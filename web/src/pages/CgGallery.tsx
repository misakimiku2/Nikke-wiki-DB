import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  CG_BG_CAT, CG_CATS, catRank, isStoryUnitVisible, loadCgIndex, loadSkillcutCgs, loadSpineModels, loadStoryIndex, nf,
  setLinks, visibleCgs,
  type CgIndex, type CgItem, type StoryUnit,
} from '../data'
import { pickLang, useLang } from '../lang'
import { fmt, useUI, type UIKey } from '../ui'

const CG_CAT_KEY: Record<string, UIKey> = {
  '01_活动剧情CG': 'cg_cat_event',
  '02_主线剧情CG': 'cg_cat_main',
  '03_支线剧情CG': 'cg_cat_sub',
  '04_角色过场': 'cg_cat_chara',
  '05_其他动态CG': 'cg_cat_other',
  '06_剧情背景': 'cg_cat_bg',
  '07_珍藏品CG': 'cg_cat_favorite',
}

const PAGE = 60

type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'readonly'

/** 按剧情分节的一组：uid 为 null 的是「未关联剧情」兜底组（排最后） */
type CgSection = { key: string; head: string; sub: string; items: CgItem[] }

/**
 * CG 图鉴（一级页）：按剧情标题分组的网格 + 筛选。
 * 剧情归属来自 cg_index.json 的 links（u → story_index 的单元标题），
 * 同角色列表按部队分栏一个思路；也可切回平铺视图按原顺序浏览。
 * 点卡片进入二级查看页 /cg/:name（目录、实时模型、时间轴、剧情段落都在那一页），
 * 这里不再放灯箱，也不再引用离线合成的动画 WebP。
 */
