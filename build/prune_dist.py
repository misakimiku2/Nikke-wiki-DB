#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""上传前清理 dist/ 里不该占 Pages 文件配额的产物。只动 dist，不改 public。

Cloudflare Pages 免费版单次部署上限 20000 文件。当前 public/ 有约 1.87 万个素材，
加上预渲染的约 2900 个 HTML 页就超了。以下内容对线上毫无用处，清掉即可：

  * cover_src/          —— dev 封面编辑器上传的原图，只在线下裁剪时用
  * cover/*.crop.json   —— 裁剪参数指纹，build_story_covers.py 用，前端不读
  * _tmp/、*.bak*       —— 历次构建的临时目录与备份残留
  * img/m/ 中未被引用的中档图 —— 图鉴缩略用 img/s、查看器大图用 img/l，
    img/m 全站只在 CSS / 首页硬编码引用 5 张，其余 2200+ 张是重复的第三份。
    保留集合直接从 web/src 源码扫描，改了引用不会漏。

用法：python build/prune_dist.py          # 在 deploy_pages.sh 构建后自动调用
"""
import os
import re
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
SRC = os.path.join(ROOT, "web", "src")
KEEP_M_RE = re.compile(r"/img/m/([0-9a-f]{16})\.webp")


def scan_keep_m():
    keep = set()
    for dp, _, fns in os.walk(SRC):
        for fn in fns:
            if not fn.endswith((".ts", ".tsx", ".css")):
                continue
            with open(os.path.join(dp, fn), encoding="utf-8", errors="ignore") as f:
                keep.update(KEEP_M_RE.findall(f.read()))
    return keep


def rm_file(path):
    os.remove(path)
    return 1


def rm_tree(path):
    n = 0
    for dp, _, fns in os.walk(path):
        n += len(fns)
    import shutil
    shutil.rmtree(path, ignore_errors=True)
    return n


def main():
    if not os.path.isdir(DIST):
        print(f"找不到 {DIST}，先跑 npm run build")
        sys.exit(1)

    removed = 0
    for name in ("_tmp", "cover_src"):
        p = os.path.join(DIST, name)
        if os.path.isdir(p):
            removed += rm_tree(p)
            print(f"  清理 dist/{name}/")

    cover = os.path.join(DIST, "cover")
    if os.path.isdir(cover):
        n = 0
        for fn in os.listdir(cover):
            if fn.endswith(".crop.json"):
                n += rm_file(os.path.join(cover, fn))
        if n:
            removed += n
            print(f"  清理 dist/cover/*.crop.json：{n}")

    for fn in os.listdir(DIST):
        if ".bak" in fn and os.path.isfile(os.path.join(DIST, fn)):
            removed += rm_file(os.path.join(DIST, fn))
            print(f"  清理 dist/{fn}")

    mid = os.path.join(DIST, "img", "m")
    if os.path.isdir(mid):
        keep = scan_keep_m()
        n = 0
        for fn in os.listdir(mid):
            h = fn[:-5] if fn.endswith(".webp") else fn
            if h not in keep:
                n += rm_file(os.path.join(mid, fn))
        removed += n
        print(f"  清理 dist/img/m/ 未引用图：{n}（保留 {len(keep)} 张）")

    total = sum(len(fns) for _, _, fns in os.walk(DIST))
    print(f"dist 清理 {removed} 个文件，剩余 {total} 个" +
          ("  ← 仍超 Pages 20000 上限！" if total > 20000 else "  （Pages 限额内）"))
    if total > 20000:
        sys.exit(1)


if __name__ == "__main__":
    main()
