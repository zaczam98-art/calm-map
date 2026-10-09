const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'

function cho(ch: string): string {
  const c = ch.charCodeAt(0)
  return c >= 0xac00 && c <= 0xd7a3 ? CHO[Math.floor((c - 0xac00) / 588)] : ch
}

/** 한글 음절은 초성 자모로, 그 밖의 글자는 그대로 바꾼다. 예: '홍대입구역(2호선)' → 'ㅎㄷㅇㄱㅇ(2ㅎㅅ)' */
export function choseong(str: string): string {
  return Array.from(str.normalize('NFC'), cho).join('')
}

/** 이름에 괄호나 가운뎃점이 끼어 있어 그대로는 찾아지지 않는 부름말. 장소 이름의 글자에서 곧바로 나오는 것만 둔다. */
export const ALIASES: Record<string, string[]> = {
  'DDP(동대문디자인플라자)': ['디디피'],
  'DMC(디지털미디어시티)': ['디엠씨'],
  '광장(전통)시장': ['광장시장'],
  '신촌·이대역': ['신촌역'],
  '총신대입구(이수)역': ['총신대입구역', '이수역'],
}

/** 장소 이름이나 부름말 중 하나라도 검색어와 일치하면 true. */
export function matchesPlace(name: string, query: string): boolean {
  return [name, ...(ALIASES[name] ?? [])].some((f) => matches(f, query))
}

const norm = (s: string) => s.normalize('NFC').replace(/\s+/g, '').toLowerCase()

/**
 * 이름 검색. 공백은 무시하고, 검색어가 이름의 일부이면 일치한다.
 * 검색어의 초성 자모(ㄱ~ㅎ)는 이름 글자의 초성과 비교하므로 'ㅎㄷ'이나 '어린이ㄷ'처럼 섞어 써도 된다.
 */
export function matches(name: string, query: string): boolean {
  const q = Array.from(norm(query))
  if (q.length === 0) return true
  const n = Array.from(norm(name))
  const nc = n.map(cho)
  for (let i = 0; i + q.length <= n.length; i++) {
    if (q.every((ch, j) => ch === n[i + j] || (CHO.includes(ch) && ch === nc[i + j]))) return true
  }
  return false
}
