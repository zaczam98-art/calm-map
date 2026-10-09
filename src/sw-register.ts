/** 앱 화면 파일을 기기에 캐시하는 서비스 워커를 등록한다. 배포본에서만 켜고, 새 버전은 안내 없이 다음 방문부터 쓴다. */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  const register = () => {
    // 첫 화면을 받는 동안 미리 받기와 겹치지 않도록 load 뒤에 등록한다
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((e) => console.warn('서비스 워커를 등록하지 못했어요', e))
  }
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
}
