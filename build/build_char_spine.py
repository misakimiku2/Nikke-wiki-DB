#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
角色 Spine 模型 → 网页可实时播放的四件套

--kind stand（默认）：站姿立绘模型
输入：nikke_extract/staging/spine_stand/<name>/...
输出：public/spine_char/<name>/...  public/data/char_spine.json
--kind combat：战斗姿态模型（aim 背身射击 / cover 掩体，名字自带姿态段）
输入：nikke_extract/staging/spine_combat/<name>/...
输出：public/spine_combat/<name>/...  public/data/char_spine_combat.json

和 CG 的 build_spine_models.py 同一条路子，三点差异：
  1. 角色 atlases 有 BOM（23 个），必须用 utf-8-sig 读，否则贴图页名带 \\ufeff，
     浏览器 fetch 会 404；写回时也不带 BOM。
  2. 部分模型是双页图集（<name>.png + <name>_2.png），每页都要转、都要改名。
  3. 图集页可以整体降采样（--size），PNG 2048² 转无损 WebP 约 2.1 MB。

图集头 pma:true —— 贴图 RGB 已经乘过 alpha，绝不能再次预乘。
只把 alpha=0 的像素 RGB 清零（PMA 混合下残留色会直接叠加成灰斑/白线），
并用 lossless + exact=True 保存，防止编码器往全透明像素里塞填充色。

  python build/build_char_spine.py                 # 增量，2048 原尺寸
  python build/build_char_spine.py --kind combat   # 战斗姿态模型
  python build/build_char_spine.py --size 1024     # 降采样
  python build/build_char_spine.py --force
  python build/build_char_spine.py --limit 8       # 先试几个
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
SRC_ROOT = os.path.join(os.environ.get("NIKKE_SRC", r"E:/test/nikke_extract"), "staging")
KINDS = {
    "stand": ("spine_stand", "spine_char", "char_spine.json", "角色站姿模型"),
    "combat": ("spine_combat", "spine_combat", "char_spine_combat.json", "角色战斗姿态模型"),
    "skillcut": ("spine_char", "spine_skillcut", "char_spine_skillcut.json", "角色大招 cut-in 模型"),
}

def paths_for(kind):
    src_name, out_name, meta_name, label = KINDS[kind]
    return (
        os.path.join(SRC_ROOT, src_name),
        os.path.join(ROOT, "public", out_name),
        os.path.join(ROOT, "public", "data", meta_name),
        label,
    )


def atlas_pages(text):
    """按空行分块，每块第一行是图集页文件名（不含冒号）"""
    pages = []
    for block in re.split(r"\n\s*\n", text):
        lines = [ln.strip() for ln in block.strip().splitlines() if ln.strip()]
        if lines and ":" not in lines[0]:
            pages.append(lines[0])
    return pages


