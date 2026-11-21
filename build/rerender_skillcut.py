#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
批量重渲「04_角色过场」里的角色大招 cut-in 静态图（skillcut 家族）。

旧静态图是上游早期渲染器的产物：可动关节处有灰色边框。这里用上游 runtime 的
render_skillcut_still.mjs（SeamFreeRenderer，与实时模型共用 spine_overrides.json）
按模型「角色段」动画重渲定格帧——透明底 2048²，覆盖上游
CG/04_角色过场/<名>.png（旧图备份到 CG/_backup_shadow/，沿用 rerender_spine.py
的惯例），随后 build_images.py 按 mtime 自动重转三档 webp（哈希不变，引用不动）。

定格帧约定（用户确认）：用大招的**待机姿势**（模型 idle 动画）而不是大招动作
帧——游戏里 cut-in 动画播完后停留的就是这套待机姿势，作为静态图最稳定。
没有 idle 动画的模型才退回大招段（挑选规则与 web/src/data.ts 的 pickBurstAnim
/ BURST_CHAR_SEGMENT 一致，两处同步维护）。段内仍做采样选帧：主指标彩色像素
数、并列比彩色占比与包围盒紧致度，避开白闪段（c017 的 skillcut_1 后半段整屏白）。

  python build/rerender_skillcut.py --probe    # 前 3 张，产物落 build/_probe_skillcut/，不覆盖原图
  python build/rerender_skillcut.py            # 全量，覆盖原图（先备份）
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.environ.get("NIKKE_SRC", r"E:/test/nikke_extract")
RUNTIME = os.path.join(SRC, "动态CG", "runtime")
BACKUP = os.path.join(SRC, "CG", "_backup_shadow")
SKILL_DIR = os.path.join(ROOT, "public", "spine_skillcut")
STAGING = os.path.join(SRC, "staging", "spine_char")
MANIFEST = os.path.join(ROOT, "public", "manifest.json")
PROBE_OUT = os.path.join(ROOT, "build", "_probe_skillcut")

PREFIX = "EventScene_"
# 与 web/src/data.ts 的 BURST_CHAR_SEGMENT 保持同步：骨架里真正带角色的段
BURST_CHAR_SEGMENT = {
    "c073_00_skillcut": "skillcut_2",
    "c093_skillcut": "skillcut_0",
    "c094_00_skillcut": "skillcut_2_OFF_MOVE_BIG",
    "c105_00_skillcut": "skillcut_2",
    "c191_02_skillcut": "skillcut_2",
    "c223_01_skillcut": "skillcut_2",
    "c234_00_skillcut": "skillcut_2",
    "c281_02_skillcut": "skillcut_2",
    "c331_00_skillcut": "skillcut_2",
    "c411_00_skillcut": "skillcut_2",
    "c580_01_skillcut": "skillcut_2",
    "c582_00_skillcut": "skillcut_0",
    "c833_00_skillcut": "skillcut_2",
}
EXACT_ANIMS = [r"^skillcut_1_all$", r"^skillcut_1$", r"^skillcut$", r"^skill_cut$"]


def pick_anim(model, anims):
    """定格动画：待机帧优先（idle / Idle），没有 idle 才退回大招段
    （与 data.ts 的 pickBurstAnim 同规则：覆盖表 → 精确名 → 含 skil 的编号最小者）"""
    names = [a["name"] for a in anims]
    idle = [n for n in names if n.lower() == "idle"] \
        or [n for n in names if n.lower().startswith("idle")
            and not re.search(r"_bg$|_character$", n)]
    if idle:
        return idle[0]
    fix = BURST_CHAR_SEGMENT.get(model)
    if fix and fix in names:
        return fix
    for p in EXACT_ANIMS:
        for n in names:
            if re.search(p, n):
                return n
    cand = [n for n in names
            if "skil" in n.lower() and not re.search(r"_bg$|_character$", n)]
    if cand:
        def num(n):
            m = re.findall(r"(\d+)", n)
            return int(m[-1]) if m else 0
        return sorted(cand, key=num)[0]
    return None


