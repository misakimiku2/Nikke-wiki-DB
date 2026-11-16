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

  // Locale_Character：主线导出用的是固定那份 zh-CN 库
  const charFile = 'e6059faf00471aa305c16cabe88871bb.dec'
  const charDb = new DatabaseSync(path.join(DEC, charFile), { readOnly: true })

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

  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(out))
  const n = Object.keys(out).length
  console.log(`皮肤 ${n} 套（含专属介绍 ${intros} 条）`)
  console.log(`输出 ${path.relative(ROOT, OUT)}  ${(fs.statSync(OUT).size / 1024).toFixed(1)} KB`)
  console.log('样例 c010_01:', JSON.stringify(out.c010_01))
  console.log('样例 c010_02:', JSON.stringify(out.c010_02))
}

main()
