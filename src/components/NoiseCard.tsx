import { useState } from 'react'
import type { NoiseData } from '../types'
import { kstNow } from '../lib/publicData'

const DOWS: [number, string][] = [[1, '월'], [2, '화'], [3, '수'], [4, '목'], [5, '금'], [6, '토'], [0, '일']]
const DB_MIN = 30
const DB_MAX = 80

/** 장소 주변의 소음 실측(서울시 S-DoT 센서). 소리의 크기만 보여 주며 지수 계산에는 넣지 않는다. */
export default function NoiseCard({ noise, place }: { noise: NoiseData | null; place: string }) {
  const now = kstNow()
  const [dow, setDow] = useState<number | null>(null)
  if (!noise) return null
  const p = noise.places[place]
  if (!p) {
    return (
      <div className="card" style={{ marginTop: 12 }}>
        <h2>이 동네의 소리 크기</h2>
        <p className="muted">가까운 곳(직선 1km 안)에 쓸 수 있는 서울시 소음 센서가 없어요. 센서가 없거나, 값이 변하지 않아 고장으로 보이는 센서만 있는 경우예요.</p>
      </div>
    )
  }
  const [h0] = noise.hours
  const available = DOWS.filter(([d]) => p.avg[String(d)])
  const chosen = dow !== null && p.avg[String(dow)] ? dow : p.avg[String(now.dow)] ? now.dow : available[0]?.[0]
  if (chosen === undefined) return null
  const avg = p.avg[String(chosen)]
  const max = p.max[String(chosen)]
  const dowName = DOWS.find(([d]) => d === chosen)![1]
  const cells = avg.map((v, i) => ({ hour: h0 + i, avg: v, max: max[i] })).filter((c): c is { hour: number; avg: number; max: number | null } => c.avg !== null)
  const day = cells.filter((c) => c.hour >= 8 && c.hour <= 21)
  const quiet = day.length ? day.reduce((a, c) => (c.avg < a.avg ? c : a)) : null
  const loud = day.length ? day.reduce((a, c) => (c.avg > a.avg ? c : a)) : null
  const cur = chosen === now.dow ? cells.find((c) => c.hour === now.hour) : undefined

  const W = 360
  const H = 120
  const padL = 26
  const padB = 20
  const bw = (W - padL - 4) / avg.length
  const y = (db: number) => H - padB - ((Math.max(DB_MIN, Math.min(DB_MAX, db)) - DB_MIN) / (DB_MAX - DB_MIN)) * (H - padB - 6)

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h2>이 동네의 소리 크기</h2>
      <div className="row" role="group" aria-label="요일">
        {DOWS.map(([d, name]) => (
          <button key={d} className={`chip small${d === chosen ? ' on' : ''}`} onClick={() => setDow(d)} disabled={!p.avg[String(d)]} aria-pressed={d === chosen}>{name}</button>
        ))}
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${place} 주변의 ${dowName}요일 시간대별 소음`} style={{ height: 120 }}>
        {[40, 60, 80].map((db) => (
          <g key={db}>
            <line x1={padL} x2={W} y1={y(db)} y2={y(db)} stroke="#e3e7ec" strokeDasharray="3 3" />
            <text x={0} y={y(db) + 4}>{db}</text>
          </g>
        ))}
        {avg.map((v, i) => {
          const hour = h0 + i
          const x = padL + i * bw + 2
          const isNow = chosen === now.dow && hour === now.hour
          return (
            <g key={hour}>
              {v !== null && <rect x={x} y={y(v)} width={bw - 4} height={H - padB - y(v)} rx={3} fill="#8595ab" stroke={isNow ? '#2f6f8f' : 'none'} strokeWidth={isNow ? 2 : 0} />}
              {v !== null && max[i] !== null && <line x1={x} x2={x + bw - 4} y1={y(max[i] as number)} y2={y(max[i] as number)} stroke="#34445a" strokeWidth={2} />}
              {hour % 3 === 0 && <text x={x + (bw - 4) / 2} y={H - 5} textAnchor="middle">{hour}시</text>}
            </g>
          )
        })}
      </svg>
      <p className="muted">막대는 그 시간의 평균 소음(dB), 위의 짧은 선은 그 시간에 난 큰 소리의 보통 수준이에요.</p>
      {cur && <p>지금 시간대({dowName}요일 {cur.hour}시)에는 평균 {cur.avg}dB{cur.max !== null ? `, 큰 소리는 ${cur.max}dB 안팎` : ''}이었어요.</p>}
      {quiet && loud && quiet.hour !== loud.hour && (
        <p>{dowName}요일 낮(8~21시)에는 {quiet.hour}시가 가장 조용했고(평균 {quiet.avg}dB), {loud.hour}시가 가장 시끄러웠어요(평균 {loud.avg}dB).</p>
      )}
      <p className="muted">
        가까운 서울시 센서 {p.sensors}개(직선 {p.km[0]}~{p.km[1]}km)가 {noise.from}부터 {noise.to}까지 잰 값이에요({noise.days}일 치, 센서·시간 {p.n}건).
        {p.excluded ? ` 값이 변하지 않아 고장으로 보이는 센서 ${p.excluded}개는 뺐어요.` : ''}
        센서는 길가에 있어서 장소 안쪽과 다를 수 있고, 소리의 크기만 재요. 소리의 종류는 현장 측정에서 분류하고, 이 값은 아직 지수 계산에 넣지 않았어요.
      </p>
    </div>
  )
}
