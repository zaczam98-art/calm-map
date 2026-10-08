import type { NearbyItem } from '../lib/nearby'
import { LEVEL3_LABEL } from '../lib/index'

export default function NearbyCalm({ items, maxKm, onSelect }: { items: NearbyItem[]; maxKm: number; onSelect: (name: string) => void }) {
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h2>가까운 곳 중 지금 더 무던한 곳</h2>
      {items.length === 0 ? (
        <p className="muted">직선 거리 {maxKm}km 안에는 지금 더 무던한 곳이 없어요. 위 그래프에서 무던한 시간대를 살펴보세요.</p>
      ) : (
        <ul className="nearby">
          {items.map((it) => (
            <li key={it.place.name}>
              <button className="nearby-btn" onClick={() => onSelect(it.place.name)}>
                <span className={`pill ${it.level}`}>{LEVEL3_LABEL[it.level]}</span>
                <span className="nearby-name">{it.place.name}</span>
                <span className="muted">직선 {it.km.toFixed(1)}km · 지수 {it.index}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
