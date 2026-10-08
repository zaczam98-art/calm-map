/**
 * 소리 점수 S 속성 시험과 수정 전후 비교.
 * 작업 트리의 src/lib/index.ts(분모 없는 합 식)와 수정 전 커밋(BASE_COMMIT)의 가중평균 식을 esbuild로 각각 묶어 같은 시험을 돌린다.
 * 수정 전 식은 'git show'로 꺼낸 소스를 메모리에서 묶는다(임시 파일을 만들지 않는다). git은 읽기만 한다.
 * esbuild는 node_modules에 있는 것(wrangler 의존성)을 쓴다.
 *
 * 실행(저장소 루트): node scripts/sound_score_test.ts
 *   - 속성 시험 결과, 사이렌 비슷한 세션의 전후 지수, ESC-50 분포를 docs/eval/sound_score_before_after.json 에 쓴다.
 *   - 현재 식이 속성 시험을 하나라도 어기면 종료 코드 1. 수정 전 식의 실패는 기록만 하고 종료 코드에 넣지 않는다.
 *   - ESC-50 음원 폴더는 환경변수 ESC50_AUDIO(기본: ../_work/data/esc50/audio), 평가 결과 파일은 ESC50_RESULT(기본: docs/eval/esc50_result.json)로 바꿀 수 있다.
 *   - 평가 결과의 perClip에 태그별 확률(scores)이 있으면 esc50.measured에 실측 S 분포를 채운다.
 */
import { buildSync } from 'esbuild'
import type { BuildOptions } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ChildProfile, PlaceSnapshot, SenseTag, Sensitivity, SoundBucket } from '../src/types.ts'

const BASE_COMMIT = 'f765233' // 소리 점수 S를 고치기 전 마지막 커밋(가중평균 식)
const root = resolve(import.meta.dirname, '..')
const TAGS: SenseTag[] = ['sudden', 'crowd', 'machine', 'music', 'speech', 'ambient']

interface Lib {
  soundScore: (b: SoundBucket | undefined, p?: ChildProfile) => number | null
  soundWeight: (n: number) => number
  hourScores: (snap: PlaceSnapshot, sound: () => SoundBucket | undefined, profile: ChildProfile | null) => { index: number; level: string }[]
  TAG_WEIGHT: Record<SenseTag, number>
}

