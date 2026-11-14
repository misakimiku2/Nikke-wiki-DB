#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
角色头像（官方 roster 立绘）导出

数据源：dp 池 icons-char-mi(hd)_assets_mi_c010_00_s_<hash>.bundle
        Texture2D 256×512，透明底，头部到胸口，游戏内角色列表用的就是它

输出：public/charmi/<name>.webp      256×512（1x），透明底
      public/data/char_mi.json      {"total": n, "items": [name, ...]}

之前角色卡用的是站姿渲染图 + 猜头部位置的裁切（取 alpha 包围盒顶部 10% 的中心），
遇到举枪、宽帽檐、长发就会裁到枪管或胸口。官方 mi 头像不需要任何裁切启发式，
框图天然正确，直接替换。

  python build/export_char_mi.py --probe
  python build/export_char_mi.py [--force]
"""
import argparse
import io
import json
import os
import re
import sqlite3
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NIKKE_SRC = os.environ.get("NIKKE_SRC", r"E:/test/nikke_extract")
sys.path.insert(0, os.path.join(NIKKE_SRC, "scripts"))

import export_cg_v2 as v2  # noqa: E402
import UnityPy  # noqa: E402
import zstandard as zstd  # noqa: E402

OUT = os.path.join(ROOT, "public", "charmi")
META = os.path.join(ROOT, "public", "data", "char_mi.json")
CAT = os.path.join(NIKKE_SRC, "catalogs", "dp_catalog.ndb.dec")
CDB = v2.ROOT / "dp" / "chunk" / "store.cdb"

KEY_RE = re.compile(r"_assets_mi_(c\d+_\d+)(_maskoff)?_s?_[0-9a-f]{32}\.bundle$", re.I)


def collect():
    """同一角色可能有 maskoff 变体，优先取普通版"""
    cat = sqlite3.connect(CAT)
    rows = cat.execute(
        "select file_id, key from files_chunktype where lower(key) like 'icons-char-mi(hd)_assets_%'"
    ).fetchall()
    picked = {}
    for fid, key in rows:
        m = KEY_RE.search(key.lower())
        if not m:
            continue
        name, maskoff = m.group(1), m.group(2)
        if name in picked and not maskoff:
            continue
        if name in picked and maskoff:
            continue
        picked[name] = (fid, key, bool(maskoff))
    return cat, picked


def worker(job, quality=92):
    """子进程内自行开 catalog 连接（sqlite 连接不能跨进程共享）"""
    import UnityPy
    import zstandard as zstd
    import export_cg_v2 as v2

    name, fid, key = job
    dst = os.path.join(OUT, name + ".webp")
    cat = sqlite3.connect(CAT)
    try:
        table = v2.cidx_map("dp")
        cdb_size = CDB.stat().st_size
        dec = zstd.ZstdDecompressor()
        bundle, _p, missing = v2.rebuild(cat, table, CDB, dec, fid, cdb_size)
        if missing or not bundle or not bundle.startswith(b"UnityFS"):
            return {"name": name, "error": "bundle 不完整"}
        env = UnityPy.load(io.BytesIO(bundle))
        img = None
        for obj in env.objects:
            if obj.type.name != "Texture2D":
                continue
            cand = obj.read().image
            if img is None or cand.width * cand.height > img.width * img.height:
                img = cand
        if img is None:
            return {"name": name, "error": "没有 Texture2D"}
        img.convert("RGBA").save(dst, "WEBP", quality=quality, method=6)
        return {"name": name, "bytes": os.path.getsize(dst)}
    except Exception as e:
        return {"name": name, "error": f"{type(e).__name__}: {e}"}
    finally:
        cat.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--probe", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--quality", type=int, default=92)
    ap.add_argument("--workers", type=int, default=0)
    args = ap.parse_args()

    os.makedirs(OUT, exist_ok=True)
    os.makedirs(os.path.dirname(META), exist_ok=True)

    cat, picked = collect()
    cat.close()
    names = sorted(picked)
    if args.probe:
        names = names[:4]
    print(f"待处理 {len(names)} 个角色头像")

    todo, ok = [], []
    for name in names:
        dst = os.path.join(OUT, name + ".webp")
        if os.path.exists(dst) and not args.force:
            ok.append(name)
        else:
            fid, key, _maskoff = picked[name]
            todo.append((name, fid, key))
    print(f"  已有 {len(ok)}，待转 {len(todo)}")

    errors = []
    t0 = time.time()
    workers = args.workers or min(8, os.cpu_count() or 4)
    if todo:
        with ProcessPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(worker, j, args.quality): j for j in todo}
            for i, fut in enumerate(as_completed(futures), 1):
                r = fut.result()
                if r.get("error"):
                    errors.append(f"{r['name']}: {r['error']}")
                else:
                    ok.append(r["name"])
                if i % 40 == 0 or i == len(todo):
                    print(f"  {i}/{len(todo)}  {time.time()-t0:.0f}s", flush=True)

    names = sorted(set(ok))
    with open(META, "w", encoding="utf-8") as f:
        json.dump({"total": len(names), "items": names}, f,
                  ensure_ascii=False, separators=(",", ":"))

    total = sum(os.path.getsize(os.path.join(OUT, n + ".webp")) for n in names)
    print(f"\n完成 {len(names)} 张，失败 {len(errors)}，耗时 {time.time()-t0:.0f}s")
    print(f"  合计 {total/1048576:.0f} MB（平均 {total/max(1,len(names))/1024:.0f} KB）")
    for e in errors[:8]:
        print("  !", e)


if __name__ == "__main__":
    main()
