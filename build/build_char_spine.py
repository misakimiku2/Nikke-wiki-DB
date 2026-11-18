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
凡是做过插值（压扁页拉伸回声明尺寸 / --size 降采样）的页：
  先清 alpha=0 残留再插值（防杂色混入边缘），插值后钳制 RGB≤A
  （LANCZOS 过冲会产生 RGB>A 的加法亮斑，头发边缘的小白点）。

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


def rescale_atlas_pages(atlas_text, src_folder, name="", verbose=True):
    """修正 atlas 声明尺寸与实际纹理尺寸不符的页（游戏资源错配）。两类失配两种修法：

    - 实际 > 声明（如 c094_01 青涩新生 1930 / 实际 2048²，c223_01/c912_00 声明
      ~1790-1934 / 实际 2048²）：整页被等比放大到 2 的幂画布，内容跟着一起拉伸。
      UV 是归一化的（bounds / 声明尺寸），采样时自动乘到实际像素，**atlas 原样不动**。
      早先这里去缩放 bounds/offsets，结果部件的世界尺寸被放大（c094_01 多 6%，
      裙摆/丝袜错位），rotate:90/270 的 region 取样区还会偏掉，边缘冒出黑色三角碎片。
    - 实际 < 声明（已知 c094_00 战术升级第二页 2048x1398 声明 / 2048x1024 实际，
      以及 c062/c194 战斗模型 2048² 声明 / 1024² 实际）：
      整页纹理被压扁（某条轴或两条轴按 实际/声明 缩短），坐标描述的仍是
      压扁前的布局。这种情况缩坐标是错的：压扁发生在页面上，rotate:90/270
      的 region 页内 footprint 与压扁轴正好互换，缩放后的 footprint 会指向
      错误内容（脸上横跨碎发、贝雷帽破片、部件消失）。
      正确修法是把贴图拉伸回声明尺寸、atlas 原样保留——UV 与内容逐像素对齐，
      rotate/offsets 一并自然修正。拉伸只在低分辨率方向插值，不损失原有细节。
    只有 2~5% 的 2 的幂取整差异（如 2046 vs 2048）不动——那种是正常填充。

    返回 (修正后的 atlas 文本, 需拉伸到声明尺寸的页名 -> (宽, 高))。
    """
    from PIL import Image

    blocks = re.split(r"(\n\s*\n)", atlas_text)
    stretch, out = [], []
    for block in blocks:
        # 分隔符原样保留
        if not block.strip():
            out.append(block)
            continue
        lines = [ln.strip() for ln in block.strip().splitlines() if ln.strip()]
        if not lines or ":" in lines[0]:
            out.append(block)
            continue
        page_name = lines[0]
        src_png = os.path.join(src_folder, page_name.replace(".webp", ".png"))
        if not os.path.exists(src_png):
            out.append(block)
            continue
        size_idx = next((i for i, ln in enumerate(lines) if ln.startswith("size:")), None)
        if size_idx is None:
            out.append(block)
            continue
        decl_w, decl_h = map(int, lines[size_idx][len("size:"):].split(","))
        with Image.open(src_png) as im:
            act_w, act_h = im.size
        sx, sy = act_w / decl_w, act_h / decl_h
        if abs(sx - 1) <= 0.05 and abs(sy - 1) <= 0.05:
            out.append(block)
            continue
        if act_w < decl_w or act_h < decl_h:
            # 压扁页：贴图拉伸回声明尺寸，atlas 文本原样保留
            stretch.append((page_name, (decl_w, decl_h)))
            if verbose:
                print(f"  [atlas fix] {name} {page_name}: 贴图 {act_w}x{act_h}"
                      f" -> 拉伸回声明 {decl_w}x{decl_h}（坐标不变）", flush=True)
            out.append(block)
            continue
        # 放大页：整页被等比放大到 2 的幂画布，内容跟着一起被拉伸。
        # 归一化 UV（bounds / 声明尺寸）采样时会自动乘到实际像素上，坐标**不能**改：
        # 改 bounds/offsets 会让世界尺寸整体放大（c094_01 青涩新生多出 6%，裙摆、丝袜错位），
        # 而 rotate:90/270 的 region 页内 footprint 与被缩放的轴正好互换，取样区整个偏掉，
        # 表现为边缘冒出的黑色三角碎片。atlas 原样保留即可。
        if verbose:
            print(f"  [atlas keep] {name} {page_name}: 声明 {decl_w}x{decl_h} / 实际 {act_w}x{act_h}"
                  f"（坐标不动，UV 归一化已自洽）", flush=True)
        out.append(block)
    return "".join(out), dict(stretch)


