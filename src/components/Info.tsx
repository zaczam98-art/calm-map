import { Fragment, useEffect, useMemo, useState } from 'react'
import type { ForecastMetrics, LeadMetric, NoiseData, SenseTag, Snapshot, WeekPattern } from '../types'
import { TAG_LABEL } from '../types'
import samplesRaw from '../data/samples.json'
import { HAS_API, loadPublicJson } from '../lib/publicData'
import { level3, noiseScore, NOISE_WEIGHT } from '../lib/index'
import { noiseLookup } from '../lib/noise'
import soundEval from '../data/sound_eval.json'
import '../styles/child.css'
import '../styles/info.css'

const SAMPLES = samplesRaw.samples
const CLASS_KO: Record<string, string> = { chainsaw: '전기톱', wind: '바람', car_horn: '자동차 경적', laughing: '웃음소리', crickets: '귀뚜라미', clapping: '박수' }

const pct = (a: number, n: number) => (n > 0 ? `${Math.round((a / n) * 100)}%` : '자료 없음')
const LEADS = ['1', '2', '3', '6', '12']
const NO_PAIRS: LeadMetric = { n: 0, exact: 0, within1: 0, persistN: 0, persistExact: 0 }
/** 적중률 계산이 나중에 더한 필드. 옛 metrics.json에는 없어서 선택 필드로 읽는다. */
type LeadExtra = LeadMetric & { over?: number; biasSum?: number; popHit?: number; persistPopHit?: number }

/** 서울시 예측의 단계 일치율이 '그대로 유지 가정'보다 낮은 시차(표에 보이는 정수 %로 비교)를 'N시간 전(예측 a%, 유지 가정 b%)' 꼴로 돌려준다. */
function lowerThanPersist(metrics: ForecastMetrics): string[] {
  return LEADS.flatMap((k) => {
    const m = metrics.byLead[k]
    if (!m || m.n <= 0 || m.persistN <= 0) return []
    const a = Math.round((m.exact / m.n) * 100)
    const b = Math.round((m.persistExact / m.persistN) * 100)
    return a < b ? [`${k}시간 전(예측 ${a}%, 유지 가정 ${b}%)`] : []
  })
}

/** 예측 단계가 실제 관측 단계보다 높았던 비교의 비율과 평균 차이를 한 문장으로 돌려준다. 값이 없는 옛 metrics.json에서는 null이다. */
function biasSentence(metrics: ForecastMetrics): string | null {
  const o: LeadExtra = metrics.overall
  if (o.n <= 0 || o.over === undefined || o.biasSum === undefined) return null
  const mean = o.biasSum / o.n
  return `예측 단계가 실제 관측 단계보다 높았던 비교는 전체의 ${pct(o.over, o.n)}이고, 예측 단계는 관측 단계보다 평균 ${Math.abs(mean).toFixed(2)}단계 ${mean >= 0 ? '높아요' : '낮아요'}.`
}

/** 예측한 인구(중앙값)와 유지 가정(그 시간 전 관측의 인구 중앙값)이 실제 관측의 인구 범위 안에 든 비율을 시차별 한 줄로 돌려준다. 값이 없는 시차는 뺀다. */
function populationLines(metrics: ForecastMetrics): string[] {
  return LEADS.flatMap((k) => {
    const m: LeadExtra | undefined = metrics.byLead[k]
    if (!m || m.n <= 0 || m.persistN <= 0 || m.popHit === undefined || m.persistPopHit === undefined) return []
    return [`${k}시간 전: 예측 ${pct(m.popHit, m.n)}(${m.popHit}/${m.n}), 유지 가정 ${pct(m.persistPopHit, m.persistN)}(${m.persistPopHit}/${m.persistN})`]
  })
}

/**
 * 요일×시간대 평균 혼잡 단계(pattern.json)만으로 정한 단계와, 같은 칸에 주변 소음(noise.json)을 더한 지수의 단계를 견줘 달라지는 칸을 센다.
 * 한 칸은 장소·요일·시간 한 조합이고 8~21시만 본다. 혼잡 점수는 단계 기준값(15, 40, 65, 90)만 쓰고(±10 보정 제외), 소리 측정과 맞춤은 넣지 않는다.
 */
