import type { HourScore } from '../types'
import { DAY_FROM, DAY_TO, LEVEL3_LABEL } from './index'
import { calmRun, NEARBY_LIMIT, NEARBY_MAX_KM } from './nearby'
import { altButton, customText, runText, TXT, type Label } from './nearbyText'
import type { NoiseGap, PickWhy, Priority } from './pick'
import type { Where } from './recPrefs'
import { crowdMarker, noiseMarker, SIREN_GUIDE } from './scoreWords'

// 추천 탭 '후보 3곳'의 화면 문구는 모두 이 파일에서 만든다. 컴포넌트와 scripts/pick_check.mjs가 같은 코드를 쓴다.
// 문체는 '~해요'체이고, 순위나 보증으로 읽히는 낱말('추천', '정확')과 shared/cardRules.ts의 금지어는 쓰지 않는다.

export const PICK = {
  family: '우리 가족 후보',
  seoul: '서울 후보',
  slotWhere: '어디서',
  slotWhen: '언제',
  slotWhat: '어떤 곳',
  whereAll: '서울 전체',
  whereGps: '내 위치',
  wherePlace: '다른 장소 근처',
  now: '지금',
  placeLabel: '기준으로 삼을 장소 이름',
  placePlaceholder: '예: 서울역, ㅅㅇㅇ',
  placeHint: '가까운 역 이름을 적어 보세요(예: 서울역). 아래 목록에서 골라도 돼요.',
  placeMore: '검색어를 더 적어 주세요.',
  placeHelp: `고른 장소에서 직선 ${NEARBY_MAX_KM}km 안의 곳을 찾아요. 고른 장소 이름은 이 기기에만 저장해요.`,
  gpsNote: '내 위치(GPS) 좌표는 거리 계산에만 쓰고, 저장하거나 어디로 보내지 않아요.',
  geoUnsupported: '이 브라우저는 위치 기능을 지원하지 않아요.',
  geoWait: '위치를 확인하는 중이에요…',
  geoFail: '위치를 확인하지 못했어요. 브라우저의 위치 권한을 확인해 주세요.',
  before: `아직 외출 시간(${DAY_FROM}~${DAY_TO}시) 전이에요.`,
  after: '오늘 외출 시간은 지났어요.',
  laterNote: '내일 아침 시각은 지도 탭의 시간대 선택에서 확인할 수 있어요.',
  priorityLabel: '오늘은 이게 더 중요해요',
  baseSelf: '고른 기준 장소',
  indexNote: '카드와 행에 적힌 숫자가 지수예요. 지수는 0~100이고 낮을수록 무던해요.',
  loading: '자료를 불러오는 중이에요…',
  noSnap: '서울시 자료도 데모 데이터도 받지 못해서 목록을 보여 드릴 수 없어요. 연결을 확인한 뒤 위의 다시 시도를 눌러 주세요.',
  planOpen: '외출 계획 세우기',
  allSeoul: '서울 전체에서 찾기',
  allKinds: "종류를 '전체'로 바꾸기",
  foldPickTitle: '후보는 이렇게 골랐어요',
  foldListLocate: '📍 내 위치에서 가까운 순으로 보기',
  listSearch: '이름으로 찾기',
  listPlaceholder: '예: 어린이대공원, ㅎㄷ',
  sortCalm: '무던한 순',
  sortNear: '가까운 순',
  listKindNone: '선택한 종류에는 없어요.',
}

/** 우선순위 칩의 이름. 키는 pickCandidates의 priority와 같다. */
export const PRIORITIES: [Priority, string][] = [
  ['crowd', '덜 붐비는 곳'],
  ['noise', '소음이 덜한 곳'],
  ['near', '가까운 곳'],
]

/** 맨 위 제목. 맞춤을 쓰거나 기준을 골랐으면 '우리 가족', 아니면 '서울'. n이 0이면 숫자를 뺀다. */
export function titleText(family: boolean, n: number): string {
  const t = family ? PICK.family : PICK.seoul
  return n > 0 ? `${t} ${n}곳` : t
}

/** 기준 장소 검색에서 일치하는 이름이 없을 때의 문장 */
export function placeNoneText(n: number): string {
  return `찾는 장소가 목록에 없어요(서울시 추적 ${n}곳만 있어요)`
}

