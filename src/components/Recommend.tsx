import { useEffect, useMemo, useRef, useState } from 'react'
import { placeLabel, type ChildProfile, type HourScore, type Level3, type NoiseData, type Place, type Snapshot } from '../types'
import { hourScores, LEVEL3_LABEL, recommend } from '../lib/index'
import { distanceKm } from '../lib/nearby'
import { makeLabel, TXT } from '../lib/nearbyText'
import { activeControls, factorTags } from '../lib/factors'
import { noiseLookup } from '../lib/noise'
import { matchesPlace } from '../lib/hangul'
import { kstNow } from '../lib/publicData'
import { basisLine } from '../lib/trustText'
import { bucketKey, type SoundStore } from '../lib/snapshot'
import { cellFor, clockOf, GROUPS, extraFrom, hasLaterDay, isCustomApplied, isFarKm, noiseGapOf, phaseOf, pickCandidates, resolveWhen, whenSlots } from '../lib/pick'
import { emptyView, foundText, foldPickBrief, foldPickSteps, listIntro, PICK, placeNoneText, priorityMarker, reasonText, rowLineText, titleText, type EmptyButton } from '../lib/pickText'
import { saveAnchor, type RecommendUi, type Where } from '../lib/recPrefs'
import { RECORD_LEGEND, recordChipAt, unappliedText } from '../lib/recordEffect'
import { hasPlanCells } from '../lib/plan'
import Fold from './Fold'
import RecConditions from './RecConditions'
import RecCandidates, { type CandCard } from './RecCandidates'
import '../styles/nonoise.css'
import '../styles/recommend.css'

interface Props {
  places: Place[]
  snap: Snapshot | null
  /** 자료를 받는 중인지. snap이 없을 때 '불러오는 중'과 '불러오지 못함'을 가른다 */
  loading?: boolean
  sound: SoundStore
  profile: ChildProfile
  offsets: Record<string, number>
  nowKey: string | undefined
  noise: NoiseData | null
  ui: RecommendUi
  onUi: (u: RecommendUi) => void
  /** card는 누른 카드 단추. 장소명과 지수가 시트 머리로 이어지는 전환에 쓴다. */
  onOpen: (name: string, from?: string, card?: Element) => void
  /** 카드를 누르면 시트를 카드와 같은 시각으로 열도록 지도의 시각 선택(0~23, null=지금)을 바꾼다 */
  onSelectHour: (hour: number | null) => void
  /** 카드 옆 '외출 계획 세우기': 그 장소의 시트를 열고 곧바로 계획을 함께 연다 */
  onOpenPlan: (name: string) => void
}

const RANK: Record<Level3, number> = { calm: 0, mid: 1, busy: 2, nodata: 3 }

/** 카드 아래 안내 문장의 자료 출처 부분. 자료 시각과 예측 기반 참고값이라는 점을 함께 밝힌다. */
function sourceNote(snap: Snapshot | null, loading: boolean): string {
  if (snap === null) return loading ? '자료를 불러오는 중이에요.' : '자료를 불러오지 못했어요.'
  return basisLine(snap)
}

