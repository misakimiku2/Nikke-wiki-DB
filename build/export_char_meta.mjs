/** 角色元数据导出：部队 / 制造企业 / 武器分类 / 兵种 / 爆裂阶段
 *
 * 数据源（全部来自游戏文件，无人工录入）：
 *  - CharacterTable.mpk   （MPK 自定义序列化：[u8 字段数][u32/字符串/bool 字段...]）
 *      c11 = 企业（已用 nikke-db 社区数据交叉校验钉死方向：1 极乐净土 / 2 米西利斯 / 3 泰特拉 / 4 朝圣者 / 7 联动）
 *      c13 = 兵种（1 火力 / 2 防御 / 3 辅助）
 *      c18 = 普通攻击技能 id
 *      c21 = 爆裂阶段（1/2/3，小红帽=5 表示全爆裂）
 *      注意：约 333 行（资源覆盖行）在 c5 处多一个字符串字段，其后列号整体 +1，解析时统一归一化
 *  - CharacterShotTable.mpk（射击表行首 u32 = 攻击技能 id，行内本地化键含武器代码）
 *      攻击技能 id → 武器代码 ar/sg/rl/smg/sr/mg
 *  - SquadInfoTable.mpk + Locale_Character（部队官方名称）
 *  - char_messages.json（角色群聊标题 = 游戏里显示的部队名，按官方部队名匹配）
 *
 * 属性（风压/水冷/燃烧/铁甲/电击）不在任何可解析的游戏表里（CharacterTable 全列锚点校验、
 * 全 MPK 的 AKL-EKL 代码扫描、Locale 库、角色详情/元素/卡池 bundle 均已排查），
 * 唯一源头是加密的 IL2CPP 元数据（nikkeBase.dll）。等人工整理的属性表，直接往
 * char_meta.json 各条目加 "element" 字段（fire/water/wind/electric/iron）即可，前端留了扩展位；
 * 社区参考数据 build/ref_characters.json（111 条，锚点校验全对，偏旧）可用 crosscheck_meta.py 验证。
 *
 * 输出 public/data/char_meta.json：
 *      { "10": { burst: 3, corp: 1, cls: 1, weapon: "ar", squad: "反击部队" }, ... }
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const STATIC = 'E:/test/nikke_extract/staticdata'
const DEC = 'E:/test/nikke_extract/decrypted'

/* ---------- MPK 通用解析 ---------- */
function parseRows(buf, headTest) {
  const heads = []
  for (let i = 1; i + 13 <= buf.length; i++) {
    const h = headTest(buf, i)
    if (h) heads.push(h)
  }
  const rows = heads.map((h, k) => {
    const fields = []
    let p = h + 1
    const end = heads[k + 1] ?? buf.length
    while (p < end) {
      const rest = end - p
      if (rest < 4) { fields.push({ t: 'b', v: buf[p] }); p += rest; continue }
      const v = buf.readInt32LE(p)
      if (v < 0 && rest >= 8) {
        const len = buf.readUInt32LE(p + 4)
        if (-(v) - 1 === len && len > 0 && len <= rest - 8) {
          fields.push({ t: 's', v: buf.slice(p + 8, p + 8 + len).toString('utf8') })
          p += 8 + len
          continue
        }
      }
      fields.push({ t: 'i', v: buf.readUInt32LE(p) })
      p += 4
    }
    return fields
  })
  return rows
}
const int = (f) => (f?.t === 'i' ? f.v : null)

/* ---------- CharacterTable ---------- */
const ctRows = parseRows(fs.readFileSync(path.join(STATIC, 'CharacterTable.mpk')), (b, i) => {
  if (b[i] !== 0x29) return false
  const v = b.readInt32LE(i + 5)
  if (v >= 0) return false
  const len = b.readUInt32LE(i + 9)
  return -(v) - 1 === len && len > 0 && len < 4096 ? i : false
})
// 归一化：c5 处的字符串字段（acc/bg）占位，去掉后列号与普通行对齐
const norm = (f) => (f[5]?.t === 's' ? [...f.slice(0, 5), ...f.slice(6)] : f)
const charMeta = new Map()
for (const f of ctRows.map(norm)) {
  const cid = int(f[3])
  if (cid == null || charMeta.has(cid)) continue
  charMeta.set(cid, { burst: int(f[21]), corp: int(f[11]), cls: int(f[13]), atk: int(f[18]) })
}

