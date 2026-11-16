/** 数据核对：皮肤标签 char_art.json vs 游戏官方名（Locale_CharacterCostume）
 *  A. 有官方名的代码：现标签 vs 官方名 不一致清单
 *  B. 官方有记录但站上没提取的皮肤（孤儿皮肤）
 *  C. 被 old:true 隐藏的立绘
 *  D. 皮肤表归属角色 vs 站上归属角色 冲突
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEC = 'E:/test/nikke_extract/decrypted'

const ci = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/char_images.json'), 'utf8'))
const art = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/char_art.json'), 'utf8'))
const chars = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/characters.json'), 'utf8')).items
const charById = new Map(chars.map((c) => [c.id, c]))
const charName = (id) => charById.get(Number(id))?.name || String(id)

// 代码 → 归属角色（char_images 的键），并处理 ART_EXTRA 类跨代码归属
const ownerOf = new Map() // art code -> character id
for (const [id, list] of Object.entries(ci)) for (const v of list) ownerOf.set(v, Number(id))

// 官方皮肤名（从 locale 表拉全量）
function findDb(tableName) {
  for (const f of fs.readdirSync(DEC)) {
    if (!f.endsWith('.dec')) continue
    try {
      const db = new DatabaseSync(path.join(DEC, f), { readOnly: true })
      const hit = db.prepare("select name from sqlite_master where type='table' and name=?").all(tableName)
      if (hit.length) return db
      db.close()
    } catch { /* skip */ }
  }
  return null
}
const db = findDb('Locale_CharacterCostume')
const official = new Map() // "10_02" -> 名字
for (const r of db.prepare('select "Key","zh-CN" as z from Locale_CharacterCostume').all()) {
  const m = /^(\d+)_(\d+)_costume_name$/.exec(r.Key)
  if (m && r.z) official.set(`${m[1]}_${Number(m[2])}`, r.z)
}
console.log('官方皮肤名:', official.size, '套')

console.log('\n=== A. 标签不一致（现标签 ≠ 官方名）===')
let a = 0
for (const [key, name] of [...official].sort()) {
  const [id, variant] = key.split('_')
  const code = `c${id.padStart(3, '0')}_${variant.padStart(2, '0')}`
  const label = art[code]?.n
  if (!label) continue
  const stripped = label.replace(new RegExp('^' + charName(id) + '[\\s·:：]+'), '')
  if (stripped !== name) {
    a++
    const owner = ownerOf.get(code)
    console.log(`  ${code} [${charName(id)}] 现标签「${label}」 vs 官方「${name}」${owner !== Number(id) ? ` ⚠归属:${owner}` : ''}`)
  }
}
if (!a) console.log('  （无）')

console.log('\n=== B. 官方有皮肤记录但代码未被认领（孤儿皮肤）===')
let b = 0
for (const [key, name] of [...official].sort()) {
  const [id, variant] = key.split('_')
  const code = `c${id.padStart(3, '0')}_${variant.padStart(2, '0')}`
  if (!ownerOf.has(code)) {
    b++
    const file = fs.existsSync(path.join(ROOT, 'public/char', code + '.webp'))
    console.log(`  ${code}「${name}」${charName(id)} 站上无归属${file ? '（文件已存在！）' : '（未提取）'}`)
  }
}
if (!b) console.log('  （无）')

console.log('\n=== C. 被 old:true 隐藏的立绘 ===')
let c = 0
for (const [code, info] of Object.entries(art)) {
  if (info.old) { c++; console.log(`  ${code}「${info.n}」归属:${charName(ownerOf.get(code) ?? '?')}`) }
}
if (!c) console.log('  （无）')

console.log('\n=== D. 归属冲突（皮肤表角色 ≠ 站上归属角色）===')
let d = 0
for (const [key, name] of [...official].sort()) {
  const [id, variant] = key.split('_')
  const code = `c${id.padStart(3, '0')}_${variant.padStart(2, '0')}`
  const owner = ownerOf.get(code)
  if (owner != null && owner !== Number(id)) {
    d++
    console.log(`  ${code}「${name}」皮肤表角色=${charName(id)}(${id}) 站上归属=${charName(owner)}(${owner})`)
  }
}
if (!d) console.log('  （无）')
