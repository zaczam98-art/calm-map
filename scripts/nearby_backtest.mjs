/**
 * 인근 장소 안내의 지난 자료 시험.
 * 수집 이력(history.json)의 관측과 서울시 예측으로 "그 시각에 앱이 받았을 스냅샷"을 다시 만들고, 저장소의 실제 규칙
 * (src/lib/nearby.ts의 calmerNearby, candidateCell)이 고른 후보가 나중에도 기준 장소보다 단계가 낮았는지 센다.
 * 결과는 src/data/nearbyEvidence.json 이다. 독립 구현(rank 배열로 따로 고른 후보)은 calmerNearby와의 일치 검증에만 쓴다.
 *
 * 실행(저장소 루트에서)
 *   생성: node scripts/nearby_backtest.mjs --history scripts/fixtures/history-2026-10-13T1106.json --from "2026-10-08 12" --to "2026-10-13 10" --out src/data/nearbyEvidence.json
 *   대조: node scripts/nearby_backtest.mjs --verify [--out src/data/nearbyEvidence.json] [--readme README.md]
 *   --noise <noise.json>  소음 파일(기본: 고정 사본). --from/--to 'YYYY-MM-DD HH'  기간(기본: 이력 전체). --out 없이 돌리면 파일을 쓰지 않는다.
 *
 * 변형: CW는 혼잡만, CNW는 혼잡에 동네 소음을 더한 지수다(소리와 아이 맞춤은 이력에 없어 둘 다 뺐다). JSON의 기준 값은 CNW이고 CW는 cw에 병기한다.
 * 정렬: 배포 값(TIER_FIRST)으로 JSON을 만들고, 표에는 true와 false를 모두 보인다.
 * 재현: 고정 사본과 전체 기간이면 조사 단계의 핵심 수치(CW, 거리순)를 판정한다. 다르면 종료 코드 1이다.
 * 대조(--verify): JSON의 모양과 기간 문구, rule이 nearby.ts와 같은지, 고정 사본으로 다시 돌린 결과가 JSON과 같은지,
 *   README 마커 사이의 수치와 기간이 JSON에서 나온 값인지 확인한다.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE = {
  history: { file: 'history-2026-10-13T1106.json', sha256: '362ec9defff793810570ac4a4c48369637cfd7e1433a393962e5aa1d9b68c833' },
  noise: { file: 'noise-2026-10-13.json', sha256: '8758d25300118d845c1460e14eb3cef44353a4277d61f130d066f99cb0405d22' },
  from: '2026-10-08 12',
  to: '2026-10-13 10',
}
// 조사 단계 결과(CW, 거리순, 반경별 후보 유무와 기준 장소가 보통 이상인 칸의 1~3시간 뒤 지속)
const REPRO = { pAny: { 1: '35.7', 2: '75.8', 3: '91.8', 6: '99.4' }, persistence: { 1: '73.2', 2: '60.2', 3: '50.6' } }
const EVIDENCE = 'src/data/nearbyEvidence.json'
const MIN_CELLS = 300
const HOUR_KEY = /^\d{4}-\d{2}-\d{2} \d{2}$/

const usage = () => {
  console.log('사용법: node scripts/nearby_backtest.mjs --history <history.json> [--noise <noise.json>] [--from "YYYY-MM-DD HH"] [--to "YYYY-MM-DD HH"] [--out <json>]')
  console.log('        node scripts/nearby_backtest.mjs --verify [--out <json>] [--readme <README.md>]')
  process.exit(1)
}
const argv = process.argv.slice(2)
const opt = {}
let verifyMode = false
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--verify') verifyMode = true
  else if (['history', 'noise', 'from', 'to', 'out', 'readme'].includes(a.slice(2)) && a.startsWith('--') && i + 1 < argv.length) opt[a.slice(2)] = argv[++i]
  else usage()
}
const abs = (f) => path.resolve(f)
const rootPath = (f) => path.join(root, f)
const readJson = (f) => JSON.parse(readFileSync(f, 'utf-8').replace(/^﻿/, ''))
const sha256 = (f) => createHash('sha256').update(readFileSync(f)).digest('hex')
const fileInfo = (f) => ({ file: path.basename(f), sha256: sha256(f), bytes: statSync(f).size })
const fatal = (msg) => {
  console.log(`오류: ${msg}`)
  process.exit(1)
}

mkdirSync(rootPath('.tmp'), { recursive: true })
const bundle = rootPath('.tmp/nearby_backtest_bundle.cjs')
await build({
  stdin: {
    contents: `
      export * from './src/lib/index.ts'
      export * from './src/lib/nearby.ts'
      export { noiseLookup } from './src/lib/noise.ts'
    `,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: bundle,
  logLevel: 'error',
})
const L = createRequire(import.meta.url)(bundle)
const places = readJson(rootPath('src/data/places.json')).filter((p) => p.tracked)
const NP = places.length
const placeIdx = new Map(places.map((p, i) => [p.name, i]))

// ---------- 통계 도우미
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)
const r4 = (x) => (x === null || Number.isNaN(x) ? null : Math.round(x * 10000) / 10000)
/** 4자리로 맺은 비율을 퍼센트 한 자리 문자열로(반올림이 부동소수 경계에 걸리지 않게 정수로 한 번 맺는다) */
const pct1 = (x) => (Math.round(Math.round(x * 1e4) / 10) / 10).toFixed(1)
const share = (n, d) => (d ? n / d : null)

