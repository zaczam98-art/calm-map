import { useMemo, useState } from 'react'
import type { ChildProfile, HourScore, Level3, NoiseData, Place, Snapshot } from '../types'
import { hourScores, LEVEL3_LABEL } from '../lib/index'
import { distanceKm } from '../lib/nearby'
import { factorTags } from '../lib/factors'
import { noiseLookup } from '../lib/noise'
import { bucketKey, type SoundStore } from '../lib/snapshot'

interface Props {
  places: Place[]
  snap: Snapshot | null
  sound: SoundStore
  profile: ChildProfile
  offsets: Record<string, number>
  nowKey: string | undefined
  noise: NoiseData | null
  ui: RecommendUi
  onUi: (u: RecommendUi) => void
  onOpen: (name: string) => void
}

const GROUPS: [string, string[]][] = [
  ['전체', []],
  ['공원', ['공원']],
  ['궁궐·유적', ['고궁·문화유산']],
  ['상권·거리', ['발달상권', '관광특구']],
  ['역 주변', ['인구밀집지역']],
]
const RANK: Record<Level3, number> = { calm: 0, mid: 1, busy: 2, nodata: 3 }

/** 지금부터 무던한 시간이 얼마나 이어지는지, 아니면 언제부터 무던해지는지 한 줄로 */
function calmLine(scores: HourScore[]): string {
  if (scores.length === 0) return '예측 자료가 없어요.'
  const now = scores[0]
  const dayWord = (s: HourScore) => (s.time.slice(0, 10) === now.time.slice(0, 10) ? '' : '내일 ')
  if (now.level === 'calm') {
    let n = 0
    while (n < scores.length && scores[n].level === 'calm') n++
    return n >= scores.length ? '예측 범위 내내 무던해요.' : `지금부터 ${dayWord(scores[n])}${scores[n].hour}시 전까지 무던해요.`
  }
  const next = scores.find((s, i) => i > 0 && s.level === 'calm' && s.hour >= 8 && s.hour <= 21)
  return next ? `${dayWord(next)}${next.hour}시부터 무던해져요.` : '예측 범위의 8~21시 사이에는 무던한 시간대가 보이지 않아요.'
}

/** 탭을 옮겼다 돌아와도 유지할 추천 화면의 선택 상태(부모가 보관) */
export interface RecommendUi {
  group: number
  pos: { lat: number; lng: number } | null
  byDistance: boolean
}

export default function Recommend({ places, snap, sound, profile, offsets, nowKey, noise, ui, onUi, onOpen }: Props) {
  const { group, pos, byDistance } = ui
  const setGroup = (g: number) => onUi({ ...ui, group: g })
  const setByDistance = (b: boolean) => onUi({ ...ui, byDistance: b })
  const [geoMsg, setGeoMsg] = useState<string | null>(null)

  const rows = useMemo(() => {
    return places.map((p) => {
      const s = snap?.places[p.name]
      const scores = hourScores(s, (h, d) => sound[p.name]?.[bucketKey(d, h)], profile, offsets[p.name] ?? 0, nowKey, noiseLookup(noise, p.name))
      const now = scores[0]
      return { place: p, level: (now?.level ?? 'nodata') as Level3, index: now?.index ?? null, line: calmLine(scores), km: pos ? distanceKm(pos, p) : null, tags: factorTags(s?.extra).filter((t) => t.key.startsWith('control') || t.key === 'rain').slice(0, 2) }
    })
  }, [places, snap, sound, profile, offsets, pos, nowKey, noise])

  const cats = GROUPS[group][1]
  const shown = rows
    .filter((r) => cats.length === 0 || cats.includes(r.place.category))
    .sort((a, b) => {
      if (byDistance && a.km !== null && b.km !== null) return a.km - b.km
      return RANK[a.level] - RANK[b.level] || (a.index ?? 999) - (b.index ?? 999) || (a.km ?? 0) - (b.km ?? 0)
    })

  const locate = () => {
    if (!('geolocation' in navigator)) {
      setGeoMsg('이 브라우저는 위치 기능을 지원하지 않아요.')
      return
    }
    setGeoMsg('위치를 확인하는 중이에요…')
    navigator.geolocation.getCurrentPosition(
      (g) => {
        onUi({ ...ui, pos: { lat: g.coords.latitude, lng: g.coords.longitude }, byDistance: true })
        setGeoMsg(null)
      },
      () => setGeoMsg('위치를 확인하지 못했어요. 브라우저의 위치 권한을 확인해 주세요.'),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    )
  }

  return (
    <div className="page">
      <div className="card">
        <h2>지금 가기 좋은 곳</h2>
        <p className="muted">
          서울 {places.length}곳을 지금 무던한 순서로 보여 줘요{profile.enabled ? '(우리 아이 맞춤 적용)' : ''}.
          {snap?.source === 'seoul' ? ` 서울시 ${snap.updatedAt.slice(11, 16)} 자료 기준이에요.` : ' 지금은 데모 자료예요.'}
        </p>
        <div className="row" role="group" aria-label="장소 종류">
          {GROUPS.map(([label], i) => (
            <button key={label} className={`chip${group === i ? ' on' : ''}`} onClick={() => setGroup(i)} aria-pressed={group === i}>{label}</button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          {pos ? (
            <>
              <button className={`chip${!byDistance ? ' on' : ''}`} onClick={() => setByDistance(false)} aria-pressed={!byDistance}>무던한 순</button>
              <button className={`chip${byDistance ? ' on' : ''}`} onClick={() => setByDistance(true)} aria-pressed={byDistance}>가까운 순</button>
            </>
          ) : (
            <button className="btn" onClick={locate}>📍 내 위치에서 가까운 순으로 보기</button>
          )}
        </div>
        <p className="muted" style={{ marginTop: 8 }}>{geoMsg ?? '위치는 이 기기에서 거리 계산에만 쓰고, 저장하거나 어디로 보내지 않아요.'}</p>
      </div>
      <ul className="rec-list">
        {shown.map((r) => (
          <li key={r.place.name}>
            <button className="rec-item" onClick={() => onOpen(r.place.name)}>
              <span className={`pill ${r.level}`}>{LEVEL3_LABEL[r.level]}</span>
              <span className="rec-main">
                <b>{r.place.name}</b> <span className="muted">{r.place.category}{r.km !== null ? ` · 직선 ${r.km.toFixed(1)}km` : ''}</span>
                <br />
                <span>{r.line}</span>
                {r.tags.map((t) => (
                  <span key={t.key} className="factor small">{t.label}</span>
                ))}
              </span>
              {r.index !== null && <span className="rec-index" aria-label={`지수 ${r.index}`}>{r.index}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