function load(opts: BuildOptions): Lib {
  const out = buildSync({ ...opts, bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' })
  const mod: { exports: unknown } = { exports: {} }
  new Function('module', 'exports', out.outputFiles[0].text)(mod, mod.exports)
  return mod.exports as Lib
}

const headSource = execFileSync('git', ['show', `${BASE_COMMIT}:src/lib/index.ts`], { cwd: root, encoding: 'utf-8' })
const cur = load({ entryPoints: [join(root, 'src/lib/index.ts')] })
const old = load({ stdin: { contents: headSource, resolveDir: join(root, 'src/lib'), sourcefile: 'index.base.ts', loader: 'ts' } })

// ---------- 입력 도우미 ----------

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rnd = mulberry32(20261009)
const SENS: Sensitivity[] = [0.5, 1, 1.5]
function pick<T>(xs: T[]): T {
  return xs[Math.floor(rnd() * xs.length)]
}

/** 앱이 만드는 버킷과 같은 모양: 여섯 태그가 모두 숫자(없는 소리는 0)다. */
function bucket(n: number, v: Partial<Record<SenseTag, number>> = {}): SoundBucket {
  return { n, tags: Object.fromEntries(TAGS.map((t) => [t, v[t] ?? 0])) as Record<SenseTag, number> }
}
/** 일부 태그의 키만 있는 버킷(summarize를 거치지 않은 입력) */
function sparse(n: number, v: Partial<Record<SenseTag, number>>): SoundBucket {
  return { n, tags: { ...v } }
}
function prof(over: Partial<Record<SenseTag, Sensitivity>> = {}): ChildProfile {
  return { enabled: true, tags: { ...(Object.fromEntries(TAGS.map((t) => [t, 1])) as Record<SenseTag, Sensitivity>), ...over }, crowd: 1, loud: 1 }
}
function randomTags(): Record<SenseTag, number> {
  return Object.fromEntries(TAGS.map((t) => [t, rnd()])) as Record<SenseTag, number>
}
function randomProfile(): ChildProfile {
  return prof(Object.fromEntries(TAGS.map((t) => [t, pick(SENS)])) as Record<SenseTag, Sensitivity>)
}
const r1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10)
const EPS = 1e-9
const CASES = 2000

// ---------- 속성 시험 ----------

interface Outcome {
  pass: boolean
  detail: string
}
interface Test {
  id: string
  name: string
  run: (lib: Lib) => Outcome
}

function runCases(label: string, fn: (lib: Lib) => boolean): (lib: Lib) => Outcome {
  return (lib) => {
    let bad = 0
    for (let i = 0; i < CASES; i++) if (!fn(lib)) bad++
    return { pass: bad === 0, detail: `${CASES}개 무작위 입력 중 위반 ${bad}개 (${label})` }
  }
}

const tests: Test[] = [
  {
    id: 'P1',
    name: '돌발음 1.0뿐인 세션은 S가 90 이상이다',
    run: (lib) => {
      const s = lib.soundScore(bucket(30, { sudden: 1 }))!
      return { pass: s >= 90, detail: `S=${r1(s)}` }
    },
  },
  {
    id: 'P2',
    name: '배경음(ambient) 1.0뿐인 세션은 S가 10 이하다',
    run: (lib) => {
      const s = lib.soundScore(bucket(30, { ambient: 1 }))!
      return { pass: s <= 10 + EPS, detail: `S=${r1(s)}` }
    },
  },
  {
    id: 'P3',
    name: '태그 값이 커지면 S는 줄지 않는다',
    run: runCases('한 태그의 값을 올렸을 때 S가 내려간 경우', (lib) => {
      const v = randomTags()
      const p = rnd() < 0.5 ? randomProfile() : undefined
      const t = pick(TAGS)
      const before = lib.soundScore({ n: 30, tags: v }, p)!
      const after = lib.soundScore({ n: 30, tags: { ...v, [t]: Math.min(1, v[t] + rnd() * 0.5) } }, p)!
      return after >= before - EPS
    }),
  },
  {
    id: 'P4',
    name: '세션에 있는 태그(값>0)의 민감도를 올리면 S는 줄지 않는다',
    run: (lib) => {
      let bad = 0
      for (let i = 0; i < CASES; i++) {
        const v = randomTags()
        const others = randomProfile().tags
        const t = pick(TAGS)
        const s = SENS.map((x) => lib.soundScore({ n: 30, tags: v }, { ...prof(), tags: { ...others, [t]: x } })!)
        if (s[1] < s[0] - EPS || s[2] < s[1] - EPS) bad++
      }
      const ex = { n: 30, tags: bucket(30, { sudden: 0.2, crowd: 0.8 }).tags }
      const exS = SENS.map((x) => r1(lib.soundScore(ex, prof({ sudden: x }))))
      return { pass: bad === 0, detail: `${CASES}개 무작위 입력 중 위반 ${bad}개. 예: 돌발음 0.2, 군중 0.8인 세션에서 돌발음 민감도 0.5, 1, 1.5일 때 S=${exS.join(', ')}` }
    },
  },
  {
    id: 'P5a',
    name: '세션에 키가 없는 태그의 민감도는 S에 영향이 없다',
    run: runCases('S가 바뀐 경우', (lib) => {
      const t = pick(TAGS)
      const v = Object.fromEntries(TAGS.filter((x) => x !== t).map((x) => [x, rnd()])) as Partial<Record<SenseTag, number>>
      const a = lib.soundScore(sparse(30, v), prof({ [t]: 0.5 }))!
      const b = lib.soundScore(sparse(30, v), prof({ [t]: 1.5 }))!
      return Math.abs(a - b) < EPS
    }),
  },
  {
    id: 'P5b',
    name: '값이 0으로 기록된 태그(앱이 만드는 버킷의 없는 소리)의 민감도는 S에 영향이 없다',
    run: runCases('S가 바뀐 경우', (lib) => {
      const t = pick(TAGS)
      const v = randomTags()
      v[t] = 0
      const a = lib.soundScore({ n: 30, tags: v }, prof({ [t]: 0.5 }))!
      const b = lib.soundScore({ n: 30, tags: v }, prof({ [t]: 1.5 }))!
      return Math.abs(a - b) < EPS
    }),
  },
  {
    id: 'P6',
    name: '모든 태그가 0이면 S는 0이다(맞춤 끔과 켬 모두)',
    run: (lib) => {
      const a = lib.soundScore(bucket(30))
      const b = lib.soundScore(bucket(30), prof({ sudden: 1.5, crowd: 1.5 }))
      return { pass: a === 0 && b === 0, detail: `맞춤 끔 S=${a}, 맞춤 켬 S=${b}` }
    },
  },
  {
    id: 'P7',
    name: 'n=0이거나 버킷이 없으면 null이다',
    run: (lib) => {
      const a = lib.soundScore(bucket(0, { sudden: 1 }))
      const b = lib.soundScore(undefined)
      return { pass: a === null && b === null, detail: `n=0 → ${a}, 버킷 없음 → ${b}` }
    },
  },
  {
    id: 'P8',
    name: '맞춤을 끄면 민감도 값과 무관하고 민감도 1과 같다',
    run: runCases('S가 다른 경우', (lib) => {
      const v = randomTags()
      const off: ChildProfile = { ...randomProfile(), enabled: false }
      const a = lib.soundScore({ n: 30, tags: v }, off)!
      const b = lib.soundScore({ n: 30, tags: v }, prof())!
      const c = lib.soundScore({ n: 30, tags: v })!
      return Math.abs(a - b) < EPS && Math.abs(a - c) < EPS
    }),
  },
  {
    id: 'P9',
    name: 'S는 항상 0 이상 100 이하다',
    run: runCases('범위를 벗어난 경우', (lib) => {
      const s = lib.soundScore({ n: 30, tags: randomTags() }, rnd() < 0.5 ? randomProfile() : undefined)!
      return s >= 0 && s <= 100
    }),
  },
]

// ---------- 사이렌 비슷한 세션의 전후 지수 ----------

const LEVELS = ['여유', '보통', '약간 붐빔', '붐빔'] as const
const SIREN_N = 30
const SIREN = bucket(SIREN_N, { sudden: 0.72 })
const level3 = (i: number) => (i < 35 ? '무던함' : i < 65 ? '보통' : '붐빔')

/** 장소 하나(혼잡 단계만 있는 단일 시각)의 지수를 hourScores로 구한다. 반올림 전 값은 같은 식으로 직접 계산해 검산한다. */
function placeIndex(lib: Lib, level: (typeof LEVELS)[number], b: SoundBucket | undefined, p: ChildProfile | null) {
  const snap: PlaceSnapshot = { live: null, fcst: [{ time: '2026-10-09 10:00', level, min: 1000, max: 1000 }] }
  const out = lib.hourScores(snap, () => b, p)[0]
  const c = lib.hourScores(snap, () => undefined, null)[0].index
  const s = lib.soundScore(b, p ?? undefined)
  const w = s === null ? 0 : lib.soundWeight(b?.n ?? 0)
  const exact = (1 - w) * c + w * (s ?? 0)
  if (Math.round(exact) !== out.index) throw new Error(`검산 불일치: ${level} ${exact} vs ${out.index}`)
  return { C: c, S: r1(s), w: Math.round(w * 1000) / 1000, exact: r1(exact), index: out.index, level: level3(out.index) }
}

function sirenTable(p: ChildProfile | null) {
  return LEVELS.map((level) => ({
    place: level,
    none: placeIndex(cur, level, undefined, p).index,
    base: placeIndex(old, level, SIREN, p),
    current: placeIndex(cur, level, SIREN, p),
  }))
}

// ---------- ESC-50 ----------

const SR = 16000
const WIN = Math.round(SR * 0.975)

function readWav(path: string): { rate: number; data: Float32Array } {
  const b = readFileSync(path)
  let off = 12
  let rate = 44100
  let channels = 1
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4)
    const size = b.readUInt32LE(off + 4)
    if (id === 'fmt ') {
      channels = b.readUInt16LE(off + 10)
      rate = b.readUInt32LE(off + 12)
    } else if (id === 'data') {
      const frames = Math.floor(size / (2 * channels))
      const data = new Float32Array(frames)
      for (let i = 0; i < frames; i++) data[i] = b.readInt16LE(off + 8 + i * 2 * channels) / 32768
      return { rate, data }
    }
    off += 8 + size + (size % 2)
  }
  throw new Error(`data 청크 없음: ${path}`)
}
/** src/lib/sound.ts의 resample과 같은 선형 보간(그 파일은 TensorFlow를 불러와서 묶지 않는다) */
function resample(input: Float32Array, from: number, to: number): Float32Array {
  const ratio = from / to
  const n = Math.floor(input.length / ratio)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = i * ratio
    const i0 = Math.floor(x)
    const i1 = Math.min(i0 + 1, input.length - 1)
    out[i] = input[i0] + (input[i1] - input[i0]) * (x - i0)
  }
  return out
}
/** src/lib/sound.ts의 classifyWindow와 같은 강도: dBFS -60~-10을 0~1로 */
function windowIntensity(w: Float32Array): number {
  let sum = 0
  for (let i = 0; i < w.length; i++) sum += w[i] * w[i]
  const dbfs = 20 * Math.log10(Math.max(Math.sqrt(sum / w.length), 1e-6))
  return Math.max(0, Math.min(1, (dbfs + 60) / 50))
}

