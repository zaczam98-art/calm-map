import type { HourScore, Level3, Place } from '../types'
import { recommend } from './index'
import { FILL, isNight } from './chartStyle'

/** 공유 이미지 크기(4:5). 단톡방 미리보기에서 잘리지 않는 세로형이다. */
export const SHARE_W = 1080
export const SHARE_H = 1350

const SITE = 'https://zaczam98-art.github.io/calm-map/'
// 기기에 깔린 한글 sans-serif를 쓴다. 글꼴 파일을 내려받지 않으므로 모양은 기기마다 조금 다를 수 있다.
const FONT = '"Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif'
const C = { bg: '#f6f7f9', card: '#ffffff', ink: '#1f2933', muted: '#5f6b7a', line: '#e3e7ec', accent: '#2f6f8f', soft: '#eaf3f8', sel: '#dcecf4', guide: '#c4ccd6' }

export interface ShareCardInput {
  place: Pick<Place, 'name'>
  scores: HourScore[]
  nowKey: string | undefined
  /** 자료 기준 시각 'YYYY-MM-DD HH:MM'(한국 시간) */
  updatedAt: string | undefined
  /** 보호자가 고른 시(0~23). 없으면 null */
  selectedHour: number | null
  /** 맞춤(아이 프로필) 반영 여부. 프로필 값은 이미지에 넣지 않고 표식만 그린다. */
  adapted: boolean
}

/** 이 장소로 들어오는 주소(해시 라우팅) */
export function placeShareUrl(name: string): string {
  return `${SITE}#/place/${encodeURIComponent(name)}`
}

/** 파일 이름에 못 쓰는 글자를 바꾼다 */
export function shareFileName(name: string): string {
  return `무던한지도_${name.replace(/[\\/:*?"<>|\s]+/g, '_')}.png`
}

/** '서울시 10/04 20:54 기준'. 저장한 이미지는 날짜가 지난 뒤에도 돌아다니므로 날짜를 같이 적는다. */
export function stampLabel(updatedAt: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(updatedAt)
  return m ? `서울시 ${m[1]}/${m[2]} ${m[3]}:${m[4]} 기준` : `서울시 ${updatedAt} 기준`
}

const font = (weight: number, size: number) => `${weight} ${size}px ${FONT}`

function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/** 공백에서 줄을 바꾸고, 낱말 하나가 한 줄보다 길면 글자 단위로 자른다. ctx.font는 미리 맞춰 둔다. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    const joined = line ? `${line} ${word}` : word
    if (ctx.measureText(joined).width <= maxW) {
      line = joined
      continue
    }
    if (line) lines.push(line)
    line = ''
    for (const ch of word) {
      if (line && ctx.measureText(line + ch).width > maxW) {
        lines.push(line)
        line = ch
      } else line += ch
    }
  }
  if (line) lines.push(line)
  return lines
}

/** 큰 글자부터 시도해 maxLines 안에 들어가는 첫 크기를 고른다. 어느 크기에도 안 들어가면 null이다. */
function fitOrNull(ctx: CanvasRenderingContext2D, text: string, maxW: number, weight: number, sizes: number[], maxLines: number) {
  for (const size of sizes) {
    ctx.font = font(weight, size)
    const lines = wrap(ctx, text, maxW)
    if (lines.length <= maxLines) return { size, lines }
  }
  return null
}

/** fitOrNull로 안 되면 가장 작은 글자로 쓰고 마지막 줄을 말줄임으로 끝낸다. */
function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number, weight: number, sizes: number[], maxLines: number) {
  const ok = fitOrNull(ctx, text, maxW, weight, sizes, maxLines)
  if (ok) return ok
  const size = sizes[sizes.length - 1]
  ctx.font = font(weight, size)
  const lines = wrap(ctx, text, maxW).slice(0, maxLines)
  let last = lines[maxLines - 1]
  while (last.length > 1 && ctx.measureText(`${last}…`).width > maxW) last = last.slice(0, -1)
  lines[maxLines - 1] = `${last}…`
  return { size, lines }
}

interface ChartBox {
  x: number
  y: number
  w: number
  h: number
  selIdx: number
  hlIdx: number
  nowIsCurrent: boolean
}

