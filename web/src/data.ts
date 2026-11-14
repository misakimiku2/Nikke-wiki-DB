export type Character = {
  id: number
  code: string
  name: string
  names: { zh?: string; en?: string; ja?: string; ko?: string; tw?: string }
  desc: string | null
  descEn: string | null
  intro: string | null
  cv: string | null
  lines: number
  speaker: string | null
  hasDesc: boolean
}

export type Stats = {
  characters: number
  charactersWithDesc: number
  lines: number
  units: number
  segments: number
  cg: number
  cgLinked: number
  animated: number
  builtAt: string
}

/** "10" -> ["c010_00", "c010_01"] */
export type CharImages = Record<string, string[]>

export function charCode(id: number): string {
  return 'c' + String(id).padStart(3, '0')
}

export function tintFor(id: number): string {
  const h = (id * 53 + 200) % 360
  return `hsl(${h}, 55%, 26%)`
}

export function accentFor(id: number): string {
  const h = (id * 53 + 200) % 360
  return `hsl(${h}, 80%, 62%)`
}

async function getJSON<T>(path: string): Promise<T> {
  const r = await fetch(path)
  if (!r.ok) throw new Error(`${path} ${r.status}`)
  return r.json()
}

let cacheChars: Character[] | null = null
let cacheImgs: CharImages | null = null

export async function loadCharacters(): Promise<Character[]> {
  if (cacheChars) return cacheChars
  const d = await getJSON<{ items: Character[] }>('/data/characters.json')
  cacheChars = d.items
  return cacheChars
}

export async function loadCharImages(): Promise<CharImages> {
  if (cacheImgs) return cacheImgs
  try {
    cacheImgs = await getJSON<CharImages>('/data/char_images.json')
  } catch {
    cacheImgs = {}
  }
  return cacheImgs
}

export async function loadStats(): Promise<Stats> {
  return getJSON<Stats>('/data/stats.json')
}

export function mainBase(imgs: CharImages, id: number): string | null {
  const list = imgs[String(id)]
  if (!list || list.length === 0) return null
  return list.find((v) => v.endsWith('_00')) || list[0]
}

export function mainImage(imgs: CharImages, id: number): string | null {
  const base = mainBase(imgs, id)
  return base ? `/char/${base}.webp` : null
}

/* 高清立绘（Spine 站姿渲染，2048 裁边后长边 1600）+ 头部方图 */

let cacheHd: Set<string> | null = null

export async function loadCharHd(): Promise<Set<string>> {
  if (cacheHd) return cacheHd
  try {
    const d = await getJSON<{ items: string[] }>('/data/char_hd.json')
    cacheHd = new Set(d.items)
  } catch {
    cacheHd = new Set()
  }
  return cacheHd
}

export function hasHd(hd: Set<string>, base: string | null): boolean {
  return !!base && hd.has(base)
}

/** kind=full 全身立绘；kind=head 头部方图（没有高清图时退回原来的卡片立绘） */
export function charImg(base: string, hd: Set<string>, kind: 'full' | 'head' = 'full'): string {
  if (hd.has(base)) return `/charhd/${base}${kind === 'head' ? '_head' : ''}.webp`
  return `/char/${base}.webp`
}

/* Spine 模型（可在网页里直播的 CG） */

let cacheSpine: Set<string> | null = null

export async function loadSpineModels(): Promise<Set<string>> {
  if (cacheSpine) return cacheSpine
  try {
    const d = await getJSON<{ items: string[] }>('/data/spine_models.json')
    cacheSpine = new Set(d.items)
  } catch {
    cacheSpine = new Set()
  }
  return cacheSpine
}

/**
 * 舞台背景层跟随人物层一起缩放/平移的变换（transform-origin: 0 0）。
 * 独立背景图和人物层必须共用同一套变换，否则背景会被单独放大，
 * 与人物透视对不上。
 */
export type ViewTransform = { scale: number; tx: number; ty: number }

