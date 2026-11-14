import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { loadStoryIndex, nf, type StoryUnit } from '../data'

export default function Story() {
  const [units, setUnits] = useState<StoryUnit[] | null>(null)
  const [cat, setCat] = useState<string>('main')
  const [q, setQ] = useState('')

  useEffect(() => {
    loadStoryIndex().then(setUnits).catch(() => setUnits([]))
  }, [])

  const cats = useMemo(() => {
    if (!units) return []
    const seen: { cat: string; label: string; n: number; lines: number }[] = []
    for (const u of units) {
      const hit = seen.find((s) => s.cat === u.cat)
      if (hit) {
        hit.n += 1
        hit.lines += u.lines
      } else {
        seen.push({ cat: u.cat, label: u.label, n: 1, lines: u.lines })
      }
    }
    return seen
  }, [units])

  const shown = useMemo(() => {
    if (!units) return []
    const k = q.trim()
    let out = units
    if (k) out = out.filter((u) => u.title.includes(k) || u.bucket.includes(k))
    else out = out.filter((u) => u.cat === cat)
    return out
  }, [units, cat, q])

  if (!units) return <div className="loading">LOADING…</div>

  return (
    <div className="wrap">
      <div className="sec-head">
        <div>
          <div className="idx">02 / STORY</div>
          <h2>剧情全文</h2>
        </div>
        <div className="meta">{nf(units.length)} EPISODES · {nf(units.reduce((a, b) => a + b.lines, 0))} LINES</div>
      </div>

      <div className="toolbar">
        <input
          className="search"
          placeholder="搜索剧情标题，例：坠落、RED ASH"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {!q && (
        <div className="cat-row">
          {cats.map((c) => (
            <button
              key={c.cat}
              className={`chip ${cat === c.cat ? 'on' : ''}`}
              onClick={() => setCat(c.cat)}
            >
              {c.label} · {c.n}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <div className="empty">没有匹配的剧情</div>
      ) : (
        <div className="story-grid">
          {shown.map((u) => (
            <Link key={u.id} to={`/story/${u.id}`} className="story-card">
              <div className="story-no">
                {u.chapter !== null && u.chapter !== undefined ? String(u.chapter).padStart(2, '0') : u.label.slice(0, 2)}
              </div>
              <div className="story-body">
                <h3>{u.title}</h3>
                <div className="story-meta">
                  <span>{nf(u.lines)} 句</span>
                  <span>{u.segments} 段</span>
                  {u.source === 'locale_fill' && <span className="tag">补全</span>}
                </div>
              </div>
              <span className="story-arrow">→</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
