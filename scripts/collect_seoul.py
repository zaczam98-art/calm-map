"""서울 실시간 도시데이터(citydata_ppltn)에서 추적 장소의 실시간 혼잡도와 12시간 예측을 모은다.

산출물
- snapshot.json : 최신 1회분(앱이 읽는다)
- history.json  : 시간대별 관측값(obs)과 그 시각에 받은 예측값(fc)을 누적한다(주간 패턴 계산과 예측 검증용)

사용: SEOUL_KEY=발급키 python scripts/collect_seoul.py [snapshot 경로] [history 경로]
- 직전 수집이 50분 이내면 건너뛴다(FORCE=1이면 항상 수집). 장소당 호출을 시간당 1회 이하로 묶기 위한 장치다.
- 키가 없으면 sample 키로 광화문·덕수궁만 받는다(시험용).
"""
import datetime, json, os, sys, time, urllib.parse, urllib.request, zoneinfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEY = os.environ.get('SEOUL_KEY') or 'sample'
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'snapshot.json')
HIST = sys.argv[2] if len(sys.argv) > 2 else None
KST = zoneinfo.ZoneInfo('Asia/Seoul')
NOW = datetime.datetime.now(KST)
MIN_GAP_MIN = 50
LEVELS = ['여유', '보통', '약간 붐빔', '붐빔']
KEEP_DAYS = 45


def set_output(changed):
    gh = os.environ.get('GITHUB_OUTPUT')
    if gh:
        with open(gh, 'a', encoding='utf-8') as f:
            f.write('changed=' + ('true' if changed else 'false') + '\n')


prev = {}
if os.path.exists(OUT):
    try:
        prev = json.load(open(OUT, encoding='utf-8'))
    except Exception:
        prev = {}
PREV = prev.get('places', {})

if prev.get('updatedAt') and not os.environ.get('FORCE'):
    try:
        last = datetime.datetime.strptime(prev['updatedAt'], '%Y-%m-%d %H:%M').replace(tzinfo=KST)
        age = (NOW - last).total_seconds() / 60
        if 0 <= age < MIN_GAP_MIN:
            print(f'skip: last snapshot is {age:.0f} min old (< {MIN_GAP_MIN})')
            set_output(False)
            sys.exit(0)
    except ValueError:
        pass

places = [p for p in json.load(open(os.path.join(ROOT, 'src', 'data', 'places.json'), encoding='utf-8')) if p['tracked']]
if KEY == 'sample':
    places = [{'name': '광화문·덕수궁'}]  # 샘플 키는 이 장소만 허용


def fetch(name):
    url = f'http://openapi.seoul.go.kr:8088/{KEY}/json/citydata_ppltn/1/5/{urllib.parse.quote(name)}'
    with urllib.request.urlopen(url, timeout=20) as r:
        d = json.load(r)
    rows = d.get('SeoulRtd.citydata_ppltn') or []
    if not rows:
        raise RuntimeError(str(d.get('RESULT') or d)[:200])
    row = rows[0]
    live = {'time': row['PPLTN_TIME'], 'level': row['AREA_CONGEST_LVL'], 'min': int(row['AREA_PPLTN_MIN']), 'max': int(row['AREA_PPLTN_MAX'])}
    fcst = []
    if row.get('FCST_YN') == 'Y':
        for f in row.get('FCST_PPLTN') or []:
            fcst.append({'time': f['FCST_TIME'], 'level': f['FCST_CONGEST_LVL'], 'min': int(f['FCST_PPLTN_MIN']), 'max': int(f['FCST_PPLTN_MAX'])})
    return {'live': live, 'fcst': fcst}


out = {'updatedAt': NOW.strftime('%Y-%m-%d %H:%M'), 'source': 'seoul', 'places': {}}  # 러너가 UTC라서 KST로 고정
fails = []
for p in places:
    try:
        out['places'][p['name']] = fetch(p['name'])
    except Exception as e:
        fails.append(f"{p['name']}: {e}")
        if p['name'] in PREV:
            out['places'][p['name']] = {**PREV[p['name']], 'stale': True}
    time.sleep(0.3)

json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
print(f"saved {len(out['places'])} places -> {OUT}; failures {len(fails)}")
for f in fails:
    print(' -', str(f).replace(KEY, '<KEY>'))


def lvl(name):
    return LEVELS.index(name) if name in LEVELS else -1


def hours_between(a, b):
    fa = datetime.datetime.strptime(a, '%Y-%m-%d %H')
    fb = datetime.datetime.strptime(b, '%Y-%m-%d %H')
    return int(round((fb - fa).total_seconds() / 3600))


if HIST:
    hist = {'v': 1, 'obs': {}, 'fc': {}, 'runs': []}
    if os.path.exists(HIST):
        try:
            hist = json.load(open(HIST, encoding='utf-8'))
        except Exception:
            pass
    hist.setdefault('obs', {})
    hist.setdefault('fc', {})
    hist.setdefault('runs', [])
    cutoff = (NOW - datetime.timedelta(days=KEEP_DAYS)).strftime('%Y-%m-%d %H')
    added = 0
    for name, ps in out['places'].items():
        if ps.get('stale') or not ps.get('live'):
            continue
        ohour = ps['live']['time'][:13]
        obs = hist['obs'].setdefault(name, {})
        # obs[시각] = [혼잡 단계(0~3), 인구 최소, 인구 최대]
        obs[ohour] = [lvl(ps['live']['level']), ps['live']['min'], ps['live']['max']]
        added += 1
        fc = hist['fc'].setdefault(name, {})
        for f in ps.get('fcst') or []:
            target = f['time'][:13]
            lead = hours_between(ohour, target)
            if 1 <= lead <= 12:
                # fc[대상 시각][몇 시간 전 예측인지] = [예측 단계, 예측 인구 중앙값]
                fc.setdefault(target, {})[str(lead)] = [lvl(f['level']), (f['min'] + f['max']) // 2]
        for table in (obs, fc):
            for k in [k for k in table if k < cutoff]:
                del table[k]
    hist['runs'] = [r for r in hist['runs'] if r[:13] >= cutoff] + [out['updatedAt']]
    json.dump(hist, open(HIST, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(f"history: +{added} observations, runs={len(hist['runs'])} -> {HIST}")

set_output(True)