def _pma_zero_transparent(im):
    """alpha=0 的像素 RGB 归零。插值（拉伸/缩放）前必做：LANCZOS 会采样邻域，
    把图集空白区的残留色混进发丝边缘，PMA 混合下表现为白点/灰斑。"""
    from PIL import Image

    alpha = im.getchannel("A")
    zero_mask = alpha.point(lambda v: 255 if v == 0 else 0)
    return Image.composite(Image.new("RGBA", im.size, (0, 0, 0, 0)), im, zero_mask)


def _stretch_page_straight(im, target_size):
    """压扁页拉伸：在「直通 alpha」空间重采样，而不是直接在 PMA 数据上 resize。

    压扁页（实际 < 声明，如 c094_00 第二页 2048x1024 / 声明 2048x1398）需要拉回声明
    尺寸，UV 才对得上。但 PMA 贴图直接 resize 时，双线性会把图集空白处的透明黑混进
    边缘像素的 RGB（RGB = 原色×A 再和 0 平均），拉回原尺寸后每个部件的边缘都残留一圈
    比内部更暗/更灰的描边——叠在脸上就是五官周围那圈「白边」（暗边贴着亮的叠加层，
    眼睛读成亮线）。

    做法：先解预乘还原出颜色（色 × 1/A），让 Pillow 分别插值「颜色」和「alpha」，
    再按 alpha 重新预乘。边缘因此保住皮肤本色，只剩 alpha 渐变，接缝自然消失。
    """
    from PIL import Image
    import numpy as np

    a = np.asarray(im).astype(np.float32)
    alpha = a[..., 3:4] / 255.0
    # 解预乘；alpha 极小的像素按 1/255 兜底，避免噪声被放大
    color = np.clip(a[..., :3] / np.maximum(alpha, 1.0 / 255.0), 0, 255)
    straight = Image.fromarray(
        np.concatenate([color, a[..., 3:4]], axis=2).astype(np.uint8), "RGBA"
    )
    resized = straight.resize(target_size, Image.BILINEAR)
    b = np.asarray(resized).astype(np.float32)
    beta = b[..., 3:4] / 255.0
    rgb = np.clip(b[..., :3] * beta, 0, 255)
    return Image.fromarray(
        np.concatenate([rgb, b[..., 3:4]], axis=2).astype(np.uint8), "RGBA"
    )


