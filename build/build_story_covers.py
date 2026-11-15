#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""为剧情卡生成 3:4 竖版封面。

默认的 object-fit: cover 会把方形 CG 居中裁一刀，人物不在正中时就会
「歪」；白底合成图还会留下大片空白。这里按主体包围盒（alpha 或非背景色）
重新取景，透明 CG 再垫一层模糊背景，输出固定 3:4，卡片里不再需要裁剪。

  python build/build_story_covers.py
输出 public/cover/<hash>.webp
"""
import json
import os
import sys
from statistics import median

from PIL import Image, ImageChops, ImageEnhance, ImageFilter, ImageOps, ImageStat

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data", "story_index.json")
IMG = os.path.join(ROOT, "public", "img")
OUT = os.path.join(ROOT, "public", "cover")
TW, TH = 480, 640          # 3:4
ASPECT = TW / TH


def source_path(h):
    for sub in ("l", "m", "s"):
        p = os.path.join(IMG, sub, f"{h}.webp")
        if os.path.exists(p):
            return p
    return None


def border_color(img, pad=8):
    w, h = img.size
    px = []
    for box in ((0, 0, w, pad), (0, h - pad, w, h),
                (0, 0, pad, h), (w - pad, 0, w, h)):
        px.extend(img.crop(box).convert("RGB").getdata())
    return tuple(int(median(c[i] for c in px)) for i in range(3))


def has_alpha(img):
    return img.mode == "RGBA" and img.getchannel("A").getextrema()[0] < 250


def density_crop(img):
    """按主体密度重心取 3:4 窗口。

    不用 alpha 包围盒：活动 CG 常有散落的光点/碎片，包围盒会横跨整张图，
    结果人物被挤到一边。这里把密度（alpha 或与背景的色差）缩小后按平方加权，
    重心会落在人物/主体上，而不是被零星像素拉偏。
    """
    w, h = img.size
    if has_alpha(img):
        d = img.getchannel("A")
    else:
        rgb = img.convert("RGB")
        bg = border_color(rgb)
        diff = ImageChops.difference(rgb, Image.new("RGB", rgb.size, bg))
        d = diff.convert("L").point(lambda v: min(255, v * 2))

    n = 128
    small = d.resize((n, n), Image.Resampling.BOX)
    px = list(small.getdata())
    weights = [(v / 255.0) ** 2 for v in px]
    total = sum(weights)
    if total <= 1e-6:
        cx, cy = w / 2, h / 2
        frac = 1.0
    else:
        cx = sum((i % n) * wt for i, wt in enumerate(weights)) / total / n * w
        cy = sum((i // n) * wt for i, wt in enumerate(weights)) / total / n * h
        # 密度越集中（单个主体）就裁得越紧，越分散（全身/大场景）留得越多
        s2 = sum(wt * wt for wt in weights)
        frac = ((total * total) / s2) / (n * n) if s2 else 1.0

    zoom = 0.55 + 0.17 * max(0.0, min(1.0, (frac - 0.10) / 0.45))
    cw = min(w, h * ASPECT) * zoom
    ch = cw / ASPECT
    if cw > w:
        cw = w
        ch = cw / ASPECT
    if ch > h:
        ch = h
        cw = ch * ASPECT
    x = min(max(cx - cw / 2, 0), w - cw)
    y = min(max(cy - ch / 2, 0), h - ch)
    return (round(x), round(y), round(x + cw), round(y + ch))


def make_cover(src, dst):
    img = Image.open(src)
    img.load()
    transparent = has_alpha(img)
    crop = density_crop(img)

    if transparent:
        # 背景：整张图 cover 铺满 + 模糊压暗，主体透明区不会露出卡片底色
        bg = ImageOps.fit(img.convert("RGBA"), (TW, TH), method=Image.Resampling.LANCZOS,
                          centering=(0.5, 0.42))
        bg = bg.filter(ImageFilter.GaussianBlur(26))
        bg = ImageEnhance.Brightness(bg).enhance(0.55)
        fg = img.crop(crop).resize((TW, TH), Image.Resampling.LANCZOS)
        bg.alpha_composite(fg)
        out = bg.convert("RGB")
    else:
        out = img.crop(crop).resize((TW, TH), Image.Resampling.LANCZOS).convert("RGB")

    out.save(dst, "WEBP", quality=84, method=6)


def main():
    os.makedirs(OUT, exist_ok=True)
    with open(DATA, encoding="utf-8") as f:
        items = json.load(f).get("items", [])
    hashes = sorted({u["cover"] for u in items if u.get("cover")})
    missing = done = 0
    total = 0
    for h in hashes:
        src = source_path(h)
        if not src:
            missing += 1
            continue
        dst = os.path.join(OUT, f"{h}.webp")
        if (not os.path.exists(dst)
                or os.path.getmtime(dst) < os.path.getmtime(src)):
            make_cover(src, dst)
            done += 1
        total += os.path.getsize(dst)
    print(f"封面 {len(hashes)} 个：重做 {done}，缺源图 {missing}，"
          f"合计 {total / 1048576:.1f} MB")


if __name__ == "__main__":
    main()
