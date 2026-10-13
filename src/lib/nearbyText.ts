import type { HourScore, Place } from '../types'
import placesRaw from '../data/places.json'
import { DAY_FROM, DAY_TO, hourOf } from './index'
import { NEARBY_FAR_KM, NEARBY_LIMIT, NEARBY_MAX_KM, splitGap, type NoiseState, type RunInfo } from './nearby'

// 인근 장소 카드의 화면 문구는 모두 이 파일에서 만든다. 컴포넌트와 scripts/nearby_check.mjs가 같은 코드를 쓴다.
// 문체는 '~해요'체이고, 순위나 보증으로 읽히는 낱말('추천', '정확')은 쓰지 않는다.

/** 서울시가 실시간으로 공개하는 주요 장소 수(src/data/places.json의 tracked) */
export const PLACE_COUNT = (placesRaw as Place[]).filter((p) => p.tracked).length

/** 시각 문자열('YYYY-MM-DD HH...')을 '지금'이 아닌 이름으로 부르는 함수. 오늘이면 'N시', 아니면 '내일 N시'. */
export type Label = (time: string) => string

export const TXT = {
  title: '무던한 곳 안내',
  titleNeutral: '무던한 곳 안내',
  customOn: '아이 맞춤을 반영해서 비교했어요.',
  customOff: '아이 맞춤 없이 기본 기준으로 비교했어요.',
  customEmpty: '아이 맞춤은 켰지만 고른 항목이 없어서 기본 기준과 같아요.',
  noNoise: '소음 미반영',
  farTime: '먼 시각일수록 예측이 빗나갈 수 있어요.',
  altHead: '같은 곳, 다른 시간',
  altNone: `외출 시간(${DAY_FROM}~${DAY_TO}시) 예측 안에는 무던해지는 때가 보이지 않아요.`,
  candHead: '가까운 다른 곳',
  mid: '붐빔보다는 낫지만 보통으로 예측돼요.',
  midObs: '붐빔보다는 낫지만 보통으로 관측돼요.',
  far: `${NEARBY_FAR_KM}km보다 멀어요`,
  farNote: `${NEARBY_FAR_KM}km보다 먼 곳은 이동이 길어질 수 있어요.`,
  isolated: `직선 ${NEARBY_FAR_KM}km 안에는 비교할 수 있는 다른 곳도 없어요.`,
  safe: '처음 가는 곳이면 아이 곁에서 주변을 먼저 살펴보세요.',
  evidence: `서울시가 실시간으로 공개하는 주요 ${PLACE_COUNT}곳끼리만 비교했어요. 직선 거리만 보여 줘요. 실제 이동 시간은 지도 앱에서 확인해 주세요. 아이에게 편한 정도를 직접 잰 값은 아니에요.`,
  baseStale: '이곳은 서울시 자료가 오래돼서 가까운 곳과 비교하지 않았어요.',
  back: '← 이전 장소로 돌아가기',
  whySummary: '이유 보기',
  panelSummary: '이 선택지는 어떻게 골랐나요',
}

/** 혼잡 점수의 이름. 기준 칸이 서울시 실시간 관측이면 '예측'이 아니라 '관측'으로 부른다. */
const crowdWord = (forecast: boolean) => (forecast ? '혼잡 예측' : '혼잡 관측')

/** 아이 맞춤 줄. applied는 켜진 맞춤이 지수를 바꿀 수 있는지(고른 민감도나 기록 보정이 있는지)다. */
export function customText(enabled: boolean, applied: boolean): string {
  return !enabled ? TXT.customOff : applied ? TXT.customOn : TXT.customEmpty
}

/** 기준 칸의 동네 소음이 반영되지 않은 이유를 알리는 줄. 소음이 반영되었으면 null. noFile은 소음 파일을 불러오지 못한 경우다. */
export function noiseLineText(state: NoiseState | 'noFile', forecast: boolean): string | null {
  const crowd = crowdWord(forecast)
  if (state === 'noFile') return `동네 소음 자료를 불러오지 못해서 ${crowd}만 반영했어요.`
  if (state === 'allMissing') return `이 시간대는 동네 소음 자료가 없어서 ${crowd}만 반영했어요.`
  if (state === 'placeMissing') return `이곳은 동네 소음 자료가 없어서 ${crowd} 위주로 계산했어요.`
  if (state === 'hourMissing') return `이 시간대는 이곳의 동네 소음 값이 비어 있어서 ${crowd} 위주로 계산했어요.`
  return null
}

export function makeLabel(today: string): Label {
  return (time) => `${time.slice(0, 10) === today ? '' : '내일 '}${hourOf(time)}시`
}

/** 후보 이름 옆의 거리와 지수 조각 */
export function metaText(km: number, index: number): string {
  return `직선 ${km.toFixed(1)}km · 지수 ${index}`
}

