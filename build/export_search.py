#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
全文搜索索引导出

527K 条台词压成 [文本, 单元ID, 说话人] 的紧凑数组，gzip 后约 7 MB，
前端懒加载后在内存里做子串匹配，不需要后端。

  python build/export_search.py
"""
import json
import os
import sqlite3
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, "data", "nikke.db")
OUT = os.path.join(ROOT, "public", "data", "search-index.json")


def main():
    con = sqlite3.connect(DB)
    # 排序必须和 export_story.py 完全一致（unit -> segment.sort_order -> line.seq），
    # 否则前端按行号定位会错位
    rows = con.execute("""
        SELECT l.text_zh, l.unit_id, l.speaker
        FROM story_lines l
        JOIN story_segments s ON s.id = l.segment_id
        WHERE l.text_zh IS NOT NULL AND l.text_zh <> ''
        ORDER BY l.unit_id, s.sort_order, l.seq
    """).fetchall()

    # [文本, 单元ID, 说话人, 单元内行号]
    payload = []
    last_unit = None
    idx = -1
    for t, u, s in rows:
        if u != last_unit:
            last_unit = u
            idx = 0
        else:
            idx += 1
        payload.append([t, u, s or "", idx])

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    size = os.path.getsize(OUT)
    print(f"索引 {len(payload):,} 条，{size/1048576:.1f} MB（gzip 后约 {size*0.3/1048576:.1f} MB）")
    print(f"输出 {OUT}")


if __name__ == "__main__":
    main()
