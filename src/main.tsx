import React from 'react'
import { createRoot } from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import App from './App'
import './styles.css'

/** 화면을 그리다 오류가 나면 빈 화면 대신 새로고침을 안내한다. */
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    console.error(error)
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="page" role="alert" style={{ textAlign: 'center', paddingTop: 48 }}>
        <p>문제가 생겼어요. 새로고침해 주세요</p>
        <button className="btn" onClick={() => location.reload()}>
          새로고침
        </button>
      </div>
    )
  }
}

const CHUNK_FLAG = 'calmmap.chunkReload'

/** 새 배포로 옛 JS 파일 이름이 사라졌을 때 한 번만 새로고침한다. 플래그가 남아 있으면 반복하지 않는다. */
function reloadOnce() {
  // 오프라인이면 새로고침해도 브라우저 오류 화면만 나오므로 LazyBoundary의 안내에 맡긴다
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  try {
    if (sessionStorage.getItem(CHUNK_FLAG)) return
    sessionStorage.setItem(CHUNK_FLAG, '1')
  } catch {
    return
  }
  location.reload()
}

// vite:preloadError는 지연 로딩 파일을 받지 못했다는 뜻이라 메시지를 따지지 않는다
window.addEventListener('vite:preloadError', reloadOnce)
window.addEventListener('unhandledrejection', (e) => {
  const msg = String((e.reason as Error | undefined)?.message ?? e.reason ?? '')
  if (msg.includes('Failed to fetch dynamically imported module') || msg.includes('ChunkLoadError')) reloadOnce()
})

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)

// 첫 렌더 뒤 5초 동안 오류가 없으면 다음 배포에서 다시 한 번 새로고침할 수 있게 플래그를 지운다
window.setTimeout(() => {
  try {
    sessionStorage.removeItem(CHUNK_FLAG)
  } catch {
    /* 저장소를 못 쓰면 지울 것도 없다 */
  }
}, 5000)
