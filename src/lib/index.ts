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

export function hourOf(time: string): number {
  return Number(time.slice(11, 13))
}

/**
 * 장소의 시간대별 지수. 현재 시각 + 12시간 예측.
 * sound: 요일·시간 버킷 조회 함수. offset: 장소별 개인 보정치(기록으로 학습).
 */
export function hourScores(
  snap: PlaceSnapshot | undefined,
  sound: (hour: number) => SoundBucket | undefined,
  profile: ChildProfile | null,
  offset = 0,
): HourScore[] {
  if (!snap) return []
  const pts: ForecastPoint[] = []
  if (snap.live) pts.push({ time: snap.live.time, level: snap.live.level, min: snap.live.min, max: snap.live.max })
  pts.push(...snap.fcst)
  const personal = profile?.enabled ? profile : null
  return pts.map((p) => {
    const h = hourOf(p.time)
    let c = congestScore(p, pts)
    if (personal) c = clamp(c * personal.crowd, 0, 100)
    const b = sound(h)
    const s = soundScore(b, personal ?? undefined)
    const w = s === null ? 0 : soundWeight(b?.n ?? 0)
    const idx = clamp((1 - w) * c + w * (s ?? 0) + (personal ? offset : 0), 0, 100)
    return { time: p.time, hour: h, index: Math.round(idx), level: level3(idx), soundN: b?.n ?? 0 }
  })
}

/** 권고 시간대: 남은 시간대 중 지수가 가장 낮은 연속 구간의 시작 */
export function recommend(scores: HourScore[]): { text: string; from: number | null } {
  const all = scores.filter((s) => s.index !== null)
  if (all.length === 0) return { text: '예측 자료가 아직 없어서 권고 시간대를 만들지 못했어요.', from: null }
  // 가족이 실제로 외출하는 8~21시만 권고 대상으로 본다. 그 범위가 비어 있으면(심야) 전체에서 고른다.
  const day = all.filter((s) => s.hour >= 8 && s.hour <= 21)
  const valid = day.length ? day : all
  const minIdx = Math.min(...valid.map((s) => s.index as number))
  const best = valid.find((s) => s.index === minIdx)!
  const now = all[0]
  const dayLabel = best.hour < now.hour ? '내일' : '오늘'
  if (best === now) {
    return { text: `지금(${now.hour}시)이 오늘 남은 시간 중 가장 무던한 편이에요.`, from: now.hour }
  }
  if (best.level === 'calm') return { text: `${dayLabel}은 ${best.hour}시 이후가 무던해요.`, from: best.hour }
  return { text: `${dayLabel}은 ${best.hour}시 무렵이 비교적 무던해요. 다른 날도 함께 살펴보세요.`, from: best.hour }
}
