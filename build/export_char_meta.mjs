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
 * 唯一源头是加密的 IL2CPP 元数据。属性表由人工对游戏整理（ELEMENT_MANUAL，按站内显示名索引），
 * 导出时并入 char_meta.json 各条目的 "element" 字段（fire/water/wind/electric/iron）；
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
 * 女神战队-方舟游侠：电视中的英雄三人组（黑色/红色/蓝色游侠），群聊匹配覆盖不到
 * 远古故事部队：小美人鱼、灰姑娘：琉璃波光（灰姑娘/格拉维已由群聊匹配命中）
 * 银枪部队：玛丽安（仅此一位）；玛丽安：女王与神罚属反击部队
 * 更全面的补充见下方 SQUAD_MANUAL（按游戏内收录逐条核对）。
 */
const SQUAD_OVERRIDE = {
  470: '女神部队', 224: '女神部队', 225: '女神部队', 226: '女神部队',
  471: '女神部队', 472: '女神部队', 473: '女神部队', 933: '女神部队',
  570: '女神战队-方舟游侠', 571: '女神战队-方舟游侠', 572: '女神战队-方舟游侠',
  513: '远古故事部队', 515: '远古故事部队',
  233: '继承者部队',
  13: '银枪部队',
  19: '反击部队',
  // NPC 没有部队，按出处活动挂组：赛菲（11/19 活动「SKY ON THE ROCK」）
  9045: 'SKY ON THE ROCK',
}

/* ---------- 人工校对的企业/势力归属（NPC 无 CharacterTable 行，按游戏档案核对）----------
 * 三大企业里的非妮姬职员：英格丽（极乐净土）、舒恩/智恩/安曼（米西利斯）、
 * 马士丁/汉森/米赛斯小姐（泰特拉）；舒恩的 CharacterTable 行本就给出 corp=2。
 * 游侠三人组同属一档节目，黑色游侠的表行给出 corp=3（泰特拉出品），红色/蓝色补齐。
 * 101/102/103 为站内自设枚举：不属于三大企业的其他势力。
 */
