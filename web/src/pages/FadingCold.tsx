/**
 * FADING AFFECTION — 冷寂 COLD SILENCE 双主题 UI
 * 纯展示组件：全部装饰由 CSS + 内联 SVG 绘制，剧情图片使用原版 CG。
 * 主题跟随站点 <html data-theme>（light = 灰白纸张，dark = 冷钢灰）。
 */
import type {
  FadingData, FadingRoute, FadingPage, FadingMemory, FadingStatus, FadingStatusChange, FadingStatusFeedback,
} from '../fadingData'
import { fadingCgSrc } from '../fadingData'
import { useFadingUI } from '../fadingI18n'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import FadingIntro from './FadingIntro'
import dossierLayout from './fading_dossier_layout.json'
import './fading-cold.css'

/** 选项/标记的级联序号交给 CSS 变量 */
const order = (i: number) => ({ '--i': String(i) }) as CSSProperties

/* ---------------- 内联 SVG 图标（stroke 用 currentColor，自动跟随主题） ---------------- */
type IconName = 'file' | 'target' | 'chip' | 'mem'
  | 'arrow' | 'lock' | 'star' | 'play' | 'refresh' | 'book' | 'eye' | 'mappin' | 'back' | 'exit'
  | 'sound' | 'mute' | 'trash' | 'hint' | 'sliders' | 'check'

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
  // HINT 徽章：自绘对话标签 + 感叹号，不用原版 marian_icn_hint.png
  hint: <><path d="M3 5h18v12H9l-6 4z" /><path d="M12 8.5v4.5M12 16h.01" /></>,
  // 音频设置：推子（三轨，各带一枚旋钮）
  sliders: <><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h10M18 18h2" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="16" cy="18" r="2" /></>,
  check: <path d="M4 12.5l5.2 5.2L20 6.8" />,
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
 *  DEATH END 在深浅主题都保留原素材红，不随深色主题反色。 */
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
 *  进入暗红侵蚀状态或侵蚀结局时使用白色 erosion 卡面。 */
function memSkin(routeNo: number, kind: string | null, erosion: boolean): 'marian' | 'commander' | 'erosion' {
  if (erosion || kind === 'erosion') return 'erosion'
  return routeNo === 3 ? 'commander' : 'marian'
}
const MEM_BTN = (skin: 'marian' | 'commander' | 'erosion') =>
  `/fading_ui/btn_marian_memory${skin === 'marian' ? '' : '_' + skin}.png`

/** 地区标记在地图上的百分比坐标（按原版游戏截图标定） */
const REGION_POS: Record<'old' | 'lake' | 'city', { x: number; y: number }> = {
  old: { x: 19, y: 62 },
  lake: { x: 41, y: 39 },
  city: { x: 74, y: 30 },
}
const MAP_SRC = '/fading_icons/map_mono.png'

type DossierLayer = {
  id: string; name: string; kind: 'image' | 'text' | 'rect'; visible: boolean; opacity: number
  x: number; y: number; w: number; h: number; z: number; rotate: number
  blend: string; radius: number; group: string
  src?: string; fit?: string; border?: number[]; grayscale?: number; brightness?: number
  text?: string; color?: string; fontSize?: number; weight?: number; align?: string
  lineHeight?: number; letterSpacing?: number; shadow?: string
}

/** 外框 line_01 的描边倍率：只放大 border-width，九宫格 slice 仍取原图像素，纹样不变。 */
const FRAME_BOLD = 1.5

/** 纯白墨迹素材（在深底上可见）。浅色主题下由 CSS 反色成深色，相片和蓝色横幅保持原色。 */
const DOSSIER_INK = new Set([
  'marian_deco_line_01.png', 'marian_deco_line_02.png',
  'marian_deco_line_04.png', 'marian_deco_line_04_v.png',
  'marian_deco_intro_10.png', 'marian_deco_intro_11.png', 'marian_deco_intro_12.png',
  'marian_bg_check.png', 'marian_bg_tag.png',
  'marian_bg_choice_hidden.png', 'marian_divider_02.png',
  'marian_title_intro_01.png',
])

/** 1920×1080 只是编辑器里方便摆素材的工作区，不是设计本身。
 *  这里按所有可见图层的实际范围（含旋转后的签名）算出内容包围盒，
 *  把留白裁掉，让名片本身铺满容器、垂直居中于画面。 */
const DOSSIER_VIEW = (() => {
  // 居中只按名片主体算；签名是浮在上面的装饰，用原坐标跟着变换即可
  const vis = (dossierLayout.layers as unknown as DossierLayer[]).filter(l => l.visible && l.name !== '签名')
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const l of vis) {
    const cx = l.x + l.w / 2, cy = l.y + l.h / 2
    const a = (l.rotate || 0) * Math.PI / 180
    const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a))
    const hw = (l.w * c + l.h * s) / 2, hh = (l.w * s + l.h * c) / 2
    minX = Math.min(minX, cx - hw); maxX = Math.max(maxX, cx + hw)
    minY = Math.min(minY, cy - hh); maxY = Math.max(maxY, cy + hh)
  }
  const padX = (maxX - minX) * 0.02, padY = (maxY - minY) * 0.02
  return { x: minX - padX, y: minY - padY, w: maxX - minX + 2 * padX, h: maxY - minY + 2 * padY }
})()

/** 关卡选择页的 MARIA-7 名片：回放 UI 编辑器导出的图层布局。
 *  和编辑器同一套规则——绝对定位，九宫格 sliced、细条 tiled、字号与边宽用 cqw 等比缩放。
 *  签名是独立图层（-19°、z 最高、不属于「名片」组），因此浮在名片上方。 */
