#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
导出前端消费的静态 JSON

  python build/export_web.py
输出到 public/data/
"""
import difflib
import json
import os
import re
import sqlite3
import sys
from collections import defaultdict

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

    # ---- 剧情卡封面：取该剧情里第一张静态 CG（跳过封面/纯背景图） ----
    cover_of = {}
    cg_items = []
    cg_path = os.path.join(OUT, "cg_index.json")
    if os.path.exists(cg_path):
        with open(cg_path, encoding="utf-8") as f:
            cg = json.load(f)
        cg_items = [it for it in cg.get("items", []) if not it["n"].endswith("_bg")]
        meta = {it["n"]: it for it in cg.get("items", [])}
        cand = defaultdict(list)
        for name, links in cg.get("links", {}).items():
            it = meta.get(name)
            if not it:
                continue
            for link in links:
                cand[link["u"]].append({
                    "i": link.get("i", 0), "h": it["h"], "n": name,
                    "k": it.get("k", 0), "d": it.get("d", 0),
                    "bg": name.endswith("_bg"),
                })
        for uid, arr in cand.items():
            arr.sort(key=lambda x: (x["i"], x["n"]))

            def pick(pred):
                for c in arr:
                    if pred(c):
                        return c["h"]
                return None

            cover = (pick(lambda c: not c["bg"] and not c["k"] and not c["d"])
                     or pick(lambda c: not c["bg"] and not c["k"])
                     or pick(lambda c: not c["bg"])
                     or pick(lambda c: True))
            if cover:
                cover_of[uid] = cover

    def norm_name(s):
        s = (s or "").lower()
        s = re.sub(r"^event_", "", s)
        s = re.sub(r"^d_(main|nikke|counseling|contents|ex)_", "", s)
        s = re.sub(r"eventscene", "", s)
        s = re.sub(r"[_\-.\s]+", "", s)
        s = re.sub(r"\d+", "", s)
        return s

    match_cache = {}

    def match_cover(bucket, title):
        """没有行级 CG 链接时，按活动名/CG 名做一次模糊匹配。"""
        key = norm_name(bucket)
        if len(key) < 3:
            key = norm_name(title)
        if len(key) < 3:
            return None
        if key in match_cache:
            return match_cache[key]
        best = best_k = None
        best_r = best_kr = 0.0
        for it in cg_items:
            nk = norm_name(it["n"])
            if not nk:
                continue
            r = difflib.SequenceMatcher(None, key, nk).ratio()
            if it.get("k"):
                if r > best_kr:
                    best_kr, best_k = r, it
            elif r > best_r:
                best_r, best = r, it
        val = None
        if best and best_r >= 0.80:
            val = best["h"]
        elif best_k and best_kr >= 0.95:
            val = best_k["h"]  # 只有活动主视觉时，名字完全对上才用
        match_cache[key] = val
        return val

    # ---- 剧情目录 ----
    units = []
    for (uid, cat, label, bucket, title, ch, segs, lines, source) in con.execute("""
        SELECT id, category, category_label, bucket, title, chapter_no,
               segment_count, line_count, source
        FROM story_units ORDER BY sort_order
    """):
        # 咨询对话已经集成到角色详情页底部，剧情目录里不再单独列一栏
        if cat == "counseling":
            continue
        # 没有任何章节/台词的空单元（补充文本里的一批占位）不进目录
        if not segs or not lines:
            continue
        cover = cover_of.get(uid) or match_cover(bucket, title)
        units.append({
            "id": uid, "cat": cat, "label": label, "bucket": bucket,
            "title": title, "chapter": ch, "segments": segs,
            "lines": lines or 0, "source": source, "cover": cover,
        })

    # 主线个别章节脚本里没有 CG（第1/5/18/25章），借相邻章节封面兜底
    for i, u in enumerate(units):
        if u["cat"] != "main" or u.get("cover"):
            continue
        for j in range(i - 1, -1, -1):
            if units[j]["cat"] == "main" and units[j].get("cover"):
                u["cover"] = units[j]["cover"]
                break
        if not u.get("cover"):
            for j in range(i + 1, len(units)):
                if units[j]["cat"] == "main" and units[j].get("cover"):
                    u["cover"] = units[j]["cover"]
                    break

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
