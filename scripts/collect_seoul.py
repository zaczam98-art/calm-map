"""서울 실시간 도시데이터(citydata)에서 추적 장소의 혼잡도·12시간 예측과 감각 요인(행사, 사고·통제, 날씨, 도로)을 모은다.

산출물
- snapshot.json : 최신 1회분(앱이 읽는다)
- history.json  : 시간대별 관측값(obs)과 그 시각에 받은 예측값(fc)을 누적한다(주간 패턴 계산과 예측 검증용)

사용: SEOUL_KEY=발급키 python scripts/collect_seoul.py [snapshot 경로] [history 경로]
- 직전 수집이 50분 이내면 건너뛴다(FORCE=1이면 항상 수집). 장소당 호출을 약 1시간에 한 번으로 묶기 위한 장치다.
- citydata 호출이 실패한 장소는 인구 항목만 주는 citydata_ppltn으로 한 번 더 시도한다.
- 키가 없으면 sample 키로 광화문·덕수궁만 받는다(시험용).
"""
import datetime, json, os, sys, time, urllib.parse, urllib.request, zoneinfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEY = os.environ.get('SEOUL_KEY') or 'sample'
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'snapshot.json')
HIST = sys.argv[2] if len(sys.argv) > 2 else None
KST = zoneinfo.ZoneInfo('Asia/Seoul')
NOW = datetime.datetime.now(KST)
TODAY = NOW.strftime('%Y-%m-%d')
MIN_GAP_MIN = 50
LEVELS = ['여유', '보통', '약간 붐빔', '붐빔']
KEEP_DAYS = 45
KEEP_LEADS = (1, 2, 3, 6, 12)  # 예측 검증에 쓰는 시차만 남겨 이력 파일 크기를 줄인다. 매시 수집에서는 첫 예측 칸이 시차 2라 2도 남긴다
SHORT_EVENT_DAYS = 7  # 기간이 이보다 짧은 행사는 축제·공연처럼 사람이 몰리기 쉬운 행사로 표시한다


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


def get(service, name):
    url = f'http://openapi.seoul.go.kr:8088/{KEY}/json/{service}/1/5/{urllib.parse.quote(name)}'
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.load(r)


def population(row):
    live = {'time': row['PPLTN_TIME'], 'level': row['AREA_CONGEST_LVL'], 'min': int(row['AREA_PPLTN_MIN']), 'max': int(row['AREA_PPLTN_MAX'])}
    fcst = []
    if row.get('FCST_YN') == 'Y':
        for f in row.get('FCST_PPLTN') or []:
            fcst.append({'time': f['FCST_TIME'], 'level': f['FCST_CONGEST_LVL'], 'min': int(f['FCST_PPLTN_MIN']), 'max': int(f['FCST_PPLTN_MAX'])})
    return {'live': live, 'fcst': fcst}


def clip(s, n):
    s = ' '.join(str(s or '').split())
    return s if len(s) <= n else s[: n - 1] + '…'


def first(v):
    return (v[0] if isinstance(v, list) and v else v) or {}


def extras(c):
    """행사, 사고·통제, 날씨, 도로 소통을 화면에 쓸 만큼만 간추린다."""
    out = {}
    events = []
    for e in c.get('EVENT_STTS') or []:
        period = str(e.get('EVENT_PERIOD') or '')
        try:
            start, end = [x.strip() for x in period.split('~')]
            if not (start <= TODAY <= end):
                continue
            days = (datetime.date.fromisoformat(end) - datetime.date.fromisoformat(start)).days + 1
        except ValueError:
            continue
        events.append({'name': clip(e.get('EVENT_NM'), 40), 'place': clip(e.get('EVENT_PLACE'), 24), 'period': period, 'short': days <= SHORT_EVENT_DAYS})
    events.sort(key=lambda e: (not e['short'], e['name']))
    if events:
        out['events'] = events[:4]
        out['eventsN'] = len(events)
    controls = []
    now_str = NOW.strftime('%Y-%m-%d %H:%M')
    for a in c.get('ACDNT_CNTRL_STTS') or []:
        until = str(a.get('EXP_CLR_DT') or '')[:16]
        if until and until < now_str:
            continue  # 해제 예정 시각이 지난 통제는 싣지 않는다
        controls.append({'type': clip(a.get('ACDNT_TYPE'), 10), 'dtype': clip(a.get('ACDNT_DTYPE'), 14), 'info': clip(a.get('ACDNT_INFO'), 60), 'until': until})
    controls.sort(key=lambda x: x['until'] or '9999')
    if controls:
        out['controls'] = controls[:4]
        out['controlsN'] = len(controls)
    w = first(c.get('WEATHER_STTS'))
    if w:
        rain = []
        for f in w.get('FCST24HOURS') or []:
            dt = str(f.get('FCST_DT') or '')
            if len(dt) >= 10 and f'{dt[:4]}-{dt[4:6]}-{dt[6:8]}' == TODAY:
                try:
                    chance = int(f.get('RAIN_CHANCE') or 0)
                except ValueError:
                    chance = 0
                if chance >= 60 or (f.get('PRECPT_TYPE') or '없음') != '없음':
                    rain.append(int(dt[8:10]))
        out['weather'] = {'temp': w.get('TEMP'), 'pcp': w.get('PRECPT_TYPE'), 'uv': w.get('UV_INDEX_LVL'), 'pm25': w.get('PM25_INDEX'), 'pm10': w.get('PM10_INDEX'), 'rainHours': rain}
    road = (c.get('ROAD_TRAFFIC_STTS') or {})
    avg = road.get('AVG_ROAD_DATA') if isinstance(road, dict) else None
    if isinstance(avg, dict) and avg.get('ROAD_TRAFFIC_IDX'):
        out['road'] = {'idx': avg.get('ROAD_TRAFFIC_IDX'), 'spd': avg.get('ROAD_TRAFFIC_SPD')}
    return out


