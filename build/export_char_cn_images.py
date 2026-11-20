#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
国服专属内容的立绘 / 头像入站

数据源：nikke_extract/staging/cn_icons/（export_char_cn.py --kinds icons 的产物）
  <code>.png        全身立绘（icons-char-full 同源，2048²，画布带留白）
  mi_<code>_s.png   官方头像（icons-char-mi 同源，256×512 透明底）

输出（与 export_sd.py / export_char_mi.py 的常规产物同形态）：
  public/char/<code>.png       1024²（2048→1024 LANCZOS）
  public/char/<code>.webp      同上，前端用
  public/charmi/<code>.webp    256×512 原样
  public/charmi/<code>_s.webp  128 宽小图（皮肤切换缩略图等小尺寸消费点）
  public/data/char_mi.json     items 追加新 code

  python build/export_char_cn_images.py [--force]
"""
import argparse
import json
import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "..", "nikke_extract", "staging", "cn_icons")
ART_OUT = os.path.join(ROOT, "public", "char")
MI_OUT = os.path.join(ROOT, "public", "charmi")
MI_META = os.path.join(ROOT, "public", "data", "char_mi.json")

# 全身立绘：三套国服专属皮肤 + 两个国服先行角色
ART_CODES = ["c082_80", "c233_80", "c260_80", "c8004_00", "c8005_00"]
ART_SIZE = 1024          # 与国际服 icons-char-full 产物一致
ART_QUALITY = 86         # export_sd.py --webp 的参数
MI_QUALITY = 92          # export_char_mi.py 的参数
SMALL_W = 128            # export_char_mi.py 的 _s 变体宽度


def convert_art(code, force):
    src = os.path.join(SRC, code + ".png")
    dst_png = os.path.join(ART_OUT, code + ".png")
    dst_webp = os.path.join(ART_OUT, code + ".webp")
    if (os.path.exists(dst_png) and os.path.exists(dst_webp)
            and not force
            and os.path.getmtime(dst_png) >= os.path.getmtime(src)):
        return "skip"
    with Image.open(src) as im:
        img = im.convert("RGBA")
        if img.width != ART_SIZE:
            img = img.resize((ART_SIZE, round(img.height * ART_SIZE / img.width)), Image.LANCZOS)
        img.save(dst_png)
        img.save(dst_webp, "WEBP", quality=ART_QUALITY, method=4)
    return "ok"


def convert_mi(code, force):
    src = os.path.join(SRC, "mi_" + code + "_s.png")
    dst = os.path.join(MI_OUT, code + ".webp")
    dst_s = os.path.join(MI_OUT, code + "_s.webp")
    if (os.path.exists(dst) and os.path.exists(dst_s)
            and not force
            and os.path.getmtime(dst) >= os.path.getmtime(src)):
        return "skip"
    with Image.open(src) as im:
        img = im.convert("RGBA")
        img.save(dst, "WEBP", quality=MI_QUALITY, method=6)
        w = SMALL_W
        h = max(1, round(img.height * w / img.width))
        img.resize((w, h), Image.LANCZOS).save(dst_s, "WEBP", quality=MI_QUALITY, method=6)
    return "ok"


def update_mi_meta(codes):
    with open(MI_META, encoding="utf-8") as f:
        meta = json.load(f)
    items = set(meta.get("items", []))
    added = [c for c in codes if c not in items]
    items.update(codes)
    meta["items"] = sorted(items)
    meta["total"] = len(meta["items"])
    with open(MI_META, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, separators=(",", ":"))
    return added


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    if not os.path.isdir(SRC):
        print(f"! 找不到源目录 {SRC}")
        return

    mi_codes = []
    for code in ART_CODES:
        try:
            s1 = convert_art(code, args.force)
            s2 = convert_mi(code, args.force)
            mi_codes.append(code)
            print(f"  {code}: 立绘 {s1}，头像 {s2}")
        except Exception as e:
            print(f"  ! {code}: {type(e).__name__}: {e}")

    added = update_mi_meta(mi_codes)
    print(f"char_mi.json 追加 {len(added)} 条：{added or '（均已存在）'}")
    print("完成 -> public/char, public/charmi")


if __name__ == "__main__":
    main()
