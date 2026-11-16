#!/usr/bin/env node
/**
 * 剧情内短信（内嵌阅读器）数据
 *
 * 把上游「短信与日常对话_全量.json」里的 Messenger 段映射回它们所属的
 * 剧情单元 / 段落，生成 public/data/story_sms.json。前端在剧情阅读器里
 * 把这些段渲染成巴拉短信气泡，而不是单独列一个没有上下文的短信目录。
 *
 * 输出：
 *   {
 *     total: 段数,
 *     cats: [{ k, n, c }],
 *     items: [{
 *       g, unit, anchor, at,
 *       cat, label, n, t, p,
 *       parts: { slug: [角色 id | null, 显示名, 头像 URL | null] },
 *       l: [[kind, slug | null, 显示名 | null, 文本], ...]
 *     }]
 *   }
 *   kind 0 = 角色，1 = 指挥官，2 = 旁白 / 系统
 *   unit = 目标剧情单元 id，anchor = 目标段落，at = 插在该段第 at 行之前
 *
 * 用法：
 *   node build/export_story_sms.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = process.env.NIKKE_SRC || 'E:/test/nikke_extract'
const STATIC = path.join(SRC, 'staticdata')
const DEC = path.join(SRC, 'decrypted')
const DATA = path.join(ROOT, 'public', 'data')
const OUT = path.join(DATA, 'story_sms.json')
const SOURCE = path.join(SRC, '其他剧情', '短信与日常对话', '短信与日常对话_全量.json')

const clean = (s) => (s || '').replace(/\{AccountData\.NickName\}/g, '指挥官')

function loadJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return fallback
  }
}

/** 群组前缀 → 阅读器分类 */
function categoryOf(g) {
  if (g.startsWith('m_subquest')) return ['sub', '支线']
  if (/^m_s\d/.test(g)) return ['sub', '支线']
  if (g.startsWith('m_treasure')) return ['treasure', '宝物']
  if (g.startsWith('m_nikke') || g.startsWith('m_d_nikke')) return ['nikke', '个人']
  if (g.startsWith('m_event') || g.startsWith('event_')) return ['event', '活动']
  if (g.startsWith('m_main') || g.startsWith('d_main')) return ['main', '主线']
  return ['other', '其他']
}

/** 短信 group → 可能的剧情段落 key（从最具体到最宽松） */
function candidatesOf(g) {
  const out = []
  if (g.startsWith('m_main_')) out.push('d_main_' + g.slice(7))
  if (g.startsWith('d_main_')) out.push(g)
  if (g.startsWith('m_event_')) out.push('event_' + g.slice(8))
  if (g.startsWith('event_')) out.push(g)
  if (g.startsWith('m_d_nikke_')) out.push('d_nikke_' + g.slice(10))
  if (g.startsWith('m_nikke_')) out.push('d_nikke_' + g.slice(8))
  if (g.startsWith('m_subquest_')) {
    const k = 'd_subquest_' + g.slice(11)
    out.push(k, k.replace(/_[se]$/, ''))
  }
  if (g.startsWith('m_treasurestory_')) out.push('treasurestory_' + g.slice(16))
  if (g.startsWith('m_s0')) out.push(g.slice(2))
  // 数字补零变体：d_main_26_1 ↔ d_main_26_01
  const extra = []
  for (const c of out) {
    const m = c.match(/^(.*_)(\d+)(_[se])?$/)
    if (m) {
      const padded = `${m[1]}${m[2].padStart(2, '0')}${m[3] || ''}`
      if (padded !== c) extra.push(padded)
    }
  }
  return [...out, ...extra]
}

/** 二进制表记录读取 */
function makeReader(buf, start) {
  let p = start
  const str = () => {
    const tag = buf.readInt32LE(p); p += 4
    if (tag >= 0) throw new Error('expected string')
    const len = buf.readInt32LE(p); p += 4
    if (len < 0 || len > 4096) throw new Error('bad length')
    const s = buf.toString('utf8', p, p + len); p += len
    return s
  }
  const int = () => { const v = buf.readInt32LE(p); p += 4; return v }
  const u8 = () => { const v = buf.readUInt8(p); p += 1; return v }
  const maybeStr = () => (buf.readInt32LE(p) < 0 ? str() : int())
  return { str, int, u8, maybeStr }
}

