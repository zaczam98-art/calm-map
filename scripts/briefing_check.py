"""gen_briefing.py 오프라인 시험 하네스.

실제 스크립트를 그대로 실행하되 시계(datetime.now)를 고정하고 Gemini 호출(urllib.request.urlopen)을 모의 응답으로 바꿔 끼운다. 실제 API는 부르지 않는다.
data 브랜치의 snapshot.json 사본을 고정 시각(08:10, 13:10, 20:10 KST)에 맞게 시간만 옮겨 쓴다(혼잡 단계 값은 그대로).
검사 항목: 후보 계산(현재 시각 칸 포함), validate 반려 사유, 재시도 프롬프트(금지 표현 목록, 구체적인 사유), stats 누적과 버전 리셋, 로그.

사용: python scripts/briefing_check.py [snapshot.json]
- snapshot은 인자, 환경변수 BRIEFING_CHECK_SNAPSHOT, 저장소 루트의 snapshot.json 순으로 찾고, 없으면 data 브랜치의 공개 파일을 내려받는다.
- 종료 코드 0이면 통과, 1이면 실패한 검사가 있다.
"""
import contextlib, copy, datetime, hashlib, io, json, os, re, sys, tempfile, time, types, urllib.request, zoneinfo
from unittest import mock

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SCRIPT = os.path.join(HERE, 'gen_briefing.py')
SOURCE = open(SCRIPT, encoding='utf-8').read()
KST = zoneinfo.ZoneInfo('Asia/Seoul')
LEVELS = ['여유', '보통', '약간 붐빔', '붐빔']
DATA_URL = 'https://raw.githubusercontent.com/zaczam98-art/calm-map/data/snapshot.json'
TMP = tempfile.TemporaryDirectory(prefix='briefing_check_')
FAILS, TOTAL = [], 0


def check(cond, msg):
    global TOTAL
    TOTAL += 1
    if not cond:
        FAILS.append(msg)
        print('FAIL', msg)


class HarnessAbort(BaseException):
    """모의 응답이 모자라는 것처럼 하네스의 오류. 스크립트의 'except Exception'이 삼키지 못하게 BaseException으로 둔다."""


class FakeResp:
    def __init__(self, payload):
        self.payload = payload

    def read(self, *args):
        return self.payload

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def fake_datetime(now):
    real = datetime.datetime

    class FakeDateTime(real):
        @classmethod
        def now(cls, tz=None):
            return cls(now.year, now.month, now.day, now.hour, now.minute, tzinfo=tz)

    mod = types.ModuleType('datetime')
    mod.__dict__.update({k: v for k, v in vars(datetime).items() if not k.startswith('__')})
    mod.datetime = FakeDateTime
    return mod


class Run:
    pass


RUN_N = 0


def run(now, snap, responses=(), prev=None, key='test-key-not-real'):
    """gen_briefing.py를 now 시각에 한 번 실행한다. responses는 Gemini 호출마다 차례로 쓰는 함수 목록(ns -> dict 또는 문자열)이다."""
    global RUN_N
    RUN_N += 1
    snap_path = os.path.join(TMP.name, f'snapshot{RUN_N}.json')
    out_path = os.path.join(TMP.name, f'briefing{RUN_N}.json')
    json.dump(snap, open(snap_path, 'w', encoding='utf-8'), ensure_ascii=False)
    if prev is not None:
        json.dump(prev, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False)
    r = Run()
    r.ns, r.prompts, r.code, r.aborted, queue = {'__name__': '__main__', '__file__': SCRIPT}, [], None, None, list(responses)

    def fake_urlopen(req, timeout=None):
        r.prompts.append(json.loads(req.data.decode('utf-8'))['contents'][0]['parts'][0]['text'])
        if not queue:
            raise HarnessAbort('모의 응답이 모자란다')
        reply = queue.pop(0)(r.ns)
        text = reply if isinstance(reply, str) else json.dumps(reply, ensure_ascii=False)
        return FakeResp(json.dumps({'candidates': [{'content': {'parts': [{'text': text}]}}]}).encode('utf-8'))

    env = {k: v for k, v in os.environ.items() if k not in ('GEMINI_KEY', 'GEMINI_MODEL', 'FORCE_BRIEFING')}
    env['FORCE_BRIEFING'] = '1'
    if key:
        env['GEMINI_KEY'] = key
    log = io.StringIO()
    with mock.patch.dict(sys.modules, {'datetime': fake_datetime(now)}), mock.patch.dict(os.environ, env, clear=True), \
            mock.patch.object(sys, 'argv', [SCRIPT, snap_path, out_path]), mock.patch.object(time, 'sleep', lambda s: None), \
            mock.patch.object(urllib.request, 'urlopen', fake_urlopen), contextlib.redirect_stdout(log):
        try:
            exec(compile(SOURCE, SCRIPT, 'exec'), r.ns)
        except SystemExit as e:
            r.code = e.code or 0
        except HarnessAbort as e:
            r.aborted = str(e)
    r.log = log.getvalue()
    r.out = json.load(open(out_path, encoding='utf-8')) if r.code is None and r.aborted is None else None
    r.queue_left = len(queue)
    return r


