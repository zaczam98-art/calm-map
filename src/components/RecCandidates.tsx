import type { ReactNode } from 'react'
import type { Level3 } from '../types'
import { LEVEL3_LABEL } from '../lib/index'
import { kmText } from '../lib/pick'
import { TXT } from '../lib/nearbyText'
import { EMPTY_BUTTON_TEXT, PICK, type EmptyButton, type EmptyView } from '../lib/pickText'
import '../styles/nonoise.css'

/** 후보 카드 한 장에 그릴 내용. 문장은 Recommend가 pickText.ts의 함수로 만들어 넘긴다. */
export interface CandCard {
  name: string
  index: number
  level: Level3
  /** 장소 분류 이름(없을 수 있음) */
  kind: string
  /** 기준까지의 직선 거리(km). 기준이 없으면 null */
  km: number | null
  /** 고른 기준 장소 자신인가 */
  isBase: boolean
  far: boolean
  reason: string
  /** 통제·비 꼬리표(최대 1개) */
  tag: string | null
  /** 내 기록 반영 칩 */
  chip: string | null
  /** 고른 항목의 말(혼잡이나 소음 낱말) */
  marker: string | null
  /** 가까이에 소음 센서가 없어 소음을 반영하지 못한 장소 */
  noMeter: boolean
}

interface Props {
  cards: CandCard[]
  /** 카드 아래(후보가 모자랄 때)나 카드 대신(후보가 없을 때) 보일 문장과 단추 */
  empty: EmptyView | null
  /** 카드 영역 대신 보일 한 줄(외출 시간이 지남, 자료 없음, 자료를 받는 중) */
  notice: { text: string; wait: boolean } | null
  onOpen: (name: string, card: Element) => void
  onEmptyButton: (b: EmptyButton) => void
}

const MAX_MARKS = 3 // 표지 줄에 그리는 표지의 최대 수

/**
 * 추천 탭의 후보 카드(최대 3장)와 빈 상태. 번호나 순위는 붙이지 않는다.
 * motion.ts의 tagCard가 '.rec-main b'와 '.rec-index'를 찾으므로 두 선택자를 유지한다.
 */
export default function RecCandidates({ cards, empty, notice, onOpen, onEmptyButton }: Props) {
  return (
    <div className={notice?.wait ? 'cand-wait' : undefined}>
      {notice && <p className="muted" role="status">{notice.text}</p>}
      {cards.length > 0 && (
        <ul className="rec-list cand-list">
          {cards.map((c) => {
            const meta: string[] = []
            if (c.kind) meta.push(c.kind)
            if (c.isBase) meta.push(PICK.baseSelf)
            else if (c.km !== null) meta.push(`직선 ${kmText(c.km)}km`)
            const marks: ReactNode[] = []
            if (c.tag) marks.push(<span key="tag" className="factor small">{c.tag}</span>)
            if (c.chip) marks.push(<span key="chip" className="recfx">{c.chip}</span>)
            if (c.marker) marks.push(<span key="marker" className="recfx">{c.marker}</span>)
            if (c.noMeter) marks.push(<span key="nonoise" className="nonoise small">{TXT.noNoise}</span>)
            return (
              <li key={c.name}>
                <button className="rec-item cand-item" onClick={(e) => onOpen(c.name, e.currentTarget)}>
                  <span className="cand-head rec-main">
                    <span className={`pill ${c.level}`}>{LEVEL3_LABEL[c.level]}</span> <b>{c.name}</b>{' '}
                    {meta.length > 0 && <span className="cand-meta">{meta.join(' · ')}</span>}
                    {c.far && <span className="nearby-far cand-far">{TXT.far}</span>}
                  </span>
                  <span className="rec-index" role="img" aria-label={`지수 ${c.index}점`}>
                    {c.index}
                    <small style={{ fontSize: 12, fontWeight: 400 }}>점</small>
                  </span>
                  <span className="cand-reason">{c.reason}</span>
                  {marks.length > 0 && <span className="cand-marks">{marks.slice(0, MAX_MARKS).flatMap((m, i) => (i > 0 ? [' ', m] : [m]))}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {empty && (
        <div className="cand-empty" role="status">
          <p className="muted">{empty.text}</p>
          {empty.buttons.length > 0 && (
            <div className="row">
              {empty.buttons.map((b) => (
                <button key={b} className="btn" onClick={() => onEmptyButton(b)}>
                  {EMPTY_BUTTON_TEXT[b]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
