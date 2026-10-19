import { Fragment, useEffect, useMemo, useState } from 'react'
import type { ForecastMetrics, LeadMetric, NoiseData, SenseTag, Snapshot, WeekPattern } from '../types'
import { TAG_LABEL } from '../types'
import samplesRaw from '../data/samples.json'
import { HAS_API, loadPublicJson } from '../lib/publicData'
import { level3, NOISE_DB_HIGH, NOISE_DB_LOW, noiseScore, NOISE_WEIGHT } from '../lib/index'
import { NOISE_HIGH_FROM_DB, NOISE_MID_FROM_DB, SPIKE_BIG_ADD } from '../lib/scoreWords'
import { noiseLookup } from '../lib/noise'
import { NOT_COLLECTED } from '../lib/landingCopy'
import { accuracyPending, accuracyText, BUSY_FROM, LEADS, lowerLeads, meaningNote, MID_FROM, MIN_PAIRS, pct, stampText } from '../lib/trustText'
import soundEval from '../data/sound_eval.json'
import { FEEDBACK_EMAIL } from './FeedbackMail'
import '../styles/child.css'
import '../styles/info.css'

const SAMPLES = samplesRaw.samples
const CLASS_KO: Record<string, string> = { chainsaw: '전기톱', wind: '바람', car_horn: '자동차 경적', laughing: '웃음소리', crickets: '귀뚜라미', clapping: '박수' }

const NO_PAIRS: LeadMetric = { n: 0, exact: 0, within1: 0, persistN: 0, persistExact: 0 }
/** 적중률 계산이 나중에 더한 필드. 옛 metrics.json에는 없어서 선택 필드로 읽는다. */
type LeadExtra = LeadMetric & { over?: number; biasSum?: number; popHit?: number; persistPopHit?: number }

/** 서울시 예측의 단계 일치율이 '그대로 유지 가정'보다 낮은 시차(표에 보이는 정수 %로 비교)를 'N시간 전(예측 a%, 유지 가정 b%)' 꼴로 돌려준다. */
function lowerThanPersist(metrics: ForecastMetrics): string[] {
  return lowerLeads(metrics).map(({ lead, a, b }) => `${lead}시간 전(예측 ${a}%, 유지 가정 ${b}%)`)
}