def rebase(snap, now):
    """스냅샷의 모든 시각을 시간 단위로 옮겨, 정기 수집(:06)이 now에 만든 것처럼 보이게 한다. 단계 값과 분(:35~:40)은 그대로다."""
    ref = datetime.datetime.strptime(snap['updatedAt'], '%Y-%m-%d %H:%M').replace(minute=0)
    delta = datetime.timedelta(hours=round((now.replace(minute=0, tzinfo=None) - ref).total_seconds() / 3600))

    def shift(s):
        return (datetime.datetime.strptime(s[:16], '%Y-%m-%d %H:%M') + delta).strftime('%Y-%m-%d %H:%M')

    out = copy.deepcopy(snap)
    out['updatedAt'] = shift(snap['updatedAt'])
    for ps in out['places'].values():
        if ps.get('live'):
            ps['live']['time'] = shift(ps['live']['time'])
        for f in ps.get('fcst') or []:
            f['time'] = shift(f['time'])
    return out


def ref_cells(ps, now, start):
    """원자료에서 따로 계산한 {시: 단계}. 스크립트의 table과 대조하는 기준값이다."""
    n, cells, live = now.replace(tzinfo=None), {}, ps.get('live')
    if live and live['level'] in LEVELS:
        t = datetime.datetime.strptime(live['time'][:16], '%Y-%m-%d %H:%M')
        if (t.date() == n.date() and t.hour == n.hour) or 0 <= (n - t).total_seconds() / 60 <= 90:
            cells[n.hour] = LEVELS.index(live['level'])
    for f in ps.get('fcst') or []:
        t = datetime.datetime.strptime(f['time'][:16], '%Y-%m-%d %H:%M')
        if t.date() == n.date() and f['level'] in LEVELS:
            cells.setdefault(t.hour, LEVELS.index(f['level']))
    return {h: v for h, v in cells.items() if start <= h <= 21}


def ref_windows(table, ok, start):
    """장소마다 조건을 만족하는 가장 긴(같으면 이른) 연속 구간. 2시간 이상만, 길이 내림차순, 시작 시각, 장소 순."""
    found = []
    for name, lv in table.items():
        best, h = None, start
        while h <= 21:
            if h in lv and ok(lv[h]):
                s = h
                while h in lv and ok(lv[h]):
                    h += 1
                if h - s >= 2 and (best is None or h - s > best[1] - best[0]):
                    best = (s, h)
            else:
                h += 1
        if best:
            found.append((name, best[0], best[1]))
    return sorted(found, key=lambda w: (-(w[2] - w[1]), w[1], w[0]))


REASON_TEXTS = ['사람이 적은 편이라 편하게 걸어요.', '여유로운 시간대라 마음이 편해요.', '천천히 둘러보기 좋은 시간이에요.']


def good_draft(ns, n_pick=2, n_avoid=1):
    picks = [{'place': w['place'], 'from': w['from'], 'to': w['to'], 'reason': REASON_TEXTS[i % 3]} for i, w in enumerate(ns['calm'][:n_pick])]
    chosen = {p['place'] for p in picks}
    avoid = [{'place': w['place'], 'from': w['from'], 'to': w['to']} for w in ns['busy'] if w['place'] not in chosen][:n_avoid]
    return {'headline': '오늘은 여유로운 곳부터 가 봐요.', 'picks': picks, 'avoid': avoid, 'tip': '출발 전에 지도를 한 번 더 확인해요.'}


