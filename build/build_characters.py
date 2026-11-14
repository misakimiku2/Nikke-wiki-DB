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
        m = re.match(r"^(\d+)_(name|intro|cv)$", key)
        if m:
            ids.add(int(m.group(1)))
    log(f"  角色 ID：{len(ids)} 个")

    con_target.execute("DELETE FROM character_entries")

    rows = []
    for cid in sorted(ids):
        def g(k, lang="zh-CN"):
            v = data.get(k)
            return (v or {}).get(lang) if v else None

        desc_key = "c%03d_description" % cid
        d = data.get(desc_key) or {}
        rows.append((
            cid,
            "c%03d" % cid,
            g(f"{cid}_name"),
            g(f"{cid}_name", "en"),
            g(f"{cid}_name", "ja"),
            g(f"{cid}_name", "ko"),
            g(f"{cid}_name", "zh-TW"),
            d.get("zh-CN"),
            d.get("en"),
            d.get("ja"),
            g(f"{cid}_intro"),
            g(f"{cid}_cv"),
            1 if d.get("zh-CN") else 0,
        ))

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
