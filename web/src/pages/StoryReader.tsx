import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  accentFor, loadCharacters, loadStoryIndex, loadStoryUnit, nf,
  type Character, type StoryCgRef, type StoryDetail, type StoryUnit,
} from '../data'
import SpinePlayer from '../components/SpinePlayer'

type Frame = {
  fg: string | null
  /** 有实时模型的 CG 名；阅读背景直接播模型，不再用离线合成动图 */
  fgSpine: string | null
  bg: string | null
  /** 点击背景时打开二级查看页所用的 CG 名 */
  n: string | null
}

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
 * 阅读 CG 背景：右侧大区域，四边渐变遮罩。
 * 透明度完全由滚动进度驱动（无定时动画）——滚轮往下滚渐显、往回滚渐隐。
 * bg 层 + 前景层双层合成；动态 CG 的前景层在静态合成图加载后换成实时 Spine 模型。
 * 点击背景跳到 CG 二级查看页。
 *
 * 显示区间按「行」切分：段落在第 N 行切到某张 CG 时，这张图从该行一直显示到
 * 下一次切换（或本段结束），而不是整段都顶着一张图。
 */
function StoryCgBg({
  frames,
  onOpen,
}: {
  frames: Frame[]
  onOpen: (name: string) => void
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
    // 整体淡入淡出只施加在合成后的容器上。
    const MAX_ALPHA = 0.55

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
      const alpha = Math.min(1, bestCov) * MAX_ALPHA
      if (layersRef.current) layersRef.current.style.opacity = String(alpha)

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
          btn.style.opacity = hash ? String(Math.min(1, bestCov)) : '0'
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
        if (btn) btn.style.opacity = '0'
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
    <div className="reader-bg">
      {/* 渐隐 mask 只作用于画面层，右上角按钮保持完整可见。
          容器统一控制不透明度，内部两层始终不透明，避免人物透出背景。 */}
      <div className="reader-bg-layers" ref={layersRef} style={{ opacity: 0 }}>
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
    </div>
  )
}

export default function StoryReader() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [detail, setDetail] = useState<StoryDetail | null>(null)
  const [index, setIndex] = useState<StoryUnit[]>([])
  const [chars, setChars] = useState<Character[]>([])

  useEffect(() => {
    setDetail(null)
    if (!id) return
    loadStoryUnit(id).then(setDetail).catch(() => setDetail(null))
    loadStoryIndex().then(setIndex).catch(() => {})
    loadCharacters().then(setChars).catch(() => {})
  }, [id])

  const pos = useMemo(() => index.findIndex((u) => String(u.id) === id), [index, id])
  const prev = pos > 0 ? index[pos - 1] : null
  const next = pos >= 0 && pos < index.length - 1 ? index[pos + 1] : null

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
      // 手动算偏移，避开 sticky 头
      const y = el.getBoundingClientRect().top + window.scrollY - 190
      window.scrollTo({ top: Math.max(0, y) })
      el.classList.add('hit')
    })
    return () => cancelAnimationFrame(raf)
  }, [detail, params])

  if (!detail) return <div className="loading">LOADING…</div>

  const total = blocks.reduce((a, b) => a + b.lines.length, 0)

  return (
    <div className={`reader ${hasCg ? 'has-cg' : ''}`}>
      {/* 背景层：透明度跟随滚动进度，动态 CG 直接播实时模型，点击进入二级查看页 */}
      {hasCg && (
        <StoryCgBg
          frames={frames}
          onOpen={(cgName) => navigate(`/cg/${encodeURIComponent(cgName)}`)}
        />
      )}

      <div className="reader-head">
        <Link to="/story" className="reader-back">← 剧情目录</Link>
        <div className="reader-title">
          <span className="reader-cat">{detail.label}</span>
          <h1>{detail.title}</h1>
          <span className="reader-count">{nf(total)} 句</span>
        </div>
        <div className="reader-nav">
          {prev && <Link to={`/story/${prev.id}`} title={prev.title} className="nav-btn">← 上话</Link>}
          {next && <Link to={`/story/${next.id}`} title={next.title} className="nav-btn">下话 →</Link>}
        </div>
      </div>

      <div className="reader-body">
        {blocks.map((seg, si) => (
          <section key={seg.g + si} className="seg" data-g={seg.g}>
            {seg.t && <h2 className="seg-title">{seg.t}</h2>}
            {seg.lines.map((ln, li) => {
              const ch = speakerMap[ln.spid]
              const isNarr = !ln.sp
              const run = seg.runs.get(li)
              return (
                <div
                  key={ln.no}
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
              )
            })}
          </section>
        ))}
      </div>

      <div className="reader-foot">
        <Link to="/story" className="btn">← 返回目录</Link>
        {next && (
          <Link to={`/story/${next.id}`} className="btn primary">
            下一话：{next.title} →
          </Link>
        )}
      </div>
    </div>
  )
}
