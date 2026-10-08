import { useEffect, useRef, useState } from 'react'
import type { Place, SoundBucket } from '../types'
import { TAG_LABEL } from '../types'
import { classifyWindow, decodeFile, loadModel, startMic, summarize, windowsFromBuffer, type WindowResult } from '../lib/sound'
import { bestTag } from '../lib/tags'
import samplesRaw from '../data/samples.json'
import { submitMeasurement } from '../lib/snapshot'
import { HAS_API, kstNow } from '../lib/publicData'
import '../styles/measure.css'

interface Sample {
  id: string
  label: string
  file: string
}
const SAMPLES = (samplesRaw as { samples: Sample[] }).samples
const MIN_WINDOWS = 5 // 창 1개가 약 1초라서, 이보다 짧은 측정은 장소에 반영하지 않는다
const DOW = ['일', '월', '화', '수', '목', '금', '토']

/** 브라우저와 라이브러리가 던지는 영어 오류를 가족이 따라 할 수 있는 한국어 안내로 바꾼다. */
function whyFailed(e: unknown, decodeMsg = '이 파일 형식은 읽을 수 없어요. wav나 mp3 파일을 써 주세요.'): string {
  const err = (e ?? {}) as { name?: string; message?: string }
  const name = err.name ?? ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return '마이크 사용이 막혀 있어요. 주소창의 자물쇠에서 마이크를 허용해 주세요.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return '이 기기에서 마이크를 찾지 못했어요. 샘플 소리나 오디오 파일로 체험할 수 있어요.'
  if (name === 'NotReadableError') return '마이크를 쓸 수 없어요. 마이크를 쓰는 다른 앱을 닫고 다시 눌러 주세요.'
  if (name === 'AudioNotRunning') return '소리를 받을 준비가 되지 않았어요. 다른 앱의 소리를 멈추고 다시 눌러 주세요. 계속 안 되면 샘플 소리나 오디오 파일로 체험할 수 있어요.'
  if (name === 'EncodingError') return decodeMsg
  if (name === 'NetworkError' || /fetch|network|load failed|failed with status|request for/i.test(err.message ?? '')) return '인터넷 연결을 확인하고 다시 눌러 주세요.'
  return '잠시 뒤 다시 해 보세요.'
}

interface Props {
  places: Place[]
  defaultPlace: string
  onSubmitted: () => void
  onRunningChange?: (running: boolean) => void
}