def not_calm_window(ns):
    """table에서 2시간 안에 '여유'가 아닌 칸이 있는 (장소, from, to)와 그 첫 칸의 시각. 후보 밖 선택을 흉내 낸다."""
    for name, lv in sorted(ns['table'].items()):
        for f in range(ns['start'], 21):
            if f in lv and f + 1 in lv and (lv[f] != 0 or lv[f + 1] != 0):
                return name, f, f + 2, (f if lv[f] != 0 else f + 1)
    return None


def feedback_lines(prompt):
    lines = prompt.split('\n')
    idx = next((i for i, s in enumerate(lines) if s.startswith('이전 답은 다음 이유로 반려되었습니다')), None)
    return [] if idx is None else [s[2:] for s in lines[idx + 1:] if s.startswith('- ')]


def load_snapshot():
    explicit = sys.argv[1] if len(sys.argv) > 1 else None
    path = explicit or os.environ.get('BRIEFING_CHECK_SNAPSHOT') or os.path.join(ROOT, 'snapshot.json')
    if os.path.exists(path):
        return json.load(open(path, encoding='utf-8')), path
    if explicit:
        sys.exit(f'snapshot 파일이 없다: {explicit}')
    with urllib.request.urlopen(DATA_URL, timeout=30) as resp:  # data 브랜치의 공개 파일을 읽기만 한다(Gemini와 서울시 API는 아니다)
        return json.load(resp), DATA_URL


RAW, SOURCE_OF_SNAP = load_snapshot()
print('snapshot:', SOURCE_OF_SNAP, RAW['updatedAt'], f"places {len(RAW['places'])}")
base = datetime.datetime.strptime(RAW['updatedAt'], '%Y-%m-%d %H:%M')
NOWS = [base.replace(hour=h, minute=10, tzinfo=KST) for h in (8, 13, 20)]
EXPECTED_VERSION = hashlib.sha1(open(SCRIPT, 'rb').read().replace(b'\r\n', b'\n')).hexdigest()[:10]
STATS_KEYS = {'version', 'runs', 'aiAttempts', 'aiPasses', 'firstTryPasses', 'aiBriefings', 'ruleBriefings', 'apiErrors', 'reasons', 'previous'}
OUT_KEYS = {'generatedAt', 'date', 'basis', 'source', 'model', 'attemptsUsed', 'headline', 'picks', 'avoid', 'tip', 'stats'}

check(all(re.fullmatch(r'\d{4}-\d\d-\d\d \d\d:\d\d', p['live']['time']) and p['live']['level'] in LEVELS for p in RAW['places'].values() if p.get('live')),
      '사본의 live 시각 형식(YYYY-MM-DD HH:MM)과 단계 값이 기대와 다르다')


def check_prompt_and_feedback(tag, r):
    """모든 프롬프트에 금지 표현 목록이 한 줄로 들어 있고, 되돌려 준 사유에 걸린 글자 묶음 말고 다른 금지어가 섞이지 않았는지 본다."""
    forbidden = r.ns['FORBIDDEN']
    for i, p in enumerate(r.prompts):
        line = next((s for s in p.split('\n') if '반려합니다' in s and '활용형' in s), '')
        check(line and all(f"'{w}'" in line for w in forbidden), f'{tag} 프롬프트 {i + 1}: FORBIDDEN 전체가 한 줄에 들어 있지 않다')
        for fb in feedback_lines(p):
            flagged = re.search(r"에 '(.+?)'이\(가\) 들어 있어 반려됨", fb)
            stray = [w for w in forbidden if w in fb and not (flagged and w == flagged.group(1))]
            check(not stray, f'{tag} 프롬프트 {i + 1}: 사유에 다른 금지어가 섞였다 {stray} <- {fb}')


