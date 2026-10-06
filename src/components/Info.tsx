import type { Snapshot } from '../types'

export default function Info({ snap }: { snap: Snapshot | null }) {
  return (
    <div className="page">
      <div className="card">
        <h2>무던한 지도란</h2>
        <p>발달장애 아동 가족이 외출 전에 "이 장소는 오늘 몇 시가 무던한가"를 보는 지도예요. 장소에 점수를 매기는 것이 아니라, 장소와 시간대의 조합을 보여 줘요.</p>
        <p className="muted">2026 AI 라이프 아이디어 챌린지 수상 후보작 "무던한 지도(Calm Map)"를 AI 라이프 솔루션 챌린지에서 구현한 시제품이에요.</p>
      </div>
      <div className="card">
        <h2>AI는 세 군데에서 일해요</h2>
        <table className="simple">
          <tbody>
            <tr><th>소리 종류 분류</th><td>YAMNet(AudioSet 521종)을 TensorFlow.js로 기기 안에서 실행해요. 소리의 크기가 아니라 종류(사이렌, 군중, 음악, 말소리…)를 알아내요. 원음은 서버로 보내지 않아요.</td></tr>
            <tr><th>감각부하 지수</th><td>서울시 실시간 도시데이터의 12시간 혼잡도 예측과 소리 측정을 합쳐 장소×시간대 지수(0~100)를 계산하고, 아이의 민감 요인으로 다시 계산해요.</td></tr>
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
        <h2>한계</h2>
        <p className="muted">혼잡도는 공원·상권·역 같은 지역 단위라 개별 가게의 환경과 달라요. 스마트폰 마이크는 기종마다 편차가 있어요. 지수는 예측이지 진단이 아니고, 문구는 항상 권고형이에요.</p>
      </div>
    </div>
  )
}