def _pma_clamp(im):
    """钳制 RGB ≤ A，恢复 pma:true 的合法性。

    对 PMA 贴图做 LANCZOS 插值时，负瓣过冲会让边缘像素的 RGB 超过 alpha
    （实测 c094_00 第二页 ~1.1 万像素、最大超出 254）。混合方程是
    (ONE, ONE_MINUS_SRC_ALPHA)，RGB 超出 A 的部分会变成加法亮斑——头发边缘的
    小白点。min(RGB, A) 对合法像素是无操作，对过冲像素恢复约束（alpha=0 处
    RGB 也随之归零）。"""
    from PIL import Image, ImageChops

    r, g, b, a = im.split()
    return Image.merge("RGBA", (
        ImageChops.darker(r, a), ImageChops.darker(g, a),
        ImageChops.darker(b, a), a,
    ))


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
        # 修正 atlas 声明尺寸与实际纹理不符的页：
        # 放大页缩坐标；压扁页（如 c094_00 第二页、c062/c194 战斗页）把贴图拉伸回声明尺寸
        atlas_text, stretch_pages = rescale_atlas_pages(atlas_text, folder_src, name)
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

        # 大招 cut-in 的独立背景贴图（extract 阶段挑好存成 bg.png / bg2.png，
        # bg2 是多镜大招的第二张场景图，网页在切镜点后换用它）
        bg_src = os.path.join(folder_src, "bg.png")
        bg_dst = os.path.join(folder, "bg.webp")
        has_bg = os.path.exists(bg_src)
        bg2_src = os.path.join(folder_src, "bg2.png")
        bg2_dst = os.path.join(folder, "bg2.webp")
        has_bg2 = os.path.exists(bg2_src)

        if not force and os.path.exists(dst_atlas) and os.path.exists(dst_skel) \
                and all(os.path.exists(os.path.join(folder, np)) for _p, np, _s in plan) \
                and (not has_bg or os.path.exists(bg_dst)) \
                and (not has_bg2 or os.path.exists(bg2_dst)):
            total = sum(os.path.getsize(os.path.join(folder, np)) for _p, np, _s in plan)
            return {"name": name, "cached": True, "bytes": total, "bg": has_bg, "bg2": has_bg2}

        lines = atlas_text.splitlines()
        for old_page, new_name, src_page in plan:
            for i, ln in enumerate(lines):
                if ln.strip() == old_page:
                    lines[i] = new_name
                    break
            with Image.open(src_page) as im:
                im = im.convert("RGBA")
                resized = False
                if old_page in stretch_pages:
                    # 压扁页：拉伸回 atlas 声明尺寸，UV 才能逐像素对齐。
                    # 必须在「直通 alpha」空间重采样，见 _stretch_page_straight：
                    # 直接在 PMA 数据上 resize 会把透明黑混进边缘，留下五官周围的白边。
                    im = _pma_zero_transparent(im)
                    im = _stretch_page_straight(im, stretch_pages[old_page])
                    resized = True
                if size and im.width > size:
                    im = im.resize((size, size), Image.LANCZOS)
                    resized = True
                if resized:
                    im = _pma_clamp(im)
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

        for bsrc, bdst in ((bg_src, bg_dst), (bg2_src, bg2_dst)):
            if not os.path.exists(bsrc):
                continue
            with Image.open(bsrc) as bim:
                bim = bim.convert("RGBA")
                if size and bim.width > size:
                    bim = bim.resize((size, size), Image.LANCZOS)
                alpha = bim.getchannel("A")
                zero_mask = alpha.point(lambda v: 255 if v == 0 else 0)
                bim = Image.composite(
                    Image.new("RGBA", bim.size, (0, 0, 0, 0)), bim, zero_mask
                )
                bim.save(bdst, "WEBP", lossless=True, method=6, exact=True)

        total = sum(os.path.getsize(os.path.join(folder, np)) for _p, np, _s in plan)
        return {"name": name, "bytes": total, "pages": len(plan), "bg": has_bg,
                "bg2": has_bg2, "atlas": os.path.getsize(dst_atlas),
                "skel": os.path.getsize(dst_skel)}
    except Exception as e:
        return {"name": name, "error": f"{type(e).__name__}: {e}"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--kind", default="stand", choices=sorted(KINDS))
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--size", type=int, default=0,
                    help="图集页统一缩放到这个边长（0 = 保持原样 2048）")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--only", default="",
                    help="只处理这些模型名，逗号分隔（部分重建，索引与全量合并）")
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
    if args.only:
        want = {s.strip() for s in args.only.split(",") if s.strip()}
        missing = want - {j[0] for j in jobs}
        if missing:
            print(f"! --only 里找不到这些模型：{sorted(missing)}")
        jobs = [j for j in jobs if j[0] in want]
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
    # 部分重建（--only/--limit）时合并旧索引，避免把全量列表覆盖成本轮子集
    partial = bool(args.only or args.limit)
    old_meta = {}
    if partial and os.path.exists(META):
        try:
            with open(META, encoding="utf-8") as f:
                old_meta = json.load(f)
        except Exception:
            old_meta = {}
        names = sorted(set(names) | set(old_meta.get("items", [])))
    meta = {"total": len(names), "items": names}
    if args.kind == "skillcut":
        meta["bgs"] = sorted(r["name"] for r in ok if r.get("bg"))
        meta["bg2s"] = sorted(r["name"] for r in ok if r.get("bg2"))
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
        if partial:
            by_skin = {**old_meta.get("bySkin", {}), **by_skin}
            by_char = {**old_meta.get("byChar", {}), **by_char}
            meta["bgs"] = sorted(set(meta["bgs"]) | set(old_meta.get("bgs", [])))
            meta["bg2s"] = sorted(set(meta["bg2s"]) | set(old_meta.get("bg2s", [])))
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
