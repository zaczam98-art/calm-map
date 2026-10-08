import { useEffect, useMemo, useState } from 'react'
import placesRaw from './data/places.json'
import type { Briefing as BriefingData, ChildProfile, ForecastMetrics, Place, Snapshot, WeekPattern } from './types'
import { loadProfile, loadOffsets, saveProfile } from './lib/profile'
import { loadSnapshot, loadSoundStore, type SoundStore } from './lib/snapshot'
import { loadPublicJson } from './lib/publicData'
import MapView from './components/MapView'
import PlaceDetail from './components/PlaceDetail'
import ChildProfileView from './components/ChildProfile'
import Measure from './components/Measure'
import Info from './components/Info'
import Briefing from './components/Briefing'
import Recommend from './components/Recommend'

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

  useEffect(() => {
    void loadSnapshot().then(setSnap)
    void loadPublicJson<WeekPattern>('pattern.json').then(setPattern)
    void loadPublicJson<ForecastMetrics>('metrics.json').then(setMetrics)
    void loadPublicJson<BriefingData>('briefing.json').then(setBriefing)
  }, [])
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
            <MapView places={PLACES} snap={snap} sound={sound} profile={profile} offsets={offsets} onSelect={setSelected} />
            {!selected && snap?.source === 'seoul' && <Briefing briefing={briefing} known={PLACE_NAMES} onSelect={setSelected} />}
            {selected && (
              <PlaceDetail
                key={selected}
                place={PLACES.find((p) => p.name === selected)!}
                places={PLACES}
                pattern={pattern}
                onSelect={setSelected}
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
        {view === 'info' && <Info snap={snap} metrics={metrics} />}
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
