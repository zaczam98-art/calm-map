import { useEffect, useMemo, useRef, useState } from 'react'
import type { Card, ChildProfile, HourScore, NoiseData, Place, SenseTag, Snapshot, WeekPattern as WeekPatternData } from '../types'
import { placeLabel, TAG_LABEL } from '../types'
import { dowOfTime, hourScores, LEVEL3_LABEL, noiseScore, recommend, scoreAt } from '../lib/index'
import { bucketKey, type SoundStore } from '../lib/snapshot'
import { loadLog, recordVisit, undoVisit } from '../lib/profile'
import { assembleCard, getCard, loadCardModules, type CardModule } from '../lib/cards'
import { HAS_API } from '../lib/publicData'
import { topTags } from '../lib/tags'
import { altCell, calmerNearby, calmRun, candidateCell, distanceKm, hasNeighborWithin, hoursAfter, NEARBY_FAR_KM, NEARBY_MAX_KM, noiseState } from '../lib/nearby'
import { altButton, basisText, customText, emptyText, makeLabel, metaText, midText, noiseLineText, panelLines, runText, selectedCalmText, summaryAlt, summaryText, TXT, whyLines } from '../lib/nearbyText'
import { noiseLookup } from '../lib/noise'
import { SHARED_BAND } from '../lib/landingCopy'
import HourChart from './HourChart'
import CardView from './CardView'
import NearbyCalm, { type NearbyRow } from './NearbyCalm'
import WeekPattern from './WeekPattern'
import Factors from './Factors'
import NoiseCard from './NoiseCard'
import WhyIndex from './WhyIndex'
import ShareImage from './ShareImage'
import FeedbackMail from './FeedbackMail'
import '../styles/detail.css'
import '../styles/nonoise.css'

const UNDO_MS = 10 * 60 * 1000 // 방금 기록을 취소할 수 있는 시간

// 시트 안의 단추(가까운 곳)로 다른 시트가 열리면, 사라질 그 단추 대신 앞 시트를 열기 전 위치로 포커스를 돌려준다
let lastOpener: Element | null = null

type VisitPrev = ReturnType<typeof recordVisit>['prev']

interface Props {
  place: Place
  places: Place[]
  pattern: WeekPatternData | null
  noise: NoiseData | null
  /** from은 후보를 눌러 열 때 넘기는 지금 장소의 이름(원래 장소로 돌아가기 단추에 쓴다) */
  onSelect: (name: string, from?: string) => void
  nowKey: string | undefined
  snap: Snapshot | null
  sound: SoundStore
  profile: ChildProfile
  offsets: Record<string, number>
  onClose: () => void
  onRecorded: (offsets: Record<string, number>, profile: ChildProfile) => void
  onMeasure: () => void
  /** 우리 아이 탭으로 이동(맞춤 전후가 같을 때 민감도를 고르러 가는 단추) */
  onGoChild?: () => void
  /** 지도 슬라이더와 함께 쓰는 선택 시각(0~23, null=지금). 주지 않으면 이 시트 안에서만 기억한다. */
  selectedHour?: number | null
  onSelectHour?: (hour: number | null) => void
  /** 후보를 눌러 이 시트가 열렸을 때 돌아갈 장소의 이름. 지도나 목록에서 직접 열었으면 null */
  backTo?: string | null
  onBack?: () => void
  /** 공유 링크로 연 시트일 때만 준다. 시트 위에 소개 화면으로 가는 한 줄 띠를 둔다. */
  onIntro?: () => void
}