function noiseShift(pattern: WeekPattern, noise: NoiseData): { cells: number; changed: number; up: number; down: number } | null {
  let cells = 0
  let up = 0
  let down = 0
  for (const [place, byKey] of Object.entries(pattern.places)) {
    const look = noiseLookup(noise, place)
    for (const [key, cell] of Object.entries(byKey)) {
      const [dow, hour] = key.split('-').map(Number)
      if (hour < 8 || hour > 21) continue
      const n = noiseScore(look(hour, dow))
      if (n === null) continue
      const c = 15 + 25 * Math.max(0, Math.min(3, Math.round(cell[0])))
      const index = Math.round((1 - NOISE_WEIGHT) * c + NOISE_WEIGHT * n)
      cells++
      if (level3(index) !== level3(c)) index > c ? up++ : down++
    }
  }
  return cells > 0 ? { cells, changed: up + down, up, down } : null
}

export default function Info({ snap, metrics, noise, placeCount, pattern: patternProp }: { snap: Snapshot | null; metrics: ForecastMetrics | null; noise: NoiseData | null; placeCount: number; pattern?: WeekPattern | null }) {
  // 부모가 pattern을 넘기지 않으면(undefined) 이 화면이 직접 받는다
  const [fetched, setFetched] = useState<WeekPattern | null>(null)
  useEffect(() => {
    if (patternProp !== undefined) return
    let alive = true
    void loadPublicJson<WeekPattern>('pattern.json').then((v) => alive && setFetched(v))
    return () => {
      alive = false
    }
  }, [patternProp])
  const pattern = patternProp === undefined ? fetched : patternProp
  const shift = useMemo(() => (pattern && noise ? noiseShift(pattern, noise) : null), [pattern, noise])
  const lower = metrics ? lowerThanPersist(metrics) : []
  const bias = metrics ? biasSentence(metrics) : null
  const popLines = metrics ? populationLines(metrics) : []
  return (
    <div className="page">
      <div className="card">
        <h2>무던한 지도란</h2>
        <h3 className="sub">쉬운 설명</h3>
        <ul className="easy">
          <li>지도의 점은 지금 그 장소가 얼마나 붐비고 시끄러운지 보여 줘요.</li>
          <li>연한 점일수록 무던해요.</li>
          <li>가기 전에 무던한 시간을 골라 보세요.</li>
        </ul>
        <p>발달장애 아동 가족이 외출 전에 "이 장소는 오늘 몇 시가 무던한가"를 보는 지도예요. 장소에 점수를 매기는 것이 아니라, 장소와 시간대의 조합을 보여 줘요.</p>
        <p className="muted">2026 AI 라이프 아이디어 챌린지 수상 후보작 "무던한 지도(Calm Map)"를 AI 라이프 솔루션 챌린지에서 구현한 시제품이에요.</p>
      </div>
      <div className="card">
        <h2>AI는 세 군데에서 일하고, 지수는 공개된 규칙으로 계산해요</h2>
        <table className="simple def">
          <tbody>
            <tr><th>소리 종류 분류</th><td>YAMNet(AudioSet 521종)을 TensorFlow.js로 기기 안에서 실행해요. 소리의 크기가 아니라 종류(사이렌, 군중, 음악, 말소리…)를 알아내요. 원음은 서버로 보내지 않아요.</td></tr>
            <tr><th>감각부하 지수(규칙)</th><td>서울시 실시간 도시데이터의 12시간 혼잡도 예측, 주변 센서의 평소 소음, 소리 분류 결과를 아래 산식으로 합쳐 장소×시간대 지수(0~100)를 계산하고, 아이의 민감 요인과 다녀온 뒤 기록으로 다시 계산해요. 이 부분은 학습 모델이 아니라 누구나 확인할 수 있는 고정 규칙이에요.</td></tr>
            <tr><th>미리 보는 카드</th><td>특수교육의 사회적 이야기 기법을 따라 3~5단계 그림 문장을 생성형 AI가 만들고, 규칙 검사(권고형, 금지어, 글자 수)를 통과한 것만 보여 줘요.</td></tr>
            <tr><th>오늘의 브리핑</th><td>규칙이 여유로운 시간대 후보를 계산하고 생성형 AI가 그중에서 골라 문장을 써요. 장소와 시간대는 예측과 다시 대조하고, 문장은 길이·어미·금지 표현을 검사해요.</td></tr>
          </tbody>
        </table>
      </div>
      <div className="card">
        <h2>지수 산식(가설 v1)</h2>
        <p>지수는 0~100이고 낮을수록 편안해요. 장소와 시간대마다 아래 순서로 계산해요.</p>
        <ol className="formula">
          <li>
            혼잡 점수 C는 서울시 혼잡도 단계의 기준값에서 시작해요.
            <ul>
              <li>기준값은 여유 15, 보통 40, 약간 붐빔 65, 붐빔 90이에요.</li>
              <li>그 장소의 12시간 예측 안에서 예상 인구가 많은 시간은 최대 10점을 더하고, 적은 시간은 최대 10점을 빼요.</li>
            </ul>
          </li>
          <li>
            소음 점수 N은 주변 서울시 센서가 같은 요일·시간대에 잰 평균 소음을 점수로 바꾼 값이에요.
            <ul>
              <li>평균 40dB은 0점이고 75dB은 100점이에요.</li>
              <li>그 시간의 최대 소음이 평균보다 3dB을 넘게 높으면, 넘은 1dB마다 4점씩 최대 20점을 더해요.</li>
            </ul>
          </li>
          <li>기본 지수 B는 소음 자료가 있으면 0.6 × C + 0.4 × N이고, 없으면 C와 같아요.</li>
          <li>
            소리 점수 S는 현장 측정을 반영한 장소·요일·시간대에만 있어요.
            <ul>
              <li>S = 100 × Σ(태그별 (확률×강도) 평균 × 태그 가중 × 민감도)이고, 0~100으로 제한해요.</li>
              <li>태그 가중은 돌발음 1.0, 군중 0.7, 기계·차량 0.5, 음악·안내방송 0.5, 말소리 0.3, 배경 0.1이에요.</li>
              <li>민감도는 맞춤을 켠 때만 0.5, 1, 1.5 중에서 쓰고, 끄면 모두 1이에요.</li>
            </ul>
          </li>
          <li>
            최종 지수는 (1 − w) × B + w × S이고, 소리 표본이 n개일 때 w = min(0.5, n / (n + 6))이에요.
            <ul>
              <li>소리 표본이 없으면 w는 0이라서 지수는 B와 같아요.</li>
              <li>맞춤을 켠 때만 다녀온 뒤 기록으로 정한 장소별 보정값(-20~+20)을 더해요.</li>
              <li>지수는 반올림한 정수이고, 35 미만은 무던함, 35 이상 65 미만은 보통, 65 이상은 붐빔이에요.</li>
            </ul>
          </li>
        </ol>
        <p className="muted">맞춤을 켜면 아래 값이 달라져요.</p>
        <ul className="apply">
          <li>혼잡 점수 C에 혼잡 민감도를 곱해요.</li>
          <li>소음 점수 N의 평균 부분에는 큰 소리 민감도를, 큰 소리 가산에는 돌발음 민감도를 곱해요.</li>
          <li>소리 점수 S의 태그마다 그 태그의 민감도를 곱해요.</li>
          <li>최종 지수에 다녀온 뒤 기록의 보정값을 더해요.</li>
        </ul>
        <p className="muted">이 산식과 숫자는 검증 전 가설이에요. 공사·행사 정보는 지수에 넣지 않고 따로 보여 줘요.</p>
        {shift && pattern && (
          <div className="stat">
            <h3 className="sub">소음을 더하면 단계가 달라지는 칸</h3>
            <p>
              혼잡 평균과 소음 평균이 모두 있는 8~21시 {shift.cells}칸 가운데 {shift.changed}칸({Math.round((shift.changed / shift.cells) * 1000) / 10}%)은 소음까지 더한 지수의 단계가 혼잡만으로 정한 단계와 달랐어요.
              더 편안한 단계로 바뀐 칸은 {shift.down}칸, 더 붐비는 단계로 바뀐 칸은 {shift.up}칸이에요.
            </p>
            <p className="muted">
              칸은 장소·요일·시간대 한 조합이에요. 혼잡 평균은 {pattern.days}일 동안 관측한 값이라서 참고치로만 봐 주세요. 혼잡 점수는 단계 기준값만 써서(±10 보정 제외) 소리 측정과 맞춤 없이 계산했어요.
            </p>
          </div>
        )}
      </div>
      <div className="card">
        <h2>개인정보</h2>
        <p className="muted">아이의 이름, 진단명, 행동 기록을 받지 않아요. 프로필(민감 요인 7개의 3단계 값)과 다녀온 뒤 기록, 소리 측정 요약은 이 기기의 저장소에만 있어요. {HAS_API ? '소리 측정 요약(장소, 요일, 시각, 태그별 숫자)과 카드 요청(장소, 시간대, 예민한 요인의 이름)은 서버로 전달돼요.' : '이 사이트에는 받는 서버가 없어서 프로필, 기록, 소리 측정 요약, 내 위치는 이 기기 밖으로 나가지 않아요. 지도 타일, 자료 파일, 소리 분류 모델을 받을 때는 접속 정보(IP 주소)가 OpenStreetMap, GitHub, TF Hub(Kaggle, Google Cloud Storage로 연결)에 전달돼요.'} 생성형 AI에는 자료 수집 단계에서 장소 이름과 혼잡도 예측만 전달돼요. 위치를 허용하면 거리 계산에만 쓰고 저장하지 않아요.</p>
        <p className="muted">카드 읽어 주기는 이 기기의 음성 합성 기능을 써요.</p>
      </div>
      <div className="card">
        <h2>데이터 출처</h2>
        <p className="muted">본 서비스는 서울특별시 공공데이터를 사용한 결과입니다. 서울 열린데이터광장 "서울시 실시간 도시데이터"(citydata, 공공누리 제1유형)에서 주요 장소 {placeCount}곳의 혼잡도와 12시간 예측, 문화행사, 사고·통제, 날씨, 도로 소통을 받아요. "스마트서울 도시데이터 센서(S-DoT) 환경정보"에서 장소 가까이 있는 센서의 시간대별 소음을 받아요{noise ? `(${noise.from}부터 ${noise.to}까지 ${noise.days}일 치, ${Object.keys(noise.places).length}곳)` : ''}. 지도는 OpenStreetMap 타일(ODbL), 소리 분류 모델은 YAMNet(Apache-2.0)이에요.
          {snap ? ` 현재 자료: ${snap.source === 'seoul' ? '서울시 API' : '데모 스냅샷'} (${snap.updatedAt} 기준).` : ''}</p>
      </div>
      <div className="card">
        <h2>예측이 얼마나 맞았나</h2>
        {metrics && metrics.overall.n >= 100 ? (
          <>
            <table className="simple metrics">
              <thead>
                <tr><th>예측 시차</th><th>비교 건수</th><th>단계 일치</th><th>한 단계 이내</th><th>유지 가정</th></tr>
              </thead>
              <tbody>
                {LEADS.filter((k) => (metrics.byLead[k]?.n ?? 0) > 0).map((k) => {
                  const m = metrics.byLead[k] ?? NO_PAIRS
                  return (
                    <tr key={k}><th>{k}시간 전</th><td>{m.n}</td><td>{pct(m.exact, m.n)}</td><td>{pct(m.within1, m.n)}</td><td>{pct(m.persistExact, m.persistN)}</td></tr>
                  )
                })}
                <tr><th>시차 합</th><td>{metrics.overall.n}</td><td>{pct(metrics.overall.exact, metrics.overall.n)}</td><td>{pct(metrics.overall.within1, metrics.overall.n)}</td><td>{pct(metrics.overall.persistExact, metrics.overall.persistN)}</td></tr>
              </tbody>
            </table>
            <p className="muted">
              서울시가 준 혼잡도 예측(4단계)을 그 시각의 실제 관측과 비교한 값이에요. 무던한 지도의 지수는 이 예측을 입력으로 쓰기 때문에 예측이 맞은 정도를 그대로 공개해요.
              "유지 가정"은 예측 없이 그 시간 전의 혼잡 단계가 이어진다고 봤을 때의 일치율이에요.
              "N시간 전"은 서울시 실시간 값이 속한 정시(19시 35분 값이면 19시)에서 N시간 뒤를 맞힌 예측이에요. 값에 적힌 시각이 받은 시각보다 이르기 때문에, 받은 시각부터 재면 한 시간쯤 짧아요.
              같은 시각의 장소들은 함께 오르내려서 비교 건수만큼 서로 독립적인 확인은 아니에요. {metrics.firstObs?.slice(0, 10)}부터 관측한 날 {metrics.days}일 동안 관측 {metrics.nObs}건을 모았고({metrics.updatedAt} 계산),
              기간이 짧은 동안에는 참고용으로만 봐 주세요.
            </p>
            {lower.length > 0 && (
              <p className="muted">
                서울시 예측의 단계 일치율이 "유지 가정"보다 낮은 시차는 {lower.join(', ')}이에요. 이 시차에서는 지금 단계가 이어진다고 본 쪽이 더 자주 맞았어요.
                지수는 이 예측을 입력으로 쓰기 때문에, 이 시차의 예측으로 계산한 칸은 참고용으로만 봐 주세요.
              </p>
            )}
            {bias && (
              <p className="muted">
                {bias} 예측과 실시간 값은 서울시가 따로 매기는 단계라서 기준이 같지 않을 수 있고, 다르면 그 차이가 "단계 일치"에 그대로 들어가요.
              </p>
            )}
            {popLines.length > 0 && (
              <p className="muted">
                단계 이름 대신 인구 범위로 보면, 예측한 인구(중앙값)가 실제 관측의 인구 범위 안에 든 비율과 "유지 가정"(그 시간 전 관측의 인구 중앙값)이 같은 범위 안에 든 비율은 아래와 같아요.
                {popLines.map((line) => (
                  <Fragment key={line}>
                    <br />
                    {line}
                  </Fragment>
                ))}
              </p>
            )}
          </>
        ) : (
          <p className="muted">서울시 혼잡도 예측과 실제 관측을 비교할 자료를 모으는 중이에요(지금 {metrics?.overall.n ?? 0}건). 비교가 100건을 넘으면 여기에 일치율이 표시돼요.</p>
        )}
      </div>
      <div className="card">
        <h2>소리 분류를 공개 음원으로 시험한 결과</h2>
        <table className="simple fit">
          <thead>
            <tr><th>태그</th><th>음원 수</th><th>맞은 수</th><th>일치율</th></tr>
          </thead>
          <tbody>
            {(Object.entries(soundEval.byTag) as [SenseTag, { n: number; correct: number }][]).map(([t, m]) => (
              <tr key={t}><th>{TAG_LABEL[t]}</th><td>{m.n}</td><td>{m.correct}</td><td>{pct(m.correct, m.n)}</td></tr>
            ))}
            <tr><th>전체</th><td>{soundEval.overall.n}</td><td>{soundEval.overall.correct}</td><td>{pct(soundEval.overall.correct, soundEval.overall.n)}</td></tr>
          </tbody>
        </table>
        <p className="muted">
          앱과 같은 모델(YAMNet)과 같은 태그 기준으로 공개 음원 {soundEval.clips}개({soundEval.dataset}의 {soundEval.classes}개 분류)를 분류해 본 값이에요({soundEval.evaluatedAt} 시험).
          음원마다 가장 큰 태그가 미리 정해 둔 정답표와 같으면 맞은 것으로 셌어요. 잘 틀린 소리는 아래와 같아요.
        </p>
        <ul className="credits">
          {soundEval.weakest.map((w) => (
            <li key={w.category}>{CLASS_KO[w.category] ?? w.category}: {w.n}개 중 {w.correct}개 맞음, 주로 '{TAG_LABEL[w.mostConfused as SenseTag] ?? w.mostConfused}' 태그로 분류</li>
          ))}
        </ul>
        <p className="muted">
          말소리 태그는 이 데이터에 해당 분류가 없어 시험하지 못했고, 음악·안내방송 태그는 종소리 한 분류로만 시험했어요. 실제 장소에서는 여러 소리가 섞이기 때문에 이 수치보다 낮을 수 있어요.
          시험은 브라우저가 아닌 Node 환경에서 했고, 정답표(scripts/esc50_tag_map.json)와 음원별 결과(docs/eval/esc50_result.json)는 저장소에 있어요.
        </p>
      </div>
      <div className="card">
        <h2>샘플 소리 출처</h2>
        <p className="muted">
          현장 측정 화면의 샘플 소리는 ESC-50 데이터셋(K. J. Piczak, 2015)에 실린 음원 가운데 개별 라이선스가 CC0인 것만 골랐어요. 원 출처는 Freesound예요.
        </p>
        <ul className="credits">
          {SAMPLES.map((s) => (
            <li key={s.id}>{s.label}: <a href={s.credit.url} target="_blank" rel="noreferrer">{s.credit.title}</a>, {s.credit.author}, {s.credit.license}</li>
          ))}
        </ul>
      </div>
      <div className="card">
        <h2>한계</h2>
        <p className="muted">혼잡도는 공원·상권·역 같은 지역 단위라 개별 가게의 환경과 달라요. 스마트폰 마이크는 기종마다 편차가 있어요. 지수는 예측이지 진단이 아니고, 문구는 항상 권고형이에요.</p>
      </div>
    </div>
  )
}