function DossierPlate() {
  const { layers } = dossierLayout as unknown as { layers: DossierLayer[] }
  const V = DOSSIER_VIEW
  const SCALE = 0.88
  const xp = (v: number) => `${+((v - V.x) / V.w * 100).toFixed(4)}%`
  const yp = (v: number) => `${+((v - V.y) / V.h * 100).toFixed(4)}%`
  // 宽高没有原点偏移，不能复用 xp/yp（会把 V.x/V.y 当偏移量扣掉，算成负值）
  const wp = (v: number) => `${+(v / V.w * 100).toFixed(4)}%`
  const hp = (v: number) => `${+(v / V.h * 100).toFixed(4)}%`
  const cqw = (v: number) => `${+(v / V.w * 100).toFixed(4)}cqw`

  type DossierStyle = CSSProperties & { '--dl-raw'?: string }
  const visual = (l: DossierLayer): DossierStyle => {
    const base: CSSProperties = {
      position: 'absolute', left: xp(l.x), top: yp(l.y),
      width: wp(l.w), height: hp(l.h), zIndex: l.z,
      opacity: l.opacity, borderRadius: l.radius || undefined,
      transform: l.rotate ? `rotate(${l.rotate}deg)` : undefined,
      mixBlendMode: (l.blend === 'normal' ? undefined : l.blend) as CSSProperties['mixBlendMode'],
      pointerEvents: 'none',
    }
    if (l.name === '签名') {
      // 签名浮在名片外，用 mask 把白色墨迹染成主题红（不改它的位置/旋转）
      const mask = `url("${l.src}")`
      return {
        ...base, backgroundColor: 'var(--fred, #c05555)',
        WebkitMaskImage: mask, maskImage: mask,
        WebkitMaskSize: '100% 100%', maskSize: '100% 100%',
        WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
      }
    }
    if (l.kind === 'image') {
      const filter = l.grayscale || l.brightness !== 1
        ? `grayscale(${l.grayscale ?? 0}) brightness(${l.brightness ?? 1})` : undefined
      if (l.fit === 'sliced' && l.border?.some(n => n > 0)) {
        const [bL, bB, bR, bT] = l.border.map(Math.round)
        const bold = l.src?.endsWith('marian_deco_line_01.png') ? FRAME_BOLD : 1
        const w = (n: number) => cqw(+(n * bold).toFixed(2))
        const edges = `${w(bT)} ${w(bR)} ${w(bB)} ${w(bL)}`
        return {
          ...base, borderStyle: 'solid', borderColor: 'transparent',
          borderTopWidth: w(bT), borderRightWidth: w(bR),
          borderBottomWidth: w(bB), borderLeftWidth: w(bL),
          // slice 仍是原图像素，只把 width 放大，所以破损纹样不变、只是描边更粗
          borderImage: `url("${l.src}") ${bT} ${bR} ${bB} ${bL} fill / ${edges} / 0 stretch`,
          filter,
        }
      }
      return {
        ...base,
        backgroundImage: `url("${l.src}")`, backgroundPosition: 'center',
        backgroundRepeat: l.fit === 'tiled' ? 'repeat' : 'no-repeat',
        backgroundSize: l.fit === 'fill' || l.fit === 'sliced' ? '100% 100%'
          : l.fit === 'tiled' ? 'auto' : l.fit,
        filter,
      }
    }
    // 文字颜色走 CSS 变量，浅色主题下由 .cf-dl-inktext / .cf-dl-stamp 覆盖
    return {
      ...base, display: 'flex', alignItems: 'center',
      justifyContent: l.align === 'center' ? 'center' : l.align === 'right' ? 'flex-end' : 'flex-start',
      color: 'var(--dl-c, var(--dl-raw))', '--dl-raw': l.color ?? '#ebebeb',
      fontSize: cqw(l.fontSize ?? 18), fontWeight: l.weight,
      textAlign: l.align as CSSProperties['textAlign'], lineHeight: l.lineHeight,
      letterSpacing: cqw(l.letterSpacing ?? 0),
      textShadow: l.shadow || undefined, whiteSpace: 'pre-wrap', overflow: 'hidden',
    }
  }

  return (
    <div className="cf-dossier-canvas" style={{
      aspectRatio: `${V.w} / ${V.h}`,
      // --cf-ds 由 CSS 按屏幕调整：桌面收一点，手机端放宽让名片更大
      width: `min(calc(100% * var(--cf-ds, ${SCALE})), calc(100cqh * ${+(V.w / V.h).toFixed(4)} * var(--cf-ds, ${SCALE})))`,
    }} aria-hidden="true">
      {layers.filter(l => l.visible).slice().sort((a, b) => a.z - b.z).map(l => {
        const ink = l.kind === 'image' && DOSSIER_INK.has(l.src?.split('/').pop() ?? '')
        // TOP SECRET 是深色 multiply 叠在横幅上，浅色主题下要翻成浅色、去掉 multiply
        const stamp = l.kind === 'text' && (l.color ?? '').toUpperCase() === '#171610'
        const lightText = l.kind === 'text' && !stamp
        return (
          <div key={l.id}
            className={`cf-dl${ink ? ' cf-dl-ink' : ''}${lightText ? ' cf-dl-inktext' : ''}${stamp ? ' cf-dl-stamp' : ''}`}
            style={visual(l)}>{l.kind === 'text' ? l.text : null}</div>
        )
      })}
    </div>
  )
}

