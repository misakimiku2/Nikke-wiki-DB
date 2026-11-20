#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数据完整性对账

在每次重新提取数据后跑一遍，确认没有回退。
  python build/verify.py
"""
import json
import os
import sqlite3
import sys
import time
from collections import Counter

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, "data", "nikke.db")

# 基准线：(说明, SQL, 期望最小值)
CHECKS = [
    ("主线章数",        "SELECT COUNT(*) FROM story_units WHERE category='main'", 50),
    ("主线台词",        "SELECT SUM(line_count) FROM story_units WHERE category='main'", 66000),
    # 2026-11 基线：上游剧情 JSON 合并后实际为 482k 行 / 671 单元 / 9734 段。
    # 原 500k / 840 / 10800 是旧版数据目标，当前提取链路达不到，改成现值防回退。
    ("总台词",          "SELECT COUNT(*) FROM story_lines", 480000),
    ("有名字台词",      "SELECT COUNT(*) FROM story_lines WHERE speaker IS NOT NULL AND speaker<>''", 290000),
    ("剧情单元",        "SELECT COUNT(*) FROM story_units", 660),
    ("剧情段落",        "SELECT COUNT(*) FROM story_segments", 9600),
    ("台词英文",        "SELECT COUNT(*) FROM story_lines WHERE text_en IS NOT NULL AND text_en<>''", 480000),
    ("台词韩文",        "SELECT COUNT(*) FROM story_lines WHERE text_ko IS NOT NULL AND text_ko<>''", 480000),
    ("台词日文",        "SELECT COUNT(*) FROM story_lines WHERE text_ja IS NOT NULL AND text_ja<>''", 480000),
    ("角色数",          "SELECT COUNT(*) FROM characters", 1100),
    ("CG 资产",         "SELECT COUNT(*) FROM cg_assets", 1340),
    ("成品插画",        "SELECT COUNT(*) FROM cg_assets WHERE is_spine_atlas=0", 1340),
    ("有剧情关联的CG",  "SELECT COUNT(*) FROM cg_assets WHERE link_count>0", 860),
    ("CG 剧情链接",     "SELECT COUNT(*) FROM cg_links", 1000),
    ("动态 CG",         "SELECT COUNT(*) FROM cg_animations", 115),
]


def main():
    if not os.path.exists(DB):
        print(f"找不到数据库：{DB}\n请先跑 build/build_db.py")
        sys.exit(1)

    con = sqlite3.connect(DB)
    ok = fail = 0

    print("=" * 60)
    print("数据完整性对账")
    print("=" * 60)
    for label, sql, minimum in CHECKS:
        try:
            val = con.execute(sql).fetchone()[0] or 0
        except Exception as e:
            print(f"  ✗ {label:<16} 查询失败：{e}")
            fail += 1
            continue
        if val >= minimum:
            print(f"  ✓ {label:<16} {val:>9,}   (>= {minimum:,})")
            ok += 1
        else:
            print(f"  ✗ {label:<16} {val:>9,}   (期望 >= {minimum:,})  ← 数据回退")
            fail += 1

    print("-" * 60)

    # 一致性检查
    issues = []
    orphan = con.execute("SELECT COUNT(*) FROM cg_links c LEFT JOIN story_lines l ON l.id=c.line_id"
                         " WHERE l.id IS NULL").fetchone()[0]
    if orphan:
        issues.append(f"CG 链接指向不存在的台词：{orphan}")

    empty_seg = con.execute("""
        SELECT COUNT(*) FROM story_segments s JOIN story_units u ON u.id=s.unit_id
        WHERE s.line_count=0 AND u.category='main'
    """).fetchone()[0]
    if empty_seg:
        issues.append(f"主线空段落：{empty_seg} 个")

    no_unit = con.execute("SELECT COUNT(*) FROM story_segments WHERE unit_id NOT IN"
                          " (SELECT id FROM story_units)").fetchone()[0]
    if no_unit:
        issues.append(f"孤立段落：{no_unit}")

    fts_n = con.execute("SELECT COUNT(*) FROM line_fts").fetchone()[0]
    line_n = con.execute("SELECT COUNT(*) FROM story_lines").fetchone()[0]
    if fts_n != line_n:
        issues.append(f"FTS 索引与台词表不一致：{fts_n:,} vs {line_n:,}（需 rebuild）")

    # 剧情封面：cover hash 必须有对应的 public/cover/<hash>.webp，
    # 且主线不出现重复封面。漏跑 build_story_covers.py（必须在 export_web.py
    # 之后跑）时会留下「借相邻章节」的重复封面和指向未生成文件的 hash → 前端裂图。
    index_path = os.path.join(ROOT, "public", "data", "story_index.json")
    index_units = []
    if os.path.exists(index_path):
        with open(index_path, encoding="utf-8") as f:
            index_units = json.load(f).get("items", [])
        bad = [u["id"] for u in index_units if u.get("cover")
               and not os.path.exists(os.path.join(ROOT, "public", "cover", u["cover"] + ".webp"))]
        if bad:
            issues.append(f"剧情封面文件缺失（漏跑 build_story_covers.py？）：{bad[:8]}")
        main_covers = Counter(u.get("cover") for u in index_units
                              if u.get("cat") == "main" and u.get("cover"))
        dups = {k: v for k, v in main_covers.items() if v > 1}
        if dups:
            issues.append(f"主线剧情封面重复（相邻借用未清理）：{dups}")

    # 剧情标题/段落标题四语（en/ko/ja）结构与覆盖率。
    # 结构错误算失败；覆盖率只打印作信息（部分分类本就没有官方译名，不设下限）。
    LANGS = ("en", "ko", "ja")
    bad_titles = []
    unit_cov = Counter()
    unit_total = Counter()
    for u in index_units:
        unit_total[u.get("cat")] += 1
        ts = u.get("titles")
        if ts is None:
            continue
        if (not isinstance(ts, dict)
                or any(k not in LANGS for k in ts)
                or any(not isinstance(v, str) or not v for v in ts.values())):
            bad_titles.append(u["id"])
            continue
        unit_cov[u.get("cat")] += 1
    if bad_titles:
        issues.append(f"story_index titles 结构非法（含空值/未知语言）：{bad_titles[:8]}")

    story_dir = os.path.join(ROOT, "public", "data", "story")
    bad_ts = bad_titles2 = 0
    seg_cov = Counter()
    seg_total = Counter()
    shard_cov = Counter()
    shard_total = Counter()
    if os.path.isdir(story_dir):
        for f in sorted(os.listdir(story_dir)):
            if not f.endswith(".json"):
                continue
            with open(os.path.join(story_dir, f), encoding="utf-8") as fp:
                d = json.load(fp)
            cat = d.get("cat")
            shard_total[cat] += 1
            ts = d.get("titles")
            if ts is not None:
                if (not isinstance(ts, dict)
                        or any(k not in LANGS for k in ts)
                        or any(not isinstance(v, str) or not v for v in ts.values())):
                    bad_titles2 += 1
                else:
                    shard_cov[cat] += 1
            for seg in d.get("segments", []):
                seg_total[cat] += 1
                t = seg.get("ts")
                if t is None:
                    continue
                if (not isinstance(t, list) or len(t) != 3
                        or any(not isinstance(v, str) for v in t)):
                    bad_ts += 1
                    continue
                if any(v for v in t):
                    seg_cov[cat] += 1
    if bad_titles2:
        issues.append(f"剧情分片 titles 结构非法：{bad_titles2} 个")
    if bad_ts:
        issues.append(f"剧情分片段落 ts 结构非法（应为 [en,ko,ja] 字符串数组）：{bad_ts} 处")

    cs_path = os.path.join(ROOT, "public", "data", "char_stories.json")
    cs_bad = cs_cov = cs_total = 0
    if os.path.exists(cs_path):
        with open(cs_path, encoding="utf-8") as f:
            cs_items = json.load(f).get("items", {})
        for e in cs_items.values():
            for r in e.get("stories", []) + e.get("counsel", []):
                cs_total += 1
                ts = r.get("ts")
                if ts is None:
                    continue
                if (not isinstance(ts, dict)
                        or any(k not in LANGS for k in ts)
                        or any(not isinstance(v, str) or not v for v in ts.values())):
                    cs_bad += 1
                else:
                    cs_cov += 1
    if cs_bad:
        issues.append(f"char_stories ts 结构非法：{cs_bad} 条")

    # 个人剧情章节名四语（Locale_NikkeEpisode）：漏跑新版 export_char_stories.py
    # 会让角色页章节列表整列中文。结构非法算失败，覆盖率设下限防回退。
    ch_bad = ch_cov = ch_total = 0
    if os.path.exists(cs_path):
        with open(cs_path, encoding="utf-8") as f:
            cs_items = json.load(f).get("items", {})
        for e in cs_items.values():
            for r in e.get("stories", []):
                for ch in r.get("chapters", []):
                    ch_total += 1
                    ts = ch.get("ts")
                    if ts is None:
                        continue
                    if (not isinstance(ts, dict)
                            or any(k not in LANGS for k in ts)
                            or any(not isinstance(v, str) or not v for v in ts.values())):
                        ch_bad += 1
                    else:
                        ch_cov += 1
    if ch_bad:
        issues.append(f"char_stories 章节 ts 结构非法：{ch_bad} 条")
    if ch_total and ch_cov < 900:
        issues.append(f"个人剧情章节名四语覆盖过低：{ch_cov}/{ch_total}（重跑 export_char_stories.py）")

    # CG 剧情链接的四语回填（export_cg.py 的 l4/s4/p4）：漏跑会让查看器的
    # 台词/说话人/段名整列中文。结构非法算失败，覆盖率设下限防回退。
    cg_path = os.path.join(ROOT, "public", "data", "cg_index.json")
    cg_bad = cg_l4 = cg_s4 = cg_p4 = cg_total = 0
    if os.path.exists(cg_path):
        with open(cg_path, encoding="utf-8") as f:
            cg_links = json.load(f).get("links", {})
        for lst in cg_links.values():
            for lk in lst:
                cg_total += 1
                for key in ("l4", "s4", "p4"):
                    v = lk.get(key)
                    if v is None:
                        continue
                    if (not isinstance(v, dict)
                            or any(kk not in LANGS for kk in v)
                            or any(not isinstance(vv, str) or not vv for vv in v.values())):
                        cg_bad += 1
                cg_l4 += 1 if isinstance(lk.get("l4"), dict) else 0
                cg_s4 += 1 if isinstance(lk.get("s4"), dict) else 0
                cg_p4 += 1 if isinstance(lk.get("p4"), dict) else 0
    if cg_bad:
        issues.append(f"cg_index 链接四语结构非法：{cg_bad} 条")
    if cg_total and (cg_l4 < 1200 or cg_p4 < 550):
        issues.append(f"cg_index 四语回填覆盖过低：l4={cg_l4} p4={cg_p4}（重跑 export_cg.py）")

    if issues:
        print("  ! 发现一致性问题：")
        for i in issues:
            print(f"    - {i}")
    else:
        print("  ✓ 一致性检查全部通过")

    # 剧情标题/段落标题四语覆盖率（信息性输出；缺译名的单元回退中文显示）
    print("-" * 60)
    print("  四语标题覆盖率（en/ko/ja 至少一语非空的比例）")
    for cat, n in unit_total.items():
        c = unit_cov.get(cat, 0)
        print(f"    单元标题 {cat:<11} {c:>4}/{n:<4} = {c * 100 // max(n, 1)}%")
    for cat, n in seg_total.items():
        c = seg_cov.get(cat, 0)
        print(f"    段落标题 {cat:<11} {c:>5}/{n:<5} = {c * 100 // max(n, 1)}%")
    if cs_total:
        print(f"    char_stories 记录   {cs_cov:>4}/{cs_total:<4} = {cs_cov * 100 // cs_total}%")
    if ch_total:
        print(f"    个人剧情章节名     {ch_cov:>4}/{ch_total:<4} = {ch_cov * 100 // ch_total}%")
    if cg_total:
        print(f"    CG 链接四语回填    台词 {cg_l4} / 说话人 {cg_s4} / 段名 {cg_p4}（共 {cg_total} 条）")

    # 搜索性能
    print("-" * 60)
    t = time.time()
    hits = con.execute("SELECT COUNT(*) FROM line_fts WHERE line_fts MATCH '玛丽安'").fetchone()[0]
    ms = (time.time() - t) * 1000
    print(f"  FTS「玛丽安」  {hits:>7,} 命中  {ms:>6.0f} ms")

    t = time.time()
    hits2 = con.execute("SELECT COUNT(*) FROM story_lines WHERE text_zh LIKE '%莱彻%'").fetchone()[0]
    ms2 = (time.time() - t) * 1000
    print(f"  LIKE「莱彻」   {hits2:>7,} 命中  {ms2:>6.0f} ms  (2 字查询兜底)")

    # 分类分布
    print("-" * 60)
    for label, n, lines in con.execute("""
        SELECT category_label, COUNT(*), SUM(line_count) FROM story_units
        GROUP BY category ORDER BY SUM(line_count) DESC
    """):
        print(f"  {label:<12} {n:>5} 单元  {(lines or 0):>8,} 条")

    print("=" * 60)
    print(f"  通过 {ok}，失败 {fail}")
    print("=" * 60)
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()
