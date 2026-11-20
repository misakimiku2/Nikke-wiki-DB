#!/usr/bin/env node
/**
 * 角色 → 巴拉（Blabla）短信 / 主线短信 映射导出
 *
 * 数据来源（全部本机离线解包，只读）：
 *   staticdata/MessengerDialogTable.mpk   每条消息：消息 id / 房间 / 群组 / 说话人 / 跳转
 *   staticdata/MessengerRoomTable.mpk     房间成员（`absolut`、`counters` 这类群聊）
 *   staticdata/MessengerMemberTable.mpk   成员 slug → 角色名 key
 *   decrypted/*.dec                       Locale_SuddenMessage 的简体中文文本
 *   public/data/characters.json           角色 id / 中英文名 / 立绘
 *
 * 输出：public/data/char_messages.json
 *   {
 *     "total": 房间数,
 *     "rooms": { "<房间 id>": { t, c, mem, l } },
 *     "items": { "<角色 id>": { "rooms": [房间 id...], "lines": 句数 } }
 *   }
 *
 * 行格式：[kind, sender, text, next, choice]
 *   kind  0 = 角色，1 = 指挥官，2 = 系统提示
 *   sender  MessengerMemberTable 的 slug（kind=0 时有）
 *   next    ref 跳转目标在 l 中的下标；-1 = 顺序往下（分支 / 合流）
 *   choice  1 = 该行是玩家可选回复（连续几行组成一组选项）
 *
 * 用法：
 *   node build/export_char_messages.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = process.env.NIKKE_SRC || 'E:/test/nikke_extract'
const STATIC = path.join(SRC, 'staticdata')
const DEC = path.join(SRC, 'decrypted')
const OUT = path.join(ROOT, 'public', 'data', 'char_messages.json')
const CHARS = path.join(ROOT, 'public', 'data', 'characters.json')

const NICKNAME_RE = /\{AccountData\.NickName\}/g
const clean = (s, nick = '指挥官') => (s == null ? s : s.replace(NICKNAME_RE, nick))
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

// 手工兜底：房间 slug / 角色内部命名与 characters.json 英文名对不上时
const ROOM_ALIAS = {
  marianp: 260,          // 神罚（内部模型名 marian_p）
  deltaninjatheif: 23,   // 德尔塔：怪盗忍者（源数据把 thief 拼成 theif）
  laplacehero: 103,      // 拉普拉斯：究极英雄
  maxwellmechanic: 105,  // 麦斯威尔：平凡技师
  eunhwatactical: 95,    // 银华：战术升级
  emmatactical: 93,      // 艾玛：战术升级
  vestitactical: 94,     // 贝斯蒂：战术升级
}

// 手工兜底：发言人 slug → 角色。这些是聊天里的化名账号，按英文名/常规路径解析不到本人：
// - 「玫瑰」(rose) 是罗珊娜的假名——聊天原文自己就点破了
//   （"是我，罗珊娜" / "上面怎么写着玫瑰？" / "那是假名"），按英文名会撞上蔷花(Rose)
// - 「黑玫瑰」(blackrose) 是梅登的外号（吉萝婷剧情里的暗中活动身份）
// - 「BOOM GUY」(boomguy) 是伊莱格在指挥官室事件里用的化名档案（npc_399）
// - 「蓝色EZS」(blueezs) 是海伦——"我是海伦"（黄金海盗活动）
// - 「见义勇为的侠客」(loyalfighter) 是牡丹——"是牡丹吗？""嗯，是我…不想被舒格发现"
// - 「求生专家？」(survivor) 是托比——"我是托比，呵呵呵-_-||"
// - 「丘比特娜嘉/丘比特蒂亚」(cupidnaga/cupidtia) 是娜嘉/蒂亚——成员表 icon 就指向
//   本人立绘（si_c450_00_s / si_c451_00_s）
// - 「未知」(noname) 是尼罗——猫咪群聊里猫爪打字 "ni'罗"
// - 「玛丽安」(marian) 本体就是神罚（序章后遇袭改造）；成员表 icon 本来就是
//   si_c260_00_s（神罚立绘）。反击部队群聊里的玛丽安消息归到神罚名下
const SENDER_ALIAS = {
  rose: 280,
  blackrose: 181,
  boomguy: 500,
  blueezs: 352,
  loyalfighter: 281,
  survivor: 192,
  cupidnaga: 450,
  cupidtia: 451,
  noname: 380,
  marian: 260,
}

// 化名「账号」：游戏里以这个账号直接开聊的（纯化名发言人房间按化名私聊呈现）。
// marian 只是身份重定向——反击部队群聊是真群聊，marian_P 私聊房的标题
// 由房间表（ROOM_ALIAS marianp）决定，都不走化名私聊分支
const ALIAS_CHAT_SLUGS = new Set(['rose', 'blackrose', 'boomguy'])

// ---------- 通用 MPK 记录读取 ----------

function makeReader(buf, start = 0) {
  let p = start
  const str = () => {
    const tag = buf.readInt32LE(p); p += 4
    if (tag >= 0) throw new Error(`expected string tag at ${p - 4}, got ${tag}`)
    const len = buf.readInt32LE(p); p += 4
    if (len < 0 || len > 4096 || p + len > buf.length) throw new Error(`bad string length ${len} at ${p - 4}`)
    const s = buf.toString('utf8', p, p + len); p += len
    return s
  }
  const int = () => { const v = buf.readInt32LE(p); p += 4; return v }
  const u8 = () => { const v = buf.readUInt8(p); p += 1; return v }
  const maybeStr = () => (buf.readInt32LE(p) < 0 ? str() : int())
  return { str, int, u8, maybeStr, get p() { return p } }
}

// ---------- MessengerMemberTable ----------

function loadMembers() {
  const buf = fs.readFileSync(path.join(STATIC, 'MessengerMemberTable.mpk'))
  const total = buf.readUInt32LE(0)
  const r = makeReader(buf, 4)
  const rows = []
  for (let i = 0; i < total; i++) {
    r.u8()
    rows.push({
      slug: r.str(),
      type: r.int(),
      nameKey: r.str(),
      introKey: r.str(),
      icon: r.str(),
      bg: r.str(),
    })
  }
  return rows
}

// ---------- MessengerRoomTable ----------

function loadRooms() {
  const buf = fs.readFileSync(path.join(STATIC, 'MessengerRoomTable.mpk'))
  const total = buf.readUInt32LE(0)
  const r = makeReader(buf, 4)
  const rows = []
  for (let i = 0; i < total; i++) {
    r.u8()
    const id = r.str()
    const flag = r.int()
    r.int()
    r.int()
    const nameKey = r.str()
    const icon = r.str()
    const n = r.int()
    const members = []
    for (let k = 0; k < n; k++) members.push(r.str())
    rows.push({ id, flag, nameKey, icon, members })
  }
  return rows
}

// ---------- 本地化角色名 ----------

function findLocaleDb(tableName) {
  for (const f of fs.readdirSync(DEC)) {
    if (!f.endsWith('.dec')) continue
    try {
      const db = new DatabaseSync(path.join(DEC, f), { readOnly: true })
      const hit = db.prepare(
        "select name from sqlite_master where type='table' and name=?",
      ).all(tableName)
      if (hit.length) return db
      db.close()
    } catch {
      /* 不是 SQLite 或没有该表 */
    }
  }
  return null
}

