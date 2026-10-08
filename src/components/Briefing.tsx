import { useState } from 'react'
import type { Briefing as BriefingData } from '../types'
import { kstNow } from '../lib/publicData'

/** 오늘의 브리핑. 오늘 날짜의 것만, 아직 지나지 않은 시간대만 보여 준다. */
export default function Briefing({ briefing, known, onSelect }: { briefing: BriefingData | null; known: Set<string>; onSelect: (name: string) => void }) {
  const [open, setOpen] = useState(true)
  if (!briefing) return null
  const now = kstNow()
  if (briefing.date !== now.date) return null
  const picks = briefing.picks.filter((p) => p.to > now.hour && known.has(p.place))
  if (picks.length === 0) return null
  const avoid = briefing.avoid.filter((p) => p.to > now.hour && known.has(p.place))
  const range = (from: number, to: number) => `${Math.max(from, now.hour)}~${to}시`
  return (
    <aside className="briefing" aria-label="오늘의 브리핑">
      <button className="briefing-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <b>오늘의 브리핑</b>
        <span className="muted">{open ? '접기' : '펼치기'}</span>
      </button>
      {open && (
        <>
          <p className="briefing-headline">{briefing.headline}</p>
          <ul className="briefing-picks">
            {picks.map((p) => (
              <li key={p.place}>
                <button onClick={() => onSelect(p.place)}>
                  <b>{p.place}</b> <span className="muted">{range(p.from, p.to)}</span>
                  <br />
                  <span>{p.reason}</span>
                </button>
              </li>
            ))}
          </ul>
          {avoid.length > 0 && (
            <p className="muted">붐비는 편: {avoid.map((a) => `${a.place}(${range(a.from, a.to)})`).join(', ')}</p>
          )}
          <p className="muted">{briefing.tip}</p>
          <p className="briefing-src">
            {briefing.source === 'ai' ? 'AI가 쓴 문장이에요. 장소와 시간대는 혼잡도 예측과 대조했고, 문장은 길이·어미·금지 표현을 검사했어요.' : '혼잡도 예측에서 규칙으로 만든 문장이에요.'}
            {' '}{briefing.generatedAt.slice(11)} 작성
          </p>
        </>
      )}
    </aside>
  )
}
