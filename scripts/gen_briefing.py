"""오늘의 브리핑을 만든다.

최신 snapshot.json의 예측에서 규칙이 '여유 구간'과 '붐비는 구간' 후보를 계산하고, 생성형 AI(Gemini)가 그중에서 골라 문장을 쓴다.
답은 규칙 검사(형식, 금지 표현, 자료와의 사실 일치)를 통과한 것만 briefing.json에 싣는다. 반려되면 이유를 알려 주고 다시 쓰게 한다.
세 번 안에 통과하지 못하거나 키가 없으면 같은 자료로 규칙 기반 문장을 만든다.

사용: GEMINI_KEY=... python scripts/gen_briefing.py snapshot.json briefing.json
- 한국 시간 06:00부터 20:59까지 실행하며, 직전 브리핑 후 170분이 지나야 새로 만든다(FORCE_BRIEFING=1이면 항상 만든다).
- 후보 구간은 오늘 8시부터 21시 시작 칸까지(22시 전까지)다. 현재 시각 칸은 같은 시이거나 90분 이내로 앞선 실시간 관측으로 채우고,
  남은 칸이 2시간 미만이면 만들지 않는다. 정기 수집(매시 :06)에서는 이 칸이 있어야 현재 시각부터 후보가 시작되고 20시대에도 만들 수 있다.
- AI에 보내는 것은 장소 이름과 시간대별 혼잡도 예측뿐이다(개인정보 없음).
- stats는 이 스크립트의 내용(해시)이 바뀌면 새로 시작하고, 이전 누적은 stats.previous에 버전·runs·aiAttempts·firstTryPasses만 남긴다.
"""
import datetime, hashlib, json, os, re, sys, time, urllib.error, urllib.request, zoneinfo

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
LIVE_MAX_AGE_MIN = 90  # 실시간 관측을 현재 시각 칸으로 쓸 수 있는 최대 경과 시간
MAX_LEN = 40
MAX_PREVIOUS = 20  # stats.previous에 남기는 이전 버전 요약의 최대 개수(briefing.json은 앱이 내려받는다)
VERSION = hashlib.sha1(open(os.path.abspath(__file__), 'rb').read().replace(b'\r\n', b'\n')).hexdigest()[:10]
FORBIDDEN = ['장애', '자폐', '진단', '증상', '치료', '환자', '위험', '절대', '금지', '경고', '사고', '못 가', '못가',
             '행사', '축제', '공사', '주차', '할인', '세일', '날씨', '비가', '눈이', '입장료', '무료',
             '조용', '소음', '시끄', '고요', '소리', '잔잔', '차분',  # 혼잡도 예측만으로 소리를 단정하지 않는다
             '내내', '종일', '거의 없', '사람이 없', '아무도']  # 자료가 뒷받침하지 않는 단정

snap = json.load(open(SNAP, encoding='utf-8'))
prev = {}
if os.path.exists(OUT):
    try:
        prev = json.load(open(OUT, encoding='utf-8'))
    except Exception:
        prev = {}
old_stats = prev.get('stats') if isinstance(prev.get('stats'), dict) else {}
if old_stats.get('version') == VERSION:
    stats = old_stats
else:  # 스크립트가 바뀌었으면 누적을 새로 시작해, 서로 다른 설계의 실행이 한 통계에 섞이지 않게 한다
    previous = list(old_stats.get('previous') or [])
    if old_stats.get('runs'):
        previous.append({'version': old_stats.get('version') or 'unversioned', 'runs': old_stats['runs'], 'aiAttempts': old_stats.get('aiAttempts', 0), 'firstTryPasses': old_stats.get('firstTryPasses', 0)})
    stats = {'version': VERSION, 'runs': 0, 'aiAttempts': 0, 'aiPasses': 0, 'firstTryPasses': 0, 'aiBriefings': 0, 'ruleBriefings': 0, 'apiErrors': 0, 'reasons': {}, 'previous': previous[-MAX_PREVIOUS:]}

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

