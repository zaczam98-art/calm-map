import { useDeferredValue, useMemo } from 'react'
import type { ChildProfile, HourScore, NoiseData, Place, Snapshot } from '../types'
import { SENSE_TAGS } from '../types'
import { hourScores } from './index'
import { noiseLookup } from './noise'
import { bucketKey, type SoundStore } from './snapshot'

/** 맞춤을 켰을 때 첫 칸의 지수가 가장 많이 달라지는 장소 하나와 그 전후 점수 */
export interface PreviewChange {
  place: string
  /** 보여 주는 칸의 시(지금 칸이 아니면 이 시를 밝힌다) */
  hour: number
  now: boolean
  off: number
  on: number
}

export interface PreviewInput {
  places: Place[]
  snap: Snapshot | null
  sound: SoundStore
  offsets: Record<string, number>
  noise: NoiseData | null
  nowKey: string | undefined
}

/** 예를 보여 줄 수 있는 것은 서울시 실제 자료가 있을 때뿐이다 */
export const canPreview = (snap: Snapshot | null) => snap?.source === 'seoul'

/** 장소별 첫 칸(지금 칸)의 점수. profile이 null이면 맞춤을 끈 값이다. 서울시 실제 자료가 아니면 비어 있다. */
function firstCells(input: PreviewInput, profile: ChildProfile | null): Map<string, HourScore> {
  const { places, snap, sound, offsets, noise, nowKey } = input
  const out = new Map<string, HourScore>()
  if (!snap || !canPreview(snap)) return out
  for (const p of places) {
    const soundAt = (h: number, d: number) => sound[p.name]?.[bucketKey(d, h)]
    const first = hourScores(snap.places[p.name], soundAt, profile, profile ? (offsets[p.name] ?? 0) : 0, nowKey, noiseLookup(noise, p.name))[0]
    if (first) out.set(p.name, first)
  }
  return out
}

/**
 * 맞춤을 켰을 때 첫 칸의 지수가 가장 많이 달라지는 장소. 달라지는 곳이 없으면 null.
 * midUpOnly를 켜면(우리 아이 탭) 맞춤을 끈 첫 칸이 보통 이상인 장소만 보고, 지수 상한(100)에 닿은 예는 실제 차이를 줄여 보이므로 닿지 않은 예가 있으면 그쪽을 먼저 고른다.
 * 끄면(칩 질문 시트) 이 두 조건 없이 차이가 가장 큰 장소를 고른다.
 */
function biggestChange(off: Map<string, HourScore>, on: Map<string, HourScore>, nowKey: string | undefined, midUpOnly: boolean): PreviewChange | null {
  let best: PreviewChange | null = null
  let bestCapped = false
  for (const [place, o] of off) {
    const n = on.get(place)
    if (!n || o.index === null || n.index === null) continue
    if (midUpOnly && o.level !== 'mid' && o.level !== 'busy') continue
    const gap = Math.abs(n.index - o.index)
    if (gap === 0) continue
    const capped = midUpOnly && n.index >= 100
    const better = !best || (capped !== bestCapped ? !capped : gap > Math.abs(best.on - best.off))
    if (better) {
      best = { place, hour: n.hour, now: n.time.slice(0, 13) === nowKey, off: o.index, on: n.index }
      bestCapped = capped
    }
  }
  return best
}

/**
 * 맞춤 전후 점수 미리 보기. profile이 null이면 계산하지 않는다(맞춤 여부와 무관하게 profile.enabled를 켠 값을 넘긴다).
 * 맞춤을 끈 첫 칸은 profile과 무관하므로 한 번만 계산하고, profile이 바뀔 때는 켠 쪽만 다시 계산한다.
 * 누름이 계산을 기다리지 않게 미룬 값을 쓰므로, settled가 false인 동안은 이전 결과가 남아 있을 수 있다.
 * midUpOnly는 예시 장소를 고르는 규칙이다(biggestChange 참고). 기본은 끈 쪽이다.
 */
export function usePreviewChange(input: PreviewInput, profile: ChildProfile | null, midUpOnly = false): { change: PreviewChange | null; settled: boolean } {
  const { places, snap, sound, offsets, noise, nowKey } = input
  const offCells = useMemo(() => firstCells({ places, snap, sound, offsets, noise, nowKey }, null), [places, snap, sound, offsets, noise, nowKey])
  const shown = useDeferredValue(profile)
  const deferred = useMemo(
    () => (shown ? biggestChange(offCells, firstCells({ places, snap, sound, offsets, noise, nowKey }, shown), nowKey, midUpOnly) : null),
    [shown, offCells, places, snap, sound, offsets, noise, nowKey, midUpOnly],
  )
  return { change: profile ? deferred : null, settled: shown === profile }
}

/** 기본값(모두 보통)과 다른 항목이 없는지 */
export const isPlain = (p: ChildProfile) => p.crowd === 1 && p.loud === 1 && SENSE_TAGS.every((t) => p.tags[t] === 1)

/** 안내방송·기계 소리는 소리 점수에만 곱해지므로, 이 항목만 바꾸면 현장 측정이 없는 칸의 지수는 바뀌지 않는다 */
export const isSoundOnly = (p: ChildProfile) => !isPlain(p) && p.crowd === 1 && p.loud === 1 && SENSE_TAGS.every((t) => t === 'music' || t === 'machine' || p.tags[t] === 1)
