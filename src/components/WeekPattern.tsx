import type { WeekPattern as WeekPatternData } from '../types'
import { kstNow } from '../lib/publicData'

const HOURS = Array.from({ length: 14 }, (_, i) => i + 8) // 8~21시
const DOWS: [number, string][] = [[1, '월'], [2, '화'], [3, '수'], [4, '목'], [5, '금'], [6, '토'], [0, '일']]
const SHADE = ['#e6ebf1', '#b9c4d2', '#8595ab', '#34445a']
const LABEL = ['여유', '보통', '약간 붐빔', '붐빔']
const MIN_DAYS = 3 // 관측일이 이보다 적으면 격자를 그리지 않고 자료가 적다는 안내만 보여 준다

// 화면에 그리는 8~21시 칸의 표본만 센다
function sampleTotal(cells: WeekPatternData['places'][string]): number {
  return Object.entries(cells).reduce((a, [k, c]) => {
    const h = Number(k.split('-')[1])
    return h >= HOURS[0] && h <= HOURS[HOURS.length - 1] ? a + c[1] : a
  }, 0)
}

// 요약 줄의 결론을 내는 묶음: 요일 2개 × 시간대 3개. 본문 설명 문장(BAND_NOTE)과 같은 경계를 쓴다.
const DAY_GROUPS: [string, number[]][] = [['평일', [1, 2, 3, 4, 5]], ['주말', [0, 6]]]
const BANDS: [string, number, number][] = [['오전', 8, 11], ['낮', 12, 16], ['저녁', 17, 21]]
const BAND_NOTE = '요약 줄은 월~금을 평일, 토·일을 주말로 묶고 8~11시를 오전, 12~16시를 낮, 17~21시를 저녁으로 묶어 평균한 값이에요.'
const MIN_GROUP_N = 3 // 묶음의 표본이 이보다 적으면 결론에서 뺀다
const MIN_SPREAD = 0.3 // 묶음 평균 단계(0~3)의 가장 낮은 값과 높은 값이 이보다 가까우면 차이가 없다고 본다
const TIE = 0.1 // 가장 낮은 값과 이 이내인 묶음은 같은 수준으로 보고 함께 적는다
const MAX_NAMED = 3 // 같은 수준인 묶음이 이보다 많으면 덜 붐빈 묶음을 늘어놓지 않고 더 붐빈 묶음을 적는다

/**
 * 요일×시간대 묶음별 평균 단계(표본 수로 가중)로 만든 요약 조각. 비교할 묶음이 둘 미만이면 null, 차이가 작으면 'flat'.
 * 가장 덜 붐빈 묶음이 여럿이면 함께 적고, 너무 많으면(대부분이 같은 수준이면) 더 붐빈 묶음만 적는다.
 */
function slotNote(cells: WeekPatternData['places'][string]): string | 'flat' | null {
  const slots: { name: string; mean: number }[] = []
  for (const [g, dows] of DAY_GROUPS) {
    for (const [b, from, to] of BANDS) {
      let n = 0
      let sum = 0
      for (const dow of dows) {
        for (let h = from; h <= to; h++) {
          const c = cells[`${dow}-${h}`]
          if (c) {
            n += c[1]
            sum += c[0] * c[1]
          }
        }
      }
      if (n >= MIN_GROUP_N) slots.push({ name: `${g} ${b}`, mean: sum / n })
    }
  }
  if (slots.length < 2) return null
  slots.sort((a, b) => a.mean - b.mean)
  const low = slots[0].mean
  if (slots[slots.length - 1].mean - low < MIN_SPREAD) return 'flat'
  const best = slots.filter((s) => s.mean <= low + TIE)
  if (best.length <= MAX_NAMED) return `${best.map((s) => s.name).join(', ')}이 가장 덜 붐볐어요`
  return `${slots.filter((s) => s.mean > low + TIE).map((s) => s.name).join(', ')}만 더 붐볐어요`
}

