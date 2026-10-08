import { MAX_STEP_LEN, validateCard } from '../../shared/cardRules'
import type { Card, ChildProfile, Level3, SenseTag } from '../types'
import { HAS_API } from './publicData'

let presets: Record<string, unknown> | null = null

async function loadPresets() {
  if (presets) return presets
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}data/cards.json`)
    presets = r.ok ? ((await r.json()) as Record<string, unknown>) : {}
  } catch {
    presets = {}
  }
  return presets
}

export interface CardRequest {
  place: string
  category: string
  level: Level3
  hourLabel: string
  tags: SenseTag[]
  childTags: SenseTag[]
}

/** 서버 생성(규칙 검사 통과분)을 먼저 쓰고, 안 되면 사전 생성 카드, 그것도 없으면 기본 카드 */
export async function getCard(req: CardRequest): Promise<{ card: Card; note: string }> {
  try {
    if (!HAS_API) throw new Error('no api')
    const r = await fetch('/api/card', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) })
    if (r.ok) {
      const j = (await r.json()) as { card?: unknown; source?: string; note?: string }
      const v = validateCard(j.card)
      if (v.ok && v.card) return { card: { ...v.card, source: j.source === 'ai' ? 'ai' : 'preset' }, note: j.note || '' }
    }
  } catch {
    /* 서버 없음 */
  }
  const p = await loadPresets()
  const lv = req.level === 'nodata' ? 'mid' : req.level
  const v = validateCard(p[`${req.place}|${lv}`] ?? p[`*|${lv}`])
  if (v.ok && v.card) return { card: { ...v.card, source: 'preset' }, note: '사전 생성 카드를 보여 드려요.' }
  return {
    card: {
      steps: [
        { icon: 'door', text: '문을 열고 천천히 들어가요.' },
        { icon: 'look', text: '먼저 주변을 한 번 둘러봐요.' },
        { icon: 'headphone', text: '소리가 크면 헤드폰을 써요.' },
        { icon: 'bye', text: '다 하면 손을 흔들고 나와요.' },
      ],
      prep: '헤드폰과 좋아하는 간식을 챙겨요.',
      whenHard: '조용한 곳에서 잠깐 쉬어요.',
      source: 'preset',
    },
    note: '기본 카드를 보여 드려요.',
  }
}

export type ModuleTag = Exclude<SenseTag, 'ambient'> | 'crowdSens' | 'loudSens' | 'loudHour' | 'crowdedHour'

/** 개발자가 생성하고 검수한 문장 한 줄. step은 카드 단계 사이에 끼우고, cope는 '힘들 때' 줄을 바꾼다. */
export interface CardModule {
  id: string
  kind: 'step' | 'cope'
  tag: ModuleTag
  text: string
  icon: string
}

export interface CardFactors {
  /** 선택한 시각이 소음이 큰 편인 시간대인지 */
  loudHour: boolean
  /** 선택한 시각이 사람이 많은 편인 시간대인지 */
  crowdedHour: boolean
}

export interface AssembledCard {
  card: Card
  /** 근거 한 줄. 기본 카드를 그대로 돌려줄 때는 빈 문자열이다. */
  reason: string
  /** 쓴 모듈 id */
  used: string[]
  /** 조립한 카드가 규칙 검사에서 떨어져 기본 카드로 되돌린 경우의 사유 */
  rejected?: string[]
}

let modulesCache: CardModule[] | null = null

export async function loadCardModules(): Promise<CardModule[]> {
  if (modulesCache) return modulesCache
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}data/card_modules.json`)
    const j: unknown = r.ok ? await r.json() : []
    modulesCache = Array.isArray(j) ? (j as CardModule[]).filter((m) => typeof m?.text === 'string') : []
  } catch {
    modulesCache = []
  }
  return modulesCache
}

const MAX_STEPS = 5
const MAX_ADDED = 2
/** 같은 행동을 두 번 안내하지 않도록, 이 아이콘의 단계가 이미 있으면 같은 아이콘 모듈은 넣지 않는다. */
const DUP_ICONS = ['headphone', 'quiet', 'hand', 'sit', 'wait']
const TAG_ORDER: Exclude<SenseTag, 'ambient'>[] = ['sudden', 'crowd', 'machine', 'music', 'speech']
const CAUSE: Record<ModuleTag, string> = {
  sudden: '돌발음에 예민해서',
  crowd: '군중 소리에 예민해서',
  machine: '기계·차량 소리에 예민해서',
  music: '음악·안내방송에 예민해서',
  speech: '말소리에 예민해서',
  crowdSens: '사람이 많은 곳에 예민해서',
  loudSens: '큰 소리에 예민해서',
  loudHour: '소음이 큰 편인 시간대라',
  crowdedHour: '사람이 많은 편인 시간대라',
}
const VERB = { put: ['넣고', '넣었어요'], swap: ['바꾸고', '바꿨어요'] }

