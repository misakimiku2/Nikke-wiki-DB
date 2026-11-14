#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
提取角色立绘

数据源：dp 池的 icons-char-full(hd) / icons-char-mi(hd)
  icons-char-full(hd)_assets_c010_00_<hash>.bundle
                          └ 角色ID └ 皮肤变体

输出：public/char/c010_00.png（原图）
      public/char/c010_00.webp（压缩版，前端用）

  python build/export_sd.py --probe
  python build/export_sd.py
"""
import argparse
import io
import os
import re
import sqlite3
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                "..", "nikke_extract", "scripts"))

import export_cg_v2 as v2
import UnityPy
import zstandard as zstd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "char")
CAT = os.path.join(v2.BASE, "catalogs", "dp_catalog.ndb.dec")
CD = v2.ROOT / "dp" / "chunk" / "store.cdb"

KIND = {
    "full": "icons-char-full(hd)_assets_",
    "mi": "icons-char-mi(hd)_assets_",
}

NAME_RE = re.compile(r"_assets_(c\d+)_(\d+)_")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--probe", action="store_true")
    ap.add_argument("--kind", default="full", choices=list(KIND))
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--webp", action="store_true", help="同时输出 webp 压缩版")
    args = ap.parse_args()

    out_dir = OUT if args.kind == "full" else os.path.join(ROOT, "public", "char_mi")
    os.makedirs(out_dir, exist_ok=True)

    cat = sqlite3.connect(CAT)
    table = v2.cidx_map("dp")
    dec = zstd.ZstdDecompressor()
    cdb_size = CD.stat().st_size

    prefix = KIND[args.kind]
    rows = cat.execute(
        "select file_id,key from files_chunktype where lower(key) like ?",
        (prefix + "%",),
    ).fetchall()
    print(f"{args.kind}: {len(rows)} 个 bundle")

    picked = []
    for fid, key in rows:
        m = NAME_RE.search(key.lower())
        if m:
            picked.append((fid, key, f"{m.group(1)}_{m.group(2)}"))
    print(f"可解析命名: {len(picked)}")

    if args.probe:
        picked = picked[:3]
    elif args.limit:
        picked = picked[: args.limit]

    ok = fail = 0
    t0 = time.time()
    for i, (fid, key, name) in enumerate(picked, 1):
        out_path = os.path.join(out_dir, name + ".png")
        if os.path.exists(out_path) and not args.force:
            ok += 1
            continue
        try:
            bundle, _, missing = v2.rebuild(cat, table, CD, dec, fid, cdb_size)
            if missing or not bundle or not bundle.startswith(b"UnityFS"):
                fail += 1
                continue
            env = UnityPy.load(io.BytesIO(bundle))
            img = None
            for obj in env.objects:
                if obj.type.name == "Texture2D":
                    d = obj.read()
                    if getattr(d, "m_Name", "") == name or img is None:
                        cand = d.image
                        if cand.width >= 128:
                            img = cand
                            if getattr(d, "m_Name", "") == name:
                                break
            if img is None:
                fail += 1
                continue
            img.save(out_path)
            if args.webp:
                img.save(os.path.join(out_dir, name + ".webp"), "WEBP", quality=86, method=4)
            ok += 1
        except Exception as e:
            fail += 1
            if fail <= 3:
                print(f"  ! {name}: {type(e).__name__}: {e}")
        if i % 50 == 0 or i == len(picked):
            print(f"  {i}/{len(picked)}  成功 {ok} 失败 {fail}  {time.time()-t0:.0f}s", flush=True)

    print(f"\n完成：成功 {ok}，失败 {fail} -> {out_dir}")
    files = [f for f in os.listdir(out_dir) if f.endswith(".png")]
    if files:
        sizes = [os.path.getsize(os.path.join(out_dir, f)) for f in files]
        print(f"  {len(files)} 个文件，合计 {sum(sizes)/1048576:.1f} MB，平均 {sum(sizes)/len(sizes)/1024:.0f} KB")


if __name__ == "__main__":
    main()
