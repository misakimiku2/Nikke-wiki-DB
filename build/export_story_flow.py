#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""主线/活动/个人等剧情的选项分支流导出（格式同 counsel_flow.json）。

复用 export_counsel_flow.parse_mpk / candidates_of / confirm / union_ok：
  - 脚本表 next 指针解析（<group>_NN 锚点游走）
  - speaker_id='Choice' 连续行 = 选项组
  - 组首行前向指针确认 + 路径并集覆盖校验

输出 public/data/story_flow.json:
  {"total": n, "items": {"<group_key>": {"next": {...}, "choices": [[...], ...]}}}
"""
import json, os, sqlite3, sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, "data", "nikke.db")
OUT = os.path.join(ROOT, "public", "data", "story_flow.json")
MPK_DIR = os.path.join(os.environ.get("NIKKE_SRC", r"E:/test/nikke_extract"), "staticdata")

from export_counsel_flow import parse_mpk, candidates_of, confirm, union_ok

# 各分类对应的脚本表前缀（按优先级尝试）
TABLE_TPLS = [
    "ScenarioDialogTable.{}.mpk",
    "EventScenarioDialogTable.{}.mpk",
    "AttractiveScenarioDialogTable.{}.mpk",
]


def find_mpk(gkey):
    for tpl in TABLE_TPLS:
        p = os.path.join(MPK_DIR, tpl.format(gkey))
        if os.path.exists(p):
            return p
    return None


def main():
    con = sqlite3.connect(DB)
    # 所有非咨询、非 daily 的段落（咨询已有 counsel_flow）
    segs = con.execute("""
        SELECT s.id, s.group_key FROM story_segments s
        JOIN story_units u ON u.id = s.unit_id
        WHERE u.category NOT IN ('counseling')
          AND s.sort_order < 9000
        ORDER BY s.unit_id, s.sort_order
    """).fetchall()

    items, stats = {}, {"ok": 0, "linear": 0, "no_line": 0, "no_mpk": 0,
                        "bad": 0, "unconfirmed": 0, "union_fail": 0}
    fails = []
    for sid, gkey in segs:
        if not gkey:
            continue
        lines = con.execute("""
            SELECT seq, speaker, speaker_id, line_key FROM story_lines
            WHERE segment_id=? ORDER BY seq
        """, (sid,)).fetchall()
        if len(lines) < 2:
            stats["no_line"] += 1
            continue
        # 快筛：没有 Choice 标记直接跳过
        if not any((spid or "") == "Choice" for _q, _sp, spid, _k in lines):
            stats["linear"] += 1
            continue
        K = len(lines)
        if any(int(k.rsplit("_", 1)[1]) != seq for seq, _sp, _spid, k in lines):
            stats["bad"] += 1
            fails.append((gkey, "seq/key mismatch"))
            continue
        path = find_mpk(gkey)
        if not path:
            stats["no_mpk"] += 1
            continue
        try:
            nxt, K_mpk = parse_mpk(path, gkey)
        except Exception as ex:
            stats["bad"] += 1
            fails.append((gkey, f"parse: {ex}"))
            continue
        if K_mpk != K:
            stats["bad"] += 1
            fails.append((gkey, f"mpk K={K_mpk} != db K={K}"))
            continue

        confirmed = []
        for grp in candidates_of([(sp or "", spid or "") for _q, sp, spid, _k in lines]):
            g = confirm(grp, nxt, K)
            if g:
                confirmed.append(g)
        # 过滤：只保留 "2个以上选项" 的组（用户要求：单选项不做）
        confirmed = [g for g in confirmed if len(g) >= 2]
        if not confirmed:
            stats["unconfirmed"] += 1
            continue
        if not union_ok(gkey, nxt, confirmed, K, fails):
            stats["union_fail"] += 1
            continue

        items[gkey] = {
            "next": {str(a): b for a, b in sorted(nxt.items())},
            "choices": confirmed,
        }
        stats["ok"] += 1

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"total": len(items), "items": items}, f,
                  ensure_ascii=False, separators=(",", ":"))
    print(f"{stats['ok']} 段带 2+ 选项分支；{stats['unconfirmed']} 段有 Choice 但无确认组；"
          f"{stats['union_fail']} 段路径不覆盖；{stats['no_mpk']} 段缺 mpk；{stats['bad']} 段解析失败")
    for g, why in fails[:20]:
        print(f"  ! {g}: {why}")
    print("输出", OUT)


if __name__ == "__main__":
    main()
