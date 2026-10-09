// 빌드가 끝난 폴더를 훑어 서비스 워커(dist/sw.js)의 자리표시를 채운다: node scripts/gen_precache.mjs [dist]
// BUILD는 미리 받을 파일의 이름과 내용에서 만든 해시라서, 화면이나 자료 파일이 바뀐 배포에서만 캐시 이름이 달라진다.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const dist = process.argv[2] || 'dist'

// core는 하나라도 못 받으면 설치를 접는 앱 화면 파일, extra는 못 받아도 되는 시험 소리와 카드 자료
const CORE = [/^index\.html$/, /^manifest\.webmanifest$/, /^assets\/[^/]+$/, /^(favicon\.svg|icon-\d+\.png)$/]
const EXTRA = [/^data\/(snapshot-demo|cards|card_modules)\.json$/, /^samples\/[^/]+\.wav$/]

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))

const files = walk(dist)
  .map((f) => relative(dist, f).split(sep).join('/'))
  .sort()
const core = files.filter((f) => CORE.some((re) => re.test(f)))
const extra = files.filter((f) => EXTRA.some((re) => re.test(f)))

for (const must of ['index.html', 'manifest.webmanifest']) {
  if (!core.includes(must)) {
    console.error(`${dist}/${must}가 없어요. 빌드가 끝난 폴더를 넘겨 주세요`)
    process.exit(1)
  }
}

const hash = createHash('sha256')
let bytes = 0
for (const f of [...core, ...extra]) {
  const buf = readFileSync(join(dist, f))
  bytes += buf.length
  hash.update(`${f}\0${createHash('sha256').update(buf).digest('hex')}\n`)
}
const build = hash.digest('hex').slice(0, 10)

const swPath = join(dist, 'sw.js')
const sw = readFileSync(swPath, 'utf8')
if (!sw.includes("'__BUILD__'") || !sw.includes("'__PRECACHE__'")) {
  console.error(`${swPath}에 자리표시가 없어요. 빌드를 다시 한 뒤 한 번만 실행하세요`)
  process.exit(1)
}
writeFileSync(
  swPath,
  sw.replace("'__BUILD__'", () => `'${build}'`).replace("'__PRECACHE__'", () => JSON.stringify({ core, extra })),
)
console.log(`sw.js: build ${build}, core ${core.length}개, extra ${extra.length}개, 합계 ${(bytes / 1024).toFixed(0)} KB`)
