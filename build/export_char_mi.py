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
import pathlib
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


def make_from_art(quality=92):
    """给没有官方 mi 头像的 NPC 从全身立绘裁一张头肩像。

    客户端里只有 icons-char-mi 的角色才有官方头像；NPC 的 mi 缺失时会退回
    1024 全身图，卡片会和旁白一样是一条完整人形。这里按 alpha 包围盒取
    头顶往下 34% 的区域，统一成 256×512 的头肩像。

    头身比偏大的角色（小孩体型）34% 会一路裁到腰，用 RATIO_FIX 单独收紧。
    """
    from PIL import Image

    # 矮身角色：头在全身里占比小，34% 会裁进腰部
    RATIO_FIX = {
        "c9019_00": 0.27,
        "c975_00": 0.62,   # 媞美是只小狗，官方 mi 是狗脸充满画面，改从立绘裁半身
    }
    # 已生成也要强制用立绘重裁：媞美官方 mi 是狗脸充满画面，另两个走手工裁剪框
    FORCE_ART = {"c975_00", "c983_00", "c227_00"}
    # 人物被机械/轮椅挤到角落时，alpha 自动定位会失准，这里直接给原图裁剪框
    # (头部中心 x, 顶部 y, 宽, 高)，宽高比固定 1:2
    MANUAL_CROP = {
        "c983_00": (410, 45, 170, 340),   # 纳迪娅：坐在轮椅上，头在画面左上，左侧是支架
        "c227_00": (520, 258, 175, 350),  # 匹诺曹：被大型机械环包围，头在正中被机械挡
    }
    art_dir = os.path.join(ROOT, "public", "char")
    made = []
    if not os.path.isdir(art_dir):
        return made
    have = {f[:-5] for f in os.listdir(OUT) if f.endswith(".webp")}
    for fn in sorted(os.listdir(art_dir)):
        if not fn.endswith(".png"):
            continue
        stem = fn[:-4]
        if stem in have and stem not in FORCE_ART:
            continue
        try:
            im = Image.open(os.path.join(art_dir, fn)).convert("RGBA")
            bbox = im.getchannel("A").getbbox()
            if not bbox:
                continue
            x0, y0, x1, y1 = bbox
            fw, fh = x1 - x0, y1 - y0
            if stem in MANUAL_CROP:
                cx, top, cw, ch = MANUAL_CROP[stem]
            else:
                ch = fh * RATIO_FIX.get(stem, 0.34)
                cw = ch / 2
                if cw < fw * 0.28:
                    cw = fw * 0.28
                    ch = cw * 2
                # 头部水平中心只看头顶 12%：手持物、披风会把整张图的包围盒中心拉偏
                band = im.getchannel("A").crop(
                    (0, y0, im.width, int(y0 + fh * 0.12))).getbbox()
                cx = (band[0] + band[2]) / 2 if band else (x0 + x1) / 2
                top = y0 - fh * 0.015
            crop = im.crop((int(cx - cw / 2), int(top),
                            int(cx + cw / 2), int(top + ch)))
            crop.resize((256, 512), Image.LANCZOS).save(
                os.path.join(OUT, stem + ".webp"), "WEBP",
                quality=quality, method=6)
            made.append(stem)
        except Exception as e:
            print("  ! 头像裁剪失败", stem, e)
    return made


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

    extra = make_from_art(args.quality)
    if extra:
        print(f"  从全身立绘补头像 {len(extra)} 张")
    # 以磁盘上实际存在的头像为准：重跑时官方 mi 会被跳过，若只统计本次处理结果，
    # 之前从立绘裁出来的那批就会从 json 里丢掉，角色卡随即退回全身图
    names = sorted(p.stem for p in pathlib.Path(OUT).glob("*.webp"))
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
