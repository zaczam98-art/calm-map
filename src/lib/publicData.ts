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

/** 한국 시간 기준 오늘 날짜와 시(기기 시간대와 무관하게 계산) */
export function kstNow(now = Date.now()): { date: string; hour: number; dow: number } {
  const d = new Date(now + 9 * 3600 * 1000)
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours(), dow: d.getUTCDay() }
}
