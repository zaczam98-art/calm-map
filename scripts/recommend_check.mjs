/**
 * 권고 문장·시간 선택 정합 시험. 모델과 외부 주소를 부르지 않고, 받아 둔 공개 스냅샷 파일로만 돈다.
 *
 * 실행(저장소 루트에서):
 *   node scripts/recommend_check.mjs <snapshot.json 경로, 기본 public/data/snapshot-demo.json>
 *
 * 확인하는 것
 *  1. 장소 시트(PlaceDetail)와 추천 목록(Recommend)이 같은 recommend(scores, nowKey)를 쓰는지(소스 검사)
 *  2. 장소 x 한국 시각(:06, :30, :59) x 맞춤 3가지 x 기록 보정 3가지에서
 *     - recommend의 text와 short가 말하는 시각이 같은지(괄호 안 범위 제외)
 *     - scores[0]의 시각이 현재 시(nowKey)와 같은지(다른 경우는 오프셋별로 집계)
 *     - scoreAt(scores, hour)가 시계열의 칸과 같고, 예측이 빠진 시각에서는 undefined이며 이웃 칸이 어긋나지 않는지
 *     - rec.from이 시계열에 있는 시각인지(카드가 맞출 칸이 존재하는지)
 *     - parts로 계산한 값이 index와 반올림 1 이내인지, 단계(level)가 index와 맞는지
 *  3. WhyIndex를 실제로 그려서 화면의 숫자(혼잡 값 + 각 단계의 증감 + 기록 보정)가 지수와 정확히 같은지
 */
import { readFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { build } from 'esbuild'

const root = process.cwd()
const snapPath = process.argv[2] || 'public/data/snapshot-demo.json'
const snap = JSON.parse(readFileSync(snapPath, 'utf-8').replace(/^﻿/, ''))

mkdirSync(path.join(root, '.tmp'), { recursive: true })
const out = path.join(root, '.tmp', 'recommend_check_bundle.cjs')
await build({
  stdin: {
    contents: `
      export * from './src/lib/index.ts'
      export { default as WhyIndex } from './src/components/WhyIndex.tsx'
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
})
const L = createRequire(import.meta.url)(out)

let fail = 0
const bad = (msg) => {
  fail++
  if (fail <= 25) console.log('  FAIL ' + msg)
}

// 1. 소스 검사
const src = (f) => readFileSync(path.join(root, f), 'utf-8')
const rec = src('src/components/Recommend.tsx')
const det = src('src/components/PlaceDetail.tsx')
console.log('[1] 같은 recommend() 사용')
console.log('  Recommend.tsx recommend(scores, nowKey) 호출:', /recommend\(scores, nowKey\)/.test(rec))
console.log('  PlaceDetail.tsx recommend(scores, nowKey) 호출:', /recommend\(scores, nowKey\)/.test(det))
console.log('  calmLine 잔재:', /calmLine/.test(rec + det) ? '있음' : '없음')
if (!/recommend\(scores, nowKey\)/.test(rec) || !/recommend\(scores, nowKey\)/.test(det)) bad('recommend 호출 형태가 다름')

// 시험 입력 만들기
const places = Object.keys(snap.places)
const withLive = places.find((p) => snap.places[p].live)
const base = (withLive ? snap.places[withLive].live.time : snap.places[places[0]].fcst[0].time).slice(0, 10)
const [by, bm, bd] = base.split('-').map(Number)
const liveHour = withLive ? Number(snap.places[withLive].live.time.slice(11, 13)) : Number(snap.places[places[0]].fcst[0].time.slice(11, 13))
const SEOUL = snap.source === 'seoul'

const nowKeys = []
if (SEOUL) {
  for (let dh = 0; dh <= 13; dh++) {
    for (const mm of [0, 6, 30, 59]) {
      const epoch = Date.UTC(by, bm - 1, bd, liveHour + dh, mm) - 9 * 3600 * 1000
      nowKeys.push({ dh, mm, key: L.nowKeyFor({ source: 'seoul' }, epoch) })
    }
  }
} else {
  nowKeys.push({ dh: 0, mm: 6, key: undefined })
}

const soundFn = (h, d) => (h % 5 === 0 ? { n: 3 + ((h + d) % 9), tags: { sudden: 0.35, crowd: 0.2, music: 0.1, ambient: 0.4 } } : h % 7 === 0 ? { n: 0, tags: {} } : undefined)
const noiseFn = (h, d) => (h % 4 === 0 ? undefined : { avg: 52 + ((h * 3 + d) % 22), max: 58 + ((h * 5 + d) % 20) })
const normal = { enabled: true, tags: { sudden: 1, crowd: 1, machine: 1, music: 1, speech: 1, ambient: 1 }, crowd: 1, loud: 1 }
const sens = { enabled: true, tags: { sudden: 1.5, crowd: 1, machine: 1, music: 1.5, speech: 1, ambient: 1 }, crowd: 1.5, loud: 1.5 }
const profiles = [null, normal, sens]
const offsets = [0, 7, -12]

const timesOf = (s) => (s.replace(/\([^)]*\)/g, '').match(/\d+시/g) ?? []).join(',')
const offsetStat = {} // dh -> [맞음, 전체]
let cells = 0
let rendered = 0
let partsMax = 0
const missing = []

for (const { dh, mm, key } of nowKeys) {
  for (const name of places) {
    const ps = snap.places[name]
    for (const prof of profiles) {
      for (const [oi, off] of offsets.entries()) {
        const scores = L.hourScores(ps, soundFn, prof, off, key, noiseFn)
        if (scores.length === 0) continue
        const r = L.recommend(scores, key)
        // 2-a. 목록 문장과 상세 문장이 같은 시각을 말한다
        if (timesOf(r.text) !== timesOf(r.short)) bad(`${name} ${key}: text/short 시각 불일치 | ${r.text} | ${r.short}`)
        // 2-b. 첫 칸이 현재 시
        const slot = (offsetStat[dh] ??= [0, 0])
        slot[1]++
        if (!key || scores[0].time.slice(0, 13) === key) slot[0]++
        else if (missing.length < 5) missing.push(`${name} 현재 ${key} 첫 칸 ${scores[0].time} forecast=${scores[0].forecast}`)
        // 2-c. scoreAt
        for (const c of scores) {
          if (L.scoreAt(scores, c.hour) !== c) bad(`${name} scoreAt(${c.hour}) 불일치`)
        }
        const present = new Set(scores.map((c) => c.hour))
        for (let h = 0; h < 24; h++) if (!present.has(h) && L.scoreAt(scores, h) !== undefined) bad(`${name} 없는 ${h}시가 undefined 아님`)
        // 2-d. 카드가 맞출 칸
        if (r.from !== null && L.scoreAt(scores, r.from) === undefined) bad(`${name} rec.from ${r.from}시 칸 없음`)
        // 2-e. parts와 level
        for (const c of scores) {
          cells++
          const p = c.parts
          if (!p) {
            bad(`${name} ${c.time} parts 없음`)
            continue
          }
          const exp = Math.max(0, Math.min(100, (1 - p.w) * p.base + p.w * (p.s ?? 0) + p.offset))
          partsMax = Math.max(partsMax, Math.abs(exp - c.index))
          if (Math.abs(exp - c.index) > 1) bad(`${name} ${c.time} parts 합 ${exp.toFixed(2)} vs index ${c.index}`)
          const expBase = p.n === null ? p.c : 0.6 * p.c + 0.4 * p.n
          if (Math.abs(expBase - p.base) > 1e-9) bad(`${name} ${c.time} base 불일치`)
          if (L.level3(c.index) !== c.level) bad(`${name} ${c.time} level 불일치`)
          if (!prof && p.offset !== 0) bad(`${name} 맞춤 꺼짐인데 offset ${p.offset}`)
          if (p.s === null && p.w !== 0) bad(`${name} 소리 없음인데 w ${p.w}`)
        }
        // 3. WhyIndex 화면 숫자 검산(렌더링이 느리므로 시각 :06, 보정은 시각마다 돌려 가며 한 가지씩)
        if (mm !== 6 || oi !== dh % offsets.length) continue
        const c = scores[(name.length + dh) % scores.length]
        const html = L.renderToStaticMarkup(
          L.createElement(L.WhyIndex, { cell: c, label: `${c.hour}시`, crowdLevel: '보통', noiseAvg: c.parts.n === null ? undefined : 60, personal: prof ? { crowd: prof.crowd, loud: prof.loud } : null }),
        )
        const lis = [...html.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((m) => m[1])
        const num = (s, re) => {
          const m = s.match(re)
          return m ? Number(m[1].replace('+', '')) : null
        }
        let run = num(lis[0], /why-v">(-?\d+)</)
        for (const li of lis.slice(1, -1)) {
          const label = li.match(/why-l">([^<]*)</)[1]
          if (label === '기록 보정') run += num(li, /why-v">([+-]?\d+)</)
          else {
            const v = num(li, /why-v">(-?\d+)</)
            const d = num(li, /why-d">([+-]?\d+)</)
            if (run + d !== v) bad(`${name} ${c.time} 화면 단계 ${label}: ${run} + ${d} != ${v}`)
            run = v
          }
        }
        const sum = num(lis.at(-1), /why-v">(\d+)점</)
        if (sum !== c.index || run !== c.index) bad(`${name} ${c.time} 화면 합 ${run} / 지수 ${sum} / 실제 ${c.index}`)
        if ((c.parts.s === null) === lis.some((l) => l.includes('소리를 더하면'))) bad(`${name} ${c.time} 소리 줄 표시가 표본 유무와 어긋남`)
        if (!prof === lis.some((l) => l.includes('기록 보정'))) bad(`${name} ${c.time} 기록 보정 줄이 맞춤 켜짐 여부와 어긋남`)
        rendered++
      }
    }
  }
}

// 2-f. 중간 시각이 빠진 장소: scoreAt이 빈 시각에서 undefined이고 이웃 칸이 어긋나지 않는다
let holes = 0
for (const name of places) {
  const ps = snap.places[name]
  if (ps.fcst.length < 6) continue
  const gone = new Set([ps.fcst[2].time, ps.fcst[3].time])
  const cut = { ...ps, fcst: ps.fcst.filter((f) => !gone.has(f.time)) }
  const sc = L.hourScores(cut, soundFn, null, 0, SEOUL ? nowKeys[0].key : undefined, noiseFn)
  for (const t of gone) {
    const h = Number(t.slice(11, 13))
    if (sc.some((c) => c.hour === h)) continue
    if (L.scoreAt(sc, h) !== undefined) bad(`${name} 빠진 ${h}시가 undefined 아님`)
  }
  for (const f of cut.fcst) {
    const c = L.scoreAt(sc, Number(f.time.slice(11, 13)))
    if (c && c.time.slice(0, 13) !== f.time.slice(0, 13) && !(c.obs || !c.forecast)) bad(`${name} ${f.time} 칸이 다른 시각 ${c.time}을 돌려줌`)
  }
  holes++
}

console.log(`[2] 시험한 장소 ${places.length}곳, 시각 ${nowKeys.length}가지, 칸 ${cells}개, parts 최대 오차 ${partsMax.toFixed(3)}`)
console.log('  현재 시 대비 첫 칸 일치(스냅샷 관측 시각 + dh시간):')
for (const [dh, [ok, all]] of Object.entries(offsetStat)) console.log(`    dh=${dh}: ${ok}/${all}${ok === all ? '' : '  <- 불일치 있음'}`)
if (missing.length) console.log('  불일치 예:', missing.join(' | '))
console.log(`[2-f] 예측이 빠진 장소 ${holes}곳에서 scoreAt 확인`)
console.log(`[3] WhyIndex 화면 산술 검산 ${rendered}건`)
console.log(fail === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${fail}건)`)
process.exit(fail === 0 ? 0 : 1)
