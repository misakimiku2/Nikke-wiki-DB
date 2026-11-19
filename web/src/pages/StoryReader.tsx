import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  accentFor, loadCharacters, loadStoryIndex, loadStorySms, loadStoryUnit, nf,
  type Character, type StoryCgRef, type StoryDetail, type StorySmsData, type StorySmsGroup, type StoryUnit,
} from '../data'
import SpinePlayer from '../components/SpinePlayer'
import StorySmsInline from '../components/StorySmsInline'
import EventHero, { eventHeroSlug } from '../components/EventHero'
import { usePageTitle } from '../usePageTitle'

type Frame = {
  fg: string | null
  /** 有实时模型的 CG 名；阅读背景直接播模型，不再用离线合成动图 */
  fgSpine: string | null
  bg: string | null
  /** 点击背景时打开二级查看页所用的 CG 名 */
  n: string | null
}

/** 这些分类按「章节列表 → 单章正文」阅读；主线保持整章一页。 */
const CHAPTER_CATS = new Set(['event', 'nikke', 'gaiden', 'sub', 'side_story'])

/** 解析一组 CG → 前景帧 + 配对背景层（游戏中动态 CG = bg 层 + Spine 前景层） */
function resolveCg(list: StoryCgRef[]): Frame {
  if (!list.length) return { fg: null, fgSpine: null, bg: null, n: null }
  const fgItem = list.find((x) => !x.n.endsWith('_bg'))
  if (fgItem) {
    const base = fgItem.n.replace(/_bg$/, '')
    const pair = list.find((x) => x.n === base + '_bg')
    return {
      fg: fgItem.h,
      fgSpine: fgItem.d || null,
      bg: pair ? pair.h : null,
      n: fgItem.n,
    }
  }
  return { fg: null, fgSpine: null, bg: list[0].h, n: list[0].n }
}

/**
 * 阅读 CG 背景：桌面在右侧大区域，移动端（≤980px）铺满整个阅读区。
 * 透明度完全由滚动进度驱动（无定时动画）——滚轮往下滚渐显、往回滚渐隐。
 * bg 层 + 前景层双层合成；动态 CG 的前景层在静态合成图加载后换成实时 Spine 模型。
 * 点击背景跳到 CG 二级查看页。
 *
 * 显示区间按「行」切分：段落在第 N 行切到某张 CG 时，这张图从该行一直显示到
 * 下一次切换（或本段结束），而不是整段都顶着一张图。
 *
 * 容器不透明度 = JS 写入的滚动进度 --cov × CSS 上限 --rb-max：
 * 移动端背景铺在正文后面，上限压得更低保证可读性（数值见 index.css）。
 */
