"""오늘의 브리핑을 만든다.

최신 snapshot.json의 예측에서 규칙이 '여유 구간'과 '붐비는 구간' 후보를 계산하고, 생성형 AI(Gemini)가 그중에서 골라 문장을 쓴다.
답은 규칙 검사(형식, 금지 표현, 자료와의 사실 일치)를 통과한 것만 briefing.json에 싣는다. 반려되면 이유를 알려 주고 다시 쓰게 한다.
세 번 안에 통과하지 못하거나 키가 없으면 같은 자료로 규칙 기반 문장을 만든다.

사용: GEMINI_KEY=... python scripts/gen_briefing.py snapshot.json briefing.json
- 06~21시(한국 시간)에만, 직전 브리핑 후 170분이 지나야 새로 만든다(FORCE_BRIEFING=1이면 항상 만든다).
- AI에 보내는 것은 장소 이름과 시간대별 혼잡도 예측뿐이다(개인정보 없음).
"""
import datetime, json, os, re, sys, time, urllib.error, urllib.request, zoneinfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAP = sys.argv[1]
OUT = sys.argv[2]
KEY = os.environ.get('GEMINI_KEY') or ''
MODEL = os.environ.get('GEMINI_MODEL') or 'gemini-flash-lite-latest'
FORCE = bool(os.environ.get('FORCE_BRIEFING'))
KST = zoneinfo.ZoneInfo('Asia/Seoul')
NOW = datetime.datetime.now(KST)
LEVELS = ['여유', '보통', '약간 붐빔', '붐빔']
DAY_START, DAY_END = 8, 21  # 권고 대상 시간대(8시부터 21시 시작 칸까지)
MIN_GAP_MIN = 170
MAX_LEN = 40
FORBIDDEN = ['장애', '자폐', '진단', '증상', '치료', '환자', '위험', '절대', '금지', '경고', '사고', '못 가', '못가',
             '행사', '축제', '공사', '주차', '할인', '세일', '날씨', '비가', '눈이', '입장료', '무료',
             '조용', '소음', '시끄']  # 혼잡도 예측만으로 소리의 크기를 단정하지 않는다

snap = json.load(open(SNAP, encoding='utf-8'))
prev = {}
if os.path.exists(OUT):
    try:
        prev = json.load(open(OUT, encoding='utf-8'))
    except Exception:
        prev = {}
stats = prev.get('stats') or {'runs': 0, 'aiAttempts': 0, 'aiPasses': 0, 'firstTryPasses': 0, 'aiBriefings': 0, 'ruleBriefings': 0, 'apiErrors': 0, 'reasons': {}}

if not FORCE:
    if not (6 <= NOW.hour < 21):
        print('skip: outside 06-21 KST')
        sys.exit(0)
    if prev.get('generatedAt'):
        try:
            last = datetime.datetime.strptime(prev['generatedAt'], '%Y-%m-%d %H:%M').replace(tzinfo=KST)
            if 0 <= (NOW - last).total_seconds() / 60 < MIN_GAP_MIN:
                print('skip: last briefing is recent')
                sys.exit(0)
        except ValueError:
            pass

today = NOW.strftime('%Y-%m-%d')
start = max(NOW.hour, DAY_START)
cats = {p['name']: p['category'] for p in json.load(open(os.path.join(ROOT, 'src', 'data', 'places.json'), encoding='utf-8'))}

# 장소별 오늘 남은 시간대의 혼잡 단계(0~3)
table = {}
for name, ps in snap.get('places', {}).items():
    if ps.get('stale'):
        continue
    lv = {}
    live = ps.get('live')
    if live and live['time'][:10] == today and int(live['time'][11:13]) == NOW.hour and live['level'] in LEVELS:
        lv[NOW.hour] = LEVELS.index(live['level'])
    for f in ps.get('fcst') or []:
        if f['time'][:10] == today and f['level'] in LEVELS:
            h = int(f['time'][11:13])
            lv.setdefault(h, LEVELS.index(f['level']))
    lv = {h: v for h, v in lv.items() if start <= h <= DAY_END}
    if lv:
        table[name] = lv

hours_left = sorted({h for lv in table.values() for h in lv})
if len(hours_left) < 2:
    print('skip: fewer than 2 hours left today')
    sys.exit(0)


def runs(lv, ok):
    """조건을 만족하는 연속 시간대 목록 [(from, to_exclusive)]"""
    out, cur = [], None
    for h in range(start, DAY_END + 2):
        good = h in lv and ok(lv[h])
        if good and cur is None:
            cur = h
        if not good and cur is not None:
            out.append((cur, h))
            cur = None
    return out


