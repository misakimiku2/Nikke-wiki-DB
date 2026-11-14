import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { loadStoryIndex, nf, type StoryUnit } from '../data'

type Row = [string, number, string, number]

const LIMIT = 200

export default function Search() {
  const [idx, setIdx] = useState<Row[] | null>(null)
  const [units, setUnits] = useState<StoryUnit[]>([])
  const [params] = useSearchParams()
  const initial = params.get('q') || ''
  const [q, setQ] = useState(initial)
  const [debounced, setDebounced] = useState(initial)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    loadStoryIndex().then(setUnits).catch(() => {})
    // 索引 9 MB，进页面才拉
    fetch('/data/search-index.json')
      .then((r) => r.json())
      .then(setIdx)
      .catch(() => setIdx([]))
  }, [])

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setDebounced(q.trim()), 220)
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [q])

  const unitMap = useMemo(() => {
    const m: Record<number, StoryUnit> = {}
    for (const u of units) m[u.id] = u
    return m
  }, [units])

  const results = useMemo(() => {
    if (!idx || debounced.length < 1) return []
    const k = debounced.toLowerCase()
    const out: Row[] = []
    for (let i = 0; i < idx.length; i++) {
      const row = idx[i]
      if (row[0].toLowerCase().includes(k)) {
        out.push(row)
        if (out.length >= LIMIT) break
      }
    }
    return out
  }, [idx, debounced])

  return (
    <div className="wrap">
      <div className="sec-head">
        <div>
          <div className="idx">04 / SEARCH</div>
          <h2>台词搜索</h2>
        </div>
        <div className="meta">
          {idx ? `${nf(idx.length)} LINES INDEXED` : 'LOADING INDEX…'}
        </div>
      </div>

      <div className="search-hero">
        <input
          className="search search-lg"
          autoFocus
          placeholder="搜索任意一句台词，例：指挥官、莱彻、活下去"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {!idx && <div className="search-hint">首次使用需要载入 9 MB 索引，之后会缓存</div>}
        {idx && debounced && (
          <div className="search-hint">
            {results.length >= LIMIT ? `已显示前 ${LIMIT} 条，请输入更精确的关键词` : `找到 ${nf(results.length)} 条`}
          </div>
        )}
      </div>

      {results.length > 0 && (
        <div className="result-list">
          {results.map(([text, uid, speaker, lineIdx], i) => {
            const u = unitMap[uid]
            return (
              <Link key={`${uid}-${lineIdx}-${i}`} to={`/story/${uid}?line=${lineIdx}`} className="result">
                <div className="result-text">
                  <Highlight text={text} keyword={debounced} />
                </div>
                <div className="result-meta">
                  {speaker && <span className="result-spk">{speaker}</span>}
                  <span className="result-where">
                    {u ? `${u.label} · ${u.title}` : `单元 ${uid}`}
                  </span>
                  <span className="result-jump">→</span>
                </div>
              </Link>
            )
          })}
        </div>
      )}

      {idx && debounced && results.length === 0 && (
        <div className="empty">没有找到包含「{debounced}」的台词</div>
      )}
    </div>
  )
}

function Highlight({ text, keyword }: { text: string; keyword: string }) {
  if (!keyword) return <>{text}</>
  const k = keyword.toLowerCase()
  const t = text
  const parts: { s: string; hit: boolean }[] = []
  let from = 0
  let at = t.toLowerCase().indexOf(k, from)
  if (at === -1) return <>{text}</>
  while (at !== -1) {
    if (at > from) parts.push({ s: t.slice(from, at), hit: false })
    parts.push({ s: t.slice(at, at + keyword.length), hit: true })
    from = at + keyword.length
    at = t.toLowerCase().indexOf(k, from)
  }
  if (from < t.length) parts.push({ s: t.slice(from), hit: false })
  return (
    <>
      {parts.map((p, i) => (p.hit ? <mark key={i}>{p.s}</mark> : <span key={i}>{p.s}</span>))}
    </>
  )
}
