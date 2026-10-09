import { Component, type ReactNode } from 'react'

/** 지연 로딩 화면(현장 측정, 정보)을 받지 못했을 때 앱 전체가 아니라 그 화면만 오류 안내로 바꾸고 하단 탭은 살려 둔다. */
// React.lazy는 한 번 거절된 import()를 기억해서, 연결이 돌아와도 앱 안에서는 다시 받지 않는다. 주소의 #/measure, #/info는 새로고침 뒤에도 같은 탭으로 돌아온다.
const reload = () => location.reload()

export default class LazyBoundary extends Component<{ children: ReactNode; onBack: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    console.error(error)
  }
  componentDidUpdate(_: unknown, prev: { failed: boolean }) {
    // 오프라인에서 실패했다면 연결이 돌아오는 순간 다시 불러온다
    if (this.state.failed && !prev.failed) window.addEventListener('online', reload, { once: true })
  }
  componentWillUnmount() {
    window.removeEventListener('online', reload)
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="page" role="alert" style={{ textAlign: 'center', paddingTop: 48 }}>
        <p>이 화면을 불러오지 못했어요. 연결을 확인한 뒤 다시 불러와 주세요.</p>
        <button className="btn primary" onClick={reload}>
          다시 불러오기
        </button>{' '}
        <button className="btn" onClick={this.props.onBack}>
          지도로 돌아가기
        </button>
      </div>
    )
  }
}
