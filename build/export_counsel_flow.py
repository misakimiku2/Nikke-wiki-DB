# -*- coding: utf-8 -*-
"""咨询分支流导出

源：staticdata/AttractiveCounselDialogTable.<会话组>.mpk（游戏引擎的咨询脚本表）。
每条记录 = [selfkey][group][speaker...][Locale_Counseling:<key>][motion][bg?][bgm?]
[数值字段...][next指针?]；next 指针只在「跳转 ≠ 顺序下一行」时存在。

会话的分支结构（从指针逆向验证）：
  [前情][选项1..选项k][分支1内容..分支k内容][汇合]
  - 选项 i 的指针 → 分支 i 的首行；分支 i 末行指针跳过后续分支直达汇合（阶梯式）；
    最后一个分支顺序走到汇合。
  - 选项行的指针也可能指向另一行选项文本（玩家连续台词彩蛋，如
    ade_agentbunny_06「不是。」→「两个都喜欢。」），所以判定不能只看目标是否越组。

选项组判定 = 文本分类给候选 + 指针确认：
  候选（与前端渲染同一套规则）：
    - speaker_id=Choice 标记的连续行（女仆系格式 B）
    - 无标记时连续 ≥2 行空 speaker（格式 A）
  确认：组内每行都要有显式前向指针（目标 > 该行行号）；失败则去掉组首再试——
    开头的旁白/玩家铺垫行会误并入候选组（如「游泳池里，伊莱格躺在游泳圈上」）。
  只有确认组才导出；没有确认组的会话不导出（前端退回平铺展示）。

输出：public/data/counsel_flow.json
      {"total": n, "items": {"<group_key>": {
          "next": {"3": 5, ...},          ← 显式跳转（缺省 next(x)=x+1，末行结束）
          "choices": [[3,4,5], ...]        ← 选项组（1-based 行号，与 /data/story 分片 seq 对齐）
      }}}
"""
import json
import os
import re
import sqlite3
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, "data", "nikke.db")
OUT = os.path.join(ROOT, "public", "data", "counsel_flow.json")
MPK_DIR = os.path.join(os.environ.get("NIKKE_SRC", r"E:/test/nikke_extract"), "staticdata")

PAT = re.compile(r"[A-Za-z0-9_]+_\d+")


def parse_mpk(path, group):
    """返回 ({行号N: 下一行号N}, K)（仅显式跳转）

    记录锚 = selfkey 串（base == group 的行键串）；指针串的 base 同样是 group，
    无法静态区分——用「期望序号游走」：按文件顺序扫 base==group 的串，
    尾号 == 期望值的即下一条记录的 selfkey，其余是指针（属于当前记录）。"""
    b = open(path, "rb").read()
    toks = [(m.start(), m.group().decode("latin1"))
            for m in re.finditer(rb"[\x20-\x7e]{3,}", b)]
    cands = [(p, int(t.rsplit("_", 1)[1])) for p, t in toks
             if ":" not in t and t.rsplit("_", 1)[0] == group and PAT.fullmatch(t)]

    nxt, expected = {}, 1
    for _p, num in cands:
        if num == expected:
            expected += 1          # selfkey
        elif expected > 1:
            nxt[expected - 1] = num  # 当前记录的 next 指针
    K = expected - 1
    if K < 2:
        raise ValueError(f"too few records: K={K}")
    if cands and max(n for _p, n in cands) > K:
        raise ValueError("record numbering has gaps")
    # 只保留前向跳转（向后 = 解析异常）
    nxt = {a: b for a, b in nxt.items() if b > a}
    return nxt, K


