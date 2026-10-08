/**
 * 카드 문장 모듈 만들기: 예민 태그·시간대 요인별 문장 18개를 Gemini 구조화 출력으로 생성하고 shared/cardRules.ts로 검사한다.
 * 모듈은 src/lib/cards.ts의 assembleCard가 기본 카드에 끼워 넣는다(step) 또는 '힘들 때' 줄을 바꾼다(cope).
 * 실행: GEMINI_KEY=... node scripts/gen_card_modules.ts   (Node 24, 타입 제거 실행)
 * 결과: public/data/card_modules.json 갱신(이미 있는 id는 건너뜀), scripts/card_modules_report.json(첫 시도 통과율·실패 사유)
 * 생성이 끝나면 개발자가 모든 문장을 읽고 어색한 문장을 직접 고친다(입력에 없는 사실, 진단·단정, 권고형 여부).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { CARD_ICONS, validateCard } from '../shared/cardRules.ts'
import type { CardModule } from '../src/lib/cards.ts'

const KEY = process.env.GEMINI_KEY
if (!KEY) {
  console.error('GEMINI_KEY 환경변수가 필요합니다.')
  process.exit(1)
}
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest'
const OUT = 'public/data/card_modules.json'

const spec = (kind: CardModule['kind'], tag: CardModule['tag'], situation: string) => ({ id: `${kind}_${tag}`, kind, tag, situation })
const SITUATION: Record<CardModule['tag'], string> = {
  sudden: '사이렌, 경적, 알람처럼 갑자기 나는 소리가 있을 수 있을 때',
  crowd: '여러 사람의 웅성거림이나 환호 같은 군중 소리가 있을 수 있을 때',
  machine: '공사, 자동차, 기계가 내는 소리가 있을 수 있을 때',
  music: '음악이나 안내방송이 나올 수 있을 때',
  speech: '사람들의 말소리가 겹쳐 들릴 수 있을 때',
  crowdSens: '사람이 많은 곳이 힘든 아이가 사람이 많을 수 있는 곳에 갈 때',
  loudSens: '큰 소리가 힘든 아이가 소리가 클 수 있는 곳에 갈 때',
  loudHour: '주변 소음이 큰 편인 시간대에 갈 때',
  crowdedHour: '사람이 많은 편인 시간대에 갈 때',
}
const TAGS = Object.keys(SITUATION) as CardModule['tag'][]
// 태그별 step 1개 + cope 1개: 5태그 × 2 + 혼잡·큰 소리 예민 2 × 2 + 소음이 큰 시간·사람이 많은 시간 2 × 2 = 18개
const SPECS = TAGS.flatMap((t) => [spec('step', t, SITUATION[t]), spec('cope', t, SITUATION[t])])

const KIND_GUIDE = {
  step: '카드의 한 단계로 끼워 넣을 문장입니다. 아이가 그 상황에서 미리 해 볼 행동 한 가지를 알려 줍니다.',
  cope: '카드 맨 아래 "힘들 때" 줄에 들어갈 문장입니다. 아이가 힘들 때 할 일 한 가지를 알려 줍니다.',
}

/** 모듈 한 줄 검사: 단계 규칙(28자, ~요 서술, 금지어)을 validateCard에 그대로 맡긴다. cope도 같은 규칙을 적용한다(단계 규칙이 '힘들 때' 줄 규칙보다 엄격). */
function validateModule(m: unknown, kind: CardModule['kind']): { ok: boolean; reasons: string[]; mod?: { text: string; icon: string } } {
  const t = (m as { text?: unknown } | null)?.text
  const icon = (m as { icon?: unknown } | null)?.icon
  if (typeof t !== 'string' || typeof icon !== 'string') return { ok: false, reasons: ['text·icon 형식 오류'] }
  const v = validateCard({
    steps: [{ icon: 'door', text: '문을 열고 천천히 들어가요.' }, { icon, text: t }, { icon: 'bye', text: '다 하면 손을 흔들고 나와요.' }],
    prep: '물을 챙겨요.',
    whenHard: kind === 'cope' ? t : '잠시 멈추고 숨을 쉬어요.',
  })
  const reasons = v.reasons.filter((r) => !r.startsWith('whenHard')).map((r) => r.replace(/^2단계/, '문장'))
  return v.ok ? { ok: true, reasons: [], mod: { text: t.trim(), icon } } : { ok: false, reasons }
}

