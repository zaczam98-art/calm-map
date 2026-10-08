import type { SenseTag, Snapshot, SoundBucket } from '../types'
import { HAS_API } from './publicData'

const KEY_SOUND = 'calmmap.sound.v1'

export async function loadSnapshot(): Promise<Snapshot> {
  if (HAS_API) {
    try {
      const r = await fetch('/api/snapshot', { cache: 'no-store' })
      if (r.ok) {
        const s = (await r.json()) as Snapshot
        if (s && s.places && Object.keys(s.places).length > 0) return s
      }
    } catch {
      /* 서버가 없거나 키가 없으면 데모 스냅샷으로 */
    }
  }
  // Worker가 없는 정적 호스팅(GitHub Pages)에서는 data 브랜치의 공개 스냅샷을 직접 읽는다
  const pub = import.meta.env.VITE_PUBLIC_SNAPSHOT_URL as string | undefined
  if (pub) {
    try {
      const r = await fetch(pub, { cache: 'no-store' })
      if (r.ok) {
        const s = (await r.json()) as Snapshot
        if (s && s.places && Object.keys(s.places).length > 0) return s
      }
    } catch {
      /* 아래 데모로 */
    }
  }
  const r = await fetch(`${import.meta.env.BASE_URL}data/snapshot-demo.json`)
  const s = (await r.json()) as Snapshot
  s.source = 'demo'
  return s
}

/** 소리 버킷 키: 요일(0~6)-시(0~23) */
export function bucketKey(dow: number, hour: number) {
  return `${dow}-${hour}`
}

export type SoundStore = Record<string, Record<string, SoundBucket>> // place -> key -> bucket

function readLocal(): SoundStore {
  try {
    return JSON.parse(localStorage.getItem(KEY_SOUND) || '{}') as SoundStore
  } catch {
    return {}
  }
}

export function mergeBucket(a: SoundBucket | undefined, b: SoundBucket): SoundBucket {
  if (!a) return b
  const n = a.n + b.n
  const tags: Partial<Record<SenseTag, number>> = {}
  const keys = new Set([...Object.keys(a.tags), ...Object.keys(b.tags)]) as Set<SenseTag>
  for (const k of keys) {
    const av = a.tags[k] ?? 0
    const bv = b.tags[k] ?? 0
    tags[k] = (av * a.n + bv * b.n) / n
  }
  return { n, tags }
}

/** 서버 버킷 + 이 기기에서 측정한 버킷을 합친다. 서버가 없으면 로컬만 쓴다. */
export async function loadSoundStore(): Promise<SoundStore> {
  let server: SoundStore = {}
  if (HAS_API) {
    try {
      const r = await fetch('/api/sound', { cache: 'no-store' })
      if (r.ok) server = (await r.json()) as SoundStore
    } catch {
      /* 로컬만 */
    }
  }
  const local = readLocal()
  const out: SoundStore = { ...server }
  for (const place of Object.keys(local)) {
    out[place] = { ...(out[place] || {}) }
    for (const k of Object.keys(local[place])) out[place][k] = mergeBucket(out[place][k], local[place][k])
  }
  return out
}

/** 측정 세션 요약을 로컬에 누적하고 서버에도 보낸다(원음 없음). */
export async function submitMeasurement(place: string, bucket: SoundBucket, dow: number, hour: number): Promise<'server' | 'local'> {
  const local = readLocal()
  const k = bucketKey(dow, hour)
  local[place] = local[place] || {}
  local[place][k] = mergeBucket(local[place][k], bucket)
  try {
    localStorage.setItem(KEY_SOUND, JSON.stringify(local))
  } catch {
    /* 무시 */
  }
  if (!HAS_API) return 'local'
  try {
    const r = await fetch('/api/measure', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ place, dow, hour, n: bucket.n, tags: bucket.tags }),
    })
    if (r.ok) return 'server'
  } catch {
    /* 서버 없음 */
  }
  return 'local'
}
