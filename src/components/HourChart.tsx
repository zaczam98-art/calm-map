import type { HourScore, Level3 } from '../types'

const FILL: Record<Level3, string> = { calm: '#d9e1ea', mid: '#8595ab', busy: '#34445a', nodata: '#c9cdd3' }

export default function HourChart({ scores, highlight }: { scores: HourScore[]; highlight: number | null }) {
  const W = 360
  const H = 160
  const padL = 24
  const padB = 22
  const n = Math.max(scores.length, 1)
  const bw = (W - padL - 4) / n
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="시간대별 감각부하 지수 그래프">
      {[35, 65].map((y) => (
        <line key={y} x1={padL} x2={W} y1={H - padB - (y / 100) * (H - padB - 8)} y2={H - padB - (y / 100) * (H - padB - 8)} stroke="#e3e7ec" strokeDasharray="3 3" />
      ))}
      {scores.map((s, i) => {
        const v = s.index ?? 0
        const h = (v / 100) * (H - padB - 8)
        const x = padL + i * bw + 2
        const y = H - padB - h
        const hl = highlight !== null && s.hour === highlight
        return (
          <g key={s.time}>
            <rect x={x} y={y} width={bw - 4} height={h} rx={3} fill={FILL[s.level]} stroke={hl ? '#2f6f8f' : 'none'} strokeWidth={hl ? 2 : 0} />
            {s.soundN > 0 && <circle cx={x + (bw - 4) / 2} cy={y - 5} r={2.5} fill="#2f6f8f" />}
            {(i === 0 || s.hour % 3 === 0) && (
              <text x={x + (bw - 4) / 2} y={H - 6} textAnchor="middle">{i === 0 ? '지금' : `${s.hour}시`}</text>
            )}
          </g>
        )
      })}
      <text x={0} y={H - padB - (35 / 100) * (H - padB - 8) + 4}>35</text>
      <text x={0} y={H - padB - (65 / 100) * (H - padB - 8) + 4}>65</text>
    </svg>
  )
}
