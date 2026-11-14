#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
剧情分片导出

每个剧情单元导出一个 JSON，前端点进去才加载，避免首屏拖几百 MB。
CG 以「第几行切到哪张图」的事件形式输出，阅读器据此按行显示，
不再「一个段落一张图撑到底」。

  python build/export_story.py
输出 public/data/story/{unit_id}.json
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
OUT = os.path.join(ROOT, "public", "data", "story")


def main():
    con = sqlite3.connect(DB)
    os.makedirs(OUT, exist_ok=True)
    # 清掉旧分片，避免单元消失后留垃圾
    for f in os.listdir(OUT):
        if f.endswith(".json"):
            os.remove(os.path.join(OUT, f))

    # cg_name -> webp hash（阅读器直接显示用），与 export_cg.py 同源走 manifest.json
    man_path = os.path.join(ROOT, "public", "manifest.json")
    cg_hash = {}
    if os.path.exists(man_path):
        with open(man_path, encoding="utf-8") as f:
            for it in json.load(f).get("items", []):
                cg_hash[it["name"]] = it["hash"]

    # 动态 CG 不再引用离线合成的动画 WebP，改由实时模型清单判定。
    spine_path = os.path.join(ROOT, "public", "data", "spine_models.json")
    spine_models: set[str] = set()
    if os.path.exists(spine_path):
        with open(spine_path, encoding="utf-8") as f:
            spine_models = set(json.load(f).get("items", []))

    def cg_ref(name):
        """CG 名 -> 前端引用；同名的 bg/前景两层都会各自成项，由阅读器合帧。"""
        h = cg_hash.get(name)
        if not h:
            return None
        item = {"h": h, "n": name}
        if name in spine_models:
            item["d"] = name      # 有实时 Spine 模型，阅读器背景直接播模型
        return item

    # 好感剧情/咨询的友好标题：char_stories.json（export_char_stories.py 产出）
    # 里有 unit → 角色条目映射；没有它就退回原始 bucket（不影响其他分类）。
    title_fix = {}
    cs_path = os.path.join(ROOT, "public", "data", "char_stories.json")
    ch_path = os.path.join(ROOT, "public", "data", "characters.json")
    if os.path.exists(cs_path) and os.path.exists(ch_path):
        with open(cs_path, encoding="utf-8") as f:
            cs = json.load(f).get("items", {})
        with open(ch_path, encoding="utf-8") as f:
            zh_of = {c["id"]: c["name"] for c in json.load(f).get("items", [])}
        for cid_s, entry in cs.items():
            zh = zh_of.get(int(cid_s))
            if not zh:
                continue
            for r in entry.get("stories", []) + entry.get("counsel", []):
                title_fix[r["id"]] = f"{zh}·{r['t']}"

    # 好感剧情/咨询的友好标题：char_stories.json（export_char_stories.py 产出）
    # 里有 unit → 角色条目映射；没有它就退回原始 bucket（不影响其他分类）。
    title_fix = {}
    cs_path = os.path.join(ROOT, "public", "data", "char_stories.json")
    ch_path = os.path.join(ROOT, "public", "data", "characters.json")
    if os.path.exists(cs_path) and os.path.exists(ch_path):
        with open(cs_path, encoding="utf-8") as f:
            cs = json.load(f).get("items", {})
        with open(ch_path, encoding="utf-8") as f:
            zh_of = {c["id"]: c["name"] for c in json.load(f).get("items", [])}
        for cid_s, entry in cs.items():
            zh = zh_of.get(int(cid_s))
            if not zh:
                continue
            for r in entry.get("stories", []) + entry.get("counsel", []):
                title_fix[r["id"]] = f"{zh}·{r['t']}"

    # (segment_id, line_id) -> [cg_name, ...]，同一行同时出主帧与 _bg 时两件都在
    cg_by_line = defaultdict(list)
    for seg_id, line_id, name in con.execute(
            "SELECT l.segment_id, l.id, c.cg_name FROM cg_links c"
            " JOIN story_lines l ON l.id = c.line_id"
            " ORDER BY l.segment_id, l.seq, c.rowid"):
        cg_by_line[(seg_id, line_id)].append(name)

    units = con.execute(
        "SELECT id, category, category_label, bucket, title, chapter_no,"
        " segment_count, line_count, source FROM story_units ORDER BY sort_order"
    ).fetchall()

    total_bytes = 0
    total_lines = 0
    total_events = 0
    for (uid, cat, label, bucket, title, ch, segs, lines, source) in units:
        seg_rows = con.execute(
            "SELECT id, group_key, title, part, line_count FROM story_segments"
            " WHERE unit_id=? ORDER BY sort_order", (uid,)
        ).fetchall()

        payload_segs = []
        for (sid, group_key, stitle, part, lcount) in seg_rows:
            if not lcount:
                continue
            ls = con.execute(
                "SELECT id, speaker, speaker_id, text_zh FROM story_lines"
                " WHERE segment_id=? ORDER BY seq", (sid,)
            ).fetchall()
            # 段内 CG 事件：[行下标, [CG 引用, ...]]，主帧在前、_bg 在前景之后
            events = []
            for idx, (lid, _sp, _spid, _txt) in enumerate(ls):
                refs = [r for r in (cg_ref(n) for n in cg_by_line.get((sid, lid), [])) if r]
                if not refs:
                    continue
                refs.sort(key=lambda x: x["n"].endswith("_bg"))
                events.append([idx, refs])
            payload_segs.append({
                "g": group_key,
                "t": stitle or part or "",
                "l": [[sp or "", spid or "", txt or ""] for _lid, sp, spid, txt in ls],
                "e": events,
            })
            total_events += len(events)

        if not payload_segs:
            continue

        # 个人剧情/咨询单元的 title 在库里就是 bucket 原文，换成友好标题
        if title == bucket or not title:
            if uid in title_fix:
                title = title_fix[uid]
            elif cat == "counseling" and payload_segs and payload_segs[0]["t"]:
                title = re.sub(r"：\d+$", "", payload_segs[0]["t"])

        payload = {
            "id": uid,
            "cat": cat,
            "label": label,
            "bucket": bucket,
            "title": title or bucket,
            "chapter": ch,
            "source": source,
            "segments": payload_segs,
        }
        path = os.path.join(OUT, f"{uid}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        total_bytes += os.path.getsize(path)
        total_lines += sum(len(s["l"]) for s in payload_segs)

    n = len([f for f in os.listdir(OUT) if f.endswith(".json")])
    print(f"导出 {n} 个剧情分片，{total_lines:,} 条台词，{total_events:,} 处 CG 切换，"
          f"合计 {total_bytes/1048576:.1f} MB")
    sizes = sorted((os.path.getsize(os.path.join(OUT, f)), f) for f in os.listdir(OUT) if f.endswith(".json"))
    if sizes:
        print(f"  最小 {sizes[0][0]/1024:.0f} KB ({sizes[0][1]})")
        print(f"  最大 {sizes[-1][0]/1024:.0f} KB ({sizes[-1][1]})")
        print(f"  中位 {sizes[len(sizes)//2][0]/1024:.0f} KB")


if __name__ == "__main__":
    main()