for now in NOWS:
    tag = now.strftime('%H:%M')
    snap = rebase(RAW, now)
    start = max(now.hour, 8)

    # A. 키 없음: 후보 계산, 규칙 문장 경로, 출력 형식
    r = run(now, snap, key=None)
    ns = r.ns
    check(r.code is None and r.out is not None, f'{tag} 키 없는 실행이 끝까지 가지 못했다 (code {r.code})')
    if r.out is None:
        continue
    ref = {n: c for n, ps in snap['places'].items() if not ps.get('stale') and (c := ref_cells(ps, now, start))}
    check(ns['table'] == ref, f'{tag} table이 원자료 재계산과 다르다')
    check(min(ns['hours_left']) == start, f"{tag} 후보 시작이 현재 시각 칸이 아니다 (hours_left {ns['hours_left'][:3]}, start {start})")
    if now.hour == 20:
        check(ns['hours_left'] == [20, 21], f"{tag} 20시대에 20~21시 두 칸이 있어야 한다: {ns['hours_left']}")
    check([(w['place'], w['from'], w['to']) for w in ns['calm']] == ref_windows(ref, lambda v: v == 0, start), f'{tag} 여유 후보가 재계산과 다르다')
    check([(w['place'], w['from'], w['to']) for w in ns['busy']] == ref_windows(ref, lambda v: v >= 2, start), f'{tag} 붐비는 후보가 재계산과 다르다')
    check(len(ns['calm']) > 0, f'{tag} 여유 후보가 없어 AI 경로를 시험할 수 없다')
    cand_line = next((s for s in r.log.split('\n') if s.startswith('candidates:')), '')
    print(tag, cand_line[:140])
    check(f"calm {len(ns['calm'])}, busy {len(ns['busy'])};" in cand_line and str((ns['calm'][0]['place'], ns['calm'][0]['from'], ns['calm'][0]['to'])) in cand_line,
          f'{tag} 후보 로그 줄의 수나 앞 후보가 다르다: {cand_line[:120]}')
    check(set(r.out) == OUT_KEYS and r.out['source'] == 'rule' and r.out['attemptsUsed'] == 0 and r.out['model'] is None, f'{tag} 출력 파일 형식이 다르다: {sorted(r.out)}')
    check(all(set(p) == {'place', 'from', 'to', 'reason'} for p in r.out['picks']) and all(set(a) == {'place', 'from', 'to'} for a in r.out['avoid']), f'{tag} picks/avoid 항목의 키가 다르다')
    check(set(r.out['stats']) == STATS_KEYS and r.out['stats']['version'] == EXPECTED_VERSION and r.out['stats']['previous'] == [], f'{tag} 새 stats의 형식이나 버전이 다르다')
    check(ns['validate']({k: r.out[k] for k in ('headline', 'picks', 'avoid', 'tip')}) == [], f'{tag} 규칙 문장이 validate를 통과하지 못했다')
    check(r.out['date'] == now.strftime('%Y-%m-%d') and r.out['generatedAt'] == now.strftime('%Y-%m-%d %H:%M'), f'{tag} date/generatedAt이 고정 시각과 다르다')

    # B. 정상 응답 1건: 첫 시도 통과
    r = run(now, snap, [lambda ns: good_draft(ns)])
    s = (r.out or {}).get('stats', {})
    check(r.out is not None and r.out['source'] == 'ai' and r.out['attemptsUsed'] == 1 and r.out['model'], f'{tag} 정상 응답이 첫 시도에 통과하지 못했다 ({r.out and r.out["source"]}, {r.log[-300:]})')
    check((s.get('aiAttempts'), s.get('aiPasses'), s.get('firstTryPasses'), s.get('aiBriefings'), s.get('reasons')) == (1, 1, 1, 1, {}), f'{tag} 정상 응답의 stats가 다르다: {s}')
    raw_line = next((x for x in r.log.split('\n') if x.startswith('  raw:')), '')
    check(raw_line.startswith('  raw: {') and len(raw_line) <= len('  raw: ') + 400, f'{tag} 모델 응답 원문 로그 줄이 없거나 400자를 넘는다')
    first = r.ns['calm'][0]
    check(f"- {first['place']} ({r.ns['cats'].get(first['place'], '')}): {first['from']}시부터 {first['to']}시 전까지" in r.prompts[0], f'{tag} 프롬프트에 첫 여유 후보 줄이 없다')
    check_prompt_and_feedback(f'{tag} 정상', r)

    # C. 후보 밖 선택 1건(여유가 아닌 칸이 든 pick, 여유 구간을 avoid로 씀) 뒤에 정상 응답
    bad = not_calm_window(r.ns)
    check(bad is not None, f'{tag} 여유가 아닌 칸이 든 구간을 table에서 찾지 못했다')
    if bad:
        def out_of_candidate(ns):
            d = good_draft(ns, 1, 0)
            d['picks'][0].update(place=bad[0], **{'from': bad[1], 'to': bad[2]})
            other = next((w for w in ns['calm'] if w['place'] != bad[0]), None)
            d['avoid'] = [{'place': other['place'], 'from': other['from'], 'to': other['to']}] if other else []
            return d
        r = run(now, snap, [out_of_candidate, lambda ns: good_draft(ns)])
        s = (r.out or {}).get('stats', {})
        lv = r.ns['table'][bad[0]]
        check(r.out is not None and r.out['source'] == 'ai' and r.out['attemptsUsed'] == 2, f'{tag} 후보 밖 선택 뒤 재시도로 통과하지 못했다')
        check((s.get('aiAttempts'), s.get('aiPasses'), s.get('firstTryPasses')) == (2, 1, 0), f'{tag} 후보 밖 선택의 stats 횟수가 다르다: {s}')
        check(set(s.get('reasons', {})) <= {'pickN 자료와 불일치', 'avoidN 자료와 불일치'} and 'pickN 자료와 불일치' in s.get('reasons', {}),
              f"{tag} stats 키에 장소나 시각이 섞였다: {s.get('reasons')}")
        fb = feedback_lines(r.prompts[1]) if len(r.prompts) > 1 else []
        want = f"{bad[3]}시 '{LEVELS[lv[bad[3]]]}'"
        check(any(x.startswith('pick1 자료와 불일치') and bad[0] in x and want in x and '필요한 단계: 여유' in x for x in fb), f'{tag} 재시도 사유에 장소, 시각, 단계가 없다: {fb}')
        if r.ns['calm'] and any(w['place'] != bad[0] for w in r.ns['calm']):
            check(any(x.startswith('avoid1 자료와 불일치') and '필요한 단계: 약간 붐빔 이상' in x for x in fb), f'{tag} avoid 사유가 구체적이지 않다: {fb}')
        check(any('rejected -> pick1 자료와 불일치' in x and bad[0] in x for x in r.log.split('\n')), f'{tag} 반려 로그에 장소가 없다')
        check_prompt_and_feedback(f'{tag} 후보밖', r)

    # D. 금지어 포함 1건 뒤에 정상 응답
    def with_forbidden(ns):
        d = good_draft(ns)
        d['tip'] = '조용하게 쉬어 가기 좋아요.'
        d['picks'][0]['reason'] = '차분히 둘러보기 좋아요.'
        return d
    r = run(now, snap, [with_forbidden, lambda ns: good_draft(ns)])
    s = (r.out or {}).get('stats', {})
    check(r.out is not None and r.out['attemptsUsed'] == 2 and s.get('reasons') == {"tip 금지 표현 '조용'": 1, "pickN reason 금지 표현 '차분'": 1}, f"{tag} 금지어 반려의 stats가 다르다: {s.get('reasons')}")
    fb = feedback_lines(r.prompts[1]) if len(r.prompts) > 1 else []
    check(any("'조용'" in x for x in fb) and any("'차분'" in x for x in fb) and all('금지' not in x for x in fb), f'{tag} 금지어 사유 문장이 다르다: {fb}')
    check_prompt_and_feedback(f'{tag} 금지어', r)

    # E. 이름 불일치 응답 3번(규칙 문장으로 대체) + 모든 사유 집계
    def wrong_name(ns):
        d = good_draft(ns)
        name = d['picks'][0]['place']
        d['picks'][0]['place'] = re.sub(r'\(.*?\)', '', name) if re.sub(r'\(.*?\)', '', name) != name else name[:-1]
        assert d['picks'][0]['place'] not in ns['table']
        return d
    r = run(now, snap, [wrong_name] * 3)
    s = (r.out or {}).get('stats', {})
    check(r.out is not None and r.out['source'] == 'rule' and r.out['attemptsUsed'] == 3, f'{tag} 이름 불일치 3번 뒤 규칙 문장으로 대체되지 않았다')
    check((s.get('aiAttempts'), s.get('aiPasses'), s.get('ruleBriefings'), s.get('reasons')) == (3, 0, 1, {'pickN 장소가 자료에 없음': 3}), f'{tag} 이름 불일치의 stats가 다르다: {s}')
    check(any(x == 'pick1 장소가 자료에 없음' for x in (feedback_lines(r.prompts[1]) if len(r.prompts) > 1 else [])), f'{tag} 이름 불일치 재시도 사유가 다르다')

    # F. 사유가 4개 이상이어도 전부 센다
    def many(ns):
        d = good_draft(ns, 1, 0)
        d.update(headline='오늘 날씨가 좋은 3곳', tip='')
        d['picks'][0]['reason'] = ''
        if bad:
            d['picks'][0].update(place=bad[0], **{'from': bad[1], 'to': bad[2]})
        return d
    r = run(now, snap, [many, lambda ns: good_draft(ns)])
    s = (r.out or {}).get('stats', {})
    n_reasons = len(r.ns['validate'](many(r.ns)))
    check(n_reasons >= 4 and sum(s.get('reasons', {}).values()) == n_reasons, f"{tag} 사유 {n_reasons}개를 전부 세지 않았다: {s.get('reasons')}")

