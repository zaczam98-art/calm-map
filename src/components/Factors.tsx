import type { PlaceExtra } from '../types'
import { activeControls, controlLabel, factorTags } from '../lib/factors'
import { kstNow } from '../lib/publicData'

function activeExtra(extra: PlaceExtra): PlaceExtra {
  const k = kstNow()
  const nowStr = `${k.date} ${String(k.hour).padStart(2, '0')}:00`
  // 해제 예정 시각이 지난 통제는 보여 주지 않는다(수집이 늦어 오래된 스냅샷일 때의 안전장치)
  return activeControls(extra, nowStr) ?? extra
}

/** 접이식 요약 줄의 한 줄('행사 1건 · 통제 없음 · 비 예보 없음'). 카드와 같은 자료에서 센다. fromHour를 주면(고른 시각이 오늘일 때) 비 예보는 그 시각 이후만 본 것이라 기준 시각을 붙인다. 자료가 없으면 null. */
export function factorsBrief(extra: PlaceExtra | undefined, fromHour?: number): string | null {
  if (!extra) return null
  const shown = activeExtra(extra)
  const tags = factorTags(shown)
  const controls = shown.controls ?? []
  const events = shown.eventsN ?? shown.events?.length ?? 0
  const parts = [events ? `행사 ${events}건` : '행사 없음', controls.length ? `통제 ${shown.controlsN || controls.length}건` : '통제 없음']
  if (extra.weather) parts.push(tags.find((t) => t.key === 'rain')?.label ?? (fromHour === undefined ? '비 예보 없음' : `${fromHour}시 이후 비 예보 없음`))
  for (const t of tags) if (t.key === 'uv' || t.key === 'air' || t.key === 'road') parts.push(t.label)
  return parts.join(' · ')
}

/** 혼잡도 외에 오늘 이 장소 주변에서 일어나는 일(공사·집회 통제, 행사, 날씨, 도로). 서울시 자료에 있는 사실만 옮긴다. bare는 접이식 안에서 쓸 때 카드 테두리와 제목을 뺀다. */
export default function Factors({ extra, fromHour, bare }: { extra: PlaceExtra | undefined; fromHour?: number; bare?: boolean }) {
  if (!extra) return null
  const shown = activeExtra(extra)
  const controls = shown.controls ?? []
  const tags = factorTags(shown)
  const w = extra.weather
  return (
    <div className={bare ? undefined : 'card'} style={bare ? undefined : { marginTop: 12 }}>
      {!bare && <h3>오늘 이 장소 주변</h3>}
      {tags.length > 0 ? (
        <p className="factor-tags">
          {tags.map((t) => (
            <span key={t.key} className="factor">{t.label}</span>
          ))}
        </p>
      ) : (
        <p className="muted">
          {fromHour === undefined
            ? '서울시 자료에 오늘 등록된 공사·집회 통제나 행사, 비 예보가 없어요.'
            : `서울시 자료에 오늘 등록된 공사·집회 통제나 행사가 없고, ${fromHour}시 이후 비 예보도 없어요.`}
        </p>
      )}
      {controls.length > 0 && (
        <>
          <h4 className="sub">공사·집회·통제 {extra.controlsN && extra.controlsN > controls.length ? `${extra.controlsN}건 중 ${controls.length}건` : `${controls.length}건`}</h4>
          <ul className="facts">
            {controls.map((c, i) => (
              <li key={i}>
                <b>{controlLabel(c.type)}</b> {c.info}
                {c.until ? ` (${c.until.slice(5)}까지)` : ''}
              </li>
            ))}
          </ul>
          {controls.some((c) => c.type === '공사' || c.type === '집회및행사') && <p className="muted">공사나 집회가 있으면 소리가 평소보다 커질 수 있어요.</p>}
        </>
      )}
      {extra.events && extra.events.length > 0 && (
        <>
          <h4 className="sub">근처 문화행사 {extra.eventsN && extra.eventsN > extra.events.length ? `${extra.eventsN}건 중 ${extra.events.length}건` : `${extra.events.length}건`}</h4>
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
          날씨: 기온 {w.temp ?? '?'}도, 강수 {w.pcp ?? '정보 없음'}, 자외선 {w.uv ?? '정보 없음'}, 초미세먼지 {w.pm25 ?? '정보 없음'}, 미세먼지 {w.pm10 ?? '정보 없음'}이에요.
          {extra.road ? ` 주변 도로는 ${extra.road.idx} 상태예요.` : ''}
        </p>
      )}
      <p className="muted">서울시 실시간 도시데이터에 등록된 내용을 그대로 옮긴 것이에요. 등록되지 않은 공사나 행사는 나오지 않아요.</p>
    </div>
  )
}
