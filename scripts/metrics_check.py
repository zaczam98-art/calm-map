"""derive_stats.py(적중률 집계)와 collect_seoul.py(이력 적재)의 변경을 검사한다. 종료 코드 0이면 통과다.

사용: python scripts/metrics_check.py history.json metrics.json
- history.json과 metrics.json은 data 브랜치에서 같은 시점에 받은 사본이다(raw.githubusercontent.com/<저장소>/data/).

검사
1. 같은 history.json으로 derive_stats.py를 돌렸을 때 기존 필드가 게시된 metrics.json과 같다(updatedAt은 계산 시각이라 제외).
2. 새 필드를 포함한 모든 필드가 따로 짠 재계산과 같다.
3. 손으로 센 작은 자료(경계값, 3원소·4원소 obs 혼합, 무효 값 포함)의 기대값과 같다.
4. 3원소·4원소 obs가 섞여도 같은 입력이면 결과가 같다.
5. collect_seoul.py를 모의 응답으로 돌려 시차 2 저장, 4원소 obs, 같은 시간대 재수집 때 기존 값 유지를 확인한다(서울시 API는 부르지 않는다).
"""
import collections, copy, datetime, json, os, subprocess, sys, tempfile, zoneinfo

HERE = os.path.dirname(os.path.abspath(__file__))
DERIVE = os.path.join(HERE, 'derive_stats.py')
COLLECT = os.path.join(HERE, 'collect_seoul.py')
OLD_KEYS = ('n', 'exact', 'within1', 'persistN', 'persistExact')
NEW_KEYS = ('over', 'biasSum', 'popHit', 'persistPopHit')
LEADS = ('1', '2', '3', '6', '12')
FMT = '%Y-%m-%d %H'
fails = []


def check(ok, label, detail=''):
    print(('PASS ' if ok else 'FAIL ') + label + ('' if ok or not detail else f' | {detail}'))
    if not ok:
        fails.append(label)


def derive(hist, tmp, tag):
    """history 딕셔너리로 derive_stats.py를 돌려 metrics.json 내용을 돌려준다."""
    h, p, m = (os.path.join(tmp, f'{tag}_{x}.json') for x in ('history', 'pattern', 'metrics'))
    json.dump(hist, open(h, 'w', encoding='utf-8'), ensure_ascii=False)
    subprocess.run([sys.executable, DERIVE, h, p, m], check=True, capture_output=True)
    return json.load(open(m, encoding='utf-8'))


def stable(metrics):
    return {k: v for k, v in metrics.items() if k != 'updatedAt'}


def recompute(hist):
    """derive_stats.py와 다른 구조(짝 목록을 먼저 만들고 센다)로 시차별 값을 센다."""
    obs = {(n, datetime.datetime.strptime(k, FMT)): v for n, o in hist['obs'].items() for k, v in o.items()}
    pairs = []
    for n, f in hist['fc'].items():
        for target, by_lead in f.items():
            for lead, val in by_lead.items():
                pairs.append((n, datetime.datetime.strptime(target, FMT), lead, val))
    out = {l: collections.Counter() for l in LEADS}
    for n, t, lead, val in pairs:
        a = obs.get((n, t))
        if lead not in out or a is None or a[0] < 0 or val[0] < 0:
            continue
        c = out[lead]
        c['n'] += 1
        c['exact'] += val[0] == a[0]
        c['within1'] += abs(val[0] - a[0]) <= 1
        c['over'] += val[0] > a[0]
        c['biasSum'] += val[0] - a[0]
        c['popHit'] += a[1] <= val[1] <= a[2]
        e = obs.get((n, t - datetime.timedelta(hours=int(lead))))
        if e is not None and e[0] >= 0:
            c['persistN'] += 1
            c['persistExact'] += e[0] == a[0]
            c['persistPopHit'] += a[1] <= (e[1] + e[2]) // 2 <= a[2]
    full = {l: {k: c[k] for k in OLD_KEYS + NEW_KEYS} for l, c in out.items()}
    full_overall = {k: sum(full[l][k] for l in LEADS) for k in OLD_KEYS + NEW_KEYS}
    return full, full_overall