function StoryCgBg({
  frames,
  onOpen,
  btnGate,
}: {
  frames: Frame[]
  onOpen: (name: string) => void
  /** 额外显示门槛（移动端 HUD 收起时为 false），paint 每帧读 ref */
  btnGate?: React.MutableRefObject<boolean>
}) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const fgSlots = [useRef<HTMLImageElement>(null), useRef<HTMLImageElement>(null)]
  const bgSlots = [useRef<HTMLImageElement>(null), useRef<HTMLImageElement>(null)]
  const fgActive = useRef(0)
  const bgActive = useRef(0)
  const curFg = useRef<string | null>(null)
  const curBg = useRef<string | null>(null)
  const spansRef = useRef<{ top: number; bottom: number; run: number }[]>([])
  const raf = useRef(0)
  const paintRef = useRef<() => void>(() => {})
  const framesRef = useRef(frames)
  framesRef.current = frames

  // 实时模型：只在当前可见区间是动态 CG 时挂载，滚走就卸载，避免后台空转
  const [spineName, setSpineName] = useState<string | null>(null)
  const [spineKey, setSpineKey] = useState(0)
  const curSpine = useRef<string | null>(null)
  const spineReady = useRef(false)
  const spineLayerRef = useRef<HTMLDivElement>(null)
  /** 所有画面层合成完之后，由这个容器统一施加不透明度 */
  const layersRef = useRef<HTMLDivElement>(null)

  const onModelReady = () => {
    spineReady.current = true
    paintRef.current()
  }

  // 缓存每一段 CG 的行区间（文档坐标）
  const measure = () => {
    const sy = window.scrollY
    const spans: { top: number; bottom: number; run: number }[] = []
    document.querySelectorAll<HTMLElement>('.seg[data-g]').forEach((el) => {
      const anchors = Array.from(el.querySelectorAll<HTMLElement>('[data-run]'))
      if (!anchors.length) return
      const segBottom = el.getBoundingClientRect().bottom + sy
      anchors.forEach((a, i) => {
        const top = a.getBoundingClientRect().top + sy
        const bottom =
          i + 1 < anchors.length ? anchors[i + 1].getBoundingClientRect().top + sy : segBottom
        spans.push({ top, bottom, run: Number(a.dataset.run) })
      })
    })
    spans.sort((a, b) => a.top - b.top)
    spansRef.current = spans
  }

  useEffect(() => {
    // 等字体/布局稳定后测量并立即重绘（mount 时 paint 跑在 measure 前，行坐标还没缓存）
    const remeasure = () => { measure(); paint() }
    const t1 = window.setTimeout(remeasure, 60)
    const t2 = window.setTimeout(remeasure, 400)

    const FADE = 0.55 // 渐变区占视口高度的比例
    // 两层（背景图 + 人物切片）各自必须保持不透明，否则会「透过人物看到背景」。
    // 整体淡入淡出只施加在合成后的容器上；不透明度上限 --rb-max 按断点/主题在 CSS 里定，
    // JS 只负责写入 0~1 的滚动进度（--cov），移动端正文压在图上，上限比桌面低得多。

    // 双槽交叉换图：写入非活动槽，返回新活动槽下标
    const swap = (slots: typeof fgSlots, active: React.MutableRefObject<number>, hash: string) => {
      const nextIdx = 1 - active.current
      const img = slots[nextIdx].current
      if (!img) return active.current
      img.style.opacity = '0'
      img.src = `/img/l/${hash}.webp`
      img.onload = () => { img.onload = null; paintRef.current() }
      img.style.zIndex = '2'
      const prev = slots[active.current].current
      if (prev) prev.style.zIndex = '1'
      active.current = nextIdx
      return nextIdx
    }

    const paint = () => {
      raf.current = 0
      const spans = spansRef.current
      if (!spans.length) return
      const sy = window.scrollY
      const vh = window.innerHeight
      const zone = vh * FADE

      // 取可视权重最高的 CG 区间：进入/退出深度连续计算
      let best = -1
      let bestCov = 0
      for (const s of spans) {
        const overlap = Math.min(s.bottom, sy + vh) - Math.max(s.top, sy)
        if (overlap <= 0) continue
        const inD = Math.min(1, (sy + vh - s.top) / zone)
        const outD = Math.min(1, (s.bottom - sy) / zone)
        const w = Math.min(inD, outD)
        if (w > bestCov) { bestCov = w; best = s.run }
      }

      const frame = best >= 0 && bestCov > 0.001 ? framesRef.current[best] : null
      const wantSpine = frame?.fgSpine || null
      if (wantSpine !== curSpine.current) {
        curSpine.current = wantSpine
        spineReady.current = false
        setSpineName(wantSpine)
        setSpineKey((k) => k + 1)
      }

      // 合成后的统一不透明度：两层先不透明地叠好，再整体淡入/淡出
      if (layersRef.current) layersRef.current.style.setProperty('--cov', String(Math.min(1, bestCov)))

      const btn = btnRef.current
      const setFg = (hash: string | null, hasSpine: boolean, name: string | null) => {
        if (hash && hash !== curFg.current) {
          const nextIdx = 1 - fgActive.current
          const img = fgSlots[nextIdx].current
          if (img) {
            img.style.opacity = '0'
            img.src = `/img/l/${hash}.webp`
            img.onload = () => { img.onload = null; paintRef.current() }
            img.style.zIndex = '2'
            const prev = fgSlots[fgActive.current].current
            if (prev) prev.style.zIndex = '1'
            fgActive.current = nextIdx
          }
          curFg.current = hash
        }
        const img = fgSlots[fgActive.current].current
        // 动态 CG：静态合成图先顶着，模型渲染出第一帧后让位。
        // 层本身只用 0/1 表示显隐，绝不单独半透明，否则人物会透出后面的背景图。
        const cover = hasSpine && spineReady.current ? 0 : 1
        if (img) {
          img.style.opacity = hash ? String(cover) : '0'
          if (name) img.dataset.cg = name
        }
        if (btn) {
          const show = !!hash && bestCov > 0.01 && (btnGate?.current ?? true)
          btn.style.opacity = show ? String(Math.min(1, bestCov)) : '0'
          // 淡出状态下别再吃点击（移动端按钮浮在正文之上，透明时不能挡操作）
          btn.style.pointerEvents = show ? 'auto' : 'none'
          if (name) btn.dataset.cg = name
        }
        if (!hash) curFg.current = null
      }
      const setBg = (hash: string | null, name: string | null) => {
        if (hash && hash !== curBg.current) {
          swap(bgSlots, bgActive, hash)
          curBg.current = hash
        }
        const img = bgSlots[bgActive.current].current
        if (img) {
          img.style.opacity = hash ? '1' : '0'
          if (name) img.dataset.cg = name
        }
      }

      if (!frame) {
        setFg(null, false, null)
        setBg(null, null)
        if (btn) { btn.style.opacity = '0'; btn.style.pointerEvents = 'none' }
        if (spineLayerRef.current) spineLayerRef.current.style.opacity = '0'
        return
      }
      setFg(frame.fg, !!wantSpine, frame.n)
      setBg(frame.bg, frame.n)
      if (spineLayerRef.current) {
        spineLayerRef.current.style.opacity = wantSpine && spineReady.current ? '1' : '0'
      }
    }
    paintRef.current = paint

    const onScroll = () => { if (!raf.current) raf.current = requestAnimationFrame(paint) }
    const onResize = () => { measure(); onScroll() }
    paint()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      if (raf.current) cancelAnimationFrame(raf.current)
    }
  }, [])

  return (
    <>
      <div className="reader-bg">
        {/* 渐隐 mask 只作用于画面层。容器统一控制不透明度，内部两层始终不透明，
            避免人物透出背景。 */}
        <div className="reader-bg-layers" ref={layersRef} style={{ '--cov': 0 } as React.CSSProperties}>
          {[0, 1].map((i) => (
            <img key={`b${i}`} ref={bgSlots[i]} alt="" className="slot slot-bg"
              onClick={(e) => { const cg = e.currentTarget.dataset.cg; if (cg) onOpen(cg) }} />
          ))}
          {[0, 1].map((i) => (
            <img key={`f${i}`} ref={fgSlots[i]} alt="" className="slot slot-fg"
              onClick={(e) => { const cg = e.currentTarget.dataset.cg; if (cg) onOpen(cg) }} />
          ))}
          {spineName && (
            <div key={spineKey} ref={spineLayerRef} className="slot-spine" style={{ opacity: 0 }}>
              <SpinePlayer name={spineName} controls={false} fitMode="cover" onReady={onModelReady} />
            </div>
          )}
        </div>
      </div>
      {/* 查看按钮必须挂在 .reader-bg 之外：.reader-bg 是 z-index 0 且 pointer-events:none
          的层叠上下文，移动端正文层（z-index 1）盖满全屏，真实触摸的命中测试到不了
          上下文内部的按钮（JS click 能触发、手指点不动的根因）。fixed + 高 z-index 悬空。 */}
      <button
        ref={btnRef}
        className="reader-bg-open"
        style={{ opacity: 0 }}
        onClick={(e) => {
          const cg = e.currentTarget.dataset.cg
          if (cg) onOpen(cg)
        }}
        title="打开 CG 查看器"
      >
        ⤢
      </button>
    </>
  )
}

