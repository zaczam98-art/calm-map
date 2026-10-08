export type CongestLevel = '여유' | '보통' | '약간 붐빔' | '붐빔'

/** 화면에 보이는 장소 분류 이름(원자료의 분류 이름을 가족이 알아보기 쉬운 말로) */
export const CATEGORY_LABEL: Record<string, string> = {
  인구밀집지역: '역·번화가',
  발달상권: '상권',
  관광특구: '관광특구',
  '고궁·문화유산': '궁궐·유적',
  공원: '공원',
}

export interface Place {
  id: string
  name: string
  lat: number
  lng: number
  category: string
  tracked: boolean
}

/** 이름 옆에 붙일 분류 라벨. 이름에 이미 '관광특구'가 있거나 역이 아닌 인구밀집지역(숭례문, 시의회 앞)이면 빈 문자열이다. 카드 조회 키는 place.category 원본을 쓴다. */
export function placeLabel(place: Pick<Place, 'name' | 'category'>): string {
  if (place.name.includes('관광특구')) return ''
  if (place.category === '인구밀집지역' && !place.name.includes('역')) return ''
  return CATEGORY_LABEL[place.category] ?? place.category
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
  extra?: PlaceExtra
}

/** 혼잡도 외의 요인(서울시 실시간 도시데이터에 등록된 사실) */
export interface PlaceExtra {
  events?: { name: string; place: string; period: string; short: boolean }[]
  eventsN?: number
  controls?: { type: string; dtype: string; info: string; until: string }[]
  controlsN?: number
  weather?: { temp: string | null; pcp: string | null; uv: string | null; pm25: string | null; pm10: string | null; rainHours: number[] }
  road?: { idx: string; spd: number | string | null }
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
  /** 소리의 크기(주변 소음 실측)에 대한 민감도 */
  loud: Sensitivity
}

export type Level3 = 'calm' | 'mid' | 'busy' | 'nodata'

/**
 * 지수를 이루는 단계별 값(반올림하지 않은 값). 지수 = clamp((1-w)·base + w·(s ?? 0) + offset, 0, 100).
 * c: 혼잡 점수(맞춤 곱 적용 후), n: 소음 점수(자료 없으면 null), base: n이 있으면 0.6c+0.4n, 없으면 c,
 * s: 소리 점수(표본 없으면 null), w: 소리 가중, offset: 장소별 기록 보정(맞춤을 껐으면 0).
 */
export interface ScoreParts {
  c: number
  n: number | null
  s: number | null
  w: number
  offset: number
  base: number
}

export interface HourScore {
  time: string
  hour: number
  index: number | null
  level: Level3
  soundN: number
  /** 실시간 관측이 아니라 예측값으로 채운 시간대 */
  forecast: boolean
  /** 주변 센서의 소음 실측이 지수에 들어간 시간대 */
  noise: boolean
  /** 현재 시각 칸을 직전 실시간 관측으로 채웠을 때 그 관측 시각('HH:MM') */
  obs?: string
  /** 지수의 단계별 구성(왜 이 지수인가 화면용) */
  parts?: ScoreParts
}

export interface Card {
  steps: { icon: string; text: string }[]
  prep: string
  whenHard: string
  source: 'ai' | 'preset'
}

/** 요일×시간대 혼잡도 패턴. places[장소]['요일-시'] = [평균 단계(0~3), 표본 수]. 요일은 일요일=0 */
export interface WeekPattern {
  updatedAt: string
  firstObs: string | null
  days: number
  places: Record<string, Record<string, [number, number]>>
}

export interface LeadMetric {
  n: number
  exact: number
  within1: number
  persistN: number
  persistExact: number
}

/** 서울시 혼잡도 예측과 실제 관측의 비교(몇 시간 전 예측인지별) */
export interface ForecastMetrics {
  updatedAt: string
  firstObs: string | null
  days: number
  nObs: number
  runs: number
  byLead: Record<string, LeadMetric>
  overall: LeadMetric
}

export interface BriefingWindow {
  place: string
  from: number
  to: number
}

/** 오늘의 브리핑(GitHub Actions에서 생성, 규칙 검사 통과분) */
export interface Briefing {
  generatedAt: string
  date: string
  basis: string
  source: 'ai' | 'rule'
  headline: string
  picks: (BriefingWindow & { reason: string })[]
  avoid: BriefingWindow[]
  tip: string
}

/** 장소 주변 S-DoT 센서의 요일×시간대 소음 실측. avg[요일]과 max[요일]은 hours[0]시부터 시간순 배열 */
export interface NoisePlace {
  sensors: number
  km: [number, number]
  excluded?: number
  avg: Record<string, (number | null)[]>
  max: Record<string, (number | null)[]>
  n: number
}

export interface NoiseData {
  updatedAt: string
  days: number
  from: string | null
  to: string | null
  hours: [number, number]
  places: Record<string, NoisePlace>
}
