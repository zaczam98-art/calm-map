/**
 * 샘플 음원 6개를 실제 YAMNet으로 분류해 최상위 태그를 출력한다.
 * 기존 번들(.tmp/eval_sound.cjs, scripts/eval_sound.ts를 빌드한 것)을 그대로 쓴다.
 *
 * 실행:
 *   node scripts/samples_check.mjs [wav 폴더] [결과 json] [비교할 이전 결과 json]
 * 폴더를 생략하면 public/samples를 쓴다. 이전 결과를 주면 태그가 달라진 파일을 표시하고 종료 코드 1을 돌려준다.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const [dirArg, outArg, prevArg] = process.argv.slice(2)
const dir = resolve(dirArg || join(root, 'public/samples'))
const out = resolve(outArg || join(mkdtempSync(join(tmpdir(), 'samples_check_')), 'result.json'))
const samples = JSON.parse(readFileSync(join(root, 'src/data/samples.json'), 'utf-8')).samples

// eval_sound가 읽는 ESC-50 메타 형식(file,fold,target,category,...)을 샘플 6개로 만든다. id가 ESC-50 분류 이름과 같다.
const csv = ['filename,fold,target,category,esc10,src_file,take']
for (const s of samples) csv.push(`${s.file},1,0,${s.id},False,0,A`)
const csvPath = join(mkdtempSync(join(tmpdir(), 'samples_meta_')), 'meta.csv')
writeFileSync(csvPath, csv.join('\n'), 'utf-8')

const run = spawnSync(process.execPath, [join(root, '.tmp/eval_sound.cjs'), dir, csvPath, out], { encoding: 'utf-8' })
if (run.status !== 0) {
  console.error(run.stderr || run.stdout)
  process.exit(run.status || 1)
}

const now = Object.fromEntries(JSON.parse(readFileSync(out, 'utf-8')).perClip.map((c) => [c.file, c.predicted]))
const prev = prevArg ? Object.fromEntries(JSON.parse(readFileSync(resolve(prevArg), 'utf-8')).perClip.map((c) => [c.file, c.predicted])) : null
let changed = 0
for (const s of samples) {
  const p = prev ? prev[s.file] : null
  const diff = p && p !== now[s.file]
  if (diff) changed++
  console.log(`${s.file}  기대 ${s.expected}  예측 ${now[s.file]}${p ? `  이전 ${p}${diff ? '  <- 달라짐' : ''}` : ''}`)
}
console.log(prev ? (changed ? `태그가 달라진 파일 ${changed}개` : '모든 파일의 최상위 태그가 이전과 같음') : `결과: ${out}`)
process.exit(changed ? 1 : 0)
