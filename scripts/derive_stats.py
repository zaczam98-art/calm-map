"""history.json에서 요일×시간대 혼잡도 패턴(pattern.json)과 서울시 예측 적중률(metrics.json)을 계산한다.

사용: python scripts/derive_stats.py history.json pattern.json metrics.json

정의
- 패턴: 장소별로 (요일, 시) 칸마다 관측된 혼잡 단계(0 여유, 1 보통, 2 약간 붐빔, 3 붐빔)의 평균과 표본 수.
  요일은 일요일=0(브라우저의 getDay와 같은 기준)이다.
- 적중률: 어떤 시각의 실제 관측 단계와, 그 시각을 대상으로 k시간 전에 받은 서울시 예측 단계를 비교한다.
  exact는 단계가 같은 건수, within1은 한 단계 이내인 건수(같은 경우 포함)다.
- 비교 기준(persist): 예측 대신 k시간 전의 관측 단계가 그대로 이어진다고 가정했을 때 단계가 같은 건수다.
  예측이 이 기준보다 나은지 볼 때 쓴다.
"""
import datetime, json, sys, zoneinfo

hist = json.load(open(sys.argv[1], encoding='utf-8'))
now = datetime.datetime.now(zoneinfo.ZoneInfo('Asia/Seoul')).strftime('%Y-%m-%d %H:%M')
obs_all = hist.get('obs', {})
fc_all = hist.get('fc', {})
FMT = '%Y-%m-%d %H'

pattern = {}
dates = set()
first = None
n_obs = 0
for name, obs in obs_all.items():
    cells = {}
    for hour_key, v in obs.items():
        level = v[0]
        if level < 0:
            continue
        d = datetime.datetime.strptime(hour_key, FMT)
        key = f'{(d.weekday() + 1) % 7}-{d.hour}'
        s, n = cells.get(key, (0, 0))
        cells[key] = (s + level, n + 1)
        dates.add(hour_key[:10])
        n_obs += 1
        if first is None or hour_key < first:
            first = hour_key
    pattern[name] = {k: [round(s / n, 2), n] for k, (s, n) in cells.items()}

LEADS = (1, 3, 6, 12)  # 수집 스크립트가 남기는 시차와 같다
by_lead = {str(k): {'n': 0, 'exact': 0, 'within1': 0, 'persistN': 0, 'persistExact': 0} for k in LEADS}
for name, fc in fc_all.items():
    obs = obs_all.get(name, {})
    for target, leads in fc.items():
        if target not in obs or obs[target][0] < 0:
            continue
        actual = obs[target][0]
        t = datetime.datetime.strptime(target, FMT)
        for lead, val in leads.items():
            if lead not in by_lead or val[0] < 0:
                continue
            m = by_lead[lead]
            m['n'] += 1
            if val[0] == actual:
                m['exact'] += 1
            if abs(val[0] - actual) <= 1:
                m['within1'] += 1
            earlier = (t - datetime.timedelta(hours=int(lead))).strftime(FMT)
            if earlier in obs and obs[earlier][0] >= 0:
                m['persistN'] += 1
                if obs[earlier][0] == actual:
                    m['persistExact'] += 1

overall = {k: sum(m[k] for m in by_lead.values()) for k in ('n', 'exact', 'within1', 'persistN', 'persistExact')}
meta = {'updatedAt': now, 'firstObs': first, 'days': len(dates)}
json.dump({**meta, 'places': pattern}, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
json.dump({**meta, 'nObs': n_obs, 'runs': len(hist.get('runs', [])), 'byLead': by_lead, 'overall': overall},
          open(sys.argv[3], 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(f"pattern: {len(pattern)} places, {n_obs} observations over {len(dates)} day(s); forecast pairs: {overall['n']} (exact {overall['exact']})")
