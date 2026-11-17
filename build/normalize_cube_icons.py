#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把魔方图标统一成相同视觉大小。

游戏图集里的 `ie_{id}` 精灵，画布虽然都是 256²，但立方体本体的占比从 60% 到 95% 不等，
直接显示会显得参差不齐。这里按 alpha 包围盒裁紧，再等比缩放到统一尺寸并居中。

    python build/normalize_cube_icons.py            # 处理 public/cubeicon/*.webp
    python build/normalize_cube_icons.py --preview  # 只生成对比图，不覆盖
"""
import argparse
import os
import sys

from PIL import Image

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "public", "cubeicon")
SHOT = os.path.join(ROOT, ".shots")

CANVAS = 256          # 输出画布
FILL = 0.86           # 立方体最长边占画布的比例
PAD = 4               # 额外裁掉 alpha 边缘的杂点


def trim(im: Image.Image) -> Image.Image:
    """按 alpha 包围盒裁紧，稍微内缩去掉抗锯齿毛边"""
    a = im.getchannel("A")
    box = a.getbbox()
    if not box:
        return im
    l, t, r, b = box
    l, t = min(l + PAD, r), min(t + PAD, b)
    r, b = max(r - PAD, l + 1), max(b - PAD, t + 1)
    return im.crop((l, t, r, b))


def normalize(path: str, out_path: str | None) -> tuple[int, int]:
    im = Image.open(path).convert("RGBA")
    body = trim(im)
    w, h = body.size
    target = int(CANVAS * FILL)
    scale = target / max(w, h)
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    body = body.resize((nw, nh), Image.LANCZOS)

    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.alpha_composite(body, ((CANVAS - nw) // 2, (CANVAS - nh) // 2))
    canvas.save(out_path or path, "WEBP", quality=92, method=4)
    return (w, h)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", action="store_true", help="只输出对比图，不覆盖原文件")
    args = ap.parse_args()

    files = sorted(f for f in os.listdir(SRC) if f.startswith("ie_") and f.endswith(".webp"))
    if not files:
        raise SystemExit(f"{SRC} 下没有 ie_*.webp")

    os.makedirs(SHOT, exist_ok=True)
    before, after = [], []
    for f in files:
        p = os.path.join(SRC, f)
        before.append(trim(Image.open(p).convert("RGBA")))
        if args.preview:
            tmp = os.path.join(SHOT, "_norm_" + f)
            normalize(p, tmp)
            after.append(Image.open(tmp).convert("RGBA"))
            os.remove(tmp)
        else:
            normalize(p, None)
            after.append(Image.open(p).convert("RGBA"))

    def sheet(ims, name):
        cols = 6
        cell = 130
        rows = (len(ims) + cols - 1) // cols
        out = Image.new("RGBA", (cols * cell, rows * cell), (32, 34, 40, 255))
        for k, im in enumerate(ims):
            r, c = divmod(k, cols)
            t = im.copy()
            t.thumbnail((cell - 12, cell - 12), Image.LANCZOS)
            out.alpha_composite(t, (c * cell + (cell - t.width) // 2,
                                    r * cell + (cell - t.height) // 2))
        path = os.path.join(SHOT, name)
        out.save(path)
        return path

    print(f"处理 {len(files)} 张 → 画布 {CANVAS}²，最长边占 {FILL:.0%}")
    print("对比图:", sheet(before, "cube-norm-before.png"))
    print("对比图:", sheet(after, "cube-norm-after.png"))


if __name__ == "__main__":
    main()
