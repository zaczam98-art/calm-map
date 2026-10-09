import type { Level3 } from '../types'

/** 막대 색. 시간대 막대 그림(HourChart)과 공유 이미지(shareCard)가 같은 값을 쓴다. */
export const FILL: Record<Level3, string> = { calm: '#9ddbc8', mid: '#46739e', busy: '#2e2a5e', nodata: '#ffffff' }

/** 추천 비교에서 빼는 밤 시간(8시 전, 21시 뒤) */
export const isNight = (h: number) => h < 8 || h > 21
