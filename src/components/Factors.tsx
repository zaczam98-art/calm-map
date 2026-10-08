import type { PlaceExtra } from '../types'
import { controlLabel, factorTags } from '../lib/factors'

/** 혼잡도 외에 오늘 이 장소 주변에서 일어나는 일(공사·집회 통제, 행사, 날씨, 도로). 서울시 자료에 있는 사실만 옮긴다. */
export default function Factors({ extra }: { extra: PlaceExtra | undefined }) {
  if (!extra) return null
  const tags = factorTags(extra)
  const w = extra.weather
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h2>오늘 이 장소 주변</h2>
      {tags.length > 0 ? (
        <p className="factor-tags">
          {tags.map((t) => (
            <span key={t.key} className="factor">{t.label}</span>
          ))}
        </p>
      ) : (
        <p className="muted">서울시 자료에 오늘 등록된 공사·집회 통제나 행사, 비 예보가 없어요.</p>
      )}
      {extra.controls && extra.controls.length > 0 && (
        <>
          <h3 className="sub">공사·집회·통제 {extra.controlsN}건</h3>
          <ul className="facts">
            {extra.controls.map((c, i) => (
              <li key={i}>
                <b>{controlLabel(c.type)}</b> {c.info}
                {c.until ? ` (${c.until.slice(5)}까지)` : ''}
              </li>
            ))}
          </ul>
          <p className="muted">공사나 집회가 있으면 큰 소리가 날 수 있어요.</p>
        </>
      )}
      {extra.events && extra.events.length > 0 && (
        <>
          <h3 className="sub">근처 문화행사 {extra.eventsN}건</h3>
          <ul className="facts">
            {extra.events.map((e, i) => (
              <li key={i}>
                {e.name} <span className="muted">{e.place}{e.short ? ' · 기간이 짧은 행사' : ''}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {w && (
        <p className="muted">
          날씨: 기온 {w.temp ?? '?'}도, 강수 {w.pcp ?? '정보 없음'}, 자외선 {w.uv ?? '정보 없음'}, 초미세먼지 {w.pm25 ?? '정보 없음'}
          {extra.road ? `. 주변 도로는 ${extra.road.idx}` : ''}.
        </p>
      )}
      <p className="muted">서울시 실시간 도시데이터에 등록된 내용을 그대로 옮긴 것이에요. 등록되지 않은 공사나 행사는 나오지 않아요.</p>
    </div>
  )
}
