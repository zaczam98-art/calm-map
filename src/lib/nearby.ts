import type { HourScore, Level3, NoiseData, Place, ScoreParts } from '../types'
import { DAY_TO, NOISE_WEIGHT, scoreAt } from './index'

/** 두 지점 사이의 직선 거리(km, 하버사인) */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(h))
}

export interface NearbyItem {
  place: Place
  km: number
  index: number
  level: Level3
  /** 기준 칸과 같은 시각의 후보 칸 */
  cell: HourScore
}

export const NEARBY_MAX_KM = 6
export const NEARBY_FAR_KM = 3 // 경험적 기준이다. 이동 부담을 잰 값이 아니다.
export const NEARBY_LIMIT = 3
export const TIER_FIRST = true // 단계 우선 정렬: 무던함 후보를 보통 후보보다 앞에, 같은 단계 안에서는 가까운 순(2026-10-13 사용자 결정)
const RANK: Record<Level3, number> = { calm: 0, mid: 1, busy: 2, nodata: 9 }

/** 시계열에서 time('YYYY-MM-DD HH...')과 같은 시(정각)의 칸 */
export function cellAtSameTime(series: HourScore[] | undefined, time: string): HourScore | undefined {
  return series?.find((c) => c.time.slice(0, 13) === time.slice(0, 13))
}

/**
 * 후보 장소의 칸을 고른다. 서울시 자료가 오래된(stale) 장소와, 기준 칸과 같은 시각의 칸이 없거나
 * 지수가 없거나 관측·예측 종류가 다른 칸은 후보가 되지 못한다.
 */
export function candidateCell(series: HourScore[] | undefined, shown: HourScore, stale: boolean): HourScore | undefined {
  if (stale) return undefined
  const c = cellAtSameTime(series, shown.time)
  return c && c.index !== null && c.forecast === shown.forecast ? c : undefined
}

/**
 * 기준 장소에서 직선 거리 maxKm 안에 있고, 기준 칸보다 단계가 낮은(더 무던한) 장소를 고른다.
 * 기준이 '붐빔'이면 '보통'과 '무던함'이, 기준이 '보통'이면 '무던함'만 후보가 된다.
 * current는 각 장소에서 기준 칸과 같은 시각의 칸을 돌려주는 함수다(없으면 undefined).
 * tierFirst가 true이면 (단계, 거리) 순으로, 아니면 거리순으로 정렬해 상위 limit곳을 돌려준다.
 * 거리순일 때는 가까운 곳부터 current를 불러 limit곳이 차면 멈춘다(current가 비싼 계산이어도 먼 곳까지 부르지 않는다). 결과는 전부 부른 뒤 정렬한 것과 같다.
 */
export function calmerNearby(
  target: Place,
  targetLevel: Level3,
  all: Place[],
  current: (p: Place) => HourScore | undefined,
  maxKm = NEARBY_MAX_KM,
  limit = NEARBY_LIMIT,
  tierFirst = TIER_FIRST,
): NearbyItem[] {
  const near: { place: Place; km: number }[] = []
  for (const p of all) {
    if (p.name === target.name) continue
    const km = distanceKm(target, p)
    if (km <= maxKm) near.push({ place: p, km })
  }
  if (!tierFirst) near.sort((a, b) => a.km - b.km)
  const out: NearbyItem[] = []
  for (const { place, km } of near) {
    const c = current(place)
    if (!c || c.index === null) continue
    if (RANK[c.level] >= RANK[targetLevel]) continue
    out.push({ place, km, index: c.index, level: c.level, cell: c })
    if (!tierFirst && out.length === limit) break
  }
  return tierFirst ? out.sort((a, b) => RANK[a.level] - RANK[b.level] || a.km - b.km).slice(0, limit) : out
}

export interface RunInfo {
  /** from 칸을 포함한 연속 무던함 칸 수(1 이상) */
  count: number
  stop: 'nonCalm' | 'noForecast' | 'dayEnd'
  /** nonCalm: 처음 무던하지 않은 칸의 time, dayEnd: '<날짜> 22:00', noForecast: 마지막 무던한 칸의 time */
  endTime: string
}

/**
 * from 칸(무던함)부터 이어지는 무던한 칸을 센다. 다음 칸은 시계열의 바로 다음 칸이면서 hour가 (현재 hour + 1) % 24인 칸이다.
 * 예측이 빠졌으면 noForecast로 멈춘다. from이 외출 시간(DAY_TO=21시) 안이면 21시 칸 다음 칸이 무던해도 22시에서 자르고 dayEnd로 멈춘다.
 * from.hour가 DAY_TO보다 크면 자르지 않는다.
 */
export function calmRun(series: HourScore[], from: HourScore): RunInfo {
  let i = series.indexOf(from)
  if (i < 0) i = series.findIndex((c) => c.time.slice(0, 13) === from.time.slice(0, 13))
  let count = 1
  let cur = from
  for (;;) {
    const next = i >= 0 ? series[i + 1] : undefined
    if (!next || next.hour !== (cur.hour + 1) % 24) return { count, stop: 'noForecast', endTime: cur.time }
    if (cur.hour === DAY_TO && from.hour <= DAY_TO && next.level === 'calm') return { count, stop: 'dayEnd', endTime: `${cur.time.slice(0, 10)} 22:00` }
    if (next.level !== 'calm') return { count, stop: 'nonCalm', endTime: next.time }
    count++
    cur = next
    i++
  }
}

