import type { ForecastMetrics, SenseTag, Snapshot } from '../types'
import { TAG_LABEL } from '../types'
import samplesRaw from '../data/samples.json'
import soundEval from '../data/sound_eval.json'

const SAMPLES = samplesRaw.samples
const CLASS_KO: Record<string, string> = { chainsaw: '전기톱', wind: '바람', car_horn: '자동차 경적', laughing: '웃음소리', crickets: '귀뚜라미', clapping: '박수' }

const pct = (a: number, n: number) => (n > 0 ? `${Math.round((a / n) * 100)}%` : '자료 없음')

export default function Info({ snap, metrics }: { snap: Snapshot | null; metrics: ForecastMetrics | null }) {
  const leads = ['1', '3', '6', '12']
  return (
    <div className="page">
      <div className="card">
        <h2>무던한 지도란</h2>
        <p>발달장애 아동 가족이 외출 전에 "이 장소는 오늘 몇 시가 무던한가"를 보는 지도예요. 장소에 점수를 매기는 것이 아니라, 장소와 시간대의 조합을 보여 줘요.</p>
        <p className="muted">2026 AI 라이프 아이디어 챌린지 수상 후보작 "무던한 지도(Calm Map)"를 AI 라이프 솔루션 챌린지에서 구현한 시제품이에요.</p>
      </div>
      <div className="card">
        <h2>AI는 두 군데에서 일하고, 지수는 공개된 규칙으로 계산해요</h2>
        <table className="simple">
          <tbody>
            <tr><th>소리 종류 분류</th><td>YAMNet(AudioSet 521종)을 TensorFlow.js로 기기 안에서 실행해요. 소리의 크기가 아니라 종류(사이렌, 군중, 음악, 말소리…)를 알아내요. 원음은 서버로 보내지 않아요.</td></tr>
            <tr><th>감각부하 지수(규칙)</th><td>서울시 실시간 도시데이터의 12시간 혼잡도 예측과 소리 분류 결과를 아래 산식으로 합쳐 장소×시간대 지수(0~100)를 계산하고, 아이의 민감 요인과 다녀온 뒤 기록으로 다시 계산해요. 이 부분은 학습 모델이 아니라 누구나 확인할 수 있는 고정 규칙이에요.</td></tr>
            <tr><th>미리 보는 카드</th><td>특수교육의 사회적 이야기 기법을 따라 3~5단계 그림 문장을 생성형 AI가 만들고, 규칙 검사(권고형, 금지어, 글자 수)를 통과한 것만 보여 줘요.</td></tr>
          </tbody>
        </table>
      </div>
      <div className="card">
        <h2>지수 산식(가설 v0)</h2>
        <p className="muted">혼잡 점수 C는 혼잡도 단계(여유 15, 보통 40, 약간 붐빔 65, 붐빔 90)에 인구 예측으로 ±10 보정. 소리 점수 S는 태그 가중(돌발음 1.0, 군중 0.7, 기계·차량 0.5, 음악·안내방송 0.5, 말소리 0.3, 배경 0.1)과 강도의 가중평균. 표본 n개면 w = min(0.5, n/(n+6)), 지수 = (1-w)·C + w·S. 무던함 35 미만, 보통 35~64, 붐빔 65 이상. 이 산식은 검증 전 가설이며 표본이 없으면 "소리 미측정", 예측이 없으면 "데이터 부족"으로 표시해요.</p>
      </div>
      <div className="card">
        <h2>개인정보</h2>
        <p className="muted">아이의 이름, 진단명, 행동 기록을 받지 않아요. 프로필(민감 요인 6개의 3단계 값)과 다녀온 뒤 기록은 이 기기의 저장소에만 있어요. 측정 전송값은 장소, 요일, 시각, 소리 태그별 평균값, 창 수뿐이에요.</p>
      </div>
      <div className="card">
        <h2>데이터 출처</h2>
        <p className="muted">본 서비스는 서울특별시 공공데이터를 사용한 결과입니다. 서울 열린데이터광장 "서울시 실시간 인구데이터"(citydata_ppltn, 공공누리 제1유형, 121곳 중 31곳 추적), 서울시 실시간 도시데이터 핫스팟 좌표, OpenStreetMap 타일(ODbL), YAMNet(Apache-2.0).
          {snap ? ` 현재 자료: ${snap.source === 'seoul' ? '서울시 API' : '데모 스냅샷'} (${snap.updatedAt} 기준).` : ''}</p>
      </div>
      <div className="card">
        <h2>예측이 얼마나 맞았나</h2>
        {metrics && metrics.overall.n > 0 ? (
          <>
            <table className="simple">
              <thead>
                <tr><th>몇 시간 전 예측</th><th>비교 건수</th><th>단계 일치</th><th>한 단계 이내</th><th>그대로 유지 가정</th></tr>
              </thead>
              <tbody>
                {leads.map((k) => {
                  const m = metrics.byLead[k]
                  return m ? (
                    <tr key={k}><th>{k}시간 전</th><td>{m.n}</td><td>{pct(m.exact, m.n)}</td><td>{pct(m.within1, m.n)}</td><td>{pct(m.persistExact, m.persistN)}</td></tr>
                  ) : null
                })}
                <tr><th>전체(1~12시간 전)</th><td>{metrics.overall.n}</td><td>{pct(metrics.overall.exact, metrics.overall.n)}</td><td>{pct(metrics.overall.within1, metrics.overall.n)}</td><td>{pct(metrics.overall.persistExact, metrics.overall.persistN)}</td></tr>
              </tbody>
            </table>
            <p className="muted">
              서울시가 준 혼잡도 예측(4단계)을 그 시각의 실제 관측과 비교한 값이에요. 무던한 지도의 지수는 이 예측을 입력으로 쓰기 때문에 예측이 맞은 정도를 그대로 공개해요.
              "그대로 유지 가정"은 예측 없이 그 시간 전의 혼잡 단계가 이어진다고 봤을 때의 일치율이에요. {metrics.firstObs?.slice(0, 10)}부터 {metrics.days}일 동안 관측 {metrics.nObs}건을 모았고({metrics.updatedAt} 계산),
              기간이 짧은 동안에는 참고용으로만 봐 주세요.
            </p>
          </>
        ) : (
          <p className="muted">서울시 혼잡도 예측과 실제 관측을 비교할 자료를 모으는 중이에요. 수집이 몇 번 쌓이면 여기에 일치율이 표시돼요.</p>
        )}
      </div>
      <div className="card">
        <h2>소리 분류를 공개 음원으로 시험한 결과</h2>
        <table className="simple">
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
          음원마다 가장 큰 태그가 미리 정해 둔 정답표와 같으면 맞은 것으로 셌어요.
          {' '}잘 틀린 소리는 {soundEval.weakest.map((w) => `${CLASS_KO[w.category] ?? w.category}(${w.n}개 중 ${w.correct}개 맞음, 주로 '${TAG_LABEL[w.mostConfused as SenseTag] ?? w.mostConfused}'로 분류)`).join(', ')}이에요.
        </p>
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