def tiny():
    """손으로 센 기대값이 있는 작은 자료. A는 3원소와 4원소 obs가 섞여 있고, B는 무효 단계, C는 인구 범위 경계다."""
    hist = {'v': 1, 'runs': ['2026-10-09 12:06'], 'obs': {
        'A': {'2026-10-09 10': [1, 100, 200, 40], '2026-10-09 11': [2, 300, 500], '2026-10-09 12': [3, 800, 1000, 35]},
        'B': {'2026-10-09 11': [-1, 0, 0]},
        'C': {'2026-10-09 09': [1, 1000, 1200], '2026-10-09 10': [1, 1100, 1300, 40]},
    }, 'fc': {
        'A': {'2026-10-09 11': {'1': [3, 500], '2': [2, 299]},
              '2026-10-09 12': {'1': [1, 1000], '2': [3, 801], '3': [-1, 0], '4': [3, 900]}},
        'B': {'2026-10-09 11': {'1': [2, 5]}},
        'C': {'2026-10-09 10': {'1': [0, 1050]}},
    }}
    zero = dict.fromkeys(OLD_KEYS + NEW_KEYS, 0)
    want = {l: dict(zero) for l in LEADS}
    want['1'].update(n=3, exact=0, within1=2, persistN=3, persistExact=1, over=1, biasSum=-2, popHit=2, persistPopHit=1)
    want['2'].update(n=2, exact=2, within1=2, persistN=1, persistExact=0, over=0, biasSum=0, popHit=1, persistPopHit=0)
    overall = dict(n=5, exact=2, within1=4, persistN=4, persistExact=1, over=1, biasSum=-2, popHit=3, persistPopHit=1)
    return hist, want, overall


def mixed_obs(hist):
    """obs 항목을 하나 걸러 4번째 원소(분)를 붙이거나 떼어 3원소·4원소를 섞는다."""
    out = copy.deepcopy(hist)
    i = 0
    for o in out['obs'].values():
        for k in sorted(o):
            i += 1
            o[k] = o[k][:3] + ([40] if i % 2 else [])
    return out


BOOT = r'''
import io, json, runpy, sys, time, urllib.request
payload = json.load(open(sys.argv[1], encoding='utf-8'))
urllib.request.urlopen = lambda url, timeout=0: io.BytesIO(json.dumps(payload).encode('utf-8'))
time.sleep = lambda s: None
sys.argv = ['collect_seoul.py'] + sys.argv[2:]
runpy.run_path(%r, run_name='__main__')
'''


def collect_run(tmp, tag, hist, ptime, level, lo, hi, today):
    """모의 응답(광화문·덕수궁 한 곳)으로 collect_seoul.py를 돌리고 갱신된 history를 돌려준다. 12칸 예측은 실시간 시각 다음 정시부터다."""
    base = datetime.datetime.strptime(f'{today} {ptime[:2]}', FMT)
    first = base + datetime.timedelta(hours=2)  # 매시 수집에서는 실시간 값(h시 40분)보다 두 시간 뒤 정시가 첫 칸이다
    fcst = [{'FCST_TIME': (first + datetime.timedelta(hours=i)).strftime('%Y-%m-%d %H:00'), 'FCST_CONGEST_LVL': '보통',
             'FCST_PPLTN_MIN': str(lo + i), 'FCST_PPLTN_MAX': str(hi + i)} for i in range(12)]
    row = {'PPLTN_TIME': f'{today} {ptime}', 'AREA_CONGEST_LVL': level, 'AREA_PPLTN_MIN': str(lo), 'AREA_PPLTN_MAX': str(hi), 'FCST_YN': 'Y', 'FCST_PPLTN': fcst}
    pay, h, snap = (os.path.join(tmp, f'{tag}_{x}.json') for x in ('payload', 'history', 'snapshot'))
    json.dump({'CITYDATA': {'LIVE_PPLTN_STTS': [row]}}, open(pay, 'w', encoding='utf-8'), ensure_ascii=False)
    json.dump(hist, open(h, 'w', encoding='utf-8'), ensure_ascii=False)
    env = {k: v for k, v in os.environ.items() if k not in ('SEOUL_KEY', 'GITHUB_OUTPUT')}
    env['FORCE'] = '1'
    r = subprocess.run([sys.executable, '-c', BOOT % COLLECT, pay, snap, h], env=env, capture_output=True, text=True)
    if r.returncode:
        print(r.stdout[-400:], r.stderr[-800:])
    check(r.returncode == 0, f'collect {tag}: 정상 종료')
    return json.load(open(h, encoding='utf-8'))


