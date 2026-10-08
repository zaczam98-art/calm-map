import type { HourScore, Level3 } from '../types'
import { LEVEL3_LABEL } from '../lib/index'

const FILL: Record<Level3, string> = { calm: '#9ddbc8', mid: '#46739e', busy: '#2e2a5e', nodata: '#ffffff' }
// 밤 시간(22~7시)은 추천 비교에서 빼므로 옅게 그린다
const isNight = (h: number) => h < 8 || h > 21
// 글자 크기는 CSS 규칙보다 앞서도록 style로 준다(viewBox 기준 16. 320px 화면에서 줄어든 뒤에도 12px 안팎이 된다)
const TEXT = { fontSize: 16 }
const TEXT_SEL = { fontSize: 16, fontWeight: 700 } as const
const HALO = { fontSize: 16, paintOrder: 'stroke', stroke: '#ffffff', strokeWidth: 3, strokeLinejoin: 'round' } as const

interface Props {
  scores: HourScore[]
  highlight: number | null
  /** 사용자가 고른 시(0~23). 없으면 null. */
  selectedHour?: number | null
  /** 주면 막대가 누를 수 있는 단추가 된다. 이미 고른 막대를 다시 누르면 null로 부른다. */
  onSelectHour?: (hour: number | null) => void
}