/** target에서 직선 km 이하에 다른 장소가 하나라도 있는가 */
export function hasNeighborWithin(target: Place, all: Place[], km = NEARBY_FAR_KM): boolean {
  return all.some((p) => p.name !== target.name && distanceKm(target, p) <= km)
}

/** 'YYYY-MM-DD HH...' 문자열의 정시를 밀리초로(두 값의 차이만 쓰므로 시간대는 상관없다). */
function hourStamp(time: string): number {
  return Date.parse(`${time.slice(0, 10)}T${time.slice(11, 13)}:00:00Z`)
}

/** from 칸에서 to 칸까지의 시간 차이(시간) */
export function hoursAfter(from: HourScore, to: HourScore): number {
  return (hourStamp(to.time) - hourStamp(from.time)) / 3600000
}

export type NoiseState = 'ok' | 'placeMissing' | 'hourMissing' | 'allMissing'

/**
 * 칸에 동네 소음이 반영되었는지 가른다. 소음 파일이 없거나 이 시각이 소음 자료의 시간 범위 밖이면 allMissing,
 * 파일에 이 장소가 없으면 placeMissing(시트 머리의 '소음 미반영' 칩과 같은 판정), 이 시각의 값만 비었으면 hourMissing이다.
 */
export function noiseState(noise: NoiseData | null, placeName: string, cell: HourScore): NoiseState {
  if (noise === null || cell.hour < noise.hours[0] || cell.hour > noise.hours[1]) return 'allMissing'
  if (!noise.places[placeName]) return 'placeMissing'
  return cell.noise ? 'ok' : 'hourMissing'
}

export interface GapPart {
  key: 'crowd' | 'noise' | 'sound' | 'offset'
  /** 0보다 크면 후보가 그만큼 낮다 */
  diff: number
}

const PART_KEYS: GapPart['key'][] = ['crowd', 'noise', 'sound', 'offset']

/** 지수 raw = (1-w)·base + w·(s ?? 0) + offset 을 항별 기여로 나눈다(순서는 PART_KEYS). */
function contributions(p: ScoreParts): number[] {
  return [(1 - p.w) * (p.n === null ? 1 : 1 - NOISE_WEIGHT) * p.c, p.n === null ? 0 : (1 - p.w) * NOISE_WEIGHT * p.n, p.w * (p.s ?? 0), p.offset]
}

const total = (v: number[]) => v.reduce((a, b) => a + b, 0)

/**
 * 두 칸의 지수 차이를 항별 정수로 나눈다. 항별 차이를 내림하고, 남은 점수(반올림 오차)를 소수부가 큰 항부터 1씩 더해
 * 정수 항의 합이 지수 차이(gap)와 정확히 같게 한다. 지수가 0이나 100에서 잘린 칸이 있으면 clamped이고 parts는 비어 있다.
 */
export function splitGap(base: HourScore, cand: HourScore): { gap: number; clamped: boolean; parts: GapPart[] } {
  if (base.index === null || cand.index === null || !base.parts || !cand.parts) return { gap: 0, clamped: true, parts: [] }
  const gap = base.index - cand.index
  const cb = contributions(base.parts)
  const cc = contributions(cand.parts)
  const out = (v: number) => v < 0 || v > 100
  if (out(total(cb)) || out(total(cc))) return { gap, clamped: true, parts: [] }
  const d = cb.map((v, i) => Math.round((v - cc[i]) * 1e9) / 1e9) // 부동소수 잡음을 없앤다
  const f = d.map(Math.floor)
  const r = gap - total(f)
  // 두 장소의 값이 같은 항(차이 0)에는 점수를 더하거나 빼지 않는다. 지수 반올림이 정확히 .5인 경계에서는 r이 음수가 되는데,
  // 그때 차이 0인 항에서 1을 빼면 같은 값에 '높아요'가 붙기 때문이다.
  const live = d.map((_, i) => i).filter((i) => d[i] !== 0)
  const ks = live.length ? live : d.map((_, i) => i)
  // r이 음수여도 같은 식이다: 모든 항에서 한 몫을 빼고 소수부가 큰 항부터 되돌려 준다
  const q = Math.floor(r / ks.length)
  const rem = r - q * ks.length
  ks.sort((a, b) => d[b] - f[b] - (d[a] - f[a]) || a - b).forEach((k, j) => {
    f[k] += q + (j < rem ? 1 : 0)
  })
  return { gap, clamped: false, parts: PART_KEYS.map((key, i) => ({ key, diff: f[i] })).filter((p) => p.diff !== 0) }
}

/**
 * 같은 곳 다른 시간: 권고 시각(recommend의 from)의 칸이 무던하고 기준 칸과 시각이 다르면 그 칸을 돌려준다.
 */
export function altCell(scores: HourScore[], from: number | null, shown: HourScore): HourScore | undefined {
  const c = from === null ? undefined : scoreAt(scores, from)
  return c && c.level === 'calm' && c.time.slice(0, 13) !== shown.time.slice(0, 13) ? c : undefined
}
