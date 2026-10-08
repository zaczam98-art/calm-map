/**
 * 조립 카드 전수 시험: cards.json 366장 × 민감 태그 부분집합 64가지 × 시간대 요인 4조합에 assembleCard를 돌려
 * validateCard 통과율, 서로 다른 결과 수, 5단계 초과 건수를 센다. 모델은 호출하지 않는다.
 *
 * 실행:
 *   node node_modules/esbuild/bin/esbuild scripts/assemble_check.ts --bundle --platform=node --format=esm --define:import.meta.env.VITE_PUBLIC_SNAPSHOT_URL=undefined --define:import.meta.env.BASE_URL='"/"' --outfile=.tmp/assemble_check.mjs
 *   node .tmp/assemble_check.mjs [모듈 json, 기본 public/data/card_modules.example.json]
 */
import { readFileSync } from 'node:fs'
import { FORBIDDEN, validateCard, type CardDraft } from '../shared/cardRules'
import { assembleCard, type AssembledCard, type CardModule } from '../src/lib/cards'
import { SENSE_TAGS, type Card, type ChildProfile, type Sensitivity } from '../src/types'

const modulesPath = process.argv[2] || 'public/data/card_modules.example.json'
const modules = JSON.parse(readFileSync(modulesPath, 'utf-8')) as CardModule[]
const presets = JSON.parse(readFileSync('public/data/cards.json', 'utf-8')) as Record<string, CardDraft>
const bases: Card[] = Object.values(presets).map((d) => ({ ...d, source: 'preset' as const }))
const FACTORS = [
  { loudHour: false, crowdedHour: false },
  { loudHour: true, crowdedHour: false },
  { loudHour: false, crowdedHour: true },
  { loudHour: true, crowdedHour: true },
]
const strip = (c: Card) => JSON.stringify({ steps: c.steps, prep: c.prep, whenHard: c.whenHard })

function profileOf(mask: number, crowd: Sensitivity, loud: Sensitivity, enabled = true): ChildProfile {
  const tags = Object.fromEntries(SENSE_TAGS.map((t, i) => [t, mask & (1 << i) ? 1.5 : 1])) as ChildProfile['tags']
  return { enabled, tags, crowd, loud }
}

function run(label: string, sens: [Sensitivity, Sensitivity][]) {
  const distinct = new Set<string>()
  const usedCount: Record<string, number> = {}
  let total = 0, pass = 0, over5 = 0, rejected = 0, changed = 0, reasonBad = 0, maxReason = 0
  let maxAdded = 0
  for (const base of bases) {
    const baseKey = strip(base)
    for (const [crowd, loud] of sens) {
      for (let mask = 0; mask < 1 << SENSE_TAGS.length; mask++) {
        for (const f of FACTORS) {
          const r: AssembledCard = assembleCard(base, profileOf(mask, crowd, loud), f, modules)
          total++
          if (validateCard(r.card).ok) pass++
          if (r.card.steps.length > 5) over5++
          if (r.rejected?.length) rejected++
          const diff = strip(r.card) !== baseKey
          if (diff) changed++
          maxAdded = Math.max(maxAdded, r.card.steps.length - base.steps.length)
          for (const id of r.used) usedCount[id] = (usedCount[id] || 0) + 1
          // 바뀐 카드에만 근거 한 줄이 있어야 하고, 근거에 금지어가 없어야 한다
          if (diff !== (r.reason.length > 0)) reasonBad++
          if (FORBIDDEN.some((w) => r.reason.includes(w))) reasonBad++
          maxReason = Math.max(maxReason, r.reason.length)
          distinct.add(strip(r.card))
        }
      }
    }
  }
  console.log(`[${label}] 조립 ${total}건 | validateCard 통과 ${pass}건 (${((pass / total) * 100).toFixed(2)}%) | 5단계 초과 ${over5}건 | 조립 후 규칙 검사 탈락(기본 카드로 되돌림) ${rejected}건`)
  console.log(`  바뀐 카드 ${changed}건 (${((changed / total) * 100).toFixed(1)}%) | 서로 다른 결과 ${distinct.size}가지 (기본 카드 ${new Set(bases.map(strip)).size}가지) | 한 카드에 늘어난 단계 최대 ${maxAdded}개`)
  console.log(`  근거 한 줄 불일치·금지어 ${reasonBad}건 | 근거 최대 ${maxReason}자 | 모듈 사용 ${JSON.stringify(usedCount)}`)
  const unused = modules.filter((m) => !usedCount[m.id]).map((m) => m.id)
  if (unused.length) console.log(`  한 번도 안 쓰인 모듈: ${unused.join(', ')}`)
  return { total, pass, over5, rejected, distinct: distinct.size }
}

