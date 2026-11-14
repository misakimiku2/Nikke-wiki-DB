#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
导出前端消费的静态 JSON

  python build/export_web.py
输出到 public/data/
"""
import json
import os
import sqlite3
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, "data", "nikke.db")
OUT = os.path.join(ROOT, "public", "data")


def dump(name, payload):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    print(f"  {name:24} {os.path.getsize(path)/1024:>7.1f} KB")


def main():
    con = sqlite3.connect(DB)

    # ---- 角色 ----
    chars = []
    for (cid, code, zh, en, ja, ko, tw, desc, desc_en, intro, cv,
         lines, sp, has_desc) in con.execute("""
        SELECT id, code, name_zh, name_en, name_ja, name_ko, name_tw,
               desc_zh, desc_en, intro_zh, cv, line_count, speaker_id, has_desc
        FROM character_entries ORDER BY line_count DESC, id
    """):
        chars.append({
            "id": cid, "code": code,
            "name": zh or en or code,
            "names": {"zh": zh, "en": en, "ja": ja, "ko": ko, "tw": tw},
            "desc": desc, "descEn": desc_en,
            "intro": intro, "cv": cv,
            "lines": lines or 0,
            "speaker": sp,
            "hasDesc": bool(has_desc),
        })
    dump("characters.json", {
        "total": len(chars),
        "withDesc": sum(1 for c in chars if c["hasDesc"]),
        "items": chars,
    })

    # ---- 技能 ----
    skills = []
    for key, kind, zh, en, ja in con.execute(
            "SELECT key, kind, zh, en, ja FROM skill_strings"):
        skills.append({"key": key, "kind": kind, "zh": zh, "en": en, "ja": ja})
    dump("skills.json", {"total": len(skills), "items": skills})

    # ---- 剧情目录 ----
    units = []
    for (uid, cat, label, bucket, title, ch, segs, lines, source) in con.execute("""
        SELECT id, category, category_label, bucket, title, chapter_no,
               segment_count, line_count, source
        FROM story_units ORDER BY sort_order
    """):
        units.append({
            "id": uid, "cat": cat, "label": label, "bucket": bucket,
            "title": title, "chapter": ch, "segments": segs,
            "lines": lines or 0, "source": source,
        })
    dump("story_index.json", {"total": len(units), "items": units})

    # ---- 首页统计 ----
    stats = {
        "characters": con.execute("SELECT COUNT(*) FROM character_entries").fetchone()[0],
        "charactersWithDesc": con.execute(
            "SELECT COUNT(*) FROM character_entries WHERE has_desc=1").fetchone()[0],
        "lines": con.execute("SELECT COUNT(*) FROM story_lines").fetchone()[0],
        "units": con.execute("SELECT COUNT(*) FROM story_units").fetchone()[0],
        "segments": con.execute("SELECT COUNT(*) FROM story_segments").fetchone()[0],
        "cg": con.execute(
            "SELECT COUNT(*) FROM cg_assets WHERE is_spine_atlas=0").fetchone()[0],
        "cgLinked": con.execute(
            "SELECT COUNT(*) FROM cg_assets WHERE link_count>0").fetchone()[0],
        "animated": con.execute("SELECT COUNT(*) FROM cg_animations").fetchone()[0],
        "builtAt": con.execute(
            "SELECT value FROM meta WHERE key='built_at'").fetchone()[0],
    }
    dump("stats.json", stats)
    print("\n  统计：", stats)


if __name__ == "__main__":
    main()
