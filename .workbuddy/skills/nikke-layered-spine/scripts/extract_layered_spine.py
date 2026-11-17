#!/usr/bin/env python3
"""从 NIKKE 游戏资源提取某个角色皮肤的【分层立绘素材】(BG 场景层 / FG 前景层)。

背景：部分皮肤的立绘不是单个 Spine 模型，而是三层叠加：
    spine_char/<主模型>   = 角色本体（上游 export_char_standing.py 已导出）
    spine_layer/<名>_bg   = 背景场景（镜子/衣架/植物等）
    spine_layer/<名>_fg   = 前景（如灰姑娘琉璃波光的更衣帘）
BG/FG 藏在 dp 资源池 spinestandingprefabgroup 的 *decadent* prefab bundle 里，
上游脚本只取主模型，不会导出这两层，故需要本脚本。

用法：
    python extract_layered_spine.py c515_00            # 提取 c515_00 的 FG/BG
    python extract_layered_spine.py c515_00 --scan     # 只扫描有哪些层，不落盘
    python extract_layered_spine.py --list             # 列出所有含 decadent prefab 的皮肤

输出：写到 <web>/public/spine_layer/<名>_fg/ 和 <名>_bg/：
    <名>_fg.skel / .atlas / .webp（图集 PNG 转无损 WebP，atlas 首行同步改名）
脚本会打印每层的动画名，便于确认是否含目标动画（如 expression_0）。

依赖：nikke_extract/scripts/export_cg_v2.py（rebuild / cidx_map）、UnityPy、zstandard、Pillow。
这些依赖在 nikke_extract 环境里已安装；运行前需把该 scripts 目录加入 sys.path。
"""
from __future__ import annotations

import argparse
import io
import re
import shutil
import sqlite3
import sys
import pathlib

# 定位上游工具链（脚本放在 nikke-web/.workbuddy/skills/...，需回溯到 nikke_extract）
HERE = pathlib.Path(__file__).resolve()
WEB_ROOT = None
EXTRACT_ROOT = None
for p in HERE.parents:
    if (p / "web" / "src").is_dir() and (p / "build").is_dir():
        WEB_ROOT = p
        cand = p.parent / "nikke_extract"
        if cand.is_dir():
            EXTRACT_ROOT = cand
        break
if EXTRACT_ROOT is None:
    # 允许用环境变量覆盖
    import os
    env = os.environ.get("NIKKE_EXTRACT")
    if env:
        EXTRACT_ROOT = pathlib.Path(env)

if EXTRACT_ROOT is None:
    sys.exit("找不到 nikke_extract 仓库，请设置环境变量 NIKKE_EXTRACT 指向它")

sys.path.insert(0, str(EXTRACT_ROOT / "scripts"))
import export_cg_v2 as v2  # noqa: E402

import UnityPy  # noqa: E402
import zstandard as zstd  # noqa: E402
from PIL import Image  # noqa: E402


def pool_paths(pool: str):
    cat = EXTRACT_ROOT / "catalogs" / f"{pool}_catalog.ndb.dec"
    cdb = v2.ROOT / pool / "chunk" / "store.cdb"
    if not cat.exists() or not cdb.exists():
        raise FileNotFoundError(f"资源池 {pool} 缺失：{cat} 或 {cdb}")
    return cat, cdb


def open_catalog(pool: str):
    cat, cdb = pool_paths(pool)
    con = sqlite3.connect(f"file:{cat}?mode=ro", uri=True)
    table = v2.cidx_map(pool)
    dec = zstd.ZstdDecompressor()
    return con, table, cdb, dec, cdb.stat().st_size


def find_prefab_bundle(con, skin: str):
    """按皮肤名（c515_00）找 decadent prefab 的 file_id / key。
    bundle key 形如：spinestandingprefabgroup(hd)_assets_spine/standing/c515/00_decadent_<hash>.bundle
    """
    cid = skin.split("_")[0]          # c515
    variant = skin.split("_")[1] if "_" in skin else "00"  # 00
    # bundle key 形如 spinestandingprefabgroup(hd)_assets_spine/standing/c515/00_decadent_<hash>.bundle
    # 注意 (hd) 在 key 前半段，不能把 %hd% 放在 pattern 末尾
    pat = f"%spinestandingprefabgroup(hd)%spine/standing/{cid}/{variant}_decadent%"
    rows = con.execute(
        "select file_id,key from files_chunktype where lower(key) like ?", (pat.lower(),)
    ).fetchall()
    if not rows:
        # 放宽：该角色的任意 variant 的 decadent hd
        pat2 = f"%spinestandingprefabgroup(hd)%spine/standing/{cid}/%decadent%"
        rows = con.execute(
            "select file_id,key from files_chunktype where lower(key) like ?", (pat2.lower(),)
        ).fetchall()
    return rows


def list_decadent_skins(con):
    keys = [r[0] for r in con.execute("select key from files_chunktype")]
    found = set()
    for k in keys:
        kl = k.lower()
        if "spinestandingprefabgroup" in kl and "decadent" in kl and kl.endswith(".bundle"):
            m = re.search(r"spine/standing/(c\d+)/(\d+)", kl)
            if m:
                found.add(f"{m.group(1)}_{m.group(2)}")
    return sorted(found)


def extract_bundle(con, table, cdb, dec, cdb_size, fid):
    bundle, _parts, missing = v2.rebuild(con, table, cdb, dec, fid, cdb_size)
    if missing or not bundle or not bundle.startswith(b"UnityFS"):
        raise RuntimeError("bundle 重组失败或不完整")
    return UnityPy.load(io.BytesIO(bundle))


