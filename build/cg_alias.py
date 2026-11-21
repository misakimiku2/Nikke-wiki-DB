#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""CG 别名映射：剧情台词里的 CG 名 → 实际导出的图片文件名。

台词 token 与导出文件名有时不一致：
  * 大小写差异（EventScene_GoldenCoinRush_02 / EventScene_Goldencoinrush_02）
  * 差分后缀（EventScene_icedragonsaga_01_1 / EventScene_icedragonsaga_01）
上游建对照索引时已用 cg_refs.resolve_cg 的近似匹配把它们指向真实图片
（见 剧情CG对照索引.csv 的「静态图」列）；web 端按文件名精确匹配，
需要同一份映射才能让这些 CG 正常显示。

只有「静态图」列非空且文件名与 CG 名不同的行才产生别名；上游标记「缺失」
的行（如 oldtales 角色差分）没有图片，不产生别名。
"""
import csv
import os

SRC = os.environ.get("NIKKE_SRC", r"E:/test/nikke_extract")
INDEX_CSV = os.path.join(SRC, "CG索引", "剧情CG对照索引.csv")

# 角色差分 token → 基名。这类名字在对话表/ScenarioCameraSettingTable 里出现，
# 但游戏 bundle 里只有基名对应的 Texture2D/Sprite（已用 F:\NIKKE 的 catalog 与
# UnityPy 逐 bundle 核对）——它们是「基名 CG + 角色 id」的镜头/图层合成键，
# 不是独立插画。阅读器按基名显示整张图即可。
_CAMERA_COMPOSITES = {
    "EventScene_oldtales_03_1_cinderella": "EventScene_oldtales_03_1",
    "EventScene_oldtales_03_1_redshoes":   "EventScene_oldtales_03_1",
    "EventScene_oldtales_05_abe":          "EventScene_oldtales_05",
    "EventScene_oldtales_05_cinderella":   "EventScene_oldtales_05",
    "EventScene_oldtales_05_hansel":       "EventScene_oldtales_05",
    "EventScene_oldtales_05_redshoes":     "EventScene_oldtales_05",
}


def load_cg_aliases(src: str | None = None) -> dict[str, str]:
    """{台词 CG 名: 实际图片文件名}。读取失败时返回空表（不影响构建）。"""
    path = os.path.join(src or SRC, "CG索引", "剧情CG对照索引.csv")
    aliases: dict[str, str] = {}
    try:
        with open(path, encoding="utf-8-sig") as f:
            for r in csv.DictReader(f):
                cg = (r.get("CG名") or "").strip()
                img = (r.get("静态图") or "").strip()
                if not cg or not img:
                    continue
                base = os.path.splitext(os.path.basename(img.replace("\\", "/")))[0]
                if base and cg != base:
                    aliases.setdefault(cg, base)
    except (OSError, csv.Error):
        pass
    for cg, base in _CAMERA_COMPOSITES.items():
        aliases.setdefault(cg, base)
    return aliases


if __name__ == "__main__":
    a = load_cg_aliases()
    print(f"CG 别名 {len(a)} 条")
    for k, v in sorted(a.items()):
        print(f"  {k} -> {v}")