/** 우선순위: 시간대 요인, 큰 소리·혼잡 예민, 태그 순서. 프로필이 꺼져 있으면 시간대 요인만 쓴다. */
function wantedTags(profile: ChildProfile, factors: CardFactors): ModuleTag[] {
  const w: ModuleTag[] = []
  if (factors.loudHour) w.push('loudHour')
  if (factors.crowdedHour) w.push('crowdedHour')
  if (profile.enabled) {
    if (profile.loud === 1.5) w.push('loudSens')
    if (profile.crowd === 1.5) w.push('crowdSens')
    for (const t of TAG_ORDER) if (profile.tags[t] === 1.5) w.push(t)
  }
  return w
}

function buildReason(inserted: CardModule[], cope: CardModule | undefined): string {
  const groups: { tag: ModuleTag; acts: { obj: string; v: keyof typeof VERB }[] }[] = []
  const add = (tag: ModuleTag, act: { obj: string; v: keyof typeof VERB }) => {
    const g = groups.find((x) => x.tag === tag)
    if (g) g.acts.push(act)
    else groups.push({ tag, acts: [act] })
  }
  for (const m of inserted) add(m.tag, { obj: m.icon === 'headphone' ? '헤드폰 단계를' : '미리 알려 주는 단계를', v: 'put' })
  if (cope) add(cope.tag, { obj: '힘들 때 할 일을', v: 'swap' })
  // 같은 원인은 한 번만 쓰고, 원인이 다르면 쉼표로 이어 한 문장으로 만든다
  const acts = groups.flatMap((g) => g.acts.map((a, j) => ({ ...a, cause: j === 0 ? `${CAUSE[g.tag]} ` : '' })))
  return acts.map((a, i) => `${i === 0 ? '' : a.cause ? ', ' : ' '}${a.cause}${a.obj} ${VERB[a.v][i < acts.length - 1 ? 0 : 1]}`).join('') + '.'
}

/**
 * 기본 카드에 아이의 예민한 태그(1.5)와 선택 시각의 요인에 맞는 모듈을 끼워 넣는다.
 * step 모듈은 첫 단계 뒤에 최대 2개(전체 5단계 이하), cope 모듈은 '힘들 때' 줄을 바꾼다.
 * 조립 결과가 validateCard를 통과하지 못하면 기본 카드를 그대로 돌려준다.
 */
export function assembleCard(base: Card, profile: ChildProfile, factors: CardFactors, modules: CardModule[]): AssembledCard {
  const keep: AssembledCard = { card: base, reason: '', used: [] }
  const wants = wantedTags(profile, factors)
  const room = Math.min(MAX_ADDED, MAX_STEPS - base.steps.length)
  const inserted: CardModule[] = []
  for (const tag of wants) {
    if (inserted.length >= room) break
    const m = modules.find((x) => x.kind === 'step' && x.tag === tag)
    if (!m) continue
    const dup = [...base.steps, ...inserted].some((s) => s.text === m.text || (DUP_ICONS.includes(s.icon) && s.icon === m.icon))
    if (!dup) inserted.push(m)
  }
  let cope: CardModule | undefined
  for (const tag of wants) {
    const m = modules.find((x) => x.kind === 'cope' && x.tag === tag)
    if (m && m.text !== base.whenHard) {
      cope = m
      break
    }
  }
  if (!inserted.length && !cope) return keep
  // validateCard는 '힘들 때' 줄의 서술 어미와 28자를 보지 않으므로 cope 문장은 단계 규칙으로 따로 본다
  if (cope && !(cope.text.length <= MAX_STEP_LEN && /요\.?$/.test(cope.text.trim()))) return { ...keep, rejected: ['힘들 때 문장이 28자 이내 ~요 서술이 아님'] }
  const v = validateCard({
    steps: [...base.steps.slice(0, 1), ...inserted.map((m) => ({ icon: m.icon, text: m.text })), ...base.steps.slice(1)],
    prep: base.prep,
    whenHard: cope ? cope.text : base.whenHard,
  })
  if (!v.ok || !v.card) return { ...keep, rejected: v.reasons }
  return { card: { ...v.card, source: base.source }, reason: buildReason(inserted, cope), used: [...inserted, ...(cope ? [cope] : [])].map((m) => m.id) }
}
