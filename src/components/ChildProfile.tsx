import { useMemo, useState } from 'react'
import type { ChildProfile, SenseTag, Sensitivity, Snapshot } from '../types'
import { SENSE_TAGS, TAG_LABEL } from '../types'
import { clearAll, defaultProfile, loadLog, removeVisit } from '../lib/profile'
import { canPreview, isPlain, isSoundOnly, usePreviewChange, type PreviewChange, type PreviewInput } from '../lib/preview'
import { PRIVACY_ASK, SHEET, STORED_HERE } from '../lib/landingCopy'
import { entryTexts, RECORD_OFF_LIST, RECORD_TAG_LIST } from '../lib/recordEffect'
import { CHILD_SIREN_NOTE } from '../lib/scoreWords'
import Fold from './Fold'
import '../styles/child.css'
import '../styles/onboarding.css'

const OPTS: [Sensitivity, string][] = [
  [0.5, '덜 예민'],
  [1, '보통'],
  [1.5, '예민'],
]

const NAME: Record<Sensitivity, string> = { 1.5: '예민', 1: '보통', 0.5: '덜 예민' }

/** 민감 요인 일곱 개. short는 바뀐 항목을 알리는 한 줄에 쓰는 짧은 이름이다. */
interface Item {
  label: string
  short: string
  get: (p: ChildProfile) => Sensitivity
  set: (p: ChildProfile, v: Sensitivity) => ChildProfile
}

const tagItem = (t: SenseTag, short: string): Item => ({
  label: TAG_LABEL[t],
  short,
  get: (p) => p.tags[t],
  set: (p, v) => ({ ...p, tags: { ...p.tags, [t]: v } }),
})

