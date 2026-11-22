import { Fragment, useCallback, useEffect, useMemo, useRef, useState,
  type CSSProperties, type ChangeEvent, type DragEvent, type ReactNode,
  type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { usePageTitle } from '../usePageTitle'
import {
  ASSET_BASE, assetGroup, exportCss, isLayout, normalizeLayout, skeletonLayout, uid,
  type AssetItem, type FadingLayout, type ImageLayer, type Layer, type RectLayer, type TextLayer,
} from '../fadingUi'
import './fading-editor.css'

const LS_AUTO = 'nikke_fading_ui_autosave_v1'
const LS_SLOTS = 'nikke_fading_ui_slots_v1'

type Hist = { items: string[]; index: number }
type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
type DragState =
  | { mode: 'move'; id: string; sx: number; sy: number; items: Array<{ id: string; x: number; y: number }> }
  | { mode: 'groupMove'; id: string; sx: number; sy: number; items: Array<{ id: string; x: number; y: number }> }
  | { mode: 'resize'; id: string; handle: Handle; sx: number; sy: number; orig: Layer }
  | { mode: 'rotate'; id: string; sx: number; sy: number; cx: number; cy: number; a0: number; orig: number }
  /** 九宫格切线：side 0=左 1=下 2=右 3=上（Unity border 顺序） */
  | { mode: 'border'; id: string; side: 0 | 1 | 2 | 3; sx: number; sy: number;
      orig: number[]; origW: number; origH: number; scale: number }
  /** 整组缩放 / 旋转：作用到组内每个图层的几何数据 */
  | { mode: 'groupResize'; handle: Handle; sx: number; sy: number; box: Box;
      members: Array<{ id: string; x: number; y: number; w: number; h: number }> }
  | { mode: 'groupRotate'; sx: number; sy: number; cx: number; cy: number; lx: number; ly: number; a0: number;
      members: Array<{ id: string; x: number; y: number; w: number; h: number; rotate: number }> }

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const BLENDS = [
  'normal', 'multiply', 'darken', 'color-burn',
  'screen', 'lighten', 'color-dodge',
  'overlay', 'soft-light', 'hard-light',
  'difference', 'exclusion',
  'hue', 'saturation', 'color', 'luminosity',
  'plus-lighter',
]

type Box = { x: number; y: number; r: number; b: number }
type Guide = { axis: 'x' | 'y'; pos: number }

/** 智能吸附：把活动框的边/中心贴到其它图层的边/中心或画布中线，返回偏移与参考线位置 */
function smartSnap(box: Box, others: Layer[], canvas: { w: number; h: number }, th: number) {
  const xt = [0, canvas.w / 2, canvas.w]
  const yt = [0, canvas.h / 2, canvas.h]
  for (const l of others) {
    xt.push(l.x, l.x + l.w / 2, l.x + l.w)
    yt.push(l.y, l.y + l.h / 2, l.y + l.h)
  }
  const xa = [box.x, (box.x + box.r) / 2, box.r]
  const ya = [box.y, (box.y + box.b) / 2, box.b]
  let bx = th + 1, by = th + 1, gx: number | null = null, gy: number | null = null
  for (const a of xa) for (const t of xt) if (Math.abs(t - a) < Math.abs(bx)) { bx = t - a; gx = t }
  for (const a of ya) for (const t of yt) if (Math.abs(t - a) < Math.abs(by)) { by = t - a; gy = t }
  return {
    dx: Math.abs(bx) <= th ? bx : 0,
    dy: Math.abs(by) <= th ? by : 0,
    gx: Math.abs(bx) <= th ? gx : null,
    gy: Math.abs(by) <= th ? gy : null,
  }
}

function readSlots(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(LS_SLOTS) || '{}') } catch { return {} }
}