export default function Recommend({ places, snap, loading = false, sound, profile, offsets, nowKey, noise, ui, onUi, onOpen, onSelectHour, onOpenPlan }: Props) {
  const { group, byDistance } = ui
  // 위치 확인처럼 나중에 도착하는 응답이 그 사이에 바뀐 선택을 되돌리지 않도록, 항상 최신 상태에 바뀐 값만 합쳐 보낸다
  const uiRef = useRef(ui)
  useEffect(() => {
    uiRef.current = ui
  }, [ui])
  const patchUi = (patch: Partial<RecommendUi>) => {
    uiRef.current = { ...uiRef.current, ...patch }
    onUi(uiRef.current)
  }
  const [geoMsg, setGeoMsg] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [listOpen, setListOpen] = useState(false)

  // 시계열: 자료와 맞춤에만 의존한다. 기준 위치와 시각을 바꿀 때는 다시 계산하지 않는다.
  const series = useMemo(
    () =>
      places.map((p) => {
        const s = snap?.places[p.name]
        const nz = noiseLookup(noise, p.name)
        const scores = hourScores(s, (h, d) => sound[p.name]?.[bucketKey(d, h)], profile, offsets[p.name] ?? 0, nowKey, nz)
        // 칩이 기록이 실제로 바꾼 폭을 말하도록, 기록이 있는 장소만 기록을 뺀 같은 시계열을 한 번 더 계산한다
        const bare = profile.enabled && (offsets[p.name] ?? 0) !== 0 ? hourScores(s, (h, d) => sound[p.name]?.[bucketKey(d, h)], profile, 0, nowKey, nz) : undefined
        return { place: p, extra: s?.extra, stale: s?.stale === true, scores, bare, line: recommend(scores, nowKey).short, noMeter: noise !== null && !noise.places[p.name] }
      }),
    [places, snap, sound, profile, offsets, nowKey, noise],
  )
  const live = useMemo(() => series.filter((s) => !s.stale).map((s) => s.scores), [series])
  const clock = useMemo(() => clockOf(nowKey, series.map((s) => s.scores)), [nowKey, series])
  const phase = clock ? phaseOf(clock.hour) : 'now'
  const slots = useMemo(() => (clock ? whenSlots(live, clock) : []), [live, clock])
  const when = clock ? resolveWhen(ui.when, slots, clock) : null
  const hasLater = clock ? hasLaterDay(live, clock) : false

  // 기준: 내 위치(pos가 있을 때)나 고른 장소. 둘 다 아니면 서울 전체이고 거리를 따지지 않는다.
  const anchorPlace = ui.anchor ? places.find((p) => p.name === ui.anchor) : undefined
  const where: Where = ui.where === 'gps' && ui.pos ? 'gps' : ui.where === 'place' && anchorPlace ? 'place' : 'all'
  const origin = where === 'gps' ? ui.pos : where === 'place' ? (anchorPlace ?? null) : null
  const baseName = where === 'gps' ? PICK.whereGps : where === 'place' ? ui.anchor : null

  // 행: 기준과 시각에 의존한다. cell은 후보를 고르는 칸(현재 시를 건너뛴 장소는 '지금' 칸이 없음), listCell은 전체 목록에 보이는 칸이다.
  const rows = useMemo(() => {
    const k = kstNow()
    const nowStr = when === null ? `${k.date} ${String(k.hour).padStart(2, '0')}:00` : `${clock?.date ?? k.date} ${String(when).padStart(2, '0')}:00`
    return series.map((s) => {
      const cell: HourScore | undefined = clock && !(phase !== 'now' && when === null) ? cellFor(s.scores, when, nowKey, clock) : undefined
      // 비 예보는 고른 시각(지금이면 현재 시) 이후만 본다. 시트의 '오늘 이 장소 주변'과 같은 기준이라 카드와 시트가 어긋나지 않는다.
      const tags = factorTags(extraFrom(activeControls(s.extra, nowStr), when ?? clock?.hour)).filter((t) => t.key.startsWith('control') || t.key === 'rain').slice(0, 2)
      return { ...s, km: origin ? distanceKm(origin, s.place) : null, cell, listCell: when === null ? s.scores[0] : cell, tags }
    })
  }, [series, origin, when, clock, phase, nowKey])

  const cats = GROUPS[group][1]
  const result = useMemo(() => (snap === null || phase === 'after' ? null : pickCandidates(rows, { cats, priority: ui.priority })), [rows, snap, phase, cats, ui.priority])

  const label = makeLabel(clock?.date ?? '')
  const cards: CandCard[] = (result?.picks ?? []).map((r) => ({
    name: r.place.name,
    index: r.cell.index,
    level: r.cell.level,
    kind: placeLabel(r.place),
    km: r.km,
    isBase: where === 'place' && r.place.name === ui.anchor,
    far: r.km !== null && isFarKm(r.km),
    reason: reasonText(r.cell, r.scores, label, when === null),
    canPlan: hasPlanCells(r.scores),
    tag: r.tags[0]?.label ?? null,
    chip: recordChipAt(r.cell, r.bare, offsets[r.place.name] ?? 0, profile.enabled),
    marker: priorityMarker(r.cell, ui.priority),
    noMeter: r.noMeter,
  }))

  const kind = cats.length > 0 ? GROUPS[group][0] : null
  const empty = result?.why ? emptyView(result.why, { base: baseName, kind, when, n: cards.length, canNow: phase === 'now' }) : null
  const notice =
    snap === null
      ? { text: loading ? PICK.loading : PICK.noSnap, wait: loading }
      : phase === 'after'
        ? { text: PICK.after, wait: false }
        : null

  const unapplied = !profile.enabled ? places.filter((p) => (offsets[p.name] ?? 0) !== 0).length : 0
  const applied = isCustomApplied(profile, offsets, (result?.pool ?? []).map((r) => r.place.name))
  const noiseGap = ui.priority === 'noise' && result ? noiseGapOf(result.pool, noise !== null) : null

  // 전체 목록(접이식 2): 우선순위와 상관없이 지수 순서이고, 종류와 이름 검색을 건다.
  const q = query.trim()
  const sortByDistance = byDistance && origin !== null
  const listRows = rows
    .map((r) => ({
      ...r,
      level: (r.listCell?.level ?? 'nodata') as Level3,
      index: r.listCell?.index ?? null,
      // 행의 알약과 지수는 고른 시각의 칸이므로 설명 줄도 같은 칸으로 말한다(지금이면 기존 권고 문장)
      text: when === null ? r.line : rowLineText(r.listCell, r.scores, label, when),
      chip: recordChipAt(r.listCell, r.bare, offsets[r.place.name] ?? 0, profile.enabled),
    }))
    .filter((r) => cats.length === 0 || cats.includes(r.place.category))
    .filter((r) => matchesPlace(r.place.name, q))
    .sort((a, b) => {
      if (sortByDistance && a.km !== null && b.km !== null) return a.km - b.km
      return RANK[a.level] - RANK[b.level] || (a.index ?? 999) - (b.index ?? 999) || (a.km ?? 0) - (b.km ?? 0)
    })
  // 종류 칩 때문에 비었는지, 목록에 아예 없는 이름인지 구분해서 알려 준다
  const listEmpty = listRows.length > 0 || !q ? null : rows.some((r) => matchesPlace(r.place.name, q)) ? 'kind' : 'none'

  const legend = cards.some((c) => c.chip) || (listOpen && listRows.some((r) => r.chip))

  const locate = (done?: () => void, sortByDistanceToo = false) => {
    const take = (pos?: { lat: number; lng: number }) => {
      patchUi({ ...(pos ? { pos } : {}), where: 'gps', ...(sortByDistanceToo ? { byDistance: true } : {}) })
      setGeoMsg(null)
      done?.()
    }
    if (uiRef.current.pos) return take()
    if (!('geolocation' in navigator)) {
      setGeoMsg(PICK.geoUnsupported)
      return
    }
    setGeoMsg(PICK.geoWait)
    navigator.geolocation.getCurrentPosition(
      (g) => take({ lat: g.coords.latitude, lng: g.coords.longitude }),
      () => setGeoMsg(PICK.geoFail),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    )
  }

  // 어디서 패널의 '서울 전체'와 후보가 없을 때의 '서울 전체에서 찾기'가 같은 길로 저장된 기준 장소를 지운다
  const clearAnchor = () => {
    saveAnchor(null)
    patchUi({ anchor: null, where: 'all' })
  }

  const onEmptyButton = (b: EmptyButton) => {
    if (b === 'allSeoul') clearAnchor()
    else if (b === 'allKinds') patchUi({ group: 0 })
    else patchUi({ when: null })
  }

  return (
    <div className="page">
      <h2 className="rec-title" tabIndex={-1}>{titleText(profile.enabled || where !== 'all', cards.length)}</h2>
      <p className="rec-sr" role="status">{foundText(cards.length)}</p>
      <RecConditions
        places={places}
        ui={ui}
        where={where}
        when={when}
        slots={slots}
        phase={phase}
        hasLater={hasLater}
        hasOrigin={origin !== null}
        noiseGap={noiseGap}
        geoMsg={geoMsg}
        onPatch={patchUi}
        onLocate={(done) => locate(done)}
        onAnchor={(name) => {
          saveAnchor(name)
          patchUi({ anchor: name, where: 'place' })
        }}
        onClearAnchor={clearAnchor}
      />
      <RecCandidates
        cards={cards}
        empty={empty}
        notice={notice}
        onOpen={(name, card) => {
          onSelectHour(when)
          onOpen(name, undefined, card)
        }}
        onOpenPlan={(name) => {
          onSelectHour(when)
          onOpenPlan(name)
        }}
        onEmptyButton={onEmptyButton}
      />
      {unapplied > 0 && <p className="muted">{unappliedText(unapplied)}</p>}
      <p className={snap === null && loading ? 'muted rec-head-wait' : 'muted'}>{sourceNote(snap, loading)}</p>
      {snap !== null && <p className="muted">{legend ? `${PICK.indexNote} ${RECORD_LEGEND}` : PICK.indexNote}</p>}
      <div className="folds">
        <Fold title={PICK.foldPickTitle} brief={foldPickBrief(origin !== null)}>
          <ol className="rec-steps">
            {foldPickSteps(profile.enabled, applied).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
        </Fold>
        <Fold title={`서울 ${places.length}곳 전체 목록`} brief={`${GROUPS[group][0]} · ${sortByDistance ? PICK.sortNear : PICK.sortCalm}`} onToggle={setListOpen}>
          <p className="muted">{listIntro(places.length, when, profile.enabled)}</p>
          <div className="search">
            <label>
              {PICK.listSearch}{' '}
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={PICK.listPlaceholder} autoComplete="off" spellCheck={false} />
            </label>
          </div>
          <div className="row">
            {origin ? (
              <>
                <button className={`chip${!sortByDistance ? ' on' : ''}`} onClick={() => patchUi({ byDistance: false })} aria-pressed={!sortByDistance}>{PICK.sortCalm}</button>
                <button className={`chip${sortByDistance ? ' on' : ''}`} onClick={() => patchUi({ byDistance: true })} aria-pressed={sortByDistance}>{PICK.sortNear}</button>
              </>
            ) : (
              <button className="btn" onClick={() => locate(undefined, true)}>{PICK.foldListLocate}</button>
            )}
          </div>
          <p className="muted" style={{ marginTop: 8 }} role="status">{geoMsg ?? PICK.gpsNote}</p>
          <div role="status">
            {listEmpty === 'kind' && (
              <>
                <p className="muted">{PICK.listKindNone}</p>
                <button className="btn" onClick={() => patchUi({ group: 0 })}>{PICK.allKinds}</button>
              </>
            )}
            {listEmpty === 'none' && <p className="muted">{placeNoneText(places.length)}</p>}
          </div>
          {snap !== null && (
            <ul className="rec-list">
              {listRows.map((r) => (
                <li key={r.place.name}>
                  <button
                    className="rec-item"
                    onClick={(e) => {
                      onSelectHour(when)
                      onOpen(r.place.name, undefined, e.currentTarget)
                    }}
                  >
                    <span className={`pill ${r.level}`}>{LEVEL3_LABEL[r.level]}</span>
                    <span className="rec-main">
                      <b>{r.place.name}</b> <span className="muted">{[placeLabel(r.place), r.km !== null ? `직선 ${r.km.toFixed(1)}km` : ''].filter(Boolean).map((t, i) => <span key={t}>{i > 0 && ' · '}<span className="nw">{t}</span></span>)}</span>
                      <br />
                      <span>{r.text}</span>
                      {r.tags.map((t) => (
                        <span key={t.key}>{' '}<span className="factor small">{t.label}</span></span>
                      ))}
                      {r.chip && <span className="recfx">{r.chip}</span>}
                      {r.noMeter && <span className="nonoise small">{TXT.noNoise}</span>}
                    </span>
                    {r.index !== null && (
                      <span className="rec-index" role="img" aria-label={`지수 ${r.index}점`}>
                        {r.index}<small style={{ fontSize: 12, fontWeight: 400 }}>점</small>
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Fold>
      </div>
    </div>
  )
}
