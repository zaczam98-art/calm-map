import { useEffect, useRef, useState } from 'react'
import { hasStoredProfile } from '../lib/landing'
import type { Snapshot } from '../types'
import { CARDS, CARDS_TITLE, DATA_ITEMS, DATA_LINK, DATA_TITLE, HERO, START } from '../lib/landingCopy'
import DotField from './DotField'
import '../styles/landing.css'

interface Props {
  placeCount: number
  /** 장소 점을 칠하는 자료. 서울시 실제 자료일 때만 단계 색이고, 데모 데이터이거나 없으면 점이 회색이다 */
  snap: Snapshot | null
  /** 헤더 제목이나 링크로 들어왔을 때만 제목으로 초점을 보낸다(처음 열 때는 옮기지 않는다) */
  focusHeading: boolean
  onMap: () => void
  /** 저장된 아이 설정이 없으면 칩 질문 시트를, 있으면 우리 아이 탭을 연다 */
  onPick: (hasProfile: boolean) => void
  onInfo: () => void
}

/** 첫 화면 그림의 막대: [시, 높이(%), 단계]. 실제 자료가 아닌 예시다(그림 아래에 예시라고 적는다). */
const STRIP: [number, number, 'calm' | 'mid' | 'busy'][] = [
  [8, 22, 'calm'], [9, 28, 'calm'], [10, 46, 'mid'], [11, 62, 'mid'], [12, 82, 'busy'], [13, 90, 'busy'], [14, 70, 'busy'],
  [15, 52, 'mid'], [16, 48, 'mid'], [17, 74, 'busy'], [18, 58, 'mid'], [19, 30, 'calm'], [20, 20, 'calm'],
]

export default function Landing({ placeCount, snap, focusHeading, onMap, onPick, onInfo }: Props) {
  const h1 = useRef<HTMLHeadingElement>(null)
  const [saved] = useState(hasStoredProfile)

  useEffect(() => {
    if (focusHeading) h1.current?.focus()
  }, [focusHeading])

  return (
    <div className="lp">
      <div className="lp-wrap">
        <header className="lp-top">
          <p className="lp-brand">무던한 지도</p>
        </header>
        <main>
          <section className="lp-hero" aria-labelledby="lp-h1">
            {/* 장식: 글자와 겹치지 않는 자리(휴대폰은 머리 줄의 빈 오른쪽, 넓은 화면은 오른쪽 위)에만 놓는다 */}
            <DotField snap={snap} />
            <div className="lp-hero-text">
              <h1 id="lp-h1" ref={h1} tabIndex={-1}>{HERO.h1}</h1>
              <p className="lp-lead">{HERO.lead}</p>
              <p className="lp-sub">{HERO.sub(placeCount)}</p>
            </div>

            {/* 첫 화면의 단 하나의 그림: 한 장소의 하루 막대. 서비스가 실제로 보여 주는 장소 시트의 막대와 같은 모양이다. */}
            <figure className="lp-day">
              <div className="lp-strip" role="img" aria-label={HERO.stripLabel}>
                <span className="lp-calmband" aria-hidden="true">{HERO.stripCalm}</span>
                {STRIP.map(([h, v, k], i) => (
                  <span key={h} className={`lp-bar ${k}`} style={{ height: `${v}%`, animationDelay: `${i * 40}ms` }} aria-hidden="true">
                    {h % 3 === 2 && <i>{h}시</i>}
                  </span>
                ))}
              </div>
              <figcaption>
                <ul className="lp-legend" aria-label={HERO.legendLabel}>
                  {(['calm', 'mid', 'busy'] as const).map((k, i) => (
                    <li key={k}>
                      <span className={`lp-dot ${k}`} aria-hidden="true" />
                      {HERO.legend[i]}
                    </li>
                  ))}
                </ul>
                <span className="lp-cap">{HERO.stripCaption}</span>
              </figcaption>
            </figure>

            <div className="lp-act" role="group" aria-labelledby="lp-q">
              <p className="lp-q" id="lp-q">{START.question}</p>
              <button type="button" className="lp-go primary" aria-labelledby="lp-a-t" aria-describedby="lp-a-d" onClick={onMap}>
                <b id="lp-a-t">{START.mapTitle}</b>
                <span id="lp-a-d">{START.mapDesc}</span>
              </button>
              <button type="button" className="lp-go secondary" aria-labelledby="lp-b-t" aria-describedby="lp-b-d" onClick={() => onPick(saved)}>
                <b id="lp-b-t">{saved ? START.savedTitle : START.pickTitle}</b>
                <span id="lp-b-d">{saved ? START.savedDesc : START.pickDesc}</span>
              </button>
              <p className="lp-note">{saved ? START.noteSaved : START.note}</p>
            </div>
          </section>

          <section className="lp-section" aria-labelledby="lp-h-use">
            <h2 id="lp-h-use">{CARDS_TITLE}</h2>
            {/* 지도에서 시간 고르기, 아이에 맞추기, 다녀온 뒤 남기기는 실제로 쓰는 순서라 번호 목록으로 둔다 */}
            <ol className="lp-steps">
              {CARDS.map((c) => (
                <li className="lp-step" key={c.title}>
                  <h3>{c.title}</h3>
                  <p>{c.body}</p>
                </li>
              ))}
            </ol>
          </section>

          <section className="lp-section" aria-labelledby="lp-h-info">
            <h2 id="lp-h-info">{DATA_TITLE}</h2>
            <div className="lp-info">
              <dl>
                {DATA_ITEMS.map((d) => (
                  <div key={d.term}>
                    <dt>{d.term}</dt>
                    <dd>{d.desc}</dd>
                  </div>
                ))}
              </dl>
              <a
                className="lp-more"
                href="#/info"
                onClick={(e) => {
                  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
                  e.preventDefault()
                  onInfo()
                }}
              >
                {DATA_LINK}
              </a>
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}
