import type { ChildProfile, SenseTag, Sensitivity } from '../types'
import { SENSE_TAGS, TAG_LABEL } from '../types'
import { clearAll, defaultProfile } from '../lib/profile'

const OPTS: [Sensitivity, string][] = [
  [0.5, '덜 예민'],
  [1, '보통'],
  [1.5, '예민'],
]

export default function ChildProfileView({ profile, onChange }: { profile: ChildProfile; onChange: (p: ChildProfile) => void }) {
  const set = (tag: SenseTag | 'crowd', v: Sensitivity) => {
    if (tag === 'crowd') onChange({ ...profile, crowd: v })
    else onChange({ ...profile, tags: { ...profile.tags, [tag]: v } })
  }
  const Row = ({ label, value, k }: { label: string; value: Sensitivity; k: SenseTag | 'crowd' }) => (
    <div className="sens-row">
      <span>{label}</span>
      <div className="seg" role="radiogroup" aria-label={label}>
        {OPTS.map(([v, l]) => (
          <button key={v} className={value === v ? 'on' : ''} role="radio" aria-checked={value === v} onClick={() => set(k, v)}>{l}</button>
        ))}
      </div>
    </div>
  )
  return (
    <div className="page">
      <div className="card">
        <h2>우리 아이 맞춤</h2>
        <p className="muted">이름이나 진단명은 묻지 않아요. 아이가 어떤 소리와 상황에 예민한지만 고르면, 지도의 지수가 그에 맞춰 다시 계산돼요. 이 기기에만 저장돼요.</p>
        <label className="toggle" style={{ marginBottom: 12 }}>
          <input type="checkbox" checked={profile.enabled} onChange={(e) => onChange({ ...profile, enabled: e.target.checked })} />
          맞춤 지수 켜기
        </label>
        <div className="sens">
          {SENSE_TAGS.filter((t) => t !== 'ambient').map((t) => (
            <Row key={t} label={TAG_LABEL[t]} value={profile.tags[t]} k={t} />
          ))}
          <Row label="사람이 많은 혼잡" value={profile.crowd} k="crowd" />
        </div>
      </div>
      <div className="card">
        <h2>기록으로 배우기</h2>
        <p className="muted">다녀온 뒤 "힘들었어요"를 누르면 그 시간에 측정된 주요 소리의 민감도가 한 단계 올라가고, 그 장소의 맞춤 지수가 5점 올라가요. "괜찮았어요"는 5점 내려요(범위 ±20).</p>
        <button className="btn" onClick={() => { if (confirm('이 기기에 저장된 프로필과 기록을 모두 지울까요?')) { clearAll(); onChange(defaultProfile()) } }}>이 기기의 프로필·기록 지우기</button>
      </div>
    </div>
  )
}
