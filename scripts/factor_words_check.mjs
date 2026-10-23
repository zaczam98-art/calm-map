/**
 * 점수 요인 말풀이(src/lib/scoreWords.ts, WhyIndex)와 기록 효과 문구(src/lib/recordEffect.ts) 검증.
 * 모델과 외부 주소를 부르지 않고, 받아 둔 공개 스냅샷과 소음 파일로만 돈다.
 *
 * 실행(저장소 루트에서):
 *   node scripts/factor_words_check.mjs <snapshot.json> <noise.json> [nowKey]
 *   고정 사본: node scripts/factor_words_check.mjs scripts/fixtures/snapshot-2026-10-13T1106.json scripts/fixtures/noise-2026-10-13.json "2026-10-13 11"
 *
 * 고정 사본이 아닌 파일로 돌리면 분포 판정(F4)은 값만 출력하고 판정하지 않는다.
 *
 * 판정(위반이 하나라도 있으면 종료 코드 1)
 *  F1 지수 불변: scripts/f1_digest.mjs의 지문이 기준값과 같음
 *  F3 평소 소음: 0~120dB를 0.1씩 훑어 noiseStep이 지수 눈금(level3)과 같고, 경계 53dB와 63dB
 *  F4 갑자기 커지는 정도: 경계값, spikeAdd와 noiseScore의 차이, 8~21시 소음 칸의 분포
 *  F5 문구: 금지어, 대시, 추천과 정확, undefined와 NaN, 문장 끝, 요약 줄 70자, 4번 줄, parts 없는 칸의 null
 *  F6 렌더: WhyIndex의 낱말 문장, 사라진 옛 문장, 5번 줄 조건, 알 수 없어요 문장, 지수는 그대로예요
 *  R1 기록 칩과 항목 문구 표
 *  R2 값의 일치: offsets와 hourScores의 parts.offset, 맞춤 끔
 *  R3 상수 일치: recordVisit을 반복하면 OFFSET_LIMIT에서 멈추고 한 번의 변화량이 RECORD_STEP
 *  R4 clearAll이 추천 탭의 기준 장소 키까지 지움
 *  R5 기록 칩의 숫자가 그 칸에서 기록이 실제로 바꾼 폭(기록을 더한 지수와 뺀 지수의 차이)이고, 0점이나 100점에서 멈춘 칸은 멈춘 점수를 밝히며, 지수가 없는 칸에는 칩이 없음
 *  D4 새로 만든 파일의 문장이 서울시 혼잡도(여유, 보통, 약간 붐빔, 붐빔)를 '단계'라고 부르지 않음
 *  G4 문구 정합: "소리 측정 요약"이 나오는 줄이 새 저장 항목 낱말을 함께 담음
 * 기록(판정 없음): 요약 줄 길이의 실측 최댓값, 분포
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { build } from 'esbuild'

const root = process.cwd()
const [snapPath, noisePath, nowKeyArg] = process.argv.slice(2)
if (!snapPath || !noisePath) {
  console.log('사용법: node scripts/factor_words_check.mjs <snapshot.json> <noise.json> [nowKey 예: "2026-10-13 11"]')
  process.exit(1)
}
const nowKey = nowKeyArg || undefined
const readJson = (f) => JSON.parse(readFileSync(f, 'utf-8').replace(/^﻿/, ''))
const snap = readJson(snapPath)
const noise = readJson(noisePath)
const isFixed = path.basename(snapPath) === 'snapshot-2026-10-13T1106.json' && path.basename(noisePath) === 'noise-2026-10-13.json' && nowKey === '2026-10-13 11'

mkdirSync(path.join(root, '.tmp'), { recursive: true })
const out = path.join(root, '.tmp', 'factor_words_check_bundle.cjs')
await build({
  stdin: {
    contents: `
      export * from './src/lib/index.ts'
      export * from './src/lib/scoreWords.ts'
      export * from './src/lib/recordEffect.ts'
      export { noiseLookup } from './src/lib/noise.ts'
      export { SENSE_TAGS } from './src/types.ts'
      export { recordVisit, clearAll, KEY_REC_ANCHOR } from './src/lib/profile.ts'
      export { SHEET } from './src/lib/landingCopy.ts'
      export { FORBIDDEN, FORBIDDEN_PATTERNS } from './shared/cardRules.ts'
      export { default as WhyIndex } from './src/components/WhyIndex.tsx'
      export { default as Info } from './src/components/Info.tsx'
      export { renderToStaticMarkup } from 'react-dom/server'
      export { createElement } from 'react'
    `,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  outfile: out,
  logLevel: 'error',
  loader: { '.css': 'empty' },
  define: { 'import.meta.env': '{"BASE_URL":"/","VITE_PUBLIC_SNAPSHOT_URL":"x"}' },
})
const L = createRequire(import.meta.url)(out)

let fail = 0
const bad = (msg) => {
  fail++
  if (fail <= 40) console.log('  FAIL ' + msg)
}

// 화면 문구 검사 공통
const DASH = new RegExp('[\u2014\u2013]') // 엠대시와 엔대시
const textOk = (tag, s) => {
  if (typeof s !== 'string') return bad(`${tag}: 문자열이 아님`)
  const f = L.FORBIDDEN.find((w) => s.includes(w))
  if (f) bad(`${tag}: 금지어 "${f}" | ${s}`)
  if (L.FORBIDDEN_PATTERNS.some((re) => re.test(s))) bad(`${tag}: 금지 패턴 | ${s}`)
  if (DASH.test(s)) bad(`${tag}: 엠대시 또는 엔대시 | ${s}`)
  if (s.includes('추천') || s.includes('정확')) bad(`${tag}: 추천 또는 정확 | ${s}`)
  if (/undefined|NaN|\[object/.test(s)) bad(`${tag}: undefined, NaN, [object | ${s}`)
}
/** 문장 끝이 '요' 또는 '다'(마침표는 있어도 없어도 됨). 요약 줄, 칩, 단추는 부르지 않는다. */
const endsOk = (tag, s) => {
  for (const sent of s.split(/(?<=\.)\s+/)) if (!/(요|다)\.?$/.test(sent.trim())) bad(`${tag}: 문장 끝이 요/다가 아님 | ${sent}`)
}

