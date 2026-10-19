import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

// 외출 계획은 전체 화면 대화상자이고 새 해시 주소를 만들지 않는다. 열 때 같은 주소로 기록을 한 칸 쌓아, 브라우저 뒤로 가기가 장소 시트가 아니라 계획만 닫게 한다.
// 표지는 불리언이 아니라 열 때마다 새로 만드는 번호다. 불리언이면 뒤로-앞으로-다시 열기-뒤로 순서에서 죽은 칸과 구분하지 못해 계획이 닫히지 않는다.
let seq = Math.floor(performance.timeOrigin) // 새로고침 뒤에도 history.state에 남은 이전 표지와 겹치지 않게 불러온 시각에서 시작한다
const markOf = (s: unknown): number | null => {
  if (typeof s !== 'object' || s === null) return null
  const v = (s as { plan?: unknown }).plan
  return typeof v === 'number' ? v : null
}

export function usePlanOverlay(openerRef: RefObject<HTMLElement | null>) {
  const [open, setOpen] = useState(false)
  const mark = useRef<number | null>(null) // 열린 계획이 쌓은 칸의 표지. null이면 쌓은 칸이 없다
  const after = useRef<(() => void) | null>(null)
  const refocus = useRef(false)

  useEffect(() => {
    const onPop = () => {
      if (mark.current === null) return
      if (markOf(history.state) === mark.current) return // 계획 위에 쌓인 칸(한 단계씩 보기)이 닫히는 중
      mark.current = null
      const next = after.current
      after.current = null
      refocus.current = !next
      setOpen(false)
      next?.()
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // 닫힘이 화면에 반영된 뒤에 포커스를 돌려준다
  useEffect(() => {
    if (!open && refocus.current) {
      refocus.current = false
      openerRef.current?.focus()
    }
  }, [open, openerRef])

  const openPlan = useCallback(() => {
    if (mark.current !== null) return
    const id = ++seq
    try {
      history.pushState({ ...(history.state as object | null), plan: id }, '')
      mark.current = id
    } catch {
      /* 기록을 쌓을 수 없으면 닫기 단추와 Esc로만 닫는다 */
    }
    setOpen(true)
  }, [])

  const closePlan = useCallback(() => {
    refocus.current = true
    setOpen(false)
    if (mark.current !== null) {
      mark.current = null
      try {
        history.back()
      } catch {
        /* 화면은 이미 닫혔다 */
      }
    }
  }, [])

  // 다른 장소 시트를 열기 전에 계획이 쌓은 칸을 먼저 되돌린다
  const leaveThen = useCallback((fn: () => void) => {
    if (mark.current === null) {
      setOpen(false)
      fn()
      return
    }
    after.current = fn
    history.back()
  }, [])

  return { open, openPlan, closePlan, leaveThen }
}