function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const BOOT = 1000
const rng = mulberry32(20261013)
const draws = Array.from({ length: BOOT }, () => Int16Array.from({ length: NP }, () => Math.floor(rng() * NP)))
/** 기준 장소별 (분자, 분모) 합 */
class PA {
  constructor() {
    this.n = new Float64Array(NP)
    this.d = new Float64Array(NP)
  }
  add(p, n, d) {
    this.n[p] += n
    this.d[p] += d
  }
  get rate() {
    const N = this.n.reduce((a, b) => a + b, 0)
    const D = this.d.reduce((a, b) => a + b, 0)
    return D ? N / D : null
  }
}
/** 기준 장소를 단위로 다시 뽑는 부트스트랩(1000회, 95%). 같은 장소의 이어진 시각이 겹치는 한계는 구간에 반영되지 않는다. */
function ci(fn, accs) {
  const out = []
  for (const dr of draws) {
    const tot = accs.map(() => ({ n: 0, d: 0 }))
    for (const p of dr) for (let i = 0; i < accs.length; i++) {
      tot[i].n += accs[i].n[p]
      tot[i].d += accs[i].d[p]
    }
    const v = fn(tot)
    if (v !== null && isFinite(v)) out.push(v)
  }
  out.sort((a, b) => a - b)
  return out.length ? [r4(out[Math.floor(out.length * 0.025)]), r4(out[Math.floor(out.length * 0.975)])] : null
}
const rateCI = (a) => ci((t) => (t[0].d ? t[0].n / t[0].d : null), [a])
const diffCI = (a, b) => ci((t) => (t[0].d && t[1].d ? t[0].n / t[0].d - t[1].n / t[1].d : null), [a, b])

// ---------- 시험 본체
const LV = ['여유', '보통', '약간 붐빔', '붐빔']
const LEADS = [2, 3, 6, 12] // 이력에 남은 예측 시차
const PERSIST_K = [1, 2, 3]
const ARRIVE_K = [2, 3, 6]
const RADII = [1, 2, 3, 6]
const MINWIN = 4 // 재구성한 비교 범위(관측 1 + 예측 n)가 이보다 작은 스냅샷은 쓰지 않는다
const VARIANTS = ['CW', 'CNW']
const pad = (n) => String(n).padStart(2, '0')
const rank3 = (lv) => (lv === 'calm' ? 0 : lv === 'mid' ? 1 : lv === 'busy' ? 2 : -1)
const noSound = () => undefined
const noNoise = () => undefined

