/** FADING AFFECTION 活动小游戏的分支数据（由 nikke_extract/scripts/export_fadingaffection.py 导出） */

export type UnlockReq = {
  kind: 'memory' | 'ending'
  page: number
  memory?: string
  name: string
}

export type FadingRoute = {
  no: number
  unlockRequirement: UnlockReq | null
  name: string
  nameKey: string
  desc: string
  startKey: string
  start: number
  intro: string
  introText: string
  unlock: string | null
}

export type FadingPage = {
  id: number
  key: string
  text: string
  cg: string | null
  bgm: string | null
  next: number | null
  links: number[]
  ending?: { title: string; hint: string }
}

export type FadingStatus = { hp: number; food: number; erosion: number }
export type FadingCost = Partial<FadingStatus>

export type FadingChoice = {
  id: number
  page: number
  key: string
  text: string
  hintKey: string | null
  hint: string
  hintReq: UnlockReq | null
  sfx: string | null
  dest: number | null
  candidates: number[]
  cost: FadingCost
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
  route: number
  index: number
  name: string
  desc: string
  short: string
}

export type FadingData = {
  version: string
  event: string
  title: string
  subtitle: string
  status: { init: FadingStatus; max: FadingStatus }
  backgrounds: Record<string, string>
  memories: FadingMemory[]
  memoryByPage: Record<string, FadingMemory>
  routes: FadingRoute[]
  pages: Record<string, FadingPage>
  choices: Record<string, FadingChoice>
  firstChoices: FadingFirst[]
  cgHashes: Record<string, string>
}

/** 结局页 -> 对应记忆（61xx -> 路线1 第 xx 条，62xx -> 路线2 第 xx 条） */
export function memoryOfEnding(data: FadingData, endingId: number): FadingMemory | null {
  const route = Math.floor(endingId / 100) - 60   // 61xx -> 1, 62xx -> 2
  const idx = endingId % 100
  if (route < 1 || route > 2) return null
  return data.memories.find((m) => m.route === route && m.index === idx) ?? null
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
