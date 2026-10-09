import { useMemo } from 'react'
import type { Briefing as BriefingData, ChildProfile, NoiseData, Snapshot } from '../types'
import { kstNow } from '../lib/publicData'
import { hourScores } from '../lib/index'
import { noiseLookup } from '../lib/noise'
import { bucketKey, type SoundStore } from '../lib/snapshot'

interface Props {
  briefing: BriefingData | null
  known: Set<string>
  onSelect: (name: string) => void
  /** 접힘 상태는 App이 보관한다(장소 시트를 여닫아도, 날짜가 같으면 다시 열어도 유지) */
  collapsed: boolean
  onToggle: () => void
  /** 장소 시트가 열려 있으면 언마운트하지 않고 숨기기만 한다 */
  hidden?: boolean
  snap: Snapshot | null
  sound: SoundStore
  profile: ChildProfile
  offsets: Record<string, number>
  noise: NoiseData | null
  nowKey: string | undefined
}

/** 오늘의 브리핑. 오늘 날짜의 것만, 아직 지나지 않은 시간대만, 장소 상세의 지수와 어긋나지 않는 항목만 보여 준다. */
export default function Briefing({ briefing, known, onSelect, collapsed, onToggle, hidden, snap, sound, profile, offsets, noise, nowKey }: Props) {
  const now = kstNow()
  const { picks, avoid } = useMemo<{ picks: BriefingData['picks']; avoid: BriefingData['avoid'] }>(() => {
    if (!briefing || briefing.date !== now.date) return { picks: [], avoid: [] }
    // 브리핑 시간대([from, to))의 칸을 장소 상세와 같은 hourScores로 다시 계산해 단계가 맞는 항목만 남긴다
    const levels = (place: string, from: number, to: number) =>
      hourScores(snap?.places[place], (h, d) => sound[place]?.[bucketKey(d, h)], profile, offsets[place] ?? 0, nowKey, noiseLookup(noise, place))
        .filter((s) => s.time.slice(0, 10) === briefing.date && s.hour >= Math.max(from, now.hour) && s.hour < to)
        .map((s) => s.level)
    const open = <T extends { place: string; to: number }>(list: T[]) => list.filter((p) => p.to > now.hour && known.has(p.place))
    return {
      picks: open(briefing.picks).filter((p) => {
        const lv = levels(p.place, p.from, p.to)
        return lv.length > 0 && lv.every((l) => l === 'calm')
      }),
      avoid: open(briefing.avoid).filter((p) => {
        const lv = levels(p.place, p.from, p.to)
        // 생성기는 서울시 예측 '약간 붐빔' 이상으로 고르지만 앱 지수로는 같은 칸이 '보통'(55~64)이 되기도 한다. 무던한 칸이 없고 붐빔이 절반 이상이면 남긴다.
        return lv.length > 0 && lv.every((l) => l !== 'calm' && l !== 'nodata') && lv.filter((l) => l === 'busy').length * 2 >= lv.length
      }),
    }
  }, [briefing, known, snap, sound, profile, offsets, noise, nowKey, now.date, now.hour])
  if (!briefing || picks.length === 0) return null
  const range = (from: number, to: number) => `${Math.max(from, now.hour)}~${to}시`
  const first = picks[0]
  const start = Math.max(first.from, now.hour)
  // 시간대 접두어는 범위 전체가 한 시간대 안일 때만 붙인다(8~22시에 '오전'이라고 쓰지 않는다). 끝은 포함하지 않는 시각이므로 마지막 칸은 to - 1시다.
  const partOf = (h: number) => (h < 12 ? '오전' : h < 17 ? '오후' : '저녁')
  const part = partOf(start) === partOf(first.to - 1) ? partOf(start) : ''
  return (
    <aside className={collapsed ? 'briefing collapsed' : 'briefing'} aria-label="오늘의 브리핑" hidden={hidden} style={hidden ? { display: 'none' } : undefined}>
      <button className="briefing-head" onClick={onToggle} aria-expanded={!collapsed}>
        {collapsed ? (
          <>
            <span>
              <span>{part ? `오늘 ${part}` : '오늘'}</span>
              <b className="bf-place">{first.place}</b>
              <span>{range(first.from, first.to)}</span>
            </span>
            <span aria-hidden>▾</span>
          </>
        ) : (
          <>
            <b>오늘의 브리핑</b>
            <span className="muted">접기</span>
          </>
        )}
      </button>
      {!collapsed && (
        <>
          <p className="briefing-headline">{briefing.headline}</p>
          <ul className="briefing-picks">
            {picks.map((p) => (
              <li key={p.place}>
                <button onClick={() => onSelect(p.place)}>
                  <b>{p.place}</b> <span className="muted">{range(p.from, p.to)}</span>
                  <br />
                  <span>{p.reason}</span>
                </button>
              </li>
            ))}
          </ul>
          {avoid.length > 0 && (
            <p className="muted">붐비는 편: {avoid.map((a) => `${a.place}(${range(a.from, a.to)})`).join(', ')}</p>
          )}
          <p className="muted">{briefing.tip}</p>
          <p className="briefing-src">
            {briefing.source === 'ai' ? 'AI가 쓴 문장이에요. 장소와 시간대는 혼잡도 예측과 대조했고, 문장은 길이·어미·금지 표현을 검사했어요.' : '혼잡도 예측에서 규칙으로 만든 문장이에요.'}
            {' '}{briefing.generatedAt.slice(11)} 작성
          </p>
        </>
      )}
    </aside>
  )
}
