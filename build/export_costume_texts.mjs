#!/usr/bin/env node
/**
 * 皮肤（时装）文案导出
 *
 * 数据来源（全部本机离线解包，只读）：
 *   decrypted/*.dec  Locale_CharacterCostume  每套皮肤的名字 / 获取方式
 *                    Locale_Character         皮肤专属档案介绍（{id}_{variant}_intro，
 *                                             仅部分皮肤有，21 条，如拉毗泳装「夏季出差中。」）
 *
 * 输出：public/data/costume_texts.json
 *   { "c010_02": { "name": "经典假期", "desc": "拉毗的时装\n通过签到活动获得",
 *                  "intro": "夏季出差中。" }, ... }
 *
 * 键 = 立绘代号（charId 补 3 位、variant 补 2 位），与 char_images.json 的值一致。
 * 用法：node build/export_costume_texts.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = process.env.NIKKE_SRC || 'E:/test/nikke_extract'
const DEC = path.join(SRC, 'decrypted')
const OUT = path.join(ROOT, 'public', 'data', 'costume_texts.json')

function findDb(tableName) {
  for (const f of fs.readdirSync(DEC)) {
    if (!f.endsWith('.dec')) continue
    try {
      const db = new DatabaseSync(path.join(DEC, f), { readOnly: true })
      const hit = db.prepare(
        "select name from sqlite_master where type='table' and name=?",
      ).all(tableName)
      if (hit.length) return { db, file: f }
      db.close()
    } catch { /* 不是 SQLite 或损坏，跳过 */ }
  }
  return null
}

const pad = (v, n) => String(v).padStart(n, '0')

/** 记录键 c010_02：charId 补 3 位、variant 补 2 位（10_2 -> c010_02，101_02 -> c101_02） */
function costumeKey(charId, variant) {
  return `c${pad(charId, 3)}_${pad(variant, 2)}`
}

function main() {
  const costume = findDb('Locale_CharacterCostume')
  if (!costume) {
    console.error('! 没找到含 Locale_CharacterCostume 的 .dec')
    process.exit(1)
  }
  console.log(`Locale_CharacterCostume <- ${costume.file}`)

  // Locale_Character：按表名在 decrypted/ 里定位（客户端更新会换文件哈希，写死会失效）
  const charHit = findDb('Locale_Character')
  if (!charHit) {
    console.error('! 没找到含 Locale_Character 的 .dec')
    process.exit(1)
  }
  const charDb = charHit.db

  const out = {}

  // 皮肤名字 / 获取方式（全部皮肤）
  for (const r of costume.db.prepare('select "Key","zh-CN" as z from Locale_CharacterCostume').all()) {
    let m = /^(\d+)_(\d+)_costume_name$/.exec(r.Key)
    if (m) {
      const k = costumeKey(m[1], m[2])
      out[k] ||= {}
      out[k].name = r.z || ''
      continue
    }
    m = /^(\d+)_(\d+)_description$/.exec(r.Key)
    if (m) {
      const k = costumeKey(m[1], m[2])
      out[k] ||= {}
      out[k].desc = r.z || ''
    }
  }

  // 皮肤专属档案介绍（Locale_Character 里的 {id}_{variant}_intro，数量少但是「换肤后介绍变化」的来源）
  let intros = 0
  for (const r of charDb.prepare('select "Key","zh-CN" as z from Locale_Character').all()) {
    const m = /^(\d+)_(\d+)_intro$/.exec(r.Key)
    if (!m || !r.z) continue
    const k = costumeKey(m[1], m[2])
    out[k] ||= {}
    out[k].intro = r.z
    intros++
  }

  // 国服专属时装（2026-11 G23.x 聊斋版本引入，如黄发垂髫/宴桃源/蝶恋花语）：
  // 国际服皮肤表没有这些条目。国服客户端的 Locale 表是明文 SQLite（.lss），
  // 结构与 .dec 相同；只补国际服没有的 key，命中的天然就是国服专属。
  let cnCount = 0
  const cnCostume = process.env.NIKKE_CN_GAME
    ? path.join(process.env.NIKKE_CN_GAME, 'nikke_Data/runtime_data/saus/saus/lss/Locale_CharacterCostume.lss')
    : 'C:/Program Files/GAME/胜利女神：新的希望(2002017)/nikke_Data/runtime_data/saus/saus/lss/Locale_CharacterCostume.lss'
  if (fs.existsSync(cnCostume)) {
    const cnDb = new DatabaseSync(cnCostume, { readOnly: true })
    for (const r of cnDb.prepare('select "Key","zh-CN" as z from Locale_CharacterCostume').all()) {
      let m = /^(\d+)_(\d+)_costume_name$/.exec(r.Key)
      if (m && r.z) {
        const k = costumeKey(m[1], m[2])
        if (!out[k]) {
          out[k] = { name: r.z }
          cnCount++
        }
        continue
      }
      m = /^(\d+)_(\d+)_description$/.exec(r.Key)
      if (m && r.z) {
        const k = costumeKey(m[1], m[2])
        if (out[k] && !out[k].desc) {
          out[k].desc = r.z.replace(/\r\n/g, '\n')
        }
      }
    }
    cnDb.close()
    console.log(`国服专属时装 ${cnCount} 套 <- ${cnCostume}`)
  } else {
    console.log('! 未找到国服 Locale_CharacterCostume.lss，跳过国服专属时装')
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(out))
  const n = Object.keys(out).length
  console.log(`皮肤 ${n} 套（含专属介绍 ${intros} 条）`)
  console.log(`输出 ${path.relative(ROOT, OUT)}  ${(fs.statSync(OUT).size / 1024).toFixed(1)} KB`)
  console.log('样例 c010_01:', JSON.stringify(out.c010_01))
  console.log('样例 c010_02:', JSON.stringify(out.c010_02))
}

main()
