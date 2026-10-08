import type { PlaceExtra } from '../types'

export interface FactorTag {
  key: string
  label: string
}

const CONTROL_LABEL: Record<string, string> = { 공사: '공사', 집회및행사: '집회·행사', 사고: '사고', 기타: '통제' }
const HIGH_UV = ['높음', '매우높음', '위험']
const BAD_AIR = ['나쁨', '매우나쁨']

export function controlLabel(type: string): string {
  return CONTROL_LABEL[type] ?? '통제'
}

/**
 * 해제 예정 시각이 지난 통제를 뺀 extra. nowStr는 한국 시간 'YYYY-MM-DD HH:00'.
 * 수집이 늦어 오래된 스냅샷일 때의 안전장치이므로, 꼬리표를 만드는 모든 화면이 이 함수를 거친 extra를 쓴다.
 */
export function activeControls(extra: PlaceExtra | undefined, nowStr: string | undefined): PlaceExtra | undefined {
  if (!extra || !nowStr) return extra
  const controls = (extra.controls ?? []).filter((c) => !c.until || c.until >= nowStr)
  return { ...extra, controls, controlsN: controls.length ? extra.controlsN : 0 }
}

/** 혼잡도 말고도 아이에게 부담이 될 수 있는 오늘의 요인을 짧은 꼬리표로 만든다(서울시 자료에 있는 사실만). */
export function factorTags(extra: PlaceExtra | undefined): FactorTag[] {
  if (!extra) return []
  const tags: FactorTag[] = []
  const kinds = [...new Set((extra.controls ?? []).map((c) => controlLabel(c.type)))]
  for (const k of kinds) tags.push({ key: `control-${k}`, label: k === '통제' ? '주변 통제' : `주변 ${k}` })
  if (extra.eventsN) tags.push({ key: 'events', label: `근처 행사 ${extra.eventsN}건` })
  const rain = extra.weather?.rainHours ?? []
  if (rain.length) tags.push({ key: 'rain', label: `비 예보 ${Math.min(...rain)}시부터` })
  if (extra.weather?.uv && HIGH_UV.includes(extra.weather.uv)) tags.push({ key: 'uv', label: '자외선 높음' })
  if ([extra.weather?.pm25, extra.weather?.pm10].some((v) => v && BAD_AIR.includes(v))) tags.push({ key: 'air', label: '미세먼지 나쁨' })
  if (extra.road?.idx === '정체') tags.push({ key: 'road', label: '주변 도로 정체' })
  return tags
}