export default function PlaceDetail({ place, places, pattern, noise, onSelect, nowKey, snap, sound, profile, offsets, onClose, onRecorded, onMeasure, onGoChild, selectedHour: hourProp, onSelectHour, backTo, onBack, onIntro }: Props) {
  const ps = snap?.places[place.name]
  const noiseAt = useMemo(() => noiseLookup(noise, place.name), [noise, place.name])
  const scores = useMemo(() => hourScores(ps, (h, d) => sound[place.name]?.[bucketKey(d, h)], profile, offsets[place.name] ?? 0, nowKey, noiseAt), [ps, sound, profile, offsets, place.name, nowKey, noiseAt])
  // 맞춤 전후 비교용: 맞춤을 끈 같은 시계열
  const plainScores = useMemo(() => (profile.enabled ? hourScores(ps, (h, d) => sound[place.name]?.[bucketKey(d, h)], null, 0, nowKey, noiseAt) : []), [ps, sound, profile.enabled, place.name, nowKey, noiseAt])
  // 막대를 눌러 고른 시각(null이면 선택 없음: 머리 줄은 지금, 카드는 권고 시각 기준). 예측이 있는 칸만 고를 수 있다.
  // 부모가 값을 주면 지도 슬라이더와 같은 값을 쓰고(장소를 바꿔도 유지), 주지 않으면 이 시트 안에서만 기억한다.
  const [ownHour, setOwnHour] = useState<number | null>(null)
  const selectedHour = hourProp !== undefined ? hourProp : ownHour
  const rec = recommend(scores, nowKey)
  const now = scores[0]
  const sel = selectedHour !== null ? scoreAt(scores, selectedHour) : undefined
  const shown = sel ?? now // 머리 줄, 소리 종류, '왜 이 지수인가'가 설명하는 칸
  const today = (nowKey ?? now?.time ?? '').slice(0, 10)
  const label = useMemo(() => makeLabel(today), [today])
  const hourName = (c: HourScore) => label(c.time)
  // '지금'이라고 부르는 것은 첫 칸이 현재 시각일 때만(nowKey가 없는 데모는 첫 칸을 지금으로 본다)
  const nowIsCurrent = !nowKey || now?.time.slice(0, 13) === nowKey
  const shortLabel = sel ? hourName(sel) : nowIsCurrent || !now ? '지금' : hourName(now)
  const shownLabel = sel ? hourName(sel) : nowIsCurrent ? (now?.obs ? `지금(관측 ${now.obs} 기준)` : '지금') : now ? hourName(now) : ''
  const tagsOf = (c: HourScore | undefined): SenseTag[] => {
    const b = c ? sound[place.name]?.[bucketKey(dowOfTime(c.time), c.hour)] : undefined
    return b ? topTags(b) : []
  }
  const shownTags = tagsOf(shown)
  const nowTags = tagsOf(now) // 방문 기록은 지금 있었던 시간대의 소리로 남긴다
  const plain = profile.enabled && shown ? scoreAt(plainScores, shown.hour) : undefined
  // 맞춤을 켰어도 지수가 하나도 달라지지 않았으면 공유 이미지에 '맞춤 반영'을 붙이지 않는다
  const adapted = profile.enabled && scores.some((s, i) => s.index !== plainScores[i]?.index)
  const chosen = profile.crowd !== 1 || profile.loud !== 1 || Object.values(profile.tags).some((v) => v !== 1)
  // 혼잡·큰 소리·돌발음 민감도가 모두 기본값이면, 고른 값은 소리 점수에만 곱해져 측정이 없는 시간대의 지수는 그대로다
  const soundOnlyChosen = chosen && profile.crowd === 1 && profile.loud === 1 && profile.tags.sudden === 1
  const totalN = Object.values(sound[place.name] ?? {}).reduce((a, b) => a + b.n, 0)
  // 기록을 남기거나 취소하면 offsets가 새 객체로 바뀌므로 그때 이 장소의 기록 건수를 다시 센다
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const visitN = useMemo(() => loadLog().filter((l) => l.place === place.name).length, [place.name, offsets])
  // 보여 주는 칸이 '보통' 이상일 때만, 같은 시각에 단계가 더 낮은 가까운 곳을 찾는다.
  // 다른 장소의 시계열은 이 장소에 보통 이상인 칸이 있을 때만 쓰고, 6km 안 후보의 것을 필요할 때 만들어 둔다.
  // 단계 우선(TIER_FIRST)이면 6km 안 후보를 모두 보고 단계, 가까운 순으로 3곳을 고르고, 거리순이면 후보 3곳이 차는 즉시 멈춘다.
  // 시각을 바꾸면 만들어 둔 시계열은 두고 후보 고르기만 다시 한다.
  const hasMid = scores.some((s) => s.level === 'mid' || s.level === 'busy')
  const allScores = useMemo(() => {
    if (!hasMid) return null
    const m = new Map<string, HourScore[]>([[place.name, scores]])
    return {
      get(name: string): HourScore[] | undefined {
        let s = m.get(name)
        if (!s) {
          s = hourScores(snap?.places[name], (h, d) => sound[name]?.[bucketKey(d, h)], profile, offsets[name] ?? 0, nowKey, noiseLookup(noise, name))
          m.set(name, s)
        }
        return s
      },
    }
  }, [hasMid, place.name, scores, snap, sound, profile, offsets, nowKey, noise])
  const picked = !!sel && sel !== now // 지금 칸을 직접 고른 경우는 고르지 않은 것과 같게 본다
  const midUp = !!shown && shown.index !== null && (shown.level === 'mid' || shown.level === 'busy')
  const baseStale = ps?.stale === true
  const nearby = useMemo(() => {
    if (!allScores || !shown || shown.index === null || shown.level === 'calm' || shown.level === 'nodata') return null
    if (snap?.places[place.name]?.stale) return null
    return calmerNearby(place, shown.level, places, (p) => (snap?.places[p.name]?.stale === true ? undefined : candidateCell(allScores.get(p.name), shown, false)))
  }, [allScores, shown, place, places, snap])
  // 카드에 보이는 줄과 후보 행. 계산은 nearby.ts, 문장은 nearbyText.ts가 맡고 여기서는 이어 붙이기만 한다.
  const recFrom = rec.from
  const nearbyView = useMemo(() => {
    if (!nearby || !allScores || !shown || !now) return null
    const baseNoise = noiseState(noise, place.name, shown)
    const noiseNote = noiseLineText(noise === null ? 'noFile' : baseNoise, shown.forecast)
    const tagNoise = noise !== null && baseNoise !== 'allMissing' // 소음 자료가 없는 시간대는 후보마다 표지를 붙이지 않고 한 줄로만 알린다
    const isNow = !picked && nowIsCurrent // 기준 칸이 지금 칸이면 관측 칸은 시각 대신 '지금'이라고 부른다
    // 맞춤을 켰어도 고른 민감도도, 비교에 든 6km 안 장소의 기록 보정도 없으면 지수가 기본 기준과 같다
    const customApplied = profile.enabled && (chosen || places.some((p) => (offsets[p.name] ?? 0) !== 0 && (p.name === place.name || distanceKm(place, p) <= NEARBY_MAX_KM)))
    const rows: NearbyRow[] = nearby.map((it) => {
      const ns = noiseState(noise, it.place.name, it.cell)
      return {
        name: it.place.name,
        level: it.level,
        meta: metaText(it.km, it.index),
        sub: it.level === 'calm' ? runText(calmRun(allScores.get(it.place.name)!, it.cell), it.cell, label, isNow) : midText(it.cell.forecast),
        far: it.km > NEARBY_FAR_KM,
        noNoise: tagNoise && (ns === 'placeMissing' || ns === 'hourMissing'),
        why: whyLines(it.place.name, shown, it.cell, { baseNoise, candNoise: ns }),
      }
    })
    const a = altCell(scores, recFrom, shown)
    const toNow = a === now && nowIsCurrent
    const aLabel = a ? (toNow ? '지금' : label(a.time)) : ''
    const aRun = a ? calmRun(scores, a) : null
    return {
      title: rows.length > 0 || a ? TXT.title : TXT.titleNeutral,
      basis: `${basisText(shown, picked, nowIsCurrent, label)} ${customText(profile.enabled, customApplied)}`,
      noiseNote,
      farTime: hoursAfter(now, shown) >= 4,
      alt: a && aRun ? { text: runText(aRun, a, label, toNow), button: altButton(aLabel), hour: toNow ? null : a.hour } : null,
      rows,
      empty: emptyText(NEARBY_MAX_KM, picked || !nowIsCurrent ? label(shown.time) : null),
      isolated: rows.length === 0 && !hasNeighborWithin(place, places, NEARBY_FAR_KM),
      panel: panelLines({
        noiseDays: noise?.days ?? null,
        baseNoise,
        deviceSound: [shown, ...nearby.map((it) => it.cell)].some((c) => (c.parts?.w ?? 0) > 0),
        obs: [shown, ...(a ? [a] : []), ...nearby.map((it) => it.cell)].some((c) => !c.forecast),
      }),
      summary: rows.length > 0 ? summaryText(rows.length, !shown.forecast) : a && aRun ? summaryAlt(aLabel, !a.forecast, aRun) : null,
    }
  }, [nearby, allScores, shown, now, noise, place, places, scores, recFrom, nowIsCurrent, label, picked, profile.enabled, chosen, offsets])
  const headingRef = useRef<HTMLHeadingElement>(null)
  const jumpToCard = () => {
    headingRef.current?.scrollIntoView({ block: 'start' })
    headingRef.current?.focus({ preventScroll: true })
  }
  const [card, setCard] = useState<{ card: Card; note: string; key: string } | null>(null)
  const [modules, setModules] = useState<CardModule[]>([])
  const [loading, setLoading] = useState(false)
  const [recorded, setRecorded] = useState<string | null>(null)
  const [undoable, setUndoable] = useState<{ prev: VisitPrev } | null>(null)
  const [shareMsg, setShareMsg] = useState('')
  const cardReq = useRef(0)
  const [cardFocus, setCardFocus] = useState(0) // 카드 만들기를 눌러 만든 경우에만 올라가고, CardView가 제목으로 포커스를 옮기는 신호가 된다
  const sheet = useRef<HTMLElement>(null)
  const opener = useRef<Element | null>(document.activeElement?.closest('.sheet') && lastOpener?.isConnected ? lastOpener : document.activeElement)

  // 시트가 열리면 시트로 포커스를 옮기고, 닫히면 열기 전 위치로 되돌린다
  useEffect(() => {
    lastOpener = opener.current
    sheet.current?.focus({ preventScroll: true })
    return () => {
      if (opener.current instanceof HTMLElement) opener.current.focus()
    }
  }, [])

  // 기록 취소 단추는 10분 동안만 둔다
  useEffect(() => {
    if (!undoable) return
    const t = window.setTimeout(() => setUndoable(null), UNDO_MS)
    return () => window.clearTimeout(t)
  }, [undoable])

  const childTags = (Object.entries(profile.tags) as [SenseTag, number][]).filter(([, v]) => v > 1).map(([t]) => t)

  // 카드를 맞출 시각의 칸: 고른 시각이 있으면 그 칸, 없으면 권고 시각, 그것도 없으면 첫 칸
  const cell = sel ?? scores.find((s) => s.hour === rec.from) ?? now
  const pointAt = (c: HourScore | undefined) => (c && ps ? [...ps.fcst, ...(ps.live ? [ps.live] : [])].find((f) => f.time.slice(0, 13) === c.time.slice(0, 13)) ?? (c.forecast ? undefined : ps.live ?? undefined) : undefined)
  const loudHour = !!cell && (noiseScore(noiseAt(cell.hour, dowOfTime(cell.time))) ?? 0) >= 60
  const crowdedHour = pointAt(cell)?.level === '약간 붐빔' || pointAt(cell)?.level === '붐빔'
  const cellKey = cell ? `${cell.level}${HAS_API ? `|${cell.hour}` : ''}` : ''
  // 프로필이나 요인이 바뀌면 이미 만든 카드도 다시 조립한다
  const assembled = useMemo(() => (card ? assembleCard(card.card, profile, { loudHour, crowdedHour }, modules) : null), [card, profile, loudHour, crowdedHour, modules])

  // 요인 카드의 비 예보는 고른 시각 이후만 본다(비 예보 시각은 오늘 자료라 내일 칸에는 적용하지 않는다)
  const baseExtra = ps?.stale ? undefined : ps?.extra
  const selToday = !!sel && sel.time.slice(0, 10) === today
  const factorsExtra = baseExtra?.weather && sel && selToday ? { ...baseExtra, weather: { ...baseExtra.weather, rainHours: baseExtra.weather.rainHours.filter((r) => r >= sel.hour) } } : baseExtra
  const factorsNote = sel && baseExtra && !selToday ? '날씨, 통제, 행사는 오늘 자료예요. 내일 자료는 서울시에서 받지 못해요.' : ''

  const makeCard = async (focus = false) => {
    const id = ++cardReq.current
    setLoading(true)
    const [r, mods] = await Promise.all([getCard({
      place: place.name,
      category: place.category,
      level: cell?.level ?? 'mid',
      hourLabel: cell ? hourName(cell) : '오늘',
      tags: tagsOf(cell),
      childTags: profile.enabled ? childTags : [],
    }), loadCardModules()])
    if (id !== cardReq.current) return // 그 사이 다른 시각을 골랐으면 늦게 온 결과는 버린다
    setModules(mods)
    setCard({ ...r, key: cellKey })
    if (focus) setCardFocus((n) => n + 1)
    setLoading(false)
  }

  // 카드를 만든 뒤 시각을 바꾸면 그 시각의 단계로 카드를 다시 만든다
  useEffect(() => {
    if (card && card.key !== cellKey) void makeCard()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellKey])

  const pickHour = (h: number | null) => {
    if (hourProp === undefined) setOwnHour(h)
    onSelectHour?.(h)
  }

  const record = (ok: boolean) => {
    const r = recordVisit(place.name, ok, nowTags)
    if (r.duplicate && !window.confirm('이미 기록했어요. 한 번 더 더할까요?')) {
      undoVisit(place.name, r.prev)
      return
    }
    onRecorded(r.offsets, r.profile)
    setUndoable({ prev: r.prev })
    const applied = profile.enabled ? '' : ' 맞춤 지수를 꺼 둔 상태라 지금 보이는 지수는 그대로이고, 켜면 반영돼요.'
    const off = r.offsets[place.name] ?? 0
    const delta = off - r.prev.offset
    const offLabel = `${off > 0 ? '+' : ''}${off}점`
    const offsetText = delta === 0
      ? `이 장소의 지수 보정이 이미 한도(±20)에 닿아 더 바뀌지 않아요(지금 ${offLabel}).`
      : `이 장소의 지수 보정을 ${Math.abs(delta)}점 ${delta > 0 ? '올렸어요' : '내렸어요'}(지금 ${offLabel}, 한도 ±20).`
    const raised = nowTags.slice(0, 2).filter((t) => r.profile.tags[t] !== r.prev.tags[t])
    setRecorded(
      ok
        ? `기록했어요. ${offsetText}${applied}`
        : `기록했어요. ${offsetText}${raised.length ? ` 지금 시간대에 측정해 둔 소리(${raised.map((t) => TAG_LABEL[t]).join(', ')})의 민감도도 한 단계 올렸어요.` : ''}${applied}`,
    )
  }

  const undo = () => {
    if (!undoable) return
    const r = undoVisit(place.name, undoable.prev)
    onRecorded(r.offsets, r.profile)
    setUndoable(null)
    setRecorded('방금 기록을 취소했어요.')
  }

  const share = async () => {
    const url = location.origin + location.pathname + '#/place/' + encodeURIComponent(place.name)
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: `${place.name} · 무던한 지도`, url })
        return
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      setShareMsg('복사했어요')
    } catch {
      setShareMsg('복사하지 못했어요. 주소창의 주소를 직접 복사해 주세요.')
    }
    window.setTimeout(() => setShareMsg(''), 4000)
  }

  return (
    <section
      ref={sheet}
      className="sheet"
      role="dialog"
      aria-label={place.name}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="handle" />
      <button className="close" onClick={onClose} aria-label="닫기">×</button>
      {onIntro && (
        <div className="share-band">
          <span>{SHARED_BAND.text}</span>
          <a
            href="#/start"
            onClick={(e) => {
              if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
              e.preventDefault()
              onIntro()
            }}
          >
            {SHARED_BAND.link}
          </a>
        </div>
      )}
      {backTo && backTo !== place.name && <button className="btn nearby-back" onClick={onBack}>{TXT.back}</button>}
      <h2>{place.name}{placeLabel(place) && <> <span className="muted">{placeLabel(place)}</span></>}</h2>
      <p>
        <span className={`pill ${shown?.level ?? 'nodata'}`}>{LEVEL3_LABEL[shown?.level ?? 'nodata']}</span>{' '}
        {shown?.index != null && <span className="muted">{shownLabel} {shown.forecast ? '예측 ' : ''}지수 {shown.index}점(0~100, 낮을수록 무던)</span>}
        {noise !== null && !noise.places[place.name] && <>{' '}<span className="nonoise">소음 미반영</span></>}
      </p>
      {plain?.index != null && shown?.index != null && (
        <div className="adapt">
          <span className="muted">
            {plain.index !== shown.index
              ? `맞춤 전 ${plain.index}점 → 후 ${shown.index}점${plain.level !== shown.level ? ` (${LEVEL3_LABEL[plain.level]} → ${LEVEL3_LABEL[shown.level]})` : ''}`
              : chosen ? `이 시간은 맞춤 전후가 같아요(${shown.index}점).${soundOnlyChosen ? ' 고른 항목은 소리를 직접 잰 시간대에서만 지수에 반영돼요.' : ''}` : '민감도를 고르면 달라져요.'}
          </span>
          {plain.index === shown.index && !chosen && onGoChild && <button className="btn" onClick={onGoChild}>우리 아이에서 고르기</button>}
        </div>
      )}
      <p><b>{rec.text}</b></p>
      {nearbyView?.summary && <button className="nearby-summary" onClick={jumpToCard}>{nearbyView.summary}</button>}
      <div className="sel-row">
        {sel ? (
          <b role="status">{hourName(sel)} 기준</b>
        ) : selectedHour !== null ? (
          <span className="muted" role="status">지도에서 고른 시각의 예측이 이 장소에는 없어서 지금 기준으로 보여 드려요.</span>
        ) : (
          <span className="muted">막대를 누르거나 아래 단추로 시각을 바꿔 볼 수 있어요.</span>
        )}
        {selectedHour !== null && <button className="btn" onClick={() => { pickHour(null); sheet.current?.focus({ preventScroll: true }) }}>권고 시간으로</button>}
      </div>
      <div className="share">
        <button className="btn" onClick={share}>링크 복사</button>
        <ShareImage place={place} scores={scores} nowKey={nowKey} updatedAt={snap?.source === 'seoul' ? snap.updatedAt : undefined} selectedHour={sel ? sel.hour : null} adapted={adapted} />
        <div role="status" className="muted">{shareMsg}</div>
      </div>
      <HourChart scores={scores} highlight={rec.from} selectedHour={sel ? sel.hour : null} onSelectHour={pickHour} />
      {/* 지수의 구성은 아래 WhyIndex가 설명하므로 여기서는 이 기기에서 잰 소리와 데모 안내만 짧게 둔다 */}
      {(totalN > 0 || snap?.source === 'demo') && (
        <p className="muted">
          {totalN > 0 && `이 기기에서 잰 소리 표본 ${totalN}개${shownTags.length ? `, ${shortLabel} 주요 소리: ${shownTags.map((t) => TAG_LABEL[t]).join(', ')}` : ''}.`}
          {snap?.source === 'demo' && ' 데모 데이터라 예측값은 전형 패턴이에요.'}
        </p>
      )}
      {shown && (
        <WhyIndex
          cell={shown}
          label={shortLabel}
          crowdLevel={pointAt(shown)?.level}
          noiseAvg={noiseAt(shown.hour, dowOfTime(shown.time))?.avg}
          personal={profile.enabled ? { crowd: profile.crowd, loud: profile.loud, sudden: profile.tags.sudden } : null}
          visits={visitN}
        />
      )}
      <div className="row">
        <button className="btn primary" onClick={() => void makeCard(true)} disabled={loading}>{loading ? '만드는 중…' : '미리 보는 카드 만들기'}</button>
        <button className="btn" onClick={onMeasure}>여기서 소리 측정하기</button>
      </div>
      {card && assembled && <CardView card={assembled.card} note={card.note} place={place.name} focusToken={cardFocus} />}
      {assembled?.reason && <p className="muted">{assembled.reason}</p>}
      {factorsNote && <p className="muted">{factorsNote}</p>}
      <Factors extra={factorsExtra} fromHour={sel && selToday ? sel.hour : undefined} />
      <NoiseCard noise={noise} place={place.name} />
      {nearbyView && (
        <NearbyCalm
          title={nearbyView.title}
          basis={nearbyView.basis}
          noiseNote={nearbyView.noiseNote}
          farTime={nearbyView.farTime}
          alt={nearbyView.alt && {
            text: nearbyView.alt.text,
            button: nearbyView.alt.button,
            onPick: () => {
              pickHour(nearbyView.alt!.hour)
              sheet.current?.focus({ preventScroll: true }) // 눌린 단추가 사라지므로 포커스를 시트로 옮긴다
            },
          }}
          rows={nearbyView.rows}
          empty={nearbyView.empty}
          isolated={nearbyView.isolated}
          panel={nearbyView.panel}
          onSelect={(name) => onSelect(name, place.name)}
          headingRef={headingRef}
        />
      )}
      {midUp && baseStale && <p className="muted">{TXT.baseStale}</p>}
      {shown?.level === 'calm' && picked && <p className="muted">{selectedCalmText(label(shown.time))}</p>}
      <WeekPattern pattern={pattern} place={place.name} />
      <div className="card" style={{ marginTop: 12 }}>
        <h3>다녀온 뒤 기록</h3>
        <p className="muted">"괜찮았어요"를 누르면 이 장소의 지수 보정이 5점 내려가고, "힘들었어요"를 누르면 5점 올라가요(장소마다 ±20까지). "힘들었어요"를 누른 때의 요일·시간대에 측정해 둔 소리가 있으면, 그중 주요 소리(최대 2개)의 민감도도 한 단계 올라가요. 보정과 민감도 변화는 맞춤 지수를 켜 둔 때만 지수에 반영돼요.</p>
        <p className="muted">기록은 이 기기에만 남고 서버로 가지 않아요. 우리 아이 탭의 "최근 기록"에서 최근 10건을 보고 지울 수 있고, 지워도 올라간 소리 민감도는 우리 아이 탭에서 직접 바꿔야 해요.</p>
        <div className="row">
          <button className="btn big" onClick={() => record(true)}><span aria-hidden>😊</span> 괜찮았어요</button>
          <button className="btn big" onClick={() => record(false)}><span aria-hidden>😣</span> 힘들었어요</button>
        </div>
        <div role="status">
          {recorded && <p className="muted" style={{ marginTop: 8 }}>{recorded}</p>}
        </div>
        {undoable && (
          <div className="row" style={{ marginTop: 4 }}>
            <button className="btn" onClick={undo}>방금 기록 취소</button>
            <span className="muted">10분 안에는 되돌릴 수 있어요.</span>
          </div>
        )}
        <FeedbackMail place={place.name} timeLabel={shortLabel} />
      </div>
    </section>
  )
}