def live_as_now(live):
    """실시간 관측을 현재 시각 칸으로 쓸 수 있는가. 같은 시이거나 지금보다 90분 이내로 앞선 관측이면 쓴다.
    정기 수집(:06)에서는 관측이 직전 시각(:35~:40)이고 예측이 다음 정시부터 시작해 현재 시각 칸이 비는데, 앱의 hourScores도 이때 live를 '지금' 칸으로 올린다."""
    if not live or live.get('level') not in LEVELS:
        return False
    if live['time'][:13] == NOW.strftime('%Y-%m-%d %H'):
        return True
    observed = datetime.datetime.strptime(live['time'][:16], '%Y-%m-%d %H:%M').replace(tzinfo=KST)
    return 0 <= (NOW - observed).total_seconds() / 60 <= LIVE_MAX_AGE_MIN


# 장소별 오늘 남은 시간대의 혼잡 단계(0~3)
table = {}
for name, ps in snap.get('places', {}).items():
    if ps.get('stale'):
        continue
    lv = {}
    live = ps.get('live')
    use_live = live_as_now(live)
    # 같은 시의 관측은 예측보다 우선하고, 지난 시(90분 이내)의 관측은 예측에 현재 시각 칸이 없을 때만 넣는다(앱의 hourScores와 같은 규칙)
    if use_live and live['time'][:13] == NOW.strftime('%Y-%m-%d %H'):
        lv[NOW.hour] = LEVELS.index(live['level'])
    for f in ps.get('fcst') or []:
        if f['time'][:10] == today and f['level'] in LEVELS:
            h = int(f['time'][11:13])
            lv.setdefault(h, LEVELS.index(f['level']))
    if use_live:
        lv.setdefault(NOW.hour, LEVELS.index(live['level']))
    lv = {h: v for h, v in lv.items() if start <= h <= DAY_END}
    if lv:
        table[name] = lv

hours_left = sorted({h for lv in table.values() for h in lv})
if len(hours_left) < 2:
    print(f'skip: fewer than 2 hours left today (places {len(table)}, hours {hours_left})')
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
    if re.search(r'\d', s):
        reasons.append(f'{label} 숫자 포함')  # 시각은 앱이 from, to로 따로 보여 주므로 문장에는 쓰지 않게 한다
    for w in FORBIDDEN:
        if w in s:
            reasons.append(f"{label} 금지 표현 '{w}'")
            # 모델에게 돌려주는 문장에는 걸린 글자 묶음 하나만 싣는다('금지' 같은 다른 금지어가 섞여 모델이 따라 쓰면 다시 반려되는 순환을 막는다)
            DETAIL[reasons[-1]] = f"{label}에 '{w}'이(가) 들어 있어 반려됨. 이 글자 묶음을 빼고 다시 쓰세요"


DETAIL = {}  # 반려 사유 -> 모델에게 돌려줄 구체적인 문장. 사유 자체(통계 키)는 짧게 두고, 장소와 시각은 여기에만 담는다


def check_window(label, w, ok, reasons, want):
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
    bad = [h for h in range(f, t) if h not in lv or not ok(lv[h])]
    if bad:
        key = f'{label} 자료와 불일치'
        reasons.append(key)
        cells = ', '.join(f"{h}시 '{LEVELS[lv[h]]}'" if h in lv else f'{h}시 자료 없음' for h in bad[:3])
        DETAIL[key] = f"{key}: {w['place']} {cells} (필요한 단계: {want})"