// ---- F1
console.log('[F1] 지수 불변')
try {
  const o = execFileSync(process.execPath, [path.join(root, 'scripts', 'f1_digest.mjs')], { encoding: 'utf-8' })
  console.log('  ' + o.trim().split('\n').join('\n  '))
} catch (e) {
  bad('F1 지문이 기준값과 다름 | ' + String(e.stdout ?? e.message).trim().split('\n').join(' / '))
}

// ---- F3
console.log('[F3] 평소 소음')
{
  const word = { calm: '낮음', mid: '보통', busy: '높음' }
  const ref = (avg) => word[L.level3(Math.max(0, Math.min(100, ((Math.round(avg) - 40) / 35) * 100)))]
  let n = 0
  for (let i = 0; i <= 1200; i++) {
    const avg = i / 10
    n++
    if (L.noiseStep(avg) !== ref(avg)) bad(`F3 noiseStep(${avg}) = ${L.noiseStep(avg)}, 기대 ${ref(avg)}`)
  }
  for (const [avg, w] of [[52.4, '낮음'], [52.5, '보통'], [62.4, '보통'], [62.5, '높음']]) if (L.noiseStep(avg) !== w) bad(`F3 noiseStep(${avg}) = ${L.noiseStep(avg)}, 기대 ${w}`)
  if (L.NOISE_MID_FROM_DB !== 53) bad(`F3 NOISE_MID_FROM_DB ${L.NOISE_MID_FROM_DB}`)
  if (L.NOISE_HIGH_FROM_DB !== 63) bad(`F3 NOISE_HIGH_FROM_DB ${L.NOISE_HIGH_FROM_DB}`)
  if (L.SPIKE_BIG_ADD !== 10) bad(`F3 SPIKE_BIG_ADD ${L.SPIKE_BIG_ADD}`)
  console.log(`  ${n}개 값, 경계 ${L.NOISE_MID_FROM_DB}dB/${L.NOISE_HIGH_FROM_DB}dB, SPIKE_BIG_ADD ${L.SPIKE_BIG_ADD}`)
}

// ---- F4
console.log('[F4] 갑자기 커지는 정도')
{
  const at = (gap) => L.spikeStep({ avg: 50, max: 50 + gap })
  for (const [g, w] of [[0, '작음'], [3.0, '작음'], [3.1, '보통'], [5.4, '보통'], [5.5, '큼'], [14, '큼']]) if (at(g) !== w) bad(`F4 gap ${g} = ${at(g)}, 기대 ${w}`)
  if (L.spikeStep({ avg: 50, max: null }) !== null) bad('F4 max null이 null이 아님')
  if (L.spikeStep(undefined) !== null) bad('F4 nz 없음이 null이 아님')
  if (L.spikeStep({ avg: 48.3, max: 51.3 }) !== '작음') bad('F4 부동소수 잡음(48.3, 51.3)이 작음이 아님')
  // 모든 소음 칸에서 spikeAdd가 noiseScore의 가산과 같다(맞춤 없음, 가산을 더해도 100 이하인 칸만)
  let cmp = 0
  for (const name of Object.keys(noise.places)) {
    const look = L.noiseLookup(noise, name)
    for (let dow = 0; dow < 7; dow++) {
      for (let h = 0; h < 24; h++) {
        const nz = look(h, dow)
        if (!nz) continue
        const base = L.noiseScore({ avg: nz.avg, max: null })
        const full = L.noiseScore(nz)
        if (full >= 100) continue // 100에서 잘린 칸은 가산을 그대로 읽을 수 없다
        cmp++
        if (Math.abs(L.spikeAdd(nz) - (full - base)) > 1e-6) bad(`F4 spikeAdd ${name} ${dow}-${h}: ${L.spikeAdd(nz)} vs ${full - base}`)
      }
    }
  }
  console.log(`  spikeAdd와 noiseScore 가산 비교 ${cmp}칸`)
  // 8~21시 소음 칸 분포
  const dist = { 낮음: 0, 보통: 0, 높음: 0, 작음: 0, 'g보통': 0, 큼: 0, 알수없음: 0 }
  let day = 0
  let withNoise = 0
  for (const name of Object.keys(snap.places)) {
    for (const c of L.hourScores(snap.places[name], () => undefined, null, 0, nowKey, L.noiseLookup(noise, name))) {
      if (c.hour < 8 || c.hour > 21) continue
      day++
      if (!c.nz) continue
      withNoise++
      dist[L.noiseStep(c.nz.avg)]++
      const sp = L.spikeStep(c.nz)
      if (sp === null) dist.알수없음++
      else dist[sp === '보통' ? 'g보통' : sp]++
    }
  }
  console.log(`  8~21시 칸 ${day}개 중 소음 있음 ${withNoise}개: 평소 소음 낮음 ${dist.낮음} / 보통 ${dist.보통} / 높음 ${dist.높음}, 갑자기 작음 ${dist.작음} / 보통 ${dist.g보통} / 큼 ${dist.큼}, 알 수 없음 ${dist.알수없음}`)
  if (isFixed) {
    const want = [1331, 1222, 899, 194, 129, 505, 618, 99]
    const got = [day, withNoise, dist.낮음, dist.보통, dist.높음, dist.작음, dist.g보통, dist.큼]
    if (want.join() !== got.join()) bad(`F4 분포 ${got.join('/')} (기대 ${want.join('/')}): 경계나 반올림 규칙이 바뀌었다는 신호`)
  } else console.log('  (고정 사본이 아니라 분포는 판정하지 않음)')
}