/** 접이식 요약 줄의 한 줄. 표본이 충분하면 어느 때가 가장 덜 붐볐는지 결론을 적는다. 패턴 자료가 없으면 null. */
export function weekBrief(pattern: WeekPatternData | null, place: string): string | null {
  if (!pattern) return null
  const cells = pattern.places[place] ?? {}
  const total = sampleTotal(cells)
  if (total === 0) return '자료를 모으는 중이에요'
  if (pattern.days < MIN_DAYS) return `관측 ${pattern.days}일치만 모였어요`
  const note = slotNote(cells)
  const basis = `관측 ${pattern.days}일 평균`
  if (note === null) return `${basis} · 표본 ${total}개`
  return `${note === 'flat' ? '요일과 시간대 차이가 크지 않았어요' : note} · ${basis}`
}

/** 요일×시간대 혼잡도 패턴. 서울시 관측값을 모아 평균한 것이며 표본 수를 함께 밝힌다. bare는 접이식 안에서 쓸 때 카드 테두리와 제목을 뺀다. */
export default function WeekPattern({ pattern, place, bare }: { pattern: WeekPatternData | null; place: string; bare?: boolean }) {
  if (!pattern) return null
  const cells = pattern.places[place] ?? {}
  const total = sampleTotal(cells)
  const now = kstNow()
  // 화면 낭독용: 요일마다 평균 단계가 가장 낮은 시간(표본이 있는 칸만, 같으면 이른 시간)
  const bestHours = DOWS.flatMap(([dow, name]) => {
    let best: { h: number; lv: number } | null = null
    for (const h of HOURS) {
      const c = cells[`${dow}-${h}`]
      if (!c) continue
      const lv = Math.max(0, Math.min(3, Math.round(c[0])))
      if (best === null || lv < best.lv) best = { h, lv }
    }
    return best ? [`${name} ${best.h}시`] : []
  })
  return (
    <div className={bare ? undefined : 'card'} style={bare ? undefined : { marginTop: 12 }}>
      {!bare && <h3>요일별 혼잡 패턴</h3>}
      {total === 0 ? (
        <p className="muted">자료를 모으는 중이에요. 며칠 뒤부터 요일과 시간대별 패턴이 채워져요.</p>
      ) : pattern.days < MIN_DAYS ? (
        <p className="muted">관측 {pattern.days}일치(이 장소의 8~21시 표본 {total}개)만 모였어요. 요일별 패턴은 관측일이 {MIN_DAYS}일 이상 쌓이면 보여 드려요.</p>
      ) : (
        <>
          <div className="week" role="img" aria-label={`${place}의 요일과 시간대별 평균 혼잡도${bestHours.length ? `. 관측 평균이 가장 낮은 시간: ${bestHours.join(', ')}` : ''}`}>
            <span />
            {HOURS.map((h) => (
              <span key={h} className="week-h">{h % 2 === 0 ? h : ''}</span>
            ))}
            {DOWS.map(([dow, name]) => (
              <div key={dow} style={{ display: 'contents' }}>
                <span className="week-d">{name}</span>
                {HOURS.map((h) => {
                  const c = cells[`${dow}-${h}`]
                  const isNow = dow === now.dow && h === now.hour
                  if (!c) return <span key={h} className={`week-c empty${isNow ? ' now' : ''}`} title={`${name} ${h}시: 표본 없음`} />
                  const lv = Math.max(0, Math.min(3, Math.round(c[0])))
                  return (
                    <span
                      key={h}
                      className={`week-c${c[1] === 1 ? ' thin' : ''}${isNow ? ' now' : ''}`}
                      style={{ background: SHADE[lv] }}
                      title={`${name} ${h}시: 평균 ${LABEL[lv]} (표본 ${c[1]}개)`}
                    />
                  )
                })}
              </div>
            ))}
          </div>
          <p className="week-legend">
            {LABEL.map((l, i) => (
              <span key={l}><i style={{ background: SHADE[i] }} />{l}</span>
            ))}
            <span><i className="empty" />표본 없음</span>
          </p>
          <p className="muted">
            서울시 혼잡도 관측값을 요일과 시간대별로 평균한 값이에요. 관측한 날은 {pattern.days}일이고 이 장소의 8~21시 표본은 {total}개예요.
            표본이 1개인 칸은 점선 테두리로 표시했고, 표본이 적은 동안에는 참고용으로만 봐 주세요.
          </p>
          <p className="muted">{BAND_NOTE}</p>
        </>
      )}
    </div>
  )
}
