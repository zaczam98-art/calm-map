import { useId, useState } from 'react'
import Fold from './Fold'
import '../styles/feedback.css'

/** 의견을 받는 주소. 서버가 없으므로 기기의 메일 앱으로 넘기고, 보낼지는 보호자가 메일 앱에서 정한다. */
export const FEEDBACK_EMAIL = 'zaczam98@gmail.com'
// 한글 500자면 mailto 주소가 약 4천 자가 된다. 더 길면 일부 메일 앱이 본문을 자르므로 여기서 막는다.
const MAX = 500

/** 메일 앱을 여는 mailto 주소. 본문에는 장소와 보고 있던 시각, 적은 글만 담는다(아이 맞춤 값과 기록은 넣지 않는다). */
export function feedbackMailto(place: string, timeLabel: string, text: string): string {
  const subject = `[무던한 지도] 의견: ${place}`
  const body = [`장소: ${place}`, `보고 있던 시각: ${timeLabel}`, '', text.trim()].join('\r\n')
  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

export default function FeedbackMail({ place, timeLabel }: { place: string; timeLabel: string }) {
  const [text, setText] = useState('')
  const [status, setStatus] = useState('')
  const id = useId()
  const send = () => {
    window.location.href = feedbackMailto(place, timeLabel, text)
    setStatus('메일 앱을 열었어요. 보내기는 메일 앱에서 눌러 주세요.')
  }
  // 메일 앱이 없는 기기를 위해 같은 내용을 복사해 둘 수 있게 한다
  const copy = async () => {
    try {
      await navigator.clipboard.writeText([`장소: ${place}`, `보고 있던 시각: ${timeLabel}`, '', text.trim()].join('\n'))
      setStatus(`복사했어요. ${FEEDBACK_EMAIL}로 보내 주세요.`)
    } catch {
      setStatus('복사하지 못했어요. 글을 직접 선택해서 복사해 주세요.')
    }
  }
  return (
    <Fold title="개발자에게 전할 말(선택)" level={4} brief="불편했던 점이나 지수가 실제와 달랐던 점" className="feedback">
      <label htmlFor={id} className="feedback-label fold-sr">개발자에게 전할 말(선택)</label>
      <textarea
        id={id}
        value={text}
        maxLength={MAX}
        rows={3}
        placeholder="불편했던 점, 지수가 실제와 달랐던 점, 고쳤으면 하는 점을 적어 주세요."
        aria-describedby={`${id}-note`}
        onChange={(e) => {
          setText(e.target.value)
          setStatus('')
        }}
      />
      <div className="feedback-row">
        <button type="button" className="btn" disabled={text.trim().length === 0} onClick={send}>메일로 보내기</button>
        <button type="button" className="btn" disabled={text.trim().length === 0} onClick={() => void copy()}>글 복사</button>
        <span className="muted feedback-count" aria-hidden="true">{text.length}/{MAX}</span>
      </div>
      <p id={`${id}-note`} className="muted feedback-note">
        메일로 보내기를 누르면 이 기기의 메일 앱이 열리고, 메일 앱에서 보내기를 눌러야 전달돼요. 메일에는 장소 이름과 보고 있던 시각, 적은 글만 들어가요. 메일 앱이 열리지 않으면 글을 복사해서 {FEEDBACK_EMAIL}로 보내 주세요.
      </p>
      <div role="status" className="muted">{status}</div>
    </Fold>
  )
}
