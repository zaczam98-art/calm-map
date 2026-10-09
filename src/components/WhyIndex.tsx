import type { CongestLevel, HourScore } from '../types'
import { LEVEL3_LABEL } from '../lib/index'

interface Props {
  /** 설명할 칸(선택한 시각, 없으면 지금) */
  cell: HourScore
  /** '지금', '9시', '내일 9시' 같은 시각 이름 */
  label: string
  /** 그 칸의 서울시 혼잡 단계(예측 또는 관측). 모르면 생략 */
  crowdLevel?: CongestLevel
  /** 그 요일·시간대 주변 센서의 평균 소음(dB). 자료가 없으면 생략 */
  noiseAvg?: number
  /** 맞춤을 켰는지, 켰다면 혼잡과 큰 소리에 곱한 민감도 */
  personal: { crowd: number; loud: number; sudden: number } | null
  /** 이 장소에 남긴 다녀온 기록 건수 */
  visits: number
}

const round = Math.round
const signed = (v: number) => (v > 0 ? `+${v}` : `${v}`)

/** 선택한 시각의 지수가 혼잡, 소음, 소리, 기록 보정을 차례로 더해 어떻게 만들어졌는지 보여 준다. 값은 모두 hourScores가 계산한 parts에서 온다. */
export default function WhyIndex({ cell, label, crowdLevel, noiseAvg, personal, visits }: Props) {
  const p = cell.parts
  if (!p || cell.index === null) return null
  const hasNoise = p.n !== null
  const hasSound = p.s !== null
  const afterNoise = round(p.base)
  const afterSound = hasSound ? round((1 - p.w) * p.base + p.w * (p.s as number)) : afterNoise
  // 화면에 보이는 정수끼리 더해서 지수가 되도록, 기록 보정은 마지막 단계와 지수의 차이로 보여 준다
  const adjust = cell.index - afterSound

  const rows: { key: string; text: string; value: number; delta?: number }[] = [{ key: 'c', text: '혼잡만 보면', value: round(p.c) }]
  if (hasNoise) rows.push({ key: 'n', text: '소음을 더하면', value: afterNoise, delta: afterNoise - round(p.c) })
  if (hasSound) rows.push({ key: 's', text: '소리를 더하면', value: afterSound, delta: afterSound - afterNoise })

  const evidence: string[] = []
  if (crowdLevel) evidence.push(`${cell.forecast ? '혼잡 예측' : '혼잡 관측'}은 '${crowdLevel}' 단계${hasNoise && noiseAvg !== undefined ? '이고,' : '예요.'}`)
  if (hasNoise && noiseAvg !== undefined) evidence.push(`평소 이 시간 주변 소음은 평균 ${round(noiseAvg)}dB예요.`)
  if (!hasNoise) evidence.push('이 시간대는 주변 소음 자료가 없어서 혼잡만 반영했어요.')
  if (hasSound) evidence.push(`직접 잰 소리 표본 ${cell.soundN}개가 지수의 ${round(p.w * 100)}%를 차지해요.`)
  if (personal && personal.crowd !== 1) evidence.push(`혼잡 점수에는 '사람이 많은 곳' 민감도(${personal.crowd}배)를 곱했어요.`)
  if (personal && p.offset === 0) evidence.push(visits === 0 ? '이 장소는 다녀온 기록이 아직 없어서 기록 보정은 0이에요.' : `이 장소의 기록 보정은 0이에요(다녀온 기록 ${visits}건).`)
  if (personal && personal.loud !== 1 && hasNoise) evidence.push(`소음 점수에는 '큰 소리' 민감도(${personal.loud}배)를 곱했어요.`)
  if (personal && personal.sudden !== 1 && hasNoise) evidence.push(`소음의 큰 소리 가산에는 사이렌·경적·알람 민감도(${personal.sudden}배)를 곱했어요.`)

  return (
    <div className="card why">
      <h3>{label} 지수는 왜 {cell.index}점일까요</h3>
      <ol className="why-rows">
        {rows.map((r) => (
          <li key={r.key}>
            <span className="why-l">{r.text}</span>
            <span className="why-bar" aria-hidden><i style={{ width: `${Math.min(100, r.value)}%` }} /></span>
            <b className="why-v">{r.value}</b>
            {r.delta !== undefined && <span className="why-d">{signed(r.delta)}</span>}
          </li>
        ))}
        {personal && (
          <li>
            <span className="why-l">기록 보정</span>
            <span className="why-bar" aria-hidden />
            <b className="why-v">{signed(adjust)}</b>
          </li>
        )}
        <li className="why-sum">
          <span className="why-l">지수</span>
          <span className="why-bar" aria-hidden><i className={cell.level} style={{ width: `${cell.index}%` }} /></span>
          <b className="why-v">{cell.index}점</b>
          <span className="why-d">{LEVEL3_LABEL[cell.level]}</span>
        </li>
      </ol>
      <p className="muted">{evidence.join(' ')}</p>
    </div>
  )
}