def best_windows(ok, min_len=2):
    found = []
    for name, lv in table.items():
        rs = [r for r in runs(lv, ok) if r[1] - r[0] >= min_len]
        if rs:
            f, t = max(rs, key=lambda r: (r[1] - r[0], -r[0]))
            found.append({'place': name, 'from': f, 'to': t})
    return sorted(found, key=lambda w: (-(w['to'] - w['from']), w['from'], w['place']))


calm = best_windows(lambda v: v == 0)
busy = best_windows(lambda v: v >= 2)


def ends_politely(s):
    return bool(re.search(r'요[.!]?$', s.strip()))


def check_text(label, s, reasons):
    if not isinstance(s, str) or not s.strip():
        reasons.append(f'{label} 없음')
        return
    if len(s.strip()) > MAX_LEN:
        reasons.append(f'{label} 글자 수 초과')
    if not ends_politely(s):
        reasons.append(f"{label}이 '~요'로 끝나지 않음")
    for w in FORBIDDEN:
        if w in s:
            reasons.append(f"{label} 금지 표현 '{w}'")


def check_window(label, w, ok, reasons):
    if not isinstance(w, dict) or w.get('place') not in table:
        reasons.append(f'{label} 장소가 자료에 없음')
        return
    f, t = w.get('from'), w.get('to')
    if not (isinstance(f, int) and isinstance(t, int)) or not (start <= f < t <= DAY_END + 1):
        reasons.append(f'{label} 시간 범위 오류')
        return
    if t - f < 2:
        reasons.append(f'{label} 2시간 미만')
    lv = table[w['place']]
    if any(h not in lv or not ok(lv[h]) for h in range(f, t)):
        reasons.append(f'{label} 자료와 불일치')


def validate(d):
    """형식, 금지 표현, 자료와의 사실 일치를 검사한다. 통과하면 빈 목록."""
    reasons = []
    if not isinstance(d, dict):
        return ['객체가 아님']
    check_text('headline', d.get('headline'), reasons)
    check_text('tip', d.get('tip'), reasons)
    picks = d.get('picks')
    if not isinstance(picks, list) or not (1 <= len(picks) <= 3):
        reasons.append('picks 개수가 1~3이 아님')
        picks = picks if isinstance(picks, list) else []
    for i, w in enumerate(picks):
        check_window(f'pick{i + 1}', w, lambda v: v == 0, reasons)
        check_text(f'pick{i + 1} reason', (w or {}).get('reason') if isinstance(w, dict) else None, reasons)
    avoid = d.get('avoid') or []
    if not isinstance(avoid, list) or len(avoid) > 2:
        reasons.append('avoid 개수가 0~2가 아님')
        avoid = []
    for i, w in enumerate(avoid):
        check_window(f'avoid{i + 1}', w, lambda v: v >= 2, reasons)
    names = [w.get('place') for w in picks if isinstance(w, dict)]
    if len(names) != len(set(names)):
        reasons.append('picks 장소 중복')
    return reasons


def clean(d):
    return {
        'headline': d['headline'].strip(),
        'picks': [{'place': w['place'], 'from': w['from'], 'to': w['to'], 'reason': w['reason'].strip()} for w in d['picks']],
        'avoid': [{'place': w['place'], 'from': w['from'], 'to': w['to']} for w in (d.get('avoid') or [])],
        'tip': d['tip'].strip(),
    }


