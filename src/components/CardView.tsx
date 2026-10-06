import { useState } from 'react'
import { ICON_EMOJI, type CardIcon } from '../../shared/cardRules'
import type { Card } from '../types'

export default function CardView({ card, note, place }: { card: Card; note: string; place: string }) {
  const [big, setBig] = useState(false)
  return (
    <div className="card" aria-label="미리 보는 카드">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>{place} 미리 보기</h2>
        <button className="btn" onClick={() => setBig((b) => !b)}>{big ? '보통 글씨' : '아이용 큰 글씨'}</button>
      </div>
      <div className={`story ${big ? 'big' : ''}`}>
        {card.steps.map((s, i) => (
          <div className="step" key={i}>
            <span className="ico" aria-hidden>{ICON_EMOJI[s.icon as CardIcon] ?? '•'}</span>
            <span>{s.text}</span>
          </div>
        ))}
      </div>
      <p style={{ marginTop: 10 }}>🎒 준비물: {card.prep}</p>
      <p>💙 힘들면: {card.whenHard}</p>
      <p className="muted">{card.source === 'ai' ? 'AI가 검수 규칙(단계 3~5, 권고형, 금지어 없음)을 통과한 문장으로 만들었어요.' : note}</p>
    </div>
  )
}
