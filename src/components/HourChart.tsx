import type { HourScore, Level3 } from '../types'
import { LEVEL3_LABEL } from '../lib/index'

const FILL: Record<Level3, string> = { calm: '#9ddbc8', mid: '#46739e', busy: '#2e2a5e', nodata: '#ffffff' }
// 밤 시간(22~7시)은 추천 비교에서 빼므로 옅게 그린다
const isNight = (h: number) => h < 8 || h > 21
// 글자 크기는 CSS 규칙보다 앞서도록 style로 준다(viewBox 기준 16. 320px 화면에서 줄어든 뒤에도 12px 안팎이 된다)
const TEXT = { fontSize: 16 }
const HALO = { fontSize: 16, paintOrder: 'stroke', stroke: '#ffffff', strokeWidth: 3, strokeLinejoin: 'round' } as const

export default function HourChart({ scores, highlight }: { scores: HourScore[]; highlight: number | null }) {
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
  const desc = scores
    .map((s, i) => `${i > 0 && i === dayBreak ? '내일 ' : ''}${labelOf(s, i)} ${LEVEL3_LABEL[s.level]}${s.index !== null ? ` ${s.index}` : ''}${highlight !== null && s.hour === highlight ? ' 추천' : ''}`)
    .join(', ')

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
    hasHatch && '빗금 막대는 주변 소음 실측이 빠진 시간이라 혼잡도 예측만 반영했어요.',
    noNoise && '이 장소는 이 시간대의 소음 자료가 없어 혼잡도 예측만 반영했어요.',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`시간대별 감각부하 지수. ${desc}`}>
        <defs>
          <pattern id="hc-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect x="0" y="0" width="2" height="6" fill="#ffffff" opacity=".7" />
            <rect x="3" y="0" width="2" height="6" fill="#1f2933" opacity=".35" />
          </pattern>
        </defs>
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
          const showLabel = i === 0 || (s.hour % 3 === 0 && cx - 14 >= nowEnd)
          return (
            <g key={s.time}>
              <g opacity={isNight(s.hour) ? 0.45 : 1}>
                <rect x={x} y={y} width={w} height={h} rx={3} fill={FILL[s.level]} fillOpacity={s.level === 'nodata' ? 0.7 : 1} stroke={s.level === 'nodata' ? '#5f6b7a' : 'none'} strokeDasharray="3 3" />
              </g>
              {missingNoise(s) && <rect x={x} y={y} width={w} height={h} rx={3} fill="url(#hc-hatch)" />}
              {hl && <rect x={x - 3} y={y - 3} width={w + 6} height={h + 6} rx={5} fill="none" stroke="#1f2933" strokeWidth={2} />}
              {s.soundN > 0 && <circle cx={cx} cy={y - (hl ? 9 : 5)} r={2.5} fill="#2f6f8f" />}
              {showLabel && (
                <text x={i === 0 && nowLabel ? padL : cx} y={H - 6} textAnchor={i === 0 && nowLabel ? 'start' : 'middle'} style={TEXT}>{labelOf(s, i)}</text>
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
      {scores.length > 0 && <p className="muted">{caption}</p>}
    </>
  )
}
