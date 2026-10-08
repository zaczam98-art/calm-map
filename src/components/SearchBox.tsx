import { useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { createPortal, flushSync } from 'react-dom'
import type { Level3, Place } from '../types'
import { LEVEL3_LABEL } from '../lib/index'
import { choseong, matches } from '../lib/hangul'
import '../styles/map.css'

const MAX = 5

/** 이름에 괄호나 가운뎃점이 끼어 있어 그대로는 찾아지지 않는 부름말. 장소 이름의 글자에서 곧바로 나오는 것만 둔다. */
const ALIASES: Record<string, string[]> = {
  'DDP(동대문디자인플라자)': ['디디피'],
  'DMC(디지털미디어시티)': ['디엠씨'],
  '광장(전통)시장': ['광장시장'],
  '신촌·이대역': ['신촌역'],
  '총신대입구(이수)역': ['총신대입구역', '이수역'],
}

const flat = (s: string) => Array.from(s.normalize('NFC').replace(/\s+/g, ''))

/** 마지막 글자가 받침 없는 음절이면 아직 조합 중일 수 있으므로, 그 글자를 초성으로만 본 검색어를 돌려준다. 예: '호' → 'ㅎ' */
function looseTail(q: string): string | null {
  const chars = Array.from(q.normalize('NFC'))
  const last = chars[chars.length - 1]
  const c = last ? last.charCodeAt(0) : 0
  if (c < 0xac00 || c > 0xd7a3 || (c - 0xac00) % 28 !== 0) return null
  chars[chars.length - 1] = choseong(last)
  return chars.join('')
}

/** 이름(과 별칭)에 검색어가 들어 있는 장소를 이름이 검색어로 시작하는 것부터 돌려준다. 검색어가 비면 빈 목록이다. */
export function searchPlaces(names: string[], query: string): { shown: string[]; total: number } {
  const q = query.trim()
  if (!q) return { shown: [], total: 0 }
  const run = (qq: string) => {
    const len = flat(qq).length
    const hits: { name: string; first: boolean }[] = []
    for (const name of names) {
      const forms = [name, ...(ALIASES[name] ?? [])]
      if (!forms.some((f) => matches(f, qq))) continue
      hits.push({ name, first: forms.some((f) => matches(flat(f).slice(0, len).join(''), qq)) })
    }
    return hits.sort((a, b) => Number(b.first) - Number(a.first)) // 정렬은 안정적이라 같은 무리 안에서는 목록 순서를 지킨다
  }
  let hits = run(q)
  const tail = looseTail(q)
  if (hits.length === 0 && tail) hits = run(tail)
  return { shown: hits.slice(0, MAX).map((h) => h.name), total: hits.length }
}

interface Props {
  places: Place[]
  /** 지금 시각의 장소별 단계. 자료가 오기 전에는 null */
  levels: Record<string, Level3> | null
  /** 줌 버튼 아래에 놓이는 검색 단추를 넣을 Leaflet 컨트롤 상자 */
  host: HTMLElement | null
  onPick: (name: string) => void
  /** 입력창에 들어올 때 부른다(지도를 서울 중심으로 되돌리지 않게 하려는 용도) */
  onFocus?: () => void
}

/**
 * 지도 위 장소 검색. 700px 미만에서는 줌 버튼 아래 돋보기 단추를 눌러 펼치고, 그 이상에서는 입력창이 줌 버튼 왼쪽에 늘 보인다.
 * 이름 일부, 초성(예: 'ㅎㄷ'), 띄어쓰기 없는 입력을 모두 찾는다.
 */
export default function SearchBox({ places, levels, host, onPick, onFocus }: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const names = useMemo(() => places.map((p) => p.name), [places])
  const found = useMemo(() => (query.trim() ? searchPlaces(names, query) : null), [names, query])

  // 바깥을 누르면 닫는다. 캡처 단계로 걸어 지도나 다른 컨트롤이 이벤트를 막아도 받는다.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!panelRef.current?.contains(t) && !toggleRef.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [open])

  const toggle = () => {
    if (open) return setOpen(false)
    // iOS는 사용자 동작 안에서 focus를 불러야 키보드가 올라오므로, 펼친 뒤 바로 같은 처리 안에서 focus한다
    flushSync(() => setOpen(true))
    inputRef.current?.focus()
  }

  const choose = (name: string) => {
    setQuery('')
    setOpen(false)
    ;(document.activeElement as HTMLElement | null)?.blur() // 키보드를 내린다
    onPick(name)
  }

  const onPanelKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation() // 열린 장소 시트까지 닫히지 않게 한다
      setOpen(false)
      if (toggleRef.current?.offsetParent) toggleRef.current.focus()
    }
  }

  // 키보드로 패널 밖으로 나가면 닫는다. relatedTarget이 없으면(iOS에서 단추를 누를 때) 닫지 않는다.
  const onPanelBlur = (e: FocusEvent) => {
    const t = e.relatedTarget as Node | null
    if (t && !panelRef.current?.contains(t) && t !== toggleRef.current) setOpen(false)
  }

  const onListKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const btns = Array.from(listRef.current?.querySelectorAll('button') ?? [])
    const i = btns.indexOf(document.activeElement as HTMLButtonElement)
    e.preventDefault()
    if (e.key === 'ArrowDown') btns[Math.min(i + 1, btns.length - 1)]?.focus()
    else if (i > 0) btns[i - 1].focus()
    else inputRef.current?.focus()
  }

  const clearOrClose = () => {
    if (query) {
      setQuery('')
      inputRef.current?.focus()
    } else {
      setOpen(false)
      if (toggleRef.current?.offsetParent) toggleRef.current.focus()
    }
  }

  const status = !found ? '' : found.shown.length ? `검색 결과 ${found.total}곳` : '목록에 없어요'
  return (
    <>
      {host &&
        createPortal(
          <button ref={toggleRef} type="button" className="sbx-toggle" aria-label="장소 검색" aria-expanded={open} aria-controls="sbx-panel" onClick={toggle}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="M15.5 15.5 21 21" />
            </svg>
          </button>,
          host,
        )}
      <div ref={panelRef} id="sbx-panel" className={open ? 'sbx-panel open' : 'sbx-panel'} onKeyDown={onPanelKey} onBlur={onPanelBlur}>
        <form
          className="sbx-field"
          role="search"
          onSubmit={(e) => {
            e.preventDefault()
            if (found?.shown[0]) choose(found.shown[0])
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="M15.5 15.5 21 21" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-label="장소 이름 검색"
            placeholder="장소 검색 (예: 홍대, ㅎㄷ)"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setOpen(true)
            }}
            onFocus={() => {
              setOpen(true)
              onFocus?.()
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                listRef.current?.querySelector('button')?.focus()
              }
            }}
          />
          <button type="button" className={query ? 'sbx-x' : 'sbx-x empty'} aria-label={query ? '검색어 지우기' : '검색 닫기'} onClick={clearOrClose}>
            <span aria-hidden>×</span>
          </button>
        </form>
        {open && found && (
          <ul ref={listRef} className="sbx-list" onKeyDown={onListKey}>
            {found.shown.map((n) => {
              const lv = levels?.[n]
              return (
                <li key={n}>
                  <button type="button" onClick={() => choose(n)}>
                    <i className={`dot ${lv ?? 'nodata'}`} aria-hidden />
                    <span>{n}</span>
                    {lv && <small>{LEVEL3_LABEL[lv]}</small>}
                  </button>
                </li>
              )
            })}
            {found.shown.length === 0 && <li className="sbx-note">목록에 없어요(서울시 추적 {places.length}곳)</li>}
            {found.total > MAX && <li className="sbx-note">{found.total}곳이 맞아요. 더 입력하면 좁혀져요</li>}
          </ul>
        )}
        <p className="sbx-sr" role="status">
          {open ? status : ''}
        </p>
      </div>
    </>
  )
}