/**
 * 阅读器左侧目录面板：分类切换 + 当前分类的作品列表；正在阅读的作品会
 * 展开它的章节，便于在作品/章节之间直接跳转。可整体收起。
 */
function ReaderNav({
  open, onOpen, onClose, index, detail, panelCat, setPanelCat, chapterIndex, backTo,
}: {
  open: boolean
  onOpen: () => void
  onClose: () => void
  index: StoryUnit[]
  detail: StoryDetail
  panelCat: string
  setPanelCat: (cat: string) => void
  chapterIndex: number | null
  backTo: string
}) {
  const cats = useMemo(() => {
    const seen: { cat: string; label: string; n: number }[] = []
    for (const u of index) {
      const hit = seen.find((s) => s.cat === u.cat)
      if (hit) hit.n += 1
      else seen.push({ cat: u.cat, label: u.label, n: 1 })
    }
    return seen
  }, [index])

  const list = useMemo(
    () => index.filter((u) => u.cat === panelCat),
    [index, panelCat],
  )

  const activeRef = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    if (!open) return
    // 打开面板时把当前作品滚到可视区域
    const t = window.setTimeout(
      () => activeRef.current?.scrollIntoView({ block: 'nearest' }), 80)
    return () => window.clearTimeout(t)
  }, [open, panelCat, detail.id])

  const narrow = () => { if (window.innerWidth <= 1100) onClose() }

  // 角色页里的咨询分片不在剧情目录中，不显示目录面板
  if (!cats.some((c) => c.cat === panelCat)) return null

  return (
    <>
      {open && <div className="rn-backdrop" onClick={onClose} />}
      <aside className={`reader-nav-panel${open ? ' open' : ''}`} aria-hidden={!open}>
        <div className="rn-head">
          <span>剧情目录</span>
          <button className="rn-close" onClick={onClose} aria-label="收起目录">×</button>
        </div>

        <div className="rn-cats">
          {cats.map((c) => (
            <button
              key={c.cat}
              className={`rn-cat${panelCat === c.cat ? ' on' : ''}`}
              onClick={() => setPanelCat(c.cat)}
            >
              {c.label}<em>{c.n}</em>
            </button>
          ))}
        </div>

        <div className="rn-list">
          {list.map((u) => (
            <div key={u.id}>
              <Link
                ref={u.id === detail.id ? activeRef : undefined}
                to={`/story/${u.id}`}
                className={`rn-item${u.id === detail.id ? ' on' : ''}`}
                onClick={narrow}
              >
                <span className="rn-title">{u.title}</span>
                <span className="rn-meta">{nf(u.lines)}</span>
              </Link>
              {u.id === detail.id && detail.segments.length > 1
                && detail.bucket !== 'MessengerDialogTable' && (
                <div className="rn-chapters">
                  {detail.segments.map((seg, i) => (
                    <Link
                      key={seg.g + i}
                      to={`/story/${detail.id}?ch=${i}`}
                      className={`rn-ch${chapterIndex === i ? ' on' : ''}`}
                      onClick={narrow}
                    >
                      <span>{String(i + 1).padStart(2, '0')}</span>
                      {seg.t || `第 ${i + 1} 章`}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="rn-foot">
          <Link to={backTo} className="rn-back" onClick={narrow}>← 返回剧情目录</Link>
        </div>
      </aside>

      {!open && (
        <button className="reader-nav-edge" onClick={onOpen} title="展开剧情目录">目录</button>
      )}
    </>
  )
}

export default function StoryReader() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [detail, setDetail] = useState<StoryDetail | null>(null)
  usePageTitle(detail ? `${detail.title} · ${detail.label}` : null)
  const [index, setIndex] = useState<StoryUnit[]>([])
  const [chars, setChars] = useState<Character[]>([])
  const [smsData, setSmsData] = useState<StorySmsData | null>(null)

  // 左侧目录面板：展开状态记在 localStorage，窄屏默认收起
  const [navOpen, setNavOpen] = useState(() => {
    try {
      const saved = localStorage.getItem('reader-nav')
      if (saved === '0') return false
      if (saved === '1') return true
    } catch { /* ignore */ }
    return window.innerWidth >= 1320
  })
  const rememberNav = (open: boolean) => {
    setNavOpen(open)
    try { localStorage.setItem('reader-nav', open ? '1' : '0') } catch { /* ignore */ }
  }
  const [panelCat, setPanelCat] = useState('')
  useEffect(() => { if (detail) setPanelCat(detail.cat) }, [detail])

  // 窄屏（≤980px，与 CSS 断点一致）下背景层铺满正文区，可用开关关闭；
  // 桌面端布局不遮挡正文，保持常开。
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 980px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 980px)')
    const fn = (e: MediaQueryListEvent) => setNarrow(e.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])

  // 移动端 CG 背景开关，记在 localStorage（默认开）
  const [bgOn, setBgOn] = useState(() => {
    try { return localStorage.getItem('reader-cgbg') !== '0' } catch { return true }
  })
  const toggleBg = () => {
    setBgOn((v) => {
      const next = !v
      try { localStorage.setItem('reader-cgbg', next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }

  // 移动端 HUD 收起/展开（默认收起：悬浮键会压住正文右下角）
  const [hudOpen, setHudOpen] = useState(() => {
    try { return localStorage.getItem('reader-hud') === '1' } catch { return false }
  })
  const hudOpenRef = useRef(hudOpen)
  hudOpenRef.current = hudOpen
  const toggleHud = () => {
    setHudOpen((v) => {
      const next = !v
      try { localStorage.setItem('reader-hud', next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
    // ⤢ 的显隐由 paint 每帧驱动，切收展后主动触发一次重绘
    window.dispatchEvent(new Event('resize'))
  }

  useEffect(() => {
    setDetail(null)
    if (!id) return
    loadStoryUnit(id).then(setDetail).catch(() => setDetail(null))
    loadStoryIndex().then(setIndex).catch(() => {})
    loadCharacters().then(setChars).catch(() => {})
  }, [id])

  // 内嵌短信：所有剧情单元都可能带 Messenger 段，按单元/段落分组
  useEffect(() => {
    if (!detail || smsData) return
    loadStorySms().then(setSmsData).catch(() => {})
  }, [detail, smsData])

  const inlineSms = useMemo(() => {
    const map: Record<string, Record<number, StorySmsGroup[]>> = {}
    if (!detail || !smsData) return map
    for (const it of smsData.items) {
      if (it.unit !== detail.id) continue
      const seg = map[it.anchor] || (map[it.anchor] = {})
      ;(seg[it.at] || (seg[it.at] = [])).push(it)
    }
    return map
  }, [detail, smsData])

  const pos = useMemo(() => index.findIndex((u) => String(u.id) === id), [index, id])
  // 上/下话只在同一分类内跳，避免活动最后一个跳到主线
  const catUnits = useMemo(() => {
    if (pos < 0) return []
    const cat = index[pos].cat
    return index.filter((u) => u.cat === cat)
  }, [index, pos])
  const catPos = useMemo(() => catUnits.findIndex((u) => String(u.id) === id), [catUnits, id])
  const prev = catPos > 0 ? catUnits[catPos - 1] : null
  const next = catPos >= 0 && catPos < catUnits.length - 1 ? catUnits[catPos + 1] : null

  // 返回目录时回到进入前的分类（分类参数在 Story 页里写进了 URL）
  const backTo = useMemo(() => {
    if (!detail) return '/story'
    if (!index.some((u) => u.cat === detail.cat)) return '/story'
    return detail.cat === 'main' ? '/story' : `/story?cat=${detail.cat}`
  }, [detail, index])

  const speakerMap = useMemo(() => {
    const m: Record<string, Character> = {}
    for (const c of chars) if (c.speaker) m[c.speaker] = c
    return m
  }, [chars])

  // 给每行编号，和搜索索引的 lineIdx 对齐，用于跳转定位；
  // 同时把段内 CG 事件摊平成全局 run 列表（每个 run = 一张图从某行开始显示）
  const { blocks, frames } = useMemo(() => {
    const frames: Frame[] = []
    let n = 0
    if (!detail) return { blocks: [], frames }
    const blocks = detail.segments.map((seg) => {
      const lines = seg.l.map(([sp, spid, txt]) => ({ sp, spid, txt, no: n++ }))
      const runs = new Map<number, number>()   // 行下标 -> run 序号
      for (const [at, refs] of seg.e || []) {
        if (!refs.length) continue
        const idx = Math.max(0, Math.min(at, lines.length - 1))
        runs.set(idx, frames.push(resolveCg(refs)) - 1)
      }
      return { t: seg.t, g: seg.g, lines, runs }
    })
    return { blocks, frames }
  }, [detail])

  const hasCg = frames.length > 0

  useEffect(() => {
    const target = params.get('line')
    if (!target || !detail) return
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(`L${target}`)
      if (!el) return
      // 手动算偏移，避开顶栏 + 头部（头部高度按元素实测，移动端更高）
      const head = document.querySelector<HTMLElement>('.reader-head')
      const offset = head ? head.offsetHeight + 76 : 190
      const y = el.getBoundingClientRect().top + window.scrollY - offset
      window.scrollTo({ top: Math.max(0, y) })
      el.classList.add('hit')
    })
    return () => cancelAnimationFrame(raf)
  }, [detail, params])

  const chapterParam = params.get('ch')
  useEffect(() => {
    // 切章节时回到顶部；带 line 的搜索/CG 跳转由上面的 effect 定位
    if (params.get('line')) return
    window.scrollTo({ top: 0 })
  }, [chapterParam])

  if (!detail) return <div className="loading">LOADING…</div>

  // 活动 / 个人剧情 / 支线 / 日常（多章节）先进章节目录，点章节才显示正文；
  // 主线一章就是一篇长文，保持原来的整章阅读
  const isMulti = CHAPTER_CATS.has(detail.cat) && detail.segments.length > 1
  let chapterIndex: number | null = null
  if (isMulti) {
    if (chapterParam !== null) {
      const n = Number(chapterParam)
      if (Number.isInteger(n) && n >= 0 && n < detail.segments.length) chapterIndex = n
    }
    if (chapterIndex === null) {
      // 搜索/CG 的 ?line= 是「单元内第几行」，换算成它所在的章节
      const lineParam = params.get('line')
      if (lineParam !== null) {
        const target = Number(lineParam)
        let acc = 0
        for (let i = 0; i < detail.segments.length; i++) {
          if (target < acc + detail.segments[i].l.length) { chapterIndex = i; break }
          acc += detail.segments[i].l.length
        }
      }
    }
  }

  const total = blocks.reduce((a, b) => a + b.lines.length, 0)
  const chapterSeg = chapterIndex !== null ? detail.segments[chapterIndex] : null
  const chapterTitle = chapterSeg && chapterIndex !== null
    ? (chapterSeg.t || `第 ${chapterIndex + 1} 章`)
    : ''
  const shownBlocks = chapterIndex !== null ? blocks.slice(chapterIndex, chapterIndex + 1) : blocks
  const shownTotal = chapterSeg ? chapterSeg.l.length : total
  const chapterHasCg = chapterIndex !== null ? (blocks[chapterIndex]?.runs.size ?? 0) > 0 : hasCg
  const prevCh = chapterIndex !== null && chapterIndex > 0 ? chapterIndex - 1 : null
  const nextCh = chapterIndex !== null && chapterIndex < detail.segments.length - 1 ? chapterIndex + 1 : null

  if (isMulti && chapterIndex === null) {
    const catWord = detail.cat === 'event' ? '活动' : '话'
    return (
      <>
        <ReaderNav
          open={navOpen}
          onOpen={() => rememberNav(true)}
          onClose={() => rememberNav(false)}
          index={index}
          detail={detail}
          panelCat={panelCat || detail.cat}
          setPanelCat={setPanelCat}
          chapterIndex={chapterIndex}
          backTo={backTo}
        />
        {/* 移动端目录入口：竖签在窄屏隐藏，列表页同样用右下角 HUD */}
        {narrow && (
          <div className="reader-hud">
            <button className="hud-btn" onClick={() => rememberNav(true)} title="展开剧情目录">
              目录
            </button>
          </div>
        )}
        <div className="reader">
        <div className="reader-head">
          <Link to={backTo} className="reader-back">← 剧情目录</Link>
          <div className="reader-title">
            <span className="reader-cat">{detail.label}</span>
            <h1>{detail.title}</h1>
            <span className="reader-count">{nf(total)} 句 · {detail.segments.length} 章</span>
          </div>
          <div className="reader-nav">
            {prev && (
              <Link to={`/story/${prev.id}`} title={prev.title} className="nav-btn">
                {catWord === '活动' ? '← 上个活动' : '← 上话'}
              </Link>
            )}
            {next && (
              <Link to={`/story/${next.id}`} title={next.title} className="nav-btn">
                {catWord === '活动' ? '下个活动 →' : '下话 →'}
              </Link>
            )}
          </div>
        </div>

        <div className="reader-body chapters">
          {eventHeroSlug(detail.id) && (
            <EventHero detail={detail} slug={eventHeroSlug(detail.id)!} />
          )}
          {detail.segments.map((seg, i) => {
            const preview = seg.l[0]?.[2]?.replace(/\n/g, ' ') || ''
            return (
              <Link key={seg.g + i} to={`/story/${detail.id}?ch=${i}`} className="chapter-row">
                <span className="chapter-no">{String(i + 1).padStart(2, '0')}</span>
                <span className="chapter-main">
                  <span className="chapter-name">{seg.t || `第 ${i + 1} 章`}</span>
                  {preview && <span className="chapter-preview">{preview}</span>}
                </span>
                <span className="chapter-meta">{nf(seg.l.length)} 句</span>
                <span className="chapter-arrow">→</span>
              </Link>
            )
          })}
        </div>

        <div className="reader-foot">
          <Link to={backTo} className="btn">← 返回目录</Link>
          {next && (
            <Link to={`/story/${next.id}`} className="btn primary">
              {catWord === '活动' ? '下个活动：' : '下一话：'}{next.title} →
            </Link>
          )}
        </div>
        </div>
      </>
    )
  }

  // 背景层显隐：桌面常开；移动端按开关渲染（关掉时不挂载 Spine 模型，省电省内存）
  const showBg = chapterHasCg && (!narrow || bgOn)

  return (
    <>
      <ReaderNav
        open={navOpen}
        onOpen={() => rememberNav(true)}
        onClose={() => rememberNav(false)}
        index={index}
        detail={detail}
        panelCat={panelCat || detail.cat}
        setPanelCat={setPanelCat}
        chapterIndex={chapterIndex}
        backTo={backTo}
      />
    <div className={`reader ${showBg ? 'has-cg' : ''}`}>
      {/* 背景层：透明度跟随滚动进度，动态 CG 直接播实时模型，点击进入二级查看页 */}
      {showBg && (
        <StoryCgBg
          key={chapterIndex ?? 'all'}
          frames={frames}
          onOpen={(cgName) => navigate(`/cg/${encodeURIComponent(cgName)}`)}
          btnGate={hudOpenRef}
        />
      )}

      {/* 移动端阅读 HUD（≤980px 渲染）：头部不再 sticky，滚走后靠它访问目录/背景开关。
          默认收起只留切换键，展开才显示 CG 开关与目录（悬浮键会压住正文右下角）。
          ⤢ 查看 CG 的悬浮按钮固定在展开组之上（见 CSS .reader-bg-open）。 */}
      {narrow && (
        <div className="reader-hud">
          {hudOpen && chapterHasCg && (
            <button
              type="button"
              className={`hud-btn${bgOn ? ' on' : ''}`}
              onClick={toggleBg}
              aria-pressed={bgOn}
              title="阅读背景开关（关闭后仅保留正文，更省电）"
            >
              CG
            </button>
          )}
          {hudOpen && (
            <button className="hud-btn" onClick={() => rememberNav(true)} title="展开剧情目录">
              目录
            </button>
          )}
          <button
            type="button"
            className="hud-btn hud-toggle"
            onClick={toggleHud}
            aria-expanded={hudOpen}
            title={hudOpen ? '收起悬浮按钮' : '展开悬浮按钮'}
          >
            {hudOpen ? '⌄' : '⌃'}
          </button>
        </div>
      )}

      <div className="reader-head">
        <Link to={chapterIndex !== null ? `/story/${detail.id}` : '/story'} className="reader-back">
          {chapterIndex !== null ? '← 章节列表' : '← 剧情目录'}
        </Link>
        <div className="reader-title">
          <span className="reader-cat">{detail.label}</span>
          <h1>{chapterIndex !== null ? chapterTitle : detail.title}</h1>
          <span className="reader-count">{nf(shownTotal)} 句</span>
        </div>
        {chapterIndex !== null && <div className="reader-sub">{detail.title}</div>}
        <div className="reader-nav">
          {chapterIndex !== null ? (
            <>
              {prevCh !== null && <Link to={`/story/${detail.id}?ch=${prevCh}`} className="nav-btn">← 上一章</Link>}
              {nextCh !== null && <Link to={`/story/${detail.id}?ch=${nextCh}`} className="nav-btn">下一章 →</Link>}
            </>
          ) : (
            <>
              {prev && <Link to={`/story/${prev.id}`} title={prev.title} className="nav-btn">← 上话</Link>}
              {next && <Link to={`/story/${next.id}`} title={next.title} className="nav-btn">下话 →</Link>}
            </>
          )}
        </div>
      </div>

      <div className="reader-body">
        {shownBlocks.map((seg, si) => (
          <section key={seg.g + si} className="seg" data-g={seg.g}>
            {seg.t && chapterIndex === null && <h2 className="seg-title">{seg.t}</h2>}
            {seg.lines.map((ln, li) => {
              const ch = speakerMap[ln.spid]
              const isNarr = !ln.sp
              const run = seg.runs.get(li)
              return (
                <Fragment key={ln.no}>
                  {inlineSms[seg.g]?.[li]?.map((g) => (
                    <StorySmsInline key={g.g} group={g} />
                  ))}
                  <div
                    id={`L${ln.no}`}
                    data-run={run}
                    className={`line ${isNarr ? 'narr' : ''}`}
                  >
                    {ln.sp && (
                      <span className="spk" style={{ color: ch ? accentFor(ch.id) : undefined }}>
                        {ln.sp}
                      </span>
                    )}
                    <p>{ln.txt}</p>
                  </div>
                </Fragment>
              )
            })}
            {inlineSms[seg.g]?.[seg.lines.length]?.map((g) => (
              <StorySmsInline key={g.g} group={g} />
            ))}
          </section>
        ))}
      </div>

      <div className="reader-foot">
        {chapterIndex !== null ? (
          <>
            <Link to={`/story/${detail.id}`} className="btn">← 返回章节列表</Link>
            {nextCh !== null && (
              <Link to={`/story/${detail.id}?ch=${nextCh}`} className="btn primary">
                下一章：{detail.segments[nextCh].t || `第 ${nextCh + 1} 章`} →
              </Link>
            )}
          </>
        ) : (
          <>
            <Link to={backTo} className="btn">← 返回目录</Link>
            {next && (
              <Link to={`/story/${next.id}`} className="btn primary">
                下一话：{next.title} →
              </Link>
            )}
          </>
        )}
      </div>
    </div>
    </>
  )
}
