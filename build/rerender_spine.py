#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
批量重渲染 Spine 动态 CG 的静态图

修复：spine-seamfix.mjs 里 *_shadow 层被当普通图层画出灰色斑块（脸上灰圈）。

  python build/rerender_spine.py --probe     # 只跑 3 张，输出到 _probe 目录
  python build/rerender_spine.py             # 全量，覆盖原图（旧图备份到 CG/_backup_shadow/）
"""
import argparse
import glob
import os
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

SRC = os.environ.get("NIKKE_SRC", r"E:/test/nikke_extract")
RUNTIME = os.path.join(SRC, "动态CG", "runtime")
BACKUP = os.path.join(SRC, "CG", "_backup_shadow")


def collect():
    """返回 [(目录, 基名, 目标png路径)]"""
    items = []
    for atlas in glob.glob(os.path.join(SRC, "CG", "**", "*.atlas"), recursive=True):
        folder = os.path.dirname(atlas)
        base = os.path.basename(atlas)[:-6]
        png = os.path.join(folder, base + ".png")
        if os.path.exists(png):
            items.append((folder, base, png))
    return items


def render(item):
    folder, base, png = item
    try:
        r = subprocess.run(
            ["node", "render_static.mjs", folder, base, png, "2048", "1.2"],
            cwd=RUNTIME, capture_output=True, text=True, timeout=180,
        )
        if r.returncode != 0:
            return (base, False, (r.stderr or "").strip().splitlines()[-1:] or ["?"])
        return (base, True, None)
    except Exception as e:
        return (base, False, [str(e)])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--probe", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    items = collect()
    print(f"待重渲染 {len(items)} 个 Spine 模型")
    if args.probe:
        items = items[:3]
    elif args.limit:
        items = items[: args.limit]

    if not args.probe:
        os.makedirs(BACKUP, exist_ok=True)
        for folder, base, png in items:
            rel = os.path.relpath(png, os.path.join(SRC, "CG"))
            dst = os.path.join(BACKUP, rel.replace("\\", "__").replace("/", "__"))
            if not os.path.exists(dst):
                shutil.copy2(png, dst)

    t0 = time.time()
    ok = fail = 0
    errors = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(render, it): it for it in items}
        for i, fut in enumerate(as_completed(futures), 1):
            base, good, err = fut.result()
            if good:
                ok += 1
            else:
                fail += 1
                errors.append(f"{base}: {err}")
            if i % 10 == 0 or i == len(items):
                print(f"  {i}/{len(items)}  成功 {ok} 失败 {fail}  {time.time()-t0:.0f}s", flush=True)

    print(f"\n完成：成功 {ok}，失败 {fail}，耗时 {(time.time()-t0)/60:.1f} 分钟")
    if not args.probe:
        print(f"  旧图备份：{BACKUP}")
    for e in errors[:6]:
        print("  !", e)


if __name__ == "__main__":
    main()
