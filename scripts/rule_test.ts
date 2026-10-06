// 규칙 검사기 자체 점검: node scripts/rule_test.ts
import { validateCard } from '../shared/cardRules.ts'
const base = { prep: '물을 챙겨요.', whenHard: '벤치에서 쉬어요.' }
const ok = validateCard({ ...base, steps: [{ icon: 'walk', text: '공원 입구로 천천히 걸어가요.' }, { icon: 'look', text: '병원 앞을 지나 꽃을 봐요.' }, { icon: 'bye', text: '다 보면 손을 흔들어요.' }] })
const bad = validateCard({ ...base, steps: [{ icon: 'walk', text: '표를 500원에 사요.' }, { icon: 'look', text: '만원을 내요.' }, { icon: 'bye', text: '손을 흔들어요.' }] })
console.log('ok case:', ok.ok, ok.reasons.join('; ') || '-')
console.log('bad case:', bad.ok, bad.reasons.join('; '))
