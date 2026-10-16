import type { ForecastMetrics, Level3, Snapshot } from '../types'
import { level3 } from './index'
import { kstNow } from './publicData'

/** 정수 %로 반올림한 비율 문구. 분모가 0이면 '자료 없음' */
export const pct = (a: number, n: number) => (n > 0 ? `${Math.round((a / n) * 100)}%` : '자료 없음')

/** 적중률 표에 싣는 예측 시차(시간 전) */
export const LEADS = ['1', '2', '3', '6', '12']
/** 적중률을 보여 주는 최소 비교 건수. 이보다 적으면 '모으는 중'으로 둔다. */
export const MIN_PAIRS = 100

/** 단계가 바뀌는 지수 경계. level3에서 읽어서 문구에 글자로 박지 않는다. */
const firstIndexOf = (lv: Level3) => Array.from({ length: 101 }, (_, i) => i).find((i) => level3(i) === lv) ?? 0
export const MID_FROM = firstIndexOf('mid')
export const BUSY_FROM = firstIndexOf('busy')

const CAVEAT = '현장과 다를 수 있어요'
const DEMO_NOTE = '데모 데이터로 계산한 값이에요. 실제 현장과 달라요.'
const DAY_MS = 86400000

/** 자료 시각 문구. 오늘 자료면 'HH:MM', 어제면 '어제 HH:MM', 그보다 오래됐으면 'MM/DD HH:MM'. 데모 자료는 헤더 배지와 같은 '데모 데이터'. */
export function stampText(snap: Snapshot, now = Date.now()): string {
  if (snap.source !== 'seoul') return '데모 데이터'
  const day = snap.updatedAt.slice(0, 10)
  const hhmm = snap.updatedAt.slice(11, 16)
  if (day === kstNow(now).date) return hhmm
  if (day === kstNow(now - DAY_MS).date) return `어제 ${hhmm}`
  return `${snap.updatedAt.slice(5, 7)}/${snap.updatedAt.slice(8, 10)} ${hhmm}`
}

/**
 * 지수가 무엇으로 계산됐는지 밝히는 한 줄. 장소 시트는 보여 주는 칸(cell)을 넘기고, 목록은 넘기지 않는다.
 * 시트용 문구는 휴대폰 폭(360px, 13px 글자)에서 한 줄에 들어가도록 짧게 둔다. 칸이 실시간 관측이면 관측 시각(obs, 없으면 칸의 time)을 넣어
 * '서울시 HH:MM 관측', 예측이면 '서울시 HH:MM 예측'으로 구분한다.
 * 목록은 순서를 매기는 지금 값(관측이 있으면 관측)과 줄에 적힌 이후 시각(예측)을 함께 쓰므로 두 가지를 모두 밝힌다.
 */
export function basisLine(snap: Snapshot, cell?: { forecast: boolean; obs?: string; time?: string }, now?: number): string {
  if (snap.source !== 'seoul') return DEMO_NOTE
  const stamp = stampText(snap, now)
  if (!cell) return `예측을 바탕으로 한 참고값이에요. 서울시 ${stamp} 자료로 계산했고, 지금 값은 관측이 있으면 관측으로, 이후 시각은 예측으로 계산해요. ${CAVEAT}.`
  if (!cell.forecast) return `서울시 ${cell.obs ?? cell.time?.slice(11, 16) ?? stamp} 관측이라 ${CAVEAT}.`
  return `서울시 ${stamp} 예측이라 ${CAVEAT}.`
}

/** 정보 탭 '점수의 뜻'에 적는, 지수가 어떤 자료로 계산됐는지 알리는 문장. 데모 데이터면 basisLine과 같은 문구를 쓴다. */
export function meaningNote(snap: Snapshot | null): string {
  return snap && snap.source !== 'seoul' ? DEMO_NOTE : `서울시 자료로 계산한 참고값이라서 ${CAVEAT}.`
}

/** 서울시 예측의 단계 일치율이 '그대로 유지 가정'보다 낮은 시차(표에 보이는 정수 %로 비교)와 두 일치율 */
export function lowerLeads(metrics: ForecastMetrics): { lead: string; a: number; b: number }[] {
  return LEADS.flatMap((k) => {
    const m = metrics.byLead[k]
    if (!m || m.n <= 0 || m.persistN <= 0) return []
    const a = Math.round((m.exact / m.n) * 100)
    const b = Math.round((m.persistExact / m.persistN) * 100)
    return a < b ? [{ lead: k, a, b }] : []
  })
}

/** 시차 목록을 '1~3, 6시간 전' 꼴로 묶는다. 이어지는 시차는 ~로 잇는다. */
export function leadRange(leads: string[]): string {
  const ns = leads.map(Number)
  const parts: string[] = []
  for (let i = 0; i < ns.length; ) {
    let j = i
    while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++
    parts.push(j > i ? `${ns[i]}~${ns[j]}` : `${ns[i]}`)
    i = j + 1
  }
  return `${parts.join(', ')}시간 전`
}

/** 적중률 대신 '아직 검증 전인 것'에 적는 문장. 비교 자료를 받지 못한 경우와 받았지만 비교가 MIN_PAIRS건 미만인 경우를 가른다. */
export function accuracyPending(metrics: ForecastMetrics | null): string {
  return metrics ? '서울시 혼잡 예측이 맞았는지는 비교 자료를 모으는 중이에요.' : '서울시 혼잡 예측이 맞았는지 비교한 자료를 아직 받지 못했어요.'
}

/** 혼잡 예측 적중률 요약. 자료가 없거나 비교가 MIN_PAIRS건 미만이면 null(검증한 것에 올리지 않는다). */
export function accuracyText(metrics: ForecastMetrics | null): string | null {
  if (!metrics || metrics.overall.n < MIN_PAIRS) return null
  const o = metrics.overall
  const low = lowerLeads(metrics)
  const head = `관측이 있었던 ${metrics.days}일 동안 서울시 혼잡 예측(4단계)을 실제 관측과 견줘 보니 단계가 같았던 비율이 ${pct(o.exact, o.n)}이고, 한 단계 차이 안에 든 비율이 ${pct(o.within1, o.n)}예요.`
  return low.length > 0 ? `${head} ${leadRange(low.map((l) => l.lead))} 예측은 예측을 낸 시점의 혼잡 단계가 그대로 이어진다고 본 경우(유지 가정)의 일치율보다 낮았어요.` : head
}
