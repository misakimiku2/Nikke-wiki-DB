#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CG 画廊数据导出

  public/data/cg_index.json
    items : 1347 张插画（hash / 分类 / 尺寸 / 关联数）
    links : cg 名 -> [{u:单元ID, i:定位行号, s:说话人, t:台词, n:段落行数, p:段落标题}]
            每条链接代表「CG 出现在该段落」；CSV 行级链接定位到精确行，
            脚本表/推断链接定位到段落首行。同段落多行合并为一条。

  python build/export_cg.py
"""
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
MANIFEST = os.path.join(ROOT, "public", "manifest.json")
OUT = os.path.join(ROOT, "public", "data", "cg_index.json")


def main():
    con = sqlite3.connect(DB)

    # ---- 段落元信息：segment_id -> (unit_id, 标题, 行数, 单元内起始行号) ----
    # 排序必须与 export_story.py 的分片结构一致（unit -> seg.sort_order -> seq）
    seg_rows = con.execute("""
        SELECT s.id, s.unit_id, s.title, s.part,
               (SELECT COUNT(*) FROM story_lines l WHERE l.segment_id = s.id)
        FROM story_segments s ORDER BY s.unit_id, s.sort_order
    """).fetchall()
    counter = defaultdict(int)   # unit_id -> 累计行号
    seg_meta = {}                # sid -> (uid, title, lcount, base)
    for (sid, uid, stitle, spart, lcount) in seg_rows:
        if not lcount:
            continue
        seg_meta[sid] = (uid, stitle or spart or "", lcount, counter[uid])
        counter[uid] += lcount

    # ---- 行 -> 段内偏移；段落首句 ----
    seg_lines = defaultdict(list)
    for lid, sid in con.execute(
            "SELECT id, segment_id FROM story_lines ORDER BY segment_id, seq"):
        seg_lines[sid].append(lid)
    line_pos = {}
    for sid, lids in seg_lines.items():
        for off, lid in enumerate(lids):
            line_pos[lid] = off

    first_line = {}
    for sid, sp, txt in con.execute("""
        SELECT segment_id, speaker, text_zh FROM story_lines
        WHERE text_zh IS NOT NULL AND text_zh <> ''
        ORDER BY segment_id, seq
    """):
        if sid not in first_line:
            first_line[sid] = (sp or "", txt)

    # ---- CG -> 段落（同段落多行合并，保留最靠上的触发点）----
    links = defaultdict(dict)    # cg -> {sid: (off, speaker, text)}
    for cg, lid, sid in con.execute("""
        SELECT c.cg_name, c.line_id, l.segment_id FROM cg_links c
        JOIN story_lines l ON l.id = c.line_id
        ORDER BY c.rowid
    """):
        meta = seg_meta.get(sid)
        if meta is None:
            continue
        off = line_pos.get(lid, 0)
        d = links[cg]
        if sid not in d or off < d[sid][0]:
            sp, txt = first_line.get(sid, ("", ""))
            d[sid] = (off, sp, txt)

    out_links = {}
    n_entries = 0
    for cg, segs in links.items():
        lst = []
        for sid, (off, sp, txt) in sorted(segs.items(), key=lambda x: seg_meta[x[0]][3]):
            uid, stitle, lcount, base = seg_meta[sid]
            lst.append({
                "u": uid,
                "i": base + off,          # 定位行号（单元内绝对行）
                "s": sp,
                "t": (txt or "")[:120],
                "n": lcount,              # 段落行数
                "p": stitle,              # 段落标题
            })
        out_links[cg] = lst
        n_entries += len(lst)
    print(f"有关联的 CG：{len(out_links)} 个，段落条目 {n_entries} 条")

    manifest = json.load(open(MANIFEST, encoding="utf-8"))
    covers = {n for (n,) in con.execute("SELECT name FROM cg_assets WHERE is_cover=1")}
    # d=1 表示「有实时 Spine 模型」。以前靠 public/dyn/*.webp 是否存在来判定，
    # 现在合成动图已经下线（质量不如实时模型且占 1.7GB），改由模型清单判定。
    spine_path = os.path.join(ROOT, "public", "data", "spine_models.json")
    spine_models: set[str] = set()
    if os.path.exists(spine_path):
        with open(spine_path, encoding="utf-8") as f:
            spine_models = set(json.load(f).get("items", []))
    # 角色大招 cut-in：EventScene_c010_00_skillcut -> 拉毗（用角色表把 c0xx 换成中文名）
    code2name = {}
    try:
        code2name = {c: n for c, n in con.execute(
            "SELECT code, name_zh FROM character_entries"
            " WHERE code IS NOT NULL AND name_zh IS NOT NULL")}
    except Exception:
        pass
    cutin_re = re.compile(r"^EventScene_(c\d+)_\d+_skillcut$")
    # Spine 图集的附加层（_atlas_add/_atlas_blen…）是零件贴图，不是能看的图
    junk_re = re.compile(r"_atlas(_(add|blen|mul|screen|mask|shot))?$", re.I)
    items = []
    for it in manifest["items"]:
        if not it.get("variants"):
            continue
        if junk_re.search(it["name"]):
            continue
        m = cutin_re.match(it["name"])
        sub = code2name.get(m.group(1), "") if m else it["sub"]
        item = {
            "h": it["hash"],
            "n": it["name"],
            "c": it["category"],
            "s": sub,
            "w": it.get("w") or 0,
            "h2": it.get("h") or 0,
            "l": len(out_links.get(it["name"], [])),
        }
        if it["name"] in covers:
            item["k"] = 1          # k=1：人工标注为活动封面/主视觉，不是剧情 CG
        if it["name"] in spine_models:
            item["d"] = 1          # d=1：有实时 Spine 模型（图鉴里可直接播放）
        items.append(item)

    payload = {
        "total": len(items),
        "items": items,
        "links": out_links,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    size = os.path.getsize(OUT)
    cats = defaultdict(int)
    for i in items:
        cats[i["c"]] += 1
    print(f"\n输出 {OUT}  {size/1024:.0f} KB")
    for c, n in sorted(cats.items()):
        print(f"  {c:<16} {n:>5}")
    linked = sum(1 for i in items if i["l"] > 0)
    print(f"  有剧情关联 {linked} / {len(items)}")
    print(f"  标注为封面/主视觉 {sum(1 for i in items if i.get('k'))} 张")


if __name__ == "__main__":
    main()
