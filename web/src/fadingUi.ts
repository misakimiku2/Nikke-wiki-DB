/** FADING AFFECTION UI 编辑器的数据结构与工具函数。
 *  编辑器产出的 Layout 是纯 JSON：画布 + 若干绝对定位图层（图片 / 文字 / 色块）。
 *  同一份 JSON 既能驱动编辑器预览，也能导出成可直接贴进 fading.css 的 CSS。 */

export type LayerKind = 'image' | 'text' | 'rect'

export interface LayerBase {
  id: string
  name: string
  kind: LayerKind
  x: number
  y: number
  w: number
  h: number
  rotate: number
  opacity: number
  z: number
  visible: boolean
  locked: boolean
  /** CSS mix-blend-mode：normal / multiply / screen / overlay ... */
  blend: string
  radius: number
  /** 所属组名（空字符串=独立层）。同组图层一起移动、一起折叠显示 */
  group: string
}
export interface ImageLayer extends LayerBase {
  kind: 'image'
  src: string
  /** fill=纯拉伸 / contain / cover / sliced=九宫格(border-image) / tiled=平铺 */
  fit: 'fill' | 'contain' | 'cover' | 'sliced' | 'tiled'
  /** Unity Sprite.border，顺序 [左, 下, 右, 上]，sliced 模式使用 */
  border: number[]
  /** 九宫格边的绘制倍率：1=原图像素宽度，<1 可把粗边收细 */
  borderScale: number
  grayscale: number
  brightness: number
}
export interface TextLayer extends LayerBase {
  kind: 'text'
  text: string
  color: string
  fontSize: number
  weight: number
  align: 'left' | 'center' | 'right'
  lineHeight: number
  letterSpacing: number
  shadow: string
}
export interface RectLayer extends LayerBase {
  kind: 'rect'
  color: string
  border: string
}
export type Layer = ImageLayer | TextLayer | RectLayer

export interface FadingLayout {
  version: number
  name: string
  canvas: {
    w: number
    h: number
    bgColor: string
    bgImage: string
    bgRepeat: 'repeat' | 'no-repeat' | 'cover'
  }
  layers: Layer[]
}

export interface AssetItem { n: string; w: number; h: number; border?: number[]; tiled?: boolean }

export const ASSET_BASE = '/fading_ui/'

export function uid(): string {
  return Math.random().toString(36).slice(2, 9)
}

export function emptyLayout(w = 1080, h = 920): FadingLayout {
  return {
    version: 1,
    name: '未命名布局',
    canvas: { w, h, bgColor: '#4e4e51', bgImage: `${ASSET_BASE}marian_ptn_wood_02.png`, bgRepeat: 'repeat' },
    layers: [],
  }
}

/** 图片 / 文字 / 色块图层的快捷构造器 */
function img(name: string, file: string, x: number, y: number, w: number, h: number, extra: Partial<ImageLayer> = {}): ImageLayer {
  return {
    id: uid(), name, kind: 'image', x, y, w, h,
    rotate: 0, opacity: 1, z: 0, visible: true, locked: false,
    blend: 'normal', radius: 0, group: '',
    src: `${ASSET_BASE}${file}`, fit: 'fill', border: [0, 0, 0, 0], borderScale: 1, grayscale: 0, brightness: 1, ...extra,
  }
}
function txt(name: string, text: string, x: number, y: number, w: number, h: number, extra: Partial<TextLayer> = {}): TextLayer {
  return {
    id: uid(), name, kind: 'text', x, y, w, h,
    rotate: 0, opacity: 1, z: 0, visible: true, locked: false,
    blend: 'normal', radius: 0, group: '',
    text, color: '#171610', fontSize: 15, weight: 600,
    align: 'left', lineHeight: 1.6, letterSpacing: 0, shadow: '', ...extra,
  }
}
function rect(name: string, x: number, y: number, w: number, h: number, extra: Partial<RectLayer> = {}): RectLayer {
  return {
    id: uid(), name, kind: 'rect', x, y, w, h,
    rotate: 0, opacity: 1, z: 0, visible: true, locked: false,
    blend: 'normal', radius: 0, group: '',
    color: '#4a4638', border: '', ...extra,
  }
}

