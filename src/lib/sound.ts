import * as tf from '@tensorflow/tfjs'
import classNames from '../data/yamnet_classes.json'
import type { SenseTag, SoundBucket } from '../types'
import { SENSE_TAGS } from '../types'
import { CLASS_TAG } from './tags'

// 태그 함수와 상수는 TensorFlow 없이 쓸 수 있게 tags.ts에 있고, 기존 이름은 여기서도 그대로 내보낸다.
export { bestTag, CLASS_TAG, topTags } from './tags'

export const YAMNET_URL = 'https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1'
export const SAMPLE_RATE = 16000
export const WINDOW_SEC = 0.975 // YAMNet 기본 창 0.96초에 맞춘 버퍼(15600 샘플)
const MODEL_STORE = 'indexeddb://calm-yamnet' // 한 번 받은 모델을 이 기기에 두고 다음부터 다시 받지 않는다

const NAMES = classNames as string[]

/**
 * 태그 확률 집계 방식. 'sum'은 태그에 속한 분류의 확률을 더하고(앱 기본값), 'max'는 가장 큰 분류 하나만 쓴다.
 * 평가 스크립트가 두 방식을 같은 자료로 비교할 때 바꾼다(FABLE_결정.md 13번).
 */
export type TagAgg = 'sum' | 'max'
let tagAgg: TagAgg = 'sum'
export function setTagAgg(m: TagAgg) {
  tagAgg = m
}

let model: tf.GraphModel | null = null
let loading: Promise<tf.GraphModel> | null = null

/** 창 하나의 클래스별 평균 확률(521개). 텐서는 여기서 모두 정리한다. */
async function meanProbs(m: tf.GraphModel, wave: Float32Array): Promise<Float32Array> {
  const input = tf.tensor1d(wave)
  const out = m.predict(input) as tf.Tensor[]
  const scores = out[0] // [frames, 521]
  const mean = scores.mean(0) // [521]
  const probs = (await mean.data()) as Float32Array
  input.dispose()
  out.forEach((t) => t.dispose())
  mean.dispose()
  return probs
}

async function prepareModel(onProgress?: (msg: string) => void): Promise<tf.GraphModel> {
  let m: tf.GraphModel
  try {
    m = await tf.loadGraphModel(MODEL_STORE)
  } catch {
    // 이 기기에 저장된 모델이 없으면 내려받아 저장한다
    onProgress?.('처음 한 번 약 16MB를 내려받아요')
    m = await tf.loadGraphModel(YAMNET_URL, { fromTFHub: true })
    try {
      await m.save(MODEL_STORE)
    } catch {
      // 저장 공간이 막혀 있어도 이번에는 쓸 수 있다
    }
  }
  // 첫 분류는 몇 초 멈추므로, 0으로 채운 창으로 한 번 미리 돌려 둔다
  onProgress?.('처음 한 번은 몇 초 걸려요')
  await new Promise((r) => setTimeout(r, 50)) // 위 문구가 먼저 화면에 그려지게 한다
  await meanProbs(m, new Float32Array(Math.round(SAMPLE_RATE * WINDOW_SEC)))
  return m
}

export async function loadModel(onProgress?: (msg: string) => void): Promise<tf.GraphModel> {
  if (model) return model
  // 받는 중에 다시 불러도 내려받기는 한 번만 한다. 실패하면 다음에 다시 시도할 수 있게 비운다.
  if (loading) onProgress?.('모델을 준비하는 중이에요. 처음 한 번은 몇 초 걸려요')
  loading ??= prepareModel(onProgress).then(
    (m) => (model = m),
    (e) => {
      loading = null
      throw e
    },
  )
  const m = await loading
  onProgress?.('모델 준비 완료')
  return m
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
  const probs = await meanProbs(m, wave)
  const idx = Array.from(probs.keys()).sort((a, b) => probs[b] - probs[a]).slice(0, 5)
  const top = idx.map((i) => ({ name: NAMES[i], prob: probs[i], tag: CLASS_TAG[i] }))
  const tagProb = Object.fromEntries(SENSE_TAGS.map((t) => [t, 0])) as Record<SenseTag, number>
  for (let i = 0; i < probs.length; i++) {
    const t = CLASS_TAG[i]
    if (t) tagProb[t] = tagAgg === 'max' ? Math.max(tagProb[t], probs[i]) : Math.min(1, tagProb[t] + probs[i])
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

/**
 * 마이크 캡처. onWindow에 약 1초마다 16kHz 파형을 준다. 반환값은 정지 함수.
 * iOS Safari는 누른 직후에 만들어 깨운 AudioContext만 소리를 받으므로, 그렇게 만든 ctx를 넘겨 쓸 수 있다.
 * 넘긴 ctx는 성공하면 정지 함수가 닫고, 실패하면(오류를 던지면) 부른 쪽이 닫는다.
 */
export async function startMic(onWindow: (wave: Float32Array) => void, existing?: AudioContext): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  })
  const ctx = existing ?? new AudioContext()
  if (ctx.state !== 'running') await ctx.resume().catch(() => undefined)
  if (ctx.state !== 'running') {
    // 깨우지 못하면 소리를 받지 못한 채 '듣는 중'으로 멈춰 보이므로 시작하지 않는다
    stream.getTracks().forEach((t) => t.stop())
    if (!existing) void ctx.close()
    throw Object.assign(new Error('audio context is not running'), { name: 'AudioNotRunning' })
  }
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
  try {
    const ab = await file.arrayBuffer()
    // 브라우저마다 디코드 실패를 다른 값으로 던지므로 이름을 하나로 맞춘다
    const audio = await ctx.decodeAudioData(ab).catch(() => {
      throw Object.assign(new Error('decode failed'), { name: 'EncodingError' })
    })
    return windowsFromBuffer(audio)
  } finally {
    void ctx.close()
  }
}

/** 디코딩된 오디오를 16kHz로 바꿔 약 1초 창으로 자른다(최대 60창) */
export function windowsFromBuffer(audio: AudioBuffer): Float32Array[] {
  const wave = resample(audio.getChannelData(0), audio.sampleRate, SAMPLE_RATE)
  const need = Math.round(SAMPLE_RATE * WINDOW_SEC)
  const windows: Float32Array[] = []
  for (let i = 0; i + need <= wave.length && windows.length < 60; i += need) windows.push(wave.slice(i, i + need))
  return windows
}
