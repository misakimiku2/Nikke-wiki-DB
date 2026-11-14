#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
高清角色立绘转码

输入：nikke_extract/staging/char_render/<name>.png —— Spine 站姿模型渲染出的 2048² 透明底图
输出：
  public/charhd/<name>.webp        全身立绘（裁掉透明边，长边 1600）
  public/charhd/<name>_head.webp   头部方图（400²，角色列表缩略图用）
  public/data/char_hd.json         {"items": [name, ...]} 有高清立绘的角色皮肤

  python build/build_char_hd.py            # 增量
  python build/build_char_hd.py --force    # 重转
"""
import argparse
import json
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(os.environ.get("NIKKE_SRC", r"E:/test/nikke_extract"), "staging", "char_render")
OUT = os.path.join(ROOT, "public", "charhd")
META = os.path.join(ROOT, "public", "data", "char_hd.json")

FULL_H = 1600      # 全身立绘长边
HEAD = 400         # 头部方图
ALPHA_T = 8        # 透明度阈值，低于它算空白


def work(path, force=False):
    from PIL import Image

    name = os.path.splitext(os.path.basename(path))[0]
    full = os.path.join(OUT, name + ".webp")
    head = os.path.join(OUT, name + "_head.webp")
    need_full = force or not os.path.exists(full)
    need_head = force or not os.path.exists(head)
    if not need_full and not need_head:
        return {"name": name, "cached": True}

    try:
        im = Image.open(path).convert("RGBA")
    except Exception as e:
        return {"name": name, "error": f"{type(e).__name__}: {e}"}

    alpha = im.getchannel("A").point(lambda v: 255 if v > ALPHA_T else 0)
    bbox = alpha.getbbox()
    if not bbox:
        return {"name": name, "error": "empty"}

    body = im.crop(bbox)
    bw, bh = body.size
    if bw < 200 or bh < 400:
        return {"name": name, "error": f"too small {bw}x{bh}"}

    # 全身：只缩不放，长边 <= FULL_H
    if need_full:
        scale = min(1.0, FULL_H / max(bw, bh))
        full_img = body if scale >= 1 else body.resize(
            (max(1, round(bw * scale)), max(1, round(bh * scale))), Image.LANCZOS)
        full_img.save(full, "WEBP", quality=88, method=6)

    # 头部：以身体高度 30% 为边长，水平对齐顶部 10% 的 alpha 包围盒中心
    # 注意 top_slice 的坐标是相对 bbox[0] 的，必须加回偏移量
    if need_head:
        side = max(120, int(bh * 0.30))
        top_slice = alpha.crop((bbox[0], bbox[1], bbox[2], bbox[1] + max(1, int(bh * 0.10))))
        tb = top_slice.getbbox() or (0, 0, bw, 1)
        cx = (tb[0] + tb[2]) // 2 + bbox[0]
        x0 = max(0, min(cx - side // 2, im.size[0] - side))
        y0 = max(0, bbox[1] - int(side * 0.05))
        head_img = im.crop((x0, y0, x0 + side, y0 + side)).resize((HEAD, HEAD), Image.LANCZOS)
        head_img.save(head, "WEBP", quality=86, method=6)

    return {"name": name, "full": os.path.getsize(full), "head": os.path.getsize(head)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--workers", type=int, default=0)
    args = ap.parse_args()

    if not os.path.isdir(SRC):
        print(f"! 渲染目录不存在：{SRC}")
        sys.exit(1)
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(os.path.dirname(META), exist_ok=True)

    paths = sorted(
        os.path.join(SRC, f) for f in os.listdir(SRC) if f.lower().endswith(".png")
    )
    print(f"待处理 {len(paths)} 张站姿渲染图")

    workers = args.workers or min(8, (os.cpu_count() or 4))
    ok, errors = [], []
    t0 = time.time()
    with ProcessPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(work, p, args.force): p for p in paths}
        for i, fut in enumerate(as_completed(futures), 1):
            r = fut.result()
            if r.get("error"):
                errors.append(f"{r['name']}: {r['error']}")
            else:
                ok.append(r["name"])
            if i % 100 == 0 or i == len(paths):
                print(f"  {i}/{len(paths)}  {time.time()-t0:.0f}s", flush=True)

    names = sorted(ok)
    with open(META, "w", encoding="utf-8") as f:
        json.dump({"total": len(names), "items": names}, f, ensure_ascii=False, separators=(",", ":"))

    total = sum(os.path.getsize(os.path.join(OUT, n + ".webp")) for n in names)
    print(f"\n完成 {len(names)} 张，失败 {len(errors)} 张，耗时 {time.time()-t0:.0f}s")
    print(f"  全身 WebP 合计 {total/1048576:.0f} MB（平均 {total/max(1,len(names))/1024:.0f} KB）")
    print(f"  索引 {META}")
    for e in errors[:6]:
        print("  !", e)


if __name__ == "__main__":
    main()