function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b)
  const i = (s.length - 1) * q
  const lo = Math.floor(i)
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo)
}
function dist(xs: number[]) {
  return { n: xs.length, median: r1(quantile(xs, 0.5)), p10: r1(quantile(xs, 0.1)), p90: r1(quantile(xs, 0.9)), ge50: Math.round((xs.filter((x) => x >= 50).length / xs.length) * 1000) / 10 }
}

interface Clip {
  file: string
  category: string
  truth: SenseTag
  predicted: string
  scores?: Record<string, number>
}

function esc50(): Record<string, unknown> {
  const resultPath = process.env.ESC50_RESULT ?? join(root, 'docs/eval/esc50_result.json')
  const audioDir = process.env.ESC50_AUDIO ?? resolve(root, '../_work/data/esc50/audio')
  const result = JSON.parse(readFileSync(resultPath, 'utf-8')) as { clips: number; windows: number; perClip: Clip[] }
  const perClip = result.perClip
  const windowsPerClip = Math.round(result.windows / result.clips)
  const out: Record<string, unknown> = { source: 'docs/eval/esc50_result.json', clips: perClip.length, windowsPerClip }

  // 1) 태그별 확률이 perClip에 있으면 실측 분포를 낸다.
  if (perClip.every((c) => c.scores)) {
    const by: Record<string, { cur: number[]; base: number[] }> = {}
    for (const c of perClip) {
      const b = { n: windowsPerClip, tags: c.scores! } as SoundBucket
      const g = (by[c.truth] ??= { cur: [], base: [] })
      g.cur.push(cur.soundScore(b)!)
      g.base.push(old.soundScore(b)!)
    }
    out.measured = Object.fromEntries(Object.entries(by).map(([t, g]) => [t, { current: dist(g.cur), base: dist(g.base) }]))
  } else {
    out.measured = null
    out.measuredNote = 'perClip에 태그별 확률(scores)이 없어 실측 S 분포는 계산하지 못했다. scripts/eval_sound.ts가 perClip에 scores를 남기도록 고쳐 다시 평가해야 한다.'
  }

  // 2) 모델 없이 음원만으로: 실측 창 강도와 가정한 태그 확률로 S를 계산한다.
  if (!existsSync(audioDir)) {
    out.scenario = null
    out.scenarioNote = `음원 폴더가 없어 건너뜀: ${audioDir}`
    return out
  }
  const intensity: Record<string, number[]> = {}
  const perTag: Record<string, { file: string; I: number }[]> = {}
  for (const c of perClip) {
    const wav = readWav(join(audioDir, c.file))
    const wave = resample(wav.data, wav.rate, SR)
    const ws: number[] = []
    for (let s = 0; s + WIN <= wave.length; s += WIN) ws.push(windowIntensity(wave.slice(s, s + WIN)))
    const mean = ws.reduce((a, b) => a + b, 0) / ws.length
    ;(perTag[c.truth] ??= []).push({ file: c.file, I: mean })
    ;(intensity[c.truth] ??= []).push(mean * 100)
  }
  const PBAR = [0.5, 0.8, 1]
  out.scenario = {
    assumption: '태그 확률(창마다 같은 값 p)은 모델이 필요해 가정값이다. 정답 태그 하나만 값이 있고(v=p×창 강도 평균 Ī) 나머지 태그는 0인 세션으로 계산한다. 다른 태그가 함께 잡히면 현재 식의 S는 더 올라간다.',
    audioDir: 'ESC50_AUDIO 또는 ../_work/data/esc50/audio',
    intensity100: Object.fromEntries(Object.entries(intensity).map(([t, xs]) => [t, dist(xs)])),
    byP: Object.fromEntries(
      PBAR.map((p) => [
        String(p),
        Object.fromEntries(
          Object.entries(perTag).map(([t, xs]) => {
            const cs = xs.map((x) => cur.soundScore(bucket(windowsPerClip, { [t]: p * x.I }))!)
            const bs = xs.map((x) => old.soundScore(bucket(windowsPerClip, { [t]: p * x.I }))!)
            return [t, { current: dist(cs), base: dist(bs) }]
          }),
        ),
      ]),
    ),
  }
  return out
}