/** 기준 칸이 어느 시각의 관측인지 예측인지 밝히는 줄 */
export function basisText(shown: HourScore, picked: boolean, nowIsCurrent: boolean, label: Label): string {
  if (picked) return `${label(shown.time)} ${shown.forecast ? '예측' : '관측'} 기준이에요.`
  if (nowIsCurrent) return `지금(${shown.obs ? `관측 ${shown.obs}` : shown.forecast ? '예측' : '관측'}) 기준이에요.`
  return `${label(shown.time)} 예측 기준이에요.`
}

/** label은 '지금' 또는 hourName 결과('N시', '내일 N시') */
export function altButton(label: string): string {
  return label === '지금' ? '지금으로 보기' : `${label}로 보기`
}

/**
 * 무던한 칸의 지속 문구. 예측이 빠졌거나 외출 시간에서 잘린 경우에는 그 뒤를 말하지 않는다.
 * from이 관측 칸(forecast=false)이면 그 칸은 '예측'이 아니라 '관측'으로 부르고, isNow이면 시각 대신 '지금'이라고 부른다.
 */
export function runText(run: RunInfo, from: HourScore, label: Label, isNow = false): string {
  const start = label(from.time)
  if (!from.forecast) {
    const at = isNow ? '지금' : `${start}대`
    if (run.count === 1) {
      if (run.stop === 'nonCalm') return `${at} 관측으로는 무던해요. 도착이 늦어지면 달라질 수 있어요.`
      if (run.stop === 'noForecast') return `${at} 관측으로는 무던해요. 그 뒤는 예측이 없어요.`
      return `${at} 관측으로는 무던해요. 외출 시간(${DAY_TO}시)까지만 살펴봤어요.`
    }
    if (run.stop === 'nonCalm') return `${at} 관측으로는 무던하고, ${label(run.endTime)} 전까지 무던할 것으로 예측돼요.`
    if (run.stop === 'dayEnd') return `${at} 관측으로는 무던하고, 외출 시간 끝(${DAY_TO}시대)까지 무던할 것으로 예측돼요.`
    return `${at} 관측으로는 무던하고, ${label(run.endTime)}대까지 무던할 것으로 예측돼요. 그 뒤는 예측이 없어요.`
  }
  if (run.count === 1) {
    if (run.stop === 'nonCalm') return `${start}대만 무던할 것으로 예측돼요. 도착이 늦어지면 달라질 수 있어요.`
    if (run.stop === 'noForecast') return `${start}대는 무던할 것으로 예측돼요. 그 뒤는 예측이 없어요.`
    return `${start}대는 무던할 것으로 예측돼요. 외출 시간(${DAY_TO}시)까지만 살펴봤어요.`
  }
  if (run.stop === 'nonCalm') return `${start}부터 ${label(run.endTime)} 전까지 무던할 것으로 예측돼요.`
  if (run.stop === 'dayEnd') return `${start}부터 외출 시간 끝(${DAY_TO}시대)까지 무던할 것으로 예측돼요.`
  return `${start}부터 ${label(run.endTime)}대까지 무던할 것으로 예측돼요. 그 뒤는 예측이 없어요.`
}

/** 보통 후보의 한 줄. 관측 칸이면 '관측'으로 부른다. */
export function midText(forecast: boolean): string {
  return forecast ? TXT.mid : TXT.midObs
}

/** label은 시각을 골랐을 때의 이름('N시'), 아니면 null(지금). 지금은 관측일 수도 예측일 수도 있어서 '예측'이라고 부르지 않는다. */
export function emptyText(maxKm: number, label: string | null): string {
  const head = `서울시 주요 ${PLACE_COUNT}곳 중 직선 ${maxKm}km 안에서`
  return label === null ? `${head} 지금 더 무던한 곳을 찾지 못했어요.` : `${head} ${label}에 더 무던할 것으로 예측되는 곳을 찾지 못했어요.`
}

export function selectedCalmText(label: string): string {
  return `${label}에는 이곳이 무던할 것으로 예측돼요.`
}

/**
 * 시트 위쪽의 요약 단추. 320px 폭에서도 한 줄이 되도록 짧게 쓰고, 거리와 지속 시간은 단추가 데려가는 카드에서 보여 준다.
 * obs는 기준 칸이 관측인지다. 관측이면 '무던한', 예측이면 '무던할'로 가른다.
 */
export function summaryText(n: number, obs = false): string {
  return `더 ${obs ? '무던한' : '무던할'} 곳 ${n}곳 보기`
}

/**
 * obs는 같은 곳 다른 시간 칸이 관측인지, run은 그 칸에서 이어지는 무던함이다.
 * 한 시간이라고 부르는 것은 한 칸뿐이고 다음 칸이 무던하지 않을 때만이다. 외출 시간 끝이나 예측 끝에서 한 칸이면 그 뒤를 말하지 않는다.
 */
