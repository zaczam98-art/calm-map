/**
 * 추천 탭 '후보 3곳'의 계산(src/lib/pick.ts)과 화면 문구(src/lib/pickText.ts) 검증.
 * 모델과 외부 주소를 부르지 않고, 받아 둔 공개 스냅샷과 소음 파일로만 돈다.
 *
 * 실행(저장소 루트에서):
 *   node scripts/pick_check.mjs <snapshot.json> <noise.json> [nowKey]
 *   고정 사본: node scripts/pick_check.mjs scripts/fixtures/snapshot-2026-10-13T1106.json scripts/fixtures/noise-2026-10-13.json "2026-10-13 11"
 *   데모 확인: node scripts/pick_check.mjs public/data/snapshot-demo.json scripts/fixtures/noise-2026-10-13.json   (nowKey 없음)
 *
 * 판정(위반이 하나라도 있으면 종료 코드 1)
 *  PK1 풀 조건 위반(붐빔, 데이터 부족, stale, 반경 밖, 칸 없음, 종류 불일치)이 후보에 없음
 *  PK2 후보 수가 3 이하이고, 입력 순서를 100번 섞어도 결과가 같음
 *  PK3 결과가 정렬 키 튜플을 직접 계산한 독립 구현과 같음(네 가지 상태 x 기준 5곳과 서울 전체 x when {null, 14, 17})
 *  PK4 네 가지 상태에서 풀의 집합과 각 장소의 지수가 같음
 *  PK5 whenSlots와 resolveWhen이 nowKey의 시가 0~23일 때 기대값을 냄
 *  PK6 cellFor가 현재 시를 건너뛴 장소에서 '지금' 칸을 돌려주지 않음
 *  PK7 pickText의 모든 문장에 금지어, 엠대시와 엔대시, '추천', '정확'이 없음. 지수 설명 문장에 '오른쪽'이 없음
 *  PK8 카드 표지 낱말과 정렬의 단조성, 표지 낱말이 crowdMarker, noiseMarker의 결과와 같음
 *  PK9 저장소 자료 사실: 121곳 각각의 직선 6km 안 다른 곳 수(중앙값 32, 최소 1, 최대 58)와 3곳 미만인 곳
 *  PK10 why 값(noRange, noData, allBusy, few)과 이유 한 줄(reasonText)
 *  PK11 기준 장소 저장(recPrefs): 왕복, 잘못된 값, 저장소 오류, clearAll
 *  PK12 소음으로 가를 수 없을 때(소음 파일이 없거나 풀에 소음 값이 없음) 안내 줄이 순서를 적용하지 못했다고 밝힘
 *  PK13 '3km보다 멀어요' 표지가 카드에 적힌 거리(소수 첫째 자리)와 같은 값으로 판정됨
 *  PK14 소음이 덜한 곳 안내 줄은 순서가 적용된 때만 사이렌 한계 문장을 담음
 *  PK15 전체 목록 행의 설명 줄이 고른 시각의 칸을 말함
 *  PK16 비 예보 꼬리표가 고른 시각 이후의 예보만 반영함
 *  PK17 어디서의 '서울 전체'와 후보가 없을 때의 '서울 전체에서 찾기'가 같은 길로 저장된 기준 장소를 지우고 '내 위치'는 그대로 둠(S1). '기준 지우기' 단추가 없음(S2). 혼잡 점수 한 이름(S3)
 *  PK18 후보 카드 옆 '외출 계획 세우기'(F1): 카드 button의 형제, 표시 조건, 시각 값을 먼저 넘김, 전체 목록 행에는 없음, 시트가 계획을 함께 여는 연결
 *  PK19 rankKey가 sortKey의 가운데 토막과 같음
 */
import { readFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'
import { build } from 'esbuild'

const root = process.cwd()
const [snapPath, noisePath, nowKeyArg] = process.argv.slice(2)
if (!snapPath || !noisePath) {
  console.log('사용법: node scripts/pick_check.mjs <snapshot.json> <noise.json> [nowKey 예: "2026-10-13 11"]')
  process.exit(1)
}
const nowKey = nowKeyArg || undefined
const readJson = (f) => JSON.parse(readFileSync(f, 'utf-8').replace(/^﻿/, ''))
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex')
const snap = readJson(snapPath)
const noise = readJson(noisePath)
const places = readJson(path.join(root, 'src/data/places.json')).filter((p) => p.tracked)

mkdirSync(path.join(root, '.tmp'), { recursive: true })
const out = path.join(root, '.tmp', 'pick_check_bundle.cjs')
await build({
  stdin: {
    contents: `
      export * from './src/lib/index.ts'
      export * from './src/lib/nearby.ts'
      export * from './src/lib/nearbyText.ts'
      export * from './src/lib/pick.ts'
      export * from './src/lib/pickText.ts'
      export * from './src/lib/scoreWords.ts'
      export * from './src/lib/recPrefs.ts'
      export { hasPlanCells } from './src/lib/plan.ts'
      export { clearAll, KEY_REC_ANCHOR } from './src/lib/profile.ts'
      export { noiseLookup } from './src/lib/noise.ts'
      export { factorTags, activeControls } from './src/lib/factors.ts'
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
  define: { 'import.meta.env': '{"BASE_URL":"/"}' }, // profile.ts가 끌어오는 publicData.ts가 읽는다
  outfile: out,
  logLevel: 'error',
})
const L = createRequire(import.meta.url)(out)

const FIXTURE = {
  snapshot: '4e491530e0cac037b7c0be7403bb1869662127f7d8972d72f11023ec5d1c4b24',
  noise: '8758d25300118d845c1460e14eb3cef44353a4277d61f130d066f99cb0405d22',
  nowKey: '2026-10-13 11',
}
const isFixture = sha(snapPath) === FIXTURE.snapshot && sha(noisePath) === FIXTURE.noise && nowKey === FIXTURE.nowKey
console.log(`입력: ${snapPath} / nowKey ${nowKey ?? '(없음, 데모)'} / 고정 사본 ${isFixture ? '예' : '아니요(명세의 재현 수치는 값만 보임)'}`)

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

const sampleProfile = { enabled: true, tags: Object.fromEntries(L.SENSE_TAGS.map((t) => [t, t === 'sudden' ? 1.5 : 1])), crowd: 1.5, loud: 1.5 }
const PROFILES = [
  ['맞춤 끔', null],
  ['샘플 프로필', sampleProfile],
]
const noSound = () => undefined
const makeSeries = (profile, offsets = {}) =>
  new Map(places.map((p) => [p.name, L.hourScores(snap.places[p.name], noSound, profile, offsets[p.name] ?? 0, nowKey, L.noiseLookup(noise, p.name))]))
const staleOf = (p) => snap.places[p.name]?.stale === true
const clockOf = (S) => L.clockOf(nowKey, [...S.values()])
const rowsFor = (S, clock, origin, when, stale = staleOf) =>
  places.map((p) => ({
    place: p,
    km: origin ? L.distanceKm(origin, p) : null,
    cell: L.cellFor(S.get(p.name), when, nowKey, clock),
    stale: stale(p),
  }))

const byName = new Map(places.map((p) => [p.name, p]))
const ANCHOR_NAMES = ['서울역', '강남역', '어린이대공원', '서울대공원', '경복궁', '홍대입구역(2호선)']
const anchors = ANCHOR_NAMES.map((n) => byName.get(n)).filter(Boolean)
if (anchors.length < ANCHOR_NAMES.length) console.log(`  참고: 기준 장소 중 목록에 없는 이름이 있음(${ANCHOR_NAMES.filter((n) => !byName.has(n)).join(', ')})`)
const ORIGINS = [['서울 전체', null], ...anchors.map((a) => [`${a.name} 근처`, a])]
const PRIORITIES = [null, 'crowd', 'noise', 'near']
const CATSETS = [[], ['공원'], ['인구밀집지역']]

// 정렬 키를 독립적으로 다시 만든다(pick.ts의 sortKey를 부르지 않는다)
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const refSpike = (nz) => (nz && nz.max !== null ? clampN((nz.max - nz.avg - 3) * 4, 0, 20) : 0)
function refKey(r, pr) {
  const c = r.cell
  const R = c.level === 'calm' ? 0 : 1
  const d = r.km ?? 0
  if (pr === 'crowd') return [R, Math.round(c.parts.c), c.index, d]
  if (pr === 'noise') return c.nz ? [R, 0, Math.round(c.nz.avg), refSpike(c.nz), c.index, d] : [R, 1, 0, 0, c.index, d]
  if (pr === 'near') return [R, d, c.index]
  return [R, c.index, d]
}
function refPick(rows, cats, pr, maxKm = 6, limit = 3) {
  const pool = rows.filter(
    (r) =>
      (cats.length === 0 || cats.includes(r.place.category)) &&
      (r.km === null || r.km <= maxKm) &&
      !r.stale &&
      r.cell &&
      r.cell.index !== null &&
      (r.cell.level === 'calm' || r.cell.level === 'mid'),
  )
  // 키 전체를 문자열 비교가 아닌 숫자 비교로 정렬한다
  const sorted = pool
    .map((r) => ({ r, k: refKey(r, pr) }))
    .sort((a, b) => {
      for (let i = 0; i < a.k.length; i++) if (a.k[i] !== b.k[i]) return a.k[i] < b.k[i] ? -1 : 1
      return a.r.place.id < b.r.place.id ? -1 : 1
    })
    .map((x) => x.r)
  return { pool: sorted, picks: sorted.slice(0, limit) }
}

// 시험에 쓰는 상태 목록: 맞춤 2종 x 기준 6곳 x when 3종 x 종류 3종
const states = []
for (const [pn, profile] of PROFILES) {
  const S = makeSeries(profile)
  const clock = clockOf(S)
  for (const [on, origin] of ORIGINS) for (const when of [null, 14, 17]) states.push({ pn, S, clock, on, origin, when })
}
console.log(`상태 수: ${states.length} (맞춤 ${PROFILES.length} x 기준 ${ORIGINS.length} x when 3), 종류 ${CATSETS.length} x 우선순위 ${PRIORITIES.length}`)

// ---------- PK1 ----------
section('PK1', '풀 조건 위반이 후보에 없음')
{
  let runs = 0
  let picked = 0
  const excluded = { busy: 0, stale: 0, far: 0, nocell: 0, kind: 0 }
  const synthStale = new Set(places.filter((_, i) => i % 7 === 0).map((p) => p.name)) // 합성: 17곳을 stale로 본다
  for (const st of states) {
    const rows = rowsFor(st.S, st.clock, st.origin, st.when, (p) => staleOf(p) || synthStale.has(p.name))
    for (const cats of CATSETS) {
      for (const pr of PRIORITIES) {
        const res = L.pickCandidates(rows, { cats, priority: pr })
        runs++
        for (const r of [...res.picks, ...res.pool]) {
          picked++
          const tag = `${st.pn} ${st.on} when=${st.when} cats=${cats.join('/') || '전체'} ${pr ?? '없음'} ${r.place.name}`
          check(r.cell && r.cell.index !== null, `칸 없음 ${tag}`)
          check(r.cell.level === 'calm' || r.cell.level === 'mid', `붐빔이나 데이터 부족이 들어옴 ${tag} ${r.cell.level}`)
          check(!r.stale, `stale가 들어옴 ${tag}`)
          check(cats.length === 0 || cats.includes(r.place.category), `종류 불일치 ${tag}`)
          check(r.km === null || r.km <= 6, `반경 밖 ${tag} ${r.km}`)
        }
      }
    }
    // 어떤 이유로 몇 곳이 빠졌는지(시험이 무의미하지 않은지 확인)
    for (const r of rows) {
      if (!r.cell || r.cell.index === null) excluded.nocell++
      else if (r.cell.level === 'busy') excluded.busy++
      if (r.stale) excluded.stale++
      if (r.km !== null && r.km > 6) excluded.far++
    }
  }
  console.log(`  ${runs}개 조합, 풀과 후보 합계 ${picked}건 검사. 걸러진 행(전 상태 합): 붐빔 ${excluded.busy}, stale ${excluded.stale}, 반경 밖 ${excluded.far}, 칸 없음 ${excluded.nocell}`)
  check(excluded.busy > 0 && excluded.far > 0 && excluded.stale > 0, '시험 자료에 걸러질 행이 없어서 검사가 무의미함')
}

// ---------- PK2 ----------
section('PK2', '후보 수 3 이하, 입력 순서를 섞어도 같은 결과')
{
  let seed = 20261013
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
  const shuffle = (a) => {
    const b = a.slice()
    for (let i = b.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1))
      ;[b[i], b[j]] = [b[j], b[i]]
    }
    return b
  }
  let runs = 0
  for (const st of states.filter((_, i) => i % 3 === 0)) {
    const rows = rowsFor(st.S, st.clock, st.origin, st.when)
    for (const pr of PRIORITIES) {
      const base = L.pickCandidates(rows, { cats: [], priority: pr })
      check(base.picks.length <= 3, `후보가 3곳을 넘음 ${base.picks.length}`)
      const before = rows.map((r) => r.place.name)
      const baseNames = names(base.pool)
      for (let k = 0; k < 100; k++) {
        const res = L.pickCandidates(shuffle(rows), { cats: [], priority: pr })
        runs++
        if (!same(names(res.pool), baseNames)) {
          bad(`섞은 입력의 풀 순서가 다름 ${st.pn} ${st.on} when=${st.when} ${pr ?? '없음'}`)
          break
        }
      }
      check(same(rows.map((r) => r.place.name), before), '입력 배열이 바뀜')
    }
  }
  console.log(`  섞은 입력 ${runs}회`)
}

// ---------- PK3 ----------
section('PK3', '독립 구현(키 튜플 직접 계산)과 같음')
{
  let runs = 0
  let diffTop = 0
  for (const st of states) {
    const rows = rowsFor(st.S, st.clock, st.origin, st.when)
    for (const cats of CATSETS) {
      let none = null
      for (const pr of PRIORITIES) {
        const res = L.pickCandidates(rows, { cats, priority: pr })
        const ref = refPick(rows, cats, pr)
        runs++
        if (!same(names(res.pool), names(ref.pool))) bad(`풀 순서 불일치 ${st.pn} ${st.on} when=${st.when} cats=${cats.join('/') || '전체'} ${pr ?? '없음'}\n    구현 ${names(res.pool).slice(0, 4)}\n    독립 ${names(ref.pool).slice(0, 4)}`)
        check(same(names(res.picks), names(ref.picks)), `후보 불일치 ${st.pn} ${st.on} when=${st.when} ${pr ?? '없음'}`)
        if (pr === null) none = res
        else if (!same(names(res.picks), names(none.picks))) diffTop++
      }
    }
  }
  console.log(`  ${runs}개 조합. 우선순위가 후보 3곳을 바꾼 경우 ${diffTop}건(참고)`)
}

// ---------- PK4 ----------
section('PK4', '네 가지 상태에서 풀의 집합과 지수가 같음')
{
  let runs = 0
  for (const st of states) {
    const rows = rowsFor(st.S, st.clock, st.origin, st.when)
    for (const cats of CATSETS) {
      const results = PRIORITIES.map((pr) => L.pickCandidates(rows, { cats, priority: pr }))
      const base = results[0]
      const setOf = (res) => [...names(res.pool)].sort()
      const idxOf = (res) => res.pool.map((r) => [r.place.name, r.cell.index]).sort((x, y) => (x[0] < y[0] ? -1 : 1))
      for (const res of results.slice(1)) {
        runs++
        check(same(setOf(res), setOf(base)), `풀의 집합이 우선순위에 따라 다름 ${st.pn} ${st.on} when=${st.when}`)
        check(same(idxOf(res), idxOf(base)), `지수가 우선순위에 따라 다름 ${st.pn} ${st.on} when=${st.when}`)
        check(res.why === base.why || (res.why === 'few') === (base.why === 'few'), `why가 우선순위에 따라 다름 ${st.pn} ${st.on} ${res.why} ${base.why}`)
      }
      // 지수는 hourScores가 만든 칸 그대로여야 한다
      for (const r of base.pool) {
        const c = L.cellFor(st.S.get(r.place.name), st.when, nowKey, st.clock)
        check(c === r.cell && c.index === r.cell.index, `칸이 바뀜 ${r.place.name}`)
      }
    }
  }
  console.log(`  ${runs}회 비교`)
}

// ---------- PK5 ----------
section('PK5', 'whenSlots, resolveWhen, phaseOf (nowKey의 시 0~23)')
{
  // 합성: 지금 시부터 12시간 뒤까지 칸이 있는 장소 하나. 자정을 넘는 칸은 다음 날짜
  const synth = (h, date = '2026-10-13') => {
    const cells = []
    for (let t = 0; t <= 12; t++) {
      const hh = (h + t) % 24
      const d = h + t >= 24 ? '2026-10-14' : date
      cells.push({ time: `${d} ${String(hh).padStart(2, '0')}:00`, hour: hh, index: 20, level: 'calm', soundN: 0, forecast: t > 0, noise: false })
    }
    return cells
  }
  const slotsRef = (h) => {
    const out = []
    for (let x = Math.max(h + 1, 8); x <= Math.min(21, 23, h + 12); x++) out.push(x)
    return out
  }
  for (let h = 0; h < 24; h++) {
    const nk = `2026-10-13 ${String(h).padStart(2, '0')}`
    const lists = [synth(h)]
    const clock = L.clockOf(nk, lists)
    check(clock.date === '2026-10-13' && clock.hour === h, `clockOf ${h}`)
    const slots = L.whenSlots(lists, clock)
    check(same(slots, slotsRef(h)), `슬롯 ${h}시: ${JSON.stringify(slots)} != ${JSON.stringify(slotsRef(h))}`)
    const phase = h < 8 ? 'before' : h > 21 ? 'after' : 'now'
    check(L.phaseOf(h) === phase, `phase ${h}시`)
    const firstOrNull = phase === 'now' ? null : (slots[0] ?? null)
    check(L.resolveWhen(null, slots, clock) === firstOrNull, `resolveWhen(null) ${h}시 ${L.resolveWhen(null, slots, clock)} != ${firstOrNull}`)
    for (const w of [5, 8, 10, 14, 17, 21, 22]) {
      const want = slots.includes(w) ? w : firstOrNull
      check(L.resolveWhen(w, slots, clock) === want, `resolveWhen(${w}) ${h}시 ${L.resolveWhen(w, slots, clock)} != ${want}`)
    }
    if (h >= 22 || h < 8) check(L.hasLaterDay(lists, clock) === (h + 12 >= 24), `hasLaterDay ${h}시`)
  }
  // 명세가 든 예: 5시는 8~17, 15시는 16~21, 22시 이후는 빈 목록, 지나간 when은 지금으로
  const at = (h) => L.whenSlots([synth(h)], L.clockOf(`2026-10-13 ${String(h).padStart(2, '0')}`, [synth(h)]))
  check(same(at(5), [8, 9, 10, 11, 12, 13, 14, 15, 16, 17]), '5시 슬롯이 8~17이 아님')
  check(same(at(15), [16, 17, 18, 19, 20, 21]), '15시 슬롯이 16~21이 아님')
  check(at(22).length === 0 && at(23).length === 0, '22시 이후에 슬롯이 있음')
  check(L.resolveWhen(10, at(15), { date: '2026-10-13', hour: 15 }) === null, '지나간 when이 지금으로 돌아가지 않음')
  // 슬롯은 stale가 아닌 장소의 합집합이고 어제 날짜의 칸은 세지 않는다
  const yesterday = synth(9, '2026-10-12').slice(0, 3)
  check(same(L.whenSlots([yesterday], { date: '2026-10-13', hour: 5 }), []), '어제 날짜의 칸이 슬롯에 들어감')
  // 데모(nowKey 없음)는 첫 칸의 날짜와 시를 쓴다
  const demoClock = L.clockOf(undefined, [[], synth(14)])
  check(demoClock && demoClock.date === '2026-10-13' && demoClock.hour === 14, 'nowKey가 없을 때 첫 칸에서 뽑지 못함')
  check(L.clockOf(undefined, [[], []]) === null, '칸이 없을 때 null이 아님')
  console.log('  24개 시각 x 슬롯, 단계, resolveWhen 검사')
}

// ---------- PK6 ----------
section('PK6', 'cellFor: 현재 시를 건너뛴 장소의 지금 칸')
{
  const mk = (time, hour) => ({ time, hour, index: 20, level: 'calm', soundN: 0, forecast: true, noise: false })
  const skipped = [mk('2026-10-13 12:00', 12), mk('2026-10-13 13:00', 13)]
  const clock = { date: '2026-10-13', hour: 11 }
  check(L.cellFor(skipped, null, '2026-10-13 11', clock) === undefined, '현재 시를 건너뛴 장소에서 지금 칸을 돌려줌')
  check(L.cellFor(skipped, null, undefined, clock) === skipped[0], '데모(nowKey 없음)는 첫 칸을 돌려줘야 함')
  check(L.cellFor([mk('2026-10-13 11:00', 11), ...skipped], null, '2026-10-13 11', clock)?.hour === 11, '지금 칸이 있는데 못 찾음')
  check(L.cellFor(skipped, 13, '2026-10-13 11', clock) === skipped[1], '숫자 when의 칸을 못 찾음')
  check(L.cellFor(skipped, 9, '2026-10-13 11', clock) === undefined, '없는 시각의 칸을 돌려줌')
  const tomorrow = [mk('2026-10-14 02:00', 2)]
  check(L.cellFor(tomorrow, 2, '2026-10-13 23', { date: '2026-10-13', hour: 23 }) === undefined, '오늘이 아닌 날짜의 칸을 돌려줌')
  let missing = 0
  for (const [pn, profile] of PROFILES) {
    const S = makeSeries(profile)
    const c = clockOf(S)
    for (const p of places) {
      const s = S.get(p.name)
      const cell = L.cellFor(s, null, nowKey, c)
      if (nowKey) {
        if (cell) check(cell.time.slice(0, 13) === nowKey, `${pn} ${p.name} 지금 칸이 현재 시가 아님 ${cell.time}`)
        if (s.length > 0 && s[0].time.slice(0, 13) !== nowKey) {
          missing++
          check(cell === undefined, `${pn} ${p.name} 지금 칸이 없는데 칸을 돌려줌`)
        }
      } else check(cell === s[0], `${pn} ${p.name} 데모는 첫 칸이어야 함`)
    }
  }
  console.log(`  합성 6건과 장소 ${places.length}곳 x ${PROFILES.length}. 현재 시를 건너뛴 장소 ${missing}건`)
}

// ---------- PK7 ----------
section('PK7', '문구 검사')
const allTexts = []
{
  const add = (s) => {
    if (typeof s === 'string') allTexts.push(s)
  }
  for (const v of Object.values(L.PICK)) add(v)
  for (const [, label] of L.PRIORITIES) add(label)
  for (const p of places) add(L.planOpenLabel(p.name))
  for (const fam of [true, false]) for (const n of [0, 1, 2, 3]) add(L.titleText(fam, n))
  for (const n of [0, 1, 3]) add(L.foundText(n))
  add(L.placeNoneText(121))
  for (const w of [null, 8, 14, 21]) add(L.whenText(w))
  for (const w of ['all', 'gps', 'place']) add(L.whereText(w, '서울역'))
  for (const pr of ['crowd', 'noise', 'near']) for (const o of [true, false]) for (const g of [null, 'file', 'pool']) add(L.guideText(pr, o, g))
  for (const why of ['noRange', 'noData', 'allBusy', 'few'])
    for (const base of [null, '내 위치', '서울역'])
      for (const kind of [null, '공원', '궁궐·유적'])
        for (const when of [null, 14])
          for (const n of [0, 1, 2]) {
            const v = L.emptyView(why, { base, kind, when, n, canNow: true })
            add(v.text)
          }
  for (const v of Object.values(L.EMPTY_BUTTON_TEXT)) add(v)
  for (const o of [true, false]) add(L.foldPickBrief(o))
  for (const en of [true, false]) for (const ap of [true, false]) for (const t of L.foldPickSteps(en, ap)) add(t)
  for (const en of [true, false]) for (const w of [null, 17]) add(L.listIntro(121, w, en))
  // 카드 이유 줄과 표지 낱말: 모든 장소 x 칸
  for (const [, profile] of PROFILES) {
    const S = makeSeries(profile)
    const label = L.makeLabel(nowKey ? nowKey.slice(0, 10) : (S.get(places[0].name)[0]?.time.slice(0, 10) ?? ''))
    for (const p of places) {
      const series = S.get(p.name)
      add(L.rowLineText(undefined, series, label, 14))
      for (const cell of series) {
        add(L.rowLineText(cell, series, label, cell.hour))
        if (cell.index === null || cell.level === 'busy') continue
        for (const isNow of [true, false]) add(L.reasonText(cell, series, label, isNow))
        for (const pr of ['crowd', 'noise', 'near', null]) add(L.priorityMarker(cell, pr) ?? undefined)
      }
    }
  }
  const unique = [...new Set(allTexts)]
  console.log(`  검사한 문구 ${allTexts.length}건 (서로 다른 문구 ${unique.length}건)`)
  for (const t of unique) {
    for (const f of L.FORBIDDEN) if (t.includes(f)) bad(`금지어 '${f}': ${t}`)
    for (const re of L.FORBIDDEN_PATTERNS) if (re.test(t)) bad(`금지 패턴 ${re}: ${t}`)
    if (/[\u2014\u2013]/.test(t)) bad(`엠대시나 엔대시: ${t}`)
    if (t.includes('추천')) bad(`'추천': ${t}`)
    if (t.includes('정확')) bad(`'정확': ${t}`)
    if (/undefined|NaN|\[object/.test(t)) bad(`undefined, NaN, [object: ${t}`)
    // 문장은 요 또는 다로 끝나야 한다(문장 끝에 온점이 있는 것만 본다. 라벨과 단추 글자는 온점이 없다)
    for (const sentence of t.split(/(?<=\.)\s+/)) {
      if (!sentence.endsWith('.')) continue
      const core = sentence.replace(/\.$/, '').replace(/\([^()]*\)$/, '') // 끝의 괄호 설명은 문장 끝으로 보지 않는다
      if (!/[요다]$/.test(core)) bad(`문장이 요나 다로 끝나지 않음: ${sentence}`)
    }
  }
  check(!L.PICK.indexNote.includes('오른쪽'), "지수 설명 문장에 '오른쪽'이 있음")
  check(L.PICK.indexNote === '카드와 행에 적힌 숫자가 지수예요. 지수는 0~100이고 낮을수록 무던해요.', '지수 설명 문장이 명세와 다름')
  check(L.PICK.before === '아직 외출 시간(8~21시) 전이에요.', `before 문장이 명세와 다름: ${L.PICK.before}`)
  check(L.PICK.placeHelp === '고른 장소에서 직선 6km 안의 곳을 찾아요. 고른 장소 이름은 이 기기에만 저장해요.', `placeHelp가 명세와 다름: ${L.PICK.placeHelp}`)
  check(L.titleText(true, 3) === '우리 가족 후보 3곳' && L.titleText(false, 0) === '서울 후보', '제목 분기가 명세와 다름')
  check(L.emptyView('noRange', { base: '서울역', kind: null, when: null, n: 0, canNow: true }).text === '서울역에서 직선 6km 안에는 살펴볼 수 있는 곳이 없어요.', 'noRange 문장이 명세와 다름')
  check(L.emptyView('allBusy', { base: null, kind: null, when: null, n: 0, canNow: true }).text === '지금은 붐비는 곳뿐이에요.', 'allBusy(지금) 문장이 명세와 다름')
  check(L.emptyView('allBusy', { base: null, kind: null, when: 17, n: 0, canNow: true }).text === '오늘 17시에는 붐빌 것으로 예측되는 곳뿐이에요.', 'allBusy(17시) 문장이 명세와 다름')
  check(L.emptyView('noData', { base: null, kind: null, when: 17, n: 0, canNow: true }).buttons.includes('now'), 'noData에 지금으로 보기 단추가 없음')
  check(L.emptyView('noData', { base: null, kind: null, when: null, n: 0, canNow: true }).buttons.length === 0, '지금 기준 noData에 단추가 있음')
  check(L.EMPTY_BUTTON_TEXT.now === '지금으로 보기', '지금으로 보기 단추 글자')
  check(L.foldPickSteps(true, true).length === 7, '접이식 1의 차례가 7줄이 아님')
}

// ---------- PK8 ----------
section('PK8', '표지 낱말과 정렬의 단조성')
{
  const CROWD_RANK = { 여유: 0, 보통: 1, '약간 붐빔': 2, 붐빔: 3 }
  const NOISE_RANK = { 낮음: 0, 보통: 1, 높음: 2 }
  let runs = 0
  let marked = 0
  for (const st of states) {
    const rows = rowsFor(st.S, st.clock, st.origin, st.when)
    const crowd = L.pickCandidates(rows, { cats: [], priority: 'crowd' }).pool
    const noiseP = L.pickCandidates(rows, { cats: [], priority: 'noise' }).pool
    runs++
    // 같은 단계 안에서 혼잡 단계 순위가 줄지 않는다
    for (let i = 1; i < crowd.length; i++) {
      const a = crowd[i - 1].cell
      const b = crowd[i].cell
      if (a.level !== b.level) continue
      if (!a.crowdLevel || !b.crowdLevel) {
        bad(`crowdLevel이 없는 칸 ${crowd[i].place.name}`)
        continue
      }
      check(CROWD_RANK[a.crowdLevel] <= CROWD_RANK[b.crowdLevel], `혼잡 단계 순위가 줄어듦 ${st.pn} ${st.on} when=${st.when}: ${crowd[i - 1].place.name} ${a.crowdLevel} -> ${crowd[i].place.name} ${b.crowdLevel}`)
    }
    // 같은 단계 안에서 평소 소음 낱말 순위가 줄지 않고, 소음 자료가 없는 장소는 그 단계의 맨 뒤
    for (let i = 1; i < noiseP.length; i++) {
      const a = noiseP[i - 1].cell
      const b = noiseP[i].cell
      if (a.level !== b.level) continue
      if (!a.nz) check(!b.nz, `소음 자료가 없는 장소 뒤에 자료가 있는 장소 ${st.pn} ${st.on} when=${st.when}: ${noiseP[i - 1].place.name} -> ${noiseP[i].place.name}`)
      else if (b.nz) check(NOISE_RANK[L.noiseStep(a.nz.avg)] <= NOISE_RANK[L.noiseStep(b.nz.avg)], `소음 낱말 순위가 줄어듦 ${st.pn} ${st.on} when=${st.when}: ${noiseP[i - 1].place.name} -> ${noiseP[i].place.name}`)
    }
    // 표지 낱말은 scoreWords의 함수와 같고, 낱말이 정렬 키의 값과 맞는다
    for (const r of [...crowd.slice(0, 3), ...noiseP.slice(0, 3)]) {
      const c = r.cell
      check(L.priorityMarker(c, 'crowd') === L.crowdMarker(c), `혼잡 표지가 crowdMarker와 다름 ${r.place.name}`)
      check(L.priorityMarker(c, 'noise') === L.noiseMarker(c), `소음 표지가 noiseMarker와 다름 ${r.place.name}`)
      check(L.priorityMarker(c, 'near') === null && L.priorityMarker(c, null) === null, `가까운 곳이나 없음에 표지가 붙음 ${r.place.name}`)
      const cm = L.priorityMarker(c, 'crowd')
      if (c.crowdLevel) {
        marked++
        check(cm !== null && cm.includes(c.crowdLevel) && cm.includes(c.forecast ? '예측' : '관측'), `혼잡 표지 낱말 ${cm}`)
      }
      const nm = L.priorityMarker(c, 'noise')
      if (c.nz) check(nm !== null && nm.includes(`평소 소음 ${L.noiseStep(c.nz.avg)}`) && nm.includes('(길가 센서)'), `소음 표지 낱말 ${nm}`)
      else check(nm === null, `소음 자료가 없는데 표지가 붙음 ${r.place.name}`)
    }
  }
  console.log(`  ${runs}개 상태, 표지 낱말 확인 ${marked}건`)
}

// ---------- PK9 ----------
section('PK9', '저장소 자료 사실(121곳의 직선 6km 안 이웃 수)')
{
  const counts = places.map((p) => ({ name: p.name, n: places.filter((q) => q.name !== p.name && L.distanceKm(p, q) <= 6).length }))
  const sorted = counts.map((c) => c.n).sort((a, b) => a - b)
  const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
  const few = counts.filter((c) => c.n < 3).map((c) => `${c.name}(${c.n})`)
  console.log(`  장소 ${places.length}곳, 이웃 수 중앙값 ${median}, 최소 ${sorted[0]}, 최대 ${sorted[sorted.length - 1]}, 3곳 미만: ${few.join(', ') || '없음'}`)
  check(places.length === 121, `장소 수 ${places.length} != 121`)
  check(median === 32 && sorted[0] === 1 && sorted[sorted.length - 1] === 58, '중앙값 32, 최소 1, 최대 58이 아님')
  check(few.length === 2 && few.includes('서울대공원(1)') && few.includes('청계산(2)'), `3곳 미만이 서울대공원(1), 청계산(2)뿐이 아님: ${few}`)
}

// ---------- PK10 ----------
section('PK10', 'why 값과 이유 한 줄')
{
  const S = makeSeries(null)
  const clock = clockOf(S)
  const seoul = rowsFor(S, clock, null, null)
  const whyTally = {}
  for (const st of states) {
    const rows = rowsFor(st.S, st.clock, st.origin, st.when)
    for (const cats of CATSETS) {
      const res = L.pickCandidates(rows, { cats, priority: null })
      whyTally[res.why ?? '없음'] = (whyTally[res.why ?? '없음'] ?? 0) + 1
      const inRange = rows.filter((r) => (cats.length === 0 || cats.includes(r.place.category)) && (r.km === null || r.km <= 6))
      const valued = inRange.filter((r) => !r.stale && r.cell && r.cell.index !== null)
      const pool = valued.filter((r) => r.cell.level === 'calm' || r.cell.level === 'mid')
      const want = inRange.length === 0 ? 'noRange' : valued.length === 0 ? 'noData' : pool.length === 0 ? 'allBusy' : pool.length < 3 ? 'few' : null
      check(res.why === want, `why ${res.why} != ${want} (${st.pn} ${st.on} when=${st.when} cats=${cats.join('/') || '전체'})`)
      check(res.inRange === inRange.length, 'inRange 개수')
    }
  }
  console.log(`  실제 상태의 why 분포: ${JSON.stringify(whyTally)}`)
  // 합성: 네 가지 모두 만든다
  const mk = (id, cat, level, index, km = null, stale = false) => ({ place: { id, name: id, lat: 0, lng: 0, category: cat, tracked: true }, km, stale, cell: index === null ? undefined : { time: '2026-10-13 11:00', hour: 11, index, level, soundN: 0, forecast: true, noise: false, parts: { c: index, n: null, s: null, w: 0, offset: 0, base: index } } })
  check(L.pickCandidates([mk('P1', '공원', 'calm', 10, 7)], { cats: [], priority: null }).why === 'noRange', '합성 noRange')
  check(L.pickCandidates([mk('P1', '공원', 'calm', 10, 7)], { cats: ['공원'], priority: null, maxKm: 7 }).why === 'few', 'maxKm 인자가 쓰이지 않음')
  check(L.pickCandidates([mk('P1', '공원', 'calm', 10, 2)], { cats: ['발달상권'], priority: null }).why === 'noRange', '합성 noRange(종류)')
  check(L.pickCandidates([mk('P1', '공원', 'calm', null, 1), mk('P2', '공원', 'calm', 5, 1, true)], { cats: [], priority: null }).why === 'noData', '합성 noData')
  check(L.pickCandidates([mk('P1', '공원', 'busy', 90, 1), mk('P2', '공원', 'busy', 80, 2)], { cats: [], priority: null }).why === 'allBusy', '합성 allBusy')
  const few = L.pickCandidates([mk('P1', '공원', 'calm', 10, 1), mk('P2', '공원', 'mid', 40, 2)], { cats: [], priority: null })
  check(few.why === 'few' && few.picks.length === 2, '합성 few')
  const four = L.pickCandidates([1, 2, 3, 4].map((i) => mk(`P${i}`, '공원', 'calm', 10 + i, i)), { cats: [], priority: null })
  check(four.why === null && four.picks.length === 3 && four.pool.length === 4, '합성 후보 4곳에서 3곳을 고르지 못함')
  // 동점은 거리, id 순
  const tie = L.pickCandidates([mk('P3', '공원', 'calm', 10, 2), mk('P1', '공원', 'calm', 10, 2), mk('P2', '공원', 'calm', 10, 1)], { cats: [], priority: null })
  check(same(names(tie.picks), ['P2', 'P1', 'P3']), `동점 처리 ${names(tie.picks)}`)
  // 단계가 우선: 보통이 지수가 낮아도 무던함이 앞
  const tier = L.pickCandidates([mk('P1', '공원', 'mid', 34, 1), mk('P2', '공원', 'calm', 30, 5)], { cats: [], priority: null })
  check(names(tier.picks)[0] === 'P2', '단계 우선이 지켜지지 않음')
  const nearTier = L.pickCandidates([mk('P1', '공원', 'mid', 40, 1), mk('P2', '공원', 'calm', 30, 5)], { cats: [], priority: 'near' })
  check(names(nearTier.picks)[0] === 'P2', '가까운 곳에서도 단계가 먼저여야 함')
  // 기본값: 6km, 3곳
  check(L.NEARBY_MAX_KM === 6 && L.NEARBY_LIMIT === 3, '기본값 상수')
  // reasonText
  let calmN = 0
  let midN = 0
  for (const p of places) {
    const series = S.get(p.name)
    const label = L.makeLabel(clock.date)
    for (const cell of series) {
      if (cell.level === 'calm') {
        calmN++
        check(L.reasonText(cell, series, label, false) === L.runText(L.calmRun(series, cell), cell, label, false), `무던함 이유가 runText와 다름 ${p.name}`)
        check(L.reasonText(cell, series, label, true) === L.runText(L.calmRun(series, cell), cell, label, true), `무던함 이유(지금)가 runText와 다름 ${p.name}`)
      } else if (cell.level === 'mid') {
        midN++
        const r = L.reasonText(cell, series, label, false)
        check(r === `${label(cell.time)} ${cell.forecast ? '예측' : '관측'}으로는 보통 단계예요.`, `보통 이유 문장 ${r}`)
        check(!r.includes('붐빔보다는 낫지만'), '보통 이유에 비교 문장이 들어감')
        check(L.reasonText(cell, series, label, true).startsWith('지금 '), '보통 이유(지금) 시작')
      }
    }
  }
  check(seoul.length === 121, '행 수')
  console.log(`  이유 줄 검사: 무던함 칸 ${calmN}, 보통 칸 ${midN}`)
}

// ---------- PK11 ----------
section('PK11', '기준 장소 저장(recPrefs)')
{
  const store = new Map()
  const fakeLs = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
  }
  globalThis.localStorage = fakeLs
  const KEY = L.KEY_REC_ANCHOR
  check(KEY === 'calmmap.recAnchor.v1', `키 이름 ${KEY}`)
  check(L.loadAnchor() === null, '빈 저장소에서 null이 아님')
  check(L.initialRecUi().where === 'all' && L.initialRecUi().anchor === null, '기준이 없을 때 서울 전체가 아님')
  L.saveAnchor('서울역')
  check(store.get(KEY) === '"서울역"' && L.loadAnchor() === '서울역', '저장과 읽기 왕복')
  const ui = L.initialRecUi()
  check(ui.where === 'place' && ui.anchor === '서울역' && ui.pos === null && ui.when === null && ui.priority === null && ui.group === 0 && ui.byDistance === false, '저장된 기준이 있을 때의 초기 상태')
  store.set(KEY, '"없는 장소"')
  check(L.loadAnchor() === null, '목록에 없는 이름을 썼음')
  store.set(KEY, '{깨진')
  check(L.loadAnchor() === null, '깨진 JSON에서 null이 아님')
  store.set(KEY, '123')
  check(L.loadAnchor() === null, '문자열이 아닌 값을 썼음')
  L.saveAnchor('서울역')
  L.saveAnchor(null)
  check(!store.has(KEY), 'saveAnchor(null)이 키를 지우지 않음')
  // 좌표로 보이는 값이 저장되지 않음: 저장되는 것은 이름 하나
  L.saveAnchor('서울역')
  check(!/\d{2}\.\d{3}/.test([...store.values()].join(' ')), '저장값에 좌표처럼 보이는 숫자가 있음')
  // clearAll
  store.set('calmmap.profile.v1', '{}')
  L.clearAll()
  check(!store.has(KEY) && !store.has('calmmap.profile.v1'), 'clearAll이 기준 장소 키를 지우지 않음')
  // 저장소가 막힌 환경: 예외 없이 동작
  globalThis.localStorage = {
    getItem: () => {
      throw new Error('blocked')
    },
    setItem: () => {
      throw new Error('blocked')
    },
    removeItem: () => {
      throw new Error('blocked')
    },
  }
  let threw = false
  try {
    check(L.loadAnchor() === null, '막힌 저장소에서 null이 아님')
    L.saveAnchor('서울역')
    L.saveAnchor(null)
    check(L.initialRecUi().where === 'all', '막힌 저장소에서 초기 상태')
  } catch {
    threw = true
  }
  check(!threw, '막힌 저장소에서 예외가 남')
  delete globalThis.localStorage
  // 소스 검사: 새 파일의 localStorage 접근이 모두 try 안에 있다
  for (const f of ['src/lib/recPrefs.ts', 'src/components/Recommend.tsx', 'src/components/RecConditions.tsx', 'src/components/RecCandidates.tsx', 'src/lib/pick.ts', 'src/lib/pickText.ts']) {
    if (!existsSync(path.join(root, f))) continue
    const src = readFileSync(path.join(root, f), 'utf-8')
    for (const m of src.matchAll(/localStorage|sessionStorage|navigator\.geolocation\.watchPosition/g)) {
      if (f !== 'src/lib/recPrefs.ts') bad(`${f}에서 직접 ${m[0]}를 씀`)
    }
    if (/fetch\(|XMLHttpRequest|sendBeacon/.test(src)) bad(`${f}에 외부 요청 코드가 있음`)
  }
  console.log('  recPrefs 왕복, 잘못된 값, 막힌 저장소, clearAll, 새 파일의 저장소와 요청 접근 검사')
}

// ---------- PK12 ----------
section('PK12', '소음으로 가를 수 없을 때의 안내 줄')
{
  // 소음 파일을 받지 못한 상태(noise=null): 모든 칸에 소음 값이 없고 '소음이 덜한 곳' 순서는 우선순위 없음과 같다
  const Sno = new Map(places.map((p) => [p.name, L.hourScores(snap.places[p.name], noSound, null, 0, nowKey, L.noiseLookup(null, p.name))]))
  const clockNo = clockOf(Sno)
  let file = 0
  let pool = 0
  let ok = 0
  for (const when of [null, 14, 17]) {
    for (const [, origin] of ORIGINS) {
      const rows = rowsFor(Sno, clockNo, origin, when)
      const none = L.pickCandidates(rows, { cats: [], priority: null })
      const noi = L.pickCandidates(rows, { cats: [], priority: 'noise' })
      if (none.pool.length === 0) {
        check(L.noiseGapOf(noi.pool, false) === null, '풀이 비었는데 이유를 돌려줌')
        continue
      }
      file++
      check(L.noiseGapOf(noi.pool, false) === 'file', `소음 파일이 없는데 file이 아님 (when=${when})`)
      check(same(names(noi.pool), names(none.pool)), `소음 값이 없는데 소음이 덜한 곳 순서가 기본 순서와 다름 (when=${when})`)
    }
  }
  // 소음 파일은 있으나 풀 전체에 소음 값이 없는 상태: 합성
  const mk = (id, nz) => ({ place: { id, name: id, lat: 0, lng: 0, category: '공원', tracked: true }, km: null, stale: false, cell: { time: '2026-10-13 11:00', hour: 11, index: 20, level: 'calm', nz } })
  const bare = L.pickCandidates([mk('P1'), mk('P2'), mk('P3')], { cats: [], priority: 'noise' })
  check(L.noiseGapOf(bare.pool, true) === 'pool', '풀에 소음 값이 없는데 pool이 아님')
  check(L.noiseGapOf(bare.pool, false) === 'file', '파일이 없는데 file이 아님')
  const some = L.pickCandidates([mk('P1'), mk('P2', { avg: 50, max: 52 }), mk('P3')], { cats: [], priority: 'noise' })
  check(L.noiseGapOf(some.pool, true) === null && names(some.picks)[0] === 'P2', '일부라도 소음 값이 있으면 순서를 적용해야 함')
  check(L.noiseGapOf([], true) === null && L.noiseGapOf([], false) === null, '빈 풀은 null이어야 함')
  // 실제 자료(소음 파일 있음): 값이 있는 칸이 한 곳이라도 있으면 null
  for (const st of states) {
    const rows = rowsFor(st.S, st.clock, st.origin, st.when)
    const res = L.pickCandidates(rows, { cats: [], priority: 'noise' })
    const g = L.noiseGapOf(res.pool, true)
    if (g === 'pool') pool++
    else ok++
    check(g === (res.pool.length > 0 && res.pool.every((r) => !r.cell.nz) ? 'pool' : null), '실제 자료에서 이유 판정이 풀과 다름')
  }
  // 문장: 세 갈래가 서로 다르고, 소음이 덜한 곳에만 갈라지며, 다른 칩의 안내 줄은 이유를 받아도 같다
  const g0 = L.guideText('noise', true, null)
  const gf = L.guideText('noise', true, 'file')
  const gp = L.guideText('noise', true, 'pool')
  check(new Set([g0, gf, gp]).size === 3, '세 갈래 문장이 같음')
  check(gf === '소음 자료를 받지 못해서 이 순서는 적용하지 못했어요.', `file 문장 ${gf}`)
  check(gp === '이 후보들은 평소 소음 자료가 없어서 이 순서는 적용하지 못했어요.', `pool 문장 ${gp}`)
  check(g0.includes('평소 소음이 낮은 곳을 앞에 둬요'), '기본 문장이 바뀜')
  for (const pr of ['crowd', 'near']) for (const o of [true, false]) check(L.guideText(pr, o, 'file') === L.guideText(pr, o, null), `${pr}의 안내 줄이 소음 이유에 따라 달라짐`)
  console.log(`  소음 파일이 없는 상태 ${file}건에서 순서가 기본과 같고 file로 판정. 실제 자료 ${states.length}상태: pool ${pool}건, 순서 적용 ${ok}건`)
}

// ---------- PK13 ----------
section('PK13', "'3km보다 멀어요' 표지와 카드에 적힌 거리")
{
  check(L.kmText(3.04) === '3.0' && !L.isFarKm(3.04), '3.04km가 3.0km로 적히는데 멀다는 표지가 붙음')
  check(L.kmText(3.06) === '3.1' && L.isFarKm(3.06), '3.06km가 3.1km로 적히는데 표지가 없음')
  check(!L.isFarKm(3) && !L.isFarKm(2.96) && L.isFarKm(3.2), '경계값 판정')
  // 모든 장소 쌍: 표지가 붙은 거리는 카드에 3.0km로 적히지 않고, 3km 이하로 적힌 거리에는 표지가 없다
  let pairs = 0
  let far = 0
  for (const a of places) {
    for (const b of places) {
      const d = L.distanceKm(a, b)
      if (d > L.NEARBY_MAX_KM) continue
      pairs++
      const shown = Number(L.kmText(d))
      check(L.isFarKm(d) === shown > L.NEARBY_FAR_KM, `표지와 표시 거리가 어긋남 ${a.name} ${b.name} ${d}`)
      if (L.isFarKm(d)) {
        far++
        check(L.kmText(d) !== '3.0', `3.0km에 멀다는 표지 ${a.name} ${b.name} ${d}`)
      }
    }
  }
  console.log(`  6km 안의 장소 쌍 ${pairs}건, 멀다는 표지 ${far}건`)
}

// ---------- PK14 ----------
section('PK14', '소음 안내 줄의 사이렌 한계 문장')
{
  const g0 = L.guideText('noise', true, null)
  check(g0.endsWith(` ${L.SIREN_GUIDE}`), `사이렌 문장이 줄 끝이 아님: ${g0}`)
  check(L.SIREN_GUIDE === '사이렌은 서울시 센서로 알 수 없어요.', `사이렌 문장이 바뀜: ${L.SIREN_GUIDE}`)
  for (const g of ['file', 'pool']) check(!L.guideText('noise', true, g).includes('사이렌'), `순서를 적용하지 못한 안내 줄(${g})에 사이렌 문장이 있음`)
  for (const pr of ['crowd', 'near']) for (const o of [true, false]) check(!L.guideText(pr, o).includes('사이렌'), `${pr} 안내 줄에 사이렌 문장이 있음`)
  console.log(`  소음 안내 줄 ${g0.length}자`)
}

// ---------- PK15 ----------
section('PK15', '전체 목록 행의 설명 줄')
{
  let n = 0
  let calm = 0
  let none = 0
  for (const [, profile] of PROFILES) {
    const S = makeSeries(profile)
    const label = L.makeLabel(nowKey ? nowKey.slice(0, 10) : (S.get(places[0].name)[0]?.time.slice(0, 10) ?? ''))
    const clock = clockOf(S)
    for (const p of places) {
      const series = S.get(p.name)
      for (let when = 8; when <= 21; when++) {
        const cell = L.cellFor(series, when, nowKey, clock)
        const t = L.rowLineText(cell, series, label, when)
        n++
        if (!cell || cell.index === null) {
          none++
          check(t === `오늘 ${when}시 자료가 없어요.`, `칸이 없는 행의 줄 ${p.name} ${when}시: ${t}`)
        } else if (cell.level === 'calm') {
          calm++
          check(t === L.runText(L.calmRun(series, cell), cell, label, false), `무던함 행의 줄이 runText와 다름 ${p.name} ${when}시`)
        } else {
          check(t === `${label(cell.time)} ${cell.forecast ? '예측' : '관측'}으로는 ${L.LEVEL3_LABEL[cell.level]} 단계예요.`, `보통과 붐빔 행의 줄 ${p.name} ${when}시: ${t}`)
        }
        // 지금 기준 문장('지금부터 N시 전까지')이 고른 시각의 행에 섞이지 않는다
        check(!/^지금/.test(t), `고른 시각의 행에 '지금' 문장 ${p.name} ${when}시: ${t}`)
      }
    }
  }
  console.log(`  장소 x 8~21시 x 프로필 2종 ${n}건 (무던함 ${calm}, 칸 없음 ${none})`)
}

// ---------- PK16 ----------
section('PK16', '비 예보 꼬리표와 고른 시각')
{
  let rainy = 0
  let n = 0
  for (const p of places) {
    const extra = snap.places[p.name]?.extra
    const hours = extra?.weather?.rainHours ?? []
    if (hours.length) rainy++
    for (let from = 0; from <= 23; from++) {
      n++
      const e = L.extraFrom(extra, from)
      const want = hours.filter((h) => h >= from)
      check(same(e?.weather?.rainHours ?? [], want), `${p.name} ${from}시 이후 비 예보 ${JSON.stringify(e?.weather?.rainHours)} (기대 ${JSON.stringify(want)})`)
      const rain = L.factorTags(e).find((t) => t.key === 'rain')
      if (want.length) check(rain?.label === `비 예보 ${Math.min(...want)}시부터`, `${p.name} ${from}시 꼬리표 ${rain?.label}`)
      else check(!rain, `${p.name} ${from}시 이후 비 예보가 없는데 꼬리표가 있음: ${rain?.label}`)
    }
    // 시각을 정하지 않으면 그대로이고, 원본 extra는 바뀌지 않는다
    check(L.extraFrom(extra, undefined) === extra, `${p.name} 시각이 없을 때 extra가 바뀜`)
    check(same(extra?.weather?.rainHours ?? [], hours), `${p.name} 원본 rainHours가 바뀜`)
  }
  check(L.extraFrom(undefined, 12) === undefined, 'extra가 없을 때')
  console.log(`  비 예보가 있는 장소 ${rainy}곳 x 0~23시 ${n}건`)
}

// ---------- PK17 ----------
section('PK17', "서울 전체와 서울 전체에서 찾기가 기준 장소를 지움, 기준 지우기 단추 없음, 혼잡 점수 한 이름")
const readSrc = (f) => readFileSync(path.join(root, f), 'utf-8')
{
  // RecConditions의 칩 세 개 가운데 서울 전체만 onClearAnchor를 부르고, 내 위치와 다른 장소 근처는 기준을 그대로 둔다
  const src = readSrc('src/components/RecConditions.tsx')
  const chipOf = (label) => {
    const end = src.indexOf(`{PICK.${label}}`)
    const start = src.lastIndexOf('<button', end)
    return end < 0 || start < 0 ? '' : src.slice(start, end)
  }
  const all = chipOf('whereAll')
  const gps = chipOf('whereGps')
  const place = chipOf('wherePlace')
  check(all.includes('onClearAnchor()'), '서울 전체 칩이 onClearAnchor를 부르지 않음')
  check(gps !== '' && !gps.includes('onClearAnchor') && !gps.includes('saveAnchor'), '내 위치 칩이 기준 장소를 건드림')
  check(place !== '' && !place.includes('onClearAnchor'), '다른 장소 근처 칩이 기준 장소를 지움')
  // S1: clearAnchor는 저장값을 지우고 anchor와 where를 서울 전체로 돌리며, 서울 전체 칩과 후보가 없을 때의 '서울 전체에서 찾기'가 같은 함수를 부른다
  const rec = readSrc('src/components/Recommend.tsx')
  check(/const clearAnchor = \(\) => \{\s*saveAnchor\(null\)\s*patchUi\(\{ anchor: null, where: 'all' \}\)\s*\}/.test(rec), 'clearAnchor가 저장값을 지우고 서울 전체로 돌리지 않음')
  check(/onClearAnchor=\{clearAnchor\}/.test(rec), '서울 전체 칩이 clearAnchor를 부르지 않음')
  check(/if \(b === 'allSeoul'\) clearAnchor\(\)/.test(rec), "'서울 전체에서 찾기'가 clearAnchor를 부르지 않음")
  check(!/patchUi\(\{ where: 'all' \}\)/.test(rec), '저장값을 지우지 않고 where만 바꾸는 호출이 남음')
  check(L.EMPTY_BUTTON_TEXT.allSeoul === '서울 전체에서 찾기', "'서울 전체에서 찾기' 단추 글자")
  // S2: '기준 지우기' 단추와 문구 키가 없고, 지우는 길을 말하는 문장이 두 길(서울 전체, 맞춤·기록 지우기)로 맞춰져 있다
  check(!('clearAnchor' in L.PICK), 'PICK.clearAnchor가 남음')
  check((src.match(/onClearAnchor\(\)/g) ?? []).length === 1 && !src.includes('PICK.clearAnchor'), 'RecConditions에 서울 전체 칩 말고 기준 지우기 호출이 남음')
  const gone = '기준 ' + '지우기'
  for (const f of ['src/lib/pickText.ts', 'src/components/RecConditions.tsx', 'src/components/Recommend.tsx', 'src/components/Info.tsx', 'README.md']) check(!readSrc(f).includes(gone), `${f}에 '${gone}'가 남음`)
  check(readSrc('src/components/Info.tsx').includes('"어디서" 단추를 열고 "서울 전체"를 눌러도 지울 수 있습니다.'), '정보 탭의 지우는 길 문장')
  check(readSrc('README.md').includes('"서울 전체에서 찾기"') && readSrc('README.md').includes('"이 기기의 맞춤·기록 지우기"'), 'README의 지우는 길 문장')
  // S3: 시트 첫 막대와 덜 붐비는 곳 안내 줄이 '혼잡 점수' 한 이름을 쓰고, 옛 이름은 어디에도 없다
  const bar = readSrc('src/components/WhyIndex.tsx').match(/key: 'c', text: '([^']+)'/)?.[1]
  check(bar === '혼잡 점수', `시트 첫 막대 이름: ${bar}`)
  for (const o of [true, false]) {
    const g = L.guideText('crowd', o)
    check(g === '같은 단계 안에서 혼잡 점수가 낮은 곳을 앞에 둬요. 지수는 그대로라서 순서와 다르게 보일 수 있어요.', `덜 붐비는 곳 안내 줄이 명세와 다름: ${g}`)
  }
  // 소음이 덜한 곳의 문장은 그대로
  check(L.guideText('noise', true, null).startsWith('같은 단계 안에서 평소 소음이 낮은 곳을 앞에 둬요. 지수는 그대로라서 순서와 다르게 보일 수 있어요.'), '소음이 덜한 곳 문장이 바뀜')
  const old = '혼잡만 ' + '보면'
  const walk = (dir) => readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(tsx?|css)$/.test(e.name) ? [path.join(dir, e.name)] : []))
  for (const f of [...walk('src'), 'README.md']) check(!readSrc(f).includes(old), `${f}에 옛 이름이 남음`)
  console.log(`  덜 붐비는 곳 안내 줄: ${L.guideText('crowd', true)}`)
}

// ---------- PK18 ----------
section('PK18', "후보 카드의 '외출 계획 세우기'(F1) 소스 사실")
{
  const cand = readSrc('src/components/RecCandidates.tsx')
  const rec = readSrc('src/components/Recommend.tsx')
  const detail = readSrc('src/components/PlaceDetail.tsx')
  const app = readSrc('src/App.tsx')
  // 카드 본체가 button이므로 계획 단추는 같은 li 안의 형제다(중첩 button 금지)
  const li = cand.match(/<li key=\{c\.name\}>([\s\S]*?)<\/li>/)?.[1] ?? ''
  const opens = [...li.matchAll(/<button\b/g)].map((m) => m.index)
  const closes = [...li.matchAll(/<\/button>/g)].map((m) => m.index)
  check(opens.length === 2 && closes.length === 2 && opens[1] > closes[0], '계획 단추가 카드 button 안에 들어 있거나 button이 둘이 아님')
  check(li.includes('className="rec-item cand-item"') && li.includes('className="btn cand-plan"'), '카드와 계획 단추의 클래스')
  check(li.includes('c.canPlan &&') && li.includes('aria-label={planOpenLabel(c.name)}') && li.includes('{PICK.planOpen}'), '계획 단추의 표시 조건, 접근 가능한 이름, 글자')
  // 전체 목록 행에는 계획 단추를 더하지 않는다
  const listPart = rec.slice(rec.indexOf('<ul className="rec-list">'))
  check(listPart.length > 100 && !/PICK\.planOpen|cand-plan|onOpenPlan/.test(listPart), '전체 목록 행에 계획 단추가 있음')
  // 표시 조건은 시트의 단추와 같은 함수다
  check(rec.includes('canPlan: hasPlanCells(r.scores)') && detail.includes('const canPlan = !tooOld && hasPlanCells(scores)'), '표시 조건이 시트와 같은 hasPlanCells가 아님')
  check(L.hasPlanCells([]) === false && L.hasPlanCells([{ index: null }]) === false && L.hasPlanCells([{ index: null }, { index: 0 }]) === true, 'hasPlanCells의 판정')
  // 누르면 지도 시각을 추천 탭 '언제' 값으로 바꾼 다음에 그 장소의 시트와 계획을 연다
  check(/onOpenPlan=\{\(name\) => \{\s*onSelectHour\(when\)\s*onOpenPlan\(name\)\s*\}\}/.test(rec), 'onSelectHour(when)을 먼저 부르지 않음')
  // App: 신호 하나로 시트를 계획과 함께 열고(카드 전환 없이 openPlace), 시트가 신호를 받으면 지운다
  check(/onOpenPlan=\{\(name\) => \{\s*setPlanFor\(name\)\s*openPlace\(name\)\s*\}\}/.test(app), 'App의 onOpenPlan이 신호를 정하고 openPlace를 부르지 않음')
  check(app.includes('openPlan={planFor !== null && planFor === selected}') && app.includes('onPlanOpened={() => setPlanFor(null)}'), 'App이 시트에 계획 신호를 넘기지 않음')
  check(app.includes('priority={recUi.priority}') && app.includes('onPriority={(priority) => setRecUi((u) => ({ ...u, priority }))}'), 'App이 시트에 우선순위 값과 setter를 넘기지 않음')
  check(/if \(!openPlan\) return\s*onPlanOpened\?\.\(\)\s*if \(canPlan\) plan\.openPlan\(\)/.test(detail), 'PlaceDetail이 마운트 때 canPlan일 때만 계획을 열지 않음')
  // 문구: 보이는 글자로 시작하는 접근 가능한 이름
  check(L.PICK.planOpen === '외출 계획 세우기', `단추 글자: ${L.PICK.planOpen}`)
  for (const p of places) check(L.planOpenLabel(p.name) === `외출 계획 세우기, ${p.name}` && L.planOpenLabel(p.name).startsWith(L.PICK.planOpen), `접근 가능한 이름 ${L.planOpenLabel(p.name)}`)
  // 모양: 테두리와 모서리는 li가 갖고, 카드 본체와 계획 단추는 테두리 없이 그 안에 한 덩어리로 들어간다(단추가 자기 카드의 것으로 읽힘). 단추 높이는 .btn의 44px 이상.
  const css = readSrc('src/styles/recommend.css')
  check(/\.cand-list > li \{ border: 1px solid var\(--ctl-line\); border-radius: var\(--radius\);/.test(css), 'li가 카드의 테두리와 모서리를 갖지 않음')
  check(/button\.cand-item \{[^}]*border: 0;/.test(css) && /button\.cand-plan \{[^}]*margin: 0;[^}]*border: 0; border-top: 1px solid var\(--line\);/.test(css), '카드 본체와 계획 단추가 테두리 없이 한 덩어리가 아님')
  // 보정: 시트의 단추는 배포된 글자 그대로이고(카드의 단추만 새 글자), 계획과 함께 여는 시트는 처음부터 함께 그리며, 같은 장소의 시트가 열려 있어도 신호를 읽는다
  const planTextSrc = readSrc('src/lib/planText.ts')
  check(planTextSrc.includes("open: '외출 계획 만들기',") && detail.includes('>{PLAN.open}</button>'), '시트의 계획 단추 글자가 배포된 "외출 계획 만들기"가 아님')
  check(/\}, \[openPlan\]\)/.test(detail) && detail.includes('usePlanOverlay(planBtn, startPlan, resume)') && detail.includes('const startPlan = canPlan && (openPlan || resume !== null)') && /enterProp && !startPlan/.test(detail) && detail.includes('if (!startPlan) sheet.current?.focus('), '같은 장소의 시트가 열려 있을 때 신호를 읽지 않거나, 시트가 계획보다 먼저 그려지거나, 계획의 포커스를 시트가 덮음')
  check(readSrc('src/lib/planOverlay.ts').includes('useState(startOpen)') && rec.includes('className="rec-title" tabIndex={-1}') && detail.includes("document.querySelector<HTMLElement>('.rec-title')"), '시트를 닫을 때 누른 카드가 사라진 경우의 포커스 되돌림')
  console.log('  카드 형제 단추, 표시 조건, 시각 값 순서, App과 PlaceDetail 연결 확인')
}

// ---------- PK19 ----------
section('PK19', 'rankKey가 sortKey의 가운데 토막과 같음')
{
  let n = 0
  for (const [, profile] of PROFILES) {
    const S = makeSeries(profile)
    for (const p of places) {
      for (const cell of S.get(p.name)) {
        if (cell.index === null || (cell.level !== 'calm' && cell.level !== 'mid')) continue
        const r = { place: p, km: 3.25, cell, stale: false }
        const R = cell.level === 'calm' ? 0 : 1
        for (const pr of ['crowd', 'noise']) {
          n++
          check(same(L.sortKey(r, pr), [R, ...L.rankKey(cell, pr), cell.index, 3.25]), `sortKey와 rankKey 불일치 ${p.name} ${cell.time} ${pr}`)
        }
      }
    }
  }
  check(same(L.rankKey({ parts: { c: 41.5 } }, 'crowd'), [42]) && same(L.rankKey({ nz: undefined }, 'noise'), [1, 0, 0]), 'rankKey 기본값')
  console.log(`  칸 ${n}건`)
}

console.log(`\n${fail === 0 ? '통과' : `실패 ${fail}건`} ${Object.keys(fails).length ? JSON.stringify(fails) : ''}`)
process.exit(fail === 0 ? 0 : 1)