console.log(`모듈 ${modules.length}개(${modulesPath}), 기본 카드 ${bases.length}장, 기본 카드 검사 통과 ${bases.filter((b) => validateCard(b).ok).length}장`)
run('명세: 혼잡·큰 소리 민감도 보통', [[1, 1]])
run('확장: 혼잡·큰 소리 민감도 보통/예민 4조합 포함', [[1, 1], [1.5, 1], [1, 1.5], [1.5, 1.5]])

// 프로필이 꺼져 있고 시간대 요인도 없으면 어떤 카드도 바뀌지 않는다
let offChanged = 0
for (const base of bases) for (let mask = 0; mask < 64; mask++) if (assembleCard(base, profileOf(mask, 1.5, 1.5, false), FACTORS[0], modules).used.length) offChanged++
console.log(`[프로필 꺼짐·요인 없음] 바뀐 카드 ${offChanged}건 (기대 0)`)

// 규칙을 어기는 모듈은 기본 카드로 되돌아와야 한다
const sudden = profileOf(1, 1, 1)
const badCases: [string, CardModule][] = [
  ['금지어', { id: 'bad1', kind: 'step', tag: 'sudden', text: '위험한 소리가 나면 피해요.', icon: 'headphone' }],
  ['글자 수 초과', { id: 'bad2', kind: 'step', tag: 'sudden', text: '갑자기 아주 큰 소리가 나면 놀라지 않도록 헤드폰을 꼭 써요.', icon: 'headphone' }],
  ['허용 목록 밖 아이콘', { id: 'bad3', kind: 'step', tag: 'sudden', text: '갑자기 큰 소리가 나면 귀를 막아요.', icon: 'rocket' }],
  ['서술 어미 아님', { id: 'bad4', kind: 'cope', tag: 'sudden', text: '귀를 막고 어른에게 말하기', icon: 'hand' }],
]
let badOk = 0
for (const [name, m] of badCases) {
  const r = assembleCard(bases[0], sudden, FACTORS[0], [m])
  const back = strip(r.card) === strip(bases[0]) && !!r.rejected?.length
  if (back) badOk++
  console.log(`  불량 모듈(${name}): 기본 카드로 되돌림 ${back}, 사유 ${r.rejected?.[0] ?? '-'}`)
}
console.log(`[불량 모듈 시험] ${badOk}/${badCases.length}건 기본 카드로 되돌림`)

// 근거 한 줄 예시
const sample = assembleCard(bases.find((b) => b.steps.length === 3) as Card, profileOf(0b00001, 1, 1.5), FACTORS[1], modules)
console.log('조립 예:', JSON.stringify(sample.card.steps.map((s) => s.text)), '| 힘들 때:', sample.card.whenHard, '| 근거:', sample.reason)

// 같은 기본 카드, 같은 시간대 요인에서 두 프로필(소리 예민, 사람 많은 곳 예민)의 결과 비교
const pair = bases.find((b) => b.steps.length === 3) as Card
for (const [name, p] of [['소리 예민', profileOf(0b01001, 1, 1.5)], ['사람 많은 곳 예민', profileOf(0, 1.5, 1)]] as const) {
  const r = assembleCard(pair, p, FACTORS[2], modules)
  console.log(`  ${name}: ${r.card.steps.map((s) => s.text).join(' > ')} | 힘들 때: ${r.card.whenHard} | ${r.reason}`)
}
