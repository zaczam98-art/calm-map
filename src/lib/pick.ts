import { CATEGORY_LABEL, type ChildProfile, type HourScore, type Place, type PlaceExtra } from '../types'
import { DAY_FROM, DAY_TO, scoreAt } from './index'
import { NEARBY_FAR_KM, NEARBY_LIMIT, NEARBY_MAX_KM } from './nearby'
import { spikeAdd } from './scoreWords'

// 추천 탭 '후보 3곳'을 고르는 순수 계산. 화면 문구는 pickText.ts, 상태 저장은 recPrefs.ts가 맡는다.
// 우선순위는 pickCandidates의 정렬 키에만 들어간다. 지수(hourScores)와 풀(어느 곳이 후보가 되는가)은 우선순위와 무관하다.

const CATEGORIES = ['공원', '고궁·문화유산', '발달상권', '관광특구', '인구밀집지역']
/** 종류 칩. 0번이 '전체'(빈 목록), 나머지는 원자료 분류 하나씩 */
export const GROUPS: [string, string[]][] = [['전체', []], ...CATEGORIES.map((c): [string, string[]] => [CATEGORY_LABEL[c] ?? c, [c]])]

export type Priority = 'crowd' | 'noise' | 'near'
export type PickWhy = 'noRange' | 'noData' | 'allBusy' | 'few'

export interface PickRow {
  place: Place
  /** 기준(내 위치나 고른 장소)까지의 직선 거리. 기준이 없으면 null */
  km: number | null
  /** 고른 시각의 칸. 없으면 undefined */
  cell: HourScore | undefined
  stale: boolean
}

export interface PickOpt {
  /** 원자료 분류 이름. 비어 있으면 전부 */
  cats: string[]
  priority: Priority | null
  maxKm?: number
  limit?: number
}

/** 풀에 든 행. 고른 칸에 지수가 있다. */
export type Picked<T extends PickRow = PickRow> = T & { cell: HourScore & { index: number } }

export interface PickResult<T extends PickRow = PickRow> {
  picks: Picked<T>[]
  /** 풀 전체(정렬된 순서). picks는 이 앞부분이다 */
  pool: Picked<T>[]
  /** 종류와 반경 안에 든 장소 수 */
  inRange: number
  why: PickWhy | null
}

/** 카드에 적는 직선 거리(km). 소수 첫째 자리까지 쓴다. */
export const kmText = (km: number): string => km.toFixed(1)

/** '3km보다 멀어요' 표지를 붙일지. 카드에 적힌 거리와 같은 값으로 가려서, 직선 3.0km에 3km보다 멀다는 표지가 함께 붙지 않게 한다. */
export const isFarKm = (km: number): boolean => Number(kmText(km)) > NEARBY_FAR_KM

/**
 * 고른 시각(fromHour) 이후의 비 예보만 남긴 extra. 비 예보 꼬리표('비 예보 N시부터')가 고른 시각과 상관없이 하루 전체의 첫 시각을 말하지 않게 한다.
 * 시트의 '오늘 이 장소 주변'이 같은 기준(고른 시 이후)을 쓴다. fromHour가 없으면 그대로 둔다.
 */
export function extraFrom(extra: PlaceExtra | undefined, fromHour: number | undefined): PlaceExtra | undefined {
  if (!extra?.weather || fromHour === undefined) return extra
  return { ...extra, weather: { ...extra.weather, rainHours: extra.weather.rainHours.filter((h) => h >= fromHour) } }
}

/**
 * '덜 붐비는 곳'과 '소음이 덜한 곳'이 같은 단계 안에서 가르는 값(키의 가운데 토막). 추천 탭의 sortKey와 외출 계획의 대안 정렬이 함께 쓴다.
 * 덜 붐비는 곳은 혼잡 점수 C를 반올림한 값이고, 소음이 덜한 곳은 소음 자료가 없으면 1 아니면 0, 평소 소음 반올림, 갑자기 커짐 가산이다.
 */
export function rankKey(c: HourScore, priority: 'crowd' | 'noise'): number[] {
  if (priority === 'crowd') return [Math.round(c.parts?.c ?? 0)]
  return c.nz ? [0, Math.round(c.nz.avg), spikeAdd(c.nz)] : [1, 0, 0]
}

/** 정렬 키(사전식, 앞이 우선). R은 무던함 0, 보통 1. 마지막 동점은 place.id(문자열 비교)로 정한다. */
export function sortKey(r: Picked, priority: Priority | null): number[] {
  const c = r.cell
  const R = c.level === 'calm' ? 0 : 1
  const I = c.index
  const d = r.km ?? 0
  if (priority === 'crowd' || priority === 'noise') return [R, ...rankKey(c, priority), I, d]
  if (priority === 'near') return [R, d, I]
  return [R, I, d]
}

function compare(a: Picked, b: Picked, priority: Priority | null): number {
  const ka = sortKey(a, priority)
  const kb = sortKey(b, priority)
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i]
  return a.place.id < b.place.id ? -1 : a.place.id > b.place.id ? 1 : 0
}

/**
 * 후보를 고른다. 풀 조건: 종류가 맞고, 기준이 있으면 maxKm 이하이고, stale이 아니고, 고른 칸에 지수가 있고, 단계가 무던함이나 보통이다.
 * 풀을 (단계, 우선순위 키, 지수, 거리, id) 순으로 정렬해 앞의 limit곳을 돌려준다. why는 후보가 비거나 limit보다 적은 이유다.
 */
