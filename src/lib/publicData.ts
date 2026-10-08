/**
 * data 브랜치에 공개된 파일(pattern.json, metrics.json, briefing.json)을 읽는다.
 * 공개 스냅샷 주소가 설정된 배포(GitHub Pages)에서만 값이 있고, 없으면 null을 돌려 화면에서 해당 영역을 숨긴다.
 */
export function publicDataUrl(file: string): string | null {
  const pub = import.meta.env.VITE_PUBLIC_SNAPSHOT_URL as string | undefined
  return pub ? pub.replace(/snapshot\.json$/, file) : null
}

/** 응답이 없는 망에서 화면이 오래 멈추지 않게 하는 제한 시간(snapshot.ts와 같은 값) */
const TIMEOUT_MS = 8000

/** AbortSignal.timeout이 없는 브라우저(iOS 15 Safari 등)에서도 동작하는 제한 시간 신호 */
export function timeoutSignal(ms: number): AbortSignal | undefined {
  if (typeof AbortSignal === 'undefined') return undefined
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms)
  const c = new AbortController()
  setTimeout(() => c.abort(), ms)
  return c.signal
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: 'no-store', signal: timeoutSignal(TIMEOUT_MS) })
    return r.ok ? ((await r.json()) as T) : null
  } catch {
    return null
  }
}

/**
 * raw 주소가 실패하면(네트워크 오류, 4xx/5xx, 8초 초과, 본문이 JSON이 아님) 한 번만 같은 출처의 Pages 사본(data-mirror/)으로 다시 받는다.
 * 사본은 마지막 배포 시점의 자료라서 묵을 수 있으므로 실패했을 때만 쓰고, 화면의 갱신 시각 경과 경고는 그대로 작동한다.
 */
export async function loadPublicJson<T>(file: string): Promise<T | null> {
  const url = publicDataUrl(file)
  if (!url) return null
  const live = await fetchJson<T>(url)
  if (live) return live
  const mirror = await fetchJson<T>(`${import.meta.env.BASE_URL}data-mirror/${file}`)
  if (mirror) console.warn(`[calm-map] ${file}: raw 주소 실패, Pages 사본으로 대체`)
  return mirror
}

/**
 * 받는 서버(/api)가 있는 배포인지. 공개 스냅샷 주소로 동작하는 정적 배포(GitHub Pages)에는 서버가 없으므로
 * 그런 배포에서는 /api 요청을 아예 보내지 않는다(맞춤 요인이나 측정값이 요청 본문으로 기기를 떠나지 않게 한다).
 */
export const HAS_API = !import.meta.env.VITE_PUBLIC_SNAPSHOT_URL

/** 한국 시간 기준 오늘 날짜와 시(기기 시간대와 무관하게 계산) */
export function kstNow(now = Date.now()): { date: string; hour: number; dow: number } {
  const d = new Date(now + 9 * 3600 * 1000)
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours(), dow: d.getUTCDay() }
}
