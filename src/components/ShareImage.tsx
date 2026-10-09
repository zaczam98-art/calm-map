import { useEffect, useRef, useState } from 'react'
import type { HourScore, Place } from '../types'
import { makeShareCardBlob, placeShareUrl, shareFileName } from '../lib/shareCard'
import '../styles/share.css'

interface Props {
  place: Pick<Place, 'name'>
  scores: HourScore[]
  nowKey: string | undefined
  /** 자료 기준 시각 'YYYY-MM-DD HH:MM' */
  updatedAt: string | undefined
  /** 고른 시(0~23). 없으면 null */
  selectedHour: number | null
  /** 맞춤(아이 프로필) 반영 여부. 이미지에는 표식만 들어가고 프로필 값은 들어가지 않는다. */
  adapted: boolean
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30000)
}

/** [이미지로 공유] 단추. 공유 시트가 되는 기기는 시트로, 아니면 PNG 파일로 내려받는다. */
export default function ShareImage({ place, scores, nowKey, updatedAt, selectedHour, adapted }: Props) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ name: string; text: string } | null>(null)
  const alive = useRef(true)
  const running = useRef(false) // 상태가 다시 그려지기 전에 연달아 눌러도 한 번만 만든다
  const timer = useRef(0)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      window.clearTimeout(timer.current)
    }
  }, [])

  if (!updatedAt || !scores.some((s) => s.index !== null)) return null

  const say = (text: string) => {
    window.clearTimeout(timer.current)
    if (!alive.current) return
    setNote({ name: place.name, text })
    if (text) timer.current = window.setTimeout(() => alive.current && setNote(null), 6000)
  }

  const run = async () => {
    if (running.current) return
    running.current = true
    setBusy(true)
    say('')
    try {
      const blob = await makeShareCardBlob({ place, scores, nowKey, updatedAt, selectedHour, adapted })
      const fileName = shareFileName(place.name)
      const file = new File([blob], fileName, { type: 'image/png' })
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: `${place.name} · 무던한 지도`, text: `${place.name} 시간대별 감각부하 예측\n${placeShareUrl(place.name)}` })
          return
        } catch (e) {
          if ((e as Error).name === 'AbortError') return
          /* 공유 시트가 열리지 않으면 파일로 내려받는다 */
        }
      }
      saveBlob(blob, fileName)
      say('이미지를 저장했어요. 저장된 파일을 단톡방 등에 올려 주세요.')
    } catch {
      say('이미지를 만들지 못했어요. 잠시 뒤에 다시 눌러 주세요.')
    } finally {
      running.current = false
      if (alive.current) setBusy(false)
    }
  }

  return (
    <span className="share-img">
      <button type="button" className="btn" aria-disabled={busy} aria-busy={busy} onClick={() => void run()}>
        {busy ? '만드는 중…' : '이미지로 공유'}
      </button>
      <span role="status" className="muted share-img-msg">{note && note.name === place.name ? note.text : ''}</span>
    </span>
  )
}
