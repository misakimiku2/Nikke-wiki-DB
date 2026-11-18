#!/usr/bin/env node
/**
 * 生成 build/cg_merges.json：把「随主 CG 模型一起收录」的重复条目并回主 CG。
 *
 * 输出到 build/（人工可维护的配置，随仓库入库），由 web/vite.config.ts 的
 * spineOverridesPlugin 同步到 public/data/cg_merges.json 供前端读取。
 * public/ 整个被 .gitignore，所以源文件不能放那里。
 *
 * 自动规则：public/spine/ 下模型图集（.atlas）引用的贴图页名恰好命中某条 CG ——
 * 那张 CG 就是模型的贴图页（如 EventScene_BowWowParadise_01_2），实时模型已经在
 * 渲染它，不再作为独立作品展示。只扫 CG 模型目录，角色站姿等其它 spine 目录不参与。
 *
 * 人工规则（MANUAL）：目检确认、但图集里没有的条目。重跑会与文件里已有的
 * 非自动条目合并保留，不会丢手工维护的部分。
 *
 * 重跑：node build/gen_cg_merges.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

const index = JSON.parse(read('public/data/cg_index.json'))
const cgNames = new Set(index.items.map((x) => x.n))

const spineDir = path.join(root, 'public', 'spine')
const auto = {}
for (const dir of fs.readdirSync(spineDir)) {
  const atlasPath = path.join(spineDir, dir, `${dir}.atlas`)
  if (!fs.existsSync(atlasPath)) continue
  const pages = [...read(path.relative(root, atlasPath)).matchAll(/^(\S+)\.(?:webp|png)$/gm)]
    .map((m) => m[1])
    .filter((n) => n !== dir && cgNames.has(n))
  if (pages.length) auto[dir] = [...new Set(pages)].sort()
}

// 目检确认：Chap_04_01 是人物层（图集只有一页、无背景），02/03 是同一动态
// 背景的两个时刻帧（直升机移动/烟雾变浓），游戏里垫在人物层下轮播。
const MANUAL = {
  EventScene_Chap_04_01: ['EventScene_Chap_04_02', 'EventScene_Chap_04_03'],
}

// 已有文件里的人工条目：保留那些自动扫描不会产出的键值（重跑不丢手工维护）
const outPath = path.join(root, 'build', 'cg_merges.json')
let prev = {}
try {
  prev = JSON.parse(read('build/cg_merges.json'))
} catch {
  /* 第一次生成 */
}
const kept = {}
for (const [k, v] of Object.entries(prev)) {
  if (k.startsWith('_') || auto[k]) continue
  kept[k] = v
}

const merges = { ...kept, ...auto, ...MANUAL }
const sorted = Object.fromEntries(Object.keys(merges).sort().map((k) => [k, merges[k]]))
const note = '主 CG（封面）→ 随它收录的条目（图集贴图页 / 动态背景帧 / 连图集的其它帧）。这些条目不再作为独立作品出现在图鉴、目录、搜索与上一张/下一张里，直接 URL 仍可访问；剧情阅读器按原始条目名取图，不受影响。由 build/gen_cg_merges.mjs 生成并合并保留人工条目（人工分类表直接写进本文件即可，重跑不会丢）。'
fs.writeFileSync(outPath, JSON.stringify({ _note: note, ...sorted }, null, 2) + '\n')
const total = Object.values(sorted).reduce((a, b) => a + b.length, 0)
console.log(`build/cg_merges.json：${Object.keys(sorted).length} 个主 CG，吸收 ${total} 条重复收录`)
