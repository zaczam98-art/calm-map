/**
 * 사전 생성 카드 만들기: 추적 장소 × 3단계를 Gemini 구조화 출력으로 생성하고 shared/cardRules.ts로 검사한다.
 * 실행: GEMINI_KEY=... node scripts/gen_cards.ts   (Node 24, 타입 제거 실행)
 * 결과: public/data/cards.json 갱신, scripts/cards_report.json(통과율·실패 사유)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { CARD_ICONS, validateCard, type CardDraft } from '../shared/cardRules.ts'

const KEY = process.env.GEMINI_KEY
if (!KEY) {
  console.error('GEMINI_KEY 환경변수가 필요합니다.')
  process.exit(1)
}
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite'
const LEVEL_KO: Record<string, string> = { calm: '무던함(사람이 적고 조용함)', mid: '보통', busy: '붐빔(사람이 많고 소리가 큼)' }

const places = (JSON.parse(readFileSync('src/data/places.json', 'utf-8')) as { name: string; category: string; tracked: boolean }[]).filter((p) => p.tracked)
const out = JSON.parse(readFileSync('public/data/cards.json', 'utf-8')) as Record<string, CardDraft>
const report: { total: number; ok: number; retried: number; failed: string[]; reasons: Record<string, number> } = { total: 0, ok: 0, retried: 0, failed: [], reasons: {} }

async function gen(place: string, category: string, level: string): Promise<CardDraft | null> {
  const prompt = [
    '당신은 발달장애 아동을 위한 "사회적 이야기(Social Story)" 카드를 쓰는 특수교사입니다.',
    '아래 정보만으로 외출 전에 아이가 미리 볼 카드를 만드세요. 정보에 없는 사실(입구 방향, 동선, 층, 가격, 영업시간, 상호)은 절대 쓰지 마세요.',
    `장소: ${place} (${category})`,
    `예상 상태: ${LEVEL_KO[level]}`,
    '규칙: 단계 3~5개. 각 단계는 28자 이내, "~해요/~어요" 서술로 끝내고, 아이가 1인칭으로 읽는 쉬운 말. 명령형·반말 금지.',
    '금지어: 장애, 자폐, 진단, 위험, 절대, 금지, 경고, 못 가, 사고. 판정하지 말고 권고만.',
    `아이콘은 다음 중 하나: ${CARD_ICONS.join(', ')}.`,
    'prep(준비물 한 줄 30자 이내), whenHard(힘들 때 할 일 한 줄 30자 이내)도 쓰세요.',
  ].join('\n')
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              steps: { type: 'ARRAY', items: { type: 'OBJECT', properties: { icon: { type: 'STRING', enum: [...CARD_ICONS] }, text: { type: 'STRING' } }, required: ['icon', 'text'] } },
              prep: { type: 'STRING' },
              whenHard: { type: 'STRING' },
            },
            required: ['steps', 'prep', 'whenHard'],
          },
        },
      }),
    })
    if (r.status === 429) {
      await new Promise((res) => setTimeout(res, 15000))
      attempt--
      continue
    }
    if (!r.ok) {
      console.error(place, level, 'HTTP', r.status, (await r.text()).slice(0, 200))
      await new Promise((res) => setTimeout(res, 3000))
      continue
    }
    const j = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
    const text = j.candidates?.[0]?.content?.parts?.[0]?.text || ''
    let draft: unknown = null
    try { draft = JSON.parse(text) } catch { /* 형식 오류 */ }
    const v = validateCard(draft)
    report.total++
    if (v.ok && v.card) {
      report.ok++
      return v.card
    }
    for (const reason of v.reasons.slice(0, 3)) report.reasons[reason] = (report.reasons[reason] || 0) + 1
    report.retried++
    console.log('재시도', place, level, v.reasons.slice(0, 2).join(' / '))
  }
  return null
}

for (const p of places) {
  for (const level of ['calm', 'mid', 'busy']) {
    const key = `${p.name}|${level}`
    if (out[key]) continue
    const c = await gen(p.name, p.category, level)
    if (c) out[key] = c
    else report.failed.push(key)
    writeFileSync('public/data/cards.json', JSON.stringify(out, null, 1), 'utf-8')
    await new Promise((res) => setTimeout(res, 4500)) // 무료 등급 분당 한도를 넘지 않게
  }
}
writeFileSync('scripts/cards_report.json', JSON.stringify(report, null, 1), 'utf-8')
console.log(`생성 시도 ${report.total}회, 1회 통과 ${report.ok}회, 재시도 ${report.retried}회, 최종 실패 ${report.failed.length}건`)
console.log('통과율(시도 기준):', report.total ? ((report.ok / report.total) * 100).toFixed(1) + '%' : 'n/a')
