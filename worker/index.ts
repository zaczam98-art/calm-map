/**
 * Cloudflare Worker: 정적 자산 + /api/*
 * - /api/snapshot : GitHub data 브랜치의 snapshot.json을 5분 캐시로 중계(서울 API는 8088 포트라 Worker가 직접 못 부른다)
 * - /api/sound    : 장소별 소리 버킷 요약(KV)
 * - /api/measure  : 측정 세션 요약 누적(원음 금지)
 * - /api/card     : Gemini 구조화 출력 → 규칙 검사 → 실패 시 사전 카드
 */
import { validateCard, CARD_ICONS, type CardDraft } from '../shared/cardRules'

export interface Env {
  ASSETS: Fetcher
  CALM_KV: KVNamespace
  DATA_URL?: string
  GEMINI_KEY?: string
  GEMINI_MODEL?: string
  CARD_DAILY_LIMIT?: string
}

const TAGS = ['sudden', 'crowd', 'machine', 'music', 'speech', 'ambient'] as const
type Tag = (typeof TAGS)[number]
const TAG_KO: Record<Tag, string> = { sudden: '돌발음(사이렌·경적·알람)', crowd: '군중 소리', machine: '기계·차량', music: '음악·안내방송', speech: '말소리', ambient: '배경음' }
const LEVEL_KO: Record<string, string> = { calm: '무던함(사람이 적고 조용함)', mid: '보통', busy: '붐빔(사람이 많고 소리가 큼)' }

const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...extra } })

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request)
    try {
      if (url.pathname === '/api/snapshot' && request.method === 'GET') return snapshot(request, env, ctx)
      if (url.pathname === '/api/sound' && request.method === 'GET') return json(await soundStore(env))
      if (url.pathname === '/api/measure' && request.method === 'POST') return measure(request, env)
      if (url.pathname === '/api/card' && request.method === 'POST') return card(request, env)
      return json({ error: 'not found' }, 404)
    } catch (e) {
      return json({ error: (e as Error).message }, 500)
    }
  },
}

async function snapshot(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!env.DATA_URL) return json({ error: 'DATA_URL not set' }, 404)
  // '/'로 시작하면 정적 자산 안의 파일을 그대로 쓴다(로컬 개발, 또는 같은 저장소에 스냅샷을 넣는 배포)
  if (env.DATA_URL.startsWith('/')) {
    const r = await env.ASSETS.fetch(new Request(new URL(env.DATA_URL, request.url).toString()))
    if (!r.ok) return json({ error: 'asset ' + r.status }, 502)
    return new Response(await r.text(), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' } })
  }
  const cache = caches.default
  const key = new Request(env.DATA_URL)
  const hit = await cache.match(key)
  if (hit) return hit
  const r = await fetch(env.DATA_URL, { cf: { cacheTtl: 300 } })
  if (!r.ok) return json({ error: 'upstream ' + r.status }, 502)
  const body = await r.text()
  const res = new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' } })
  ctx.waitUntil(cache.put(key, res.clone()))
  return res
}

interface Bucket { n: number; tags: Partial<Record<Tag, number>> }

async function soundStore(env: Env): Promise<Record<string, Record<string, Bucket>>> {
  const raw = await env.CALM_KV.get('sound')
  return raw ? (JSON.parse(raw) as Record<string, Record<string, Bucket>>) : {}
}

async function measure(request: Request, env: Env): Promise<Response> {
  const len = Number(request.headers.get('content-length') || '0')
  if (len > 2048) return json({ error: 'too large' }, 413)
  const b = (await request.json()) as Record<string, unknown>
  for (const k of Object.keys(b)) if (['audio', 'wave', 'pcm', 'embedding', 'raw'].includes(k)) return json({ error: '원음 필드는 받지 않습니다' }, 400)
  const place = String(b.place || '').slice(0, 40)
  const dow = Number(b.dow)
  const hour = Number(b.hour)
  const n = Math.min(600, Math.max(1, Number(b.n) || 0))
  const tags = (b.tags || {}) as Record<string, number>
  if (!place || !(dow >= 0 && dow <= 6) || !(hour >= 0 && hour <= 23)) return json({ error: 'bad input' }, 400)
  const clean: Partial<Record<Tag, number>> = {}
  for (const t of TAGS) if (typeof tags[t] === 'number') clean[t] = Math.max(0, Math.min(1, tags[t]))
  const store = await soundStore(env)
  const key = `${dow}-${hour}`
  store[place] = store[place] || {}
  const prev = store[place][key]
  if (!prev) store[place][key] = { n, tags: clean }
  else {
    const tn = prev.n + n
    const merged: Partial<Record<Tag, number>> = {}
    for (const t of TAGS) merged[t] = ((prev.tags[t] ?? 0) * prev.n + (clean[t] ?? 0) * n) / tn
    store[place][key] = { n: tn, tags: merged }
  }
  await env.CALM_KV.put('sound', JSON.stringify(store))
  return json({ ok: true })
}

