"""서울시 S-DoT 센서의 시간대별 소음 실측값을 장소별 요일×시간대 통계로 모은다.

S-DoT 환경정보(IotVdata017)는 시내 약 1,000개 센서의 1시간 단위 최소·평균·최대값을 전날 치까지 준다(최근 약 33일).
이 스크립트는 아직 처리하지 않은 날짜를 최신부터 며칠씩 받아 센서별 누적 상태(noise_state.json)에 더하고,
앱이 읽는 장소별 요약(noise.json)을 다시 만든다.

사용: SEOUL_KEY=발급키 python scripts/collect_sdot.py noise_state.json noise.json
- 한 번에 처리하는 날짜 수는 SDOT_MAX_DAYS(기본 6)로 제한한다. 하루 치는 약 25회 호출(1,000행씩)이다.
- 장소와 센서의 대응은 scripts/sdot_place_sensors.json에 있다(직선 0.6km 안 최대 3개, 없으면 1.0km 안 1개).

센서 품질 걸러 내기
- 값이 바닥값(35dB)에 붙어 있거나 거의 변하지 않는 센서가 있다(2026-10-08 점검: 1,021개 중 약 30개가 대부분의 시간에 35dB).
- 센서-날짜 단위: 그날 관측이 12시간 이상인데 시간 평균이 35.5dB 이하인 시간이 80% 이상이거나 최댓값과 최솟값 차이가 1dB 이하이면 그날 치는 더하지 않는다.
- 센서 단위(요약을 만들 때): 누적 관측 24시간 이상인 센서 가운데 같은 기준에 걸리는 센서는 제외한다.

산출 정의(noise.json의 places[장소])
- avg[요일] : 7시부터 22시까지 시간대별로, 쓸 수 있는 센서가 보고한 '시간 평균 소음(dB)'의 평균. 요일은 일요일=0
- max[요일] : 같은 칸에서 센서가 보고한 '시간 최대 소음(dB)'의 평균(그 시간에 났던 가장 큰 소리의 보통 수준)
- sensors, km : 쓴 센서 수와 거리 범위(직선). excluded는 품질 문제로 뺀 센서 수
- n : 더한 센서·시간 수
"""
import datetime, json, os, sys, time, urllib.request, zoneinfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEY = os.environ.get('SEOUL_KEY') or ''
STATE, OUT = sys.argv[1], sys.argv[2]
MAX_DAYS = int(os.environ.get('SDOT_MAX_DAYS') or 6)
LOOKBACK = 33
PAGE = 1000
HOUR_FROM, HOUR_TO = 7, 22  # 앱용 요약에 싣는 시간대
FLOOR_DB, FLOOR_FRAC, MIN_RANGE_DB, MIN_HOURS = 35.5, 0.8, 1.0, 24
DAY_MIN_HOURS = 12  # 센서-날짜 품질 판정에 필요한 최소 관측 시간 수
GRACE_DAYS = 2  # 어제부터 이 일수 안의 날짜는 자료가 없어도 '없음'으로 확정하지 않는다
KST = zoneinfo.ZoneInfo('Asia/Seoul')
NOW = datetime.datetime.now(KST)

if not KEY:
    print('skip: SEOUL_KEY not set')
    sys.exit(0)

m = json.load(open(os.path.join(ROOT, 'scripts', 'sdot_place_sensors.json'), encoding='utf-8'))
aliases = m.get('aliases', {})
needed = {s['sn'] for sensors in m['places'].values() for s in sensors}

state = None
if os.path.exists(STATE):
    try:
        state = json.load(open(STATE, encoding='utf-8'))
    except Exception:
        state = None
if not state or state.get('v') != 2:
    state = {'v': 2, 'processed': [], 'empty': [], 'sensors': {}}  # 형식이 바뀌면 처음부터 다시 모은다

yesterday = (NOW - datetime.timedelta(days=1)).date()
wanted = [(yesterday - datetime.timedelta(days=i)).isoformat() for i in range(LOOKBACK)]
todo = [d for d in wanted if d not in state['processed'] and d not in state['empty']][:MAX_DAYS]


def num(v):
    try:
        x = float(v)
        return x if x == x else None
    except (TypeError, ValueError):
        return None


def fetch_day(date):
    rows, start = [], 1
    while True:
        url = f'http://openapi.seoul.go.kr:8088/{KEY}/json/IotVdata017/{start}/{start + PAGE - 1}/%20/{date}'
        with urllib.request.urlopen(url, timeout=60) as r:
            d = json.load(r)
        v = d.get('IotVdata017')
        if not v:
            code = (d.get('RESULT') or {}).get('CODE')
            if code == 'INFO-200':
                return rows  # 그 날짜의 자료 없음
            raise RuntimeError(str(d)[:160].replace(KEY, '<KEY>'))
        rows += v['row']
        if start + PAGE - 1 >= int(v['list_total_count']):
            return rows
        start += PAGE
        time.sleep(0.1)


