import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import L from 'leaflet'
import type { ChildProfile, HourScore, Level3, NoiseData, Place, Snapshot } from '../types'
import { hourScores, LEVEL3_LABEL } from '../lib/index'
import { bucketKey, type SoundStore } from '../lib/snapshot'
import { activeControls, factorTags } from '../lib/factors'
import { kstNow } from '../lib/publicData'
import { noiseLookup } from '../lib/noise'
import SearchBox from './SearchBox'
import TimeSlider, { cellAt, levelAt, offsetOf, planFor, slotHour, slotShort } from './TimeSlider'
import '../styles/map.css'

const FILL: Record<Level3, string> = { calm: '#9ddbc8', mid: '#46739e', busy: '#2e2a5e', nodata: '#ffffff' }
const OUTLINE = '#1f2933' // 어두운 테두리: 무던함(연한 채움)이 밝은 지도 배경에서도 모양으로 보이게 한다
const SELECTED: L.CircleMarkerOptions = { radius: 13, weight: 4, color: '#0b1a22', dashArray: undefined }
const CENTER: L.LatLngTuple = [37.5565, 126.98]
const START_ZOOM = 12 // 11이면 도심 마커가 서로 겹쳐 누르기 어렵다
const PICK_PX = 24 // 누른 곳에서 이 거리 안에 마커가 둘 이상이면 고르는 목록을 띄운다
const PICK_MAX = 5

function baseStyle(level: Level3, hasControl: boolean): L.CircleMarkerOptions {
  const nodata = level === 'nodata'
  return {
    radius: 10,
    color: hasControl ? '#b45309' : nodata ? '#5f6b7a' : OUTLINE, // 공사·집회 통제가 있으면 테두리 색을 바꾼다
    weight: hasControl ? 3 : nodata ? 2 : 1.5,
    fillColor: FILL[level],
    fillOpacity: nodata ? 0.7 : 1,
    dashArray: nodata ? '3 3' : undefined, // 자료 없음은 색이 아니라 점선 모양으로 구분한다
  }
}

/** 마커 말풍선. 시각을 골랐으면 어느 시각 기준인지 덧붙인다. */
function tipHtml(name: string, level: Level3, cell: HourScore | undefined, at: string, controls: string[]): string {
  return `${name}<br><b>${LEVEL3_LABEL[level]}</b>${cell?.index != null ? ` (${cell.index})` : ''}${at ? ` · ${at} 기준` : ''}${controls.length ? `<br>${controls.join(', ')}` : ''}`
}

interface Props {
  places: Place[]
  snap: Snapshot | null
  sound: SoundStore
  profile: ChildProfile
  offsets: Record<string, number>
  nowKey: string | undefined
  noise: NoiseData | null
  onSelect: (name: string) => void
  selected?: string | null
  active?: boolean
  onTileError?: () => void
  /** 슬라이더로 고른 시(0~23). null이면 지금. 장소 시트의 막대와 같은 값을 쓴다. */
  selectedHour?: number | null
  onSelectHour?: (hour: number | null) => void
}

