# YAMNet 모델 파일 고지

이 폴더의 `model.json`과 `group1-shard1of4.bin` ~ `group1-shard4of4.bin`은 Google의 YAMNet(TensorFlow.js 변환본)을 수정 없이 그대로 복사한 파일입니다.

## 출처

- 모델: TF Hub `google/tfjs-model/yamnet/tfjs/1` (현재는 Kaggle Models의 `google/yamnet`, 변형 `tfJs/tfjs/1`로 연결됩니다)
- 내려받은 주소: `https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1/{파일 이름}?tfjs-format=file` (2026-10-11, 앱이 쓰는 주소와 같습니다)
- 형식: TensorFlow.js graph-model (변환기 TensorFlow.js Converter v2.1.0)
- 원본 모델 코드: https://github.com/tensorflow/models/tree/master/research/audioset/yamnet
- 학습 자료: AudioSet (521개 소리 종류)

## 파일 구성

| 파일 | 바이트 | SHA-256 |
| --- | --- | --- |
| model.json | 100759 | 552a4e59884a7fad25dbdbc1bbe75af2a416bca44de12523081d4b55606d59d3 |
| group1-shard1of4.bin | 4194304 | 2ba509dbfc875e0483e5e3f6935cd9be9f986dd1219796c649422fd337dde4ca |
| group1-shard2of4.bin | 4194304 | b789c08119ef33a534475b964c25447586e18328039c06322d4b5337887d1fca |
| group1-shard3of4.bin | 4194304 | 464a4a19cfb207c81bbd6ba079d2f36402902c07faa8b6d305f438dc0ab74212 |
| group1-shard4of4.bin | 3455404 | 311fcb65f9985e825a9f162b7ef82bdc81a745bff11f90bd7b1eaabbd1f55e6b |

샤드 4개의 합계는 16,038,316바이트이고, `model.json`의 `weightsManifest`에 적힌 가중치 크기 합계와 같습니다.

## 라이선스

Apache License 2.0입니다. 확인한 근거는 다음과 같습니다.

- https://raw.githubusercontent.com/tensorflow/models/master/LICENSE : `/research` 폴더 아래 모든 파일을 Apache License 2.0으로 허용한다고 적혀 있습니다. YAMNet 코드는 `research/audioset/yamnet`에 있습니다.
- https://raw.githubusercontent.com/tensorflow/models/master/research/audioset/yamnet/yamnet.py : 파일 머리말에 Apache License, Version 2.0 고지가 있습니다.

TF Hub와 Kaggle 모델 쪽 라이선스 표기는 페이지가 스크립트로 그려져서 이 작업에서 직접 확인하지 못했습니다. 위 두 근거는 모델 코드 저장소의 라이선스입니다.

라이선스 전문: https://www.apache.org/licenses/LICENSE-2.0

## 변경 사항

없습니다. 내려받은 파일을 그대로 두었고, 앱은 이 파일을 `import.meta.env.BASE_URL + 'models/yamnet/model.json'`에서 읽습니다.
