#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
全文搜索索引导出（四语分片）

48 万条台词按内容语言压成 [文本, 单元ID, 说话人, 单元内行号] 的紧凑数组，前端
懒加载后在内存里做子串匹配，不需要后端。

单文件 26+ MB 会超过托管平台的单文件上限，因此按 **连续 unit 区间** 拆成多个
分片输出 public/data/search/：manifest v2 按语言给出各自的分片清单
（zh 沿用旧的 0.json… 文件名，en/ko/ja 在同名子目录），前端读 manifest 后
按当前内容语言并行拉取、按序号拼接（见 web/src/pages/Search.tsx）。

各语言独立切分，但行号 idx 统一按 zh 的规范序号计（= 该行在 unit 内的序位）：
story_lines 的 zh 列全量非空，zh 分片本身就是全量行，en/ko/ja 缺译的行在各自
分片里跳过、不占行号，因此 ?line= 跳转在各语言间一致。

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

# 内容语言 → story_lines 的文本列（顺序即 manifest 输出顺序）
LANGS = ["zh", "en", "ko", "ja"]
TEXT_COL = {"zh": "text_zh", "en": "text_en", "ko": "text_ko", "ja": "text_ja"}


def shard_by_unit(payload, sizes):
    """按 unit 边界切分：同一个 unit 的所有行必须落在同一分片
    （行号是导出时按全量顺序累加的，跨片切割会让按 unit 区间取片的用法错位）。
    拼接顺序 = 分片序号顺序，拼回后与单文件时代逐行一致。"""
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
    return boundaries


def write_shards(lang, payload, sizes):
    """写出一种语言的分片，返回 manifest 的 shards 条目。
    zh 保持旧文件名（0.json …）；其他语言放同名子目录避免互相覆盖。"""
    subdir = "" if lang == "zh" else lang + "/"
    os.makedirs(os.path.join(OUT_DIR, lang), exist_ok=True)

    entries = []
    start = 0
    for n, end in enumerate(shard_by_unit(payload, sizes)):
        chunk = payload[start:end]
        fn = f"{subdir}{n}.json"
        with open(os.path.join(OUT_DIR, fn), "w", encoding="utf-8") as f:
            json.dump(chunk, f, ensure_ascii=False, separators=(",", ":"))
        entries.append({
            "file": fn,
            "rows": len(chunk),
            "unit_from": chunk[0][1],
            "unit_to": chunk[-1][1],
        })
        start = end
    return entries


def main():
    con = sqlite3.connect(DB)
    # 排序必须和 export_story.py 完全一致（unit -> segment.sort_order -> line.seq），
    # 否则前端按行号定位会错位
    rows = con.execute("""
        SELECT l.text_zh, l.text_en, l.text_ko, l.text_ja, l.unit_id, l.speaker
        FROM story_lines l
        JOIN story_segments s ON s.id = l.segment_id
        WHERE l.text_zh IS NOT NULL AND l.text_zh <> ''
        ORDER BY l.unit_id, s.sort_order, l.seq
    """).fetchall()

    # 各语言的 [文本, 单元ID, 说话人, 单元内行号]；
    # idx 按 zh 的规范序号计（zh 全量非空，即该行在 unit 内的序位），
    # 某语言缺译的行跳过、不占 idx，保证跨语言 ?line= 一致。
    payloads = {lang: [] for lang in LANGS}
    last_unit = None
    idx = -1
    for zh, en, ko, ja, u, s in rows:
        if u != last_unit:
            last_unit = u
            idx = 0
        else:
            idx += 1
        texts = {"zh": zh, "en": en, "ko": ko, "ja": ja}
        for lang in LANGS:
            t = texts[lang]
            if not t:
                continue
            payloads[lang].append([t, u, s or "", idx])

    os.makedirs(OUT_DIR, exist_ok=True)
    manifest = {"v": 2, "shards": {}}
    for lang in LANGS:
        payload = payloads[lang]
        sizes = [
            len(json.dumps(r, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) + 1
            for r in payload
        ]
        manifest["shards"][lang] = write_shards(lang, payload, sizes)
        total_mb = sum(sizes) / 1048576
        print(f"{lang}: {len(payload):,} 行  {total_mb:.1f} MB  拆 {len(manifest['shards'][lang])} 片")

    with open(os.path.join(OUT_DIR, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, separators=(",", ":"))

    for lang in LANGS:
        print(f"  {lang} 分片：")
        for s in manifest["shards"][lang]:
            p = os.path.join(OUT_DIR, s["file"])
            print(f"    {s['file']}  {os.path.getsize(p)/1048576:.1f} MB  {s['rows']:,} 行  unit {s['unit_from']}–{s['unit_to']}")
    print(f"输出 {OUT_DIR}")


if __name__ == "__main__":
    main()
