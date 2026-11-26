/** FADING AFFECTION 活动小游戏的分支数据（由 nikke_extract/scripts/export_fadingaffection.py 导出） */

import type { ContentLang } from './lang'

export type FadingLocale = 'zh-CN' | 'en' | 'ko' | 'ja'
export type FadingLocales = Record<FadingLocale, Record<string, string>>

export type UnlockReq = {
  /** memory = 需要指定记忆；ending = 需要看过指定结局；state = 状态门槛（粮食） */
  kind: 'memory' | 'ending' | 'state'
  /** 记忆 id（LootItemTable 记录 id）/ 结局页号 / 门槛值 */
  id: number
  page: number | null
  /** 路线-序号，仅用于展示（记忆 id 与页号不同源，判定一律用 id） */
  memory?: string
  memoryKind?: 'save' | 'deleted' | 'fragment'
  name: string
  nameKey?: string | null
}

export type FadingRoute = {
  no: number
  unlockRequirement: UnlockReq | null
  name: string
  nameKey: string
  desc: string
  descKey?: string | null
  startKey: string
  start: number
  intro: string
  introKey?: string | null
  introText: string
  unlock: string | null
  /** 该路线是否启用侵蚀度：原作只为路线 2 写了侵蚀数值 */
  erosion: boolean
}

export type FadingPage = {
  id: number
  key: string
  text: string
  /** 页面表 st+9 字段的路线归属（1/2/3）；结局页同样带，比 id 前缀可靠 */
  route?: number | null
  cg: string | null
  bgm: string | null
  /** 抵达本页授予的记忆 id（0/缺省 = 不授予） */
  grant?: number | null
  next: number | null
  links: number[]
  ending?: { title: string; hint: string; titleKey?: string | null; hintKey?: string | null }
}

export type FadingStatus = { hp: number; food: number; erosion: number }
export type FadingStatusChange = { hp: number; food: number; erosion: number }
export type FadingStatusFeedback = { id: number; hp: number; food: number }

export function applyFadingStatusChange(
  status: FadingStatus,
  change: FadingStatusChange,
  max: FadingStatus,
): FadingStatus {
  return {
    hp: Math.max(0, Math.min(max.hp, status.hp + change.hp)),
    food: Math.max(0, Math.min(max.food, status.food + change.food)),
    erosion: Math.max(0, Math.min(max.erosion, status.erosion + change.erosion)),
  }
}

/** Manager 表 83501 里的一条状态定义：数值原样带出，不在前端猜增减 */
export type FadingStatusItem = {
  key: 'hp' | 'food' | 'erosion'
  /** Locale_Event 里的官方名称（体力 / 粮食 / 侵蚀度） */
  name: string
  nameKey: string
  icon: string | null
  /** 上限：体力 10、粮食 1、侵蚀度 100 */
  max: number
  /** 第二个数值：体力/粮食与 max 相同，侵蚀度为 50（教程「达到一定程度」） */
  second: number
}

export type FadingChoice = {
  id: number
  page: number
  key: string
  text: string
  hintKey: string | null
  hint: string
  /** 解锁条件：与 hint 无关，172 条选项里 38 条带条件、只有 25 条带 hint */
  req: UnlockReq | null
  sfx: string | null
  dest: number | null
  candidates: number[]
  statusChange: FadingStatusChange
}

export type FadingFirst = {
  page: number
  key: string
  text: string
  dest: number | null
  candidates: number[]
  unlock: UnlockReq | null
}

export type FadingMemory = {
  id: number
  /** saveitem / deleteditem / fragmenteditem 三类 */
  kind: 'save' | 'deleted' | 'fragment'
  route: number
  index: number
  name: string
  nameKey?: string | null
  desc: string
  descKey?: string | null
  short: string
  shortKey?: string | null
  grantPage: number | null
  grantPages: number[]
}

export type FadingData = {
  version: string
  event: string
  title: string
  subtitle: string
  locales: FadingLocales
  status: { items: FadingStatusItem[]; init: FadingStatus; max: FadingStatus }
  backgrounds: Record<string, string>
  memories: FadingMemory[]
  memoryByPage: Record<string, FadingMemory>
  routes: FadingRoute[]
  pages: Record<string, FadingPage>
  choices: Record<string, FadingChoice>
  firstChoices: FadingFirst[]
  cgHashes: Record<string, string>
}

export function fadingText(data: FadingData, key: string | null | undefined, lang: ContentLang, fallback = ''): string {
  if (!key) return fallback
  const plain = key.includes(':') ? key.slice(key.indexOf(':') + 1) : key
  const locale: FadingLocale = lang === 'zh' ? 'zh-CN' : lang
  return data.locales[locale]?.[plain] || data.locales['zh-CN']?.[plain] || fallback
}

