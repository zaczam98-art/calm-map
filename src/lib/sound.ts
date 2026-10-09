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

const DOWNLOAD_IDLE_MS = 45_000 // 이 시간 동안 응답이나 데이터가 한 번도 오지 않으면 내려받기를 끊는다(느린 연결은 데이터가 계속 오므로 끊기지 않는다)

/** 응답이 오기까지, 그리고 본문 조각 사이가 idleMs를 넘기면 요청을 끊는 fetch. 연결이 끊긴 채 멈춘 내려받기가 영원히 끝나지 않는 것을 막는다. */
function idleGuardFetch(idleMs: number): typeof fetch {
  return async (input, init) => {
    const ctl = new AbortController()
    let timer = setTimeout(() => ctl.abort(), idleMs)
    const bump = () => {
      clearTimeout(timer)
      timer = setTimeout(() => ctl.abort(), idleMs)
    }
    try {
      const res = await fetch(input, { ...init, signal: ctl.signal })
      if (!res.body) {
        clearTimeout(timer)
        return res
      }
      bump()
      const reader = res.body.getReader()
      const body = new ReadableStream<Uint8Array>({
        async pull(c) {
          try {
            const { done, value } = await reader.read()
            if (done) {
              clearTimeout(timer)
              c.close()
            } else {
              bump()
              c.enqueue(value)
            }
          } catch (e) {
            clearTimeout(timer)
            c.error(e)
          }
        },
        cancel(reason) {
          clearTimeout(timer)
          return reader.cancel(reason)
        },
      })
      return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers })
    } catch (e) {
      clearTimeout(timer)
      throw e
    }
  }
}

async function prepareModel(onProgress?: (msg: string) => void): Promise<tf.GraphModel> {
  let m: tf.GraphModel
  try {
    m = await tf.loadGraphModel(MODEL_STORE)
  } catch {
    // 이 기기에 저장된 모델이 없으면 내려받아 저장한다
    onProgress?.('처음 한 번 약 16MB를 내려받아요')
    try {
      m = await tf.loadGraphModel(YAMNET_URL, {
        fromTFHub: true,
        fetchFunc: idleGuardFetch(DOWNLOAD_IDLE_MS),
        onProgress: (f) => onProgress?.(`모델을 내려받는 중이에요 (${Math.round(f * 100)}%)`),
      })
    } catch {
      // 원인(네트워크, 주소 변경, 차단)은 여기서 가려내지 못하므로 화면 문구가 원인을 단정하지 않게 이름만 붙인다
      throw Object.assign(new Error('model download failed'), { name: 'ModelDownloadFailed' })
    }
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

/**
 * 측정 탭을 떠난 뒤 이 시간(밀리초)이 지나면 모델을 메모리에서 내린다. 0이면 끈다.
 * 다시 쓸 때는 기기에 저장된 모델(IndexedDB)을 읽어 오므로 다시 내려받지 않는다.
 */
export const IDLE_DISPOSE_MS = 60_000
let disposeTimer: ReturnType<typeof setTimeout> | undefined

export function cancelModelDispose() {
  clearTimeout(disposeTimer)
  disposeTimer = undefined
}

export function scheduleModelDispose() {
  cancelModelDispose()
  if (IDLE_DISPOSE_MS <= 0) return
  const tick = () => {
    if (loading && !model) {
      disposeTimer = setTimeout(tick, IDLE_DISPOSE_MS) // 아직 받는 중이면 끝난 뒤로 미룬다
      return
    }
    model?.dispose()
    model = null
    loading = null
    disposeTimer = undefined
  }
  disposeTimer = setTimeout(tick, IDLE_DISPOSE_MS)
}

/** 소리 크기(dBFS)를 보호자가 읽을 말로 바꾼다. 마이크마다 감도가 달라 기기 기준의 대략적인 구분이다. */
export type LoudLevel = '작음' | '보통' | '큼'
export function loudLevel(dbfs: number): LoudLevel {
  if (dbfs < -45) return '작음'
  if (dbfs < -25) return '보통'
  return '큼'
}

/**
 * 평가 혼동행렬(행=정답 태그, 열=예측 태그)에서 '이 태그로 분류된 음원 중 실제로 그 태그였던 수'를 태그별로 구한다.
 * 정답 행이 없는 태그(말소리 등)와 행렬이 없을 때는 비워 둔다.
 */
export function tagPrecision(confusion: Record<string, Record<string, number>> | undefined): Partial<Record<SenseTag, { hit: number; n: number }>> {
  const out: Partial<Record<SenseTag, { hit: number; n: number }>> = {}
  if (!confusion) return out
  for (const t of SENSE_TAGS) {
    if (!confusion[t]) continue
    let n = 0
    for (const row of Object.values(confusion)) n += row[t] ?? 0
    if (n > 0) out[t] = { hit: confusion[t][t] ?? 0, n }
  }
  return out
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