/** MessengerDialogTable 每条消息的真实发送人（type 2 = 角色，1 = 玩家，3 = 系统） */
function loadMessengerRows() {
  const buf = fs.readFileSync(path.join(STATIC, 'MessengerDialogTable.mpk'))
  const text = buf.toString('latin1')
  const toks = []
  const re = /[ -~]{4,}/g
  let m
  while ((m = re.exec(text))) toks.push({ t: m[0], s: m.index, e: m.index + m[0].length })
  const map = new Map()
  for (let k = 0; k < toks.length; k++) {
    if (!/^Locale_[A-Za-z]+:/.test(toks[k].t)) continue
    let idIdx = -1
    for (let j = k - 1; j >= Math.max(0, k - 8); j--) {
      if (!/^m_[A-Za-z0-9_]+_\d+$/.test(toks[j].t)) continue
      if (toks[j + 1]?.t === toks[j].t.replace(/_\d+$/, '')) { idIdx = j; break }
    }
    if (idIdx < 0) continue
    try {
      const r = makeReader(buf, toks[idIdx].s - 9)
      r.u8()
      const id = r.str()
      r.str()                 // room
      r.str()                 // group
      const type = r.int()
      const fifth = type === 2 ? r.str() : r.maybeStr()
      r.int(); r.maybeStr()
      const loc = r.str()
      if (loc !== toks[k].t || id !== toks[idIdx].t) continue
      const key = loc.slice(loc.indexOf(':') + 1)
      map.set(key, { type, sender: type === 2 ? fifth : null })
    } catch { /* 忽略贴图/表情等特殊记录 */ }
  }
  return map
}

function loadMemberTable() {
  const buf = fs.readFileSync(path.join(STATIC, 'MessengerMemberTable.mpk'))
  const total = buf.readUInt32LE(0)
  const r = makeReader(buf, 4)
  const map = new Map()
  for (let i = 0; i < total; i++) {
    r.u8()
    const slug = r.str()
    const type = r.int()
    const nameKey = r.str()
    r.str(); r.str(); r.str()
    map.set(slug, { type, nameKey })
  }
  return map
}

function findLocaleDb(tableName) {
  for (const f of fs.readdirSync(DEC)) {
    if (!f.endsWith('.dec')) continue
    try {
      const db = new DatabaseSync(path.join(DEC, f), { readOnly: true })
      if (db.prepare("select name from sqlite_master where type='table' and name=?").all(tableName).length) {
        return db
      }
      db.close()
    } catch { /* not sqlite */ }
  }
  return null
}

/**
 * 从游戏场景脚本里读短信的真实触发位置。
 *
 * ScenarioDialogTable.<段>.mpk / EventScenarioDialogTable.<段>.mpk /
 * AttractiveScenarioDialogTable.<段>.mpk 里会直接出现 Messenger 房间 key，
 * 夹在该段相邻两句的 Locale_* 引用之间。比起按 key 前缀猜段落，这里能
 * 拿到精确的段落和行号。
 *
 * 返回 Map<房间 key, { unit, seg, at }>，at = 插在该段第 at 行之前。
 */
function loadScenarioAnchors(segByKey, groupSet) {
  const out = new Map()
  const files = fs.readdirSync(STATIC).filter((f) => /^(Event|Attractive)?ScenarioDialogTable\..+\.mpk$/.test(f))
  const tokenRe = /[ -~]{4,}/g
  const locRe = /^Locale_[A-Za-z]+:(.+)_(\d+)$/
  for (const f of files) {
    const seg = f.replace(/^(Event|Attractive)?ScenarioDialogTable\./, '').replace(/\.mpk$/, '')
    const target = segByKey.get(seg)
    if (!target) continue
    const text = fs.readFileSync(path.join(STATIC, f)).toString('latin1')
    const toks = []
    let m
    while ((m = tokenRe.exec(text))) toks.push(m[0])
    const locs = []
    for (let i = 0; i < toks.length; i++) {
      const mm = toks[i].match(locRe)
      if (mm && mm[1] === seg) locs.push({ i, n: Number(mm[2]) })
    }
    if (!locs.length) continue
    for (let i = 0; i < toks.length; i++) {
      const g = toks[i]
      if (g === seg || !groupSet.has(g)) continue
      if (out.has(g)) continue
      const next = locs.find((x) => x.i > i)
      const prev = [...locs].reverse().find((x) => x.i < i)
      const at = next ? Math.max(0, next.n - 1) : prev ? prev.n : 0
      out.set(g, { unit: target.id, seg, at: Math.min(at, target.len) })
    }
  }
  return out
}

