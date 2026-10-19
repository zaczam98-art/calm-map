import placesRaw from '../data/places.json'
import type { Place } from '../types'
import type { Priority } from './pick'
import { KEY_REC_ANCHOR } from './profile'

export type Where = 'all' | 'gps' | 'place'

/** 탭을 옮겼다 돌아와도 유지할 추천 화면의 선택 상태(부모가 보관). 기기에 저장하는 것은 anchor(장소 이름 하나)뿐이다. */
export interface RecommendUi {
  group: number
  /** 내 위치. 메모리에만 두고 저장하지 않는다 */
  pos: { lat: number; lng: number } | null
  byDistance: boolean
  where: Where
  /** 다른 장소 근처로 고른 기준 장소의 이름 */
  anchor: string | null
  /** 오늘의 시(null=지금) */
  when: number | null
  priority: Priority | null
}

const NAMES = new Set((placesRaw as Place[]).filter((p) => p.tracked).map((p) => p.name))

/** 저장된 기준 장소 이름. 저장소를 읽을 수 없거나 목록에 없는 이름이면 null */
export function loadAnchor(): string | null {
  try {
    const raw = localStorage.getItem(KEY_REC_ANCHOR)
    if (!raw) return null
    const v: unknown = JSON.parse(raw)
    return typeof v === 'string' && NAMES.has(v) ? v : null
  } catch {
    return null
  }
}

/** 기준 장소 이름을 저장하거나(null이면 지운다). 저장이 막힌 환경에서는 조용히 넘어간다. */
export function saveAnchor(name: string | null): void {
  try {
    if (name === null) localStorage.removeItem(KEY_REC_ANCHOR)
    else localStorage.setItem(KEY_REC_ANCHOR, JSON.stringify(name))
  } catch {
    /* 저장 불가 환경에서는 이번 방문 동안만 쓴다 */
  }
}

export function initialRecUi(): RecommendUi {
  const anchor = loadAnchor()
  return { group: 0, pos: null, byDistance: false, where: anchor ? 'place' : 'all', anchor, when: null, priority: null }
}
