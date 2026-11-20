#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""动态 CG 的查看器背景 → 自动填充 build/spine_overrides.json。

上游 `CG索引/动态CG背景对照.csv`（export_bg_map.py 产出）对 118 个动态 CG 逐个
标注背景来源，「建议背景」列可直接映射到 spine_overrides.json 的 background 字段
（CG 查看器把它铺在实时模型下面；实时模型照常走 SpinePlayer 的背景层）。

规则：
  - 建议背景为空 / '-'（96 个模型自带 bg region 或 16 个纯透明底）→ 不动；
  - 已有手工 background 的条目不覆盖（人工标注优先，如 EventScene_Main_01_01）；
  - 其余按建议补全，comment 标注来源，重复运行幂等。

  python build/fill_spine_backgrounds.py
"""
import csv
import json
import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.environ.get("NIKKE_SRC", r"E:/test/nikke_extract")
CSV = os.path.join(SRC, "CG索引", "动态CG背景对照.csv")
OUT = os.path.join(ROOT, "build", "spine_overrides.json")
COMMENT = "background 自动填充：上游 CG索引/动态CG背景对照.csv 的「建议背景」列"


def main():
    rows = list(csv.DictReader(open(CSV, encoding="utf-8-sig")))
    with open(OUT, encoding="utf-8") as f:
        data = json.load(f)
    models = data.setdefault("models", {})

    added = kept = skipped = 0
    for r in rows:
        name = (r.get("动态CG") or "").strip()
        bg = (r.get("建议背景") or "").strip()
        if not name or not bg or bg == "-":
            skipped += 1
            continue
        entry = models.setdefault(name, {})
        if entry.get("background"):
            kept += 1          # 已有手工标注（或上次已填），人工优先不覆盖
            continue
        entry["background"] = bg
        if not entry.get("comment"):
            entry["comment"] = COMMENT
        added += 1

    text = json.dumps(data, ensure_ascii=False, indent=2)
    with open(OUT, "w", encoding="utf-8", newline="\r\n") as f:
        f.write(text)
    print(f"建议背景 {len(rows) - skipped} 条：新增 {added}，已有保留 {kept}，"
          f"无建议跳过 {skipped}")
    print(f"输出 {OUT}（models 共 {len(models)} 个）")
    if added:
        print("重新跑构建/部署后生效：vite 的 spineOverridesPlugin 会同步到 public/data/。")


if __name__ == "__main__":
    main()
