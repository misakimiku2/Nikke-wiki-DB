/** FADING AFFECTION 原版 prefab 布局：类型、数据加载、Unity RectTransform → CSS 换算。
 *  JSON 由 nikke_extract/scripts/export_fading_ui_layout.py 导出，经 Vite 同步到
 *  public/data/fading_prefabs/<screen>.json。 */
import type { CSSProperties } from 'react'

export interface PrefabImage {
  spritePathId: number
  sprite: string
  png: string | null
  /** 0 Simple / 1 Sliced / 2 Tiled / 3 Filled */
  type: number
  color: number[]
  fill: number
}

export interface PrefabNode {
  name: string
  active: boolean
  eff?: boolean
  anchorMin: number[]
  anchorMax: number[]
  pivot: number[]
  sizeDelta: number[]
  anchoredPosition: number[]
  scale: number[]
  rotation: number
  image?: PrefabImage
  text?: string
  children?: PrefabNode[]
}

export interface SpriteMeta {
  sprite: string
  texture: string
  png: string | null
  /** Unity 顺序 [L, B, R, T] */
  border: number[]
  rect: number[]
  pivot: number[]
}

export interface PrefabData {
  id: number
  screen: string
  canvas: { w: number; h: number }
  spriteMeta: Record<string, SpriteMeta>
  tree: PrefabNode[]
  templates: Record<string, PrefabNode>
}

const cache = new Map<string, Promise<PrefabData>>()

