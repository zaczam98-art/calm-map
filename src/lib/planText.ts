import type { HourScore, Snapshot } from '../types'
import { LEVEL3_LABEL } from './index'
import { calmRun, NEARBY_MAX_KM } from './nearby'
import { PLACE_COUNT, runText, TXT, type Label } from './nearbyText'
import type { NoiseGap, Priority } from './pick'
import { MEMO_MAX, type MemoKey } from './plan'
import { guideText } from './pickText'
import { basisLine } from './trustText'

// 외출 계획 화면의 문구는 모두 이 파일에서 만든다. 컴포넌트와 scripts/plan_check.mjs가 같은 코드를 쓴다.
// 문체는 '~해요'체이고, 순위나 보증으로 읽히는 낱말('추천', '정확')은 쓰지 않는다.

/** 계획 화면의 세 단계. 번호가 붙은 제목과 맨 위 바로 가기 단추의 글자를 한 곳에 둔다. */
export const STEPS = [
  { key: 'when', head: '1. 언제 갈까요', jump: '1 언제' },
  { key: 'info', head: '2. 미리 볼 정보', jump: '2 미리 볼 정보' },
  { key: 'alt', head: '3. 안 맞을 때 가까운 다른 곳', jump: '3 안 맞을 때' },
] as const

export const PLAN = {
  open: '외출 계획 만들기', // 장소 시트의 단추. 추천 카드의 단추 글자는 PICK.planOpen
  close: '닫기',
  jump: '바로 가기',
  whenLabel: '도착할 시각',
  whenHelp: '바꾸면 이 장소 시트와 지도의 시각도 함께 바뀌어요. 후보 목록의 시각은 그대로예요.',
  whenStale: '이 장소는 서울시 자료를 새로 받지 못해서 이전에 받은 값이에요.',
  cardHead: '미리 보는 카드',
  cardMake: '카드 만들기',
  cardBusy: '만드는 중…',
  cardSame: '고른 시각의 단계(무던함, 보통, 붐빔)에 맞춰 만들어요.',
  cardWorking: '카드를 만드는 중이에요.',
  cardDone: '카드를 만들었어요.',
  altGuideNear: '가까운 곳을 먼저 둬요. 무던함인지 보통인지는 따지지 않아요. 지수는 그대로예요.',
  altNoForecast: '이 시각은 예측이 없어서 다른 곳을 고르지 못했어요.',
  altDemo: '데모 데이터끼리만 비교한 값이라 실제 현장과 달라요.',
  altRetry: '다른 시각을 고르면 달라질 수 있어요.',
  altGo: '이곳 보기',
  memoHead: '내 메모',
  memoNote: `이 앱에는 장소 안쪽의 입구, 화장실, 쉴 곳 정보가 없어요. 가 보고 알게 된 것이나 미리 알아본 것을 적어 두면 다음에 이 장소의 계획을 열 때 그대로 보여 줘요. 칸마다 ${MEMO_MAX}자까지 적을 수 있고, 메모는 이 기기에만 저장돼요.`,
  memoSaved: '이 기기에 저장했어요.',
  memoFailed: '저장하지 못했어요. 이 브라우저에서 기기 저장이 막혀 있어요.',
  memoCleared: '메모를 지웠어요.',
  memoClear: '이 장소 메모 지우기',
  memoConfirm: '이 장소의 메모를 모두 지울까요?',
  shareHead: '나누기',
  shareNote: '이미지에는 메모가 들어가지 않아요.',
  shareAdapted: " 아이 맞춤을 쓰고 있으면 '맞춤 반영' 표시는 들어가요.",
}

export const MEMO_FIELDS: { key: MemoKey; label: string; placeholder: string }[] = [
  { key: 'entry', label: '들어가는 곳', placeholder: '예: 처음 들어가는 문, 모이기로 한 곳' },
  { key: 'restroom', label: '화장실', placeholder: '예: 가까운 화장실이 있는 곳' },
  { key: 'rest', label: '쉴 곳', placeholder: '예: 앉아서 쉴 수 있는 곳' },
  { key: 'exit', label: '빠져나올 곳', placeholder: '예: 힘들면 바로 나갈 수 있는 길' },
]

export const planTitle = (place: string): string => `${place} 외출 계획`

/** 지금 칸인가: 시계열의 첫 칸이고 현재 시각의 칸일 때(nowKey가 없는 데모는 첫 칸을 지금으로 본다) */
export const isNowCell = (cell: HourScore, scores: HourScore[], nowKey: string | undefined): boolean => cell === scores[0] && (!nowKey || cell.time.slice(0, 13) === nowKey)

/** 시각 이름: 지금 칸이면 '지금', 아니면 label(오늘이면 'N시', 아니면 '내일 N시') */
export const whenName = (cell: HourScore, isNow: boolean, label: Label): string => (isNow ? '지금' : label(cell.time))