/** 单个模型的渲染覆盖配置（隐藏素材自带装饰层、补回独立背景图等） */
export type SpineOverride = {
  hiddenSlots?: string[]
  /** 独立背景 CG 的名字（按 cg_index 查 hash），或 / 开头的图片 URL */
  background?: string
  comment?: string
}
let cacheOverrides: Record<string, SpineOverride> | null = null

export async function loadSpineOverrides(): Promise<Record<string, SpineOverride>> {
  if (cacheOverrides) return cacheOverrides
  try {
    const d = await getJSON<{ models?: Record<string, SpineOverride> }>('/data/spine_overrides.json')
    cacheOverrides = d.models || {}
  } catch {
    cacheOverrides = {}
  }
  return cacheOverrides
}

export function variantsOf(imgs: CharImages, id: number): string[] {
  return imgs[String(id)] || []
}

export function nf(n: number): string {
  return (n || 0).toLocaleString('zh-CN')
}

/* ================= 剧情 ================= */

export type StoryUnit = {
  id: number
  cat: string
  label: string
  bucket: string
  title: string
  chapter: number | null
  segments: number
  lines: number
  source: string
}

/** [说话人, 说话人ID, 文本] */
export type StoryLine = [string, string, string]

export type StoryCgRef = { h: string; n: string; d?: string }

/** e = 段内 CG 事件：[台词行下标, 该行起的 CG 集合] */
export type StorySegment = { g: string; t: string; l: StoryLine[]; e?: [number, StoryCgRef[]][] }

export type StoryDetail = {
  id: number
  cat: string
  label: string
  bucket: string
  title: string
  chapter: number | null
  source: string
  segments: StorySegment[]
}

let cacheUnits: StoryUnit[] | null = null

export async function loadStoryIndex(): Promise<StoryUnit[]> {
  if (cacheUnits) return cacheUnits
  const d = await getJSON<{ items: StoryUnit[] }>('/data/story_index.json')
  cacheUnits = d.items
  return cacheUnits
}

export async function loadStoryUnit(id: string | number): Promise<StoryDetail> {
  return getJSON<StoryDetail>(`/data/story/${id}.json`)
}

export const CAT_ORDER = [
  'main', 'event', 'nikke', 'sub', 'side_story', 'gaiden', 'counseling', 'daily', 'extra',
]

export function catRank(cat: string): number {
  const i = CAT_ORDER.indexOf(cat)
  return i === -1 ? 99 : i
}

/* ================= CG ================= */

export type CgItem = {
  h: string
  n: string
  c: string
  s: string
  w: number
  h2: number
  l: number
  /** 1 = 人工标注为活动封面/主视觉（不是剧情 CG） */
  k?: number
  /** 1 = 有实时 Spine 模型（由 spine_models.json 判定，不再依赖离线合成动图） */
  d?: number
}

export type CgLink = { u: number; i: number; s: string; t: string; n?: number; p?: string }

export type CgIndex = {
  total: number
  items: CgItem[]
  links: Record<string, CgLink[]>
}

let cacheCg: CgIndex | null = null

export async function loadCgIndex(): Promise<CgIndex> {
  if (cacheCg) return cacheCg
  cacheCg = await getJSON<CgIndex>('/data/cg_index.json')
  return cacheCg
}

export const CG_CATS = [
  { key: '01_活动剧情CG', label: '活动剧情' },
  { key: '02_主线剧情CG', label: '主线剧情' },
  { key: '03_支线剧情CG', label: '支线剧情' },
  { key: '04_角色过场', label: '角色过场' },
  { key: '05_其他动态CG', label: '其他' },
]

/** 单元标题常常就是 bucket slug（如 event_stt_staranis），这种时候退回到分类名 */
export function whereOf(u: StoryUnit | undefined, uid: number): string {
  if (!u) return `单元 ${uid}`
  const t = (u.title || '').trim()
  if (!t || t === u.bucket || /^[a-z0-9_]+$/i.test(t)) return u.label
  return t
}