function characterName(db, key) {
  if (!db || !key || !key.includes(':')) return null
  const [table, k] = key.split(':')
  try {
    return db.prepare(`select "zh-CN" as z from "${table}" where Key=?`).get(k)?.z || null
  } catch {
    return null
  }
}

// ---------- MessengerDialogTable ----------

function loadMessages() {
  const buf = fs.readFileSync(path.join(STATIC, 'MessengerDialogTable.mpk'))
  const text = buf.toString('latin1')
  const toks = []
  const re = /[ -~]{4,}/g
  let m
  while ((m = re.exec(text))) toks.push({ t: m[0], s: m.index, e: m.index + m[0].length })

  const rows = []
  for (let k = 0; k < toks.length; k++) {
    if (!toks[k].t.startsWith('Locale_SuddenMessage:')) continue
    // 行首的消息 id 是当前行里唯一一个「下一个 token 正好是房间 id」的 m_* 串。
    // 从后往前找，避免把上一行的 id / 引用字段当成当前行。
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
      const room = r.str()
      const group = r.str()
      const type = r.int()
      const fifth = type === 2 ? r.str() : r.maybeStr()
      const flag = r.int()          // 1 = 普通，2 = 玩家选项
      const ref = r.maybeStr()      // 分支 / 合流跳转目标
      const key = r.str()
      if (id !== toks[idIdx].t || key !== toks[k].t) continue
      rows.push({
        id, room, group, type,
        sender: type === 2 ? fifth : null,
        choice: flag === 2,
        ref: typeof ref === 'string' ? ref : null,
        key: key.slice('Locale_SuddenMessage:'.length),
      })
    } catch {
      /* 跳过解析不了的特殊记录（贴图 / 表情等） */
    }
  }
  return rows
}

