#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
全文搜索索引导出

527K 条台词压成 [文本, 单元ID, 说话人, 单元内行号] 的紧凑数组，前端懒加载后
在内存里做子串匹配，不需要后端。

单文件 26+ MB 会超过 Cloudflare Pages 的 25 MiB 单文件上限，因此按
**连续 unit 区间** 拆成多个分片输出 public/data/search/：
前端读 manifest.json 后并行拉取、按序号拼接（见 web/src/pages/Search.tsx）。

  python build/export_search.py
"""
import json
import os
import shutil
import sqlite3
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, "data", "nikke.db")
OUT_DIR = os.path.join(ROOT, "public", "data", "search")
OLD_OUT = os.path.join(ROOT, "public", "data", "search-index.json")
# 每片目标体积：总量 26 MB 左右时约出 4 片，远低于托管平台 25 MiB 单文件上限
TARGET_SHARD_MB = 6.5


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

    # 切分点只落在 unit 边界：同一个 unit 的所有行必须落在同一分片
    # （行号是导出时按全量顺序累加的，跨片切割会让按 unit 区间取片的用法错位）。
    # 拼接顺序 = 分片序号顺序，拼回后与单文件时代逐行一致。
    sizes = [
        len(json.dumps(r, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) + 1
        for r in payload
    ]
    total_bytes = sum(sizes)
    n_target = max(1, round(total_bytes / (TARGET_SHARD_MB * 1048576)))
    target = total_bytes / n_target

    boundaries = []  # 每片的结束行号（不含）
    acc = 0
    prev_unit = None
    for i, (r, sz) in enumerate(zip(payload, sizes)):
        if acc >= target and i > 0 and r[1] != prev_unit:
            boundaries.append(i)
            acc = 0
        acc += sz
        prev_unit = r[1]
    boundaries.append(len(payload))

    # 整个目录重写（清掉上次运行可能留下的多余分片），旧单文件不再生成
    shutil.rmtree(OUT_DIR, ignore_errors=True)
    os.makedirs(OUT_DIR, exist_ok=True)
    if os.path.exists(OLD_OUT):
        os.remove(OLD_OUT)

    manifest = {"total": len(payload), "shards": []}
    start = 0
    for n, end in enumerate(boundaries):
        chunk = payload[start:end]
        with open(os.path.join(OUT_DIR, f"{n}.json"), "w", encoding="utf-8") as f:
            json.dump(chunk, f, ensure_ascii=False, separators=(",", ":"))
        manifest["shards"].append({
            "file": f"{n}.json",
            "rows": len(chunk),
            "unit_from": chunk[0][1],
            "unit_to": chunk[-1][1],
        })
        start = end

    with open(os.path.join(OUT_DIR, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, separators=(",", ":"))

    print(f"索引 {len(payload):,} 条，共 {total_bytes/1048576:.1f} MB，拆 {len(boundaries)} 片：")
    for s in manifest["shards"]:
        p = os.path.join(OUT_DIR, s["file"])
        print(f"  {s['file']}  {os.path.getsize(p)/1048576:.1f} MB  {s['rows']:,} 行  unit {s['unit_from']}–{s['unit_to']}")
    print(f"输出 {OUT_DIR}")


if __name__ == "__main__":
    main()