function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`! 找不到 ${SOURCE}`)
    process.exit(1)
  }
  const full = loadJson(SOURCE, [])
  const bucket = full.find((x) => x.bucket === 'MessengerDialogTable')
  if (!bucket) {
    console.error('! 短信与日常对话_全量.json 里没有 MessengerDialogTable')
    process.exit(1)
  }

  const rowByKey = loadMessengerRows()
  const memberBySlug = loadMemberTable()
  const localeDb = findLocaleDb('Locale_Character')
  const charName = (key) => {
    if (!localeDb || !key) return null
    const i = key.indexOf(':')
    if (i < 0) return null
    const table = key.slice(0, i)
    const k = key.slice(i + 1)
    try {
      return localeDb.prepare(`select "zh-CN" as z from "${table}" where Key=?`).get(k)?.z || null
    } catch {
      return null
    }
  }

  const index = loadJson(path.join(DATA, 'story_index.json'), { items: [] })
  const segs = []
  const segByKey = new Map()
  for (const u of index.items || []) {
    if (u.bucket === 'MessengerDialogTable' || u.cat === 'daily' || u.cat === 'extra') continue
    const d = loadJson(path.join(DATA, 'story', `${u.id}.json`), { segments: [] })
    for (const s of d.segments || []) {
      const target = { id: u.id, bucket: u.bucket, g: s.g, len: (s.l || []).length }
      segs.push(target)
      if (!segByKey.has(s.g)) segByKey.set(s.g, target)
    }
  }

  // 场景脚本里的真实触发位置优先，找不到才退回 key 前缀匹配
  const groupSet = new Set(bucket.groups.map((x) => x.group))
  const scenarioAnchors = loadScenarioAnchors(segByKey, groupSet)

  const chars = loadJson(path.join(DATA, 'characters.json'), { items: [] }).items || []
  const imgs = loadJson(path.join(DATA, 'char_images.json'), {})
  const mi = new Set(loadJson(path.join(DATA, 'char_mi.json'), { items: [] }).items || [])
  const bySpeaker = new Map()
  for (const c of chars) if (c.speaker) bySpeaker.set(c.speaker, c)

  const resolvePart = (slug, name) => {
    let c = slug ? bySpeaker.get(slug) : null
    if (!c && slug) c = bySpeaker.get(slug.replace(/_[a-z]$/, ''))
    if (!c && name) c = chars.find((x) => x.name === name)
    if (!c) return [null, name || slug || '未知', null]
    const list = imgs[String(c.id)] || []
    const base = list.find((v) => v.endsWith('_00')) || list[0]
    const avatar = base && mi.has(base) ? `/charmi/${base}.webp` : null
    return [c.id, name || c.name, avatar]
  }

  /** 消息发送人 slug 优先走 MessengerMemberTable（NPC 聊天账号也有名字） */
  const resolveSender = (slug, fallbackName) => {
    const mem = slug ? memberBySlug.get(slug) : null
    if (!mem) return resolvePart(slug, fallbackName)
    const name = charName(mem.nameKey) || fallbackName || slug || '未知'
    const num = (mem.nameKey.split(':')[1] || '').match(/^(\d+)_name$/)
    let c = num ? chars.find((x) => x.id === Number(num[1])) : null
    if (!c) c = chars.find((x) => x.name === name) || (fallbackName ? chars.find((x) => x.name === fallbackName) : null)
    if (!c) return [null, name, null]
    const list = imgs[String(c.id)] || []
    const base = list.find((v) => v.endsWith('_00')) || list[0]
    const avatar = base && mi.has(base) ? `/charmi/${base}.webp` : null
    return [c.id, name, avatar]
  }

  /** 找到短信段对应的剧情段；没有对应的（独立巴拉房间）跳过 */
  function anchorOf(g) {
    const cs = candidatesOf(g)
    let best = null
    for (const c of cs) {
      for (const s of segs) {
        if (s.g === c) {
          if (!best || s.g.length > best.g.length) best = s
        } else if (c.startsWith(s.g + '_')) {
          if (!best || s.g.length > best.g.length) best = s
        } else if (s.g.startsWith(c + '_')) {
          if (!best || s.g.length > best.g.length) best = s
        }
      }
    }
    if (!best) {
      // 数字断档兜底：d_main_02af_06 在正文里只到 04、下一段是 07
      const m = g.replace(/^m_main_/, '').replace(/^d_main_/, '').match(/^(.*?)(\d+)(_[se])?$/)
      if (m) {
        const prefix = 'd_main_' + m[1]
        const target = Number(m[2])
        let near = null
        for (const s of segs) {
          if (!s.g.startsWith(prefix)) continue
          const n = Number((s.g.slice(prefix.length).match(/^(\d+)/) || [])[1])
          if (!Number.isFinite(n) || n > target) continue
          if (!near || n > Number((near.g.slice(prefix.length).match(/^(\d+)/) || [])[1])) near = s
        }
        if (near) best = near
      }
    }
    if (!best) return null
    const before = /_[se]$/.test(g) && !/_[se]$/.test(best.g) && g.endsWith('_s')
    return { unit: best.id, anchor: best.g, before }
  }

  const items = []
  const skipped = []
  for (const raw of bucket.groups) {
    const g = raw.group
    let unit
    let anchorG
    let at
    const exact = scenarioAnchors.get(g)
    if (exact) {
      unit = exact.unit
      anchorG = exact.seg
      at = exact.at
    } else {
      const anchor = anchorOf(g)
      if (!anchor) { skipped.push(g); continue }
      unit = anchor.unit
      anchorG = anchor.anchor
      at = anchor.before ? 0 : (segByKey.get(anchor.anchor)?.len ?? 0)
    }
    const lines = raw.lines || []
    const speakers = new Set(lines.map((l) => l.speaker).filter(Boolean))
    const portraits = new Set(lines.map((l) => l.portrait).filter(Boolean))
    const hasMeta = speakers.size > 0 || portraits.size > 0
    const isMEx = g.startsWith('m_ex_')
    const directMEx = isMEx && portraits.size <= 1 && speakers.size > 0
    const groupMEx = isMEx && portraits.size > 1

    const outLines = []
    const parts = {}
    const names = []
    for (const l of lines) {
      const text = clean(l['zh-CN'])
      if (!text) continue
      const row = rowByKey.get(l.key)
      let kind = null
      let slug = null
      let name = null

      // MessengerDialogTable 的 type/sender 是判断左右气泡最可靠的信息；
      // 旧 JSON 里很多剧情内短信没有 speaker/portrait，靠这里补齐。
      if (row) {
        if (row.type === 2 && row.sender) {
          kind = 0
          slug = row.sender
          name = l.speaker || l.portrait || null
        } else if (row.type === 1) {
          kind = 1
        } else if (row.type === 3) {
          kind = 2
        }
      }

      if (kind === null) {
        // 没有原始行信息时退回旧 JSON 的 speaker/portrait 判定
        kind = 2
        if (hasMeta) {
          if (l.speaker) {
            kind = 0
            name = l.speaker
            slug = l.speaker_id || l.portrait_id || null
          } else if (isMEx && directMEx) {
            kind = 1
          } else if (l.portrait) {
            kind = 0
            name = l.portrait
            slug = l.portrait_id || l.speaker_id || null
          } else {
            kind = 1
          }
        }
      }
      if (kind !== 0 && /离开了聊天室|加入了聊天室|被撤回/.test(text)) kind = 2

      if (kind === 0 && slug) {
        if (!parts[slug]) parts[slug] = resolveSender(slug, name)
        if (!name) name = parts[slug][1]
        if (name && !names.includes(name) && names.length < 4) names.push(name)
      }
      outLines.push([kind, kind === 0 ? slug : null, kind === 0 ? name : null, text])
    }
    if (!outLines.length) continue
    const [cat, label] = categoryOf(g)
    const previewLine = outLines.find((x) => x[0] !== 2) || outLines[0]
    items.push({
      g,
      unit,
      anchor: anchorG,
      at,
      cat,
      label,
      n: outLines.length,
      t: names.length ? names.join(' / ') : '剧情短信',
      p: previewLine[3].replace(/\s*\n\s*/g, ' ').slice(0, 70),
      parts,
      l: outLines,
    })
  }

  // 同一段落后按群组 key 排序，保证多段短信的顺序稳定
  items.sort((a, b) =>
    a.unit - b.unit || a.anchor.localeCompare(b.anchor) || a.at - b.at || a.g.localeCompare(b.g))

  const counts = {}
  for (const it of items) counts[it.cat] = (counts[it.cat] || 0) + 1
  const cats = [
    { k: 'all', n: '全部', c: items.length },
    { k: 'main', n: '主线', c: counts.main || 0 },
    { k: 'event', n: '活动', c: counts.event || 0 },
    { k: 'nikke', n: '个人', c: counts.nikke || 0 },
    { k: 'sub', n: '支线', c: counts.sub || 0 },
    { k: 'treasure', n: '宝物', c: counts.treasure || 0 },
    { k: 'other', n: '其他', c: counts.other || 0 },
  ].filter((x) => x.c > 0 || x.k === 'all')

  fs.writeFileSync(OUT, JSON.stringify({ total: items.length, cats, items }))
  const exactN = items.filter((x) => scenarioAnchors.has(x.g)).length
  console.log(`内嵌剧情短信 ${items.length} 段 / ${items.reduce((a, x) => a + x.n, 0)} 条`
    + `（场景脚本精确定位 ${exactN} 段）`)
  console.log(`输出 ${path.relative(ROOT, OUT)}  ${(fs.statSync(OUT).size / 1048576).toFixed(2)} MB`)
  if (skipped.length) console.log(`未找到剧情归属（不内嵌）：${skipped.length} 段`, skipped.slice(0, 20))
}

main()
