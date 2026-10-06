export type CongestLevel = '여유' | '보통' | '약간 붐빔' | '붐빔'

export interface Place {
  id: string
  name: string
  lat: number
  lng: number
  category: string
  tracked: boolean
}

export interface ForecastPoint {
  time: string // 'YYYY-MM-DD HH:00'
  level: CongestLevel
  min: number
  max: number
}

export interface PlaceSnapshot {
  live: { time: string; level: CongestLevel; min: number; max: number } | null
  fcst: ForecastPoint[]
  stale?: boolean
}

export interface Snapshot {
  updatedAt: string
  source: 'seoul' | 'demo'
  places: Record<string, PlaceSnapshot>
}

/** 감각 태그 6종 */
export type SenseTag = 'sudden' | 'crowd' | 'machine' | 'music' | 'speech' | 'ambient'

export const SENSE_TAGS: SenseTag[] = ['sudden', 'crowd', 'machine', 'music', 'speech', 'ambient']

export const TAG_LABEL: Record<SenseTag, string> = {
  sudden: '돌발음(사이렌·경적·알람)',
  crowd: '군중 소리',
  machine: '기계·차량',
  music: '음악·안내방송',
  speech: '말소리',
  ambient: '배경음',
}

/** 소리 버킷 요약: 태그별 가중 강도 평균과 표본 수 */
export interface SoundBucket {
  n: number
  tags: Partial<Record<SenseTag, number>> // 0~1 평균 강도
}

export type Sensitivity = 0.5 | 1 | 1.5

export interface ChildProfile {
  enabled: boolean
  tags: Record<SenseTag, Sensitivity>
  crowd: Sensitivity
}

export type Level3 = 'calm' | 'mid' | 'busy' | 'nodata'

export interface HourScore {
  time: string
  hour: number
  index: number | null
  level: Level3
  soundN: number
}

export interface Card {
  steps: { icon: string; text: string }[]
  prep: string
  whenHard: string
  source: 'ai' | 'preset'
}