/** 도착할 시각 선택지의 글자. 예: '내일 9시 · 보통 48점', 권고 시각 칸 끝에는 ' · 권고 시간' */
export function whenOption(cell: HourScore, o: { isNow: boolean; isRec: boolean; label: Label }): string {
  const state = cell.index === null ? LEVEL3_LABEL[cell.level] : `${LEVEL3_LABEL[cell.level]} ${cell.index}점`
  return `${whenName(cell, o.isNow, o.label)} · ${state}${o.isRec ? ' · 권고 시간' : ''}`
}

export interface WhenLines {
  head: string
  /** 무던한 칸일 때만: 무던함이 이어지는 시간 */
  sub: string | null
  /** 권고 시간 문장. 고른 칸이 권고 시각이고 무던하면 sub와 겹치므로 null */
  rec: string | null
  /** 지수가 어떤 자료로 계산됐는지(예측인지 관측인지, 자료 시각) */
  basis: string
}

/** '언제 갈까요' 카드의 문장들 */
export function whenLines(cell: HourScore, rec: { text: string; from: number | null }, scores: HourScore[], label: Label, nowKey: string | undefined, snap: Snapshot | null): WhenLines {
  const isNow = isNowCell(cell, scores, nowKey)
  const when = whenName(cell, isNow, label)
  const run = cell.level === 'calm' ? runText(calmRun(scores, cell), cell, label, isNow) : null
  // 관측 칸의 run 문장은 첫머리('지금 관측으로는 무던해요. ', '지금 관측으로는 무던하고, ')가 head와 같은 말이므로, 그 첫머리를 빼고 이어지는 말만 남긴다
  const lead = `${isNow ? '지금' : `${label(cell.time)}대`} 관측으로는 무던`
  const echo = run === null ? undefined : [`${lead}해요. `, `${lead}하고, `].find((s) => run.startsWith(s))
  return {
    head: cell.index === null ? `${isNow ? '지금은' : `${when}에는`} 지수를 낼 자료가 없어요.` : `${when} ${cell.forecast ? '예측' : '관측'}으로는 ${LEVEL3_LABEL[cell.level]}(지수 ${cell.index}점)이에요.`,
    sub: run !== null && echo ? run.slice(echo.length) : run,
    rec: cell.level === 'calm' && cell.hour === rec.from ? null : `권고 시간: ${rec.text}`,
    basis: snap ? basisLine(snap, cell) : '',
  }
}

/** 카드를 만드는 칸이 계획의 기준 칸과 다를 때(시각을 고르지 않아 권고 시각으로 만들 때)의 안내. cardWhen은 카드 칸의 시각 이름이다. */
export const cardOther = (cardWhen: string): string => `카드는 권고 시간인 ${cardWhen} 기준으로 만들어요.`

/** 대안을 가르는 기준. 소개와 없을 때 문장이 이 낱말을 함께 써서, 찾는 조건과 못 찾았다는 말이 어긋나지 않게 한다. 무던함 기준이면 무던한 곳, 보통이나 붐빔 기준이면 더 낮은 단계의 곳이다. */
const altKind = (cell: HourScore): string => {
  if (cell.level === 'calm') return cell.forecast ? '무던할 것으로 예측되는' : '무던한 것으로 관측되는'
  return `더 낮은 단계로 ${cell.forecast ? '예측' : '관측'}되는`
}

/** 대안 구역의 우선순위 안내 줄. 덜 붐비는 곳과 소음이 덜한 곳은 추천 탭과 같은 문장이고, 가까운 곳은 대안이 단계를 가리지 않고 거리만 보므로 계획 전용 문장이다. */
export const altGuide = (priority: Priority, noiseGap: NoiseGap): string => (priority === 'near' ? PLAN.altGuideNear : guideText(priority, true, noiseGap))

/** 대안 소개 */
export const altIntro = (cell: HourScore, when: string): string => `${when} 기준으로, 직선 ${NEARBY_MAX_KM}km 안에서 ${cell.level === 'calm' ? '같은 시각에 ' : ''}${altKind(cell)} 곳이에요.`

/** 대안이 하나도 없을 때의 문장 */
export function altEmpty(cell: HourScore, when: string): string {
  const head = `서울시 주요 ${PLACE_COUNT}곳 중 직선 ${NEARBY_MAX_KM}km 안에서 ${when === '지금' ? when : `${when}에`}`
  return `${head} ${altKind(cell)} ${cell.level === 'calm' ? '다른 곳을' : '곳을'} 찾지 못했어요.`
}

/** 대안 구역의 비교 범위 안내. 데모 데이터이면 TXT.evidence의 첫 문장('서울시가 실시간으로 공개하는 …')만 데모 안내로 바꾸고, 직선 거리와 이동 시간 문장은 그대로 쓴다. */
export const evidenceText = (live: boolean): string => (live ? TXT.evidence : `${PLAN.altDemo} ${TXT.evidence.replace(/^[^.]*\.\s*/, '')}`)

/** 대안 행의 단추에 붙는 접근 가능한 이름 */
export const altGoLabel = (name: string): string => `${PLAN.altGo}, ${name} 시트 열기`

export const liveWhen = (when: string): string => `${when} 기준으로 다시 골랐어요.`