/** 후보 카드 옆 계획 단추의 접근 가능한 이름. 보이는 글자로 시작해서 읽기 도구와 음성 조작이 같은 말로 부른다. */
export const planOpenLabel = (name: string): string => `${PICK.planOpen}, ${name}`

/** 후보 수가 바뀔 때 스크린리더로만 알리는 문장 */
export function foundText(n: number): string {
  return n > 0 ? `후보 ${n}곳을 찾았어요.` : ''
}

/** 언제 칸의 값. when이 null이면 '지금', 숫자면 '오늘 N시' */
export function whenText(when: number | null): string {
  return when === null ? PICK.now : `오늘 ${when}시`
}

export function whereText(where: Where, anchor: string | null): string {
  return where === 'gps' ? PICK.whereGps : where === 'place' && anchor ? `${anchor} 근처` : PICK.whereAll
}

/**
 * 우선순위를 고른 때만 보이는 안내 줄. 가까운 곳은 기준이 있는지에 따라 다르다.
 * 소음이 덜한 곳은 소음으로 가를 수 없을 때(noiseGap) 순서를 적용하지 못했다고 밝힌다. 이때 카드 순서는 우선순위가 없을 때와 같다.
 * 순서가 적용된 소음 안내 줄 끝에는 사이렌·경적·알람을 센서로 알 수 없다는 한계를 붙인다(평균 소음이 낮아도 사이렌이 적다는 뜻으로 읽히지 않게 한다).
 */
export function guideText(priority: Priority, hasOrigin: boolean, noiseGap: NoiseGap = null): string {
  if (priority === 'crowd') return '같은 단계 안에서 혼잡 점수가 낮은 곳을 앞에 둬요. 지수는 그대로라서 순서와 다르게 보일 수 있어요.'
  if (priority === 'noise') {
    if (noiseGap === 'file') return '소음 자료를 받지 못해서 이 순서는 적용하지 못했어요.'
    if (noiseGap === 'pool') return '이 후보들은 평소 소음 자료가 없어서 이 순서는 적용하지 못했어요.'
    return `같은 단계 안에서 평소 소음이 낮은 곳을 앞에 둬요. 지수는 그대로라서 순서와 다르게 보일 수 있어요. ${SIREN_GUIDE}`
  }
  return hasOrigin ? '무던함이 먼저이고, 같은 단계 안에서 가까운 곳이 앞에 와요. 지수는 그대로예요.' : '어디서 찾을지 고르면 가까운 곳부터 보여 줘요.'
}

/** 카드 표지 줄의 '고른 항목의 말'. 혼잡과 소음 낱말은 scoreWords.ts 하나에서 나오고, 가까운 곳은 머리 줄의 거리가 말한다. */
export function priorityMarker(cell: HourScore, priority: Priority | null): string | null {
  return priority === 'crowd' ? crowdMarker(cell) : priority === 'noise' ? noiseMarker(cell) : null
}

/**
 * 카드의 이유 한 줄. 무던함 칸은 시트 '가까운 다른 곳'과 같은 runText를 쓴다. 보통 칸은 비교 대상이 없으므로 midText 대신 전용 문장을 쓰고,
 * 예측과 관측은 칸 단위로 가른다. isNow이면 시각 대신 '지금'이라고 부른다.
 */
export function reasonText(cell: HourScore, series: HourScore[], label: Label, isNow: boolean): string {
  if (cell.level === 'calm') return runText(calmRun(series, cell), cell, label, isNow)
  return `${isNow ? PICK.now : label(cell.time)} ${cell.forecast ? '예측' : '관측'}으로는 보통 단계예요.`
}

/**
 * 전체 목록 행의 설명 줄(시각을 골랐을 때). 행의 알약과 지수가 고른 시각의 칸이므로 설명도 같은 칸으로 말한다.
 * 무던함 칸은 후보 카드와 같은 runText이고, 그 밖의 칸은 단계 이름만 말한다. 그 시각의 칸이 없으면 자료가 없다고 밝힌다.
 */
