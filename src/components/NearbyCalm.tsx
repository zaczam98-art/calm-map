import type { Ref } from 'react'
import type { Level3 } from '../types'
import { LEVEL3_LABEL } from '../lib/index'
import { TXT } from '../lib/nearbyText'
import Fold from './Fold'

/** 후보 한 곳의 표시 내용. 문장은 PlaceDetail이 nearbyText.ts의 함수로 만들어 넘긴다. */
export interface NearbyRow {
  name: string
  level: Level3
  /** 직선 거리(km) */
  km: number
  /** '직선 N.Nkm · 지수 N' 조각 */
  meta: string
  /** 무던한 후보는 지속 문구, 보통 후보는 midText 결과 */
  sub: string
  far: boolean
  noNoise: boolean
  /** '이유 보기'에 쓰는 줄. 첫 줄이 요약이고 나머지는 항목별 줄 */
  why: string[]
}

interface Props {
  title: string
  basis: string
  noiseNote: string | null
  farTime: boolean
  alt: { text: string; button: string; onPick: () => void } | null
  rows: NearbyRow[]
  /** 후보가 없을 때의 문장 */
  empty: string
  isolated: boolean
  panel: string[]
  onSelect: (name: string) => void
  headingRef: Ref<HTMLHeadingElement>
  /** 기준 칸이 관측인지(관측이면 '무던한', 예측이면 '무던할'). 시트 위쪽 요약 단추와 같은 시제를 쓴다 */
  obs: boolean
  /** 시트 위쪽의 요약 단추가 이 카드를 펼칠 때 쓰는 접이식 참조 */
  foldRef: Ref<HTMLDetailsElement>
  /** 열림 상태가 바뀔 때(요약 단추의 aria-expanded를 맞추는 데 쓴다) */
  onToggle: (open: boolean) => void
}

const BRIEF_NAMES = 2 // 요약 줄에 이름을 적는 후보 수

/** 요약 줄 한 줄: 위쪽 요약 단추와 같은 말('더 무던한 곳', 예측이면 '더 무던할 곳')로 후보 수와 가까운 후보 이름을 적고, 같은 곳 다른 시간이 있으면 덧붙인다. 거리는 직선이라는 말을 붙여 이동 거리로 읽히지 않게 한다. */
function briefText(rows: NearbyRow[], alt: boolean, obs: boolean): string {
  const altNote = alt ? ' · 같은 곳 다른 시간 있음' : ''
  const calmer = obs ? '더 무던한 곳' : '더 무던할 곳'
  if (rows.length === 0) return `${calmer} 없음${altNote}`
  const names = rows.slice(0, BRIEF_NAMES).map((r) => `${r.name} 직선 ${r.km.toFixed(1)}km`).join(', ')
  return `${calmer} ${rows.length}곳: ${names}${rows.length > BRIEF_NAMES ? ' 등' : ''}${altNote}`
}

export default function NearbyCalm({ title, basis, noiseNote, farTime, alt, rows, empty, isolated, panel, onSelect, headingRef, obs, foldRef, onToggle }: Props) {
  return (
    <Fold title={title} brief={briefText(rows, !!alt, obs)} className="nearby-card" foldRef={foldRef} headingRef={headingRef} onToggle={onToggle}>
      <p className="muted">{basis}</p>
      {noiseNote && <p className="muted">{noiseNote}</p>}
      {farTime && <p className="muted">{TXT.farTime}</p>}
      <h4 className="sub">{TXT.altHead}</h4>
      {alt ? (
        <div className="nearby-alt">
          <p>{alt.text}</p>
          <button className="btn" onClick={alt.onPick}>{alt.button}</button>
        </div>
      ) : (
        <p className="muted">{TXT.altNone}</p>
      )}
      <h4 className="sub">{TXT.candHead}</h4>
      {rows.length === 0 ? (
        <p className="muted">{isolated ? `${empty} ${TXT.isolated}` : empty}</p>
      ) : (
        <>
          <ul className="nearby">
            {rows.map((r) => (
              <li key={r.name}>
                <button className="nearby-btn" onClick={() => onSelect(r.name)}>
                  <span className={`pill ${r.level}`}>{LEVEL3_LABEL[r.level]}</span>
                  <span className="nearby-name">{r.name}</span>
                  <span className="muted">{r.meta}</span>
                  <span className="nearby-sub muted">{r.sub}</span>
                  {(r.far || r.noNoise) && (
                    <span className="nearby-tags">
                      {r.far && <span className="nearby-far">{TXT.far}</span>}
                      {r.noNoise && <span className="nonoise">{TXT.noNoise}</span>}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {rows.some((r) => r.far) && <p className="muted nearby-note">{TXT.farNote}</p>}
          <p className="nearby-note">{TXT.safe}</p>
        </>
      )}
      <p className="muted nearby-note">{TXT.evidence}</p>
      {rows.length > 0 && (
        <details className="nearby-more">
          <summary>{TXT.whySummary}</summary>
          <div className="nearby-more-body">
            {rows.map((r) => (
              <div key={r.name}>
                <p>{r.why[0]}</p>
                {r.why.length > 1 && (
                  <ul>
                    {r.why.slice(1).map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
      <details className="nearby-more">
        <summary>{TXT.panelSummary}</summary>
        <div className="nearby-more-body">
          {panel.map((line) => (
            <p key={line} className="muted">{line}</p>
          ))}
        </div>
      </details>
    </Fold>
  )
}