# 이하 13:10 스냅샷으로
now13 = NOWS[1]
snap13 = rebase(RAW, now13)

# G. stats 버전: 옛 누적(버전 없음) -> 리셋, 같은 버전 -> 누적, 다른 버전 -> 리셋, 상한, 깨진 stats
legacy = {'generatedAt': '2026-10-08 18:07', 'stats': {'runs': 5, 'aiAttempts': 9, 'aiPasses': 4, 'firstTryPasses': 2, 'aiBriefings': 4, 'ruleBriefings': 1, 'apiErrors': 0,
                                                    'reasons': {'pickN 자료와 불일치': 7, 'avoidN 자료와 불일치': 2, "pickN reason 금지 표현 '조용'": 1}}}
r1 = run(now13, snap13, key=None, prev=legacy)
s1 = (r1.out or {}).get('stats', {})
check(s1.get('version') == EXPECTED_VERSION and s1.get('runs') == 1 and s1.get('reasons') == {} and s1.get('ruleBriefings') == 1, f'버전 없는 옛 stats가 새로 시작되지 않았다: {s1}')
check(s1.get('previous') == [{'version': 'unversioned', 'runs': 5, 'aiAttempts': 9, 'firstTryPasses': 2}], f"previous가 다르다: {s1.get('previous')}")
r2 = run(now13, snap13, key=None, prev=r1.out)
s2 = (r2.out or {}).get('stats', {})
check(s2.get('runs') == 2 and s2.get('ruleBriefings') == 2 and s2.get('previous') == s1.get('previous') and s2.get('version') == EXPECTED_VERSION, f'같은 버전인데 누적되지 않았다: {s2}')
tampered = copy.deepcopy(r2.out)
tampered['stats'].update(version='oldver0001', runs=7, aiAttempts=11, firstTryPasses=3)
r3 = run(now13, snap13, key=None, prev=tampered)
s3 = (r3.out or {}).get('stats', {})
check(s3.get('runs') == 1 and s3.get('previous') == s1['previous'] + [{'version': 'oldver0001', 'runs': 7, 'aiAttempts': 11, 'firstTryPasses': 3}], f"다른 버전인데 리셋/previous가 다르다: {s3}")
cap = r1.ns['MAX_PREVIOUS']
capped = {'stats': {'version': 'v-old', 'runs': 3, 'previous': [{'version': f'v{i}', 'runs': 1, 'aiAttempts': 1, 'firstTryPasses': 0} for i in range(cap + 5)]}}
s4 = (run(now13, snap13, key=None, prev=capped).out or {}).get('stats', {})
check(len(s4.get('previous', [])) == cap and s4['previous'][-1]['version'] == 'v-old' and s4['previous'][0]['version'] == 'v6', f"previous 상한이 다르다: {[p['version'] for p in s4.get('previous', [])][:3]}")
s5 = (run(now13, snap13, key=None, prev={'stats': 'broken'}).out or {}).get('stats', {})
check(s5.get('runs') == 1 and s5.get('previous') == [], f'깨진 stats를 새로 시작하지 못했다: {s5}')

