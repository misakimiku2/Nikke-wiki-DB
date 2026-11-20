#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
角色档案导入

数据源：decrypted/ 里两个本地化 SQLite（扩展名 .dec，实为标准 SQLite）
  Locale_Character  -> 角色名 / 介绍 / 签名 / 声优
  Locale_Skill      -> 技能名 / 技能说明

key 对应关系（已交叉验证）：
  10_name                 拉毗
  c010_description        拉毗的角色介绍
  10_intro                拉毗的签名台词

  python build/build_characters.py
"""
import glob
import os
import re
import sqlite3
import sys
import time

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.environ.get("NIKKE_SRC", r"E:/test/nikke_extract")
DECRYPTED = os.path.join(SRC, "decrypted")
DB_PATH = os.path.join(ROOT, "data", "nikke.db")

LANGS = ["zh-CN", "en", "ja", "ko", "zh-TW"]


def clean_cv(s):
    """Locale 里的声优值是「CV：石川由依」，去掉前缀只留名字。"""
    if not s:
        return None
    return re.sub(r"^\s*CV\s*[:：]\s*", "", s, flags=re.I).strip() or None

# NPC 的 Locale id 与立绘资源代号不一致时，显示用的 code 以实际立绘为准
CODE_FIX = {
    909: "c914",   # 伯宁姆 Burningum
    930: "c113",   # E.H.（NPC 形态，复用 c113_01）
    931: "c939",   # 多万 Doban
    932: "c922",   # 真 Jin
    933: "c943",   # 莉莉维丝 Liliweiss
    934: "c941",   # 皮娜 Pinne
    935: "c961",   # 奥斯华 Oswald
}
# 非角色或重复条目：777 部队名；908 与 890 芭比珑重复；914 嚣嘈缺图集；
# 930 是 E.H. 的空壳条目（113 才是带介绍的正主）；510 同理，514 才是格拉维正主
DROP_IDS = {777, 908, 914, 930, 510}

# Locale 里没有数字 key、但剧情里有名字的 NPC（名字来自 npc_567_name）
NAME_FIX = {
    9003: {"zh-CN": "米赛斯小姐", "en": "Mrs. Miss", "ja": "ミセス・ミス", "ko": "미세스 미스"},
    915: {"zh-CN": "莱普琪立安", "en": "Raptilon", "ja": "ラプチリアン", "ko": "랩틸리언"},
}

# 只有剧情模型、没有 Locale 数字条目的 NPC：补成独立条目（名字来自 npc_XXX_name）
EXTRA = {
    813: ("c813", "9S", "9S"),
    923: ("c923", "董事会的男性高层", "Male Executive"),
    924: ("c924", "董事会的女性高层", "Female Executive"),
    945: ("c945", "警卫机器人", "Security Robot"),
    947: ("c947", "穿着外套的男人", "Man in a Jacket"),
    948: ("c948", "莉思", "Riss"),
    951: ("c951", "小男孩", "Boy"),
    952: ("c952", "小女孩", "Little Girl"),
    983: ("c983", "纳迪娅", "Nadia"),
    997: ("c997", "独一", "Only One"),
    9006: ("c9006", "德尔帕拉", "Deipara"),
    9026: ("c9026", "艾米", "Amy"),
    9031: ("c931", "收集机器人", "Collection Robot"),
    # 第 43 章「独一」登场的具名 NPC，代号取自 ScenarioCharacterSettingTable 的
    # spine/standing 字段（不是 Locale id）
    9016: ("c9016", "女祭司", "Priestess"),
    9017: ("c9017", "奥图露亚", "Altruia"),
    9018: ("c9018", "普林瑟斯", "Princess"),
    9019: ("c9019", "斯托尔三世", "Stall III"),
    # 其余专属立绘的具名 NPC（同样是 Locale 无数字条目、只有剧情模型）
    263: ("c263", "茵迪维利亚", "Indivilia"),
    803: ("c803", "电次", "Denji"),
    804: ("c804", "早川秋", "Aki Hayakawa"),
    9002: ("c9002", "诺拉", "Nora"),
    9010: ("c9010", "珍", "Jane"),
    9011: ("c9011", "莱因", "Rain"),
    9023: ("c9023", "汉森", "Hanson"),
    9024: ("c9024", "宥宥", "Yoyo"),
    9025: ("c9025", "艾格维斯塔", "Egovista"),
    9030: ("c9030", "安曼", "Enme"),
    9034: ("c9034", "企鹅1号", "Penguin No.1"),
    9035: ("c9035", "企鹅2号", "Penguin No.2"),
    9036: ("c9036", "企鹅3号", "Penguin No.3"),
    9037: ("c9037", "企鹅4号", "Penguin No.4"),
    # 11/19 活动「SKY ON THE ROCK」的具名 NPC：Locale 只有 npc_825_name（赛菲/Sephie），
    # 无数字条目；立绘资源代号 c9045 取自 spinestandingcharactergroup 的 standing 路径
    9045: ("c9045", "赛菲", "Sephie"),
    936: ("c936", "麦克斯", "Max"),
    946: ("c946", "露露", "Ruru"),
    967: ("c967", "露咪", "Lumi"),
    968: ("c968", "二姐", "Lua"),
    969: ("c969", "大姐", "Lena"),
    975: ("c975", "媞美", "Timi"),
    976: ("c976", "T.Rony", "T.Rony"),
    980: ("c980", "汉塞尔", "Hansel"),
    981: ("c981", "葛丽特", "Gretel"),
    988: ("c988", "村长", "Village Chief"),
    991: ("c991", "D.E.E.P.", "D.E.E.P."),
    # 以下几位的 Locale id 已被 CODE_FIX 挪作他用（930-935 指向别的立绘），
    # 只能另开 id 段，避免覆盖 E.H./多万/真/莉莉维丝/皮娜/奥斯华
    9100: ("c930", "碧翠丝", "Beatrice"),
    9101: ("c932", "伏特MK.ll", "Volt MK.II"),
    9102: ("c933", "伏特", "Volt"),
    9103: ("c934", "安洁丽娜", "Angelina"),
    9104: ("c935", "约瑟夫", "Joseph"),
    # 已实装 / 即将实装的独立角色卡（不是现有角色的皮肤）
    # 9200/9201 暂无官方命名，站内用自创名；诺雅的原型此时已非异端，取「新生」
    9200: ("c474", "桃乐丝：异端", "Dorothy: Heretic"),
    9201: ("c235", "诺雅：新生", "Noah: Rebirth"),
}

# 国服先行角色（2026-11 G23.x 聊斋版本，整体不在国际服 Locale 表里）。
# 文案抄自国服 Locale_Character.lss（明文 SQLite，Key 与国际服同构）；
# 英文名暂无官方译名，用拼音。desc / intro / cv 齐全，has_desc=1。
CN_EXTRA = {
    8004: {
        "code": "c8004", "zh": "婴宁", "en": "Yingning",
        "desc": "聊斋志异部队的情报员，和机械狐狸共感的少女。\n个性天真，像狐狸一样活泼好动。",
        "intro": "(＝｀ω´＝)～～狐狐大飞扑～～",
        "cv": "金元寿子",
    },
    8005: {
        "code": "c8005", "zh": "画皮", "en": "Huapi",
        "desc": "聊斋志异部队的主力，擅长完美伪装的秘密间谍。\n个性阴郁，没有伪装就不知道如何自处。",
        "intro": "私人账号，勿扰……工作交接请call内线",
        "cv": "大原沙耶香",
    },
}


def log(m):
    print(m, flush=True)


def find_locale_db(table):
    """在 decrypted/ 里定位包含指定表的库"""
    for f in sorted(glob.glob(os.path.join(DECRYPTED, "*.dec"))):
        try:
            con = sqlite3.connect("file:%s?mode=ro" % f.replace("\\", "/"), uri=True)
            hit = con.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)
            ).fetchone()
            if hit:
                return con
            con.close()
        except Exception:
            continue
    return None


def load_locale(con, table):
    """返回 {key: {lang: text}}"""
    cols = [d[1] for d in con.execute('PRAGMA table_info("%s")' % table)]
    use = [c for c in LANGS if c in cols]
    sel = ", ".join('"%s"' % c for c in use)
    out = {}
    for row in con.execute('SELECT Key, %s FROM "%s"' % (sel, table)):
        key = row[0]
        out[key] = {use[i]: row[i + 1] for i in range(len(use))}
    return out


def build_characters(con_target):
    src = find_locale_db("Locale_Character")
    if not src:
        log("! 找不到 Locale_Character")
        return
    data = load_locale(src, "Locale_Character")
    src.close()
    log(f"  Locale_Character：{len(data):,} 个 key")

    # 收集角色 ID
    ids = set()
    for key in data:
        m = re.match(r"^(\d+)_(name|intro|cv(?:_(?:ja|en|ko))?)$", key)
        if m:
            ids.add(int(m.group(1)))
    log(f"  角色 ID：{len(ids)} 个")

    con_target.execute("DELETE FROM character_entries")

    rows = []
    for cid in sorted(ids):
        if cid in DROP_IDS:
            continue

        def g(k, lang="zh-CN"):
            if cid in NAME_FIX and k == f"{cid}_name":
                return NAME_FIX[cid].get(lang) or NAME_FIX[cid].get("zh-CN")
            v = data.get(k)
            return (v or {}).get(lang) if v else None

        desc_key = "c%03d_description" % cid
        d = data.get(desc_key) or {}
        rows.append((
            cid,
            CODE_FIX.get(cid, "c%03d" % cid),
            g(f"{cid}_name"),
            g(f"{cid}_name", "en"),
            g(f"{cid}_name", "ja"),
            g(f"{cid}_name", "ko"),
            g(f"{cid}_name", "zh-TW"),
            d.get("zh-CN"),
            d.get("en"),
            d.get("ja"),
            g(f"{cid}_intro"),
            clean_cv(g(f"{cid}_cv_ja")),
            1 if d.get("zh-CN") else 0,
        ))

    have = {r[0] for r in rows}
    for cid, (code, zh, en) in EXTRA.items():
        if cid in have:
            continue
        rows.append((cid, code, zh, en, None, None, None,
                     None, None, None, None, None, 0))
    have = {r[0] for r in rows}
    for cid, e in CN_EXTRA.items():
        if cid in have:
            continue
        rows.append((cid, e["code"], e["zh"], e["en"], None, None, None,
                     e["desc"], None, None, e["intro"], e["cv"], 1))

    # 无独立声优的 NPC 角色卡沿用本体声优：桃乐丝：异端→桃乐丝，诺雅：新生→诺雅
    CV_INHERIT = {9200: 233, 9201: 232}
    idx = {r[0]: i for i, r in enumerate(rows)}
    for cid, base_id in CV_INHERIT.items():
        if cid in idx and base_id in idx:
            base = rows[idx[base_id]]
            r = rows[idx[cid]]
            rows[idx[cid]] = r[:11] + (base[11],) + r[12:]

    con_target.executemany(
        "INSERT OR REPLACE INTO character_entries"
        "(id, code, name_zh, name_en, name_ja, name_ko, name_tw,"
        " desc_zh, desc_en, desc_ja, intro_zh, cv, has_desc)"
        " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", rows,
    )
    con_target.commit()
    with_desc = sum(1 for r in rows if r[12])
    log(f"  写入角色 {len(rows)} 个（其中有介绍 {with_desc}）")


def build_skills(con_target):
    src = find_locale_db("Locale_Skill")
    if not src:
        log("! 找不到 Locale_Skill")
        return
    data = load_locale(src, "Locale_Skill")
    src.close()

    rows = []
    for key, langs in data.items():
        if key.startswith("skill_name"):
            kind = "kind_name"
        elif key.endswith("_add_des"):
            kind = "add_des"
        elif "description" in key:
            kind = "description"
        elif key.endswith("_name"):
            kind = "name"
        else:
            kind = "other"
        rows.append((
            key, kind,
            langs.get("zh-CN"), langs.get("en"), langs.get("ja"), langs.get("ko"),
        ))

    con_target.execute("DELETE FROM skill_strings")
    con_target.executemany(
        "INSERT OR REPLACE INTO skill_strings(key, kind, zh, en, ja, ko)"
        " VALUES(?,?,?,?,?,?)", rows,
    )
    con_target.commit()
    log(f"  Locale_Skill：{len(rows):,} 条写入")


def link_speakers(con):
    """把角色档案和剧情说话人按名字对上，顺带统计台词数"""
    con.execute("""
        UPDATE character_entries SET
          speaker_id = (
            SELECT c.speaker_id FROM characters c
            WHERE c.name_zh = character_entries.name_zh
            ORDER BY c.line_count DESC LIMIT 1
          )
    """)
    con.execute("""
        UPDATE character_entries SET
          line_count = COALESCE((
            SELECT c.line_count FROM characters c
            WHERE c.speaker_id = character_entries.speaker_id
          ), 0)
    """)
    con.commit()
    linked = con.execute(
        "SELECT COUNT(*) FROM character_entries WHERE speaker_id IS NOT NULL").fetchone()[0]
    log(f"  与剧情说话人对上 {linked} 个角色")


def main():
    if not os.path.exists(DB_PATH):
        log(f"! 数据库不存在，先跑 build_db.py：{DB_PATH}")
        sys.exit(1)

    t0 = time.time()
    log("[角色] 导入角色档案 …")
    con = sqlite3.connect(DB_PATH)
    build_characters(con)
    build_skills(con)
    link_speakers(con)

    log("\n" + "=" * 52)
    for name, desc, lines, sp in con.execute(
        "SELECT name_zh, desc_zh, line_count, speaker_id FROM character_entries"
        " WHERE has_desc=1 ORDER BY line_count DESC LIMIT 8"
    ):
        log(f"  {name:<8} {lines:>6,} 句  {(desc or '')[:38]}")
    log("=" * 52)
    log(f"耗时 {time.time()-t0:.1f}s")


if __name__ == "__main__":
    main()
