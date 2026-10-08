import type { ChildProfile, CongestLevel, ForecastPoint, HourScore, Level3, PlaceSnapshot, SenseTag, SoundBucket } from '../types'
import { SENSE_TAGS } from '../types'

/** 태그 기본 가중(설계 문서 3절) */
export const TAG_WEIGHT: Record<SenseTag, number> = {
  sudden: 1.0,
  crowd: 0.7,
  machine: 0.5,
  music: 0.5,
  speech: 0.3,
  ambient: 0.1,
}

const LEVEL_BASE: Record<CongestLevel, number> = { 여유: 15, 보통: 40, '약간 붐빔': 65, 붐빔: 90 }

/** 혼잡 점수 C: 단계 기준값 + 같은 단계 안에서 인구 중앙값 위치로 ±10 보정 */
export function congestScore(p: ForecastPoint, all: ForecastPoint[]): number {
  const base = LEVEL_BASE[p.level] ?? 40
  const mids = all.map((f) => (f.min + f.max) / 2)
  const lo = Math.min(...mids)
  const hi = Math.max(...mids)
  if (!isFinite(lo) || hi <= lo) return base
  const pos = ((p.min + p.max) / 2 - lo) / (hi - lo) // 0~1
  return clamp(base + (pos - 0.5) * 20, 0, 100)
}

/** 소리 점수 S: 태그 가중 × 강도의 가중평균을 0~100으로 */
export function soundScore(b: SoundBucket | undefined, profile?: ChildProfile): number | null {
  if (!b || b.n === 0) return null
  let num = 0
  let den = 0
  for (const t of SENSE_TAGS) {
    const v = b.tags[t]
    if (v === undefined) continue
    const w = TAG_WEIGHT[t] * (profile?.enabled ? profile.tags[t] : 1)
    num += w * v
    den += w
  }
  if (den === 0) return null
  return clamp((num / den) * 100 * 1.4, 0, 100) // 1.4: 보통 측정값이 0.3~0.6에 몰려 있어 체감 범위로 늘림
}

export function soundWeight(n: number): number {
  return n <= 0 ? 0 : Math.min(0.5, n / (n + 6))
}

export function level3(index: number | null): Level3 {
  if (index === null) return 'nodata'
  if (index < 35) return 'calm'
  if (index < 65) return 'mid'
  return 'busy'
}

export const LEVEL3_LABEL: Record<Level3, string> = { calm: '무던함', mid: '보통', busy: '붐빔', nodata: '데이터 부족' }

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** 한국 시간 기준 현재 시각 키 'YYYY-MM-DD HH'. 실제 서울시 자료일 때만 지난 시간대를 걸러 낸다(데모 스냅샷은 날짜가 고정). */
export function nowKeyFor(snap: { source: string } | null | undefined, now = Date.now()): string | undefined {
  if (!snap || snap.source !== 'seoul') return undefined
  return new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 13).replace('T', ' ')
}

export function hourOf(time: string): number {
  return Number(time.slice(11, 13))
}

/**
 * 장소의 시간대별 지수. 현재 시각 + 12시간 예측.
 * sound: 요일·시간 버킷 조회 함수. offset: 장소별 개인 보정치(기록으로 학습).
 */