/** 开场地区选择：原版地图 + 可点标记 */
function RegionMap({ choices }: { choices: ColdChoice[] }) {
  const t = useFadingUI()
  return (
    <div className="cf-map">
      <div className="cf-map-frame">
        <img src={MAP_SRC} alt={t('region_map')} />
        <span className="cf-map-label">{t('field_map')}</span>
        {choices.map((c, i) => {
          const pos = c.region ? REGION_POS[c.region] : { x: 50, y: 50 }
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
const REDACT_NORMAL_MS = 250
const REDACT_GLITCH_MS = 400
const REDACT_TOTAL_MS = REDACT_NORMAL_MS + REDACT_GLITCH_MS

function useTypewriter(text: string, onReveal?: () => void, start = true) {
  const { plain, ranges } = useMemo(() => redactionTimeline(text), [text])
  const [n, setN] = useState(start ? plain.length : 0)
  const [skipped, setSkipped] = useState(false)
  const [activeRedaction, setActiveRedaction] = useState<number | null>(null)
  const nRef = useRef(n)
  const stopped = useRef(false)
  const activeRef = useRef<number | null>(null)
  const rafRef = useRef(0)
  const guardRef = useRef(0)
  const pauseRef = useRef(0)
  const cb = useRef(onReveal)
  cb.current = onReveal
  useEffect(() => {
    cancelAnimationFrame(rafRef.current)
    clearTimeout(guardRef.current)
    clearTimeout(pauseRef.current)
    stopped.current = false
    activeRef.current = null
    nRef.current = 0
    setSkipped(false)
    setActiveRedaction(null)
    setN(0)
    // CG 翻页没放完之前先空着，别提前把正文和打字音放出来
    if (!start) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      nRef.current = plain.length
      setN(plain.length)
      return
    }
    let last = performance.now()
    let carry = 0
    let shown = 0
    const finish = () => {
      stopped.current = true
      activeRef.current = null
      setActiveRedaction(null)
      setSkipped(true)
      nRef.current = plain.length
      setN(plain.length)
    }
    const pause = (index: number) => {
      activeRef.current = index
      setActiveRedaction(index)
      pauseRef.current = window.setTimeout(() => {
        if (stopped.current) return
        activeRef.current = null
        setActiveRedaction(null)
        last = performance.now()
        if (nRef.current < plain.length) rafRef.current = requestAnimationFrame(step)
      }, REDACT_TOTAL_MS + 80)
    }
    const step = (now: number) => {
      if (stopped.current || activeRef.current != null) return
      carry += now - last
      last = now
      let next = nRef.current
      let pauseAt = -1
      while (carry >= TYPE_MS && next < plain.length) {
        next++
        carry -= TYPE_MS
        if (next > shown) { shown = next; cb.current?.() }
        const redaction = ranges.findIndex((r) => r.end === next)
        if (redaction >= 0) { pauseAt = redaction; break }
      }
      nRef.current = next
      setN(next)
      if (pauseAt >= 0) { pause(pauseAt); return }
      if (next < plain.length) rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    /* 后台页面不跑 rAF，兜底把剩余文字和演绎一次补齐，免得选项永远出不来 */
    guardRef.current = window.setTimeout(finish, plain.length * TYPE_MS + ranges.length * (REDACT_TOTAL_MS + 80) + 600)
    return () => {
      stopped.current = true
      cancelAnimationFrame(rafRef.current)
      clearTimeout(guardRef.current)
      clearTimeout(pauseRef.current)
    }
  }, [text, start, plain, ranges])
  return {
    shown: plain.slice(0, n),
    done: n >= plain.length && activeRedaction === null,
    skipped,
    skip: () => {
      stopped.current = true
      activeRef.current = null
      cancelAnimationFrame(rafRef.current)
      clearTimeout(guardRef.current)
      clearTimeout(pauseRef.current)
      setActiveRedaction(null)
      setSkipped(true)
      nRef.current = plain.length
      setN(plain.length)
    },
  }
}

const REDACT_TAG = /\[\[REDACT\]\]([\s\S]*?)\[\[\/REDACT\]\]/g
const REDACT_CHARS = '▓▒░#%&?/\\<>+=*'

function redactionTimeline(text: string): { plain: string; ranges: { start: number; end: number }[] } {
  let plain = ''
  let last = 0
  const ranges: { start: number; end: number }[] = []
  for (const m of text.matchAll(REDACT_TAG)) {
    const at = m.index ?? 0
    plain += text.slice(last, at)
    const start = plain.length
    plain += m[1]
    ranges.push({ start, end: plain.length })
    last = at + m[0].length
  }
  plain += text.slice(last)
  return { plain, ranges }
}

function stripRedactionTags(text: string): string {
  return redactionTimeline(text).plain
}

function scramble(text: string): string {
  return [...text].map((ch) => ch === ' ' ? ' ' : REDACT_CHARS[Math.floor(Math.random() * REDACT_CHARS.length)]).join('')
}

function RedactedSpan({ text, animate }: { text: string; animate: boolean }) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const [stage, setStage] = useState<'normal' | 'glitch' | 'block'>(!animate || reduced ? 'block' : 'normal')
  const [noise, setNoise] = useState(text)
  useLayoutEffect(() => {
    if (!animate || reduced) { setStage('block'); return }
    setStage('normal')
    setNoise(text)
    let timer = 0
    const glitchAt = window.setTimeout(() => {
      setStage('glitch')
      setNoise(scramble(text))
      timer = window.setInterval(() => setNoise(scramble(text)), 50)
    }, REDACT_NORMAL_MS)
    const blockAt = window.setTimeout(() => {
      clearInterval(timer)
      setStage('block')
    }, REDACT_TOTAL_MS)
    return () => { clearTimeout(glitchAt); clearTimeout(blockAt); clearInterval(timer) }
  }, [text, animate, reduced])
  return (
    <span className="cf-redact" aria-label={text} title={text}>
      <span className={`cf-redact-normal${stage === 'normal' ? ' on' : ''}`} aria-hidden="true">{text}</span>
      <span className={`cf-redact-glitch${stage === 'glitch' ? ' on' : ''}`} aria-hidden="true">{noise}</span>
      <span className={`cf-redact-block${stage === 'block' ? ' on' : ''}`} aria-hidden="true" />
    </span>
  )
}

function RedactedText({ text, shownCount, animate = true }: { text: string; shownCount: number; animate?: boolean }) {
  const parts: { text: string; redacted: boolean }[] = []
  let last = 0
  for (const m of text.matchAll(REDACT_TAG)) {
    const at = m.index ?? 0
    if (at > last) parts.push({ text: text.slice(last, at), redacted: false })
    parts.push({ text: m[1], redacted: true })
    last = at + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last), redacted: false })
  let left = Math.max(0, shownCount)
  return (
    <>
      {parts.map((part, i) => {
        if (left <= 0) return null
        const take = Math.min(left, part.text.length)
        left -= take
        if (!part.redacted || take < part.text.length) {
          return <span key={i}>{part.text.slice(0, take)}</span>
        }
        return <RedactedSpan key={i} text={part.text} animate={animate} />
      })}
    </>
  )
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
type BurstBlock = {
  id: number; x: number; y: number; w: number; h: number; c: 'r' | 'c'
  dx: number; dy: number; dx2: number; dy2: number; rot: number; rot2: number; delay: number
}

/** rAF + 时间片生成方块（setInterval 在后台窗口会被节流到秒级，实测差 60 倍）。
 *  每块自己抽签：尺寸分大中小三档，寿命 60~300ms 各自不同；在场数量也是随机重抽的。
 *  strength=0.5 时数量上限与透明度都减半，给侵蚀路线做比结局弱的持续干扰。 */
function useBlocks(active: boolean, sceneKey: number, strength = 1): Blk[] {
  const [blks, setBlks] = useState<Blk[]>([])
  useEffect(() => {
    setBlks([])
    if (!active || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const t0 = Date.now()
    const maxWant = Math.max(1, Math.round(13 * strength))
    const maxBlocks = Math.max(1, Math.round(16 * strength))
    let id = 0, raf = 0, alive = true, on = true, phaseEnd = t0 + 900, want = Math.min(4, maxWant), wantEnd = 0
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
        o: (0.45 + Math.random() * 0.5) * strength,
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
        if (now >= wantEnd) { want = 1 + Math.floor(Math.random() * maxWant); wantEnd = now + 260 + Math.random() * 440 }
        setBlks((prev) => {
          if (!alive) return prev
          const kept = prev.filter((b) => b.until > now)
          if (kept.length === prev.length && kept.length >= want) return prev
          while (kept.length < want) kept.push(mk(now))
          return kept.length > maxBlocks ? kept.slice(0, maxBlocks) : kept
        })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { alive = false; cancelAnimationFrame(raf) }
  }, [active, sceneKey, strength])
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
function EndFx({ kind, blks, strength = 1 }: { kind: string; blks: Blk[]; strength?: number }) {
  const weak = strength < 1
  const filterId = weak ? 'fx-tear-half' : 'fx-tear'
  return (
    <div className={`cf-endfx cf-endfx-${kind}${weak ? ' cf-endfx-weak' : ''}`} aria-hidden="true">
      <svg className="fx-defs" width="0" height="0">
        <filter id={filterId} x="-10%" y="-10%" width="120%" height="120%">
          {/* 横向几乎不变、纵向约 20px 一条 → 位移按粗水平条带整体错位，是撕裂不是磨砂 */}
          <feTurbulence type="fractalNoise" baseFrequency="0.002 0.05" numOctaves="1" seed="3" result="n">
            <animate attributeName="seed" values="2;9;17;4;12;6" dur="0.28s" repeatCount="indefinite" calcMode="discrete" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="n" xChannelSelector="R" yChannelSelector="G" scale={26 * strength} />
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
  statusChange?: FadingStatusChange
  disabled?: boolean
  /** 带 HINT 的锁定项：点击只弹提示、不推进剧情 */
  hintOnly?: boolean
  region?: 'old' | 'lake' | 'city'
  onClick: () => void
}
function OptionStatusChange({ change }: { change: FadingStatusChange | undefined }) {
  const t = useFadingUI()
  if (!change) return null
  const items: { kind: 'hp' | 'food' | 'erosion'; label: string; value: number }[] = [
    { kind: 'hp', label: t('hp'), value: change.hp },
    { kind: 'food', label: t('food'), value: change.food },
    { kind: 'erosion', label: t('erosion'), value: change.erosion },
  ]
  const shown = items.filter((item) => item.value !== 0)
  if (shown.length === 0) return null
  return (
    <span className="cf-changes">
      {shown.map(({ kind, label, value }) => (
        <span className="cf-change" key={kind} title={`${label} ${value > 0 ? '+' : ''}${value}`}
          aria-label={`${label} ${value > 0 ? '+' : ''}${value}`}>
          <PNGIcon kind={kind} /><b>{value > 0 ? '+' : ''}{value}</b>
        </span>
      ))}
    </span>
  )
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
  /** 侵蚀状态爆发的一次性音效 */
  onErosionBurst?: () => void
  /** 当前路线状态；上限与名称仍取 Manager 表 */
  status: FadingStatus
  statusFeedback: FadingStatusFeedback | null
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
  /** 点击锁定的 HINT 选项时弹出的提示横幅文本（null = 不显示） */
  hintToast: string | null
  hintClosing: boolean
  onHint: (text: string) => void
  onClearSave: () => void
  onMemClick: () => void
  routeUnlocked: (r: FadingRoute) => boolean
  /** 卡片右上角的 NEW（prefab 里的 reddot_v2）：这条路线还没被打开过 */
  routeIsNew: (r: FadingRoute) => boolean
  /** 音频静音开关（文件由 build/export_fading_audio.py 导出） */
  muted: boolean
  onToggleMute: () => void
  /** 音量（0~1）：bgm 管音乐层与环境音床，sfx 管音效 / UI / 打字 */
  gains: { bgm: number; sfx: number }
  onGainChange: (k: 'bgm' | 'sfx', v: number) => void
  onGainReset: () => void
}

/** 弹窗通用行为：Esc 关闭。onClose 每次渲染都是新函数，用 ref 兜住只绑一次。 */
function useDialogClose(onClose: () => void) {
  const fn = useRef(onClose)
  fn.current = onClose
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') fn.current() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
}

/** 记忆分三类（LootItem 表）：已储存 / 已删除 / 仅剩一部分 */
const MEM_KIND_KEY = {
  save: 'kind_save', deleted: 'kind_deleted', fragment: 'kind_fragment',
} as const

/** 音频设置弹窗：两条推子（音乐 / 音效）+ 静音、重置、完成。
 *  铺在外框内的居中遮罩上——手机竖屏也保证完整可见，不会像下来菜单那样贴边溢出。 */
function AudioSettingsDialog({ p, onClose }: { p: FadingColdProps; onClose: () => void }) {
  const t = useFadingUI()
  const box = useRef<HTMLDivElement>(null)
  useDialogClose(onClose)
  /* 打开时把焦点放到第一根推子，键盘左右键就能调 */
  useEffect(() => { box.current?.querySelector<HTMLInputElement>('input')?.focus() }, [])
  const rows: { k: 'bgm' | 'sfx'; label: string; hint: string }[] = [
    { k: 'bgm', label: t('music'), hint: t('music_hint') },
    { k: 'sfx', label: t('sfx'), hint: t('sfx_hint') },
  ]
  return (
    <div className="cf-modal" role="dialog" aria-modal="true" aria-label={t('audio_settings')}>
      {/* 遮罩本身是按钮：点空白处关闭，键盘也能落到它上面 */}
      <button className="cf-modal-scrim" onClick={onClose} aria-label={t('close_audio')} tabIndex={-1} />
      <div className="cf-modal-box" ref={box}>
        <div className="cf-modal-head">
          <span>
            <h3>{t('audio_settings')}</h3>
            <small>AUDIO / VOLUME</small>
          </span>
          <button className="cf-modal-x" onClick={onClose} title={t('close')} aria-label={t('close')}>×</button>
        </div>
        {rows.map(({ k, label, hint }) => {
          const v = Math.round(p.gains[k] * 100)
          return (
            <label className="cf-set-row" key={k}>
              <span className="cf-set-lb">{label}<em>{hint}</em></span>
              <input type="range" min={0} max={100} step={1} value={v}
                aria-label={`${label} VOLUME`}
                onChange={(e) => p.onGainChange(k, Number(e.target.value) / 100)} />
              <span className="cf-set-val">{v}</span>
            </label>
          )
        })}
        <div className="cf-set-foot">
          <button className={`cf-set-btn${p.muted ? ' on' : ''}`} onClick={p.onToggleMute}>
            <I n={p.muted ? 'mute' : 'sound'} /> {p.muted ? t('muted') : t('mute_all')}
          </button>
          <span className="cf-set-foot-r">
            <button className="cf-set-btn" onClick={p.onGainReset}>{t('reset_default')}</button>
            <button className="cf-set-btn solid" onClick={onClose}>{t('done')}</button>
          </span>
        </div>
      </div>
    </div>
  )
}

/** 详情弹窗要显示的东西：一个结局页，或一条记忆 */
type Peek = { kind: 'ending'; page: FadingPage } | { kind: 'memory'; mem: FadingMemory }

/** 回想 / 记忆详情：列表里只放摘要，完整正文在这里读。
 *  结局页的 body（ending.text）本来就在页面表里，卡片上只露了 title / hint。 */
function PeekDialog({ p, peek, onClose }: { p: FadingColdProps; peek: Peek; onClose: () => void }) {
  const t = useFadingUI()
  useDialogClose(onClose)

  if (peek.kind === 'memory') {
    const m = peek.mem
    return (
      <div className="cf-modal" role="dialog" aria-modal="true" aria-label={t('memory_detail')}>
        <button className="cf-modal-scrim" onClick={onClose} aria-label={t('close')} tabIndex={-1} />
        <div className="cf-modal-box cf-peek">
          <div className="cf-modal-head">
            <span>
              <h3>{m.name}</h3>
              <small>R{m.route} · {String(m.index).padStart(2, '0')} · {t(MEM_KIND_KEY[m.kind])}</small>
            </span>
            <button className="cf-modal-x" onClick={onClose} title={t('close')} aria-label={t('close')}>×</button>
          </div>
          <p className="cf-peek-short">{m.short}</p>
          <p className="cf-peek-text">{m.desc}</p>
        </div>
      </div>
    )
  }

  const page = peek.page
  const src = fadingCgSrc(p.data, page.cg)
  const mark = END_MARK[endKind(page.id)]
  return (
    <div className="cf-modal" role="dialog" aria-modal="true" aria-label={t('ending_detail')}>
      <button className="cf-modal-scrim" onClick={onClose} aria-label={t('close')} tabIndex={-1} />
      <div className="cf-modal-box cf-peek">
        <div className="cf-modal-head">
          <span>
            <h3>{page.ending?.title}</h3>
            <small>#{String(page.id).slice(-4)} · ENDING · ROUTE {ROMAN[(page.route ?? 1) - 1] ?? 'I'}</small>
          </span>
          <button className="cf-modal-x" onClick={onClose} title={t('close')} aria-label={t('close')}>×</button>
        </div>
        {src && <figure className="cf-peek-art"><img src={src} alt={page.cg || ''} /></figure>}
        <p className="cf-peek-text"><RedactedText text={page.text} shownCount={stripRedactionTags(page.text).length} animate={false} /></p>
        {page.ending?.hint && <p className="cf-peek-hint">{page.ending.hint}</p>}
        {mark && <div className={`cf-peek-mark cf-peek-mark-${endKind(page.id)}`}><img src={mark.src} alt={mark.alt} /></div>}
      </div>
    </div>
  )
}

/** 设置键：开合状态提到 FadingCold，弹窗要渲染在外框层（不能被正文区裁掉）。 */
function AudioSettingsButton({ open, onOpen }: { open: boolean; onOpen: () => void }) {
  const t = useFadingUI()
  return (
    <button className={`cf-sound${open ? ' on' : ''}`} onClick={onOpen}
      title={t('audio_settings')} aria-haspopup="dialog" aria-expanded={open}>
      <I n="sliders" />
    </button>
  )
}

const STATUS_GLYPHS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ#@%&?/\\|<>+=*'

function AnimatedValue({ value }: { value: number }) {
  const [shown, setShown] = useState(String(value))
  const previous = useRef(value)
  useEffect(() => {
    const from = previous.current
    previous.current = value
    if (from === value || value > from) {
      setShown(String(value))
      return
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(String(value))
      return
    }
    const scramble = () => Array.from({ length: 3 }, () => STATUS_GLYPHS[Math.floor(Math.random() * STATUS_GLYPHS.length)]).join('')
    const started = performance.now()
    setShown(scramble())
    const timer = window.setInterval(() => {
      if (performance.now() - started < 240) setShown(scramble())
      else {
        window.clearInterval(timer)
        setShown(String(value))
      }
    }, 48)
    return () => window.clearInterval(timer)
  }, [value])
  return <span className="sb-num">{shown}</span>
}

/** 状态栏：体力/粮食上排，侵蚀长条下排。内存按钮不在这里（见 MemButton）。 */
function StatusBar({ status, defs, erosionActive, feedback }: {
  status: FadingStatus; defs: FadingData['status']; erosionActive: boolean
  feedback: FadingStatusFeedback | null
}) {
  const t = useFadingUI()
  const find = (k: 'hp' | 'food' | 'erosion') => defs.items.find((s) => s.key === k)
  const hp = find('hp'), food = find('food'), eros = find('erosion')
  const pct = eros?.max ? Math.round((status.erosion / eros.max) * 100) : 0
  const mark = eros?.max && eros.second < eros.max
    ? Math.round((eros.second / eros.max) * 100) : null
  return (
    <div className="sb sb-f">
      <div className="sb-main">
        {/* 体力/粮食只留图标与数字，名称不再写出来（图标本身就是识别符） */}
        <div className="sb-row1">
          <div className="sb-stat-wrap">
            <div className="sb-stat" title={hp ? `${hp.name} ${hp.max}` : undefined}>
              <PNGIcon kind="hp" />
              <b><AnimatedValue value={status.hp} /><small>/{hp?.max ?? defs.max.hp}</small></b>
            </div>
            {feedback && feedback.hp < 0 && (
              <span key={`hp-${feedback.id}`} className="sb-delta sb-delta-hp" aria-hidden="true">
                <PNGIcon kind="hp" />{feedback.hp}
              </span>
            )}
          </div>
          <div className="sb-stat-wrap">
            <div className="sb-stat" title={food ? `${food.name} ${food.max}` : undefined}>
              <PNGIcon kind="food" />
              <b><AnimatedValue value={status.food} /><small>/{food?.max ?? defs.max.food}</small></b>
            </div>
            {feedback && feedback.food < 0 && (
              <span key={`food-${feedback.id}`} className="sb-delta sb-delta-food" aria-hidden="true">
                <PNGIcon kind="food" />{feedback.food}
              </span>
            )}
          </div>
        </div>
        <div className={`sb-row2 ${erosionActive ? '' : 'off'}`}>
          {erosionActive ? (
            <>
              <span className="sb-lb"><PNGIcon kind="erosion" /> {eros?.name || t('erosion')}</span>
              <div className="sb-track">
                <i style={{ width: `${pct}%` }} />
                {mark != null && <em style={{ left: `${mark}%` }} title={t('erosion_threshold', { n: eros?.second ?? 0 })} />}
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
  const t = useFadingUI()
  return (
    <button className={`sb-mem sb-mem-card sb-mem-${skin}`} onClick={onClick} title={t('memory_card_title')}>
      <img src={MEM_BTN(skin)} alt="" draggable={false} />
      <span className="sb-mem-lb">{t('memory')}</span>
    </button>
  )
}

/** 游戏内右上角导航：回退上一节点 / 返回主菜单（对应原版两枚图标按钮） */
function GameNav({ canBack, onBack, onHome }: { canBack: boolean; onBack: () => void; onHome: () => void }) {
  const t = useFadingUI()
  return (
    <div className="cf-gamenav">
      <button className="cf-navbtn" disabled={!canBack} onClick={onBack} title={t('back_node')}><I n="back" /></button>
      <button className="cf-navbtn" onClick={onHome} title={t('back_home')}><I n="exit" /></button>
    </div>
  )
}

export default function FadingCold(p: FadingColdProps) {
  const t = useFadingUI()
  const { data, view, route, pageText, cgSrc, cgAlt, status, choices, ending,
    endingId, memoryUnlocked, found, endings, memories, unlockedMemories } = p

  /* 换幕时序：淡出 → 新幕淡入 → CG 翻页（cf-page-turn .6s + .14s delay）
     → 翻页放完才开始逐字出正文，打字音也跟着一起开始。没有 CG 的页面直接出字。 */
  const hasCg = view === 'game' && !p.isRegionSelect && !!cgSrc
  const routeNo = route?.no ?? 1
  const endK = ending ? endKind(endingId) : null
  const erosionThreshold = data.status.items.find((s) => s.key === 'erosion')?.second ?? 50
  const erosionRevealed = endK === 'erosion' || (p.erosionActive && status.erosion >= erosionThreshold)
  const erosionMode = erosionRevealed && (view === 'game'
    || ((view === 'endings' || view === 'memories') && p.backView === 'game'))
  const [erosionBurst, setErosionBurst] = useState(false)
  const [burstBlocks, setBurstBlocks] = useState<BurstBlock[]>([])
  const rootClass = `fad-cold-root${erosionMode ? ' cf-erosion-state' : ''}${erosionBurst ? ' cf-erosion-burst' : ''}${p.fade === 'none' ? '' : ' fade-' + p.fade}`
  useLayoutEffect(() => {
    if (!erosionMode || ending) { setErosionBurst(false); setBurstBlocks([]); return }
    setBurstBlocks(Array.from({ length: 7 }, (_, i) => {
      const dx = (Math.random() - .5) * 54
      const dy = (Math.random() - .5) * 30
      const rot = (Math.random() - .5) * 10
      return {
        id: i,
        x: -18 + Math.random() * 96,
        y: -10 + Math.random() * 90,
        w: 14 + Math.random() * 18,
        h: 8 + Math.random() * 12,
        c: i % 2 === 0 ? 'c' : 'r',
        dx, dy, dx2: -dx * .6, dy2: -dy * .6, rot, rot2: -rot * .5,
        delay: Math.random() * .12,
      }
    }))
    p.onErosionBurst?.()
    setErosionBurst(true)
    const t = window.setTimeout(() => { setErosionBurst(false); setBurstBlocks([]) }, 300)
    return () => clearTimeout(t)
  }, [erosionMode, ending])
  /* 手机端全屏：把小游戏面板本身全屏，站点导航栏自然被排除在全屏元素之外 */
  /* 音频设置弹窗：挂在组件层，弹窗渲染到外框上（见 .cf-modal） */
  const [settingsOpen, setSettingsOpen] = useState(false)
  /* 回想 / 记忆的详情弹窗：卡片只放摘要，点开才读全文 */
  const [peek, setPeek] = useState<Peek | null>(null)
  /* 「重新记录」的即时提示：跟 HINT 那条同一套外观，只是停留更短 */
  const [toast, setToast] = useState<string | null>(null)
  const [toastOut, setToastOut] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  /* 提示条：HINT 那条是 3s，这里 1.2s 就走——只是告诉玩家「记下了」，不用留那么久 */
  useEffect(() => {
    if (!toast || toastOut) return
    const t = window.setTimeout(() => setToastOut(true), 1200)
    return () => clearTimeout(t)
  }, [toast, toastOut])
  useEffect(() => {
    if (!toastOut) return
    const t = window.setTimeout(() => { setToast(null); setToastOut(false) }, 280)
    return () => clearTimeout(t)
  }, [toastOut])
  /** 弹一条短提示（同一条被再次触发时重新计时） */
  function notify(msg: string) {
    setToastOut(false)
    setToast(msg)
  }
  function toggleFullscreen() {
    const root = document.querySelector('.fad-cold-root')
    if (!root) return
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else root.requestFullscreen?.().catch(() => {})
  }
  const [textStart, setTextStart] = useState(!hasCg)
  const typed = useTypewriter(pageText, p.onType, textStart)
  const erosionFx = view === 'game' && !ending && erosionMode
  const fxActive = view === 'game' && (!!ending || erosionFx)
  const fxStrength = ending || erosionBurst ? 1 : 0.5
  const blks = useBlocks(fxActive, ending ? p.sceneKey : erosionBurst ? -1 : 0, fxStrength)

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
     等于自己把自己禁用。判断方式用位置比对而不是时间窗：只有位置还停在「我们刚写进去的」
     那个值上才算自己滚的。
     时间窗法（旧实现：写完 120ms 内忽略）有两个坑：
       1) 目标超过最大滚动量时永远差最后几像素，循环每帧都在写，时间戳一直被刷新，
          鼠标滚轮永远抢不回页面；
       2) 逐字出字时目标一直在长，同样会一直刷新。 */
  const autoTop = useRef(0)
  /** 把目标夹进 [0, maxScroll]：超出的部分永远到不了，只会让循环空转、把滚轮锁死。 */
  function clampTarget(el: HTMLElement, top: number) {
    const max = Math.max(0, el.scrollHeight - el.clientHeight)
    return Math.min(Math.max(0, top), max)
  }
  function autoScrollTo(el: HTMLElement, top: number) {
    const to = clampTarget(el, top)
    if (Math.abs(el.scrollTop - to) < 0.5) return
    el.scrollTop = to
    autoTop.current = el.scrollTop
  }
  function trackFollow() {
    const el = scrollRef.current
    if (!el) return
    /* 浏览器可能把小数 scrollTop 取整，留 1px 容差 */
    if (Math.abs(el.scrollTop - autoTop.current) <= 1) return
    followRef.current = false
  }
  /** 点击画面：如果还在追滚途中，直接落到终点，别让用户等动画 */
  function jumpScroll() {
    const el = scrollRef.current
    if (!el || !followRef.current) return false
    if (Math.abs(clampTarget(el, targetRef.current) - el.scrollTop) <= 2) return false
    autoScrollTo(el, targetRef.current)
    return true
  }
  /* 换幕先瞬回顶部（CG 从头放起），再把目标同步成 0，免得追滚动画从半路滑上来 */
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    autoScrollTo(el, 0)
    autoTop.current = el.scrollTop
    targetRef.current = 0
    followRef.current = true
  }, [p.sceneKey])
  /* 逐步定目标：CG 翻页阶段跟画框底部 → 打字阶段跟正文底部 →
     打完跟选项底部，下面没东西了自然就停。 */
  /** 当前该跟到哪一块：页面顶部的滚动目标由打字阶段决定，循环里重算时也要用同一个 */
  const followSel = useRef('.cf-script')
  followSel.current = !textStart ? '.cf-fig' : typed.done ? '.cf-opts' : '.cf-script'
  function measureTarget(el: HTMLElement) {
    const t = el.querySelector(followSel.current) as HTMLElement | null
    if (!t) return
    targetRef.current = Math.max(0, t.offsetTop + t.offsetHeight - el.clientHeight + 12)
  }
  useEffect(() => {
    const el = scrollRef.current
    if (!el || p.isRegionSelect || !followRef.current) return
    measureTarget(el)
  }, [textStart, typed.shown, typed.done, p.sceneKey, p.isRegionSelect])
  /* 线性追滚：约 340px/s，一步到位改成匀速滑行 */
  useEffect(() => {
    const el = scrollRef.current
    if (!el || view !== 'game' || p.isRegionSelect) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let raf = 0
    let last = performance.now()
    let lastMeasure = 0
    const SPEED = 0.34
    const step = (now: number) => {
      const dt = Math.min(64, now - last)
      last = now
      // 用户已经接手就不再碰 scrollTop，否则会跟他抢页面
      if (followRef.current) {
        /* 每半秒重量一次：CG 加载完、字体回流会把先算好的目标顶偏，
           不重算的话页面会停在中途，结局的按钮就被留在屏幕外。 */
        if (now - lastMeasure > 500) { lastMeasure = now; measureTarget(el) }
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
      <div className={rootClass}>
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
                {/* 开发工具的统一写法：字面量 import.meta.env.DEV 守卫会在生产构建里
                    连 children 一起被摇掉；不要封装成组件，否则链接文字仍会进包。 */}
                {import.meta.env.DEV && (
                  <>
                    <a className="cf-devlink" href="/game/fadingaffection/editor" title={t('dev_ui_editor')}>🛠 UI 编辑器</a>
                    <button className="cf-devlink" title={t('dev_unlock_all')} onClick={() => {
                      const pages = Object.values(p.data.pages)
                      localStorage.setItem('nikke_fading_seen_v1', JSON.stringify(pages.map(x => x.id)))
                      localStorage.setItem('nikke_fading_endings_v1', JSON.stringify(pages.filter(x => x.ending).map(x => x.id)))
                      location.reload()
                    }}>🔓 全解锁</button>
                  </>
                )}
                {/* 手机端顶栏位置用来放全屏（正式功能）；dev 按钮由 CSS 在窄屏隐藏 */}
                <button className="cf-devlink cf-fullscreen" onClick={toggleFullscreen}
                  title={isFullscreen ? t('exit_fullscreen') : t('game_fullscreen')}>
                  {isFullscreen ? `⛶ ${t('close')}` : `⛶ ${t('game_fullscreen')}`}
                </button>
                <button className="cf-sound" onClick={p.onToggleMute}
                  title={p.muted ? t('unmute') : t('mute')} aria-pressed={p.muted}>
                  <I n={p.muted ? 'mute' : 'sound'} />
                </button>
                <AudioSettingsButton open={settingsOpen} onOpen={() => setSettingsOpen(true)} />
                <button className="cf-clear" onClick={p.onClearSave} title={t('clear_save')} aria-label={t('clear_save')}><I n="trash" /></button>
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
            {/* 动作按钮贴在分割线上方，导语落到线下——标题屏没有卡片，
                按钮留在原位会让下半块空成一片。 */}
            <div className="cf-acts cf-home-acts">
              {/* 原版在主菜单点「탐색 시작」才进关卡选择，这里照做：开始记录 = 切到关卡屏 */}
              <button className="cf-btn on" onClick={() => p.onNavigate('routes')}>
                <I n="play" /> {t('start_record')}
              </button>
              <Link className="cf-btn cf-story-link" to="/story/663" title={t('enter_story')}>
                <I n="book" /> {t('story')}
              </Link>
              <button className="cf-btn" onClick={() => p.onNavigate('memories')}><I n="mem" /> {t('memories')} {unlockedMemories.size}/{data.memories.length}</button>
              <button className="cf-btn" onClick={() => p.onNavigate('endings')}><I n="book" /> {t('endings')} {found.length}/{endings.length}</button>
            </div>
            <div className="cf-home-block">
            <p className="cf-lead">
              {t('home_lead')}
            </p>
            </div>{/* /cf-home-block */}
            </div>{/* /cf-home-body */}
          </div>
          </div>
          {/* 弹窗挂在外框之外、.cf 之内：手机端能吃到面板的全部宽度，不被 14px 外边距再削一圈 */}
          {settingsOpen && <AudioSettingsDialog p={p} onClose={() => setSettingsOpen(false)} />}
        </div></div></div>
      </div>
    )
  }

  /* ---------- 关卡选择 ---------- */
  if (view === 'routes') {
    return (
      <div className={rootClass}>
        <div id="cf"><div className="stage"><div className="cf cf-fill">
          <div className="cf-frame">
            <div className="cf-inner cf-inner-fill" key={p.view}>
            <div className="cf-doc-head">
              <button className="cf-back" onClick={() => p.onNavigate('home')}>
                <I n="arrow" /> {t('back_home')}
              </button>
              <div className="cf-list-head">
                <h2>{t('route_select')}</h2>
                <small>{data.routes.length} RECORDS / SUBJECT MARIA</small>
              </div>
            </div>
            <div className="cf-home-body">
            <div className="cf-home-art"><DossierPlate /></div>
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
                    {/* 原版这枚是 reddot_v2 里的 board_new，用同一张 stamp 素材，
                        只有「已解锁但还没进去过」的路线才亮 */}
                    {ok && p.routeIsNew(r) && (
                      <img className="cf-rc-new" src="/fading_ui/marian_icn_new.png" alt="NEW" draggable={false} />
                    )}
                    <div className="cf-rc-body">
                      <h4>{ok ? r.name : 'NO SIGNAL'}</h4>
                      <p>{ok ? r.desc : t('unlock_after_ending', { name: req?.name || t('previous_ending') })}</p>
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
      <div className={rootClass}>
        <div id="cf"><div className="stage"><div className="cf cf-fill">
          <div className="cf-frame"><div className="cf-inner cf-inner-fill" key={p.view}>
            <div className="cf-doc-head">
              <button className="cf-back" onClick={() => p.onNavigate(p.backView)}>
                <I n="arrow" /> {p.backView === 'game' ? t('back_story') : t('back_routes')}
              </button>
              <div className="cf-list-head">
                <h2>{view === 'endings' ? t('endings') : t('memories')}</h2>
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
                      <div key={ep.id} className={`cf-tile ${got ? '' : 'locked'}`}
                        onClick={got ? () => setPeek({ kind: 'ending', page: ep }) : undefined}
                        role={got ? 'button' : undefined} tabIndex={got ? 0 : undefined}
                        onKeyDown={got ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPeek({ kind: 'ending', page: ep }) }
                        } : undefined}>
                        <div className="cf-tile-img">{got && src ? <img src={src} alt="" loading="lazy" /> : '?'}</div>
                        <div className="cf-tile-meta">
                          <div className="cf-tile-id"><span>#{String(ep.id).slice(-4)}</span>{got && <I n="arrow" />}</div>
                          <div className="cf-tile-name">{got ? ep.ending?.title : t('ending_locked')}</div>
                          <div className="cf-tile-hint">{got ? ep.ending?.hint : t('explore_unlock')}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <>
                  <p className="cf-lead" style={{ textAlign: 'left', margin: '0 0 16px' }}>
                    {t('memories_lead')}
                  </p>
                  <div className="cf-mgrid">
                    {memories.map((m) => {
                      const got = unlockedMemories.has(m.id)
                      return (
                        /* 卡片只留前三行（编号 / 名称 / 短句），完整记录点开才读——
                           原文 desc 有 3~4 行，铺在卡片上会把网格撑成一堵墙 */
                        <div key={m.id} className={`cf-memo ${got ? '' : 'locked'}`}
                          onClick={got ? () => setPeek({ kind: 'memory', mem: m }) : undefined}
                          role={got ? 'button' : undefined} tabIndex={got ? 0 : undefined}
                          onKeyDown={got ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPeek({ kind: 'memory', mem: m }) }
                          } : undefined}>
                          <div className="cf-memo-id">
                            <span>R{m.route} · {String(m.index).padStart(2, '0')}</span>
                            {got && <I n="arrow" />}
                          </div>
                          <div className="cf-memo-name">{got ? m.name : t('memory_locked')}</div>
                          <div className="cf-memo-short">{got ? m.short : '???'}</div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          </div></div>
          {peek && <PeekDialog p={p} peek={peek} onClose={() => setPeek(null)} />}
        </div></div></div>
      </div>
    )
  }

  /* ---------- 剧情页 ---------- */
  const endMark = endK ? END_MARK[endK] : null
  /** 这次结局是否已经进过档案：重复到达时，横幅 / 说明行 / 记录提示都要换说法 */
  const endRecorded = endingId != null && found.includes(endingId)
  /* 剧情正文抽成变量：结局页要在下面再渲染一份加位移滤镜的副本，用方块矩形当遮罩 */
  const body = (
    <>
            {p.isRegionSelect ? (
              <>
                <RegionMap choices={choices} />
                <p className="cf-map-hint">{t('choose_region')}</p>
                <div className="cf-script"><RedactedText text={pageText} shownCount={stripRedactionTags(pageText).length} /></div>
              </>
            ) : (
              <>
                {cg(cgAlt || undefined, cgSrc || undefined)}
                <div className={`cf-script ${typed.done ? '' : 'typing'}`}><RedactedText text={pageText} shownCount={typed.shown.length} animate={!typed.skipped} /></div>
              </>
            )}
            <div className={`cf-opts ${typed.done || p.isRegionSelect ? 'ready' : 'pending'}`}
              style={p.isRegionSelect ? { display: 'none' } : undefined}>
              {choices.map((c, i) => (
                <button key={c.key} className={`cf-opt${c.hintOnly ? ' cf-opt-hintlocked' : ''}`}
                  style={order(i)} disabled={c.disabled}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (c.hintOnly && c.hint) p.onHint(c.hint)
                    else p.onChoice(c)
                  }}>
                  <span className="ix">{c.index}</span>
                  <span className="tx">
                    {c.locked ? '???' : <RedactedText text={c.text} shownCount={stripRedactionTags(c.text).length} animate={typed.done || !!p.isRegionSelect} />}
                    {c.hint && !c.locked && <span className="cf-hint"><I n="eye" /> {c.hint}</span>}
                    {c.locked && c.lockText && <span className="cf-hint cf-hint-locked"><I n="lock" /> {c.lockText}</span>}
                    {/* 已选过：自绘角标，和 HINT 徽章同一套语言（等宽大写 + 对勾 + 悬停反色）。
                        原作只有一枚「Checked」戳、没有百分比，早年那行「Checked +1%」的 +1% 是编的。 */}
                    {c.checked && <span className="cf-checked"><I n="check" />CHECKED</span>}
                  </span>
                  {c.checked && !c.locked && <OptionStatusChange change={c.statusChange} />}
                  {/* HINT 徽章常驻：原版即使选项被锁（如未拿到「袭击」）也贴着 HINT，
                      解锁条件只管提示文字 / 能不能点。徽章占据右侧箭头的位置。 */}
                  {c.hint
                    ? <span className="cf-hint-badge"><I n="hint" /> HINT</span>
                    : <span className="arrow"><I n="arrow" /></span>}
                </button>
              ))}
              {/* 这不是一个分支，只是「画面可点」的提示，所以不套 .cf-opt 的选项行外壳；
                  仍要 stopPropagation，否则一次点击会既走这里又走 .cf-scroll 的推进 */}
              {p.canNext && !p.isRegionSelect && (
                <button className="cf-next" style={order(choices.length)}
                  onClick={(e) => { e.stopPropagation(); p.onNext() }}>
                  <span className="tx">{t('click_continue')}</span>
                  <span className="arrow"><I n="arrow" /></span>
                </button>
              )}
              {ending && (
                <div className="cf-end-block" style={{ textAlign: 'center', marginTop: 18, ...order(choices.length) }}>
                  {/* 原版这里不是文字，而是一枚按结局类型盖下去的字标 */}
                  <div className={`cf-end-mark cf-end-mark-${endK}`}>
                    {endMark && <img src={endMark.src} alt={endMark.alt} />}
                    <span className="no">#{endingId}</span>
                  </div>
                  <h3 style={{ margin: '18px 0 14px', font: '800 34px/1 "Arial Black",Helvetica,sans-serif', color: 'var(--fink)' }}>{ending.title}</h3>
                  <p style={{ margin: '0 auto', maxWidth: 470, fontSize: 12, lineHeight: 2.1, color: 'var(--fmut)' }}>{ending.hint}</p>
                  {memoryUnlocked && (
                    /* 结局页落上去只是「待确认」：这段记忆要按「重新记录」才写进存档，
                       点「返回上一节点」等于放弃，所以文案要跟状态走 */
                    <div className="unlock" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, margin: '20px 0', padding: '9px 16px', border: '1px solid var(--fline)', color: 'var(--fsteel)', fontSize: 12 }}>
                      <I n="mem" /> {endRecorded ? t('memory_saved_prefix') : t('memory_pending_prefix')}{memoryUnlocked.short}
                    </div>
                  )}
                  <div className="acts" style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
                    <button className="cf-btn on" onClick={(e) => {
                      e.stopPropagation()
                      /* 文案在点击这一刻抓下来：紧接着就会换幕回到路线开场，ending 会变成 null */
                      notify(endRecorded ? t('no_new_record') : t('recorded', { name: ending.title }))
                      p.onRestart()
                    }}>
                      <I n="refresh" /> {t('restart')}
                    </button>
                    <button className="cf-btn" onClick={(e) => { e.stopPropagation(); p.onNavigate('endings') }}>
                      <I n="book" /> {t('endings')}
                    </button>
                  </div>
                  {/* 这一行把规则说清楚：结局页只是待确认，返回上一节点不会留档 */}
                  <p className="cf-end-note">
                    {endRecorded
                      ? t('ending_recorded_note')
                      : t('ending_unrecorded_note')}
                  </p>
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
        <span className="cf-bar-route"><I n="file" /> {route?.name || t('record')}</span>
        <span className="cf-bar-right">
          <b><I n="chip" /> MEM {unlockedMemories.size} / ARC {found.length}</b>
          <button className="cf-sound" onClick={p.onToggleMute}
            title={p.muted ? t('unmute') : t('mute')} aria-pressed={p.muted}>
            <I n={p.muted ? 'mute' : 'sound'} />
          </button>
          <AudioSettingsButton open={settingsOpen} onOpen={() => setSettingsOpen(true)} />
          <GameNav canBack={p.canBack} onBack={p.onBack} onHome={() => p.onNavigate('home')} />
        </span>
      </div>
      <div className={`cf-game cf-game-fixed ${ending ? 'cf-end-' + endKind(endingId) : ''}`}>
        <div className="cf-head">
          <div className="ix">{ROMAN[routeNo - 1] ?? routeNo}</div>
          <h3>{route?.name || t('record')}</h3>
          <div className="sub"><I n="target" /> SUBJECT {routeNo === 3 ? 'NO.7' : 'MARIA'} / {String(routeNo).padStart(3, '0')}</div>
        </div>
        {/* key=sceneKey：每换一幕重挂载，让淡入 / CG 翻页 / 选项级联重新播放 */}
        {/* 原版是「点画面」而不是「点那颗按钮」：没打完先补完，打完之后整块正文区都能推进。
            选项按钮自己 stopPropagation，避免一次点击既选分支又推进。 */}
        {/* 滚轮一落下就说明用户要自己看，立刻交还控制权（位置比对在极快滚动时可能来不及） */}
        <div className="cf-scroll" ref={ghost ? undefined : scrollRef}
          onScroll={ghost ? undefined : trackFollow} key={p.sceneKey}
          onWheel={ghost ? undefined : () => { followRef.current = false }}
          onClick={ghost ? undefined : () => {
            if (!textStart) return          // CG 还在翻页，这一下不算「点画面」
            if (!typed.done) { typed.skip(); return }
            if (jumpScroll()) return        // 还在自动追滚：这一下直接落到终点，不推进剧情
            if (p.canNext) p.onNext()
          }}>
          {body}
        </div>{/* /cf-scroll */}
        <StatusBar status={status} defs={data.status} erosionActive={p.erosionActive} feedback={p.statusFeedback} />
        <MemButton skin={memSkin(routeNo, endK, erosionMode)} onClick={p.onMemClick} />
      </div>
    </>
  )

  return (
    <div className={rootClass}>
      <div id="cf"><div className="stage"><div className="cf cf-fill">
        <div className="cf-frame">
          <div className="cf-inner cf-inner-fill" key={p.view}>
            {renderPanel()}
            {fxActive && <div className={`cf-ghost${fxStrength < 1 ? ' cf-ghost-weak' : ''}`} style={maskOf(blks)} aria-hidden="true">{renderPanel(true)}</div>}
            {fxActive && <EndFx key={ending ? p.sceneKey : erosionBurst ? 'erosion-burst' : 'erosion-state'} kind={endK || 'erosion'} blks={blks} strength={fxStrength} />}
          </div>
          {/* 边框线自己也被干扰：骑边方块落在哪，哪一段边框就被位移 */}
          {fxActive && <div className={`cf-ghost-frame${fxStrength < 1 ? ' cf-ghost-weak' : ''}`} style={maskOf(blks)} aria-hidden="true" />}
          {erosionBurst && [1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <div key={n} className={`cf-burst-slice cf-burst-slice-${n}`} aria-hidden="true">{renderPanel(true)}</div>
          ))}
          {erosionBurst && [1, 2, 3, 4, 5, 6].map((n) => (
            <div key={`frame-${n}`} className={`cf-frame-slice cf-frame-slice-${n}`} aria-hidden="true" />
          ))}
          {erosionBurst && (
            <div className="cf-burst-fx" aria-hidden="true">
              {burstBlocks.map((b) => (
                <i key={b.id} className={`cf-burst-block ${b.c}`} style={{
                  left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%`,
                  '--dx': `${b.dx}px`, '--dy': `${b.dy}px`,
                  '--dx2': `${b.dx2}px`, '--dy2': `${b.dy2}px`,
                  '--rot': `${b.rot}deg`, '--rot2': `${b.rot2}deg`,
                  animationDelay: `${b.delay}s`,
                } as CSSProperties} />
              ))}
            </div>
          )}
          {/* 原版点击锁定的 HINT 选项会弹一条横向提示（uis_mini_fad_hint_toast） */}
          {p.hintToast && (
            <div className={`cf-hint-toast${p.hintClosing ? ' cf-hint-toast-closing' : ''}`} role="status">
              {p.hintToast}
            </div>
          )}
          {/* 记录成功的提示：外观与 HINT 提醒同一条，停留更短 */}
          {toast && (
            <div className={`cf-hint-toast${toastOut ? ' cf-hint-toast-closing' : ''}`} role="status">
              {toast}
            </div>
          )}
        </div>
        {settingsOpen && <AudioSettingsDialog p={p} onClose={() => setSettingsOpen(false)} />}
      </div></div></div>
    </div>
  )
}