# H. 현재 시각 칸: 같은 시이거나 90분 이내로 앞선 live만 쓴다
day = now13.strftime('%Y-%m-%d')
yesterday = (now13 - datetime.timedelta(days=1)).strftime('%Y-%m-%d')
for when, expect in [(f'{day} 13:05', True), (f'{day} 13:40', True), (f'{day} 12:40', True), (f'{day} 11:40', True), (f'{day} 11:39', False), (f'{day} 11:00', False), (f'{yesterday} 12:40', False)]:
    sn = copy.deepcopy(snap13)
    for ps in sn['places'].values():
        if ps.get('live'):
            ps['live']['time'] = when
    t = run(now13, sn, key=None).ns['table']
    ok = all((13 in lv) == expect for lv in t.values()) and (not expect or all(lv[13] == LEVELS.index(sn['places'][n]['live']['level']) for n, lv in t.items()))
    check(ok, f'live {when}: 현재 시각 칸 사용 여부가 기대({expect})와 다르다')
sn = copy.deepcopy(snap13)
first_name = next(iter(sn['places']))
sn['places'][first_name]['live']['level'] = '정보없음'
t = run(now13, sn, key=None).ns['table']
check(13 not in t[first_name] and sum(13 in lv for lv in t.values()) == len(t) - 1, '알 수 없는 단계의 live가 현재 시각 칸으로 들어갔다')

