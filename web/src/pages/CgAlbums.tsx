import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  CG_BG_CAT, CG_CATS, loadCgIndex, nf, visibleCgs,
  type CgIndex, type CgItem,
} from '../data'

const PAGE = 60

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/**
 * 图集整理（开发期后台；路由只在 dev 注册，生产构建没有这个页面）。
 *
 * 把同一场景的差分 CG 视觉化归组，替代以前「手动整理表格 → 发给会话改
 * cg_merges.json」的流程：
 *   - 下方 CG 池里点选若干张 →「新建图集」（封面默认取剧情关联最多的一张）
 *   - 「加入图集…」把选中的图并进已有图集（成员会从旧图集移出）
 *   - 图集卡片：成员 × 移除、「设为封面」换主图、「解散」整组拆回独立条目
 *   - 保存 = 全量写回 build/cg_merges.json（dev 中间件 /api/cg-merges），
 *     写完整页刷新，图鉴与查看器立即按新分组展示；gen_cg_merges.mjs 重跑
 *     会保留这些人工条目。自动规则组（图集贴图页等）只读展示、不可改动。
 *
 * 文案没有走四语词典：这是维护者自用的后台，不是面向访客的页面。
 */
export default function CgAlbums() {
  const navigate = useNavigate()
  const [data, setData] = useState<CgIndex | null>(null)
  /** 本地编辑态：{ 封面: [成员...] }，保存时整体落盘 */
  const [groups, setGroups] = useState<Record<string, string[]>>({})
  /** 自动规则组（gen 脚本会还原的那种）：只读 */
  const [auto, setAuto] = useState<Set<string>>(new Set())
  const [apiOk, setApiOk] = useState(false)
  /** 落盘时的快照（JSON 串），与本地不一致 = 有未保存改动 */
  const loadedRef = useRef<string | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [catSel, setCatSel] = useState<Set<string>>(new Set())
  const [diffsOnly, setDiffsOnly] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const [chooser, setChooser] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)
  const sentinel = useRef<HTMLDivElement | null>(null)

  const showToast = useCallback((text: string, bad = false) => {
    setToast({ text, bad })
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), bad ? 5600 : 3400)
  }, [])

  useEffect(() => {
    loadCgIndex().then(setData).catch(() => setData({ total: 0, items: [], links: {} }))
    fetch('/api/cg-merges')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('no api'))))
      .then((m: { groups?: Record<string, string[]>; auto?: string[] }) => {
        const g = m.groups || {}
        setGroups(g)
        loadedRef.current = JSON.stringify(g)
        setAuto(new Set(m.auto || []))
        setApiOk(true)
      })
      .catch(() => setApiOk(false))
  }, [])

  const byName = useMemo(() => {
    const m = new Map<string, CgItem>()
    if (data) for (const it of data.items) m.set(it.n, it)
    return m
  }, [data])

  // CG 池 = 合并后的可见条目（成员已并入封面、X_bg 自动配对都消失），
  // 剧情背景板不参与差分整理，整个排除。用本地 groups 而不是 data.merges，
  // 保存后无需等刷新就能按最新分组渲染。
  const pool = useMemo(
    () => (data ? visibleCgs(data.items, groups).filter((it) => it.c !== CG_BG_CAT) : []),
    [data, groups],
  )

  const albumList = useMemo(() => Object.entries(groups).sort(([a], [b]) => (a < b ? -1 : 1)), [groups])
  const nGrouped = useMemo(
    () => albumList.reduce((a, [, list]) => a + list.length + 1, 0),
    [albumList],
  )

  /**
   * 疑似差分：去掉最后一段编号后同名的未整理条目（Chap_32_06_01/02/03 →
   * 同属 Chap_32_06 族）。族太大（>4）一般是同章不同场景，不算差分。
   */
  const suspect = useMemo(() => {
    const byStem = new Map<string, string[]>()
    for (const it of pool) {
      const stem = it.n.replace(/_\d+$/, '')
      const arr = byStem.get(stem)
      if (arr) arr.push(it.n)
      else byStem.set(stem, [it.n])
    }
    const hit = new Set<string>()
    for (const list of byStem.values()) {
      if (list.length >= 2 && list.length <= 4) for (const n of list) hit.add(n)
    }
    return hit
  }, [pool])

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase()
    return pool.filter((it) => {
      if (catSel.size > 0 && !catSel.has(it.c)) return false
      if (diffsOnly && !suspect.has(it.n)) return false
      if (k && !(it.n.toLowerCase().includes(k) || it.s.toLowerCase().includes(k))) return false
      return true
    })
  }, [pool, catSel, diffsOnly, q, suspect])

  const dirty = apiOk && loadedRef.current != null && JSON.stringify(groups) !== loadedRef.current

  // ---- 选中集与图集操作（都只改本地 groups，保存才落盘）----

  const selNames = useMemo(() => pool.filter((it) => sel.has(it.n)).map((it) => it.n), [pool, sel])

  const toggleSel = (n: string) => {
    if (!apiOk) return
    setSel((s) => {
      const x = new Set(s)
      if (x.has(n)) x.delete(n)
      else x.add(n)
      return x
    })
  }

  /** 选中集里有别人家的封面时无法整理（图集的键就是封面名） */
  const coverConflict = () => {
    const hit = selNames.find((n) => groups[n])
    if (hit) showToast(`「${hit}」已是另一个图集的封面，先解散那个图集或把它从选择里去掉`, true)
    return !!hit
  }

  const createFromSel = () => {
    if (selNames.length < 2 || coverConflict()) return
    // 封面默认取剧情关联最多的一张（与现有数据约定一致：封面=剧情里出现的那帧）
    let cover = selNames[0]
    for (const n of selNames) {
      if ((byName.get(n)?.l || 0) > (byName.get(cover)?.l || 0)) cover = n
    }
    const members = selNames.filter((n) => n !== cover)
    setGroups((g) => ({ ...g, [cover]: members }))
    setSel(new Set())
    setSaveState('idle')
    showToast(`已建图集「${cover}」（共 ${members.length + 1} 张）；封面可在卡片上「设为封面」更换`)
  }

  const addTo = (cover: string) => {
    if (auto.has(cover)) return
    const moving = selNames.filter((n) => n !== cover)
    if (!moving.length || coverConflict()) return
    const from = new Set<string>()
    for (const [k, list] of Object.entries(groups)) {
      if (k !== cover && moving.some((n) => list.includes(n))) from.add(k)
    }
    setGroups((g) => {
      const next: Record<string, string[]> = {}
      for (const [k, list] of Object.entries(g)) {
        if (k === cover) {
          next[k] = [...list, ...moving.filter((n) => !list.includes(n))]
        } else {
          const rest = list.filter((n) => !moving.includes(n))
          if (rest.length) next[k] = rest   // 成员被移空的旧图集自动解散
        }
      }
      return next
    })
    setSel(new Set())
    setSaveState('idle')
    showToast(`已把 ${moving.length} 张并入「${cover}」${from.size ? `（同时从 ${[...from].join('、')} 移出）` : ''}`)
  }

  const removeFrom = (cover: string, name: string) => {
    if (auto.has(cover)) return
    setGroups((g) => {
      const next = { ...g }
      const rest = (g[cover] || []).filter((m) => m !== name)
      if (rest.length) next[cover] = rest
      else delete next[cover]   // 最后一个成员移除 → 整组解散
      return next
    })
    setSaveState('idle')
  }

  /** 设为封面：原封面降为成员并排在最前 */
  const promote = (cover: string, name: string) => {
    if (auto.has(cover)) return
    setGroups((g) => {
      const next = { ...g }
      next[name] = [cover, ...(g[cover] || []).filter((m) => m !== name)]
      delete next[cover]
      return next
    })
    setSaveState('idle')
  }

  const disband = (cover: string) => {
    if (auto.has(cover)) return
    const size = (groups[cover]?.length || 0) + 1
    if (!window.confirm(`解散图集「${cover}」？${size} 张 CG 将恢复为独立条目（保存前可反悔）。`)) return
    setGroups((g) => {
      const next = { ...g }
      delete next[cover]
      return next
    })
    setSaveState('idle')
  }

  const save = useCallback(async () => {
    if (!dirty || saveState === 'saving') return
    setSaveState('saving')
    try {
      const r = await fetch('/api/cg-merges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups }),
      })
      const j: { ok?: boolean; groups?: Record<string, string[]>; error?: string } = await r.json()
      if (!j.ok) throw new Error(j.error || 'save failed')
      const g = j.groups || groups
      loadedRef.current = JSON.stringify(g)
      setGroups(g)
      setSaveState('saved')
      showToast('已写入 build/cg_merges.json，马上刷新页面载入新分组…')
      // watcher 的 full-reload 通常先到，这里兜底
      window.setTimeout(() => window.location.reload(), 1500)
    } catch {
      setSaveState('error')
      showToast('保存失败：build/cg_merges.json 未写入，请看 dev server 输出', true)
    }
  }, [dirty, groups, saveState, showToast])

  // Ctrl/Cmd+S 保存
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save])

  // 有未保存改动时拦一下意外关闭/刷新
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  // ---- 返回/刷新恢复：只恢复筛选与滚动位置（选择与改动不恢复，保存即刷新清空） ----
  const histIdx = () => {
    const st = window.history.state as { idx?: number } | null
    return typeof st?.idx === 'number' ? st.idx : null
  }
  const idxRef = useRef<number | null>(histIdx())
  const saveRef = useRef<() => void>(() => {})
  useEffect(() => {
    idxRef.current = histIdx()
  })
  const skipLimitReset = useRef(false)
  useEffect(() => {
    saveRef.current = () => {
      const idx = idxRef.current
      if (idx == null) return
      try {
        sessionStorage.setItem(
          'cg-albums-restore',
          JSON.stringify({ idx, y: window.scrollY, q, catSel: [...catSel], diffsOnly }),
        )
      } catch {
        /* ignore */
      }
    }
  })
  useEffect(() => {
    const h = () => saveRef.current()
    window.addEventListener('pagehide', h)
    return () => window.removeEventListener('pagehide', h)
  }, [])
  useEffect(() => {
    if (skipLimitReset.current) {
      skipLimitReset.current = false
      return
    }
    setLimit(PAGE)
  }, [catSel, q, diffsOnly])

  useEffect(() => {
    if (!data) return
    let saved: { idx: number; y: number; q?: string; catSel?: string[]; diffsOnly?: boolean }
    try {
      const raw = sessionStorage.getItem('cg-albums-restore')
      if (!raw) return
      saved = JSON.parse(raw)
      sessionStorage.removeItem('cg-albums-restore')
    } catch {
      return
    }
    if (saved.idx !== histIdx()) return
    skipLimitReset.current = true
    setQ(saved.q || '')
    setCatSel(new Set(saved.catSel || []))
    setDiffsOnly(!!saved.diffsOnly)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => window.scrollTo(0, saved.y))
    })
  }, [data])

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

  if (!data) return <div className="loading">LOADING…</div>

  const editable = apiOk
  const activeCount = catSel.size + (diffsOnly ? 1 : 0)
  const joinable = albumList.filter(([c]) => !auto.has(c))

  const renderCell = (it: CgItem) => {
    const selected = sel.has(it.n)
    const setSize = groups[it.n]?.length
    return (
      <button
        key={it.h}
        className={`cg-cell ${selected ? 'sel' : ''}`}
        title={editable
          ? `${it.n} · 点击选择／取消；Ctrl+点击打开查看器`
          : it.n}
        onClick={(e) => {
          if (!editable) return
          if (e.ctrlKey || e.metaKey) {
            navigate(`/cg/${encodeURIComponent(it.n)}`)
            return
          }
          toggleSel(it.n)
        }}
      >
        <img src={`/img/s/${it.h}.webp`} alt={it.n} loading="lazy" />
        {selected && <span className="alb-sel-tag">已选</span>}
        {setSize != null && <span className="cg-set">集 {setSize + 1}</span>}
        {it.l > 0 && <span className="cg-badge">{it.l}</span>}
      </button>
    )
  }

  return (
    <div className="wrap">
      <div className="sec-head">
        <div>
          <div className="idx">DEV / ALBUMS</div>
          <h2>图集整理</h2>
        </div>
        <div className="meta">{nf(albumList.length)} 组 · {nf(nGrouped)} 张已并入</div>
      </div>

      {!apiOk && (
        <div className="empty">
          这个页面是开发期后台：需要 dev server 提供的保存接口（/api/cg-merges）。
          请用 <b>npm run dev</b> 打开站点再访问。
        </div>
      )}
      {apiOk && (
        <p className="alb-intro">
          差分 CG 整理：在下方 CG 池点选同一场景的几张图 →「新建图集」；
          已整理的图集在上方列表里维护（× 移除成员、「设为封面」换主图、「解散」拆组）。
          保存写入 build/cg_merges.json 并刷新页面；生成器重跑不会丢人工条目。
        </p>
      )}

      <div className="toolbar">
        <div className="search-box">
          <input
            className="search"
            placeholder="搜索 CG 名称或活动键"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && (
            <button type="button" className="search-clear" onClick={() => setQ('')} title="清空">×</button>
          )}
        </div>
        <button
          className={`chip ${diffsOnly ? 'on' : ''}`}
          onClick={() => setDiffsOnly((v) => !v)}
          title="只显示去掉末尾编号后同名的未整理条目（差分候选）"
        >
          疑似差分{suspect.size ? ` · ${suspect.size}` : ''}
        </button>
        <span className="alb-toolbar-right">
          {dirty && saveState !== 'saving' && <span className="alb-dirty">有未保存改动</span>}
          {saveState === 'saved' && <span className="pick-save saved">已写入，刷新中…</span>}
          {saveState === 'error' && <span className="pick-save error">保存失败</span>}
          <button className="chip alb-save" disabled={!dirty || saveState === 'saving'} onClick={save}>
            保存{dirty ? ' ·' : ''}
          </button>
        </span>
      </div>

      {apiOk && (
        <div className="alb-cats">
          <button className={`chip fp-chip ${catSel.size === 0 ? 'on' : ''}`} onClick={() => setCatSel(new Set())}>
            全部
          </button>
          {CG_CATS.filter((c) => c.key !== CG_BG_CAT).map((c) => (
            <button
              key={c.key}
              className={`chip fp-chip ${catSel.has(c.key) ? 'on' : ''}`}
              onClick={() => setCatSel((s) => {
                const n = new Set(s)
                if (n.has(c.key)) n.delete(c.key)
                else n.add(c.key)
                return n
              })}
            >
              {c.label}
            </button>
          ))}
          {activeCount > 0 && (
            <button className="chip fp-chip fp-clear" onClick={() => { setCatSel(new Set()); setDiffsOnly(false) }}>
              清除筛选
            </button>
          )}
        </div>
      )}

      {apiOk && (
        <section className="alb-sect">
          <div className="squad-head">
            <h3>已整理图集</h3>
            <span className="cnt">{nf(albumList.length)} 组 · 其中自动规则 {auto.size} 组（只读）</span>
          </div>
          {albumList.length === 0 ? (
            <div className="empty">还没有图集。在下方 CG 池点选 2 张以上，点「新建图集」归组。</div>
          ) : (
            <div className="alb-list">
              {albumList.map(([cover, members]) => {
                const isAuto = auto.has(cover)
                const cov = byName.get(cover)
                return (
                  <div key={cover} className={`alb-card ${isAuto ? 'is-auto' : ''}`}>
                    <div className="alb-cover">
                      {cov
                        ? <img src={`/img/s/${cov.h}.webp`} alt={cover} loading="lazy" />
                        : <span className="alb-thumb-none">不在图鉴</span>}
                      <span className="alb-cover-tag">{isAuto ? '自动' : '封面'}</span>
                    </div>
                    <div className="alb-body">
                      <div className="alb-title-row">
                        <Link className="alb-name" to={`/cg/${encodeURIComponent(cover)}`} title="在查看器里打开">{cover}</Link>
                        <span className="alb-size">{members.length + 1} 张</span>
                        {!isAuto && (
                          <button className="alb-btn danger" onClick={() => disband(cover)}>解散</button>
                        )}
                      </div>
                      <div className="alb-thumbs">
                        {members.map((n) => {
                          const it = byName.get(n)
                          return (
                            <div key={n} className={`alb-thumb ${it ? '' : 'missing'}`} title={n}>
                              {it
                                ? <img src={`/img/s/${it.h}.webp`} alt={n} loading="lazy" />
                                : <span className="alb-thumb-none">不在图鉴</span>}
                              {!isAuto && (
                                <>
                                  <button
                                    className="alb-x"
                                    onClick={() => removeFrom(cover, n)}
                                    title="从图集移除"
                                  >×</button>
                                  <button
                                    className="alb-promote"
                                    onClick={() => promote(cover, n)}
                                    title="把这张设为图集封面（原封面降为成员）"
                                  >设为封面</button>
                                </>
                              )}
                              <span className="alb-thumb-name">{n}</span>
                            </div>
                          )
                        })}
                      </div>
                      {isAuto && (
                        <div className="alb-auto-note">
                          生成器自动规则（模型图集贴图页），重跑 gen_cg_merges.mjs 会还原，只能看不能改。
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      )}

      <section className="alb-sect">
        <div className="squad-head">
          <h3>CG 池</h3>
          <span className="cnt">
            {nf(filtered.length)} / {nf(pool.length)} 张可整理 · 点击选择，Ctrl+点击打开查看器
          </span>
        </div>
        {filtered.length === 0 ? (
          <div className="empty">没有匹配的 CG</div>
        ) : (
          <div className="cg-grid">{filtered.slice(0, limit).map(renderCell)}</div>
        )}
        <div ref={sentinel} className="cg-more">
          {limit < filtered.length ? '加载中…' : `共 ${nf(filtered.length)} 张`}
        </div>
      </section>

      {editable && sel.size > 0 && (
        <div className="pickbar alb-pickbar">
          <b>已选 {sel.size} 张</b>
          <button className="alb-act primary" onClick={createFromSel} disabled={sel.size < 2}
            title={sel.size < 2 ? '至少选 2 张才能成组' : '把选中的图归成一个新图集'}>
            新建图集
          </button>
          <button
            className="alb-act"
            onClick={() => setChooser(true)}
            disabled={joinable.length === 0}
            title="把选中的图并进已有图集"
          >
            加入图集…
          </button>
          <button className="alb-act ghost" onClick={() => setSel(new Set())}>清除选择</button>
        </div>
      )}

      {chooser && (
        <div className="alb-modal" onClick={() => setChooser(false)}>
          <div className="alb-modal-in" onClick={(e) => e.stopPropagation()}>
            <div className="alb-modal-head">把选中的 {sel.size} 张加入图集（已在其它图集的会一并移入）</div>
            <div className="alb-modal-list">
              {joinable.map(([cover, members]) => {
                const cov = byName.get(cover)
                return (
                  <button key={cover} className="alb-modal-row" onClick={() => { addTo(cover); setChooser(false) }}>
                    {cov && <img src={`/img/s/${cov.h}.webp`} alt="" loading="lazy" />}
                    <span className="alb-modal-name">{cover}</span>
                    <span className="alb-modal-cnt">{members.length + 1} 张</span>
                  </button>
                )
              })}
              {joinable.length === 0 && <div className="empty">还没有可加入的图集，先「新建图集」。</div>}
            </div>
            <div className="alb-modal-foot">
              <button className="alb-btn" onClick={() => setChooser(false)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`alb-toast ${toast.bad ? 'bad' : ''}`}>{toast.text}</div>}
    </div>
  )
}