/** HourChart.tsx와 같은 규칙(값 대 높이 비율, 색, 밤 시간 옅게, 점선 35·65)으로 그린다. 글자 칸은 상자 높이와 상관없이 고정 크기를 둔다. */
function drawChart(ctx: CanvasRenderingContext2D, scores: HourScore[], b: ChartBox) {
  const LABEL_H = 46
  const TOP_H = 40
  const PAD_L = 14
  const PAD_R = 8
  const GAP = 3
  const n = Math.max(scores.length, 1)
  const bw = (b.w - PAD_L - PAD_R) / n
  const base = b.y + b.h - LABEL_H
  const plotH = b.h - LABEL_H - TOP_H
  const barMax = Math.max(0, ...scores.map((s) => s.index ?? 0))
  const yMax = Math.min(100, Math.max(70, Math.ceil((barMax + 10) / 10) * 10))
  const yOf = (v: number) => base - (v / yMax) * plotH
  const xOf = (i: number) => b.x + PAD_L + i * bw

  if (b.selIdx >= 0) {
    rrect(ctx, xOf(b.selIdx), b.y + 2, bw, base - b.y + 2, 12)
    ctx.fillStyle = C.sel
    ctx.fill()
    ctx.lineWidth = 3
    ctx.strokeStyle = C.accent
    ctx.stroke()
  }
  ctx.lineWidth = 2
  ctx.strokeStyle = C.guide
  ctx.setLineDash([8, 8])
  for (const v of [35, 65]) {
    ctx.beginPath()
    ctx.moveTo(b.x + PAD_L, yOf(v))
    ctx.lineTo(b.x + b.w, yOf(v))
    ctx.stroke()
  }
  ctx.setLineDash([])

  scores.forEach((s, i) => {
    const h = ((s.index ?? 0) / yMax) * plotH
    const x = xOf(i) + GAP
    const w = bw - GAP * 2
    const y = base - h
    const alpha = isNight(s.hour) ? 0.45 : 1
    ctx.globalAlpha = alpha
    rrect(ctx, x, y, w, h, 7)
    if (s.level === 'nodata') {
      ctx.globalAlpha = alpha * 0.7
      ctx.fillStyle = FILL.nodata
      ctx.fill()
      ctx.globalAlpha = alpha
      ctx.strokeStyle = C.muted
      ctx.lineWidth = 2
      ctx.setLineDash([6, 6])
      ctx.stroke()
      ctx.setLineDash([])
    } else {
      ctx.fillStyle = FILL[s.level]
      ctx.fill()
      // 옅은 '무던함' 색이 흰 바탕에서 묻히지 않게 얇은 윤곽을 둔다
      ctx.strokeStyle = 'rgba(31, 41, 51, .35)'
      ctx.lineWidth = 2
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    if (i === b.hlIdx) {
      rrect(ctx, x - 6, y - 6, w + 12, h + 12, 10)
      ctx.strokeStyle = C.ink
      ctx.lineWidth = 4
      ctx.stroke()
    }
  })

  // 눈금 글자: 첫 칸, 고른 칸, 3시간마다. 고른 칸 바로 옆과 첫 칸 바로 옆은 겹치므로 뺀다.
  ctx.textAlign = 'center'
  ctx.fillStyle = C.ink
  scores.forEach((s, i) => {
    const nearSel = b.selIdx >= 0 && Math.abs(i - b.selIdx) === 1
    const show = i === b.selIdx || (!nearSel && (i === 0 || (i > 1 && s.hour % 3 === 0)))
    if (!show) return
    ctx.font = font(i === b.selIdx ? 700 : 400, 28)
    ctx.fillText(i === 0 && b.nowIsCurrent ? '지금' : `${s.hour}시`, xOf(i) + bw / 2, b.y + b.h - 10)
  })

  const dayBreak = scores.findIndex((s, i) => i > 0 && s.time.slice(0, 10) !== scores[i - 1].time.slice(0, 10))
  if (dayBreak > 0) {
    const x = xOf(dayBreak)
    ctx.strokeStyle = C.muted
    ctx.lineWidth = 2
    ctx.setLineDash([4, 6])
    ctx.beginPath()
    ctx.moveTo(x, b.y + 4)
    ctx.lineTo(x, base)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.textAlign = 'left'
    ctx.font = font(400, 26)
    ctx.lineJoin = 'round'
    ctx.lineWidth = 7
    ctx.strokeStyle = C.card
    ctx.strokeText('내일', x + 8, b.y + 30)
    ctx.fillStyle = C.ink
    ctx.fillText('내일', x + 8, b.y + 30)
  }
  // 날짜 구분선이 없는 12시간에서도 뒤에 그리는 설명 글과 범례가 가운데 정렬로 남지 않게 되돌린다
  ctx.textAlign = 'left'
}

/** 1080x1350 캔버스에 공유 카드를 그린다. 프로필 값은 받지도, 그리지도 않는다. */
export function drawShareCard(ctx: CanvasRenderingContext2D, input: ShareCardInput) {
  const { place, scores, nowKey, updatedAt, selectedHour, adapted } = input
  const M = 72
  const CW = SHARE_W - M * 2
  const rec = recommend(scores, nowKey)
  const today = (nowKey ?? scores[0]?.time ?? '').slice(0, 10)
  const hourName = (s: HourScore) => `${s.time.slice(0, 10) === today ? '오늘' : '내일'} ${s.hour}시`

  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, SHARE_W, SHARE_H)
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'

  // 머리: 서비스 이름, 맞춤 반영 표식
  ctx.font = font(700, 40)
  ctx.fillStyle = C.accent
  ctx.fillText('무던한 지도', M, 104)
  if (adapted) {
    ctx.font = font(700, 30)
    const bw = ctx.measureText('맞춤 반영').width + 44
    rrect(ctx, M + CW - bw, 56, bw, 56, 28)
    ctx.fillStyle = C.accent
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.fillText('맞춤 반영', M + CW - bw / 2, 94)
    ctx.textAlign = 'left'
  }

  // 장소 이름
  // 이름은 한 줄에 들어가는 가장 큰 글자로, 길면 두 줄로 쓴다
  const name = fitOrNull(ctx, place.name, CW, 700, [80, 70, 62], 1) ?? fit(ctx, place.name, CW, 700, [62, 54], 2)
  const nameLh = name.size * 1.22
  ctx.font = font(700, name.size)
  ctx.fillStyle = C.ink
  name.lines.forEach((l, i) => ctx.fillText(l, M, 140 + name.size * 0.92 + i * nameLh))
  const nameBottom = 140 + name.lines.length * nameLh

  // 권고 문장: 시간대 문장을 가장 먼저 크게 보인다
  const padIn = 34
  const rt = fit(ctx, rec.text, CW - padIn * 2 - 12, 700, [54, 50, 46, 42, 38], 5)
  const recLh = rt.size * 1.4
  const recTop = nameBottom + 24
  const recH = padIn * 2 + rt.lines.length * recLh
  rrect(ctx, M, recTop, CW, recH, 24)
  ctx.fillStyle = C.soft
  ctx.fill()
  ctx.save()
  ctx.clip()
  ctx.fillStyle = C.accent
  ctx.fillRect(M, recTop, 12, recH)
  ctx.restore()
  ctx.font = font(700, rt.size)
  ctx.fillStyle = C.ink
  rt.lines.forEach((l, i) => ctx.fillText(l, M + 12 + padIn, recTop + padIn + rt.size * 1.05 + i * recLh))
  const recBottom = recTop + recH

  // 아래쪽 고정 영역: 기준 시각, 예측 안내, 주소
  const FOOT = 1140
  ctx.strokeStyle = C.line
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(M, FOOT)
  ctx.lineTo(M + CW, FOOT)
  ctx.stroke()
  ctx.font = font(700, 40)
  ctx.fillStyle = C.ink
  ctx.fillText(updatedAt ? stampLabel(updatedAt) : '', M, FOOT + 56)
  ctx.font = font(400, 38)
  ctx.fillText('예측이며 확정이 아니에요', M, FOOT + 106)
  const shown = `${SITE}#/place/${place.name}`
  ctx.fillStyle = C.accent
  // 주소는 한 줄에 들어가는 가장 큰 글자로, 그래도 길면 두 줄로 쓴다
  const urlWidth = (size: number) => {
    ctx.font = font(400, size)
    return ctx.measureText(shown).width
  }
  const urlSize = [28, 26, 24].find((s) => urlWidth(s) <= CW)
  const url = urlSize ? { size: urlSize, lines: [shown] } : fit(ctx, shown, CW, 400, [26], 2)
  ctx.font = font(400, url.size)
  url.lines.forEach((l, i) => ctx.fillText(l, M, FOOT + 158 + i * 34))

  // 12시간 막대 상자
  const hasBars = scores.some((s) => s.index !== null)
  if (!hasBars) return
  const panelTop = recBottom + 28
  const panelBottom = FOOT - 28
  const selIdx = selectedHour === null ? -1 : scores.findIndex((s) => s.hour === selectedHour)
  const hlIdx = rec.from === null ? -1 : scores.findIndex((s) => s.hour === rec.from)
  const nowIsCurrent = !nowKey || scores[0].time.slice(0, 13) === nowKey
  rrect(ctx, M, panelTop, CW, panelBottom - panelTop, 28)
  ctx.fillStyle = C.card
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = C.line
  ctx.stroke()

  const ix = M + 28
  const iw = CW - 56
  ctx.font = font(700, 32)
  ctx.fillStyle = C.ink
  ctx.fillText('시간대별 감각부하 지수', ix, panelTop + 62)

  // 그림 설명: 막대가 좁은 칸에 들어가는 만큼만 쓴다
  const notes = [
    selIdx >= 0 && `바탕이 칠해진 막대는 ${hourName(scores[selIdx])}예요.`,
    hlIdx >= 0 && '테두리가 있는 막대는 권고 시간이에요.',
    scores.some((s) => isNight(s.hour)) && '옅은 막대는 밤 시간이라 추천 비교에서 뺐어요.',
  ].filter((t): t is string => typeof t === 'string')
  const LEG_H = 40
  const CAP_LH = 37
  const chartTop = panelTop + 82
  let capLines: string[] = []
  let chartH = 0
  for (let k = notes.length; k >= 0; k -= 1) {
    ctx.font = font(400, 28)
    capLines = k ? wrap(ctx, notes.slice(0, k).join(' '), iw) : []
    chartH = panelBottom - 26 - LEG_H - 14 - (capLines.length ? capLines.length * CAP_LH + 8 : 0) - chartTop
    if (chartH >= 200) break
  }
  drawChart(ctx, scores, { x: ix, y: chartTop, w: iw, h: Math.max(chartH, 200), selIdx, hlIdx, nowIsCurrent })

  // 설명 글과 색 범례
  const capTop = chartTop + Math.max(chartH, 200) + 8
  ctx.font = font(400, 28)
  ctx.fillStyle = C.muted
  capLines.forEach((l, i) => ctx.fillText(l, ix, capTop + 28 + i * CAP_LH))
  const legY = panelBottom - 26 - LEG_H
  const legend: [Level3, string][] = [['calm', '무던함(35 미만)'], ['mid', '보통'], ['busy', '붐빔(65 이상)']]
  if (scores.some((s) => s.level === 'nodata')) legend.push(['nodata', '자료 없음'])
  let lx = ix
  for (const [lv, label] of legend) {
    rrect(ctx, lx, legY + 6, 28, 28, 6)
    ctx.fillStyle = FILL[lv]
    ctx.fill()
    ctx.strokeStyle = lv === 'nodata' ? C.muted : 'rgba(31, 41, 51, .35)'
    ctx.lineWidth = 2
    ctx.setLineDash(lv === 'nodata' ? [5, 4] : [])
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = C.ink
    ctx.fillText(label, lx + 38, legY + 29)
    lx += 38 + ctx.measureText(label).width + 30
  }
}

/** 공유 카드 PNG. 글꼴 준비를 잠깐 기다린 뒤 그린다. */
export async function makeShareCardBlob(input: ShareCardInput): Promise<Blob> {
  try {
    await document.fonts?.ready
  } catch {
    /* 글꼴 준비를 못 기다려도 기기 기본 글꼴로 그린다 */
  }
  const canvas = document.createElement('canvas')
  canvas.width = SHARE_W
  canvas.height = SHARE_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d unavailable')
  drawShareCard(ctx, input)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
  })
}
