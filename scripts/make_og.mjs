// 공유 미리보기(public/og.png)와 설치 아이콘(public/icon-*.png)을 다시 만든다.
// 사용: node scripts/make_og.mjs <지도 홈 캡처.png>
// 캡처는 1280x800 데스크톱 지도 홈이어야 하고, 아래 CROP 영역에 마커가 모두 들어와야 한다.
// 글꼴은 Malgun Gothic이며, 없으면 같은 계열의 한글 글꼴로 대체된다.
// sharp가 필요하다(wrangler의 하위 의존성으로 node_modules에 들어 있다).
import { readFileSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = fileURLToPath(new URL('..', import.meta.url))
const pub = (name) => root + 'public/' + name

const BG = '#f5f7fa'
const INK = '#1f2933'
const ACCENT = '#46739e'
const MUTED = '#5f6b7a'
const LINE = '#d5dae0'
const FONT = "'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans CJK KR', sans-serif"

const PANEL = { x: 40, y: 40, w: 540, h: 550, r: 28 }
const CROP = { left: 358, top: 117, width: 560, height: 570 }
const COL_X = 620

const capture = process.argv[2]
if (!capture || !existsSync(capture)) {
  console.error('사용: node scripts/make_og.mjs <지도 홈 캡처.png>')
  process.exit(1)
}

// 아이콘: favicon.svg의 원 요소를 그대로 쓰고, 없으면 기본 농담 원 세 개를 그린다.
const fav = readFileSync(pub('favicon.svg'), 'utf8')
const DEFAULT_CIRCLES = [
  '<circle cx="14" cy="32" r="8" fill="#9ddbc8"/>',
  '<circle cx="32" cy="32" r="8" fill="#46739e"/>',
  '<circle cx="50" cy="32" r="8" fill="#2e2a5e"/>',
]
const circles = fav.match(/<circle[^>]*\/>/g) ?? DEFAULT_CIRCLES
const favSvg = /<rect[^>]*rx=/.test(fav)
  ? fav
  : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="1" y="1" width="62" height="62" rx="14" fill="#ffffff" stroke="${LINE}" stroke-width="2"/>${circles.join('')}</svg>`
// 홈 화면 아이콘(180, 192, 512)은 꽉 찬 흰 바탕으로 만든다. iOS는 투명한 모서리를 검게 채우고,
// 원은 가운데 80% 안전 영역에 들어가므로 Android의 maskable 마스크에도 잘리지 않는다.
const flatSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#ffffff"/><g transform="translate(32 32) scale(.9) translate(-32 -32)">${circles.join('')}</g></svg>`

const render = (svg, size) =>
  sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png({ compressionLevel: 9 })

await render(flatSvg, 180).toFile(pub('icon-180.png'))
await render(flatSvg, 192).toFile(pub('icon-192.png'))
await render(flatSvg, 512).toFile(pub('icon-512.png'))
const iconBuf = await render(favSvg, 168).toBuffer()

// 공유 이미지
const mapBuf = await sharp(capture).extract(CROP).resize(PANEL.w, PANEL.h, { fit: 'fill' }).png().toBuffer()
const b64 = (buf) => buf.toString('base64')
const { x, y, w, h, r } = PANEL

const lines = [
  ['외출 전에,'],
  ['이 장소가 ', ['몇 시에', true], ' 무던한지'],
  ['미리 보는 지도'],
]
const tagline = lines
  .map((parts, i) => {
    const inner = parts
      .map((p) => (Array.isArray(p) ? `<tspan fill="${ACCENT}" font-weight="700">${p[0]}</tspan>` : p))
      .join('')
    return `<text x="${COL_X}" y="${352 + i * 50}" font-size="34" fill="${INK}">${inner}</text>`
  })
  .join('')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" font-family="${FONT}">
  <defs>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14"/></filter>
    <clipPath id="cp"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/></clipPath>
  </defs>
  <rect width="1200" height="630" fill="${BG}"/>
  <rect x="${x}" y="${y + 8}" width="${w}" height="${h}" rx="${r}" fill="${INK}" opacity=".16" filter="url(#sh)"/>
  <image x="${x}" y="${y}" width="${w}" height="${h}" clip-path="url(#cp)" href="data:image/png;base64,${b64(mapBuf)}"/>
  <rect x="${x + 1}" y="${y + 1}" width="${w - 2}" height="${h - 2}" rx="${r - 1}" fill="none" stroke="${LINE}" stroke-width="2"/>
  <rect x="${x + 18}" y="${y + h - 50}" width="104" height="32" rx="16" fill="#ffffff" opacity=".94"/>
  <text x="${x + 70}" y="${y + h - 28}" font-size="16" fill="${MUTED}" text-anchor="middle">화면 예시</text>
  <image x="${COL_X}" y="76" width="84" height="84" href="data:image/png;base64,${b64(iconBuf)}"/>
  <text x="${COL_X}" y="262" font-size="84" font-weight="700" fill="${INK}">무던한 지도</text>
  <rect x="${COL_X}" y="288" width="64" height="6" rx="3" fill="${ACCENT}"/>
  ${tagline}
  <rect x="${COL_X}" y="512" width="540" height="2" fill="${LINE}"/>
  <text x="${COL_X}" y="558" font-size="21" fill="${MUTED}">서울 121곳 · 혼잡도 예측 + 소음 실측 + 아이별 민감도</text>
</svg>`

await sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: true, quality: 92, effort: 10 }).toFile(pub('og.png'))

for (const f of ['og.png', 'icon-180.png', 'icon-192.png', 'icon-512.png']) {
  const m = await sharp(pub(f)).metadata()
  console.log(f, `${m.width}x${m.height}`, `${(statSync(pub(f)).size / 1024).toFixed(0)}KB`)
}