// ---- F5, F6 공통 입력: 실제 칸 + 변형 칸
const names = Object.keys(snap.places)
const tags = Object.fromEntries(L.SENSE_TAGS.map((t) => [t, 1]))
const profOf = (sudden) => (sudden === null ? null : { enabled: true, crowd: 1, loud: 1, tags: { ...tags, sudden } })
const SUDDENS = [null, 0.5, 1, 1.5]
const cells = []
for (const sudden of SUDDENS) {
  for (const name of names) {
    const sc = L.hourScores(snap.places[name], () => undefined, profOf(sudden), 0, nowKey, L.noiseLookup(noise, name))
    for (const c of sc) cells.push({ c, sudden })
  }
}
/** 한 칸에서 말풀이가 갈라지는 경우를 모두 만든 변형 */
const variants = (c) => {
  const nz = c.nz ?? { avg: 60, max: 64 }
  return [
    c,
    { ...c, nz: undefined, noise: false },
    { ...c, nz: { avg: nz.avg, max: null } },
    { ...c, nz: { avg: nz.avg, max: nz.avg + 0.2 } },
    { ...c, nz: { avg: nz.avg, max: nz.avg + 3 } },
    { ...c, nz: { avg: nz.avg, max: nz.avg + 7 } },
    { ...c, crowdLevel: undefined },
    { ...c, soundN: 5 },
    { ...c, soundN: 0, forecast: !c.forecast },
    { ...c, parts: c.parts && { ...c.parts, offset: -5 } }, // 이 장소에 기록 보정이 있는 칸
  ]
}

console.log('[F5] 문구')
{
  // 요약 줄 상한(명세 F5). 3줄(375px)과 4줄(320px) 안에 드는지는 브라우저 검사가 맡는다.
const BRIEF_LIMIT = 70
let briefMax = 0
  let briefMaxText = ''
  let n = 0
  for (const { c, sudden } of cells) {
    for (const v of variants(c)) {
      n++
      const tag = `F5 ${v.time} sudden=${sudden}`
      const b = L.wordsBrief(v, sudden)
      if (v.parts === undefined || v.index === null) {
        if (b !== null) bad(`${tag}: parts나 지수가 없는데 wordsBrief가 null이 아님`)
      } else {
        if (b === null) bad(`${tag}: wordsBrief가 null`)
        else {
          textOk(tag + ' 요약', b)
          if (b.length > briefMax) {
            briefMax = b.length
            briefMaxText = b
          }
          if (b.length > BRIEF_LIMIT) bad(`${tag}: 요약 줄 ${b.length}자 | ${b}`)
          if (/혼잡 단계/.test(b)) bad(`${tag}: 요약 줄이 서울시 혼잡도를 '단계'로 부름 | ${b}`)
          if (!b.includes(L.SIREN_BRIEF)) bad(`${tag}: 요약 줄에 사이렌 조각이 없음`)
          if (/ /.test(L.SIREN_BRIEF) || !L.SIREN_BRIEF.includes(String.fromCharCode(0xa0))) bad(`${tag}: 사이렌 조각이 줄바꿈 없는 공백으로 이어지지 않음`)
          if (b !== L.wordsBrief(v, 1) || b !== L.wordsBrief(v, null)) bad(`${tag}: 요약 줄이 sudden 값에 따라 바뀜`)
          // 요약 줄의 소음 낱말과 본문의 어미가 같은 낱말에서 나왔는지
          if (v.nz) {
            const w = L.noiseStep(v.nz.avg)
            if (!b.includes(`평소 소음 ${w}(길가 센서)`)) bad(`${tag}: 요약 줄의 소음 낱말이 noiseStep(${v.nz.avg}) = ${w}와 다름 | ${b}`)
          }
        }
      }
      const lines = L.wordLines(v, { days: 33, sudden })
      lines.forEach((s, i) => {
        textOk(`${tag} 본문${i + 1}`, s)
        endsOk(`${tag} 본문${i + 1}`, s)
      })
      // 소음 줄: 모은 날 수는 '지난 N일'이 아니라 'N일 치 자료'로 말한다(날 수는 자료가 있는 날의 수이고 달력상 최근 N일이 아니다)
      if (v.nz) {
        if (!lines[1].includes('33일 치 자료에서 이 요일·시간대의') || lines[1].includes('지난')) bad(`${tag}: 소음 줄의 날 수 표현 | ${lines[1]}`)
        const noDays = L.wordLines(v, { sudden })[1]
        if (noDays.includes('일 치') || noDays.includes('지난') || !noDays.includes('이 요일·시간대의 주변 센서 평균은')) bad(`${tag}: 날 수가 없을 때의 소음 줄 | ${noDays}`)
      }
      if (!lines.includes(L.SIREN_WHY)) bad(`${tag}: 본문에 사이렌 줄이 없음`)
      if (lines.indexOf(L.SIREN_WHY) !== (v.nz ? 3 : 2)) bad(`${tag}: 사이렌 줄 위치`)
    }
  }
  for (const [k, s] of Object.entries({ SIREN_BRIEF: L.SIREN_BRIEF, SIREN_GUIDE: L.SIREN_GUIDE, SIREN_WHY: L.SIREN_WHY, CHILD_SIREN_NOTE: L.CHILD_SIREN_NOTE, 'SHEET.sudden': L.SHEET.sudden })) {
    textOk(k, s)
    if (k !== 'SIREN_BRIEF') endsOk(k, s)
  }
  console.log(`  칸 ${n}개(변형 포함) 검사, 요약 줄 최대 ${briefMax}자: ${briefMaxText}`)

  // 정보 탭 문단
  const html = L.renderToStaticMarkup(L.createElement(L.Info, { snap: null, loading: false, metrics: null, noise: null, placeCount: 121, pattern: null }))
  const text = html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, '\n').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  const para = text.split('\n').map((s) => s.trim()).find((s) => s.startsWith('장소 화면의 낱말은'))
  if (!para) bad('F5 정보 탭에서 낱말 문단을 찾지 못함')
  else {
    textOk('정보 탭 문단', para)
    endsOk('정보 탭 문단', para)
    const need = [`${L.NOISE_MID_FROM_DB - 1}dB 이하는 낮음`, `${L.NOISE_MID_FROM_DB}~${L.NOISE_HIGH_FROM_DB - 1}dB는 보통`, `${L.NOISE_HIGH_FROM_DB}dB 이상은 높음`, `${L.SPIKE_BIG_ADD}점 미만이면 보통`, `${L.SPIKE_BIG_ADD}점 이상이면 큼`, '평균 소음 40dB(0점)과 75dB(100점)', '(35점, 65점)']
    for (const s of need) if (!para.includes(s)) bad(`F5 정보 탭 문단에 "${s}"가 없음 | ${para}`)
    console.log(`  정보 탭 문단: ${para}`)
  }

  // 기록 효과 문구의 모든 조합
  const rec = [L.RECORD_OFF_TEXT, L.RECORD_GO_CHILD, L.RECORD_LEGEND, L.RECORD_TAG_LIST, L.RECORD_OFF_LIST]
  for (let k = 0; k <= 121; k++) rec.push(L.unappliedText(k))
  for (const o of [-20, -15, -5, 0, 5, 15, 20]) {
    for (const enabled of [true, false]) {
      const chip = L.recordChip(o, enabled)
      if (chip !== null) textOk(`칩 o=${o}`, chip)
      for (const ok of [true, false]) for (const showCap of [true, false]) rec.push(L.entryText(ok, o, enabled, showCap))
    }
  }
  rec.forEach((s, i) => {
    textOk(`기록 문구 ${i}`, s)
    if (s !== L.RECORD_GO_CHILD) endsOk(`기록 문구 ${i}`, s)
  })
  console.log(`  기록 효과 문구 ${rec.length}개 검사`)
}

