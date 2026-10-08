import { validateCard } from '../../shared/cardRules'
import type { Card, Level3, SenseTag } from '../types'
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
