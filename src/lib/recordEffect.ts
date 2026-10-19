/**
 * 다녀온 뒤 기록이 지수에 얼마나 반영됐는지 말하는 문구. 값은 App 상태의 offsets[장소](hourScores가 쓰는 보정치) 하나에서 오고, 로그에서 합을 다시 계산하지 않는다.
 * RECORD_STEP과 OFFSET_LIMIT은 profile.ts의 recordVisit과 같은 값이어야 한다(scripts/factor_words_check.mjs의 R3이 지킨다).
 */
import type { HourScore } from '../types'

/** 기록 한 건이 바꾸는 장소 보정치(점) */
export const RECORD_STEP = 5
/** 장소 보정치의 한도(±점) */
export const OFFSET_LIMIT = 20

export const RECORD_OFF_TEXT = '다녀온 기록이 있지만 맞춤 지수가 꺼져 있어서 지수에 반영하지 않았어요. 켜면 반영돼요.'
export const RECORD_GO_CHILD = '우리 아이에서 켜기'
/** 칩 숫자의 뜻. 칩이 재는 것은 장소 보정치(기록으로 쌓인 값)가 그 시각의 지수를 실제로 바꾼 폭뿐이다. 소리 민감도 상승은 넣지 않는다. 지수가 0점이나 100점에서 멈추면 보정치보다 작다. */
export const RECORD_LEGEND = '내 기록 반영은 장소마다 쌓인 기록 보정이 이 시각의 지수를 실제로 바꾼 점수예요. 지수는 0점과 100점에서 멈추기 때문에, 멈춘 시각에는 쌓인 보정보다 적게 바뀌어요.'
/** 우리 아이 탭 '최근 기록' 목록 위에 한 번만 두는 문장(힘들었어요 기록에 소리를 잰 시간대가 있을 때) */
export const RECORD_TAG_LIST = '힘들었어요 기록은 그때 잰 소리의 민감도도 한 단계 올렸을 수 있어요.'
/** 맞춤 지수가 꺼진 때 '최근 기록' 목록 위에 한 번만 두는 문장. 항목마다 되풀이하지 않는다. */
export const RECORD_OFF_LIST = `맞춤 지수가 꺼져 있어서 이 기록들은 지수에 반영되지 않았어요. 켜면 괜찮았어요는 -${RECORD_STEP}점, 힘들었어요는 +${RECORD_STEP}점이 반영돼요.`

const signed = (v: number) => `${v > 0 ? '+' : '-'}${Math.abs(v)}`

/**
 * 기록이 이 칸의 지수를 실제로 바꾼 폭(점). cell은 기록을 더한 칸이고, bare는 같은 시계열에서 기록(offset)만 0으로 두고 hourScores로 다시 계산한 것이다.
 * 지수는 0점과 100점에서 멈추므로 장소 보정치보다 작을 수 있다. 칸이나 지수가 없으면 undefined.
 */
export function recordWidth(cell: HourScore | undefined, bare: HourScore[] | undefined): number | undefined {
  const b = cell && bare?.find((c) => c.time === cell.time)
  return cell && b && cell.index !== null && b.index !== null ? cell.index - b.index : undefined
}

/**
 * 장소 보정치 o를 지수에 반영 중임을 알리는 칩 글자. 맞춤을 껐거나 o가 0이면 null.
 * width는 recordWidth가 구한 실제 폭이다. 보정치보다 작으면(지수가 0점이나 100점에서 멈춤) 실제 폭과 멈춘 점수를 말하고, 그 칸에서는 '(최대)'를 붙이지 않는다.
 * width가 없으면 o를 그대로 말한다.
 */
export function recordChip(o: number, enabled: boolean, width?: number): string | null {
  if (!enabled || o === 0) return null
  if (width !== undefined && Math.abs(width) < Math.abs(o)) return `내 기록 반영 ${width === 0 ? '0' : signed(width)}점(${o < 0 ? 0 : 100}점에서 멈춤)`
  return `내 기록 반영 ${signed(o)}점${Math.abs(o) >= OFFSET_LIMIT ? '(최대)' : ''}`
}

/** 추천 카드와 장소 시트 머리가 같이 쓰는 칩. 이 장소의 이 칸에서 기록이 실제로 바꾼 폭으로 말한다. 칸이나 지수가 없으면 바뀐 폭도 없으므로 null이다. */
export function recordChipAt(cell: HourScore | undefined, bare: HourScore[] | undefined, o: number, enabled: boolean): string | null {
  if (!cell || cell.index === null) return null
  return recordChip(o, enabled, recordWidth(cell, bare))
}

/** 맞춤을 껐는데 보정치가 0이 아닌 장소가 서울 전체에서 n곳일 때 추천 카드 아래에 두는 한 줄. 후보 카드 3장이 아니라 기록이 있는 모든 장소의 수다. */
export function unappliedText(n: number): string {
  return `맞춤 지수가 꺼져 있어서, 기록이 있는 장소(서울 전체 ${n}곳)의 지수 보정은 반영되지 않았어요. 켜면 반영돼요.`
}

/**
 * 우리 아이 탭 '최근 기록' 항목의 둘째 줄. ok는 괜찮았어요, o는 그 장소의 현재 보정치다.
 * 맞춤을 껐으면 항목에는 기록 종류만 쓰고 이유는 목록 위의 RECORD_OFF_LIST가 한 번 말한다.
 * 상한 근처에서 반대 부호 기록을 섞으면 건별 합이 현재 보정과 어긋나므로, 상한에 닿아 있고 부호가 같으면 건별 숫자 대신 현재 상태를 말한다.
 * 그 문장은 같은 장소의 가장 최근 기록 하나에만 붙이고(showCap), 나머지 항목은 기록 종류만 쓴다.
 */
export function entryText(ok: boolean, o: number, enabled: boolean, showCap = true): string {
  const head = ok ? '괜찮았어요' : '힘들었어요'
  if (!enabled) return head
  const own = ok ? -RECORD_STEP : RECORD_STEP
  if (Math.abs(o) >= OFFSET_LIMIT && o * own > 0) return showCap ? `${head} · 이 장소의 지수 보정이 최대(±${OFFSET_LIMIT}점)에 닿아 있어요` : head
  return `${head} · 이 기록으로 지수 ${signed(own)}점이 반영돼요`
}

/** 최근 기록 목록(최근 것이 앞)의 항목별 둘째 줄. 상한 문장은 장소마다 목록에서 처음 나오는 항목에만 붙는다. */
export function entryTexts(entries: { place: string; ok: boolean }[], offsets: Record<string, number>, enabled: boolean): string[] {
  const capShown = new Set<string>()
  return entries.map(({ place, ok }) => {
    const o = offsets[place] ?? 0
    const capped = enabled && Math.abs(o) >= OFFSET_LIMIT && o * (ok ? -RECORD_STEP : RECORD_STEP) > 0
    const showCap = !capShown.has(place)
    if (capped) capShown.add(place)
    return entryText(ok, o, enabled, showCap)
  })
}
