// TensorFlow가 필요 없는 감각 태그 함수와 상수. 장소 상세처럼 모델을 쓰지 않는 화면은 여기서 가져와 TensorFlow 묶음을 끌어오지 않는다.
import classNames from '../data/yamnet_classes.json'
import type { SenseTag, SoundBucket } from '../types'
import { SENSE_TAGS } from '../types'

export { SENSE_TAGS, TAG_LABEL } from '../types'

/** 클래스 이름 키워드로 감각 태그를 정한다. 먼저 맞는 태그가 우선. */
const TAG_KEYWORDS: [SenseTag, RegExp][] = [
  ['sudden', /siren|alarm|horn|honk|toot|scream|shout|yell|cry|crying|explosion|firework|firecracker|gunshot|drill|jackhammer|hammer|power tool|chainsaw|shatter|glass|slam|bang|smash|whistle|buzzer|beep|bark|dog|thunder|crash/i],
  ['crowd', /crowd|hubbub|babble|children playing|cheer|applause|clapping|chatter|laughter|giggle|chuckle|crowd/i],
  ['machine', /vehicle|car\b|bus|truck|motorcycle|engine|train|subway|rail|aircraft|helicopter|air conditioning|mechanical fan|motor|machine|lawn mower|vacuum|blender|traffic|tire|skidding|idling|accelerating/i],
  ['music', /music|singing|song|guitar|drum|piano|synthesizer|electronic|hip hop|pop music|rock|jazz|choir|organ|trumpet|violin|bell|chime|jingle|theme|soundtrack|radio|television|loudspeaker|public address/i],
  ['speech', /speech|conversation|narration|monologue|talk|male|female|child speech|whispering|voice/i],
  ['ambient', /silence|wind|water|rain|stream|bird|room|outside|environmental|white noise|pink noise|hum|noise|quiet|echo|reverberation|static/i],
]

export const CLASS_TAG: (SenseTag | null)[] = (classNames as string[]).map((n) => {
  for (const [tag, re] of TAG_KEYWORDS) if (re.test(n)) return tag
  return null
})

export function topTags(b: SoundBucket, k = 2): SenseTag[] {
  return (Object.entries(b.tags) as [SenseTag, number][])
    .filter(([t]) => t !== 'ambient')
    .sort((a, b2) => b2[1] - a[1])
    .slice(0, k)
    .map(([t]) => t)
}

/** 요약에서 값이 가장 큰 태그(배경음 포함). 평가 스크립트와 같은 기준이다. */
export function bestTag(b: SoundBucket): SenseTag | null {
  let best: SenseTag | null = null
  let bestV = 0
  for (const t of SENSE_TAGS) {
    const v = b.tags[t] ?? 0
    if (v > bestV) {
      bestV = v
      best = t
    }
  }
  return best
}
