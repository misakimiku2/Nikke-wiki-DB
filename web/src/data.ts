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

/**
 * 官方全身立绘（icons-char-full(hd)，1024²）。
 * 注意不要用 public/charhd：那是旧管线把 Spine 模型渲染成单帧的合成图，
 * 姿势、表情、上色都和官方立绘对不上（点「打开静态立绘原图」看到的就是它）。
 */
export function charArt(base: string): string {
  return `/char/${base}.webp`
}

/* 官方角色头像（icons-char-mi(hd)，256×512 透明底，头部到胸口） */

let cacheMi: Set<string> | null = null

export async function loadCharMi(): Promise<Set<string>> {
  if (cacheMi) return cacheMi
  try {
    const d = await getJSON<{ items: string[] }>('/data/char_mi.json')
    cacheMi = new Set(d.items)
  } catch {
    cacheMi = new Set()
  }
  return cacheMi
}

/**
 * 角色卡预览图。优先用官方 mi 头像：框图天生正确，不需要按 alpha 猜头部位置；
 * 没有头像的角色退回站姿渲染图，再没有就用 1024 图标。
 */
export function charPortrait(base: string | null, mi: Set<string>): string | null {
  if (!base) return null
  if (mi.has(base)) return `/charmi/${base}.webp`
  return charArt(base)
}

/** 详情页皮肤切换用的小方图：有 mi 就裁头部，否则官方全身图 */
export function charThumb(base: string, mi: Set<string>): string {
  if (mi.has(base)) return `/charmi/${base}.webp`
  return charArt(base)
}

/* 角色技能说明（desc 模板里的 {description_value_NN} 由前端按等级填充） */

export type CharSkill = {
  sid: number
  kind: string
  name: string
  desc: string
  values: (string | null)[][]
  levels: number
  icon: string
}

let cacheSkills: Record<string, CharSkill[]> | null = null

export async function loadCharSkills(): Promise<Record<string, CharSkill[]>> {
  if (cacheSkills) return cacheSkills
  try {
    const d = await getJSON<{ total: number; items: Record<string, CharSkill[]> }>('/data/char_skills.json')
    cacheSkills = d.items || {}
  } catch {
    cacheSkills = {}
  }
  return cacheSkills
}

/* 角色 Spine 站姿模型（可实时播放 idle / 表情动画） */

let cacheCharSpine: Set<string> | null = null

export async function loadCharSpine(): Promise<Set<string>> {
  if (cacheCharSpine) return cacheCharSpine
  try {
    const d = await getJSON<{ items: string[] }>('/data/char_spine.json')
    cacheCharSpine = new Set(d.items)
  } catch {
    cacheCharSpine = new Set()
  }
  return cacheCharSpine
}

/** 表情动画的中文名；未收录的原样显示（talk_* 是口型，放在下拉里） */
export const EXPR_LABEL: Record<string, string> = {
  idle: '待机',
  delight: '开心',
  angry: '生气',
  sad: '悲伤',
  sorrow: '难过',
  surprise: '惊讶',
  surp: '惊讶',
  surpreise: '惊讶',
  surprised: '惊讶',
  shy: '害羞',
  shy2: '害羞',
  think: '思考',
  worry: '担心',
  worried: '担心',
  no: '拒绝',
  yes: '同意',
  special: '特殊',
  action: '动作',
  battle: '战斗',
  smile: '微笑',
  happy: '高兴',
  good: '得意',
  pain: '痛苦',
  rage: '暴怒',
  mad: '恼怒',
  cry: '哭泣',
  tear: '流泪',
  panic: '惊慌',
  scared: '害怕',
  sleep: '睡眠',
  serious: '严肃',
  void: '放空',
  etc: '其他',
  go: '前进',
  bad: '失落',
  close: '闭眼',
  expression_0: '默认表情',
  expression_1: '表情 1',
  bg_idle: '背景待机',
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