# I. 20:10에 관측이 너무 오래됐으면(121분) 현재 시각 칸이 비어 만들지 않는다
now20 = NOWS[2]
sn = rebase(RAW, now20)
for ps in sn['places'].values():
    ps['live']['time'] = f"{now20.strftime('%Y-%m-%d')} 18:09"
t = run(now20, sn, key=None)
check(t.code == 0 and t.out is None and 'skip: fewer than 2 hours left today' in t.log, f'20:10에 오래된 live면 건너뛰어야 한다: code {t.code}')

# J. 결측 칸은 '자료 없음'으로 설명한다
sn = copy.deepcopy(snap13)
hole_name = next(iter(sn['places']))
sn['places'][hole_name]['fcst'] = [f for f in sn['places'][hole_name]['fcst'] if f['time'][11:13] != '16']
t = run(now13, sn, key=None)
d = good_draft(t.ns, 1, 0)
d['picks'][0].update(place=hole_name, **{'from': 15, 'to': 17})
reasons = t.ns['validate'](d)
check(reasons == ['pick1 자료와 불일치'] and f"{hole_name} " in t.ns['DETAIL'].get('pick1 자료와 불일치', '') and '16시 자료 없음' in t.ns['DETAIL'].get('pick1 자료와 불일치', ''), f"결측 칸 사유가 다르다: {reasons} {t.ns['DETAIL']}")

# K. 모델 응답이 JSON이 아니면 원문 앞 400자를 남기고 API 오류로 센다
r = run(now13, snap13, [lambda ns: 'x' * 600, lambda ns: good_draft(ns)])
s = (r.out or {}).get('stats', {})
check(('  raw: ' + 'x' * 400) in r.log.split('\n') and (s.get('apiErrors'), s.get('aiAttempts'), s.get('aiPasses')) == (1, 1, 1) and r.out['attemptsUsed'] == 2, f'JSON이 아닌 응답의 로그나 stats가 다르다: {s}')

# L. 모의 응답이 남거나 모자라지 않았고, 장소 이름에 금지어가 없다(사유 문장에 섞일 수 없다)
check(r.queue_left == 0 and r.aborted is None, '모의 응답 수가 맞지 않는다')
names = list(snap13['places'])
clash = [(n, w) for n in names for w in r.ns['FORBIDDEN'] if w in n]
check(not clash, f'장소 이름에 금지어가 들어 있다: {clash}')

TMP.cleanup()
if FAILS:
    print(f'FAILED {len(FAILS)}/{TOTAL}')
    sys.exit(1)
print(f'OK {TOTAL} checks')
