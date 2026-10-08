import * as tf from '@tensorflow/tfjs'
import classNames from '../data/yamnet_classes.json'
import type { SenseTag, SoundBucket } from '../types'
import { SENSE_TAGS } from '../types'

export const YAMNET_URL = 'https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1'
export const SAMPLE_RATE = 16000
export const WINDOW_SEC = 0.975 // YAMNet 기본 창 0.96초에 맞춘 버퍼(15600 샘플)

/** 클래스 이름 키워드로 감각 태그를 정한다. 먼저 맞는 태그가 우선. */
const TAG_KEYWORDS: [SenseTag, RegExp][] = [
  ['sudden', /siren|alarm|horn|honk|toot|scream|shout|yell|cry|crying|explosion|firework|firecracker|gunshot|drill|jackhammer|hammer|power tool|chainsaw|shatter|glass|slam|bang|smash|whistle|buzzer|beep|bark|dog|thunder|crash/i],
  ['crowd', /crowd|hubbub|babble|children playing|cheer|applause|clapping|chatter|laughter|giggle|chuckle|crowd/i],
  ['machine', /vehicle|car\b|bus|truck|motorcycle|engine|train|subway|rail|aircraft|helicopter|air conditioning|mechanical fan|motor|machine|lawn mower|vacuum|blender|traffic|tire|skidding|idling|accelerating/i],
  ['music', /music|singing|song|guitar|drum|piano|synthesizer|electronic|hip hop|pop music|rock|jazz|choir|organ|trumpet|violin|bell|chime|jingle|theme|soundtrack|radio|television|loudspeaker|public address/i],
  ['speech', /speech|conversation|narration|monologue|talk|male|female|child speech|whispering|voice/i],
  ['ambient', /silence|wind|water|rain|stream|bird|room|outside|environmental|white noise|pink noise|hum|noise|quiet|echo|reverberation|static/i],
]

const NAMES = classNames as string[]
export const CLASS_TAG: (SenseTag | null)[] = NAMES.map((n) => {
  for (const [tag, re] of TAG_KEYWORDS) if (re.test(n)) return tag
  return null
})

let model: tf.GraphModel | null = null

export async function loadModel(onProgress?: (msg: string) => void): Promise<tf.GraphModel> {
  if (model) return model
  onProgress?.('모델을 내려받는 중이에요(약 15MB, 처음 한 번만)')
  model = await tf.loadGraphModel(YAMNET_URL, { fromTFHub: true })
  onProgress?.('모델 준비 완료')
  return model
}

export interface WindowResult {
  top: { name: string; prob: number; tag: SenseTag | null }[]
  tagProb: Record<SenseTag, number> // 태그별 확률 합(최대 1)
  intensity: number // 0~1 (dBFS -60~-10)
  dbfs: number
}

/** 1창(≈1초) 파형을 분류한다. 원음은 함수 안에서만 쓰고 밖으로 내보내지 않는다. */
export async function classifyWindow(wave: Float32Array): Promise<WindowResult> {
  const m = await loadModel()
  const input = tf.tensor1d(wave)
  const out = m.predict(input) as tf.Tensor[]
  const scores = out[0] // [frames, 521]
  const mean = scores.mean(0) // [521]
  const probs = (await mean.data()) as Float32Array
  input.dispose()
  out.forEach((t) => t.dispose())
  mean.dispose()
  const idx = Array.from(probs.keys()).sort((a, b) => probs[b] - probs[a]).slice(0, 5)
  const top = idx.map((i) => ({ name: NAMES[i], prob: probs[i], tag: CLASS_TAG[i] }))
  const tagProb = Object.fromEntries(SENSE_TAGS.map((t) => [t, 0])) as Record<SenseTag, number>
  for (let i = 0; i < probs.length; i++) {
    const t = CLASS_TAG[i]
    if (t) tagProb[t] = Math.min(1, tagProb[t] + probs[i])
  }
  let sum = 0
  for (let i = 0; i < wave.length; i++) sum += wave[i] * wave[i]
  const rms = Math.sqrt(sum / Math.max(1, wave.length))
  const dbfs = 20 * Math.log10(Math.max(rms, 1e-6))
  const intensity = Math.max(0, Math.min(1, (dbfs + 60) / 50))
  return { top, tagProb, intensity, dbfs }
}

/** 세션 창 결과들을 버킷 요약으로: 태그별 (확률×강도) 평균 */
export function summarize(windows: WindowResult[]): SoundBucket {
  const tags: Partial<Record<SenseTag, number>> = {}
  for (const t of SENSE_TAGS) {
    let s = 0
    for (const w of windows) s += w.tagProb[t] * w.intensity
    tags[t] = windows.length ? +(s / windows.length).toFixed(3) : 0
  }
  return { n: windows.length, tags }
}

export function topTags(b: SoundBucket, k = 2): SenseTag[] {
  return (Object.entries(b.tags) as [SenseTag, number][])
    .filter(([t]) => t !== 'ambient')
    .sort((a, b2) => b2[1] - a[1])
    .slice(0, k)
    .map(([t]) => t)
}

/** 선형 보간 리샘플(브라우저 AudioContext가 16kHz를 못 줄 때) */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input
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

/** 마이크 캡처. onWindow에 약 1초마다 16kHz 파형을 준다. 반환값은 정지 함수. */
export async function startMic(onWindow: (wave: Float32Array) => void): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  })
  const ctx = new AudioContext()
  const src = ctx.createMediaStreamSource(stream)
  const proc = ctx.createScriptProcessor(4096, 1, 1)
  const need = Math.round(SAMPLE_RATE * WINDOW_SEC)
  let buf = new Float32Array(0)
  proc.onaudioprocess = (e) => {
    const chunk = resample(e.inputBuffer.getChannelData(0), ctx.sampleRate, SAMPLE_RATE)
    const merged = new Float32Array(buf.length + chunk.length)
    merged.set(buf)
    merged.set(chunk, buf.length)
    buf = merged
    while (buf.length >= need) {
      onWindow(buf.slice(0, need))
      buf = buf.slice(need)
    }
  }
  src.connect(proc)
  proc.connect(ctx.destination)
  return () => {
    proc.disconnect()
    src.disconnect()
    stream.getTracks().forEach((t) => t.stop())
    void ctx.close()
  }
}

/** 오디오 파일을 1초 창으로 잘라 분류(마이크 없이 시연할 때) */
export async function decodeFile(file: File): Promise<Float32Array[]> {
  const ctx = new AudioContext()
  const ab = await file.arrayBuffer()
  const audio = await ctx.decodeAudioData(ab)
  await ctx.close()
  return windowsFromBuffer(audio)
}

/** 디코딩된 오디오를 16kHz로 바꿔 약 1초 창으로 자른다(최대 60창) */
export function windowsFromBuffer(audio: AudioBuffer): Float32Array[] {
  const wave = resample(audio.getChannelData(0), audio.sampleRate, SAMPLE_RATE)
  const need = Math.round(SAMPLE_RATE * WINDOW_SEC)
  const windows: Float32Array[] = []
  for (let i = 0; i + need <= wave.length && windows.length < 60; i += need) windows.push(wave.slice(i, i + need))
  return windows
}

/** 요약에서 값이 가장 큰 태그(배경음 포함). 평가 스크립트와 같은 기준이다. */
export function bestTag(b: SoundBucket): SenseTag | null {
  let best: SenseTag | null = null
  let bestV = 0
  for (const t of SENSE_TAGS) {
    const v = b.tags[t] ?? 0
    if (v > bestV) {
      bestV = v
      best = t
    }
  }
  return best
}