def convert(job, force=False, size=0):
    from PIL import Image

    name, folder_src, out_root = job
    folder = os.path.join(out_root, name)
    os.makedirs(folder, exist_ok=True)
    dst_atlas = os.path.join(folder, name + ".atlas")
    dst_skel = os.path.join(folder, name + ".skel")

    try:
        raw = open(os.path.join(folder_src, name + ".atlas"), "rb").read()
        atlas_text = raw.decode("utf-8-sig", "replace")
        pages = atlas_pages(atlas_text)
        if not pages:
            return {"name": name, "error": "atlas 里找不到图集页"}

        # 每页的源文件与目标文件名
        plan = []
        for page in pages:
            src_page = os.path.join(folder_src, page)
            if not os.path.exists(src_page):
                return {"name": name, "error": f"缺图集页 {page}"}
            stem, _ext = os.path.splitext(page)
            plan.append((page, stem + ".webp", src_page))

        if not force and os.path.exists(dst_atlas) and os.path.exists(dst_skel) \
                and all(os.path.exists(os.path.join(folder, np)) for _p, np, _s in plan):
            total = sum(os.path.getsize(os.path.join(folder, np)) for _p, np, _s in plan)
            return {"name": name, "cached": True, "bytes": total}

        lines = atlas_text.splitlines()
        for old_page, new_name, src_page in plan:
            for i, ln in enumerate(lines):
                if ln.strip() == old_page:
                    lines[i] = new_name
                    break
            with Image.open(src_page) as im:
                im = im.convert("RGBA")
                if size and im.width > size:
                    im = im.resize((size, size), Image.LANCZOS)
                # alpha=0 的像素连 RGB 一起清零
                alpha = im.getchannel("A")
                zero_mask = alpha.point(lambda v: 255 if v == 0 else 0)
                im = Image.composite(
                    Image.new("RGBA", im.size, (0, 0, 0, 0)), im, zero_mask
                )
                im.save(os.path.join(folder, new_name), "WEBP",
                        lossless=True, method=6, exact=True)
        with open(dst_atlas, "w", encoding="utf-8", newline="\n") as f:
            f.write("\n".join(lines) + "\n")
        with open(os.path.join(folder_src, name + ".skel"), "rb") as f:
            data = f.read()
        with open(dst_skel, "wb") as f:
            f.write(data)

        total = sum(os.path.getsize(os.path.join(folder, np)) for _p, np, _s in plan)
        return {"name": name, "bytes": total, "pages": len(plan),
                "atlas": os.path.getsize(dst_atlas), "skel": os.path.getsize(dst_skel)}
    except Exception as e:
        return {"name": name, "error": f"{type(e).__name__}: {e}"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--kind", default="stand", choices=sorted(KINDS))
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--size", type=int, default=0,
                    help="图集页统一缩放到这个边长（0 = 保持原样 2048）")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    SRC, OUT, META, label = paths_for(args.kind)
    if not os.path.isdir(SRC):
        print(f"! 源目录不存在：{SRC}")
        sys.exit(1)
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(os.path.dirname(META), exist_ok=True)

    jobs = []
    for name in sorted(os.listdir(SRC)):
        d = os.path.join(SRC, name)
        if not os.path.isdir(d):
            continue
        if name.startswith("dummy"):
            continue  # 资源池里的测试模型，不进网页
        if not (os.path.exists(os.path.join(d, name + ".atlas"))
                and os.path.exists(os.path.join(d, name + ".skel"))):
            continue
        jobs.append((name, d, OUT))
    if args.limit:
        jobs = jobs[:args.limit]
    print(f"待处理 {len(jobs)} 个{label}")

    ok, errors = [], []
    t0 = time.time()
    workers = min(8, os.cpu_count() or 4)
    with ProcessPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(convert, j, args.force, args.size): j for j in jobs}
        for i, fut in enumerate(as_completed(futures), 1):
            r = fut.result()
            if r.get("error"):
                errors.append(f"{r['name']}: {r['error']}")
            else:
                ok.append(r)
            if i % 25 == 0 or i == len(jobs):
                done_mb = sum(x.get("bytes", 0) for x in ok) / 1048576
                print(f"  {i}/{len(jobs)}  {done_mb:.0f} MB  {time.time()-t0:.0f}s", flush=True)

    names = sorted({r["name"] for r in ok})
    meta = {"total": len(names), "items": names}
    if args.kind == "skillcut":
        # 大招模型的命名五花八门（源数据就有拼写变体/皮肤段位置不一），
        # 直接在这里把「皮肤 → 模型」映射算好，前端两级查找：
        #   bySkin["c010_00"] = "c010_00_skillcut"   常规：<皮肤>_<后缀>
        #   byChar["c093"]    = "c093_skillcut"      无皮肤段的兜底
        by_skin, by_char = {}, {}
        for name in names:
            if name.startswith("dummy"):
                continue
            m = re.match(r"^(c\d+)_(\d+)$", name)              # c821_01 无后缀
            if m:
                by_skin.setdefault(m.group(0), name)
                continue
            m = re.match(r"^(c\d+)_skillcut_(\d+)$", name)     # c840_skillcut_00 皮肤段在后
            if m:
                by_skin.setdefault(f"{m.group(1)}_{m.group(2)}", name)
                continue
            m = re.match(r"^(c\d+_\d+)_(.+)$", name)           # c010_00_skillcut / c017_00_slillcut / c470_00_z_f
            if m:
                by_skin.setdefault(m.group(1), name)
                continue
            m = re.match(r"^(c\d+)_", name)                    # c093_skillcut 无皮肤段
            if m:
                by_char.setdefault(m.group(1), name)
        meta["bySkin"] = by_skin
        meta["byChar"] = by_char
        print(f"  皮肤映射 {len(by_skin)} 条，角色级兜底 {len(by_char)} 条")
    with open(META, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, separators=(",", ":"))

    total = sum(r.get("bytes", 0) for r in ok)
    pages = sum(r.get("pages", 0) for r in ok)
    print(f"\n完成 {len(names)} 个模型（{pages} 张图集页），失败 {len(errors)}，"
          f"耗时 {time.time()-t0:.0f}s")
    print(f"  贴图合计 {total/1048576:.0f} MB（平均 {total/max(1,len(ok))/1024:.0f} KB）")
    print(f"  索引 {META}")
    for e in errors[:8]:
        print("  !", e)


if __name__ == "__main__":
    main()
