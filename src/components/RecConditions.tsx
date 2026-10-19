import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { placeLabel, type Place } from '../types'
import { matchesPlace } from '../lib/hangul'
import { GROUPS, type NoiseGap, type Phase, type Priority } from '../lib/pick'
import { guideText, PICK, placeNoneText, PRIORITIES, whenText, whereText } from '../lib/pickText'
import type { RecommendUi, Where } from '../lib/recPrefs'

type PanelKey = 'where' | 'when' | 'what'

const MAX_RESULTS = 5 // 장소 검색 결과로 보여 주는 최대 수

const chipClass = (on: boolean) => (on ? 'chip on' : 'chip')

interface Props {
  places: Place[]
  ui: RecommendUi
  /** 내 위치가 아직 없으면 all로 본 값 */
  where: Where
  /** 고른 시각(null=지금)을 지금의 선택지에 맞춘 값 */
  when: number | null
  /** 오늘 남은 외출 시각(시) 선택지 */
  slots: number[]
  phase: Phase
  /** 오늘 이후 날짜의 칸이 있는가(22시 이후 지도 탭 안내를 붙일지) */
  hasLater: boolean
  hasOrigin: boolean
  /** '소음이 덜한 곳'을 소음으로 가를 수 없을 때의 이유(안내 줄이 순서를 적용하지 못했다고 밝힌다) */
  noiseGap: NoiseGap
  geoMsg: string | null
  onPatch: (p: Partial<RecommendUi>) => void
  /** 위치를 확인한다. 성공했을 때만 done을 부른다. */
  onLocate: (done: () => void) => void
  onAnchor: (name: string) => void
  onClearAnchor: () => void
}

