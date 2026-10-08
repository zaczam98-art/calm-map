# 무던한 지도 (Calm Map)

발달장애 아동 가족이 외출 전에 "이 장소는 오늘 몇 시가 무던한가"를 보는 AI 감각부하 지도입니다. 2026 AI 라이프 아이디어 챌린지 수상 후보작 "무던한 지도(Calm Map)"를 AI 라이프 솔루션 챌린지에서 웹 시제품으로 구현했습니다.

- 테스트 URL: https://zaczam98-art.github.io/calm-map/
- 서버 없이 GitHub Pages와 GitHub Actions만으로 동작합니다.

## 무엇을 하는가

| 기능 | 내용 | 위치 |
|---|---|---|
| 감각부하 지도 | 서울 121곳의 지금 지수와 12시간 예측을 3단계 농담으로 보여 줍니다. 공사·집회 통제가 있는 곳은 테두리로 표시합니다. 수집이 늦으면 현재 시각의 예측값을 쓰고 "(예측값)"이라고 표시합니다. | `src/lib/index.ts`, `src/components/MapView.tsx` |
| 우리 아이 맞춤 | 민감 요인 6개(3단계)로 지수를 다시 계산합니다. 이름과 진단명은 받지 않고 기기에만 저장합니다. | `src/lib/profile.ts` |
| 소리 종류 분류 | YAMNet(AudioSet 521종)을 TensorFlow.js로 브라우저 안에서 실행합니다. 마이크, 오디오 파일, 내장 샘플 소리 6개로 해 볼 수 있습니다. | `src/lib/sound.ts`, `src/components/Measure.tsx` |
| 미리 보는 카드 | 사회적 이야기 형식의 카드를 Gemini 구조화 출력으로 미리 만들고 규칙 검사를 통과한 것만 싣습니다(96장). | `scripts/gen_cards.ts`, `shared/cardRules.ts` |
| 오늘의 브리핑 | 규칙이 여유 구간 후보를 계산하고, Gemini가 그중에서 골라 문장을 쓰고, 규칙이 자료와 다시 대조합니다. 통과하지 못하면 규칙 기반 문장을 씁니다. | `scripts/gen_briefing.py`, `src/components/Briefing.tsx` |
| 요일별 패턴 | 수집한 관측값을 요일과 시간대별로 평균해 보여 줍니다(표본 수 표시). | `scripts/derive_stats.py`, `src/components/WeekPattern.tsx` |
| 오늘 이 장소 주변 | 혼잡도 말고도 부담이 될 수 있는 요인(공사·집회 통제, 문화행사, 비 예보, 자외선, 미세먼지, 도로 정체)을 서울시 자료에서 그대로 옮겨 보여 줍니다. | `scripts/collect_seoul.py`, `src/components/Factors.tsx` |
| 이 동네의 소리 크기 | 장소 가까이 있는 서울시 S-DoT 센서가 잰 시간대별 소음(평균과 큰 소리 수준)을 요일별로 보여 줍니다. 값이 변하지 않는 센서는 뺍니다. 지수 계산에는 아직 넣지 않았습니다. | `scripts/collect_sdot.py`, `src/components/NoiseCard.tsx` |
| 지금 가기 좋은 곳 | 전체 장소를 지금 무던한 순서로 보여 주고, 분류로 거르거나 내 위치에서 가까운 순으로 볼 수 있습니다(위치는 기기 안에서만 씁니다). | `src/components/Recommend.tsx` |
| 가까운 곳 추천 | 지금 붐비는 곳을 보고 있을 때 직선 6km 안에서 단계가 더 낮은 곳을 가까운 순으로 보여 줍니다. | `src/lib/nearby.ts` |
| 예측 적중률 공개 | 서울시 예측과 실제 관측을 비교한 일치율을 정보 화면에 그대로 보여 줍니다. | `scripts/derive_stats.py`, `src/components/Info.tsx` |

AI가 맡는 일은 소리 종류 분류(YAMNet)와 문장 작성(Gemini)입니다. 지수 계산, 권고 시간대, 후보 구간 계산, 문장 검사는 공개된 고정 규칙이 맡습니다.

## 실행

```bash
npm install
npm run dev        # http://localhost:5173 (공개 자료 주소가 없으면 데모 스냅샷으로 동작)
npm run build
```

공개 자료로 개발 화면을 보려면 `VITE_PUBLIC_SNAPSHOT_URL`에 data 브랜치의 `snapshot.json` 주소를 넣고 실행합니다.

## 자료 수집 (GitHub Actions)

서울 열린데이터광장 API는 8088 포트만 열려 있어 브라우저나 서버리스 함수에서 직접 부르기 어렵습니다. `.github/workflows/collect.yml`이 15분마다 실행을 시도하고, `scripts/collect_seoul.py`는 직전 수집 후 50분이 지나지 않았으면 건너뜁니다. GitHub의 예약 실행이 자주 늦어지거나 빠지기 때문에 이렇게 했고, 장소당 호출은 약 1시간에 한 번으로 묶입니다(121곳이면 하루 약 2,900~3,400회). 실제 실행 간격은 GitHub 사정에 따라 더 벌어질 수 있습니다.

