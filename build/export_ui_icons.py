#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 dp 池导出 UI 图标（装备 / 属性等）。

  python build/export_ui_icons.py equip            # → public/equipicon/
  python build/export_ui_icons.py equip --list     # 只列名字不落盘
  python build/export_ui_icons.py "icons-buff(hd)" --out staticon
"""
import argparse
import io
import os
import pathlib
import re
import sqlite3
import sys
import time

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NIKKE_SRC = os.environ.get("NIKKE_SRC", r"E:/test/nikke_extract")
sys.path.insert(0, os.path.join(NIKKE_SRC, "scripts"))

import export_cg_v2 as v2  # noqa: E402
import UnityPy  # noqa: E402
import zstandard as zstd  # noqa: E402

PATCH = os.environ.get(
    "NIKKE_PATCH", r"F:\NIKKE\Unity\com_proximabeta_NIKKE\com.shiftup.patch")

ALIAS = {
    "equip": ("icons-equip(hd)", "equipicon"),
    "buff": ("icons-buff(hd)", "staticon"),
    "battle": ("icons-battle(hd)", "battleicon"),
    "ui": ("icon-atlased(hd)", "uiicon"),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pool", help="别名(equip/buff/battle/ui) 或完整池名前缀")
    ap.add_argument("--out", default="", help="输出子目录，默认按别名")
    ap.add_argument("--set", default="dp", choices=["dp", "core"], help="资源池组")
    ap.add_argument("--only", default="", help="只导名字含这些关键字的，逗号分隔")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    prefix, outdir = ALIAS.get(args.pool, (args.pool, args.pool))
    outdir = args.out or outdir
    OUT = os.path.join(ROOT, "public", outdir)
    only = [s.strip() for s in args.only.split(",") if s.strip()]
    cdb = pathlib.Path(PATCH) / args.set / "chunk" / "store.cdb"
    CAT = os.path.join(NIKKE_SRC, "catalogs", f"{args.set}_catalog.ndb.dec")

    cat = sqlite3.connect(CAT)
    rows = cat.execute(
        "select file_id,key from files_chunktype where key like ?",
        (prefix.replace("(", r"\(").replace(")", r"\)") + "%",)).fetchall()
    if not rows:
        rows = cat.execute(
            "select file_id,key from files_chunktype where key like ?", (prefix + "%",)).fetchall()
    assert rows, f"池 {prefix} 不存在"
    print(f"池 {prefix} @{args.set}: {len(rows)} 个 bundle")

    table = v2.cidx_map(args.set)
    dec = zstd.ZstdDecompressor()
    os.makedirs(OUT, exist_ok=True)

    names, ok, skip, fail = [], 0, 0, 0
    t0 = time.time()
    for fid, key in rows:
        bundle, _p, missing = v2.rebuild(cat, table, cdb, dec, fid, cdb.stat().st_size)
        if missing or not bundle:
            continue
        try:
            env = UnityPy.load(io.BytesIO(bundle))
        except Exception:
            fail += 1
            continue
        for o in env.objects:
            if o.type.name not in ("Sprite", "Texture2D"):
                continue
            d = o.read()
            name = d.m_Name
            if name.startswith("sactx-"):
                continue
            if only and not any(k in name for k in only):
                continue
            names.append(name)
            if args.list:
                continue
            dst = os.path.join(OUT, name + ".webp")
            if os.path.exists(dst) and not args.force:
                skip += 1
                continue
            try:
                img = d.image
                if img.mode != "RGBA":
                    img = img.convert("RGBA")
                img.save(dst, "WEBP", quality=90, method=4)
                ok += 1
            except Exception:
                fail += 1

    if args.list:
        uniq = sorted(set(names))
        print(f"共 {len(uniq)} 个纹理：")
        for n in uniq:
            print("  ", n)
    else:
        total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT) if f.endswith(".webp"))
        print(f"导出完成：新增 {ok}，跳过 {skip}，失败 {fail}，合计 {total/1048576:.2f} MB，"
              f"耗时 {time.time()-t0:.0f}s → {OUT}")


if __name__ == "__main__":
    main()
