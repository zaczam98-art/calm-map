import type { Level3, Place } from '../types'

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
}

export const NEARBY_MAX_KM = 6
export const NEARBY_MIN_GAP = 10

/**
 * 기준 장소에서 직선 거리 maxKm 안에 있고, 지금 지수가 minGap 이상 낮은 장소를 가까운 순으로 고른다.
 * current는 각 장소의 현재 지수를 돌려주는 함수다(자료가 없으면 undefined).
 */
export function calmerNearby(
  target: Place,
  targetIndex: number,
  all: Place[],
  current: (p: Place) => { index: number | null; level: Level3 } | undefined,
  maxKm = NEARBY_MAX_KM,
  minGap = NEARBY_MIN_GAP,
  limit = 3,
): NearbyItem[] {
  const out: NearbyItem[] = []
  for (const p of all) {
    if (p.name === target.name) continue
    const km = distanceKm(target, p)
    if (km > maxKm) continue
    const c = current(p)
    if (!c || c.index === null) continue
    if (c.index <= targetIndex - minGap) out.push({ place: p, km, index: c.index, level: c.level })
  }
  return out.sort((a, b) => a.km - b.km).slice(0, limit)
}
