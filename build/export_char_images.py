#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
扫描 public/char 生成角色立绘清单

  python build/export_char_images.py
输出 public/data/char_images.json  {"10": ["c010_00", "c010_01"], ...}
"""
import json
import os
import re
import sys
from collections import defaultdict

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "public", "char")
OUT = os.path.join(ROOT, "public", "data", "char_images.json")


def main():
    if not os.path.isdir(SRC):
        print("! public/char 不存在，先跑 export_sd.py")
        return

    groups = defaultdict(list)
    for fn in os.listdir(SRC):
        if not fn.endswith(".webp"):
            continue
        stem = fn[:-5]
        m = re.match(r"^c(\d+)_(\d+)$", stem)
        if m:
            groups[int(m.group(1))].append(stem)

    # 按变体号排序
    for k in groups:
        groups[k].sort()

    payload = {str(k): sorted(v) for k, v in sorted(groups.items())}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    total = sum(len(v) for v in groups.values())
    multi = sum(1 for v in groups.values() if len(v) > 1)
    print(f"角色 {len(groups)} 个，立绘 {total} 张（{multi} 个角色有多套皮肤）")
    print(f"输出 {OUT}  {os.path.getsize(OUT)/1024:.0f} KB")


if __name__ == "__main__":
    main()
