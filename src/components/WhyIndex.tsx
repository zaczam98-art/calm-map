import type { HourScore } from '../types'
import { LEVEL3_LABEL } from '../lib/index'
import { RECORD_LEGEND } from '../lib/recordEffect'
import { wordLines, wordsBrief } from '../lib/scoreWords'

interface Props {
  /** 설명할 칸(선택한 시각, 없으면 지금) */
  cell: HourScore
  /** '지금', '9시', '내일 9시' 같은 시각 이름 */
  label: string
  /** 소음 자료가 모은 날 수. 모르면 생략 */
  noiseDays?: number | null
  /** 맞춤을 켰는지, 켰다면 혼잡과 큰 소리에 곱한 민감도 */
  personal: { crowd: number; loud: number; sudden: number } | null
  /** 이 장소에 남긴 다녀온 기록 건수 */
  visits: number
  /** 접이식(Fold) 안에서 쓸 때 true: 카드 테두리와 제목을 그리지 않는다(제목은 접이식의 요약 줄이 맡는다) */
  bare?: boolean
}

const round = Math.round
const signed = (v: number) => (v > 0 ? `+${v}` : `${v}`)

/** 구성 요소별 누적값. 카드와 요약 한 줄이 같은 숫자를 쓰도록 한곳에서 계산한다. */
function breakdown(cell: HourScore) {
  const p = cell.parts
  if (!p || cell.index === null) return null
  const hasNoise = p.n !== null
  const hasSound = p.s !== null
  const afterNoise = round(p.base)
  const afterSound = hasSound ? round((1 - p.w) * p.base + p.w * (p.s as number)) : afterNoise
  // 화면에 보이는 정수끼리 더해서 지수가 되도록, 기록 보정은 마지막 단계와 지수의 차이로 보여 준다
  return { p, index: cell.index, hasNoise, hasSound, afterNoise, afterSound, adjust: cell.index - afterSound }
}

/** 접이식 요약 줄의 한 줄. 카드를 펼치지 않아도 지수의 요인이 낱말로 보인다. 설명할 칸이 없으면 null. */
export function whyBrief(cell: HourScore, sudden: number | null): string | null {
  return wordsBrief(cell, sudden)
}

/** 선택한 시각의 지수가 혼잡, 소음, 소리, 기록 보정을 차례로 더해 어떻게 만들어졌는지 보여 준다. 숫자는 hourScores가 계산한 parts에서, 낱말은 scoreWords에서 온다. */
export default function WhyIndex({ cell, label, noiseDays, personal, visits, bare }: Props) {
  const b = breakdown(cell)
  if (!b) return null
  const { p, hasNoise, hasSound, afterNoise, afterSound, adjust } = b

  const rows: { key: string; text: string; value: number; delta?: number }[] = [{ key: 'c', text: '혼잡만 보면', value: round(p.c) }]
  if (hasNoise) rows.push({ key: 'n', text: '소음을 더하면', value: afterNoise, delta: afterNoise - round(p.c) })
  if (hasSound) rows.push({ key: 's', text: '소리를 더하면', value: afterSound, delta: afterSound - afterNoise })

  const words = wordLines(cell, { days: noiseDays, sudden: personal ? personal.sudden : null })
  const evidence: string[] = []
  if (hasSound) evidence.push(`직접 잰 소리 표본 ${cell.soundN}개가 지수의 ${round(p.w * 100)}%를 차지해요.`)
  if (personal && personal.crowd !== 1) evidence.push(`혼잡 점수에는 '사람이 많은 곳' 민감도(${personal.crowd}배)를 곱했어요.`)
  if (personal && p.offset === 0) evidence.push(visits === 0 ? '이 장소는 다녀온 기록이 아직 없어서 기록 보정은 0이에요.' : `이 장소의 기록 보정은 0이에요(다녀온 기록 ${visits}건).`)
  if (personal && p.offset !== 0) evidence.push(RECORD_LEGEND) // 시트 머리의 '내 기록 반영' 칩 숫자의 뜻
  if (personal && personal.loud !== 1 && hasNoise) evidence.push(`소음 점수에는 '큰 소리' 민감도(${personal.loud}배)를 곱했어요.`)

  return (
    <div className={bare ? 'why' : 'card why'}>
      {!bare && <h3>{label} 지수는 왜 {cell.index}점일까요</h3>}
      <p className="muted">낮을수록 무던해요(0~100).</p>
      <ul className="why-words">
        {words.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
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
          <span className="why-bar" aria-hidden><i className={cell.level} style={{ width: `${b.index}%` }} /></span>
          <b className="why-v">{b.index}점</b>
          <span className="why-d">{LEVEL3_LABEL[cell.level]}</span>
        </li>
      </ol>
      {evidence.length > 0 && <p className="muted">{evidence.join(' ')}</p>}
    </div>
  )
}