def fetch(name):
    try:
        c = get('citydata', name).get('CITYDATA') or {}
        row = first(c.get('LIVE_PPLTN_STTS'))
        if not row:
            raise RuntimeError('no population in citydata')
        res = population(row)
        try:
            res['extra'] = extras(c)
        except Exception as x:  # 부가 정보 처리 오류는 인구 수집을 막지 않고 로그만 남긴다
            print(f'{name}: extras failed {type(x).__name__}: {str(x)[:80]}')
        return res
    except Exception as e:  # 큰 응답이 실패하면 인구 항목만이라도 받는다
        d = get('citydata_ppltn', name)
        rows = d.get('SeoulRtd.citydata_ppltn') or []
        if not rows:
            raise RuntimeError(f'{type(e).__name__}; fallback: ' + str(d.get('RESULT') or d)[:160])
        return population(rows[0])


out = {'updatedAt': NOW.strftime('%Y-%m-%d %H:%M'), 'source': 'seoul', 'places': {}}  # 러너가 UTC라서 KST로 고정
fails = []
for p in places:
    try:
        out['places'][p['name']] = fetch(p['name'])
    except Exception as e:
        fails.append(f"{p['name']}: {e}")
        if p['name'] in PREV:
            # 이전 값을 물려주되, 날짜가 없는 행사·통제·날씨(extra)는 오늘 정보처럼 보이지 않도록 뺀다
            out['places'][p['name']] = {**{k: v for k, v in PREV[p['name']].items() if k != 'extra'}, 'stale': True}
    time.sleep(0.2)

if not any(not v.get('stale') for v in out['places'].values()):
    # 한 곳도 새로 받지 못했다. 이전 스냅샷을 그대로 두어 갱신 시각이 실제 마지막 성공 시각을 가리키게 하고, 다음 시도에서 다시 받는다.
    print('no place fetched; keeping the previous snapshot')
    for f in fails[:5]:
        print(' -', str(f).replace(KEY, '<KEY>'))
    set_output(False)
    sys.exit(0)

with_extra = sum(1 for v in out['places'].values() if 'extra' in v)
json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(f"saved {len(out['places'])} places ({with_extra} with extras) -> {OUT}; failures {len(fails)}")
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
        # obs[시각] = [혼잡 단계(0~3), 인구 최소, 인구 최대, 실시간 값 시각(PPLTN_TIME)의 분]. 분은 이 변경 뒤에 쌓은 항목에만 있고 옛 항목은 3원소다.
        # 같은 시간대를 다시 받아도 유효한 기존 값은 덮어쓰지 않는다(강제 재수집이 적중률 집계를 바꾸지 않게 한다).
        if obs.get(ohour, [-1])[0] < 0:
            obs[ohour] = [lvl(ps['live']['level']), ps['live']['min'], ps['live']['max'], int(ps['live']['time'][14:16])]
            added += 1
        fc = hist['fc'].setdefault(name, {})
        for f in ps.get('fcst') or []:
            target = f['time'][:13]
            lead = hours_between(ohour, target)
            if lead in KEEP_LEADS:
                # fc[대상 시각][몇 시간 전 예측인지] = [예측 단계, 예측 인구 중앙값]
                fc.setdefault(target, {})[str(lead)] = [lvl(f['level']), (f['min'] + f['max']) // 2]
    # 보존 기간 정리는 이번에 받지 못한 장소와 추적을 그만둔 장소에도 적용한다
    for table in (hist['obs'], hist['fc']):
        for name in list(table):
            for k in [k for k in table[name] if k < cutoff]:
                del table[name][k]
            if not table[name]:
                del table[name]
    for fcn in hist['fc'].values():  # 예전 형식의 불필요한 시차 값 정리
        for t in fcn:
            fcn[t] = {l: v for l, v in fcn[t].items() if int(l) in KEEP_LEADS}
    hist['runs'] = [r for r in hist['runs'] if r[:13] >= cutoff] + [out['updatedAt']]
    json.dump(hist, open(HIST, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(f"history: +{added} observations, runs={len(hist['runs'])} -> {HIST}")

set_output(True)
