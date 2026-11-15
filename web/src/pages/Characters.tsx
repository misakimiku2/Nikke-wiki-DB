import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  accentFor, charPortrait, loadCharImages, loadCharMi, loadCharSpine,
  loadCharacters, mainBase, nf, tintFor,
  type CharImages, type Character,
} from '../data'

type Filter = 'all' | 'desc' | 'lines' | 'img'

export default function Characters() {
  const [list, setList] = useState<Character[] | null>(null)
  const [imgs, setImgs] = useState<CharImages>({})
  const [mi, setMi] = useState<Set<string>>(new Set())
  const [spine, setSpine] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  useEffect(() => {
    loadCharacters().then(setList).catch(() => setList([]))
    loadCharImages().then(setImgs).catch(() => {})
    loadCharMi().then(setMi).catch(() => {})
    loadCharSpine().then(setSpine).catch(() => {})
  }, [])

  /**
   * 悬停预热：鼠标在卡片上停 350ms 就把站姿模型的 atlas / skel / 图集页拉进缓存，
   * 点进详情时模型基本已经就位，不会先空一段再淡入。扫过去的鼠标不会触发。
   */
  const hoverTimer = useRef<number | null>(null)
  const warmed = useRef<Set<string>>(new Set())
  const warm = useCallback((base: string | null) => {
    if (!base || !spine.has(base) || warmed.current.has(base)) return
    warmed.current.add(base)
    const dir = `/spine_char/${base}/`
    fetch(`${dir}${base}.atlas`).catch(() => {})
    fetch(`${dir}${base}.skel`).catch(() => {})
    // 图集页由 SpinePlayer 用 <img> 加载，这里同样用 Image 预热；第二页按需再取
    const page = new Image()
    page.src = `${dir}${base}.webp`
  }, [spine])
  const warmOn = useCallback((base: string | null) => {
    if (typeof window === 'undefined' || !window.matchMedia('(hover: hover)').matches) return
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current)
    hoverTimer.current = window.setTimeout(() => warm(base), 350)
  }, [warm])
  const warmOff = useCallback(() => {
    if (hoverTimer.current) { window.clearTimeout(hoverTimer.current); hoverTimer.current = null }
  }, [])
  useEffect(() => () => warmOff(), [warmOff])

  const shown = useMemo(() => {
    if (!list) return []
    const k = q.trim().toLowerCase()
    let out = list
    if (k) {
      out = out.filter(
        (c) =>
          c.name.toLowerCase().includes(k) ||
          (c.names.en || '').toLowerCase().includes(k) ||
          (c.names.ja || '').includes(q) ||
          (c.desc || '').includes(q),
      )
    }
    if (filter === 'desc') out = out.filter((c) => c.hasDesc)
    if (filter === 'lines') out = out.filter((c) => c.lines > 0)
    // 只显示有可用立绘/头像的条目，避免 NPC 空卡
    out = out.filter((c) => !!mainBase(imgs, c.id))
    return out
  }, [list, imgs, q, filter])

  if (!list) return <div className="loading">LOADING…</div>

  const total = list.filter((c) => !!mainBase(imgs, c.id)).length

  return (
    <div className="wrap">
      <div className="sec-head">
        <div>
          <div className="idx">01 / CHARACTER</div>
          <h2>角色图鉴</h2>
        </div>
        <div className="meta">{nf(total)} ENTRIES</div>
      </div>

      <div className="toolbar">
        <input
          className="search"
          placeholder="搜索角色名 / 介绍，例：拉毗、反击部队"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className={`chip ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>
          全部
        </button>
        <button className={`chip ${filter === 'img' ? 'on' : ''}`} onClick={() => setFilter('img')}>
          有立绘
        </button>
        <button className={`chip ${filter === 'desc' ? 'on' : ''}`} onClick={() => setFilter('desc')}>
          有档案
        </button>
        <button className={`chip ${filter === 'lines' ? 'on' : ''}`} onClick={() => setFilter('lines')}>
          登过场
        </button>
      </div>

      {shown.length === 0 ? (
        <div className="empty">NO MATCH</div>
      ) : (
        <div className="char-grid">
          {shown.map((c) => {
            const base = mainBase(imgs, c.id)
            const face = !!base && mi.has(base)
            const src = charPortrait(base, mi)
            return (
              <Link
                key={c.id}
                to={`/characters/${c.id}`}
                className="char-card"
                style={{ ['--tint' as string]: tintFor(c.id) }}
                onMouseEnter={() => warmOn(base)}
                onMouseLeave={warmOff}
              >
                <div className={`visual ${face ? 'is-face' : 'is-full'}`}>
                  {src ? (
                    <img src={src} alt={c.name} loading="lazy" />
                  ) : (
                    <span className="fallback">{c.name.slice(0, 1)}</span>
                  )}
                </div>
                <div className="meta">
                  <h3>{c.name}</h3>
                  <div className="row">
                    <span>{c.code}</span>
                    <span className="lines" style={{ color: accentFor(c.id) }}>
                      {c.lines > 0 ? nf(c.lines) : '—'}
                    </span>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
