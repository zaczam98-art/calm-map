import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import placesRaw from './data/places.json'
import type { Briefing as BriefingData, ChildProfile, ForecastMetrics, NoiseData, Place, SenseTag, Snapshot, WeekPattern } from './types'
import { SENSE_TAGS } from './types'
import { loadProfile, loadOffsets, saveProfile } from './lib/profile'
import { loadSnapshot, loadSoundStore, type SoundStore } from './lib/snapshot'
import { kstNow, loadPublicJson } from './lib/publicData'
import { nowKeyFor } from './lib/index'
import MapView from './components/MapView'
import PlaceDetail from './components/PlaceDetail'
import ChildProfileView from './components/ChildProfile'
import Briefing from './components/Briefing'
import Recommend from './components/Recommend'
import LazyBoundary from './components/LazyBoundary'
import Onboarding from './components/Onboarding'
import Landing from './components/Landing'
import { isBlankHash, markLandingDone, shouldAutoShowLanding } from './lib/landing'
import { HEADER_LINK_LABEL, LANDING_TITLE, TIP_TEXT } from './lib/landingCopy'
import { tagCard, useChangeTick, withViewTransition } from './lib/motion'
import { initialRecUi, type RecommendUi } from './lib/recPrefs'
import './styles/nav.css'

// 소리 측정(TensorFlow.js)과 정보 화면은 처음 화면에 필요 없으므로 열 때 내려받는다
const Measure = lazy(() => import('./components/Measure'))
const Info = lazy(() => import('./components/Info'))

export const PLACES = (placesRaw as Place[]).filter((p) => p.tracked)
const PLACE_NAMES = new Set(PLACES.map((p) => p.name))

type View = 'map' | 'recommend' | 'child' | 'measure' | 'info'
/** 랜딩('start')은 탭이 아니라서 View에 넣지 않는다(VIEW_LABEL과 NAV_ICON이 View만 키로 쓴다) */
type Screen = View | 'start'

const NAV: [View, string][] = [
  ['map', '지도'],
  ['recommend', '추천'],
  ['child', '우리 아이'],
  ['measure', '현장 측정'],
  ['info', '정보'],
]
const VIEWS = NAV.map(([v]) => v)
const SCREENS: Screen[] = [...VIEWS, 'start']
const VIEW_LABEL = Object.fromEntries(NAV) as Record<View, string>

/** 하단 탭 아이콘(24x24 선 아이콘). 선 굵기와 색은 nav.css가 정한다. */
const NAV_ICON: Record<View, ReactNode> = {
  map: (
    <>
      <path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z" />
      <path d="M9 4v13.5M15 6.5V20" />
    </>
  ),
  recommend: <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z" />,
  child: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.9 3.1-6.5 7-6.5s7 2.6 7 6.5" />
    </>
  ),
  measure: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.5h.01" />
    </>
  ),
}

/** 헤더 '적용 중' 칩에 나열할 이름. 민감도를 예민(1.5)으로 고른 항목만 보여 준다. */
const APPLIED_TAG: Partial<Record<SenseTag, string>> = {
  sudden: '사이렌',
  crowd: '군중 소리',
  machine: '기계 소리',
  music: '안내방송·음악',
  speech: '말소리',
  ambient: '배경음',
}

/** 칩 글자를 앞머리('적용 중: ')와 나머지로 나눈다. 좁은 화면(520px 이하)에서는 이름 대신 짧은 글자(count)만 보여 주고, 이름 전체는 title과 aria-label에 있다. */
function appliedParts(p: ChildProfile): { lead: string; rest: string; count: string } {
  const items: string[] = []
  for (const t of SENSE_TAGS) if (p.tags[t] === 1.5 && APPLIED_TAG[t]) items.push(APPLIED_TAG[t]!)
  if (p.crowd === 1.5) items.push('사람 많은 곳')
  if (p.loud === 1.5) items.push('큰 소리')
  if (items.length) return { lead: '적용 중: ', rest: items.join(', '), count: `${items.length}개 적용` }
  return isDefaultSens(p) ? { lead: '', rest: '아직 고르지 않았어요', count: '0개 적용' } : { lead: '적용 중: ', rest: '직접 고른 값', count: '설정됨' }
}