/** 一张「剧情页」骨架：按 1080×920 截图的大致比例摆好原版纹理，
 *  用户在此基础上拖动微调即可，不用从零开始对齐。 */
export function skeletonLayout(): FadingLayout {
  const layout = emptyLayout(1080, 920)
  layout.name = '剧情页骨架'
  const layers: Layer[] = [
    // 纸张底 + 褶皱纹理
    // marian_bg_paper 有 20px border，按 .9 图（九宫格拉伸）处理，四角保持原样
    rect('纸张底色', 196, 0, 688, 920, { color: '#e8e5d8' }),
    img('纸张底纸', 'marian_bg_paper.png', 196, 0, 688, 920, { fit: 'sliced', border: [20, 20, 20, 20] }),
    // marian_texture_paper 无 border，是无缝噪波，平铺才正确
    img('纸张纹理', 'marian_texture_paper.png', 196, 0, 688, 920, { opacity: 0.32, blend: 'multiply', fit: 'tiled' }),
    // 装饰：夹子 / 徽章 / 藤蔓
    img('金属夹', 'marian_deco_book.png', 474, -6, 132, 42),
    img('指挥官徽章', 'marian_deco_01.png', 250, -4, 88, 104),
    img('左侧藤蔓', 'marian_deco_02.png', 214, 72, 112, 262),
    img('右侧藤蔓', 'marian_deco_03.png', 822, 520, 104, 232),
    // 页眉标题条
    img('标题条笔刷', 'marian_bg_tilte.png', 316, 26, 372, 50),
    txt('记录标题', '7号的记录', 336, 34, 210, 32, { fontSize: 21, color: '#20303b', weight: 800 }),
    txt('页眉印章', 'IN ACTION', 578, 38, 100, 24, { fontSize: 12, color: '#a4263f', weight: 800, align: 'center', letterSpacing: 1 }),
    rect('左翻页', 690, 30, 32, 32, { color: 'transparent', border: '1px solid #8a9aa6', radius: 3 }),
    rect('重开记录', 738, 30, 32, 32, { color: 'transparent', border: '1px solid #8a9aa6', radius: 3 }),
    // 正文
    txt('Script 正文', '「！！！」\n没办法叫出名字。\n想不起来要叫的名字。\n「啊啊……啊啊啊……！」\n7号感到绝望。\n无论如何都要想起来……_', 326, 118, 440, 176, { fontSize: 15, lineHeight: 1.8, weight: 600 }),
    img('心形图标', 'icn_marian_hp.png', 326, 292, 36, 30),
    txt('状态提示', '-1', 366, 296, 60, 24, { fontSize: 13, color: '#2f5f8a', weight: 800 }),
    img('分隔线', 'marian_divider_01.png', 322, 358, 430, 14, { opacity: 0.7 }),
    // 选项条
    img('普通选项条', 'marian_bg_choice_maria.png', 310, 390, 494, 68),
    txt('选项文字', '抬起头望向她。', 372, 408, 340, 30, { fontSize: 14, weight: 700, color: '#17232c' }),
    // 底部状态栏
    img('状态栏', 'marian_bg_state.png', 298, 796, 504, 106),
    txt('体力', '体力', 344, 818, 60, 26, { fontSize: 13, color: '#182731', weight: 800 }),
    txt('体力数值', '1/10', 404, 818, 80, 26, { fontSize: 14, color: '#182731', weight: 800 }),
    txt('粮食', '粮食', 512, 818, 60, 26, { fontSize: 13, color: '#182731', weight: 800 }),
    txt('粮食数值', '0', 572, 818, 40, 26, { fontSize: 14, color: '#182731', weight: 800 }),
    img('内存卡', 'btn_marian_memory.png', 618, 802, 186, 94),
    txt('ACCESS DENIED', 'A C C E S S   D E N I E D', 366, 888, 360, 22, { fontSize: 10, color: 'rgba(255,255,255,.55)', align: 'center', letterSpacing: 2 }),
    // 弹孔
    rect('弹孔 1', 284, 120, 16, 16, { radius: 8, color: '#3a3529' }),
    rect('弹孔 2', 852, 60, 18, 18, { radius: 9, color: '#3a3529' }),
    rect('弹孔 3', 284, 668, 16, 16, { radius: 8, color: '#3a3529' }),
  ]
  const GROUP_OF: Record<string, string> = {
    纸张底色: '纸张', 纸张底纸: '纸张', 纸张纹理: '纸张',
    金属夹: '装饰', 指挥官徽章: '装饰', 左侧藤蔓: '装饰', 右侧藤蔓: '装饰',
    '弹孔 1': '装饰', '弹孔 2': '装饰', '弹孔 3': '装饰',
    标题条笔刷: '页眉', 记录标题: '页眉', 页眉印章: '页眉', 左翻页: '页眉', 重开记录: '页眉',
    'Script 正文': '正文', 心形图标: '正文', 状态提示: '正文', 分隔线: '正文',
    普通选项条: '选项', 选项文字: '选项',
    状态栏: '状态栏', 体力: '状态栏', 体力数值: '状态栏', 粮食: '状态栏',
    粮食数值: '状态栏', 内存卡: '状态栏', 'ACCESS DENIED': '状态栏',
  }
  layers.forEach((l, i) => { l.z = i; l.group = GROUP_OF[l.name] || '' })
  layout.layers = layers
  return layout
}

