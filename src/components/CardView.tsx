import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { ICON_EMOJI, type CardIcon } from '../../shared/cardRules'
import type { Card } from '../types'
import '../styles/card.css'

const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window

/** 한 단계씩 보기의 화면 하나. 단계 뒤에 '힘들 때' 문장이 마지막 화면으로 붙는다. */
function stepPage(card: Card, i: number): { icon: string; text: string; cap: string } {
  if (i < card.steps.length) {
    const s = card.steps[i]
    return { icon: ICON_EMOJI[s.icon as CardIcon] ?? '•', text: s.text, cap: `${i + 1} / ${card.steps.length}단계` }
  }
  return { icon: '💙', text: card.whenHard, cap: '힘들 때' }
}

function speakText(text: string) {
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'ko-KR'
  u.rate = 0.85
  window.speechSynthesis.speak(u)
}

interface StepDialogProps {
  card: Card
  place: string
  index: number
  voice: boolean
  autoRead: boolean
  onGo: (i: number) => void
  onClose: () => void
  onAutoRead: () => void
  onReplay: () => void
}

/** 전체 화면 한 단계씩 보기. 열리면 닫기 버튼으로 포커스를 옮기고, 화면 안에서만 Tab이 돈다. */
export function StepDialog({ card, place, index, voice, autoRead, onGo, onClose, onAutoRead, onReplay }: StepDialogProps) {
  const box = useRef<HTMLDivElement>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)
  const last = card.steps.length
  const i = Math.min(Math.max(index, 0), last)
  const page = stepPage(card, i)

  useEffect(() => {
    closeBtn.current?.focus()
  }, [])

  const go = (d: number) => {
    const n = i + d
    if (n >= 0 && n <= last) onGo(n)
  }
  // React 이벤트로 받아야 포털 밖의 장소 시트가 같은 Esc로 함께 닫히지 않게 막을 수 있다
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
    } else if (e.key === 'ArrowLeft') {
      go(-1)
    } else if (e.key === 'ArrowRight') {
      go(1)
    } else if (e.key === 'Tab' && box.current) {
      const items = [...box.current.querySelectorAll<HTMLElement>('button')]
      const first = items[0]
      const end = items[items.length - 1]
      const active = document.activeElement
      if (!box.current.contains(active) || (e.shiftKey && (active === first || active === box.current))) {
        e.preventDefault()
        ;(e.shiftKey ? end : first).focus()
      } else if (!e.shiftKey && active === end) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  return (
    <div className="cs-back" role="dialog" aria-modal="true" aria-label={`${place} 한 단계씩 보기`} tabIndex={-1} ref={box} onKeyDown={onKeyDown}>
      <div className="cs-top">
        <button className="btn" onClick={onClose} ref={closeBtn}>닫기</button>
      </div>
      <div className={`cs-stage${i === last ? ' last' : ''}`} aria-live="polite" aria-atomic="true">
        <p className="cs-cap">{page.cap}</p>
        <span className="cs-ico" aria-hidden>{page.icon}</span>
        <p className="cs-text">{page.text}</p>
      </div>
      <ol className="cs-dots" aria-label="진행 상황">
        {Array.from({ length: last + 1 }, (_, n) => (
          <li key={n} className={`${n === last ? 'last ' : ''}${n < i ? 'done' : ''}`.trim() || undefined} aria-current={n === i ? 'step' : undefined}>
            <span className="cs-sr">{n === last ? '힘들 때' : `${n + 1}단계`}</span>
          </li>
        ))}
      </ol>
      <div className="cs-nav">
        <button className="btn" onClick={() => go(-1)} aria-disabled={i === 0}>이전</button>
        <button className="btn primary" onClick={() => go(1)} aria-disabled={i === last}>다음</button>
      </div>
      {voice && (
        <div className="cs-aux">
          <button className="btn" onClick={onReplay}>이 문장 듣기</button>
          <button className="btn" onClick={onAutoRead} aria-pressed={autoRead}>넘길 때 읽어 주기</button>
        </div>
      )}
    </div>
  )
}

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
  const [step, setStep] = useState<number | null>(null) // 한 단계씩 보기의 현재 화면. null이면 닫힘
  const [autoRead, setAutoRead] = useState(false)
  const token = useRef(0)
  const head = useRef<HTMLHeadingElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const hasVoice = useKoreanVoice()
  const voice = canSpeak && hasVoice

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

  // 한 단계씩 보기에서는 화면에 보이는 문장 하나만 읽는다. 화면이 바뀌거나 닫히면 읽던 소리를 멈춘다.
  const pageText = step === null ? '' : stepPage(card, Math.min(step, card.steps.length)).text
  useEffect(() => {
    if (step === null || !canSpeak) return
    const synth = window.speechSynthesis
    if (autoRead && hasVoice) speakText(pageText)
    return () => synth.cancel()
  }, [step, pageText, autoRead, hasVoice])

  const openStep = () => {
    token.current++
    if (canSpeak) window.speechSynthesis.cancel()
    setReading(null)
    setStep(0)
  }
  const closeStep = () => {
    setStep(null)
    opener.current?.focus()
  }
  const replay = () => {
    if (!canSpeak) return
    window.speechSynthesis.cancel()
    speakText(pageText)
  }

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
          <button className="btn" onClick={openStep} ref={opener} aria-haspopup="dialog">한 단계씩 보기</button>
          {voice && <button className="btn" onClick={read}>{reading !== null ? '읽기 멈추기' : '읽어 주기'}</button>}
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
      {step !== null &&
        createPortal(
          <StepDialog card={card} place={place} index={step} voice={voice} autoRead={autoRead} onGo={setStep} onClose={closeStep} onAutoRead={() => setAutoRead((a) => !a)} onReplay={replay} />,
          document.body,
        )}
    </section>
  )
}