수집 결과는 `data` 브랜치에 커밋 1개로 올라갑니다.

| 파일 | 내용 |
|---|---|
| `snapshot.json` | 최신 1회분(실시간 단계와 12시간 예측, 행사·통제·날씨·도로). 앱이 지도에 씁니다. |
| `history.json` | 시간대별 관측값과 그 시각에 받은 예측값의 누적(45일 보존). |
| `pattern.json` | 요일×시간대 평균 혼잡 단계와 표본 수. |
| `metrics.json` | 예측 일치율(몇 시간 전 예측인지별)과 비교 기준. |
| `briefing.json` | 오늘의 브리핑과 생성·검사 통계. |
| `noise.json` | 장소별 요일×시간대 소음 실측 요약(S-DoT, 7~22시). |
| `noise_state.json` | 센서별 누적 상태(소음 요약을 다시 만들 때 씁니다). |

저장소 Secrets에 `SEOUL_KEY`(서울 열린데이터광장 일반 인증키)와 `GEMINI_KEY`(브리핑용, 없으면 규칙 기반 문장만 사용)가 필요합니다.

## 측정 결과

- 카드 규칙 통과율: 검사기 수정 전 160회 시도 중 63회 통과(39.4%), 수정 후 31회 시도 중 30회 통과(96.8%). 수정 전 수치는 금지어 '원'이 '공원'을 잘못 걸러 낸 결과입니다. `scripts/cards_report*.json`
- 소리 분류 일치율: 공개 음원 ESC-50의 23개 분류 920개에서 745개(81.0%)가 정답표와 같았습니다. 태그별로는 돌발음 282/360, 기계·차량 225/240, 배경음 148/200, 군중 소리 50/80, 음악·안내방송 40/40입니다. 말소리 태그는 해당 분류가 없어 시험하지 못했습니다. 정답표는 결과를 보기 전에 커밋했습니다. `scripts/esc50_tag_map.json`, `scripts/eval_sound.ts`, `docs/eval/esc50_result.json`
- 예측 일치율: `metrics.json`에 누적되며 정보 화면에 표시됩니다.

소리 분류 평가는 다음처럼 다시 실행할 수 있습니다(ESC-50 음원은 저장소에 없으므로 따로 받아야 합니다).

```bash
node node_modules/esbuild/bin/esbuild scripts/eval_sound.ts --bundle --platform=node --format=cjs --outfile=.tmp/eval_sound.cjs
node .tmp/eval_sound.cjs <ESC-50 audio 폴더> <meta/esc50.csv> <결과.json>
```

## 데이터 출처와 라이선스

- 서울 열린데이터광장 "서울시 실시간 도시데이터"(citydata, OA-21285)와 "스마트서울 도시데이터 센서(S-DoT) 환경정보"(IotVdata017, OA-15969). 공공누리 제1유형(출처 표시)이며, 본 서비스는 서울특별시 공공데이터를 사용한 결과입니다. 센서 위치는 같은 데이터셋의 "설치 위치정보" 파일로 장소와 대응시켰고, 저장소에는 좌표 없이 시리얼과 거리만 실었습니다(`scripts/sdot_place_sensors.json`). 인증키는 이용약관 제7조에 따라 공개하지 않고 GitHub Actions Secrets에만 둡니다.
- OpenStreetMap 타일(ODbL, 기여자 표기)
- YAMNet: Apache-2.0 (tfhub.dev/google/tfjs-model/yamnet/tfjs/1)
- ESC-50 (K. J. Piczak, 2015, CC BY-NC 3.0): 소리 분류 평가에만 썼고 저장소에는 싣지 않았습니다. `public/samples/`의 샘플 6개는 ESC-50에 실린 음원 가운데 개별 라이선스가 CC0인 것이며, 출처는 `src/data/samples.json`에 있습니다.

## 개인정보

아이의 이름, 진단명, 행동 기록을 받지 않습니다. 프로필과 다녀온 뒤 기록은 브라우저 저장소에만 둡니다. 소리는 기기 안에서 분류하며 원음을 전송하지 않습니다. 생성형 AI에 보내는 것은 장소 이름과 혼잡도 예측뿐입니다.

## 한계

혼잡도는 공원, 상권, 역 같은 지역 단위라 개별 가게의 환경과 다릅니다. 소음 센서는 길가에 있어서 장소 안쪽과 다를 수 있고 소리의 크기만 잽니다(전날 치까지 제공). 지수 산식은 검증 전 가설입니다. 소리 측정값을 기기 사이에 공유하는 서버는 배포하지 않았고, 이 정적 배포에서는 `/api` 요청을 아예 보내지 않습니다(`worker/`는 배포하지 않은 Cloudflare Worker 코드입니다). 수집 이력은 2026-10-08부터 쌓여서 요일별 패턴과 예측 일치율은 표본이 적습니다.