export function summaryAlt(label: string, obs = false, run?: RunInfo): string {
  if (obs) return `같은 곳이 ${label} 관측으로는 무던해요`
  if (run && run.count === 1) {
    if (run.stop === 'nonCalm') return `같은 곳이 ${label} 한 시간 무던할 것으로 예측돼요`
    return `같은 곳이 ${label === '지금' ? '지금은' : `${label}대는`} 무던할 것으로 예측돼요`
  }
  return `같은 곳이 ${label}부터 무던할 것으로 예측돼요`
}

const PART_LABEL = { noise: '동네 소음', sound: '소리 측정', offset: '내 기록 보정' }

/**
 * 후보 한 곳의 '이유 보기' 줄. 기준 장소(이곳)와 비교해 지수 차이를 항별로 나누고, 소음과 소리가 한쪽에만 반영된 경우를 밝힌다.
 * 소음은 장소 전체의 자료가 없는 경우(placeMissing)와 이 시간대 값만 빈 경우(hourMissing)를 가른다.
 */
export function whyLines(name: string, base: HourScore, cand: HourScore, opts: { baseNoise: NoiseState; candNoise: NoiseState }): string[] {
  const { gap, clamped, parts } = splitGap(base, cand)
  const lines = [`${name}의 지수는 ${cand.index}이고, 이곳(지수 ${base.index})보다 ${gap}점 낮아요.`]
  for (const p of parts) lines.push(`${p.key === 'crowd' ? crowdWord(base.forecast) : PART_LABEL[p.key]} 쪽은 이곳보다 ${Math.abs(p.diff)}점 ${p.diff > 0 ? '낮아요' : '높아요'}.`)
  if (clamped) lines.push('계산 범위(0~100) 끝에 닿아서 항목별로는 나누지 않았어요.')
  const baseOk = opts.baseNoise === 'ok'
  if (baseOk !== (opts.candNoise === 'ok')) {
    const lacking = baseOk ? opts.candNoise : opts.baseNoise
    lines.push(`${baseOk ? `${name}의` : '이곳의'} 동네 소음은 ${lacking === 'placeMissing' ? '자료가 없어서' : '이 시간대 값이 비어 있어서'} 반영되지 않았어요.`)
  }
  if (((base.parts?.w ?? 0) > 0) !== ((cand.parts?.w ?? 0) > 0)) lines.push('소리 측정은 이 기기에서 잰 곳에만 반영돼요.')
  return lines
}

/**
 * '이 선택지는 어떻게 골랐나요' 패널의 줄. 앞의 글자 태그로 근거의 종류를 가른다.
 * noiseDays는 동네 소음 자료의 평균 일수(자료가 없으면 null), baseNoise는 기준 칸의 소음 상태, deviceSound는 기준 장소나 후보에 이 기기에서 잰 소리가 반영되었는지,
 * obs는 비교에 쓴 칸 중 서울시 실시간 관측 칸이 있는지다.
 */
export function panelLines(opts: { noiseDays: number | null; baseNoise: NoiseState; deviceSound: boolean; obs: boolean }): string[] {
  const lines = opts.obs
    ? ['[서울시 관측] 지금 시각은 서울시가 실시간으로 공개하는 혼잡 단계를 썼어요.', '[서울시 예측] 다른 시간은 서울시가 발표한 혼잡 예측 단계를 썼어요. 두 값 모두 지역 단위라 장소 안쪽과 다를 수 있어요.']
    : ['[서울시 예측] 서울시가 발표한 혼잡 예측 단계를 썼어요. 지역 단위 값이라 장소 안쪽과 다를 수 있어요.']
  // 이 시간대에 소음 자료가 없다고 카드 위쪽에서 밝힌 경우(allMissing)에는 소음 평균을 썼다고 쓰지 않는다
  if (opts.noiseDays !== null && opts.baseNoise !== 'allMissing') {
    const skipped = opts.baseNoise === 'placeMissing' ? ' 다만 이곳은 자료가 없어서 반영하지 않았어요.' : opts.baseNoise === 'hourMissing' ? ' 다만 이곳은 이 시간대 값이 비어 있어서 반영하지 않았어요.' : ''
    lines.push(`[소음 평균] 지난 ${opts.noiseDays}일 요일·시각별 동네 소음 평균을 썼어요. 센서는 길가에 있어서 장소 안쪽과 다를 수 있어요.${skipped}`)
  }
  if (opts.deviceSound) lines.push('[기기 소리] 이 기기에서 잰 소리는 잰 장소에만 반영돼요.')
  lines.push(`[가설] 지수 산식은 가설 v1.1이고, 직선 ${NEARBY_MAX_KM}km와 ${NEARBY_LIMIT}곳이라는 기준은 경험으로 정한 값이에요.`)
  lines.push(`[가설] ${NEARBY_FAR_KM}km보다 멀다는 표지도 이동 부담을 재서 정한 값이 아니에요.`)
  return lines
}