export function localizeFadingData(data: FadingData, lang: ContentLang): FadingData {
  const tr = (key: string | null | undefined, fallback: string) => fadingText(data, key, lang, fallback)
  const req = (value: UnlockReq | null): UnlockReq | null => value
    ? { ...value, name: tr(value.nameKey, value.name) }
    : null
  const routes = data.routes.map((r) => ({
    ...r,
    name: tr(r.nameKey, r.name),
    desc: tr(r.descKey, r.desc),
    intro: tr(r.introKey, r.intro),
    introText: tr(r.startKey, r.introText),
    unlockRequirement: req(r.unlockRequirement),
  }))
  const pages = Object.fromEntries(Object.entries(data.pages).map(([id, p]) => [id, {
    ...p,
    text: tr(p.key, p.text),
    ending: p.ending ? {
      ...p.ending,
      title: tr(p.ending.titleKey, p.ending.title),
      hint: tr(p.ending.hintKey, p.ending.hint),
    } : undefined,
  }]))
  const choices = Object.fromEntries(Object.entries(data.choices).map(([id, c]) => [id, {
    ...c,
    text: tr(c.key, c.text),
    hint: tr(c.hintKey, c.hint),
    req: req(c.req),
  }]))
  const firstChoices = data.firstChoices.map((c) => ({
    ...c,
    text: tr(c.key, c.text),
    unlock: req(c.unlock),
  }))
  const memories = data.memories.map((m) => ({
    ...m,
    name: tr(m.nameKey, m.name),
    desc: tr(m.descKey, m.desc),
    short: tr(m.shortKey, m.short),
  }))
  const memoryById = new Map(memories.map((m) => [m.id, m]))
  const memoryByPage = Object.fromEntries(Object.entries(data.memoryByPage).map(([id, m]) => [
    id, memoryById.get(m.id) ?? m,
  ]))
  return {
    ...data,
    routes,
    pages,
    choices,
    firstChoices,
    memories,
    memoryByPage,
    status: {
      ...data.status,
      items: data.status.items.map((item) => ({ ...item, name: tr(item.nameKey, item.name) })),
    },
  }
}

/** Manager 表里的状态定义（官方名称 / 上限 / 第二数值） */
export function statusItem(data: FadingData, key: FadingStatusItem['key']): FadingStatusItem | undefined {
  return data.status.items.find((s) => s.key === key)
}

/** 抵达该页所授予的记忆（授予关系取自页面表字段，记忆 id 与页号不同源） */export function memoryGrantedHere(data: FadingData, pageId: number | null): FadingMemory | null {
  if (pageId == null) return null
  return data.memoryByPage[String(pageId)] ?? null
}

/** 已解锁的记忆 id：访问过的授予页反查（授予页既可能是普通页，也可能是结局页） */
export function unlockedMemoryIds(data: FadingData, visited: Iterable<number>): Set<number> {
  const s = new Set<number>()
  for (const pid of visited) {
    const m = data.memoryByPage[String(pid)]
    if (m) s.add(m.id)
  }
  return s
}

let cache: FadingData | null = null
export async function loadFadingData(): Promise<FadingData> {
  if (cache) return cache
  const r = await fetch('/data/fadingaffection.json', { cache: 'no-cache' })
  if (!r.ok) throw new Error(`fadingaffection.json ${r.status}`)
  const loaded: FadingData = await r.json()
  cache = loaded
  return loaded
}

export function fadingCgSrc(data: FadingData, name: string | null | undefined): string | null {
  if (!name) return null
  const h = data.cgHashes[name]
  return h ? `/img/l/${h}.webp` : null
}

/** 该页可点的选项：首选项（路线开场）优先，其次是普通选项 */
export function choicesFor(data: FadingData, pageId: number): FadingChoice[] {
  return Object.values(data.choices)
    .filter((c) => c.page === pageId)
    .sort((a, b) => a.id - b.id)
}

export function firstFor(data: FadingData, pageId: number): FadingFirst[] {
  return data.firstChoices.filter((c) => c.page === pageId)
}

/** 所有结局页（按 id 排序） */
export function endingsOf(data: FadingData): FadingPage[] {
  return Object.values(data.pages)
    .filter((p) => p.ending)
    .sort((a, b) => a.id - b.id)
}

/** 地点推导（与 locationBgSrc 同一套页面号规则）：x001 是开场平原，
 *  下一位 1=旧市区、2=湖、3=新市区。环境音床按这个选。 */
export function locationOf(pageId: number | null): 'plain' | 'old' | 'lake' | 'city' | null {
  if (pageId == null) return null
  if (pageId % 1000 === 1) return 'plain'
  const d = Math.floor(pageId / 100) % 10
  return d === 1 ? 'old' : d === 2 ? 'lake' : d === 3 ? 'city' : 'plain'
}

/**
 * 场景背景：小游戏无专用背景表，原版在无 CG 的页面沿用场景板并模糊压暗。
 * 这里按页面 id 推导地点（xx = 路线1/2/3，下一位 1=旧市区、2=湖、3=新市区）：
 *   1001/2001/3001 开场 → 废墟平原；11xx/21xx/31xx → 旧市区；12xx/22xx → 湖。
 */
export function locationBgSrc(data: FadingData, pageId: number | null): string | null {
  if (pageId == null) return null
  const key =
    pageId === 1001 || pageId === 2001 || pageId === 3001 ? 'DestroyedStreet'
      : (pageId >= 1100 && pageId < 1200) || (pageId >= 2100 && pageId < 2200) ? 'DestroyedStreet'
        : (pageId >= 1200 && pageId < 1300) || (pageId >= 2200 && pageId < 2300) ? 'Lake'
          : (pageId >= 2300 && pageId < 2400) ? 'City_d'
            : pageId >= 3000 ? 'DestroyedStreet'
              : 'DestroyedStreet'
  const h = data.backgrounds[key]
  return h ? `/img/l/${h}.webp` : null
}