/* ---------- CharacterShotTable：攻击技能 → 武器 ---------- */
const shotRows = parseRows(fs.readFileSync(path.join(STATIC, 'CharacterShotTable.mpk')), (b, i) => {
  const v = b.readInt32LE(i)
  if (v < 1000000 || v > 10000000) return null
  const m = b.readInt32LE(i + 4)
  if (m >= 0) return null
  const len = b.readUInt32LE(i + 8)
  return -(m) - 1 === len && len > 5 && len < 4096 ? i - 1 : null
})
const skillWeapon = new Map()
for (const f of shotRows) {
  const id = int(f[0])
  if (id == null || skillWeapon.has(id)) continue
  for (const x of f) {
    if (x.t !== 's') continue
    const m = /localkey_([a-z]+)_/.exec(x.v)
    if (m && ['ar', 'sg', 'rl', 'smg', 'sr', 'mg'].includes(m[1])) { skillWeapon.set(id, m[1]); break }
  }
}

/* ---------- SquadInfoTable + Locale_Character：部队官方名 + 官方世界观介绍 ---------- */
function openTable(name) {
  for (const fn of fs.readdirSync(DEC)) {
    if (!fn.endsWith('.dec')) continue
    try {
      const db = new DatabaseSync(path.join(DEC, fn), { readOnly: true })
      const hit = db.prepare("select name from sqlite_master where type='table' and name=?").all(name)
      if (hit.length) return db
      db.close()
    } catch { /* skip */ }
  }
  return null
}
const squadSet = new Set()
const squadInfo = {}
{
  const db = openTable('Locale_Character')
  const buf = fs.readFileSync(path.join(STATIC, 'SquadInfoTable.mpk'))
  const rows = parseRows(buf, (b, i) => {
    if (b[i] !== 5) return false
    const a = b.readUInt32LE(i + 1)
    if (a < 1 || a > 100) return false
    if (b.readUInt32LE(i + 5) < 1) return false
    const v = b.readInt32LE(i + 9)
    if (v >= 0) return false
    const len = b.readUInt32LE(i + 13)
    return -(v) - 1 === len && len > 5 && len < 4096 ? i : false
  })
  for (const f of rows) {
    const nameKey = f.find((x) => x.t === 's' && /_name$/.test(x.v))
    if (!nameKey) continue
    const slug = nameKey.v.replace('Locale_Character:', '').replace('_name', '')
    const r = db.prepare('select "zh-CN" as z from Locale_Character where "Key" = ?').all(slug + '_name')
    if (!r[0]?.z) continue
    squadSet.add(r[0].z)
    // 官方世界观介绍（游戏内部队档案文本，squad_{slug}_info）
    const infoKey = f.find((x) => x.t === 's' && /_info$/.test(x.v))
    if (infoKey) {
      const info = db.prepare('select "zh-CN" as z from Locale_Character where "Key" = ?')
        .all(infoKey.v.split(':').pop())[0]?.z
      if (info) squadInfo[r[0].z] = info
    }
  }
  db.close()
}

/* ---------- 群聊标题 → 部队 ---------- */
const msgs = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/char_messages.json'), 'utf8'))
const roomTitle = new Map(Object.entries(msgs.rooms).map(([id, r]) => [id, r.t]))
const squadOf = (item) => {
  for (const rid of item.rooms || []) {
    const t = roomTitle.get(rid)
    if (t && squadSet.has(t)) return t
  }
  return null
}

/* ---------- 人工校对的部队归属（按游戏档案核对，优先于群聊匹配） ----------
 * 女神部队：小红帽、女神系变体与莉莉维丝（这些角色没有以部队命名的群聊，群聊匹配覆盖不到）
 * 远古故事部队：小美人鱼、灰姑娘：琉璃波光（灰姑娘/格拉维已由群聊匹配命中）
 * 银枪部队：玛丽安（仅此一位）；玛丽安：女王与神罚属反击部队
 */