export function pickCandidates<T extends PickRow>(rows: T[], opt: PickOpt): PickResult<T> {
  const maxKm = opt.maxKm ?? NEARBY_MAX_KM
  const limit = opt.limit ?? NEARBY_LIMIT
  const range = rows.filter((r) => (opt.cats.length === 0 || opt.cats.includes(r.place.category)) && (r.km === null || r.km <= maxKm))
  const valued = range.filter((r): r is Picked<T> => !r.stale && !!r.cell && r.cell.index !== null)
  const pool = valued.filter((r) => r.cell.level === 'calm' || r.cell.level === 'mid').sort((a, b) => compare(a, b, opt.priority))
  const picks = pool.slice(0, limit)
  const why: PickWhy | null = range.length === 0 ? 'noRange' : valued.length === 0 ? 'noData' : pool.length === 0 ? 'allBusy' : picks.length < limit ? 'few' : null
  return { picks, pool, inRange: range.length, why }
}

/** 고른 민감도나 후보 풀 안의 기록 보정이 지수를 바꿨는지(customText의 applied) */
export function isCustomApplied(profile: ChildProfile, offsets: Record<string, number>, names: string[]): boolean {
  if (!profile.enabled) return false
  const chosen = profile.crowd !== 1 || profile.loud !== 1 || Object.values(profile.tags).some((v) => v !== 1)
  return chosen || names.some((n) => (offsets[n] ?? 0) !== 0)
}

/** '소음이 덜한 곳'을 골랐지만 소음으로 가를 수 없는 이유. file은 소음 파일을 받지 못한 경우, pool은 파일은 있으나 후보 풀의 어느 칸에도 소음 값이 없는 경우다. */
export type NoiseGap = 'file' | 'pool' | null

/** 풀이 있는데 소음 값이 있는 칸이 하나도 없으면 정렬이 기본 순서와 같아진다. 그때의 이유를 돌려주고, 소음으로 가를 수 있으면 null이다. */
export function noiseGapOf(pool: Picked[], noiseLoaded: boolean): NoiseGap {
  if (pool.length === 0 || pool.some((r) => r.cell.nz)) return null
  return noiseLoaded ? 'pool' : 'file'
}

/** 한국 시간 기준 지금의 날짜와 시. 후보가 오늘 남은 시각만 다루므로 이 둘이면 된다. */
export interface Clock {
  date: string
  hour: number
}

/** nowKey('YYYY-MM-DD HH')에서 뽑고, 없으면(데모 스냅샷) 시계열들의 첫 칸에서 뽑는다. 칸이 하나도 없으면 null. */
export function clockOf(nowKey: string | undefined, lists: HourScore[][]): Clock | null {
  if (nowKey) return { date: nowKey.slice(0, 10), hour: Number(nowKey.slice(11, 13)) }
  const first = lists.find((s) => s.length > 0)?.[0]
  return first ? { date: first.time.slice(0, 10), hour: first.hour } : null
}

export type Phase = 'before' | 'now' | 'after'

/** 지금이 외출 시간(8~21시) 전인지, 안인지, 지났는지 */
export function phaseOf(hour: number): Phase {
  return hour < DAY_FROM ? 'before' : hour > DAY_TO ? 'after' : 'now'
}

/**
 * '언제' 선택지: 오늘 날짜이고 지수가 있고 외출 시간(8~21시) 안이며 지금 시보다 큰 시의 합집합(오름차순).
 * lists는 stale이 아닌 장소들의 시계열이다.
 */
export function whenSlots(lists: HourScore[][], clock: Clock): number[] {
  const hours = new Set<number>()
  for (const s of lists) {
    for (const c of s) {
      if (c.time.slice(0, 10) === clock.date && c.index !== null && c.hour >= DAY_FROM && c.hour <= DAY_TO && c.hour > clock.hour) hours.add(c.hour)
    }
  }
  return [...hours].sort((a, b) => a - b)
}

/**
 * 저장해 둔 when(null=지금)을 지금 선택지에 맞춘다. 선택지에 있으면 그대로 두고, 빠졌으면(시간이 지남) 지금이 외출 시간 안일 때는 null(지금),
 * 아니면 첫 선택지로 바꾼다. 선택지가 없으면 null이다.
 */
export function resolveWhen(when: number | null, slots: number[], clock: Clock): number | null {
  if (when !== null && slots.includes(when)) return when
  if (phaseOf(clock.hour) === 'now') return null
  return slots[0] ?? null
}

/**
 * 고른 시각의 칸. when이 null이면 시계열의 첫 칸이되, nowKey가 있으면 그 칸이 현재 시일 때만 인정한다
 * (서울시 자료가 현재 시를 건너뛴 장소를 '지금'이라 부르지 않기 위해서). 숫자이면 그 시의 칸이고 날짜도 오늘이어야 한다.
 */
export function cellFor(scores: HourScore[], when: number | null, nowKey: string | undefined, clock: Clock): HourScore | undefined {
  if (when === null) {
    const c = scores[0]
    return c && (!nowKey || c.time.slice(0, 13) === nowKey) ? c : undefined
  }
  const c = scoreAt(scores, when)
  return c && c.time.slice(0, 10) === clock.date ? c : undefined
}

/** 오늘 이후 날짜의 칸(지수가 있는 것)이 하나라도 있는가. 22시 이후 '내일 아침은 지도 탭에서' 안내를 붙일지 가른다. */
export function hasLaterDay(lists: HourScore[][], clock: Clock): boolean {
  return lists.some((s) => s.some((c) => c.index !== null && c.time.slice(0, 10) > clock.date))
}