export function hourScores(
  snap: PlaceSnapshot | undefined,
  sound: (hour: number, dow: number) => SoundBucket | undefined,
  profile: ChildProfile | null,
  offset = 0,
  nowKey?: string,
): HourScore[] {
  if (!snap) return []
  type Pt = ForecastPoint & { forecast: boolean }
  let pts: Pt[] = []
  if (snap.live) pts.push({ time: snap.live.time, level: snap.live.level, min: snap.live.min, max: snap.live.max, forecast: false })
  pts.push(...snap.fcst.map((f) => ({ ...f, forecast: true })))
  if (nowKey) {
    // 수집이 늦어지면 실시간 값이 이미 지난 시각의 것이다. 지난 시간대는 버리고 현재 시각의 예측값부터 보여 준다.
    const fresh = pts.filter((p) => p.time.slice(0, 13) >= nowKey)
    const seen = new Set<string>()
    pts = fresh.filter((p) => (seen.has(p.time.slice(0, 13)) ? false : (seen.add(p.time.slice(0, 13)), true)))
  }
  const personal = profile?.enabled ? profile : null
  return pts.map((p) => {
    const h = hourOf(p.time)
    let c = congestScore(p, pts)
    if (personal) c = clamp(c * personal.crowd, 0, 100)
    const b = sound(h, dowOfTime(p.time))
    const s = soundScore(b, personal ?? undefined)
    const w = s === null ? 0 : soundWeight(b?.n ?? 0)
    const idx = clamp((1 - w) * c + w * (s ?? 0) + (personal ? offset : 0), 0, 100)
    return { time: p.time, hour: h, index: Math.round(idx), level: level3(idx), soundN: b?.n ?? 0, forecast: p.forecast }
  })
}

/** 'YYYY-MM-DD HH:MM' 문자열의 요일(일요일=0). 기기 시간대와 무관하게 날짜만으로 계산한다. */
export function dowOfTime(time: string): number {
  const [y, m, d] = time.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/**
 * 권고 문장. 외출 시간대(8~21시)에서 지수가 가장 낮은 칸을 고르고, 그 칸의 단계에 맞는 말로 안내한다.
 * 무던한 칸이면 앞뒤로 이어지는 무던한 구간을 함께 말하고, 붐비는 칸이면 무던하다고 말하지 않는다.
 */
export function recommend(scores: HourScore[]): { text: string; from: number | null } {
  const all = scores.filter((s) => s.index !== null)
  if (all.length === 0) return { text: '예측 자료가 아직 없어서 권고 시간대를 만들지 못했어요.', from: null }
  // 가족이 실제로 외출하는 8~21시만 권고 대상으로 본다. 그 범위가 비어 있으면(심야) 전체에서 고른다.
  const day = all.filter((s) => s.hour >= 8 && s.hour <= 21)
  const valid = day.length ? day : all
  const minIdx = Math.min(...valid.map((s) => s.index as number))
  const best = valid.find((s) => s.index === minIdx)!
  const now = all[0]
  const label = (s: HourScore) => (s.time.slice(0, 10) === now.time.slice(0, 10) ? '오늘' : '내일')
  const when = best === now ? `지금(${now.hour}시)` : `${label(best)} ${best.hour}시 무렵`
  if (best.level === 'busy') return { text: `남은 시간은 대체로 붐벼요. 그중에서는 ${when}이 덜 붐벼요.`, from: best.hour }
  if (best.level !== 'calm') return { text: `${when}이 남은 시간 중 가장 덜 붐벼요(보통 수준).`, from: best.hour }
  // 무던한 칸: 앞뒤로 이어지는 무던한 구간을 찾는다
  const i = all.indexOf(best)
  let a = i
  let b = i
  while (a - 1 >= 0 && all[a - 1].level === 'calm') a--
  while (b + 1 < all.length && all[b + 1].level === 'calm') b++
  const start = all[a]
  const untilEnd = b === all.length - 1
  const endHour = (all[b].hour + 1) % 24
  if (start === now) {
    if (untilEnd) return { text: '지금부터 예측 범위 끝까지 무던해요.', from: now.hour }
    return { text: a === b ? `지금(${now.hour}시)이 무던해요. ${endHour}시부터는 달라져요.` : `지금부터 ${endHour}시 전까지 무던해요.`, from: now.hour }
  }
  if (untilEnd) return { text: `${label(start)} ${start.hour}시부터 무던해요.`, from: start.hour }
  return { text: a === b ? `${label(start)} ${start.hour}시 무렵이 무던해요.` : `${label(start)} ${start.hour}시부터 ${endHour}시 전까지 무던해요.`, from: start.hour }
}