async function card(request: Request, env: Env): Promise<Response> {
  const b = (await request.json()) as { place?: string; category?: string; level?: string; hourLabel?: string; tags?: string[]; childTags?: string[] }
  const level = ['calm', 'mid', 'busy'].includes(String(b.level)) ? String(b.level) : 'mid'
  const preset = await presetCard(env, request, String(b.place || ''), level)
  if (!env.GEMINI_KEY) return json({ card: preset, source: 'preset', note: 'AI 키가 설정되지 않아 사전 생성 카드를 보여 드려요.' })

  const today = new Date().toISOString().slice(0, 10)
  const limit = Number(env.CARD_DAILY_LIMIT || '300')
  const cntKey = `cardcount:${today}`
  const used = Number((await env.CALM_KV.get(cntKey)) || '0')
  if (used >= limit) return json({ card: preset, source: 'preset', note: '오늘 AI 생성 한도에 닿아 사전 생성 카드를 보여 드려요.' })

  const tags = (b.tags || []).filter((t): t is Tag => (TAGS as readonly string[]).includes(t)).map((t) => TAG_KO[t])
  const childTags = (b.childTags || []).filter((t): t is Tag => (TAGS as readonly string[]).includes(t)).map((t) => TAG_KO[t])
  const prompt = [
    '당신은 발달장애 아동을 위한 "사회적 이야기(Social Story)" 카드를 쓰는 특수교사입니다.',
    '아래 정보만으로 외출 전에 아이가 미리 볼 카드를 만드세요. 정보에 없는 사실(입구 방향, 동선, 층, 가격, 영업시간, 상호)은 절대 쓰지 마세요.',
    `장소: ${String(b.place || '').slice(0, 40)} (${String(b.category || '').slice(0, 20)})`,
    `방문 시간대: ${String(b.hourLabel || '오늘').slice(0, 10)}, 예상 상태: ${LEVEL_KO[level]}`,
    tags.length ? `그 시간대에 자주 들리는 소리: ${tags.join(', ')}` : '소리 측정 자료는 없습니다.',
    childTags.length ? `아이가 예민한 요인: ${childTags.join(', ')}` : '',
    '규칙: 단계 3~5개. 각 단계는 28자 이내, "~해요/~어요" 서술로 끝내고, 아이가 1인칭으로 읽는 쉬운 말. 명령형·반말 금지.',
    '금지어: 장애, 자폐, 진단, 위험, 절대, 금지, 경고, 못 가, 사고. 판정하지 말고 권고만.',
    `아이콘은 다음 중 하나: ${CARD_ICONS.join(', ')}.`,
    'prep(준비물 한 줄 30자 이내), whenHard(힘들 때 할 일 한 줄 30자 이내)도 쓰세요.',
  ].filter(Boolean).join('\n')

  const model = env.GEMINI_MODEL || 'gemini-flash-lite-latest'
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.6,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            steps: { type: 'ARRAY', items: { type: 'OBJECT', properties: { icon: { type: 'STRING', enum: [...CARD_ICONS] }, text: { type: 'STRING' } }, required: ['icon', 'text'] } },
            prep: { type: 'STRING' },
            whenHard: { type: 'STRING' },
          },
          required: ['steps', 'prep', 'whenHard'],
        },
      },
    }),
  })
  await env.CALM_KV.put(cntKey, String(used + 1), { expirationTtl: 60 * 60 * 36 })
  if (!r.ok) return json({ card: preset, source: 'preset', note: `AI 호출 실패(${r.status})로 사전 생성 카드를 보여 드려요.` })
  const j = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  const text = j.candidates?.[0]?.content?.parts?.[0]?.text || ''
  let draft: unknown = null
  try { draft = JSON.parse(text) } catch { /* 아래에서 처리 */ }
  const v = validateCard(draft)
  await logValidation(env, today, v.ok, v.reasons)
  if (v.ok && v.card) return json({ card: v.card, source: 'ai' })
  return json({ card: preset, source: 'preset', note: `AI 문장이 규칙 검사에 걸려(${v.reasons[0] || '형식'}) 사전 생성 카드를 보여 드려요.` })
}

/** 카드 규칙 통과율 집계(성과보고서 지표용) */
async function logValidation(env: Env, day: string, ok: boolean, reasons: string[]) {
  const key = `cardlog:${day}`
  const raw = await env.CALM_KV.get(key)
  const log = raw ? (JSON.parse(raw) as { ok: number; fail: number; reasons: Record<string, number> }) : { ok: 0, fail: 0, reasons: {} }
  if (ok) log.ok++
  else {
    log.fail++
    for (const r of reasons.slice(0, 3)) log.reasons[r] = (log.reasons[r] || 0) + 1
  }
  await env.CALM_KV.put(key, JSON.stringify(log), { expirationTtl: 60 * 60 * 24 * 60 })
}

async function presetCard(env: Env, request: Request, place: string, level: string): Promise<CardDraft> {
  const u = new URL('/data/cards.json', request.url)
  const r = await env.ASSETS.fetch(new Request(u.toString()))
  const all = r.ok ? ((await r.json()) as Record<string, CardDraft>) : {}
  return all[`${place}|${level}`] || all[`*|${level}`] || all['*|mid']
}