export function rowLineText(cell: HourScore | undefined, series: HourScore[], label: Label, when: number): string {
  if (!cell || cell.index === null) return `${whenText(when)} 자료가 없어요.`
  if (cell.level === 'calm') return runText(calmRun(series, cell), cell, label, false)
  return `${label(cell.time)} ${cell.forecast ? '예측' : '관측'}으로는 ${LEVEL3_LABEL[cell.level]} 단계예요.`
}

export type EmptyButton = 'allSeoul' | 'allKinds' | 'now'

export interface EmptyView {
  text: string
  buttons: EmptyButton[]
}

/**
 * 후보가 비었거나 모자랄 때의 문장과 단추. base는 기준 이름('내 위치' 또는 장소 이름, 기준이 없으면 null),
 * kind는 고른 종류 이름(전체이면 null), n은 있는 후보 수, canNow는 '지금으로 보기'가 의미 있는지다.
 */
export function emptyView(why: PickWhy, o: { base: string | null; kind: string | null; when: number | null; n: number; canNow: boolean }): EmptyView {
  const widen: EmptyButton[] = [...(o.base !== null ? (['allSeoul'] as const) : []), ...(o.kind !== null ? (['allKinds'] as const) : [])]
  if (why === 'noRange') {
    const head = `${o.base ?? PICK.whereAll}에서 직선 ${NEARBY_MAX_KM}km 안에는`
    return { text: o.kind === null ? `${head} 살펴볼 수 있는 곳이 없어요.` : `${head} ${o.kind}인 곳이 없어요.`, buttons: widen }
  }
  if (why === 'noData') return { text: `${whenText(o.when)} 기준으로 비교할 수 있는 자료가 없어요.`, buttons: o.when !== null && o.canNow ? ['now'] : [] }
  if (why === 'allBusy') return { text: o.when === null ? '지금은 붐비는 곳뿐이에요.' : `${whenText(o.when)}에는 붐빌 것으로 예측되는 곳뿐이에요.`, buttons: widen }
  return { text: `조건에 맞는 곳이 ${o.n}곳이에요.`, buttons: widen }
}

export const EMPTY_BUTTON_TEXT: Record<EmptyButton, string> = { allSeoul: PICK.allSeoul, allKinds: PICK.allKinds, now: altButton(PICK.now) }

/** 접이식 '후보는 이렇게 골랐어요'의 한 줄 요약. 기준이 없으면 거리를 따지지 않는다. */
export function foldPickBrief(hasOrigin: boolean): string {
  return hasOrigin ? `직선 ${NEARBY_MAX_KM}km 안에서 골라요` : '서울 전체에서 골라요'
}

/** 접이식 '후보는 이렇게 골랐어요'의 본문. applied는 isCustomApplied의 결과다. */
export function foldPickSteps(enabled: boolean, applied: boolean): string[] {
  return [
    `고른 기준에서 직선 ${NEARBY_MAX_KM}km 안의 곳만 봐요. 서울 전체를 고르면 거리는 따지지 않아요.`,
    '붐비는 곳(관측이나 예측), 서울시 자료가 오래된 곳, 고른 시각의 값이 없는 곳은 빼요.',
    '무던함을 보통보다 앞에 두고, 같은 단계 안에서는 지수가 낮은 곳을 앞에 둬요. 지수가 같으면 가까운 곳이 앞이에요.',
    `'${PICK.priorityLabel}'를 고르면 같은 단계 안에서 그 항목이 낮은 곳(가까운 곳이면 거리가 짧은 곳)을 먼저 둬요. 지수는 바뀌지 않아요.`,
    TXT.evidence,
    customText(enabled, applied),
    `[가설] 직선 ${NEARBY_MAX_KM}km와 ${NEARBY_LIMIT}곳이라는 기준은 경험으로 정한 값이에요.`,
  ]
}

/** 접이식 '서울 N곳 전체 목록'의 첫 줄. 시각을 골랐으면 '지금' 자리에 '오늘 N시'가 들어간다. */
export function listIntro(n: number, when: number | null, enabled: boolean): string {
  return `서울 ${n}곳을 ${whenText(when)} 무던한 순서로 보여 줘요${enabled ? '(우리 아이 맞춤 적용)' : ''}.`
}