def ask_gemini(feedback=None):
    """규칙이 계산한 후보 구간을 주고, AI는 그중에서 고르고 문장을 쓴다. 답은 validate()가 자료와 다시 대조한다."""
    def line(w):
        return f"- {w['place']} ({cats.get(w['place'], '')}): {w['from']}시부터 {w['to']}시 전까지"
    prompt_lines = [
        '당신은 발달장애 아동 가족의 외출을 돕는 안내 문장을 쓰는 사람입니다.',
        f'아래는 서울시 혼잡도 예측에서 뽑은 오늘({today}) 남은 시간의 후보 구간입니다.',
        '이 후보만 근거로 오늘의 브리핑을 JSON으로 쓰세요.',
        '규칙:',
        "- picks: '여유 구간 후보'에서 1~3개를 고릅니다. place, from, to는 후보에 적힌 값을 그대로 씁니다. 분류가 서로 다른 장소가 섞이면 좋습니다.",
        "- avoid: '붐비는 구간 후보'에서 0~2개를 고릅니다. place, from, to는 후보에 적힌 값을 그대로 씁니다. 후보가 없으면 빈 배열로 둡니다.",
        f"- headline, 각 pick의 reason, tip은 각각 {MAX_LEN}자 이내의 쉬운 말로 쓰고 '~요'로 끝냅니다.",
        '- 후보에 없는 사실(행사, 공사, 날씨, 주차, 가격, 시설)은 쓰지 않습니다. 진단이나 판정, 금지 표현을 쓰지 않고 권고만 합니다.',
        '여유 구간 후보:',
        *[line(w) for w in calm[:12]],
        '붐비는 구간 후보:',
        *([line(w) for w in busy[:6]] or ['- 없음']),
    ]
    if feedback:
        prompt_lines += ['이전 답은 다음 이유로 반려되었습니다. 같은 실수를 반복하지 마세요:', *[f'- {r}' for r in feedback[:5]]]
    prompt = '\n'.join(prompt_lines)
    window = {'type': 'OBJECT', 'properties': {'place': {'type': 'STRING'}, 'from': {'type': 'INTEGER'}, 'to': {'type': 'INTEGER'}}, 'required': ['place', 'from', 'to']}
    pick = {'type': 'OBJECT', 'properties': {**window['properties'], 'reason': {'type': 'STRING'}}, 'required': ['place', 'from', 'to', 'reason']}
    body = {
        'contents': [{'parts': [{'text': prompt}]}],
        'generationConfig': {
            'temperature': 0.5,
            'responseMimeType': 'application/json',
            'responseSchema': {
                'type': 'OBJECT',
                'properties': {'headline': {'type': 'STRING'}, 'picks': {'type': 'ARRAY', 'items': pick}, 'avoid': {'type': 'ARRAY', 'items': window}, 'tip': {'type': 'STRING'}},
                'required': ['headline', 'picks', 'avoid', 'tip'],
            },
        },
    }
    req = urllib.request.Request(
        f'https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent',
        data=json.dumps(body).encode('utf-8'),
        headers={'Content-Type': 'application/json', 'X-goog-api-key': KEY},
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        j = json.load(r)
    text = (((j.get('candidates') or [{}])[0].get('content') or {}).get('parts') or [{}])[0].get('text') or ''
    return json.loads(text)


def rule_based():
    """AI 없이 같은 자료로 만드는 문장. 여유 구간이 없으면 '보통 이하' 구간으로 대신한다."""
    if calm:
        picks = [{**w, 'reason': "예측 혼잡도가 계속 '여유'예요."} for w in calm[:3]]
        headline = '오늘 남은 시간에 여유로운 곳을 골랐어요.'
    else:
        mild = best_windows(lambda v: v <= 1)
        picks = [{**w, 'reason': "예측 혼잡도가 '보통' 이하예요."} for w in mild[:3]]
        headline = '오늘은 여유로운 곳이 드물어요. 덜 붐비는 곳이에요.'
    return {'headline': headline, 'picks': picks, 'avoid': busy[:2], 'tip': '출발 전에 지도를 한 번 더 확인해요.'}


stats['runs'] += 1
result, source, attempts_used, last_reasons = None, 'rule', 0, []
if KEY and calm:
    for attempt in range(1, 4):
        attempts_used = attempt
        try:
            draft = ask_gemini(last_reasons)
        except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError, TimeoutError, KeyError) as e:
            stats['apiErrors'] += 1
            print(f'attempt {attempt}: api error {type(e).__name__}')
            time.sleep(8)
            continue
        stats['aiAttempts'] += 1
        last_reasons = validate(draft)
        if not last_reasons:
            stats['aiPasses'] += 1
            if attempt == 1:
                stats['firstTryPasses'] += 1
            result, source = clean(draft), 'ai'
            break
        for r in last_reasons[:3]:
            key = re.sub(r'\d+', 'N', r)
            stats['reasons'][key] = stats['reasons'].get(key, 0) + 1
        print(f'attempt {attempt}: rejected ->', ' / '.join(last_reasons[:3]))
        time.sleep(4)

if result is None:
    result = rule_based()
    stats['ruleBriefings'] += 1
else:
    stats['aiBriefings'] += 1

if not result['picks']:
    print('skip: nothing to recommend')
    sys.exit(0)

out = {
    'generatedAt': NOW.strftime('%Y-%m-%d %H:%M'),
    'date': today,
    'basis': snap.get('updatedAt'),
    'source': source,
    'model': MODEL if source == 'ai' else None,
    'attemptsUsed': attempts_used,
    **result,
    'stats': stats,
}
json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(f"briefing: source={source}, picks={len(result['picks'])}, avoid={len(result['avoid'])}, attempts={attempts_used} -> {OUT}")
print('  ', result['headline'])