const existing: CardModule[] = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf-8')) : []
const byId = new Map(existing.map((m) => [m.id, m]))
const report: { total: number; firstTryOk: number; ok: number; retried: number; generated: number; failed: string[]; reasons: Record<string, number>; attempts: Record<string, number> } = {
  total: 0, firstTryOk: 0, ok: 0, retried: 0, generated: 0, failed: [], reasons: {}, attempts: {},
}

async function gen(s: (typeof SPECS)[number]): Promise<{ text: string; icon: string } | null> {
  let lastReasons: string[] = []
  for (let attempt = 0; attempt < 3; attempt++) {
    const prompt = [
      '당신은 발달장애 아동을 위한 "사회적 이야기(Social Story)" 카드를 쓰는 특수교사입니다.',
      `외출 전에 아이가 미리 볼 카드에 넣을 문장 하나를 만드세요. ${KIND_GUIDE[s.kind]}`,
      `상황: ${s.situation}`,
      '문장은 어느 장소에서도 읽혀야 합니다. 장소 이름, 입구 방향, 동선, 층, 가격, 영업시간, 상호처럼 정보에 없는 사실은 절대 쓰지 마세요.',
      '"~면", "~때" 같은 조건으로 쓰고, 소리가 크다거나 사람이 많다고 단정하지 마세요.',
      '규칙: 28자 이내, "~해요/~어요" 서술로 끝내고, 아이가 1인칭으로 읽는 쉬운 말. 명령형·반말 금지.',
      '금지어: 장애, 자폐, 진단, 위험, 절대, 금지, 경고, 못 가, 사고. 판정하지 말고 권고만. 소리가 조용하다거나 사람이 없다고 단정하지 않습니다.',
      `아이콘은 다음 중 하나: ${CARD_ICONS.join(', ')}.`,
      ...(lastReasons.length ? [`직전 시도가 규칙 검사에서 떨어졌습니다: ${lastReasons.join(' / ')}. 고쳐서 다시 쓰세요.`] : []),
    ].join('\n')
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
            properties: { text: { type: 'STRING' }, icon: { type: 'STRING', enum: [...CARD_ICONS] } },
            required: ['text', 'icon'],
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
      console.error(s.id, 'HTTP', r.status, (await r.text()).slice(0, 200))
      await new Promise((res) => setTimeout(res, 3000))
      continue
    }
    const j = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
    const text = j.candidates?.[0]?.content?.parts?.[0]?.text || ''
    let draft: unknown = null
    try { draft = JSON.parse(text) } catch { /* 형식 오류 */ }
    const v = validateModule(draft, s.kind)
    report.total++
    report.attempts[s.id] = (report.attempts[s.id] || 0) + 1
    if (v.ok && v.mod) {
      report.ok++
      if (attempt === 0) report.firstTryOk++
      return v.mod
    }
    lastReasons = v.reasons.slice(0, 3)
    for (const reason of lastReasons) report.reasons[reason] = (report.reasons[reason] || 0) + 1
    report.retried++
    console.log('재시도', s.id, lastReasons.slice(0, 2).join(' / '))
  }
  return null
}

for (const s of SPECS) {
  if (byId.has(s.id)) continue
  report.generated++
  const g = await gen(s)
  if (g) byId.set(s.id, { id: s.id, kind: s.kind, tag: s.tag, text: g.text, icon: g.icon })
  else report.failed.push(s.id)
  writeFileSync(OUT, JSON.stringify(SPECS.map((x) => byId.get(x.id)).filter(Boolean), null, 1), 'utf-8')
  await new Promise((res) => setTimeout(res, 4500)) // 무료 등급 분당 한도를 넘지 않게
}
writeFileSync('scripts/card_modules_report.json', JSON.stringify(report, null, 1), 'utf-8')
console.log(`모듈 ${byId.size}/${SPECS.length}개, 생성 시도 ${report.total}회, 첫 시도 통과 ${report.firstTryOk}회, 재시도 ${report.retried}회, 최종 실패 ${report.failed.length}건`)
console.log('첫 시도 통과율(이번에 생성한 모듈 기준):', report.generated ? ((report.firstTryOk / report.generated) * 100).toFixed(1) + '%' : 'n/a')
console.log(`${OUT}의 문장을 모두 읽고 어색한 문장을 고친 뒤 쓰세요.`)
