#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
技能图标导出

数据源：dp 池 icons-skill(hd)_assets_all_<hash>.bundle
        每个图标是一张独立的 128×128 Texture2D，名字即 SkillInfoTable 里的
        icon 引用（icn_skill_statcritical_01 / icn_skill_c011_ult / ...）

输出：public/skillicon/<名字>.webp   （128² 透明底，约 3 KB/张）
      由 export_char_skills.py 生成的 char_skills.json 里每条技能带 icon 字段，
      前端取 /skillicon/<icon>.webp 显示。

  python build/export_skill_icons.py [--force]
"""
import argparse
import io
import os
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

OUT = os.path.join(ROOT, "public", "skillicon")
CAT = os.path.join(NIKKE_SRC, "catalogs", "dp_catalog.ndb.dec")
CDB = v2.ROOT / "dp" / "chunk" / "store.cdb"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    os.makedirs(OUT, exist_ok=True)
    cat = sqlite3.connect(CAT)
    rows = cat.execute(
        "select file_id,key from files_chunktype where key like 'icons-skill(hd)%'").fetchall()
    assert rows, "icons-skill(hd) 池不存在"
    fid, key = rows[0]
    table = v2.cidx_map("dp")
    dec = zstd.ZstdDecompressor()
    bundle, _p, missing = v2.rebuild(cat, table, CDB, dec, fid, CDB.stat().st_size)
    if missing or not bundle:
        print("! bundle 不完整")
        sys.exit(1)

    env = UnityPy.load(io.BytesIO(bundle))
    ok = skip = fail = 0
    t0 = time.time()
    for o in env.objects:
        if o.type.name != "Texture2D":
            continue
        d = o.read()
        name = d.m_Name
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
        except Exception as e:
            fail += 1
            if fail <= 5:
                print(f"  ! {name}: {type(e).__name__}: {e}")

    total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT) if f.endswith(".webp"))
    print(f"图标导出完成：新增 {ok}，跳过 {skip}，失败 {fail}，"
          f"合计 {total/1048576:.1f} MB，耗时 {time.time()-t0:.0f}s")
    print(f"输出 {OUT}")


if __name__ == "__main__":
    main()
