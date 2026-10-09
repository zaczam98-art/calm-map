/* 앱 화면 파일만 이 기기에 캐시해서 오프라인에서도 앱이 열리게 하는 최소 서비스 워커.
 * 빌드 뒤 scripts/gen_precache.mjs가 아래 두 자리표시(BUILD, PRECACHE)를 채운다.
 * 지도 타일, raw.githubusercontent.com, data-mirror, TF Hub 모델 같은 요청은 건드리지 않는다. */
const BUILD = '__BUILD__'
const PRECACHE = '__PRECACHE__'

const CACHE_PREFIX = 'calm-map-shell-'
const CACHE = CACHE_PREFIX + BUILD
const SCOPE = self.registration.scope
const SCOPE_PATH = new URL(SCOPE).pathname
const SHELL = new URL('index.html', SCOPE).href
// 자리표시가 비어 있으면(gen_precache를 돌리지 않은 빌드) 미리 받기 없이 방문한 파일만 캐시한다
const LIST = typeof PRECACHE === 'object' ? PRECACHE : { core: [], extra: [] }

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      // 해시가 붙은 assets/는 HTTP 캐시를 써도 되지만, 이름이 고정된 파일은 10분짜리 HTTP 캐시의 옛 사본을 피해 새로 받는다
      const add = (p) => cache.add(new Request(new URL(p, SCOPE).href, { cache: p.startsWith('assets/') ? 'default' : 'reload' }))
      // 앱 화면 파일은 하나라도 못 받으면 설치를 접고 다음 방문에 다시 시도한다
      await Promise.all(LIST.core.map(add))
      // 시험 소리와 카드 자료는 못 받아도 설치를 막지 않는다(쓸 때 받아서 캐시한다)
      await Promise.allSettled(LIST.extra.map(add))
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== CACHE).map((n) => caches.delete(n)))
      await self.clients.claim()
    })(),
  )
})

/** 해시나 고정된 이름의 파일: 캐시에 있으면 그대로 쓰고, 없으면 받아서 캐시에 넣는다. */
async function cacheFirst(event) {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(event.request, { ignoreVary: true })
  if (hit) return hit
  const res = await fetch(event.request)
  // 없는 파일에 index.html을 200으로 돌려주는 호스트가 있어도 그 화면을 JS 이름으로 캐시하지 않는다
  const html = (res.headers.get('content-type') || '').includes('text/html')
  if (res.ok && !html) event.waitUntil(cache.put(event.request, res.clone()))
  return res
}

/** 화면과 manifest, 자료 파일: 먼저 네트워크로 받고, 연결이 안 되면 캐시를 쓴다. 화면 이동은 캐시한 index.html로 대신한다. */
async function networkFirst(event) {
  const req = event.request
  const cache = await caches.open(CACHE)
  const key = req.mode === 'navigate' ? SHELL : req
  try {
    const res = await fetch(req)
    if (res.ok) event.waitUntil(cache.put(key, res.clone()))
    return res
  } catch (err) {
    const hit = await cache.match(key, { ignoreSearch: true, ignoreVary: true })
    if (hit) return hit
    throw err
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET' || req.headers.has('range')) return
  const url = new URL(req.url)
  // 다른 출처(타일, raw.githubusercontent.com, 모델)와 이 앱 범위 밖 요청은 응답하지 않아 브라우저가 평소처럼 처리한다
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE_PATH)) return
  const rel = url.pathname.slice(SCOPE_PATH.length)
  if (rel.startsWith('data-mirror/') || rel.startsWith('api/')) return
  event.respondWith(rel.startsWith('assets/') || rel.startsWith('samples/') ? cacheFirst(event) : networkFirst(event))
})