export default function MapView({ places, snap, sound, profile, offsets, nowKey, noise, onSelect, selected = null, active = true, onTileError, selectedHour = null, onSelectHour }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const markersRef = useRef(new Map<string, { m: L.CircleMarker; base: L.CircleMarkerOptions; level: Level3; ctrl: boolean; ctrlLabels: string[] }>())
  const [pick, setPick] = useState<{ x: number; y: number; names: string[] } | null>(null) // 겹친 마커 중 고르는 목록
  const [searchHost, setSearchHost] = useState<HTMLElement | null>(null) // 줌 버튼 아래 검색 단추 자리
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const styledRef = useRef<string | null>(null) // 선택 강조가 입혀진 마커 이름
  const pendingRef = useRef<string | null>(null) // 지도가 숨겨져 있어 아직 옮기지 못한 선택
  const movedRef = useRef(false)
  const refocusUntilRef = useRef(0) // 검색으로 고른 직후 이 시각까지는 크기가 바뀔 때 선택 장소를 다시 시트 위로 맞춘다(키보드가 내려가며 지도가 커지는 경우)
  const reducedRef = useRef(false)
  const placesRef = useRef(places)
  const selectedRef = useRef(selected)
  const tileErrorRef = useRef(onTileError)
  placesRef.current = places
  selectedRef.current = selected
  tileErrorRef.current = onTileError

  // 선택한 마커가 시트 위(화면 높이 20% 지점)에 보이도록 옮긴다. 지도가 숨겨져 있으면 보일 때까지 미룬다.
  const focusPending = () => {
    const map = mapRef.current
    const el = containerRef.current
    const name = pendingRef.current
    if (!map || !el || !name || !el.clientWidth || !el.clientHeight) return
    const p = placesRef.current.find((x) => x.name === name)
    if (!p) return
    pendingRef.current = null
    map.invalidateSize({ animate: false })
    const z = Math.max(map.getZoom(), 13)
    const target = map.unproject(map.project([p.lat, p.lng], z).add([0, map.getSize().y * 0.3]), z)
    movedRef.current = true
    map.flyTo(target, z, { animate: !reducedRef.current, duration: 0.5 })
  }

  // 검색 결과를 골랐을 때: 새 장소면 선택 효과가 옮기고, 이미 선택된 장소면 직접 옮긴다
  const searchPick = (name: string) => {
    refocusUntilRef.current = Date.now() + 1500
    if (name === selectedRef.current) {
      pendingRef.current = name
      focusPending()
    } else {
      onSelectRef.current(name)
    }
  }

  // 누른 곳 가까이(PICK_PX)의 마커가 하나면 바로 열고, 둘 이상이면 가까운 순으로 고르게 한다. 마커 밖을 눌러도 가까우면 같게 다룬다.
  const pickAt = (pt: L.Point) => {
    const map = mapRef.current
    if (!map) return
    const near = [...markersRef.current]
      .map(([name, { m }]) => ({ name, d: map.latLngToContainerPoint(m.getLatLng()).distanceTo(pt) }))
      .filter((x) => x.d <= PICK_PX)
      .sort((a, b) => a.d - b.d)
    if (near.length < 2) {
      setPick(null)
      if (near.length === 1) onSelectRef.current(near[0].name)
      return
    }
    setPick({ x: pt.x, y: pt.y, names: near.slice(0, PICK_MAX).map((n) => n.name) })
  }

  const applySelection = (name: string | null) => {
    const prev = styledRef.current && markersRef.current.get(styledRef.current)
    if (prev && styledRef.current !== name) prev.m.setStyle(prev.base)
    styledRef.current = name
    const cur = name ? markersRef.current.get(name) : undefined
    if (cur) {
      cur.m.setStyle({ ...cur.base, ...SELECTED })
      cur.m.bringToFront()
    }
  }

  useEffect(() => {
    const el = containerRef.current!
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    reducedRef.current = reduced
    const map = L.map(el, { zoomControl: false, zoomAnimation: !reduced, fadeAnimation: !reduced, markerZoomAnimation: !reduced, inertia: !reduced }).setView(CENTER, START_ZOOM)
    const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> 기여자',
    }).addTo(map)
    let tileErrors = 0
    tiles.on('tileerror', () => {
      tileErrors += 1
      if (tileErrors === 5) tileErrorRef.current?.()
    })
    L.control.zoom({ position: 'topright', zoomInTitle: '확대', zoomOutTitle: '축소' }).addTo(map)
    // 검색 단추는 줌 버튼 바로 아래에 쌓이도록 같은 모서리의 Leaflet 컨트롤로 둔다(React가 이 상자에 단추를 그린다)
    const searchCtl = new L.Control({ position: 'topright' })
    searchCtl.onAdd = () => {
      const box = L.DomUtil.create('div', 'sbx-host')
      L.DomEvent.disableClickPropagation(box)
      L.DomEvent.disableScrollPropagation(box)
      return box
    }
    searchCtl.addTo(map)
    setSearchHost(searchCtl.getContainer() ?? null)
    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    // 컨테이너 크기가 마운트 뒤(또는 숨겨진 탭이 보일 때) 정해지므로, 사용자가 지도를 움직이기 전까지는
    // 크기가 바뀔 때마다 크기를 다시 계산하고 서울 중심으로 되돌린다. 숨겨져 크기가 0이면 건드리지 않는다.
    const markMoved = () => { movedRef.current = true }
    map.on('dragstart zoomstart', markMoved)
    const closePick = () => setPick(null)
    map.on('movestart zoomstart', closePick)
    const onMapClick = (e: L.LeafletMouseEvent) => pickAt(e.containerPoint)
    map.on('click', onMapClick)
    const fix = () => {
      if (!el.clientWidth || !el.clientHeight) return
      map.invalidateSize({ animate: false })
      if (!movedRef.current) map.setView(CENTER, map.getZoom(), { animate: false })
      else if (Date.now() < refocusUntilRef.current && selectedRef.current) {
        pendingRef.current = selectedRef.current
        focusPending()
      }
    }
    const timers = [50, 300, 1000, 2500].map((ms) => setTimeout(fix, ms))
    const ro = new ResizeObserver(fix)
    ro.observe(el)
    window.addEventListener('resize', fix)
    document.addEventListener('visibilitychange', fix)
    return () => {
      timers.forEach(clearTimeout)
      ro.disconnect()
      window.removeEventListener('resize', fix)
      document.removeEventListener('visibilitychange', fix)
      map.off('dragstart zoomstart', markMoved)
      map.off('movestart zoomstart', closePick)
      map.off('click', onMapClick)
      setSearchHost(null)
      map.remove()
      mapRef.current = null
      layerRef.current = null
      markersRef.current.clear()
      styledRef.current = null
      movedRef.current = false
    }
  }, [])

  // 장소별 시간대 시계열(마커 색, 범례 개수, 슬라이더 범위가 모두 이 한 벌을 쓴다)
  const allScores = useMemo(() => {
    if (!snap) return null
    const out: Record<string, HourScore[]> = {}
    for (const p of places) out[p.name] = hourScores(snap.places[p.name], (h, d) => sound[p.name]?.[bucketKey(d, h)], profile, offsets[p.name] ?? 0, nowKey, noiseLookup(noise, p.name))
    return out
  }, [places, snap, sound, profile, offsets, nowKey, noise])
  const plan = useMemo(() => planFor(allScores, nowKey), [allScores, nowKey])
  const step = plan && selectedHour !== null ? offsetOf(plan, selectedHour) : 0 // 슬라이더 칸 번호(0=지금)
  const hour = plan && step > 0 && step <= plan.max ? selectedHour : null // 지도가 실제로 쓰는 시각. 지금 칸과 범위 밖은 지금으로 본다.
  const hourRef = useRef(hour)
  hourRef.current = hour
  const planRef = useRef(plan)
  planRef.current = plan
  const paintedRef = useRef<number | null>(null) // 마커에 입혀 둔 시각
  const atOf = (h: number | null) => (plan && h !== null ? slotShort(plan, offsetOf(plan, h)) : '')

  useEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    layer.clearLayers()
    markersRef.current.clear()
    styledRef.current = null
    setPick(null)
    if (!snap || !allScores) return // 자료가 오기 전에는 마커를 그리지 않는다
    const k = kstNow()
    const nowStr = `${k.date} ${String(k.hour).padStart(2, '0')}:00`
    const h = hourRef.current
    const pl = planRef.current
    const at = pl && h !== null ? slotShort(pl, offsetOf(pl, h)) : ''
    paintedRef.current = h
    for (const p of places) {
      const ps = snap.places[p.name]
      const scores = allScores[p.name]
      const level = levelAt(scores, h)
      // 공사·통제 테두리는 지금 시각의 자료다(서울시가 내일 통제는 주지 않는다). 시각을 옮겨도 그대로 둔다.
      const ctrlLabels = factorTags(activeControls(ps?.extra, nowStr)).filter((t) => t.key.startsWith('control')).map((t) => t.label)
      const base = baseStyle(level, ctrlLabels.length > 0)
      const m = L.circleMarker([p.lat, p.lng], { ...base, className: `mk ${level}`, bubblingMouseEvents: false })
      m.bindTooltip(tipHtml(p.name, level, cellAt(scores, h), at, ctrlLabels), { direction: 'top', offset: [0, -8] })
      m.on('click', (e) => pickAt(mapRef.current!.latLngToContainerPoint(e.latlng)))
      m.addTo(layer)
      // 키보드·스크린리더 경로는 추천 탭 목록으로 일원화하므로 마커는 탭 정지에서 뺀다
      const el = m.getElement()
      el?.setAttribute('tabindex', '-1')
      el?.setAttribute('aria-hidden', 'true')
      markersRef.current.set(p.name, { m, base, level, ctrl: ctrlLabels.length > 0, ctrlLabels })
    }
    applySelection(selectedRef.current)
  }, [places, snap, allScores])

  // 슬라이더를 옮기면 마커를 다시 만들지 않고 색과 말풍선만 바꾼다
  useEffect(() => {
    if (!allScores || paintedRef.current === hour) return
    paintedRef.current = hour
    const at = atOf(hour)
    for (const [name, e] of markersRef.current) {
      const scores = allScores[name]
      const level = levelAt(scores, hour)
      if (level !== e.level) {
        e.base = baseStyle(level, e.ctrl)
        e.m.setStyle(e.base)
        e.m.getElement()?.classList.replace(e.level, level)
        e.level = level
      }
      e.m.setTooltipContent(tipHtml(name, level, cellAt(scores, hour), at, e.ctrlLabels))
    }
    setPick(null)
    applySelection(styledRef.current) // 선택 강조는 setStyle로 지워졌을 수 있으니 다시 입힌다
  }, [allScores, hour])

  // 고른 시각이 지나 범위 밖이 되면(시간이 흘러 칸이 밀린 경우) 선택을 지금으로 돌린다
  useEffect(() => {
    if (plan && selectedHour !== null && offsetOf(plan, selectedHour) > plan.max) onSelectHour?.(null)
  }, [plan, selectedHour, onSelectHour])

  useEffect(() => {
    setPick(null)
    applySelection(selected)
    pendingRef.current = selected
    focusPending()
  }, [selected])

  useEffect(() => {
    if (!active) return
    const t = setTimeout(() => {
      mapRef.current?.invalidateSize({ animate: false })
      focusPending()
    }, 0)
    return () => clearTimeout(t)
  }, [active])

  // 고른 시각의 장소별 단계(범례 개수와 검색 결과 표시용)
  const levels = useMemo(() => {
    if (!allScores) return null
    const out: Record<string, Level3> = {}
    for (const p of places) out[p.name] = levelAt(allScores[p.name], hour)
    return out
  }, [allScores, places, hour])

  const counts = useMemo(() => {
    if (!levels) return null
    const c: Record<Level3, number> = { calm: 0, mid: 0, busy: 0, nodata: 0 }
    for (const lv of Object.values(levels)) c[lv] += 1
    return c
  }, [levels])

  return (
    <div className="map-wrap">
      <div ref={containerRef} id="map" role="application" aria-label={`서울 장소 ${places.length}곳의 감각부하 지도`} />
      <SearchBox
        places={places}
        levels={levels}
        host={searchHost}
        onPick={searchPick}
        onFocus={() => {
          movedRef.current = true // 입력하는 동안 키보드로 크기가 바뀌어도 지도를 서울 중심으로 되돌리지 않는다
          setPick(null)
        }}
      />
      {pick && <PickList pick={pick} box={containerRef.current} levels={markersRef.current} onPick={(name) => onSelect(name)} onClose={() => setPick(null)} />}
      {plan && onSelectHour && (
        <TimeSlider
          plan={plan}
          value={step > plan.max ? 0 : step}
          onChange={(k) => onSelectHour(k === 0 ? null : slotHour(plan, k))}
          active={active && !selected}
          counts={counts}
        />
      )}
      <div className={plan && onSelectHour ? 'legend above-slider' : 'legend'} role="group" aria-label="범례">
        {hour !== null && <span className="legend-at">{atOf(hour)} 기준</span>}
        <span><i className="dot calm" />무던함{counts && <b>{counts.calm}</b>}</span>
        <span><i className="dot mid" />보통{counts && <b>{counts.mid}</b>}</span>
        <span><i className="dot busy" />붐빔{counts && <b>{counts.busy}</b>}</span>
        <span><i className="dot nodata" />자료 없음{counts && <b>{counts.nodata}</b>}</span>
        <span><i className="dot ring" />공사·통제{hour !== null && '(지금 기준)'}</span>
      </div>
    </div>
  )
}