console.log('[F6] 렌더')
{
  const flat = (el) => L.renderToStaticMarkup(el).replace(/<!-- -->/g, '').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  const count = (s, sub) => s.split(sub).length - 1
  let n = 0
  let legendN = 0
  // 변형 칸 전부와 실제 칸 일부(소음 있는 칸 위주로 간격을 두고)를 그린다
  const pool = []
  cells.forEach(({ c, sudden }, i) => {
    if (i % 29 === 0) pool.push({ c, sudden })
  })
  for (const { c, sudden } of pool.slice(0, 220)) {
    for (const v of variants(c)) {
      if (v.parts === undefined || v.index === null) continue
      n++
      const personal = sudden === null ? null : { crowd: 1, loud: 1, sudden }
      const html = flat(L.createElement(L.WhyIndex, { cell: v, label: `${v.hour}시`, noiseDays: 33, personal, visits: 0, bare: true }))
      const tag = `F6 ${v.time} sudden=${sudden}`
      const kind = v.forecast ? '예측' : '관측'
      if (!html.includes(L.SIREN_WHY)) bad(`${tag}: 사이렌 줄이 없음`)
      if (!html.includes('class="why-words"')) bad(`${tag}: ul.why-words가 없음`)
      // 결정 41: 첫 막대는 정렬 키와 같은 값이고 '혼잡 점수' 한 이름으로 부른다
      if (!/<ol class="why-rows"><li[^>]*><span class="why-l">혼잡 점수<\/span>/.test(html)) bad(`${tag}: 첫 막대 이름이 '혼잡 점수'가 아님`)
      if (v.crowdLevel) {
        const eyo = { 여유: '예요', 보통: '이에요', '약간 붐빔': '이에요', 붐빔: '이에요' }[v.crowdLevel]
        if (!html.includes(`서울시 혼잡도 ${kind}은 '${v.crowdLevel}'${eyo}.`)) bad(`${tag}: 혼잡 문장이 없음`)
      } else if (!html.includes('서울시 혼잡도 자료를 찾지 못했어요.')) bad(`${tag}: 혼잡도 없음 문장이 없음`)
      // 서울시 혼잡 4단계를 가리키는 곳은 '단계'라고 부르지 않는다(단계는 무던함, 보통, 붐빔 구분에만 쓴다)
      if (/혼잡 단계|' 단계예요/.test(html)) bad(`${tag}: 서울시 혼잡도를 '단계'로 부름`)
      // 사라져야 하는 옛 문장
      for (const old of ['단계이고,', '평소 이 시간 주변 소음은 평균', '소음의 큰 소리 가산에는', '단계예요.</p>']) if (html.includes(old)) bad(`${tag}: 옛 문장 "${old}"가 남아 있음`)
      if (count(html, '이 시간대는 주변 소음 자료가 없어서 혼잡만 반영했어요.') !== (v.nz ? 0 : 1)) bad(`${tag}: 소음 없음 문장 개수`)
      // 5번 줄은 맞춤을 켜고 sudden이 1이 아닐 때만
      const has5 = html.includes('사이렌·경적·알람 민감도(')
      if (has5 !== (sudden !== null && sudden !== 1)) bad(`${tag}: 5번 줄 조건 (있음 ${has5})`)
      if (has5) {
        if (!html.includes(`민감도(${sudden}배)는 사이렌이 날 가능성을 예측하는 값이 아니에요.`)) bad(`${tag}: 5번 줄 배수`)
        if (!html.includes(sudden > 1 ? '더 크게 반영하는 값이에요.' : '덜 반영하는 값이에요.')) bad(`${tag}: 5번 줄 방향어`)
        const gap = v.nz && v.nz.max !== null ? Math.round((v.nz.max - v.nz.avg) * 10) / 10 : null
        const none = v.soundN === 0 && (gap === null || gap <= 3) // 가산이 0점(최대 소음 자료가 없거나 차이가 3dB 이하)이고 이 기기에서 잰 소리도 없는 칸
        if (html.includes('이 시간대는 반영할 값이 없어서 지수는 그대로예요.') !== none) bad(`${tag}: 지수는 그대로예요 조건 (soundN ${v.soundN}, 차이 ${gap})`)
      } else if (html.includes('지수는 그대로예요')) bad(`${tag}: 5번 줄이 없는데 지수는 그대로예요`)
      // 시트 머리 칩의 뜻(범례)은 맞춤을 켠 채 이 장소의 기록 보정이 0이 아닐 때만 근거 문단에 붙는다
      if (personal !== null && v.parts.offset !== 0) legendN++
      if (html.includes(L.RECORD_LEGEND) !== (personal !== null && v.parts.offset !== 0)) bad(`${tag}: 기록 범례 조건 (offset ${v.parts.offset})`)
      // 최대 소음 자료가 없는 소음 칸
      if (v.nz && v.nz.max === null && !html.includes('소리가 갑자기 커지는 정도는 이 시간대 자료가 없어서 알 수 없어요.')) bad(`${tag}: max 없음 문장이 없음`)
      if (!v.nz && html.includes('소리가 갑자기 커지는 정도는')) bad(`${tag}: 소음 없는 칸에 갑자기 커지는 정도 줄이 있음`)
      // 막대 줄 아래의 근거 문단에는 옛 문장 네 개가 없고 남은 문장만 있다
      if (v.parts.s !== null && !html.includes(`직접 잰 소리 표본 ${v.soundN}개가 지수의 `)) bad(`${tag}: 직접 잰 소리 비중 문장이 없음`)
    }
  }
  console.log(`  WhyIndex ${n}건 렌더, 기록 범례가 붙어야 하는 칸 ${legendN}건`)
  if (legendN === 0) bad('F6 기록 범례 조건을 시험한 칸이 없음')
}

console.log('[R1] 기록 칩과 항목 문구')
{
  const eq = (name, got, want) => {
    if (got !== want) bad(`R1 ${name}: ${JSON.stringify(got)} (기대 ${JSON.stringify(want)})`)
  }
  eq('(0, 켬)', L.recordChip(0, true), null)
  eq('(-5, 켬)', L.recordChip(-5, true), '내 기록 반영 -5점')
  eq('(5, 켬)', L.recordChip(5, true), '내 기록 반영 +5점')
  eq('(20, 켬)', L.recordChip(20, true), '내 기록 반영 +20점(최대)')
  eq('(-20, 켬)', L.recordChip(-20, true), '내 기록 반영 -20점(최대)')
  eq('(5, 끔)', L.recordChip(5, false), null)
  // 실제 폭(width)을 받는 경우: 보정치와 같으면 그대로, 작으면 멈춘 점수를 밝히고 '(최대)'보다 앞선다
  eq('(-5, 켬, 폭 -5)', L.recordChip(-5, true, -5), '내 기록 반영 -5점')
  eq('(-20, 켬, 폭 -20)', L.recordChip(-20, true, -20), '내 기록 반영 -20점(최대)')
  eq('(-5, 켬, 폭 -3)', L.recordChip(-5, true, -3), '내 기록 반영 -3점(0점에서 멈춤)')
  eq('(-20, 켬, 폭 -12)', L.recordChip(-20, true, -12), '내 기록 반영 -12점(0점에서 멈춤)')
  eq('(-20, 켬, 폭 0)', L.recordChip(-20, true, 0), '내 기록 반영 0점(0점에서 멈춤)')
  eq('(10, 켬, 폭 4)', L.recordChip(10, true, 4), '내 기록 반영 +4점(100점에서 멈춤)')
  eq('(20, 켬, 폭 0)', L.recordChip(20, true, 0), '내 기록 반영 0점(100점에서 멈춤)')
  eq('(5, 끔, 폭 0)', L.recordChip(5, false, 0), null)
  eq('(0, 켬, 폭 0)', L.recordChip(0, true, 0), null)
  eq('recordWidth 칸 없음', L.recordWidth(undefined, []), undefined)
  eq('recordWidth 비교 칸 없음', L.recordWidth({ time: 'a', index: 3 }, undefined), undefined)
  eq('recordWidth 지수 없음', L.recordWidth({ time: 'a', index: null }, [{ time: 'a', index: 3 }]), undefined)
  eq('recordWidth', L.recordWidth({ time: 'a', index: 0 }, [{ time: 'b', index: 9 }, { time: 'a', index: 4 }]), -4)
  eq('entry 켬 괜찮았어요', L.entryText(true, -5, true), '괜찮았어요 · 이 기록으로 지수 -5점이 반영돼요')
  eq('entry 켬 힘들었어요', L.entryText(false, 5, true), '힘들었어요 · 이 기록으로 지수 +5점이 반영돼요')
  eq('entry 상한(같은 부호)', L.entryText(false, 20, true), '힘들었어요 · 이 장소의 지수 보정이 최대(±20점)에 닿아 있어요')
  eq('entry 상한(같은 부호, 괜찮았어요)', L.entryText(true, -20, true), '괜찮았어요 · 이 장소의 지수 보정이 최대(±20점)에 닿아 있어요')
  eq('entry 상한이지만 반대 부호', L.entryText(true, 20, true), '괜찮았어요 · 이 기록으로 지수 -5점이 반영돼요')
  eq('entry 상한이고 이미 말한 장소', L.entryText(false, 20, true, false), '힘들었어요')
  eq('entry 끔 힘들었어요', L.entryText(false, 5, false), '힘들었어요')
  eq('entry 끔 괜찮았어요', L.entryText(true, -5, false), '괜찮았어요')
  eq('unappliedText', L.unappliedText(3), '맞춤 지수가 꺼져 있어서, 기록이 있는 장소(서울 전체 3곳)의 지수 보정은 반영되지 않았어요. 켜면 반영돼요.')
  // 최근 기록 목록: 상한 문장은 장소마다 가장 최근 항목 하나에만, 끔 문장은 목록 위에 한 번만
  const sixEntries = [
    { place: '군자역', ok: true }, { place: '건대입구역', ok: false }, { place: '건대입구역', ok: false },
    { place: '건대입구역', ok: false }, { place: '건대입구역', ok: false }, { place: '서울역', ok: true },
  ]
  const offs = { 서울역: -5, 건대입구역: 20, 군자역: -20 }
  const on = L.entryTexts(sixEntries, offs, true)
  const caps = on.filter((t) => t.includes('최대(±20점)'))
  eq('entryTexts 켬: 상한 문장 수(장소 둘)', caps.length, 2)
  eq('entryTexts 켬: 군자역 최신 항목', on[0], '괜찮았어요 · 이 장소의 지수 보정이 최대(±20점)에 닿아 있어요')
  eq('entryTexts 켬: 건대입구역 최신 항목', on[1], '힘들었어요 · 이 장소의 지수 보정이 최대(±20점)에 닿아 있어요')
  eq('entryTexts 켬: 건대입구역 나머지', on.slice(2, 5).join('|'), '힘들었어요|힘들었어요|힘들었어요')
  eq('entryTexts 켬: 상한이 아닌 장소', on[5], '괜찮았어요 · 이 기록으로 지수 -5점이 반영돼요')
  eq('entryTexts 끔: 모두 기록 종류만', L.entryTexts(sixEntries, offs, false).join('|'), '괜찮았어요|힘들었어요|힘들었어요|힘들었어요|힘들었어요|괜찮았어요')
  eq('entryTexts 켬: 반대 부호는 상한 문장 없이 숫자', L.entryTexts([{ place: '건대입구역', ok: true }, { place: '건대입구역', ok: false }], offs, true).join('|'), '괜찮았어요 · 이 기록으로 지수 -5점이 반영돼요|힘들었어요 · 이 장소의 지수 보정이 최대(±20점)에 닿아 있어요')
  eq('RECORD_OFF_LIST', L.RECORD_OFF_LIST, '맞춤 지수가 꺼져 있어서 이 기록들은 지수에 반영되지 않았어요. 켜면 괜찮았어요는 -5점, 힘들었어요는 +5점이 반영돼요.')
  eq('RECORD_OFF_TEXT', L.RECORD_OFF_TEXT, '다녀온 기록이 있지만 맞춤 지수가 꺼져 있어서 지수에 반영하지 않았어요. 켜면 반영돼요.')
  eq('RECORD_LEGEND', L.RECORD_LEGEND, '내 기록 반영은 장소마다 쌓인 기록 보정이 이 시각의 지수를 실제로 바꾼 점수예요. 지수는 0점과 100점에서 멈추기 때문에, 멈춘 시각에는 쌓인 보정보다 적게 바뀌어요.')
  eq('RECORD_TAG_LIST', L.RECORD_TAG_LIST, '힘들었어요 기록은 그때 잰 소리의 민감도도 한 단계 올렸을 수 있어요.')
}

console.log('[R2] 값의 일치')
{
  const place = '서울역'
  const ps = snap.places[place]
  if (!ps) bad(`R2 ${place}이 스냅샷에 없음`)
  else {
    const on = L.hourScores(ps, () => undefined, profOf(1), -5, nowKey, L.noiseLookup(noise, place))
    const off = L.hourScores(ps, () => undefined, null, -5, nowKey, L.noiseLookup(noise, place))
    if (on[0].parts.offset !== -5) bad(`R2 맞춤 켬 parts.offset ${on[0].parts.offset}`)
    if (!(L.recordChip(-5, true) ?? '').includes('-5점')) bad('R2 칩이 -5점을 말하지 않음')
    if (off[0].parts.offset !== 0) bad(`R2 맞춤 끔 parts.offset ${off[0].parts.offset}`)
    if (L.recordChip(-5, false) !== null) bad('R2 맞춤 끔인데 칩이 있음')
    console.log(`  ${place}: 켬 offset ${on[0].parts.offset}, 끔 offset ${off[0].parts.offset}`)
  }
}

console.log('[R5] 기록 칩의 폭')
{
  // 모든 장소와 칸에서, 칩이 말하는 폭이 기록을 더한 지수와 뺀 지수의 차이와 같다
  const prof = profOf(1)
  const signedStr = (v) => (v === 0 ? '0' : `${v > 0 ? '+' : '-'}${Math.abs(v)}`)
  let nCells = 0
  let full = 0
  let stopped = 0
  let zero = 0
  let capStop = 0
  for (const name of names) {
    const ps = snap.places[name]
    const look = L.noiseLookup(noise, name)
    const bare = L.hourScores(ps, () => undefined, prof, 0, nowKey, look)
    for (const o of [-20, -15, -10, -5, 5, 10, 15, 20]) {
      for (const c of L.hourScores(ps, () => undefined, prof, o, nowKey, look)) {
        if (c.index === null) continue
        nCells++
        const tag = `R5 ${name} ${c.time} o=${o}`
        const b = bare.find((x) => x.time === c.time)
        // 독립 계산: 기록을 뺀 지수를 parts에서 직접 구한다
        const p = c.parts
        const pre = Math.round(Math.max(0, Math.min(100, (1 - p.w) * p.base + p.w * (p.s ?? 0))))
        const width = c.index - pre
        if (b.index !== pre) bad(`${tag}: 기록을 뺀 지수 ${b.index} != ${pre}`)
        if (L.recordWidth(c, bare) !== width) bad(`${tag}: recordWidth ${L.recordWidth(c, bare)} != ${width}`)
        if (Math.sign(width) * Math.sign(o) < 0 || Math.abs(width) > Math.abs(o)) bad(`${tag}: 폭 ${width}이 보정치 범위를 벗어남`)
        const chip = L.recordChipAt(c, bare, o, true)
        textOk(tag + ' 칩', chip)
        if (width === o) {
          full++
          const want = `내 기록 반영 ${signedStr(o)}점${Math.abs(o) >= L.OFFSET_LIMIT ? '(최대)' : ''}`
          if (chip !== want) bad(`${tag}: 칩 ${chip} (기대 ${want})`)
        } else {
          stopped++
          if (width === 0) zero++
          if (Math.abs(o) >= L.OFFSET_LIMIT) capStop++
          if (c.index !== (o < 0 ? 0 : 100)) bad(`${tag}: 폭이 줄었는데 지수 ${c.index}가 0이나 100이 아님`)
          const want = `내 기록 반영 ${signedStr(width)}점(${o < 0 ? 0 : 100}점에서 멈춤)`
          if (chip !== want) bad(`${tag}: 칩 ${chip} (기대 ${want})`)
          if (chip.includes('(최대)')) bad(`${tag}: 멈춘 칸에 (최대)가 겹침 | ${chip}`)
        }
        // 맞춤을 끄면 칩이 없다
        if (L.recordChipAt(c, bare, o, false) !== null) bad(`${tag}: 맞춤 끔인데 칩이 있음`)
      }
    }
  }
  // 시험 범위(멈춘 칸이 있는지)는 자료에 달려 있으므로 고정 사본일 때만 판정한다
  if (isFixed && (full === 0 || stopped === 0 || zero === 0 || capStop === 0)) bad(`R5 시험한 경우가 모자람: 그대로 ${full}, 멈춤 ${stopped}, 폭 0 ${zero}, 한도에서 멈춤 ${capStop}`)
  // 지수가 없는 칸(칸이 없거나 index가 null)에서는 기록이 바꾼 폭이 없으므로, 보정치가 저장돼 있어도 칩이 없다
  for (const o of [-20, -5, 5, 20]) {
    if (L.recordChipAt(undefined, [], o, true) !== null) bad(`R5 칸이 없는데 칩이 있음 (o=${o})`)
    if (L.recordChipAt({ time: 'a', index: null }, [{ time: 'a', index: 3 }], o, true) !== null) bad(`R5 지수 없는 칸에 칩이 있음 (o=${o})`)
    if (L.recordChipAt({ time: 'a', index: null }, undefined, o, true) !== null) bad(`R5 지수 없고 비교 칸도 없는 칸에 칩이 있음 (o=${o})`)
  }
  // 고정 사본의 11시 건대입구역: 기록 없이 5점이라 -20점 보정이 0점에서 멈추고, 칩이 -20점(최대)이 아니라 실제 폭 -5점을 말한다
  if (isFixed) {
    const ps = snap.places['건대입구역']
    const look = L.noiseLookup(noise, '건대입구역')
    const on = L.hourScores(ps, () => undefined, prof, -20, nowKey, look)[0]
    const bare = L.hourScores(ps, () => undefined, prof, 0, nowKey, look)
    const chip = L.recordChipAt(on, bare, -20, true)
    if (bare[0].index !== 5 || on.index !== 0) bad(`R5 건대입구역 11시 지수 ${bare[0].index} -> ${on.index} (기대 5 -> 0)`)
    if (chip !== '내 기록 반영 -5점(0점에서 멈춤)') bad(`R5 건대입구역 0점 카드의 칩: ${chip}`)
    console.log(`  건대입구역 11시: 기록 없이 ${bare[0].index}점, -20점 보정 뒤 ${on.index}점, 칩 "${chip}"`)
  }
  // 추천 카드와 시트 머리가 같은 함수를 쓴다
  for (const f of ['src/components/Recommend.tsx', 'src/components/PlaceDetail.tsx']) {
    const src = readFileSync(path.join(root, f), 'utf-8')
    if (!src.includes('recordChipAt(')) bad(`R5 ${f}가 recordChipAt을 쓰지 않음`)
    if (/\brecordChip\(/.test(src)) bad(`R5 ${f}가 recordChip을 직접 부름`)
  }
  console.log(`  칸 ${nCells}개: 폭이 보정치와 같음 ${full}, 지수가 멈춰 줄어듦 ${stopped}(폭 0 ${zero}, 한도에서 멈춤 ${capStop})`)
}

console.log('[D4] 서울시 혼잡도 이름')
{
  // 1단계에서 새로 만든 파일의 문장에서 서울시 혼잡 4단계를 '단계'라고 부르지 않는다
  const re = /혼잡 단계|혼잡 예측 단계|혼잡 관측 단계|서울시 단계|' 단계예요/
  for (const f of ['src/lib/scoreWords.ts', 'src/lib/pickText.ts', 'src/lib/recordEffect.ts', 'src/components/WhyIndex.tsx', 'src/components/Recommend.tsx', 'src/components/RecConditions.tsx', 'src/components/RecCandidates.tsx']) {
    readFileSync(path.join(root, f), 'utf-8').split(/\r?\n/).forEach((line, i) => {
      if (re.test(line)) bad(`D4 ${f}:${i + 1}에서 서울시 혼잡도를 '단계'로 부름 | ${line.trim()}`)
    })
  }
  console.log('  새 파일 일곱 개에 서울시 혼잡도를 단계로 부른 문장이 없음')
}

// localStorage를 Map으로 흉내 낸다
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
  clear: () => store.clear(),
}

console.log('[R3] 상수 일치')
{
  const seq = []
  let prev = 0
  for (let i = 0; i < 7; i++) {
    const r = L.recordVisit('서울역', false, [])
    const o = r.offsets['서울역']
    seq.push(o)
    if (i < 4 && o - prev !== L.RECORD_STEP) bad(`R3 ${i + 1}번째 변화량 ${o - prev} (RECORD_STEP ${L.RECORD_STEP})`)
    prev = o
  }
  if (seq[4] !== L.OFFSET_LIMIT || seq[5] !== L.OFFSET_LIMIT || seq[6] !== L.OFFSET_LIMIT) bad(`R3 상한 ${seq.join(',')} (OFFSET_LIMIT ${L.OFFSET_LIMIT})`)
  store.clear()
  let low = 0
  for (let i = 0; i < 6; i++) low = L.recordVisit('서울역', true, []).offsets['서울역']
  if (low !== -L.OFFSET_LIMIT) bad(`R3 하한 ${low} (-OFFSET_LIMIT ${-L.OFFSET_LIMIT})`)
  console.log(`  힘들었어요 7번: ${seq.join(', ')} / 괜찮았어요 6번 뒤: ${low}`)
}

console.log('[R4] clearAll')
{
  store.set('calmmap.recAnchor.v1', JSON.stringify('서울역'))
  for (const k of ['calmmap.profile.v1', 'calmmap.offset.v1', 'calmmap.log.v1']) store.set(k, '{}')
  if (L.KEY_REC_ANCHOR !== 'calmmap.recAnchor.v1') bad(`R4 KEY_REC_ANCHOR ${L.KEY_REC_ANCHOR}`)
  L.clearAll()
  for (const k of ['calmmap.recAnchor.v1', 'calmmap.profile.v1', 'calmmap.offset.v1', 'calmmap.log.v1']) if (store.has(k)) bad(`R4 clearAll 뒤에 ${k}가 남음`)
  console.log('  clearAll 뒤에 기준 장소 키가 없음')
}

console.log('[G4] 문구 정합')
{
  const PHRASE = '소리 측정 요약'
  const NEW = '추천 탭에서 고른 기준 장소 이름'
  // 서버로 전달하는 항목을 말하는 줄은 기준 장소 이름이 전달되지 않으므로 새 낱말을 담지 않는다
  const EXEMPT = /서버로 전달됩니다/
  let seen = 0
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = path.join(dir, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(tsx?|md)$/.test(f)) {
        readFileSync(p, 'utf-8').split(/\r?\n/).forEach((line, i) => {
          if (!line.includes(PHRASE)) return
          seen++
          const where = `${path.relative(root, p)}:${i + 1}`
          if (EXEMPT.test(line)) console.log(`  예외(서버 전달 항목) ${where}`)
          else if (!line.includes(NEW)) bad(`G4 ${where}: "${PHRASE}"만 있고 "${NEW}"가 없음`)
        })
      }
    }
  }
  walk(path.join(root, 'src'))
  const readme = readFileSync(path.join(root, 'README.md'), 'utf-8')
  if (readme.includes(PHRASE) && !readme.includes(NEW)) bad('G4 README.md에 새 저장 항목이 없음')
  console.log(`  "${PHRASE}"가 나오는 줄 ${seen}개 확인`)
}

console.log(fail === 0 ? '\n모든 검사 통과' : `\n위반 ${fail}건`)
process.exit(fail === 0 ? 0 : 1)
