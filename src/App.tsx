import { useEffect, useMemo, useRef, useState } from 'react'
import placesRaw from './data/places.json'
import type { Briefing as BriefingData, ChildProfile, ForecastMetrics, NoiseData, Place, Snapshot, WeekPattern } from './types'
import { loadProfile, loadOffsets, saveProfile } from './lib/profile'
import { loadSnapshot, loadSoundStore, type SoundStore } from './lib/snapshot'
import { loadPublicJson } from './lib/publicData'
import { nowKeyFor } from './lib/index'
import MapView from './components/MapView'
import PlaceDetail from './components/PlaceDetail'
import ChildProfileView from './components/ChildProfile'
import Measure from './components/Measure'
import Info from './components/Info'
import Briefing from './components/Briefing'
import Recommend, { type RecommendUi } from './components/Recommend'

export const PLACES = (placesRaw as Place[]).filter((p) => p.tracked)
const PLACE_NAMES = new Set(PLACES.map((p) => p.name))

type View = 'map' | 'recommend' | 'child' | 'measure' | 'info'

export default function App() {
  const [view, setView] = useState<View>('map')
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

  // 열어 둔 채 시간이 지나도 '지금'이 맞도록 1분마다 시각을 다시 보고, 화면에 돌아왔을 때 10분이 지났으면 자료를 다시 읽는다
  const [tick, setTick] = useState(0)
  const loadedAt = useRef(0)
  const refresh = () => {
    loadedAt.current = Date.now()
    void loadSnapshot()
      // 다시 읽기가 실패해 데모로 떨어지거나 같은 자료면 이미 있는 실제 자료를 유지한다
      .then((s) => setSnap((prev) => (prev && (s.source === 'demo' || prev.updatedAt === s.updatedAt) ? prev : s)))
      .catch(() => {})
    void loadPublicJson<WeekPattern>('pattern.json').then((v) => v && setPattern(v))
    void loadPublicJson<ForecastMetrics>('metrics.json').then((v) => v && setMetrics(v))
    void loadPublicJson<BriefingData>('briefing.json').then((v) => v && setBriefing(v))
    void loadPublicJson<NoiseData>('noise.json').then((v) => v && setNoise(v))
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

  const header = useMemo(
    () => (
      <header className="topbar">
        <h1>무던한 지도</h1>
        {snap?.source === 'demo' && <span className="badge demo">데모 데이터</span>}
        {snap?.source === 'seoul' && <span className="badge">서울시 {snap.updatedAt.slice(11, 16)} 기준</span>}
        <label className="toggle">
          <input type="checkbox" checked={personalOn} onChange={(e) => updateProfile({ ...profile, enabled: e.target.checked })} />
          우리 아이 맞춤
        </label>
      </header>
    ),
    [snap, personalOn, profile],
  )

  return (
    <div className="app">
      {header}
      <main className="main">
        {view === 'map' && (
          <>
            <MapView places={PLACES} snap={snap} sound={sound} profile={profile} offsets={offsets} nowKey={nowKey} noise={noise} onSelect={setSelected} />
            {!selected && snap?.source === 'seoul' && <Briefing briefing={briefing} known={PLACE_NAMES} onSelect={setSelected} />}
            {selected && (
              <PlaceDetail
                key={selected}
                place={PLACES.find((p) => p.name === selected)!}
                places={PLACES}
                pattern={pattern}
                noise={noise}
                onSelect={setSelected}
                nowKey={nowKey}
                snap={snap}
                sound={sound}
                profile={profile}
                offsets={offsets}
                onClose={() => setSelected(null)}
                onRecorded={(o, p) => {
                  setOffsets(o)
                  setProfile(p)
                }}
                onMeasure={() => setView('measure')}
              />
            )}
          </>
        )}
        {view === 'recommend' && (
          <Recommend
            places={PLACES}
            snap={snap}
            sound={sound}
            profile={profile}
            offsets={offsets}
            nowKey={nowKey}
            noise={noise}
            ui={recUi}
            onUi={setRecUi}
            onOpen={(name) => {
              setSelected(name)
              setView('map')
            }}
          />
        )}
        {view === 'child' && <ChildProfileView profile={profile} onChange={updateProfile} />}
        {view === 'measure' && (
          <Measure places={PLACES} defaultPlace={selected ?? PLACES[0].name} onSubmitted={() => setSoundVersion((v) => v + 1)} />
        )}
        {view === 'info' && <Info snap={snap} metrics={metrics} noise={noise} placeCount={PLACES.length} />}
      </main>
      <nav className="nav">
        {(
          [
            ['map', '🗺️', '지도'],
            ['recommend', '⭐', '추천'],
            ['child', '🧒', '우리 아이'],
            ['measure', '🎙️', '현장 측정'],
            ['info', 'ℹ️', '정보'],
          ] as [View, string, string][]
        ).map(([v, ico, label]) => (
          <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)} aria-label={label}>
            <span aria-hidden>{ico}</span>
            {label}
          </button>
        ))}
      </nav>
    </div>
  )
}
