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

/* ---------- 角色副色调（accent） ---------- */

/** WCAG 相对亮度（0–1），输入 sRGB 0–255 */
function relLum(r: number, g: number, b: number): number {
  const lin = (v: number) => {
    const x = v / 255
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function hslRgb(h: number, s: number, l: number): [number, number, number] {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}

/** 浅色主题底色 --bg: #f4f1e8 */
const LIGHT_BG_LUM = relLum(244, 241, 232)

/**
 * 浅色主题用的角色色。黄（伊莱格 60°）/ 黄绿（拉普拉斯 100°）/ 绿（马士丁 126°）
 * 这类色相 62% 明度在白底上几乎看不见，蓝紫则本来就没问题——
 * 所以不做色相分段，直接从 62% 往下压明度，压到对浅色底对比度 ≥ 3.2 为止。
 */
function readableAccent(h: number): string {
  for (let l = 62; l >= 28; l--) {
    if ((LIGHT_BG_LUM + 0.05) / (relLum(...hslRgb(h, 80, l)) + 0.05) >= 3.2)
      return `hsl(${h}, 80%, ${l}%)`
  }
  return `hsl(${h}, 80%, 28%)`
}

/**
 * 角色副色调，按当前 color-scheme 自动适配两种主题：
 * 深色主题保持 62% 亮色（暗底上很清楚），浅色主题用 readableAccent 压暗版。
 */
export function accentFor(id: number): string {
  const h = (id * 53 + 200) % 360
  return `light-dark(${readableAccent(h)}, hsl(${h}, 80%, 62%))`
}

async function getJSON<T>(path: string): Promise<T> {
  // no-cache：每次重新验证，避免数据重导出后浏览器还拿旧的 characters/char_images
  const r = await fetch(path, { cache: 'no-cache' })
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

/** 立绘显示名（来自游戏本地化/皮肤名），key 为 c010_02 这种资源代号 */
export type CharArtInfo = { n: string; old: boolean }
export type CharArtMap = Record<string, CharArtInfo>

let cacheArtMap: CharArtMap | null = null

export async function loadCharArt(): Promise<CharArtMap> {
  if (cacheArtMap) return cacheArtMap
  try {
    cacheArtMap = await getJSON<CharArtMap>('/data/char_art.json')
  } catch {
    cacheArtMap = {}
  }
  return cacheArtMap
}

export function artLabel(art: CharArtMap, base: string): string {
  return art[base]?.n || base
}

/** 皮肤文案（来自 Locale_CharacterCostume + Locale_Character 的 {id}_{variant}_intro） */
export type CostumeText = { name?: string; desc?: string; intro?: string }
export type CostumeTextMap = Record<string, CostumeText>

let cacheCostumeTexts: CostumeTextMap | null = null

export async function loadCostumeTexts(): Promise<CostumeTextMap> {
  if (cacheCostumeTexts) return cacheCostumeTexts
  try {
    cacheCostumeTexts = await getJSON<CostumeTextMap>('/data/costume_texts.json')
  } catch {
    cacheCostumeTexts = {}
  }
  return cacheCostumeTexts
}

/**
 * 角色元数据（来自游戏静态表，export_char_meta.mjs 导出）：
 * 兵种 cls（1 火力 / 2 防御 / 3 辅助）、企业 corp（1 极乐净土 / 2 米西利斯 / 3 泰特拉 / 4 朝圣者 / 5 反常——
 * 联动角色的游戏枚举 7 导出时归入 5；101 中央政府 / 102 伊甸园 / 103 V.T.C. 为站内自设枚举，NPC 由人工校对并入）、
 * 武器 weapon（ar/sg/rl/smg/sr/mg，由攻击技能射击表反查）、爆裂阶段 burst（1/2/3，5=全爆裂）、
 * 部队 squad（群聊标题与官方部队名匹配，部分角色缺失）、
 * 属性 element（人工对游戏整理，build/export_char_meta.mjs 的 ELEMENT_MANUAL 并入，
 * fire/water/wind/electric/iron；无战斗属性的 NPC 缺失）。
 */
export type CharMeta = {
  burst?: number | null
  corp?: number | null
  cls?: number | null
  weapon?: string | null
  squad?: string | null
  element?: string | null
}
export type CharMetaMap = Record<string, CharMeta>

/* 枚举显示名（char_meta.json 的数值/代码枚举 → 官方中文名），概览卡与图鉴筛选共用 */
export const SPEC_CORP: Record<number, string> = {
  1: '极乐净土', 2: '米西利斯', 3: '泰特拉', 4: '朝圣者', 5: '反常',
  101: '中央政府', 102: '伊甸园', 103: 'V.T.C.',
}
export const SPEC_CLS: Record<number, string> = { 1: '火力型', 2: '防御型', 3: '辅助型' }
export const SPEC_WEAPON: Record<string, string> = {
  ar: '步枪', smg: '冲锋枪', sg: '霰弹枪', rl: '发射器', sr: '狙击步枪', mg: '机枪',
}
export const SPEC_ELEMENT: Record<string, string> = {
  fire: '燃烧', water: '水冷', wind: '风压', electric: '电击', iron: '铁甲',
}
export const SPEC_BURST: Record<number, string> = { 1: 'Ⅰ', 2: 'Ⅱ', 3: 'Ⅲ', 5: '全爆裂' }

let cacheCharMeta: CharMetaMap | null = null

export async function loadCharMeta(): Promise<CharMetaMap> {
  if (cacheCharMeta) return cacheCharMeta
  try {
    cacheCharMeta = await getJSON<CharMetaMap>('/data/char_meta.json')
  } catch {
    cacheCharMeta = {}
  }
  return cacheCharMeta
}

/**
 * 概览卡弹窗的官方说明文本（export_char_meta.mjs 导出）：
 * 枪械类型/兵种/企业带官方名称与描述；squad 为部队世界观介绍（Locale_Character 的 squad_*_info）；
 * 属性 desc 待人工属性表并入后使用。企业/部队均为游戏内原文（换行分段）。
 */
export type SpecTextEntry = { name?: string; desc?: string }
export type SpecTexts = {
  weapon: Record<string, SpecTextEntry>
  cls: Record<string, SpecTextEntry>
  element: Record<string, SpecTextEntry>
  corp: Record<string, SpecTextEntry>
  squad: Record<string, string>
}

let cacheSpecTexts: SpecTexts | null = null

export async function loadSpecTexts(): Promise<SpecTexts> {
  if (cacheSpecTexts) return cacheSpecTexts
  try {
    cacheSpecTexts = await getJSON<SpecTexts>('/data/spec_texts.json')
  } catch {
    cacheSpecTexts = { weapon: {}, cls: {}, element: {}, corp: {}, squad: {} }
  }
  return cacheSpecTexts
}

/* ---------- 角色基础属性（等级 → HP / ATK / DEF） ---------- */

/** 属性曲线：数组索引 = 等级 - 1 */
export type StatCurve = { hp: number[]; atk: number[]; def: number[] }
export type StatCurves = Record<string, StatCurve>

/** char_stats.json 单条：模板键 + 16 个关键等级的数值快照 */
export type CharBaseStat = {
  id: number
  name: string | null
  nameEn: string | null
  code: string | null
  template: number
  rarity: 'R' | 'SR' | 'SSR'
  cls: number
  clsName: string
  weapon: string
  stats: Record<string, { hp: number; atk: number; def: number }>
}

/** 突破星级 → 角色等级上限。3 星之后接同步器等级，属性表最高给到 1400 级 */
export const LB_MAX_LEVEL = [80, 120, 160, 1400]

/** 每次突破的属性增益：+2% 与固定值（固定值按稀有度区分，来自 CharacterStatEnhanceTable） */
export const LB_GAIN: Record<string, { hp: number; atk: number; def: number }> = {
  R: { hp: 2300, atk: 16, def: 80 },
  SR: { hp: 2300, atk: 18, def: 90 },
  SSR: { hp: 3000, atk: 20, def: 100 },
}

/** 好感度上限：朝圣者 40，其余 30 */
export function affectionMax(corp: number | null | undefined): number {
  return corp === 4 ? 40 : 30
}
/** 好感每级加成约 0.1% 三围（30 级约占 200 级总属性 3%） */
export const AFFECTION_PER_LV = 0.001

/** 极限突破（核心强化）：3 星之后 0–7 级，每级 +2%，无固定值 */
export const CORE_MAX = 7
export const CORE_RATE = 0.02

let cacheStatCurves: StatCurves | null = null

export async function loadStatCurves(): Promise<StatCurves> {
  if (cacheStatCurves) return cacheStatCurves
  try {
    cacheStatCurves = await getJSON<StatCurves>('/data/stat_curves.json')
  } catch {
    cacheStatCurves = {}
  }
  return cacheStatCurves
}

let cacheCharStats: Record<string, CharBaseStat> | null = null

export async function loadCharStats(): Promise<Record<string, CharBaseStat>> {
  if (cacheCharStats) return cacheCharStats
  try {
    cacheCharStats = await getJSON<Record<string, CharBaseStat>>('/data/char_stats.json')
  } catch {
    cacheCharStats = {}
  }
  return cacheCharStats
}

/* ---------- 装备（部位 × 职业 × 品阶） ---------- */

export type EquipPart = 'head' | 'arm' | 'body' | 'leg'
export type EquipStat = {
  part: EquipPart
  cls: number
  tier: number
  atk: number
  hp: number
  def: number
}
export type EquipStats = { items: EquipStat[] }

export const EQUIP_PARTS: EquipPart[] = ['head', 'arm', 'body', 'leg']
export const EQUIP_PART_CN: Record<EquipPart, string> = {
  head: '头盔', arm: '手套', body: '衣服', leg: '靴子',
}
export const EQUIP_TIERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
export const EQUIP_MAX_ENHANCE = 5
/** 每级强化 +10% 基础值（游戏内 +0～+5 共约 +50%） */
export const EQUIP_ENHANCE_RATE = 0.1

/** 品阶 → 图标档位（图集只提供 6 档外观，相邻品阶共用） */
const TIER_ICON: Record<number, string> = {
  1: 't1', 2: 't1', 3: 't3', 4: 't3', 5: 't5',
  6: 't5', 7: 't7', 8: 't7', 9: 't9_1', 10: 't9_3',
}
const CLS_KEY: Record<number, string> = { 1: 'attacker', 2: 'defender', 3: 'supporter' }

/** 装备图标路径（dp 池 icons-equip 图集切图，128²） */
export function equipIcon(part: EquipPart, cls: number, tier: number): string {
  const t = TIER_ICON[tier] ?? 't9_1'
  const c = CLS_KEY[cls] ?? 'attacker'
  return `/equipicon/icn_equipment_${part}_${c}_${t}.webp`
}

/** T10 词条（Overload）：9 种，每种 15 档，数值为社区实测表 */
export type EquipOption = {
  key: string
  label: string
  /** 索引 = 档位-1，共 15 档 */
  tiers: number[]
}

export const EQUIP_OPTIONS: EquipOption[] = [
  {
    key: 'atk', label: '攻击力增加',
    tiers: [4.77, 5.47, 6.18, 6.88, 7.59, 8.29, 9.00, 9.70, 10.40, 11.11, 11.81, 12.52, 13.22, 13.93, 14.63],
  },
  {
    key: 'def', label: '防御力增加',
    tiers: [4.77, 5.47, 6.18, 6.88, 7.59, 8.29, 9.00, 9.70, 10.40, 11.11, 11.81, 12.52, 13.22, 13.93, 14.63],
  },
  {
    key: 'elem', label: '优越代码伤害增加',
    tiers: [9.54, 10.94, 12.34, 13.75, 15.15, 16.55, 17.95, 19.35, 20.75, 22.15, 23.56, 24.96, 26.36, 27.76, 29.16],
  },
  {
    key: 'critdmg', label: '暴击伤害增加',
    tiers: [6.64, 7.62, 8.60, 9.58, 10.56, 11.54, 12.52, 13.50, 14.48, 15.46, 16.44, 17.42, 18.40, 19.38, 20.36],
  },
  {
    key: 'crit', label: '暴击率增加',
    tiers: [2.30, 2.64, 2.98, 3.32, 3.66, 4.00, 4.35, 4.69, 5.03, 5.37, 5.70, 6.05, 6.39, 6.73, 7.07],
  },
  {
    key: 'ammo', label: '最大装弹数',
    tiers: [27.84, 31.95, 36.06, 40.17, 44.28, 48.39, 52.50, 56.60, 60.71, 64.82, 68.93, 73.04, 77.15, 81.26, 85.37],
  },
  {
    key: 'hit', label: '命中率增加',
    tiers: [4.77, 5.47, 6.18, 6.88, 7.59, 8.29, 9.00, 9.70, 10.40, 11.11, 11.81, 12.52, 13.22, 13.93, 14.63],
  },
  {
    key: 'charge', label: '蓄力伤害增加',
    tiers: [4.77, 5.47, 6.18, 6.88, 7.59, 8.29, 9.00, 9.70, 10.40, 11.11, 11.81, 12.52, 13.22, 13.93, 14.63],
  },
  {
    key: 'chargespd', label: '蓄力速度增加',
    tiers: [1.98, 2.28, 2.57, 2.86, 3.16, 3.45, 3.75, 4.04, 4.33, 4.63, 4.92, 5.21, 5.51, 5.80, 6.09],
  },
]

/** 档位概率：1-5 档 60%，6-10 档 35%，11-15 档 5% */
export const EQUIP_TIER_ODDS = ['60%', '60%', '60%', '60%', '60%',
  '35%', '35%', '35%', '35%', '35%', '5%', '5%', '5%', '5%', '5%']

let cacheEquipStats: EquipStats | null = null

export async function loadEquipStats(): Promise<EquipStats> {
  if (cacheEquipStats) return cacheEquipStats
  try {
    cacheEquipStats = await getJSON<EquipStats>('/data/equip_stats.json')
  } catch {
    cacheEquipStats = { items: [] }
  }
  return cacheEquipStats
}

/* ---------- 魔方（Harmony Cube） ---------- */

export type CubeLevel = {
  lv: number
  atk: number
  def: number
  hp: number
  /** 该等级可装备的妮姬数量 */
  slots: number
}

export type CubeInfo = {
  id: number
  /** 图标/外观 ID，图标文件名即 ie_{iconId}，与序号不同（如量子魔方是 11001） */
  iconId: number
  /** 游戏内主题色 #RRGGBB */
  color: string
  key: string
  name: string
  nameEn: string
  /** 该魔方自身的技能效果名 */
  effect: string
  unit: string
  /** 三档数值：Lv1-2 / Lv3-6 / Lv7-15 */
  tiers: number[]
  /** 会作用到三围面板的字段 */
  affects: 'hp' | 'def' | null
}

export type CubeStats = {
  levels: CubeLevel[]
  cubes: CubeInfo[]
  /** 所有魔方通用的「优越代码伤害」按等级，Lv1-4 为 null */
  elemental: (number | null)[]
  tierBounds: number[]
}

/** 魔方等级上限 */
export const CUBE_MAX_LEVEL = 15

/** 魔方图标：dp 池 icons-equip 里的 ie_{id} 精灵（256²，透明底）
 * 10018（外框魔方）为最新魔方，本地客户端图集尚未收录，前端自动回退线框占位 */
export function cubeIcon(id: number): string {
  return `/cubeicon/ie_${id}.webp`
}

/** 等级 → 档位下标（0/1/2），对应 tiers */
export function cubeTierIndex(lv: number, bounds: number[]): number {
  const [a, b] = bounds
  if (lv <= a) return 0
  if (lv <= b) return 1
  return 2
}

let cacheCubeStats: CubeStats | null = null

export async function loadCubeStats(): Promise<CubeStats> {
  if (cacheCubeStats) return cacheCubeStats
  try {
    cacheCubeStats = await getJSON<CubeStats>('/data/cube_stats.json')
  } catch {
    cacheCubeStats = { levels: [], cubes: [], elemental: [], tierBounds: [2, 6, 15] }
  }
  return cacheCubeStats
}

/* ---------- 珍藏品（Favorite Item / 收集品娃娃） ---------- */

export type FavoriteLevel = { lv: number; hp: number; atk: number; def: number }
export type FavoriteInfo = {
  id: number
  key: string
  cls: string
  weapon: string
  rare: 'R' | 'SR'
  name: string
  nameEn: string
  desc: string
  icon: string
  /** 16 级三围，索引 = 阶段 0-15 */
  levels: FavoriteLevel[]
}
export type FavoriteStats = FavoriteInfo[]

/** 珍藏品阶段上限（0-15，共 16 阶） */
export const FAVORITE_MAX_PHASE = 15

/** 图标：dp 池 icons-favoriteitem(hd) 的 si_favoriteitem_<职业>_00（R/SR 共用） */
export function favoriteIcon(cls: string): string {
  return `/favoriteicon/si_favoriteitem_${cls}_00.webp`
}

/** 各职业娃娃的技能效果（社区实测，非三围面板属性；phase 分档） */
export const FAVORITE_EFFECTS: Record<string, { label: string; skill: string; tiers: number[]; unit: string }[]> = {
  ar: [
    { label: '核心伤害增加', skill: '给予勇气的视线', tiers: [8.52, 12.78, 17.04], unit: '%' },
    { label: '防御力增加', skill: '心灵的支柱', tiers: [18.5, 27.75, 37], unit: '%' },
  ],
  mg: [
    { label: '最大装弹数增加', skill: '给予勇气的视线', tiers: [4.75, 7.13, 9.5], unit: '%' },
    { label: '防御力增加', skill: '心灵的支柱', tiers: [18.5, 27.75, 37], unit: '%' },
  ],
  rl: [
    { label: '蓄力伤害增加', skill: '给予勇气的视线', tiers: [4.74, 7.11, 9.47], unit: '%' },
    { label: '防御力增加', skill: '心灵的支柱', tiers: [18.5, 27.75, 37], unit: '%' },
  ],
  sg: [
    { label: '普通攻击伤害增加', skill: '给予勇气的视线', tiers: [4.73, 7.1, 9.46], unit: '%' },
    { label: '防御力增加', skill: '心灵的支柱', tiers: [18.5, 27.75, 37], unit: '%' },
  ],
  smg: [
    { label: '普通攻击伤害增加', skill: '给予勇气的视线', tiers: [4.73, 7.1, 9.46], unit: '%' },
    { label: '防御力增加', skill: '心灵的支柱', tiers: [18.5, 27.75, 37], unit: '%' },
  ],
  sr: [
    { label: '蓄力伤害增加', skill: '给予勇气的视线', tiers: [4.74, 7.11, 9.47], unit: '%' },
    { label: '防御力增加', skill: '心灵的支柱', tiers: [18.5, 27.75, 37], unit: '%' },
  ],
}
/** 珍藏品通用第三效果（所有职业） */
export const FAVORITE_GLOBAL_EFFECTS = [
  { label: '所受伤害减少', tiers: [8.5, 12.75, 17], unit: '%' },
  { label: '掩体最大体力增加', tiers: [15, 22.5, 30], unit: '%' },
]
/** 阶段 → 技能档位下标（0/1/2）：0-5 / 6-10 / 11-15 */
export function favoriteTierIndex(phase: number): number {
  if (phase <= 5) return 0
  if (phase <= 10) return 1
  return 2
}

let cacheFavoriteStats: FavoriteStats | null = null

export async function loadFavoriteStats(): Promise<FavoriteStats> {
  if (cacheFavoriteStats) return cacheFavoriteStats
  try {
    cacheFavoriteStats = await getJSON<FavoriteStats>('/data/favorite_stats.json')
  } catch {
    cacheFavoriteStats = []
  }
  return cacheFavoriteStats
}

/** 部队专属图标（dp 池 icons-squad 图集提取，部队中文名 → 图标路径；
 * 联动部队与四兽/近接等自创部队不在游戏图集内，查不到即回退无图标） */
export type SquadIcons = Record<string, string>

let cacheSquadIcons: SquadIcons | null = null

export async function loadSquadIcons(): Promise<SquadIcons> {
  if (cacheSquadIcons) return cacheSquadIcons
  try {
    cacheSquadIcons = await getJSON<SquadIcons>('/data/squad_icons.json')
  } catch {
    cacheSquadIcons = {}
  }
  return cacheSquadIcons
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

export type CharSkillsData = {
  items: Record<string, CharSkill[]>
  /** 词组 ID → 解释行（描述里 <word_group=ID>词条</word_group> 的弹窗文本） */
  terms: Record<number, string[]>
}

let cacheSkills: CharSkillsData | null = null

export async function loadCharSkills(): Promise<CharSkillsData> {
  if (cacheSkills) return cacheSkills
  try {
    cacheSkills = await getJSON<CharSkillsData>('/data/char_skills.json')
    cacheSkills.items = cacheSkills.items || {}
    cacheSkills.terms = cacheSkills.terms || {}
  } catch {
    cacheSkills = { items: {}, terms: {} }
  }
  return cacheSkills
}

/* 角色好感剧情 / 咨询 映射（行数据本体按需走 loadStoryUnit） */

export type CharStoryChapter = { t: string; n: number }

export type CharStoryRec = {
  id: number
  t: string
  lines: number
  /** 个人剧情段数 / 咨询会话数 */
  segs?: number
  sessions?: number
  /** 皮肤名（皮肤专属剧情/咨询） */
  skin?: string
  /** 个人剧情的章节名与句数（咨询没有） */
  chapters?: CharStoryChapter[]
}

export type CharStoriesData = Record<string, { stories: CharStoryRec[]; counsel: CharStoryRec[] }>

let cacheStories: CharStoriesData | null = null

export async function loadCharStories(): Promise<CharStoriesData> {
  if (cacheStories) return cacheStories
  try {
    const d = await getJSON<{ items: CharStoriesData }>('/data/char_stories.json')
    cacheStories = d.items || {}
  } catch {
    cacheStories = {}
  }
  return cacheStories
}

/* 角色语音（日语 + 国服中文）。

   每个角色每种语言一条 OGG 雪碧图，按 start/end 播放其中一段；避免为 1 万多条
   语音各生成一个文件（静态托管有文件数上限）。国服版本较旧，部分角色/台词没有
   中文语音，因此中文片段是可选的，前端会回退到日语。 */

export type CharVoice = {
  id: string
  /** 语音说明（在大厅点击时I / 礼物II …） */
  t: string
  /** 中文台词（国际服 zh-CN） */
  x: string
  /** 国服中文台词；与语音一致，和国际服文本可能不同 */
  xz?: string
  /** 日文原文 */
  j?: string
  /** 日语雪碧图中的起止秒数 */
  s: number
  e: number
  /** 中文雪碧图中的起止秒数；国服缺失时没有 */
  zs?: number
  ze?: number
  /** 同一角色有多套皮肤语音时，标注来自哪套皮肤 */
  g?: string
}

export type CharVoiceCat = { k: string; n: string; v: CharVoice[] }
export type CharVoiceData = {
  /** 日语雪碧图 */
  f: string
  /** 中文雪碧图（国服没有该角色语音时没有） */
  fz?: string
  /** 语音总数 */
  n: number
  /** 中文语音条数 */
  zc?: number
  /** 日配声优 */
  cvj?: string
  /** 中配声优 */
  cvz?: string
  cats: CharVoiceCat[]
}

let cacheVoices: Record<string, CharVoiceData> | null = null

export async function loadCharVoices(): Promise<Record<string, CharVoiceData>> {
  if (cacheVoices) return cacheVoices
  try {
    const d = await getJSON<{ items: Record<string, CharVoiceData> }>('/data/char_voices.json')
    cacheVoices = d.items || {}
  } catch {
    cacheVoices = {}
  }
  return cacheVoices
}

/* 角色巴拉（Blabla）短信 / 主线短信。
   房间含分支：行尾 next 是 ref 跳转目标下标（-1 = 顺序往下），choice=1 表示
   玩家可选回复。群聊的发言人与显示名在 sn 里按 slug 查。 */

export type CharMsgLine = [
  kind: number,          // 0 角色 / 1 指挥官 / 2 系统
  sender: string | null, // MessengerMemberTable slug
  text: string,
  next: number,
  choice: number,
]

export type CharMsgRoom = {
  /** 房间标题（私聊为角色名，群聊为群名） */
  t: string
  /** blabla = 巴拉聊天，main = 主线短信 */
  c: 'blabla' | 'main'
  /** [角色 id, 显示名] */
  m: [number, string][]
  /** 发言人 slug → [角色 id, 聊天显示名] */
  sn: Record<string, [number | null, string]>
  l: CharMsgLine[]
}

export type CharMsgItem = { rooms: string[]; lines: number }

export type CharMessagesData = {
  total: number
  rooms: Record<string, CharMsgRoom>
  items: Record<string, CharMsgItem>
}

let cacheMessages: CharMessagesData | null = null

export async function loadCharMessages(): Promise<CharMessagesData> {
  if (cacheMessages) return cacheMessages
  try {
    cacheMessages = await getJSON<CharMessagesData>('/data/char_messages.json')
  } catch {
    cacheMessages = { total: 0, rooms: {}, items: {} }
  }
  return cacheMessages
}

/* 咨询分支流（export_counsel_flow.py，来自引擎脚本表）：
   next = 显式跳转（缺省 next(x)=x+1），choices = 选项组（1-based 行号） */

export type CounselFlow = { next: Record<number, number>; choices: number[][] }

let cacheFlow: Record<string, CounselFlow> | null = null

export async function loadCounselFlow(): Promise<Record<string, CounselFlow>> {
  if (cacheFlow) return cacheFlow
  try {
    const d = await getJSON<{ items: Record<string, CounselFlow> }>('/data/counsel_flow.json')
    cacheFlow = d.items || {}
  } catch {
    cacheFlow = {}
  }
  return cacheFlow
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

/* 角色战斗姿态模型（aim 背身射击 / cover 掩体），名字形如 c010_aim_00 */

let cacheCharCombat: Set<string> | null = null

export async function loadCharCombat(): Promise<Set<string>> {
  if (cacheCharCombat) return cacheCharCombat
  try {
    const d = await getJSON<{ items: string[] }>('/data/char_spine_combat.json')
    cacheCharCombat = new Set(d.items)
  } catch {
    cacheCharCombat = new Set()
  }
  return cacheCharCombat
}

/** 站姿皮肤名 c010_00 → 某姿态的战斗模型名；皮肤无该姿态时返回 null */
export function combatModelName(current: string, pose: 'aim' | 'cover', have: Set<string>): string | null {
  const m = current.match(/^(.+)_(\d+)$/)
  if (!m) return null
  const name = `${m[1]}_${pose}_${m[2]}`
  return have.has(name) ? name : null
}

/* 角色大招 cut-in 模型（c010_00_skillcut 等，源数据有拼写变体）。
   构建期已算好 皮肤→模型 映射；byChar 是无皮肤段模型的角色级兜底。
   bg = 有独立手绘背景贴图的模型（网页里铺在大招画布底下） */

export type SkillcutIndex = {
  bySkin: Record<string, string>
  byChar: Record<string, string>
  bg: Set<string>
  /** 多镜大招的第二张场景图（切镜后换用） */
  bg2: Set<string>
  /** 三镜大招的第三张场景图（第二个切点后换用） */
  bg3: Set<string>
  /** 同段镜头内的贴图状态切换（sceneBlurCut 时刻起显示） */
  bg4: Set<string>
}

let cacheSkillcut: SkillcutIndex | null = null

export async function loadCharSkillcut(): Promise<SkillcutIndex> {
  if (cacheSkillcut) return cacheSkillcut
  try {
    const d = await getJSON<{ bySkin?: Record<string, string>; byChar?: Record<string, string>; bgs?: string[]; bg2s?: string[]; bg3s?: string[]; bg4s?: string[] }>(
      '/data/char_spine_skillcut.json')
    cacheSkillcut = {
      bySkin: d.bySkin || {},
      byChar: d.byChar || {},
      bg: new Set(d.bgs || []),
      bg2: new Set(d.bg2s || []),
      bg3: new Set(d.bg3s || []),
      bg4: new Set(d.bg4s || []),
    }
  } catch {
    cacheSkillcut = { bySkin: {}, byChar: {}, bg: new Set(), bg2: new Set(), bg3: new Set(), bg4: new Set() }
  }
  return cacheSkillcut
}

/** 皮肤 c010_00 → 大招模型；先查皮肤级，再查角色级（c093_skillcut 这类无皮肤段） */
export function skillcutModelName(current: string, idx: SkillcutIndex): string | null {
  return idx.bySkin[current] || idx.byChar[current.match(/^(c\d+)_/)?.[1] || ''] || null
}

/**
 * 部分大招模型的 `skillcut_1` 是纯背景层动画（只有 1 个 bg 附件、无角色部件），
 * 角色本体在另一段里。游戏里这些段是分层同时渲染的，我们只播一段，若按通用
 * 规则命中背景段就只剩一张背景图。这里按模型名指定「真正带角色的段」。
 * 判定方法：逐段采样可见槽位数，背景段全程 ≤23，角色段 ≥108（离线全量扫描
 * 233 个模型，只有下列 13 个出现错选）。key 为 spine_skillcut 目录名。
 */
const BURST_CHAR_SEGMENT: Record<string, string> = {
  c073_00_skillcut: 'skillcut_2',
  c093_skillcut: 'skillcut_0',
  c094_00_skillcut: 'skillcut_2_OFF_MOVE_BIG',
  c105_00_skillcut: 'skillcut_2',
  c191_02_skillcut: 'skillcut_2',
  c223_01_skillcut: 'skillcut_2',
  c234_00_skillcut: 'skillcut_2',
  c281_02_skillcut: 'skillcut_2',
  c331_00_skillcut: 'skillcut_2',
  c411_00_skillcut: 'skillcut_2',
  c580_01_skillcut: 'skillcut_2',
  c582_00_skillcut: 'skillcut_0',
  c833_00_skillcut: 'skillcut_2',
}

/**
 * 大招「角色段 + 背景段」双实例合成配置：key 为模型名，value 为只含背景图/背景
 * 运镜的那段动画名。游戏里这类演出用两个骨架实例分别播角色段与背景段再叠加；
 * 背景段有独立的运镜骨，和角色段动画同步，构图上比纯静态背景板更接近原作。
 * 只有确认两段共用同一套运镜、叠在一起观感正确的模型才加进来。
 */
export const BURST_BG_SEGMENT: Record<string, string> = {
  c093_skillcut: 'skillcut_1', // 艾玛:战术升级 —— 暗场+右侧光条，与角色段同运镜
  c094_00_skillcut: 'skillcut_1_OFF', // 贝斯蒂:战术升级 —— 深蓝聚光灯，角色清晰
  c582_00_skillcut: 'skillcut_1', // 蕾贝儿 —— 书桌/紫色思考泡场景
}
/** 其余 10 个错选模型（c073/c105/c191/c223/c234/c281/c331/c411/c580/c833）的
 *  背景段多为纯色板/特效，未逐一验证叠加观感，暂只播角色段（见 BURST_CHAR_SEGMENT）。 */

/** 取模型的大招背景段动画名（无则 undefined） */
export function burstBgSegment(model?: string): string | undefined {
  return model ? BURST_BG_SEGMENT[model] : undefined
}

/**
 * 大招 cut-in 的主动画挑选。源数据命名五花八门（全量 233 个里 30 个不带
 * skillcut_1）：skillcut_0 / skillcut_01 / skilcut_1（拼写错误）/ skillcut1 /
 * skillcut / skill_cut / skill_01 / c094 的 _OFF 三段式 / c532 的 _all 分层。
 * 先按模型名查角色段覆盖表（见 BURST_CHAR_SEGMENT），再走通用规则：
 * 精确名优先，其余在含 skil 的动画里取编号最小的（分段式取第 1 段）。
 * @param model 大招模型名（如 c582_00_skillcut），用于命中角色段覆盖表
 */
export function pickBurstAnim(names: string[], model?: string): string | undefined {
  const fix = model && BURST_CHAR_SEGMENT[model]
  if (fix && names.includes(fix)) return fix
  const exact = [/^skillcut_1_all$/, /^skillcut_1$/, /^skillcut$/, /^skill_cut$/]
  for (const p of exact) {
    const hit = names.find((n) => p.test(n))
    if (hit) return hit
  }
  const cand = names.filter((n) => /skil/i.test(n) && !/_bg$|_character$/.test(n))
  if (cand.length) {
    const num = (n: string) => {
      const m = n.match(/(\d+)/g)
      return m ? Number(m[m.length - 1]) : 0
    }
    return [...cand].sort((a, b) => num(a) - num(b))[0]
  }
  return undefined
}

/**
 * 角色「第二形态」检测。
 * 一部分妮姬的站姿模型把两种形态做在同一套动画里，同一批表情各录两份：
 * idle/idle_02、angry/angry_alt、idle/idle_blue …… 这些变体动画目前会和普通
 * 表情一起挤在「更多表情」下拉里。这里把它们识别出来，供页面做形态切换。
 *
 * 后缀命名并不统一（_02 / _alt / _blue / _2，同一模型内部还可能混用：
 * 桃乐丝 c233 的 idle 变体叫 idle_alt、angry 变体却叫 angry_02），因此按
 * 「去掉一个后缀后得到纯基础名、且该基础名真实存在」来配对，并且禁止链式
 * 配对（灰姑娘 c511 有 idle_blue 又有 idle_blue_02，_blue_02 不能再当形态2）。
 * 另有一些角色的第二形态只是小改动（潘托姆 c580 仅换眼镜/面具 3 个附件），
 * 同样按成套变体识别，不做换装强度筛选。
 */
export type FormInfo = {
  /** 形态①（基础）的动画名列表 */
  form1: string[]
  /** 形态②（变体）的动画名列表 */
  form2: string[]
  /** 成对项 [基础名, 形态①动画, 形态②动画]，用于切形态时保持同一表情 */
  pairs: [string, string, string][]
  /** 形态①→形态② 的过渡动画（如 expression_0），无则 null */
  toForm2: string | null
  /** 形态②→形态① 的过渡动画（如 expression_0_alt），无则 null */
  toForm1: string | null
  /** 形态②的默认待机：优先 idle_alt（变身动画末帧落点），避免切换后跳帧 */
  form2Idle: string | null
}

const FORM_SUFFIXES = ['_02', '_alt', '_blue', '_2']
const hasFormSuffix = (a: string) => FORM_SUFFIXES.some((s) => a.endsWith(s))
const stripFormSuffix = (a: string): string | null => {
  for (const s of FORM_SUFFIXES) if (a.endsWith(s)) return a.slice(0, -s.length)
  return null
}

/**
 * 已知源数据异常：动画表里有 _02/_alt 变体，但不是真正的第二形态。
 * - c470 小红帽三条：expression_0 是把 images_1/images_2 分层差分图叠上去的
 *   「红眼」效果，没有 idle 变体；切到所谓的形态②后点别的动画又回到形态①。
 * - c402/c403 坎西两条：expression_0 是 action 的逐帧副本（附件 100% 相同），
 *   不是变身动画，形态②只是同一动作的复制。
 * 这些皮肤不显示形态切换按钮。随数据更新可按需增删。
 */
const FORM_FALSE_POSITIVES = /^c(402|403|470)_\d\d$/

/**
 * 第二形态判定：
 * 1) 有双向过渡动画 expression_0 + expression_0_alt → 直接认定（覆盖 c100
 *    拉普拉斯这种只有 idle_alt 一个变体、但有完整变身动画的模型）；
 * 2) 否则要求 ≥3 对变体且含 idle 变体（普通成套表情差分）。
 * name 传入模型名（如 c233_00），用于排除已知的源数据异常。
 */
export function detectFormVariants(anims: string[], name?: string): FormInfo | null {
  if (name && FORM_FALSE_POSITIVES.test(name)) return null
  // 形态切换过渡动画：expression_0 = 形态①→②，expression_0_alt = 形态②→①。
  // 它们不是表情，要从表情列表和变体配对里都排除（否则 expression_0_alt 的
  // 基础名 expression_0 会被当成一对普通变体）。
  const toForm2 = anims.includes('expression_0') ? 'expression_0' : null
  const toForm1 = anims.includes('expression_0_alt') ? 'expression_0_alt' : null
  const exprs = new Set([toForm2, toForm1].filter(Boolean) as string[])
  const set = new Set(anims)
  const pairs: [string, string, string][] = []
  for (const v of anims) {
    if (exprs.has(v) || !hasFormSuffix(v)) continue
    const base = stripFormSuffix(v)
    if (base && !hasFormSuffix(base) && set.has(base) && !exprs.has(base)) {
      pairs.push([base, base, v])
    }
  }
  const hasIdleVar = pairs.some((p) => /^idle/.test(p[0]))
  const twoWay = !!toForm2 && !!toForm1
  // 双向过渡直接认定；否则需成套变体（≥3 对）且含待机变体
  if (!twoWay && (pairs.length < 3 || !hasIdleVar)) return null
  // 带后缀的一律归形态②（含 c511 那种 _blue_02 双层变体），不带后缀的归形态①，
  // 两组互补且不重叠；过渡动画单独抽出，不出现在任一形态的表情列表里。
  return {
    form1: anims.filter((a) => !exprs.has(a) && !hasFormSuffix(a)),
    form2: anims.filter((a) => !exprs.has(a) && hasFormSuffix(a)),
    pairs,
    toForm2,
    toForm1,
    /** 形态②的默认待机：优先 idle_alt（形态切换动画末帧落点，避免跳帧），其次 idle_02 等 */
    form2Idle: anims.find((a) => a === 'idle_alt')
      || anims.find((a) => /^idle_02$|^idle_blue$/.test(a))
      || null,
  }
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
  /**
   * 舞台裁剪：把实时渲染裁进这些槽位包围盒的并集（世界坐标，跟随缩放/平移）。
   * 用于「画作框 + 会飘出框外的动画部件」的 CG（如 BowWowParadise 的警戒带）：
   * 官方观感里所有内容都收在画框内，而骨架包围盒会把框外部分一起算进去。
   * 槽位名可用精确名或 /正则/；用 URL ?debugslots=1 探针找槽位名。
   */
  stageClipSlots?: string[]
  /**
   * 多镜大招每张场景背景的初始世界基准。sceneBgBases[i] 对应第 i+1 张图：
   * side_i = 基准边长 × sideMul，中心 = 校准中心 + (cxOffPct, cyOffPct)%
   * × side_i（世界坐标，y 向上）。用于给不同取景的场景图一个接近正确的
   * 初始摆放，之后用校准模式（URL calib=1）微调。
   */
  sceneBgBases?: Array<{ sideMul?: number; cxOffPct?: number; cyOffPct?: number }>
  /**
   * 多镜切镜点（秒，升序）：槽 1..N 在对应切点后换背景。显式给出时跳过
   * camera 跳变自动检测——三镜大招（c530）的次大跳变会被段内运镜干扰。
   * 数值来自 Spine camera 骨轨迹实测（probe_camera.mjs）。
   */
  sceneCuts?: number[]
  /**
   * 同一段镜头内的贴图状态切换时刻（秒）：sceneBg4 在此时刻起显示，
   * 与 camera 切镜无关（c530 城市段清晰 → 冲刺动感模糊）。
   */
  sceneBlurCut?: number
  /**
   * 自动取景缩放关键帧（秒 → 倍率，线性插值）：抵消骨架动画自带的推近。
   * 与用户手动缩放相乘，双击复位只复位手动档。c530 段3 角色骨骼放大
   * ~1.9×，定格特写占满画面看不清人，配 [{t:2.64,zoom:1},{t:4,zoom:.66}]
   * 让镜头在人物定格前拉远。
   */
  zoomKeys?: Array<{ t: number; zoom: number }>
  /**
   * 场景背景板绑定的骨骼名（默认 camera）。c352_02 的运镜真正落在 `bone`
   * （camera → bone → hl1_body/水花）：镜头推进和俯冲特写都在 bone 上，
   * 绑 camera 只能跟到 1.15× 的慢推，角色俯冲到 3.2× 时背景就错位了。
   */
  sceneBone?: string
  /**
   * 背景板的绑定方式：
   *  - bone（默认）：套用运镜骨相对 t=0 的完整仿射（平移+缩放）。
   *  - body：只取运镜骨的缩放/旋转，并以角色身体中心为轴心缩放——
   *    对应游戏里「镜头跟着角色推近」的观感。骨骼自身的世界原点离角色
   *    很远（c352 的 bone 在 (-2033,-2024)），直接用全仿射会把背景板
   *    甩到屏幕外，只剩一片纯色。
   */
  sceneBgPivot?: 'bone' | 'body'
  /** 「body」模式下真正作为缩放轴心的骨骼名（例如 c352 的 hl1_body）。
      缺省用可见内容的中位中心——那个点会随姿势漂移，导出的校准值对不上 */
  pivotBone?: string
  /**
   * 某张背景的绝对世界矩形关键帧（校准导出的最终值，单位为骨架世界坐标）。
   * 存在时优先于骨骼绑定：按时间线性插值，用于复现骨骼上不存在的独立
   * 镜头推拉（例如 c352 第二镜结尾背景自己放大到 1.19×）。
   */
  sceneBgKeys?: Array<Array<{ t: number; cx: number; cy: number; side: number; rot?: number }>>
  /**
   * 关键帧的插值驱动骨（按骨骼缩放进度插值，而不是按时间线性）。
   * s0/s1 为该骨在首/末关键帧时刻的缩放，用于把当前缩放归一化成 0..1。
   */
  sceneBgKeyDrive?: Array<{ bone: string; s0: number; s1: number } | null>
  /**
   * 某张背景刚性挂在指定骨骼上（按该校准帧反解出的骨骼局部偏移）。
   * 用于角色自身有连续缩放/下沉、但不在 sceneBone 上的镜头：背景跟着
   * 骨骼平滑运动，比稀疏关键帧的线性插值更贴合人物。
   * vx/vy 为骨骼世界位置到背景中心的偏移（世界方向，未乘骨骼缩放），
   * side 为骨骼缩放为 1 时的背景边长。
   */
  sceneBgBoneBinds?: Array<{ bone: string; vx: number; vy: number; side: number } | null>
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

/** 立绘分层资源：部分角色的立绘拆成 BG 场景 + 角色 + FG 前景（如更衣帘），
    三层同步播放切换动画。key 是主模型名，value 是额外层名（放在 /spine_layer/ 下）。
    新增角色只需在这里加一条，SpinePlayer 会自动加载并同步。 */
const LAYERED_MODELS: Record<string, { bg?: string; fg?: string }> = {
  c515_00: { bg: 'c515_00_bg', fg: 'c515_00_fg' }, // 灰姑娘:琉璃波光（更衣帘转场）
}
export function layerConfigFor(name: string): { bg?: string; fg?: string } | undefined {
  return LAYERED_MODELS[name]
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
  /** 卡片封面：该剧情第一张静态 CG 的图片 hash；没有 CG 时为 null */
  cover?: string | null
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

/* 剧情内短信阅读器（build/export_story_sms.mjs）：
   剧情全文里剩下的活动 / 个人 / 支线 / 主线内嵌手机对话。 */

export type StorySmsPart = [number | null, string, string | null]

/** [kind, sender slug, 显示名, 文本]；kind 0 角色 / 1 指挥官 / 2 旁白系统 */
export type StorySmsLine = [number, string | null, string | null, string]

export type StorySmsGroup = {
  g: string
  /** 目标剧情单元 id */
  unit: number
  /** 插在哪个剧情段落里 */
  anchor: string
  /** 插在该段第 at 行之前（等于该段行数时插在段末） */
  at: number
  cat: string
  label: string
  n: number
  t: string
  p: string
  parts: Record<string, StorySmsPart>
  l: StorySmsLine[]
}

export type StorySmsData = {
  total: number
  cats: { k: string; n: string; c: number }[]
  items: StorySmsGroup[]
}

let cacheStorySms: StorySmsData | null = null

export async function loadStorySms(): Promise<StorySmsData> {
  if (cacheStorySms) return cacheStorySms
  try {
    cacheStorySms = await getJSON<StorySmsData>('/data/story_sms.json')
  } catch {
    cacheStorySms = { total: 0, cats: [], items: [] }
  }
  return cacheStorySms
}

let cacheUnits: StoryUnit[] | null = null

export async function loadStoryIndex(): Promise<StoryUnit[]> {
  if (cacheUnits) return cacheUnits
  const d = await getJSON<{ items: StoryUnit[] }>('/data/story_index.json')
  cacheUnits = d.items
  return cacheUnits
}

const unitCache = new Map<string, StoryDetail>()

export async function loadStoryUnit(id: string | number): Promise<StoryDetail> {
  const key = String(id)
  const hit = unitCache.get(key)
  if (hit) return hit
  const d = await getJSON<StoryDetail>(`/data/story/${key}.json`)
  unitCache.set(key, d)
  return d
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
  /** 合并收录表（cg_merges.json，由 build/gen_cg_merges.mjs 生成）：
      主 CG 名 → 随它收录的重复条目（图集贴图页 / 动态背景帧），不再单独展示 */
  merges?: Record<string, string[]>
}

let cacheCg: CgIndex | null = null

async function loadCgMerges(): Promise<Record<string, string[]>> {
  try {
    return await getJSON<Record<string, string[]>>('/data/cg_merges.json')
  } catch {
    return {}
  }
}

export async function loadCgIndex(): Promise<CgIndex> {
  if (cacheCg) return cacheCg
  const [idx, merges] = await Promise.all([
    getJSON<CgIndex>('/data/cg_index.json'),
    loadCgMerges(),
  ])
  cacheCg = { ...idx, merges }
  return cacheCg
}

/**
 * 合并收录：同一张作品被拆成多条 CG 的情况，浏览序列（图鉴/目录/搜索/
 * 上一张下一张）只保留主条目；直接 URL / 分享链接仍可访问被并的条目。
 * 两类来源：
 *  - 命名规则：X 与 X_bg 拆成「人物层 + 背景板」（ACPUFreeze_01/_bg 这类），
 *    存在同名主 CG 时合并；孤儿 _bg（Main_01_bg）保持独立。剧情阅读器的
 *    同款配对约定见 resolveCg()。
 *  - cg_merges.json：主CG图集里的贴图页（BowWowParadise_01_2 这类）与
 *    目检确认的动态背景帧（Chap_04_02/03），由生成脚本维护。
 */
export function visibleCgs(
  items: CgItem[],
  merges: Record<string, string[]> = {},
): CgItem[] {
  const names = new Set(items.map((x) => x.n))
  const hidden = new Set<string>()
  for (const it of items) {
    if (it.n.endsWith('_bg') && names.has(it.n.slice(0, -3))) hidden.add(it.n)
  }
  for (const list of Object.values(merges)) {
    if (!Array.isArray(list)) continue // 跳过 _note 之类的说明字段
    for (const n of list) hidden.add(n)
  }
  return items.filter((it) => !hidden.has(it.n))
}

/** 主 CG 名 → 它合并的独立背景板条目（无则 null） */
export function mergedBgOf(items: CgItem[], name: string): CgItem | null {
  return items.find((x) => x.n === `${name}_bg`) || null
}

/** 主 CG 名 → 本集成员（合并收录的重复条目 / 连续画面帧；非封面返回空数组） */
export function setMembersOf(
  merges: Record<string, string[]> | undefined,
  name: string,
): string[] {
  const list = merges?.[name]
  return Array.isArray(list) ? list : []
}

/** 条目 → 它被并入的封面名（本身是封面或独立条目时返回 null） */
export function coverOf(
  merges: Record<string, string[]> | undefined,
  name: string,
): string | null {
  for (const [cover, list] of Object.entries(merges || {})) {
    if (Array.isArray(list) && list.includes(name)) return cover
  }
  return null
}

/**
 * 封面集（自身 + 全部成员）的剧情段落并集，按 unit:line 去重。
 * 静态连图集的封面常常不是剧情里出现的那一帧（l 可能为 0），
 * 信息面板与「有剧情」筛选都应以整集为准。
 */
export function setLinks(index: CgIndex, name: string): CgLink[] {
  const seen = new Set<string>()
  const out: CgLink[] = []
  for (const n of [name, ...setMembersOf(index.merges, name)]) {
    for (const lk of index.links[n] || []) {
      const k = `${lk.u}:${lk.i}`
      if (seen.has(k)) continue
      seen.add(k)
      out.push(lk)
    }
  }
  return out
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