// ---------- 主流程 ----------

function main() {
  if (!fs.existsSync(CHARS)) {
    console.error(`! 找不到 ${CHARS}，请先运行 export_web.py`)
    process.exit(1)
  }
  const chars = JSON.parse(fs.readFileSync(CHARS, 'utf8')).items
  const charById = new Map(chars.map((c) => [c.id, c]))
  const enExact = new Map()
  const zhExact = new Map()
  for (const c of chars) {
    const e = norm(c.names?.en)
    if (e && !enExact.has(e)) enExact.set(e, c.id)
    if (c.name && !zhExact.has(c.name)) zhExact.set(c.name, c.id)
  }

  const members = loadMembers()
  const memberBySlug = new Map(members.map((m) => [m.slug, m]))
  const rooms = loadRooms()
  const roomById = new Map(rooms.map((r) => [r.id, r]))
  const localeDb = findLocaleDb('Locale_Character')
  const msgDb = findLocaleDb('Locale_SuddenMessage')

  /** slug → characters.json 的角色 id */
  function charOfSlug(slug) {
    if (!slug) return null
    if (SENDER_ALIAS[slug] && charById.has(SENDER_ALIAS[slug])) return SENDER_ALIAS[slug]
    const mem = memberBySlug.get(slug)
    if (mem) {
      const key = mem.nameKey.split(':')[1] || ''
      const num = key.match(/^(\d+)_name$/)
      if (num && charById.has(Number(num[1]))) return Number(num[1])
      const zh = characterName(localeDb, mem.nameKey)
      if (zh) {
        if (zhExact.has(zh)) return zhExact.get(zh)
        const hit = chars.find((c) => c.name.startsWith(zh + '：'))
        if (hit) return hit.id
      }
    }
    const n = norm(slug)
    if (ROOM_ALIAS[n] && charById.has(ROOM_ALIAS[n])) return ROOM_ALIAS[n]
    if (enExact.has(n)) return enExact.get(n)
    if (slug.includes('_')) {
      const base = slug.replace(/_[a-z]$/, '')
      if (ROOM_ALIAS[norm(base)] && charById.has(ROOM_ALIAS[norm(base)])) return ROOM_ALIAS[norm(base)]
      if (enExact.has(norm(base))) return enExact.get(norm(base))
    }
    const sp = chars.find((c) => c.speaker === slug)
    return sp ? sp.id : null
  }

  /** 房间 slug / 群组 slug → characters.json 的角色 id（只对私聊房间用）。
   *  loose=false 只认精确的成员 slug / 英文名 / 手工别名；
   *  loose=true 才允许英文名前缀（给少量没有房间表记录的皮肤房间兜底）。 */
  function charOfRoomKey(key, loose = false) {
    const n = norm(key)
    if (!n) return null
    if (ROOM_ALIAS[n] && charById.has(ROOM_ALIAS[n])) return ROOM_ALIAS[n]
    if (enExact.has(n)) return enExact.get(n)
    if (memberBySlug.has(key)) {
      const id = charOfSlug(key)
      if (id) return id
    }
    if (!loose) {
      const sp = chars.find((c) => c.speaker === key)
      return sp ? sp.id : null
    }

    // 角色英文名的精确前缀（Anne: Miracle Fairy ≈ anne_miraclefairy，
    // Emma: Tactical Upgrade ≈ emma_tactical），取最长的那个，避免命中基础角色
    let best = null
    for (const [en, id] of enExact) {
      if (en.length < n.length) continue
      if (!en.startsWith(n)) continue
      if (en.length - n.length > 10) continue
      if (!best || en.length > best.en.length) best = { en, id }
    }
    if (best) return best.id

    // 双向前缀：key 比英文名长（多出版本后缀）时也允许，但至少剩 3 个字符
    for (const [en, id] of enExact) {
      if (en.length >= 4 && n.startsWith(en) && n.length - en.length >= 3) {
        if (!best || en.length > best.en.length) best = { en, id }
      }
    }
    if (best) return best.id
    return null
  }

  const rows = loadMessages()
  console.log(`消息 ${rows.length} 条`)
  const textStmt = msgDb?.prepare(
    'select "zh-CN" as z, en, ko, ja from Locale_SuddenMessage where Key=?')
  const textOf = (key) => {
    try {
      const r = textStmt?.get(key)
      return {
        zh: clean(r?.z),
        en: clean(r?.en, 'Commander'),
        ko: clean(r?.ko, '지휘관'),
        ja: clean(r?.ja, '指揮官'),
      }
    } catch {
      return { zh: '', en: '', ko: '', ja: '' }
    }
  }

  // 按房间分组
  const byRoom = new Map()
  for (const r of rows) {
    if (r.room.startsWith('m_test')) continue
    if (!byRoom.has(r.room)) byRoom.set(r.room, [])
    byRoom.get(r.room).push(r)
  }

  const outRooms = {}
  const outItems = {}
  const skipped = []
  const warnings = []
  /** 化名账号聊天（玫瑰/黑玫瑰这类）：排序时放在角色自己的私聊后面 */
  const aliasRooms = new Set()

  for (const [roomId, list] of byRoom) {
    const group = list[0].group
    const key = roomId
      .replace(/^m_ex_/, '')
      .replace(/^m_mainafter_/, '')
      .replace(/_\d+$/, '')
    const ids = new Set()
    let direct = false
    let title = null
    let memberSlugs = null

    // 化名账号聊天：整个房间只有化名在发言。游戏里这段会话直接以「玫瑰」这样的
    // 化名显示（罗珊娜用假名跟指挥官聊），不挂在群聊名目下——按私聊呈现：
    // 标题 = 化名，成员 = 本人。不新建角色实体，发言人/头像都归到本人名下
    // （化名在成员表里的 icon 本来就指向本人立绘，如 rose 是 si_c280_01_s）
    const senderSlugs = [...new Set(list.map((r) => r.sender).filter(Boolean))]
    const aliasOnly = senderSlugs.length > 0
      && senderSlugs.every((s) => ALIAS_CHAT_SLUGS.has(s))
    if (aliasOnly) {
      for (const s of senderSlugs) ids.add(SENDER_ALIAS[s])
      title = characterName(localeDb, memberBySlug.get(senderSlugs[0])?.nameKey)
        || charById.get(SENDER_ALIAS[senderSlugs[0]])?.name || null
      aliasRooms.add(roomId)
    }

    // 顺序：房间表精确匹配 → 精确角色名（皮肤私聊）→ 群组表精确匹配 →
    // 前缀房间 → 宽松角色名前缀。`claymore` 这类群聊 slug 以角色英文名开头，
    // 不能让宽松前缀抢先把它判成私聊。
    // 先试带后缀的完整房间 id（boomsday_01 这类在房间表里有自己的记录），
    // 再退回剥掉序号后的 key（killthelord 这类群聊房间）
    const exactRoom = aliasOnly
      ? undefined
      : roomById.get(roomId.replace(/^m_(?:ex|mainafter)_/, '')) || roomById.get(key)
    if (exactRoom) {
      memberSlugs = exactRoom.members
      title = characterName(localeDb, exactRoom.nameKey)
    } else if (!aliasOnly) {
      const directId = charOfRoomKey(key, false)
      if (directId) {
        ids.add(directId)
        direct = true
        title = charById.get(directId)?.name || null
      }
    }

    if (!aliasOnly && !direct && !memberSlugs) {
      const groupRoom = roomById.get(group)
      if (groupRoom) {
        memberSlugs = groupRoom.members
        title = characterName(localeDb, groupRoom.nameKey)
      }
    }
    if (!aliasOnly && !direct && !memberSlugs) {
      const prefixRooms = rooms.filter((r) => r.id.startsWith(key + '_'))
      if (prefixRooms.length) {
        memberSlugs = [...new Set(prefixRooms.flatMap((r) => r.members))]
        title = prefixRooms.map((r) => characterName(localeDb, r.nameKey)).find(Boolean) || null
      }
    }
    if (!aliasOnly && !direct && !memberSlugs) {
      const directId = charOfRoomKey(key, true)
      if (directId) {
        ids.add(directId)
        direct = true
        title = charById.get(directId)?.name || null
      }
    }
    if (!direct && memberSlugs) {
      for (const slug of memberSlugs) {
        const id = charOfSlug(slug)
        if (id && charById.has(id)) ids.add(id)
      }
    }
    // 群聊里真正说过话的人也算成员（前哨基地聊天群这类房间的成员表只挂了一个人）
    if (!direct && ids.size > 0) {
      for (const r of list) {
        const id = charOfSlug(r.sender)
        if (id && charById.has(id)) ids.add(id)
      }
    }
    // 房间表 / 群组都找不到时，退回到「谁在这个房间里说过话」。
    // 这类房间不是私聊（例如 unknown + 拉毗 的临时群聊），不要把发言人全部
    // 强行挂到唯一一个角色上。
    if (ids.size === 0) {
      for (const r of list) {
        const id = charOfSlug(r.sender)
        if (id && charById.has(id)) ids.add(id)
      }
    }
    if (ids.size === 0) {
      skipped.push({ room: roomId, group, key, lines: list.length })
      continue
    }

    // 行：kind / sender / 简中 / next / choice / 英文 / 韩文 / 日文
    // 先保留全部有文本的行，再按 id 建索引；ref 指向被丢掉的空行时退化为顺序往下。
    const kept = []
    for (const r of list) {
      const text = textOf(r.key)
      if (!text.zh && !text.en && !text.ko && !text.ja) continue
      kept.push({ r, text })
    }
    const idxOf = new Map(kept.map((x, i) => [x.r.id, i]))
    const lines = kept.map(({ r, text }) => {
      const kind = r.type === 2 ? 0 : r.type === 1 ? 1 : 2
      const next = r.ref && idxOf.has(r.ref) ? idxOf.get(r.ref) : -1
      return [kind, kind === 0 ? r.sender : null, text.zh, next, r.choice ? 1 : 0,
        text.en, text.ko, text.ja]
    })
    if (lines.length === 0) {
      skipped.push({ room: roomId, group, key, lines: 0 })
      continue
    }

    // 发言人 slug → [角色 id, 聊天显示名]
    const sn = {}
    for (const ln of lines) {
      const slug = ln[1]
      if (!slug || sn[slug]) continue
      const mem = memberBySlug.get(slug)
      sn[slug] = [
        charOfSlug(slug),
        (mem && characterName(localeDb, mem.nameKey)) || charById.get(charOfSlug(slug))?.name || slug,
      ]
    }
    const m = [...ids].map((id) => [id, charById.get(id)?.name || String(id)])
    // 私聊房间只有一个角色：发言人一律挂到这个角色上。
    // 例：marian_P 的 sender slug 是 marian，但房间实际属于神罚；露菲皮肤房间的
    // sender 是 rupee_w，应显示在「露菲：冬日购物狂」而不是基础露菲上。
    if (direct && ids.size === 1) {
      const onlyId = [...ids][0]
      const full = charById.get(onlyId)?.name || String(onlyId)
      for (const slug of Object.keys(sn)) {
        const short = sn[slug][1]
        sn[slug] = [onlyId, short && (full.startsWith(short) || full.startsWith(short + '：')) ? short : full]
      }
    }
    const cat = roomId.startsWith('m_mainafter_') ? 'main' : 'blabla'
    const badTitle = !title || /^unknown$/i.test(title)
    const shownTitle = badTitle
      ? (m.length > 1 ? m.map((x) => x[1]).join(' / ') : '未知群聊')
      : title
    outRooms[roomId] = {
      t: shownTitle || key,
      c: cat,
      m,
      sn,
      l: lines,
    }
    for (const id of ids) {
      if (!outItems[id]) outItems[id] = { rooms: [], lines: 0 }
      outItems[id].rooms.push(roomId)
      outItems[id].lines += lines.length
    }
    if (!title) warnings.push(`房间 ${roomId} 没有标题（群组 ${group}）`)
  }

  // 每个角色的房间排序：私聊 → 化名私聊 → 群聊；巴拉 → 主线；按房间号
  const rank = (id) => {
    const r = outRooms[id]
    const num = Number(id.match(/_(\d+)$/)?.[1] || 0)
    return [
      r.c === 'main' ? 1 : 0,
      r.m.length > 1 ? 1 : 0,
      aliasRooms.has(id) ? 1 : 0,
      num,
      id,
    ]
  }
  for (const item of Object.values(outItems)) {
    item.rooms.sort((a, b) => {
      const ra = rank(a), rb = rank(b)
      for (let i = 0; i < ra.length; i++) {
        if (ra[i] < rb[i]) return -1
        if (ra[i] > rb[i]) return 1
      }
      return 0
    })
  }

  const payload = {
    total: Object.keys(outRooms).length,
    rooms: outRooms,
    items: outItems,
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(payload))
  console.log(`角色 ${Object.keys(outItems).length} 个 / 房间 ${payload.total} 个 / 消息 ${rows.length} 条`)
  console.log(`输出 ${path.relative(ROOT, OUT)}  ${(fs.statSync(OUT).size / 1048576).toFixed(2)} MB`)
  if (skipped.length) {
    console.log(`\n未映射房间 ${skipped.length} 个：`)
    for (const s of skipped) console.log(`  - ${s.room} (group=${s.group}, ${s.lines} 行)`)
  }
  if (warnings.length) {
    console.log(`\n提示 ${warnings.length} 条：`)
    for (const w of warnings.slice(0, 10)) console.log(`  - ${w}`)
  }
}

main()
