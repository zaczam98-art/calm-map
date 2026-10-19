/**
 * 외출 계획의 계산(src/lib/plan.ts), 화면 문구(src/lib/planText.ts), 메모 저장 키 검증.
 * 모델과 외부 주소를 부르지 않고, 받아 둔 공개 스냅샷과 소음 파일로만 돈다.
 *
 * 실행(저장소 루트에서):
 *   node scripts/plan_check.mjs <snapshot.json> <noise.json> [nowKey]
 *   고정 사본: node scripts/plan_check.mjs scripts/fixtures/snapshot-2026-10-13T1106.json scripts/fixtures/noise-2026-10-13.json "2026-10-13 11"
 *   P3은 public/data/snapshot-demo.json(nowKey 없음)도 같은 실행 안에서 함께 본다.
 *
 * 판정(위반이 하나라도 있으면 종료 코드 1)
 *  P1 메모 저장소: 왕복, 40자 절단, 네 칸이 모두 빈 저장이 항목을 지움, 깨진 JSON과 모양이 다른 값은 빈 메모, 쓰기 실패는 false, clearAll이 KEY_PLAN을 지움
 *  P2 대안: 121곳 x 외출 시간 칸 x 맞춤 끔과 켬 x 기록 보정 2종 x stale 2종에서 planAlternatives가 독립 재구현과 일치하고, 불변식을 지킴
 *  P3 whenLines와 선택지 글자: head가 시각 이름, 예측 또는 관측, 단계 이름, 지수를 정확히 담고, sub와 rec의 조건을 지킴
 *  P4 금지어: planText.ts의 모든 문구와 조합 결과를 FORBIDDEN, 대시, '추천', '정확', undefined, NaN으로 검사하고 문장 끝을 검사
 *  P5 메모가 나가는 길: 메모 함수를 부르는 파일은 Plan.tsx뿐이고 Plan.tsx에 전송 수단이 없으며, 카드 요청에 메모 필드가 없음
 *  G4 문구 정합: 저장 항목을 말하는 줄이 '외출 계획 메모'를 함께 담음(서버 전달 항목은 예외)
 *  D4 새 파일의 문장이 서울시 혼잡도를 '단계'라고 부르지 않음
 *  P6 보정 1회차: 지수 없는 칸의 조사, sub 중복 제거, 접근 가능한 이름이 보이는 글자를 담음, 메모 칸 속성과 저장 시점, 사이렌 문장 조건, scroll-padding, 시트 단추 줄 간격(소스 사실만. 화면 동작은 브라우저 검사)
 *  P7 보정 2회차: 대안 소개와 없을 때 문장의 기준 낱말, 두 이름 통일, 카드 안내의 권고 시간, 데모 데이터의 비교 범위 문장, 메모 안내의 설명 연결 위치(소스 사실만)
 * 기록(판정 없음): 대안이 있는 칸의 비율, 대안 수 분포
 */
import { readFileSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { build } from 'esbuild'

const root = process.cwd()
const [snapPath, noisePath, nowKeyArg] = process.argv.slice(2)
if (!snapPath || !noisePath) {
  console.log('사용법: node scripts/plan_check.mjs <snapshot.json> <noise.json> [nowKey 예: "2026-10-13 11"]')
  process.exit(1)
}
const nowKey = nowKeyArg || undefined
const readJson = (f) => JSON.parse(readFileSync(f, 'utf-8').replace(/^﻿/, ''))
const snap = readJson(snapPath)
const noise = readJson(noisePath)
const demo = readJson(path.join(root, 'public/data/snapshot-demo.json'))
const places = readJson(path.join(root, 'src/data/places.json')).filter((p) => p.tracked)

mkdirSync(path.join(root, '.tmp'), { recursive: true })
const out = path.join(root, '.tmp', 'plan_check_bundle.cjs')
await build({
  stdin: {
    contents: `
      export * from './src/lib/index.ts'
      export * from './src/lib/nearby.ts'
      export * from './src/lib/nearbyText.ts'
      export * from './src/lib/plan.ts'
      export * from './src/lib/planText.ts'
      export { basisLine } from './src/lib/trustText.ts'
      export { clearAll, KEY_PLAN } from './src/lib/profile.ts'
      export { noiseLookup } from './src/lib/noise.ts'
      export { DATA_ITEMS } from './src/lib/landingCopy.ts'
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
  loader: { '.css': 'empty' },
  define: { 'import.meta.env': '{"BASE_URL":"/","VITE_PUBLIC_SNAPSHOT_URL":"x"}' },
})
const L = createRequire(import.meta.url)(out)

let fail = 0
let sec = ''
const bad = (msg) => {
  fail++
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

// localStorage를 Map으로 흉내 낸다. throwOn에 넣은 동작은 예외를 던진다.
const store = new Map()
const throwOn = new Set()
globalThis.localStorage = {
  getItem: (k) => {
    if (throwOn.has('get')) throw new Error('blocked')
    return store.has(k) ? store.get(k) : null
  },
  setItem: (k, v) => {
    if (throwOn.has('set')) throw new Error('quota')
    store.set(k, String(v))
  },
  removeItem: (k) => {
    if (throwOn.has('remove')) throw new Error('blocked')
    store.delete(k)
  },
  clear: () => store.clear(),
}

const RANK = { calm: 0, mid: 1, busy: 2, nodata: 9 }
const sampleProfile = { enabled: true, tags: Object.fromEntries(L.SENSE_TAGS.map((t) => [t, t === 'sudden' ? 1.5 : 1])), crowd: 1.5, loud: 1.5 }
const PROFILES = [
  ['맞춤 끔', null],
  ['샘플 프로필', sampleProfile],
]
const OFFSETS = [
  ['보정 없음', {}],
  ['보정 있음', { 서울역: 20, 강남역: -5, 잠실한강공원: -5 }],
]
const makeScores = (sn, nk, profile, offsets) =>
  new Map(places.map((p) => [p.name, L.hourScores(sn.places[p.name], () => undefined, profile, offsets[p.name] ?? 0, nk, L.noiseLookup(noise, p.name))]))
const inDay = (c) => c.hour >= L.DAY_FROM && c.hour <= L.DAY_TO
const t13 = (t) => t.slice(0, 13)

// ---- P1
section('P1', '메모 저장소')
{
  const full = { entry: '정문 앞 광장', restroom: '1층 화장실', rest: '분수대 옆 벤치', exit: '후문' }
  check(L.KEY_PLAN === 'calmmap.plan.v1', `KEY_PLAN ${L.KEY_PLAN}`)
  check(same(L.loadMemo('서울역'), L.emptyMemo()), '저장 전에는 빈 메모')

  check(L.saveMemo('서울역', full) === true, '저장이 true를 돌려주지 않음')
  check(same(L.loadMemo('서울역'), full), `왕복 불일치 ${JSON.stringify(L.loadMemo('서울역'))}`)
  const raw = JSON.parse(store.get(L.KEY_PLAN))
  check(raw.v === 1 && typeof raw.places === 'object', '저장 모양이 { v: 1, places }가 아님')
  check(['entry', 'restroom', 'rest', 'exit'].every((k) => raw.places['서울역'][k] === full[k]) && !Number.isNaN(Date.parse(raw.places['서울역'].ts)), `장소 항목 모양 ${JSON.stringify(raw.places['서울역'])}`)

  // 다른 장소 항목과 목록에 없는 이름은 건드리지 않는다
  L.saveMemo('없는곳', { ...L.emptyMemo(), rest: '벤치' })
  L.saveMemo('강남역', { ...L.emptyMemo(), exit: '2번 출구 쪽' })
  check(L.loadMemo('없는곳').rest === '벤치' && L.loadMemo('서울역').exit === '후문', '다른 장소를 저장하면서 기존 항목이 바뀜')

  // 40자 절단: 저장할 때와 읽을 때
  const long = '가'.repeat(50)
  L.saveMemo('서울역', { entry: long, restroom: long, rest: '나', exit: '' })
  const cut = L.loadMemo('서울역')
  check(cut.entry.length === 40 && cut.restroom.length === 40 && cut.rest === '나', `저장 때 절단 ${cut.entry.length}/${cut.restroom.length}`)
  store.set(L.KEY_PLAN, JSON.stringify({ v: 1, places: { 서울역: { entry: long, restroom: '다', rest: '', exit: '' } } }))
  check(L.loadMemo('서울역').entry.length === 40, '읽을 때 40자로 자르지 않음')

  // 네 칸이 모두 비면(공백만 있어도) 항목을 지우고, 마지막 항목이 사라지면 키도 지운다
  L.saveMemo('서울역', full)
  L.saveMemo('서울역', { entry: '', restroom: ' ', rest: '', exit: '  ' })
  check(!('서울역' in (JSON.parse(store.get(L.KEY_PLAN) ?? '{"places":{}}').places ?? {})), '빈 저장이 항목을 지우지 않음')
  check(same(L.loadMemo('서울역'), L.emptyMemo()), '지운 뒤에도 메모가 보임')
  store.clear()
  L.saveMemo('서울역', full)
  L.saveMemo('서울역', L.emptyMemo())
  check(!store.has(L.KEY_PLAN), '항목이 하나도 없는데 키가 남음')
  check(L.memoIsEmpty(L.emptyMemo()) && !L.memoIsEmpty(full), 'memoIsEmpty')

  // 깨진 JSON과 모양이 다른 값은 예외 없이 빈 메모
  const odd = ['not json{', '[]', '"x"', '123', 'null', 'true', '{}', '{"v":2,"places":{}}', '{"v":1}', '{"v":1,"places":[]}', '{"v":1,"places":"x"}', '{"v":1,"places":{"서울역":"x"}}', '{"v":1,"places":{"서울역":null}}', '{"v":1,"places":{"서울역":[1,2]}}', '{"v":1,"places":{"서울역":{"entry":5,"restroom":null,"rest":["a"],"exit":{"a":1}}}}']
  for (const r of odd) {
    store.set(L.KEY_PLAN, r)
    try {
      check(same(L.loadMemo('서울역'), L.emptyMemo()), `모양이 다른 값에서 빈 메모가 아님 | ${r}`)
    } catch (e) {
      bad(`읽기에서 예외 | ${r} | ${e.message}`)
    }
    try {
      check(L.saveMemo('서울역', full) === true && same(L.loadMemo('서울역'), full), `모양이 다른 값 위에 저장하지 못함 | ${r}`)
    } catch (e) {
      bad(`쓰기에서 예외 | ${r} | ${e.message}`)
    }
  }
  store.set(L.KEY_PLAN, JSON.stringify({ v: 1, places: { 서울역: { entry: 5, restroom: '화장실 앞', rest: null, exit: '' } } }))
  check(same(L.loadMemo('서울역'), { ...L.emptyMemo(), restroom: '화장실 앞' }), '문자열이 아닌 칸만 빈 칸이어야 함')

  // 저장소가 막힌 환경
  store.clear()
  throwOn.add('set')
  check(L.saveMemo('서울역', full) === false, '쓰기가 막혔는데 false가 아님')
  throwOn.clear()
  throwOn.add('get')
  try {
    check(same(L.loadMemo('서울역'), L.emptyMemo()), '읽기가 막혔는데 빈 메모가 아님')
  } catch (e) {
    bad(`읽기 차단에서 예외 ${e.message}`)
  }
  throwOn.clear()
  store.set(L.KEY_PLAN, JSON.stringify({ v: 1, places: { 서울역: { ...full, ts: 'x' } } }))
  throwOn.add('remove')
  check(L.saveMemo('서울역', L.emptyMemo()) === false, '지우기가 막혔는데 false가 아님')
  throwOn.clear()

  // clearAll
  store.clear()
  L.saveMemo('서울역', full)
  for (const k of ['calmmap.profile.v1', 'calmmap.offset.v1', 'calmmap.log.v1']) store.set(k, '{}')
  L.clearAll()
  check(!store.has(L.KEY_PLAN), 'clearAll 뒤에 메모가 남음')
  console.log('  왕복, 40자 절단, 빈 저장, 깨진 값 15종, 저장소 오류, clearAll 확인')
  store.clear()
}

// ---- P2
section('P2', '대안(planAlternatives)')
{
  const stat = { cells: 0, withAlt: 0, byN: [0, 0, 0], zeroLevel: 0, zeroLowerSame: 0 }
  const staleSynth = (names) => (n) => names.has(n)
  const synthNames = new Set(places.filter((_, i) => i % 7 === 0).map((p) => p.name))
  const actualStale = new Set(places.filter((p) => snap.places[p.name]?.stale === true).map((p) => p.name))
  const STALES = [
    ['stale 실제', staleSynth(actualStale)],
    ['stale 합성(17곳)', staleSynth(synthNames)],
  ]
  // 독립 재구현: 6km 안, 같은 시각의 칸, 지수 있음, 관측 예측 종류 같음, 목표 단계보다 낮음, stale 제외, (단계, 거리) 정렬, 상위 2곳
  const reference = (base, cell, S, isStale) => {
    if (cell.index === null || cell.level === 'nodata') return []
    const limit = cell.level === 'calm' ? 1 : RANK[cell.level]
    const found = []
    for (const p of places) {
      if (p.name === base.name || isStale(p.name)) continue
      const km = L.distanceKm(base, p)
      if (km > 6) continue
      const c = S.get(p.name).find((x) => t13(x.time) === t13(cell.time))
      if (!c || c.index === null || c.forecast !== cell.forecast) continue
      if (RANK[c.level] >= limit) continue
      found.push({ name: p.name, km, index: c.index, level: c.level, time: c.time })
    }
    return found.sort((a, b) => RANK[a.level] - RANK[b.level] || a.km - b.km).slice(0, 2)
  }
  const brief = (items) => items.map((it) => ({ name: it.place.name, km: it.km, index: it.index, level: it.level, time: it.cell.time }))
  for (const [pn, profile] of PROFILES) {
    for (const [on, offsets] of OFFSETS) {
      const S = makeScores(snap, nowKey, profile, offsets)
      for (const [sn, isStale] of STALES) {
        for (const base of places) {
          const series = S.get(base.name)
          for (const cell of series.filter(inDay)) {
            const got = L.planAlternatives({ place: base, places, cell, getScores: (n) => S.get(n), isStale })
            const want = reference(base, cell, S, isStale)
            const tag = `${pn}/${on}/${sn}/${base.name}/${cell.time}`
            if (!same(brief(got), want)) bad(`독립 재구현과 다름 ${tag} | ${JSON.stringify(brief(got))} != ${JSON.stringify(want)}`)
            if (got.length > 2) bad(`2곳을 넘음 ${tag}`)
            if (got.some((it) => it.place.name === base.name)) bad(`자기 자신이 후보 ${tag}`)
            if (got.some((it) => it.km > 6)) bad(`6km 밖 ${tag}`)
            if (got.some((it) => isStale(it.place.name))) bad(`stale 후보 ${tag}`)
            if (cell.level === 'calm' && got.some((it) => it.level !== 'calm')) bad(`무던함 기준인데 무던하지 않은 후보 ${tag}`)
            if (cell.level !== 'calm' && got.some((it) => RANK[it.level] >= RANK[cell.level])) bad(`기준보다 낮지 않은 후보 ${tag}`)
            if (got.some((it) => it.cell.forecast !== cell.forecast || t13(it.cell.time) !== t13(cell.time))) bad(`칸이 다름 ${tag}`)
            if (pn === '맞춤 끔' && on === '보정 없음' && sn === 'stale 실제') {
              stat.cells++
              if (got.length > 0) stat.withAlt++
              stat.byN[got.length]++
              // 보통·붐빔 기준에서 대안이 0곳인 칸 중, 같은 단계에서 지수만 더 낮은 곳이 6km 안에 있는 칸(그래서 '덜 붐빌'이라고 쓰면 사실과 어긋난다)
              if (cell.level !== 'calm' && cell.index !== null && cell.level !== 'nodata' && got.length === 0) {
                stat.zeroLevel++
                const lowerSame = places.some((p) => {
                  if (p.name === base.name || isStale(p.name) || L.distanceKm(base, p) > 6) return false
                  const c = S.get(p.name).find((x) => t13(x.time) === t13(cell.time))
                  return !!c && c.index !== null && c.forecast === cell.forecast && c.level === cell.level && c.index < cell.index
                })
                if (lowerSame) stat.zeroLowerSame++
              }
            }
          }
          // 지수가 없는 칸과 자료 부족 칸은 빈 목록
          const c0 = series[0]
          if (c0) {
            for (const fake of [{ ...c0, index: null, level: 'nodata' }, { ...c0, index: 50, level: 'nodata' }, { ...c0, index: null }]) {
              if (L.planAlternatives({ place: base, places, cell: fake, getScores: (n) => S.get(n), isStale: () => false }).length !== 0) bad(`지수가 없거나 자료 부족인 칸에서 목록이 비지 않음 ${base.name}`)
            }
          }
        }
      }
    }
  }
  // scoresGetter는 시트의 이웃 계산과 같은 식(hourScores)이다
  const prof = sampleProfile
  const offs = OFFSETS[1][1]
  const me = places[0]
  const myScores = L.hourScores(snap.places[me.name], () => undefined, prof, offs[me.name] ?? 0, nowKey, L.noiseLookup(noise, me.name))
  const get = L.scoresGetter({ snap, sound: {}, profile: prof, offsets: offs, nowKey, noise, place: me, scores: myScores })
  check(get(me.name) === myScores, 'scoresGetter가 기준 장소의 시계열을 그대로 돌려주지 않음')
  for (const p of places.slice(0, 40)) {
    const want = L.hourScores(snap.places[p.name], () => undefined, prof, offs[p.name] ?? 0, nowKey, L.noiseLookup(noise, p.name))
    if (!same(get(p.name), want)) bad(`scoresGetter 불일치 ${p.name}`)
    if (get(p.name) !== get(p.name)) bad(`scoresGetter가 같은 이름을 두 번 계산함 ${p.name}`)
  }
  // customApplied: 맞춤 끔, 고른 항목 없음, 기록 보정이 6km 안에 있음, 6km 밖에만 있음
  const none = { enabled: true, tags: Object.fromEntries(L.SENSE_TAGS.map((t) => [t, 1])), crowd: 1, loud: 1 }
  const seoul = places.find((p) => p.name === '서울역')
  const far = places.find((p) => L.distanceKm(seoul, p) > 6)
  const near = places.find((p) => p.name !== seoul.name && L.distanceKm(seoul, p) <= 6)
  check(L.customApplied({ ...none, enabled: false, crowd: 1.5 }, {}, seoul, places) === false, 'customApplied 맞춤 끔')
  check(L.customApplied(none, {}, seoul, places) === false, 'customApplied 고른 항목 없음')
  check(L.customApplied({ ...none, crowd: 1.5 }, {}, seoul, places) === true, 'customApplied 고른 항목 있음')
  check(L.customApplied(none, { [near.name]: 5 }, seoul, places) === true, 'customApplied 6km 안의 기록')
  check(L.customApplied(none, { [far.name]: 5 }, seoul, places) === false, 'customApplied 6km 밖의 기록')
  console.log(`  기준 칸 ${stat.cells}개(맞춤 끔, 보정 없음) 중 대안 있음 ${stat.withAlt}개, 대안 수 0/1/2곳 = ${stat.byN.join('/')}`)
  console.log(`  기록: 보통·붐빔 기준에서 대안이 0곳인 칸 ${stat.zeroLevel}개 중 6km 안에 같은 단계이면서 지수가 더 낮은 곳이 있는 칸 ${stat.zeroLowerSame}개`)
}

// ---- P3
section('P3', 'whenLines와 선택지 글자')
const textBag = new Set() // P4가 검사할 문장 모음(문장, 라벨 구분)
const labelBag = new Set()
{
  const bare = /undefined|NaN|\[object/
  const run = (name, sn, nk) => {
    const S = makeScores(sn, nk, null, {})
    const today = (nk ?? places.map((p) => S.get(p.name)[0]).find(Boolean).time).slice(0, 10)
    const label = L.makeLabel(today)
    let cells = 0
    let calmN = 0
    let recSkipped = 0
    let echoCut = 0
    let altPairs = 0
    for (const p of places) {
      const scores = S.get(p.name)
      if (scores.length === 0) continue
      const rec = L.recommend(scores, nk)
      for (const cell of scores) {
        cells++
        const isNow = L.isNowCell(cell, scores, nk)
        const lines = L.whenLines(cell, rec, scores, label, nk, sn)
        const when = isNow ? '지금' : label(cell.time)
        const tag = `${name}/${p.name}/${cell.time}`
        const wantHead = `${when} ${cell.forecast ? '예측' : '관측'}으로는 ${L.LEVEL3_LABEL[cell.level]}(지수 ${cell.index}점)이에요.`
        if (lines.head !== wantHead) bad(`head 불일치 ${tag} | ${lines.head} != ${wantHead}`)
        for (const part of [when, cell.forecast ? '예측' : '관측', L.LEVEL3_LABEL[cell.level], `지수 ${cell.index}점`]) if (!lines.head.includes(part)) bad(`head에 "${part}"가 없음 ${tag}`)
        if ((lines.sub !== null) !== (cell.level === 'calm')) bad(`sub 유무가 무던함과 다름 ${tag}`)
        if (lines.sub !== null) {
          // head가 이미 말한 '관측으로는 무던…'을 sub가 되풀이하지 않고, 예측 칸의 sub는 runText 그대로이며, 관측 칸의 sub는 runText에서 그 첫머리만 뺀 것이다
          const full = L.runText(L.calmRun(scores, cell), cell, label, isNow)
          if (lines.sub.length === 0 || lines.sub.includes('관측으로는 무던')) bad(`sub가 head와 같은 말을 되풀이함 ${tag} | ${lines.sub}`)
          if (cell.forecast ? lines.sub !== full : !(full.endsWith(lines.sub) && full !== lines.sub)) bad(`sub가 runText와 다름 ${tag} | ${lines.sub} | ${full}`)
          if (!cell.forecast) echoCut++
        }
        const recHere = cell.level === 'calm' && cell.hour === rec.from
        if (recHere) recSkipped++
        if (recHere ? lines.rec !== null : lines.rec !== `권고 시간: ${rec.text}`) bad(`rec 불일치 ${tag} | ${lines.rec}`)
        if (lines.basis !== L.basisLine(sn, cell)) bad(`basis 불일치 ${tag}`)
        if (cell.level === 'calm') calmN++
        if (cell.index !== null && cell.level !== 'nodata') {
          // 대안을 찾는 조건(소개)과 못 찾았다는 말(없을 때)이 같은 기준 낱말을 쓴다. 보통·붐빔 기준의 없을 때 문장은 '덜 붐빌'처럼 같은 단계 안의 지수 차이까지 뜻하는 말을 쓰지 않는다.
          const word = cell.level === 'calm' ? (cell.forecast ? '무던할 것으로 예측되는' : '무던한 것으로 관측되는') : `더 낮은 단계로 ${cell.forecast ? '예측' : '관측'}되는`
          const aIntro = L.altIntro(cell, when)
          const aEmpty = L.altEmpty(cell, when)
          if (!aIntro.includes(word) || !aEmpty.includes(word)) bad(`altIntro와 altEmpty가 같은 기준 낱말 "${word}"를 쓰지 않음 ${tag} | ${aIntro} | ${aEmpty}`)
          if (cell.level !== 'calm' && /덜 붐빌|덜 붐비는/.test(aEmpty)) bad(`보통·붐빔 기준의 없을 때 문장이 '덜 붐빌'을 씀 ${tag} | ${aEmpty}`)
          altPairs++
        }
        for (const s of [lines.head, lines.sub, lines.rec, lines.basis]) if (s !== null) {
          if (bare.test(s)) bad(`undefined, NaN, [object ${tag} | ${s}`)
          textBag.add(s)
        }
        if (inDay(cell) || cell === scores[0]) {
          const o = L.whenOption(cell, { isNow, isRec: cell.hour === rec.from, label })
          const wantO = `${when} · ${L.LEVEL3_LABEL[cell.level]} ${cell.index}점${cell.hour === rec.from ? ' · 권고 시간' : ''}`
          if (o !== wantO) bad(`선택지 글자 불일치 ${tag} | ${o} != ${wantO}`)
          if (bare.test(o)) bad(`선택지에 undefined 등 ${tag}`)
          labelBag.add(o)
        }
      }
    }
    console.log(`  ${name}: ${cells}칸 확인(무던함 ${calmN}칸, 권고 시각이라 rec를 생략한 칸 ${recSkipped}개, head와 겹치는 첫머리를 뺀 관측 칸 ${echoCut}개, 소개와 없을 때 문장의 기준 낱말 확인 ${altPairs}칸)`)
  }
  run('고정 사본', snap, nowKey)
  run('데모', demo, undefined)
  if (!L.basisLine(demo, demo.places[Object.keys(demo.places)[0]]).includes('데모')) bad('데모 기준 줄이 데모 안내가 아님')
  // 지금 칸 판정과 내일 시각 이름
  const S = makeScores(snap, nowKey, null, {})
  const sc = S.get('서울역')
  check(L.isNowCell(sc[0], sc, nowKey) === true && L.isNowCell(sc[1], sc, nowKey) === false, 'isNowCell')
  check(L.isNowCell(sc[0], sc, '2026-10-13 12') === false, '현재 시각이 첫 칸과 다르면 지금이 아님')
  check(L.isNowCell(sc[0], sc, undefined) === true, 'nowKey가 없으면 첫 칸이 지금')
  const tomorrow = { ...sc[3], time: '2026-10-14 09:00', hour: 9, index: 48, level: 'mid' }
  check(L.whenOption(tomorrow, { isNow: false, isRec: false, label: L.makeLabel('2026-10-13') }) === '내일 9시 · 보통 48점', `내일 선택지 글자 ${L.whenOption(tomorrow, { isNow: false, isRec: false, label: L.makeLabel('2026-10-13') })}`)
  // 지수 없는 칸: 지금 칸은 '지금은', 그 밖의 시각은 받침 없이도 읽히는 '에는'을 쓴다('14시은' 같은 조사 오류가 없어야 한다)
  const lab13 = L.makeLabel('2026-10-13')
  const noIdx = (c) => ({ ...c, index: null, level: 'nodata' })
  const nowNone = L.whenLines(noIdx(sc[0]), L.recommend(sc, nowKey), [noIdx(sc[0]), ...sc.slice(1)], lab13, nowKey, snap)
  const sc2 = [noIdx(sc[0]), ...sc.slice(1)]
  const nowNone2 = L.whenLines(sc2[0], L.recommend(sc, nowKey), sc2, lab13, nowKey, snap)
  check(nowNone2.head === '지금은 지수를 낼 자료가 없어요.' && nowNone2.sub === null, `지금 칸에 지수가 없을 때의 head ${nowNone2.head}`)
  for (const [hh, wantWhen] of [[11, '11시'], [14, '14시'], [9, '9시'], [21, '21시']]) {
    const c = noIdx({ ...sc[3], hour: hh, time: `2026-10-13 ${String(hh).padStart(2, '0')}:00` })
    const w = L.whenLines(c, L.recommend(sc, nowKey), sc, lab13, nowKey, snap)
    check(w.head === `${wantWhen}에는 지수를 낼 자료가 없어요.` && w.sub === null, `${hh}시 칸에 지수가 없을 때의 head ${w.head}`)
    textBag.add(w.head)
  }
  const tmr = L.whenLines(noIdx({ ...sc[3], hour: 9, time: '2026-10-14 09:00' }), L.recommend(sc, nowKey), sc, lab13, nowKey, snap)
  check(tmr.head === '내일 9시에는 지수를 낼 자료가 없어요.', `내일 칸에 지수가 없을 때의 head ${tmr.head}`)
  textBag.add(tmr.head)
  textBag.add(nowNone2.head)
  check(nowNone.head.endsWith('에는 지수를 낼 자료가 없어요.') && !/[가-힣]은 지수/.test(nowNone.head.replace('지금은', '')), `복사본 칸의 head ${nowNone.head}`)
}

// ---- P4
section('P4', '문구 금지어와 문장 끝')
{
  const DASH = new RegExp('[\\u2014\\u2013]') // 엠대시와 엔대시
  const textOk = (tag, s) => {
    if (typeof s !== 'string' || s.length === 0) return bad(`${tag}: 문자열이 아님`)
    const f = L.FORBIDDEN.find((w) => s.includes(w))
    if (f) bad(`${tag}: 금지어 "${f}" | ${s}`)
    if (L.FORBIDDEN_PATTERNS.some((re) => re.test(s))) bad(`${tag}: 금지 패턴 | ${s}`)
    if (DASH.test(s)) bad(`${tag}: 엠대시 또는 엔대시 | ${s}`)
    if (s.includes('추천') || s.includes('정확')) bad(`${tag}: 추천 또는 정확 | ${s}`)
    if (/undefined|NaN|\[object/.test(s)) bad(`${tag}: undefined, NaN, [object | ${s}`)
  }
  /** 문장 끝이 '요' 또는 '다'(마침표는 있어도 없어도 되고, 확인 대화상자의 물음은 '요?'도 허용). 끝의 괄호 덧말은 떼고 본다(권고 문장의 '(보통 수준).'). */
  const endsOk = (tag, s) => {
    for (const sent of s.trim().split(/(?<=\.)\s+/)) if (!/(요|다)[.?]?$/.test(sent.trim().replace(/\([^)]*\)\.?$/, ''))) bad(`${tag}: 문장 끝이 요/다가 아님 | ${sent}`)
  }
  // 라벨, 단추, 자리표시는 문장 끝을 보지 않는다
  const LABEL_KEYS = ['open', 'close', 'jump', 'altJump', 'whenHead', 'whenLabel', 'cardHead', 'cardMake', 'cardBusy', 'altHead', 'altGo', 'memoHead', 'memoClear', 'shareHead']
  const PLAN = L.PLAN
  const sentenceKeys = Object.keys(PLAN).filter((k) => !LABEL_KEYS.includes(k))
  const constants = Object.keys(PLAN).length
  for (const k of Object.keys(PLAN)) textOk(`PLAN.${k}`, PLAN[k])
  for (const k of sentenceKeys) endsOk(`PLAN.${k}`, PLAN[k])
  for (const f of L.MEMO_FIELDS) {
    textOk(`MEMO_FIELDS.${f.key}.label`, f.label)
    textOk(`MEMO_FIELDS.${f.key}.placeholder`, f.placeholder)
    if (!f.placeholder.startsWith('예:')) bad(`자리표시가 "예:"로 시작하지 않음 | ${f.placeholder}`)
  }
  if (L.MEMO_FIELDS.map((f) => f.key).join() !== 'entry,restroom,rest,exit') bad('메모 칸 네 개가 고정 순서가 아님')

  // 조합: 시각 이름 x 기준 칸 종류 x 예측과 관측
  const whens = ['지금', '9시', '14시', '내일 9시']
  const combos = []
  for (const level of ['calm', 'mid', 'busy']) for (const forecast of [true, false]) for (const when of whens) combos.push({ cell: { level, forecast }, when })
  for (const { cell, when } of combos) {
    for (const [name, s] of [['altIntro', L.altIntro(cell, when)], ['altEmpty', L.altEmpty(cell, when)]]) {
      textOk(`${name}(${cell.level},${cell.forecast},${when})`, s)
      endsOk(`${name}(${cell.level},${cell.forecast},${when})`, s)
    }
    const o = L.cardOther(when)
    textOk(`cardOther(${when})`, o)
    endsOk(`cardOther(${when})`, o)
    const lw = L.liveWhen(when)
    textOk(`liveWhen(${when})`, lw)
    endsOk(`liveWhen(${when})`, lw)
  }
  // 소개와 없을 때 문장이 기준 칸 종류에 맞는 낱말을 쓴다
  check(L.altIntro({ level: 'calm', forecast: true }, '14시').includes('무던할 것으로 예측되는'), '무던함 기준 소개 낱말')
  check(L.altIntro({ level: 'calm', forecast: false }, '지금').includes('무던한 것으로 관측되는'), '관측 기준 소개 낱말')
  check(L.altIntro({ level: 'mid', forecast: true }, '14시').includes('더 낮은 단계로 예측되는'), '보통 기준 소개 낱말')
  check(L.altEmpty({ level: 'busy', forecast: true }, '14시').includes('14시에 더 낮은 단계로 예측되는 곳을 찾지 못했어요.'), '붐빔 기준 없을 때 낱말')
  check(L.altEmpty({ level: 'mid', forecast: false }, '지금').includes('안에서 지금 더 낮은 단계로 관측되는 곳을 찾지 못했어요.'), '보통 관측 기준 없을 때 낱말')
  check(L.altEmpty({ level: 'mid', forecast: true }, '14시').includes('더 낮은 단계로 예측되는 곳을') && !/덜 붐빌|덜 붐비는/.test(L.altEmpty({ level: 'mid', forecast: true }, '14시')), '없을 때 문장이 소개와 같은 단계 낱말을 씀(같은 단계 안의 지수 차이를 뜻하는 말은 쓰지 않음)')
  check(L.PLAN.altRetry === '다른 시각을 고르면 달라질 수 있어요.', '없을 때 다음 행동 문장')
  check(L.cardOther('21시') === '카드는 권고 시간인 21시 기준으로 만들어요.' && L.cardOther('내일 9시') === '카드는 권고 시간인 내일 9시 기준으로 만들어요.', `카드 안내 한 문장 ${L.cardOther('21시')}`)
  check(L.altEmpty({ level: 'calm', forecast: true }, '지금').includes('안에서 지금 무던할 것으로'), '지금 기준 없을 때 낱말')
  check(L.altIntro({ level: 'calm', forecast: true }, '14시').includes('직선 6km'), '소개에 직선 6km')
  for (const p of places) {
    textOk(`planTitle(${p.name})`, L.planTitle(p.name))
    textOk(`altGoLabel(${p.name})`, L.altGoLabel(p.name))
    // WCAG 2.5.3: 보이는 글자('이곳 보기')가 접근 가능한 이름에 그대로 들어 있고, 어느 장소인지도 밝힌다
    if (L.altGoLabel(p.name) !== `이곳 보기, ${p.name} 시트 열기` || !L.altGoLabel(p.name).includes(L.PLAN.altGo)) bad(`altGoLabel 형식 ${L.altGoLabel(p.name)}`)
  }
  // 대안 구역의 비교 범위 문장(서울시 자료일 때와 데모일 때)
  for (const live of [true, false]) {
    const ev = L.evidenceText(live)
    textOk(`evidenceText(${live})`, ev)
    endsOk(`evidenceText(${live})`, ev)
  }
  // P3에서 만든 문장과 선택지 글자
  for (const s of textBag) {
    textOk('whenLines', s)
    endsOk('whenLines', s)
  }
  for (const s of labelBag) textOk('선택지', s)
  const sentences = textBag.size + sentenceKeys.length + combos.length * 4
  console.log(`  상수 ${constants}개, 조합 문장 ${combos.length * 4}개, whenLines 문장 ${textBag.size}개, 선택지 글자 ${labelBag.size}개 검사(문장 ${sentences}개)`)
}

// ---- P5
section('P5', '메모가 나가는 길')
{
  const walk = (dir, acc = []) => {
    for (const f of readdirSync(dir)) {
      const p = path.join(dir, f)
      if (statSync(p).isDirectory()) walk(p, acc)
      else if (/\.tsx?$/.test(f)) acc.push(p)
    }
    return acc
  }
  const files = walk(path.join(root, 'src'))
  const users = files.filter((f) => /\b(loadMemo|saveMemo)\b/.test(readFileSync(f, 'utf-8')) && !/[\\/]lib[\\/]plan\.ts$/.test(f)).map((f) => path.relative(root, f).replace(/\\/g, '/'))
  check(same(users, ['src/components/Plan.tsx']), `메모 함수를 부르는 파일 ${JSON.stringify(users)}`)
  const plan = readFileSync(path.join(root, 'src/components/Plan.tsx'), 'utf-8')
  for (const w of ['fetch(', 'sendBeacon', 'XMLHttpRequest', 'navigator.share', 'mailto', 'clipboard', 'getCard', 'location.href']) if (plan.includes(w)) bad(`Plan.tsx에 전송 수단 "${w}"`)
  const cardsTs = readFileSync(path.join(root, 'src/lib/cards.ts'), 'utf-8')
  const req = cardsTs.match(/interface CardRequest[\s\S]*?\r?\n}/)
  check(!!req && !/memo|plan|entry|restroom/i.test(req[0]), 'CardRequest에 메모 필드가 있음')
  const keyUsers = files.filter((f) => /KEY_PLAN/.test(readFileSync(f, 'utf-8'))).map((f) => path.relative(root, f).replace(/\\/g, '/')).sort()
  check(same(keyUsers, ['src/lib/plan.ts', 'src/lib/profile.ts']), `KEY_PLAN을 쓰는 파일 ${JSON.stringify(keyUsers)}`)
  console.log(`  메모 함수를 부르는 곳 ${users.join(', ')}, KEY_PLAN을 쓰는 곳 ${keyUsers.join(', ')}`)
}

// ---- G4
section('G4', '문구 정합')
{
  const PHRASE = '소리 측정 요약'
  const ANCHOR = '추천 탭에서 고른 기준 장소 이름'
  const NEW = '외출 계획 메모'
  const EXEMPT = /서버로 전달됩니다/ // 서버로 전달하는 항목을 말하는 줄에는 메모가 들어가지 않는다
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
          else if (!line.includes(NEW)) bad(`${where}: "${PHRASE}"만 있고 "${NEW}"가 없음`)
        })
      }
    }
  }
  walk(path.join(root, 'src'))
  // 기준 장소 이름을 저장 항목으로 말하는 줄, 온보딩 항목, README
  for (const f of ['src/components/Info.tsx', 'src/components/ChildProfile.tsx', 'src/lib/landingCopy.ts', 'README.md']) {
    readFileSync(path.join(root, f), 'utf-8').split(/\r?\n/).forEach((line, i) => {
      if (line.includes(ANCHOR) && !line.includes(NEW)) bad(`${f}:${i + 1}: "${ANCHOR}"만 있고 "${NEW}"가 없음`)
    })
  }
  const item = L.DATA_ITEMS.find((d) => d.term === '개인정보')
  check(!!item && item.desc.includes(NEW), 'DATA_ITEMS의 개인정보 항목에 외출 계획 메모가 없음')
  const readme = readFileSync(path.join(root, 'README.md'), 'utf-8')
  check(readme.includes(NEW) && readme.includes('| 외출 계획 |'), 'README에 외출 계획 행이나 메모 문구가 없음')
  const info = readFileSync(path.join(root, 'src/components/Info.tsx'), 'utf-8')
  check(info.includes('이 장소 메모 지우기'), '정보 탭에 메모 지우는 길이 없음')
  console.log(`  "${PHRASE}"가 나오는 줄 ${seen}개 확인`)
}

// ---- D4
section('D4', '서울시 혼잡도 이름')
{
  const re = /혼잡 단계|혼잡 예측 단계|혼잡 관측 단계|서울시 단계|' 단계예요/
  for (const f of ['src/lib/planText.ts', 'src/lib/plan.ts', 'src/components/Plan.tsx']) {
    readFileSync(path.join(root, f), 'utf-8').split(/\r?\n/).forEach((line, i) => {
      if (re.test(line)) bad(`${f}:${i + 1}에서 서울시 혼잡도를 '단계'로 부름 | ${line.trim()}`)
    })
  }
  console.log('  새 파일 세 개에 서울시 혼잡도를 단계로 부른 문장이 없음')
}

// ---- P6
section('P6', '보정 1회차 항목(소스 사실. 화면 동작은 브라우저 검사가 본다)')
{
  const read = (f) => readFileSync(path.join(root, f), 'utf-8')
  const planTsx = read('src/components/Plan.tsx')
  const planCss = read('src/styles/plan.css')
  const overlay = read('src/lib/planOverlay.ts')
  const detail = read('src/components/PlaceDetail.tsx')
  // 메모 칸: 맞춤법 검사를 끄고(입력한 글이 브라우저 서비스로 나가지 않게), 화면이 숨겨질 때 저장하며, 모두 지운 저장은 따로 알린다
  check((planTsx.match(/<textarea/g) ?? []).length === 1 && !/<input/.test(planTsx), '메모 칸이 textarea 하나(칸 네 개를 map으로 그림)가 아님')
  check(/<textarea[\s\S]*?spellCheck=\{false\}[\s\S]*?\/>/.test(planTsx), '메모 칸에 spellCheck={false}가 없음')
  check(planTsx.includes("'pagehide'") && planTsx.includes("'visibilitychange'") && planTsx.includes("document.visibilityState === 'hidden'"), 'pagehide와 visibilitychange에서 저장하지 않음')
  check(/memoIsEmpty\(latest\.current\) \? PLAN\.memoCleared : PLAN\.memoSaved/.test(planTsx), '메모를 모두 비워 저장할 때 memoCleared를 알리지 않음')
  check(/profile\.enabled && profile\.tags\.sudden > 1 && <p[^>]*>\{SIREN_GUIDE\}/.test(planTsx), '맞춤 켬과 사이렌 민감도가 1보다 클 때만 SIREN_GUIDE를 보이는 줄이 없음')
  check(planTsx.includes('PLAN.whenStale') && planTsx.includes('baseStale &&'), '이전 값 기준 장소에 언제 갈까요 안내가 없음')
  // 스타일: 고정 막대 아래로 포커스가 놓이게 하는 scroll-padding-top, 시트 단추 줄 간격
  const sp = planCss.match(/\.plan-back \{ scroll-padding-top: (\d+)px/)
  check(!!sp && Number(sp[1]) >= 70, `.plan-back의 scroll-padding-top이 막대 높이(58px)에 여유를 더한 값이 아님 ${sp ? sp[1] : '없음'}`)
  check(/\.row\.sheet-actions \{ row-gap: 6px; \}/.test(planCss) && detail.includes('className="row sheet-actions"'), '시트 단추 줄의 줄 간격 규칙이 없음')
  check(!/let seq = 0\b/.test(overlay), 'planOverlay의 표지 번호가 0에서 시작해 새로고침 뒤의 죽은 표지와 겹침')
  console.log('  메모 칸, 저장 시점, 사이렌 문장, 자료 오래됨 안내, scroll-padding, 시트 단추 줄, 표지 번호 시작값 확인')
}

// ---- P7
section('P7', '보정 2회차 항목(소스 사실. 화면 동작은 브라우저 검사가 본다)')
{
  const read = (f) => readFileSync(path.join(root, f), 'utf-8')
  const planTsx = read('src/components/Plan.tsx')
  const planCss = read('src/styles/plan.css')
  // 구역 제목과 바로 가기 단추가 한 이름을 쓴다
  check(L.PLAN.altJump === L.PLAN.altHead && L.PLAN.altHead === '안 맞을 때 가까운 다른 곳', `바로 가기 단추와 구역 제목의 이름 ${L.PLAN.altJump} | ${L.PLAN.altHead}`)
  // 카드 안내는 왜 그 시각인지(권고 시간)를 밝힌다
  check(L.cardOther('21시').includes('권고 시간'), '카드 안내에 권고 시간이 없음')
  // 데모 데이터에서는 서울시 실시간 자료처럼 읽히는 첫 문장을 데모 안내로 바꾸고, 나머지 문장(직선 거리, 이동 시간)은 그대로 둔다
  const live = L.evidenceText(true)
  const demoEv = L.evidenceText(false)
  const tail = L.TXT.evidence.replace(/^[^.]*\.\s*/, '')
  check(live === L.TXT.evidence, '서울시 자료일 때의 비교 범위 문장이 TXT.evidence와 다름')
  check(!demoEv.includes('실시간') && !demoEv.includes('서울시가') && demoEv.startsWith(L.PLAN.altDemo) && tail.length > 20 && demoEv.endsWith(tail), `데모 비교 범위 문장 ${demoEv}`)
  check(/const live = snap\?\.source === 'seoul'/.test(planTsx) && /evidenceText\(live\)/.test(planTsx) && !/\{TXT\.evidence\}/.test(planTsx), "Plan.tsx가 snap.source === 'seoul'로 비교 범위 문장을 가르지 않음")
  check(/const updatedAt = live \? snap\.updatedAt : undefined/.test(planTsx), 'updatedAt(공유 이미지 구역의 조건)이 서울시 자료일 때만 값을 가짐')
  // 메모 안내는 칸마다 잇지 않고 묶음에 한 번만 잇는다
  const ta = planTsx.match(/<textarea[\s\S]*?\/>/)
  check(!!ta && !/aria-describedby/.test(ta[0]), '메모 칸(textarea)에 aria-describedby가 남아 있음')
  check(/role="group" aria-labelledby=\{`\$\{id\}-memo-head`\} aria-describedby=\{`\$\{id\}-memo-note`\}/.test(planTsx) && planTsx.includes('id={`${id}-memo-head`}'), '메모 칸 묶음(role=group)에 이름과 설명이 잇대어 있지 않음')
  // 카드 구역은 머리와 단추를 한 줄에 둔다
  check(/\.plan-card-row \{ display: flex;/.test(planCss) && planTsx.includes('className="plan-card-row"') && !planTsx.includes('plan-make'), '카드 구역 머리 줄(.plan-card-row)이 없음')
  console.log('  이름 통일, 카드 안내, 데모 비교 범위, 메모 설명 연결, 카드 구역 머리 줄 확인')
}

console.log(fail === 0 ? '\n모든 검사 통과' : `\n위반 ${fail}건`)
process.exit(fail === 0 ? 0 : 1)
