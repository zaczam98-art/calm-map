import type { WeekPattern as WeekPatternData } from '../types'
import { kstNow } from '../lib/publicData'

const HOURS = Array.from({ length: 14 }, (_, i) => i + 8) // 8~21시
const DOWS: [number, string][] = [[1, '월'], [2, '화'], [3, '수'], [4, '목'], [5, '금'], [6, '토'], [0, '일']]
const SHADE = ['#e6ebf1', '#b9c4d2', '#8595ab', '#34445a']
const LABEL = ['여유', '보통', '약간 붐빔', '붐빔']
const MIN_DAYS = 3 // 관측일이 이보다 적으면 격자를 그리지 않고 자료가 적다는 안내만 보여 준다

/** 요일×시간대 혼잡도 패턴. 서울시 관측값을 모아 평균한 것이며 표본 수를 함께 밝힌다. */
export default function WeekPattern({ pattern, place }: { pattern: WeekPatternData | null; place: string }) {
  if (!pattern) return null
  const cells = pattern.places[place] ?? {}
  // 화면에 그리는 8~21시 칸의 표본만 센다
  const total = Object.entries(cells).reduce((a, [k, c]) => {
    const h = Number(k.split('-')[1])
    return h >= HOURS[0] && h <= HOURS[HOURS.length - 1] ? a + c[1] : a
  }, 0)
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
    <div className="card" style={{ marginTop: 12 }}>
      <h3>요일별 혼잡도 패턴</h3>
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
        </>
      )}
    </div>
  )
}
