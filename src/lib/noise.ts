import type { NoiseData } from '../types'

export interface NoiseAt {
  avg: number
  max: number | null
}

/** 장소의 요일·시간대별 소음 실측을 돌려주는 조회 함수를 만든다(자료가 없으면 항상 undefined). */
export function noiseLookup(noise: NoiseData | null, place: string): (hour: number, dow: number) => NoiseAt | undefined {
  const p = noise?.places[place]
  if (!p) return () => undefined
  const h0 = noise!.hours[0]
  const h1 = noise!.hours[1]
  return (hour, dow) => {
    if (hour < h0 || hour > h1) return undefined
    const avg = p.avg[String(dow)]?.[hour - h0]
    if (avg === null || avg === undefined) return undefined
    const max = p.max[String(dow)]?.[hour - h0] ?? null
    return { avg, max }
  }
}
