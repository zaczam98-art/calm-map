import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import placesRaw from './data/places.json'
import type { Briefing as BriefingData, ChildProfile, ForecastMetrics, NoiseData, Place, Snapshot, WeekPattern } from './types'
import { loadProfile, loadOffsets, saveProfile } from './lib/profile'
import { loadSnapshot, loadSoundStore, type SoundStore } from './lib/snapshot'
import { kstNow, loadPublicJson } from './lib/publicData'
import { nowKeyFor } from './lib/index'
import MapView from './components/MapView'
import PlaceDetail from './components/PlaceDetail'
import ChildProfileView from './components/ChildProfile'
import Briefing from './components/Briefing'
import Recommend, { type RecommendUi } from './components/Recommend'
import LazyBoundary from './components/LazyBoundary'

// 소리 측정(TensorFlow.js)과 정보 화면은 처음 화면에 필요 없으므로 열 때 내려받는다
const Measure = lazy(() => import('./components/Measure'))
const Info = lazy(() => import('./components/Info'))

export const PLACES = (placesRaw as Place[]).filter((p) => p.tracked)
const PLACE_NAMES = new Set(PLACES.map((p) => p.name))

type View = 'map' | 'recommend' | 'child' | 'measure' | 'info'

const NAV: [View, string, string][] = [
  ['map', '🗺️', '지도'],
  ['recommend', '⭐', '추천'],
  ['child', '🧒', '우리 아이'],
  ['measure', '🎙️', '현장 측정'],
  ['info', 'ℹ️', '정보'],
]
const VIEWS = NAV.map(([v]) => v)
const VIEW_LABEL = Object.fromEntries(NAV.map(([v, , label]) => [v, label])) as Record<View, string>

const BRIEFING_KEY = 'calmmap.briefing.v1'
const TIP_KEY = 'calmmap.tip.v1'
const STALE_MIN = 120 // 이만큼 지난 자료에는 '몇 시간 전 자료'를 붙인다
const TOO_OLD_MIN = 720 // 이만큼 지나면 예측을 보여 주지 않고 브리핑도 숨긴다

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function lsSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* 저장할 수 없는 환경에서는 이번 방문에서만 기억한다 */
  }
}

function initialBriefingCollapsed(): boolean {
  try {
    const v = JSON.parse(lsGet(BRIEFING_KEY) || 'null')
    if (v && v.date === kstNow().date && typeof v.collapsed === 'boolean') return v.collapsed
  } catch {
    /* 저장값이 깨졌으면 기본값을 쓴다 */
  }
  return !window.matchMedia('(min-width:700px)').matches
}

/** 'YYYY-MM-DD HH:MM'(한국 시간) 자료가 지금으로부터 몇 분 전인지 */
function ageMinutes(updatedAt: string, now = Date.now()): number {
  const t = Date.UTC(+updatedAt.slice(0, 4), +updatedAt.slice(5, 7) - 1, +updatedAt.slice(8, 10), +updatedAt.slice(11, 13), +updatedAt.slice(14, 16))
  const m = (now + 9 * 3600_000 - t) / 60_000
  return Number.isFinite(m) ? Math.max(0, m) : 0
}

/** 장소 상세는 '#/place/이름', 나머지는 '#/탭'. 추천 탭에서 연 장소도 주소는 '#/place/이름'이고 어느 탭인지는 history.state에 둔다. */
function urlFor(view: View, selected: string | null): string {
  return selected && (view === 'map' || view === 'recommend') ? `#/place/${encodeURIComponent(selected)}` : `#/${view}`
}