const MEASURE_LEAVE_MSG = '측정 중이에요. 나가면 지금까지 결과가 사라져요. 나갈까요?'
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

/** 장소 상세는 '#/place/이름', 나머지는 '#/탭'. 추천 탭에서 연 장소도 주소는 '#/place/이름'이고 어느 탭인지는 history.state에 둔다.
 * 가까운 곳 후보로 연 시트가 돌아갈 장소(backTo)도 history.state에 두어, 한 단계씩 보기를 닫거나 앞으로 가기로 돌아와도 돌아가기 단추가 남게 한다. */
function urlFor(view: Screen, selected: string | null): string {
  return selected && (view === 'map' || view === 'recommend') ? `#/place/${encodeURIComponent(selected)}` : `#/${view}`
}

/** shared: 공유 링크가 연 기록 칸인지. 칸의 state에 남겨 두므로 소개 화면을 거쳐 뒤로 가기로 돌아와도 알 수 있다. fresh는 문서를 처음 열 때만 true로 부른다. */
function readLocation(fresh = false): { view: Screen; selected: string | null; backTo: string | null; shared: boolean } {
  const st = history.state as { view?: unknown; selected?: unknown; backTo?: unknown; shared?: unknown } | null
  if (st && SCREENS.includes(st.view as Screen)) {
    const selected = typeof st.selected === 'string' && PLACE_NAMES.has(st.selected) ? st.selected : null
    const backTo = selected && typeof st.backTo === 'string' && st.backTo !== selected && PLACE_NAMES.has(st.backTo) ? st.backTo : null
    return { view: st.view as Screen, selected, backTo, shared: selected !== null && st.shared === true }
  }
  const h = location.hash.replace(/^#\/?/, '')
  if (h.startsWith('place/')) {
    try {
      const name = decodeURIComponent(h.slice(6))
      const selected = PLACE_NAMES.has(name) ? name : null
      return { view: 'map', selected, backTo: null, shared: fresh && selected !== null }
    } catch {
      return { view: 'map', selected: null, backTo: null, shared: false }
    }
  }
  return { view: SCREENS.includes(h as Screen) ? (h as Screen) : 'map', selected: null, backTo: null, shared: false }
}

/** 맞춤을 켰어도 고른 것이 없어 지수가 그대로인 프로필인지 */
function isDefaultSens(p: ChildProfile): boolean {
  return p.crowd === 1 && p.loud === 1 && Object.values(p.tags).every((v) => v === 1)
}

export default function App() {
  const [initialLoc] = useState(() => readLocation(true))
  // 주소가 비어 있는 첫 방문이면 주소를 바꾸지 않고 랜딩만 그린다. 단추로 나가면 꺼지고, 정보 링크로 나갔다가 뒤로 가기로 빈 주소에 돌아오면 다시 그린다.
  const [autoLanding, setAutoLanding] = useState(() => initialLoc.view === 'map' && initialLoc.selected === null && shouldAutoShowLanding())
  const [screen, setScreen] = useState<Screen>(() => (autoLanding ? 'start' : initialLoc.view))
  const onStart = screen === 'start'
  const view: View = onStart ? 'map' : screen // 랜딩 뒤에는 숨은 지도가 그대로 있다
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [sound, setSound] = useState<SoundStore>({})
  const [profile, setProfile] = useState<ChildProfile>(() => loadProfile())
  const [offsets, setOffsets] = useState<Record<string, number>>(() => loadOffsets())
  const [selected, setSelected] = useState<string | null>(null)
  const [selectedHour, setSelectedHour] = useState<number | null>(null) // 지도 슬라이더와 장소 시트가 함께 쓰는 시각(0~23, null=지금)
  const [backTo, setBackTo] = useState<string | null>(initialLoc.backTo) // 가까운 곳 후보를 눌러 열었을 때 돌아갈 장소(직접 연 시트는 null). 새로고침해도 history.state에서 되살린다.
  const [soundVersion, setSoundVersion] = useState(0)
  const [pattern, setPattern] = useState<WeekPattern | null>(null)
  const [metrics, setMetrics] = useState<ForecastMetrics | null>(null)
  const [briefing, setBriefing] = useState<BriefingData | null>(null)
  const [noise, setNoise] = useState<NoiseData | null>(null)
  const [loading, setLoading] = useState(true)
  const [briefingCollapsed, setBriefingCollapsedState] = useState(initialBriefingCollapsed)
  const [introOpen, setIntroOpen] = useState(false) // 칩 질문 시트: 랜딩의 '아이가 힘들어하는 것 고르기'로만 열린다
  // 공유 링크(#/place/이름)가 연 기록 칸의 장소. 그 칸의 시트 위에만 소개 띠를 보여 준다. 다른 칸으로 옮기면 지우고, 뒤로 가기로 그 칸에 돌아오면 state에서 되살린다.
  const [sharedPlace, setSharedPlace] = useState(initialLoc.shared ? initialLoc.selected : null)
  const [tipOpen, setTipOpen] = useState(() => lsGet(TIP_KEY) === null)
  const [tileErr, setTileErr] = useState(0) // 0 없음, 1 안내 중, 2 닫음
  const [measureRunning, setMeasureRunning] = useState(false)

  const viewRef = useRef(view)
  viewRef.current = view
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const autoLandingRef = useRef(autoLanding)
  autoLandingRef.current = autoLanding
  const startFocus = useRef(false) // 헤더 제목, 링크, 뒤로 가기로 랜딩에 들어올 때만 제목으로 초점을 보낸다
  const leaveFocus = useRef<'map' | 'child' | 'nav' | null>(null) // 랜딩을 떠난 뒤 초점을 보낼 곳
  const measureRunningRef = useRef(measureRunning)
  measureRunningRef.current = measureRunning
  const ignorePop = useRef(false) // 뒤로 가기를 되돌리느라 일어난 popstate는 건너뛴다
  const snapRef = useRef(snap)
  snapRef.current = snap
  // 주소로 들어온 장소는 자료가 도착한 뒤에 연다
  const pendingPlace = useRef(initialLoc.selected)
  const mainRef = useRef<HTMLElement>(null)
  const dragStart = useRef<{ x: number; y: number } | null>(null)

  const navigate = useCallback((v: Screen, sel: string | null, replace = false, back?: string) => {
    pendingPlace.current = null
    if (v === 'start') startFocus.current = true
    setScreen(v)
    setSelected(sel)
    const hash = urlFor(v, sel)
    if (replace || location.hash !== hash) setSharedPlace(null) // 같은 칸에 머무는 동안(같은 장소를 다시 누름)만 띠를 둔다
    const state = back ? { view: v, selected: sel, backTo: back } : { view: v, selected: sel }
    try {
      if (replace) history.replaceState(state, '', hash)
      else if (location.hash !== hash) history.pushState(state, '', hash)
    } catch {
      /* 주소를 바꿀 수 없는 환경에서는 화면만 바꾼다 */
    }
  }, [])
  const openPlace = useCallback(
    (name: string, from?: string, card?: Element) => {
      const open = () => {
        setBackTo(from ?? null)
        navigate(viewRef.current === 'recommend' ? 'recommend' : 'map', name, false, from)
      }
      // 추천 목록에서 누른 카드는 장소명과 지수가 시트 머리로 이어지는 전환을 쓴다. 이미 열린 장소의 카드를 다시 누르면 시트 머리와 카드가 같은 이름이 되어 전환이 중단되므로 그대로 연다. 지도와 가까운 곳 후보로 여는 경우도 그대로 연다.
      if (card && viewRef.current === 'recommend' && from === undefined && name !== selectedRef.current) {
        const before = selectedRef.current
        tagCard(card, PLACES.findIndex((p) => p.name === name))
        // 옛 화면을 찍은 뒤에 update가 불리므로, 그 사이에 다른 화면이나 장소로 옮겨 갔으면 카드를 열지 않고 마지막 동작을 따른다
        withViewTransition(() => viewRef.current === 'recommend' && selectedRef.current === before, open)
      } else open()
    },
    [navigate],
  )
  const closeSheet = () => {
    setBackTo(null)
    navigate(view, null, true) // 뒤로 가기가 사이트를 떠나지 않도록 기록을 쌓지 않고 바꾼다
  }
  const go = (v: View) => {
    if (v === view) return
    if (view === 'measure' && measureRunning) {
      if (!window.confirm(MEASURE_LEAVE_MSG)) return
    }
    setBackTo(null)
    navigate(v, v === 'recommend' || (v === 'map' && view === 'recommend') ? null : selected)
  }
  /** 소개 화면(#/start)을 연다. 헤더 제목과 공유 링크 띠가 쓰고, 측정 중이면 탭을 옮길 때와 같은 확인을 거친다. */
  const openStart = () => {
    if (onStart) return
    if (view === 'measure' && measureRunning && !window.confirm(MEASURE_LEAVE_MSG)) return
    setBackTo(null)
    navigate('start', null)
  }
  /** 랜딩의 진입 단추. 자동으로 띄운 랜딩은 주소가 없으므로 기록을 쌓지 않고 바꾸고(뒤로 가기가 막다른 길이 되지 않게), 직접 연 #/start에서는 기록을 쌓는다. */
  const enterApp = (kind: 'map' | 'pick' | 'child') => {
    markLandingDone()
    const replace = autoLanding && isBlankHash()
    if (replace) setAutoLanding(false) // 빈 주소 칸을 바꿨을 때만 끈다. 직접 연 #/start에서 쌓은 기록 아래에는 빈 주소 칸이 남아 있어 뒤로 가면 랜딩이 다시 뜬다.
    setBackTo(null)
    leaveFocus.current = kind === 'pick' ? null : kind // 시트는 스스로 첫 칩으로 초점을 가져간다
    navigate(kind === 'child' ? 'child' : 'map', null, replace)
    if (kind === 'pick') setIntroOpen(true)
  }

  // 공유 링크가 연 기록 칸에 표시를 남긴다. 소개 화면을 거쳐 뒤로 가기로 이 칸에 돌아오면 onPop이 이 표시를 읽어 띠를 되살린다.
  useEffect(() => {
    if (!initialLoc.shared || history.state) return
    try {
      history.replaceState({ view: 'map', selected: initialLoc.selected, shared: true }, '', location.href)
    } catch {
      /* 주소를 바꿀 수 없는 환경에서는 표시를 남기지 않는다 */
    }
  }, [initialLoc])
  useEffect(() => {
    const onPop = () => {
      if (ignorePop.current) {
        ignorePop.current = false
        return
      }
      // 한 단계씩 보기가 열려 있으면 뒤로 가기는 그것만 닫는다(CardView가 닫는다). 장소 시트는 그대로 둔다.
      if (document.querySelector('.cs-back')) return
      const loc = readLocation()
      // 자동으로 띄운 랜딩의 주소(빈 해시)로 돌아오면 지도 대신 랜딩을 다시 보여 준다
      const next: Screen = autoLandingRef.current && isBlankHash() ? 'start' : loc.view
      // 측정 중에 브라우저 뒤로 가기로 나가려 하면 탭을 누를 때와 같은 확인을 거친다. 취소하면 한 칸 앞으로 돌아온다.
      if (viewRef.current === 'measure' && measureRunningRef.current && next !== 'measure' && !window.confirm(MEASURE_LEAVE_MSG)) {
        ignorePop.current = true
        history.go(1)
        return
      }
      pendingPlace.current = null
      setBackTo(loc.backTo)
      setSharedPlace(loc.shared && next !== 'start' ? loc.selected : null)
      if (next === 'start') startFocus.current = true
      setIntroOpen(false) // 주소가 바뀌면 칩 질문 시트는 닫는다
      setScreen(next)
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
    document.title = onStart ? LANDING_TITLE : `${selected && (view === 'map' || view === 'recommend') ? selected : VIEW_LABEL[view]} · 무던한 지도`
  }, [view, selected, onStart])
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
    const noiseP = loadPublicJson<NoiseData>('noise.json').then((raw) => {
      // JSON이어도 places와 hours가 없는 모양이면 소음 자료로 쓰지 않는다(그대로 쓰면 지수 계산에서 앱 전체가 오류 화면이 된다)
      const v = raw && typeof raw.places === 'object' && raw.places !== null && Array.isArray(raw.hours) ? raw : null
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
  const [recUi, setRecUi] = useState<RecommendUi>(initialRecUi)
  const [planFor, setPlanFor] = useState<string | null>(null) // 추천 카드의 '외출 계획 세우기'로 열 장소. 시트가 마운트하며 계획을 함께 열고 이 신호를 지운다
  useEffect(() => {
    void loadSoundStore().then(setSound)
  }, [soundVersion])

  const updateProfile = (p: ChildProfile) => {
    setProfile(p)
    saveProfile(p)
  }
  const personalOn = profile.enabled
  const chipTick = useChangeTick(profile) // 맞춤 설정이 바뀔 때마다 오르는 번호: 칩을 새로 그려 배경 강조를 한 번 돌린다
  const screenTick = useChangeTick(screen) // 화면이 바뀔 때마다 오르는 번호: 짝수와 홀수가 번갈아 main의 페이드를 다시 시작한다

  const setBriefingCollapsed = (collapsed: boolean) => {
    setBriefingCollapsedState(collapsed)
    lsSet(BRIEFING_KEY, JSON.stringify({ date: kstNow().date, collapsed }))
  }
  const closeTip = () => {
    setTipOpen(false)
    lsSet(TIP_KEY, '1')
  }
  const onTileError = useCallback(() => setTileErr((s) => (s === 0 ? 1 : s)), [])

  // 자료 상태: 받는 중 / 정상 / 데모 데이터 / 둘 다 못 받음. 실제 자료가 있으면 다시 읽는 중에도 그대로 둔다.
  const loadState: 'loading' | 'ok' | 'demo' | 'fail' = snap?.source === 'seoul' ? 'ok' : loading ? 'loading' : snap ? 'demo' : 'fail'
  const age = snap?.source === 'seoul' ? ageMinutes(snap.updatedAt) : 0
  const stale = age >= STALE_MIN
  const tooOld = age >= TOO_OLD_MIN
  // 너무 오래된 자료는 배너 안내대로 예측을 보여 주지 않는다. 자료 시각은 남기고 장소 칸만 비워서 지도, 시트, 목록이 모두 '자료 없음'으로 나온다.
  const viewSnap = useMemo(() => (snap && tooOld ? { ...snap, places: {} } : snap), [snap, tooOld])
  const today = snap?.updatedAt.slice(0, 10) === kstNow().date
  const hhmm = snap?.updatedAt.slice(11, 16) ?? ''
  const stampLabel = !snap ? '' : today ? `서울시 ${hhmm} 기준` : `${snap.updatedAt.slice(5, 7)}/${snap.updatedAt.slice(8, 10)} ${hhmm} 기준`

  const selPlace = selected ? PLACES.find((p) => p.name === selected) : undefined
  const showSheet = !onStart && (view === 'map' || view === 'recommend') && !!selPlace
  // 시트는 닫혀 있다가 열릴 때만 올라오는 애니메이션을 쓴다. 열린 채 다른 장소로 바꿀 때는 새로 마운트되어도 내용만 바뀐다.
  const sheetWasShown = useRef(false)
  const sheetEnter = !sheetWasShown.current
  useEffect(() => {
    sheetWasShown.current = showSheet
  })
  const showData = !onStart && (view === 'map' || view === 'recommend')
  const lazyFallback = <p className="page muted" role="status">불러오는 중이에요</p>

  const chip = personalOn ? appliedParts(profile) : null
  const chipLabel = chip ? chip.lead + chip.rest : ''

  // 칩 질문 시트가 떠 있는 동안 뒤 화면은 inert로 막고(Tab, 클릭, 스크린리더 탐색 모두), 시트를 닫으면 inert를 푼 뒤 포커스를 지도로 보낸다
  // 랜딩이 떠 있는 동안에는 앱 화면 전체를 hidden으로 두므로 시트와 랜딩 중 하나만 떠 있다
  const introShown = introOpen && !onStart
  const introWasShown = useRef(introShown)
  useEffect(() => {
    if (introWasShown.current && !introShown) {
      const next = viewRef.current === 'map' ? document.getElementById('map') : document.querySelector<HTMLElement>('.nav button[aria-current="page"]')
      next?.focus()
    }
    introWasShown.current = introShown
  }, [introShown])
  // 랜딩을 떠나면 도착 화면으로 초점을 보내 body로 떨어지지 않게 한다(시트는 스스로 첫 칩으로 가져간다)
  const wasStart = useRef(onStart)
  useEffect(() => {
    if (wasStart.current && !onStart) {
      const to = leaveFocus.current
      leaveFocus.current = null
      if (to === 'map') {
        document.getElementById('map')?.focus()
      } else if (to === 'child') {
        const h = mainRef.current?.querySelector<HTMLElement>('h2')
        h?.setAttribute('tabindex', '-1')
        h?.focus()
      } else if (to === 'nav') {
        document.querySelector<HTMLElement>('.nav button[aria-current="page"]')?.focus()
      }
    }
    wasStart.current = onStart
  }, [onStart])

  return (
    <div className="app">
      {onStart && (
        <Landing
          placeCount={PLACES.length}
          snap={viewSnap}
          focusHeading={startFocus.current}
          onMap={() => enterApp('map')}
          onPick={(hasProfile) => enterApp(hasProfile ? 'child' : 'pick')}
          onInfo={() => {
            leaveFocus.current = 'nav'
            navigate('info', null)
          }}
        />
      )}
      <header className={personalOn ? 'topbar has-chip' : 'topbar'} hidden={onStart} inert={introShown}>
        <h1>
          <a
            href="#/start"
            aria-label={HEADER_LINK_LABEL}
            onClick={(e) => {
              if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
              e.preventDefault()
              openStart()
            }}
          >
            무던한 지도
          </a>
        </h1>
        {loadState === 'loading' && (
          <span className="badge">
            <span className="pre">자료 </span>불러오는 중…
          </span>
        )}
        {loadState === 'demo' && <span className="badge demo">데모 데이터</span>}
        {loadState === 'fail' && <span className="badge warn">자료 없음</span>}
        {loadState === 'ok' &&
          (stale ? (
            <span className="badge warn" title={stampLabel}>
              {Math.floor(age / 60)}시간 전<span className="post"> 자료</span>
            </span>
          ) : (
            <span className="badge" title={stampLabel}>
              {today && <span className="pre">서울시 </span>}
              {today ? `${hhmm} 기준` : stampLabel}
            </span>
          ))}
        <label className="toggle">
          <input type="checkbox" checked={personalOn} onChange={(e) => updateProfile({ ...profile, enabled: e.target.checked })} />
          <span className="toggle-lead">우리 아이 </span>맞춤
        </label>
        {chip && (
          <button className="applied-chip" onClick={() => go('child')} aria-label={`${chipLabel}. 우리 아이 탭으로 이동`} title={chipLabel}>
            <span key={chipTick} className={chipTick ? 'flash' : undefined}>
              {chip.lead && <span className="applied-lead">{chip.lead}</span>}
              <span className="applied-full">{chip.rest}</span>
              <span className="applied-count" aria-hidden>{chip.count}</span>
            </span>
          </button>
        )}
      </header>
      {view === 'map' && !onStart && !introShown && tipOpen && !selected && (
        <div className="tip">
          <span>{TIP_TEXT}</span>
          <button onClick={closeTip}>닫기</button>
        </div>
      )}
      {showData && (loadState === 'demo' || loadState === 'fail') && (
        <div className="banner warn" role="status" inert={introShown}>
          <span>{snap ? '서울시 자료를 불러오지 못해 데모 데이터를 보여 드려요' : '서울시 자료를 불러오지 못했어요'}</span>
          <button onClick={() => refresh(false)}>다시 시도</button>
        </div>
      )}
      {showData && tooOld && (
        <div className="banner warn" role="status" inert={introShown}>
          <span>자료가 오래돼 예측을 보여 드리지 못해요 ({stampLabel})</span>
        </div>
      )}
      {view === 'map' && !onStart && tileErr === 1 && (
        <div className="banner warn" role="status" inert={introShown}>
          <span>지도 이미지를 불러오지 못했어요. 연결을 확인해 주세요</span>
          <button onClick={() => setTileErr(2)}>닫기</button>
        </div>
      )}
      <main className="main" ref={mainRef} hidden={onStart} inert={introShown} data-fade={screenTick ? screenTick % 2 : undefined}>
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
          {/* 화면에서 지도 왼쪽 위에 놓이는 브리핑을 DOM에서도 지도보다 앞에 두어 Tab 순서가 화면 순서와 같다 */}
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
          <MapView
            places={PLACES}
            snap={viewSnap}
            sound={sound}
            profile={profile}
            offsets={offsets}
            nowKey={nowKey}
            noise={noise}
            onSelect={openPlace}
            selected={selected}
            active={view === 'map' && !onStart}
            onTileError={onTileError}
            selectedHour={selectedHour}
            onSelectHour={setSelectedHour}
          />
        </div>
        {showSheet && (
          <PlaceDetail
            key={selected}
            enter={sheetEnter}
            place={selPlace!}
            places={PLACES}
            pattern={pattern}
            noise={noise}
            onSelect={openPlace}
            nowKey={nowKey}
            snap={viewSnap}
            tooOld={tooOld}
            sound={sound}
            profile={profile}
            offsets={offsets}
            onClose={closeSheet}
            onRecorded={(o, p) => {
              setOffsets(o)
              setProfile(p)
            }}
            onMeasure={() => go('measure')}
            onGoChild={() => go('child')}
            selectedHour={selectedHour}
            onSelectHour={setSelectedHour}
            backTo={backTo}
            onBack={() => window.history.back()}
            onIntro={view === 'map' && selected === sharedPlace ? openStart : undefined}
            priority={recUi.priority}
            onPriority={(priority) => setRecUi((u) => ({ ...u, priority }))}
            openPlan={planFor !== null && planFor === selected}
            onPlanOpened={() => setPlanFor(null)}
          />
        )}
        {view === 'recommend' && (
          <Recommend
            places={PLACES}
            snap={viewSnap}
            loading={loading}
            sound={sound}
            profile={profile}
            offsets={offsets}
            nowKey={nowKey}
            noise={noise}
            ui={recUi}
            onUi={setRecUi}
            onOpen={openPlace}
            onSelectHour={setSelectedHour}
            onOpenPlan={(name) => {
              setPlanFor(name)
              openPlace(name)
            }}
          />
        )}
        {view === 'child' && (
          <ChildProfileView
            profile={profile}
            places={PLACES}
            snap={viewSnap}
            sound={sound}
            offsets={offsets}
            noise={noise}
            nowKey={nowKey}
            onChange={updateProfile}
            onOffsetsChange={setOffsets}
            onCleared={() => {
              setOffsets({})
              setSoundVersion((v) => v + 1)
              setRecUi((u) => ({ ...u, anchor: null, where: u.where === 'place' ? 'all' : u.where }))
            }}
          />
        )}
        {view === 'measure' && (
          <LazyBoundary onBack={() => go('map')}>
            <Suspense fallback={lazyFallback}>
              <Measure
                places={PLACES}
                defaultPlace={selected ?? undefined}
                onSubmitted={() => setSoundVersion((v) => v + 1)}
                onRunningChange={setMeasureRunning}
              />
            </Suspense>
          </LazyBoundary>
        )}
        {view === 'info' && (
          <LazyBoundary onBack={() => go('map')}>
            <Suspense fallback={lazyFallback}>
              <Info snap={snap} loading={loading} metrics={metrics} noise={noise} pattern={pattern} placeCount={PLACES.length} />
            </Suspense>
          </LazyBoundary>
        )}
      </main>
      <nav className="nav" aria-label="주 메뉴" hidden={onStart} inert={introShown}>
        {NAV.map(([v, label]) => (
          <button key={v} className={view === v ? 'on' : ''} onClick={() => go(v)} aria-label={label} aria-current={view === v ? 'page' : undefined}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              {NAV_ICON[v]}
            </svg>
            {label}
          </button>
        ))}
      </nav>
      {introShown && (
        <Onboarding
          places={PLACES}
          snap={viewSnap}
          sound={sound}
          offsets={offsets}
          noise={noise}
          nowKey={nowKey}
          onFinish={(applied) => {
            if (applied) setProfile(applied) // 저장은 Onboarding이 마쳤다. 안내 막대(TIP_KEY)는 지도에서 처음 한 번 띄우므로 여기서 기록하지 않는다
            setIntroOpen(false)
          }}
        />
      )}
    </div>
  )
}
