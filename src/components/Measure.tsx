import { useEffect, useRef, useState } from 'react'
import type { Place, SoundBucket } from '../types'
import { TAG_LABEL } from '../types'
import { bestTag, classifyWindow, decodeFile, loadModel, startMic, summarize, windowsFromBuffer, type WindowResult } from '../lib/sound'
import samplesRaw from '../data/samples.json'
import { submitMeasurement } from '../lib/snapshot'

interface Sample {
  id: string
  label: string
  file: string
}
const SAMPLES = (samplesRaw as { samples: Sample[] }).samples

interface Props {
  places: Place[]
  defaultPlace: string
  onSubmitted: () => void
}

export default function Measure({ places, defaultPlace, onSubmitted }: Props) {
  const [place, setPlace] = useState(defaultPlace)
  const [status, setStatus] = useState('마이크 또는 오디오 파일로 소리 종류를 분류해요. 원음은 이 기기 밖으로 나가지 않아요.')
  const [running, setRunning] = useState(false)
  const [windows, setWindows] = useState<WindowResult[]>([])
  const [last, setLast] = useState<WindowResult | null>(null)
  const [summary, setSummary] = useState<SoundBucket | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const [sample, setSample] = useState<string | null>(null) // 샘플 소리로 만든 요약이면 그 이름
  const playRef = useRef<AudioContext | null>(null)
  const stopRef = useRef<(() => void) | null>(null)
  const busy = useRef(false)

  useEffect(() => () => {
    stopRef.current?.()
    void playRef.current?.close()
  }, [])
  useEffect(() => {
    // 개발·검증용: 콘솔에서 합성 파형으로 분류기를 시험할 수 있게 노출
    if (import.meta.env.DEV) (window as unknown as { __calmClassify?: typeof classifyWindow }).__calmClassify = classifyWindow
  }, [])

  const prefetch = async () => {
    try {
      const t0 = performance.now()
      await loadModel(setStatus)
      setStatus(`모델 준비 완료 (${((performance.now() - t0) / 1000).toFixed(1)}초). 이제 마이크로 시작할 수 있어요.`)
    } catch (e) {
      setStatus(`모델을 내려받지 못했어요: ${(e as Error).message}`)
    }
  }

  const handleWave = async (wave: Float32Array) => {
    if (busy.current) return // 추론이 1초보다 느리면 창을 건너뛴다
    busy.current = true
    try {
      const r = await classifyWindow(wave)
      setLast(r)
      setWindows((w) => [...w, r])
    } finally {
      busy.current = false
    }
  }

  const start = async () => {
    try {
      await loadModel(setStatus)
      setWindows([])
      setSummary(null)
      setSent(null)
      setSample(null)
      stopRef.current = await startMic((w) => void handleWave(w))
      setRunning(true)
      setStatus('듣는 중이에요. 30초 이상 측정하면 좋아요.')
    } catch (e) {
      setStatus(`시작하지 못했어요: ${(e as Error).message}`)
    }
  }
  const stop = () => {
    stopRef.current?.()
    stopRef.current = null
    setRunning(false)
    setWindows((w) => {
      setSummary(summarize(w))
      return w
    })
    setStatus('측정을 멈췄어요. 아래 요약을 이 장소에 반영할 수 있어요.')
  }
  const onFile = async (f: File | undefined) => {
    if (!f) return
    try {
      await loadModel(setStatus)
      setStatus('파일을 분류하는 중이에요…')
      const ws = await decodeFile(f)
      const results: WindowResult[] = []
      for (const w of ws) results.push(await classifyWindow(w))
      setWindows(results)
      setLast(results[results.length - 1] ?? null)
      setSummary(summarize(results))
      setSent(null)
      setSample(null)
      setStatus(`파일 ${ws.length}초 분량을 분류했어요.`)
    } catch (e) {
      setStatus(`파일을 읽지 못했어요: ${(e as Error).message}`)
    }
  }
  /** 내장 샘플 소리를 들려주면서 분류한다. 체험용이라 장소에는 반영하지 않는다. */
  const playSample = async (s: Sample) => {
    try {
      if (running) stop()
      void playRef.current?.close()
      const ctx = new AudioContext()
      playRef.current = ctx
      void ctx.resume()
      await loadModel(setStatus)
      setStatus(`샘플 '${s.label}'을 불러오는 중이에요…`)
      const ab = await (await fetch(`${import.meta.env.BASE_URL}samples/${s.file}`)).arrayBuffer()
      const audio = await ctx.decodeAudioData(ab)
      const src = ctx.createBufferSource()
      src.buffer = audio
      src.connect(ctx.destination)
      src.start()
      const results: WindowResult[] = []
      for (const w of windowsFromBuffer(audio)) results.push(await classifyWindow(w))
      const loudest = results.reduce<WindowResult | null>((a, r) => (!a || r.intensity > a.intensity ? r : a), null)
      const sum = summarize(results)
      const tag = bestTag(sum)
      setWindows(results)
      setLast(loudest)
      setSummary(sum)
      setSent(null)
      setSample(s.label)
      setStatus(`샘플 '${s.label}'을 ${results.length}초 분량 분류했어요. 가장 큰 태그는 ${tag ? TAG_LABEL[tag] : '없음'}이에요.`)
    } catch (e) {
      setStatus(`샘플을 재생하지 못했어요: ${(e as Error).message}`)
    }
  }
  const submit = async () => {
    if (!summary) return
    const now = new Date()
    const where = await submitMeasurement(place, summary, now.getDay(), now.getHours())
    setSent(where === 'server' ? '서버에 라벨·강도·시각만 보냈어요(원음 없음).' : '서버가 없어 이 기기에만 저장했어요.')
    onSubmitted()
  }

  return (
    <div className="page">
      <div className="card">
        <h2>현장 측정</h2>
        <p className="muted">{status}</p>
        <div className="row" style={{ marginBottom: 10 }}>
          <label>장소 <select value={place} onChange={(e) => setPlace(e.target.value)}>{places.map((p) => <option key={p.name}>{p.name}</option>)}</select></label>
        </div>
        <div className="row">
          {!running ? <button className="btn primary" onClick={start}>🎙️ 마이크로 시작</button> : <button className="btn" onClick={stop}>⏹ 멈추기</button>}
          <label className="btn">📁 오디오 파일로 시연 <input type="file" accept="audio/*" style={{ display: 'none' }} onChange={(e) => void onFile(e.target.files?.[0])} /></label>
          <button className="btn" onClick={prefetch}>⬇️ 모델 미리 받기</button>
        </div>
        <p className="muted" style={{ marginTop: 12, marginBottom: 6 }}>마이크가 없어도 샘플 소리로 체험할 수 있어요. 누르면 소리가 나요.</p>
        <div className="row" aria-label="샘플 소리">
          {SAMPLES.map((s) => (
            <button key={s.id} className="btn" onClick={() => void playSample(s)} disabled={running}>🔊 {s.label}</button>
          ))}
        </div>
        <p className="muted" style={{ marginTop: 8 }}>분류 창 {windows.length}개 {last && `· 강도 ${last.dbfs.toFixed(0)} dBFS`}</p>
        <div className="meter" aria-label="강도"><div style={{ width: `${Math.round((last?.intensity ?? 0) * 100)}%` }} /></div>
        {last && (
          <ul className="labels" aria-label="상위 분류">
            {last.top.map((t) => (
              <li key={t.name}><span>{t.name}{t.tag ? ` → ${TAG_LABEL[t.tag]}` : ''}</span><span>{(t.prob * 100).toFixed(0)}%</span></li>
            ))}
          </ul>
        )}
      </div>
      {summary && (
        <div className="card">
          <h2>{sample ? `샘플 '${sample}' 요약` : '이 세션 요약'}</h2>
          <table className="simple">
            <tbody>
              {(Object.entries(summary.tags) as [keyof typeof TAG_LABEL, number][]).map(([t, v]) => (
                <tr key={t}><th>{TAG_LABEL[t]}</th><td>{(v * 100).toFixed(0)}</td></tr>
              ))}
              <tr><th>창 수</th><td>{summary.n}</td></tr>
            </tbody>
          </table>
          {sample ? (
            <p className="muted">샘플 소리는 체험용이라 장소에 반영하지 않아요. 실제 장소의 소리는 마이크로 측정해요.</p>
          ) : (
            <>
              <p className="muted">서버로 보내는 것은 이 표의 숫자와 요일·시각뿐이에요.</p>
              <button className="btn primary" onClick={submit} disabled={!!sent}>이 장소에 반영</button>
            </>
          )}
          {sent && <p className="muted" style={{ marginTop: 8 }}>{sent}</p>}
        </div>
      )}
    </div>
  )
}