function readLocation(): { view: View; selected: string | null } {
  const st = history.state as { view?: unknown; selected?: unknown } | null
  if (st && VIEWS.includes(st.view as View)) {
    return { view: st.view as View, selected: typeof st.selected === 'string' && PLACE_NAMES.has(st.selected) ? st.selected : null }
  }
  const h = location.hash.replace(/^#\/?/, '')
  if (h.startsWith('place/')) {
    try {
      const name = decodeURIComponent(h.slice(6))
      return { view: 'map', selected: PLACE_NAMES.has(name) ? name : null }
    } catch {
      return { view: 'map', selected: null }
    }
  }
  return { view: VIEWS.includes(h as View) ? (h as View) : 'map', selected: null }
}

/** 맞춤을 켰어도 고른 것이 없어 지수가 그대로인 프로필인지 */
function isDefaultSens(p: ChildProfile): boolean {
  return p.crowd === 1 && p.loud === 1 && Object.values(p.tags).every((v) => v === 1)
}

export default function App() {
  const [initialLoc] = useState(readLocation)
  const [view, setView] = useState<View>(initialLoc.view)
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [sound, setSound] = useState<SoundStore>({})
  const [profile, setProfile] = useState<ChildProfile>(() => loadProfile())
  const [offsets, setOffsets] = useState<Record<string, number>>(() => loadOffsets())
  const [selected, setSelected] = useState<string | null>(null)
  const [soundVersion, setSoundVersion] = useState(0)
  const [pattern, setPattern] = useState<WeekPattern | null>(null)
  const [metrics, setMetrics] = useState<ForecastMetrics | null>(null)
  const [briefing, setBriefing] = useState<BriefingData | null>(null)
  const [noise, setNoise] = useState<NoiseData | null>(null)
  const [loading, setLoading] = useState(true)
  const [briefingCollapsed, setBriefingCollapsedState] = useState(initialBriefingCollapsed)
  const [tipOpen, setTipOpen] = useState(() => lsGet(TIP_KEY) === null)
  const [tileErr, setTileErr] = useState(0) // 0 없음, 1 안내 중, 2 닫음
  const [measureRunning, setMeasureRunning] = useState(false)

  const viewRef = useRef(view)
  viewRef.current = view
  const snapRef = useRef(snap)
  snapRef.current = snap
  // 주소로 들어온 장소는 자료가 도착한 뒤에 연다
  const pendingPlace = useRef(initialLoc.selected)
  const mainRef = useRef<HTMLElement>(null)
  const dragStart = useRef<{ x: number; y: number } | null>(null)

  const navigate = useCallback((v: View, sel: string | null, replace = false) => {
    pendingPlace.current = null
    setView(v)
    setSelected(sel)
    const hash = urlFor(v, sel)
    const state = { view: v, selected: sel }
    try {
      if (replace) history.replaceState(state, '', hash)
      else if (location.hash !== hash) history.pushState(state, '', hash)
    } catch {
      /* 주소를 바꿀 수 없는 환경에서는 화면만 바꾼다 */
    }
  }, [])
  const openPlace = useCallback((name: string) => navigate(viewRef.current === 'recommend' ? 'recommend' : 'map', name), [navigate])
  const closeSheet = () => navigate(view, null, true) // 뒤로 가기가 사이트를 떠나지 않도록 기록을 쌓지 않고 바꾼다
  const go = (v: View) => {
    if (v === view) return
    if (view === 'measure' && measureRunning) {
      if (!window.confirm('측정 중이에요. 나가면 지금까지 결과가 사라져요. 나갈까요?')) return
    }
    navigate(v, v === 'recommend' || (v === 'map' && view === 'recommend') ? null : selected)
  }

  useEffect(() => {
    const onPop = () => {
      const loc = readLocation()
      pendingPlace.current = null
      setView(loc.view)
      setSelected(loc.selected)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  useEffect(() => {
    if (snap && pendingPlace.current) {
      setSelected(pendingPlace.current)
      pendingPlace.current = null
    }
  }, [snap])
  useEffect(() => {
    if (view !== 'measure') setMeasureRunning(false) // 측정 화면을 벗어나면(뒤로 가기 포함) 측정은 끝난 것이다
  }, [view])
  useEffect(() => {
    document.title = `${selected && (view === 'map' || view === 'recommend') ? selected : VIEW_LABEL[view]} · 무던한 지도`
  }, [view, selected])
  // 추천 탭 위에 뜬 시트는 목록 위에 맞는 모양(.on-list)으로 그린다
  useEffect(() => {
    mainRef.current?.querySelector('.sheet')?.classList.toggle('on-list', view === 'recommend')
  }, [view, selected])

  // 열어 둔 채 시간이 지나도 '지금'이 맞도록 1분마다 시각을 다시 보고, 화면에 돌아왔을 때 10분이 지났으면 자료를 다시 읽는다
  const [tick, setTick] = useState(0)
  const loadedAt = useRef(0)
  const retryTimer = useRef<number | undefined>(undefined)
  const refresh = (autoRetry = true) => {
    loadedAt.current = Date.now()
    setLoading(true)
    const snapP = loadSnapshot().catch(() => null)
    const noiseP = loadPublicJson<NoiseData>('noise.json').then((v) => {
      if (v) setNoise((prev) => (prev && prev.updatedAt === v.updatedAt ? prev : v))
      return v
    })
    // 소음 자료가 먼저 들어간 뒤(최대 4초) 스냅샷을 넣어, 마커 색이 처음에 한 번 바뀌어 보이지 않게 한다
    const noiseOrWait = Promise.race([noiseP, new Promise<null>((r) => setTimeout(() => r(null), 4000))])
    void Promise.all([snapP, noiseOrWait]).then(([s]) => {
      setLoading(false)
      // 다시 읽기가 실패해 데모로 떨어지거나 같은 자료면 이미 있는 실제 자료를 유지한다
      if (s) setSnap((prev) => (prev && (s.source === 'demo' || prev.updatedAt === s.updatedAt) ? prev : s))
      // 실제 자료를 한 번도 받지 못한 채 데모로 떨어졌으면 10분을 기다리지 않고 30초 뒤 한 번 더 시도한다
      window.clearTimeout(retryTimer.current)
      if (autoRetry && snapRef.current?.source !== 'seoul' && s?.source !== 'seoul') {
        retryTimer.current = window.setTimeout(() => refresh(false), 30_000)
      }
    })
    void loadPublicJson<WeekPattern>('pattern.json').then((v) => v && setPattern((prev) => (prev && prev.updatedAt === v.updatedAt ? prev : v)))
    void loadPublicJson<ForecastMetrics>('metrics.json').then((v) => v && setMetrics((prev) => (prev && prev.updatedAt === v.updatedAt ? prev : v)))
    void loadPublicJson<BriefingData>('briefing.json').then((v) => v && setBriefing((prev) => (prev && prev.generatedAt === v.generatedAt ? prev : v)))
  }
  useEffect(() => {
    const bump = () => {
      setTick((t) => t + 1)
      if (document.visibilityState === 'visible' && Date.now() - loadedAt.current > 10 * 60_000) refresh()
    }
    const id = setInterval(bump, 60_000)
    document.addEventListener('visibilitychange', bump)
    return () => {
      clearInterval(id)
      window.clearTimeout(retryTimer.current)
      document.removeEventListener('visibilitychange', bump)
    }
  }, [])
  const nowKey = useMemo(() => nowKeyFor(snap), [snap, tick])
  useEffect(() => {
    refresh()
  }, [])
  const [recUi, setRecUi] = useState<RecommendUi>({ group: 0, pos: null, byDistance: false })
  useEffect(() => {
    void loadSoundStore().then(setSound)
  }, [soundVersion])

  const updateProfile = (p: ChildProfile) => {
    setProfile(p)
    saveProfile(p)
  }
  const personalOn = profile.enabled

  const setBriefingCollapsed = (collapsed: boolean) => {
    setBriefingCollapsedState(collapsed)
    lsSet(BRIEFING_KEY, JSON.stringify({ date: kstNow().date, collapsed }))
  }
  const closeTip = () => {
    setTipOpen(false)
    lsSet(TIP_KEY, '1')
  }
  const onTileError = useCallback(() => setTileErr((s) => (s === 0 ? 1 : s)), [])

  // 자료 상태: 받는 중 / 정상 / 예시 자료 / 둘 다 못 받음. 실제 자료가 있으면 다시 읽는 중에도 그대로 둔다.
  const loadState: 'loading' | 'ok' | 'demo' | 'fail' = snap?.source === 'seoul' ? 'ok' : loading ? 'loading' : snap ? 'demo' : 'fail'
  const age = snap?.source === 'seoul' ? ageMinutes(snap.updatedAt) : 0
  const stale = age >= STALE_MIN
  const tooOld = age >= TOO_OLD_MIN
  const today = snap?.updatedAt.slice(0, 10) === kstNow().date
  const hhmm = snap?.updatedAt.slice(11, 16) ?? ''
  const stampLabel = !snap ? '' : today ? `서울시 ${hhmm} 기준` : `${snap.updatedAt.slice(5, 7)}/${snap.updatedAt.slice(8, 10)} ${hhmm} 기준`

  const selPlace = selected ? PLACES.find((p) => p.name === selected) : undefined
  const showSheet = (view === 'map' || view === 'recommend') && !!selPlace
  const showData = view === 'map' || view === 'recommend'
  const lazyFallback = <p className="page muted" role="status">불러오는 중이에요</p>

  return (
    <div className="app">
      <header className="topbar">
        <h1>무던한 지도</h1>
        {loadState === 'loading' && <span className="badge">자료 불러오는 중…</span>}
        {loadState === 'demo' && <span className="badge demo">데모 데이터</span>}
        {loadState === 'fail' && <span className="badge warn">자료 없음</span>}
        {loadState === 'ok' &&
          (stale ? (
            <span className="badge warn" title={stampLabel}>
              {Math.floor(age / 60)}시간 전 자료
            </span>
          ) : (
            <span className="badge" title={stampLabel}>
              {today && <span className="pre">서울시 </span>}
              {today ? `${hhmm} 기준` : stampLabel}
            </span>
          ))}
        <label className="toggle">
          <input type="checkbox" checked={personalOn} onChange={(e) => updateProfile({ ...profile, enabled: e.target.checked })} />
          우리 아이 맞춤
        </label>
      </header>
      {view === 'map' && tipOpen && !selected && (
        <div className="tip">
          <span>연한 점일수록 무던해요. 점을 누르면 시간대별 지수가 나와요</span>
          <button onClick={closeTip}>닫기</button>
        </div>
      )}
      {showData && (loadState === 'demo' || loadState === 'fail') && (
        <div className="banner warn" role="status">
          <span>{snap ? '서울시 자료를 불러오지 못해 예시 자료를 보여 드려요' : '서울시 자료를 불러오지 못했어요'}</span>
          <button onClick={() => refresh(false)}>다시 시도</button>
        </div>
      )}
      {showData && tooOld && (
        <div className="banner warn" role="status">
          <span>자료가 오래돼 예측을 보여 드리지 못해요 ({stampLabel})</span>
        </div>
      )}
      {view === 'map' && tileErr === 1 && (
        <div className="banner warn" role="status">
          <span>지도 이미지를 불러오지 못했어요. 연결을 확인해 주세요</span>
          <button onClick={() => setTileErr(2)}>닫기</button>
        </div>
      )}
      {personalOn && isDefaultSens(profile) && view !== 'child' && (
        <div className="banner" role="status">
          <span>아직 아이가 예민한 소리를 고르지 않았어요</span>
          <button onClick={() => go('child')}>고르러 가기</button>
        </div>
      )}
      <main className="main" ref={mainRef}>
        {/* 지도는 탭을 옮겨도 닫지 않고 숨기기만 해서 확대와 위치가 유지된다 */}
        <div
          hidden={view !== 'map'}
          onPointerDown={(e) => {
            dragStart.current = (e.target as Element).closest('.briefing') ? null : { x: e.clientX, y: e.clientY }
          }}
          onPointerMove={(e) => {
            const s = dragStart.current
            // 지도를 끌기 시작하면 브리핑을 접는다
            if (s && e.buttons === 1 && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 12) {
              dragStart.current = null
              if (!briefingCollapsed) setBriefingCollapsed(true)
            }
          }}
          onPointerUp={() => (dragStart.current = null)}
          onPointerCancel={() => (dragStart.current = null)}
        >
          <button className="skip" onClick={() => go('recommend')}>
            지도를 건너뛰고 장소 목록 보기
          </button>
          <MapView
            places={PLACES}
            snap={snap}
            sound={sound}
            profile={profile}
            offsets={offsets}
            nowKey={nowKey}
            noise={noise}
            onSelect={openPlace}
            selected={selected}
            active={view === 'map'}
            onTileError={onTileError}
          />
          {snap?.source === 'seoul' && !tooOld && (
            <Briefing
              briefing={briefing}
              known={PLACE_NAMES}
              onSelect={openPlace}
              collapsed={briefingCollapsed}
              onToggle={() => setBriefingCollapsed(!briefingCollapsed)}
              hidden={!!selected}
              snap={snap}
              sound={sound}
              profile={profile}
              offsets={offsets}
              noise={noise}
              nowKey={nowKey}
            />
          )}
        </div>
        {showSheet && (
          <PlaceDetail
            key={selected}
            place={selPlace!}
            places={PLACES}
            pattern={pattern}
            noise={noise}
            onSelect={openPlace}
            nowKey={nowKey}
            snap={snap}
            sound={sound}
            profile={profile}
            offsets={offsets}
            onClose={closeSheet}
            onRecorded={(o, p) => {
              setOffsets(o)
              setProfile(p)
            }}
            onMeasure={() => go('measure')}
          />
        )}
        {view === 'recommend' && (
          <Recommend
            places={PLACES}
            snap={snap}
            loading={loading}
            sound={sound}
            profile={profile}
            offsets={offsets}
            nowKey={nowKey}
            noise={noise}
            ui={recUi}
            onUi={setRecUi}
            onOpen={openPlace}
          />
        )}
        {view === 'child' && (
          <ChildProfileView
            profile={profile}
            onChange={updateProfile}
            onOffsetsChange={setOffsets}
            onCleared={() => {
              setOffsets({})
              setSoundVersion((v) => v + 1)
            }}
          />
        )}
        {view === 'measure' && (
          <LazyBoundary onBack={() => go('map')}>
            <Suspense fallback={lazyFallback}>
              <Measure
                places={PLACES}
                defaultPlace={selected ?? PLACES[0].name}
                onSubmitted={() => setSoundVersion((v) => v + 1)}
                onRunningChange={setMeasureRunning}
              />
            </Suspense>
          </LazyBoundary>
        )}
        {view === 'info' && (
          <LazyBoundary onBack={() => go('map')}>
            <Suspense fallback={lazyFallback}>
              <Info snap={snap} metrics={metrics} noise={noise} placeCount={PLACES.length} />
            </Suspense>
          </LazyBoundary>
        )}
      </main>
      <nav className="nav" aria-label="주 메뉴">
        {NAV.map(([v, ico, label]) => (
          <button key={v} className={view === v ? 'on' : ''} onClick={() => go(v)} aria-label={label} aria-current={view === v ? 'page' : undefined}>
            <span aria-hidden>{ico}</span>
            {label}
          </button>
        ))}
      </nav>
    </div>
  )
}