def candidates_of(lines):
    """文本分类的候选选项组；lines = [(sp, spid)]，返回 1-based 行号组列表"""
    n = len(lines)
    has_marks = any(spid in ("Choice", "Self") for _sp, spid in lines)
    out, i = [], 0
    while i < n:
        sp, spid = lines[i]
        if spid == "Choice":
            j = i
            while j < n and lines[j][1] == "Choice":
                j += 1
            out.append(list(range(i + 1, j + 1)))
            i = j
            continue
        if not sp and i != n - 1:
            j = i
            while j < n and not lines[j][0] and lines[j][1] not in ("Choice", "Self"):
                j += 1
            run_end = n - 1 if j >= n - 1 else j
            if run_end - i >= 2:
                # 混合格式（有标记）里，紧挨着 Choice/Self 的空行段是格式 B 的角色
                # 台词（说话人缺失），不是选项；只有两侧都不是标记行才认
                near_mark = (i > 0 and lines[i - 1][1] in ("Choice", "Self"))
                if run_end < n and lines[run_end][1] in ("Choice", "Self"):
                    near_mark = True
                if not near_mark:
                    out.append(list(range(i + 1, run_end + 1)))
                i = run_end
                continue
        i += 1
    return out


def confirm(grp, nxt, k_total):
    """组首行必须有「跳过下一行」的前向指针（选项块夹在首选项与它的分支之间——
    含玩家连续台词彩蛋的指向也算）；失败则去掉组首重试（开头旁白/铺垫会误并入候选）。
    其余选项的分支可能顺序紧跟（末选项常见），不强求指针。返回确认组或 None"""
    while len(grp) >= 2:
        o1 = grp[0]
        if o1 in nxt and nxt[o1] >= o1 + 2 and nxt[o1] <= k_total:
            return grp
        grp = grp[1:]
    return None


def union_ok(gkey, nxt, choices, k_total, fails):
    """所有选项组合的路径并集必须覆盖全部行——不满足说明指针与行数据有出入，
    该会话退回平铺展示（前端没有 flow 就按顺序全展示）"""
    import itertools

    def step(x):
        return nxt.get(x, x + 1 if x < k_total else None)

    union = set()
    for combo in itertools.product(*[range(len(c)) for c in choices]):
        cur, guard = 1, 0
        while cur and cur <= k_total and guard < 500:
            guard += 1
            grp = next((c for c in choices if c[0] == cur), None)
            if grp:
                pick = combo[choices.index(grp)]
                union.add(grp[pick])
                cur = step(grp[pick])
                continue
            union.add(cur)
            cur = step(cur)
    missing = set(range(1, k_total + 1)) - union
    if missing:
        fails.append((gkey, f"paths miss lines {sorted(missing)[:6]}"))
        return False
    return True


def main():
    con = sqlite3.connect(DB)
    segs = con.execute("""
        select s.id, s.group_key
        from story_segments s join story_units u on u.id = s.unit_id
        where u.category = 'counseling' and s.sort_order < 9000
          and s.title is not null and s.title != ''
        order by s.unit_id, s.sort_order
    """).fetchall()

    items, stats = {}, {"ok": 0, "linear": 0, "no_mpk": 0, "bad": 0,
                        "unconfirmed": 0, "union_fail": 0}
    fails = []
    for sid, gkey in segs:
        if not gkey:
            continue
        lines = con.execute("""
            select seq, speaker, speaker_id, line_key from story_lines
            where segment_id=? order by seq
        """, (sid,)).fetchall()
        if not lines:
            continue
        K = len(lines)
        if any(int(k.rsplit("_", 1)[1]) != seq for seq, _sp, _spid, k in lines):
            stats["bad"] += 1
            fails.append((gkey, "seq/key mismatch"))
            continue

        path = os.path.join(MPK_DIR, f"AttractiveCounselDialogTable.{gkey}.mpk")
        if not os.path.exists(path):
            stats["no_mpk"] += 1
            continue
        try:
            nxt, K_mpk = parse_mpk(path, gkey)
        except Exception as e:
            stats["bad"] += 1
            fails.append((gkey, f"parse: {e}"))
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
        if not confirmed:
            if nxt:
                stats["unconfirmed"] += 1
                fails.append((gkey, f"pointers {nxt} but no confirmed choices"))
            else:
                stats["linear"] += 1
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

    print(f"会话 {stats['ok']} 组带分支流，{stats['unconfirmed']} 组有指针无确认选项，"
          f"{stats['union_fail']} 组路径不覆盖，{stats['no_mpk']} 组缺 mpk，"
          f"{stats['bad']} 组解析失败")
    for g, why in fails[:15]:
        print(f"  ! {g}: {why}")


if __name__ == "__main__":
    main()