def validate(d):
    """형식, 금지 표현, 자료와의 사실 일치를 검사한다. 통과하면 빈 목록."""
    reasons = []
    DETAIL.clear()
    if not isinstance(d, dict):
        return ['객체가 아님']
    check_text('headline', d.get('headline'), reasons)
    check_text('tip', d.get('tip'), reasons)
    picks = d.get('picks')
    if not isinstance(picks, list) or not (1 <= len(picks) <= 3):
        reasons.append('picks 개수가 1~3이 아님')
        picks = picks if isinstance(picks, list) else []
    for i, w in enumerate(picks):
        check_window(f'pick{i + 1}', w, lambda v: v == 0, reasons, LEVELS[0])
        check_text(f'pick{i + 1} reason', (w or {}).get('reason') if isinstance(w, dict) else None, reasons)
    avoid = d.get('avoid') or []
    if not isinstance(avoid, list) or len(avoid) > 2:
        reasons.append('avoid 개수가 0~2가 아님')
        avoid = []
    for i, w in enumerate(avoid):
        check_window(f'avoid{i + 1}', w, lambda v: v >= 2, reasons, f'{LEVELS[2]} 이상')
    names = [w.get('place') for w in picks if isinstance(w, dict)]
    if len(names) != len(set(names)):
        reasons.append('picks 장소 중복')
    anames = [w.get('place') for w in avoid if isinstance(w, dict)]
    if len(anames) != len(set(anames)) or set(anames) & set(names):
        reasons.append('avoid 장소 중복')
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
        f"- headline, 각 pick의 reason, tip은 각각 {MAX_LEN}자 이내의 쉬운 말로 쓰고 '~요'로 끝냅니다. 이 문장들에는 숫자와 시각을 쓰지 않습니다(시각은 from, to로만 전달).",
        "- 소리의 크기(조용하다, 시끄럽다)나 '내내', '종일', '사람이 없다' 같은 단정은 쓰지 않습니다. 사람이 적은 편이라는 정도로만 말합니다.",
        '- 후보에 없는 사실(행사, 공사, 날씨, 주차, 가격, 시설)은 쓰지 않습니다. 진단이나 판정, 금지 표현을 쓰지 않고 권고만 합니다.',
        "- 검사기는 headline, 각 pick의 reason, tip에 다음 글자 묶음이 들어 있으면(다른 낱말의 일부여도, 활용형이어도) 반려합니다. 이 글자 묶음이 나오지 않게 쓰세요: " + ', '.join(f"'{w}'" for w in FORBIDDEN),
        '여유 구간 후보:',
        *[line(w) for w in calm[:12]],
        '붐비는 구간 후보:',
        *([line(w) for w in busy[:6]] or ['- 없음']),
    ]
    if feedback:
        prompt_lines += ['이전 답은 다음 이유로 반려되었습니다. 같은 실수를 반복하지 마세요(아래 장소와 시각은 from, to를 고르는 데만 쓰고, 문장에는 쓰지 않습니다):', *[f'- {r}' for r in feedback[:8]]]
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
    print('  raw:', ' '.join(text[:400].split()))  # 반려와 파싱 실패를 나중에 되짚을 수 있게, 파싱 전에 앞 400자를 한 줄로 남긴다
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
    chosen = {w['place'] for w in picks}
    return {'headline': headline, 'picks': picks, 'avoid': [w for w in busy if w['place'] not in chosen][:2], 'tip': '출발 전에 지도를 한 번 더 확인해요.'}


stats['runs'] += 1
result, source, attempts_used, last_reasons, last_feedback = None, 'rule', 0, [], []
print(f"candidates: places {len(table)}, hours {hours_left[0]}-{hours_left[-1]}, calm {len(calm)}, busy {len(busy)}; "
      f"calm[:3]={[(w['place'], w['from'], w['to']) for w in calm[:3]]} busy[:3]={[(w['place'], w['from'], w['to']) for w in busy[:3]]}")
if KEY and calm:
    for attempt in range(1, 4):
        attempts_used = attempt
        try:
            draft = ask_gemini(last_feedback)
        except Exception as e:  # 연결 끊김 같은 예외도 여기서 받아, 규칙 기반 문장과 통계 저장까지 이어지게 한다
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
        last_feedback = [DETAIL.get(r, r) for r in last_reasons]
        for r in last_reasons:
            key = re.sub(r'\d+', 'N', r)
            stats['reasons'][key] = stats['reasons'].get(key, 0) + 1
        print(f'attempt {attempt}: rejected ->', ' / '.join(last_feedback[:8]))
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