export function isLayout(v: unknown): v is FadingLayout {
  if (!v || typeof v !== 'object') return false
  const d = v as Partial<FadingLayout>
  return !!d.canvas && typeof d.canvas.w === 'number' && typeof d.canvas.h === 'number' && Array.isArray(d.layers)
}

/** 把每个图层的背景图路径换成实际可访问 URL（导入外部 JSON 时容错） */
export function normalizeLayout(v: FadingLayout): FadingLayout {
  return {
    ...v,
    version: 1,
    canvas: { ...v.canvas, bgImage: normSrc(v.canvas.bgImage) },
    layers: v.layers.map((l) => {
      const base = { ...l, blend: l.blend || 'normal', radius: l.radius || 0,
        rotate: l.rotate || 0, opacity: l.opacity ?? 1, visible: l.visible !== false,
        locked: !!l.locked, group: l.group || '' }
      if (base.kind === 'image') {
        const im = base as ImageLayer
        im.src = normSrc(im.src)
        im.fit = im.fit || 'fill'
        im.border = Array.isArray(im.border) && im.border.length === 4 ? im.border : [0, 0, 0, 0]
        im.borderScale = im.borderScale ?? 1
        im.grayscale = im.grayscale ?? 0
        im.brightness = im.brightness ?? 1
      }
      return base
    }),
  }
}
function normSrc(s: string): string {
  if (!s) return ''
  if (/^(https?:|data:|\/)/.test(s)) return s
  return `${ASSET_BASE}${s.replace(/^\/+/, '')}`
}

