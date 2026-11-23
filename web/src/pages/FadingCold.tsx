/**
 * FADING AFFECTION — 冷寂 COLD SILENCE 双主题 UI
 * 纯展示组件：全部装饰由 CSS + 内联 SVG 绘制，唯一图片是原版黑白 CG。
 * 主题跟随站点 <html data-theme>（light = 灰白纸张，dark = 冷钢灰）。
 */
import type {
  FadingData, FadingRoute, FadingPage, FadingMemory,
} from '../fadingData'
import { fadingCgSrc } from '../fadingData'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import FadingIntro from './FadingIntro'
import './fading-cold.css'

/** 选项/标记的级联序号交给 CSS 变量 */
const order = (i: number) => ({ '--i': String(i) }) as CSSProperties

/* ---------------- 内联 SVG 图标（stroke 用 currentColor，自动跟随主题） ---------------- */
type IconName = 'file' | 'target' | 'chip' | 'mem'
  | 'arrow' | 'lock' | 'star' | 'play' | 'refresh' | 'book' | 'eye' | 'mappin' | 'back' | 'exit'
  | 'sound' | 'mute' | 'trash'

const PATHS: Record<IconName, React.ReactNode> = {
  file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h4M9 12h6M9 16h6" /></>,
  target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 1v4M12 19v4M1 12h4M19 12h4" /></>,
  chip: <><rect x="5" y="5" width="14" height="14" rx="1" /><rect x="9" y="9" width="6" height="6" /><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" /></>,
  mem: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h5" /></>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  lock: <><rect x="5" y="10" width="14" height="11" rx="1" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  star: <path d="M12 2l2.6 6.6L21 9.3l-5 4.4 1.5 6.6L12 17l-5.5 3.3L8 13.7l-5-4.4 6.4-.7z" />,
  play: <path d="M7 4l13 8-13 8z" />,
  refresh: <path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5" />,
  book: <><path d="M4 5h7v15H4zM13 5h7v15h-7z" /><path d="M4 9h7M13 9h7" /></>,
  eye: <><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z" /><circle cx="12" cy="12" r="2.5" /></>,
  mappin: <><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7z" fill="currentColor" stroke="none" /><circle cx="12" cy="9" r="2.6" fill="var(--fpanel,#fff)" stroke="none" /></>,
  back: <><path d="M11 6L5 12l6 6M18 6l-6 6 6 6" /></>,
  exit: <><path d="M14 4H5v16h9M11 12h9M17 8l4 4-4 4" /></>,
  sound: <><path d="M4 9h3l5-4v14l-5-4H4z" /><path d="M16 9.5a4 4 0 0 1 0 5M18.5 7a7.5 7.5 0 0 1 0 10" /></>,
  mute: <><path d="M4 9h3l5-4v14l-5-4H4z" /><path d="M16 10l5 4M21 10l-5 4" /></>,
  trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14" /><path d="M10 11v7M14 11v7" /></>,
}
function I({ n, fill }: { n: IconName; fill?: boolean }) {
  return <svg className={fill ? 'ico ico-fill' : 'ico'} viewBox="0 0 24 24" aria-hidden="true">{PATHS[n]}</svg>
}
/** 原版 UI 纹理图标：CSS mask 染色，跟随 currentColor 自动适配深浅主题 */
function PNGIcon({ kind }: { kind: 'hp' | 'food' | 'erosion' | 'lock' | 'mem' | 'arrow' | 'hex' }) {
  return <span className={`icn-png ${kind}`} aria-hidden="true" />
}
const ROMAN = ['I', 'II', 'III', 'IV', 'V']

/* ---------- 原版 UI 位图 ---------- */

/** 关卡卡片背景：prefab 14110 `adventure_routeselect_marian` 里
 *  btn_route_select_marian_01/02/03 的 img_value 分别是 marian_routeselect_01/02/03.png，
 *  序号与 RouteTable 的 route1/2/3 按兄弟顺序对齐。 */
const ROUTE_ART = (no: number) => `/fading_ui/marian_routeselect_0${no}.png`

/** 结局类型字标（DEATH END / TRUE END / HIDDEN END / 504 ERROR）。
 *  结局类型是页面表的真实字段：-34 正文 key 字符串之后 +19 的 u8，
 *  1=death 2=true 3=hidden 4=erosion，265 页与 id 前缀零例外吻合。
 *  四张都是深色墨迹（实测不透明像素 100% 亮度低于 80），垫在纸片上才读得出来。 */
const END_MARK: Record<string, { src: string; alt: string }> = {
  death: { src: '/fading_ui/icn_ending_death.png', alt: 'DEATH END' },
  true: { src: '/fading_ui/icn_ending_true.png', alt: 'TRUE END' },
  hidden: { src: '/fading_ui/icn_ending_hidden.png', alt: 'HIDDEN END' },
  // 图面是 504，Locale 串却是 404 ERROR——按图面写
  erosion: { src: '/fading_ui/icn_ending_erosion.png', alt: '504 ERROR' },
}

/** 内存按钮皮肤。prefab 14111 的阅读界面有三套完整皮肤（marian / commander / erosion），
 *  各带一枚 btn_memory 图。路线归属的依据是 RouteTable 的 intro 字段：
 *  路线 1、2 = `event_text_adv_plus_intro_maria`（"MARIA - {0}"）→ marian，
 *  路线 3 = `event_text_adv_plus_intro_header_commander`（"IN ACTION"）→ commander。
 *  erosion 版在 prefab 里默认 inactive，八张表除 Manager 的状态定义外没有任何 erosion 字段，
 *  状态增减量也已证实不存在（8 张表 4 字节窗口全扫，[-9,-1] 命中 0），
 *  所以表里唯一能证实的侵蚀信号是结局类型字段（=4，即 7xxx 那 6 页）——侵蚀版只在这类页面启用。 */
function memSkin(routeNo: number, kind: string | null): 'marian' | 'commander' | 'erosion' {
  if (kind === 'erosion') return 'erosion'
  return routeNo === 3 ? 'commander' : 'marian'
}
const MEM_BTN = (skin: 'marian' | 'commander' | 'erosion') =>
  `/fading_ui/btn_marian_memory${skin === 'marian' ? '' : '_' + skin}.png`

/** 地区标记在地图上的百分比坐标（按原版游戏截图标定） */
const REGION_POS: Record<string, { x: number; y: number }> = {
  '旧市区': { x: 19, y: 62 },
  '湖': { x: 41, y: 39 },
  '新市区': { x: 74, y: 30 },
}
const MAP_SRC = '/fading_icons/map_mono.png'

/** 开场地区选择：原版地图 + 可点标记 */
function RegionMap({ choices }: { choices: ColdChoice[] }) {
  return (
    <div className="cf-map">
      <div className="cf-map-frame">
        <img src={MAP_SRC} alt="地区地图" />
        <span className="cf-map-label">FIELD MAP / 旧市地区域</span>
        {choices.map((c, i) => {
          const pos = REGION_POS[c.text] ?? { x: 50, y: 50 }
          return (
            <button
              key={c.key}
              className={`cf-marker ${c.locked ? 'locked' : ''}`}
              style={{ left: `${pos.x}%`, top: `${pos.y}%`, ...order(i) }}
              disabled={c.locked}
              onClick={() => c.onClick()}
              title={c.text}
            >
              <span className="pin">{c.locked ? <I n="lock" /> : <I n="mappin" />}</span>
              <span className="tag">{c.locked ? '???' : c.text}</span>
              {c.locked && c.lockText && <span className="req">{c.lockText}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** 打字机：约 42 字/秒逐字出现，全部出完才放行选项；点正文可立刻补完。
 *  用 rAF 按已耗时间推算字数——被后台节流时不会累积错位，回到前台直接补到正确位置。
 *  只跟 text 走，不跟幕次走：换视图（回主菜单、开内存）时正文没变，就不该重打一遍——
 *  重打会在看不见的地方把打字咔哒和笔刷音放出来，原作点开内存回到同一页也是直接给全文。
 *  start=false 时先不出字：有 CG 的页面要等翻页放完，正文和打字音才一起开始。 */
const TYPE_MS = 24

function useTypewriter(text: string, onReveal?: () => void, start = true) {
  const [n, setN] = useState(start ? text.length : 0)
  const stopped = useRef(false)
  const cb = useRef(onReveal)
  cb.current = onReveal
  useEffect(() => {
    stopped.current = false
    // CG 翻页没放完之前先空着，别提前把正文和打字音放出来
    if (!start) { setN(0); return }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setN(text.length); return }
    setN(0)
    const t0 = performance.now()
    let raf = 0
    let guard = 0
    let shown = 0
    const step = (now: number) => {
      if (stopped.current) return
      const v = Math.min(Math.floor((now - t0) / TYPE_MS), text.length)
      if (v > shown) { shown = v; cb.current?.() }
      setN(v)
      if (v < text.length) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    /* 后台页面不跑 rAF，兜底把剩余文字补齐，免得选项永远出不来 */
    guard = window.setTimeout(() => { stopped.current = true; setN(text.length) }, text.length * TYPE_MS + 400)
    return () => { cancelAnimationFrame(raf); clearTimeout(guard) }
  }, [text, start])
  return {
    shown: n >= text.length ? text : text.slice(0, n),
    done: n >= text.length,
    skip: () => { stopped.current = true; setN(text.length) },
  }
}

/** 结局类型：按页号前缀（6xxx 死亡 / 7xxx 侵蚀 / 8xxx TRUE / 9xxx HIDDEN） */
function endKind(id: number | null): string {
  if (id == null) return 'death'
  if (id >= 9000) return 'hidden'
  if (id >= 8000) return 'true'
  if (id >= 7000) return 'erosion'
  return 'death'
}

/** 干扰方块：位置与尺寸都用百分比，既当可见色块，也当内容副本的遮罩矩形 */
type Blk = { id: number; x: number; y: number; w: number; h: number; o: number; c: string; until: number }

/** rAF + 时间片生成方块（setInterval 在后台窗口会被节流到秒级，实测差 60 倍）。
 *  每块自己抽签：尺寸分大中小三档，寿命 60~300ms 各自不同；在场数量 1~13 也是随机重抽的。
 *  整体上再套一层随机断续——亮 0.9~2.2s、灭 0.22~0.74s，灭时全部清空。 */
function useBlocks(active: boolean, sceneKey: number): Blk[] {
  const [blks, setBlks] = useState<Blk[]>([])
  useEffect(() => {
    if (!active || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setBlks([]); return }
    const t0 = Date.now()
    let id = 0, raf = 0, alive = true, on = true, phaseEnd = t0 + 900, want = 4, wantEnd = 0
    const mk = (now: number): Blk => {
      const pick = Math.random()                                  // 尺寸档位随机
      const w = pick < 0.3 ? 26 + Math.random() * 46 : pick < 0.62 ? 9 + Math.random() * 18 : 2 + Math.random() * 7
      const h = pick < 0.3 ? 2.2 + Math.random() * 4.6 : pick < 0.62 ? 1.1 + Math.random() * 2.6 : 0.5 + Math.random() * 1.4
      const r = Math.random()
      // 约 1/5 专门骑在面板四边上，可以溢出内容区去干扰边框线
      const edge = Math.random() < 0.2
      let x = 2 + Math.random() * (96 - w - 2)
      let y = 2 + Math.random() * (96 - h - 2)
      if (edge) {
        const side = Math.floor(Math.random() * 4)
        if (side === 0) x = -3
        else if (side === 1) x = 99 - w
        else if (side === 2) y = -3
        else y = 99 - h
      }
      return {
        id: ++id,
        x, y,
        w, h,
        o: 0.45 + Math.random() * 0.5,
        c: r < 0.2 ? 'r' : r < 0.45 ? 'g' : '',
        until: now + 60 + Math.random() * 240,
      }
    }
    const tick = () => {
      if (!alive) return
      const now = Date.now()
      if (now >= phaseEnd) {
        on = !on
        phaseEnd = now + (on ? 900 + Math.random() * 1300 : 220 + Math.random() * 520)
        if (!on) setBlks([])
      }
      if (on) {
        // 在场数量本身也是随机的：隔 260~700ms 重新抽一次，有时一两块有时十几块
        if (now >= wantEnd) { want = 1 + Math.floor(Math.random() * 13); wantEnd = now + 260 + Math.random() * 440 }
        setBlks((prev) => {
          const kept = prev.filter((b) => b.until > now)
          if (kept.length === prev.length && kept.length >= want) return prev
          while (kept.length < want) kept.push(mk(now))
          return kept.length > 16 ? kept.slice(0, 16) : kept
        })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { alive = false; cancelAnimationFrame(raf) }
  }, [active, sceneKey])
  return blks
}

/** 方块矩形拼成 SVG 遮罩：只有这些矩形覆盖到的内容副本会显示出来。
 *  骑边的方块坐标会溢出，遮罩按 0~100 裁一下，贴到面板边缘为止。 */
function maskOf(bs: Blk[]): CSSProperties {
  const cl = (v: number) => Math.max(0, Math.min(100, v))
  const rects = bs.map((b) => {
    const x = cl(b.x), y = cl(b.y), w = cl(b.x + b.w) - x, h = cl(b.y + b.h) - y
    return w <= 0 || h <= 0 ? '' : `<rect x='${x.toFixed(1)}' y='${y.toFixed(1)}' `
      + `width='${w.toFixed(1)}' height='${h.toFixed(1)}'/>`
  }).join('')
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' `
    + `preserveAspectRatio='none'><g fill='#fff'>${rects}</g></svg>`
  const u = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
  return {
    maskImage: u, WebkitMaskImage: u, maskSize: '100% 100%',
    WebkitMaskSize: '100% 100%', maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat',
  } as CSSProperties
}

/** 干扰层：位移滤镜定义（给内容副本用）+ 方块色块 + 一次性撕裂 + 噪波 */
function EndFx({ kind, blks }: { kind: string; blks: Blk[] }) {
  return (
    <div className={`cf-endfx cf-endfx-${kind}`} aria-hidden="true">
      <svg className="fx-defs" width="0" height="0">
        <filter id="fx-tear" x="-10%" y="-10%" width="120%" height="120%">
          {/* 横向几乎不变、纵向约 20px 一条 → 位移按粗水平条带整体错位，是撕裂不是磨砂 */}
          <feTurbulence type="fractalNoise" baseFrequency="0.002 0.05" numOctaves="1" seed="3" result="n">
            <animate attributeName="seed" values="2;9;17;4;12;6" dur="0.28s" repeatCount="indefinite" calcMode="discrete" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="n" xChannelSelector="R" yChannelSelector="G" scale="26" />
        </filter>
      </svg>
      {blks.map((b) => (
        <i key={b.id} className={`fx-blk ${b.c}`}
          style={{ left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%`, opacity: b.o }} />
      ))}
      <i className="fx-slice" /><i className="fx-noise" />
    </div>
  )
}

/* ---------------- 组件 props ---------------- */
export type ColdView = 'home' | 'routes' | 'game' | 'endings' | 'memories'
export type ColdChoice = {
  key: string | number
  index: string
  text: string
  hint?: string
  locked?: boolean
  lockText?: string
  checked?: boolean
  disabled?: boolean
  onClick: () => void
}
export type FadingColdProps = {
  data: FadingData
  view: ColdView
  route: FadingRoute | null
  pageText: string
  cgSrc: string | null
  cgAlt?: string
  isRegionSelect?: boolean
  /** 幕次：每换一幕 +1，用来重置淡入 / 打字 / 选项级联动画 */
  sceneKey: number
  /** 正在淡出的范围：page 只淡正文/CG/选项，view 淡整块正文区（外框、标题、状态栏不动） */
  fade: 'none' | 'page' | 'view'
  /** 回想/记忆页的返回目标：从游戏里点开就要回到同一页 */
  backView: ColdView
  /** 每露出一批文字回调一次，用来打打字音 */
  onType?: () => void
  /** Manager 表原样导出：items + init + max，状态不做增减 */
  status: FadingData['status']
  choices: ColdChoice[]
  ending: { title: string; hint: string } | null
  endingId: number | null
  memoryUnlocked: FadingMemory | null
  found: number[]
  endings: FadingPage[]
  memories: FadingMemory[]
  unlockedMemories: Set<number>
  /** 侵蚀度只在部分路线启用（原版路线 1/3 的侵蚀条是锁定的） */
  erosionActive: boolean
  onStart: (r: FadingRoute) => void
  onNavigate: (v: ColdView) => void
  onRestart: () => void
  onBack: () => void
  canBack: boolean
  /** 无选项页面的推进按钮（原版「点击画面继续」） */
  canNext: boolean
  onNext: () => void
  onChoice: (c: ColdChoice) => void
  onClearSave: () => void
  onMemClick: () => void
  routeUnlocked: (r: FadingRoute) => boolean
  /** 音频静音开关（文件由 build/export_fading_audio.py 导出） */
  muted: boolean
  onToggleMute: () => void
}

/** 状态栏：体力/粮食上排，侵蚀长条下排。数值全部来自 Manager 表：
 *  粮食上限只有 1 份，是随身物品而不是消耗条。内存按钮不在这里（见 MemButton）。 */
function StatusBar({ status, erosionActive }: {
  status: FadingData['status']; erosionActive: boolean
}) {
  const find = (k: 'hp' | 'food' | 'erosion') => status.items.find((s) => s.key === k)
  const hp = find('hp'), food = find('food'), eros = find('erosion')
  const pct = eros?.max ? Math.round((status.init.erosion / eros.max) * 100) : 0
  const mark = eros?.max && eros.second < eros.max
    ? Math.round((eros.second / eros.max) * 100) : null
  return (
    <div className="sb sb-f">
      <div className="sb-main">
        {/* 体力/粮食只留图标与数字，名称不再写出来（图标本身就是识别符） */}
        <div className="sb-row1">
          <div className="sb-stat" title={hp ? `体力 ${hp.max}` : undefined}>
            <PNGIcon kind="hp" />
            <b>{status.init.hp}<small>/{hp?.max ?? status.max.hp}</small></b>
          </div>
          <div className="sb-stat" title={food ? `粮食 ${food.max} 份` : undefined}>
            <PNGIcon kind="food" />
            <b>{status.init.food}<small>/{food?.max ?? status.max.food}</small></b>
          </div>
        </div>
        <div className={`sb-row2 ${erosionActive ? '' : 'off'}`}>
          {erosionActive ? (
            <>
              <span className="sb-lb"><PNGIcon kind="erosion" /> {eros?.name || '侵蚀度'}</span>
              <div className="sb-track">
                <i style={{ width: `${pct}%` }} />
                {mark != null && <em style={{ left: `${mark}%` }} title={`达到 ${eros?.second} 进入侵蚀状态`} />}
              </div>
              <span className="sb-pct">{pct}%</span>
            </>
          ) : (
            /* 未启用侵蚀的路线：整条斜纹槽，中间只写 LOCK，连「侵蚀度」三字都不出现 */
            <div className="sb-track sb-track-lock"><span className="sb-lock-txt">LOCK</span></div>
          )}
        </div>
      </div>
    </div>
  )
}

/** 内存按钮：原版就是那张 NIMPH 记忆卡本体（btn_marian_memory 三套皮肤），
 *  「内存」两字压在卡面的平坦标签区上；三套卡底色不同，字色跟着皮肤走。
 *  它不属于页脚，是浮在剧情区右下角的按钮，所以单独挂到 .cf-game 上。 */
function MemButton({ skin, onClick }: {
  skin: 'marian' | 'commander' | 'erosion'; onClick: () => void
}) {
  return (
    <button className={`sb-mem sb-mem-card sb-mem-${skin}`} onClick={onClick} title="内存 / MEMORY">
      <img src={MEM_BTN(skin)} alt="" draggable={false} />
      <span className="sb-mem-lb">内存</span>
    </button>
  )
}

/** 游戏内右上角导航：回退上一节点 / 返回主菜单（对应原版两枚图标按钮） */
function GameNav({ canBack, onBack, onHome }: { canBack: boolean; onBack: () => void; onHome: () => void }) {
  return (
    <div className="cf-gamenav">
      <button className="cf-navbtn" disabled={!canBack} onClick={onBack} title="返回上一节点"><I n="back" /></button>
      <button className="cf-navbtn" onClick={onHome} title="返回主菜单"><I n="exit" /></button>
    </div>
  )
}

export default function FadingCold(p: FadingColdProps) {
  const { data, view, route, pageText, cgSrc, cgAlt, status, choices, ending,
    endingId, memoryUnlocked, found, endings, memories, unlockedMemories } = p

  /* 换幕时序：淡出 → 新幕淡入 → CG 翻页（cf-page-turn .6s + .14s delay）
     → 翻页放完才开始逐字出正文，打字音也跟着一起开始。没有 CG 的页面直接出字。 */
  const hasCg = view === 'game' && !p.isRegionSelect && !!cgSrc
  const [textStart, setTextStart] = useState(!hasCg)
  const typed = useTypewriter(pageText, p.onType, textStart)
  const blks = useBlocks(view === 'game' && !!ending, p.sceneKey)

  useEffect(() => {
    setTextStart(!hasCg)
    if (!hasCg) return
    /* 兜底：动画事件因缓存或降级没回来时，最迟 900ms 后照样开始出字 */
    const t = window.setTimeout(() => setTextStart(true), 900)
    return () => clearTimeout(t)
  }, [p.sceneKey, hasCg])

  /* 打字时把最新内容留在视野里。逐字出字时正文是按「行」跳着长的，
     直接写 scrollTop 就变成跳一下停一下；所以这里只算出目标值存进 targetRef，
     另开一条 rAF 以恒定速度线性追过去。
     只跟开头那一段：用户自己滚一下就彻底让位，到下一幕才重新启用。
     不做「滚回底部自动恢复」——那样会和手指抢页面。 */
  const scrollRef = useRef<HTMLDivElement>(null)
  const followRef = useRef(true)
  const targetRef = useRef(0)
  /* 程序滚动会触发 onScroll，若把它当成「用户自己滚的」，第一次换幕就把跟随关掉了，
     等于自己把自己禁用。所以自己滚的时候记个时间戳，那之后的事件忽略。 */
  const lastAuto = useRef(0)
  function autoScrollTo(el: HTMLElement, top: number) {
    lastAuto.current = Date.now()
    el.scrollTop = top
  }
  function trackFollow() {
    const el = scrollRef.current
    if (!el || Date.now() - lastAuto.current < 120) return
    followRef.current = false
  }
  /* 换幕先瞬回顶部（CG 从头放起），再把目标同步成 0，免得追滚动画从半路滑上来 */
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    autoScrollTo(el, 0)
    targetRef.current = 0
    followRef.current = true
  }, [p.sceneKey])
  /* 逐步定目标：CG 翻页阶段跟画框底部 → 打字阶段跟正文底部 →
     打完跟选项底部，下面没东西了自然就停。 */
  useEffect(() => {
    const el = scrollRef.current
    if (!el || p.isRegionSelect || !followRef.current) return
    const sel = !textStart ? '.cf-fig' : typed.done ? '.cf-opts' : '.cf-script'
    const target = el.querySelector(sel) as HTMLElement | null
    if (!target) return
    targetRef.current = Math.max(0, target.offsetTop + target.offsetHeight - el.clientHeight + 12)
  }, [textStart, typed.shown, typed.done, p.sceneKey, p.isRegionSelect])
  /* 线性追滚：约 340px/s，一步到位改成匀速滑行 */
  useEffect(() => {
    const el = scrollRef.current
    if (!el || view !== 'game' || p.isRegionSelect) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let raf = 0
    let last = performance.now()
    const SPEED = 0.34
    const step = (now: number) => {
      const dt = Math.min(64, now - last)
      last = now
      // 用户已经接手就不再碰 scrollTop，否则会跟他抢页面
      if (followRef.current) {
        const d = targetRef.current - el.scrollTop
        if (Math.abs(d) > 0.5) autoScrollTo(el, el.scrollTop + Math.sign(d) * Math.min(Math.abs(d), SPEED * dt))
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [view, p.isRegionSelect, p.sceneKey])

  const cg = (name?: string, key?: string) => {
    const src = fadingCgSrc(data, name)
    return src ? <figure className="cf-fig" onAnimationEnd={() => setTextStart(true)}><img key={key} src={src} alt={name || ''} /><figcaption><PNGIcon kind="hex" /> <I n="file" /> PLATE</figcaption></figure> : null
  }

  /* ---------- 主菜单（标题屏） ---------- */
  if (view === 'home') {
    return (
      <div className={`fad-cold-root ${p.fade === 'none' ? '' : 'fade-' + p.fade}`}>
        <div id="cf"><div className="stage"><div className="cf cf-fill">
          <div className="cf-frame">
            {/* 动态 CG 挂在 cf-frame 上：它铺满整块面板，也不跟着换幕一起闪 */}
            <FadingIntro fit="cover" className="cf-home-bg" />
            {/* 点缀只借一张原版素材：左上角垂下来的藤蔓。
                不做整页拟物——原版那页档案是单张 baked 图（marian_main_back_bg_01），
                铺上来会把动态 CG 整个盖掉。 */}
            <img className="cf-home-leaf" src="/fading_ui/marian_main_leaf.png" alt="" aria-hidden="true" draggable={false} />
            <div className="cf-inner cf-inner-fill" key={p.view}>
            <div className="cf-home-head">
            <div className="cf-top">
              <span className="cf-top-id"><I n="file" /> <span className="cf-top-full">SILVERGUN PROJECT — </span>ARCHIVE VOL. I</span>
              <span className="cf-top-right">
                <span className="cf-mark"><I n="target" /> MMXXVI</span>
                <button className="cf-sound" onClick={p.onToggleMute}
                  title={p.muted ? '取消静音' : '静音'} aria-pressed={p.muted}>
                  <I n={p.muted ? 'mute' : 'sound'} />
                </button>
                <button className="cf-clear" onClick={p.onClearSave} title="清除存档" aria-label="清除存档"><I n="trash" /></button>
              </span>
            </div>
            <div className="cf-hero">
              <div className="k"><I n="star" fill /> A RECORD OF FADING AFFECTION</div>
              <h1>FADING<em>Affection</em></h1>
              <div className="cf-rule"><i /></div>
              <div className="id"><I n="target" /> SUBJECT MARIA — {found.length ? 'RESTORED' : 'INITIALIZE'}</div>
            </div>
            </div>{/* /cf-home-head */}
            <div className="cf-home-body">
            <div className="cf-home-art" aria-hidden="true">{/* 标题屏这里全留给动态 CG */}</div>
            <div className="cf-home-block">
            <p className="cf-lead">
              三段记录，三种人生。体力、粮食、侵蚀度标记着玛丽亚的处境，
              某些分支只有达成特定状态才会开启——死亡并非终点，
              留下的记忆是解锁新路线与新地点的钥匙。
            </p>
            <div className="cf-acts">
              {/* 原版在主菜单点「탐색 시작」才进关卡选择，这里照做：开始记录 = 切到关卡屏 */}
              <button className="cf-btn on" onClick={() => p.onNavigate('routes')}>
                <I n="play" /> 开始记录
              </button>
              <button className="cf-btn" onClick={() => p.onNavigate('memories')}><I n="mem" /> 记忆 {unlockedMemories.size}/{data.memories.length}</button>
              <button className="cf-btn" onClick={() => p.onNavigate('endings')}><I n="book" /> 回想 {found.length}/{endings.length}</button>
            </div>
            </div>{/* /cf-home-block */}
            </div>{/* /cf-home-body */}
          </div></div>
        </div></div></div>
      </div>
    )
  }

  /* ---------- 关卡选择 ---------- */
  if (view === 'routes') {
    return (
      <div className={`fad-cold-root ${p.fade === 'none' ? '' : 'fade-' + p.fade}`}>
        <div id="cf"><div className="stage"><div className="cf cf-fill">
          <div className="cf-frame">
            <FadingIntro fit="cover" className="cf-home-bg" />
            <img className="cf-home-leaf" src="/fading_ui/marian_main_leaf.png" alt="" aria-hidden="true" draggable={false} />
            <div className="cf-inner cf-inner-fill" key={p.view}>
            <div className="cf-doc-head">
              <button className="cf-back" onClick={() => p.onNavigate('home')}>
                <I n="arrow" /> 返回主菜单
              </button>
              <div className="cf-list-head">
                <h2>记录选择</h2>
                <small>{data.routes.length} RECORDS / SUBJECT MARIA</small>
              </div>
            </div>
            <div className="cf-home-body">
            <div className="cf-home-art" aria-hidden="true">{/* 关卡屏这里留给卡片长高 */}</div>
            <div className="cf-home-block">
            <div className="cf-routes">
              {data.routes.map((r, i) => {
                const ok = p.routeUnlocked(r)
                const req = r.unlockRequirement
                return (
                  <div key={r.no} className={`cf-rc ${ok ? '' : 'lock'}`} onClick={() => ok && p.onStart(r)}
                    style={{ cursor: ok ? 'pointer' : 'not-allowed', ...order(i) }}>
                    {/* 原版关卡卡片的背景就是这张水彩插画，文字压在下方渐隐层上 */}
                    <img className="cf-rc-art" src={ROUTE_ART(r.no)} alt="" aria-hidden="true" loading="lazy" draggable={false} />
                    <span className="cf-rc-scrim" aria-hidden="true" />
                    {ok && r.no === 1 && <span className="cf-rc-new">NEW</span>}
                    <div className="cf-rc-body">
                      <h4>{ok ? r.name : 'NO SIGNAL'}</h4>
                      <p>{ok ? r.desc : `观看【${req?.name ?? '前一条记录的结局'}】后解锁`}</p>
                      <div className="go">{ok ? <>OPEN <PNGIcon kind="arrow" /></> : <><PNGIcon kind="lock" /> LOCKED</>}</div>
                    </div>
                  </div>
                )
              })}
            </div>
            </div>{/* /cf-home-block */}
            </div>{/* /cf-home-body */}
          </div></div>
        </div></div></div>
      </div>
    )
  }

  /* ---------- 回想 / 记忆 ---------- */
  if (view === 'endings' || view === 'memories') {
    return (
      <div className={`fad-cold-root ${p.fade === 'none' ? '' : 'fade-' + p.fade}`}>
        <div id="cf"><div className="stage"><div className="cf cf-fill">
          <div className="cf-frame"><div className="cf-inner cf-inner-fill" key={p.view}>
            <div className="cf-doc-head">
              <button className="cf-back" onClick={() => p.onNavigate(p.backView)}>
                <I n="arrow" /> {p.backView === 'game' ? '返回剧情' : '返回路线选择'}
              </button>
              <div className="cf-list-head">
                <h2>{view === 'endings' ? '回想' : '记忆'}</h2>
                <small>{view === 'endings' ? `${found.length} / ${endings.length} ENDINGS` : `${unlockedMemories.size} / ${data.memories.length} MEMORIES`}</small>
              </div>
            </div>
            <div className="cf-list">
              {view === 'endings' ? (
                <div className="cf-grid">
                  {endings.map((ep) => {
                    const got = found.includes(ep.id)
                    const src = fadingCgSrc(data, ep.cg)
                    return (
                      <div key={ep.id} className={`cf-tile ${got ? '' : 'locked'}`}>
                        <div className="cf-tile-img">{got && src ? <img src={src} alt="" loading="lazy" /> : '?'}</div>
                        <div className="cf-tile-meta">
                          <div className="cf-tile-id">#{String(ep.id).slice(-4)}</div>
                          <div className="cf-tile-name">{got ? ep.ending?.title : '尚未收录的结局'}</div>
                          <div className="cf-tile-hint">{got ? ep.ending?.hint : '继续探索以解锁'}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <>
                  <p className="cf-lead" style={{ textAlign: 'left', margin: '0 0 16px' }}>
                    记录在 NIMPH 里的记忆，是开启新路线的钥匙。
                  </p>
                  <div className="cf-mgrid">
                    {memories.map((m) => {
                      const got = unlockedMemories.has(m.id)
                      return (
                        <div key={m.id} className={`cf-memo ${got ? '' : 'locked'}`}>
                          <div className="cf-memo-id">R{m.route} · {String(m.index).padStart(2, '0')}</div>
                          <div className="cf-memo-name">{got ? m.name : '未储存的记忆'}</div>
                          <div className="cf-memo-short">{got ? m.short : '???'}</div>
                          <div className="cf-memo-desc">{got ? m.desc : '这段记忆尚未找回。'}</div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          </div></div>
        </div></div></div>
      </div>
    )
  }

  /* ---------- 剧情页 ---------- */
  const routeNo = route?.no ?? 1
  const endK = ending ? endKind(endingId) : null
  const endMark = endK ? END_MARK[endK] : null
  /* 剧情正文抽成变量：结局页要在下面再渲染一份加位移滤镜的副本，用方块矩形当遮罩 */
  const body = (
    <>
            {p.isRegionSelect ? (
              <>
                <RegionMap choices={choices} />
                <p className="cf-map-hint">在地图上选择要前往的地区</p>
                <div className="cf-script">{pageText}</div>
              </>
            ) : (
              <>
                {cg(cgAlt || undefined, cgSrc || undefined)}
                <div className={`cf-script ${typed.done ? '' : 'typing'}`}>{typed.shown}</div>
              </>
            )}
            <div className={`cf-opts ${typed.done || p.isRegionSelect ? 'ready' : 'pending'}`}
              style={p.isRegionSelect ? { display: 'none' } : undefined}>
              {choices.map((c, i) => (
                <button key={c.key} className="cf-opt" style={order(i)} disabled={c.disabled}
                  onClick={(e) => { e.stopPropagation(); p.onChoice(c) }}>
                  <span className="ix">{c.index}</span>
                  <span className="tx">
                    {c.locked ? '???' : c.text}
                    {c.hint && !c.locked && <span className="cf-hint"><I n="eye" /> {c.hint}</span>}
                    {c.locked && c.lockText && <span className="cf-hint cf-hint-locked"><I n="lock" /> {c.lockText}</span>}
                    {c.checked && <span className="cf-hint cf-hint-checked">Checked +1%</span>}
                  </span>
                  <span className="arrow"><I n="arrow" /></span>
                </button>
              ))}
              {/* 这不是一个分支，只是「画面可点」的提示，所以不套 .cf-opt 的选项行外壳；
                  仍要 stopPropagation，否则一次点击会既走这里又走 .cf-scroll 的推进 */}
              {p.canNext && !p.isRegionSelect && (
                <button className="cf-next" style={order(choices.length)}
                  onClick={(e) => { e.stopPropagation(); p.onNext() }}>
                  <span className="tx">点击画面继续</span>
                  <span className="arrow"><I n="arrow" /></span>
                </button>
              )}
              {ending && (
                <div className="cf-end-block" style={{ textAlign: 'center', marginTop: 18, ...order(choices.length) }}>
                  {/* 原版这里不是文字，而是一枚按结局类型盖下去的字标 */}
                  <div className="cf-end-mark">
                    {endMark && <img src={endMark.src} alt={endMark.alt} />}
                    <span className="no">#{endingId}</span>
                  </div>
                  <h3 style={{ margin: '18px 0 14px', font: '800 34px/1 "Arial Black",Helvetica,sans-serif', color: 'var(--fink)' }}>{ending.title}</h3>
                  <p style={{ margin: '0 auto', maxWidth: 470, fontSize: 12, lineHeight: 2.1, color: 'var(--fmut)' }}>{ending.hint}</p>
                  {memoryUnlocked && (
                    <div className="unlock" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, margin: '20px 0', padding: '9px 16px', border: '1px solid var(--fline)', color: 'var(--fsteel)', fontSize: 12 }}>
                      <I n="mem" /> 解锁记忆：{memoryUnlocked.name}
                    </div>
                  )}
                  <div className="acts" style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
                    <button className="cf-btn on" onClick={p.onRestart}><I n="refresh" /> 重新记录</button>
                    <button className="cf-btn" onClick={() => p.onNavigate('endings')}><I n="book" /> 回想</button>
                  </div>
                </div>
              )}
            </div>
    </>
  )

  /* 整块面板（章节栏 + 标题 + 正文 + 状态栏）抽成函数：结局页要在它上面再叠一份
     加位移滤镜的副本，干扰范围覆盖整块面板而不只是正文。
     必须带 ghost 标记——两份都挂 scrollRef 的话，React 以后挂载的那个为准，
     跟随逻辑就会去滚那份 pointer-events:none 的副本，真身一动不动。 */
  const renderPanel = (ghost = false) => (
    <>
          <div className="cf-bar">
        <span><I n="arrow" /> CHAPTER {ROMAN[routeNo - 1] ?? routeNo} · {routeNo === 3 ? 'NO.7' : 'MARIA'}</span>
        <span className="cf-bar-route"><I n="file" /> {route?.name || '记录'}</span>
        <span className="cf-bar-right">
          <b><I n="chip" /> MEM {unlockedMemories.size} / ARC {found.length}</b>
          <button className="cf-sound" onClick={p.onToggleMute}
            title={p.muted ? '取消静音' : '静音'} aria-pressed={p.muted}>
            <I n={p.muted ? 'mute' : 'sound'} />
          </button>
          <GameNav canBack={p.canBack} onBack={p.onBack} onHome={() => p.onNavigate('home')} />
        </span>
      </div>
      <div className={`cf-game cf-game-fixed ${ending ? 'cf-end-' + endKind(endingId) : ''}`}>
        <div className="cf-head">
          <div className="ix">{ROMAN[routeNo - 1] ?? routeNo}</div>
          <h3>{route?.name || '记录'}</h3>
          <div className="sub"><I n="target" /> SUBJECT {routeNo === 3 ? 'NO.7' : 'MARIA'} / {String(routeNo).padStart(3, '0')}</div>
        </div>
        {/* key=sceneKey：每换一幕重挂载，让淡入 / CG 翻页 / 选项级联重新播放 */}
        {/* 原版是「点画面」而不是「点那颗按钮」：没打完先补完，打完之后整块正文区都能推进。
            选项按钮自己 stopPropagation，避免一次点击既选分支又推进。 */}
        <div className="cf-scroll" ref={ghost ? undefined : scrollRef}
          onScroll={ghost ? undefined : trackFollow} key={p.sceneKey}
          onClick={ghost ? undefined : () => {
            if (!textStart) return          // CG 还在翻页，这一下不算「点画面」
            if (!typed.done) { typed.skip(); return }
            if (p.canNext) p.onNext()
          }}>
          {body}
        </div>{/* /cf-scroll */}
        <StatusBar status={status} erosionActive={p.erosionActive} />
        <MemButton skin={memSkin(routeNo, endK)} onClick={p.onMemClick} />
      </div>
    </>
  )

  return (
    <div className={`fad-cold-root ${p.fade === 'none' ? '' : 'fade-' + p.fade}`}>
      <div id="cf"><div className="stage"><div className="cf cf-fill">
        <div className="cf-frame">
          <div className="cf-inner cf-inner-fill" key={p.view}>
            {renderPanel()}
            {ending && <div className="cf-ghost" style={maskOf(blks)} aria-hidden="true">{renderPanel(true)}</div>}
            {ending && <EndFx key={p.sceneKey} kind={endKind(endingId)} blks={blks} />}
          </div>
          {/* 边框线自己也被干扰：骑边方块落在哪，哪一段边框就被位移 */}
          {ending && <div className="cf-ghost-frame" style={maskOf(blks)} aria-hidden="true" />}
        </div>
      </div></div></div>
    </div>
  )
}
