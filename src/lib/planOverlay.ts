import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

// 외출 계획은 전체 화면 대화상자이고 새 해시 주소를 만들지 않는다. 열 때 같은 주소로 기록을 한 칸 쌓아, 브라우저 뒤로 가기가 장소 시트가 아니라 계획만 닫게 한다.
// 표지는 불리언이 아니라 열 때마다 새로 만드는 번호다. 불리언이면 뒤로-앞으로-다시 열기-뒤로 순서에서 죽은 칸과 구분하지 못해 계획이 닫히지 않는다.
let seq = Math.floor(performance.timeOrigin) // 새로고침 뒤에도 history.state에 남은 이전 표지와 겹치지 않게 불러온 시각에서 시작한다
const markOf = (s: unknown): number | null => {
  if (typeof s !== 'object' || s === null) return null
  const v = (s as { plan?: unknown }).plan
  return typeof v === 'number' ? v : null
}
// 대안 시트를 열려고 계획을 떠날 때는 계획의 칸을 되돌리지 않고 단계 번호(planStep)만 남긴다. 대안 시트에서 뒤로 가면 이 칸에 닿고, 그때 한 번만 계획을 그 단계에서 다시 연다.
const stepOf = (s: unknown): number | null => {
  if (typeof s !== 'object' || s === null) return null
  const v = (s as { planStep?: unknown }).planStep
  return typeof v === 'number' ? v : null
}

export interface PlanResume {
  id: number
  step: number
}

/** 지금 기록 칸이 name 장소의 계획이 대안 단계로 떠난 칸이면 그 표지와 단계를 돌려준다. 아니면 null. 장소는 주소로 가른다(주소로 처음 연 칸은 state에 장소가 없다). */
export function planResume(name: string): PlanResume | null {
  const id = markOf(history.state)
  const step = stepOf(history.state)
  if (id === null || step === null) return null
  try {
    return decodeURIComponent(location.hash) === `#/place/${name}` ? { id, step } : null
  } catch {
    return null
  }
}

/**
 * startOpen이 참이면 첫 화면부터 열린 채로 시작한다(추천 카드의 '외출 계획 세우기'로 시트와 함께 열 때, 시트가 먼저 비치지 않게 한다). 기록 칸은 마운트 효과가 쌓는다.
 * resume이 있으면(대안 시트에서 뒤로 돌아옴) 새 칸을 쌓지 않고 돌아온 칸을 계획의 칸으로 이어 쓴다.
 */
export function usePlanOverlay(openerRef: RefObject<HTMLElement | null>, startOpen = false, resume: PlanResume | null = null) {
  const [open, setOpen] = useState(startOpen)
  const mark = useRef<number | null>(null) // 열린 계획이 쌓은 칸의 표지. null이면 쌓은 칸이 없다
  const refocus = useRef(false)

  useEffect(() => {
    const onPop = () => {
      if (mark.current === null) return
      if (markOf(history.state) === mark.current) return // 계획 위에 쌓인 칸(한 단계씩 보기)이 닫히는 중
      mark.current = null
      refocus.current = true
      setOpen(false)
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

  useEffect(() => {
    if (resume) {
      mark.current = resume.id
      try {
        const next = { ...(history.state as Record<string, unknown>) }
        delete next.planStep // 돌아올 때 한 번만 쓰는 표지라서 지운다
        history.replaceState(next, '')
      } catch {
        /* 표지를 지우지 못해도 계획은 열린 채로 쓸 수 있다 */
      }
    } else if (startOpen) openPlan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 대안 장소의 시트를 열기 전에 이 계획의 칸에 단계 번호를 남긴다. 칸은 되돌리지 않으므로 대안 시트에서 뒤로 가면 이 칸으로 돌아와 계획이 그 단계에서 다시 열린다.
  const leaveTo = useCallback((step: number, fn: () => void) => {
    if (mark.current !== null && markOf(history.state) === mark.current) {
      try {
        history.replaceState({ ...(history.state as object | null), planStep: step }, '')
      } catch {
        /* 표지를 남기지 못하면 뒤로 가기는 계획 없이 장소 시트로 돌아온다 */
      }
    }
    fn()
  }, [])

  return { open, openPlan, closePlan, leaveTo }
}