/** 加载某个界面的 prefab 布局（带缓存） */
export function loadPrefab(screen: string): Promise<PrefabData> {
  let p = cache.get(screen)
  if (!p) {
    p = fetch(`/data/fading_prefabs/${screen}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`prefab ${screen} HTTP ${r.status}`)
        return r.json() as Promise<PrefabData>
      })
    cache.set(screen, p)
  }
  return p
}

export interface Rect { x: number; y: number; w: number; h: number }

/** 父节点的局部坐标系：「局部尺寸」用于锚点计算，「世界变换」用于把子节点映射到画布。
 *  Unity 里父节点的 scale 会缩放整棵子树，忽略它会让深层节点越算越偏。 */
interface Frame {
  ox: number   // 局部原点(左下)的世界 X
  oy: number   // 局部原点(左下)的世界 Y（CSS top-down，即父底边）
  w: number    // 未缩放的局部宽
  h: number    // 未缩放的局部高
  sx: number   // 累计世界缩放 X
  sy: number   // 累计世界缩放 Y
}

const ROOT_FRAME = (canvas: { w: number; h: number }): Frame =>
  ({ ox: 0, oy: canvas.h, w: canvas.w, h: canvas.h, sx: 1, sy: 1 })

/** 把一个 RectTransform 放进父 Frame，返回世界矩形与它自己的子 Frame。 */
function place(n: PrefabNode, f: Frame): { rect: Rect; frame: Frame } {
  const [aminx, aminy] = n.anchorMin
  const [amaxx, amaxy] = n.anchorMax
  const [px, py] = n.pivot
  const [sw, sh] = n.sizeDelta
  const [apx, apy] = n.anchoredPosition
  const [nsx, nsy] = n.scale
  // 局部矩形（父的未缩放坐标系里）
  const w = sw + (amaxx - aminx) * f.w
  const h = sh + (amaxy - aminy) * f.h
  const centerX = ((aminx + amaxx) / 2) * f.w + apx
  const centerY = ((aminy + amaxy) / 2) * f.h + apy
  const leftLocal = centerX - px * w
  const bottomLocal = centerY - py * h
  // 世界坐标（父的 scale 围绕其局部原点作用）
  const x = f.ox + leftLocal * f.sx
  const bottom = f.oy - bottomLocal * f.sy
  const worldW = w * f.sx
  const worldH = h * f.sy
  return {
    rect: { x, y: bottom - worldH, w: worldW, h: worldH },
    frame: { ox: x, oy: bottom, w, h, sx: f.sx * nsx, sy: f.sy * nsy },
  }
}

/** 单个节点在给定父矩形下的世界矩形（父矩形按无缩放处理，供模板定位用）。 */
export function childRect(n: PrefabNode, parent: Rect): Rect {
  return place(n, { ox: parent.x, oy: parent.y + parent.h, w: parent.w, h: parent.h, sx: 1, sy: 1 }).rect
}

/** 递归计算所有节点的绝对矩形，path 形如 /root/board_ui_ver/...。
 *  canvas 可覆盖（横屏时把锚点放进 1920×1080 的框里重新推导）。 */
export function computeRects(data: PrefabData, canvas = data.canvas): Map<string, Rect> {
  const out = new Map<string, Rect>()
  const walk = (n: PrefabNode, f: Frame, path: string) => {
    const { rect, frame } = place(n, f)
    out.set(path, rect)
    for (const c of n.children || []) walk(c, frame, `${path}/${c.name}`)
  }
  for (const n of data.tree) walk(n, ROOT_FRAME(canvas), '/' + n.name)
  return out
}

/** 计算任意子树（如 item_page 模板）在给定父矩形下的绝对矩形。 */
export function computeSubtreeRects(n: PrefabNode, parent: Rect): Map<string, Rect> {
  const out = new Map<string, Rect>()
  const walk = (x: PrefabNode, f: Frame, path: string) => {
    const { rect, frame } = place(x, f)
    out.set(path, rect)
    for (const c of x.children || []) walk(c, frame, `${path}/${c.name}`)
  }
  walk(n, { ox: parent.x, oy: parent.y + parent.h, w: parent.w, h: parent.h, sx: 1, sy: 1 }, '/' + n.name)
  return out
}

/** 在子树里按名字找节点（返回第一个匹配） */
export function findNode(n: PrefabNode | undefined, name: string): PrefabNode | undefined {
  if (!n) return undefined
  if (n.name === name) return n
  for (const c of n.children || []) {
    const hit = findNode(c, name)
    if (hit) return hit
  }
  return undefined
}

/** 从绝对矩形生成定位样式（设计坐标系里的 px，外层统一 transform 缩放）。 */
export function rectStyle(r: Rect, extra?: CSSProperties): CSSProperties {
  return {
    position: 'absolute',
    left: `${r.x}px`,
    top: `${r.y}px`,
    width: `${r.w}px`,
    height: `${r.h}px`,
    ...extra,
  }
}

/** Unity RectTransform → CSS 绝对定位。百分比 + px 的 calc 让布局随容器尺寸自适应
 *  （即原版锚点机制在浏览器里的等价实现，横竖屏都靠它推导）。 */
export function nodeStyle(n: PrefabNode): CSSProperties {
  const [aminx, aminy] = n.anchorMin
  const [amaxx, amaxy] = n.anchorMax
  const [px, py] = n.pivot
  const [sw, sh] = n.sizeDelta
  const [apx, apy] = n.anchoredPosition
  const [sx, sy] = n.scale
  const leftPct = ((aminx + amaxx) / 2 - px * (amaxx - aminx)) * 100
  const leftPx = apx - px * sw
  const topPct = (1 - (aminy + amaxy) / 2 - (1 - py) * (amaxy - aminy)) * 100
  const topPx = -(apy + (1 - py) * sh)
  return {
    position: 'absolute',
    left: `calc(${leftPct}% + ${leftPx}px)`,
    top: `calc(${topPct}% + ${topPx}px)`,
    width: `calc(${(amaxx - aminx) * 100}% + ${sw}px)`,
    height: `calc(${(amaxy - aminy) * 100}% + ${sh}px)`,
    transformOrigin: `${px * 100}% ${(1 - py) * 100}%`,
    transform: `rotate(${-n.rotation}rad) scale(${sx}, ${sy})`,
  }
}

/** Image 组件 → CSS 背景。Simple 拉伸 / Sliced 九宫格 / Tiled 平铺。 */
export function imageStyle(
  img: PrefabImage,
  meta: SpriteMeta | undefined,
  extra?: CSSProperties,
): CSSProperties {
  const alpha = img.color?.[3] ?? 1
  const base: CSSProperties = { width: '100%', height: '100%', opacity: alpha, ...extra }
  if (!img.png) return base
  const url = `url(/fading_ui/${img.png})`
  // Unity Image.color 是对贴图的正片叠底。白色笔刷靠它染成蓝灰/棕色。
  // 用 CSS mask（而不是叠一层渐变，那会把透明区域也染成实心块）保留贴图 alpha。
  const [r, g, b] = img.color || [1, 1, 1]
  const isTinted = r < 0.999 || g < 0.999 || b < 0.999
  if (isTinted) {
    const tint = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`
    const maskSize = img.type === 2 ? 'auto' : '100% 100%'
    const maskRepeat = img.type === 2 ? 'repeat' : 'no-repeat'
    return {
      ...base,
      backgroundColor: tint,
      backgroundImage: 'none',
      maskImage: url,
      WebkitMaskImage: url,
      maskSize,
      WebkitMaskSize: maskSize,
      maskRepeat,
      WebkitMaskRepeat: maskRepeat,
    }
  }
  if (img.type === 2) {
    return { ...base, backgroundImage: url, backgroundRepeat: 'repeat', backgroundSize: 'auto' }
  }
  const border = meta?.border || [0, 0, 0, 0]
  if (img.type === 1 && border.some((v) => v > 0)) {
    const [L, B, R, T] = border
    const widths = `${T}px ${R}px ${B}px ${L}px`
    return {
      ...base,
      borderStyle: 'solid',
      borderWidth: widths,
      borderColor: 'transparent',
      boxSizing: 'border-box',
      backgroundImage: 'none',
      borderImageSource: url,
      borderImageSlice: `${T} ${R} ${B} ${L} fill`,
      borderImageWidth: widths,
      borderImageRepeat: 'stretch',
    }
  }
  return { ...base, backgroundImage: url, backgroundSize: '100% 100%', backgroundRepeat: 'no-repeat' }
}