const ITEMS: Item[] = [
  tagItem('sudden', '돌발음'),
  tagItem('crowd', '군중 소리'),
  tagItem('machine', '기계·차량'),
  tagItem('music', '음악·안내방송'),
  tagItem('speech', '말소리'),
  { label: '사람이 많은 혼잡', short: '혼잡', get: (p) => p.crowd, set: (p, v) => ({ ...p, crowd: v }) },
  { label: '큰 소리(주변 소음의 크기)', short: '큰 소리', get: (p) => p.loud, set: (p, v) => ({ ...p, loud: v }) },
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

/** 프리셋을 눌렀을 때 어떤 항목이 어떻게 바뀌는지 한 문장으로. 바뀐 쪽(예민, 덜 예민, 보통)마다 절을 나눠 '바뀌고'로 잇는다. */
function changeLine(before: ChildProfile, after: ChildProfile): string {
  const parts: string[] = []
  for (const v of [1.5, 0.5, 1] as Sensitivity[]) {
    const names = ITEMS.filter((i) => i.get(before) !== v && i.get(after) === v).map((i) => i.short)
    if (names.length) parts.push(`${names.join(', ')} 항목이 ${NAME[v]}으로 바뀌`)
  }
  const items = parts.length ? `${parts.join('고, ')}었어요.` : '바뀐 항목은 없어요.'
  return before.enabled ? items : `${items} 맞춤 지수도 켜졌어요.`
}

/**
 * 접어 둔 세부 민감도의 한 줄 요약. base는 마지막으로 누른 프리셋이고, 누른 적이 없으면 null이라 직접 바꾼 항목을 적지 않는다.
 * 직접 바꾼 항목은 예민·덜 예민 개수와 겹칠 수도 있고(예민 → 덜 예민) 어느 쪽에도 없을 수도 있어서(예민 → 보통), 개수에 더하지 않고 괄호로 따로 적는다.
 */
function detailBrief(p: ChildProfile, base: ChildProfile | null): string {
  const hi = ITEMS.filter((i) => i.get(p) === 1.5).length
  const lo = ITEMS.filter((i) => i.get(p) === 0.5).length
  const n = base ? ITEMS.filter((i) => i.get(p) !== i.get(base)).length : 0
  const counts = [hi ? `예민 ${hi}개` : '', lo ? `덜 예민 ${lo}개` : '', !hi && !lo ? '모두 보통' : ''].filter(Boolean).join(' · ')
  return n ? `${counts} (누른 단추에서 직접 바꾼 항목 ${n}개)` : counts
}

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

const PV = {
  noData: '서울시 실제 자료가 있을 때 맞춤 전후 점수를 예로 보여 줘요.',
  plain: '모든 항목이 보통이라 맞춤 전후 차이가 없어요. 예민한 항목을 고르면 점수가 어떻게 달라지는지 보여 줘요.',
  eg: '장소 한 곳을 예로 든 점수예요. 지수가 낮을수록 무던해요.',
  off: '맞춤 지수가 꺼져 있어요. 켜면 고른 내용이 지수에 반영돼요.',
}

interface PvState {
  change: PreviewChange | null
  /** 미룬 계산이 따라잡았는지(false인 동안은 이전 결과가 남아 있을 수 있다) */
  settled: boolean
}

/** 미리 보기 상자 아래 안내 문장. 맞춤이 꺼져 있으면 '켜면 반영돼요' 문장 하나가 대신하므로 켜진 상태를 전제한 문장(SHEET)은 쓰지 않는다. */
function previewNote(snap: Snapshot | null, profile: ChildProfile, { change, settled }: PvState): string | null {
  if (change) return PV.eg
  if (!canPreview(snap)) return PV.noData
  if (isPlain(profile)) return PV.plain
  if (!profile.enabled) return null
  if (isSoundOnly(profile)) return SHEET.soundOnly
  return settled ? SHEET.noExample : null // 미룬 계산이 따라잡은 뒤에도 예가 없을 때만 알린다
}

/** 선택 직후 맞춤 전후 점수 미리 보기. 칩 질문 시트(Onboarding)와 같은 계산(lib/preview)을 쓴다. */
function Preview({ snap, profile, state }: { snap: Snapshot | null; profile: ChildProfile; state: PvState }) {
  const { change } = state
  const note = previewNote(snap, profile, state)
  return (
    <div className="ob-preview child-preview" role="status">
      {change && (
        <>
          <span className="ob-pv-place">
            {change.place} · {change.now ? '지금' : `${change.hour}시`}
          </span>
          <span className="ob-pv-num">
            맞춤을 끄면 <b>{change.off}점</b>, 켜면 <b>{change.on}점</b>이에요.
          </span>
        </>
      )}
      {note && <span className="ob-pv-note">{note}</span>}
      {!profile.enabled && !isPlain(profile) && <span className="ob-pv-note">{PV.off}</span>}
    </div>
  )
}

/** 세부 민감도를 고르는 동안 위쪽 미리 보기가 화면 밖에 있어도 보이도록, 접이식 안쪽 맨 위에 붙여 두는 한 줄(스크린리더는 위쪽 미리 보기를 읽는다) */
function PreviewStick({ snap, profile, change }: { snap: Snapshot | null; profile: ChildProfile; change: PreviewChange | null }) {
  const text = change
    ? `${change.place} · ${change.now ? '지금' : `${change.hour}시`} 맞춤을 끄면 ${change.off}점, 켜면 ${change.on}점`
    : !canPreview(snap)
      ? '서울시 실제 자료가 있을 때 전후 점수를 보여 줘요'
      : isPlain(profile)
        ? '모든 항목이 보통이라 전후 차이가 없어요'
        : '고른 조합은 보여 줄 전후 예가 없어요'
  return <p className="child-stick" aria-hidden="true">{text}</p>
}

const SHOWN_LOG = 10

/** 기록 시각(ISO)을 한국 시간 '월/일 시:분'으로 */
function stamp(ts: string): string {
  const d = new Date(Date.parse(ts) + 9 * 3600_000)
  const p2 = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`
}

interface Props extends PreviewInput {
  profile: ChildProfile
  onChange: (p: ChildProfile) => void
  onCleared?: () => void
  /** 기록을 지워 장소 보정치가 바뀌었을 때 */
  onOffsetsChange?: (offsets: Record<string, number>) => void
}

export default function ChildProfileView({ profile, onChange, onCleared, onOffsetsChange, ...input }: Props) {
  const [log, setLog] = useState(loadLog)
  const recent = log.slice(-SHOWN_LOG).reverse()
  const entryLines = entryTexts(recent, input.offsets, profile.enabled) // 항목마다 같은 문장을 되풀이하지 않도록 한 번만 말할 것은 목록 위에 둔다
  const tagRaised = recent.some((v) => !v.ok && v.topTags.length > 0)
  // 마지막으로 누른 프리셋을 누르기 직전의 값. 그 프리셋이 바꾼 값 그대로일 때만 되돌릴 수 있고(그 뒤에 직접 바꾸면 사라진다), 화면에 적힌 변경(line)이 바로 되돌리는 변경이다.
  // baseBefore는 그때 마지막으로 눌러 둔 프리셋이라, 되돌리면 세부 요약의 기준도 함께 돌아간다.
  const [undo, setUndo] = useState<{ before: ChildProfile; baseBefore: ChildProfile | null; applied: ChildProfile; label: string; line: string } | null>(null)
  const canUndo = undo !== null && same(profile, undo.applied)
  // 마지막으로 누른 프리셋. 세부 요약의 '직접 고친 항목'을 세는 기준이다(누른 적이 없으면 null).
  const [base, setBase] = useState<ChildProfile | null>(null)
  // 미리 보기 계산은 한 번만 하고, 위쪽 상자와 세부 접이식 안의 한 줄이 같은 결과를 쓴다.
  const cand = useMemo(() => ({ ...profile, enabled: true }), [profile])
  const pv = usePreviewChange(input, cand, true)
  return (
    <div className="page">
      <div className="card">
        <h2>우리 아이 맞춤</h2>
        <p className="muted">{PRIVACY_ASK} {STORED_HERE}</p>
        <div className="child-toggle">
          <label className="toggle">
            <input type="checkbox" checked={profile.enabled} onChange={(e) => onChange({ ...profile, enabled: e.target.checked })} />
            맞춤 지수 켜기
          </label>
          <span className="muted">켜면 지도와 추천의 지수가 아이 민감도로 다시 계산돼요.</span>
        </div>
        <p className="muted child-preset-hint" id="child-preset-hint">아래 단추를 누르면 맞춤이 켜지고 일곱 항목이 한 번에 정해져요. 이미 직접 고른 값은 누른 단추의 값으로 바뀌어요.</p>
        <div className="child-presets" role="group" aria-labelledby="child-preset-hint">
          {PRESETS.map(([label, p]) => {
            const on = same(profile, p)
            return (
              <button
                key={label}
                className={on ? 'chip on child-preset' : 'chip child-preset'}
                aria-pressed={on}
                onClick={() => {
                  if (!on) setUndo({ before: profile, baseBefore: base, applied: p, label, line: changeLine(profile, p) })
                  setBase(p)
                  onChange(p)
                }}
              >
                {label}
              </button>
            )
          })}
        </div>
        {canUndo && (
          <div className="child-undo">
            <span className="muted" role="status">"{undo.label}": {undo.line}</span>
            <button
              className="btn"
              onClick={() => {
                onChange(undo.before)
                setBase(undo.baseBefore)
                setUndo(null)
              }}
            >
              되돌리기
            </button>
          </div>
        )}
        <Preview snap={input.snap} profile={profile} state={pv} />
        {profile.tags.sudden > 1 && <p className="muted child-preset-note">{CHILD_SIREN_NOTE}</p>}
        <div className="folds">
          <Fold title="세부 민감도 직접 고르기" brief={detailBrief(profile, base)}>
            <PreviewStick snap={input.snap} profile={profile} change={pv.change} />
            <div className="sens">
              {ITEMS.map((i) => (
                <Row key={i.label} label={i.label} value={i.get(profile)} onPick={(v) => onChange(i.set(profile, v))} />
              ))}
            </div>
          </Fold>
        </div>
      </div>
      <div className="card">
        <h2>기록으로 배우기</h2>
        <p className="muted">맞춤 지수를 켜 둔 때는 장소 화면의 "다녀온 뒤 기록"에서 "힘들었어요"를 누르면 그 장소의 지수 보정이 5점 올라가고, "괜찮았어요"를 누르면 5점 내려가요.</p>
        <div className="folds">
          <Fold title="자세히" brief="소리 민감도, 반영 조건, 기록이 남는 곳">
            <p className="muted">"힘들었어요"를 누른 때의 요일·시간대에 측정해 둔 소리가 있으면, 그중 주요 소리(최대 2개)의 민감도도 한 단계 올라가요(이미 "예민"인 소리는 그대로예요). 지수 보정은 장소마다 ±20까지예요. 보정과 민감도 변화는 맞춤 지수를 켜 둔 때만 지수에 반영돼요. 기록은 이 기기에만 남고, 아래 "최근 기록"에서 보고 지울 수 있어요.</p>
          </Fold>
        </div>
        <button
          className="btn child-clear"
          onClick={() => {
            if (confirm('이 기기에 저장된 프로필과 기록을 모두 지울까요? 소리 측정 요약, 추천 탭에서 고른 기준 장소 이름도 함께 지워요.')) {
              clearAll()
              onChange(defaultProfile())
              setBase(null)
              setLog([])
              onCleared?.()
            }
          }}
        >
          이 기기의 맞춤·기록 지우기
        </button>
      </div>
      <div className="card">
        <h2>최근 기록</h2>
        {recent.length === 0 ? (
          <p className="muted">아직 기록이 없어요. 장소 화면의 "다녀온 뒤 기록"에서 남길 수 있어요.</p>
        ) : (
          <>
            <p className="muted">최근 {recent.length}건이에요. {tagRaised && `${RECORD_TAG_LIST} `}지우면 그 기록이 바꾼 장소 보정(5점)은 되돌리고, 올라간 소리 민감도는 "세부 민감도 직접 고르기"에서 바꿔 주세요.</p>
            {!profile.enabled && <p className="muted">{RECORD_OFF_LIST}</p>}
            <ul className="visit-log">
              {recent.map((v, i) => (
                <li key={v.ts + v.place}>
                  <span><b>{v.place}</b> <span className="muted">{stamp(v.ts)}</span><br />{entryLines[i]}</span>
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
