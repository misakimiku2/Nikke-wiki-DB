#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CG 图片三档转码

把 CG/ 下的成品插画转成 400 / 1280 / 2048 三档 WebP，
文件名用内容哈希（防止按原名猜测批量抓取），并输出 manifest.json。

  python build/build_images.py --probe     # 先抽 5 张试跑，看体积和时间
  python build/build_images.py             # 全量（增量，已转的跳过）
  python build/build_images.py --force     # 强制重转
"""
import argparse
import glob
import hashlib
import json
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.environ.get("NIKKE_SRC", r"E:/test/nikke_extract")
OUT = os.path.join(ROOT, "public", "img")
MANIFEST = os.path.join(ROOT, "public", "manifest.json")
DB_PATH = os.path.join(ROOT, "data", "nikke.db")

TIERS = [
    ("s", 400,  80),
    ("m", 1280, 85),
    ("l", 2048, 88),
]


def short_hash(text):
    return hashlib.md5(text.encode("utf-8")).hexdigest()[:16]


def collect():
    """收集待转图片：只取成品插画，跳过 spine 图集贴图"""
    items = []
    for path in glob.glob(os.path.join(SRC, "CG", "**", "*.png"), recursive=True):
        name = os.path.basename(path)[:-4]
        if name.endswith(".spine"):
            continue
        rel = os.path.relpath(path, SRC).replace("\\", "/")
        if "_backup_shadow" in rel:
            continue          # 旧渲染版本的备份目录，不进图库
        parts = rel.split("/")
        category = parts[1] if len(parts) > 2 else ""
        sub = "/".join(parts[2:-1])
        items.append({
            "name": name,
            "hash": short_hash(name),
            "src": path,
            "rel": rel,
            "category": category,
            "sub": sub,
        })
    return items


def process_one(item, force=False):
    """单张图转三档，返回 manifest 条目"""
    from PIL import Image

    h = item["hash"]
    entry = {
        "name": item["name"],
        "hash": h,
        "category": item["category"],
        "sub": item["sub"],
        "src": item["rel"],
        "variants": {},
    }

    done = all(os.path.exists(os.path.join(OUT, t[0], h + ".webp")) for t in TIERS)
    if done and not force:
        try:
            with Image.open(item["src"]) as im:
                entry["w"], entry["h"] = im.size
        except Exception:
            pass
        for key, width, _ in TIERS:
            p = os.path.join(OUT, key, h + ".webp")
            entry["variants"][key] = {"w": width, "bytes": os.path.getsize(p)}
        entry["cached"] = True
        return entry

    try:
        with Image.open(item["src"]) as im:
            im = im.convert("RGBA") if im.mode in ("RGBA", "LA", "P") else im.convert("RGB")
            ow, oh = im.size
            entry["w"], entry["h"] = ow, oh
            for key, target_w, quality in TIERS:
                dirpath = os.path.join(OUT, key)
                os.makedirs(dirpath, exist_ok=True)
                if ow <= target_w:
                    scaled = im
                else:
                    ratio = target_w / ow
                    scaled = im.resize((target_w, max(1, round(oh * ratio))), Image.LANCZOS)
                out_path = os.path.join(dirpath, h + ".webp")
                scaled.save(out_path, "WEBP", quality=quality, method=4)
                entry["variants"][key] = {"w": scaled.size[0], "bytes": os.path.getsize(out_path)}
        return entry
    except Exception as e:
        entry["error"] = f"{type(e).__name__}: {e}"
        return entry


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--probe", action="store_true", help="只抽 5 张试跑")
    ap.add_argument("--force", action="store_true", help="强制重转")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=0)
    args = ap.parse_args()

    if not os.path.isdir(SRC):
        print(f"! 源目录不存在：{SRC}")
        sys.exit(1)

    items = collect()
    print(f"待处理 {len(items)} 张成品插画")

    if args.probe:
        items = items[:: max(1, len(items) // 5)][:5]
        print(f"试跑模式：抽 {len(items)} 张")
    elif args.limit:
        items = items[: args.limit]

    workers = args.workers or min(8, (os.cpu_count() or 4))
    t0 = time.time()
    results = []
    errors = []

    with ProcessPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(process_one, it, args.force): it for it in items}
        for i, fut in enumerate(as_completed(futures), 1):
            try:
                r = fut.result()
            except Exception as e:
                errors.append(str(e))
                continue
            if r.get("error"):
                errors.append(f"{r['name']}: {r['error']}")
            else:
                results.append(r)
            if i % 50 == 0 or i == len(items):
                elapsed = time.time() - t0
                rate = i / elapsed if elapsed else 0
                eta = (len(items) - i) / rate if rate else 0
                print(f"  {i}/{len(items)}  {rate:.1f} 张/秒  剩余 {eta/60:.1f} 分钟", flush=True)

    elapsed = time.time() - t0
    total_bytes = {k: sum(r["variants"].get(k, {}).get("bytes", 0) for r in results) for k, _, _ in TIERS}

    print(f"\n完成 {len(results)} 张，失败 {len(errors)} 张，耗时 {elapsed/60:.1f} 分钟")
    for k, w, q in TIERS:
        print(f"  {k} ({w}px, q{q}):  {total_bytes[k]/1048576:7.1f} MB")
    print(f"  合计:  {sum(total_bytes.values())/1048576:7.1f} MB" + ("  （含缓存命中）" if any(r.get('cached') for r in results) else ""))
    if errors:
        print("\n失败样例：")
        for e in errors[:5]:
            print("  " + e)

    if not args.probe:
        # 合并已有 manifest（增量场景下保留之前转好的条目）
        # 但只保留本次扫描到的名字——被移出 CG/ 的图（如 _backup_shadow 备份）要一起清掉
        old = {}
        if os.path.exists(MANIFEST) and not args.force:
            try:
                prev = json.load(open(MANIFEST, encoding="utf-8"))
                names = {it["name"] for it in items}
                old = {x["name"]: x for x in prev.get("items", []) if x["name"] in names}
            except Exception:
                old = {}
        for r in results:
            old[r["name"]] = r

        # 按数据库补 link_count，方便前端过滤「有剧情上下文的 CG」
        try:
            import sqlite3
            con = sqlite3.connect(DB_PATH)
            link_map = dict(con.execute("SELECT name, link_count FROM cg_assets"))
            con.close()
            for name, entry in old.items():
                entry["links"] = link_map.get(name, 0)
        except Exception:
            pass

        # 补上跳过的 spine 图集（前端可能要用原图）
        manifest = {
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "source": SRC,
            "tiers": [{"key": k, "width": w, "quality": q} for k, w, q in TIERS],
            "total": len(old),
            "items": sorted(old.values(), key=lambda x: x["name"]),
        }
        os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
        with open(MANIFEST, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, separators=(",", ":"))
        print(f"\nmanifest: {MANIFEST}  ({os.path.getsize(MANIFEST)/1024:.0f} KB, {len(old)} 条)")


if __name__ == "__main__":
    main()