const SQUAD_OVERRIDE = {
  470: '女神部队', 224: '女神部队', 225: '女神部队', 226: '女神部队',
  471: '女神部队', 472: '女神部队', 473: '女神部队', 933: '女神部队',
  513: '远古故事部队', 515: '远古故事部队',
  233: '继承者部队',
  13: '银枪部队',
  19: '反击部队',
}

/* ---------- 合并输出（只保留站点收录的角色） ---------- */
const chars = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/characters.json'), 'utf8')).items
const out = {}
let missMeta = 0
for (const c of chars) {
  const m = charMeta.get(c.id)
  const item = msgs.items[String(c.id)]
  const squad = SQUAD_OVERRIDE[c.id] ?? (item ? squadOf(item) : null)
  if (!m) { missMeta++; out[String(c.id)] = { squad } } else {
    out[String(c.id)] = {
      burst: m.burst, corp: m.corp, cls: m.cls,
      weapon: m.atk != null ? skillWeapon.get(m.atk) || null : null,
      squad,
    }
  }
}
fs.writeFileSync(path.join(ROOT, 'public/data/char_meta.json'), JSON.stringify(out, null, 1))
const n = (sel) => Object.values(out).filter(sel).length
console.log(`角色 ${chars.length}，无CharacterTable行 ${missMeta}`)
console.log(`爆裂 ${n((x) => x.burst)} | 企业 ${n((x) => x.corp)} | 兵种 ${n((x) => x.cls)} | 武器 ${n((x) => x.weapon)} | 部队 ${n((x) => x.squad)}`)

/* ---------- 概览卡弹窗的官方说明文本 → spec_texts.json ----------
 * Locale_System：WEAPON_TYPE_*_NAME/DESC（枪械类型）、CLASS_TYPE_*_NAME/DESC（兵种）、
 *                ELEMENT_DESC_*（属性伤害说明，游戏文案自带克制关系表述）
 * 企业与部队游戏内没有说明文本，弹窗文案由前端自拟。 */
{
  const sysDb = openTable('Locale_System')
  const q = (key) => sysDb.prepare('select "zh-CN" as z from Locale_System where Key = ?').all(key)[0]?.z || ''
  const texts = {
    weapon: {},
    cls: {},
    element: {},
    corp: {},
    squad: squadInfo,
  }
  for (const [code, key] of [['ar', 'AR'], ['sg', 'SG'], ['rl', 'RL'], ['smg', 'SMG'], ['sr', 'SR'], ['mg', 'MG']]) {
    texts.weapon[code] = { name: q(`WEAPON_TYPE_${key}_NAME`), desc: q(`WEAPON_TYPE_${key}_DESC`) }
  }
  for (const [num, key] of [['1', 'ATTACKER'], ['2', 'DEFENDER'], ['3', 'SUPPORTER']]) {
    texts.cls[num] = { name: q(`CLASS_TYPE_${key}_NAME`), desc: q(`CLASS_TYPE_${key}_DESC`) }
  }
  for (const [el, key] of [['fire', 'FIRE'], ['water', 'WARTER'], ['wind', 'WIND'], ['electric', 'ELECTRONIC'], ['iron', 'IRON']]) {
    texts.element[el] = { desc: q(`ELEMENT_DESC_${key}`) }
  }
  // 企业世界观介绍（CorporationInfoTable 引用的回收研究所文本；联动 corp=7 无官方文本）
  for (const [num, key] of [['1', 'ELYSION'], ['2', 'MISSILIS'], ['3', 'TETRA'], ['4', 'PILGRIM'], ['5', 'ABNORMAL']]) {
    texts.corp[num] = { name: q(`COMPANY_${key}`), desc: q(`RECYCLE_ROOM_RESEARCH_${key}_INFO`) }
  }
  sysDb.close()
  fs.writeFileSync(path.join(ROOT, 'public/data/spec_texts.json'), JSON.stringify(texts, null, 1))
  console.log(`spec_texts.json：武器 ${Object.keys(texts.weapon).length} | 兵种 ${Object.keys(texts.cls).length} | 属性 ${Object.keys(texts.element).length} | 企业 ${Object.keys(texts.corp).length} | 部队介绍 ${Object.keys(texts.squad).length}`)
}
