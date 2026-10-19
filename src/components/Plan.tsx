import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { ChildProfile, HourScore, NoiseData, Place, Snapshot } from '../types'
import { DAY_FROM, DAY_TO, LEVEL3_LABEL, scoreAt, type recommend } from '../lib/index'
import { calmRun, NEARBY_FAR_KM, noiseState } from '../lib/nearby'
import { customText, metaText, midText, runText, TXT, type Label } from '../lib/nearbyText'
import { customApplied, emptyMemo, loadMemo, MEMO_MAX, memoIsEmpty, planAlternatives, saveMemo, scoresGetter, type Memo, type MemoKey } from '../lib/plan'
import { altEmpty, altGoLabel, altIntro, cardOther, evidenceText, isNowCell, liveWhen, MEMO_FIELDS, PLAN, planTitle, whenLines, whenName, whenOption } from '../lib/planText'
import { SIREN_GUIDE } from '../lib/scoreWords'
import type { SoundStore } from '../lib/snapshot'
import type { AssembledCard } from '../lib/cards'
import CardView from './CardView'
import ShareImage from './ShareImage'
import '../styles/plan.css'

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, a[href]'
const SAVE_MS = 500 // 입력이 멈춘 뒤 메모를 저장하기까지의 시간

/** 메모 칸의 높이를 글 길이에 맞춘다(한 줄에 다 보이지 않는 글도 끝까지 읽게) */
const fit = (el: HTMLTextAreaElement | null) => {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`
}

/** 구역 위쪽으로 스크롤하고 그 제목으로 포커스를 옮긴다 */
const jump = (title: HTMLElement | null) => {
  title?.closest('section')?.scrollIntoView({ block: 'start' })
  title?.focus({ preventScroll: true })
}

interface Props {
  place: Place
  places: Place[]
  scores: HourScore[]
  /** 시트 머리가 보여 주는 칸. 계획의 기준 칸이다. */
  shown: HourScore
  rec: ReturnType<typeof recommend>
  label: Label
  nowKey: string | undefined
  snap: Snapshot | null
  sound: SoundStore
  profile: ChildProfile
  offsets: Record<string, number>
  noise: NoiseData | null
  adapted: boolean
  selectedHour: number | null
  /** 지도 슬라이더와 시트가 함께 쓰는 선택 시각(null=지금)을 바꾼다 */
  onPickHour: (hour: number | null) => void
  card: { note: string } | null
  assembled: AssembledCard | null
  loading: boolean
  cardFocus: number
  onMakeCard: () => void
  onClose: () => void
  /** 대안 장소의 시트를 연다(계획이 쌓은 기록 칸을 먼저 되돌린 뒤) */
  onOpenPlace: (name: string) => void
}

/** 전체 화면 외출 계획. 열리면 제목으로 포커스를 옮기고, 화면 안에서만 Tab이 돈다. 열려 있을 때만 마운트된다. */
export default function Plan({ place, places, scores, shown, rec, label, nowKey, snap, sound, profile, offsets, noise, adapted, selectedHour, onPickHour, card, assembled, loading, cardFocus, onMakeCard, onClose, onOpenPlace }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const firstInput = useRef<HTMLTextAreaElement | null>(null)
  const altTitle = useRef<HTMLHeadingElement>(null)
  const memoTitle = useRef<HTMLHeadingElement>(null)
  const id = useId()
  const now = scores[0]
  const isNow = isNowCell(shown, scores, nowKey)
  const when = whenName(shown, isNow, label)
  const lines = whenLines(shown, rec, scores, label, nowKey, snap)

  // 도착할 시각 선택지: 예측이 있는 외출 시간(8~21시)의 칸과 지금 보여 주는 칸
  const options = scores.filter((c) => c === shown || (c.index !== null && c.hour >= DAY_FROM && c.hour <= DAY_TO))
  const valueOf = (c: HourScore) => (c === now ? 'now' : String(c.hour))
  const [liveTime, setLiveTime] = useState('')
  const onWhen = (v: string) => {
    const next = v === 'now' ? now : scoreAt(scores, Number(v))
    onPickHour(v === 'now' ? null : Number(v))
    if (next) setLiveTime(liveWhen(whenName(next, isNowCell(next, scores, nowKey), label)))
  }

  // 카드를 만드는 칸은 시트와 같다: 고른 시각, 없으면 권고 시각, 그것도 없으면 첫 칸
  const sel = selectedHour !== null ? scoreAt(scores, selectedHour) : undefined
  const cardCell = sel ?? scores.find((s) => s.hour === rec.from) ?? now
  const cardLine = cardCell === shown ? PLAN.cardSame : cardOther(whenName(cardCell, isNowCell(cardCell, scores, nowKey), label))
  const [liveCard, setLiveCard] = useState('')
  const wasLoading = useRef(false)
  useEffect(() => {
    if (loading) {
      wasLoading.current = true
      setLiveCard(PLAN.cardWorking)
    } else if (wasLoading.current) {
      wasLoading.current = false
      setLiveCard(PLAN.cardDone)
    }
  }, [loading])

  // 안 맞을 때 가까운 다른 곳
  const baseStale = snap?.places[place.name]?.stale === true
  const getScores = useMemo(() => scoresGetter({ snap, sound, profile, offsets, nowKey, noise, place, scores }), [snap, sound, profile, offsets, nowKey, noise, place, scores])
  const alts = useMemo(
    () => (baseStale ? [] : planAlternatives({ place, places, cell: shown, getScores, isStale: (n) => snap?.places[n]?.stale === true })),
    [baseStale, place, places, shown, getScores, snap],
  )
  const tagNoise = noise !== null && noiseState(noise, place.name, shown) !== 'allMissing' // 소음 자료가 없는 시간대는 후보마다 표지를 붙이지 않는다
  const rows = alts.map((it) => {
    const ns = noiseState(noise, it.place.name, it.cell)
    return {
      name: it.place.name,
      level: it.level,
      meta: metaText(it.km, it.index),
      sub: it.level === 'calm' ? runText(calmRun(getScores(it.place.name), it.cell), it.cell, label, isNow) : midText(it.cell.forecast),
      far: it.km > NEARBY_FAR_KM,
      noNoise: tagNoise && (ns === 'placeMissing' || ns === 'hourMissing'),
    }
  })

  // 내 메모: 입력이 멈추고 500ms 뒤, 입력 칸을 벗어날 때, 계획이 닫힐 때 저장한다
  const [memo, setMemo] = useState<Memo>(() => loadMemo(place.name))
  const [saveMsg, setSaveMsg] = useState('')
  const latest = useRef(memo)
  const dirty = useRef(false)
  const timer = useRef(0)
  const flush = useCallback(
    (announce: boolean) => {
      window.clearTimeout(timer.current)
      if (!dirty.current) return
      dirty.current = false
      const ok = saveMemo(place.name, latest.current)
      if (announce) setSaveMsg(!ok ? PLAN.memoFailed : memoIsEmpty(latest.current) ? PLAN.memoCleared : PLAN.memoSaved)
    },
    [place.name],
  )
  useEffect(() => () => flush(false), [flush])
  // 입력하고 0.5초 안에 새로고침하거나 탭을 닫거나 다른 앱으로 넘어가도 글이 남게, 화면이 숨겨질 때도 저장한다
  useEffect(() => {
    const onHide = () => flush(true)
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush(true)
    }
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [flush])
  // 화면 폭이 바뀌면 줄 수가 달라지므로 메모 칸 높이를 다시 맞춘다
  useEffect(() => {
    const refit = () => box.current?.querySelectorAll('textarea').forEach(fit)
    window.addEventListener('resize', refit)
    return () => window.removeEventListener('resize', refit)
  }, [])
  const edit = (k: MemoKey, v: string) => {
    latest.current = { ...latest.current, [k]: v }
    setMemo(latest.current)
    dirty.current = true
    setSaveMsg('')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => flush(true), SAVE_MS)
  }
  const clearMemo = () => {
    if (!window.confirm(PLAN.memoConfirm)) return
    window.clearTimeout(timer.current)
    dirty.current = false
    latest.current = emptyMemo()
    setMemo(latest.current)
    setSaveMsg(saveMemo(place.name, latest.current) ? PLAN.memoCleared : PLAN.memoFailed)
    firstInput.current?.focus() // 누른 단추가 비활성이 되므로 포커스를 첫 입력 칸으로 옮긴다
  }

  // 마지막에 제목으로 포커스를 옮긴다(자식인 카드가 마운트될 때 가져간 포커스보다 나중에 돌아 이긴다)
  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  // 포털 자손(한 단계씩 보기)에서 올라온 키는 그쪽이 처리한다. Esc는 계획만 닫고 시트는 남긴다.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.target as Node)) return
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
    } else if (e.key === 'Tab' && box.current) {
      const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0)
      const first = items[0]
      const end = items[items.length - 1]
      const active = document.activeElement
      if (!box.current.contains(active) || (e.shiftKey && (active === first || active === box.current))) {
        e.preventDefault()
        ;(e.shiftKey ? end : first).focus()
      } else if (!e.shiftKey && active === end) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  const noForecast = shown.index === null || shown.level === 'nodata'
  const live = snap?.source === 'seoul' // 데모 데이터이면 서울시 실시간 자료처럼 읽히는 문장과 공유 이미지를 쓰지 않는다
  const updatedAt = live ? snap.updatedAt : undefined

  return createPortal(
    <div className="cs-back plan-back" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1} ref={box} onKeyDown={onKeyDown}>
      <div className="plan-top">
        <button className="btn" onClick={onClose}>{PLAN.close}</button>
      </div>
      <div className="plan-body">
        <h2 id={`${id}-title`} tabIndex={-1} ref={titleRef}>{planTitle(place.name)}</h2>
        <div className="plan-jump" role="group" aria-label={PLAN.jump}>
          <button className="btn" onClick={() => jump(altTitle.current)}>{PLAN.altJump}</button>
          <button className="btn" onClick={() => jump(memoTitle.current)}>{PLAN.memoHead}</button>
        </div>
        <p role="status" className="cs-sr">{liveTime}</p>
        <p role="status" className="cs-sr">{liveCard}</p>

        <section className="card plan-when">
          <h3>{PLAN.whenHead}</h3>
          <label htmlFor={`${id}-when`} className="plan-label">{PLAN.whenLabel}</label>
          <select id={`${id}-when`} value={valueOf(shown)} onChange={(e) => onWhen(e.target.value)} aria-describedby={`${id}-when-help`}>
            {options.map((c) => (
              <option key={c.time} value={valueOf(c)}>{whenOption(c, { isNow: isNowCell(c, scores, nowKey), isRec: c.hour === rec.from, label })}</option>
            ))}
          </select>
          <p id={`${id}-when-help`} className="muted">{PLAN.whenHelp}</p>
          <p className="plan-head"><b>{lines.head}</b></p>
          {lines.sub && <p>{lines.sub}</p>}
          {lines.rec && <p><b>{lines.rec}</b></p>}
          {lines.basis && <p className="muted">{lines.basis}</p>}
          {baseStale && <p className="muted">{PLAN.whenStale}</p>}
        </section>

        <section className="card">
          <h3 tabIndex={-1} ref={altTitle}>{PLAN.altHead}</h3>
          {baseStale ? (
            <p className="muted">{TXT.baseStale}</p>
          ) : noForecast ? (
            <p className="muted">{PLAN.altNoForecast}</p>
          ) : rows.length === 0 ? (
            <p className="muted">{altEmpty(shown, when)}{options.length > 1 && ` ${PLAN.altRetry}`}</p>
          ) : (
            <>
              <p>{altIntro(shown, when)}</p>
              <ul className="nearby">
                {rows.map((r) => (
                  <li key={r.name} className="plan-alt">
                    <span className={`pill ${r.level}`}>{LEVEL3_LABEL[r.level]}</span>
                    <span className="nearby-name">{r.name}</span>
                    <span className="muted">{r.meta}</span>
                    <span className="nearby-sub muted">{r.sub}</span>
                    {(r.far || r.noNoise) && (
                      <span className="nearby-tags">
                        {r.far && <span className="nearby-far">{TXT.far}</span>}
                        {r.noNoise && <span className="nonoise">{TXT.noNoise}</span>}
                      </span>
                    )}
                    <button className="btn plan-alt-go" aria-label={altGoLabel(r.name)} onClick={() => onOpenPlace(r.name)}>{PLAN.altGo}</button>
                  </li>
                ))}
              </ul>
              {rows.some((r) => r.far) && <p className="muted nearby-note">{TXT.farNote}</p>}
              <p className="nearby-note">{TXT.safe}</p>
              <p className="muted nearby-note">{evidenceText(live)}</p>
              <p className="muted nearby-note">{customText(profile.enabled, customApplied(profile, offsets, place, places))}</p>
              {profile.enabled && profile.tags.sudden > 1 && <p className="muted nearby-note">{SIREN_GUIDE}</p>}
            </>
          )}
        </section>

        {card && assembled ? (
          <>
            <CardView card={assembled.card} note={card.note} place={place.name} focusToken={cardFocus} />
            {assembled.reason && <p className="muted">{assembled.reason}</p>}
            {cardCell !== shown && <p className="muted">{cardLine}</p>}
          </>
        ) : (
          <section className="card">
            <div className="plan-card-row">
              <h3>{PLAN.cardHead}</h3>
              <button className="btn primary" onClick={onMakeCard} disabled={loading}>{loading ? PLAN.cardBusy : PLAN.cardMake}</button>
            </div>
            <p className="muted">{cardLine}</p>
          </section>
        )}

        <section className="card plan-memo">
          <h3 id={`${id}-memo-head`} tabIndex={-1} ref={memoTitle}>{PLAN.memoHead}</h3>
          <p id={`${id}-memo-note`} className="muted">{PLAN.memoNote}</p>
          {/* 안내 문장은 칸마다 잇지 않고 묶음에 한 번만 잇는다(스크린리더가 칸을 옮길 때마다 같은 문장을 다시 읽지 않게) */}
          <div role="group" aria-labelledby={`${id}-memo-head`} aria-describedby={`${id}-memo-note`}>
            {MEMO_FIELDS.map((f, i) => (
              <div key={f.key} className="plan-field">
                <label htmlFor={`${id}-${f.key}`} className="plan-label">{f.label}</label>
                <textarea
                  id={`${id}-${f.key}`}
                  ref={(el) => {
                    if (i === 0) firstInput.current = el
                    fit(el)
                  }}
                  rows={1}
                  maxLength={MEMO_MAX}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={f.placeholder}
                  value={memo[f.key]}
                  onChange={(e) => edit(f.key, e.target.value.replace(/[\r\n]+/g, ' '))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.preventDefault() // 메모는 줄바꿈 없이 한 줄로 이어 쓴다
                  }}
                  onBlur={() => flush(true)}
                />
              </div>
            ))}
          </div>
          <div className="row">
            <button className="btn" onClick={clearMemo} disabled={memoIsEmpty(memo)}>{PLAN.memoClear}</button>
          </div>
          <p role="status" className="muted plan-save">{saveMsg}</p>
        </section>

        {updatedAt && (
          <section className="card">
            <h3>{PLAN.shareHead}</h3>
            <p className="muted">{PLAN.shareNote}{adapted && PLAN.shareAdapted}</p>
            <ShareImage place={place} scores={scores} nowKey={nowKey} updatedAt={updatedAt} selectedHour={sel ? sel.hour : null} adapted={adapted} />
          </section>
        )}
      </div>
    </div>,
    document.body,
  )
}
