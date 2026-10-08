import { useEffect, useMemo, useRef, useState } from 'react'
import type { Card, ChildProfile, NoiseData, Place, SenseTag, Snapshot, WeekPattern as WeekPatternData } from '../types'
import { CATEGORY_LABEL, TAG_LABEL } from '../types'
import { dowOfTime, hourScores, LEVEL3_LABEL, noiseScore, recommend } from '../lib/index'
import { bucketKey, type SoundStore } from '../lib/snapshot'
import { recordVisit, undoVisit } from '../lib/profile'
import { assembleCard, getCard, loadCardModules, type CardModule } from '../lib/cards'
import { topTags } from '../lib/tags'
import { calmerNearby, NEARBY_MAX_KM } from '../lib/nearby'
import { noiseLookup } from '../lib/noise'
import HourChart from './HourChart'
import CardView from './CardView'
import NearbyCalm from './NearbyCalm'
import WeekPattern from './WeekPattern'
import Factors from './Factors'
import NoiseCard from './NoiseCard'
import '../styles/detail.css'

const UNDO_MS = 10 * 60 * 1000 // 방금 기록을 취소할 수 있는 시간

// 시트 안의 단추(가까운 곳)로 다른 시트가 열리면, 사라질 그 단추 대신 앞 시트를 열기 전 위치로 포커스를 돌려준다
let lastOpener: Element | null = null

type VisitPrev = ReturnType<typeof recordVisit>['prev']

interface Props {
  place: Place
  places: Place[]
  pattern: WeekPatternData | null
  noise: NoiseData | null
  onSelect: (name: string) => void
  nowKey: string | undefined
  snap: Snapshot | null
  sound: SoundStore
  profile: ChildProfile
  offsets: Record<string, number>
  onClose: () => void
  onRecorded: (offsets: Record<string, number>, profile: ChildProfile) => void
  onMeasure: () => void
}

