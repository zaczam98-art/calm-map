import type { ChildProfile, CongestLevel, ForecastPoint, HourScore, Level3, PlaceSnapshot, SenseTag, SoundBucket } from '../types'
import { SENSE_TAGS } from '../types'

/** 태그 기본 가중(설계 문서 3절) */
export const TAG_WEIGHT: Record<SenseTag, number> = {
  sudden: 1.0,
  crowd: 0.7,
  machine: 0.5,
  music: 0.5,
  speech: 0.3,
  ambient: 0.1,
}

/** 가족이 실제로 외출하는 시간대. 권고는 이 범위의 칸만 비교한다. */
const DAY_FROM = 8
const DAY_TO = 21

const LEVEL_BASE: Record<CongestLevel, number> = { 여유: 15, 보통: 40, '약간 붐빔': 65, 붐빔: 90 }

/** 혼잡 점수 C: 단계 기준값 + 같은 단계 안에서 인구 중앙값 위치로 ±10 보정 */
export function congestScore(p: ForecastPoint, all: ForecastPoint[]): number {
  const base = LEVEL_BASE[p.level] ?? 40
  const mids = all.map((f) => (f.min + f.max) / 2)
  const lo = Math.min(...mids)
  const hi = Math.max(...mids)
  if (!isFinite(lo) || hi <= lo) return base
  const pos = ((p.min + p.max) / 2 - lo) / (hi - lo) // 0~1
  return clamp(base + (pos - 0.5) * 20, 0, 100)
}

/**
 * 소리 점수 S: 측정에 잡힌 태그마다 (확률×강도 평균 v) × 태그 가중 × 민감도를 더해 0~100으로.
 * S = clamp(100 × Σ_t v_t · TAG_WEIGHT[t] · sens_t, 0, 100). 맞춤을 끄면 sens_t = 1.
 * 가중 합으로 나누지 않는다. 나누면 값이 0인 태그가 분모를 키워 돌발음만 잡힌 세션도 S가 45를 넘지 못하고,
 * 민감도가 분자와 분모에서 상쇄된다. 이 식에서는 민감도를 올리면 그 태그의 몫만큼 S가 오르고, 세션에 없는 태그의 민감도는 S에 영향이 없다.
 */
export function soundScore(b: SoundBucket | undefined, profile?: ChildProfile): number | null {
  if (!b || b.n === 0) return null
  let sum = 0
  for (const t of SENSE_TAGS) {
    const v = b.tags[t]
    if (v === undefined) continue
    sum += v * TAG_WEIGHT[t] * (profile?.enabled ? profile.tags[t] : 1)
  }
  return clamp(sum * 100, 0, 100)
}

/** 소음 실측이 있을 때 기본 지수에서 소음이 차지하는 비중. 혼잡은 실시간 예측이고 소음은 평소 패턴이라 혼잡에 조금 더 무게를 둔다. */
export const NOISE_WEIGHT = 0.4
export const NOISE_DB_LOW = 40 // 이 평균 소음(dB)이면 소음 점수 0: 조용한 주택가 수준
export const NOISE_DB_HIGH = 75 // 이 평균 소음이면 100: 큰길가 수준
export const NOISE_SPIKE_FROM = 3 // 시간 최대와 평균의 차이가 이보다 크면 '큰 소리' 가산
export const NOISE_SPIKE_PER_DB = 4
export const NOISE_SPIKE_MAX = 20

/**
 * 소음 점수 N: 주변 센서의 같은 요일·시간대 평균 소음을 0~100으로 바꾸고, 큰 소리 정도(최대-평균)를 더한다.
 * 맞춤을 켜면 평균에는 '큰 소리' 민감도를, 가산에는 돌발음 민감도를 곱한다. 자료가 없으면 null.
 */
export function noiseScore(nz: { avg: number; max: number | null } | undefined, profile?: ChildProfile): number | null {
  if (!nz) return null
  let n = clamp(((nz.avg - NOISE_DB_LOW) / (NOISE_DB_HIGH - NOISE_DB_LOW)) * 100, 0, 100)
  const gap = nz.max === null ? 0 : nz.max - nz.avg
  let spike = clamp((gap - NOISE_SPIKE_FROM) * NOISE_SPIKE_PER_DB, 0, NOISE_SPIKE_MAX)
  if (profile?.enabled) {
    n = clamp(n * profile.loud, 0, 100)
    spike = spike * profile.tags.sudden
  }
  return clamp(n + spike, 0, 100)
}

export function soundWeight(n: number): number {
  return n <= 0 ? 0 : Math.min(0.5, n / (n + 6))
}

