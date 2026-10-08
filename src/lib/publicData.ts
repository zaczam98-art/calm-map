/**
 * data 브랜치에 공개된 파일(pattern.json, metrics.json, briefing.json)을 읽는다.
 * 공개 스냅샷 주소가 설정된 배포(GitHub Pages)에서만 값이 있고, 없으면 null을 돌려 화면에서 해당 영역을 숨긴다.
 */
export function publicDataUrl(file: string): string | null {
  const pub = import.meta.env.VITE_PUBLIC_SNAPSHOT_URL as string | undefined
  return pub ? pub.replace(/snapshot\.json$/, file) : null
}

export async function loadPublicJson<T>(file: string): Promise<T | null> {
  const url = publicDataUrl(file)
  if (!url) return null
  try {
    const r = await fetch(url, { cache: 'no-store' })
    return r.ok ? ((await r.json()) as T) : null
  } catch {
    return null
  }
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
