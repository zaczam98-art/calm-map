import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { flushSync } from 'react-dom'
import '../styles/motion.css'

/** 사용자가 운영체제에서 '동작 줄이기'를 켰는지. 켜져 있으면 JS로 만드는 움직임도 모두 건너뛴다(CSS 쪽은 styles.css가 끈다). */
export function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

let seq = 0

/**
 * 화면 상태를 바꾸는 update를 View Transition으로 감싼다. update 안의 상태 변경은 flushSync로 그 자리에서 화면에 반영한다.
 * 추천 카드에서 장소 시트를 여는 전환에만 쓴다(누른 카드의 장소명과 지수가 시트 머리로 이어진다). html의 data-vt='place'는 CSS가 읽는 표시다.
 * 메뉴 이동은 전환 중에 누르기가 막히지 않도록 View Transition 대신 main의 CSS 페이드를 쓴다.
 * 옛 화면을 찍고 나서 update를 부르기까지 사이에 사용자가 다른 화면으로 옮겨 갔을 수 있다. 그때는 isCurrent가 false를 돌려주므로 update 없이 마지막 동작을 따른다.
 * startViewTransition이 없거나 동작 줄이기가 켜져 있으면 update를 바로 실행한다.
 */
export function withViewTransition(isCurrent: () => boolean, update: () => void): void {
  if (typeof document.startViewTransition !== 'function' || reducedMotion()) {
    untagCard()
    update()
    return
  }
  const root = document.documentElement
  const id = ++seq
  const vt = document.startViewTransition(() => {
    untagCard() // 옛 화면은 이름이 붙은 채로 찍혔으므로, 새 화면에서는 카드의 이름을 떼어 시트 머리와 겹치지 않게 한다
    if (!isCurrent()) return
    root.dataset.vt = 'place' // 시트 머리의 이름은 카드의 이름을 뗀 뒤 새 화면을 그리는 이 순간에만 켠다. 그 전에 켜 두면 같은 장소의 시트와 카드가 같은 이름을 가질 수 있다.
    flushSync(update)
  })
  const done = () => {
    if (id === seq) delete root.dataset.vt // 더 나중에 시작한 전환이 있으면 그 전환의 표시를 지우지 않는다
  }
  // 건너뛴 전환의 거부(ready, finished)는 update가 이미 실행됐으므로 오류로 남기지 않는다
  vt.ready.catch(() => {})
  vt.updateCallbackDone.catch(() => {})
  vt.finished.then(done, done)
}

const vtName = (index: number, part: 'name' | 'score') => `place-${index}-${part}`

/** 시트 머리의 장소명과 지수에 붙이는 view-transition-name. 추천 카드가 같은 이름을 쓰면 한 요소처럼 이어진다(motion.css는 이 이름을 전환 중에만 살려 둔다). */
export function placeVt(index: number, part: 'name' | 'score'): CSSProperties | undefined {
  return index < 0 ? undefined : { viewTransitionName: vtName(index, part) }
}

let tagged: HTMLElement[] = []

/**
 * 누른 추천 카드의 장소명과 지수에만 같은 이름을 붙인다. 목록 전체에 늘 붙여 두면 장소 120여 곳이 모두 따로 찍혀 느려지고, 시트 위로 목록 글자가 겹쳐 그려진다.
 * 이름을 붙인 요소는 상자로 찍히므로 줄 안에 흐르는 장소명은 이 순간에만 inline-block으로 바꾼다(항상 바꿔 두면 긴 이름 옆의 분류 글자가 새 줄로 밀린다).
 * 여러 줄로 꺾인 이름은 inline-block이 되면 뒤따르는 분류 글자가 새 줄로 밀려 카드 높이가 바뀌므로, 한 줄인 이름만 이어 준다(꺾인 이름은 시트 쪽에서 나타나기만 한다).
 */
export function tagCard(card: Element, index: number): void {
  untagCard()
  const parts: [string, 'name' | 'score'][] = [['.rec-main b', 'name'], ['.rec-index', 'score']]
  for (const [selector, part] of parts) {
    const el = card.querySelector<HTMLElement>(selector)
    if (!el || index < 0) continue
    if (part === 'name') {
      if (el.getClientRects().length > 1) continue
      el.style.display = 'inline-block'
    }
    el.style.setProperty('view-transition-name', vtName(index, part))
    tagged.push(el)
  }
}

function untagCard(): void {
  for (const el of tagged) {
    el.style.removeProperty('view-transition-name')
    el.style.removeProperty('display')
  }
  tagged = []
}

/** value가 바뀔 때마다 1씩 오르는 번호(처음에는 0). 요소의 key로 쓰면 값이 바뀔 때 그 요소를 새로 그려서 CSS 애니메이션이 한 번 돈다. */
export function useChangeTick(value: unknown): number {
  const [seen, setSeen] = useState(value)
  const [tick, setTick] = useState(0)
  if (!Object.is(seen, value)) {
    setSeen(value)
    setTick(tick + 1)
  }
  return tick
}

/**
 * 같은 대상의 숫자가 바뀌면 보이는 값이 이전 값에서 새 값까지 ms 동안 세어 간다. 첫 값, 값이 없는 경우, 동작 줄이기에서는 바로 새 값을 돌려준다.
 * 대상 자체가 바뀐 경우(다른 시각을 고름)는 세지 않도록 대상을 가리는 key를 함께 받아, key가 바뀌면 새 값을 바로 보인다.
 */
export function useCountUp(target: number | null, key: string | number, ms = 300): number | null {
  const [tween, setTween] = useState<number | null>(null)
  const shown = useRef(target) // 지금 화면에 보이는 값(세는 도중에 목표가 또 바뀌면 여기서 이어 간다)
  const keyRef = useRef(key)
  // 화면을 그리기 전에 시작해야 새 값이 한 프레임 먼저 보였다가 이전 값으로 돌아가지 않는다
  useLayoutEffect(() => {
    if (keyRef.current !== key) {
      keyRef.current = key
      shown.current = target
    }
    const from = shown.current
    if (target === null || from === null || from === target || reducedMotion()) {
      shown.current = target
      setTween(null)
      return
    }
    const t0 = performance.now()
    let raf = 0
    const step = () => {
      const p = Math.min(1, Math.max(0, (performance.now() - t0) / ms)) // rAF가 넘기는 프레임 시각은 t0보다 이를 수 있어 쓰지 않는다(음수가 되면 이전 값보다 작게 센다)
      const v = p >= 1 ? target : Math.round(from + (target - from) * (1 - (1 - p) ** 2))
      shown.current = v
      setTween(p >= 1 ? null : v)
      if (p < 1) raf = requestAnimationFrame(step)
    }
    setTween(from)
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, key, ms])
  return tween ?? target
}