def collect_layers(env, skin: str):
    """返回 {layer_name: {'atlas':str,'skel':bytes,'regions':set,'anims':list,'image':PIL}}"""
    out = {}
    for obj in env.objects:
        t = obj.type.name
        try:
            if t == "TextAsset":
                r = obj.read()
                nm = str(r.m_Name)
                if nm.endswith((".atlas", ".skel")) and ("_fg." in nm or "_bg." in nm):
                    d = r.m_Script
                    if isinstance(d, str):
                        d = d.encode("utf-8", "surrogateescape")
                    base = nm.rsplit(".", 1)[0]
                    out.setdefault(base, {})
                    out[base]["atlas" if nm.endswith(".atlas") else "skel"] = bytes(d)
            elif t == "Texture2D":
                r = obj.read()
                nm = str(r.m_Name)
                if ("_fg" in nm or "_bg" in nm) and r.image is not None:
                    out.setdefault(nm, {})["image"] = r.image.convert("RGBA")
        except Exception:
            continue
    # 解析动画名（skel 是 Spine binary：搬 spine-core 太重，这里只给 atlas region 概览；
    # 完整动画名请在浏览器用 spine-webgl 的 SkeletonBinary 读，或看 README 的验证方法）
    for base, d in out.items():
        atlas = d.get("atlas", "")
        if isinstance(atlas, bytes):
            atlas = atlas.decode("utf-8", "surrogateescape")
            d["atlas"] = atlas
        # atlas 是「贴图名 / bounds:... / rotate:...」逐行交替，只取非元数据行
        d["regions"] = [ln.strip() for ln in atlas.splitlines()
                        if ln.strip() and not re.match(r"^(size|filter|pma|scale|bounds|rotate|offsets|orig):", ln.strip())]
        d.pop("atlas_parsed", None)
    return out


def save_layer(base: str, data: dict, dest_root: pathlib.Path):
    if "atlas" not in data or "skel" not in data or "image" not in data:
        print(f"  [跳过] {base} 缺少 atlas/skel/image，实际有：{list(data)}")
        return False
    folder = dest_root / base
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{base}.skel").write_bytes(data["skel"])
    # PNG -> 无损 WebP（pma 图集：exact=True 不再二次乘 alpha）
    img_path = folder / f"{base}.webp"
    data["image"].save(img_path, "WEBP", lossless=True, exact=True)
    # atlas 首行的图片名 png -> webp；pma:true 原样保留
    atlas = data["atlas"]
    if isinstance(atlas, bytes):
        atlas = atlas.decode("utf-8", "surrogateescape")
    atlas = atlas.replace(f"{base}.png", f"{base}.webp", 1)
    (folder / f"{base}.atlas").write_text(atlas, encoding="utf-8")
    print(f"  [保存] {folder}  ({len(data['skel'])} skel bytes, {img_path.stat().st_size} webp bytes)")
    print(f"         贴图 region {len(data['regions'])} 个: {', '.join(data['regions'][:8])}")
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("skin", nargs="?", help="主模型名，如 c515_00")
    ap.add_argument("--scan", action="store_true", help="只扫描并打印层信息，不写盘")
    ap.add_argument("--list", action="store_true", help="列出所有含 decadent prefab 的皮肤")
    ap.add_argument("--pool", default="dp", help="资源池，默认 dp")
    ap.add_argument("--out", help="输出根目录，默认 <web>/public/spine_layer")
    args = ap.parse_args()

    con, table, cdb, dec, cdb_size = open_catalog(args.pool)

    if args.list:
        print("含 decadent prefab 的皮肤（不代表一定有 FG/BG 层）：")
        print("  " + ", ".join(list_decadent_skins(con)))
        return

    if not args.skin:
        ap.error("需要提供 skin 参数，或使用 --list")

    rows = find_prefab_bundle(con, args.skin)
    print(f"[{args.skin}] 命中 {len(rows)} 个 decadent prefab bundle")
    if not rows:
        print("  未找到。可先用 --list 确认该皮肤是否有 decadent prefab。")
        return

    all_layers = {}
    for fid, key in rows:
        print(f"  解析 {key.split('_assets_')[-1]}")
        try:
            env = extract_bundle(con, table, cdb, dec, cdb_size, fid)
        except Exception as e:
            print(f"    [失败] {e}")
            continue
        for base, data in collect_layers(env, args.skin).items():
            if base in all_layers:
                all_layers[base].update(data)
            else:
                all_layers[base] = data

    if not all_layers:
        print("  未发现任何 *_fg / *_bg 层 —— 该皮肤可能没有分层立绘，保持单层即可。")
        return

    print(f"  发现 {len(all_layers)} 个分层：{', '.join(all_layers)}")
    if args.scan:
        for base, d in all_layers.items():
            print(f"    {base}: {'有贴图' if 'image' in d else '无贴图'} / "
                  f"{'有skel' if 'skel' in d else '无skel'}")
        return

    dest = pathlib.Path(args.out) if args.out else WEB_ROOT / "public" / "spine_layer"
    for base, data in sorted(all_layers.items()):
        save_layer(base, data, dest)
    print("完成。记得在 web/src/data.ts 的 LAYERED_MODELS 登记该主模型，"
          "并重新构建 dist（public 素材需拷入）。")


if __name__ == "__main__":
    main()
