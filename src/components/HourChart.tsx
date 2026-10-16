import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import type { HourScore } from '../types'
import { LEVEL3_LABEL } from '../lib/index'
import { reducedMotion } from '../lib/motion'
import { FILL, isNight } from '../lib/chartStyle' // 밤 시간(22~7시)은 권고 시간 비교에서 빼므로 옅게 그린다
import '../styles/chart.css'
// 글자 크기는 CSS 규칙보다 앞서도록 style로 준다(viewBox 기준. 375px 화면에서 거의 같은 px가 되고 320px에서도 12px 안팎이다)
const TEXT = { fontSize: 15 }
const TEXT_SEL = { fontSize: 15, fontWeight: 700 } as const
const TICK = { fontSize: 13, paintOrder: 'stroke', stroke: '#ffffff', strokeWidth: 3, strokeLinejoin: 'round' } as const
const INK = '#1f2933'
const GRID = '#e3e7ec'
const SEL_BG = '#e9f1f6'

/** 위만 둥근 막대. 바닥은 각지게 두어 기준선에서 자라는 모양이 된다. */
const barPath = (x: number, y: number, w: number, h: number) => {
  const r = Math.min(4, h / 2, w / 2)
  return `M${x},${y + h} V${y + r} a${r},${r} 0 0 1 ${r},-${r} H${x + w - r} a${r},${r} 0 0 1 ${r},${r} V${y + h} Z`
}

interface Props {
  scores: HourScore[]
  highlight: number | null
  /** 사용자가 고른 시(0~23). 없으면 null. */
  selectedHour?: number | null
  /** 주면 막대가 누를 수 있는 단추가 된다. 이미 고른 막대를 다시 누르면 null로 부른다. */
  onSelectHour?: (hour: number | null) => void
  /** false면 막대가 처음부터 서 있다. 시트가 이미 열린 채 다른 장소로 바꿀 때 막대가 바닥에서 다시 자라지 않게 한다. */
  animateIn?: boolean
}

