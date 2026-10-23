import type { ChildProfile, HourScore, Level3, NoiseData, Place, Snapshot } from '../types'
import { hourScores } from './index'
import { calmerNearby, candidateCell, distanceKm, NEARBY_MAX_KM, type NearbyItem } from './nearby'
import { noiseLookup } from './noise'
import { noiseGapOf, rankKey, type NoiseGap, type Picked, type Priority } from './pick'
import { KEY_PLAN } from './profile'
import { bucketKey, type SoundStore } from './snapshot'

// 외출 계획의 계산과 저장. 문장은 planText.ts, 화면은 components/Plan.tsx가 맡는다.

export const MEMO_KEYS = ['entry', 'restroom', 'rest', 'exit'] as const
export type MemoKey = (typeof MEMO_KEYS)[number]
export type Memo = Record<MemoKey, string>
export const MEMO_MAX = 40

export const emptyMemo = (): Memo => ({ entry: '', restroom: '', rest: '', exit: '' })
export const memoIsEmpty = (m: Memo): boolean => MEMO_KEYS.every((k) => m[k].trim() === '')

/** 저장된 장소별 메모 묶음. 읽을 수 없거나 모양이 다르면 빈 객체 */
function readPlaces(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(KEY_PLAN)
    if (!raw) return {}
    const v: unknown = JSON.parse(raw)
    if (typeof v !== 'object' || v === null || (v as { v?: unknown }).v !== 1) return {}
    const p = (v as { places?: unknown }).places
    return typeof p === 'object' && p !== null && !Array.isArray(p) ? (p as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** 장소의 메모. 읽을 수 없거나 모양이 다르면 빈 메모이고, 문자열이 아닌 칸은 빈 칸으로 보며, 각 칸은 40자로 자른다. */
export function loadMemo(place: string): Memo {
  const memo = emptyMemo()
  const e = readPlaces()[place]
  if (typeof e !== 'object' || e === null) return memo
  for (const k of MEMO_KEYS) {
    const s = (e as Record<string, unknown>)[k]
    if (typeof s === 'string') memo[k] = s.slice(0, MEMO_MAX)
  }
  return memo
}

/**
 * 장소의 메모를 저장한다. 네 칸이 모두 비면 그 장소 항목을 지우고, 항목이 하나도 남지 않으면 키도 지운다.
 * 다른 장소의 항목은 장소 목록에 없는 이름이어도 건드리지 않는다. 쓰기가 막혀 있으면 false.
 */
export function saveMemo(place: string, memo: Memo): boolean {
  try {
    const places = readPlaces()
    const cut = emptyMemo()
    for (const k of MEMO_KEYS) cut[k] = memo[k].trim().slice(0, MEMO_MAX)
    if (memoIsEmpty(cut)) delete places[place]
    else places[place] = { ...cut, ts: new Date().toISOString() }
    if (Object.keys(places).length === 0) localStorage.removeItem(KEY_PLAN)
    else localStorage.setItem(KEY_PLAN, JSON.stringify({ v: 1, places }))
    return true
  } catch {
    return false
  }
}

/** 장소 이름 하나의 시계열을 시트의 이웃 계산과 같은 식으로 만들고, 이름마다 한 번만 계산한다. */
export function scoresGetter(a: {
  snap: Snapshot | null
  sound: SoundStore
  profile: ChildProfile
  offsets: Record<string, number>
  nowKey: string | undefined
  noise: NoiseData | null
  place: Place
  scores: HourScore[]
}): (name: string) => HourScore[] {
  const m = new Map<string, HourScore[]>([[a.place.name, a.scores]])
  return (name) => {
    let s = m.get(name)
    if (!s) {
      s = hourScores(a.snap?.places[name], (h, d) => a.sound[name]?.[bucketKey(d, h)], a.profile, a.offsets[name] ?? 0, a.nowKey, noiseLookup(a.noise, name))
      m.set(name, s)
    }
    return s
  }
}

/** 외출 계획을 만들 수 있는 시계열인가: 지수가 있는 칸이 하나 이상. 자료가 12시간 넘게 묵은 경우(tooOld)는 부르는 쪽이 따로 거른다. */
export const hasPlanCells = (scores: HourScore[]): boolean => scores.some((c) => c.index !== null)

const ALT_LIMIT = 2 // 대안으로 보여 주는 최대 수

interface PoolArgs {
  place: Place
  places: Place[]
  cell: HourScore
  getScores: (name: string) => HourScore[] | undefined
  isStale: (name: string) => boolean
}

/**
 * 고른 칸이 안 맞을 때 갈 수 있는 곳 전부: 직선 6km 안에서 같은 시각의 같은 종류(예측이나 관측) 칸이 있고 단계가 더 낮은 곳을 단계, 거리 순으로 늘어놓는다.
 * 기준 칸이 무던함이면 무던한 곳만, 보통이나 붐빔이면 그보다 낮은 곳을 후보로 삼는다. 우선순위는 이 집합을 바꾸지 않는다.
 */
export function planPool(a: PoolArgs): NearbyItem[] {
  if (a.cell.index === null || a.cell.level === 'nodata') return []
  const target: Level3 = a.cell.level === 'calm' ? 'mid' : a.cell.level
  return calmerNearby(a.place, target, a.places, (p) => (a.isStale(p.name) ? undefined : candidateCell(a.getScores(p.name), a.cell, false)), NEARBY_MAX_KM, Infinity, true)
}

/**
 * 후보 집합을 '오늘은 이게 더 중요해요' 선택으로 줄 세워 앞의 2곳을 돌려준다. 키는 사전식이고 마지막 동점은 place.id다.
 * 선택이 없으면 집합이 이미 (단계, 거리) 순이므로 그대로 쓴다. 덜 붐비는 곳은 (단계, 혼잡 점수, 거리), 소음이 덜한 곳은 (단계, 소음 키, 거리), 가까운 곳은 (거리)다.
 */
export function rankAlternatives(pool: NearbyItem[], priority: Priority | null): NearbyItem[] {
  if (priority === null) return pool.slice(0, ALT_LIMIT)
  const key = (it: NearbyItem): number[] => (priority === 'near' ? [it.km] : [it.level === 'calm' ? 0 : 1, ...rankKey(it.cell, priority), it.km])
  const order = (a: NearbyItem, b: NearbyItem): number => {
    const ka = key(a)
    const kb = key(b)
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i]
    return a.place.id < b.place.id ? -1 : a.place.id > b.place.id ? 1 : 0
  }
  return [...pool].sort(order).slice(0, ALT_LIMIT)
}

/** 안 맞을 때 갈 대안 2곳까지. priority가 없으면 단계, 거리 순이다. */
export function planAlternatives(a: PoolArgs & { priority?: Priority | null }): NearbyItem[] {
  return rankAlternatives(planPool(a), a.priority ?? null)
}

/** '소음이 덜한 곳'을 골랐지만 후보 어디에도 소음 값이 없어서 순서를 적용하지 못하는 이유(추천 탭과 같은 noiseGapOf 판정) */
export function planNoiseGap(pool: NearbyItem[], noiseLoaded: boolean): NoiseGap {
  return noiseGapOf(
    pool.map((it) => ({ place: it.place, km: it.km, stale: false, cell: it.cell as Picked['cell'] })),
    noiseLoaded,
  )
}

/** 맞춤을 켰어도 고른 민감도도, 비교에 든 6km 안 장소의 기록 보정도 없으면 지수가 기본 기준과 같다(시트의 무던한 곳 안내와 같은 판정) */
export function customApplied(profile: ChildProfile, offsets: Record<string, number>, place: Place, places: Place[]): boolean {
  const chosen = profile.crowd !== 1 || profile.loud !== 1 || Object.values(profile.tags).some((v) => v !== 1)
  return profile.enabled && (chosen || places.some((p) => (offsets[p.name] ?? 0) !== 0 && (p.name === place.name || distanceKm(place, p) <= NEARBY_MAX_KM)))
}
