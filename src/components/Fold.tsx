import type { ReactNode, Ref } from 'react'
import '../styles/compact.css'

interface Props {
  /** 요약 줄의 제목. 펼쳐지는 내용의 이름이다 */
  title: string
  /** 제목의 수준. 기본은 h3이고, h3 카드 안에 놓는 접이식은 4를 준다 */
  level?: 3 | 4
  /** 요약 줄 아래의 한 줄 요약. 펼치지 않아도 핵심을 알 수 있게 쓴다 */
  brief?: string | null
  className?: string
  /** 코드에서 펼칠 때 쓰는 details 참조(무던한 곳 요약 단추) */
  foldRef?: Ref<HTMLDetailsElement>
  /** 주면 제목이 포커스를 받을 수 있게(tabIndex -1) 한다 */
  headingRef?: Ref<HTMLHeadingElement>
  /** 열림 상태가 바뀔 때(요약 단추의 aria-expanded를 맞추는 데 쓴다) */
  onToggle?: (open: boolean) => void
  children: ReactNode
}

/**
 * 장소 시트의 접이식. 처음에는 항상 접혀 있고 열림 상태를 저장하지 않는다(details의 열림은 DOM에만 있고, 장소를 바꾸면 시트가 새로 만들어진다).
 * 요약 줄은 44px 이상이며, 제목 아래에 한 줄 요약을 둘 수 있다.
 */
export default function Fold({ title, level = 3, brief, className, foldRef, headingRef, onToggle, children }: Props) {
  const Heading = level === 4 ? 'h4' : 'h3'
  return (
    <details className={className ? `fold ${className}` : 'fold'} ref={foldRef} onToggle={onToggle ? (e) => onToggle(e.currentTarget.open) : undefined}>
      <summary>
        <Heading className="fold-t" ref={headingRef} tabIndex={headingRef ? -1 : undefined}>{title}</Heading>
        {brief && <span className="fold-b">{brief}</span>}
      </summary>
      <div className="fold-body">{children}</div>
    </details>
  )
}
