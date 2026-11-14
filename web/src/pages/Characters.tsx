import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  accentFor, charPortrait, loadCharHd, loadCharImages, loadCharMi,
  loadCharacters, mainBase, nf, tintFor,
  type CharImages, type Character,
} from '../data'

type Filter = 'all' | 'desc' | 'lines' | 'img'

export default function Characters() {
  const [list, setList] = useState<Character[] | null>(null)
  const [imgs, setImgs] = useState<CharImages>({})
  const [hd, setHd] = useState<Set<string>>(new Set())
  const [mi, setMi] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  useEffect(() => {
    loadCharacters().then(setList).catch(() => setList([]))
    loadCharImages().then(setImgs).catch(() => {})
    loadCharHd().then(setHd).catch(() => {})
    loadCharMi().then(setMi).catch(() => {})
  }, [])

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
    if (filter === 'img') out = out.filter((c) => !!mainBase(imgs, c.id))
    return out
  }, [list, imgs, q, filter])

  if (!list) return <div className="loading">LOADING…</div>

  return (
    <div className="wrap">
      <div className="sec-head">
        <div>
          <div className="idx">01 / CHARACTER</div>
          <h2>角色图鉴</h2>
        </div>
        <div className="meta">{nf(list.length)} ENTRIES</div>
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
            const src = charPortrait(base, mi, hd)
            return (
              <Link
                key={c.id}
                to={`/characters/${c.id}`}
                className="char-card"
                style={{ ['--tint' as string]: tintFor(c.id) }}
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