def collect():
    """04 分类里能映射到实时模型目录的 skillcut 条目：[(模型, 模型目录, 目标png, CG名)]"""
    with open(MANIFEST, encoding="utf-8") as f:
        items = json.load(f).get("items", [])
    out, missing = [], []
    for it in items:
        if it.get("category") != "04_角色过场" or not it.get("name", "").startswith(PREFIX):
            continue
        model = it["name"][len(PREFIX):]
        src = os.path.join(SRC, it.get("src", "").replace("/", os.sep))
        dir_ = None
        for base in (SKILL_DIR, STAGING):
            d = os.path.join(base, model)
            if os.path.exists(os.path.join(d, model + ".atlas")) \
                    and os.path.exists(os.path.join(d, model + ".skel")):
                dir_ = d
                break
        if dir_ and os.path.exists(src):
            out.append((model, dir_, src, it["name"]))
        else:
            missing.append(it["name"])
    return out, missing


def render(item):
    model, dir_, src, name = item
    try:
        info = subprocess.run(
            ["node", "probe_skillcut_info.mjs", dir_, model],
            cwd=RUNTIME, capture_output=True, text=True, timeout=120,
        )
        if info.returncode != 0:
            return (name, False, (info.stderr or "").strip().splitlines()[-1:] or ["?"])
        anims = json.loads(info.stdout).get("anims", [])
        anim = pick_anim(model, anims)
        if not anim:
            return (name, False, [f"没有可识别的大招动画：{[a['name'] for a in anims]}"])
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "still.png")
            r = subprocess.run(
                ["node", "render_skillcut_still.mjs", dir_, model, anim, out, "12", "2048"],
                cwd=RUNTIME, capture_output=True, text=True, timeout=180,
            )
            if r.returncode != 0:
                return (name, False, (r.stderr or "").strip().splitlines()[-1:] or ["?"])
            meta = json.loads(r.stdout.strip().splitlines()[-1])
            if PROBE:
                os.makedirs(PROBE_OUT, exist_ok=True)
                dst = os.path.join(PROBE_OUT, name + ".png")
            else:
                rel = os.path.relpath(src, os.path.join(SRC, "CG"))
                dst = os.path.join(BACKUP, rel.replace("\\", "__").replace("/", "__"))
                if not os.path.exists(dst):
                    os.makedirs(os.path.dirname(dst), exist_ok=True)
                    shutil.copy2(src, dst)
                dst = src
            shutil.copyfile(out, dst)
            return (name, True, f"{anim}@{meta['time']}s colored={meta['colored']}")
    except Exception as e:
        return (name, False, [str(e)])


PROBE = False


def main():
    global PROBE
    ap = argparse.ArgumentParser()
    ap.add_argument("--probe", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()
    PROBE = args.probe

    items, missing = collect()
    print(f"待重渲 {len(items)} 张 skillcut 定格帧（04_角色过场）")
    if missing:
        print(f"  无实时模型/缺源图 {len(missing)} 张，维持旧图：" + "、".join(missing[:10])
              + ("…" if len(missing) > 10 else ""))
    if args.probe:
        items = items[:3]
    elif args.limit:
        items = items[: args.limit]

    t0 = time.time()
    ok = fail = 0
    errors = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(render, it): it for it in items}
        for i, fut in enumerate(as_completed(futures), 1):
            name, good, msg = fut.result()
            if good:
                ok += 1
                if args.probe:
                    print(f"  ✓ {name}: {msg}")
            else:
                fail += 1
                errors.append(f"{name}: {msg}")
            if i % 20 == 0 or i == len(items):
                print(f"  {i}/{len(items)}  成功 {ok} 失败 {fail}  {time.time()-t0:.0f}s", flush=True)

    print(f"\n完成：成功 {ok}，失败 {fail}，耗时 {(time.time()-t0)/60:.1f} 分钟")
    if args.probe:
        print(f"  试跑产物：{PROBE_OUT}（未覆盖原图）")
    elif ok:
        print("  下一步：python build/build_images.py  # 按 mtime 重转这批的三档 webp")
    for e in errors[:8]:
        print("  !", e)


if __name__ == "__main__":
    main()
