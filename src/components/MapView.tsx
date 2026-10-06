import { useEffect, useRef } from 'react'
import L from 'leaflet'
import type { ChildProfile, Level3, Place, Snapshot } from '../types'
import { hourScores, LEVEL3_LABEL } from '../lib/index'
import { bucketKey, type SoundStore } from '../lib/snapshot'

const FILL: Record<Level3, string> = { calm: '#d9e1ea', mid: '#8595ab', busy: '#34445a', nodata: '#c9cdd3' }

interface Props {
  places: Place[]
  snap: Snapshot | null
  sound: SoundStore
  profile: ChildProfile
  offsets: Record<string, number>
  onSelect: (name: string) => void
}

export default function MapView({ places, snap, sound, profile, offsets, onSelect }: Props) {
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!mapRef.current) {
      const m = L.map('map', { zoomControl: false }).setView([37.5565, 126.98], 11)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> 기여자',
      }).addTo(m)
      L.control.zoom({ position: 'topright' }).addTo(m)
      layerRef.current = L.layerGroup().addTo(m)
      mapRef.current = m
    }
    const map = mapRef.current
    // 컨테이너 크기가 마운트 뒤에 정해지므로 크기를 다시 계산하고 중심을 되돌린다(StrictMode 재실행에도 동작)
    const fix = () => {
      map.invalidateSize()
      map.setView([37.5565, 126.98], map.getZoom())
    }
    const t = setTimeout(fix, 50)
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(document.getElementById('map')!)
    return () => {
      clearTimeout(t)
      ro.disconnect()
    }
  }, [])

  useEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    layer.clearLayers()
    for (const p of places) {
      const ps = snap?.places[p.name]
      const dowOf = (t: string) => new Date(t.replace(' ', 'T') + ':00').getDay()
      const scores = hourScores(ps, (h) => sound[p.name]?.[bucketKey(ps?.live ? dowOf(ps.live.time) : new Date().getDay(), h)], profile, offsets[p.name] ?? 0)
      const now = scores[0]
      const level: Level3 = now?.level ?? 'nodata'
      const m = L.circleMarker([p.lat, p.lng], {
        radius: 11,
        color: '#ffffff',
        weight: 2,
        fillColor: FILL[level],
        fillOpacity: 1,
        className: `mk ${level}`,
      })
      m.bindTooltip(`${p.name}<br><b>${LEVEL3_LABEL[level]}</b>${now?.index != null ? ` (${now.index})` : ''}`, { direction: 'top', offset: [0, -8] })
      m.on('click', () => onSelect(p.name))
      m.addTo(layer)
    }
  }, [places, snap, sound, profile, offsets, onSelect])

  return (
    <div className="map-wrap">
      <div id="map" role="application" aria-label="서울 장소 30곳의 감각부하 지도" />
      <div className="legend" aria-label="범례">
        <span><i className="dot calm" />무던함</span>
        <span><i className="dot mid" />보통</span>
        <span><i className="dot busy" />붐빔</span>
        <span><i className="dot nodata" />데이터 부족</span>
      </div>
    </div>
  )
}
