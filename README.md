# 무던한 지도 (Calm Map)

발달장애 아동 가족이 외출 전에 "이 장소는 오늘 몇 시가 무던한가"를 보는 AI 감각부하 지도입니다. 2026 AI 라이프 아이디어 챌린지 수상 후보작 "무던한 지도(Calm Map)"를 AI 라이프 솔루션 챌린지에서 웹 시제품으로 구현했습니다.

## 구성

| 영역 | 내용 |
|---|---|
| 소리 종류 분류 | YAMNet(AudioSet 521종)을 TensorFlow.js로 브라우저 안에서 실행합니다. 원음과 임베딩은 서버로 보내지 않고 태그별 평균 강도·창 수·요일·시각만 보냅니다. |
| 감각부하 지수 | 서울시 실시간 도시데이터의 혼잡도 12시간 예측과 소리 측정을 결합해 장소×시간대 지수(0~100)를 계산하고, 아이의 민감 요인 6개(3단계)로 다시 계산합니다. `src/lib/index.ts` |
| 미리 보는 카드 | 사회적 이야기 형식의 3~5단계 카드를 Gemini 구조화 출력으로 만들고, `shared/cardRules.ts`의 규칙 검사(단계 수, 권고형 어미, 금지어, 글자 수, 아이콘 enum)를 통과한 것만 보여 줍니다. 실패하면 사전 생성 카드를 씁니다. |

## 실행

```bash
npm install
npm run dev        # http://localhost:5173 (API 없이 데모 스냅샷으로 동작)
npm run build
npx wrangler dev   # Worker + 정적 자산 (dist 필요)
```

## 배포(Cloudflare Workers)

1. `wrangler.jsonc`의 `CALM_KV.id`를 `npx wrangler kv namespace create CALM_KV` 결과로 바꿉니다.
2. `DATA_URL`을 이 저장소의 `data` 브랜치 `snapshot.json` raw 주소로 바꿉니다.
3. `npx wrangler secret put GEMINI_KEY` (선택. 없으면 사전 생성 카드만 사용)
4. `npm run build && npx wrangler deploy`

## 혼잡도 수집(GitHub Actions)

서울 열린데이터광장 API는 8088 포트만 열려 있어 Workers가 직접 부르지 못합니다. `.github/workflows/collect.yml`이 매시 `scripts/collect_seoul.py`를 실행해 추적 장소 31곳의 응답을 `data` 브랜치 `snapshot.json`으로 올리고, Worker가 이를 5분 캐시로 중계합니다. 저장소 Secrets에 `SEOUL_KEY`를 넣어야 합니다. 호출은 31곳×24회=744회/일입니다(공식 안내의 일 1,000회 한도는 실시간 지하철 키에만 명시되어 있고, 일반 인증키는 횟수 제한이 명시되어 있지 않습니다).

## 데이터 출처와 라이선스

- 서울 열린데이터광장 "서울시 실시간 인구데이터"(citydata_ppltn, OA-21778, 공공누리 제1유형: 출처 표시). 본 서비스는 서울특별시 공공데이터를 사용한 결과입니다. 서울시 실시간 도시데이터 핫스팟 좌표 121곳.
- 인증키는 이용약관 제7조에 따라 공개·공유하지 않으며 GitHub Actions Secrets에만 둡니다.
- OpenStreetMap 타일(ODbL, 기여자 표기)
- YAMNet: Apache-2.0 (tfhub.dev/google/tfjs-model/yamnet/tfjs/1)

## 개인정보

아이의 이름·진단명·행동 기록을 받지 않습니다. 프로필과 다녀온 뒤 기록은 브라우저 저장소에만 둡니다. `/api/measure`는 원음 필드가 있으면 거부합니다.