const CORP_MANUAL = {
  900: 1, 901: 2, 973: 2, 9030: 2,
  902: 3, 9023: 3, 9003: 3,
  570: 3, 571: 3, 572: 3,
  903: 101, 931: 101, 909: 101, 935: 101, 904: 101, 371: 101, 370: 101,
  925: 102, 929: 102,
  9018: 103, 991: 103, 9016: 103,
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
/* ---------- 人工校对的企业/势力归属并入（NPC 无表行或需校正） ---------- */
for (const [id, corp] of Object.entries(CORP_MANUAL)) {
  if (!out[id]) continue
  out[id].corp = corp
}
console.log(`人工企业 ${Object.keys(CORP_MANUAL).length}`)

/* ---------- 联动角色企业归入反常：游戏表的企业枚举为 7（联动），档案展示为反常（5） ---------- */
{
  let n7 = 0
  for (const v of Object.values(out)) {
    if (v.corp === 7) { v.corp = 5; n7++ }
  }
  console.log(`联动→反常 ${n7}`)
}

/* ---------- 部队补充表（按游戏内收录逐条核对，优先级最高）----------
 * 补齐群聊匹配与 SQUAD_OVERRIDE 覆盖不到的部队归属；玛律恰那改隶学术界部队。
 * 四兽部队/近接战斗部队暂无游戏档案文本，弹窗回退占位说明。
 * 明日香本体为 NERV 时期，其 WILLE 版本单独钉死，避免变体继承到 NERV。
 * 樱属 WILLE；桃乐丝：异端暂归女神部队（异端形态暂无官方档案定位）。
 */
const SQUAD_MANUAL = {
  321: '学术界部队',
  272: '777部队',
  590: '孵化器部队',
  192: '无极限部队',
  620: '秘幕秩序部队',
  330: '白骑士部队', 331: '白骑士部队',
  532: '超地平线部队', 530: '超地平线部队', 531: '超地平线部队',
  223: '开拓者部队',
  361: '克重部队',
  316: '专属女仆部队',
  150: '大师之手部队',
  441: '监督者部队', 440: '监督者部队',
  560: '四兽部队', 562: '四兽部队', 563: '四兽部队', 561: '四兽部队',
  261: '异端者', 262: '异端者', 9017: '异端者', 9025: '异端者', 263: '异端者',
  120: '召回释放部队', 121: '召回释放部队',
  860: '莉可莉可咖啡厅', 861: '莉可莉可咖啡厅', 862: '莉可莉可咖啡厅',
  971: '近接战斗部队',
  821: '爱蜜莉雅阵营', 820: '爱蜜莉雅阵营', 822: '爱蜜莉雅阵营',
  851: '第二空降小队', 852: '第五空降小队', 850: '第七空降小队',
  833: 'NERV', 830: 'NERV', 831: 'NERV', 832: 'NERV', 834: 'NERV',
  835: 'WILLE', 836: 'WILLE',
  9200: '女神部队',
  842: 'B.S.T.', 840: 'B.S.T.', 841: 'B.S.T.',
  871: '自称特别搜查队',
  800: '恶魔猎人', 801: '恶魔猎人', 802: '恶魔猎人',
  810: '寄叶', 811: '寄叶', 813: '寄叶',
  870: '心之怪盗团',
  872: '特别课外活动部',
  306: '替代者部队', 303: '替代者部队', 305: '替代者部队', 307: '替代者部队',
  304: '替代者部队', 300: '替代者部队', 302: '替代者部队', 301: '替代者部队', 308: '替代者部队',
}
{
  let nSm = 0
  for (const [id, squad] of Object.entries(SQUAD_MANUAL)) {
    if (!out[id]) continue
    out[id].squad = squad
    nSm++
  }
  console.log(`部队补充 ${nSm}`)
}

/* ---------- 变体角色卡继承本体部队（同一个人，不同的角色卡）----------
 * 名字为「本体名：别名」的卡片与本体同一部队（如阿妮斯：超级巨星仍属反击部队）；
 * 已有部队的（群聊匹配/SQUAD_OVERRIDE/SQUAD_MANUAL）以既有结果为准，本体缺部队的保持空缺。
 */
{
  const idByName = new Map(chars.map((c) => [c.name, c.id]))
  let nVs = 0
  for (const c of chars) {
    const sep = c.name.indexOf('：')
    if (sep <= 0) continue
    const cur = out[String(c.id)]
    const baseId = idByName.get(c.name.slice(0, sep))
    if (!cur || cur.squad || baseId == null) continue
    const baseSquad = out[String(baseId)]?.squad
    if (baseSquad) { cur.squad = baseSquad; nVs++ }
  }
  console.log(`变体继承部队 ${nVs}`)
}

/* ---------- 人工整理的属性表（对游戏逐条核对，译名与站内 characters.json 对齐）----------
 * 属性不在任何可解析的游戏表里（源头是加密的 IL2CPP 元数据），人工按游戏内
 * 收录条目的属性图标整理；覆盖 206 条（其余为无战斗属性的 NPC，概览卡自动跳过）。
 */
const ELEMENT_MANUAL = {
  fire: ['艾玛', '西格娜', '米兰达', '银华', 'D：杀手妻子', '拉毗：小红帽', '艾玛：战术升级', '贝斯蒂：战术升级', '银华：战术升级', '迪塞尔：冬日甜心', '布丽德：静默轨道', '阿尔卡娜：命运伴侣', '尤妮', '德雷克', '克拉乌', '吉洛', '特罗尼', '米哈拉：羁绊锁链', '爱丽丝', '尤尔夏', '杨', '樱花', '可可', '索达', '尼罗', '贝伊', '鲁玛妮', '神罚', '尼希利斯塔', '格拉维', '玛丽安：女王', '红莲：弑神', '长发公主：圣域', '帕瓦', '2B', 'A2', '明日香', '零', 'QUEEN（真）', '雪子', '拉毗', '尼恩', '士兵O.W.', '产品12'],
  water: ['普丽瓦蒂', '波莉', '布丽德', '贝斯蒂', '海伦', '尼恩：蓝色海洋', '潘托姆', '吉萝婷：寒冬杀手', '马斯特：浪漫的女仆', '安克：天真的女仆', '德尔塔：怪盗忍者', '索林：霜之旅票', '托比', '坎西：逃生女王', '伊莱格：BOOM与惊吓', '白鹤', '吉尔提：神力兔女郎', '森：疾速兔女郎', '梅里', '米尔克', '鲁德米拉', '富克旺', '毒蛇', '莱伊', '阿莉亚', '梅里：海湾女神', '鲁德米拉：冬日之主', '莱昂纳', '爱丽丝：仙境兔女郎', '布蕾德', '克劳斯特', '普莉卡', '贝洛塔：南瓜女巫', '桃乐丝', '桃乐丝：机缘巧遇', '白雪公主：重型武装', '玛奇玛', '雷姆', '爱蜜莉雅', '米哈拉', 'N102', '尼夫', '樱', 'iDoll海'],
  wind: ['迪塞尔', 'D', '基里', '索拉', 'E.H.', '佩珀', '艾德米', '吉尔提', '安妮：奇迹仙女', '艾菲涅尔', '玛娜', '莫莉', '拉普拉斯：究极英雄', '麦斯威尔：平凡技师', '德雷克：终极反派', '布兰儿', '诺亚尔', '朵拉', '沃纶姆', '爱德', '罗珊娜：高雅海洋', '樱花：夏日绽放', '薇尔维特', '方舟黑色游侠', '诺雅', '红莲：暗影', '小美人鱼', '娜由塔', '莉贝雷利奥', '明日香：WILLE', '零（暂称）', '德尔塔', '安克', '米卡', '姬野', '拉姆', '百合', '产品23', 'iDoll花'],
  electric: ['吉萝婷', '梅登', '马斯特', '普丽瓦蒂：不友善的女仆', '茨瓦伊', '梅登：冰玫瑰', '阿尔卡娜', 'K', '阿维斯塔', '森', '坎西', '娜嘉', '伊莱格', '爱因', '芙罗拉', '特蕾娜', '尼恩：透视之眼', '艾可希雅', '饼干', '诺伊斯', '露菲：冬日购物狂', '罗珊娜', '阿妮斯：闪耀夏日', '牡丹', '克雷伊', '露姬', '阿妮斯：超级巨星', '伊莎贝尔', '红莲', '哈兰', '灰姑娘', '真理', '艾达', '吉儿', '艾瑟儿', '贝洛塔', '克莱尔', '士兵E.G.', '产品08'],
  iron: ['索林', '海伦：海蓝宝石', '玛律恰那', '蕾贝儿', '玛律恰那：海洋进修', '麦斯威尔', '丽塔', '尤莉亚', '桑迪', '豺狼', '拉普拉斯', '蒂亚', '舒格', '普琳玛', '露菲', '诺薇儿', '米卡：雪地伙伴', '索达：闪亮兔女郎', '米尔克：花漾兔女郎', '爱德：特工兔女郎', '敏特', '白雪公主', '长发公主', '小红帽', '白雪公主：纯真年代', '皇冠', '长发公主：纯洁恩典', '钟鸣', '灰姑娘：琉璃波光', '伊芙', '渡鸦', '千束', '泷奈', '阿妮斯', '帕斯卡', '美里', '胡桃', '埃癸斯', '士兵F.A.', 'iDoll太阳'],
}
{
  const idByName = new Map(chars.map((c) => [c.name, c.id]))
  let nEl = 0
  for (const [el, names] of Object.entries(ELEMENT_MANUAL)) {
    for (const name of names) {
      const id = idByName.get(name)
      if (id == null) { console.log(`! 属性表名字未匹配：${el} · ${name}`); continue }
      out[String(id)].element = el
      nEl++
    }
  }
  console.log(`属性 ${nEl}`)
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
    texts.element[el] = { name: q(`ELEMENT_NAME_${key}`), desc: q(`ELEMENT_DESC_${key}`) }
  }
  // 企业世界观介绍（CorporationInfoTable 引用的回收研究所文本；联动 corp=7 无官方文本）
  for (const [num, key] of [['1', 'ELYSION'], ['2', 'MISSILIS'], ['3', 'TETRA'], ['4', 'PILGRIM'], ['5', 'ABNORMAL']]) {
    texts.corp[num] = { name: q(`COMPANY_${key}`), desc: q(`RECYCLE_ROOM_RESEARCH_${key}_INFO`) }
  }
  sysDb.close()
  fs.writeFileSync(path.join(ROOT, 'public/data/spec_texts.json'), JSON.stringify(texts, null, 1))
  console.log(`spec_texts.json：武器 ${Object.keys(texts.weapon).length} | 兵种 ${Object.keys(texts.cls).length} | 属性 ${Object.keys(texts.element).length} | 企业 ${Object.keys(texts.corp).length} | 部队介绍 ${Object.keys(texts.squad).length}`)
}
