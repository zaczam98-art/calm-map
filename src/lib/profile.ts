import type { ChildProfile, SenseTag, Sensitivity } from '../types'
import { SENSE_TAGS } from '../types'
import { KEY_SOUND } from './snapshot'

const KEY_PROFILE = 'calmmap.profile.v1'
const KEY_OFFSET = 'calmmap.offset.v1'
const KEY_LOG = 'calmmap.log.v1'

export function defaultProfile(): ChildProfile {
  const tags = Object.fromEntries(SENSE_TAGS.map((t) => [t, 1])) as Record<SenseTag, Sensitivity>
  return { enabled: false, tags, crowd: 1, loud: 1 }
}

/** valid가 있으면 저장값이 그 모양이 아닐 때(null, 배열 자리에 객체 등) fallback을 돌려준다. */
function read<T>(key: string, fallback: T, valid?: (v: unknown) => boolean): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const v: unknown = JSON.parse(raw)
    return valid && !valid(v) ? fallback : (v as T)
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

/** 이 기기에 저장된 프로필이 있는지(첫 방문 안내를 보여 줄지 정하는 데 쓴다). 저장소를 읽을 수 없으면 있는 것으로 본다. */
export function hasSavedProfile(): boolean {
  try {
    return localStorage.getItem(KEY_PROFILE) !== null
  } catch {
    return true
  }
}

export function loadOffsets(): Record<string, number> {
  return read<Record<string, number>>(KEY_OFFSET, {}, (v) => typeof v === 'object' && v !== null && !Array.isArray(v))
}

export interface VisitLog {
  place: string
  ts: string
  ok: boolean
  topTags: SenseTag[]
}

export function loadLog(): VisitLog[] {
  return read<VisitLog[]>(KEY_LOG, [], (v) => Array.isArray(v) && v.every((l) => typeof l === 'object' && l !== null))
}

/** 기록 직전 상태. 방금 기록 취소(undoVisit)에 쓴다. */
export interface VisitPrev {
  offset: number
  tags: Record<string, number>
}

const DUPLICATE_MS = 3 * 3600 * 1000 // 같은 장소를 이 시간 안에 다시 기록하면 중복으로 본다

/**
 * 다녀온 뒤 기록. 괜찮았어요(-5) / 힘들었어요(+5), 범위 ±20.
 * 힘들었어요이면 그 시간대 상위 태그의 민감도를 한 단계(+0.5는 과하므로 0.5 단위 체계 안에서 1→1.5만) 올린다.
 * prev는 기록 직전의 장소 보정치와 태그 민감도, duplicate는 같은 장소를 3시간 안에 이미 기록했는지 여부다(기록은 그대로 더한다).
 */
export function recordVisit(
  place: string,
  ok: boolean,
  topTags: SenseTag[],
): { offsets: Record<string, number>; profile: ChildProfile; prev: VisitPrev; duplicate: boolean } {
  const offsets = loadOffsets()
  const cur = offsets[place] ?? 0
  const profile = loadProfile()
  const prev: VisitPrev = { offset: cur, tags: { ...profile.tags } }
  const log = loadLog()
  const duplicate = log.some((v) => v.place === place && Date.now() - Date.parse(v.ts) < DUPLICATE_MS)
  offsets[place] = Math.max(-20, Math.min(20, cur + (ok ? -5 : 5)))
  write(KEY_OFFSET, offsets)
  if (!ok) {
    for (const t of topTags.slice(0, 2)) {
      if (profile.tags[t] === 1) profile.tags[t] = 1.5
      else if (profile.tags[t] === 0.5) profile.tags[t] = 1
    }
    saveProfile(profile)
  }
  log.push({ place, ts: new Date().toISOString(), ok, topTags })
  write(KEY_LOG, log.slice(-200))
  return { offsets, profile, prev, duplicate }
}

/**
 * 방금 한 recordVisit을 되돌린다. 그 장소의 가장 최근 기록 한 건을 지우고, 장소 보정치와 그 기록이 올린 태그 민감도를 prev로 돌린다.
 * 지울 기록이 없으면(이미 되돌렸으면) 아무것도 바꾸지 않는다. 그동안 사용자가 직접 바꾼 다른 태그 민감도는 건드리지 않는다.
 */
export function undoVisit(place: string, prev: VisitPrev): { offsets: Record<string, number>; profile: ChildProfile } {
  const offsets = loadOffsets()
  const profile = loadProfile()
  const log = loadLog()
  let i = -1
  for (let k = log.length - 1; k >= 0; k--) {
    if (log[k].place === place) {
      i = k
      break
    }
  }
  if (i < 0) return { offsets, profile }
  const [entry] = log.splice(i, 1)
  write(KEY_LOG, log)
  if (prev.offset === 0) delete offsets[place]
  else offsets[place] = prev.offset
  write(KEY_OFFSET, offsets)
  if (!entry.ok) {
    for (const t of entry.topTags.slice(0, 2)) if (t in prev.tags) profile.tags[t] = prev.tags[t] as Sensitivity
    saveProfile(profile)
  }
  return { offsets, profile }
}

/**
 * 기록 목록에서 한 건을 지운다. 그 기록이 바꿨던 장소 보정치(±5)는 되돌리고(한도 ±20 안), 올려 둔 태그 민감도는 그대로 둔다.
 */
export function removeVisit(place: string, ts: string): Record<string, number> {
  const offsets = loadOffsets()
  const log = loadLog()
  const i = log.findIndex((v) => v.place === place && v.ts === ts)
  if (i < 0) return offsets
  const [entry] = log.splice(i, 1)
  write(KEY_LOG, log)
  const next = Math.max(-20, Math.min(20, (offsets[place] ?? 0) + (entry.ok ? 5 : -5)))
  if (next === 0) delete offsets[place]
  else offsets[place] = next
  write(KEY_OFFSET, offsets)
  return offsets
}

/** 이 기기에 저장한 프로필·보정치·기록·소리 측정 요약을 모두 지운다. */
export function clearAll() {
  for (const k of [KEY_PROFILE, KEY_OFFSET, KEY_LOG, KEY_SOUND]) localStorage.removeItem(k)
}
