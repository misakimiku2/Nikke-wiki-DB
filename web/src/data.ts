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
}

let cacheSkillcut: SkillcutIndex | null = null

export async function loadCharSkillcut(): Promise<SkillcutIndex> {
  if (cacheSkillcut) return cacheSkillcut
  try {
    const d = await getJSON<{ bySkin?: Record<string, string>; byChar?: Record<string, string>; bgs?: string[]; bg2s?: string[] }>(
      '/data/char_spine_skillcut.json')
    cacheSkillcut = {
      bySkin: d.bySkin || {},
      byChar: d.byChar || {},
      bg: new Set(d.bgs || []),
      bg2: new Set(d.bg2s || []),
    }
  } catch {
    cacheSkillcut = { bySkin: {}, byChar: {}, bg: new Set(), bg2: new Set() }
  }
  return cacheSkillcut
}

/** 皮肤 c010_00 → 大招模型；先查皮肤级，再查角色级（c093_skillcut 这类无皮肤段） */
export function skillcutModelName(current: string, idx: SkillcutIndex): string | null {
  return idx.bySkin[current] || idx.byChar[current.match(/^(c\d+)_/)?.[1] || ''] || null
}

/**
 * 大招 cut-in 的主动画挑选。源数据命名五花八门（全量 233 个里 30 个不带
 * skillcut_1）：skillcut_0 / skillcut_01 / skilcut_1（拼写错误）/ skillcut1 /
 * skillcut / skill_cut / skill_01 / c094 的 _OFF 三段式 / c532 的 _all 分层。
 * 精确名优先，其余在含 skil 的动画里取编号最小的（分段式取第 1 段）。
 */
export function pickBurstAnim(names: string[]): string | undefined {
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
   * 多镜大招每张场景背景的初始世界基准。sceneBgBases[i] 对应第 i+1 张图：
   * side_i = 基准边长 × sideMul，中心 = 校准中心 + (cxOffPct, cyOffPct)%
   * × side_i（世界坐标，y 向上）。用于给不同取景的场景图一个接近正确的
   * 初始摆放，之后用校准模式（URL calib=1）微调。
   */
  sceneBgBases?: Array<{ sideMul?: number; cxOffPct?: number; cyOffPct?: number }>
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
