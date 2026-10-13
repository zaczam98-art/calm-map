/**
 * 무던한 곳 안내의 계산(src/lib/nearby.ts)과 화면 문구(src/lib/nearbyText.ts) 검증.
 * 모델과 외부 주소를 부르지 않고, 받아 둔 공개 스냅샷과 소음 파일로만 돈다.
 *
 * 실행(저장소 루트에서):
 *   node scripts/nearby_check.mjs <snapshot.json> <noise.json> [nowKey]
 *   고정 사본: node scripts/nearby_check.mjs scripts/fixtures/snapshot-2026-10-13T1106.json scripts/fixtures/noise-2026-10-13.json "2026-10-13 11"
 *
 * 맞춤 끔과 샘플 프로필(enabled, 혼잡 1.5, 큰 소리 1.5, 돌발음 1.5)에서 각각, 단계 우선 정렬(tierFirst) true와 false를 모두 돈다. 소리 측정은 없다.
 * 고정 사본이 아닌 파일로 돌리면 명세의 재현 수치(41곳, 53곳 등)는 판정하지 않고 값만 출력한다.
 *
 * 판정(위반이 하나라도 있으면 종료 코드 1)
 *  C1  불변식: 후보가 자기 자신이 아니고 6km 이하이며 같은 칸이 있고 더 낮은 단계이며 stale이 아니고 forecast가 같고 3곳 이하이며 정렬 규칙을 지킴
 *  C2  독립 재구현(전체 후보를 모아 정렬키로 정렬)과 calmerNearby 목록 비교
 *  C3  회귀: tierFirst=false, 선택 없음(scores[0])일 때 옛 calmerNearby 사본과 목록 비교
 *  C4  지속(calmRun): 따로 센 값과 비교, 합성 시계열, from.hour 22와 23
 *  C5  이유 분해(splitGap): 정수 항의 합 = gap, 소수 항의 합과 gap의 차이, clamped 판정
 *  C6  같은 곳 다른 시간(altCell): 있으면 calm이고 recommend의 from 칸과 같음
 *  C7  금지어: 모든 문구 상수와 문장 조립 함수의 조합을 FORBIDDEN, FORBIDDEN_PATTERNS, 엠대시와 엔대시, '추천'으로 검사
 *  C8  이웃 없음: 직선 3km 안에 다른 장소가 없는 곳
 *  C9  시각 연동 재현(19시 기준)
 *  C10 성능: 121곳 hourScores 전체 계산 시간
 *  C11 stale와 종류 불일치 제외
 *  C12 소음 상태(noiseState)
 * 기록(판정 없음): 후보 유무, 도착 오프셋별 분포, 3km 초과, 이웃 수, 정렬별 평균 거리, 지속 칸 수 분포
 */
import { readFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'
import { build } from 'esbuild'

const root = process.cwd()
const [snapPath, noisePath, nowKeyArg] = process.argv.slice(2)
if (!snapPath || !noisePath) {
  console.log('사용법: node scripts/nearby_check.mjs <snapshot.json> <noise.json> [nowKey 예: "2026-10-13 11"]')
  process.exit(1)
}
const nowKey = nowKeyArg || undefined
const readJson = (f) => JSON.parse(readFileSync(f, 'utf-8').replace(/^﻿/, ''))
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex')
const snap = readJson(snapPath)
const noise = readJson(noisePath)
const places = readJson(path.join(root, 'src/data/places.json')).filter((p) => p.tracked)

mkdirSync(path.join(root, '.tmp'), { recursive: true })
const out = path.join(root, '.tmp', 'nearby_check_bundle.cjs')
await build({
  stdin: {
    contents: `
      export * from './src/lib/index.ts'
      export * from './src/lib/nearby.ts'
      export * from './src/lib/nearbyText.ts'
      export { noiseLookup } from './src/lib/noise.ts'
      export { SENSE_TAGS } from './src/types.ts'
      export { FORBIDDEN, FORBIDDEN_PATTERNS } from './shared/cardRules.ts'
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

// 명세 5.1절이 적은 고정 사본(조사 단계의 2026-10-13 11시 사본)
const FIXTURE = {
  snapshot: '4e491530e0cac037b7c0be7403bb1869662127f7d8972d72f11023ec5d1c4b24',
  noise: '8758d25300118d845c1460e14eb3cef44353a4277d61f130d066f99cb0405d22',
  nowKey: '2026-10-13 11',
}
const isFixture = sha(snapPath) === FIXTURE.snapshot && sha(noisePath) === FIXTURE.noise && nowKey === FIXTURE.nowKey

let fail = 0
let sec = ''
const fails = {}
const bad = (msg) => {
  fail++
  fails[sec] = (fails[sec] ?? 0) + 1
  if (fail <= 40) console.log(`  FAIL [${sec}] ${msg}`)
}
const check = (cond, msg) => {
  if (!cond) bad(msg)
  return cond
}
const section = (name, title) => {
  sec = name
  console.log(`[${name}] ${title}`)
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const names = (items) => items.map((it) => it.place.name)
const t13 = (t) => t.slice(0, 13)
const pct = (a, b) => (b === 0 ? '-' : `${((a / b) * 100).toFixed(1)}%`)
/** 명세의 재현 수치와 비교한다. 고정 사본일 때만 판정하고, 아니면 값만 보인다. */
const expectEq = (label, actual, expected, judge = true) => {
  const ok = actual === expected
  console.log(`  ${label}: ${actual} (명세 ${expected}${ok ? ', 일치' : ', 다름'})`)
  if (isFixture && judge && !ok) bad(`${label} ${actual} != ${expected}`)
}

const RANK = { calm: 0, mid: 1, busy: 2 }
const midUp = (c) => !!c && c.index !== null && (c.level === 'mid' || c.level === 'busy')
const staleOf = (p) => snap.places[p.name]?.stale === true
const placeIdx = new Map(places.map((p, i) => [p.name, i]))
const staleSynth = (p) => placeIdx.get(p.name) % 7 === 0 // 합성: 17곳을 stale로 본다

const sampleProfile = { enabled: true, tags: Object.fromEntries(L.SENSE_TAGS.map((t) => [t, t === 'sudden' ? 1.5 : 1])), crowd: 1.5, loud: 1.5 }
const PROFILES = [
  ['맞춤 끔', null],
  ['샘플 프로필', sampleProfile],
]
const makeScores = (profile, offsets = {}, soundFor = () => () => undefined) =>
  new Map(places.map((p) => [p.name, L.hourScores(snap.places[p.name], soundFor(p.name), profile, offsets[p.name] ?? 0, nowKey, L.noiseLookup(noise, p.name))]))
const nearbyFor = (S, base, shown, tierFirst, stale = staleOf) =>
  L.calmerNearby(base, shown.level, places, (p) => L.candidateCell(S.get(p.name), shown, stale(p)), undefined, undefined, tierFirst)
const brief = (items) => items.map((it) => [it.place.name, it.km, it.index, it.level, it.cell.time])

// 옛 calmerNearby(HEAD 5095ae5)를 그대로 복사한 사본: 회귀 비교용
function legacyNearby(target, targetLevel, all, current, maxKm = 6, limit = 3) {
  const result = []
  for (const p of all) {
    if (p.name === target.name) continue
    const km = L.distanceKm(target, p)
    if (km > maxKm) continue
    const c = current(p)
    if (!c || c.index === null) continue
    if (RANK[c.level] < RANK[targetLevel]) result.push({ place: p, km, index: c.index, level: c.level })
  }
  return result.sort((a, b) => a.km - b.km).slice(0, limit)
}

// 따로 센 연속 무던함: 이어지는 칸을 모은 뒤 멈춘 까닭을 그 다음 칸으로 가른다
function runRef(series, i) {
  const from = series[i]
  const streak = [from]
  for (let j = i + 1; j < series.length; j++) {
    const prev = streak[streak.length - 1]
    const c = series[j]
    if (c.hour !== (prev.hour + 1) % 24 || c.level !== 'calm') break
    if (from.hour <= 21 && prev.hour === 21) break // 22시 칸부터는 자른다
    streak.push(c)
  }
  const last = streak[streak.length - 1]
  const nxt = series[i + streak.length]
  if (!nxt || nxt.hour !== (last.hour + 1) % 24) return { count: streak.length, stop: 'noForecast', endTime: last.time }
  if (nxt.level === 'calm') return { count: streak.length, stop: 'dayEnd', endTime: `${last.time.slice(0, 10)} 22:00` }
  return { count: streak.length, stop: 'nonCalm', endTime: nxt.time }
}

// 항별로 따로 계산한 기여(hourScores의 식을 parts에서 다시 쓴 것)
function rawOf(p) {
  return (1 - p.w) * p.base + p.w * (p.s ?? 0) + p.offset
}
function termsOf(p) {
  const nz = p.n === null ? 0 : 1
  return [(1 - p.w) * (1 - 0.4 * nz) * p.c, (1 - p.w) * 0.4 * (p.n ?? 0), p.w * (p.s ?? 0), p.offset]
}

console.log(`입력: ${snapPath} (${places.length}곳, 서울시 ${snap.updatedAt}), ${noisePath}, nowKey ${nowKey ?? '(없음)'}`)
console.log(`배포값: TIER_FIRST=${L.TIER_FIRST}, NEARBY_MAX_KM=${L.NEARBY_MAX_KM}, NEARBY_FAR_KM=${L.NEARBY_FAR_KM}, NEARBY_LIMIT=${L.NEARBY_LIMIT}`)
console.log(`고정 사본 여부: ${isFixture ? '예(재현 수치를 판정함)' : '아니오(재현 수치는 판정하지 않고 값만 출력)'}`)
for (const f of [snapPath, noisePath]) console.log(`  ${path.basename(f)} ${statSync(f).size}바이트 sha256 ${sha(f)}`)
const fixDir = path.join(root, 'scripts', 'fixtures')
if (existsSync(fixDir)) {
  for (const f of readdirSync(fixDir).sort()) console.log(`  scripts/fixtures/${f} ${statSync(path.join(fixDir, f)).size}바이트 sha256 ${sha(path.join(fixDir, f))}`)
}
check(places.length === L.PLACE_COUNT, `places.json의 tracked ${places.length}곳 != 문구의 PLACE_COUNT ${L.PLACE_COUNT}`)

const whyAll = [] // C7에서 검사할 이유 문장(실제 후보 전수)
const keepScores = {}

for (const [pname, profile] of PROFILES) {
  console.log(`\n===== ${pname} =====`)
  const S = makeScores(profile)
  keepScores[pname] = S
  const isOff = profile === null
  const cellsOf = (b) => S.get(b.name) ?? []
  const nowOf = (b) => cellsOf(b)[0]

  // C1 불변식, C2 독립 재구현
  section('C1', '불변식 + [C2] 독립 재구현')
  for (const [stName, stale] of [['원본 stale', staleOf], ['합성 stale 17곳', staleSynth]]) {
    for (const tierFirst of [false, true]) {
      let bases = 0
      let itemsN = 0
      let empty = 0
      for (const b of places) {
        for (const c of cellsOf(b)) {
          if (!midUp(c)) continue
          bases++
          const items = nearbyFor(S, b, c, tierFirst, stale)
          itemsN += items.length
          if (items.length === 0) empty++
          // C1
          check(items.length <= 3, `${b.name} ${c.time} 후보 ${items.length}곳`)
          items.forEach((it, k) => {
            const tag = `${b.name} ${c.time} -> ${it.place.name}`
            check(it.place.name !== b.name, `${tag} 자기 자신`)
            check(it.km <= 6 && Math.abs(it.km - L.distanceKm(b, it.place)) < 1e-12, `${tag} 거리 ${it.km}`)
            check(t13(it.cell.time) === t13(c.time) && S.get(it.place.name).includes(it.cell), `${tag} 같은 칸이 아님`)
            check(RANK[it.cell.level] < RANK[c.level], `${tag} 더 낮은 단계가 아님`)
            check(!stale(it.place), `${tag} stale`)
            check(it.cell.forecast === c.forecast, `${tag} forecast 불일치`)
            check(it.index === it.cell.index && it.level === it.cell.level, `${tag} index와 level이 cell과 다름`)
            if (k > 0) {
              const a = items[k - 1]
              const ok = tierFirst ? RANK[a.level] < RANK[it.level] || (a.level === it.level && a.km <= it.km) : a.km <= it.km
              check(ok, `${tag} 정렬 규칙 위반(tierFirst=${tierFirst})`)
            }
          })
          // C2
          sec = 'C2'
          const all = []
          for (const p of places) {
            if (p.name === b.name || stale(p)) continue
            const km = L.distanceKm(b, p)
            if (km > 6) continue
            const cell = (S.get(p.name) ?? []).find((x) => t13(x.time) === t13(c.time))
            if (!cell || cell.index === null || cell.forecast !== c.forecast || RANK[cell.level] >= RANK[c.level]) continue
            all.push({ p, km, cell })
          }
          const key = (x) => (tierFirst ? RANK[x.cell.level] * 1000 + x.km : x.km)
          const exp = all
            .map((x) => [key(x), x])
            .sort((a, b2) => a[0] - b2[0])
            .slice(0, 3)
            .map((e) => e[1])
          check(same(exp.map((x) => x.p.name), names(items)) && exp.every((x, k) => x.cell === items[k].cell && x.km === items[k].km), `${b.name} ${c.time} 독립 재구현과 다름(tierFirst=${tierFirst})`)
          if (tierFirst) {
            const hasCalmLeft = all.some((x) => x.cell.level === 'calm' && !items.some((it) => it.place.name === x.p.name))
            check(!(hasCalmLeft && items.some((it) => it.level === 'mid')), `${b.name} ${c.time} 무던함 후보가 밖에 있는데 보통 후보가 포함됨`)
          }
          if (stale === staleOf && tierFirst === L.TIER_FIRST) {
            const dflt = L.calmerNearby(b, c.level, places, (p) => L.candidateCell(S.get(p.name), c, stale(p)))
            check(same(brief(dflt), brief(items)), `${b.name} ${c.time} 기본 인자가 TIER_FIRST와 다름`)
          }
          // 이유 문장 수집(원본 stale, 두 정렬 모두)
          sec = 'C5'
          if (stale === staleOf) {
            for (const it of items) {
              const bs = L.noiseState(noise, b.name, c)
              const cs = L.noiseState(noise, it.place.name, it.cell)
              const lines = L.whyLines(it.place.name, c, it.cell, { baseNoise: bs, candNoise: cs })
              whyAll.push(...lines)
              // 소음 비대칭 문장은 noiseState 판정과 일치해야 한다
              const lacksCand = lines.filter((ln) => ln.startsWith(`${it.place.name}의 동네 소음은 `))
              const lacksBase = lines.filter((ln) => ln.startsWith('이곳의 동네 소음은 '))
              const expCand = bs === 'ok' && cs !== 'ok'
              const expBase = bs !== 'ok' && cs === 'ok'
              check(lacksCand.length === (expCand ? 1 : 0) && lacksBase.length === (expBase ? 1 : 0), `${b.name} -> ${it.place.name} 소음 비대칭 문장이 noiseState(${bs}, ${cs})와 다름`)
              // 장소 전체의 자료가 없는 경우와 이 시간대 값만 빈 경우를 가른다
              const lackState = expCand ? cs : expBase ? bs : null
              if (lackState) {
                const want = `${lackState === 'placeMissing' ? '자료가 없어서' : '이 시간대 값이 비어 있어서'} 반영되지 않았어요.`
                check((lacksCand[0] ?? lacksBase[0]).endsWith(want), `${b.name} -> ${it.place.name} 소음 문장이 ${lackState}와 다름`)
              }
              // 이유 문장 수치: 항목의 부호 있는 합 = gap
              check(lines[0] === `${it.place.name}의 지수는 ${it.cell.index}이고, 이곳(지수 ${c.index})보다 ${c.index - it.cell.index}점 낮아요.`, `${b.name} -> ${it.place.name} 첫 줄 ${lines[0]}`)
              const sp = L.splitGap(c, it.cell)
              let sum = 0
              for (const ln of lines.slice(1)) {
                const m = ln.match(/^(혼잡 예측|혼잡 관측|동네 소음|소리 측정|내 기록 보정) 쪽은 이곳보다 (\d+)점 (낮아요|높아요)\.$/)
                if (m) sum += (m[3] === '낮아요' ? 1 : -1) * Number(m[2])
                // 혼잡 항의 이름은 기준 칸이 예측이면 '혼잡 예측', 관측이면 '혼잡 관측'이다(후보 칸은 기준 칸과 종류가 같다)
                if (m && m[1].startsWith('혼잡')) check(m[1] === (c.forecast ? '혼잡 예측' : '혼잡 관측'), `${b.name} -> ${it.place.name} 혼잡 항의 이름 ${m[1]}이 기준 칸(forecast=${c.forecast})과 다름`)
              }
              check(sp.clamped || sum === c.index - it.cell.index, `${b.name} -> ${it.place.name} 이유 줄의 합 ${sum} != gap`)
              check(lines.includes('계산 범위(0~100) 끝에 닿아서 항목별로는 나누지 않았어요.') === sp.clamped, `${b.name} -> ${it.place.name} clamped 문장`)
            }
          }
          sec = 'C1'
        }
      }
      console.log(`  ${stName}, tierFirst=${tierFirst}: 기준 칸 ${bases}개, 후보 ${itemsN}건, 후보 없는 칸 ${empty}개`)
    }
  }

  // C3 회귀
  section('C3', '옛 calmerNearby와 회귀 비교(tierFirst=false, 선택 없음)')
  {
    let n = 0
    let diff = 0
    let screenDiff = 0
    for (const b of places) {
      const now = nowOf(b)
      if (!midUp(now)) continue
      n++
      const cur = (p) => S.get(p.name)?.[0]
      const old = legacyNearby(b, now.level, places, cur)
      const neu = L.calmerNearby(b, now.level, places, cur, undefined, undefined, false)
      if (!same(brief(old.map((o) => ({ ...o, cell: cur(o.place) }))), brief(neu))) {
        diff++
        bad(`${b.name} 옛 목록 ${names(old)} / 새 목록 ${names(neu)}`)
      }
      const viaScreen = nearbyFor(S, b, now, false)
      if (!same(names(old), names(viaScreen))) screenDiff++
    }
    console.log(`  기준이 보통 이상인 장소 ${n}곳 중 옛 목록과 다른 곳 ${diff}곳 (화면 경로 candidateCell 적용 시 다른 곳 ${screenDiff}곳, 기록)`)
    if (isOff) expectEq('보통 이상 장소 수', n, 41)
    // 거리순이면 후보 3곳이 차는 대로 멈추므로 current를 6km 안 장소 수보다 적게 부르고, 단계 우선이면 6km 안을 모두 부른다
    let callsDist = 0
    let callsTier = 0
    let inRange = 0
    let fewer = 0
    for (const b of places) {
      const now = nowOf(b)
      if (!midUp(now)) continue
      const within = places.filter((p) => p.name !== b.name && L.distanceKm(b, p) <= L.NEARBY_MAX_KM).length
      let cd = 0
      let ct = 0
      L.calmerNearby(b, now.level, places, (p) => (cd++, S.get(p.name)?.[0]), undefined, undefined, false)
      L.calmerNearby(b, now.level, places, (p) => (ct++, S.get(p.name)?.[0]), undefined, undefined, true)
      check(cd <= within && ct === within, `${b.name} current 호출 수: 거리순 ${cd}, 단계 우선 ${ct}, 6km 안 ${within}`)
      callsDist += cd
      callsTier += ct
      inRange += within
      if (cd < within) fewer++
    }
    console.log(`  current 호출 수: 6km 안 ${inRange}곳 합계에 거리순 ${callsDist}, 단계 우선 ${callsTier} (거리순이 덜 부른 장소 ${fewer}곳, 기록)`)
  }

  // C4 지속
  section('C4', '지속(calmRun)')
  {
    let cells = 0
    const byOffset = [0, 0, 0, 0]
    const stops = { nonCalm: 0, noForecast: 0, dayEnd: 0 }
    for (const b of places) {
      const series = cellsOf(b)
      series.forEach((c, i) => {
        if (c.level !== 'calm') return
        cells++
        if (i <= 3) byOffset[i]++
        const got = L.calmRun(series, c)
        const exp = runRef(series, i)
        stops[got.stop]++
        check(same(got, exp), `${b.name} ${c.time} calmRun ${JSON.stringify(got)} != ${JSON.stringify(exp)}`)
        check(got.count >= 1, `${b.name} ${c.time} count < 1`)
      })
    }
    console.log(`  무던한 칸 ${cells}개 전수 일치 검사(도착 오프셋 0~3의 무던한 칸 ${byOffset.join(', ')}곳), 멈춤 사유 ${JSON.stringify(stops)}`)
  }

  // C6 같은 곳 다른 시간
  section('C6', '같은 곳 다른 시간(altCell)')
  {
    let combos = 0
    let withAlt = 0
    let none = 0
    let noneNight = 0
    let none0 = 0
    let none0Night = 0
    let base0 = 0
    for (const b of places) {
      const series = cellsOf(b)
      if (series.length === 0) continue
      const rec = L.recommend(series, nowKey)
      const rc = rec.from === null ? undefined : series.find((s) => s.hour === rec.from)
      const night = series.some((s) => s.level === 'calm' && s.hour > L.DAY_TO)
      ;[null, ...series].forEach((sel, k) => {
        const shown = sel ?? series[0]
        if (!midUp(shown)) return
        combos++
        if (sel === null) base0++
        const alt = L.altCell(series, rec.from, shown)
        if (alt) {
          withAlt++
          check(alt.level === 'calm' && alt === rc && t13(alt.time) !== t13(shown.time), `${b.name} ${k}번째 선택 alt가 calm이 아니거나 rec.from 칸과 다름`)
        } else {
          none++
          if (night) noneNight++
          if (sel === null) {
            none0++
            if (night) none0Night++
          }
          check(rec.from === null || !rc || rc.level !== 'calm' || t13(rc.time) === t13(shown.time), `${b.name} ${k}번째 선택 alt가 있어야 하는데 없음`)
        }
      })
    }
    console.log(`  기준이 보통 이상인 (장소, 시각 선택) ${combos}건: alt 있음 ${withAlt}건, altNone ${none}건 중 22시 이후에 무던한 칸이 있는 조합 ${noneNight}건`)
    console.log(`  선택 없음만: 기준 ${base0}곳 중 altNone ${none0}곳, 그중 22시 이후 무던한 칸이 있는 곳 ${none0Night}곳 (조사 단계 15곳)`)
    check(L.TXT.altNone.includes(`${L.DAY_FROM}~${L.DAY_TO}시`), 'altNone 문구에 외출 시간 범위가 없음')
  }

  // C9 시각 연동 재현
  section('C9', '시각 연동 재현(19시 기준)')
  {
    const at19 = (b) => cellsOf(b).find((c) => c.hour === 19)
    for (const tierFirst of [false, true]) {
      let calmNow = 0
      let calmNowNot19 = 0
      let withCand = 0
      let midNow = 0
      let midBoth = 0
      let sameList = 0
      for (const b of places) {
        const now = nowOf(b)
        const c19 = at19(b)
        if (!now || !c19 || c19.index === null) continue
        if (now.level === 'calm') {
          calmNow++
          if (c19.level !== 'calm') {
            calmNowNot19++
            if (nearbyFor(S, b, c19, tierFirst).length > 0) withCand++
          }
        } else if (midUp(now)) {
          midNow++
          if (midUp(c19)) {
            midBoth++
            if (same(names(nearbyFor(S, b, c19, tierFirst)), names(nearbyFor(S, b, now, tierFirst)))) sameList++
          }
        }
      }
      console.log(`  tierFirst=${tierFirst}: 지금 무던한 ${calmNow}곳 중 19시에 무던하지 않은 ${calmNowNot19}곳, 그중 후보가 있는 ${withCand}곳 / 지금 보통 이상 ${midNow}곳 중 19시에도 보통 이상 ${midBoth}곳, 그중 목록이 지금과 같은 ${sameList}곳`)
      if (isOff) {
        expectEq('지금 무던한 곳 수', calmNow, 80)
        expectEq('19시에 무던하지 않은 곳', calmNowNot19, 53)
        expectEq('그중 후보가 있는 곳(정렬과 무관)', withCand, 50)
        expectEq('지금 보통 이상 중 19시에도 보통 이상', midBoth, 33)
        if (tierFirst) console.log(`  그중 목록이 지금과 같은 곳: ${sameList} (명세의 5는 거리순 기준이라 비교하지 않음)`)
        else expectEq('그중 목록이 지금과 같은 곳', sameList, 5)
      }
      const sd = places.find((p) => p.name === '서대문독립공원')
      const c = sd && at19(sd)
      if (c) {
        const l = nearbyFor(S, sd, c, tierFirst)
        const full = names(L.calmerNearby(sd, c.level, places, (p) => L.candidateCell(S.get(p.name), c, false), undefined, 200, tierFirst))
        console.log(`  서대문독립공원 19시 ${c.index}점(${c.level}), tierFirst=${tierFirst}: ${l.map((it) => `${it.place.name}(${it.index})`).join(', ')}`)
        check(!full.includes('홍제폭포') && full.includes('서촌'), '서대문독립공원 19시 후보에 홍제폭포가 있거나 서촌이 없음')
        if (isFixture && isOff && !tierFirst) check(same(names(l), ['서촌', '덕수궁길·정동길', '충정로역']), `서대문독립공원 19시 후보 ${names(l)}`)
      }
    }
  }

  // 기록
  section('기록', '판정 없는 기록')
  {
    const bases = places.filter((b) => midUp(nowOf(b)))
    const listNow = (b, tierFirst) => nearbyFor(S, b, nowOf(b), tierFirst)
    const withCand = bases.filter((b) => listNow(b, false).length > 0).length
    console.log(`  후보 있는 비율(선택 없음): ${withCand}/${bases.length} = ${pct(withCand, bases.length)}`)
    let legacyItems = 0
    let firstDiff = 0
    let far14 = 0
    let farAny = 0
    for (const b of bases) {
      for (const it of legacyNearby(b, nowOf(b).level, places, (p) => S.get(p.name)?.[0])) {
        legacyItems++
        if (t13(S.get(it.place.name)[0].time) !== t13(nowOf(b).time)) firstDiff++
        if (it.km > L.NEARBY_FAR_KM) far14++
      }
      farAny += listNow(b, false).filter((it) => it.km > L.NEARBY_FAR_KM).length
    }
    console.log(`  옛 방식(scores[0]) 후보 ${legacyItems}건 중 후보 첫 칸 시각이 기준 첫 칸과 다른 쌍 ${firstDiff}건`)
    if (isOff) expectEq('옛 방식 3km 초과 후보', far14, 14, false)
    else console.log(`  옛 방식 3km 초과 후보 ${far14}건`)
    console.log(`  새 방식(선택 없음, tierFirst=false) 3km 초과 후보 ${farAny}건`)
    // 도착 오프셋 0~3
    for (let a = 0; a <= 3; a++) {
      const bs = places.filter((b) => midUp(cellsOf(b)[a]))
      const has = bs.filter((b) => nearbyFor(S, b, cellsOf(b)[a], false).length > 0).length
      const dist = { 1: 0, 2: 0, '3+': 0 }
      let calmN = 0
      for (const b of bs) {
        for (const it of nearbyFor(S, b, cellsOf(b)[a], false)) {
          if (it.level !== 'calm') continue
          calmN++
          const r = L.calmRun(S.get(it.place.name), it.cell).count
          dist[r >= 3 ? '3+' : r]++
        }
      }
      console.log(`  도착 오프셋 ${a}: 기준 ${bs.length}곳 중 후보 있는 ${has}곳, 무던한 후보 ${calmN}건의 지속 칸 수 1칸 ${dist[1]} / 2칸 ${dist[2]} / 3칸 이상 ${dist['3+']}`)
    }
    // 후보 칸이 예측인 비율
    let candN = 0
    let candFc = 0
    for (const b of bases) {
      for (const it of listNow(b, false)) {
        candN++
        if (it.cell.forecast) candFc++
      }
    }
    console.log(`  후보 칸이 예측인 비율(선택 없음): ${candFc}/${candN} = ${pct(candFc, candN)}`)
    // 정렬별 평균 거리
    for (const tierFirst of [false, true]) {
      const kms = bases.flatMap((b) => listNow(b, tierFirst).map((it) => it.km))
      const mean = kms.reduce((a, v) => a + v, 0) / (kms.length || 1)
      const far = kms.filter((k) => k > L.NEARBY_FAR_KM).length
      console.log(`  ${tierFirst ? '단계 우선' : '거리순'} 정렬: 후보 ${kms.length}건, 평균 후보 거리 ${mean.toFixed(2)}km, 3km 초과 ${far}건(${pct(far, kms.length)})`)
    }
    // 지속 칸 수 분포(항목 3)
    const runs = []
    for (const b of bases) for (const it of listNow(b, false)) if (it.level === 'calm') runs.push(L.calmRun(S.get(it.place.name), it.cell))
    const total = bases.reduce((a, b) => a + listNow(b, false).length, 0)
    const c1 = runs.filter((r) => r.count === 1).length
    const c2 = runs.filter((r) => r.count <= 2).length
    const c3 = runs.filter((r) => r.count >= 3).length
    const stops = { nonCalm: 0, noForecast: 0, dayEnd: 0 }
    for (const r of runs) stops[r.stop]++
    console.log(`  후보 ${total}건 중 지금 무던한 ${runs.length}건의 지속 칸 수: 1칸 ${c1}, 2칸 이하 ${c2}, 3칸 이상 ${c3}, 멈춤 사유 ${JSON.stringify(stops)}`)
    if (isOff) {
      expectEq('후보 수', total, 123, false)
      expectEq('무던한 후보 수', runs.length, 113, false)
      expectEq('1칸', c1, 71, false)
      expectEq('2칸 이하', c2, 74, false)
      expectEq('3칸 이상', c3, 39, false)
    }
  }
}

// 이웃 수 기록
section('기록', '직선 1km, 2km 안 다른 장소 수')
{
  const median = (a) => {
    const v = a.slice().sort((x, y) => x - y)
    const m = v.length >> 1
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
  }
  for (const km of [1, 2]) {
    const cnt = places.map((p) => places.filter((q) => q.name !== p.name && L.distanceKm(p, q) <= km).length)
    console.log(`  ${km}km 안: 다른 장소가 0곳인 장소 ${cnt.filter((v) => v === 0).length}곳, 중앙값 ${median(cnt)}곳`)
  }
  console.log('  (명세: 1km 0곳인 장소 50, 2km 0곳인 장소 10, 2km 중앙값 4)')
}

// C4 합성 시계열
section('C4', '합성 시계열과 from.hour 22, 23')
{
  const D1 = '2026-10-13'
  const D2 = '2026-10-14'
  const mk = (date, h, level = 'calm') => ({ time: `${date} ${String(h).padStart(2, '0')}:00`, hour: h, index: level === 'calm' ? 20 : level === 'mid' ? 50 : 80, level, soundN: 0, forecast: true, noise: false })
  const calmRange = (date, a, b) => Array.from({ length: b - a + 1 }, (_, k) => mk(date, a + k))
  const cases = [
    ['중간 결측', [mk(D1, 10), mk(D1, 11), mk(D1, 13), mk(D1, 14)], 0, { count: 2, stop: 'noForecast', endTime: `${D1} 11:00` }],
    ['마지막 칸까지(20시)', calmRange(D1, 18, 20), 0, { count: 3, stop: 'noForecast', endTime: `${D1} 20:00` }],
    ['마지막 칸 하나', calmRange(D1, 20, 20), 0, { count: 1, stop: 'noForecast', endTime: `${D1} 20:00` }],
    ['21시가 마지막 칸', calmRange(D1, 20, 21), 0, { count: 2, stop: 'noForecast', endTime: `${D1} 21:00` }],
    ['21시에서 22시로 넘어감', calmRange(D1, 19, 23), 0, { count: 3, stop: 'dayEnd', endTime: `${D1} 22:00` }],
    ['21시에서 시작해 22시로', calmRange(D1, 21, 23), 0, { count: 1, stop: 'dayEnd', endTime: `${D1} 22:00` }],
    ['21시 다음이 보통', [mk(D1, 20), mk(D1, 21), mk(D1, 22, 'mid')], 0, { count: 2, stop: 'nonCalm', endTime: `${D1} 22:00` }],
    ['8시부터 22시까지', calmRange(D1, 8, 22), 0, { count: 14, stop: 'dayEnd', endTime: `${D1} 22:00` }],
    ['from 22시, 자정 넘어 보통', [...calmRange(D1, 22, 23), mk(D2, 0), mk(D2, 1), mk(D2, 2, 'mid')], 0, { count: 4, stop: 'nonCalm', endTime: `${D2} 02:00` }],
    ['from 22시, 자정 넘어 끝까지', [...calmRange(D1, 22, 23), mk(D2, 0), mk(D2, 1)], 0, { count: 4, stop: 'noForecast', endTime: `${D2} 01:00` }],
    ['from 23시', [mk(D1, 23), mk(D2, 0), mk(D2, 1, 'busy')], 0, { count: 2, stop: 'nonCalm', endTime: `${D2} 01:00` }],
    ['from 23시 하나', [mk(D1, 23)], 0, { count: 1, stop: 'noForecast', endTime: `${D1} 23:00` }],
    ['from 23시, 다음 칸이 하루 뒤 같은 시각 아님', [mk(D1, 23), mk(D2, 3)], 0, { count: 1, stop: 'noForecast', endTime: `${D1} 23:00` }],
  ]
  for (const [name, series, i, exp] of cases) {
    const got = L.calmRun(series, series[i])
    check(same(got, exp), `합성 '${name}': ${JSON.stringify(got)} != ${JSON.stringify(exp)}`)
    check(same(got, runRef(series, i)), `합성 '${name}': 따로 센 값과 다름`)
  }
  console.log(`  합성 ${cases.length}건 통과 여부 확인(중간 결측, 마지막 칸까지, 21시에서 22시로, from.hour 22와 23)`)
}

// C5 이유 분해
section('C5', '이유 분해(splitGap)')
{
  const offsets = Object.fromEntries(places.map((p, i) => [p.name, ((i * 7) % 41) - 20])) // 임의 정수 기록 보정(-20~20)
  const soundFor = (name) => {
    const i = placeIdx.get(name)
    return i % 3 === 0 ? () => undefined : (h, d) => (h % 5 === 0 ? { n: 3 + ((h + d + i) % 9), tags: { sudden: 0.35, crowd: 0.2, music: 0.1, ambient: 0.4 } } : undefined)
  }
  const combos = [
    ['맞춤 끔', null, {}, undefined],
    ['샘플 프로필', sampleProfile, {}, undefined],
    ['샘플 프로필 + 기록 보정', sampleProfile, offsets, undefined],
    ['샘플 프로필 + 기록 보정 + 가짜 소리(보조 조합)', sampleProfile, offsets, soundFor],
  ]
  for (const [cname, prof, offs, snd] of combos) {
    const S = makeScores(prof, offs, snd)
    let pairs = 0
    let clampedN = 0
    let negR = 0
    let negRaw = 0
    let maxDev = 0
    let maxSumGap = 0
    let hasSound = 0
    let soundSentenceOk = 0
    const byTime = new Map(places.map((p) => [p.name, new Map(S.get(p.name).map((c) => [t13(c.time), c]))]))
    for (const cells of S.values()) for (const c of cells) check(Math.round(Math.max(0, Math.min(100, rawOf(c.parts)))) === c.index, `${c.time} raw로 다시 계산한 지수가 index와 다름`)
    for (const b of places) {
      for (const bc of S.get(b.name)) {
        if (bc.index === null) continue
        for (const p of places) {
          if (p.name === b.name) continue
          const cc = byTime.get(p.name).get(t13(bc.time))
          if (!cc || cc.index === null) continue
          pairs++
          const sp = L.splitGap(bc, cc)
          const rb = rawOf(bc.parts)
          const rc = rawOf(cc.parts)
          const expClamped = rb < 0 || rb > 100 || rc < 0 || rc > 100
          const gap = bc.index - cc.index
          if (!check(sp.gap === gap, `${b.name} ${bc.time} -> ${p.name} gap ${sp.gap} != ${gap}`)) continue
          if (!check(sp.clamped === expClamped, `${b.name} ${bc.time} -> ${p.name} clamped ${sp.clamped} != ${expClamped}`)) continue
          if (expClamped) {
            clampedN++
            check(sp.parts.length === 0, `${b.name} ${bc.time} -> ${p.name} clamped인데 parts가 있음`)
            continue
          }
          const tb = termsOf(bc.parts)
          const tc = termsOf(cc.parts)
          const d = tb.map((v, i) => v - tc[i])
          const dsum = d.reduce((a, v) => a + v, 0)
          maxSumGap = Math.max(maxSumGap, Math.abs(dsum - gap))
          check(Math.abs(dsum - (rb - rc)) < 1e-9, `${b.name} ${bc.time} -> ${p.name} 항별 기여의 합이 raw 차이와 다름`)
          check(Math.abs(dsum - gap) <= 1 + 1e-9, `${b.name} ${bc.time} -> ${p.name} 소수 항 합 ${dsum}과 gap ${gap}의 차이가 1 초과`)
          check(sp.parts.reduce((a, q) => a + q.diff, 0) === gap, `${b.name} ${bc.time} -> ${p.name} 정수 항의 합이 gap과 다름`)
          const order = ['crowd', 'noise', 'sound', 'offset']
          check(sp.parts.every((q, k) => q.diff !== 0 && Number.isInteger(q.diff) && (k === 0 || order.indexOf(sp.parts[k - 1].key) < order.indexOf(q.key))), `${b.name} ${bc.time} -> ${p.name} parts 형식`)
          const rounded = d.map((v) => Math.round(v * 1e9) / 1e9)
          if (gap - rounded.reduce((a, v) => a + Math.floor(v), 0) < 0) negR++
          if (gap - d.reduce((a, v) => a + Math.floor(v), 0) < 0) negRaw++
          check(sp.parts.every((q) => rounded[order.indexOf(q.key)] !== 0), `${b.name} ${bc.time} -> ${p.name} 차이가 0인 항에 값이 붙음 ${JSON.stringify(sp.parts)}`)
          for (const q of sp.parts) maxDev = Math.max(maxDev, Math.abs(q.diff - rounded[order.indexOf(q.key)]))
          for (let k = 0; k < 4; k++) {
            if (!sp.parts.some((q) => q.key === order[k])) maxDev = Math.max(maxDev, Math.abs(rounded[k]))
          }
          const soundDiff = (bc.parts.w > 0) !== (cc.parts.w > 0)
          if (snd) {
            hasSound++
            const lines = L.whyLines(p.name, bc, cc, { baseNoise: 'ok', candNoise: 'ok' })
            if (lines.includes('소리 측정은 이 기기에서 잰 곳에만 반영돼요.') === soundDiff) soundSentenceOk++
          }
        }
      }
    }
    console.log(`  ${cname}: 쌍 ${pairs}건, clamped ${clampedN}건, r<0 분기 ${negR}건(1e-9 반올림 뒤)과 ${negRaw}건(반올림 전), 항별 정수와 소수의 최대 차이 ${maxDev.toFixed(3)}, 소수 합과 gap의 최대 차이 ${maxSumGap.toFixed(3)}${snd ? `, 소리 반영 문장 일치 ${soundSentenceOk}/${hasSound}` : ''}`)
    check(maxDev <= 1 + 1e-9, `${cname} 항별 정수와 소수의 차이가 1 초과`)
    if (isFixture && cname === '샘플 프로필') expectEq('샘플 프로필의 r<0 분기(반올림 전)', negRaw, 4, false)
    if (snd) check(soundSentenceOk === hasSound, `${cname} 소리 반영 문장이 w 판정과 다름`)
  }
}

// C8 이웃 없음
section('C8', '직선 3km 안에 다른 장소가 없는 곳')
{
  const iso = places.filter((p) => !L.hasNeighborWithin(p, places, 3)).map((p) => p.name)
  console.log(`  ${iso.length}곳: ${iso.join(', ')}`)
  if (isFixture) check(same(iso.slice().sort(), ['서울대공원', '연신내역', '청계산']), `이웃 없는 곳 ${iso}`)
  check(places.every((p) => L.hasNeighborWithin(p, places) === L.hasNeighborWithin(p, places, 3)), '기본 인자가 3km와 다름')
}

// C10 성능
section('C10', '성능: 121곳 hourScores 전체 계산')
{
  const run = () => {
    for (const p of places) L.hourScores(snap.places[p.name], () => undefined, sampleProfile, 0, nowKey, L.noiseLookup(noise, p.name))
  }
  for (let i = 0; i < 10; i++) run()
  const t0 = performance.now()
  for (let i = 0; i < 50; i++) run()
  const ms = (performance.now() - t0) / 50
  console.log(`  ${ms.toFixed(2)}ms (50회 평균, 기준 10ms 이하)`)
  check(ms <= 10, `121곳 계산 ${ms.toFixed(2)}ms > 10ms`)
}

// C11 stale, 종류 불일치
section('C11', 'stale와 종류 불일치 제외')
{
  const S = keepScores['맞춤 끔']
  const staleN = Object.values(snap.places).filter((p) => p.stale).length
  let staleEx = 0
  let kindEx = 0
  let inRange = 0
  for (const b of places) {
    const now = S.get(b.name)[0]
    if (!midUp(now)) continue
    for (const p of places) {
      if (p.name === b.name || L.distanceKm(b, p) > 6) continue
      const cell = L.cellAtSameTime(S.get(p.name), now.time)
      if (!cell || cell.index === null || RANK[cell.level] >= RANK[now.level]) continue
      inRange++
      if (staleOf(p)) staleEx++
      else if (cell.forecast !== now.forecast) kindEx++
    }
  }
  console.log(`  원본: stale 장소 ${staleN}곳, 기준이 보통 이상인 41곳 주변의 더 낮은 단계 후보 ${inRange}건 중 stale 제외 ${staleEx}건, 관측·예측 종류 불일치 제외 ${kindEx}건 (기록)`)
  if (isFixture) {
    check(staleN === 0, `원본에 stale 장소 ${staleN}곳`)
    check(staleEx === 0, `원본에서 stale로 제외된 후보 ${staleEx}건`)
  }
  const b = places.find((x) => midUp(S.get(x.name)[0]) && nearbyFor(S, x, S.get(x.name)[0], false).length === 3)
  if (!b) {
    bad('후보가 3곳인 기준 장소가 없어 합성 사례를 만들지 못함')
  } else {
    const shown = S.get(b.name)[0]
    const items = nearbyFor(S, b, shown, false)
    const v = items[0]
    // stale
    const copy = structuredClone(snap)
    copy.places[v.place.name].stale = true
    const l2 = nearbyFor(S, b, shown, false, (p) => copy.places[p.name]?.stale === true)
    check(!names(l2).includes(v.place.name), 'stale로 만든 후보가 목록에 남음')
    check(same(names(l2).filter((n) => names(items).includes(n)), names(items).slice(1)), 'stale 제외 뒤 나머지 후보 순서가 바뀜')
    check(L.candidateCell(S.get(v.place.name), shown, true) === undefined, 'stale인데 candidateCell이 칸을 돌려줌')
    check(L.candidateCell(S.get(v.place.name), shown, false) === v.cell, 'stale가 아닌데 candidateCell이 칸을 돌려주지 않음')
    // 관측·예측 종류 불일치
    const flipped = S.get(v.place.name).map((c) => (c === v.cell ? { ...c, forecast: !c.forecast } : c))
    const S2 = new Map(S)
    S2.set(v.place.name, flipped)
    check(L.candidateCell(flipped, shown, false) === undefined, 'forecast가 뒤집힌 칸을 후보로 돌려줌')
    check(!names(nearbyFor(S2, b, shown, false)).includes(v.place.name), 'forecast가 뒤집힌 후보가 목록에 남음')
    // 지수 없음, 같은 시각 칸 없음, 시계열 없음
    check(L.candidateCell(S.get(v.place.name).map((c) => ({ ...c, index: null, level: 'nodata' })), shown, false) === undefined, '지수 없는 칸을 후보로 돌려줌')
    check(L.candidateCell(S.get(v.place.name).filter((c) => t13(c.time) !== t13(shown.time)), shown, false) === undefined, '같은 시각 칸이 없는데 후보로 돌려줌')
    check(L.candidateCell(undefined, shown, false) === undefined, '시계열이 없는데 후보로 돌려줌')
    // 기준이 선택한 시각이면 같은 시각의 후보 칸을 읽는다(scores[0]이 아니다)
    const c19 = S.get(b.name).find((c) => c.hour === 19)
    if (c19 && midUp(c19)) {
      for (const it of nearbyFor(S, b, c19, false)) check(it.cell.hour === 19, `19시 기준인데 후보 ${it.place.name}의 칸이 ${it.cell.hour}시`)
    }
    console.log(`  합성 사례 기준 ${b.name}, 제외한 후보 ${v.place.name}: stale, 종류 불일치, 지수 없음, 시각 없음, 시계열 없음 검사`)
  }
}

// C12 소음 상태
section('C12', '소음 상태(noiseState)')
{
  const S = keepScores['맞춤 끔']
  const indep = (name, cell) => {
    const [h0, h1] = noise.hours
    if (cell.hour < h0 || cell.hour > h1) return 'allMissing'
    const np = noise.places[name]
    if (!np) return 'placeMissing'
    const v = np.avg?.[String(L.dowOfTime(cell.time))]?.[cell.hour - h0]
    return v === null || v === undefined ? 'hourMissing' : 'ok'
  }
  const tally = {}
  let cellsN = 0
  for (const p of places) {
    for (const c of S.get(p.name)) {
      cellsN++
      const got = L.noiseState(noise, p.name, c)
      check(got === indep(p.name, c), `${p.name} ${c.time} noiseState ${got} != ${indep(p.name, c)}`)
      check(L.noiseState(null, p.name, c) === 'allMissing', `${p.name} ${c.time} noise 파일 없음인데 allMissing이 아님`)
      const h = c.hour
      tally[h] = tally[h] ?? { ok: 0, placeMissing: 0, hourMissing: 0, allMissing: 0 }
      tally[h][got]++
    }
  }
  console.log(`  전수 ${cellsN}칸 일치 검사. 19시: ${JSON.stringify(tally[19])}, 23시: ${JSON.stringify(tally[23])}`)
  if (isFixture) {
    check(tally[19]?.placeMissing === 6 && tally[19]?.hourMissing === 4, `19시 placeMissing/hourMissing ${tally[19]?.placeMissing}/${tally[19]?.hourMissing}`)
    check(tally[23]?.allMissing === places.length, `23시 allMissing ${tally[23]?.allMissing}`)
  }
}

// C7 금지어
section('C7', '금지어와 문장 부호')
{
  const T = L.TXT
  const texts = new Set(Object.values(T))
  const add = (s) => texts.add(s)
  const days = ['2026-10-13', '2026-10-14']
  const stamps = []
  for (const d of days) for (let h = 0; h < 24; h++) stamps.push(`${d} ${String(h).padStart(2, '0')}:00`)
  const label = L.makeLabel(days[0])
  const labels = [...new Set(stamps.map(label))]
  for (const s of [...labels, '지금']) {
    add(L.altButton(s))
    add(L.selectedCalmText(s))
    for (const obs of [true, false]) {
      add(L.summaryAlt(s, obs))
      for (const count of [1, 3]) for (const stop of ['nonCalm', 'noForecast', 'dayEnd']) {
        const t = L.summaryAlt(s, obs, { count, stop, endTime: '2026-10-13 22:00' })
        add(t)
        // '한 시간'은 한 칸뿐이고 다음 칸이 무던하지 않을 때만 쓴다. 외출 시간 끝이나 예측 끝에서는 길이를 말하지 않는다.
        check(t.includes('한 시간') === (!obs && count === 1 && stop === 'nonCalm'), `summaryAlt 길이 단정: '${t}' (obs=${obs}, count=${count}, stop=${stop})`)
      }
    }
    if (s !== '지금') add(L.emptyText(6, s))
  }
  add(L.emptyText(6, null))
  add(L.emptyText(3, null))
  for (const t of stamps) {
    for (const forecast of [true, false]) {
      for (const obs of [undefined, '10:35']) {
        for (const picked of [true, false]) for (const cur of [true, false]) add(L.basisText({ time: t, forecast, obs }, picked, cur, label))
      }
    }
  }
  for (let count = 1; count <= 13; count++) {
    for (const stop of ['nonCalm', 'noForecast', 'dayEnd']) {
      for (const from of stamps) for (const endTime of stamps) for (const forecast of [true, false]) for (const isNow of [true, false]) add(L.runText({ count, stop, endTime }, { time: from, forecast }, label, isNow))
    }
  }
  for (let n = 1; n <= 3; n++) for (const obs of [true, false]) add(L.summaryText(n, obs))
  for (const km of [0.3, 2.34, 5.99, 6]) for (const index of [0, 37, 100]) add(L.metaText(km, index))
  for (const noiseDays of [null, 33]) for (const baseNoise of ['ok', 'placeMissing', 'hourMissing', 'allMissing']) for (const deviceSound of [true, false]) for (const obs of [true, false]) {
    const lines = L.panelLines({ noiseDays, baseNoise, deviceSound, obs })
    for (const s of lines) add(s)
    // 소음 평균 줄은 소음 자료가 있고 이 시간대에 자료가 없다고 밝히지 않았을 때만 있다
    check(lines.some((x) => x.startsWith('[소음 평균]')) === (noiseDays !== null && baseNoise !== 'allMissing'), `panelLines 소음 평균 줄 유무 (noiseDays=${noiseDays}, baseNoise=${baseNoise})`)
  }
  for (const state of ['noFile', 'ok', 'placeMissing', 'hourMissing', 'allMissing']) for (const forecast of [true, false]) {
    const t = L.noiseLineText(state, forecast)
    check((t === null) === (state === 'ok'), `noiseLineText null 판정 (${state})`)
    if (t) {
      add(t)
      check(t.includes(forecast ? '혼잡 예측' : '혼잡 관측') && !t.includes(forecast ? '혼잡 관측' : '혼잡 예측'), `noiseLineText가 기준 칸 종류와 다르게 부름 (${state}, forecast=${forecast}): ${t}`)
    }
  }
  for (const enabled of [true, false]) for (const applied of [true, false]) add(L.customText(enabled, applied))
  add(L.midText(true))
  add(L.midText(false))
  // 이유 문장: 실제 후보 전수(위에서 모은 것)와 합성 조합
  for (const s of whyAll) add(s)
  const cellOf = (index, w, n, c = index, forecast = true) => ({ time: '2026-10-13 19:00', hour: 19, index, level: 'busy', soundN: 0, forecast, noise: n !== null, parts: { c, n, s: w > 0 ? 50 : null, w, offset: 0, base: index } })
  const states = ['ok', 'placeMissing', 'hourMissing', 'allMissing']
  for (const bs of states) for (const cs of states) {
    for (const [bw, cw] of [[0, 0], [0.3, 0], [0, 0.3]]) {
      for (const s of L.whyLines('가나다', cellOf(80, bw, 50), cellOf(20, cw, null), { baseNoise: bs, candNoise: cs })) add(s)
      for (const s of L.whyLines('가나다', cellOf(100, bw, 100), cellOf(0, cw, 0), { baseNoise: bs, candNoise: cs })) add(s)
      for (const s of L.whyLines('가나다', cellOf(100, bw, 100, 130), cellOf(20, cw, null), { baseNoise: bs, candNoise: cs })) add(s)
      for (const s of L.whyLines('가나다', cellOf(80, bw, 50, 80, false), cellOf(20, cw, null, 20, false), { baseNoise: bs, candNoise: cs })) add(s)
    }
  }
  // 명세 3.3절 표의 문구와 한 글자씩 대조(조립 함수가 표와 다르게 만들면 잡힌다)
  const g = (actual, expected) => check(actual === expected, `문구 고정값 불일치: '${actual}' != '${expected}'`)
  const shown = (forecast, obs) => ({ time: '2026-10-13 19:00', forecast, obs })
  g(label('2026-10-13 09:00'), '9시')
  g(label('2026-10-14 00:00'), '내일 0시')
  g(L.basisText(shown(true), true, true, label), '19시 예측 기준이에요.')
  g(L.basisText(shown(false), true, true, label), '19시 관측 기준이에요.')
  g(L.basisText({ time: '2026-10-14 08:00', forecast: true }, true, false, label), '내일 8시 예측 기준이에요.')
  g(L.basisText(shown(false, '10:35'), false, true, label), '지금(관측 10:35) 기준이에요.')
  g(L.basisText(shown(true), false, true, label), '지금(예측) 기준이에요.')
  g(L.basisText(shown(false), false, true, label), '지금(관측) 기준이에요.')
  g(L.basisText(shown(true), false, false, label), '19시 예측 기준이에요.')
  g(L.altButton('지금'), '지금으로 보기')
  g(L.altButton('내일 8시'), '내일 8시로 보기')
  const f14 = { time: '2026-10-13 14:00', forecast: true }
  const o11 = { time: '2026-10-13 11:00', forecast: false, obs: '10:35' }
  g(L.runText({ count: 1, stop: 'nonCalm', endTime: '2026-10-13 15:00' }, f14, label), '14시대만 무던할 것으로 예측돼요. 도착이 늦어지면 달라질 수 있어요.')
  g(L.runText({ count: 1, stop: 'noForecast', endTime: '2026-10-13 14:00' }, f14, label), '14시대는 무던할 것으로 예측돼요. 그 뒤는 예측이 없어요.')
  g(L.runText({ count: 1, stop: 'dayEnd', endTime: '2026-10-13 22:00' }, f14, label), '14시대는 무던할 것으로 예측돼요. 외출 시간(21시)까지만 살펴봤어요.')
  g(L.runText({ count: 3, stop: 'nonCalm', endTime: '2026-10-13 17:00' }, f14, label), '14시부터 17시 전까지 무던할 것으로 예측돼요.')
  g(L.runText({ count: 3, stop: 'dayEnd', endTime: '2026-10-13 22:00' }, f14, label), '14시부터 외출 시간 끝(21시대)까지 무던할 것으로 예측돼요.')
  g(L.runText({ count: 3, stop: 'noForecast', endTime: '2026-10-13 16:00' }, f14, label), '14시부터 16시대까지 무던할 것으로 예측돼요. 그 뒤는 예측이 없어요.')
  // 관측 칸은 '예측'이 아니라 '관측'으로 부르고, 지금 칸이면 시각 대신 '지금'이라고 부른다
  g(L.runText({ count: 1, stop: 'nonCalm', endTime: '2026-10-13 12:00' }, o11, label, true), '지금 관측으로는 무던해요. 도착이 늦어지면 달라질 수 있어요.')
  g(L.runText({ count: 1, stop: 'nonCalm', endTime: '2026-10-13 12:00' }, o11, label), '11시대 관측으로는 무던해요. 도착이 늦어지면 달라질 수 있어요.')
  g(L.runText({ count: 1, stop: 'noForecast', endTime: '2026-10-13 11:00' }, o11, label, true), '지금 관측으로는 무던해요. 그 뒤는 예측이 없어요.')
  g(L.runText({ count: 1, stop: 'dayEnd', endTime: '2026-10-13 22:00' }, o11, label, true), '지금 관측으로는 무던해요. 외출 시간(21시)까지만 살펴봤어요.')
  g(L.runText({ count: 3, stop: 'nonCalm', endTime: '2026-10-13 14:00' }, o11, label, true), '지금 관측으로는 무던하고, 14시 전까지 무던할 것으로 예측돼요.')
  g(L.runText({ count: 3, stop: 'dayEnd', endTime: '2026-10-13 22:00' }, o11, label, true), '지금 관측으로는 무던하고, 외출 시간 끝(21시대)까지 무던할 것으로 예측돼요.')
  g(L.runText({ count: 3, stop: 'noForecast', endTime: '2026-10-13 13:00' }, o11, label, true), '지금 관측으로는 무던하고, 13시대까지 무던할 것으로 예측돼요. 그 뒤는 예측이 없어요.')
  g(L.midText(true), '붐빔보다는 낫지만 보통으로 예측돼요.')
  g(L.midText(false), '붐빔보다는 낫지만 보통으로 관측돼요.')
  g(L.emptyText(6, null), '서울시 주요 121곳 중 직선 6km 안에서 지금 더 무던한 곳을 찾지 못했어요.')
  g(L.emptyText(6, '19시'), '서울시 주요 121곳 중 직선 6km 안에서 19시에 더 무던할 것으로 예측되는 곳을 찾지 못했어요.')
  g(L.selectedCalmText('19시'), '19시에는 이곳이 무던할 것으로 예측돼요.')
  g(L.summaryText(3), '더 무던할 곳 3곳 보기')
  g(L.summaryText(1, true), '더 무던한 곳 1곳 보기')
  const rn = (count, stop) => ({ count, stop, endTime: '2026-10-13 22:00' })
  g(L.summaryAlt('19시'), '같은 곳이 19시부터 무던할 것으로 예측돼요')
  g(L.summaryAlt('19시', false, rn(3, 'nonCalm')), '같은 곳이 19시부터 무던할 것으로 예측돼요')
  g(L.summaryAlt('19시', false, rn(3, 'dayEnd')), '같은 곳이 19시부터 무던할 것으로 예측돼요')
  g(L.summaryAlt('19시', false, rn(1, 'nonCalm')), '같은 곳이 19시 한 시간 무던할 것으로 예측돼요')
  g(L.summaryAlt('21시', false, rn(1, 'dayEnd')), '같은 곳이 21시대는 무던할 것으로 예측돼요')
  g(L.summaryAlt('내일 7시', false, rn(1, 'noForecast')), '같은 곳이 내일 7시대는 무던할 것으로 예측돼요')
  g(L.summaryAlt('지금', false, rn(1, 'dayEnd')), '같은 곳이 지금은 무던할 것으로 예측돼요')
  g(L.summaryAlt('지금', true), '같은 곳이 지금 관측으로는 무던해요')
  g(L.summaryAlt('지금', true, rn(1, 'dayEnd')), '같은 곳이 지금 관측으로는 무던해요')
  g(L.metaText(2.34, 37), '직선 2.3km · 지수 37')
  g(T.far, '3km보다 멀어요')
  g(T.farNote, '3km보다 먼 곳은 이동이 길어질 수 있어요.')
  g(T.isolated, '직선 3km 안에는 비교할 수 있는 다른 곳도 없어요.')
  g(T.safe, '처음 가는 곳이면 아이 곁에서 주변을 먼저 살펴보세요.')
  g(T.evidence, '서울시가 실시간으로 공개하는 주요 121곳끼리만 비교했어요. 직선 거리만 보여 줘요. 실제 이동 시간은 지도 앱에서 확인해 주세요. 아이에게 편한 정도를 직접 잰 값은 아니에요.')
  g(T.altNone, '외출 시간(8~21시) 예측 안에는 무던해지는 때가 보이지 않아요.')
  const pc = (index, c, offset, forecast = true) => ({ time: '2026-10-13 19:00', hour: 19, index, level: 'busy', soundN: 0, forecast, noise: false, parts: { c, n: null, s: null, w: 0, offset, base: c } })
  const none = { baseNoise: 'allMissing', candNoise: 'allMissing' }
  g(L.whyLines('가나다', pc(60, 60, 0), pc(30, 30, 0), none).join('|'), '가나다의 지수는 30이고, 이곳(지수 60)보다 30점 낮아요.|혼잡 예측 쪽은 이곳보다 30점 낮아요.')
  g(L.whyLines('가나다', pc(60, 60, 0), pc(30, 35, -5), none).join('|'), '가나다의 지수는 30이고, 이곳(지수 60)보다 30점 낮아요.|혼잡 예측 쪽은 이곳보다 25점 낮아요.|내 기록 보정 쪽은 이곳보다 5점 낮아요.')
  g(L.whyLines('가나다', pc(60, 65, -5), pc(30, 30, 0), none).join('|'), '가나다의 지수는 30이고, 이곳(지수 60)보다 30점 낮아요.|혼잡 예측 쪽은 이곳보다 35점 낮아요.|내 기록 보정 쪽은 이곳보다 5점 높아요.')
  g(L.whyLines('가나다', pc(60, 60, 0), pc(30, 30, 0), { baseNoise: 'ok', candNoise: 'placeMissing' }).slice(-1)[0], '가나다의 동네 소음은 자료가 없어서 반영되지 않았어요.')
  g(L.whyLines('가나다', pc(60, 60, 0), pc(30, 30, 0), { baseNoise: 'ok', candNoise: 'hourMissing' }).slice(-1)[0], '가나다의 동네 소음은 이 시간대 값이 비어 있어서 반영되지 않았어요.')
  g(L.whyLines('가나다', pc(60, 60, 0), pc(30, 30, 0), { baseNoise: 'hourMissing', candNoise: 'ok' }).slice(-1)[0], '이곳의 동네 소음은 이 시간대 값이 비어 있어서 반영되지 않았어요.')
  g(L.whyLines('가나다', pc(60, 60, 0), pc(30, 30, 0), { baseNoise: 'placeMissing', candNoise: 'ok' }).slice(-1)[0], '이곳의 동네 소음은 자료가 없어서 반영되지 않았어요.')
  g(L.whyLines('가나다', pc(60, 60, 0, false), pc(30, 30, 0, false), none).join('|'), '가나다의 지수는 30이고, 이곳(지수 60)보다 30점 낮아요.|혼잡 관측 쪽은 이곳보다 30점 낮아요.')
  const pl = (o) => L.panelLines({ noiseDays: null, baseNoise: 'ok', deviceSound: false, obs: false, ...o })
  g(pl({})[0], '[서울시 예측] 서울시가 발표한 혼잡 예측 단계를 썼어요. 지역 단위 값이라 장소 안쪽과 다를 수 있어요.')
  g(pl({ obs: true })[0], '[서울시 관측] 지금 시각은 서울시가 실시간으로 공개하는 혼잡 단계를 썼어요.')
  const nz = (baseNoise) => pl({ noiseDays: 33, baseNoise }).find((x) => x.startsWith('[소음 평균]'))
  g(nz('ok'), '[소음 평균] 지난 33일 요일·시각별 동네 소음 평균을 썼어요. 센서는 길가에 있어서 장소 안쪽과 다를 수 있어요.')
  g(nz('placeMissing'), '[소음 평균] 지난 33일 요일·시각별 동네 소음 평균을 썼어요. 센서는 길가에 있어서 장소 안쪽과 다를 수 있어요. 다만 이곳은 자료가 없어서 반영하지 않았어요.')
  g(nz('hourMissing'), '[소음 평균] 지난 33일 요일·시각별 동네 소음 평균을 썼어요. 센서는 길가에 있어서 장소 안쪽과 다를 수 있어요. 다만 이곳은 이 시간대 값이 비어 있어서 반영하지 않았어요.')
  g(nz('allMissing'), undefined)
  g(L.noiseLineText('noFile', true), '동네 소음 자료를 불러오지 못해서 혼잡 예측만 반영했어요.')
  g(L.noiseLineText('allMissing', false), '이 시간대는 동네 소음 자료가 없어서 혼잡 관측만 반영했어요.')
  g(L.noiseLineText('placeMissing', false), '이곳은 동네 소음 자료가 없어서 혼잡 관측 위주로 계산했어요.')
  g(L.noiseLineText('hourMissing', true), '이 시간대는 이곳의 동네 소음 값이 비어 있어서 혼잡 예측 위주로 계산했어요.')
  g(L.noiseLineText('ok', true), null)
  g(L.customText(true, true), '아이 맞춤을 반영해서 비교했어요.')
  g(L.customText(true, false), '아이 맞춤은 켰지만 고른 항목이 없어서 기본 기준과 같아요.')
  g(L.customText(false, true), '아이 맞춤 없이 기본 기준으로 비교했어요.')
  g(T.back, '← 이전 장소로 돌아가기')
  g(L.whyLines('가나다', pc(60, 60, 0), pc(30, 30, 0), { baseNoise: 'ok', candNoise: 'ok' }).length, 2)
  const FORB = [...L.FORBIDDEN, '추천', '—', '–', 'undefined', 'NaN', '[object']
  let n = 0
  for (const s of texts) {
    n++
    const hit = FORB.find((f) => s.includes(f)) ?? L.FORBIDDEN_PATTERNS.map((re) => s.match(re)?.[0]).find(Boolean)
    check(!hit, `금지어 '${hit}': ${s}`)
    check(!/\{|\}|\$\{|  /.test(s), `문장 조립 흔적: ${s}`)
  }
  console.log(`  서로 다른 문장 ${n}건 검사(상수 ${Object.keys(T).length}개, 이유 문장 ${new Set(whyAll).size}건 포함)`)
}

console.log(`\n${fail === 0 ? '통과' : '실패'}: 위반 ${fail}건${fail ? ' ' + JSON.stringify(fails) : ''}`)
process.exit(fail === 0 ? 0 : 1)