export default function HourChart({ scores, highlight, selectedHour = null, onSelectHour }: Props) {
  const W = 360
  const H = 160
  const padL = 6
  const padB = 22
  const padT = 16
  const n = Math.max(scores.length, 1)
  const bw = (W - padL - 4) / n
  const barMax = Math.max(0, ...scores.map((s) => s.index ?? 0))
  const yMax = Math.min(100, Math.max(70, Math.ceil((barMax + 10) / 10) * 10))
  const plotH = H - padB - padT
  const yOf = (v: number) => H - padB - (v / yMax) * plotH
  const hasNoise = scores.some((s) => s.noise)
  const missingNoise = (s: HourScore) => hasNoise && !s.noise && s.index !== null
  const first = scores[0]
  const nowLabel = first && first.forecast === false && first.obs ? `지금(관측 ${first.obs})` : null
  const nowEnd = nowLabel ? padL + nowLabel.length * 11 : 0
  const labelOf = (s: HourScore, i: number) => (i === 0 && nowLabel ? nowLabel : `${s.hour}시`)
  const dayBreak = scores.findIndex((s, i) => i > 0 && s.time.slice(0, 10) !== scores[i - 1].time.slice(0, 10))
  const tomorrow = (i: number) => dayBreak > 0 && i >= dayBreak
  const desc = scores
    .map((s, i) => `${i > 0 && i === dayBreak ? '내일 ' : ''}${labelOf(s, i)} ${LEVEL3_LABEL[s.level]}${s.index !== null ? ` ${s.index}` : ''}${highlight !== null && s.hour === highlight ? ' 추천' : ''}`)
    .join(', ')
  // 단추의 이름: '9시 보통 지수 42'. 내일 칸은 '내일'을 붙인다.
  const buttonName = (s: HourScore, i: number) =>
    `${tomorrow(i) ? '내일 ' : ''}${s.hour}시 ${LEVEL3_LABEL[s.level]}${s.index !== null ? ` 지수 ${s.index}` : ''}${highlight !== null && s.hour === highlight ? ' 추천' : ''}`
  const selIdx = selectedHour === null ? -1 : scores.findIndex((s) => s.hour === selectedHour)
  // 고른 막대의 글자가 '지금(관측 …)' 글자와 겹치면, 고른 쪽 글자를 보이고 지금 글자는 뺀다
  const selCx = selIdx >= 0 ? padL + selIdx * bw + 2 + (bw - 4) / 2 : 0
  const nowShown = nowLabel !== null && !(selIdx > 0 && selCx - 17 < nowEnd)
  const endX = nowShown ? nowEnd : 0
  // 막대가 좁은 화면(막대 한 칸 20~30px)에서도 한 시간씩 옮길 수 있는 큰 단추. 고르기 전에는 첫 칸(지금)에서 시작한다.
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
  const caption = [
    '추천 시간은 외출 시간(8~21시) 안에서 골라요.',
    hasNight && '옅은 막대는 밤 시간이라 추천 비교에서 뺐어요.',
    hasHighlight && '테두리가 있는 막대가 추천 시간이에요.',
    selIdx >= 0 && '바탕이 칠해진 막대가 지금 보고 있는 시간이에요.',
    hasHatch && '빗금 막대는 주변 소음 실측이 빠진 시간이라 혼잡도 예측만 반영했어요.',
    noNoise && '이 장소는 이 시간대의 소음 자료가 없어 혼잡도 예측만 반영했어요.',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <>
      <div className="chart-wrap">
        <svg className="chart" viewBox={`0 0 ${W} ${H}`} {...(onSelectHour ? { 'aria-hidden': true } : { role: 'img', 'aria-label': `시간대별 감각부하 지수. ${desc}` })}>
          <defs>
            <pattern id="hc-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect x="0" y="0" width="2" height="6" fill="#ffffff" opacity=".7" />
              <rect x="3" y="0" width="2" height="6" fill="#1f2933" opacity=".35" />
            </pattern>
          </defs>
          {selIdx >= 0 && <rect x={padL + selIdx * bw} y={1} width={bw} height={H - padB + 1} rx={6} fill="#dcecf4" stroke="#2f6f8f" strokeWidth={1.5} />}
          {[35, 65].map((y) => (
            <line key={y} x1={padL} x2={W} y1={yOf(y)} y2={yOf(y)} stroke="#c4ccd6" strokeDasharray="3 3" />
          ))}
          {scores.map((s, i) => {
            const v = s.index ?? 0
            const h = (v / yMax) * plotH
            const x = padL + i * bw + 2
            const w = bw - 4
            const y = H - padB - h
            const hl = highlight !== null && s.hour === highlight
            const cx = x + w / 2
            const sel = i === selIdx
            // 고른 막대의 시각 글자가 이웃 눈금 글자와 겹치지 않게, 바로 옆 눈금은 뺀다
            const nearSel = selIdx >= 0 && Math.abs(i - selIdx) === 1
            const showLabel = sel || (!nearSel && (i === 0 || (s.hour % 3 === 0 && cx - 14 >= endX)))
            return (
              <g key={s.time}>
                <g opacity={isNight(s.hour) ? 0.45 : 1}>
                  <rect x={x} y={y} width={w} height={h} rx={3} fill={FILL[s.level]} fillOpacity={s.level === 'nodata' ? 0.7 : 1} stroke={s.level === 'nodata' ? '#5f6b7a' : 'none'} strokeDasharray="3 3" />
                </g>
                {missingNoise(s) && <rect x={x} y={y} width={w} height={h} rx={3} fill="url(#hc-hatch)" />}
                {hl && <rect x={x - 3} y={y - 3} width={w + 6} height={h + 6} rx={5} fill="none" stroke="#1f2933" strokeWidth={2} />}
                {s.soundN > 0 && <circle cx={cx} cy={y - (hl ? 9 : 5)} r={2.5} fill="#2f6f8f" />}
                {showLabel && (
                  <text x={i === 0 && nowShown ? padL : cx} y={H - 6} textAnchor={i === 0 && nowShown ? 'start' : 'middle'} style={sel ? TEXT_SEL : TEXT}>{i === 0 && nowShown ? nowLabel : `${s.hour}시`}</text>
                )}
              </g>
            )
          })}
          {/* 기준선 글자는 막대 위에 얹히지 않는 자리에, 막대보다 앞에 그려 가려지지 않게 한다 */}
          {[35, 65].map((y) => (
            <text key={y} x={labelX(y, y === 35 ? 68 : 54)} y={yOf(y) - 3} style={HALO}>{y === 35 ? '무던함 35' : '붐빔 65'}</text>
          ))}
          {dayBreak > 0 && (
            <g>
              <line x1={padL + dayBreak * bw} x2={padL + dayBreak * bw} y1={2} y2={H - padB} stroke="#5f6b7a" strokeDasharray="2 3" />
              <text x={padL + dayBreak * bw + 3} y={14} style={HALO}>내일</text>
            </g>
          )}
        </svg>
        {onSelectHour && (
          <div className="chart-bars" role="group" aria-label="시간대별 감각부하 지수. 시간을 고르면 그 시각 기준으로 보여 줘요">
            {scores.map((s, i) => (
              <button key={s.time} type="button" aria-pressed={i === selIdx} aria-label={buttonName(s, i)} disabled={s.index === null} onClick={() => onSelectHour(i === selIdx ? null : s.hour)} />
            ))}
          </div>
        )}
      </div>
      {onSelectHour && scores.length > 1 && (
        <div className="chart-step">
          <button type="button" className="btn" disabled={!canStep(-1)} onClick={() => stepTo(-1)}>‹ 이전 시간</button>
          <button type="button" className="btn" disabled={!canStep(1)} onClick={() => stepTo(1)}>다음 시간 ›</button>
        </div>
      )}
      {scores.length > 0 && <p className="muted">{caption}</p>}
    </>
  )
}