export default function Measure({ places, defaultPlace, onSubmitted, onRunningChange }: Props) {
  const [place, setPlace] = useState(defaultPlace)
  const [status, setStatus] = useState('마이크 또는 오디오 파일로 소리 종류를 분류해요. 원음은 이 기기 밖으로 나가지 않아요.')
  const [isErr, setIsErr] = useState(false) // 상태 문구가 오류면 스크린리더에 바로 읽히게 role='alert'로 보여 준다
  const [running, setRunning] = useState(false)
  const [windows, setWindows] = useState<WindowResult[]>([])
  const [last, setLast] = useState<WindowResult | null>(null)
  const [summary, setSummary] = useState<SoundBucket | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const [sample, setSample] = useState<string | null>(null) // 샘플 소리로 만든 요약이면 그 이름
  const [fromFile, setFromFile] = useState<string | null>(null) // 시연용 오디오 파일로 만든 요약이면 파일 이름
  const [quiet, setQuiet] = useState(false) // 샘플을 소리 없이 분류만 한다
  const [starting, setStarting] = useState(false)
  const playRef = useRef<AudioContext | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const say = (s: string) => {
    setStatus(s)
    setIsErr(false)
  }
  const fail = (s: string) => {
    setStatus(s)
    setIsErr(true)
  }
  const playToken = useRef(0) // 마이크 시작, 파일 분류, 샘플 재생 중 하나를 새로 시작하면 올려서, 진행 중이던 이전 동작이 화면을 덮어쓰지 못하게 한다
  const stopSample = () => {
    playToken.current++
    void playRef.current?.close()
    playRef.current = null
  }
  const stopRef = useRef<(() => void) | null>(null)
  const busy = useRef(false)

  useEffect(() => () => {
    playToken.current++
    stopRef.current?.()
    void playRef.current?.close()
  }, [])
  useEffect(() => {
    // 측정 중에는 앱이 탭을 옮기기 전에 확인을 받을 수 있게 알린다. 측정 중에 화면이 사라져도 알림을 풀어 둔다.
    onRunningChange?.(running)
    return () => {
      if (running) onRunningChange?.(false)
    }
  }, [running])
  useEffect(() => {
    // 개발·검증용: 콘솔에서 합성 파형으로 분류기를 시험할 수 있게 노출
    if (import.meta.env.DEV) (window as unknown as { __calmClassify?: typeof classifyWindow }).__calmClassify = classifyWindow
  }, [])

  const prefetch = async () => {
    try {
      const t0 = performance.now()
      await loadModel(say)
      say(`모델 준비 완료 (${((performance.now() - t0) / 1000).toFixed(1)}초). 이제 마이크로 시작할 수 있어요.`)
    } catch (e) {
      fail(`모델을 내려받지 못했어요. ${whyFailed(e)}`)
    }
  }

  const handleWave = async (wave: Float32Array) => {
    if (busy.current) return // 추론이 1초보다 느리면 창을 건너뛴다
    busy.current = true
    const my = playToken.current
    try {
      const r = await classifyWindow(wave)
      if (my !== playToken.current) return // 멈춘 뒤에 끝난 창은 요약에 들어가지 않으므로 세지 않는다
      setLast(r)
      setWindows((w) => [...w, r])
    } finally {
      busy.current = false
    }
  }

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      fail('이 브라우저에서는 마이크를 쓸 수 없어요. Safari나 Chrome에서 열어 주세요. 샘플 소리나 오디오 파일로 체험할 수 있어요.')
      return
    }
    stopSample()
    const my = playToken.current
    // iOS는 버튼을 누른 직후에 만들어 깨운 AudioContext만 소리를 받아서, 모델을 기다리기 전에 먼저 만든다
    const ctx = new AudioContext()
    void ctx.resume()
    let handedOver = false // 마이크 연결이 성공하면 정지 함수가 ctx를 닫는다
    setStarting(true)
    say('마이크를 켜는 중이에요…')
    try {
      await loadModel(say)
      if (my !== playToken.current) return
      const s = await startMic((w) => void handleWave(w), ctx)
      handedOver = true
      if (my !== playToken.current) {
        s() // 기다리는 사이 다른 동작이 시작됐으면 방금 연 마이크를 바로 닫는다
        return
      }
      setWindows([])
      setSummary(null)
      setSent(null)
      setSample(null)
      setFromFile(null)
      stopRef.current = s
      setRunning(true)
      say('듣는 중이에요. 30초 이상 측정하면 좋아요.')
    } catch (e) {
      if (my !== playToken.current) return
      fail(`시작하지 못했어요. ${whyFailed(e)}`)
    } finally {
      if (!handedOver) void ctx.close().catch(() => undefined)
      if (my === playToken.current) setStarting(false)
    }
  }
  const stop = () => {
    playToken.current++
    setStarting(false)
    stopRef.current?.()
    stopRef.current = null
    setRunning(false)
    if (windows.length === 0) {
      setSummary(null)
      fail('소리가 잡히지 않았어요. 1초 이상 측정하고, 마이크 권한과 마이크까지의 거리를 확인해 주세요.')
      return
    }
    setSummary(summarize(windows))
    say('측정을 멈췄어요. 아래 요약을 이 장소에 반영할 수 있어요.')
  }
  const onFile = async (f: File | undefined) => {
    if (!f) return
    stopSample()
    const my = playToken.current
    say('파일을 불러오는 중이에요…')
    try {
      await loadModel(say)
      if (my !== playToken.current) return
      say('파일을 분류하는 중이에요…')
      const ws = await decodeFile(f)
      if (my !== playToken.current) return
      if (ws.length === 0) {
        setWindows([])
        setLast(null)
        setSummary(null)
        fail('이 파일은 1초보다 짧아서 분류하지 못했어요. 1초 이상인 파일을 써 주세요.')
        return
      }
      const results: WindowResult[] = []
      for (const w of ws) {
        results.push(await classifyWindow(w))
        if (my !== playToken.current) return
      }
      setWindows(results)
      setLast(results[results.length - 1] ?? null)
      setSummary(summarize(results))
      setSent(null)
      setSample(null)
      setFromFile(f.name)
      say(`파일 ${ws.length}초 분량을 분류했어요.`)
    } catch (e) {
      if (my !== playToken.current) return
      fail(`파일을 읽지 못했어요. ${whyFailed(e)}`)
    }
  }
  /** 내장 샘플 소리를 들려주면서 분류한다. 체험용이라 장소에는 반영하지 않는다. */
  const playSample = async (s: Sample) => {
    if (running) stop()
    stopSample()
    const my = playToken.current
    try {
      const ctx = new AudioContext()
      playRef.current = ctx
      void ctx.resume()
      say(`'${s.label}' 샘플을 준비하는 중이에요…`)
      await loadModel(say)
      if (my !== playToken.current) return
      say(`'${s.label}' 샘플을 불러오는 중이에요…`)
      const ab = await (await fetch(`${import.meta.env.BASE_URL}samples/${s.file}`)).arrayBuffer()
      if (my !== playToken.current) return
      const audio = await ctx.decodeAudioData(ab)
      if (my !== playToken.current) return
      if (!quiet) {
        const src = ctx.createBufferSource()
        src.buffer = audio
        const gain = ctx.createGain()
        gain.gain.value = 0.35 // 사이렌처럼 큰 소리가 아이에게 갑자기 크게 들리지 않게 낮춘다
        src.connect(gain).connect(ctx.destination)
        src.start()
      }
      const results: WindowResult[] = []
      for (const w of windowsFromBuffer(audio)) {
        results.push(await classifyWindow(w))
        if (my !== playToken.current) return
      }
      const loudest = results.reduce<WindowResult | null>((a, r) => (!a || r.intensity > a.intensity ? r : a), null)
      const sum = summarize(results)
      const tag = bestTag(sum)
      setWindows(results)
      setLast(loudest)
      setSummary(sum)
      setSent(null)
      setSample(s.label)
      setFromFile(null)
      say(tag ? `'${s.label}' 샘플 ${results.length}초 분량을 분류했어요. 가장 큰 태그로 '${TAG_LABEL[tag]}' 태그가 나왔어요.` : `'${s.label}' 샘플 ${results.length}초 분량을 분류했지만 뚜렷한 태그가 나오지 않았어요.`)
    } catch (e) {
      if (my !== playToken.current) return // 다른 동작이 이 재생을 취소한 경우
      fail(`샘플을 재생하지 못했어요. ${whyFailed(e, '샘플 소리를 읽지 못했어요. 잠시 뒤 다시 해 보세요.')}`)
    }
  }
  const submit = async () => {
    if (!summary || summary.n < MIN_WINDOWS) return
    const k = kstNow() // 기기 시간대와 무관하게 한국 시각의 요일·시 칸에 반영한다
    if (fromFile && !confirm(`이 파일의 소리를 ${place} ${DOW[k.dow]}요일 ${k.hour}시 칸에 반영할까요? 현장에서 잰 소리가 아니라 시연용 파일이에요.`)) return
    const where = await submitMeasurement(place, summary, k.dow, k.hour)
    setSent(where === 'server' ? '서버에 라벨·강도·시각만 보냈어요(원음 없음).' : '이 기기에만 저장했어요.')
    onSubmitted()
  }

  const pct = Math.round((last?.intensity ?? 0) * 100)
  return (
    <div className="page">
      <div className="card">
        <h2>현장 측정</h2>
        <p className="muted m-status" role="status">{isErr ? '' : status}</p>
        {isErr && <p className="m-err" role="alert">{status}</p>}
        <div className="row" style={{ marginBottom: 10 }}>
          <label>장소 <select value={place} onChange={(e) => setPlace(e.target.value)}>{places.map((p) => <option key={p.name}>{p.name}</option>)}</select></label>
        </div>
        <div className="row">
          {!running ? <button className="btn primary" onClick={start} disabled={starting}>{starting ? '준비 중…' : '🎙️ 마이크로 시작'}</button> : <button className="btn" onClick={stop}>⏹ 멈추기</button>}
          <input ref={fileRef} type="file" accept="audio/*" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
          <button className="btn" onClick={() => fileRef.current?.click()} disabled={running || starting}>📁 오디오 파일로 시연</button>
          <button className="btn" onClick={prefetch}>⬇️ 모델 미리 받기</button>
        </div>
        <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>처음 한 번 약 16MB를 내려받아요. 와이파이를 권하고, 받은 모델은 이 기기에 저장해 둬요.</p>
        <p className="muted" style={{ marginTop: 12, marginBottom: 6 }}>마이크가 없어도 샘플 소리로 체험할 수 있어요. 누르면 소리가 나요. 사이렌과 오토바이 엔진은 큰 소리예요. 아이가 가까이 있으면 볼륨을 낮춰 주세요. 샘플은 분류가 예상대로 나오는 예시를 고른 것이고, 공개 음원 920개로 잰 일치율은 정보 화면에 있어요.</p>
        <label className="m-check"><input type="checkbox" checked={quiet} onChange={(e) => setQuiet(e.target.checked)} />소리 없이 분류만 하기</label>
        <div className="row" role="group" aria-label="샘플 소리">
          {SAMPLES.map((s) => (
            <button key={s.id} className="btn" onClick={() => void playSample(s)} disabled={running || starting}>🔊 {s.label}</button>
          ))}
        </div>
        <p className="muted" style={{ marginTop: 8 }}>분류 창 {windows.length}개 {last && `· 강도 ${last.dbfs.toFixed(0)} dBFS`}</p>
        <div className="meter" role="progressbar" aria-label="소리 강도" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><div style={{ width: `${pct}%` }} /></div>
        {last && (
          <ul className="labels" aria-label="상위 분류">
            {last.top.map((t) => (
              <li key={t.name}><span>{t.tag ? TAG_LABEL[t.tag] : '그 밖의 소리'} <span lang="en" className="muted">{t.name}</span></span><span>{(t.prob * 100).toFixed(0)}%</span></li>
            ))}
          </ul>
        )}
      </div>
      {summary && (
        <div className="card">
          <h2>{sample ? `'${sample}' 샘플 요약` : '이 세션 요약'}</h2>
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
              <p className="muted">{HAS_API ? '서버로 보내는 것은 장소 이름과 이 표의 숫자, 요일·시각뿐이에요.' : '이 사이트에는 받는 서버가 없어서 아무것도 보내지 않고 이 기기에만 저장해요.'}</p>
              {fromFile && <p className="muted">시연용 파일 결과라서, 반영하기 전에 한 번 더 물어봐요.</p>}
              {summary.n < MIN_WINDOWS && <p className="muted">표본이 {MIN_WINDOWS}개보다 적어서 장소에 반영할 수 없어요. {MIN_WINDOWS}초 이상 측정해 주세요.</p>}
              <button className="btn primary" onClick={submit} disabled={!!sent || summary.n < MIN_WINDOWS}>이 장소에 반영</button>
            </>
          )}
          {sent && <p className="muted" style={{ marginTop: 8 }}>{sent}</p>}
        </div>
      )}
    </div>
  )
}
