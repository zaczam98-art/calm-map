import type { HourScore } from '../types'
import { clamp, level3, NOISE_SPIKE_FROM, NOISE_SPIKE_MAX, NOISE_SPIKE_PER_DB, noiseScore } from './index'

/**
 * 지수를 이루는 요인을 낱말로 옮긴 문구. 장소 시트의 요약 줄, 펼친 본문, 추천 후보 카드의 표지가 모두 이 파일을 쓴다.
 * 낱말은 지수 산식의 값을 말로 옮긴 표현 기준이고 검증 전 가설이다. 혼잡은 서울시 혼잡도의 이름(여유, 보통, 약간 붐빔, 붐빔)을 그대로 쓴다.
 */

export type NoiseWord = '낮음' | '보통' | '높음'
export type SpikeWord = '작음' | '보통' | '큼'

/** 정수 dB 하나가 소음 점수로 바뀐 값의 단계. 지수와 같은 경계(level3)를 쓴다. */
const noiseLevelAt = (db: number) => level3(noiseScore({ avg: db, max: null }))
/** 정수 dB를 0~120에서 훑어 level3이 처음 바뀌는 값. 글자로 박지 않고 지수 눈금과 경계에서 파생한다. */
const firstDbOf = (lv: 'mid' | 'busy') => Array.from({ length: 121 }, (_, i) => i).find((db) => noiseLevelAt(db) === lv) ?? 0
export const NOISE_MID_FROM_DB = firstDbOf('mid')
export const NOISE_HIGH_FROM_DB = firstDbOf('busy')

/** 큰 소리 가산이 이 점수 이상이면 '큼'. 가산 상한의 절반이다. */
export const SPIKE_BIG_ADD = NOISE_SPIKE_MAX / 2
/** 한 시간 최대 소음과 평균의 차이가 이보다 작으면 본문에서 '거의 같았어요'라고 말한다. */
export const SPIKE_NEAR_ZERO_DB = 0.5

/**
 * 요약 줄의 사이렌 조각. 줄이 바뀌어도 문장 중간에서 갈라지지 않도록 단어 사이를 줄바꿈 없는 공백(U+00A0)으로 잇는다.
 * 조각의 폭(13px 글자 158px)은 320px 시트에서 요약 줄이 쓸 수 있는 폭(약 171px) 안에 든다. '서울시 센서로는'을 넣으면 210px라 이 폭에 들지 않고 줄이 4줄에서 5줄로 늘어난다.
 */
export const SIREN_BRIEF = '사이렌은\u00a0센서로\u00a0알\u00a0수\u00a0없어요'
/** 추천 탭 '소음이 덜한 곳' 안내 줄 끝의 한 문장. 320px에서도 안내 줄이 3줄 안에 들도록 짧게 쓰고, 서울시 센서로 한정한다. */
export const SIREN_GUIDE = '사이렌은 서울시 센서로 알 수 없어요.'
export const SIREN_WHY = '서울시 센서 자료로는 사이렌·경적·알람이 나는지 알 수 없어요. 이 앱이 받는 자료에는 소리의 크기만 있고 종류는 없어요.'
export const CHILD_SIREN_NOTE = '사이렌·경적·알람을 예민으로 골라도 사이렌이 날 가능성을 예측하지는 않아요. 센서 자료로는 점수가 달라지는 폭이 작을 수 있어요.'

type Nz = { avg: number; max: number | null }

/** 평소 소음의 낱말. 정수 dB로 반올림한 값을 지수 눈금에 올려서 정한다(52dB 이하 낮음, 63dB 이상 높음). */
export function noiseStep(avg: number): NoiseWord {
  const lv = noiseLevelAt(Math.round(avg))
  return lv === 'calm' ? '낮음' : lv === 'mid' ? '보통' : '높음'
}

/** 소음 점수에 큰 소리 가산으로 들어가는 점수(맞춤 곱 전). 최대 소음 자료가 없으면 0이다. */
export function spikeAdd(nz: Nz | undefined): number {
  if (!nz || nz.max === null) return 0
  return clamp((nz.max - nz.avg - NOISE_SPIKE_FROM) * NOISE_SPIKE_PER_DB, 0, NOISE_SPIKE_MAX)
}

/** 한 시간 최대 소음과 평균의 차이(dB). 51.3 - 48.3 같은 부동소수 잡음이 낱말을 뒤집지 않게 소수 한 자리로 반올림한다. */
const gapOf = (avg: number, max: number) => Math.round((max - avg) * 10) / 10

/** 갑자기 커지는 정도의 낱말. 가산이 0이면 작음, 0을 넘고 SPIKE_BIG_ADD 미만이면 보통, 이상이면 큼. 최대 소음 자료가 없으면 null. */
export function spikeStep(nz: Nz | undefined): SpikeWord | null {
  if (!nz || nz.max === null) return null
  const add = clamp((gapOf(nz.avg, nz.max) - NOISE_SPIKE_FROM) * NOISE_SPIKE_PER_DB, 0, NOISE_SPIKE_MAX)
  return add <= 0 ? '작음' : add < SPIKE_BIG_ADD ? '보통' : '큼'
}

