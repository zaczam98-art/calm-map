/** 미리 보는 카드 규칙. 서버(Worker)와 클라이언트가 같이 쓴다. */

export const CARD_ICONS = ['door', 'ticket', 'walk', 'sit', 'headphone', 'toilet', 'quiet', 'bye', 'hand', 'look', 'eat', 'wait'] as const
export type CardIcon = (typeof CARD_ICONS)[number]

export const ICON_EMOJI: Record<CardIcon, string> = {
  door: '🚪',
  ticket: '🎫',
  walk: '🚶',
  sit: '🪑',
  headphone: '🎧',
  toilet: '🚻',
  quiet: '🤫',
  bye: '👋',
  hand: '🤝',
  look: '👀',
  eat: '🍙',
  wait: '⏳',
}

export interface CardDraft {
  steps: { icon: string; text: string }[]
  prep: string
  whenHard: string
}

/** 판정·낙인·공포 표현과 입력에 없는 사실을 막는 금지어 */
export const FORBIDDEN = [
  '장애', '자폐', '진단', '증상', '치료', '환자',
  '못 가', '못가', '가면 안', '위험', '절대', '금지', '경고', '사고',
  '입구는', '왼쪽', '오른쪽', '직진', '층에', '엘리베이터', '할인', '영업시간', '휴무',
  '해라', '하지 마', '마라', '해야 한다', '해야한다',
  '조용하고', '조용해요', '조용해서', '사람이 없', '사람이 적어서', '한적',  // 혼잡도 예측만으로 소리와 사람 수를 단정하지 않는다('조용한 곳에서 쉬어요' 같은 행동 안내는 허용)
]

/** 가격 언급(숫자+원, 천원·만원). '원' 한 글자로 막으면 '공원'까지 걸리므로 패턴으로 검사한다. */
export const FORBIDDEN_PATTERNS: RegExp[] = [/\d\s*원/, /(천|만)\s*원/]

function hasForbidden(text: string): string | null {
  for (const f of FORBIDDEN) if (text.includes(f)) return f
  for (const re of FORBIDDEN_PATTERNS) {
    const m = text.match(re)
    if (m) return m[0]
  }
  return null
}

export const MAX_STEP_LEN = 28
export const MAX_LINE_LEN = 30

export function validateCard(c: unknown): { ok: boolean; reasons: string[]; card?: CardDraft } {
  const reasons: string[] = []
  if (!c || typeof c !== 'object') return { ok: false, reasons: ['객체가 아님'] }
  const d = c as Partial<CardDraft>
  if (!Array.isArray(d.steps) || d.steps.length < 3 || d.steps.length > 5) reasons.push('단계 수가 3~5가 아님')
  const steps = Array.isArray(d.steps) ? d.steps : []
  steps.forEach((s, i) => {
    if (!s || typeof s.text !== 'string' || typeof s.icon !== 'string') {
      reasons.push(`${i + 1}단계 형식 오류`)
      return
    }
    if (!(CARD_ICONS as readonly string[]).includes(s.icon)) reasons.push(`${i + 1}단계 아이콘 '${s.icon}'은 허용 목록에 없음`)
    if (s.text.length > MAX_STEP_LEN) reasons.push(`${i + 1}단계 글자 수 초과(${s.text.length})`)
    if (!/(요|어요|아요|해요|예요|에요)\.?$/.test(s.text.trim())) reasons.push(`${i + 1}단계가 '~요' 서술로 끝나지 않음`)
    const bad = hasForbidden(s.text)
    if (bad) reasons.push(`${i + 1}단계 금지어 '${bad}'`)
  })
  for (const [k, v] of [['prep', d.prep], ['whenHard', d.whenHard]] as const) {
    if (typeof v !== 'string' || v.length === 0) reasons.push(`${k} 없음`)
    else {
      if (v.length > MAX_LINE_LEN) reasons.push(`${k} 글자 수 초과(${v.length})`)
      const bad = hasForbidden(v)
      if (bad) reasons.push(`${k} 금지어 '${bad}'`)
    }
  }
  if (reasons.length) return { ok: false, reasons }
  return { ok: true, reasons: [], card: { steps: steps.map((s) => ({ icon: s.icon, text: s.text.trim() })), prep: (d.prep as string).trim(), whenHard: (d.whenHard as string).trim() } }
}

export const LEVEL_KO: Record<string, string> = { calm: '무던함', mid: '보통', busy: '붐빔' }
