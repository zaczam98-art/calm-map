/**
 * 공개 음원(ESC-50)으로 소리 종류 분류를 평가한다.
 * 앱과 같은 모델(YAMNet TF.js), 같은 태그 매핑(CLASS_TAG), 같은 리샘플 함수, 같은 요약 방식(확률×강도 평균)을 쓴다.
 * 브라우저와 다른 점: 실행 환경이 Node(tfjs CPU 백엔드)이고, 44.1kHz 원본을 바로 16kHz로 선형 보간한다.
 *
 * 실행:
 *   node node_modules/esbuild/bin/esbuild scripts/eval_sound.ts --bundle --platform=node --format=cjs --outfile=.tmp/eval_sound.cjs
 *   node .tmp/eval_sound.cjs <ESC-50 audio 폴더> <meta/esc50.csv> <결과 json> [분류당 최대 개수]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { classifyWindow, resample, SAMPLE_RATE, summarize, WINDOW_SEC, type WindowResult } from '../src/lib/sound'
import { SENSE_TAGS, type SenseTag } from '../src/types'
import tagMap from './esc50_tag_map.json'

const [audioDir, metaCsv, outPath, limitArg] = process.argv.slice(2)
const limit = limitArg ? Number(limitArg) : Infinity

const truthOf: Record<string, SenseTag> = {}
for (const [tag, classes] of Object.entries(tagMap.tags)) for (const c of classes) truthOf[c] = tag as SenseTag

function readWav(path: string): { rate: number; data: Float32Array } {
  const b = readFileSync(path)
  let off = 12
  let rate = 44100
  let channels = 1
  let bits = 16
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4)
    const size = b.readUInt32LE(off + 4)
    if (id === 'fmt ') {
      channels = b.readUInt16LE(off + 10)
      rate = b.readUInt32LE(off + 12)
      bits = b.readUInt16LE(off + 22)
    } else if (id === 'data') {
      if (bits !== 16) throw new Error(`16비트가 아닌 파일: ${path}`)
      const frames = Math.floor(size / (2 * channels))
      const data = new Float32Array(frames)
      for (let i = 0; i < frames; i++) data[i] = b.readInt16LE(off + 8 + i * 2 * channels) / 32768
      return { rate, data }
    }
    off += 8 + size + (size % 2)
  }
  throw new Error(`data 청크 없음: ${path}`)
}

async function main() {
  const rows = readFileSync(metaCsv, 'utf-8').trim().split('\n').slice(1).map((l) => l.trim().split(','))
  const picked: { file: string; category: string; truth: SenseTag }[] = []
  const perClass: Record<string, number> = {}
  for (const r of rows) {
    const [file, , , category] = r
    const truth = truthOf[category]
    if (!truth) continue
    perClass[category] = (perClass[category] || 0) + 1
    if (perClass[category] > limit) continue
    picked.push({ file, category, truth })
  }
  const need = Math.round(SAMPLE_RATE * WINDOW_SEC)
  const confusion: Record<string, Record<string, number>> = {}
  const byClass: Record<string, { n: number; correct: number; truth: SenseTag; predicted: Record<string, number> }> = {}
  const clips: { file: string; category: string; truth: SenseTag; predicted: SenseTag | 'none'; scores: Record<string, number> }[] = []
  const t0 = Date.now()
  let windowsTotal = 0
  for (let i = 0; i < picked.length; i++) {
    const p = picked[i]
    const wav = readWav(join(audioDir, p.file))
    const wave = resample(wav.data, wav.rate, SAMPLE_RATE)
    const results: WindowResult[] = []
    for (let s = 0; s + need <= wave.length; s += need) results.push(await classifyWindow(wave.slice(s, s + need)))
    windowsTotal += results.length
    const summary = summarize(results) // 태그별 (확률×강도) 평균: 앱이 장소에 반영하는 값과 같다
    let best: SenseTag | 'none' = 'none'
    let bestV = 0
    for (const t of SENSE_TAGS) {
      const v = summary.tags[t] ?? 0
      if (v > bestV) {
        bestV = v
        best = t
      }
    }
    confusion[p.truth] = confusion[p.truth] || {}
    confusion[p.truth][best] = (confusion[p.truth][best] || 0) + 1
    const c = (byClass[p.category] = byClass[p.category] || { n: 0, correct: 0, truth: p.truth, predicted: {} })
    c.n++
    if (best === p.truth) c.correct++
    c.predicted[best] = (c.predicted[best] || 0) + 1
    clips.push({ file: p.file, category: p.category, truth: p.truth, predicted: best, scores: summary.tags as Record<string, number> })
    if ((i + 1) % 20 === 0 || i === picked.length - 1) {
      const sec = (Date.now() - t0) / 1000
      console.log(`${i + 1}/${picked.length} clips, ${windowsTotal} windows, ${sec.toFixed(0)}s (${((sec / windowsTotal) * 1000).toFixed(0)} ms/window)`)
    }
  }
  const byTag: Record<string, { n: number; correct: number }> = {}
  for (const c of clips) {
    const m = (byTag[c.truth] = byTag[c.truth] || { n: 0, correct: 0 })
    m.n++
    if (c.predicted === c.truth) m.correct++
  }
  const n = clips.length
  const correct = clips.filter((c) => c.predicted === c.truth).length
  const out = {
    dataset: tagMap.dataset,
    evaluatedAt: new Date().toISOString(),
    method: '음원 하나를 0.975초 창으로 나눠 YAMNet으로 분류하고, 태그별 (확률×강도) 평균이 가장 큰 태그를 그 음원의 예측으로 본다. 정답은 scripts/esc50_tag_map.json의 정답표다.',
    limitPerClass: Number.isFinite(limit) ? limit : null,
    clips: n,
    windows: windowsTotal,
    overall: { n, correct },
    byTag,
    confusion,
    byClass,
    perClip: clips.map((c) => ({ file: c.file, category: c.category, truth: c.truth, predicted: c.predicted })),
  }
  writeFileSync(outPath, JSON.stringify(out, null, 1), 'utf-8')
  console.log(`overall ${correct}/${n} = ${((correct / n) * 100).toFixed(1)}%`)
  for (const [t, m] of Object.entries(byTag)) console.log(`  ${t}: ${m.correct}/${m.n} = ${((m.correct / m.n) * 100).toFixed(1)}%`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