/** 예측 단계가 실제 관측 단계보다 높았던 비교의 비율과 평균 차이를 한 문장으로 돌려준다. 값이 없는 옛 metrics.json에서는 null이다. */
function biasSentence(metrics: ForecastMetrics): string | null {
  const o: LeadExtra = metrics.overall
  if (o.n <= 0 || o.over === undefined || o.biasSum === undefined) return null
  const mean = o.biasSum / o.n
  return `예측 단계가 실제 관측 단계보다 높았던 비교는 전체의 ${pct(o.over, o.n)}이고, 예측 단계는 관측 단계보다 평균 ${Math.abs(mean).toFixed(2)}단계 ${mean >= 0 ? '높습니다' : '낮습니다'}.`
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

export default function Info({ snap, loading = false, metrics, noise, placeCount, pattern: patternProp }: { snap: Snapshot | null; /** 자료를 받는 중인지. snap이 없을 때 '불러오는 중'과 '불러오지 못함'을 가른다 */ loading?: boolean; metrics: ForecastMetrics | null; noise: NoiseData | null; placeCount: number; pattern?: WeekPattern | null }) {
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
  const accuracy = accuracyText(metrics)
  const stampLine = snap ? (snap.source === 'seoul' ? `지금 보는 자료는 서울시 ${stampText(snap)} 기준이에요.` : '지금 보는 자료는 데모 데이터예요.') : loading ? '자료를 불러오는 중이에요.' : '지금은 자료를 불러오지 못했어요.'
  return (
    <div className="page">
      <a href="#/start" className="info-intro">소개 화면 다시 보기</a>
      <div className="card">
        <h2>무던한 지도란</h2>
        <p>소리나 사람 많은 곳에 예민한 아이와 함께 나서는 가족이 출발 전에 "이 장소는 오늘 몇 시가 무던한가"를 보는 지도예요. 같은 장소도 시간대에 따라 지수가 달라져서, 장소와 시간대의 조합마다 지수를 보여 줘요.</p>
        <p className="muted">2026 AI 라이프 아이디어 챌린지 수상 후보작 "무던한 지도(Calm Map)"를 기반으로 한 AI 라이프 솔루션 챌린지 출품작이에요.</p>
      </div>

      <div className="card">
        <h2>한눈에 보기</h2>
        <table className="simple def">
          <tbody>
            <tr><th>점수의 뜻</th><td>지수는 0~100이고 낮을수록 무던해요. {MID_FROM} 미만은 무던함, {MID_FROM} 이상 {BUSY_FROM} 미만은 보통, {BUSY_FROM} 이상은 붐빔이에요. {meaningNote(snap)}</td></tr>
            <tr><th>자료 시각</th><td>{stampLine} 서울시 자료는 매시 새로 모아서 올리지만 늦을 때가 있어요.</td></tr>
            <tr><th>개인정보</th><td>아이의 이름, 병원 기록, 행동 기록은 받지 않아요. 고른 내용과 다녀온 뒤 기록, 외출 계획 메모, 추천 탭에서 고른 기준 장소 이름은 이 기기에만 저장해요.</td></tr>
            <tr>
              <th>검증 범위</th>
              <td>
                <p className="scope"><b>검증한 것</b></p>
                <ul className="plain">
                  {accuracy && <li>{accuracy}</li>}
                  <li>공개 음원 시험에서는 {soundEval.dataset} 음원 {soundEval.overall.n}개({soundEval.classes}개 분류) 중 {soundEval.overall.correct}개({pct(soundEval.overall.correct, soundEval.overall.n)})의 태그가 미리 정해 둔 정답표와 같았어요. 말소리 태그는 시험하지 못했고, 실제 장소에서는 이보다 낮을 수 있어요.</li>
                  <li>지수와 적중률은 설계한 계산식대로 나오는지 프로그램으로 검사했어요(아이에게 맞는지는 아직 확인하지 못했어요).</li>
                </ul>
                <p className="scope"><b>아직 검증 전인 것</b></p>
                <ul className="plain">
                  {!accuracy && <li>{accuracyPending(metrics)}</li>}
                  <li>실제 외출에서 아이가 편했는지는 확인하지 못했어요.</li>
                  <li>지수가 아이가 느끼는 정도와 맞는지는 확인하지 못했어요.</li>
                  <li>휴대폰 실기기에서의 동작은 확인하지 못했어요. 컴퓨터 브라우저에서 화면 크기를 줄여 확인했어요.</li>
                </ul>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>이용 방법</h2>
        <table className="simple def">
          <tbody>
            <tr><th>지도의 점</th><td>점 하나가 장소 하나예요. 점이 연할수록 무던하고 짙을수록 붐비는 편이에요. 단계 이름과 장소 수는 지도 아래 범례에 있어요.</td></tr>
            <tr><th>시각 고르기</th><td>지도 아래 슬라이더로 지금부터 최대 12시간 안의 시각을 고르면 점이 그 시각의 예측으로 바뀌어요. 장소 화면의 막대를 눌러도 같은 시각을 고를 수 있어요.</td></tr>
            <tr><th>무던한 곳 안내</th><td>장소 화면에서 보고 있는 시각(막대를 고르지 않았으면 지금)이 '보통' 이상이면, 같은 시각에 단계가 더 낮은 가까운 곳(직선 6km 안, 최대 3곳)을 보여 줘요. 같은 장소에서 무던해지는 다른 시간이 있으면 그 시간도 알려 줘요.</td></tr>
            <tr><th>우리 아이 맞춤</th><td>우리 아이 탭에서 예민한 소리와 상황을 고르고 "맞춤 지수 켜기"를 누르면, 지수가 아이에게 맞게 다시 계산돼요. 맞춤 지수를 켜 두면 다녀온 뒤 기록도 지수에 반영돼요.</td></tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>지수는 이렇게 계산해요</h2>
        <ul className="plain">
          <li>지수는 0~100이고 낮을수록 무던해요. 35 미만은 무던함, 35 이상 65 미만은 보통, 65 이상은 붐빔이에요.</li>
          <li>서울시의 12시간 혼잡도 예측에, 장소 가까이 있는 센서가 같은 요일·시간대에 잰 평소 소음을 합쳐요(혼잡 6, 소음 4의 비율). 소음 자료가 없는 곳은 혼잡만 써요.</li>
          <li>소리를 측정해 둔 시간대에는 소리 종류도 더해서 계산해요.</li>
          <li>맞춤 지수를 켜면 아이의 민감도와 다녀온 뒤 기록이 지수에 반영돼요.</li>
          <li>계산은 정해 둔 규칙으로 하고, AI는 소리 종류를 구분하고 문장을 만드는 데에만 써요. 자세한 식은 맨 아래 "자세한 계산 방법과 검증 기록"에 있어요.</li>
        </ul>
      </div>

      <div className="card">
        <h2>이용 시 확인사항</h2>
        <ul className="plain">
          <li>혼잡도는 공원, 상권, 역 같은 지역 단위로 나와요. 가려는 가게나 시설 안의 상황과 다를 수 있어요.</li>
          <li>지수는 장소와 시간대의 예측값이나 관측값을 바탕으로 계산해요. 예측이 얼마나 맞았는지는 맨 아래 "자세한 계산 방법과 검증 기록"에서 볼 수 있어요.</li>
          <li>스마트폰 마이크는 기종마다 측정값이 달라요. 현장 측정 결과를 다른 기기의 값과 그대로 견주기는 어려워요.</li>
          <li>카드와 브리핑의 안내 문장은 참고용 제안이에요. 실제로 갈 때는 그날 아이의 상태와 현장 분위기를 보고 정해 주세요.</li>
          <li>공사·행사 정보는 지수에 넣지 않아요. 장소 화면의 "오늘 이 장소 주변"에서 따로 확인할 수 있어요.</li>
        </ul>
      </div>

      <div className="card">
        <h2>개인정보 처리 안내</h2>
        <h3 className="sub">받지 않는 정보</h3>
        <p className="plain-p">{NOT_COLLECTED}</p>
        <h3 className="sub">이 기기에 저장하는 정보</h3>
        <ul className="plain">
          <li>우리 아이 맞춤(민감 요인 7개의 3단계 값), 다녀온 뒤 기록, 장소별 지수 보정, 소리 측정 요약, 외출 계획 메모, 추천 탭에서 고른 기준 장소 이름을 이 기기의 저장소에 보관합니다.</li>
          <li>위 정보는 우리 아이 탭의 "이 기기의 맞춤·기록 지우기"로 지울 수 있습니다. 외출 계획 메모는 계획 화면의 "이 장소 메모 지우기"로 장소마다 지울 수도 있습니다. 추천 탭에서 고른 기준 장소 이름은 "어디서" 단추를 열고 "서울 전체"나 "기준 지우기"를 눌러도 지울 수 있습니다.</li>
          <li>화면을 이루는 파일은 오프라인에서도 열리도록 이 기기에 캐시합니다(지도 그림과 서울시 자료는 제외).</li>
        </ul>
        <h3 className="sub">밖으로 전달되는 정보</h3>
        <ul className="plain">
          {HAS_API ? (
            <>
              <li>소리 측정 요약(장소, 요일, 시각, 태그별 숫자)과 카드 요청(장소, 시간대, 예민한 요인의 이름)은 서버로 전달됩니다.</li>
              <li>서버는 카드 요청의 내용을 생성형 AI에 전달합니다. 맞춤 지수를 켜 두었다면 예민한 요인의 이름도 여기에 들어갑니다.</li>
              <li>우리 아이 맞춤의 3단계 값, 다녀온 뒤 기록, 외출 계획 메모, 추천 탭에서 고른 기준 장소 이름은 이 기기 밖으로 나가지 않습니다.</li>
              <li>지도 타일을 받을 때 접속 정보(IP 주소)가 OpenStreetMap에 전달됩니다.</li>
            </>
          ) : (
            <>
              <li>이 서비스에는 정보를 받는 서버가 없어서 우리 아이 맞춤, 기록, 소리 측정 요약, 외출 계획 메모, 추천 탭에서 고른 기준 장소 이름, 이용자의 위치는 이 기기 밖으로 나가지 않습니다.</li>
              <li>지도 타일, 자료 파일, 소리 분류 모델을 받을 때 접속 정보(IP 주소)가 OpenStreetMap, GitHub에 전달됩니다.</li>
              <li>생성형 AI에는 자료를 수집하는 단계에서 장소 이름과 혼잡도 예측만 전달합니다.</li>
            </>
          )}
          <li>소리 분류 모델은 이 서비스와 같은 출처에서 받고, 받지 못하면 TF Hub(Kaggle, Google Cloud Storage로 연결)에서 받으며, 이때 접속 정보(IP 주소)가 그쪽에도 전달됩니다.</li>
          <li>장소 화면의 "개발자에게 전할 말"에서 "메일로 보내기"를 누르면 이 기기의 메일 앱이 열립니다. 메일 앱에서 보내기를 누른 경우에만 장소 이름, 보고 있던 시각, 적은 글이 개발자 메일({FEEDBACK_EMAIL})로 전달됩니다.</li>
        </ul>
        <h3 className="sub">위치와 음성</h3>
        <ul className="plain">
          <li>위치를 허용하면 거리 계산에만 쓰고 저장하지 않습니다.</li>
          <li>카드 읽어 주기는 이 기기의 음성 합성 기능을 씁니다.</li>
        </ul>
      </div>

      <div className="card">
        <h2>데이터 출처</h2>
        <p className="plain-p">본 서비스는 서울특별시 공공데이터를 사용한 결과입니다.</p>
        <ul className="plain">
          <li>서울 열린데이터광장 "서울시 실시간 도시데이터"(citydata, 공공누리 제1유형)에서 주요 장소 {placeCount}곳의 혼잡도, 12시간 예측, 문화행사, 통제 정보, 날씨, 도로 소통을 받습니다.</li>
          <li>"스마트서울 도시데이터 센서(S-DoT) 환경정보"에서 장소 가까이 있는 센서의 시간대별 소음을 받습니다{noise ? `(${noise.from}부터 ${noise.to}까지 ${noise.days}일 치, 소음 자료가 있는 장소 ${Object.keys(noise.places).length}곳)` : ''}.</li>
          <li>지도는 OpenStreetMap 타일(ODbL)을 씁니다.</li>
          <li>소리 분류 모델은 YAMNet(Apache-2.0)입니다.</li>
        </ul>
        {snap && <p className="plain-p">현재 자료는 {snap.source === 'seoul' ? '서울시 API' : '데모 데이터'}({snap.updatedAt} 기준)입니다.</p>}
      </div>

      <div className="card">
        <h2>샘플 소리 출처</h2>
        <p className="plain-p">
          현장 측정 화면의 샘플 소리는 ESC-50 데이터셋(K. J. Piczak, 2015)에 실린 음원 가운데 개별 라이선스가 CC0인 것만 골랐습니다. 원 출처는 Freesound입니다.
        </p>
        <ul className="credits">
          {SAMPLES.map((s) => (
            <li key={s.id}>{s.label}: <a href={s.credit.url} target="_blank" rel="noreferrer">{s.credit.title}</a>, {s.credit.author}, {s.credit.license}</li>
          ))}
        </ul>
      </div>

      <div className="card">
        <details className="info-more">
          <summary>자세한 계산 방법과 검증 기록</summary>
          <div className="info-more-body">
            <h3>AI가 쓰이는 곳</h3>
            <table className="simple def">
              <tbody>
                <tr><th>소리 종류 분류</th><td>YAMNet(AudioSet 521종)을 TensorFlow.js로 이 기기 안에서 실행해, 소리의 종류(사이렌, 군중, 음악, 말소리 등)를 구분합니다. 원음은 서버로 보내지 않습니다.</td></tr>
                <tr><th>지수 계산(규칙)</th><td>서울시 실시간 도시데이터의 12시간 혼잡도 예측, 주변 센서의 평소 소음, 소리 분류 결과를 아래 산식으로 합쳐 장소와 시간대별 지수(0~100)를 계산합니다. 아이의 민감 요인과 다녀온 뒤 기록이 있으면 이를 반영해 다시 계산합니다. 이 계산에는 학습 모델을 쓰지 않고 고정된 규칙만 씁니다.</td></tr>
                <tr><th>미리 보는 카드</th><td>특수교육의 사회적 이야기 기법에 따라 3~5단계 그림 문장을 생성형 AI가 만듭니다. 권고형 문장인지, 쓰지 않기로 한 표현이 들어갔는지, 글자 수가 맞는지를 규칙으로 검사해 통과한 것만 보여 줍니다.</td></tr>
                <tr><th>오늘의 브리핑</th><td>규칙이 여유로운 시간대 후보를 계산하고, 생성형 AI가 그중에서 골라 문장을 씁니다. 장소와 시간대는 예측과 다시 대조하고, 문장은 길이, 어미, 쓰지 않기로 한 표현을 검사합니다.</td></tr>
              </tbody>
            </table>

            <h3>지수 산식(가설 v1.1)</h3>
            <p>지수는 0~100이고 낮을수록 무던합니다. 장소와 시간대마다 아래 순서로 계산합니다.</p>
            <ol className="formula">
              <li>
                혼잡 점수 C는 서울시 혼잡도 단계의 기준값에서 시작합니다.
                <ul>
                  <li>기준값은 여유 15, 보통 40, 약간 붐빔 65, 붐빔 90입니다.</li>
                  <li>그 장소의 12시간 예측 전체(관측값이 있으면 함께)에서 예상 인구가 많은 편인 시간은 최대 10점을 더하고, 적은 편인 시간은 최대 10점을 뺍니다. 비교 범위가 지금 시각에 따라 달라지지 않으므로, 같은 자료로 계산하는 동안에는 정각이 지나도 같은 장소와 시간대의 점수가 바뀌지 않습니다.</li>
                </ul>
              </li>
              <li>
                소음 점수 N은 주변 서울시 센서가 같은 요일·시간대에 잰 평균 소음을 점수로 바꾼 값입니다.
                <ul>
                  <li>평균 40dB은 0점이고 75dB은 100점입니다.</li>
                  <li>그 시간의 최대 소음이 평균보다 3dB을 넘게 높으면, 넘은 1dB마다 4점씩 최대 20점을 더합니다.</li>
                </ul>
              </li>
              <li>기본 지수 B는 소음 자료가 있으면 0.6 × C + 0.4 × N이고, 없으면 C와 같습니다.</li>
              <li>
                소리 점수 S는 현장 측정을 반영한 장소·요일·시간대에만 있습니다.
                <ul>
                  <li>S = 100 × Σ(태그별 (확률×강도) 평균 × 태그 가중 × 민감도)이고, 0~100으로 제한합니다.</li>
                  <li>태그 가중은 돌발음 1.0, 군중 0.7, 기계·차량 0.5, 음악·안내방송 0.5, 말소리 0.3, 배경 0.1입니다.</li>
                  <li>민감도는 맞춤 지수를 켠 때만 0.5, 1, 1.5 중에서 쓰고, 끄면 모두 1입니다.</li>
                </ul>
              </li>
              <li>
                최종 지수는 (1 − w) × B + w × S이고, 소리 표본이 n개일 때 w = min(0.5, n / (n + 6))입니다.
                <ul>
                  <li>소리 표본이 없으면 w는 0이므로 지수는 B와 같습니다.</li>
                  <li>맞춤 지수를 켠 때만 다녀온 뒤 기록으로 정한 장소별 지수 보정(-20~+20)을 더합니다.</li>
                  <li>지수는 반올림한 정수이고, 35 미만은 무던함, 35 이상 65 미만은 보통, 65 이상은 붐빔입니다.</li>
                </ul>
              </li>
            </ol>
            <p className="muted">맞춤 지수를 켜면 아래 값이 달라집니다.</p>
            <ul className="apply">
              <li>혼잡 점수 C에 혼잡 민감도를 곱합니다.</li>
              <li>소음 점수 N의 평균 부분에는 큰 소리 민감도를, 큰 소리 가산에는 돌발음 민감도를 곱합니다.</li>
              <li>소리 점수 S의 태그마다 그 태그의 민감도를 곱합니다.</li>
              <li>최종 지수에 다녀온 뒤 기록의 지수 보정을 더합니다.</li>
            </ul>
            <p className="muted">이 산식과 숫자는 검증 전 가설입니다. 공사·행사 정보는 지수에 넣지 않고 따로 보여 줍니다.</p>
            <p className="muted">
              장소 화면의 낱말은 지수 산식의 값을 말로 옮긴 것입니다. 평소 소음은 평균 소음 {NOISE_DB_LOW}dB(0점)과 {NOISE_DB_HIGH}dB(100점) 사이를 지수와 같은 경계({MID_FROM}점, {BUSY_FROM}점)로 나눠 {NOISE_MID_FROM_DB - 1}dB 이하는 낮음, {NOISE_MID_FROM_DB}~{NOISE_HIGH_FROM_DB - 1}dB는 보통, {NOISE_HIGH_FROM_DB}dB 이상은 높음으로 부릅니다.
              소리가 갑자기 커지는 정도는 큰 소리 가산 점수가 0점이면 작음, 0점을 넘고 {SPIKE_BIG_ADD}점 미만이면 보통, {SPIKE_BIG_ADD}점 이상이면 큼입니다. 두 기준은 검증 전 표현 기준입니다. 이 앱이 받는 서울시 센서 자료에는 소리의 크기만 있어서 사이렌이 나는지는 알 수 없습니다.
            </p>
            {shift && pattern && (
              <div className="stat">
                <h4 className="sub">소음을 더하면 단계가 달라지는 칸</h4>
                <p>
                  칸은 장소·요일·시간대 한 조합입니다. 혼잡 평균과 소음 평균이 모두 있는 8~21시 {shift.cells}칸 가운데 {shift.changed}칸({Math.round((shift.changed / shift.cells) * 1000) / 10}%)에서, 소음까지 더한 지수의 단계가 혼잡만으로 정한 단계와 달랐습니다.
                  더 무던한 단계로 바뀐 칸은 {shift.down}칸, 더 붐비는 단계로 바뀐 칸은 {shift.up}칸입니다.
                </p>
                <p className="muted">
                  혼잡 평균은 {pattern.days}일 동안 관측한 값이므로 참고용으로만 보시기 바랍니다. 혼잡 점수는 단계 기준값만 써서(±10 보정 제외) 소리 측정과 맞춤 지수 없이 계산했습니다.
                </p>
              </div>
            )}

            <h3>예측이 얼마나 맞았나</h3>
            {metrics && metrics.overall.n >= MIN_PAIRS ? (
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
                  서울시가 제공한 혼잡도 예측(4단계)을 그 시각의 실제 관측과 비교한 값입니다. 이 서비스의 지수는 이 예측을 입력으로 쓰므로, 예측이 맞은 정도를 위 표에 적었습니다.
                  "유지 가정"은 예측을 쓰지 않고 예측을 낸 시점의 혼잡 단계가 그대로 이어진다고 봤을 때의 일치율입니다.
                  "N시간 전"은 서울시 실시간 값이 속한 정시(19시 35분 값이면 19시)에서 N시간 뒤를 맞힌 예측입니다. 값에 적힌 시각이 받은 시각보다 이르기 때문에, 받은 시각부터 계산하면 한 시간쯤 짧습니다.
                  같은 시각의 장소들은 함께 오르내리므로 비교 건수만큼 서로 독립적인 확인은 아닙니다. {metrics.firstObs?.slice(0, 10)}부터 관측이 있었던 {metrics.days}일 동안 {metrics.nObs}건의 관측값을 모았고({metrics.updatedAt} 계산),
                  기간이 짧은 동안에는 참고용으로만 보시기 바랍니다.
                </p>
                {lower.length > 0 && (
                  <p className="muted">
                    서울시 예측의 단계 일치율이 "유지 가정"보다 낮은 시차는 {lower.join(', ')}입니다. 이 시차에서는 예측을 낼 때의 단계가 그대로 이어진다고 본 쪽이 더 자주 맞았습니다.
                    지수는 이 예측을 입력으로 쓰므로, 이 시차의 예측으로 계산한 지수는 참고용으로만 보시기 바랍니다.
                  </p>
                )}
                {bias && (
                  <p className="muted">
                    {bias} 예측과 실시간 값은 서울시가 따로 매기는 단계라서 기준이 다를 수 있으며, 그 차이는 "단계 일치"에 그대로 반영됩니다.
                  </p>
                )}
                {popLines.length > 0 && (
                  <p className="muted">
                    단계 이름 대신 인구 범위로도 비교했습니다. 예측한 인구(중앙값)가 실제 관측의 인구 범위 안에 든 비율과, "유지 가정"(예측을 낼 때 관측한 인구 중앙값)이 든 비율은 아래와 같습니다.
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
              <p className="muted">서울시 혼잡도 예측과 실제 관측을 비교할 자료를 모으는 중입니다(지금 {metrics?.overall.n ?? 0}건). 비교가 {MIN_PAIRS}건 이상이 되면 여기에 일치율을 보여 줍니다.</p>
            )}

            <h3>소리 분류를 공개 음원으로 시험한 결과</h3>
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
              이 서비스와 같은 모델(YAMNet)과 태그 기준으로 공개 음원 {soundEval.clips}개({soundEval.dataset}의 {soundEval.classes}개 분류)를 분류해 본 값입니다({soundEval.evaluatedAt} 시험).
              음원마다 가장 큰 태그가 미리 정해 둔 정답표와 같으면 맞은 것으로 집계했습니다. 일치율이 낮은 소리는 아래와 같습니다.
            </p>
            <ul className="credits">
              {soundEval.weakest.map((w) => (
                <li key={w.category}>{CLASS_KO[w.category] ?? w.category}: {w.n}개 중 {w.correct}개가 맞았고, 주로 '{TAG_LABEL[w.mostConfused as SenseTag] ?? w.mostConfused}' 태그로 분류했습니다.</li>
              ))}
            </ul>
            <p className="muted">
              말소리 태그는 이 데이터에 해당 분류가 없어 시험하지 못했고, 음악·안내방송 태그는 종소리 한 분류로만 시험했습니다. 실제 장소에서는 여러 소리가 섞이므로 이 수치보다 낮을 수 있습니다.
              시험은 Node 환경에서 했고, 정답표(scripts/esc50_tag_map.json)와 음원별 결과(docs/eval/esc50_result.json)는 저장소에 있습니다.
            </p>
          </div>
        </details>
      </div>
    </div>
  )
}
