import type { Ref } from 'react'
import type { Level3 } from '../types'
import { LEVEL3_LABEL } from '../lib/index'
import { TXT } from '../lib/nearbyText'

/** 후보 한 곳의 표시 내용. 문장은 PlaceDetail이 nearbyText.ts의 함수로 만들어 넘긴다. */
export interface NearbyRow {
  name: string
  level: Level3
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
}

export default function NearbyCalm({ title, basis, noiseNote, farTime, alt, rows, empty, isolated, panel, onSelect, headingRef }: Props) {
  return (
    <div className="card nearby-card" style={{ marginTop: 12 }}>
      <h3 tabIndex={-1} ref={headingRef}>{title}</h3>
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
    </div>
  )
}
