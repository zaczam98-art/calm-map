"""서울 실시간 도시데이터(citydata_ppltn)에서 추적 장소 30곳의 실시간 혼잡도와 12시간 예측을 모아 snapshot.json으로 저장한다.

사용: SEOUL_KEY=발급키 python scripts/collect_seoul.py [출력경로]
키가 없으면 'sample' 키로 광화문·덕수궁만 받는다(시험용).
"""
import json, os, sys, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEY = os.environ.get('SEOUL_KEY', 'sample')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'snapshot.json')
PREV = {}
if os.path.exists(OUT):
    try:
        PREV = json.load(open(OUT, encoding='utf-8')).get('places', {})
    except Exception:
        PREV = {}

places = [p for p in json.load(open(os.path.join(ROOT, 'src', 'data', 'places.json'), encoding='utf-8')) if p['tracked']]
if KEY == 'sample':
    places = [p for p in places if p['name'] == '광화문광장'] or places[:1]
    places = [{'name': '광화문·덕수궁'}]  # 샘플 키는 이 장소만 허용

def fetch(name: str):
    url = f"http://openapi.seoul.go.kr:8088/{KEY}/json/citydata_ppltn/1/5/{urllib.parse.quote(name)}"
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

out = {'updatedAt': time.strftime('%Y-%m-%d %H:%M'), 'source': 'seoul', 'places': {}}
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
    print(' -', f)
