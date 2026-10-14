import { hasSavedProfile } from './profile'

/** 칩 질문 시트를 닫은 기록. 이 기록이 있으면 이미 쓰던 사용자로 본다. */
export const INTRO_KEY = 'calmmap.intro.v1'
/** 랜딩을 자동으로 띄운 횟수('1', '2')나 진입 단추를 누른 기록('done') */
export const LANDING_KEY = 'calmmap.landing.v1'
/** 이 탭 세션에서 이미 횟수를 올렸는지(sessionStorage). 새로고침해도 횟수를 다시 올리지 않게 한다. */
const SEEN_KEY = 'calmmap.landing.seen'
const MAX_AUTO = 2

/** 주소에 해시가 없는 첫 진입인지('', '#', '#/'). 공유 링크와 직접 주소는 건너뛴다. */
export function isBlankHash(): boolean {
  return location.hash === '' || location.hash === '#' || location.hash === '#/'
}

/**
 * 첫 방문 랜딩을 자동으로 띄울지. 최초 로드 때 한 번만 부른다.
 * 저장소를 읽거나 쓸 수 없으면 새로고침마다 뜨지 않도록 띄우지 않는다.
 */
export function shouldAutoShowLanding(): boolean {
  if (!isBlankHash()) return false
  try {
    if (new URLSearchParams(location.search).get('intro') === '0') return false // 캡처와 영상용
    if (localStorage.getItem(INTRO_KEY) !== null || hasSavedProfile()) return false
    const done = localStorage.getItem(LANDING_KEY)
    if (done === 'done') return false
    // 같은 탭 세션에서는 횟수를 올리지 않고 그대로 보여 준다(새로고침, StrictMode의 초기화 두 번 호출)
    if (sessionStorage.getItem(SEEN_KEY) === '1') return true
    const shown = done === null ? 0 : Number(done)
    if (!Number.isInteger(shown) || shown >= MAX_AUTO) return false
    const next = String(shown + 1)
    localStorage.setItem(LANDING_KEY, next)
    if (localStorage.getItem(LANDING_KEY) !== next) return false // 쓰기가 막힌 환경
    try {
      sessionStorage.setItem(SEEN_KEY, '1')
    } catch {
      // 탭 표시를 남기지 못하면 랜딩을 띄우지 않으므로, 보이지 않은 횟수가 소진되지 않게 올린 값을 되돌린다
      if (done === null) localStorage.removeItem(LANDING_KEY)
      else localStorage.setItem(LANDING_KEY, done)
      return false
    }
    return true
  } catch {
    return false
  }
}

/** 랜딩의 진입 단추를 눌렀다는 기록. 이 뒤로는 자동으로 띄우지 않는다. */
export function markLandingDone() {
  try {
    localStorage.setItem(LANDING_KEY, 'done')
  } catch {
    /* 저장할 수 없는 환경에서는 이번 방문에서만 넘어간다 */
  }
}

/** 이 기기에 저장된 아이 설정이 있는지. 저장소를 읽을 수 없으면 없는 것으로 본다(칩 질문으로 안내한다). */
export function hasStoredProfile(): boolean {
  try {
    localStorage.getItem(LANDING_KEY)
  } catch {
    return false
  }
  return hasSavedProfile()
}
