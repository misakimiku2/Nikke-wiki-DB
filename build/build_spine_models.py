#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 CG 目录里的 Spine 模型整理成网页可直接播放的形式。

输入：nikke_extract/CG/**/<name>.atlas | .skel | <name>.spine.png
输出：public/spine/<name>/<name>.atlas | .skel | <name>.spine.webp
      public/data/spine_models.json  {"items": [name, ...]}

图集页原本是 2048² PNG（单张 3~4 MB），转成 WebP 后 ~2 MB，
并把 .atlas 第一行的页文件名改成 .webp（atlas 靠第一行找贴图）。

重要：游戏导出的 .atlas 头部写着 `pma:true`，也就是贴图 RGB **已经乘过 alpha**。
这里绝不能再次预乘（历史上踩过这个坑：腮红/发光层被乘两次 alpha，
在实时播放和静态合成里都变成灰斑）。只做两件事：
  1. 把完全透明像素的 RGB 强制清 0 —— 源图里有极少数残留，且普通 WebP
     编码器会往 alpha=0 的像素里塞压缩填充色；PMA 混合是 `ONE`，这些垃圾色
     会被直接加到画面上，形成"灰色切片"和沿部件轮廓的白线。
  2. lossless WebP 用 `exact=True`，禁止编码器改动全透明像素的 RGB。

  python build/build_spine_models.py            # 增量
  python build/build_spine_models.py --force
"""
import argparse
import json
import os
import re
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(os.environ.get("NIKKE_SRC", r"E:/test/nikke_extract"), "CG")
OUT = os.path.join(ROOT, "public", "spine")
META = os.path.join(ROOT, "public", "data", "spine_models.json")
QUALITY = 92


def page_line(atlas_text):
    """atlas 第一行是图集贴图文件名"""
    for line in atlas_text.splitlines():
        s = line.strip()
        if s and ":" not in s:
            return s
    return ""


def convert(job, force=False, lossless=True):
    from PIL import Image

    name, atlas_path, skel_path, page_path = job
    src_dir = os.path.dirname(atlas_path)
    folder = os.path.join(OUT, name)
    os.makedirs(folder, exist_ok=True)
    dst_atlas = os.path.join(folder, name + ".atlas")
    dst_skel = os.path.join(folder, name + ".skel")

    try:
        atlas_text = open(atlas_path, encoding="utf-8", errors="replace").read()

        # 一个模型可能有多个图集页；每页第一行是贴图文件名，要逐页转换并改名
        pages = [ln.strip() for ln in atlas_text.splitlines()
                 if ln.strip() and ":" not in ln.strip()]
        # 只有每块的第一行才是页名，这里按空行分块取
        import re as _re
        pages = []
        for block in _re.split(r"\n\s*\n", atlas_text):
            first = block.strip().splitlines()[0].strip() if block.strip() else ""
            if first and ":" not in first:
                pages.append(first)
        if not pages:
            pages = [name + ".spine.png"]

        out_pages = []
        for page in pages:
            src_page = os.path.join(src_dir, page)
            if not os.path.exists(src_page):
                # 有时页名没有扩展名或路径不同，退回到主贴图
                src_page = page_path
            stem = os.path.splitext(page)[0]
            if stem == name:
                stem = name + ".spine"
            new_name = stem + ".webp"
            out_pages.append((page, new_name, src_page))

        dst_full = os.path.join(folder, out_pages[0][1])
        if not force and os.path.exists(dst_atlas) and os.path.exists(dst_skel) \
                and all(os.path.exists(os.path.join(folder, np)) for _p, np, _s in out_pages):
            total = sum(os.path.getsize(os.path.join(folder, np)) for _p, np, _s in out_pages)
            return {"name": name, "cached": True, "bytes": total}

        lines = atlas_text.splitlines()
        for old_page, new_name, src_page in out_pages:
            for i, ln in enumerate(lines):
                if ln.strip() == old_page:
                    lines[i] = new_name
                    break
            with Image.open(src_page) as im:
                im = im.convert("RGBA")
                # 把 alpha=0 的像素整颗清零（RGB 也要清，PMA 混合下残留色会直接叠加）。
                # 用 mask + composite 走 C 实现，避免 400 万像素的 Python 循环。
                alpha = im.getchannel("A")
                zero_mask = alpha.point(lambda v: 255 if v == 0 else 0)
                im = Image.composite(
                    Image.new("RGBA", im.size, (0, 0, 0, 0)), im, zero_mask
                )
                dst = os.path.join(folder, new_name)
                if lossless:
                    # exact=True 保留全透明像素的 RGB=0；否则 libwebp 会写入预测色，
                    # 线性采样时在部件边界渗出灰/白细线。
                    im.save(dst, "WEBP", lossless=True, method=6, exact=True)
                else:
                    im.save(dst, "WEBP", quality=QUALITY, method=5)
        with open(dst_atlas, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")

        with open(skel_path, "rb") as f:
            data = f.read()
        with open(dst_skel, "wb") as f:
            f.write(data)

        total = sum(os.path.getsize(os.path.join(folder, np)) for _p, np, _s in out_pages)
        return {"name": name, "bytes": total, "pages": len(out_pages),
                "atlas": os.path.getsize(dst_atlas), "skel": os.path.getsize(dst_skel)}
    except Exception as e:
        return {"name": name, "error": f"{type(e).__name__}: {e}"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--lossy", action="store_true",
                    help="用有损 WebP（体积小，但不支持 exact，全透明像素的 RGB 会被编码器改写，"
                         "PMA 混合下会重新出现切片边界细线，不建议使用）")
    args = ap.parse_args()

    if not os.path.isdir(SRC):
        print(f"! 源目录不存在：{SRC}")
        sys.exit(1)
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(os.path.dirname(META), exist_ok=True)

    jobs = []
    for dirpath, _dirs, files in os.walk(SRC):
        for fn in files:
            if not fn.endswith(".atlas"):
                continue
            name = fn[:-len(".atlas")]
            skel = os.path.join(dirpath, name + ".skel")
            page = os.path.join(dirpath, name + ".spine.png")
            if not (os.path.exists(skel) and os.path.exists(page)):
                continue
            jobs.append((name, os.path.join(dirpath, fn), skel, page))
    jobs.sort()
    print(f"待处理 {len(jobs)} 个 Spine 模型")

    ok, errors = [], []
    t0 = time.time()
    workers = min(8, os.cpu_count() or 4)
    with ProcessPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(convert, j, args.force, not args.lossy): j for j in jobs}
        for i, fut in enumerate(as_completed(futures), 1):
            r = fut.result()
            if r.get("error"):
                errors.append(f"{r['name']}: {r['error']}")
            else:
                ok.append(r)
            if i % 40 == 0 or i == len(jobs):
                print(f"  {i}/{len(jobs)}  {time.time()-t0:.0f}s", flush=True)

    names = sorted({r["name"] for r in ok})
    with open(META, "w", encoding="utf-8") as f:
        json.dump({"total": len(names), "items": names}, f, ensure_ascii=False, separators=(",", ":"))

    total = sum(r.get("bytes", 0) for r in ok)
    print(f"\n完成 {len(names)} 个模型，失败 {len(errors)}，耗时 {time.time()-t0:.0f}s")
    print(f"  贴图合计 {total/1048576:.0f} MB（平均 {total/max(1,len(ok))/1024:.0f} KB）")
    for e in errors[:6]:
        print("  !", e)


if __name__ == "__main__":
    main()
