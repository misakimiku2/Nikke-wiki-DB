import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  CG_CATS, loadCgIndex, loadSpineModels, nf, type CgIndex,
} from '../data'

const PAGE = 60

type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'readonly'

/**
 * CG 图鉴（一级页）：网格 + 筛选。
 * 点卡片进入二级查看页 /cg/:name（目录、实时模型、时间轴、剧情段落都在那一页），
 * 这里不再放灯箱，也不再引用离线合成的动画 WebP。
 */
export default function CgGallery() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [data, setData] = useState<CgIndex | null>(null)
  const [cat, setCat] = useState<string>('all')
  const [onlyLinked, setOnlyLinked] = useState(false)
  const [onlyCover, setOnlyCover] = useState(false)
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [spine, setSpine] = useState<Set<string>>(new Set())
  const openedFromUrl = useRef(false)
  const sentinel = useRef<HTMLDivElement | null>(null)

  // ---- 人工标注（活动封面 / 主视觉）----
  // dev 下走 /api/cg-flags 直接读写 build/cg_flags.json；静态部署时退回 cg_index.json 的 k 字段。
  const [flags, setFlags] = useState<Set<string>>(new Set())
  const [editMode, setEditMode] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const writable = useRef(false)
  // 连点时 React 还没重渲染，必须用 ref 里的最新集合，否则后一次点击会覆盖前一次
  const flagsRef = useRef<Set<string>>(new Set())
  const saveTimer = useRef<number | undefined>(undefined)

  const applyFlags = useCallback((next: Set<string>) => {
    flagsRef.current = next
    setFlags(next)
  }, [])

  useEffect(() => {
    loadCgIndex()
      .then((d) => {
        setData(d)
        applyFlags(new Set(d.items.filter((x) => x.k === 1).map((x) => x.n)))
      })
      .catch(() => setData({ total: 0, items: [], links: {} }))
    loadSpineModels().then(setSpine).catch(() => {})

    fetch('/api/cg-flags')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('no api'))))
      .then((d: { cover?: string[] }) => {
        if (!Array.isArray(d.cover)) return
        writable.current = true
        applyFlags(new Set(d.cover))
      })
      .catch(() => setSaveState('readonly'))
  }, [applyFlags])

  const flush = useCallback(async () => {
    try {
      const r = await fetch('/api/cg-flags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cover: [...flagsRef.current] }),
      })
      const j = await r.json()
      setSaveState(j.ok ? 'saved' : 'error')
    } catch {
      setSaveState('error')
    }
  }, [])

  const toggleFlag = useCallback((name: string) => {
    const next = new Set(flagsRef.current)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    applyFlags(next)
    if (!writable.current) return
    setSaveState('saving')
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(flush, 350)
  }, [applyFlags, flush])

  // 退出标注模式时刷新一下提示
  useEffect(() => {
    if (!editMode && saveState === 'saved') setSaveState('idle')
  }, [editMode, saveState])

  const filtered = useMemo(() => {
    if (!data) return []
    const k = q.trim().toLowerCase()
    // 搜「封面 / 主视觉」当标签用，和名称/活动键搜索并存
    const tagHit = k.length >= 2 && '封面主视觉cover'.includes(k)
    return data.items.filter((it) => {
      if (cat !== 'all' && it.c !== cat) return false
      if (onlyLinked && it.l === 0) return false
      if (onlyCover && !flags.has(it.n)) return false
      if (k && !(it.n.toLowerCase().includes(k) || it.s.toLowerCase().includes(k)
        || (tagHit && flags.has(it.n)))) return false
      return true
    })
  }, [data, cat, onlyLinked, onlyCover, q, flags])

  useEffect(() => setLimit(PAGE), [cat, onlyLinked, onlyCover, q])

  // ?cg=<hash> 分享链接直接跳到对应的二级查看页
  useEffect(() => {
    if (openedFromUrl.current || !data) return
    const h = params.get('cg')
    if (!h) return
    const it = data.items.find((x) => x.h === h)
    if (it) {
      openedFromUrl.current = true
      navigate(`/cg/${encodeURIComponent(it.n)}`, { replace: true })
    }
  }, [params, data, navigate])

  // 滚到底自动加载更多
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setLimit((n) => Math.min(n + PAGE, filtered.length))
      }
    }, { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [filtered.length])

  // 活动封面覆盖率：按 sub_category 分组，每组只要有一张被标就算覆盖
  const coverStats = useMemo(() => {
    if (!data) return { done: 0, total: 0 }
    const byEvent = new Map<string, boolean>()
    for (const it of data.items) {
      if (it.c !== '01_活动剧情CG' || !it.s) continue
      byEvent.set(it.s, (byEvent.get(it.s) || false) || flags.has(it.n))
    }
    let done = 0
    byEvent.forEach((v) => { if (v) done++ })
    return { done, total: byEvent.size }
  }, [data, flags])

  if (!data) return <div className="loading">LOADING…</div>

  const nCover = flags.size
  const enterEdit = () => {
    setEditMode((v) => !v)
    setOnlyCover(false)
  }

  return (
    <div className="wrap">
      <div className="sec-head">
        <div>
          <div className="idx">03 / GALLERY</div>
          <h2>CG 图鉴</h2>
        </div>
        <div className="meta">{nf(data.total)} IMAGES</div>
      </div>

      <div className="toolbar">
        <input
          className="search"
          placeholder="搜索 CG 名称或活动键"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className={`chip ${cat === 'all' ? 'on' : ''}`} onClick={() => setCat('all')}>
          全部
        </button>
        {CG_CATS.map((c) => (
          <button key={c.key} className={`chip ${cat === c.key ? 'on' : ''}`} onClick={() => setCat(c.key)}>
            {c.label}
          </button>
        ))}
        <button className={`chip ${onlyLinked ? 'on' : ''}`} onClick={() => setOnlyLinked((v) => !v)}>
          有剧情
        </button>
        <button className={`chip ${onlyCover ? 'on' : ''}`} onClick={() => setOnlyCover((v) => !v)}>
          封面 {nCover}
        </button>
        {writable.current && (
          <button className={`chip ${editMode ? 'on' : ''}`} onClick={enterEdit}>
            {editMode ? '退出标注' : '标注模式'}
          </button>
        )}
      </div>

      {editMode && (
        <div className="pickbar">
          <b>标注模式</b>
          <span>点卡片 = 标记／取消「活动封面」；已标 {nCover} 张 · 活动覆盖 {coverStats.done}/{coverStats.total}</span>
          <span className={`pick-save ${saveState}`}>
            {saveState === 'saving' ? '保存中…' : saveState === 'saved' ? '已写入 cg_flags.json'
              : saveState === 'error' ? '保存失败' : '改动自动保存'}
          </span>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="empty">没有匹配的 CG</div>
      ) : (
        <>
          <div className="cg-grid">
            {filtered.slice(0, limit).map((it) => {
              const marked = flags.has(it.n)
              return (
                <button
                  key={it.h}
                  className={`cg-cell ${editMode ? 'pick' : ''} ${marked ? 'marked' : ''}`}
                  onClick={() => (editMode
                    ? toggleFlag(it.n)
                    : navigate(`/cg/${encodeURIComponent(it.n)}`))}
                  title={editMode ? `${it.n}（点击${marked ? '取消' : '标为'}封面）` : `${it.n} · 打开查看器`}
                >
                  <img src={`/img/s/${it.h}.webp`} alt={it.n} loading="lazy" />
                  {marked && <span className="cg-tag">封面</span>}
                  {(it.d === 1 || spine.has(it.n)) && <span className="cg-dyn">动</span>}
                  {it.l > 0 && <span className="cg-badge">{it.l}</span>}
                </button>
              )
            })}
          </div>
          <div ref={sentinel} className="cg-more">
            {limit < filtered.length ? '加载中…' : `— 共 ${nf(filtered.length)} 张 —`}
          </div>
        </>
      )}
    </div>
  )
}
