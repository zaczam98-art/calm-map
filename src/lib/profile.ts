import type { ChildProfile, SenseTag, Sensitivity } from '../types'
import { SENSE_TAGS } from '../types'

const KEY_PROFILE = 'calmmap.profile.v1'
const KEY_OFFSET = 'calmmap.offset.v1'
const KEY_LOG = 'calmmap.log.v1'

export function defaultProfile(): ChildProfile {
  const tags = Object.fromEntries(SENSE_TAGS.map((t) => [t, 1])) as Record<SenseTag, Sensitivity>
  return { enabled: false, tags, crowd: 1 }
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* 저장 불가 환경(시크릿 창 등)에서는 조용히 넘어간다 */
  }
}

export function loadProfile(): ChildProfile {
  const p = read<ChildProfile | null>(KEY_PROFILE, null)
  return p ? { ...defaultProfile(), ...p, tags: { ...defaultProfile().tags, ...p.tags } } : defaultProfile()
}

export function saveProfile(p: ChildProfile) {
  write(KEY_PROFILE, p)
}

export function loadOffsets(): Record<string, number> {
  return read<Record<string, number>>(KEY_OFFSET, {})
}

export interface VisitLog {
  place: string
  ts: string
  ok: boolean
  topTags: SenseTag[]
}

export function loadLog(): VisitLog[] {
  return read<VisitLog[]>(KEY_LOG, [])
}

/**
 * 다녀온 뒤 기록. 괜찮았어요(-5) / 힘들었어요(+5), 범위 ±20.
 * 힘들었어요이면 그 시간대 상위 태그의 민감도를 한 단계(+0.5는 과하므로 0.5 단위 체계 안에서 1→1.5만) 올린다.
 */
export function recordVisit(place: string, ok: boolean, topTags: SenseTag[]): { offsets: Record<string, number>; profile: ChildProfile } {
  const offsets = loadOffsets()
  const cur = offsets[place] ?? 0
  offsets[place] = Math.max(-20, Math.min(20, cur + (ok ? -5 : 5)))
  write(KEY_OFFSET, offsets)
  const profile = loadProfile()
  if (!ok) {
    for (const t of topTags.slice(0, 2)) {
      if (profile.tags[t] === 1) profile.tags[t] = 1.5
      else if (profile.tags[t] === 0.5) profile.tags[t] = 1
    }
    saveProfile(profile)
  }
  const log = loadLog()
  log.push({ place, ts: new Date().toISOString(), ok, topTags })
  write(KEY_LOG, log.slice(-200))
  return { offsets, profile }
}

export function clearAll() {
  for (const k of [KEY_PROFILE, KEY_OFFSET, KEY_LOG]) localStorage.removeItem(k)
}
