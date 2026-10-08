import { useEffect, useRef, useState } from 'react'
import { ICON_EMOJI, type CardIcon } from '../../shared/cardRules'
import type { Card } from '../types'

const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window

/** 목소리 목록이 잡혔는데 한국어가 하나도 없으면 읽어 주기를 숨긴다. 목록이 비어 있으면(아직 로딩 중이거나 알 수 없음) 보여 준다. */
function useKoreanVoice(): boolean {
  const [ok, setOk] = useState(true)
  useEffect(() => {
    if (!canSpeak) return
    const synth = window.speechSynthesis
    const check = () => {
      const voices = synth.getVoices()
      setOk(voices.length === 0 || voices.some((v) => v.lang.toLowerCase().startsWith('ko')))
    }
    check()
    synth.addEventListener?.('voiceschanged', check)
    return () => synth.removeEventListener?.('voiceschanged', check)
  }, [])
  return ok
}

export default function CardView({ card, note, place, focusToken }: { card: Card; note: string; place: string; focusToken: number }) {
  const [big, setBig] = useState(false)
  const [reading, setReading] = useState<number | null>(null)
  const token = useRef(0)
  const head = useRef<HTMLHeadingElement>(null)
  const hasVoice = useKoreanVoice()

  // 사용자가 카드 만들기를 눌러 카드가 만들어졌을 때만(focusToken이 바뀔 때만) 제목으로 포커스를 옮겨 스크린리더가 결과를 알린다.
  // 시각을 바꾸거나 프로필이 바뀌어 카드가 다시 조립될 때는 사용자가 누르던 곳에 포커스를 둔다.
  useEffect(() => {
    head.current?.focus()
  }, [focusToken])
  // 카드가 바뀌거나 사라지면 읽기를 멈춘다
  useEffect(() => {
    return () => {
      token.current++
      if (canSpeak) window.speechSynthesis.cancel()
      setReading(null)
    }
  }, [card])

  const read = () => {
    const synth = window.speechSynthesis
    if (reading !== null) {
      token.current++
      synth.cancel()
      setReading(null)
      return
    }
    const mine = ++token.current
    if (synth.speaking || synth.pending) synth.cancel()
    const say = (i: number) => {
      if (mine !== token.current) return
      if (i >= card.steps.length) {
        setReading(null)
        return
      }
      setReading(i)
      const u = new SpeechSynthesisUtterance(card.steps[i].text)
      u.lang = 'ko-KR'
      u.rate = 0.85
      u.onend = () => say(i + 1)
      u.onerror = () => {
        if (mine === token.current) setReading(null)
      }
      synth.speak(u)
    }
    say(0)
  }

  return (
    <section className="card" aria-label="미리 보는 카드">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 ref={head} tabIndex={-1}>{place} 미리 보기</h3>
        <div className="row">
          {canSpeak && hasVoice && <button className="btn" onClick={read}>{reading !== null ? '읽기 멈추기' : '읽어 주기'}</button>}
          <button className="btn" onClick={() => setBig((b) => !b)} aria-pressed={big}>아이용 큰 글씨</button>
        </div>
      </div>
      <ol className={`story ${big ? 'big' : ''}`}>
        {card.steps.map((s, i) => (
          <li className={`step${reading === i ? ' speaking' : ''}`} key={i} aria-current={reading === i ? 'step' : undefined}>
            <span className="ico" aria-hidden>{ICON_EMOJI[s.icon as CardIcon] ?? '•'}</span>
            <span>{s.text}</span>
          </li>
        ))}
      </ol>
      <p style={{ marginTop: 10 }}><span aria-hidden>🎒</span> 준비물: {card.prep}</p>
      <p><span aria-hidden>💙</span> 힘들면: {card.whenHard}</p>
      <p className="muted">{card.source === 'ai' ? 'AI가 검수 규칙(단계 3~5, 권고형, 금지어 없음)을 통과한 문장으로 만들었어요.' : note}</p>
    </section>
  )
}
