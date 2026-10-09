import { useEffect, useMemo, useRef, useState } from 'react'
import { CATEGORY_LABEL, placeLabel, type ChildProfile, type Level3, type NoiseData, type Place, type Snapshot } from '../types'
import { hourScores, LEVEL3_LABEL, recommend } from '../lib/index'
import { distanceKm } from '../lib/nearby'
import { activeControls, factorTags } from '../lib/factors'
import { noiseLookup } from '../lib/noise'
import { matchesPlace } from '../lib/hangul'
import { kstNow } from '../lib/publicData'
import { bucketKey, type SoundStore } from '../lib/snapshot'

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
  onOpen: (name: string) => void
}

const CATEGORIES = ['공원', '고궁·문화유산', '발달상권', '관광특구', '인구밀집지역']
const GROUPS: [string, string[]][] = [['전체', []], ...CATEGORIES.map((c): [string, string[]] => [CATEGORY_LABEL[c] ?? c, [c]])]
const RANK: Record<Level3, number> = { calm: 0, mid: 1, busy: 2, nodata: 3 }

/** 목록 위 안내 문장의 자료 출처 부분. 자료 날짜가 오늘이 아니면 월/일을 함께 밝힌다. */
function sourceNote(snap: Snapshot | null, loading: boolean): string {
  if (snap === null) return loading ? '자료를 불러오는 중이에요.' : '자료를 불러오지 못했어요.'
  if (snap.source !== 'seoul') return '지금은 예시 자료예요.'
  const day = snap.updatedAt.slice(0, 10) === kstNow().date ? '' : `${snap.updatedAt.slice(5, 10).replace('-', '/')} `
  return `서울시 ${day}${snap.updatedAt.slice(11, 16)} 자료 기준이에요.`
}

/** 탭을 옮겼다 돌아와도 유지할 추천 화면의 선택 상태(부모가 보관) */
export interface RecommendUi {
  group: number
  pos: { lat: number; lng: number } | null
  byDistance: boolean
}

export default function Recommend({ places, snap, loading = false, sound, profile, offsets, nowKey, noise, ui, onUi, onOpen }: Props) {
  const { group, pos, byDistance } = ui
  // 위치 확인처럼 나중에 도착하는 응답이 그 사이에 바뀐 칩 선택을 되돌리지 않도록, 항상 최신 상태에 바뀐 값만 합쳐 보낸다
  const uiRef = useRef(ui)
  useEffect(() => {
    uiRef.current = ui
  }, [ui])
  const patchUi = (patch: Partial<RecommendUi>) => {
    uiRef.current = { ...uiRef.current, ...patch }
    onUi(uiRef.current)
  }
  const setGroup = (g: number) => patchUi({ group: g })
  const setByDistance = (b: boolean) => patchUi({ byDistance: b })
  const [geoMsg, setGeoMsg] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const rows = useMemo(() => {
    const k = kstNow()
    const nowStr = `${k.date} ${String(k.hour).padStart(2, '0')}:00`
    return places.map((p) => {
      const s = snap?.places[p.name]
      const scores = hourScores(s, (h, d) => sound[p.name]?.[bucketKey(d, h)], profile, offsets[p.name] ?? 0, nowKey, noiseLookup(noise, p.name))
      const now = scores[0]
      const tags = factorTags(activeControls(s?.extra, nowStr)).filter((t) => t.key.startsWith('control') || t.key === 'rain').slice(0, 2)
      return { place: p, level: (now?.level ?? 'nodata') as Level3, index: now?.index ?? null, line: recommend(scores, nowKey).short, km: pos ? distanceKm(pos, p) : null, tags }
    })
  }, [places, snap, sound, profile, offsets, pos, nowKey, noise])

  const cats = GROUPS[group][1]
  const q = query.trim()
  const shown = rows
    .filter((r) => cats.length === 0 || cats.includes(r.place.category))
    .filter((r) => matchesPlace(r.place.name, q))
    .sort((a, b) => {
      if (byDistance && a.km !== null && b.km !== null) return a.km - b.km
      return RANK[a.level] - RANK[b.level] || (a.index ?? 999) - (b.index ?? 999) || (a.km ?? 0) - (b.km ?? 0)
    })
  // 종류 칩 때문에 비었는지, 목록에 아예 없는 이름인지 구분해서 알려 준다
  const emptyMsg =
    shown.length > 0 || !q
      ? null
      : rows.some((r) => matchesPlace(r.place.name, q))
        ? '선택한 종류에는 없어요. 종류를 \'전체\'로 바꿔 보세요.'
        : `찾는 장소가 목록에 없어요(서울시 추적 ${places.length}곳만 있어요)`

  const locate = () => {
    if (!('geolocation' in navigator)) {
      setGeoMsg('이 브라우저는 위치 기능을 지원하지 않아요.')
      return
    }
    setGeoMsg('위치를 확인하는 중이에요…')
    navigator.geolocation.getCurrentPosition(
      (g) => {
        patchUi({ pos: { lat: g.coords.latitude, lng: g.coords.longitude }, byDistance: true })
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
          서울 {places.length}곳을 지금 무던한 순서로 보여 줘요{profile.enabled ? '(우리 아이 맞춤 적용)' : ''}. {sourceNote(snap, loading)}
        </p>
        {snap !== null && <p className="muted">각 줄 오른쪽의 점수가 지수예요. 지수는 0~100이고 낮을수록 편안해요.</p>}
        <div className="search">
          <label>
            이름으로 찾기{' '}
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="예: 어린이대공원, ㅎㄷ" autoComplete="off" spellCheck={false} />
          </label>
        </div>
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
        <p className="muted" style={{ marginTop: 8 }} role="status">{geoMsg ?? '위치는 이 기기에서 거리 계산에만 쓰고, 저장하거나 어디로 보내지 않아요.'}</p>
      </div>
      <div role="status">{emptyMsg && <p className="muted">{emptyMsg}</p>}</div>
      {snap === null ? (
        <p className="muted" role="status">{loading ? '자료를 불러오는 중이에요…' : '서울시 자료도 예시 자료도 받지 못해서 목록을 보여 드릴 수 없어요. 연결을 확인한 뒤 위의 다시 시도를 눌러 주세요.'}</p>
      ) : (
      <ul className="rec-list">
        {shown.map((r) => (
          <li key={r.place.name}>
            <button className="rec-item" onClick={() => onOpen(r.place.name)}>
              <span className={`pill ${r.level}`}>{LEVEL3_LABEL[r.level]}</span>
              <span className="rec-main">
                <b>{r.place.name}</b> <span className="muted">{[placeLabel(r.place), r.km !== null ? `직선 ${r.km.toFixed(1)}km` : ''].filter(Boolean).join(' · ')}</span>
                <br />
                <span>{r.line}</span>
                {r.tags.map((t) => (
                  <span key={t.key} className="factor small">{t.label}</span>
                ))}
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
    </div>
  )
}
