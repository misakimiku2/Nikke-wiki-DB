#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""剧情 ↔ CG 全链路核查（只读，不改动任何数据）。

逐层对账：
  1. 构建脚本是否还引用人工映射表 script_cg_map.json
  2. 上游 CG索引 与 nikke.db.cg_links 的 (line_key, cg) 差异
  3. 人工映射表条目在当前库中的覆盖情况
  4. cg_links 的资产 / manifest / webp 可用性
  5. 行级结构（撞车 key、越界、单行多 CG）
  6. 导出的 story/*.json 事件与数据库是否一致
  7. 章节 / 活动归属异常（跨章、跨活动）
  8. 动态 CG（实时 Spine 模型）触发情况
  9. 图集贴图页误入 manifest 的情况

用法：
  python build/audit_cg.py                # 打印报告
  python build/audit_cg.py --out 报告.md   # 同时写文件
"""
import argparse, json, os, re, sqlite3, sys
from collections import Counter, defaultdict

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.environ.get("NIKKE_SRC", r"E:/test/nikke_extract")
DB = os.path.join(ROOT, "data", "nikke.db")
MANIFEST = os.path.join(ROOT, "public", "manifest.json")
STORY_DIR = os.path.join(ROOT, "public", "data", "story")
STORY_INDEX = os.path.join(ROOT, "public", "data", "story_index.json")
SPINE_META = os.path.join(ROOT, "public", "data", "spine_models.json")
CG_INDEX = os.path.join(SRC, "CG索引", "剧情CG对照索引.json")
SCRIPT_MAP = os.path.join(ROOT, "build", "script_cg_map.json")
CG_DIR = os.path.join(SRC, "CG")
IMG_L = os.path.join(ROOT, "public", "img", "l")
BUILD_DIR = os.path.join(ROOT, "build")

lines = []
def p(s=""):
    lines.append(str(s))
    print(s)

def loadj(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="")
    a = ap.parse_args()
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    man = loadj(MANIFEST, {}).get("items", [])
    man_by_name = {it["name"]: it for it in man}
    spine = set(loadj(SPINE_META, {}).get("items", []))
    story_idx = {u["id"]: u for u in loadj(STORY_INDEX, {}).get("items", [])}

    p("# 剧情 ↔ CG 全链路核查报告")
    p()
    p(f"- 数据库：`{DB}`")
    p(f"- 上游：`{SRC}`")
    p(f"- manifest CG {len(man)} 个 / 实时 Spine 模型 {len(spine)} 个")
    p()

    # ---- 1. 人工映射表是否还在使用 ----
    p("## 1. 人工映射表 script_cg_map.json")
    users = []
    for f in os.listdir(BUILD_DIR):
        if f.endswith((".py", ".mjs")) and f != "audit_cg.py":
            txt = open(os.path.join(BUILD_DIR, f), encoding="utf-8", errors="replace").read()
            if "script_cg_map" in txt:
                users.append(f)
    p(f"- 当前 `build/` 中引用它的脚本：**{users or '无'}**")
    if not users:
        p("- ⚠️ 人工校对表已失效：新版 `build_db.py` 改为只解析 `.mpk`，不再读取该表。")
    p()

    # ---- 2. 上游索引 vs DB ----
    p("## 2. 上游 `剧情CG对照索引` vs `cg_links`")
    db_pairs = defaultdict(set)
    db_cg_units = defaultdict(set)
    for lk, cg, bucket in con.execute("""
        SELECT l.line_key, c.cg_name, u.bucket FROM cg_links c
        JOIN story_lines l ON l.id=c.line_id JOIN story_units u ON u.id=c.unit_id"""):
        if lk:
            db_pairs[(lk, cg)].add(bucket)
        db_cg_units[cg].add(bucket)
    idx = loadj(CG_INDEX, []) or []
    up_pairs = set()
    for r in idx:
        lk, cg = (r.get("台词ID") or "").strip(), (r.get("CG名") or "").strip()
        if lk and cg:
            up_pairs.add((lk, cg))
    only_up = sorted(up_pairs - set(db_pairs))
    only_db = sorted(set(db_pairs) - up_pairs)
    p(f"- 上游 (line_key, cg) 对 {len(up_pairs)}，当前库 {len(db_pairs)}")
    p(f"- 上游有库里无：**{len(only_up)}**；库里有上游无：**{len(only_db)}**")
    for lk, cg in only_up[:12]:
        p(f"  - 缺：`{lk}` → `{cg}`")
    p()

    # ---- 3. 人工表覆盖 ----
    p("## 3. `script_cg_map.json` 条目覆盖")
    sm = loadj(SCRIPT_MAP, {}) or {}
    seg_groups = defaultdict(set)
    for g, bucket in con.execute("""
        SELECT s.group_key, u.bucket FROM story_segments s JOIN story_units u ON u.id=s.unit_id"""):
        seg_groups[g].add(bucket)
    ok, missing = 0, []
    for g, cgs in sm.items():
        for cg in cgs:
            if any(b in db_cg_units.get(cg, set()) for b in seg_groups.get(g, set())):
                ok += 1
            else:
                missing.append((g, cg, sorted(seg_groups.get(g, set())), sorted(db_cg_units.get(cg, set()))))
    total = sum(len(v) for v in sm.values())
    p(f"- 人工表 {total} 条；当前库对应单元有该 CG {ok} 条，**缺失 {len(missing)} 条**")
    for g, cg, want, got in missing[:25]:
        p(f"  - `{g}` → `{cg}` 期望={want} 实际={got}")
    p()

    # ---- 4. 资产可用性 ----
    p("## 4. 资产 / 图片可用性")
    assets = {r[0] for r in con.execute("SELECT name FROM cg_assets")}
    linked = {r[0] for r in con.execute("SELECT DISTINCT cg_name FROM cg_links")}
    no_asset = sorted(linked - assets)
    no_manifest = sorted(n for n in linked if n not in man_by_name)
    no_webp = sorted(n for n in linked if n in man_by_name and
                     not os.path.exists(os.path.join(IMG_L, man_by_name[n]["hash"] + ".webp")))
    stale = []
    for n in linked & assets & man_by_name.keys():
        it = man_by_name[n]
        src = os.path.join(SRC, it.get("src", "").replace("/", os.sep))
        dst = os.path.join(IMG_L, it["hash"] + ".webp")
        if os.path.exists(src) and os.path.exists(dst) and os.path.getmtime(src) > os.path.getmtime(dst) + 2:
            stale.append(n)
    p(f"- 链接涉及的 CG {len(linked)} 个：`cg_assets` 无记录 {len(no_asset)}，manifest 无图 {len(no_manifest)}，webp 缺失 {len(no_webp)}，webp 陈旧 {len(stale)}")
    if no_asset:
        p("- `cg_assets` 无记录的 CG：" + "、".join(f"`{n}`" for n in no_asset[:30]))
    if no_manifest:
        p("- manifest 无图的 CG：" + "、".join(f"`{n}`" for n in no_manifest[:30]))
    p()

    # ---- 5. 行级结构 ----
    p("## 5. 行级结构")
    collide = con.execute("""
        SELECT line_key, COUNT(DISTINCT unit_id) u, COUNT(*) n FROM story_lines
        GROUP BY line_key HAVING u>1 ORDER BY u DESC, n DESC""").fetchall()
    collide_with_cg = []
    for lk, u, n in collide:
        c = con.execute("""SELECT COUNT(DISTINCT cu.id) FROM cg_links c
            JOIN story_lines l ON l.id=c.line_id JOIN story_units cu ON cu.id=c.unit_id
            WHERE l.line_key=?""", (lk,)).fetchone()[0]
        if c > 1:
            collide_with_cg.append((lk, u, c))
    multi = con.execute("""SELECT line_id, COUNT(*) n FROM cg_links GROUP BY line_id
        HAVING n>2""").fetchall()
    p(f"- 撞车 line_key {len(collide)} 个；其中把 CG 串到多个单元的 **{len(collide_with_cg)}** 个")
    for lk, u, c in collide_with_cg[:15]:
        p(f"  - `{lk}` 出现在 {u} 个单元，CG 挂到 {c} 个单元")
    p(f"- 单行挂 >2 个 CG 的行：{len(multi)}")
    p()

    # ---- 6. 导出产物一致性 ----
    p("## 6. 导出 story/*.json 事件")
    tot_ev = 0
    bad_hash, bad_idx, bad_name = [], [], []
    per_unit = {}
    for f in os.listdir(STORY_DIR):
        if not f.endswith(".json"): continue
        uid = int(f[:-5])
        if uid not in story_idx:
            continue          # 已无台词的陈旧分片，前端不会加载
        d = loadj(os.path.join(STORY_DIR, f), {})
        ev = 0
        for s in d.get("segments", []):
            nlines = len(s.get("l", []))
            for at, refs in s.get("e", []):
                ev += 1
                if not (0 <= at < max(1, nlines)):
                    bad_idx.append((uid, at, nlines))
                for r in refs:
                    if r.get("h") not in {it["hash"] for it in man}:
                        bad_hash.append((uid, r.get("h")))
                    if r.get("n") not in man_by_name:
                        bad_name.append((uid, r.get("n")))
        tot_ev += ev
        per_unit[uid] = ev
    db_ev = con.execute("SELECT COUNT(*) FROM cg_links").fetchone()[0]
    p(f"- 数据库 cg_links {db_ev} 条 → 导出事件 {tot_ev} 处（按行合并后）")
    p(f"- 事件 hash 不在 manifest：{len(bad_hash)}；CG 名不在 manifest：{len(bad_name)}；行下标越界：{len(bad_idx)}")
    for uid, h in bad_hash[:10]:
        p(f"  - 单元 {uid} 的 hash `{h}` 找不到图片")
    p()

    # ---- 7. 章节 / 活动归属 ----
    p("## 7. 章节 / 活动归属异常")
    chap_bad, cross_event = [], []
    for cg, bucket, ch in con.execute("""
        SELECT DISTINCT c.cg_name, u.bucket, u.chapter_no FROM cg_links c
        JOIN story_units u ON u.id=c.unit_id"""):
        m = re.search(r"Chap_(\d{2})", cg)
        if m and ch is not None and int(m.group(1)) != ch:
            chap_bad.append((cg, bucket, ch))
        ev = re.match(r"EventScene_([a-z0-9]+)_", cg, re.I)
        if ev and bucket.startswith("d_main_") and ev.group(1).lower() not in ("chap", "main"):
            cross_event.append((cg, bucket))
    p(f"- CG 名章节号与所在单元章号不符：{len(chap_bad)}（含游戏中合理复用/闪回，需人工甄别）")
    for cg, bucket, ch in chap_bad[:12]:
        p(f"  - `{cg}` → `{bucket}`（第 {ch} 章）")
    p(f"- 活动 CG 出现在主线单元：{len(cross_event)}")
    for cg, bucket in cross_event[:12]:
        p(f"  - `{cg}` → `{bucket}`")
    p()

    # ---- 8. 动态 CG ----
    p("## 8. 实时 Spine 模型触发")
    sp_events = Counter()
    for f in os.listdir(STORY_DIR):
        if not f.endswith(".json"): continue
        d = loadj(os.path.join(STORY_DIR, f), {})
        for s in d.get("segments", []):
            for at, refs in s.get("e", []):
                for r in refs:
                    if r.get("d"):
                        sp_events[r["d"]] += 1
    p(f"- 阅读器中会播放实时模型的 CG：{len(sp_events)} 个，共 {sum(sp_events.values())} 处")
    for n, k in sp_events.most_common(12):
        p(f"  - {k}× `{n}`")
    p()

    # ---- 9. 图集页误入 manifest ----
    p("## 9. 图集贴图页误入 manifest")
    suspects = []
    for root, dirs, files in os.walk(CG_DIR):
        for f in files:
            if not f.endswith(".atlas"): continue
            text = open(os.path.join(root, f), encoding="utf-8", errors="replace").read()
            for block in re.split(r"\n\s*\n", text):
                first = block.strip().splitlines()[0].strip() if block.strip() else ""
                if not first or ":" in first: continue
                stem, ext = os.path.splitext(first)
                if ".spine" not in stem and ext.lower() in (".png", ""):
                    suspects.append((f, first, stem in man_by_name))
    p(f"- 不带 `.spine` 的图集页 {len(suspects)} 个（其中被收进 manifest {sum(1 for _,_,b in suspects if b)} 个）")
    for f, pg, inman in suspects[:12]:
        p(f"  - `{f}` → `{pg}` 在manifest={inman}")
    p()

    # ---- 10. 角色过场分类 ----
    p("## 10. `04_角色过场` 分类被当作剧情 CG")
    cut = list(con.execute("""
        SELECT c.cg_name, u.bucket FROM cg_links c JOIN story_units u ON u.id=c.unit_id
        JOIN cg_assets a ON a.name=c.cg_name WHERE a.category='04_角色过场'"""))
    p(f"- {len(set(r[0] for r in cut))} 个 CG、{len(cut)} 条链接")
    p("- 分布：" + "、".join(f"`{b}`×{n}" for b, n in Counter(r[1] for r in cut).most_common()))
    p("- 说明：这些主要是联动活动（EVA / RE0 / Nier / Persona 等）CG，多数为正常插画，需逐张目视确认是否混有模型切片。")
    p()

    con.close()
    report = "\n".join(lines)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(report + "\n")
        print(f"\n报告已写入 {a.out}")

if __name__ == "__main__":
    main()
