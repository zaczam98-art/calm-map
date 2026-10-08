import { Component, type ReactNode } from 'react'

/** 지연 로딩 화면(현장 측정, 정보)을 받지 못했을 때 앱 전체가 아니라 그 화면만 오류 안내로 바꾸고 하단 탭은 살려 둔다. */
export default class LazyBoundary extends Component<{ children: ReactNode; onBack: () => void }, { failed: boolean }> {
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
        <p>이 화면을 불러오지 못했어요.</p>
        <button className="btn" onClick={this.props.onBack}>
          지도로 돌아가기
        </button>
      </div>
    )
  }
}
