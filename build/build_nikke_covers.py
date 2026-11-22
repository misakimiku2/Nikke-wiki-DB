#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""给「妮姬个人剧情」批量指定封面：该角色的**大招动画待机静帧**。

静帧就是 04_角色过场 里已经渲染好的 EventScene_<skillcut> CG（透明底，
rerender_skillcut.py 按 idle 姿势定格的那批），原图在 public/img/l/<hash>.webp。
这里不渲染、不新增 CG，只做「单元 -> CG hash」的映射 + 写 overrides，再调用
build_story_covers.py 现裁 3:4 封面（和主线/活动剧情完全相同的流程）。

映射链（全部读现有 manifest，不引入新的手工表）：
    story_index(cat=nikke) --char_stories.json--> 角色 id
      --characters.json.code--> cXXX
      --char_spine_skillcut.json bySkin/byChar--> skillcut 模型名
      --cg_index.json(n=EventScene_<模型>)--> CG hash

规则：
  * 同一角色卡有多个皮肤模型时取 cXXX_00（基础款）；byChar 映射直接取。
  * 联动 / NPC 剧情（d_nikke_c_* / d_nikke_ce*）在 char_stories 里没有角色，
    跳过；没有 skillcut 模型的角色（belorta/delta/ether/mica/mihara/n102/neve）
    也跳过，维持原状。
  * 已经存在的「带 crop 参数」的手动覆盖优先保留，不被批量覆盖。
  * --dry-run 只打印计划，不写任何文件。

用法：
    python build/build_nikke_covers.py --dry-run     # 先看会改哪些
    python build/build_nikke_covers.py               # 写 overrides + 生成封面
    python build/build_nikke_covers.py --no-render   # 只写 overrides，不重生成图
"""
import argparse
import json
import os
import subprocess
import sys
from collections import Counter

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = lambda name: os.path.join(ROOT, "public", "data", name)
STORY_INDEX = D("story_index.json")
CHARACTERS = D("characters.json")
CHAR_STORIES = D("char_stories.json")
SKILLCUT = D("char_spine_skillcut.json")
CG_INDEX = D("cg_index.json")
OVERRIDES = os.path.join(ROOT, "build", "cg_cover_overrides.json")
COVER_BUILDER = os.path.join(ROOT, "build", "build_story_covers.py")


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def resolve_plan():
    """返回 (计划列表, 统计)。每项 = {id, bucket, title, cid, code, model, hash, action}"""
    idx = load_json(STORY_INDEX)
    chars = {c["id"]: c for c in load_json(CHARACTERS)["items"]}
    cs = load_json(CHAR_STORIES)["items"]
    skill = load_json(SKILLCUT)
    cg = load_json(CG_INDEX)

    # story_id -> 角色 id（char_stories 里只有个人/宝物剧情，不含咨询）
    story2cid = {}
    for cid, e in cs.items():
        for s in e["stories"]:
            story2cid[s["id"]] = int(cid)

    cg_by_name = {it["n"]: it["h"] for it in cg["items"]}
    by_skin = skill.get("bySkin", {})
    by_char = skill.get("byChar", {})

    def skillcut_model(code):
        """角色 code(cXXX) -> 优先的 skillcut 模型名；找不到返回 None。"""
        if code in by_char:
            return by_char[code]
        skins = sorted(k for k in by_skin if k.startswith(code + "_"))
        if not skins:
            return None
        base = next((k for k in skins if k.endswith("_00")), skins[0])
        return by_skin[base]

    # 现有覆盖：带 crop 参数的手工项保留
    existing = load_json(OVERRIDES) if os.path.exists(OVERRIDES) else {}
    manual = {k: v for k, v in existing.items()
              if isinstance(v, dict) and v.get("crop")}

    plan, stat = [], Counter()
    current_cover = {u["id"]: u.get("cover") for u in idx.get("items", [])}
    for u in idx.get("items", []):
        if u.get("cat") != "nikke":
            continue
        uid = u["id"]
        cid = story2cid.get(uid)
        if cid is None:
            stat["跳过·联动/NPC（无角色映射）"] += 1
            continue
        ch = chars.get(cid)
        code = ch.get("code") if ch else None
        if not code:
            stat["跳过·角色无 code"] += 1
            continue
        model = skillcut_model(code)
        if not model:
            stat["跳过·角色无 skillcut 模型"] += 1
            continue
        h = cg_by_name.get("EventScene_" + model)
        if not h:
            stat["跳过·模型无 CG（未渲染静帧）"] += 1
            continue
        key = str(uid)
        if key in manual:
            stat["保留·手工 crop 覆盖"] += 1
            continue
        old = existing.get(key)
        had_cover = bool(current_cover.get(uid))
        action = "新增"
        if isinstance(old, str) and old == h:
            action = "已是该静帧"
            stat["已是该静帧"] += 1
        elif old is not None:
            action = "替换旧覆盖"
            stat["替换旧覆盖"] += 1
        elif had_cover:
            action = "替换自动封面"
            stat["替换自动封面（原为 fuzzy 匹配）"] += 1
        else:
            stat["新增"] += 1
        plan.append(dict(id=uid, bucket=u["bucket"], title=u["title"], cid=cid,
                         code=code, model=model, hash=h, action=action, old=old))
    return plan, stat


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="只打印计划，不写文件")
    ap.add_argument("--no-render", action="store_true", help="只写 overrides，不重生成封面")
    args = ap.parse_args()

    plan, stat = resolve_plan()
    print(f"妮姬个人剧情封面计划：{len(plan)} 项待写入")
    for k, v in stat.items():
        print(f"  {k}: {v}")

    if not plan:
        print("无需修改。")
        return
    print("\n样例（前 10）：")
    for p in plan[:10]:
        print(f"  #{p['id']:<4} {p['bucket']:<38} {p['code']:<6} "
              f"{p['model']:<24} -> {p['hash']}  [{p['action']}]")
    if args.dry_run:
        print("\n--dry-run：未写任何文件。")
        return

    # 写 overrides（合并，保留主线/活动及其他手工项）
    existing = load_json(OVERRIDES) if os.path.exists(OVERRIDES) else {}
    for p in plan:
        existing[str(p["id"])] = p["hash"]
    with open(OVERRIDES, "w", encoding="utf-8") as f:
        json.dump(existing, f, ensure_ascii=False, indent=2, sort_keys=False)
    print(f"\n已写入 {OVERRIDES}（{len(plan)} 项）")

    if args.no_render:
        print("--no-render：跳过封面生成。")
        return

    ids = ",".join(str(p["id"]) for p in plan)
    print(f"调用 build_story_covers.py --only <{len(plan)} 个 id> --force 现裁封面…")
    r = subprocess.run([sys.executable, COVER_BUILDER, "--only", ids, "--force"],
                       cwd=ROOT)
    if r.returncode != 0:
        print(f"! 封面生成失败（exit {r.returncode}）")
        sys.exit(r.returncode)


if __name__ == "__main__":
    main()