const kind = (cell: HourScore) => (cell.forecast ? '예측' : '관측')

/** 추천 카드와 시트 요약 줄이 같이 쓰는 혼잡 표지. 서울시 혼잡도를 모르면 null. */
export function crowdMarker(cell: HourScore): string | null {
  return cell.crowdLevel ? `혼잡 ${kind(cell)} ${cell.crowdLevel}` : null
}

/** 소음 표지. 소음 자료가 없으면 null. */
export function noiseMarker(cell: HourScore): string | null {
  return cell.nz ? `평소 소음 ${noiseStep(cell.nz.avg)}(길가 센서)` : null
}

/**
 * 접이식 '왜 이 지수인가요'의 요약 줄. 설명할 칸이 없으면 null이다(이때 호출부가 기존 대체 경로를 쓴다).
 * 사이렌 조각은 맞춤 여부와 상관없이 늘 붙는다. sudden은 호출부 시그니처를 wordLines와 맞추려고 받고, 문구에는 쓰지 않는다.
 */
export function wordsBrief(cell: HourScore, _sudden?: number | null): string | null {
  if (!cell.parts || cell.index === null) return null
  const nz = cell.nz
  const parts = [crowdMarker(cell) ?? '혼잡 자료 없음', noiseMarker(cell) ?? '소음 자료 없음']
  if (nz) parts.push(`갑자기 커지는 정도 ${spikeStep(nz) ?? '알 수 없음'}`)
  parts.push(SIREN_BRIEF)
  return parts.join(' · ')
}

/** '여유'처럼 받침이 없으면 '예요', 있으면 '이에요' */
const be = (w: string) => ((w.charCodeAt(w.length - 1) - 0xac00) % 28 === 0 ? '예요' : '이에요')

const NOISE_END: Record<NoiseWord, string> = { 낮음: '낮아요', 보통: '보통이에요', 높음: '높아요' }
const SPIKE_END: Record<SpikeWord, string> = { 작음: '작아요', 보통: '보통이에요', 큼: '커요' }

/**
 * 펼친 본문의 낱말 문장. 순서는 혼잡, 평소 소음, 갑자기 커지는 정도, 사이렌, 민감도 설명이다.
 * days는 소음 자료가 모은 날 수(없으면 생략), sudden은 맞춤을 켠 때의 돌발음 민감도(껐으면 null).
 */
export function wordLines(cell: HourScore, { days, sudden }: { days?: number | null; sudden?: number | null }): string[] {
  const out: string[] = []
  out.push(cell.crowdLevel ? `서울시 혼잡도 ${kind(cell)}은 '${cell.crowdLevel}'${be(cell.crowdLevel)}.` : '서울시 혼잡도 자료를 찾지 못했어요.')
  const nz = cell.nz
  if (nz) {
    out.push(`평소 소음은 ${NOISE_END[noiseStep(nz.avg)]}. ${days ? `${days}일 치 자료에서 ` : ''}이 요일·시간대의 주변 센서 평균은 ${Math.round(nz.avg)}dB이고, 센서는 길가에 있어서 장소 안쪽과 다를 수 있어요.`)
    if (nz.max === null) {
      out.push('소리가 갑자기 커지는 정도는 이 시간대 자료가 없어서 알 수 없어요.')
    } else {
      const gap = gapOf(nz.avg, nz.max)
      const step = spikeStep(nz) as SpikeWord
      out.push(
        gap >= SPIKE_NEAR_ZERO_DB
          ? `소리가 갑자기 커지는 정도는 ${SPIKE_END[step]}. 센서가 한 시간 동안 잰 가장 큰 소리는 평균보다 대체로 ${gap.toFixed(1)}dB 컸어요.`
          : '소리가 갑자기 커지는 정도는 작아요. 센서가 한 시간 동안 잰 가장 큰 소리는 평균과 거의 같았어요.',
      )
    }
  } else {
    out.push('이 시간대는 주변 소음 자료가 없어서 혼잡만 반영했어요.')
  }
  out.push(SIREN_WHY)
  if (sudden != null && sudden !== 1) {
    const no = cell.soundN === 0 && spikeStep(nz) !== '보통' && spikeStep(nz) !== '큼' // 가산이 0점이고 이 기기에서 잰 소리도 없으면 곱할 값이 없다
    out.push(`사이렌·경적·알람 민감도(${sudden}배)는 사이렌이 날 가능성을 예측하는 값이 아니에요. 소리가 갑자기 커지는 정도와 이 기기에서 잰 소리를 ${sudden > 1 ? '더 크게' : '덜'} 반영하는 값이에요.${no ? ' 이 시간대는 반영할 값이 없어서 지수는 그대로예요.' : ''}`)
  }
  return out
}
