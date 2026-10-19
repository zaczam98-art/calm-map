import { useMemo } from 'react'
import placesRaw from '../data/places.json'
import { hourScores, nowKeyFor } from '../lib/index'
import type { Level3, Place, Snapshot } from '../types'

/** 랜딩 배경의 점 그림: 추적하는 장소의 좌표를 위도·경도 그대로 상자에 맞춰 찍는다(지도 타일은 쓰지 않는다). */
const SITES = (placesRaw as Place[]).filter((p) => p.tracked)
const LAT_MID = SITES.reduce((s, p) => s + p.lat, 0) / SITES.length
const KX = Math.cos((LAT_MID * Math.PI) / 180) // 경도 1도는 위도 1도보다 짧아서 이 비율로 줄인다
const MIN_X = Math.min(...SITES.map((p) => p.lng)) * KX
const MAX_Y = Math.max(...SITES.map((p) => p.lat))
const SPAN_X = Math.max(...SITES.map((p) => p.lng)) * KX - MIN_X
const SPAN_Y = MAX_Y - Math.min(...SITES.map((p) => p.lat))
const W = 1000
const PAD = 24
const SCALE = (W - PAD * 2) / SPAN_X
const H = Math.ceil(SPAN_Y * SCALE + PAD * 2)
const DOTS = SITES.map((p) => ({
  key: p.id,
  name: p.name,
  x: Math.round(((p.lng * KX - MIN_X) * SCALE + PAD) * 10) / 10,
  y: Math.round(((MAX_Y - p.lat) * SCALE + PAD) * 10) / 10,
}))

interface Props {
  /** 서울시 실제 자료(source 'seoul')면 장소마다 지금 칸의 단계 색으로, 데모 데이터이거나 없으면 옅은 회색으로 칠한다(점의 위치와 크기는 같다) */
  snap: Snapshot | null
}

/**
 * 장식 그림이다. 읽어 줄 내용이 없고(aria-hidden), 움직이지 않는다. 맞춤·소리·소음은 반영하지 않은 기본 단계 색이다.
 * 서울시 실제 자료일 때만 단계 색으로 칠한다. 데모 데이터는 가상의 단계라 실제 현황처럼 보이지 않게 회색으로 둔다.
 * 점이 무엇인지 한 줄로 밝힌다(하루 막대 범례와 같은 색이라 이 설명이 없으면 하루 막대의 일부로 읽힐 수 있다). 그림이 장식이므로 이 줄도 함께 읽어 주지 않는다.
 */
export default function DotField({ snap }: Props) {
  const live = snap?.source === 'seoul'
  const levels = useMemo(() => {
    if (!snap || snap.source !== 'seoul') return DOTS.map((): Level3 => 'nodata')
    const nowKey = nowKeyFor(snap)
    return DOTS.map((d): Level3 => hourScores(snap.places[d.name], () => undefined, null, 0, nowKey)[0]?.level ?? 'nodata')
  }, [snap])

  return (
    <div className="lp-field" aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" focusable="false">
        {DOTS.map((d, i) => (
          <circle key={d.key} className={`lp-pt ${levels[i]}`} cx={d.x} cy={d.y} r="8" />
        ))}
      </svg>
      <p className="lp-field-note">{live ? `서울 ${DOTS.length}곳의 지금 단계예요.` : `서울 ${DOTS.length}곳의 위치예요.`}</p>
    </div>
  )
}