export function level3(index: number | null): Level3 {
  if (index === null) return 'nodata'
  if (index < 35) return 'calm'
  if (index < 65) return 'mid'
  return 'busy'
}

export const LEVEL3_LABEL: Record<Level3, string> = { calm: '무던함', mid: '보통', busy: '붐빔', nodata: '데이터 부족' }

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** 한국 시간 기준 현재 시각 키 'YYYY-MM-DD HH'. 실제 서울시 자료일 때만 지난 시간대를 걸러 낸다(데모 스냅샷은 날짜가 고정). */
export function nowKeyFor(snap: { source: string } | null | undefined, now = Date.now()): string | undefined {
  if (!snap || snap.source !== 'seoul') return undefined
  return new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 13).replace('T', ' ')
}

export function hourOf(time: string): number {
  return Number(time.slice(11, 13))
}

/** 'YYYY-MM-DD HH...' 문자열의 정시를 밀리초로(두 값의 차이만 쓰므로 시간대는 상관없다). */
function hourStamp(time: string): number {
  return Date.parse(`${time.slice(0, 10)}T${time.slice(11, 13)}:00:00Z`)
}

/**
 * 장소의 시간대별 지수. 현재 시각 + 12시간 예측.
 * sound: 요일·시간 버킷 조회 함수. offset: 장소별 개인 보정치(기록으로 학습).
 */
export function hourScores(
  snap: PlaceSnapshot | undefined,
  sound: (hour: number, dow: number) => SoundBucket | undefined,
  profile: ChildProfile | null,
  offset = 0,
  nowKey?: string,
  noise: (hour: number, dow: number) => { avg: number; max: number | null } | undefined = () => undefined,
): HourScore[] {
  if (!snap) return []
  type Pt = ForecastPoint & { forecast: boolean; obs?: string }
  let pts: Pt[] = []
  if (snap.live) pts.push({ time: snap.live.time, level: snap.live.level, min: snap.live.min, max: snap.live.max, forecast: false })
  pts.push(...snap.fcst.map((f) => ({ ...f, forecast: true })))
  if (nowKey) {
    // 수집이 늦어지면 실시간 값이 이미 지난 시각의 것이다. 지난 시간대는 버리고 현재 시각의 예측값부터 보여 준다.
    const fresh = pts.filter((p) => p.time.slice(0, 13) >= nowKey)
    const seen = new Set<string>()
    pts = fresh.filter((p) => (seen.has(p.time.slice(0, 13)) ? false : (seen.add(p.time.slice(0, 13)), true)))
    // 예측이 다음 시각부터 시작해 지금 시각 칸이 비면, 1~2시간 안의 실시간 관측을 지금 칸으로 쓴다(관측 시각은 obs에 남긴다).
    const l = snap.live
    if (l && !pts.some((p) => p.time.slice(0, 13) === nowKey)) {
      const ago = (hourStamp(nowKey) - hourStamp(l.time)) / 3600000
      if (ago >= 1 && ago <= 2) pts.unshift({ time: `${nowKey}:00`, level: l.level, min: l.min, max: l.max, forecast: false, obs: l.time.slice(11, 16) })
    }
  }
  const personal = profile?.enabled ? profile : null
  return pts.map((p) => {
    const h = hourOf(p.time)
    const dow = dowOfTime(p.time)
    let c = congestScore(p, pts)
    if (personal) c = clamp(c * personal.crowd, 0, 100)
    const nz = noise(h, dow)
    const n = noiseScore(nz, personal ?? undefined)
    const base = n === null ? c : (1 - NOISE_WEIGHT) * c + NOISE_WEIGHT * n
    const b = sound(h, dow)
    const s = soundScore(b, personal ?? undefined)
    const w = s === null ? 0 : soundWeight(b?.n ?? 0)
    const off = personal ? offset : 0
    const idx = clamp((1 - w) * base + w * (s ?? 0) + off, 0, 100)
    const index = Math.round(idx) // 화면에 보이는 정수와 단계가 어긋나지 않게 반올림한 값으로 단계를 정한다
    return { time: p.time, hour: h, index, level: level3(index), soundN: b?.n ?? 0, forecast: p.forecast, noise: n !== null, obs: p.obs, parts: { c, n, s, w, offset: off, base } }
  })
}

/** 시계열에서 해당 시(0~23)의 칸. 예측이 빠진 시각이면 undefined(배열 인덱스로 짐작하지 않는다). */
export function scoreAt(scores: HourScore[], hour: number): HourScore | undefined {
  return scores.find((s) => s.hour === hour)
}