changed = False
for date in todo:
    try:
        rows = fetch_day(date)
    except Exception as e:
        print(f'{date}: failed {type(e).__name__}: {str(e)[:120]}')
        continue
    recent = date >= (yesterday - datetime.timedelta(days=GRACE_DAYS)).isoformat()
    if not rows:
        # 자료가 늦게 올라올 수 있으므로 최근 며칠은 비어 있다고 확정하지 않는다
        if not recent:
            state['empty'].append(date)
            changed = True
        print(f'{date}: no rows')
        continue
    # 센서별로 그날 값을 먼저 모은다
    by_sensor = {}
    for r in rows:
        sn = aliases.get(r.get('SN'), r.get('SN'))
        if sn not in needed:
            continue
        hr = str(r.get('MSRMT_HR') or '')  # 'YYYY-MM-DD_HH:07:00'
        try:
            t = datetime.datetime.strptime(hr[:13], '%Y-%m-%d_%H')
        except ValueError:
            continue
        avg, mx = num(r.get('AVG_NIS')), num(r.get('MAX_NIS'))
        if avg is None or mx is None or not (20 <= avg <= 120) or not (20 <= mx <= 130):
            continue
        by_sensor.setdefault(sn, []).append((t, avg, mx))
    used = skipped = 0
    for sn, vals in by_sensor.items():
        # 그날 하루치가 바닥값에 붙어 있거나 거의 변하지 않으면 그 센서-날짜는 쓰지 않는다(고장이나 통신 이상)
        avgs = [v[1] for v in vals]
        if len(avgs) >= DAY_MIN_HOURS and (sum(1 for a in avgs if a <= FLOOR_DB) / len(avgs) >= FLOOR_FRAC or max(avgs) - min(avgs) <= MIN_RANGE_DB):
            skipped += 1
            continue
        s = state['sensors'].setdefault(sn, {'cells': {}, 'q': [0, 0, avgs[0], avgs[0]]})
        q = s['q']  # [관측 시간 수, 바닥값인 시간 수, 시간 평균의 최솟값, 최댓값]
        for t, avg, mx in vals:
            c = s['cells'].setdefault(f'{(t.weekday() + 1) % 7}-{t.hour}', [0, 0, 0])  # [평균 합, 최대 합, n], 요일은 일요일=0
            c[0] += avg
            c[1] += mx
            c[2] += 1
            q[0] += 1
            q[1] += 1 if avg <= FLOOR_DB else 0
            q[2] = min(q[2], avg)
            q[3] = max(q[3], avg)
            used += 1
    if used == 0 and recent:
        print(f'{date}: {len(rows)} rows but nothing usable yet; will retry')
        continue
    state['processed'].append(date)
    changed = True
    print(f'{date}: {len(rows)} rows, {used} used, {skipped} sensor-days skipped for quality')

state['processed'] = sorted(set(state['processed']))
json.dump(state, open(STATE, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))


def usable(sn):
    s = state['sensors'].get(sn)
    if not s:
        return None  # 값이 없는 센서
    n, floor, lo, hi = s['q']
    if n < MIN_HOURS:
        return None
    return not (floor / n >= FLOOR_FRAC or hi - lo <= MIN_RANGE_DB)


places_out, excluded_total, no_data = {}, 0, 0
for place, sensors in m['places'].items():
    good = [s for s in sensors if usable(s['sn']) is True]
    excluded = sum(1 for s in sensors if usable(s['sn']) is False)
    excluded_total += excluded
    if not good:
        no_data += 1
        continue
    avg, mx, total = {}, {}, 0
    for dow in range(7):
        a, b = [], []
        for h in range(HOUR_FROM, HOUR_TO + 1):
            sa = sb = n = 0
            for s in good:
                c = state['sensors'][s['sn']]['cells'].get(f'{dow}-{h}')
                if c:
                    sa += c[0]
                    sb += c[1]
                    n += c[2]
            a.append(round(sa / n, 1) if n else None)
            b.append(round(sb / n, 1) if n else None)
            total += n
        if any(v is not None for v in a):
            avg[str(dow)] = a
            mx[str(dow)] = b
    if not avg:
        no_data += 1
        continue
    kms = [s['km'] for s in good]
    places_out[place] = {'sensors': len(good), 'km': [min(kms), max(kms)], 'excluded': excluded, 'avg': avg, 'max': mx, 'n': total}

out = {
    'updatedAt': NOW.strftime('%Y-%m-%d %H:%M'),
    'days': len(state['processed']),
    'from': state['processed'][0] if state['processed'] else None,
    'to': state['processed'][-1] if state['processed'] else None,
    'hours': [HOUR_FROM, HOUR_TO],
    'places': places_out,
}
json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
remaining = len([d for d in wanted if d not in state['processed'] and d not in state['empty']])
print(f"noise: {len(places_out)} places with usable sensors, {no_data} without; {excluded_total} place-sensor links excluded for quality; "
      f"{out['days']} day(s) processed ({out['from']} ~ {out['to']}), remaining {remaining}")
gh = os.environ.get('GITHUB_OUTPUT')
if gh:
    with open(gh, 'a', encoding='utf-8') as f:
        f.write(f"sdot_changed={'true' if changed else 'false'}\n")
