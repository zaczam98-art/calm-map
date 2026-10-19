/**
 * 지수 불변 지문(F1). hourScores가 만든 칸의 지수 관련 값만 모아 sha256을 구한다.
 * 모든 장소 x 프로필 2종(꺼짐, 샘플) x 기록 보정 3종(0, 5, -10) x nowKey 2종 칸을 돈다. 새로 더한 칸 필드(crowdLevel, nz)는 해시에 넣지 않는다.
 * 지수 산식을 건드린 변경은 이 값이 바뀌므로, 산식 밖의 변경 전후에 같은 값이 나와야 한다.
 *
 * 실행(저장소 루트에서): node scripts/f1_digest.mjs
 * 기준값: cells 18876 sha256 7d0fd965a5c3ed00f414dc102dbc276b85585fb02250d2281d82bfeb3a3a4e28 (고정 사본)
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { build } from 'esbuild'

const BASE_HASH = '7d0fd965a5c3ed00f414dc102dbc276b85585fb02250d2281d82bfeb3a3a4e28'
const BASE_CELLS = 18876

const root = process.cwd()
const readJson = (f) => JSON.parse(readFileSync(path.join(root, f), 'utf-8').replace(/^﻿/, ''))
const snap = readJson('scripts/fixtures/snapshot-2026-10-13T1106.json')
const noise = readJson('scripts/fixtures/noise-2026-10-13.json')

mkdirSync(path.join(root, '.tmp'), { recursive: true })
const out = path.join(root, '.tmp', 'f1_digest_bundle.cjs')
await build({
  stdin: { contents: "export * from './src/lib/index.ts'\nexport { noiseLookup } from './src/lib/noise.ts'\nexport { SENSE_TAGS } from './src/types.ts'\n", resolveDir: root, loader: 'ts' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: out,
  logLevel: 'error',
})
const L = createRequire(import.meta.url)(out)

const names = Object.keys(snap.places)
const tags = Object.fromEntries(L.SENSE_TAGS.map((t) => [t, 1]))
const profs = { off: null, sample: { enabled: true, crowd: 1.5, loud: 1.5, tags: { ...tags, sudden: 1.5 } } }
const r6 = (v) => (v === null ? null : Math.round(v * 1e6) / 1e6)
const h = createHash('sha256')
let n = 0
for (const [pk, prof] of Object.entries(profs)) {
  for (const off of [0, 5, -10]) {
    for (const nowKey of ['2026-10-13 11', undefined]) {
      for (const nm of names) {
        const s = L.hourScores(snap.places[nm], () => undefined, prof, off, nowKey, L.noiseLookup(noise, nm))
        for (const c of s) {
          n++
          h.update(JSON.stringify([pk, off, nowKey ?? '-', nm, c.time, c.index, c.level, c.soundN, c.forecast, c.noise, c.obs ?? null, c.parts && [r6(c.parts.c), r6(c.parts.n), r6(c.parts.s), r6(c.parts.w), c.parts.offset, r6(c.parts.base)]]))
        }
      }
    }
  }
}
const digest = h.digest('hex')
console.log('cells', n, 'sha256', digest)
const same = n === BASE_CELLS && digest === BASE_HASH
console.log(same ? 'F1 OK: 기준값과 같음' : 'F1 FAIL: 기준값과 다름')
process.exit(same ? 0 : 1)
