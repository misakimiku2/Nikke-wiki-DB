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

    # ---- 剧情 → 登场角色：按说话人归并出每个单元的角色卡清单 ----
    # 同一角色的剧情 speaker 有多个变体（mary/mary_s、sephie/sephie_op、sky_op*），
    # 在 characters 表里是同名的多行；按 name_zh 回链角色档案即可全部归并，
    # 精确对上 character_entries.speaker_id 的行优先（咨询/剧情两套 speaker 并存时）。
    # 指挥官(Self)、？？？这类没有角色卡的说话人 join 不上，自然排除。
    sp2char = {}
    for sp, eid in con.execute("""
        SELECT c.speaker_id, e.id
        FROM characters c
        JOIN character_entries e ON e.name_zh = c.name_zh
        ORDER BY (e.speaker_id = c.speaker_id) DESC, e.line_count DESC
    """):
        sp2char.setdefault(sp, eid)

    # ---- 主线角色身份差分 --------------------------------------------------
    # 剧情里同一角色会换多个身份，但原始 speaker 的 name_zh 多半还写着旧身份
    # （rapi_red 也写作「拉毗」），按名字 join 会把新旧身份并到同一张卡。
    # 这里按「speaker 变体 + 主线章节阶段」纠正，让过渡章能同时出现两版角色。
    # 角色 id 来自 character_entries：10 拉毗 / 16 拉毗:小红帽、90/93 艾玛、
    # 91/94 贝斯蒂、92/95 银华、100/103 拉普拉斯、101/104 德雷克、
    # 102/105 麦斯威尔、12/17 阿妮斯、11/18 尼恩、13/260/19 玛丽安三阶段。
    MARIAN_SPEAKERS = {
        "marian", "marian_p", "marian_q", "marian_queen", "marian_f", "marian_d", "modenia",
    }
    main_chapter = {}   # unit_id -> d_main_NN 的数字部分（0-based）
    for uid, bk in con.execute(
            "SELECT id, bucket FROM story_units WHERE category='main'"):
        m = re.match(r"d_main_(\d+)", bk or "")
        main_chapter[uid] = int(m.group(1)) if m else -1

    def main_identity(uid, sp):
        """主线的身份覆盖；None 表示沿用默认 name_zh 映射。"""
        n = main_chapter.get(uid, -1)
        if n < 0:
            return None
        sp = sp or ""
        # 玛丽安：坠落/侵蚀=玛丽安，中段=神罚，d_main_47 起=女王
        if sp in MARIAN_SPEAKERS:
            return 13 if n <= 1 else (19 if n >= 47 else 260)
        # 新身份 speaker 变体：变体本身即代表升级身份（过渡章可与旧版并存）
        if sp.startswith("rapi_red"):
            return 16
        if sp.startswith("anis_i"):
            return 17
        # 继承（d_main_34）起：战术升级三人组整体切换
        if n >= 34:
            if sp.startswith("emma"):
                return 93
            if sp.startswith("vesti"):
                return 94
            if sp.startswith("eunhwa"):
                return 95
        # 对话（d_main_35）起：三人组即使 speaker 仍是旧名也算升级身份
        if n >= 35:
            if sp.startswith("laplace"):
                return 103
            if sp.startswith("drake"):
                return 104
            if sp.startswith("maxwell"):
                return 105
        # 行动（d_main_44）起：白雪公主重型武装、红莲弑神、长发公主圣域
        if n >= 44:
            if sp.startswith("snowwhite"):
                return 471
            if sp.startswith("hongryeon"):
                return 472
            if sp.startswith("rapunzel"):
                return 473
            # 钥匙（d_main_43）之后：尼恩换成透视之眼
            if sp.startswith("neon"):
                return 18
        # 开战（d_main_47）之后：桃乐丝异端、诺雅新生
        if n >= 48:
            if sp.startswith("dorothy"):
                return 9200
            if sp.startswith("noah"):
                return 9201
        return None

    cast = defaultdict(lambda: defaultdict(int))   # unit_id -> char_id -> 台词行数
    for uid, sp in con.execute(
            "SELECT unit_id, speaker_id FROM story_lines WHERE speaker_id IS NOT NULL"):
        cid = main_identity(uid, sp)
        if cid is None:
            cid = sp2char.get(sp)
        if cid:
            cast[uid][cid] += 1

    # 钥匙章（d_main_43）：剧情里尼恩同时以「尼恩」和「尼恩：透视之眼」登场，
    # 但 speaker 全是 neon，数据无法区分；手动补一张升级身份卡，与基础版并存。
    for uid, n in main_chapter.items():
        if n == 43 and cast[uid].get(11):
            cast[uid][18] = max(cast[uid].get(18, 0), cast[uid][11])
    # 每个单元内按台词行数降序——话最多的排最前面
    dump("story_cast.json", {
        "total": len(cast),
        "units": {str(uid): [cid for cid, _ in sorted(v.items(), key=lambda x: -x[1])]
                  for uid, v in cast.items()},
    })

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