// ---------- 실행과 기록 ----------

const results = tests.map((t) => ({ id: t.id, name: t.name, current: t.run(cur), base: t.run(old) }))
const sirenOff = sirenTable(null)
const sirenSudden15 = sirenTable(prof({ sudden: 1.5 }))
const esc = esc50()

const weights = cur.TAG_WEIGHT
if (JSON.stringify(weights) !== JSON.stringify(old.TAG_WEIGHT)) throw new Error('태그 가중이 수정 전후로 달라서 전후 비교가 값 조정과 섞인다')

const report = {
  baseCommit: BASE_COMMIT,
  tagWeight: weights,
  formulas: {
    base: 'S = clamp(140 × Σ(w_t·s_t·v_t) / Σ(w_t·s_t) , 0, 100)  (합은 값이 0인 태그까지 포함. 분모에 민감도가 들어감)',
    current: 'S = clamp(100 × Σ(v_t · w_t · s_t), 0, 100)  (분모 없음)',
  },
  properties: results,
  siren: { session: { n: SIREN_N, sudden: 0.72 }, w: cur.soundWeight(SIREN_N), customOff: sirenOff, suddenSens15: sirenSudden15 },
  esc50: esc,
}
writeFileSync(join(root, 'docs/eval/sound_score_before_after.json'), JSON.stringify(report, null, 1) + '\n', 'utf-8')