export default function PlaceDetail({ place, places, pattern, noise, onSelect, nowKey, snap, sound, profile, offsets, onClose, onRecorded, onMeasure }: Props) {
  const ps = snap?.places[place.name]
  const scores = useMemo(() => hourScores(ps, (h, d) => sound[place.name]?.[bucketKey(d, h)], profile, offsets[place.name] ?? 0, nowKey, noiseLookup(noise, place.name)), [ps, sound, profile, offsets, place.name, nowKey, noise])
  const rec = recommend(scores, nowKey)
  const now = scores[0]
  // '지금'이라고 부르는 것은 첫 칸이 현재 시각일 때만(nowKey가 없는 데모는 첫 칸을 지금으로 본다)
  const nowIsCurrent = !nowKey || now?.time.slice(0, 13) === nowKey
  const nowBucket = now ? sound[place.name]?.[bucketKey(dowOfTime(now.time), now.hour)] : undefined
  const tags: SenseTag[] = nowBucket ? topTags(nowBucket) : []
  const totalN = Object.values(sound[place.name] ?? {}).reduce((a, b) => a + b.n, 0)
  // 지금 '보통' 이상일 때만, 가까운 곳 중 지수가 뚜렷이 낮은 곳을 찾는다
  const nearby = useMemo(() => {
    if (!now || now.index === null || now.level === 'calm' || now.level === 'nodata') return null
    return calmerNearby(place, now.level, places, (p) => hourScores(snap?.places[p.name], (h, d) => sound[p.name]?.[bucketKey(d, h)], profile, offsets[p.name] ?? 0, nowKey, noiseLookup(noise, p.name))[0])
  }, [now, place, places, snap, sound, profile, offsets, nowKey, noise])
  const [card, setCard] = useState<{ card: Card; note: string } | null>(null)
  const [modules, setModules] = useState<CardModule[]>([])
  const [loading, setLoading] = useState(false)
  const [recorded, setRecorded] = useState<string | null>(null)
  const [undoable, setUndoable] = useState<{ prev: VisitPrev } | null>(null)
  const [shareMsg, setShareMsg] = useState('')
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

  // 카드를 맞출 시각의 칸: 권고 시각이 있으면 그 칸, 없으면 첫 칸
  const cell = scores.find((s) => s.hour === rec.from) ?? now
  const loudHour = !!cell && (noiseScore(noiseLookup(noise, place.name)(cell.hour, dowOfTime(cell.time))) ?? 0) >= 60
  const point = cell && ps ? [...ps.fcst, ...(ps.live ? [ps.live] : [])].find((f) => f.time.slice(0, 13) === cell.time.slice(0, 13)) ?? (cell.forecast ? undefined : ps.live ?? undefined) : undefined
  const crowdedHour = point?.level === '약간 붐빔' || point?.level === '붐빔'
  // 프로필이나 요인이 바뀌면 이미 만든 카드도 다시 조립한다
  const assembled = useMemo(() => (card ? assembleCard(card.card, profile, { loudHour, crowdedHour }, modules) : null), [card, profile, loudHour, crowdedHour, modules])

  const makeCard = async () => {
    setLoading(true)
    const [r, mods] = await Promise.all([getCard({
      place: place.name,
      category: place.category,
      level: cell?.level ?? 'mid',
      hourLabel: rec.from !== null ? `${rec.from}시` : '오늘',
      tags,
      childTags: profile.enabled ? childTags : [],
    }), loadCardModules()])
    setModules(mods)
    setCard(r)
    setLoading(false)
  }

  const record = (ok: boolean) => {
    const r = recordVisit(place.name, ok, tags)
    if (r.duplicate && !window.confirm('이미 기록했어요. 한 번 더 더할까요?')) {
      undoVisit(place.name, r.prev)
      return
    }
    onRecorded(r.offsets, r.profile)
    setUndoable({ prev: r.prev })
    const applied = profile.enabled ? '' : ' 맞춤을 켜면 이 기록이 지수에 반영돼요.'
    const off = r.offsets[place.name] ?? 0
    const offsetText = ` 이 장소 보정 ${off > 0 ? '+' : ''}${off}(한도 ±20).`
    setRecorded(
      ok
        ? `고마워요. 이 장소의 맞춤 보정을 조금 낮췄어요.${offsetText}${applied}`
        : `기록했어요. 이 장소의 맞춤 보정을 조금 올렸어요.${offsetText}${tags.length ? ' 그 시간에 측정된 소리 요인의 민감도도 올렸어요.' : ''}${applied}`,
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
      <h2>{place.name} <span className="muted">{CATEGORY_LABEL[place.category] ?? place.category}</span></h2>
      <p>
        <span className={`pill ${now?.level ?? 'nodata'}`}>{LEVEL3_LABEL[now?.level ?? 'nodata']}</span>{' '}
        {now?.index != null && <span className="muted">{nowIsCurrent ? (now.obs ? `지금(관측 ${now.obs} 기준)` : '지금') : `${now.hour}시`} 지수 {now.index}{now.forecast ? ' (예측값)' : ''}{profile.enabled ? ' (우리 아이 맞춤)' : ''}</span>}
      </p>
      <p><b>{rec.text}</b></p>
      <div className="share">
        <button className="btn" onClick={share}>링크 복사</button>
        <div role="status" className="muted">{shareMsg}</div>
      </div>
      <HourChart scores={scores} highlight={rec.from} />
      <p className="muted">
        막대는 혼잡도 예측{now?.noise ? '과 평소 소음 실측' : ''}{totalN > 0 ? '과 소리 종류 측정' : ''}으로 계산한 감각부하 지수예요. 점이 있는 시간대는 소리 종류 측정 표본이 있어요.
        {' '}소리 표본 {totalN}개{totalN === 0 ? ' (소리 미측정)' : tags.length ? `, 지금 시간대 주요 소리: ${tags.map((t) => TAG_LABEL[t]).join(', ')}` : ''}.
        {snap?.source === 'demo' && ' 데모 데이터라 예측값은 전형 패턴이에요.'}
      </p>
      <div className="row">
        <button className="btn primary" onClick={makeCard} disabled={loading}>{loading ? '만드는 중…' : '미리 보는 카드 만들기'}</button>
        <button className="btn" onClick={onMeasure}>여기서 소리 측정하기</button>
      </div>
      {card && assembled && <CardView card={assembled.card} note={card.note} place={place.name} />}
      {assembled?.reason && <p className="muted">{assembled.reason}</p>}
      <Factors extra={ps?.stale ? undefined : ps?.extra} />
      <NoiseCard noise={noise} place={place.name} />
      {nearby && <NearbyCalm items={nearby} maxKm={NEARBY_MAX_KM} onSelect={onSelect} />}
      <WeekPattern pattern={pattern} place={place.name} />
      <div className="card" style={{ marginTop: 12 }}>
        <h3>다녀온 뒤 기록</h3>
        <p className="muted">버튼 두 개로 끝나요. 이 기기에만 저장되고 서버로 가지 않아요.</p>
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
      </div>
    </section>
  )
}
