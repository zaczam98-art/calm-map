import { useState } from 'react'
import type { ChildProfile, SenseTag, Sensitivity } from '../types'
import { SENSE_TAGS, TAG_LABEL } from '../types'
import { clearAll, defaultProfile, loadLog, removeVisit } from '../lib/profile'
import '../styles/child.css'

const OPTS: [Sensitivity, string][] = [
  [0.5, '덜 예민'],
  [1, '보통'],
  [1.5, '예민'],
]

const preset = (tags: SenseTag[], crowd: Sensitivity, loud: Sensitivity): ChildProfile => {
  const base = defaultProfile()
  for (const t of tags) base.tags[t] = 1.5
  return { ...base, enabled: true, crowd, loud }
}

const PRESETS: [string, ChildProfile][] = [
  ['소리가 힘들어요', preset(['sudden', 'machine', 'music'], 1, 1.5)],
  ['사람 많은 곳이 힘들어요', preset(['crowd'], 1.5, 1)],
  ['기본으로', preset([], 1, 1)],
]

const same = (a: ChildProfile, b: ChildProfile) =>
  a.enabled === b.enabled && a.crowd === b.crowd && a.loud === b.loud && SENSE_TAGS.every((t) => a.tags[t] === b.tags[t])

function Row({ label, value, onPick }: { label: string; value: Sensitivity; onPick: (v: Sensitivity) => void }) {
  return (
    <div className="sens-row">
      <span>{label}</span>
      <div className="seg" role="group" aria-label={label}>
        {OPTS.map(([v, l]) => (
          <button key={v} className={value === v ? 'on' : ''} aria-pressed={value === v} onClick={() => onPick(v)}>{l}</button>
        ))}
      </div>
    </div>
  )
}

const SHOWN_LOG = 10

/** 기록 시각(ISO)을 한국 시간 '월/일 시:분'으로 */
function stamp(ts: string): string {
  const d = new Date(Date.parse(ts) + 9 * 3600_000)
  const p2 = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`
}

interface Props {
  profile: ChildProfile
  onChange: (p: ChildProfile) => void
  onCleared?: () => void
  /** 기록을 지워 장소 보정치가 바뀌었을 때 */
  onOffsetsChange?: (offsets: Record<string, number>) => void
}

export default function ChildProfileView({ profile, onChange, onCleared, onOffsetsChange }: Props) {
  const [log, setLog] = useState(loadLog)
  const recent = log.slice(-SHOWN_LOG).reverse()
  return (
    <div className="page">
      <div className="card">
        <h2>우리 아이 맞춤</h2>
        <p className="muted">이름이나 진단명은 묻지 않아요. 아이가 어떤 소리와 상황에 예민한지만 고르면, 지도의 지수가 그에 맞춰 다시 계산돼요. 이 기기에만 저장돼요.</p>
        <div className="child-toggle">
          <label className="toggle">
            <input type="checkbox" checked={profile.enabled} onChange={(e) => onChange({ ...profile, enabled: e.target.checked })} />
            맞춤 지수 켜기
          </label>
          <span className="muted">켜면 지도와 추천의 지수가 아이 민감도로 다시 계산돼요.</span>
        </div>
        <p className="muted" id="child-preset-hint">항목을 하나씩 고르기 어렵다면, 아래 버튼 중 가까운 것을 눌러 보세요. 맞춤이 켜지고 일곱 항목이 한 번에 정해져요.</p>
        <div className="child-presets" role="group" aria-labelledby="child-preset-hint">
          {PRESETS.map(([label, p]) => {
            const on = same(profile, p)
            return <button key={label} className={on ? 'chip on' : 'chip'} aria-pressed={on} onClick={() => onChange(p)}>{label}</button>
          })}
        </div>
        <div className="sens">
          {SENSE_TAGS.filter((t) => t !== 'ambient').map((t) => (
            <Row key={t} label={TAG_LABEL[t]} value={profile.tags[t]} onPick={(v) => onChange({ ...profile, tags: { ...profile.tags, [t]: v } })} />
          ))}
          <Row label="사람이 많은 혼잡" value={profile.crowd} onPick={(v) => onChange({ ...profile, crowd: v })} />
          <Row label="큰 소리(주변 소음의 크기)" value={profile.loud} onPick={(v) => onChange({ ...profile, loud: v })} />
        </div>
      </div>
      <div className="card">
        <h2>기록으로 배우기</h2>
        <p className="muted">다녀온 뒤 "힘들었어요"를 누르면 그 시간에 측정된 주요 소리의 민감도가 한 단계 올라가고, 그 장소의 맞춤 지수가 5점 올라가요. "괜찮았어요"는 5점 내려요(범위 ±20).</p>
        <button
          className="btn"
          onClick={() => {
            if (confirm('이 기기에 저장된 프로필과 기록을 모두 지울까요? 소리 측정 요약도 함께 지워요.')) {
              clearAll()
              onChange(defaultProfile())
              setLog([])
              onCleared?.()
            }
          }}
        >
          이 기기의 프로필·기록 지우기
        </button>
      </div>
      <div className="card">
        <h2>최근 기록</h2>
        {recent.length === 0 ? (
          <p className="muted">아직 기록이 없어요. 장소 화면의 "다녀온 뒤 기록"에서 남길 수 있어요.</p>
        ) : (
          <>
            <p className="muted">최근 {recent.length}건이에요. 지우면 그 기록이 바꾼 장소 보정(5점)은 되돌리고, 올라간 소리 민감도는 위에서 직접 바꿔 주세요.</p>
            <ul className="visit-log">
              {recent.map((v) => (
                <li key={v.ts + v.place}>
                  <span><b>{v.place}</b> <span className="muted">{stamp(v.ts)}</span><br />{v.ok ? '괜찮았어요' : '힘들었어요'}</span>
                  <button
                    className="btn"
                    aria-label={`${v.place} ${stamp(v.ts)} 기록 지우기`}
                    onClick={() => {
                      onOffsetsChange?.(removeVisit(v.place, v.ts))
                      setLog(loadLog())
                    }}
                  >
                    지우기
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