export default function FadingUiEditor() {
  usePageTitle('FADING AFFECTION · UI 拼图编辑器')

  /* ---------- 布局状态：hist 负责撤销/重做，draft 负责拖拽时的临时预览 ---------- */
  const initial = useMemo(() => {
    try {
      const raw = localStorage.getItem(LS_AUTO)
      if (raw) {
        const d = JSON.parse(raw)
        if (isLayout(d)) return normalizeLayout(d)
      }
    } catch { /* 存档损坏就从骨架开始 */ }
    return skeletonLayout()
  }, [])
  const [hist, setHist] = useState<Hist>({ items: [JSON.stringify(initial)], index: 0 })
  const [draft, setDraftState] = useState<FadingLayout | null>(null)
  const draftRef = useRef<FadingLayout | null>(null)
  const committed = useMemo(() => JSON.parse(hist.items[hist.index]) as FadingLayout, [hist])
  const committedRef = useRef(committed)
  committedRef.current = committed
  const layout = draft ?? committed

  const setDraft = useCallback((v: FadingLayout | null) => {
    draftRef.current = v
    setDraftState(v)
  }, [])
  const commit = useCallback((next: FadingLayout) => {
    const s = JSON.stringify(next)
    setHist((h) => {
      const items = h.items.slice(0, h.index + 1)
      if (items[items.length - 1] === s) return h
      const arr = [...items, s].slice(-120)
      return { items: arr, index: arr.length - 1 }
    })
  }, [])
  const undo = useCallback(() => setHist((h) => ({ ...h, index: Math.max(0, h.index - 1) })), [])
  const redo = useCallback(() => setHist((h) => ({ ...h, index: Math.min(h.items.length - 1, h.index + 1) })), [])

  useEffect(() => {
    try { localStorage.setItem(LS_AUTO, JSON.stringify(committed)) } catch { /* ignore */ }
  }, [committed])

  function apply(mut: (l: FadingLayout) => FadingLayout) {
    const base = draftRef.current ?? committedRef.current
    commit(mut(JSON.parse(JSON.stringify(base)) as FadingLayout))
  }
  function patchLayer(id: string, patch: Partial<Layer>) {
    apply((l) => ({ ...l, layers: l.layers.map((x) => (x.id === id ? { ...x, ...patch } as Layer : x)) }))
  }
  function setCanvas(patch: Partial<FadingLayout['canvas']>) {
    apply((l) => ({ ...l, canvas: { ...l.canvas, ...patch } }))
  }

  /* ---------- 素材库 ---------- */
  const [assets, setAssets] = useState<AssetItem[]>([])
  const [search, setSearch] = useState('')
  const [group, setGroup] = useState('全部')
  const [toast, setToast] = useState('')
  const toastTimer = useRef<number | null>(null)
  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 2800)
  }, [])

  useEffect(() => {
    fetch('/data/fading_ui_manifest.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('manifest 不存在'))))
      .then((d: { items?: AssetItem[] }) => setAssets(d.items || []))
      .catch(() => showToast('素材清单读取失败，请重启 dev server'))
  }, [showToast])

  // 旧存档迁移：之前把带 border 的素材误存成 tiled / border=0，
  // 清单加载完后按真实 Sprite 元数据改回 sliced，避免用户已摆好的布局要重做。
  const migrated = useRef(false)
  useEffect(() => {
    if (!assets.length || migrated.current) return
    migrated.current = true
    const borders = new Map(assets.map((a) => [a.n, a.border || [0, 0, 0, 0]]))
    const cur = committedRef.current
    let changed = false
    const layers = cur.layers.map((l) => {
      if (l.kind !== 'image') return l
      const name = l.src.split('/').pop() || ''
      const b = borders.get(name)
      if (b && b.some((n) => n > 0) && l.border.every((n) => n === 0)) {
        changed = true
        return { ...l, border: b, fit: l.fit === 'tiled' ? 'sliced' : l.fit }
      }
      return l
    })
    if (changed) commit({ ...cur, layers })
  }, [assets, commit])

  const groups = useMemo(() => ['全部', ...Array.from(new Set(assets.map((a) => assetGroup(a.n))))], [assets])
  const shownAssets = useMemo(() => assets.filter((a) =>
    (group === '全部' || assetGroup(a.n) === group) && a.n.toLowerCase().includes(search.toLowerCase().trim()),
  ), [assets, group, search])

  function addAsset(a: AssetItem, cx?: number, cy?: number) {
    const nw = a.w || 256
    const nh = a.h || 128
    const f = Math.min(1, (layout.canvas.w * 0.6) / nw, (layout.canvas.h * 0.6) / nh)
    const w = Math.max(8, Math.round(nw * f))
    const h = Math.max(8, Math.round(nh * f))
    const x = Math.round((cx ?? layout.canvas.w / 2) - w / 2)
    const y = Math.round((cy ?? layout.canvas.h / 2) - h / 2)
    const border = a.border?.length === 4 ? a.border : [0, 0, 0, 0]
    // 按原作行为选默认填充方式：平铺类 > 有九宫格 border 的 > 纯拉伸
    const fit: ImageLayer['fit'] = a.tiled ? 'tiled' : border.some((n) => n > 0) ? 'sliced' : 'fill'
    const layer: ImageLayer = {
      id: uid(), name: a.n.replace(/\.png$/i, ''), kind: 'image', x, y, w, h, baseW: w, baseH: h,
      rotate: 0, opacity: 1, z: layout.layers.length, visible: true, locked: false,
      blend: 'normal', radius: 0, group: '', src: `${ASSET_BASE}${a.n}`,
      fit, border, borderScale: 1, grayscale: 0, brightness: 1,
    }
    apply((l) => ({ ...l, layers: [...l.layers, layer] }))
    selectOnly(layer.id)
  }
  function addText() {
    const layer: TextLayer = {
      id: uid(), name: '文字', kind: 'text',
      x: 120, y: 120, w: 320, h: 48, baseW: 320, baseH: 48,
      rotate: 0, opacity: 1, z: layout.layers.length, visible: true, locked: false,
      blend: 'normal', radius: 0, group: '', text: '双击此处编辑文字', color: '#171610',
      fontSize: 18, weight: 700, align: 'left', lineHeight: 1.5, letterSpacing: 0, shadow: '',
    }
    apply((l) => ({ ...l, layers: [...l.layers, layer] }))
    selectOnly(layer.id)
  }
  function addRect() {
    const layer: RectLayer = {
      id: uid(), name: '色块', kind: 'rect',
      x: 120, y: 200, w: 240, h: 120, baseW: 240, baseH: 120,
      rotate: 0, opacity: 1, z: layout.layers.length, visible: true, locked: false,
      blend: 'normal', radius: 0, group: '', color: 'rgba(140,30,50,.6)', border: '',
    }
    apply((l) => ({ ...l, layers: [...l.layers, layer] }))
    selectOnly(layer.id)
  }

  /* ---------- 编辑器视图状态 ---------- */
  const [selected, setSelected] = useState<string | null>(null)
  /** 选中整组时，画布显示组包围盒与整组变换手柄 */
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  /** 图层面板 Ctrl+左键追加选中的图层（primary 仍是 selected） */
  const [multi, setMulti] = useState<string[]>([])
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null)
  const [dragOverRoot, setDragOverRoot] = useState(false)
  const [zoom, setZoom] = useState(0.65)
  const [snap, setSnap] = useState(true)
  const [smart, setSmart] = useState(true)
  const [guides, setGuides] = useState<Guide[]>([])
  const [grid, setGrid] = useState(10)
  const [showGrid, setShowGrid] = useState(true)
  const [preview, setPreview] = useState(false)
  /** 选中图片时：true=用切线调九宫格 border，false=自由缩放/旋转 */
  const [nineMode, setNineMode] = useState(false)
  const [scaleLink, setScaleLink] = useState(true)
  /** 正在画布上就地编辑的文字图层 id */
  const [editingText, setEditingText] = useState<string | null>(null)
  const blendRef = useRef<HTMLSelectElement>(null)
  const groupBlendRef = useRef<HTMLSelectElement>(null)
  const [spaceDown, setSpaceDown] = useState(false)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [panning, setPanning] = useState(false)
  const [layerH, setLayerH] = useState(230)
  const rightRef = useRef<HTMLElement>(null)
  const panRef = useRef(pan)
  panRef.current = pan
  const suppressClick = useRef(false)
  const selLayer = layout.layers.find((l) => l.id === selected) ?? null
  const selIsImage = selLayer?.kind === 'image'

  // 整组包围盒（选中组时用于整体缩放/旋转）
  const groupMembers = useMemo(() =>
    selectedGroup ? layout.layers.filter((l) => l.group === selectedGroup) : [],
  [layout.layers, selectedGroup])
  const groupBox = useMemo<Box | null>(() => {
    if (!groupMembers.length) return null
    const x = Math.min(...groupMembers.map((l) => l.x))
    const y = Math.min(...groupMembers.map((l) => l.y))
    const r = Math.max(...groupMembers.map((l) => l.x + l.w))
    const b = Math.max(...groupMembers.map((l) => l.y + l.h))
    return { x, y, r, b }
  }, [groupMembers])

  // 组混合模式下拉框：同样支持悬停滚轮切换
  useEffect(() => {
    const el = groupBlendRef.current
    if (!el || !selectedGroup) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const i = BLENDS.indexOf(el.value)
      const next = Math.max(0, Math.min(BLENDS.length - 1, i + (e.deltaY > 0 ? 1 : -1)))
      if (BLENDS[next] !== el.value) patchGroup({ blend: BLENDS[next] })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [selectedGroup])

  // 混合模式下拉框：悬停时用滚轮切换（原生监听 + passive:false，避免页面跟着滚）
  useEffect(() => {
    const el = blendRef.current
    const id = selLayer?.id
    if (!el || !id) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const i = BLENDS.indexOf(el.value)
      const next = Math.max(0, Math.min(BLENDS.length - 1, i + (e.deltaY > 0 ? 1 : -1)))
      if (BLENDS[next] !== el.value) patchLayer(id, { blend: BLENDS[next] })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [selLayer?.id])

  // 文字就地编辑：点击画布/面板其它地方时退出编辑（onBlur 在部分浏览器不稳定，做兜底）
  useEffect(() => {
    if (!editingText) return
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null
      if (!el?.closest('.fu-text-edit')) setEditingText(null)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [editingText])

  // 多选：primary 用 selected，其余存在 multi 里
  const selectedIds = useCallback(
    () => (selected ? [selected, ...multi.filter((id) => id !== selected)] : [...multi]),
    [selected, multi],
  )
  const isSelected = (id: string) => selected === id || multi.includes(id)
  function selectOnly(id: string | null) { setSelected(id); setMulti([]); setSelectedGroup(null) }
  function onLayerRowClick(e: ReactMouseEvent, l: Layer) {
    if (e.ctrlKey || e.metaKey) {
      // primary 单独存在 selected 里，不重复放进 multi
      if (l.id === selected) {
        // Ctrl+点击主选中项 = 取消它，并把第一个附加选中项提升为主项
        if (multi.length) { setSelected(multi[0]); setMulti(multi.slice(1)) }
        else selectOnly(null)
      } else {
        setMulti((prev) => (prev.includes(l.id) ? prev.filter((id) => id !== l.id) : [...prev, l.id]))
      }
    } else selectOnly(l.id)
  }

  // 切换选中图层时，默认：有九宫格 border 的进 .9 图模式，否则进自由变换
  useEffect(() => {
    const l = layout.layers.find((x) => x.id === selected)
    setNineMode(l?.kind === 'image' && l.border.some((n) => n > 0))
    // 只在选中项变化时重置，避免调 border 时把模式又切回去
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  /* ---------- 拖拽：移动 / 缩放 / 旋转 / 九宫格切线 ---------- */
  function startDrag(e: ReactPointerEvent, d: DragState) {
    if (preview) return
    e.stopPropagation()
    e.preventDefault()
    const z = zoom
    const doSnap = snap
    const g = grid
    const useSmart = smart
    const move = (ev: PointerEvent) => {
      const cur = draftRef.current ?? committedRef.current
      const dx = (ev.clientX - d.sx) / z
      const dy = (ev.clientY - d.sy) / z
      let next: FadingLayout
      const gs: Guide[] = []
      if (d.mode === 'groupResize') {
        const o = d.box
        let x = o.x, y = o.y, r = o.r, b = o.b
        if (d.handle.includes('e')) r = o.r + dx
        if (d.handle.includes('s')) b = o.b + dy
        if (d.handle.includes('w')) x = o.x + dx
        if (d.handle.includes('n')) y = o.y + dy
        if (r - x < 20) { r = x + 20; if (d.handle.includes('w')) x = r - 20 }
        if (b - y < 20) { b = y + 20; if (d.handle.includes('n')) y = b - 20 }
        if (doSnap) {
          x = Math.round(x / g) * g; y = Math.round(y / g) * g
          r = Math.round(r / g) * g; b = Math.round(b / g) * g
        }
        // Shift：整组等比缩放（宽高比以缩放前的包围盒为准）
        if (ev.shiftKey) {
          const ow = o.r - o.x, oh = o.b - o.y
          const ratio = ow / Math.max(1, oh)
          const corner = d.handle.length === 2
          let nw = r - x, nh = b - y
          if (corner) {
            if (Math.abs(dx) >= Math.abs(dy)) nh = nw / ratio
            else nw = nh * ratio
            if (d.handle.includes('n')) y = b - nh
            if (d.handle.includes('w')) x = r - nw
          } else if (d.handle === 'e' || d.handle === 'w') {
            nh = nw / ratio
            y = o.y - (nh - oh) / 2
          } else {
            nw = nh * ratio
            x = o.x - (nw - ow) / 2
          }
          r = x + nw; b = y + nh
        }
        const sx = (r - x) / (o.r - o.x)
        const sy = (b - y) / (o.b - o.y)
        const pos = new Map(d.members.map((m) => [m.id, {
          x: x + (m.x - o.x) * sx, y: y + (m.y - o.y) * sy,
          w: m.w * sx, h: m.h * sy,
        }]))
        next = { ...cur, layers: cur.layers.map((l) => {
          const p = pos.get(l.id)
          return p ? { ...l, ...p } : l
        }) }
      } else if (d.mode === 'groupRotate') {
        const a = Math.atan2(ev.clientY - d.cy, ev.clientX - d.cx) * 180 / Math.PI
        let delta = a - d.a0
        if (ev.shiftKey) delta = Math.round(delta / 15) * 15
        const rad = delta * Math.PI / 180
        const cos = Math.cos(rad), sin = Math.sin(rad)
        const pos = new Map(d.members.map((m) => {
          const ox = m.x + m.w / 2, oy = m.y + m.h / 2
          // 用画布坐标的中心算几何；cx/cy 是屏幕坐标，只用于求鼠标角度
          const nx = d.lx + (ox - d.lx) * cos - (oy - d.ly) * sin
          const ny = d.ly + (ox - d.lx) * sin + (oy - d.ly) * cos
          return [m.id, { x: nx - m.w / 2, y: ny - m.h / 2, rotate: Math.round(m.rotate + delta) }]
        }))
        next = { ...cur, layers: cur.layers.map((l) => {
          const p = pos.get(l.id)
          return p ? { ...l, ...p } : l
        }) }
      } else if (d.mode === 'move' || d.mode === 'groupMove') {
        // move=拖单个/多选图层；groupMove=拖组标题条移动整组
        let mx = dx
        let my = dy
        const first = d.items[0]
        if (doSnap) {
          mx = Math.round((first.x + dx) / g) * g - first.x
          my = Math.round((first.y + dy) / g) * g - first.y
        }
        if (useSmart) {
          const ids = new Set(d.items.map((it) => it.id))
          const others = cur.layers.filter((l) => !ids.has(l.id))
          const mLayers = d.items
            .map((it) => cur.layers.find((l) => l.id === it.id))
            .filter((l): l is Layer => !!l)
          if (mLayers.length) {
            const box: Box = {
              x: Math.min(...mLayers.map((l) => l.x)) + mx,
              y: Math.min(...mLayers.map((l) => l.y)) + my,
              r: Math.max(...mLayers.map((l) => l.x + l.w)) + mx,
              b: Math.max(...mLayers.map((l) => l.y + l.h)) + my,
            }
            const s = smartSnap(box, others, cur.canvas, 7 / z)
            mx += s.dx; my += s.dy
            if (s.gx != null) gs.push({ axis: 'x', pos: s.gx })
            if (s.gy != null) gs.push({ axis: 'y', pos: s.gy })
          }
        }
        const pos = new Map(d.items.map((it) => [it.id, { x: it.x + mx, y: it.y + my }]))
        next = { ...cur, layers: cur.layers.map((l) => {
          const p = pos.get(l.id)
          return p ? { ...l, x: p.x, y: p.y } : l
        }) }
      } else if (d.mode === 'resize') {
        const o = d.orig
        let x = o.x, y = o.y, w = o.w, h = o.h
        if (d.handle.includes('e')) w = o.w + dx
        if (d.handle.includes('s')) h = o.h + dy
        if (d.handle.includes('w')) { w = o.w - dx; x = o.x + dx }
        if (d.handle.includes('n')) { h = o.h - dy; y = o.y + dy }
        if (w < 8) { w = 8; if (d.handle.includes('w')) x = o.x + o.w - 8 }
        if (h < 8) { h = 8; if (d.handle.includes('n')) y = o.y + o.h - 8 }
        if (doSnap) {
          x = Math.round(x / g) * g; y = Math.round(y / g) * g
          w = Math.round(w / g) * g; h = Math.round(h / g) * g
        }
        // Shift：单图层等比缩放
        if (ev.shiftKey) {
          const ratio = o.w / Math.max(1, o.h)
          const corner = d.handle.length === 2
          if (corner) {
            if (Math.abs(dx) >= Math.abs(dy)) h = w / ratio
            else w = h * ratio
            if (d.handle.includes('n')) y = o.y + o.h - h
            if (d.handle.includes('w')) x = o.x + o.w - w
          } else if (d.handle === 'e' || d.handle === 'w') {
            h = w / ratio
            y = o.y - (h - o.h) / 2
          } else {
            w = h * ratio
            x = o.x - (w - o.w) / 2
          }
        }
        if (useSmart && !ev.shiftKey) {
          const s = smartSnap({ x, y, r: x + w, b: y + h },
            cur.layers.filter((l) => l.id !== d.id), cur.canvas, 7 / z)
          if (s.dx) {
            if (d.handle.includes('e')) w += s.dx
            else if (d.handle.includes('w')) { x += s.dx; w -= s.dx }
          }
          if (s.dy) {
            if (d.handle.includes('s')) h += s.dy
            else if (d.handle.includes('n')) { y += s.dy; h -= s.dy }
          }
          if (s.gx != null) gs.push({ axis: 'x', pos: s.gx })
          if (s.gy != null) gs.push({ axis: 'y', pos: s.gy })
        }
        next = { ...cur, layers: cur.layers.map((l) => (l.id === d.id ? { ...l, x, y, w, h } : l)) }
      } else if (d.mode === 'border') {
        // 拖九宫格切线：只改 border，不动图层位置尺寸
        const snapVal = (v: number) => Math.max(0, Math.round(doSnap ? Math.round(v / g) * g : v))
        const sc = d.scale || 1
        const b = [...d.orig]
        if (d.side === 0) b[0] = snapVal(d.orig[0] + dx / sc)
        else if (d.side === 2) b[2] = snapVal(d.orig[2] - dx / sc)
        else if (d.side === 3) b[3] = snapVal(d.orig[3] + dy / sc)
        else b[1] = snapVal(d.orig[1] - dy / sc)
        // 对边 border 不允许相交
        if (d.side === 0) b[0] = Math.min(b[0], d.origW - d.orig[2] - 2)
        if (d.side === 2) b[2] = Math.min(b[2], d.origW - d.orig[0] - 2)
        if (d.side === 3) b[3] = Math.min(b[3], d.origH - d.orig[1] - 2)
        if (d.side === 1) b[1] = Math.min(b[1], d.origH - d.orig[3] - 2)
        next = { ...cur, layers: cur.layers.map((l) =>
          l.id === d.id ? ({ ...l, border: b, fit: 'sliced' } as ImageLayer) : l) }
      } else {
        // 剩下的只会是 rotate
        const rot = d as Extract<DragState, { mode: 'rotate' }>
        const a = Math.atan2(ev.clientY - rot.cy, ev.clientX - rot.cx) * 180 / Math.PI
        let r = rot.orig + (a - rot.a0)
        if (ev.shiftKey) r = Math.round(r / 15) * 15
        next = { ...cur, layers: cur.layers.map((l) => (l.id === rot.id ? { ...l, rotate: Math.round(r) } : l)) }
      }
      setDraft(next)
      setGuides(gs)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const final = draftRef.current
      setDraft(null)
      setGuides([])
      if (final) commit(final)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function onLayerDown(e: ReactPointerEvent, l: Layer) {
    // 空格平移 / 文字就地编辑时不要让图层开始拖动
    if (preview || spaceDown || e.button === 1 || editingText === l.id) return
    selectOnly(l.id)
    if (l.locked) return
    // 拖图层只移动该层（多选时一起移动）；整组移动请用组包围盒的橙色标题条
    const ids = selectedIds()
    const members = layout.layers.filter((x) => ids.includes(x.id) && !x.locked)
    startDrag(e, {
      mode: 'move', id: l.id, sx: e.clientX, sy: e.clientY,
      items: members.map((x) => ({ id: x.id, x: x.x, y: x.y })),
    })
  }
  /** 拖组标题条：整组平移 */
  function onGroupMoveDown(e: ReactPointerEvent) {
    if (!groupMembers.length) return
    e.stopPropagation(); e.preventDefault()
    startDrag(e, {
      mode: 'groupMove', id: selectedGroup || '', sx: e.clientX, sy: e.clientY,
      items: groupMembers.filter((l) => !l.locked).map((l) => ({ id: l.id, x: l.x, y: l.y })),
    })
  }
  function onRotateDown(e: ReactPointerEvent, l: Layer) {
    const host = stageRef.current
    if (!host) return
    const r = host.getBoundingClientRect()
    const cx = r.left + (l.x + l.w / 2) * zoom
    const cy = r.top + (l.y + l.h / 2) * zoom
    const a0 = Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI
    startDrag(e, { mode: 'rotate', id: l.id, sx: e.clientX, sy: e.clientY, cx, cy, a0, orig: l.rotate })
  }

  function onGroupHandleDown(e: ReactPointerEvent, h: Handle) {
    if (!groupBox) return
    e.stopPropagation(); e.preventDefault()
    startDrag(e, {
      mode: 'groupResize', handle: h, sx: e.clientX, sy: e.clientY,
      box: { ...groupBox },
      members: groupMembers.map((l) => ({ id: l.id, x: l.x, y: l.y, w: l.w, h: l.h })),
    })
  }
  function onGroupRotateDown(e: ReactPointerEvent) {
    const host = stageRef.current
    if (!groupBox || !host) return
    const r = host.getBoundingClientRect()
    const cx = r.left + (groupBox.x + groupBox.r) / 2 * zoom
    const cy = r.top + (groupBox.y + groupBox.b) / 2 * zoom
    const a0 = Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI
    startDrag(e, {
      mode: 'groupRotate', sx: e.clientX, sy: e.clientY, cx, cy,
      lx: (groupBox.x + groupBox.r) / 2, ly: (groupBox.y + groupBox.b) / 2, a0,
      members: groupMembers.map((l) => ({
        id: l.id, x: l.x, y: l.y, w: l.w, h: l.h, rotate: l.rotate,
      })),
    })
  }

  function removeLayer(id: string) {
    apply((l) => ({ ...l, layers: l.layers.filter((x) => x.id !== id) }))
    if (selected === id) selectOnly(null)
    else setMulti((m) => m.filter((x) => x !== id))
  }
  /** 删除所有选中图层（Ctrl+多选） */
  function removeSelected() {
    const ids = selectedIds()
    if (!ids.length) return
    apply((l) => ({ ...l, layers: l.layers.filter((x) => !ids.includes(x.id)) }))
    selectOnly(null)
  }
  function duplicateLayer(id: string) {
    const src = layout.layers.find((l) => l.id === id)
    if (!src) return
    const copy = { ...src, id: uid(), name: `${src.name} 副本`, x: src.x + 12, y: src.y + 12, z: layout.layers.length } as Layer
    apply((l) => ({ ...l, layers: [...l.layers, copy] }))
    selectOnly(copy.id)
  }
  /** 复制所有选中图层：保留原图层各自的分组 */
  function duplicateSelected() {
    const ids = selectedIds()
    const src = layout.layers.filter((l) => ids.includes(l.id))
    if (!src.length) return
    const copies = src.map((m) => ({
      ...m, id: uid(), name: `${m.name} 副本`, x: m.x + 12, y: m.y + 12,
      z: layout.layers.length + m.z,
    })) as Layer[]
    apply((l) => ({ ...l, layers: [...l.layers, ...copies] }))
    selectOnly(copies[0].id)
    setMulti(copies.slice(1).map((c) => c.id))
    showToast(`已复制 ${copies.length} 个图层`)
  }
  /** 批量调层级：选中的图层作为一整块移动 */
  function moveZ(ids: string[], dir: 'up' | 'down' | 'top' | 'bottom') {
    const sorted = [...layout.layers].sort((a, b) => a.z - b.z)
    const idxs = sorted.map((l, i) => (ids.includes(l.id) ? i : -1)).filter((i) => i >= 0)
    if (!idxs.length) return
    const lo = Math.min(...idxs)
    const hi = Math.max(...idxs)
    const block = sorted.splice(lo, hi - lo + 1)
    let at: number
    if (dir === 'up') at = Math.min(sorted.length, lo + 1)
    else if (dir === 'down') at = Math.max(0, lo - 1)
    else if (dir === 'top') at = sorted.length
    else at = 0
    sorted.splice(at, 0, ...block)
    sorted.forEach((l, k) => { l.z = k })
    apply((l) => ({ ...l, layers: sorted }))
  }

  /* ---------- 图层关系：编组 / 解组 / 整组复制删除 / 对齐 ---------- */
  const groupNames = useMemo(() =>
    Array.from(new Set(layout.layers.map((l) => l.group).filter(Boolean))), [layout.layers])

  /** 批量修改组内所有图层的属性（混合模式 / 透明度等） */
  function patchGroup(patch: Partial<Layer>) {
    if (!selectedGroup) return
    apply((cur) => ({ ...cur, layers: cur.layers.map((x) =>
      (x.group === selectedGroup ? { ...x, ...patch } as Layer : x)) }))
  }
  /** 只改组内图片图层的填充模式 */
  function patchGroupImages(patch: Partial<ImageLayer>) {
    if (!selectedGroup) return
    apply((cur) => ({ ...cur, layers: cur.layers.map((x) =>
      (x.group === selectedGroup && x.kind === 'image' ? { ...x, ...patch } as ImageLayer : x)) }))
  }
  function renameGroup(oldName: string, newName: string) {
    if (!newName.trim() || newName === oldName) return
    apply((l) => ({ ...l, layers: l.layers.map((x) =>
      (x.group === oldName ? { ...x, group: newName.trim() } : x)) }))
    setSelectedGroup(newName.trim())
  }
  /** 按新的包围盒调整整组（用于属性面板直接输入 X/Y/宽/高） */
  function applyGroupBox(next: Box) {
    if (!groupBox || !groupMembers.length) return
    const sx = (next.r - next.x) / (groupBox.r - groupBox.x)
    const sy = (next.b - next.y) / (groupBox.b - groupBox.y)
    const pos = new Map(groupMembers.map((m) => [m.id, {
      x: next.x + (m.x - groupBox.x) * sx,
      y: next.y + (m.y - groupBox.y) * sy,
      w: m.w * sx, h: m.h * sy,
    }]))
    apply((cur) => ({ ...cur, layers: cur.layers.map((l) => {
      const p = pos.get(l.id)
      return p ? { ...l, ...p } : l
    }) }))
  }
  /** 把当前多选的图层编成一个新组（图层面板有独立按钮 + Ctrl+G） */
  function groupSelection() {
    const ids = selectedIds()
    if (ids.length < 2) { showToast('先在图层面板按住 Ctrl 选中至少 2 个图层'); return }
    const suggested = `新组 ${groupNames.length + 1}`
    const name = (window.prompt('组名', suggested) || '').trim()
    if (!name) return
    apply((l) => ({ ...l, layers: l.layers.map((x) => (ids.includes(x.id) ? { ...x, group: name } : x)) }))
    showToast(`已把 ${ids.length} 个图层编入「${name}」`)
  }
  function ungroupSelection() {
    const names = new Set(selectedIds()
      .map((id) => layout.layers.find((l) => l.id === id)?.group)
      .filter((n): n is string => !!n))
    if (!names.size) { showToast('先选中组内的图层'); return }
    apply((l) => ({ ...l, layers: l.layers.map((x) => (names.has(x.group) ? { ...x, group: '' } : x)) }))
    showToast(`已解散 ${names.size} 个组（图层保留）`)
  }

  function setLayerGroup(id: string, name: string) {
    apply((l) => ({ ...l, layers: l.layers.map((x) => (x.id === id ? { ...x, group: name } : x)) }))
  }
  function ungroup(name: string) {
    apply((l) => ({ ...l, layers: l.layers.map((x) => (x.group === name ? { ...x, group: '' } : x)) }))
    if (selectedGroup === name) setSelectedGroup(null)
  }
  function duplicateGroup(name: string) {
    const members = layout.layers.filter((x) => x.group === name)
    if (!members.length) return
    const copies = members.map((m) => ({
      ...m, id: uid(), name: `${m.name} 副本`, x: m.x + 12, y: m.y + 12,
      z: layout.layers.length + m.z,
    })) as Layer[]
    apply((l) => ({ ...l, layers: [...l.layers, ...copies] }))
    showToast(`已复制组「${name}」的 ${copies.length} 个图层`)
  }
  function deleteGroup(name: string) {
    if (!window.confirm(`删除整组「${name}」及其全部图层？可 Ctrl+Z 撤销。`)) return
    apply((l) => ({ ...l, layers: l.layers.filter((x) => x.group !== name) }))
    selectOnly(null)
    if (selectedGroup === name) setSelectedGroup(null)
  }
  /** 把选中图层（或整组包围盒）对齐到画布边缘/中线 */
  function align(dir: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') {
    const chosen = selectedIds()
    const primary = selLayer
    if (!chosen.length) return
    // 多选时对齐选中集合；单选且属于组时对齐整组包围盒
    const ids = chosen.length > 1 || !primary?.group
      ? chosen
      : layout.layers.filter((x) => x.group === primary.group).map((x) => x.id)
    const members = layout.layers.filter((x) => ids.includes(x.id))
    if (!members.length) return
    const box = {
      x: Math.min(...members.map((m) => m.x)),
      y: Math.min(...members.map((m) => m.y)),
      r: Math.max(...members.map((m) => m.x + m.w)),
      b: Math.max(...members.map((m) => m.y + m.h)),
    }
    let dx = 0, dy = 0
    if (dir === 'left') dx = -box.x
    else if (dir === 'hcenter') dx = (layout.canvas.w - (box.r - box.x)) / 2 - box.x
    else if (dir === 'right') dx = layout.canvas.w - box.r
    else if (dir === 'top') dy = -box.y
    else if (dir === 'vcenter') dy = (layout.canvas.h - (box.b - box.y)) / 2 - box.y
    else dy = layout.canvas.h - box.b
    const off = new Map(ids.map((id) => [id, { dx, dy }]))
    apply((cur) => ({ ...cur, layers: cur.layers.map((x) => {
      const o = off.get(x.id)
      return o ? { ...x, x: x.x + o.dx, y: x.y + o.dy } : x
    }) }))
  }
  /** 图层面板拖拽排序：把 from 层插到 to 层的位置，重排 z */
  function reorder(ids: string[], to: string) {
    if (ids.includes(to)) return
    const sorted = [...layout.layers].sort((a, b) => a.z - b.z)
    const idxs = sorted.map((l, i) => (ids.includes(l.id) ? i : -1)).filter((i) => i >= 0)
    if (!idxs.length) return
    const lo = Math.min(...idxs), hi = Math.max(...idxs)
    const block = sorted.splice(lo, hi - lo + 1)
    const ti = sorted.findIndex((l) => l.id === to)
    sorted.splice(ti < 0 ? sorted.length : ti, 0, ...block)
    sorted.forEach((l, k) => { l.z = k })
    apply((l) => ({ ...l, layers: sorted }))
  }
  /** 拖到某图层上：排序到它前面，并并入它所在的组（一次提交） */
  function dropOnLayer(ids: string[], target: Layer) {
    if (ids.includes(target.id)) return
    apply((cur) => {
      const sorted = [...cur.layers].sort((a, b) => a.z - b.z)
      const idxs = sorted.map((l, i) => (ids.includes(l.id) ? i : -1)).filter((i) => i >= 0)
      if (!idxs.length) return cur
      const lo = Math.min(...idxs), hi = Math.max(...idxs)
      const block = sorted.splice(lo, hi - lo + 1)
      const ti = sorted.findIndex((l) => l.id === target.id)
      sorted.splice(ti < 0 ? sorted.length : ti, 0, ...block)
      return {
        ...cur,
        layers: sorted.map((x, i) => ({
          ...x, z: i, group: ids.includes(x.id) ? target.group : x.group,
        })),
      }
    })
  }
  /** 把图层拖进某个组（或拖到空白区时 group='' 表示移出组），z 顺序保持 */
  function dropIntoGroup(ids: string[], group: string) {
    apply((l) => {
      const layers = l.layers.map((x) => (ids.includes(x.id) ? { ...x, group } : x))
      return { ...l, layers: [...layers].sort((a, b) => a.z - b.z).map((x, i) => ({ ...x, z: i })) }
    })
  }
  function ungroupDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault(); e.stopPropagation()
    const ids = draggedIds(e)
    if (ids.length) { dropIntoGroup(ids, ''); showToast('已把图层移出组') }
    setDragOverRoot(false); setDragOverGroup(null)
  }
  function draggedIds(e: DragEvent): string[] {
    const raw = e.dataTransfer.getData('application/x-fading-layer')
    if (!raw) return []
    if (raw.startsWith('[')) {
      try {
        const arr = JSON.parse(raw)
        if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === 'string')
      } catch { /* fall through */ }
    }
    return [raw]
  }

  /* ---------- 键盘快捷键 ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      if (e.key === 'Escape') { selectOnly(null); setModal(null); return }
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return }
      if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return }
      if (ctrl && e.key.toLowerCase() === 'g') { e.preventDefault(); groupSelection(); return }
      if (spaceDown) return
      const ids = selectedIds()
      if (!ids.length) return
      if (ctrl && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); return }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(); return }
      if (layout.layers.find((x) => x.id === selected)?.locked) return
      const step = e.shiftKey ? 10 : 1
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
      if (dx || dy) {
        e.preventDefault()
        apply((cur) => ({ ...cur, layers: cur.layers.map((x) =>
          ids.includes(x.id) ? { ...x, x: x.x + dx, y: x.y + dy } : x) }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* ---------- 空格键：按住时画布进入平移模式 ---------- */
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      if (e.code === 'Space') { e.preventDefault(); setSpaceDown(true) }
    }
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpaceDown(false) }
    const blur = () => setSpaceDown(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  /* ---------- 画布拖入素材 / 平移 / Ctrl+滚轮缩放 ---------- */
  const stageRef = useRef<HTMLDivElement>(null)
  const stageScrollRef = useRef<HTMLDivElement>(null)
  const sizerRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom

  useEffect(() => {
    const host = stageScrollRef.current
    if (!host) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const sz = sizerRef.current
      if (!sz) return
      const oldZoom = zoomRef.current
      const next = Math.min(2, Math.max(0.1, +(oldZoom - Math.sign(e.deltaY) * 0.08).toFixed(2)))
      if (next === oldZoom) return
      // 以鼠标所在的画布点为锚点缩放：缩放后把该点移回鼠标位置
      const r = sz.getBoundingClientRect()
      const lx = (e.clientX - r.left) / oldZoom
      const ly = (e.clientY - r.top) / oldZoom
      setZoom(next)
      requestAnimationFrame(() => {
        const r2 = sz.getBoundingClientRect()
        const wantX = e.clientX - lx * next
        const wantY = e.clientY - ly * next
        setPan((p) => ({ x: p.x + (wantX - r2.left), y: p.y + (wantY - r2.top) }))
      })
    }
    host.addEventListener('wheel', onWheel, { passive: false })
    return () => host.removeEventListener('wheel', onWheel)
  }, [])

  function onStagePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!spaceDown && e.button !== 1) return
    e.preventDefault()
    const sx = e.clientX, sy = e.clientY
    const ox = panRef.current.x, oy = panRef.current.y
    let moved = false
    setPanning(true)
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 3) moved = true
      setPan({ x: ox + ev.clientX - sx, y: oy + ev.clientY - sy })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setPanning(false)
      // 平移结束后的 click 不要触发「点击空白处取消选中」
      if (moved) suppressClick.current = true
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    const name = e.dataTransfer.getData('application/x-fading-asset')
    const a = assets.find((x) => x.n === name)
    const host = stageRef.current
    if (!a || !host) return
    const r = host.getBoundingClientRect()
    addAsset(a, (e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom)
  }

  /** 右栏分隔条：拖动调整「图层」列表高度，剩下的给「属性」 */
  function onSplitPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault()
    const host = rightRef.current
    if (!host) return
    const startY = e.clientY
    const startH = layerH
    const maxH = Math.max(80, host.clientHeight - 260)
    const move = (ev: PointerEvent) => {
      setLayerH(Math.max(80, Math.min(maxH, startH + ev.clientY - startY)))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /* ---------- 存档 / 导入导出 / 项目落盘 ---------- */
  const [slots, setSlots] = useState<Record<string, string>>(readSlots)
  const [slotName, setSlotName] = useState('')
  const [modal, setModal] = useState<'export' | 'help' | null>(null)
  const [exportKind, setExportKind] = useState<'json' | 'css'>('json')
  const [exportText, setExportText] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  function saveSlot() {
    const name = (slotName.trim() || window.prompt('布局名称', layout.name) || '').trim()
    if (!name) return
    const next = { ...slots, [name]: JSON.stringify(committed) }
    try {
      localStorage.setItem(LS_SLOTS, JSON.stringify(next))
      setSlots(next); setSlotName(''); showToast(`已保存「${name}」`)
    } catch { showToast('本地存储空间不足') }
  }
  function loadSlot() {
    const raw = slots[slotName.trim()]
    if (!raw) { showToast('请先在下拉框选择存档'); return }
    try {
      const d = JSON.parse(raw)
      if (!isLayout(d)) throw new Error('bad layout')
      commit(normalizeLayout(d)); selectOnly(null); showToast(`已载入「${slotName.trim()}」`)
    } catch { showToast('存档损坏') }
  }
  function removeSlot() {
    const name = slotName.trim()
    if (!slots[name]) return
    const next = { ...slots }; delete next[name]
    localStorage.setItem(LS_SLOTS, JSON.stringify(next)); setSlots(next); showToast('已删除存档')
  }
  async function saveToProject() {
    try {
      const r = await fetch('/api/fading-layout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layout: committed }),
      })
      const d = await r.json()
      showToast(d.ok ? '已写入 build/fading_ui_layout.json' : `保存失败：${d.error || ''}`)
    } catch (err) { showToast(`保存失败：${err}`) }
  }
  async function loadFromProject() {
    try {
      const r = await fetch('/api/fading-layout')
      const d = await r.json()
      if (d.layout && isLayout(d.layout)) {
        commit(normalizeLayout(d.layout)); selectOnly(null); showToast('已从项目载入布局')
      } else showToast('项目里还没有布局，先点「存到项目」')
    } catch (err) { showToast(`读取失败：${err}`) }
  }
  function openExport(kind: 'json' | 'css') {
    setExportKind(kind)
    setExportText(kind === 'json' ? JSON.stringify(committed, null, 2) : exportCss(committed))
    setModal('export')
  }
  function copyExport() {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(exportText).then(() => showToast('已复制到剪贴板'))
        .catch(() => fallbackCopy())
    } else fallbackCopy()
  }
  function fallbackCopy() {
    const ta = document.getElementById('fu-export-text') as HTMLTextAreaElement | null
    ta?.select()
    try { document.execCommand('copy'); showToast('已复制到剪贴板') } catch { showToast('复制失败，请手动选中') }
  }
  function downloadExport() {
    const blob = new Blob([exportText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = exportKind === 'json' ? `${layout.name || 'layout'}.json` : 'fading-ui-layout.css'
    a.click()
    URL.revokeObjectURL(url)
  }
  function importFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    f.text().then((t) => {
      const d = JSON.parse(t)
      if (!isLayout(d)) throw new Error('不是合法的布局 JSON')
      commit(normalizeLayout(d)); selectOnly(null); showToast('已导入布局')
    }).catch((err) => showToast(`导入失败：${err}`))
    e.target.value = ''
  }
  function resetSkeleton() {
    if (!window.confirm('用骨架覆盖当前画布？当前布局会进入撤销历史，可 Ctrl+Z 找回。')) return
    commit(skeletonLayout()); selectOnly(null); showToast('已载入剧情页骨架')
  }

  /* ---------- 图层渲染 ---------- */
  /** 外层只管几何与交互，不承载混合模式 —— 否则手柄会被图层效果一起混合 */
  function layerBoxStyle(l: Layer): CSSProperties {
    return {
      position: 'absolute',
      left: l.x, top: l.y, width: l.w, height: l.h,
      transform: l.rotate ? `rotate(${l.rotate}deg)` : undefined,
      display: l.visible ? undefined : 'none',
      cursor: preview ? 'default' : (l.locked ? 'not-allowed' : 'move'),
    }
  }
  /** 内层只管画面：混合模式 / 透明度 / 滤镜都在这里，不影响操作手柄 */
  function layerVisualStyle(l: Layer): CSSProperties {
    const common: CSSProperties = {
      pointerEvents: 'none',
      opacity: l.opacity,
      mixBlendMode: l.blend as CSSProperties['mixBlendMode'],
      borderRadius: l.radius || undefined,
    }
    if (l.kind === 'image') {
      const filter = l.grayscale || l.brightness !== 1
        ? `grayscale(${l.grayscale}) brightness(${l.brightness})` : undefined
      if (l.fit === 'sliced' && l.border.some((n) => n > 0)) {
        const [bL, bB, bR, bT] = l.border.map(Math.round)
        const s = l.borderScale ?? 1
        const f = (v: number) => +(v * s).toFixed(2)
        const [L, B, R, T] = [f(bL), f(bB), f(bR), f(bT)]
        return {
          ...common,
          borderStyle: 'solid', borderColor: 'transparent',
          borderTopWidth: `${T}px`, borderRightWidth: `${R}px`,
          borderBottomWidth: `${B}px`, borderLeftWidth: `${L}px`,
          borderImage: `url("${l.src}") ${bT} ${bR} ${bB} ${bL} fill / ${T}px ${R}px ${B}px ${L}px / 0 stretch`,
          filter,
        }
      }
      return {
        ...common,
        backgroundImage: `url("${l.src}")`,
        backgroundPosition: 'center',
        backgroundRepeat: l.fit === 'tiled' ? 'repeat' : 'no-repeat',
        backgroundSize: l.fit === 'fill' || l.fit === 'sliced' ? '100% 100%' : l.fit === 'tiled' ? 'auto' : l.fit,
        filter,
      }
    }
    if (l.kind === 'rect') {
      return { ...common, background: l.color, border: l.border || undefined }
    }
    return {
      ...common,
      display: 'flex', alignItems: 'center',
      justifyContent: l.align === 'center' ? 'center' : l.align === 'right' ? 'flex-end' : 'flex-start',
      color: l.color, fontSize: l.fontSize, fontWeight: l.weight,
      textAlign: l.align, lineHeight: l.lineHeight, letterSpacing: l.letterSpacing,
      textShadow: l.shadow || undefined,
      whiteSpace: 'pre-wrap', overflow: 'hidden',
    }
  }

  /** 画布上就地编辑文字时的 textarea 样式：与最终渲染的字体/对齐一致 */
  function textEditStyle(l: TextLayer): CSSProperties {
    const s = layerVisualStyle(l)
    return {
      ...s,
      display: 'block', width: '100%', height: '100%',
      margin: 0, padding: 0, resize: 'none', overflow: 'hidden',
      fontFamily: 'inherit', background: 'rgba(255,255,255,.9)',
      border: '1px dashed #2ee6ff', outline: 'none', cursor: 'text',
      mixBlendMode: 'normal', pointerEvents: 'auto', zIndex: 5,
    }
  }

  const stageStyle: CSSProperties = {
    width: layout.canvas.w,
    height: layout.canvas.h,
    transform: `scale(${zoom})`,
    transformOrigin: 'top left',
    backgroundColor: layout.canvas.bgColor,
    backgroundImage: layout.canvas.bgImage ? `url("${layout.canvas.bgImage}")` : undefined,
    backgroundRepeat: layout.canvas.bgRepeat,
    backgroundSize: layout.canvas.bgRepeat === 'cover' ? 'cover' : undefined,
    backgroundPosition: 'center',
  }
  const sortedLayers = useMemo(() => [...layout.layers].sort((a, b) => a.z - b.z), [layout.layers])

  function renderLayerRow(l: Layer, nested = false) {
    return (
      <div key={l.id}
        className={`fu-layer-row${isSelected(l.id) ? ' on' : ''}${multi.includes(l.id) && l.id !== selected ? ' multi' : ''}${nested ? ' nested' : ''}`}
        draggable
        onDragStart={(e) => {
          const ids = isSelected(l.id) ? selectedIds() : [l.id]
          e.dataTransfer.setData('application/x-fading-layer', JSON.stringify(ids))
          e.dataTransfer.effectAllowed = 'move'
        }}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
        onDragLeave={() => setDragOverGroup(null)}
        onDrop={(e) => {
          e.preventDefault(); e.stopPropagation()
          dropOnLayer(draggedIds(e), l)
          setDragOverGroup(null); setDragOverRoot(false)
        }}
        onClick={(e) => onLayerRowClick(e, l)}
        title={`Ctrl+左键多选 · 拖动排序/拖进组${l.group ? ` · 组：${l.group}` : ''}`}>
        <span className="fu-layer-icn">{l.kind === 'image' ? '▧' : l.kind === 'text' ? 'T' : '▢'}</span>
        <span className="fu-layer-name">{l.name}</span>
        <button className="fu-ico" title={l.visible ? '隐藏' : '显示'}
          onClick={(e) => {
            e.stopPropagation()
            const ids = isSelected(l.id) ? selectedIds() : [l.id]
            apply((cur) => ({ ...cur, layers: cur.layers.map((x) => (ids.includes(x.id) ? { ...x, visible: !l.visible } : x)) }))
          }}>{l.visible ? '◉' : '◌'}</button>
        <button className="fu-ico" title={l.locked ? '解锁' : '锁定'}
          onClick={(e) => {
            e.stopPropagation()
            const ids = isSelected(l.id) ? selectedIds() : [l.id]
            apply((cur) => ({ ...cur, layers: cur.layers.map((x) => (ids.includes(x.id) ? { ...x, locked: !l.locked } : x)) }))
          }}>{l.locked ? '🔒' : '🔓'}</button>
      </div>
    )
  }
  function renderGroupHeader(name: string, count: number) {
    const isOn = selectedGroup === name || (!!selLayer && selLayer.group === name)
    return (
      <div key={`g-${name}`}
        className={`fu-group-head${isOn ? ' on' : ''}${dragOverGroup === name ? ' drop-target' : ''}`}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverGroup(name) }}
        onDragLeave={() => setDragOverGroup(null)}
        onDrop={(e) => {
          e.preventDefault(); e.stopPropagation()
          dropIntoGroup(draggedIds(e), name)
          setDragOverGroup(null); setDragOverRoot(false)
          showToast(`已把图层移入组「${name}」`)
        }}>
        <button className="fu-group-toggle" title="折叠 / 展开组"
          onClick={() => setCollapsed((c) => ({ ...c, [name]: !c[name] }))}>{collapsed[name] ? '▸' : '▾'}</button>
        <button className="fu-group-name" onClick={() => {
          const first = layout.layers.find((l) => l.group === name)
          if (first) { selectOnly(first.id); setSelectedGroup(name) }
        }} title="选中整组：画布出现包围盒，可整体缩放/旋转">📁 {name} <small>{count}</small></button>
        <button className="fu-ico" title="复制整组" onClick={() => duplicateGroup(name)}>⧉</button>
        <button className="fu-ico" title="解散组（图层保留）" onClick={() => ungroup(name)}>⊠</button>
        <button className="fu-ico" title="删除整组" onClick={() => deleteGroup(name)}>✕</button>
      </div>
    )
  }
  const layerTree: ReactNode[] = []
  {
    const desc = [...layout.layers].sort((a, b) => b.z - a.z)
    const seen = new Set<string>()
    for (const l of desc) {
      if (!l.group) { layerTree.push(renderLayerRow(l)); continue }
      if (seen.has(l.group)) continue
      seen.add(l.group)
      const members = desc.filter((x) => x.group === l.group)
      layerTree.push(renderGroupHeader(l.group, members.length))
      if (!collapsed[l.group]) members.forEach((m) => layerTree.push(renderLayerRow(m, true)))
    }
  }

  return (
    <div className="fu-app">
      <div className="fu-top">
        <div className="fu-brand">
          <span className="fu-brand-mark">FA</span>
          <div>
            <b>UI 拼图编辑器</b>
            <small>FADING AFFECTION · {layout.canvas.w}×{layout.canvas.h} · {layout.layers.length} 图层</small>
          </div>
        </div>
        <div className="fu-top-tools">
          <button className="fu-btn" onClick={undo} disabled={hist.index === 0} title="Ctrl+Z">↶ 撤销</button>
          <button className="fu-btn" onClick={redo} disabled={hist.index >= hist.items.length - 1} title="Ctrl+Shift+Z">↷ 重做</button>
          <span className="fu-sep" />
          <button className="fu-btn" onClick={() => openExport('json')}>导出 JSON</button>
          <button className="fu-btn" onClick={() => openExport('css')}>导出 CSS</button>
          <button className="fu-btn" onClick={() => fileRef.current?.click()}>导入</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={importFile} />
          <span className="fu-sep" />
          <button className="fu-btn" onClick={saveToProject} title="写入 build/fading_ui_layout.json（dev）">存到项目</button>
          <button className="fu-btn" onClick={loadFromProject}>从项目读</button>
          <button className="fu-btn fu-btn-accent" onClick={() => setModal('help')}>? 帮助</button>
          <LinkBack />
        </div>
      </div>

      <div className="fu-body">
        {/* ---------- 左：素材库 ---------- */}
        <aside className="fu-left">
          <div className="fu-pane-head">
            <span>素材库 <small>{assets.length}</small></span>
          </div>
          <input className="fu-input fu-search" placeholder="搜索文件名，如 bg_choice / deco / hp"
            value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="fu-input" value={group} onChange={(e) => setGroup(e.target.value)}>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <p className="fu-tip">拖到画布，或点击加在画布中央。素材来自 <code>public/fading_ui/</code></p>
          <div className="fu-asset-grid">
            {shownAssets.map((a) => (
              <button key={a.n} className="fu-asset" draggable
                onDragStart={(e) => e.dataTransfer.setData('application/x-fading-asset', a.n)}
                onClick={() => addAsset(a)}
                title={`${a.n} · ${a.w}×${a.h} · ${a.tiled ? '平铺 tiled'
                  : a.border?.some((n) => n > 0) ? `九宫格 ${a.border.join('/')}` : '纯拉伸'}`}>
                <span className="fu-asset-img"><img src={`${ASSET_BASE}${a.n}`} alt="" loading="lazy" /></span>
                <span className="fu-asset-name">{a.n.replace(/\.png$/i, '')}</span>
              </button>
            ))}
            {!shownAssets.length && <div className="fu-empty">没有匹配的素材</div>}
          </div>
          <div className="fu-add-row">
            <button className="fu-btn" onClick={addText}>＋ 文字</button>
            <button className="fu-btn" onClick={addRect}>＋ 色块</button>
            <button className="fu-btn" onClick={resetSkeleton}
              title="载入按原截图比例预摆好的剧情页骨架（约 28 个图层，含纸张/夹子/藤蔓/标题条/正文/选项条/状态栏）。会弹窗确认，旧布局可用 Ctrl+Z 找回。">↺ 骨架模板</button>
          </div>
        </aside>

        {/* ---------- 中：画布 ---------- */}
        <main className="fu-center">
          <div className="fu-canvas-bar">
            <label>预设
              <select className="fu-input" defaultValue="" onChange={(e) => {
                const v = e.target.value
                if (!v) return
                const [w, h] = v.split('x').map(Number)
                setCanvas({ w, h })
              }}>
                <option value="">选择…</option>
                <option value="1080x920">剧情页 1080×920</option>
                <option value="816x896">主菜单 816×896</option>
                <option value="1080x608">横屏 1080×608</option>
              </select>
            </label>
            <label>宽<input className="fu-input fu-num" type="number" value={layout.canvas.w}
              onChange={(e) => setCanvas({ w: Math.max(100, Number(e.target.value) || 100) })} /></label>
            <label>高<input className="fu-input fu-num" type="number" value={layout.canvas.h}
              onChange={(e) => setCanvas({ h: Math.max(100, Number(e.target.value) || 100) })} /></label>
            <label>底色<input className="fu-color" type="color" value={layout.canvas.bgColor}
              onChange={(e) => setCanvas({ bgColor: e.target.value })} /></label>
            <label>底图
              <select className="fu-input" value={layout.canvas.bgImage}
                onChange={(e) => setCanvas({ bgImage: e.target.value })}>
                <option value="">无</option>
                {assets.map((a) => <option key={a.n} value={`${ASSET_BASE}${a.n}`}>{a.n}</option>)}
              </select>
            </label>
            <select className="fu-input fu-short" value={layout.canvas.bgRepeat}
              onChange={(e) => setCanvas({ bgRepeat: e.target.value as FadingLayout['canvas']['bgRepeat'] })}>
              <option value="repeat">平铺</option>
              <option value="no-repeat">不重复</option>
              <option value="cover">铺满</option>
            </select>
            <span className="fu-sep" />
            <label>名称<input className="fu-input fu-name" value={layout.name}
              onChange={(e) => apply((l) => ({ ...l, name: e.target.value }))} /></label>
          </div>

          <div className="fu-canvas-bar fu-canvas-bar-2">
            <label className="fu-check"><input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} /> 网格</label>
            <label className="fu-check"><input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> 网格吸附</label>
            <label className="fu-check" title="拖动时贴齐其它图层的边 / 中心，并显示参考线">
              <input type="checkbox" checked={smart} onChange={(e) => setSmart(e.target.checked)} /> 智能吸附</label>
            <label>步长<input className="fu-input fu-num fu-num-sm" type="number" min="1" value={grid}
              onChange={(e) => setGrid(Math.max(1, Number(e.target.value) || 1))} /></label>
            <span className="fu-sep" />
            <button className="fu-btn" onClick={() => setZoom((z) => Math.max(0.1, +(z - 0.1).toFixed(2)))}>－</button>
            <span className="fu-zoom">{Math.round(zoom * 100)}%</span>
            <button className="fu-btn" onClick={() => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(2)))}>＋</button>
            <button className="fu-btn" onClick={() => { setZoom(0.65); setPan({ x: 0, y: 0 }) }}>适应</button>
            <span className="fu-sep" />
            <span className="fu-align-label">对齐{selectedGroup ? `「${selectedGroup}」` : selLayer?.group ? `「${selLayer.group}」` : ''}</span>
            {([['left', '◧'], ['hcenter', '▣'], ['right', '◨'], ['top', '▔'], ['vcenter', '▤'], ['bottom', '▁']] as const).map(([d, ic]) => (
              <button key={d} className="fu-btn fu-align" disabled={!selLayer}
                title={{ left: '左对齐画布', hcenter: '水平居中', right: '右对齐画布', top: '顶对齐', vcenter: '垂直居中', bottom: '底对齐' }[d]}
                onClick={() => align(d)}>{ic}</button>
            ))}
            <span className="fu-sep" />
            <span className="fu-align-label">变换</span>
            <div className="fu-mode-switch" title="九宫格模式：拖动图层内的橙色切线调整 border；自由变换：拖动角点缩放">
              <button disabled={!selIsImage} className={!nineMode ? 'on' : ''}
                onClick={() => setNineMode(false)}>自由</button>
              <button disabled={!selIsImage} className={nineMode ? 'on' : ''}
                onClick={() => setNineMode(true)}>.9 图</button>
            </div>
            <span className="fu-sep" />
            <label className="fu-check"><input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} /> 预览（隐藏控制点）</label>
          </div>

          <div ref={stageScrollRef}
            className={`fu-stage-scroll${spaceDown ? ' space-mode' : ''}${panning ? ' panning' : ''}`}
            onPointerDown={onStagePointerDown}
            onClick={(e) => {
              if (preview) return
              if (suppressClick.current) { suppressClick.current = false; return }
              // 图层自身的 onClick 会 stopPropagation；这里只处理真正的空白处点击
              if ((e.target as HTMLElement).closest('.fu-layer')) return
              selectOnly(null)
            }}>
            <div ref={sizerRef} className="fu-stage-sizer"
              style={{ width: layout.canvas.w * zoom, height: layout.canvas.h * zoom,
                transform: `translate(${pan.x}px, ${pan.y}px)` }}>
              <div className="fu-stage" ref={stageRef} style={stageStyle}
                onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
                {sortedLayers.map((l) => {
                  const isSel = selected === l.id && !preview && !selectedGroup
                  const nine = isSel && nineMode && l.kind === 'image'
                  const b = l.kind === 'image' ? l.border : [0, 0, 0, 0]
                  const scale = l.kind === 'image' ? (l.borderScale ?? 1) : 1
                  const bs = b.map((v) => v * scale)
                  const sliceDown = (side: 0 | 1 | 2 | 3) => (e: ReactPointerEvent) => {
                    e.stopPropagation(); e.preventDefault()
                    startDrag(e, { mode: 'border', id: l.id, side,
                      sx: e.clientX, sy: e.clientY, orig: [...b], origW: l.w, origH: l.h, scale })
                  }
                  return (
                    <Fragment key={l.id}>
                      {/* 画面与手柄分开渲染：混合模式只作用于画面，不影响操作组件 */}
                      <div className="fu-layer-visual"
                        style={{ ...layerBoxStyle(l), zIndex: l.z + 1, ...layerVisualStyle(l) }}>
                        {l.kind === 'text' && editingText !== l.id ? l.text : null}
                      </div>
                      <div className={`fu-layer${isSel ? ' is-sel' : ''}${nine ? ' nine-mode' : ''}`}
                        data-layer-id={l.id}
                        style={{ ...layerBoxStyle(l), zIndex: 10000 + l.z }}
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => onLayerDown(e, l)}
                        onDoubleClick={(e) => {
                          if (preview || l.kind !== 'text' || l.locked) return
                          e.stopPropagation(); e.preventDefault()
                          selectOnly(l.id)
                          setEditingText(l.id)
                        }}>
                        {l.kind === 'text' && editingText === l.id
                          ? <textarea
                            autoFocus
                            className="fu-text-edit"
                            style={textEditStyle(l)}
                            value={l.text}
                            placeholder="输入文字…（Esc 或点击空白处结束）"
                            onPointerDown={(e) => e.stopPropagation()}
                            onChange={(e) => patchLayer(l.id, { text: e.target.value })}
                            onBlur={() => setEditingText(null)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
                                e.preventDefault(); setEditingText(null)
                              }
                            }}
                          />
                          : null}
                        {isSel && <>
                          <span className="fu-layer-tag">{l.name}{nine ? ' · .9 图' : ''}
                            {Math.round(l.w / (l.baseW || l.w) * 100) !== 100 || Math.round(l.h / (l.baseH || l.h) * 100) !== 100
                              ? ` · ${Math.round(l.w / (l.baseW || l.w) * 100)}% / ${Math.round(l.h / (l.baseH || l.h) * 100)}%` : ''}</span>
                          {nine ? <>
                            <span className="fu-slice fu-slice-v" style={{ left: bs[0] }} title="左 border（显示绘制宽度，实际源像素 × 倍率）"
                              onPointerDown={sliceDown(0)}><i /><em>L {bs[0].toFixed(0)}</em></span>
                            <span className="fu-slice fu-slice-v" style={{ left: l.w - bs[2] }} title="右 border"
                              onPointerDown={sliceDown(2)}><i /><em>R {bs[2].toFixed(0)}</em></span>
                            <span className="fu-slice fu-slice-h" style={{ top: bs[3] }} title="上 border"
                              onPointerDown={sliceDown(3)}><i /><em>T {bs[3].toFixed(0)}</em></span>
                            <span className="fu-slice fu-slice-h" style={{ top: l.h - bs[1] }} title="下 border"
                              onPointerDown={sliceDown(1)}><i /><em>B {bs[1].toFixed(0)}</em></span>
                          </> : HANDLES.map((h) => (
                            <span key={h} className={`fu-handle fu-h-${h}`}
                              onPointerDown={(e) => {
                                e.stopPropagation(); e.preventDefault()
                                startDrag(e, { mode: 'resize', id: l.id, handle: h,
                                  sx: e.clientX, sy: e.clientY, orig: { ...l } })
                              }} />
                          ))}
                          <span className="fu-rotate" title="拖动旋转（Shift 吸附 15°）"
                            onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); onRotateDown(e, l) }}>⟳</span>
                        </>}
                      </div>
                    </Fragment>
                  )
                })}
                {selectedGroup && groupBox && !preview && (
                  <div className="fu-group-box" style={{
                    left: groupBox.x, top: groupBox.y,
                    width: groupBox.r - groupBox.x, height: groupBox.b - groupBox.y,
                  }}
                    onPointerDown={(e) => {
                      e.preventDefault()
                      onGroupMoveDown(e)
                    }}
                    onDoubleClick={(e) => {
                      // 组框盖住图层时，双击框内某一层可退出组模式并选中该层
                      const box = e.currentTarget as HTMLElement
                      box.style.pointerEvents = 'none'
                      const hit = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
                      box.style.pointerEvents = ''
                      const id = hit?.closest('.fu-layer')?.getAttribute('data-layer-id')
                      if (id) { selectOnly(id); setSelectedGroup(null) }
                    }}>
                    <span className="fu-group-box-tag" title="拖框内任意位置移动整组；双击框内某个图层可编辑该层"
                      onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); onGroupMoveDown(e) }}>
                      📁 {selectedGroup} · {groupMembers.length} 层（拖框内移动整组 · 双击某层编辑单层）</span>
                    <span className="fu-group-pivot" title="旋转支点：包围盒中心" />
                    {HANDLES.map((h) => (
                      <span key={h} className={`fu-handle fu-h-${h}`}
                        onPointerDown={(e) => onGroupHandleDown(e, h)} />
                    ))}
                    <span className="fu-rotate" title="拖动旋转整组（Shift 吸附 15°）"
                      onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); onGroupRotateDown(e) }}>⟳</span>
                  </div>
                )}
                {showGrid && !preview && (
                  <div className="fu-grid" style={{ backgroundSize: `${grid * zoom}px ${grid * zoom}px` }} />
                )}
                {guides.map((g, i) => (
                  <div key={i} className={g.axis === 'x' ? 'fu-guide fu-guide-x' : 'fu-guide fu-guide-y'}
                    style={g.axis === 'x' ? { left: g.pos } : { top: g.pos }} />
                ))}
              </div>
            </div>
          </div>
          <div className="fu-statusbar">
            <span>坐标以画布左上角为原点 · 选中图片后顶部切「.9 图」可拖橙色切线调 border · 空格拖动画布 · Ctrl+滚轮缩放</span>
            <span>{selLayer ? `已选：${selLayer.name} · x=${selLayer.x} y=${selLayer.y} w=${selLayer.w} h=${selLayer.h} · 缩放 ${(selLayer.w / (selLayer.baseW || selLayer.w) * 100).toFixed(0)}% / ${(selLayer.h / (selLayer.baseH || selLayer.h) * 100).toFixed(0)}%` : '未选中图层'}</span>
          </div>
        </main>

        {/* ---------- 右：图层 + 属性 ---------- */}
        <aside className="fu-right" ref={rightRef}>
          <div className="fu-pane-head">
            <span>图层 <small>{layout.layers.length}{selectedIds().length > 1 ? ` · 已选 ${selectedIds().length}` : ''}</small></span>
            <span className="fu-head-actions">
              <button className="fu-head-btn" title="把多选的图层编成组（Ctrl+G）" onClick={groupSelection}>＋编组</button>
              <button className="fu-head-btn" title="解散选中图层所在的组" onClick={ungroupSelection}>解组</button>
            </span>
          </div>
          <div className={`fu-layers${dragOverRoot ? ' root-drag' : ''}`} style={{ height: layerH }}
            onDragOver={(e) => { e.preventDefault(); setDragOverRoot(true) }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverRoot(false)
            }}
            onDrop={(e) => {
              e.preventDefault()
              const ids = draggedIds(e)
              if (ids.length) { dropIntoGroup(ids, ''); showToast('已把图层移出组') }
              setDragOverRoot(false); setDragOverGroup(null)
            }}>
            {layerTree}
            {!layout.layers.length && <div className="fu-empty">画布还是空的，从左边拖点素材过来</div>}
          </div>
          <div className={`fu-ungroup-zone${dragOverRoot ? ' on' : ''}`}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverRoot(true) }}
            onDragLeave={() => setDragOverRoot(false)}
            onDrop={ungroupDrop}
            title="把图层拖到这里即可移出所在的组">⇱ 拖到此处 = 移出组</div>
          <div className="fu-splitter" title="拖动调整图层 / 属性面板高度"
            onPointerDown={onSplitPointerDown}><span /></div>

          <div className="fu-pane-head"><span>属性</span></div>
          <div className="fu-inspector">
            {selectedGroup && groupBox ? <>
              <div className="fu-group-info">组 · {groupMembers.length} 个图层</div>
              <p className="fu-tip">画布上的虚线框是整组包围盒，拖动 8 个手柄缩放、⟳ 旋转，中心十字就是旋转支点。</p>
              <label className="fu-field"><span>组名</span>
                <input className="fu-input" value={selectedGroup}
                  onChange={(e) => renameGroup(selectedGroup, e.target.value)} /></label>
              <div className="fu-grid4">
                <NumField label="X" value={groupBox.x} onChange={(v) => applyGroupBox({ ...groupBox, x: v, r: v + (groupBox.r - groupBox.x) })} />
                <NumField label="Y" value={groupBox.y} onChange={(v) => applyGroupBox({ ...groupBox, y: v, b: v + (groupBox.b - groupBox.y) })} />
                <NumField label="宽" value={groupBox.r - groupBox.x} onChange={(v) => applyGroupBox({ ...groupBox, r: groupBox.x + Math.max(2, v) })} />
                <NumField label="高" value={groupBox.b - groupBox.y} onChange={(v) => applyGroupBox({ ...groupBox, b: groupBox.y + Math.max(2, v) })} />
              </div>
              <label className="fu-field"><span>组混合模式 · 悬停滚轮可切换</span>
                <select ref={groupBlendRef} className="fu-input" title="悬停此处滚动滚轮即可切换组内所有图层的混合模式"
                  value={groupMembers[0]?.blend || 'normal'}
                  onChange={(e) => patchGroup({ blend: e.target.value })}>
                  {BLENDS.map((b) => <option key={b} value={b}>{b}</option>)}
                </select></label>
              <label className="fu-field"><span>组透明度</span>
                <input type="range" min="0" max="1" step="0.01" value={groupMembers[0]?.opacity ?? 1}
                  onChange={(e) => patchGroup({ opacity: Number(e.target.value) })} />
                <em>{Math.round((groupMembers[0]?.opacity ?? 1) * 100)}%</em></label>
              <label className="fu-field"><span>组内图片填充模式</span>
                <select className="fu-input" value={groupMembers.find((l) => l.kind === 'image')?.fit ?? 'fill'}
                  onChange={(e) => patchGroupImages({ fit: e.target.value as ImageLayer['fit'] })}>
                  <option value="fill">拉伸 fill</option>
                  <option value="contain">适应 contain</option>
                  <option value="cover">裁切 cover</option>
                  <option value="sliced">九宫格 sliced</option>
                  <option value="tiled">平铺 tiled</option>
                </select></label>
              <div className="fu-zrow">
                <button className="fu-btn" onClick={() => duplicateGroup(selectedGroup)}>复制整组</button>
                <button className="fu-btn" onClick={() => ungroup(selectedGroup)}>解散组</button>
              </div>
              <button className="fu-btn fu-btn-danger" onClick={() => deleteGroup(selectedGroup)}>删除整组</button>
            </> : !selLayer ? <p className="fu-tip">选中一个图层或组后在这里精调位置、尺寸与样式。</p> : <>
              <label className="fu-field"><span>名称</span>
                <input className="fu-input" value={selLayer.name}
                  onChange={(e) => patchLayer(selLayer.id, { name: e.target.value })} /></label>
              <label className="fu-field"><span>所属组 · 同组图层一起移动/对齐</span>
                <div className="fu-group-edit">
                  <input className="fu-input" list="fu-group-names" placeholder="独立图层" value={selLayer.group}
                    onChange={(e) => setLayerGroup(selLayer.id, e.target.value)} />
                  {selLayer.group && <button className="fu-btn" onClick={() => ungroup(selLayer.group)}>解组</button>}
                </div>
                <datalist id="fu-group-names">
                  {groupNames.map((g) => <option key={g} value={g} />)}
                </datalist></label>
              <div className="fu-grid4">
                <NumField label="X" value={selLayer.x} onChange={(v) => patchLayer(selLayer.id, { x: v })} />
                <NumField label="Y" value={selLayer.y} onChange={(v) => patchLayer(selLayer.id, { y: v })} />
                <NumField label="宽" value={selLayer.w} onChange={(v) => patchLayer(selLayer.id, { w: v })} />
                <NumField label="高" value={selLayer.h} onChange={(v) => patchLayer(selLayer.id, { h: v })} />
                <NumField label="旋转" value={selLayer.rotate} onChange={(v) => patchLayer(selLayer.id, { rotate: v })} />
                <NumField label="圆角" value={selLayer.radius} onChange={(v) => patchLayer(selLayer.id, { radius: v })} />
                <label className="fu-field fu-span2"><span>透明度</span>
                  <input type="range" min="0" max="1" step="0.01" value={selLayer.opacity}
                    onChange={(e) => patchLayer(selLayer.id, { opacity: Number(e.target.value) })} />
                  <em>{Math.round(selLayer.opacity * 100)}%</em></label>
              </div>
              <div className="fu-field">
                <span>缩放 · 相对原始尺寸 {selLayer.baseW}×{selLayer.baseH}</span>
                <label className="fu-check" style={{ marginBottom: 4 }}>
                  <input type="checkbox" checked={scaleLink} onChange={(e) => setScaleLink(e.target.checked)} /> 等比联动</label>
                <div className="fu-grid2">
                  <NumField label="宽 %" value={+(selLayer.w / (selLayer.baseW || selLayer.w) * 100).toFixed(1)}
                    onChange={(v) => {
                      const s = Math.max(1, v) / 100
                      patchLayer(selLayer.id, {
                        w: Math.max(1, (selLayer.baseW || selLayer.w) * s),
                        ...(scaleLink ? { h: Math.max(1, (selLayer.baseH || selLayer.h) * s) } : {}),
                      })
                    }} />
                  <NumField label="高 %" value={+(selLayer.h / (selLayer.baseH || selLayer.h) * 100).toFixed(1)}
                    onChange={(v) => {
                      const s = Math.max(1, v) / 100
                      patchLayer(selLayer.id, {
                        h: Math.max(1, (selLayer.baseH || selLayer.h) * s),
                        ...(scaleLink ? { w: Math.max(1, (selLayer.baseW || selLayer.w) * s) } : {}),
                      })
                    }} />
                </div>
              </div>
              <label className="fu-field"><span>混合模式 · 悬停滚轮可切换</span>
                <select ref={blendRef} className="fu-input" value={selLayer.blend}
                  title="悬停此处滚动鼠标滚轮即可切换混合模式"
                  onChange={(e) => patchLayer(selLayer.id, { blend: e.target.value })}>
                  {BLENDS.map((b) => <option key={b} value={b}>{b}</option>)}
                </select></label>

              {selLayer.kind === 'image' && <>
                <label className="fu-field"><span>素材路径</span>
                  <input className="fu-input mono" list="fu-asset-names" value={selLayer.src}
                    onChange={(e) => patchLayer(selLayer.id, { src: e.target.value })} /></label>
                <datalist id="fu-asset-names">
                  {assets.map((a) => <option key={a.n} value={`${ASSET_BASE}${a.n}`} />)}
                </datalist>
                <div className="fu-grid2">
                  <label className="fu-field"><span>填充</span>
                    <select className="fu-input" value={selLayer.fit}
                      onChange={(e) => patchLayer(selLayer.id, { fit: e.target.value as ImageLayer['fit'] })}>
                      <option value="fill">拉伸 fill</option>
                      <option value="contain">适应 contain</option>
                      <option value="cover">裁切 cover</option>
                      <option value="sliced">九宫格 sliced</option>
                      <option value="tiled">平铺 tiled</option>
                    </select></label>
                  <label className="fu-field"><span>灰度</span>
                    <input type="range" min="0" max="1" step="0.05" value={selLayer.grayscale}
                      onChange={(e) => patchLayer(selLayer.id, { grayscale: Number(e.target.value) })} /></label>
                  <NumField label="亮度" value={selLayer.brightness} step={0.05}
                    onChange={(v) => patchLayer(selLayer.id, { brightness: v })} />
                </div>
                {(selLayer.fit === 'sliced' || selLayer.border.some((n) => n > 0)) && (
                  <div className="fu-field">
                    <span>九宫格 border（左 / 下 / 右 / 上 · 来自原作 Sprite）</span>
                    <div className="fu-border-row">
                      {(['左', '下', '右', '上'] as const).map((label, i) => (
                        <NumField key={label} label={label} value={selLayer.border[i] ?? 0}
                          onChange={(v) => {
                            const b = [...selLayer.border]
                            b[i] = Math.max(0, v)
                            patchLayer(selLayer.id, { border: b })
                          }} />
                      ))}
                    </div>
                    <div className="fu-border-scale">
                      <NumField label="边宽倍率" value={selLayer.borderScale ?? 1} step={0.05}
                        onChange={(v) => patchLayer(selLayer.id, { borderScale: Math.max(0.05, v) })} />
                      <button className="fu-btn" title="按素材原尺寸与当前图层尺寸的比例自动收细/放大边框"
                        onClick={() => {
                          const a = assets.find((x) => x.n === (selLayer.src.split('/').pop() || ''))
                          if (!a?.w || !a?.h) { showToast('素材清单里没有这张图的尺寸'); return }
                          const s = Math.max(0.05, Math.min(selLayer.w / a.w, selLayer.h / a.h))
                          patchLayer(selLayer.id, { borderScale: +s.toFixed(3) })
                          showToast(`边宽倍率已设为 ${s.toFixed(2)}`)
                        }}>按图层自适应</button>
                    </div>
                    <p className="fu-tip">倍率 &lt; 1 可把粗边收细：源图四角纹样仍完整取用，只是被压窄绘制。</p>
                  </div>
                )}
              </>}
              {selLayer.kind === 'text' && <>
                <label className="fu-field"><span>文字内容</span>
                  <textarea className="fu-input fu-textarea" rows={3} value={selLayer.text}
                    onChange={(e) => patchLayer(selLayer.id, { text: e.target.value })} /></label>
                <div className="fu-grid4">
                  <label className="fu-field fu-span2"><span>颜色</span>
                    <input className="fu-color" type="color" value={/^#/.test(selLayer.color) ? selLayer.color : '#171610'}
                      onChange={(e) => patchLayer(selLayer.id, { color: e.target.value })} /></label>
                  <NumField label="字号" value={selLayer.fontSize} onChange={(v) => patchLayer(selLayer.id, { fontSize: v })} />
                  <NumField label="字重" value={selLayer.weight} onChange={(v) => patchLayer(selLayer.id, { weight: v })} />
                  <NumField label="行高" value={selLayer.lineHeight} step={0.1} onChange={(v) => patchLayer(selLayer.id, { lineHeight: v })} />
                  <NumField label="字距" value={selLayer.letterSpacing} step={0.5} onChange={(v) => patchLayer(selLayer.id, { letterSpacing: v })} />
                  <label className="fu-field fu-span2"><span>对齐</span>
                    <select className="fu-input" value={selLayer.align}
                      onChange={(e) => patchLayer(selLayer.id, { align: e.target.value as TextLayer['align'] })}>
                      <option value="left">左</option><option value="center">中</option><option value="right">右</option>
                    </select></label>
                </div>
                <label className="fu-field"><span>文字阴影（CSS）</span>
                  <input className="fu-input" placeholder="0 1px 3px #000" value={selLayer.shadow}
                    onChange={(e) => patchLayer(selLayer.id, { shadow: e.target.value })} /></label>
              </>}
              {selLayer.kind === 'rect' && <>
                <label className="fu-field"><span>填充色</span>
                  <input className="fu-color" type="color" value={/^#/.test(selLayer.color) ? selLayer.color : '#8c1e32'}
                    onChange={(e) => patchLayer(selLayer.id, { color: e.target.value })} /></label>
                <label className="fu-field"><span>边框（CSS）</span>
                  <input className="fu-input" placeholder="1px solid #999" value={selLayer.border}
                    onChange={(e) => patchLayer(selLayer.id, { border: e.target.value })} /></label>
              </>}

              <div className="fu-zrow">
                <button className="fu-btn" onClick={() => moveZ(selectedIds(), 'bottom')}>置底</button>
                <button className="fu-btn" onClick={() => moveZ(selectedIds(), 'down')}>下移</button>
                <button className="fu-btn" onClick={() => moveZ(selectedIds(), 'up')}>上移</button>
                <button className="fu-btn" onClick={() => moveZ(selectedIds(), 'top')}>置顶</button>
              </div>
              <div className="fu-zrow">
                <button className="fu-btn" onClick={duplicateSelected}>复制图层{selectedIds().length > 1 ? `(${selectedIds().length})` : ''}</button>
                <button className="fu-btn fu-btn-danger" onClick={removeSelected}>删除图层{selectedIds().length > 1 ? `(${selectedIds().length})` : ''}</button>
              </div>
            </>}
          </div>

          <div className="fu-pane-head"><span>本地存档</span></div>
          <div className="fu-slotbox">
            <select className="fu-input" value={slotName} onChange={(e) => setSlotName(e.target.value)}>
              <option value="">选择存档…</option>
              {Object.keys(slots).sort().map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <input className="fu-input" placeholder="新存档名称" value={slotName}
              onChange={(e) => setSlotName(e.target.value)} />
            <div className="fu-zrow">
              <button className="fu-btn" onClick={saveSlot}>保存</button>
              <button className="fu-btn" onClick={loadSlot}>读取</button>
              <button className="fu-btn" onClick={removeSlot}>删除</button>
            </div>
          </div>
        </aside>
      </div>

      {toast && <div className="fu-toast">{toast}</div>}

      {modal === 'export' && (
        <div className="fu-modal-bg" onClick={() => setModal(null)}>
          <div className="fu-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fu-modal-head">
              <b>导出布局</b>
              <div className="fu-tabs">
                <button className={exportKind === 'json' ? 'on' : ''} onClick={() => {
                  setExportKind('json'); setExportText(JSON.stringify(committed, null, 2))
                }}>JSON（完整数据）</button>
                <button className={exportKind === 'css' ? 'on' : ''} onClick={() => {
                  setExportKind('css'); setExportText(exportCss(committed))
                }}>CSS（贴进 fading.css）</button>
              </div>
              <button className="fu-ico fu-close" onClick={() => setModal(null)}>✕</button>
            </div>
            <p className="fu-tip">JSON 可再次导入本编辑器或发给助手还原；CSS 是绝对定位规则，文字内容请对照 JSON 里的 <code>text</code> 字段。</p>
            <textarea id="fu-export-text" className="fu-export" readOnly value={exportText} spellCheck={false} />
            <div className="fu-modal-foot">
              <button className="fu-btn fu-btn-accent" onClick={copyExport}>复制全部</button>
              <button className="fu-btn" onClick={downloadExport}>下载文件</button>
            </div>
          </div>
        </div>
      )}

      {modal === 'help' && (
        <div className="fu-modal-bg" onClick={() => setModal(null)}>
          <div className="fu-modal fu-help" onClick={(e) => e.stopPropagation()}>
            <div className="fu-modal-head"><b>怎么用</b>
              <button className="fu-ico fu-close" onClick={() => setModal(null)}>✕</button></div>
            <ol>
              <li>左侧素材库列出 <code>public/fading_ui/</code> 里全部原版纹理。可按名字搜索、按类型筛选；拖到画布或点击添加。</li>
              <li>画布里拖动图层移动，八个角点缩放（按住 <b>Shift</b> 等比缩放，组也一样），顶部 <b>⟳</b> 旋转（按住 Shift 吸附 15°）。文字图层<b>双击</b>可直接在画布上编辑（Esc / Ctrl+Enter 结束）。右侧属性面板可输入精确数值。</li>
              <li>左侧「↺ 骨架模板」= 载入一份按原截图比例预摆好的剧情页脚手架（纸张、夹子、藤蔓、标题条、正文、选项条、状态栏…约 28 层），在它上面微调比从零开始快。会先弹窗确认，旧布局可 Ctrl+Z 找回。</li>
              <li><b>多选与编组</b>：图层面板里 <b>Ctrl + 左键</b> 多选，面板顶部点「＋编组」或按 <b>Ctrl+G</b> 即可把选中层编成组（「解组」解散）。多选后可一起删除、复制（副本自动成组）、对齐、调层级。单选时属性面板的「所属组」也能填名字编组。</li>
              <li><b>组整体变换</b>：点击图层面板的组名（📁）选中整组，画布上出现**整组虚线包围盒**；拖框内任意位置移动整组，8 个缩放手柄缩放整组，⟳ 旋转整组（中心十字是支点）。右侧属性面板切换为组属性。</li>
              <li><b>组图层模式</b>：选中组后，属性面板可统一调整组内所有图层的混合模式（悬停滚轮可切换）、透明度，以及组内图片的填充模式（fill / contain / cover / sliced / tiled）。</li>
              <li><b>编辑组内单层</b>：组框会盖住组内图层，选中组时请<b>双击框内某个图层</b>退出组模式并选中它（或直接点右侧图层面板里的行）；之后拖该层就只动它。未选中组时，拖图层本来就只移动单层。Ctrl+D 复制会保留原图层的分组，不会凭空新建组。</li>
              <li>「网格吸附」按步长对齐坐标；「智能吸附」拖动时贴齐其它图层的边 / 中心与画布中线，并显示红色参考线。「对齐」按钮把选中层或整组包围盒对齐到画布。撤销 / 重做支持 120 步（Ctrl+Z / Ctrl+Shift+Z）。「预览」隐藏所有控制点看最终效果。</li>
              <li><b>存到项目</b>写入 <code>build/fading_ui_layout.json</code>（dev 接口），换机器也不丢；<b>本地存档</b>存在浏览器里。</li>
              <li>拼好后点 <b>导出 JSON</b> 把文件发我，我就能按精确坐标/尺寸改 <code>fading.css</code>，不再靠截图猜。</li>
            </ol>
            <p className="fu-tip">缩放后属性面板会显示相对原始尺寸的<b>宽/高百分比</b>，也可直接输入百分比调整；勾选「等比联动」则宽高一起变。选中标签和底部状态栏也会实时显示。</p>
            <p className="fu-tip"><b>混合模式</b>共 17 种，属性面板里的下拉框<b>悬停后滚动鼠标滚轮</b>即可逐个切换。白色线稿想显示在浅色背景上，试试 <b>multiply</b> 或 <b>darken</b>。混合模式只作用于图像本身，选择框/手柄/切线不会跟着被混合。</p>
            <p className="fu-tip">选中图片后，顶部「变换」开关可在 <b>.9 图</b> 与 <b>自由</b> 间切换：.9 图模式下图层内出现四条橙色切线，直接拖动即可调整九宫格 border（左右上下），切线的手柄会跟着动；自由模式恢复八个缩放角点。</p>
            <p className="fu-tip">视图操作：<b>按住空格拖动</b>平移整块画布（中键拖动也可以），<b>Ctrl + 滚轮</b>以鼠标位置为锚点缩放，工具栏「适应」复位缩放与平移。</p>
            <p className="fu-tip">快捷键：方向键微调 1px（Shift 10px）、Delete 删除、Ctrl+D 复制、Ctrl+Z / Ctrl+Shift+Z 撤销重做、Esc 取消选中。</p>
          </div>
        </div>
      )}
    </div>
  )
}

function NumField({ label, value, onChange, step = 1 }: {
  label: string; value: number; onChange: (v: number) => void; step?: number
}) {
  return (
    <label className="fu-field"><span>{label}</span>
      <input className="fu-input fu-num" type="number" step={step} value={Number(value.toFixed?.(2) ?? value)}
        onChange={(e) => onChange(Number(e.target.value) || 0)} /></label>
  )
}

/** 返回游戏页的链接（编辑器嵌在同一站点里） */
function LinkBack() {
  return <a className="fu-btn fu-back" href="/game/fadingaffection">← 返回游戏</a>
}
