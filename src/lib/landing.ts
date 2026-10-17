import { hasSavedProfile } from './profile'

/** 칩 질문 시트를 닫은 기록 */
export const INTRO_KEY = 'calmmap.intro.v1'
/** 랜딩의 진입 단추를 누른 기록('done'). 자동 표시 판정에는 쓰지 않는다. */
export const LANDING_KEY = 'calmmap.landing.v1'

/** 주소에 해시가 없는 진입인지('', '#', '#/'). 공유 링크와 직접 주소는 건너뛴다. */
export function isBlankHash(): boolean {
  return location.hash === '' || location.hash === '#' || location.hash === '#/'
}

/**
 * 주소만 열었을 때(해시 없음) 소개 화면을 띄울지. 최초 로드 때 한 번만 부른다.
 * 처음이든 다시 온 사람이든 주소로 들어오면 항상 소개 화면부터 보여 준다(2026-10-17 사용자 결정).
 * 공유 링크(#/place/...)와 다른 화면 주소는 그 화면으로 바로 가고, ?intro=0은 캡처와 영상용으로 건너뛴다.
 */
export function shouldAutoShowLanding(): boolean {
  if (!isBlankHash()) return false
  try {
    return new URLSearchParams(location.search).get('intro') !== '0'
  } catch {
    return true
  }
}

/** 랜딩의 진입 단추를 눌렀다는 기록 */
export function markLandingDone() {
  try {
    localStorage.setItem(LANDING_KEY, 'done')
  } catch {
    /* 저장할 수 없는 환경에서는 기록만 남기지 않는다 */
  }
}

/** 이 기기에 저장된 아이 맞춤이 있는지. 저장소를 읽을 수 없으면 없는 것으로 본다(칩 질문으로 안내한다). */
export function hasStoredProfile(): boolean {
  try {
    localStorage.getItem(LANDING_KEY)
  } catch {
    return false
  }
  return hasSavedProfile()
}
