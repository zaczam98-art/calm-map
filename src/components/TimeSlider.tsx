import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import type { HourScore, Level3 } from '../types'
import { scoreAt } from '../lib/index'
import '../styles/a11y.css'

const HOUR_MS = 3600_000
const MAX_AHEAD = 12 // 지금부터 이만큼 뒤까지만 고를 수 있다(예측이 이보다 짧으면 있는 데까지)
const PLAY_MS = 1000
const ANNOUNCE_MS = 300 // 슬라이더를 끄는 동안 문장이 쌓이지 않게, 멈춘 뒤 이만큼 기다렸다가 한 번만 알린다

/** 슬라이더가 고를 수 있는 칸의 범위. 0번 칸이 '지금'(고른 시각이 없음, selectedHour=null)이고, k번 칸은 0번 칸에서 k시간 뒤다. */
export interface SliderPlan {
  /** 0번 칸의 시각 키 'YYYY-MM-DD HH'(장소들의 첫 예측 칸 중 가장 이른 것) */
  origin: string
  /** 오늘 날짜 'YYYY-MM-DD'(한국 시간). '오늘'과 '내일'을 가르는 기준 */
  today: string
  /** 0번 칸이 현재 시각의 칸인가. 수집이 늦어 첫 칸이 이미 다음 시각이면 '지금'이라 부르지 않는다. */
  isNow: boolean
  /** 예측이 있는 가장 먼 칸(1~12) */
  max: number
}

const stamp = (key: string) => Date.parse(`${key.slice(0, 10)}T${key.slice(11, 13)}:00:00Z`)

/** 모든 장소의 시계열에서 슬라이더 범위를 만든다. 고를 칸이 없으면(예측이 한 칸뿐이거나 자료가 없으면) null. */
export function planFor(all: Record<string, HourScore[]> | null, nowKey: string | undefined): SliderPlan | null {
  if (!all) return null
  let first = ''
  let last = ''
  for (const scores of Object.values(all)) {
    for (const s of scores) {
      const k = s.time.slice(0, 13)
      if (!first || k < first) first = k
      if (!last || k > last) last = k
    }
  }
  if (!first) return null
  const max = Math.min(MAX_AHEAD, Math.round((stamp(last) - stamp(first)) / HOUR_MS))
  if (max < 1) return null
  return { origin: first, today: (nowKey ?? first).slice(0, 10), isNow: !nowKey || first === nowKey, max }
}

const slotDate = (plan: SliderPlan, k: number) => new Date(stamp(plan.origin) + k * HOUR_MS)

/** k번 칸의 시(0~23). 이 값이 selectedHour로 App에 전해진다. */
export function slotHour(plan: SliderPlan, k: number): number {
  return slotDate(plan, k).getUTCHours()
}

/** 고른 시(0~23)가 몇 번 칸인지. 칸 범위 밖의 시각이면 plan.max보다 큰 값이 나온다. */
export function offsetOf(plan: SliderPlan, hour: number): number {
  return (((hour - slotHour(plan, 0)) % 24) + 24) % 24
}

/** 슬라이더 옆 이름: '지금' / '오늘 15시' / '내일 8시' */
export function slotLabel(plan: SliderPlan, k: number): string {
  if (k === 0 && plan.isNow) return '지금'
  const d = slotDate(plan, k)
  return `${d.toISOString().slice(0, 10) === plan.today ? '오늘' : '내일'} ${d.getUTCHours()}시`
}

/** 범례와 말풍선에 붙이는 짧은 이름: '15시' / '내일 8시'(오늘은 날짜를 뺀다) */
export function slotShort(plan: SliderPlan, k: number): string {
  const d = slotDate(plan, k)
  return `${d.toISOString().slice(0, 10) === plan.today ? '' : '내일 '}${d.getUTCHours()}시`
}

/** 고른 시각의 칸. hour가 null이면 첫 칸(지금), 그 시각의 예측이 없으면 undefined(옆 칸으로 짐작하지 않는다). */
export function cellAt(scores: HourScore[] | undefined, hour: number | null): HourScore | undefined {
  if (!scores) return undefined
  return hour === null ? scores[0] : scoreAt(scores, hour)
}

export function levelAt(scores: HourScore[] | undefined, hour: number | null): Level3 {
  return cellAt(scores, hour)?.level ?? 'nodata'
}