/** 후보 3곳의 조건 세 가지(어디서, 언제, 어떤 곳)와 '오늘은 이게 더 중요해요' 칩. 조건은 단추 아래에 패널로 열리고 한 번에 하나만 열린다. */
export default function RecConditions({ places, ui, where, when, slots, phase, hasLater, hasOrigin, noiseGap, geoMsg, onPatch, onLocate, onAnchor, onClearAnchor }: Props) {
  const [open, setOpen] = useState<PanelKey | null>(null)
  const [showPlace, setShowPlace] = useState(false)
  const [placeQ, setPlaceQ] = useState('')
  const triggers = useRef<Partial<Record<PanelKey, HTMLButtonElement | null>>>({})
  const focusPanel = useRef(false)

  const stations = useMemo(() => places.filter((p) => p.category === '인구밀집지역').sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)), [places])
  const q = placeQ.trim()
  const found = q ? places.filter((p) => matchesPlace(p.name, q)) : []

  // 우선순위 칩이 어디서 패널을 열었을 때는 패널 첫 단추로 초점을 보낸다
  useEffect(() => {
    if (open === 'where' && focusPanel.current) {
      focusPanel.current = false
      document.getElementById('rec-panel-where')?.querySelector('button')?.focus()
    }
  }, [open])

  const toggle = (k: PanelKey) => {
    setPlaceQ('')
    setShowPlace(k === 'where' && where === 'place')
    setOpen(open === k ? null : k)
  }
  const closeTo = (k: PanelKey) => {
    setOpen(null)
    triggers.current[k]?.focus()
  }
  const pickPriority = (key: Priority) => {
    onPatch({ priority: ui.priority === key ? null : key })
    if (key === 'near' && ui.priority !== 'near' && !hasOrigin) {
      focusPanel.current = true
      setPlaceQ('')
      setShowPlace(false)
      setOpen('where')
    }
  }

  const conds: { key: PanelKey; label: string; value: string }[] = [
    { key: 'where', label: PICK.slotWhere, value: whereText(where, ui.anchor) },
    { key: 'when', label: PICK.slotWhen, value: whenText(when) },
    { key: 'what', label: PICK.slotWhat, value: GROUPS[ui.group][0] },
  ]
  const optionRow = (children: ReactNode) => <div className="rec-opts">{children}</div>

  // 패널은 자기 단추 바로 뒤에 그린다. Tab 순서가 단추 다음에 그 패널의 컨트롤이 되고, 화면에서는 CSS 격자가 단추 줄 아래로 보낸다.
  const panels: Record<PanelKey, ReactNode> = {
    where: (
      <div id="rec-panel-where" className="rec-panel" role="group" aria-label="어디서 찾을지 고르기" hidden={open !== 'where'}>
        {open === 'where' && (
          <>
            {optionRow(
              <>
                <button
                  type="button"
                  className={chipClass(where === 'all')}
                  aria-pressed={where === 'all'}
                  onClick={() => {
                    if (ui.anchor) onClearAnchor()
                    else onPatch({ where: 'all' })
                    closeTo('where')
                  }}
                >
                  {PICK.whereAll}
                </button>
                <button type="button" className={chipClass(where === 'gps')} aria-pressed={where === 'gps'} onClick={() => onLocate(() => closeTo('where'))}>
                  {PICK.whereGps}
                </button>
                <button
                  type="button"
                  className={chipClass(where === 'place')}
                  aria-pressed={where === 'place'}
                  onClick={() => {
                    setShowPlace(true)
                    if (ui.anchor && where !== 'place') onPatch({ where: 'place' })
                  }}
                >
                  {PICK.wherePlace}
                </button>
              </>,
            )}
            {showPlace && (
              <div className="rec-place">
                <div className="search">
                  <input type="search" aria-label={PICK.placeLabel} value={placeQ} onChange={(e) => setPlaceQ(e.target.value)} placeholder={PICK.placePlaceholder} autoComplete="off" spellCheck={false} />
                </div>
                {q ? (
                  found.length > 0 ? (
                    <>
                      <ul className="rec-picks">
                        {found.slice(0, MAX_RESULTS).map((p) => (
                          <li key={p.name}>
                            <button
                              type="button"
                              className="rec-pick"
                              onClick={() => {
                                onAnchor(p.name)
                                closeTo('where')
                              }}
                            >
                              <b>{p.name}</b> <span className="muted">{placeLabel(p)}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                      {found.length > MAX_RESULTS && <p className="muted">{PICK.placeMore}</p>}
                    </>
                  ) : (
                    <p className="muted" role="status">{placeNoneText(places.length)}</p>
                  )
                ) : (
                  <>
                    <p className="muted">{PICK.placeHint}</p>
                    <ul className="rec-picks scroll">
                      {stations.map((p) => (
                        <li key={p.name}>
                          <button
                            type="button"
                            className="rec-pick"
                            onClick={() => {
                              onAnchor(p.name)
                              closeTo('where')
                            }}
                          >
                            <b>{p.name}</b>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <p className="muted">{PICK.placeHelp}</p>
              </div>
            )}
            <p className="muted">{PICK.gpsNote}</p>
            <p className="muted rec-geo" role="status">{geoMsg ?? ''}</p>
            {ui.anchor && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  onClearAnchor()
                  closeTo('where')
                }}
              >
                {PICK.clearAnchor}
              </button>
            )}
          </>
        )}
      </div>
    ),
    when: (
      <div id="rec-panel-when" className="rec-panel" role="group" aria-label="언제 갈지 고르기" hidden={open !== 'when'}>
        {open === 'when' && (
          <>
            {phase === 'before' && <p className="muted">{PICK.before}</p>}
            {phase === 'after' && <p className="muted">{PICK.after}</p>}
            {phase === 'after' && hasLater && <p className="muted">{PICK.laterNote}</p>}
            {optionRow(
              <>
                {phase === 'now' && (
                  <button
                    type="button"
                    className={chipClass(when === null)}
                    aria-pressed={when === null}
                    onClick={() => {
                      onPatch({ when: null })
                      closeTo('when')
                    }}
                  >
                    {PICK.now}
                  </button>
                )}
                {slots.map((h) => (
                  <button
                    key={h}
                    type="button"
                    className={chipClass(when === h)}
                    aria-pressed={when === h}
                    onClick={() => {
                      onPatch({ when: h })
                      closeTo('when')
                    }}
                  >
                    {h}시
                  </button>
                ))}
              </>,
            )}
          </>
        )}
      </div>
    ),
    what: (
      <div id="rec-panel-what" className="rec-panel" role="group" aria-label="어떤 곳을 볼지 고르기" hidden={open !== 'what'}>
        {open === 'what' &&
          optionRow(
            GROUPS.map(([label], i) => (
              <button
                key={label}
                type="button"
                className={chipClass(ui.group === i)}
                aria-pressed={ui.group === i}
                onClick={() => {
                  onPatch({ group: i })
                  closeTo('what')
                }}
              >
                {label}
              </button>
            )),
          )}
      </div>
    ),
  }

  return (
    <div
      className="rec-conditions"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation()
          closeTo(open)
        }
      }}
    >
      <div className="rec-conds">
        {conds.map((c) => (
          <Fragment key={c.key}>
            <button
              type="button"
              ref={(el) => {
                triggers.current[c.key] = el
              }}
              className={`rec-cond${c.key === 'where' && where === 'all' ? ' hint' : ''}`}
              aria-expanded={open === c.key}
              aria-controls={`rec-panel-${c.key}`}
              aria-label={`${c.label} ${c.value}`}
              onClick={() => toggle(c.key)}
            >
              <span className="rec-cond-l">{c.label}</span>
              <span className="rec-cond-v">{c.value}</span>
            </button>
            {panels[c.key]}
          </Fragment>
        ))}
      </div>

      <div className="rec-prio" role="group" aria-labelledby="rec-prio-l">
        <span id="rec-prio-l" className="rec-prio-l">{PICK.priorityLabel}</span>
        <div className="rec-prio-chips">
          {PRIORITIES.map(([key, label]) => (
            <button key={key} type="button" className={chipClass(ui.priority === key)} aria-pressed={ui.priority === key} onClick={() => pickPriority(key)}>
              {label}
            </button>
          ))}
        </div>
        <p className="muted rec-prio-g" role="status">{ui.priority ? guideText(ui.priority, hasOrigin, noiseGap) : ''}</p>
      </div>
    </div>
  )
}