console.log(`수정 전 식: ${BASE_COMMIT}:src/lib/index.ts / 현재 식: 작업 트리 src/lib/index.ts`)
for (const r of results) {
  console.log(`${r.id} ${r.current.pass ? '통과' : '실패'} (현재)  ${r.base.pass ? '통과' : '실패'} (수정 전)  ${r.name}`)
  console.log(`     현재: ${r.current.detail}`)
  console.log(`     수정 전: ${r.base.detail}`)
}
for (const [label, rows] of [['맞춤 끔', sirenOff], ['돌발음 민감도 1.5', sirenSudden15]] as const) {
  console.log(`사이렌 비슷한 세션(돌발음 0.72, ${SIREN_N}창, 소리 비중 ${cur.soundWeight(SIREN_N)}), ${label}`)
  for (const r of rows) console.log(`  ${r.place}: 소리 없음 ${r.none} → 수정 전 ${r.base.index}(S ${r.base.S}) → 현재 ${r.current.index}(S ${r.current.S})`)
}
const bad = results.filter((r) => !r.current.pass)
console.log(bad.length === 0 ? `현재 식: 속성 시험 ${results.length}개 모두 통과` : `현재 식: 실패 ${bad.map((r) => r.id).join(', ')}`)
process.exit(bad.length === 0 ? 0 : 1)