def main():
    if len(sys.argv) != 3:
        sys.exit('사용: python scripts/metrics_check.py history.json metrics.json')
    hist = json.load(open(sys.argv[1], encoding='utf-8'))
    pub = json.load(open(sys.argv[2], encoding='utf-8'))
    with tempfile.TemporaryDirectory() as tmp:
        # 1. 게시된 metrics.json과 기존 필드 비교
        new = derive(hist, tmp, 'real')
        check(pub['runs'] == len(hist['runs']) and pub['nObs'] == sum(len(o) for o in hist['obs'].values()),
              '사본 일치: metrics.json이 이 history.json에서 계산된 것이다', f"runs {pub['runs']}/{len(hist['runs'])}")
        for key in ('nObs', 'runs', 'days', 'firstObs'):
            check(new[key] == pub[key], f'기존 필드 {key}', f'{new[key]} != {pub[key]}')
        for lead, old in pub['byLead'].items():
            got = {k: new['byLead'][lead][k] for k in OLD_KEYS}
            check(got == {k: old[k] for k in OLD_KEYS}, f'기존 필드 byLead[{lead}]', f'{got} != {old}')
        check({k: new['overall'][k] for k in OLD_KEYS} == {k: pub['overall'][k] for k in OLD_KEYS}, '기존 필드 overall')
        # 2. 새 필드까지 독립 재계산과 비교
        full, full_overall = recompute(hist)
        for lead in LEADS:
            check({k: new['byLead'][lead][k] for k in OLD_KEYS + NEW_KEYS} == full[lead], f'독립 재계산 byLead[{lead}]', f"{new['byLead'][lead]} != {full[lead]}")
        check({k: new['overall'][k] for k in OLD_KEYS + NEW_KEYS} == full_overall, '독립 재계산 overall')
        # 3. 손으로 센 기대값
        t_hist, want, want_overall = tiny()
        got = derive(t_hist, tmp, 'tiny')
        for lead in LEADS:
            check({k: got['byLead'][lead][k] for k in OLD_KEYS + NEW_KEYS} == want[lead], f'손계산 byLead[{lead}]', f"{got['byLead'][lead]} != {want[lead]}")
        check({k: got['overall'][k] for k in OLD_KEYS + NEW_KEYS} == want_overall, '손계산 overall', str(got['overall']))
        # 4. 3원소·4원소 obs 혼합
        for name, h in (('실제 이력', hist), ('손계산 이력', t_hist)):
            a, b = derive(h, tmp, 'plain'), derive(mixed_obs(h), tmp, 'mixed')
            check(stable(a) == stable(b), f'3원소·4원소 obs를 섞어도 결과가 같다 ({name})')
        # 5. collect_seoul.py 모의 실행
        today = datetime.datetime.now(zoneinfo.ZoneInfo('Asia/Seoul')).strftime('%Y-%m-%d')
        place = '광화문·덕수궁'
        hour = f'{today} 08'
        empty = {'v': 1, 'obs': {}, 'fc': {}, 'runs': []}
        h1 = collect_run(tmp, 'c1', empty, '08:40', '보통', 1000, 1200, today)
        check(h1['obs'][place][hour] == [1, 1000, 1200, 40], 'collect: obs가 4원소(분 포함)로 저장된다', str(h1['obs'][place].get(hour)))
        leads = sorted({l for by in h1['fc'][place].values() for l in by}, key=int)
        check(leads == ['2', '3', '6', '12'], 'collect: 첫 예측 칸(시차 2)이 저장되고 나머지는 3, 6, 12다', str(leads))
        h2 = collect_run(tmp, 'c2', h1, '08:50', '붐빔', 5000, 6000, today)
        check(h2['obs'][place][hour] == [1, 1000, 1200, 40], 'collect: 같은 시간대 재수집이 유효한 기존 값을 덮어쓰지 않는다', str(h2['obs'][place].get(hour)))
        legacy = {'v': 1, 'obs': {place: {hour: [2, 300, 400]}}, 'fc': {}, 'runs': []}
        h3 = collect_run(tmp, 'c3', legacy, '08:50', '붐빔', 5000, 6000, today)
        check(h3['obs'][place][hour] == [2, 300, 400], 'collect: 3원소 옛 항목도 같은 시간대에는 유지된다', str(h3['obs'][place].get(hour)))
        bad = {'v': 1, 'obs': {place: {hour: [-1, 0, 0]}}, 'fc': {}, 'runs': []}
        h4 = collect_run(tmp, 'c4', bad, '08:50', '붐빔', 5000, 6000, today)
        check(h4['obs'][place][hour] == [3, 5000, 6000, 50], 'collect: 단계가 무효(-1)인 기존 값은 새 값으로 바뀐다', str(h4['obs'][place].get(hour)))
        h5 = collect_run(tmp, 'c5', h1, '09:40', '여유', 800, 900, today)
        check(h5['obs'][place][f'{today} 09'] == [0, 800, 900, 40] and h5['obs'][place][hour][3:] == [40], 'collect: 다른 시간대는 새 항목으로 쌓인다')
        check(stable(derive(h5, tmp, 'after'))['nObs'] == 2, 'derive: collect가 만든 이력을 읽는다(관측 2건)')
    print(f"\n{'통과' if not fails else '실패 ' + str(len(fails)) + '건'}")
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