interface Props {
  plan: SliderPlan
  /** 고른 칸 번호(0=지금) */
  value: number
  onChange: (k: number) => void
  /** 지도 탭이 보이는 동안만 true. 숨겨지면 자동 진행을 멈춘다. */
  active: boolean
  /** 고른 칸의 단계별 장소 수(범례와 같은 값). 주면 시각을 바꾼 뒤 화면 밖 문장으로 읽어 준다. */
  counts?: Record<Level3, number> | null
}

export default function TimeSlider({ plan, value, onChange, active, counts }: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const valueRef = useRef(value)
  const maxRef = useRef(plan.max)
  const changeRef = useRef(onChange)
  const playingRef = useRef(false)
  const sentRef = useRef(value) // 이 슬라이더가 마지막으로 보낸 칸. 다른 값이 들어오면 바깥(시트 막대)에서 바꾼 것이다.
  valueRef.current = value
  playingRef.current = playing
  maxRef.current = plan.max
  changeRef.current = onChange

  // 슬라이더를 누르거나 끌고 휠을 돌려도 뒤의 지도가 움직이거나 확대되지 않게 한다
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    L.DomEvent.disableClickPropagation(el)
    L.DomEvent.disableScrollPropagation(el)
  }, [])

  // 1초마다 한 칸씩 나아가고, 마지막 칸에서 멈춘다
  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => {
      const v = valueRef.current
      if (v >= maxRef.current) {
        setPlaying(false)
        return
      }
      sentRef.current = v + 1
      changeRef.current(v + 1)
      if (v + 1 >= maxRef.current) setPlaying(false)
    }, PLAY_MS)
    return () => window.clearInterval(id)
  }, [playing])

  useEffect(() => {
    if (!active) setPlaying(false)
  }, [active])

  // 재생 중에 시트 막대 등 바깥에서 시각을 바꾸면 재생을 멈춰 고른 값을 덮어쓰지 않는다
  useEffect(() => {
    if (playingRef.current && value !== sentRef.current) setPlaying(false)
  }, [value])

  const label = slotLabel(plan, value)

  // 시각을 바꾼 결과를 읽어 준다: '15시 기준 무던함 79곳, 보통 30곳, 붐빔 12곳'. 처음 그릴 때와 자료만 새로 들어온 때는 읽지 않는다.
  const said = counts
    ? `${value === 0 && plan.isNow ? '지금' : slotShort(plan, value)} 기준 무던함 ${counts.calm}곳, 보통 ${counts.mid}곳, 붐빔 ${counts.busy}곳${counts.nodata ? `, 자료 없음 ${counts.nodata}곳` : ''}`
    : ''
  const saidRef = useRef(said)
  saidRef.current = said
  const shownValue = useRef(value)
  const [spoken, setSpoken] = useState('')
  useEffect(() => {
    if (shownValue.current === value) return
    shownValue.current = value
    const id = window.setTimeout(() => setSpoken(saidRef.current), ANNOUNCE_MS)
    return () => window.clearTimeout(id)
  }, [value])
  const toggle = () => {
    if (playing) {
      setPlaying(false)
      return
    }
    const start = value >= plan.max ? 0 : value
    sentRef.current = start
    if (start !== value) onChange(start) // 끝에서 누르면 처음부터 다시
    setPlaying(true)
  }
  // 앱 바깥 상자의 포인터 핸들러(지도를 끌면 브리핑을 접는다)로 슬라이더 조작이 번지지 않게 한다
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()

  return (
    <div ref={boxRef} className="tslider" role="group" aria-label="지도 시각 고르기" onPointerDown={stop} onPointerMove={stop}>
      <button type="button" className="tslider-play" onClick={toggle} aria-label={playing ? '재생 멈춤' : '시간대 재생'} title={playing ? '재생 멈춤' : '시간대 재생'}>
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
          {playing ? <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" /> : <path d="M8 5.5v13l11-6.5z" fill="currentColor" />}
        </svg>
      </button>
      <input
        type="range"
        min={0}
        max={plan.max}
        step={1}
        value={Math.min(value, plan.max)}
        aria-label="지도에 보여 줄 시각"
        aria-valuetext={label}
        onChange={(e) => {
          setPlaying(false)
          sentRef.current = Number(e.target.value)
          onChange(Number(e.target.value))
        }}
      />
      <span className="tslider-label" aria-hidden="true">{label}</span>
      <span className="tslider-live" role="status" aria-live="polite" aria-atomic="true">{spoken}</span>
    </div>
  )
}
