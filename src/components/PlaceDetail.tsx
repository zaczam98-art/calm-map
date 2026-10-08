import { useMemo, useState } from 'react'
import type { Card, ChildProfile, NoiseData, Place, SenseTag, Snapshot, WeekPattern as WeekPatternData } from '../types'
import { TAG_LABEL } from '../types'
import { dowOfTime, hourScores, LEVEL3_LABEL, recommend } from '../lib/index'
import { bucketKey, type SoundStore } from '../lib/snapshot'
import { recordVisit } from '../lib/profile'
import { getCard } from '../lib/cards'
import { topTags } from '../lib/sound'
import { calmerNearby, NEARBY_MAX_KM } from '../lib/nearby'
import HourChart from './HourChart'
import CardView from './CardView'
import NearbyCalm from './NearbyCalm'
import WeekPattern from './WeekPattern'
import Factors from './Factors'
import NoiseCard from './NoiseCard'

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
  const scores = useMemo(() => hourScores(ps, (h, d) => sound[place.name]?.[bucketKey(d, h)], profile, offsets[place.name] ?? 0, nowKey), [ps, sound, profile, offsets, place.name, nowKey])
  const rec = recommend(scores)
  const now = scores[0]
  const nowBucket = now ? sound[place.name]?.[bucketKey(dowOfTime(now.time), now.hour)] : undefined
  const tags: SenseTag[] = nowBucket ? topTags(nowBucket) : []
  const totalN = Object.values(sound[place.name] ?? {}).reduce((a, b) => a + b.n, 0)
  // 지금 '보통' 이상일 때만, 가까운 곳 중 지수가 뚜렷이 낮은 곳을 찾는다
  const nearby = useMemo(() => {
    if (!now || now.index === null || now.level === 'calm' || now.level === 'nodata') return null
    return calmerNearby(place, now.level, places, (p) => hourScores(snap?.places[p.name], (h, d) => sound[p.name]?.[bucketKey(d, h)], profile, offsets[p.name] ?? 0, nowKey)[0])
  }, [now, place, places, snap, sound, profile, offsets, nowKey])
  const [card, setCard] = useState<{ card: Card; note: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [recorded, setRecorded] = useState<string | null>(null)

  const childTags = (Object.entries(profile.tags) as [SenseTag, number][]).filter(([, v]) => v > 1).map(([t]) => t)

  const makeCard = async () => {
    setLoading(true)
    const r = await getCard({
      place: place.name,
      category: place.category,
      level: now?.level ?? 'mid',
      hourLabel: rec.from !== null ? `${rec.from}시` : '오늘',
      tags,
      childTags: profile.enabled ? childTags : [],
    })
    setCard(r)
    setLoading(false)
  }

  const record = (ok: boolean) => {
    const r = recordVisit(place.name, ok, tags)
    onRecorded(r.offsets, r.profile)
    const applied = profile.enabled ? '' : ' 맞춤을 켜면 이 기록이 지수에 반영돼요.'
    setRecorded(
      ok
        ? `고마워요. 이 장소의 맞춤 보정을 조금 낮췄어요.${applied}`
        : `기록했어요. 이 장소의 맞춤 보정을 조금 올렸어요.${tags.length ? ' 그 시간에 측정된 소리 요인의 민감도도 올렸어요.' : ''}${applied}`,
    )
  }

  return (
    <section className="sheet" aria-label={`${place.name} 상세`}>
      <div className="handle" />
      <button className="close" onClick={onClose} aria-label="닫기">×</button>
      <h2>{place.name} <span className="muted">{place.category}</span></h2>
      <p>
        <span className={`pill ${now?.level ?? 'nodata'}`}>{LEVEL3_LABEL[now?.level ?? 'nodata']}</span>{' '}
        {now?.index != null && <span className="muted">지금 지수 {now.index}{now.forecast ? ' (예측값)' : ''}{profile.enabled ? ' (우리 아이 맞춤)' : ''}</span>}
      </p>
      <p><b>{rec.text}</b></p>
      <HourChart scores={scores} highlight={rec.from} />
      <p className="muted">
        막대는 혼잡도 예측{totalN > 0 ? '과 소리 측정' : ''}으로 계산한 감각부하 지수예요. 점이 있는 시간대는 소리 측정 표본이 있어요.
        {' '}소리 표본 {totalN}개{totalN === 0 ? ' (소리 미측정)' : tags.length ? `, 지금 시간대 주요 소리: ${tags.map((t) => TAG_LABEL[t]).join(', ')}` : ''}.
        {snap?.source === 'demo' && ' 데모 데이터라 예측값은 전형 패턴이에요.'}
      </p>
      <div className="row">
        <button className="btn primary" onClick={makeCard} disabled={loading}>{loading ? '만드는 중…' : '미리 보는 카드 만들기'}</button>
        <button className="btn" onClick={onMeasure}>여기서 소리 측정하기</button>
      </div>
      {card && <CardView card={card.card} note={card.note} place={place.name} />}
      <Factors extra={ps?.extra} />
      <NoiseCard noise={noise} place={place.name} />
      {nearby && <NearbyCalm items={nearby} maxKm={NEARBY_MAX_KM} onSelect={onSelect} />}
      <WeekPattern pattern={pattern} place={place.name} />
      <div className="card" style={{ marginTop: 12 }}>
        <h2>다녀온 뒤 기록</h2>
        <p className="muted">버튼 두 개로 끝나요. 이 기기에만 저장되고 서버로 가지 않아요.</p>
        <div className="row">
          <button className="btn big" onClick={() => record(true)}>😊 괜찮았어요</button>
          <button className="btn big" onClick={() => record(false)}>😣 힘들었어요</button>
        </div>
        {recorded && <p className="muted" style={{ marginTop: 8 }}>{recorded}</p>}
      </div>
    </section>
  )
}
