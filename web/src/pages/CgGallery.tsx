import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  CG_CATS, loadCgIndex, loadSpineModels, nf, setLinks, visibleCgs, type CgIndex,
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

  // 合并收录后的可见条目：X_bg / 图集贴图页 / 动态背景帧不再单独出卡
  const pool = useMemo(() => (data ? visibleCgs(data.items, data.merges) : []), [data])

  // 封面集信息：成员数 + 整集去重后的剧情段落数。
  // 连图集的封面常常不是剧情里出现的那一帧（自身 l 可能为 0），
  // 「有剧情」筛选与角标按整集统计。
  const setInfo = useMemo(() => {
    const m = new Map<string, { size: number; links: number }>()
    if (!data) return m
    for (const [cover, list] of Object.entries(data.merges || {})) {
      if (!Array.isArray(list) || list.length === 0) continue
      m.set(cover, { size: list.length, links: setLinks(data, cover).length })
    }
    return m
  }, [data])

  const linkCountOf = useCallback(
    (it: { n: string; l: number }) => setInfo.get(it.n)?.links ?? it.l,
    [setInfo],
  )

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase()
    // 搜「封面 / 主视觉」当标签用，和名称/活动键搜索并存
    const tagHit = k.length >= 2 && '封面主视觉cover'.includes(k)
    return pool.filter((it) => {
      if (cat !== 'all' && it.c !== cat) return false
      if (onlyLinked && linkCountOf(it) === 0) return false
      if (onlyCover && !flags.has(it.n)) return false
      if (k && !(it.n.toLowerCase().includes(k) || it.s.toLowerCase().includes(k)
        || (tagHit && flags.has(it.n)))) return false
      return true
    })
  }, [pool, cat, onlyLinked, onlyCover, q, flags, linkCountOf])

  useEffect(() => {
    if (skipLimitReset.current) {
      skipLimitReset.current = false
      return
    }
    setLimit(PAGE)
  }, [cat, onlyLinked, onlyCover, q])

  // ---- 返回恢复 ----
  // 无限加载的渲染条数（limit）决定页面高度；点进查看器再返回时组件重挂载、
  // limit 回到初值，页面高度骤减，浏览器的滚动位置恢复对不上就被钳回顶部。
  // 离开页面时把渲染进度 / 滚动位置 / 筛选状态存进 sessionStorage（按 history
  // idx 键控），返回（或刷新）时 idx 一致才恢复，其余情况按全新访问处理。
  const histIdx = () => {
    const st = window.history.state as { idx?: number } | null
    return typeof st?.idx === 'number' ? st.idx : null
  }
  // 卸载时 history.state 已经是新页面（查看器）的 idx，必须在挂载期间记下自己的
  const idxRef = useRef<number | null>(histIdx())
  const saveRef = useRef<() => void>(() => {})
  useEffect(() => {
    idxRef.current = histIdx()
  })
  const skipLimitReset = useRef(false)

  // 挂载期间接管浏览器滚动恢复：popstate 时浏览器的延迟恢复会跟我们自己的
  // scrollTo 打架（它按旧高度钳制后把位置改掉），这里改成手动管理。
  useEffect(() => {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual'
    return () => {
      if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'auto'
    }
  }, [])

  useEffect(() => {
    const save = () => {
      const idx = idxRef.current
      if (idx == null) return
      try {
        sessionStorage.setItem(
          'cg-gallery-restore',
          JSON.stringify({ idx, limit, y: window.scrollY, q, cat, onlyLinked, onlyCover }),
        )
      } catch {
        /* ignore */
      }
    }
    // 每次渲染刷新保存函数（闭包里带最新状态）；pagehide 用 ref 调最新的
    saveRef.current = save
  })
  useEffect(() => {
    const onPageHide = () => saveRef.current()
    window.addEventListener('pagehide', onPageHide)
    return () => window.removeEventListener('pagehide', onPageHide)
  }, [])

  // 恢复：数据就绪后执行一次；筛选状态先还原（并跳过它们触发的 limit 重置），
  // 下一帧再恢复滚动位置——此时网格已按恢复后的条数渲染，高度对得上。
  useEffect(() => {
    if (!data) return
    let saved: { idx: number; limit: number; y: number; q: string; cat: string; onlyLinked: boolean; onlyCover: boolean }
    try {
      const raw = sessionStorage.getItem('cg-gallery-restore')
      if (!raw) return
      saved = JSON.parse(raw)
      sessionStorage.removeItem('cg-gallery-restore')
    } catch {
      return
    }
    if (saved.idx !== histIdx()) return
    skipLimitReset.current = true
    setQ(saved.q)
    setCat(saved.cat)
    setOnlyLinked(saved.onlyLinked)
    setOnlyCover(saved.onlyCover)
    setLimit(saved.limit)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => window.scrollTo(0, saved.y))
    })
  }, [data])

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
        <div className="meta">{nf(pool.length)} IMAGES</div>
      </div>

      <div className="toolbar">
        <div className="search-box">
          <input
            className="search"
            placeholder="搜索 CG 名称或活动键"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && (
            <button
              type="button"
              className="search-clear"
              onClick={() => setQ('')}
              aria-label="清空搜索"
              title="清空"
            >
              ×
            </button>
          )}
        </div>
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
                onClick={() => {
                  if (editMode) {
                    toggleFlag(it.n)
                    return
                  }
                  saveRef.current() // 进查看器前先存渲染进度与滚动位置
                  navigate(`/cg/${encodeURIComponent(it.n)}`)
                }}
                  title={editMode ? `${it.n}（点击${marked ? '取消' : '标为'}封面）` : `${it.n} · 打开查看器`}
                >
                  <img src={`/img/s/${it.h}.webp`} alt={it.n} loading="lazy" />
                  {marked && <span className="cg-tag">封面</span>}
                  {(it.d === 1 || spine.has(it.n)) && <span className="cg-dyn">动</span>}
                  {setInfo.get(it.n) && (
                    <span className="cg-set">集 {setInfo.get(it.n)!.size + 1}</span>
                  )}
                  {linkCountOf(it) > 0 && <span className="cg-badge">{linkCountOf(it)}</span>}
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
