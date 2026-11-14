#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数据完整性对账

在每次重新提取数据后跑一遍，确认没有回退。
  python build/verify.py
"""
import os
import sqlite3
import sys
import time

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, "data", "nikke.db")

# 基准线：(说明, SQL, 期望最小值)
CHECKS = [
    ("主线章数",        "SELECT COUNT(*) FROM story_units WHERE category='main'", 50),
    ("主线台词",        "SELECT SUM(line_count) FROM story_units WHERE category='main'", 66000),
    ("总台词",          "SELECT COUNT(*) FROM story_lines", 500000),
    ("有名字台词",      "SELECT COUNT(*) FROM story_lines WHERE speaker IS NOT NULL AND speaker<>''", 290000),
    ("剧情单元",        "SELECT COUNT(*) FROM story_units", 840),
    ("剧情段落",        "SELECT COUNT(*) FROM story_segments", 10800),
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

    if issues:
        print("  ! 发现一致性问题：")
        for i in issues:
            print(f"    - {i}")
    else:
        print("  ✓ 一致性检查全部通过")

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