export default function HourChart({ scores, highlight, selectedHour = null, onSelectHour, animateIn = true }: Props) {
  const barRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [focusAt, setFocusAt] = useState<number | null>(null) // 방향키로 옮기는 동안만 쓰는 칸 번호. 막대 밖으로 포커스가 나가면 비운다.
  const [grown, setGrown] = useState(() => !animateIn || reducedMotion()) // 시트가 열릴 때 막대가 바닥에서 한 번 자란다. 동작 줄이기와 열린 채 바뀐 장소에서는 처음부터 서 있다.
  useEffect(() => {
    const id = requestAnimationFrame(() => setGrown(true))
    return () => cancelAnimationFrame(id)
  }, [])
  const W = 360
  const H = 160
  const padL = 6
  const padB = 22
  const padT = 14
  const n = Math.max(scores.length, 1)
  const bw = (W - padL - 4) / n
  const barW = Math.min(24, bw - 2) // 막대는 24px까지만 굵게, 칸 사이는 2px 이상 비운다
  const barMax = Math.max(0, ...scores.map((s) => s.index ?? 0))
  const yMax = Math.min(100, Math.max(70, Math.ceil((barMax + 10) / 10) * 10))
  const plotH = H - padB - padT
  const yOf = (v: number) => H - padB - (v / yMax) * plotH
  const hasNoise = scores.some((s) => s.noise)
  const missingNoise = (s: HourScore) => hasNoise && !s.noise && s.index !== null
  const first = scores[0]
  // 관측 시각은 시트 머리에 있으므로 축에는 '지금'만 쓴다
  const nowLabel = first && first.forecast === false && first.obs ? '지금' : null
  const nowEnd = nowLabel ? padL + 32 : 0
  const dayBreak = scores.findIndex((s, i) => i > 0 && s.time.slice(0, 10) !== scores[i - 1].time.slice(0, 10))
  const tomorrow = (i: number) => dayBreak > 0 && i >= dayBreak
  const labelOf = (s: HourScore, i: number) => (i === 0 && nowLabel ? nowLabel : `${i === dayBreak ? '내일 ' : ''}${s.hour}시`)
  const desc = scores
    .map((s, i) => `${i > 0 && i === dayBreak ? '내일 ' : ''}${i === 0 && nowLabel ? `지금(관측 ${first.obs})` : `${s.hour}시`} ${LEVEL3_LABEL[s.level]}${s.index !== null ? ` ${s.index}` : ''}${highlight !== null && s.hour === highlight ? ' 권고 시간' : ''}`)
    .join(', ')
  // 단추의 이름: '9시 보통 지수 42'. 내일 칸은 '내일'을 붙인다.
  const buttonName = (s: HourScore, i: number) =>
    `${tomorrow(i) ? '내일 ' : ''}${s.hour}시 ${LEVEL3_LABEL[s.level]}${s.index !== null ? ` 지수 ${s.index}` : ''}${highlight !== null && s.hour === highlight ? ' 권고 시간' : ''}`
  const selIdx = selectedHour === null ? -1 : scores.findIndex((s) => s.hour === selectedHour)
  // 고른 막대의 글자가 '지금' 글자와 겹치면, 고른 쪽 글자를 보이고 지금 글자는 뺀다
  const selCx = selIdx >= 0 ? padL + selIdx * bw + bw / 2 : 0
  const nowShown = nowLabel !== null && !(selIdx > 0 && selCx - 17 < nowEnd)
  const endX = nowShown ? nowEnd : 0
  // 막대가 좁은 화면(막대 한 칸 20~30px)에서도 한 시간씩 옮길 수 있는 단추. 고르기 전에는 첫 칸(지금)에서 시작한다.
  const cur = selIdx >= 0 ? selIdx : 0
  const canStep = (dir: 1 | -1) => scores.some((s, i) => (dir > 0 ? i > cur : i < cur) && s.index !== null)
  const stepTo = (dir: 1 | -1) => {
    for (let i = cur + dir; i >= 0 && i < scores.length; i += dir) {
      if (scores[i].index !== null) {
        onSelectHour?.(scores[i].hour)
        return
      }
    }
  }

  // Tab 정지는 막대 묶음 전체에서 한 곳이다: 고른 막대(없으면 값이 있는 첫 칸), 방향키로 옮기는 동안에는 포커스가 있는 막대
  const enabledIdx = scores.flatMap((s, i) => (s.index === null ? [] : [i]))
  const tabIdx = focusAt !== null && enabledIdx.includes(focusAt) ? focusAt : enabledIdx.includes(selIdx) ? selIdx : (enabledIdx[0] ?? -1)
  const onBarsKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const from = enabledIdx.indexOf(barRefs.current.indexOf(e.target as HTMLButtonElement))
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (from < 0 || (!step && e.key !== 'Home' && e.key !== 'End')) return
    e.preventDefault()
    const to = step ? from + step : e.key === 'Home' ? 0 : enabledIdx.length - 1
    barRefs.current[enabledIdx[Math.min(Math.max(to, 0), enabledIdx.length - 1)]]?.focus()
  }
  const onBarsBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setFocusAt(null)
  }

  const hasNight = scores.some((s) => isNight(s.hour))
  const hasHighlight = highlight !== null && scores.some((s) => s.hour === highlight)
  const hasHatch = scores.some(missingNoise)
  const noNoise = !hasNoise && scores.some((s) => s.index !== null)
  // 기준선 글자는 막대와 겹치지 않는 자리(기준선보다 높은 막대가 없는 구간)를 오른쪽 끝부터 찾아 놓는다. 없으면 겹침이 가장 적은 자리.
  const labelX = (v: number, width: number) => {
    let best = { x: W - 2 - width, hits: Infinity }
    for (let k = 0; k <= n; k += 1) {
      const x0 = W - 2 - width - k * bw
      if (x0 < padL) break
      const hits = scores.filter((s, i) => (s.index ?? 0) > v && padL + i * bw + 2 < x0 + width && padL + i * bw + bw - 2 > x0).length
      if (hits < best.hits) best = { x: x0, hits }
      if (hits === 0) break
    }
    return best.x
  }

  return (
    <>
      <div className="chart-wrap">
        <svg className="chart" viewBox={`0 0 ${W} ${H}`} {...(onSelectHour ? { 'aria-hidden': true } : { role: 'img', 'aria-label': `시간대별 감각부하 지수. ${desc}` })}>
          <defs>
            <pattern id="hc-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect x="0" y="0" width="3" height="6" fill="#ffffff" opacity=".6" />
            </pattern>
            <clipPath id="hc-clip"><rect x="0" y="0" width={W} height={H - padB} /></clipPath>
          </defs>
          {selIdx >= 0 && <rect x={padL + selIdx * bw} y={padT - 6} width={bw} height={H - padB - padT + 8} rx={6} fill={SEL_BG} />}
          {[35, 65].map((y) => (
            <line key={y} x1={padL} x2={W} y1={yOf(y)} y2={yOf(y)} stroke={GRID} />
          ))}
          {scores.map((s, i) => {
            const v = s.index ?? 0
            const h = (v / yMax) * plotH
            const x = padL + i * bw + (bw - barW) / 2
            const hl = highlight !== null && s.hour === highlight
            const cx = x + barW / 2
            const sel = i === selIdx
            // 고른 막대의 시각 글자가 이웃 눈금 글자와 겹치지 않게, 바로 옆 눈금은 뺀다
            const nearSel = selIdx >= 0 && Math.abs(i - selIdx) === 1
            const showLabel = sel || (!nearSel && (i === 0 || (s.hour % 3 === 0 && cx - 14 >= endX)))
            return (
              <g key={s.time}>
                {/* 막대는 가장 큰 높이로 한 번 그려 두고 위치(translateY)만 옮긴다. 높이를 바꾸는 방식과 달리 위쪽 둥근 모양이 일그러지지 않고, 기준선 아래로 내려간 부분은 clipPath가 자른다. */}
                <g clipPath="url(#hc-clip)">
                  <g className="hc-bar" style={{ transform: `translateY(${grown ? plotH - h : plotH}px)` }}>
                    <g opacity={isNight(s.hour) ? 0.45 : 1}>
                      <path d={barPath(x, padT, barW, plotH)} fill={FILL[s.level]} />
                      {missingNoise(s) && <path d={barPath(x, padT, barW, plotH)} fill="url(#hc-hatch)" />}
                    </g>
                    {hl && <circle cx={cx} cy={h >= 18 ? padT + 9 : padT - 7} r={4.5} fill={INK} stroke="#ffffff" strokeWidth={2} />}
                  </g>
                </g>
                {showLabel && (
                  <text x={i === 0 && nowShown ? padL : cx} y={H - 6} textAnchor={i === 0 && nowShown ? 'start' : 'middle'} style={sel ? TEXT_SEL : TEXT}>
                    {i === 0 && nowShown ? nowLabel : sel ? `${tomorrow(i) ? '내일 ' : ''}${s.hour}시` : labelOf(s, i)}
                  </text>
                )}
              </g>
            )
          })}
          {/* 기준선 글자는 막대 위에 얹히지 않는 자리에, 막대보다 앞에 그려 가려지지 않게 한다 */}
          {[35, 65].map((y) => (
            <text key={y} x={labelX(y, y === 35 ? 60 : 48)} y={yOf(y) - 3} style={TICK}>{y === 35 ? '무던함 35' : '붐빔 65'}</text>
          ))}
        </svg>
        {onSelectHour && (
          <div className="chart-bars" role="group" aria-label="시간대별 감각부하 지수. 시간을 고르면 그 시각 기준으로 보여 줘요" onKeyDown={onBarsKey} onBlur={onBarsBlur}>
            {scores.map((s, i) => (
              <button
                key={s.time}
                ref={(el) => {
                  barRefs.current[i] = el
                }}
                type="button"
                tabIndex={i === tabIdx ? 0 : -1}
                aria-pressed={i === selIdx}
                aria-label={buttonName(s, i)}
                disabled={s.index === null}
                onFocus={() => setFocusAt(i)}
                onClick={() => onSelectHour(i === selIdx ? null : s.hour)}
              />
            ))}
          </div>
        )}
      </div>
      {scores.length > 0 && (
        <div className="chart-foot">
          {onSelectHour && scores.length > 1 && (
            <button type="button" className="chart-nav" disabled={!canStep(-1)} aria-label="이전 시간" onClick={() => stepTo(-1)}>‹ 이전</button>
          )}
          <ul className="chart-legend">
            {hasHighlight && (
              <li>
                <svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill={INK} stroke="#ffffff" strokeWidth="2" /></svg>
                권고 시간
              </li>
            )}
            {hasNight && (
              <li>
                <svg width="14" height="14" aria-hidden="true"><rect x="3" y="2" width="8" height="12" rx="2" fill={FILL.mid} opacity=".45" /></svg>
                밤(비교 제외)
              </li>
            )}
            {hasHatch && (
              <li>
                <svg width="14" height="14" aria-hidden="true">
                  <defs>
                    <pattern id="lg-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                      <rect x="0" y="0" width="2" height="4" fill="#ffffff" opacity=".6" />
                    </pattern>
                  </defs>
                  <rect x="3" y="2" width="8" height="12" rx="2" fill={FILL.mid} />
                  <rect x="3" y="2" width="8" height="12" rx="2" fill="url(#lg-hatch)" />
                </svg>
                소음 자료 없음
              </li>
            )}
            {noNoise && <li>소음 자료 없음(혼잡만 반영)</li>}
          </ul>
          {onSelectHour && scores.length > 1 && (
            <button type="button" className="chart-nav" disabled={!canStep(1)} aria-label="다음 시간" onClick={() => stepTo(1)}>다음 ›</button>
          )}
        </div>
      )}
    </>
  )
}
