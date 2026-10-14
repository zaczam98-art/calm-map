import { useEffect, useRef, useState } from 'react'
import { hasStoredProfile } from '../lib/landing'
import { CARDS, CARDS_TITLE, DATA_ITEMS, DATA_LINK, DATA_TITLE, HERO, START } from '../lib/landingCopy'
import '../styles/landing.css'

interface Props {
  placeCount: number
  /** 헤더 제목이나 링크로 들어왔을 때만 제목으로 초점을 보낸다(처음 열 때는 옮기지 않는다) */
  focusHeading: boolean
  onMap: () => void
  /** 저장된 아이 설정이 없으면 칩 질문 시트를, 있으면 우리 아이 탭을 연다 */
  onPick: (hasProfile: boolean) => void
  onInfo: () => void
}

export default function Landing({ placeCount, focusHeading, onMap, onPick, onInfo }: Props) {
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
            <div className="lp-hero-text">
              <h1 id="lp-h1" ref={h1} tabIndex={-1}>{HERO.h1}</h1>
              <p className="lp-lead">{HERO.lead}</p>
              <p className="lp-sub">{HERO.sub(placeCount)}</p>
              <p className="lp-dotnote">{HERO.dotNote}</p>
              <ul className="lp-legend" aria-label={HERO.legendLabel}>
                {(['calm', 'mid', 'busy'] as const).map((k, i) => (
                  <li key={k}>
                    <span className={`lp-dot ${k}`} aria-hidden="true" />
                    {HERO.legend[i]}
                  </li>
                ))}
              </ul>
            </div>

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
            <ul className="lp-cards">
              {CARDS.map((c) => (
                <li className="lp-card" key={c.title}>
                  <h3>{c.title}</h3>
                  <p>{c.body}</p>
                </li>
              ))}
            </ul>
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