/** 한 번 누른 곳에 마커가 겹쳐 있을 때, 누른 지점 곁에 띄우는 장소 선택 목록 */
function PickList({ pick, box, levels, onPick, onClose }: { pick: { x: number; y: number; names: string[] }; box: HTMLElement | null; levels: Map<string, { level: Level3 }>; onPick: (name: string) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  const w = box?.clientWidth ?? 0
  const h = box?.clientHeight ?? 0
  const left = Math.max(8, Math.min(pick.x - 110, w - 228))
  const style: CSSProperties = pick.y > h / 2 ? { left, bottom: h - pick.y + 18 } : { left, top: pick.y + 18 }
  return (
    <div className="pick" role="group" aria-label="가까이 겹쳐 있는 장소" style={style}>
      <div className="pick-head">
        <span>가까이 있는 장소 {pick.names.length}곳</span>
        <button onClick={onClose} aria-label="목록 닫기">×</button>
      </div>
      <ul>
        {pick.names.map((n) => (
          <li key={n}>
            <button onClick={() => onPick(n)}>
              <i className={`dot ${levels.get(n)?.level ?? 'nodata'}`} aria-hidden />
              <span>{n}</span>
              <small>{LEVEL3_LABEL[levels.get(n)?.level ?? 'nodata']}</small>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