export default function CgGallery() {
  const t = useUI()
  const { lang } = useLang()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [data, setData] = useState<CgIndex | null>(null)
  const [units, setUnits] = useState<StoryUnit[]>([])
  /** 分类筛选（多选并集，空集 = 全部）与剧情筛选一起收在筛选面板里 */
  const [catSel, setCatSel] = useState<Set<string>>(new Set())
  const [grouped, setGrouped] = useState(true)
  const [panelOpen, setPanelOpen] = useState(false)
  const [storySel, setStorySel] = useState<Set<number>>(new Set())
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [spine, setSpine] = useState<Set<string>>(new Set())
  /** 大招 cut-in 条目（04_角色过场的 skillcut 家族）：查看器里直播实时模型 */
  const [skillcutCgs, setSkillcutCgs] = useState<Set<string>>(new Set())
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
    loadSkillcutCgs().then(setSkillcutCgs).catch(() => {})
    loadStoryIndex().then(setUnits).catch(() => setUnits([]))

    // 标注模式是给维护者打封面标用的开发期功能：只在 dev 请求保存接口。
    // 生产构建没有 /api/cg-flags（configureServer 不跑），这里不再发无谓的 404，
    // 入口按钮也不会出现。
    if (import.meta.env.DEV) {
      fetch('/api/cg-flags')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('no api'))))
        .then((d: { cover?: string[] }) => {
          if (!Array.isArray(d.cover)) return
          writable.current = true
          applyFlags(new Set(d.cover))
        })
        .catch(() => setSaveState('readonly'))
    }
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

  // 浏览全集：06_剧情背景 是铺在人物/模型下面的场景板（black 黑场、场景图），
  // 不是 CG 插画——默认不混进网格，筛选面板里选「剧情背景」才单独浏览
  const poolCg = useMemo(() => pool.filter((it) => it.c !== CG_BG_CAT), [pool])
  const showBoards = catSel.has(CG_BG_CAT)
  const base = useMemo(
    () => (showBoards ? pool : poolCg),
    [showBoards, pool, poolCg],
  )

  const unitMap = useMemo(() => {
    const m = new Map<number, StoryUnit>()
    for (const u of units) m.set(u.id, u)
    return m
  }, [units])

  // 封面集信息：成员数 + 整集去重后的剧情段落数。
  // 连图集的封面常常不是剧情里出现的那一帧（自身 l 可能为 0），
  // 分组归属与角标按整集统计。
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

  /** CG 名 → 出现过的全部剧情单元（按段落条数降序）：分组与剧情筛选都用它
   *  ——多剧情引用的 CG 在每个引用它的分组都出现，不按「主单元」单选归类。
   *  封面合集按整集并集统计——封面帧自己常常不在剧情里。 */
  const allStory = useMemo(() => {
    const m = new Map<string, number[]>()
    if (!data) return m
    for (const it of pool) {
      const lks = data.merges?.[it.n] ? setLinks(data, it.n) : data.links[it.n] || []
      if (!lks.length) continue
      const cnt = new Map<number, number>()
      const order: number[] = []
      for (const lk of lks) {
        if (!cnt.has(lk.u)) order.push(lk.u)
        cnt.set(lk.u, (cnt.get(lk.u) || 0) + 1)
      }
      m.set(it.n, [...order].sort((a, b) => (cnt.get(b) || 0) - (cnt.get(a) || 0)))
    }
    return m
  }, [data, pool])

  /** 剧情单元标题的本地化（CgView.whereText 同款回退：缺官方名或是 slug 时用 label） */
  const storyTitleOf = useCallback((u: StoryUnit | undefined): string | null => {
    if (!u) return null
    const base = (u.title || '').trim()
    // 只把真正的 snake_case slug（event_stt_xxx）当占位标题；
    // 不能带 i 标志，否则 SNOWFALL 这类全大写官方名会被误判回退成分类名
    if (!base || base === u.bucket || /^[a-z0-9_]+$/.test(base)) return u.label
    return pickLang(lang, base, u.titles?.en, u.titles?.ko, u.titles?.ja)
  }, [lang])

  // 单元展示顺序：剧情分类（主线→活动→个人→…）在前，同分类内按 story_index 原序
  const orderedUnits = useMemo(() => {
    return units.filter(isStoryUnitVisible).sort((a, b) => catRank(a.cat) - catRank(b.cat))
  }, [units])

  /** 剧情筛选候选：站内 CG 实际关联到的单元（带张数，多剧情引用各计一次），按展示顺序排 */
  const storyOpts = useMemo(() => {
    const cnt = new Map<number, number>()
    for (const it of pool) {
      for (const uid of allStory.get(it.n) || []) cnt.set(uid, (cnt.get(uid) || 0) + 1)
    }
    const out: { uid: number; title: string; cat: string; n: number }[] = []
    for (const u of orderedUnits) {
      const n = cnt.get(u.id)
      if (n) out.push({ uid: u.id, title: storyTitleOf(u) || u.label, cat: u.cat, n })
    }
    return out
  }, [pool, allStory, orderedUnits, storyTitleOf])

  const toggleStory = (uid: number) => {
    setStorySel((s) => {
      const n = new Set(s)
      if (n.has(uid)) n.delete(uid)
      else n.add(uid)
      return n
    })
  }

  const toggleCat = (key: string) => {
    setCatSel((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })
  }

  /** 分类面板 chips 的张数（按可见条目统计；「全部」= 默认进网格的插画数） */
  const catCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const it of pool) m[it.c] = (m[it.c] || 0) + 1
    return m
  }, [pool])

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase()
    // 搜「封面 / 主视觉」当标签用，和名称/活动键搜索并存
    const tagHit = k.length >= 2 && '封面主视觉cover'.includes(k)
    return base.filter((it) => {
      if (catSel.size > 0 && !catSel.has(it.c)) return false
      if (storySel.size > 0) {
        // 多剧情引用的 CG：任一被选中的剧情引用它即命中
        const uids = allStory.get(it.n)
        if (!uids?.some((uid) => storySel.has(uid))) return false
      }
      if (k && !(it.n.toLowerCase().includes(k) || it.s.toLowerCase().includes(k)
        || (tagHit && flags.has(it.n)))) return false
      return true
    })
  }, [base, catSel, storySel, q, flags, allStory])

  // 分组视图的分节：主线章节 → 活动 → 个人剧情 → 未关联剧情（兜底组在最后）。
  // 一个 CG 被多个剧情引用时在**每个**引用它的分组都出现（如 OverZone 的 CG
  // 同时属于主线章与活动剧情）；节内沿用原始顺序；单元不在 story_index
  // （异常数据）时也并入兜底组。
  const sections = useMemo<CgSection[]>(() => {
    const byUnit = new Map<number, CgItem[]>()
    const none: CgItem[] = []
    for (const it of filtered) {
      const uids = allStory.get(it.n)
      if (!uids?.length) {
        none.push(it)
        continue
      }
      let placed = false
      for (const uid of uids) {
        const u = unitMap.get(uid)
        if (!u) continue
        placed = true
        const arr = byUnit.get(u.id)
        if (arr) arr.push(it)
        else byUnit.set(u.id, [it])
      }
      if (!placed) none.push(it)
    }
    const out: CgSection[] = []
    for (const u of orderedUnits) {
      const items = byUnit.get(u.id)
      if (!items) continue
      out.push({
        key: `u${u.id}`,
        head: storyTitleOf(u) || u.label,
        sub: t(`cat_${u.cat}` as UIKey),
        items,
      })
    }
    if (none.length) {
      out.push({ key: 'none', head: t('cg_group_none'), sub: '', items: none })
    }
    return out
  }, [filtered, allStory, unitMap, orderedUnits, storyTitleOf, t])

  useEffect(() => {
    if (skipLimitReset.current) {
      skipLimitReset.current = false
      return
    }
    setLimit(PAGE)
  }, [catSel, q, grouped, storySel])

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
          JSON.stringify({ idx, limit, y: window.scrollY, q, catSel: [...catSel], grouped, storySel: [...storySel] }),
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
  // grouped / storySel 是后加的字段，旧记录缺省时按默认值兜底。
  useEffect(() => {
    if (!data) return
    let saved: {
      idx: number; limit: number; y: number; q?: string; catSel?: string[]
      grouped?: boolean; storySel?: number[]
    }
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
    setQ(saved.q || '')
    setCatSel(new Set(saved.catSel || []))
    setGrouped(saved.grouped ?? true)
    setStorySel(new Set(saved.storySel || []))
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
  const enterEdit = () => setEditMode((v) => !v)
  const activeCount = catSel.size + storySel.size
  const anyFilter = activeCount > 0 || !!q.trim()

  const renderCell = (it: CgItem) => {
    const marked = flags.has(it.n)
    // 提示里列出全部出现过的剧情标题（横跨多单元的 CG 用 / 连接）
    const st = (allStory.get(it.n) || [])
      .map((uid) => storyTitleOf(unitMap.get(uid)))
      .filter((x): x is string => !!x)
      .join(' / ') || null
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
        title={editMode
          ? `${it.n}${st ? ` · ${st}` : ''}${fmt(t('cg_pick_hint'), { a: marked ? t('cg_annotate_unmark') : t('cg_annotate_mark'), b: t('cg_badge_cover') })}`
          : `${it.n}${st ? ` · ${st}` : ''} · ${t('cg_open_viewer')}`}
      >
        <img src={`/img/s/${it.h}.webp`} alt={it.n} loading="lazy" />
        {marked && <span className="cg-tag">{t('cg_badge_cover')}</span>}
        {(it.d === 1 || spine.has(it.n) || skillcutCgs.has(it.n)) && (
          <span className="cg-dyn">{t('cg_badge_anim')}</span>
        )}
        {setInfo.get(it.n) && (
          <span className="cg-set">{fmt(t('cg_set_n'), { n: setInfo.get(it.n)!.size + 1 })}</span>
        )}
        {linkCountOf(it) > 0 && <span className="cg-badge">{linkCountOf(it)}</span>}
      </button>
    )
  }

  // 分组模式下按 limit 预算逐节渲染：装不下的节整节不出现，节内截断
  let budget = limit
  const shownSections = sections.map((sec) => {
    const take = Math.min(sec.items.length, budget)
    budget -= take
    return { sec, take }
  }).filter((x) => x.take > 0)

  return (
    <div className="wrap">
      <div className="sec-head">
        <div>
          <div className="idx">03 / GALLERY</div>
          <h2>{t('cg_title')}</h2>
        </div>
        <div className="meta">
          {anyFilter ? `${nf(filtered.length)} / ${nf(base.length)}` : nf(base.length)} IMAGES
        </div>
      </div>

      <div className="toolbar">
        <div className="search-box">
          <input
            className="search"
            placeholder={t('cg_search_ph')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && (
            <button
              type="button"
              className="search-clear"
              onClick={() => setQ('')}
              aria-label={t('common_clear_search')}
              title={t('common_clear')}
            >
              ×
            </button>
          )}
        </div>
        <div className="tool-sort" role="group" aria-label="排序方式">
          <button className={`chip ${grouped ? 'on' : ''}`} onClick={() => setGrouped(true)}>
            {t('cg_sort_story')}
          </button>
          <button className={`chip ${!grouped ? 'on' : ''}`} onClick={() => setGrouped(false)}>
            {t('cg_sort_flat')}
          </button>
        </div>
        <button
          className={`chip tool-filter ${panelOpen ? 'on' : ''} ${activeCount > 0 ? 'has-active' : ''}`}
          onClick={() => setPanelOpen((o) => !o)}
          aria-expanded={panelOpen}
          title={t('filter_btn')}
        >
          {t('filter_btn')}{activeCount > 0 ? ` · ${activeCount}` : ''}
        </button>
        {/* 开发期后台入口：标注模式（封面打标）与图集整理，生产构建不渲染 */}
        {import.meta.env.DEV && writable.current && (
          <>
            <button className={`chip ${editMode ? 'on' : ''}`} onClick={enterEdit}>
              {editMode ? t('cg_annotate_exit') : t('cg_annotate')}
            </button>
            <button className="chip" onClick={() => navigate('/cg/albums')} title="差分 CG 图集整理后台（dev）">
              {t('cg_albums_tools')}
            </button>
          </>
        )}
      </div>

      {panelOpen && (
        <div className="filter-panel">
          <div className="fp-group">
            <div className="fp-title">{t('cg_filter_cat')}</div>
            <div className="fp-chips">
              <button
                className={`chip fp-chip ${catSel.size === 0 ? 'on' : ''}`}
                onClick={() => setCatSel(new Set())}
              >
                {t('cg_all')}
                <span className="fp-cnt">{nf(poolCg.length)}</span>
              </button>
              {CG_CATS.map((c) => (
                <button
                  key={c.key}
                  className={`chip fp-chip ${catSel.has(c.key) ? 'on' : ''}`}
                  onClick={() => toggleCat(c.key)}
                >
                  {t(CG_CAT_KEY[c.key] ?? 'cg_cat_other')}
                  <span className="fp-cnt">{nf(catCounts[c.key] || 0)}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="fp-group">
            <div className="fp-title">{t('cg_filter_story')}</div>
            <div className="fp-scroll">
              {storyOpts.length === 0 && <span className="fp-none">{t('filter_none')}</span>}
              {storyOpts.map((o) => (
                <button
                  key={o.uid}
                  className={`chip fp-chip ${storySel.has(o.uid) ? 'on' : ''}`}
                  onClick={() => toggleStory(o.uid)}
                  title={`${t(`cat_${o.cat}` as UIKey)} · ${o.title}`}
                >
                  {o.title}
                  <span className="fp-cnt">{nf(o.n)}</span>
                </button>
              ))}
            </div>
          </div>
          {activeCount > 0 && (
            <button className="chip fp-clear" onClick={() => { setCatSel(new Set()); setStorySel(new Set()) }}>
              {t('filter_clear')}
            </button>
          )}
        </div>
      )}

      {editMode && (
        <div className="pickbar">
          <b>{t('cg_annotate')}</b>
          <span>{fmt(t('cg_annotate_hint'), { n: nCover, d: coverStats.done, t: coverStats.total })}</span>
          <span className={`pick-save ${saveState}`}>
            {saveState === 'saving' ? t('cg_annotate_saving') : saveState === 'saved' ? t('cg_annotate_done')
              : saveState === 'error' ? t('cg_annotate_fail') : t('cg_annotate_autosave')}
          </span>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="empty">{t('cg_none')}</div>
      ) : grouped ? (
        <>
          {shownSections.map(({ sec, take }) => (
            <section className="squad-sect" key={sec.key}>
              <div className="squad-head">
                <h3 title={sec.head}>{sec.head}</h3>
                <span className="cnt">
                  {sec.sub ? `${sec.sub} · ` : ''}{fmt(t('cg_n_imgs'), { n: nf(sec.items.length) })}
                </span>
              </div>
              <div className="cg-grid">{sec.items.slice(0, take).map(renderCell)}</div>
            </section>
          ))}
          <div ref={sentinel} className="cg-more">
            {limit < filtered.length ? t('common_loading') : fmt(t('cg_count_total'), { n: nf(filtered.length) })}
          </div>
        </>
      ) : (
        <>
          <div className="cg-grid">{filtered.slice(0, limit).map(renderCell)}</div>
          <div ref={sentinel} className="cg-more">
            {limit < filtered.length ? t('common_loading') : fmt(t('cg_count_total'), { n: nf(filtered.length) })}
          </div>
        </>
      )}
    </div>
  )
}
