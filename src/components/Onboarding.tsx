import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { ChildProfile, HourScore, NoiseData, Place, Snapshot } from '../types'
import { hourScores } from '../lib/index'
import { noiseLookup } from '../lib/noise'
import { defaultProfile, hasSavedProfile, saveProfile } from '../lib/profile'
import { bucketKey, type SoundStore } from '../lib/snapshot'
import '../styles/onboarding.css'

const INTRO_KEY = 'calmmap.intro.v1'

/** 첫 방문 안내를 보여 줄지: 저장된 프로필도 안내를 본 기록도 없고, 주소에 intro=0(캡처·영상용)이 없을 때만 보여 준다. */
export function shouldShowIntro(): boolean {
  try {
    if (new URLSearchParams(location.search).get('intro') === '0') return false
    if (/[#?&/]intro=0(?:&|$)/.test(location.hash)) return false
    return localStorage.getItem(INTRO_KEY) === null && !hasSavedProfile()
  } catch {
    return false // 저장할 수 없는 환경에서는 새로고침마다 뜨지 않게 보여 주지 않는다
  }
}

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

interface IntroChange {
  place: string
  /** 보여 주는 칸의 시(지금 칸이 아니면 이 시를 밝힌다) */
  hour: number
  now: boolean
  off: number
  on: number
}

/** 장소별 첫 칸(지금 칸)의 점수. profile이 null이면 맞춤을 끈 값이다. 서울시 실제 자료가 아니면 비어 있다. */
function firstCells(
  places: Place[],
  snap: Snapshot | null,
  sound: SoundStore,
  offsets: Record<string, number>,
  noise: NoiseData | null,
  nowKey: string | undefined,
  profile: ChildProfile | null,
): Map<string, HourScore> {
  const out = new Map<string, HourScore>()
  if (!snap || snap.source !== 'seoul') return out
  for (const p of places) {
    const soundAt = (h: number, d: number) => sound[p.name]?.[bucketKey(d, h)]
    const first = hourScores(snap.places[p.name], soundAt, profile, profile ? (offsets[p.name] ?? 0) : 0, nowKey, noiseLookup(noise, p.name))[0]
    if (first) out.set(p.name, first)
  }
  return out
}

/** 맞춤을 켰을 때 첫 칸의 지수가 가장 많이 달라지는 장소. 달라지는 곳이 없으면 null. */
function biggestChange(off: Map<string, HourScore>, on: Map<string, HourScore>, nowKey: string | undefined): IntroChange | null {
  let best: IntroChange | null = null
  for (const [place, o] of off) {
    const n = on.get(place)
    if (!n || o.index === null || n.index === null) continue
    const gap = Math.abs(n.index - o.index)
    if (gap > 0 && (!best || gap > Math.abs(best.on - best.off))) best = { place, hour: n.hour, now: n.time.slice(0, 13) === nowKey, off: o.index, on: n.index }
  }
  return best
}

interface Props {
  places: Place[]
  snap: Snapshot | null
  sound: SoundStore
  offsets: Record<string, number>
  noise: NoiseData | null
  nowKey: string | undefined
  /** 안내를 닫을 때. 시작하기로 고른 항목이 있으면 저장한 프로필을, 아니면 null을 넘긴다. */
  onFinish: (applied: ChildProfile | null) => void
}

export default function Onboarding({ places, snap, sound, offsets, noise, nowKey, onFinish }: Props) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const ref = useRef<HTMLDivElement>(null)
  const cand = useMemo(() => profileFor(picked), [picked])
  const canPreview = snap?.source === 'seoul'
  // 맞춤을 끈 첫 칸은 선택과 무관하므로 한 번만 계산하고, 선택이 바뀔 때는 켠 쪽만 다시 계산한다(칩 누름이 계산을 기다리지 않게 미룬 값을 쓴다)
  const offCells = useMemo(() => firstCells(places, snap, sound, offsets, noise, nowKey, null), [places, snap, sound, offsets, noise, nowKey])
  const shown = useDeferredValue(picked)
  const deferredChange = useMemo(
    () => (shown.size ? biggestChange(offCells, firstCells(places, snap, sound, offsets, noise, nowKey, profileFor(shown)), nowKey) : null),
    [shown, offCells, places, snap, sound, offsets, noise, nowKey],
  )
  const change = picked.size ? deferredChange : null
  // 안내방송·기계 소리는 소리 점수에만 곱해지므로, 이 항목만 고르면 현장 측정이 없는 칸의 지수는 바뀌지 않는다
  const soundOnly = !change && picked.size > 0 && [...picked].every((id) => id === 'music' || id === 'machine')

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
    ref.current?.focus()
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
      <div className="ob-sheet" role="dialog" aria-modal="true" aria-label="처음 사용 안내" tabIndex={-1} ref={ref}>
        <div className="ob-body">
          <p className="ob-guide">점 하나가 장소 하나예요. 연할수록 무던해요. 점을 누르면 오늘 몇 시가 편한지 나와요.</p>
          <p className="ob-legend" aria-hidden>
            <span><i className="calm" />무던함</span>
            <span><i className="mid" />보통</span>
            <span><i className="busy" />붐빔</span>
          </p>
          <h2 id="ob-title">아이가 힘들어하는 것이 있나요?</h2>
          <p className="muted">여러 개 골라도 돼요. 이름이나 진단명은 묻지 않아요.</p>
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
                  맞춤 끄면 <b>{change.off}점</b>, 켜면 <b>{change.on}점</b>
                </span>
                <span className="ob-pv-note">0~100점이고, 낮을수록 편안해요</span>
              </>
            ) : picked.size === 0 ? (
              <span className="ob-pv-note">{canPreview ? '고르면 지수가 어떻게 달라지는지 예를 보여 드려요. ' : ''}고르지 않고 시작하면 맞춤 없이 시작해요.</span>
            ) : soundOnly ? (
              <span className="ob-pv-note">고른 항목은 소리를 직접 잰 장소와 시간대에서 지수에 반영돼요. 현장 측정 탭에서 소리를 재 보세요.</span>
            ) : null}
          </div>
          <p className="muted ob-note">고른 내용은 이 기기에만 저장되고, 우리 아이 탭에서 언제든 바꿀 수 있어요.</p>
        </div>
        <div className="ob-actions">
          <button className="btn" onClick={() => finish(false)}>건너뛰기</button>
          <button className="btn primary" onClick={() => finish(true)}>시작하기</button>
        </div>
      </div>
    </div>
  )
}