/** 'YYYY-MM-DD HH:MM' 문자열의 요일(일요일=0). 기기 시간대와 무관하게 날짜만으로 계산한다. */
export function dowOfTime(time: string): number {
  const [y, m, d] = time.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/**
 * 권고 문장. 외출 시간(8~21시)만 비교하고, 비교 범위를 문장에 밝힌다.
 * - 지금이 외출 시간 안이고 무던하면 늘 '지금부터 N시 전까지 무던해요'로 시작한다(22시 이후까지 이어지면 22시에서 자르고 한 번만 안내).
 * - 지금이 22~23시면 '오늘 외출 시간은 지났어요', 0~7시면 '아직 외출 시간 전이에요'로 시작하고 8시 이후 칸에서 고른다.
 * - 무던한 칸이 없으면 가장 덜 붐비는 칸을 말하되 무던하다고 하지 않는다.
 * 오늘/내일은 nowKey(한국 시간)의 날짜로 가른다. nowKey가 없으면(데모 스냅샷) 첫 칸이 지금이다.
 * short는 추천 목록용 한 줄(30자 이내)이다.
 */
export function recommend(scores: HourScore[], nowKey?: string): { text: string; short: string; from: number | null } {
  const all = scores.filter((s) => s.index !== null)
  if (all.length === 0) return { text: '예측 자료가 아직 없어서 권고 시간대를 만들지 못했어요.', short: '예측 자료가 아직 없어요.', from: null }
  const inDay = (s: HourScore) => s.hour >= DAY_FROM && s.hour <= DAY_TO
  const first = all[0]
  const today = (nowKey ?? first.time).slice(0, 10)
  const nowHour = nowKey ? Number(nowKey.slice(11, 13)) : first.hour
  const hasNow = nowKey === undefined || first.time.slice(0, 13) === nowKey // 첫 칸이 지금 시각의 값인가
  const nowInDay = nowHour >= DAY_FROM && nowHour <= DAY_TO
  const head = nowInDay ? '' : nowHour > DAY_TO ? '오늘 외출 시간은 지났어요. ' : '아직 외출 시간 전이에요. '
  const dayOf = (s: HourScore) => (s.time.slice(0, 10) === today ? '오늘' : '내일')

  const cand = all.filter(inDay)
  if (cand.length === 0) return { text: `${head}외출 시간(${DAY_FROM}~${DAY_TO}시)의 예측이 아직 없어요.`, short: '외출 시간 예측이 아직 없어요.', from: null }
  const minIdx = Math.min(...cand.map((s) => s.index as number))
  const best = cand.find((s) => s.index === minIdx)!
  const nowCalm = hasNow && nowInDay && first.level === 'calm'
  const anchor = nowCalm ? first : best

  if (anchor.level === 'calm') {
    // 앵커 앞뒤로 이어지는 무던한 구간을 외출 시간 안에서만 넓힌다
    const i = all.indexOf(anchor)
    let a = i
    let b = i
    while (a - 1 >= 0 && all[a - 1].level === 'calm' && inDay(all[a - 1])) a--
    while (b + 1 < all.length && all[b + 1].level === 'calm' && inDay(all[b + 1])) b++
    const start = all[a]
    const end = all[b].hour + 1
    const night = b + 1 < all.length && all[b + 1].level === 'calm' // 외출 시간에서 끊었을 뿐 22시 이후도 무던한 경우
    const lastKnown = b === all.length - 1 && all[b].hour < DAY_TO // 예측이 끝나서 거기까지만 아는 경우
    const to = night ? `${DAY_TO + 1}시 전까지 무던해요` : lastKnown ? '예측 범위 끝까지 무던해요' : `${end}시 전까지 무던해요`
    const note = night ? '(밤 시간은 비교에서 뺐어요)' : ''
    if (start === first && nowCalm) return { text: `지금부터 ${to}${note}.`, short: `지금부터 ${to.replace('예측 범위', '예측')}`, from: start.hour }
    const span = `${dayOf(start)} ${start.hour}시부터 ${to}`
    return { text: `${head}${head ? '' : `외출 시간(${DAY_FROM}~${DAY_TO}시) 중에는 `}${span}${note}.`, short: span.replace('예측 범위', '예측'), from: start.hour }
  }

  const when = best === first && hasNow ? `지금(${best.hour}시)` : `${dayOf(best)} ${best.hour}시 무렵`
  const scope = `${head}외출 시간(${DAY_FROM}~${DAY_TO}시) 중에서는 `
  if (best.level === 'busy') return { text: `${scope}${when}이 가장 덜 붐비지만, 그래도 붐비는 편이에요.`, short: `대체로 붐벼요. ${when}이 덜해요`, from: best.hour }
  return { text: `${scope}${when}이 가장 덜 붐벼요(보통 수준).`, short: `${when}이 가장 덜 붐벼요(보통 수준)`, from: best.hour }
}
