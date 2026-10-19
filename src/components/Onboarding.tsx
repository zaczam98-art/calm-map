import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChildProfile, NoiseData, Place, Snapshot } from '../types'
import { defaultProfile, saveProfile } from '../lib/profile'
import { canPreview, isSoundOnly, usePreviewChange } from '../lib/preview'
import type { SoundStore } from '../lib/snapshot'
import { INTRO_KEY } from '../lib/landing'
import { SHEET } from '../lib/landingCopy'
import '../styles/onboarding.css'

const PICKS: { id: string; label: string; apply: (p: ChildProfile) => void }[] = [
  { id: 'sudden', label: '사이렌·경적·알람', apply: (p) => { p.tags.sudden = 1.5 } },
  { id: 'crowd', label: '사람이 많은 곳', apply: (p) => { p.crowd = 1.5 } },
  { id: 'music', label: '안내방송·큰 음악', apply: (p) => { p.tags.music = 1.5 } },
  { id: 'machine', label: '공사·기계 소리', apply: (p) => { p.tags.machine = 1.5 } },
  { id: 'loud', label: '그냥 큰 소리', apply: (p) => { p.loud = 1.5 } },
]

function profileFor(ids: ReadonlySet<string>): ChildProfile {
  const p = defaultProfile()
  p.enabled = true
  for (const pick of PICKS) if (ids.has(pick.id)) pick.apply(p)
  return p
}

interface Props {
  places: Place[]
  snap: Snapshot | null
  sound: SoundStore
  offsets: Record<string, number>
  noise: NoiseData | null
  nowKey: string | undefined
  /** 시트를 닫을 때. 적용하기로 고른 항목이 있으면 저장한 프로필을, 아니면 null을 넘긴다. */
  onFinish: (applied: ChildProfile | null) => void
}

export default function Onboarding({ places, snap, sound, offsets, noise, nowKey, onFinish }: Props) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const ref = useRef<HTMLDivElement>(null)
  const cand = useMemo(() => profileFor(picked), [picked])
  // 맞춤을 끈 쪽은 한 번만 계산하고, 고른 항목이 바뀔 때는 켠 쪽만 다시 계산한다(칩 누름이 계산을 기다리지 않게 미룬 값을 쓴다). 우리 아이 탭도 같은 함수를 쓴다.
  const { change, settled } = usePreviewChange({ places, snap, sound, offsets, noise, nowKey }, picked.size ? cand : null)
  const soundOnly = !change && picked.size > 0 && isSoundOnly(cand)

  const finish = (apply: boolean) => {
    try {
      localStorage.setItem(INTRO_KEY, '1')
    } catch {
      /* 저장할 수 없으면 이번 방문에서만 닫는다 */
    }
    if (apply && picked.size) {
      saveProfile(cand)
      onFinish(cand)
    } else {
      onFinish(null)
    }
  }
  const finishRef = useRef(finish)
  finishRef.current = finish

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('.chip')?.focus() // 랜딩에서 넘어온 초점이 body로 떨어지지 않게 첫 칩으로 보낸다
    // 시트 뒤의 화면으로 Tab 초점이 넘어가지 않게 시트 안에서만 돌린다
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finishRef.current(false)
      const box = ref.current
      if (e.key !== 'Tab' || !box) return
      const items = [...box.querySelectorAll<HTMLElement>('button')]
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (!box.contains(active) || (e.shiftKey && (active === first || active === box))) {
        e.preventDefault()
        const target = e.shiftKey ? last : first
        target.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  return (
    <div className="ob-back">
      <div className="ob-sheet" role="dialog" aria-modal="true" aria-labelledby="ob-title" tabIndex={-1} ref={ref}>
        <div className="ob-body">
          <h2 id="ob-title">{SHEET.title}</h2>
          <p className="muted">{SHEET.help}</p>
          <div className="ob-chips" role="group" aria-labelledby="ob-title">
            {PICKS.map((pick) => {
              const on = picked.has(pick.id)
              return (
                <button key={pick.id} className={on ? 'chip on' : 'chip'} aria-pressed={on} onClick={() => toggle(pick.id)}>
                  {pick.label}
                </button>
              )
            })}
          </div>
          <div className="ob-preview" role="status">
            {change ? (
              <>
                <span className="ob-pv-place">
                  {change.place} · {change.now ? '지금' : `${change.hour}시`}
                </span>
                <span className="ob-pv-num">
                  맞춤을 끄면 <b>{change.off}점</b>, 켜면 <b>{change.on}점</b>이에요.
                </span>
                <span className="ob-pv-note">{SHEET.why}</span>
              </>
            ) : picked.size === 0 ? (
              <span className="ob-pv-note">{canPreview(snap) ? SHEET.promise : SHEET.noPreview}</span>
            ) : soundOnly ? (
              <span className="ob-pv-note">{SHEET.soundOnly}</span>
            ) : settled ? (
              <span className="ob-pv-note">{SHEET.noExample}</span> // 미룬 계산이 따라잡은 뒤에도 예가 없을 때만 알린다
            ) : null}
          </div>
          <p className="muted ob-note">{SHEET.foot}</p>
        </div>
        <div className="ob-actions">
          <button className={picked.size ? 'btn' : 'btn primary'} onClick={() => finish(false)}>{SHEET.skip}</button>
          {picked.size > 0 && <button className="btn primary" onClick={() => finish(true)}>{SHEET.apply(picked.size)}</button>}
        </div>
      </div>
    </div>
  )
}