function shiftKey(key, k) {
  const d = new Date(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10), +key.slice(11, 13) + k))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}`
}

function compute(historyPath, noisePath, fromArg, toArg) {
  const hist = readJson(historyPath)
  const noise = readJson(noisePath)
  const allKeys = [...new Set(Object.values(hist.obs).flatMap((o) => Object.keys(o)))].sort()
  for (let i = 0; i < allKeys.length; i++) if (allKeys[i] !== shiftKey(allKeys[0], i)) throw new Error('이력의 시각 축이 이어지지 않아요: ' + allKeys[i])
  for (const [name, v] of [['--from', fromArg], ['--to', toArg]]) if (v && !HOUR_KEY.test(v)) fatal(`${name}은 'YYYY-MM-DD HH' 모양이어야 해요: ${v}`)
  const iFrom = fromArg ? allKeys.indexOf(fromArg) : 0
  const iTo = toArg ? allKeys.indexOf(toArg) : allKeys.length - 1
  if (iFrom < 0 || iTo < iFrom) fatal(`기간이 이력의 시각 범위(${allKeys[0]} ~ ${allKeys[allKeys.length - 1]}) 안에 없어요: ${fromArg ?? '처음'} ~ ${toArg ?? '끝'}`)
  const hourKeys = allKeys.slice(iFrom, iTo + 1)
  const NH = hourKeys.length
  const hrOf = hourKeys.map((k) => +k.slice(11, 13))
  const dayOf = hourKeys.map((k) => k.slice(0, 10))
  const hours = NH
  const days = Math.round(hours / 24)
  const period = { from: hourKeys[0], to: hourKeys[NH - 1], hours, days, label: `${hourKeys[0].slice(0, 10)}부터 ${days}일` }

  // 독립 구현이 쓰는 이웃 목록(반경 안, 가까운 순)
  const nbr = places.map((a, i) =>
    places
      .map((b, j) => ({ j, km: L.distanceKm(a, b) }))
      .filter((x) => x.j !== i && x.km <= L.NEARBY_MAX_KM)
      .sort((x, y) => x.km - y.km || x.j - y.j),
  )

  // 스냅샷 재구성: 시각 H에 앱이 받았을 live(관측)와 fcst(발표된 예측 중 이력에 남은 시차 2, 3, 6, 12). 예측은 중앙값만 남아 min=max=중앙값이다.
  function buildSnap(name, key) {
    const o = hist.obs[name]?.[key]
    if (!o || o[0] < 0) return null
    const live = { time: `${key}:00`, level: LV[o[0]], min: o[1], max: o[2] }
    const fcst = []
    for (const lead of LEADS) {
      const tk = shiftKey(key, lead)
      const v = hist.fc[name]?.[tk]?.[String(lead)]
      if (v && v[0] >= 0) fcst.push({ time: `${tk}:00`, level: LV[v[0]], min: v[1], max: v[1], lead })
    }
    return { live, fcst }
  }
  const nzOf = {
    CW: places.map(() => noNoise),
    CNW: places.map((p) => L.noiseLookup(noise, p.name)),
  }
  // ser: 장소 x 시각의 hourScores 결과 전체(실제 규칙이 읽는 칸). rO, rF: 독립 구현이 읽는 단계(0 무던, 1 보통, 2 붐빔, -1 없음)
  const V = Object.fromEntries(
    VARIANTS.map((vn) => [
      vn,
      {
        ser: new Array(NP * NH).fill(null),
        rO: new Int8Array(NP * NH).fill(-1),
        rF: Object.fromEntries(ARRIVE_K.map((k) => [k, new Int8Array(NP * NH).fill(-1)])),
      },
    ]),
  )
  const winHist = {}
  let nSnap = 0
  let nExcluded = 0
  for (let pi = 0; pi < NP; pi++) {
    for (let hi = 0; hi < NH; hi++) {
      const snap = buildSnap(places[pi].name, hourKeys[hi])
      if (!snap) continue
      nSnap++
      const nPts = 1 + snap.fcst.length
      winHist[nPts] = (winHist[nPts] ?? 0) + 1
      if (nPts < MINWIN) {
        nExcluded++
        continue
      }
      const at = pi * NH + hi
      for (const vn of VARIANTS) {
        const sc = L.hourScores(snap, noSound, null, 0, undefined, nzOf[vn][pi])
        const v = V[vn]
        v.ser[at] = sc
        v.rO[at] = rank3(sc[0].level)
        snap.fcst.forEach((f, j) => {
          if (v.rF[f.lead]) v.rF[f.lead][at] = rank3(sc[1 + j].level)
        })
      }
    }
  }

  const sameDayOutHour = (hi, k) => hi + k < NH && dayOf[hi + k] === dayOf[hi] && hrOf[hi + k] <= L.DAY_TO

  function analyze(vn, tierFirst) {
    const v = V[vn]
    const rO = (j, h) => (h >= 0 && h < NH ? v.rO[j * NH + h] : -1)
    /** 실제 규칙: shown 칸과 같은 칸을 가진 장소 중 단계가 낮은 곳을 calmerNearby가 고른다 */
    const pick = (b, hi, shown, maxKm, limit) => L.calmerNearby(places[b], shown.level, places, (p) => L.candidateCell(v.ser[placeIdx.get(p.name) * NH + hi] ?? undefined, shown, false), maxKm, limit, tierFirst)
    // 독립 구현: rank 배열과 이웃 목록만 쓴다
    const indepPick = (b, rk, brk) => {
      const cand = nbr[b].map((x) => ({ ...x, rk: rk(x.j) })).filter((x) => x.rk >= 0 && x.rk < brk)
      if (tierFirst) cand.sort((x, y) => x.rk - y.rk || x.km - y.km || x.j - y.j)
      return cand.slice(0, L.NEARBY_LIMIT).map((x) => x.j)
    }
    const indep = { checked: 0, bad: 0, first: null }
    const compare = (label, items, ref) => {
      indep.checked++
      const got = items.map((it) => placeIdx.get(it.place.name))
      if (got.length !== ref.length || got.some((j, i) => j !== ref[i])) {
        indep.bad++
        indep.first ??= `${label} 실제 ${got.join(',')} 독립 ${ref.join(',')}`
      }
    }

    // 기준 장소가 외출 시간(8~21시)의 관측에서 이미 보통 이상이던 칸
    const cases = []
    for (let hi = 0; hi < NH; hi++) {
      if (hrOf[hi] < 8 || hrOf[hi] > L.DAY_TO) continue
      for (let b = 0; b < NP; b++) {
        const shown = v.ser[b * NH + hi]?.[0]
        if (!shown || (shown.level !== 'mid' && shown.level !== 'busy')) continue
        const picks = pick(b, hi, shown, L.NEARBY_MAX_KM, L.NEARBY_LIMIT)
        compare(`${places[b].name} ${hourKeys[hi]} 지금`, picks, indepPick(b, (j) => rO(j, hi), rO(b, hi)))
        cases.push({ b, hi, shown, picks })
      }
    }

    // 반경별 후보 유무
    const pAny = {}
    for (const r of RADII) {
      const hit = cases.filter((c) => (r === L.NEARBY_MAX_KM ? c.picks : pick(c.b, c.hi, c.shown, r, 1)).length > 0).length
      pAny[r] = r4(share(hit, cases.length))
    }

    // 지금 관측으로 고른 후보가 k시간 뒤(관측)에도 기준 장소보다 단계가 낮은지
    const score = (picks, hk, rB) => {
      const ranks = picks.map((it) => rO(placeIdx.get(it.place.name), hk)).filter((rp) => rp >= 0)
      return { n: ranks.length, rel: ranks.filter((rp) => rp < rB).length, busy: ranks.filter((rp) => rp === 2).length }
    }
    const persistence = {}
    for (const k of PERSIST_K) {
      const lower = new PA()
      const busy = new PA()
      let nCase = 0
      let nPick = 0
      for (const c of cases) {
        if (!c.picks.length || !sameDayOutHour(c.hi, k)) continue
        const rB = rO(c.b, c.hi + k)
        if (rB < 0) continue
        const s = score(c.picks, c.hi + k, rB)
        if (!s.n) continue
        nCase++
        nPick += s.n
        lower.add(c.b, s.rel, s.n)
        busy.add(c.b, s.busy, s.n)
      }
      persistence[k] = { rate: r4(lower.rate), ci95: rateCI(lower), cells: nCase, picks: nPick, toBusy: r4(busy.rate), sameOrHigher: r4(1 - lower.rate) }
    }

    // 도착 시각(k시간 뒤)을 고르고 그 시각의 서울시 예측으로 고른 후보가 그 시각 관측에서 기준 장소보다 단계가 낮은지.
    // arrivalVsNow는 같은 칸에서 지금 관측으로 고른 후보(위의 picks)와 견준다. 둘 다 후보가 있는 칸만 모은다.
    const arrival = {}
    const arrivalVsNow = {}
    for (const k of ARRIVE_K) {
      const rel = new PA()
      const busy = new PA()
      const cFc = new PA()
      const cNow = new PA()
      let nCase = 0
      let nPick = 0
      let nCommon = 0
      for (const c of cases) {
        if (!sameDayOutHour(c.hi, k)) continue
        const hk = c.hi + k
        const series = v.ser[c.b * NH + c.hi]
        const shownF = L.cellAtSameTime(series, hourKeys[hk])
        const fb = v.rF[k][c.b * NH + c.hi]
        if ((shownF ? rank3(shownF.level) : -1) !== fb) {
          indep.checked++
          indep.bad++
          indep.first ??= `${places[c.b].name} ${hourKeys[c.hi]} +${k}h 예측 칸 단계 ${shownF?.level} / ${fb}`
        }
        if (!shownF || shownF.index === null || shownF.level === 'calm') continue
        const rB = rO(c.b, hk)
        if (rB < 0) continue
        const picksF = pick(c.b, c.hi, shownF, L.NEARBY_MAX_KM, L.NEARBY_LIMIT)
        compare(`${places[c.b].name} ${hourKeys[c.hi]} +${k}h 예측`, picksF, indepPick(c.b, (j) => v.rF[k][j * NH + c.hi], fb))
        const sF = score(picksF, hk, rB)
        if (sF.n) {
          nCase++
          nPick += sF.n
          rel.add(c.b, sF.rel, sF.n)
          busy.add(c.b, sF.busy, sF.n)
          const sN = score(c.picks, hk, rB)
          if (sN.n) {
            nCommon++
            cFc.add(c.b, sF.rel, sF.n)
            cNow.add(c.b, sN.rel, sN.n)
          }
        }
      }
      arrival[k] = { rate: r4(rel.rate), ci95: rateCI(rel), cells: nCase, picks: nPick, toBusy: r4(busy.rate), sameOrHigher: r4(1 - rel.rate) }
      arrivalVsNow[k] = { pred: r4(cFc.rate), nowObs: r4(cNow.rate), diffCi95: diffCI(cFc, cNow), cells: nCommon }
    }

    // 배포할 규칙으로 고른 후보까지의 직선 거리
    const kms = cases.flatMap((c) => c.picks.map((it) => it.km))
    const distance = { within3km: r4(share(kms.filter((km) => km <= L.NEARBY_FAR_KM).length, kms.length)), picks: kms.length, meanKm: kms.length ? Math.round(mean(kms) * 100) / 100 : null }
    return { nCases: cases.length, pAny, persistence, arrival, arrivalVsNow, distance, indep }
  }

  const R = {}
  for (const vn of VARIANTS) for (const tf of [false, true]) R[`${vn}:${tf}`] = analyze(vn, tf)
  const deployed = L.TIER_FIRST
  const part = (a) => ({ persistence: a.persistence, arrival: a.arrival, arrivalVsNow: a.arrivalVsNow, distance: { within3km: a.distance.within3km, picks: a.distance.picks } })
  const cnw = R[`CNW:${deployed}`]
  const cw = R[`CW:${deployed}`]
  const evidence = {
    generatedAt: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }),
    input: fileInfo(historyPath),
    noise: { ...fileInfo(noisePath), days: noise.days },
    period,
    rule: { maxKm: L.NEARBY_MAX_KM, limit: L.NEARBY_LIMIT, tierFirst: deployed, variant: 'CNW' },
    reconstruction: '관측 1칸과 서울시 예측 시차 2, 3, 6, 12의 중앙값으로 다시 만든 스냅샷. 소리와 아이 맞춤은 제외',
    ...part(cnw),
    minCells: MIN_CELLS,
    limits: [
      `${days}일 자료`,
      '같은 장소의 이어진 시각이 겹침',
      '장소 단위 부트스트랩이라 구간이 실제보다 좁음',
      '소리와 아이 민감도 제외',
      '아이에게 편한 정도는 재지 않음',
      '기준 장소가 외출 시간(8~21시) 관측에서 이미 보통 이상이던 칸만 시험함',
    ],
    cw: part(cw),
  }
  return { evidence, R, deployed, meta: { period, nSnap, nExcluded, winHist, historyPath, noisePath, noise } }
}

const stringify = (o) => JSON.stringify(o, null, 2).replace(/\[\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]/g, '[$1, $2]') + '\n'

// ---------- 출력 도우미
const line = (s = '') => console.log(s)
function printReport({ evidence, R, deployed, meta }) {
  const e = evidence
  line(`입력 history: ${path.relative(root, meta.historyPath)} sha256 ${e.input.sha256} ${e.input.bytes}B`)
  line(`입력 noise:   ${path.relative(root, meta.noisePath)} sha256 ${e.noise.sha256} ${e.noise.bytes}B (소음 평균 ${e.noise.days}일)`)
  line(`기간: ${e.period.from} ~ ${e.period.to} (${e.period.hours}시간, ${e.period.label})`)
  line(`규칙: 반경 ${e.rule.maxKm}km, 최대 ${e.rule.limit}곳, TIER_FIRST(배포 값) ${deployed}, JSON 기준 변형 ${e.rule.variant}`)
  line(`재구성: 스냅샷 ${meta.nSnap}건, 비교 범위 점 수 ${JSON.stringify(meta.winHist)}, ${MINWIN}점 미만 제외 ${meta.nExcluded}건`)
  line()
  let bad = 0
  line('[독립 구현 일치] calmerNearby 대 rank 배열 독립 구현(지금 관측 기준과 도착 시각 예측 기준 모든 사례)')
  for (const [key, a] of Object.entries(R)) {
    line(`  ${key.padEnd(10)} 비교 ${a.indep.checked}건, 불일치 ${a.indep.bad}건${a.indep.first ? ` (첫 불일치: ${a.indep.first})` : ''}`)
    bad += a.indep.bad
  }
  line()
  line('[결과] 비율은 퍼센트, 괄호는 95% 구간(장소 단위 부트스트랩)')
  for (const [key, a] of Object.entries(R)) {
    const [vn, tf] = key.split(':')
    const p = (x) => pct1(x)
    const per = PERSIST_K.map((k) => `${k}h ${p(a.persistence[k].rate)}(${a.persistence[k].ci95.map(p).join('~')})`).join(' / ')
    const arr = ARRIVE_K.map((k) => `${k}h ${p(a.arrival[k].rate)}(${a.arrival[k].cells}칸)`).join(' / ')
    const avn = ARRIVE_K.map((k) => `${k}h ${p(a.arrivalVsNow[k].pred)} 대 ${p(a.arrivalVsNow[k].nowObs)} 차 ${a.arrivalVsNow[k].diffCi95.map(p).join('~')}%p`).join(' / ')
    line(`  ${vn} 단계 우선=${tf}${String(tf) === String(deployed) ? '(배포 값)' : ''}: 기준 칸 ${a.nCases}`)
    line(`    후보 있는 비율(직선 km): ${RADII.map((r) => `${r}km ${p(a.pAny[r])}`).join(' / ')}`)
    line(`    지금 관측으로 고른 후보가 k시간 뒤 더 낮은 비율: ${per}`)
    line(`    도착 시각 예측으로 고른 후보가 그 시각에 더 낮은 비율: ${arr}`)
    line(`    예측으로 고름 대 지금 관측으로 고름(같은 칸): ${avn}`)
    line(`    후보 ${a.distance.picks}곳, 직선 3km 안 ${p(a.distance.within3km)}%, 평균 ${a.distance.meanKm}km`)
  }
  return bad
}

function reproduce({ R, meta }) {
  const isFix = meta.period.from === FIXTURE.from && meta.period.to === FIXTURE.to && path.basename(meta.historyPath) === FIXTURE.history.file && sha256(meta.historyPath) === FIXTURE.history.sha256 && sha256(meta.noisePath) === FIXTURE.noise.sha256
  const a = R['CW:false']
  line()
  line(`[재현] 조사 단계 핵심 수치 대조(CW, 거리순)${isFix ? '' : ': 고정 사본이나 전체 기간이 아니라서 판정하지 않고 값만 보임'}`)
  let bad = 0
  const row = (label, actual, expected) => {
    const ok = actual === expected
    line(`  ${label}: ${actual}% (조사 ${expected}%${isFix ? (ok ? ', 일치' : ', 다름') : ''})`)
    if (isFix && !ok) bad++
  }
  for (const r of RADII) row(`반경 ${r}km 후보 있는 비율`, pct1(a.pAny[r]), REPRO.pAny[r])
  for (const k of PERSIST_K) row(`지속 ${k}시간 뒤`, pct1(a.persistence[k].rate), REPRO.persistence[k])
  return bad
}

// ---------- 대조 모드
function verify(evPath, readmePath) {
  const errs = []
  const need = (cond, msg) => {
    if (!cond) errs.push(msg)
    return cond
  }
  const ev = readJson(evPath)
  const num = (x) => typeof x === 'number' && Number.isFinite(x)
  const ratio = (x) => num(x) && x >= 0 && x <= 1
  const pair = (x) => Array.isArray(x) && x.length === 2 && x.every(num) && x[0] <= x[1]
  const stat = (o, where) => {
    if (!need(o && ratio(o.rate) && pair(o.ci95) && Number.isInteger(o.cells) && Number.isInteger(o.picks) && ratio(o.toBusy) && ratio(o.sameOrHigher), `${where}: 모양이 달라요`)) return
    need(o.ci95[0] - 0.01 <= o.rate && o.rate <= o.ci95[1] + 0.01, `${where}: 구간이 비율을 감싸지 않아요`)
    need(Math.abs(o.rate + o.sameOrHigher - 1) <= 0.0002, `${where}: rate + sameOrHigher != 1`)
  }
  const vs = (o, where) => need(o && ratio(o.pred) && ratio(o.nowObs) && pair(o.diffCi95) && Number.isInteger(o.cells), `${where}: 모양이 달라요`)
  const block = (b, where) => {
    for (const k of PERSIST_K) stat(b.persistence?.[k], `${where}.persistence.${k}`)
    for (const k of ARRIVE_K) stat(b.arrival?.[k], `${where}.arrival.${k}`)
    for (const k of ARRIVE_K) vs(b.arrivalVsNow?.[k], `${where}.arrivalVsNow.${k}`)
    need(ratio(b.distance?.within3km) && Number.isInteger(b.distance?.picks), `${where}.distance: 모양이 달라요`)
  }
  block(ev, '기준')
  need(ev.cw, 'cw 블록이 없어요')
  if (ev.cw) block(ev.cw, 'cw')

  // rule과 기간
  need(ev.rule?.tierFirst === L.TIER_FIRST, `rule.tierFirst(${ev.rule?.tierFirst})가 nearby.ts의 TIER_FIRST(${L.TIER_FIRST})와 달라요`)
  need(ev.rule?.variant === 'CNW', `rule.variant(${ev.rule?.variant})가 CNW가 아니에요`)
  need(ev.rule?.maxKm === L.NEARBY_MAX_KM && ev.rule?.limit === L.NEARBY_LIMIT, 'rule.maxKm 또는 rule.limit이 nearby.ts와 달라요')
  need(ev.minCells === MIN_CELLS, `minCells가 ${MIN_CELLS}이 아니에요`)
  const p = ev.period
  if (need(p && HOUR_KEY.test(p.from) && HOUR_KEY.test(p.to), 'period.from, period.to 모양이 달라요')) {
    const stamp = (k) => Date.parse(`${k.slice(0, 10)}T${k.slice(11, 13)}:00:00Z`)
    const hours = (stamp(p.to) - stamp(p.from)) / 3600000 + 1
    need(p.hours === hours, `period.hours(${p.hours})가 기간의 시간 수(${hours})와 달라요`)
    need(p.days === Math.round(p.hours / 24), `period.days(${p.days})가 hours / 24의 반올림(${Math.round(p.hours / 24)})과 달라요`)
    need(p.label === `${p.from.slice(0, 10)}부터 ${p.days}일`, `period.label(${p.label})이 기간 문구와 달라요`)
    need(ev.limits?.[0] === `${p.days}일 자료`, `limits[0]이 '${p.days}일 자료'가 아니에요`)
  }
  for (const s of ['같은 장소의 이어진 시각이 겹침', '장소 단위 부트스트랩이라 구간이 실제보다 좁음', '소리와 아이 민감도 제외', '아이에게 편한 정도는 재지 않음']) need(ev.limits?.includes(s), `limits에 '${s}'가 없어요`)

  // 입력 사본과 다시 돌린 결과
  const histFile = rootPath(path.join('scripts/fixtures', ev.input?.file ?? ''))
  const noiseFile = rootPath(path.join('scripts/fixtures', ev.noise?.file ?? ''))
  let recomputed = '건너뜀(고정 사본 파일이 없어요)'
  if (existsSync(histFile) && existsSync(noiseFile)) {
    need(sha256(histFile) === ev.input.sha256 && statSync(histFile).size === ev.input.bytes, 'input의 sha256 또는 bytes가 사본과 달라요')
    need(sha256(noiseFile) === ev.noise.sha256 && statSync(noiseFile).size === ev.noise.bytes, 'noise의 sha256 또는 bytes가 사본과 달라요')
    const again = compute(histFile, noiseFile, p.from, p.to).evidence
    const strip = (o) => JSON.stringify({ ...o, generatedAt: null })
    const same = strip(again) === strip(ev)
    need(same, '고정 사본으로 다시 돌린 결과가 JSON과 달라요(스크립트나 규칙이 바뀌었으면 --out으로 다시 만드세요)')
    recomputed = same ? '일치' : '다름'
  }
  line(`JSON 모양, rule, 기간 문구: ${errs.length ? `${errs.length}건 문제` : '이상 없음'}`)
  line(`고정 사본으로 다시 돌린 결과와 JSON: ${recomputed}`)

  // README 마커 사이
  const readme = readFileSync(readmePath, 'utf-8')
  const m = readme.match(/<!-- nearby-evidence:start -->([\s\S]*?)<!-- nearby-evidence:end -->/)
  let readmeNote = 'README에 마커가 없어요'
  if (need(m, 'README에 <!-- nearby-evidence:start --> ... <!-- nearby-evidence:end --> 마커가 없어요')) {
    const text = m[1].replace(/(?<=\d),(?=\d{3}(?!\d))/g, '') // 천 단위 쉼표는 지우고 읽는다
    // JSON의 비율 값을 퍼센트 한 자리 문자열로 모은다
    const allowed = new Set()
    const walk = (o) => {
      if (Array.isArray(o)) o.forEach(walk)
      else if (o && typeof o === 'object') Object.values(o).forEach(walk)
      else if (num(o) && o >= -1 && o <= 1) allowed.add(pct1(o))
    }
    walk([ev.persistence, ev.arrival, ev.arrivalVsNow, ev.distance, ev.cw])
    const found = [...text.matchAll(/(-?\d+(?:\.\d+)?)%p?/g)].map((x) => x[1])
    for (const x of text.matchAll(/(-?\d+(?:\.\d+)?)~(?=-?\d)/g)) found.push(x[1])
    for (const x of found) need(allowed.has(x), `README의 수치 ${x}가 JSON의 어떤 비율에서도 나오지 않아요`)
    // 기간
    const dates = [...text.matchAll(/(\d{4}-\d{2}-\d{2})부터 (\d+)일/g)]
    need(dates.length > 0, 'README 마커 사이에 기간 문구(YYYY-MM-DD부터 N일)가 없어요')
    for (const d of dates) need(d[1] === p?.from.slice(0, 10) && Number(d[2]) === p?.days, `README의 기간 '${d[0]}'이 period(${p?.label})와 달라요`)
    // 이 문장들이 말하는 값이 빠지지 않았는지
    const a = ev.arrivalVsNow?.[2]
    const wanted = [pct1(ev.distance.within3km), pct1(a.pred), pct1(a.nowObs), pct1(a.diffCi95[0]), pct1(a.diffCi95[1])]
    for (const x of wanted) need(found.includes(x), `README 마커 사이에 없는 JSON 값: ${x}%`)
    for (const x of [String(ev.distance.picks), String(a.cells)]) need(new RegExp(`(?<![\\d,.])${x}(?![\\d.])`).test(text), `README 마커 사이에 없는 JSON 값: ${x}`)
    // 문장의 주장이 JSON과 맞는지: README가 2시간 뒤를 '구별되지 않았다'고 쓰면 구간이 0을 포함해야 하고, '모두 확인'이라고 쓰면 0을 넘어야 한다
    if (/혼잡만 쓴 지수에서[^.]*모두 확인/.test(text)) for (const k of ARRIVE_K) need(ev.cw.arrivalVsNow[k].diffCi95[0] > 0, `cw 도착 ${k}시간 뒤 구간이 0을 포함해서 README의 '혼잡만은 모두 확인' 문장이 틀려요`)
    const saysNoDiff2 = /2시간 뒤[^.]*구별되지 않/.test(text)
    need(saysNoDiff2 ? a.diffCi95[0] <= 0 && a.diffCi95[1] >= 0 : a.diffCi95[0] > 0, saysNoDiff2 ? 'CNW 2시간 뒤 구간이 0을 포함하지 않아서 README의 \'구별되지 않았다\' 문장이 틀려요' : 'CNW 2시간 뒤 구간이 0을 포함해서 README의 \'모두 확인\' 문장이 틀려요')
    for (const k of [3, 6]) need(ev.arrivalVsNow[k].diffCi95[0] > 0, `CNW 도착 ${k}시간 뒤 구간이 0을 포함해서 README의 '차이가 있었다' 문장이 틀려요`)
    readmeNote = `수치 ${found.length}개 모두 JSON에서 나온 값, 기간 문구 ${dates.length}개 일치`
  }
  line(`README 마커 사이: ${readmeNote}`)

  // 근거 패널의 '[시험]' 문장은 결정 D2가 승인된 뒤에만 있다
  const textSrc = readFileSync(rootPath('src/lib/nearbyText.ts'), 'utf-8')
  if (textSrc.includes('[시험]')) line('경고: src/lib/nearbyText.ts에 [시험] 문장이 있는데 이 대조가 아직 그 수치를 보지 않아요. 대조를 추가하세요.')
  else line('근거 패널 [시험] 문장: nearbyText.ts에 없어서 대조하지 않음(D2 미승인 상태)')

  for (const e of errs) line(`  FAIL ${e}`)
  return errs.length
}

// ---------- 실행
if (verifyMode) {
  const bad = verify(abs(opt.out ?? rootPath(EVIDENCE)), abs(opt.readme ?? rootPath('README.md')))
  line(bad ? `\n실패 ${bad}건` : '\n통과')
  process.exit(bad ? 1 : 0)
}
const historyPath = abs(opt.history ?? usage())
const noisePath = abs(opt.noise ?? rootPath(path.join('scripts/fixtures', FIXTURE.noise.file)))
for (const f of [historyPath, noisePath]) if (!existsSync(f)) fatal(`파일이 없어요: ${f}`)
const t0 = Date.now()
const result = compute(historyPath, noisePath, opt.from, opt.to)
let bad = printReport(result)
bad += reproduce(result)
line()
if (opt.out) {
  const out = abs(opt.out)
  mkdirSync(path.dirname(out), { recursive: true })
  writeFileSync(out, stringify(result.evidence), 'utf-8')
  line(`쓴 파일: ${path.relative(root, out)} (${statSync(out).size}바이트)`)
} else line('파일을 쓰지 않았어요(--out 없음)')
line(`${((Date.now() - t0) / 1000).toFixed(1)}초, ${bad ? `실패 ${bad}건` : '통과'}`)
process.exit(bad ? 1 : 0)