/** 导出 CSS：每个可见图层一条绝对定位规则，可直接贴进 fading.css */
export function exportCss(layout: FadingLayout): string {
  const out: string[] = [
    `/* FADING AFFECTION · UI 布局导出 — ${layout.name}（${layout.canvas.w}×${layout.canvas.h}）*/`,
    `/* 由 /game/fadingaffection/editor 生成；文字内容见同份 JSON */`,
    `.fadui-stage {`,
    `  position: relative;`,
    `  width: ${layout.canvas.w}px;`,
    `  height: ${layout.canvas.h}px;`,
    `  background-color: ${layout.canvas.bgColor};`,
  ]
  if (layout.canvas.bgImage) {
    out.push(`  background-image: url('${layout.canvas.bgImage}');`)
    out.push(`  background-repeat: ${layout.canvas.bgRepeat};`)
    if (layout.canvas.bgRepeat === 'cover') out.push(`  background-size: cover; background-position: center;`)
  }
  out.push(`  overflow: hidden;`, `}`, ``)

  for (const l of [...layout.layers].sort((a, b) => a.z - b.z)) {
    if (!l.visible) continue
    const sel = `.fadui-layer-${l.id.replace(/[^a-zA-Z0-9_-]/g, '')}`
    out.push(`${sel} /* ${l.name} */ {`,
      `  position: absolute;`,
      `  left: ${l.x}px; top: ${l.y}px; width: ${l.w}px; height: ${l.h}px;`,
      `  z-index: ${l.z};`)
    if (l.rotate) out.push(`  transform: rotate(${l.rotate}deg);`)
    if (l.opacity !== 1) out.push(`  opacity: ${l.opacity};`)
    if (l.blend !== 'normal') out.push(`  mix-blend-mode: ${l.blend};`)
    if (l.radius) out.push(`  border-radius: ${l.radius}px;`)
    if (l.kind === 'image') {
      if (l.fit === 'sliced' && l.border.some((n) => n > 0)) {
        const [bL, bB, bR, bT] = l.border.map(Math.round)
        const s = l.borderScale ?? 1
        const f = (v: number) => +(v * s).toFixed(2)
        const [L, B, R, T] = [f(bL), f(bB), f(bR), f(bT)]
        out.push(`  /* 九宫格 · Unity border(左${bL} 下${bB} 右${bR} 上${bT}) · 绘制倍率 ${s} */`,
          `  border-style: solid;`,
          `  border-color: transparent;`,
          `  border-width: ${T}px ${R}px ${B}px ${L}px;`,
          `  border-image: url('${l.src}') ${bT} ${bR} ${bB} ${bL} fill / ${T}px ${R}px ${B}px ${L}px / 0 stretch;`)
      } else if (l.fit === 'tiled') {
        out.push(`  background: url('${l.src}') repeat;`)
      } else {
        const size = l.fit === 'fill' || l.fit === 'sliced' ? '100% 100%' : l.fit
        out.push(`  background: url('${l.src}') center / ${size} no-repeat;`)
      }
      if (l.grayscale) out.push(`  filter: grayscale(${l.grayscale}) brightness(${l.brightness});`)
      else if (l.brightness !== 1) out.push(`  filter: brightness(${l.brightness});`)
    } else if (l.kind === 'rect') {
      out.push(`  background: ${l.color};`)
      if (l.border) out.push(`  border: ${l.border};`)
    } else {
      out.push(`  color: ${l.color};`,
        `  font-size: ${l.fontSize}px;`,
        `  font-weight: ${l.weight};`,
        `  line-height: ${l.lineHeight};`,
        `  letter-spacing: ${l.letterSpacing}px;`,
        `  text-align: ${l.align};`)
      if (l.shadow) out.push(`  text-shadow: ${l.shadow};`)
    }
    out.push(`}`, ``)
  }
  return out.join('\n')
}

/** 素材按文件名前缀粗分组，方便在 244 张图里找东西 */
export function assetGroup(name: string): string {
  const n = name.toLowerCase()
  if (n.startsWith('btn_')) return '按钮'
  if (n.startsWith('icn_')) return '图标'
  if (n.startsWith('marian_txt_')) return '文字印章'
  if (n.startsWith('marian_deco_')) return '装饰'
  if (n.startsWith('marian_bg_')) return '底板 / 笔刷'
  if (n.startsWith('marian_intro_')) return '开场'
  if (n.startsWith('marian_main_') || n.startsWith('marian_route')) return '菜单 / 路线'
  if (n.startsWith('marian_ptn_') || n.startsWith('marian_texture_')) return '纹理 / 木纹'
  if (n.startsWith('ele_fadingaffection_')) return '教程插画'
  if (n.startsWith('fx_') || n.includes('transition')) return '特效'
  if (n.startsWith('sactx-')) return '视图图集'
  return '其它'
}
