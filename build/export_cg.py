#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CG 画廊数据导出

  public/data/cg_index.json
    items : 1347 张插画（hash / 分类 / 尺寸 / 关联数）
    links : cg 名 -> [{u:单元ID, i:定位行号, s:说话人, t:台词, n:显示句数, p:段落标题}]
            每条链接代表「CG 出现在该段落」；CSV 行级链接定位到精确行，
            脚本表/推断链接定位到段落首行。同段落多行合并为一条。
            n = 真实显示区间句数：从触发行到下一个会替换它的 CG 切换事件，
            或下一个场景 black/none 行（游戏里切场景时 CG 不再挂屏）——两者取
            更早者，段内都没有则到段末；连图集各帧 / X_bg 互相接替不视为切换。

  python build/export_cg.py
"""
import json
import os
import re
import sqlite3
import sys
from collections import defaultdict

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, "data", "nikke.db")
MANIFEST = os.path.join(ROOT, "public", "manifest.json")
OUT = os.path.join(ROOT, "public", "data", "cg_index.json")
CHARS = os.path.join(ROOT, "public", "data", "characters.json")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from export_story import load_locale_titles   # noqa: E402  剧情标题四语（Stage/MainScenario/NikkeEpisode/Counseling…）
from build_db import harvest_cg_line_assets   # noqa: E402  行级场景切换 bg（black/none 切断 CG 区间）


def load_char_names():
    """角色中文名 -> {en,ko,ja}（characters.json 的 names 列），供链接说话人本地化。"""
    try:
        d = json.load(open(CHARS, encoding="utf-8"))
    except Exception:
        return {}
    items = d.get("items", []) if isinstance(d, dict) else d
    out = {}
    for it in items:
        if not isinstance(it, dict):
            continue
        zh = it.get("name")
        names = it.get("names") or {}
        if zh and (names.get("en") or names.get("ko") or names.get("ja")):
            out[zh] = {l: names.get(l) for l in ("en", "ko", "ja")}
    return out


def load_merge_groups():
    """cg_merges.json 的封面 + 成员视为同一组：连图集各帧互相接替，不截断彼此的显示区间。"""
    path = os.path.join(ROOT, "build", "cg_merges.json")
    groups = {}
    try:
        raw = json.load(open(path, encoding="utf-8"))
    except Exception:
        return groups
    for cover, members in raw.items():
        if not isinstance(members, list):
            continue  # 跳过 _note 之类的说明字段
        for name in [cover] + members:
            groups[name] = cover
    return groups


def canonical(name: str) -> str:
    """X 与 X_bg 是同一张作品（人物层 + 背景板），归为一组。"""
    return name[:-3] if name.endswith("_bg") else name


def main():
    con = sqlite3.connect(DB)

    # ---- 段落元信息：segment_id -> (unit_id, 标题, 行数, 单元内起始行号, group_key) ----
    # 排序必须与 export_story.py 的分片结构一致（unit -> seg.sort_order -> seq）
    seg_rows = con.execute("""
        SELECT s.id, s.unit_id, s.title, s.part, s.group_key,
               (SELECT COUNT(*) FROM story_lines l WHERE l.segment_id = s.id)
        FROM story_segments s ORDER BY s.unit_id, s.sort_order
    """).fetchall()
    counter = defaultdict(int)   # unit_id -> 累计行号
    seg_meta = {}                # sid -> (uid, title, lcount, base, group_key)
    for (sid, uid, stitle, spart, gkey, lcount) in seg_rows:
        if not lcount:
            continue
        seg_meta[sid] = (uid, stitle or spart or "", lcount, counter[uid], gkey)
        counter[uid] += lcount

    # ---- 行 -> 段内偏移；段落首句 ----
    seg_lines = defaultdict(list)
    for lid, sid in con.execute(
            "SELECT id, segment_id FROM story_lines ORDER BY segment_id, seq"):
        seg_lines[sid].append(lid)
    line_pos = {}
    for sid, lids in seg_lines.items():
        for off, lid in enumerate(lids):
            line_pos[lid] = off

    first_line = {}
    for sid, sp, txt, en, ko, ja in con.execute("""
        SELECT segment_id, speaker, text_zh, text_en, text_ko, text_ja FROM story_lines
        WHERE text_zh IS NOT NULL AND text_zh <> ''
        ORDER BY segment_id, seq
    """):
        if sid not in first_line:
            first_line[sid] = (sp or "", txt, en or "", ko or "", ja or "")

    # ---- 四语回填用的表 ----
    locale_titles = load_locale_titles()
    # 主线段名不走 Locale 表（export_main_section_names.py 从游戏 UI 文本提取），
    # 与 Locale 命中的条目合并成一张 group_key -> 四语 的查找表
    section_names = {}
    try:
        with open(os.path.join(ROOT, "build", "main_section_names.json"), encoding="utf-8") as f:
            section_names = json.load(f)
    except Exception:
        pass
    for gk, v in section_names.items():
        key = f"{gk}_title"
        if key not in locale_titles and all(v.get(l) for l in ("en", "ko", "ja", "zh")):
            locale_titles[key] = {l: v[l] for l in ("zh", "en", "ko", "ja")}
    char_names = load_char_names()

    # ---- 场景黑场/清背景切断点 ----
    # 上游剧情 JSON 行级 bg 字段是场景切换命令：black=黑屏转场、none=清空背景。
    # CG 显示区间在这些行处切断（游戏里切场景时 CG 不再挂屏），区间 = 触发行 →
    # 下一个 black/none 行（与下一个 CG 切换事件取更早者）。
    line_key_pos = defaultdict(list)   # line_key -> [(sid, off)]
    for lid, lk, sid in con.execute("SELECT id, line_key, segment_id FROM story_lines"):
        off = line_pos.get(lid)
        if off is not None and lk:
            line_key_pos[lk].append((sid, off))
    clear_offsets = defaultdict(list)  # sid -> [off]（升序）
    for lk, ev in harvest_cg_line_assets().items():
        if any(b in ("black", "none") for b in ev.get("bg") or []):
            for sid, off in line_key_pos.get(lk, []):
                clear_offsets[sid].append(off)
    for sid in clear_offsets:
        clear_offsets[sid] = sorted(set(clear_offsets[sid]))

    # ---- CG -> 段落（同段落多行合并，保留最靠上的触发点）----
    # 同时收集每段内全部 CG 触发行（含其它 CG）：用于推算真实显示区间
    links = defaultdict(dict)      # cg -> {sid: (off, speaker, text)}
    seg_events = defaultdict(dict)  # sid -> {off: set(cg 名)}（同行的多张图并成一个事件）
    for cg, lid, sid in con.execute("""
        SELECT c.cg_name, c.line_id, l.segment_id FROM cg_links c
        JOIN story_lines l ON l.id = c.line_id
        ORDER BY c.rowid
    """):
        meta = seg_meta.get(sid)
        if meta is None:
            continue
        off = line_pos.get(lid, 0)
        d = links[cg]
        if sid not in d or off < d[sid][0]:
            sp, txt = first_line.get(sid, ("", ""))[:2]
            d[sid] = (off, sp, txt)
        seg_events[sid].setdefault(off, set()).add(cg)

    out_links = {}
    n_entries = 0
    n_l4 = n_s4 = n_p4 = 0
    merge_groups = load_merge_groups()

    def group_of(name: str) -> str:
        c = canonical(name)
        return merge_groups.get(c, c)

    # 每段的触发偏移升序列表（运行长度推算用）
    seg_event_offsets = {sid: sorted(evs) for sid, evs in seg_events.items()}

    for cg, segs in links.items():
        lst = []
        g_self = group_of(cg)
        for sid, (off, sp, txt) in sorted(segs.items(), key=lambda x: seg_meta[x[0]][3]):
            uid, stitle, lcount, base, gkey = seg_meta[sid]
            # 真实显示区间：从触发行到下一个会顶掉它的 CG 切换事件为止（与阅读器的
            # CG 切换口径一致）；同组条目（连图集各帧 / X_bg）互相接替不算切换，
            # 段内没有后续切换就显示到段末。老的「整段行数」会把触发前的半段
            # 和后续场景（回忆杀等）都算进去，远大于游戏里的实际出现范围。
            end = lcount
            # 场景黑场/清背景先切：CG 在下一个 black/none 行处不再挂屏
            for o2 in clear_offsets.get(sid, ()):
                if o2 > off:
                    end = min(end, o2)
                    break
            for o2 in seg_event_offsets.get(sid, ()):
                if o2 <= off:
                    continue
                if any(group_of(n2) != g_self for n2 in seg_events[sid][o2]):
                    end = min(end, o2)
                    break
            run = max(1, end - off)
            entry = {
                "u": uid,
                "i": base + off,          # 定位行号（单元内绝对行）
                "s": sp,
                "t": (txt or "")[:120],
                "n": run,                 # 显示区间句数（触发行 → 下一 CG 切换 / 段末）
                "p": stitle,              # 段落标题
            }
            # 四语回填：段落标题（Locale 官方名）、首句台词、说话人名。
            # 只在 zh 数据与库内/官方简中一致时给，避免上游改动后错配。
            fl = first_line.get(sid)
            if fl and all(fl[2:]) and (fl[1] or "")[:120] == entry["t"]:
                entry["l4"] = {"en": fl[2], "ko": fl[3], "ja": fl[4]}
                n_l4 += 1
            nm = char_names.get(sp)
            if nm and all(nm.values()):
                entry["s4"] = nm
                n_s4 += 1
            loc4 = locale_titles.get(f"{gkey}_title") if gkey else None
            if loc4 and all(loc4.get(l) for l in ("en", "ko", "ja")) \
                    and loc4.get("zh") == stitle:
                entry["p4"] = {l: loc4[l] for l in ("en", "ko", "ja")}
                n_p4 += 1
            lst.append(entry)
        out_links[cg] = lst
        n_entries += len(lst)
    print(f"有关联的 CG：{len(out_links)} 个，段落条目 {n_entries} 条")
    print(f"  四语回填：台词 {n_l4} / 说话人 {n_s4} / 段名 {n_p4}")

    manifest = json.load(open(MANIFEST, encoding="utf-8"))
    covers = {n for (n,) in con.execute("SELECT name FROM cg_assets WHERE is_cover=1")}
    # d=1 表示「有实时 Spine 模型」。以前靠 public/dyn/*.webp 是否存在来判定，
    # 现在合成动图已经下线（质量不如实时模型且占 1.7GB），改由模型清单判定。
    spine_path = os.path.join(ROOT, "public", "data", "spine_models.json")
    spine_models: set[str] = set()
    if os.path.exists(spine_path):
        with open(spine_path, encoding="utf-8") as f:
            spine_models = set(json.load(f).get("items", []))
    # 角色大招 cut-in：EventScene_c010_00_skillcut -> 拉毗（用角色表把 c0xx 换成中文名）
    code2name = {}
    try:
        code2name = {c: n for c, n in con.execute(
            "SELECT code, name_zh FROM character_entries"
            " WHERE code IS NOT NULL AND name_zh IS NOT NULL")}
    except Exception:
        pass
    # 大招 cut-in：CG 名剥 EventScene_ 前缀后命中实时模型清单（char_spine_skillcut
    # items，与 spine_skillcut/ 模型目录一一对应）。比旧正则宽松——c840_skillcut_00
    # 这类反序名与 c017_00_slillcut 这类上游拼写错误名也能拿到角色中文名。
    sc_path = os.path.join(ROOT, "public", "data", "char_spine_skillcut.json")
    skillcut_models: set[str] = set()
    if os.path.exists(sc_path):
        with open(sc_path, encoding="utf-8") as f:
            skillcut_models = set(json.load(f).get("items", []))
    cutin_code_re = re.compile(r"^EventScene_(c\d+)")
    # Spine 图集的附加层（_atlas_add/_atlas_blen…）是零件贴图，不是能看的图
    junk_re = re.compile(r"_atlas(_(add|blen|mul|screen|mask|shot))?$", re.I)
    items = []
    for it in manifest["items"]:
        if not it.get("variants"):
            continue
        if junk_re.search(it["name"]):
            continue
        is_cutin = it["name"].startswith("EventScene_") \
            and it["name"][len("EventScene_"):] in skillcut_models
        m = cutin_code_re.match(it["name"]) if is_cutin else None
        sub = code2name.get(m.group(1), "") if m else it["sub"]
        item = {
            "h": it["hash"],
            "n": it["name"],
            "c": it["category"],
            "s": sub,
            "w": it.get("w") or 0,
            "h2": it.get("h") or 0,
            "l": len(out_links.get(it["name"], [])),
        }
        if it["name"] in covers:
            item["k"] = 1          # k=1：人工标注为活动封面/主视觉，不是剧情 CG
        if it["name"] in spine_models:
            item["d"] = 1          # d=1：有实时 Spine 模型（图鉴里可直接播放）
        items.append(item)

    payload = {
        "total": len(items),
        "items": items,
        "links": out_links,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    size = os.path.getsize(OUT)
    cats = defaultdict(int)
    for i in items:
        cats[i["c"]] += 1
    print(f"\n输出 {OUT}  {size/1024:.0f} KB")
    for c, n in sorted(cats.items()):
        print(f"  {c:<16} {n:>5}")
    linked = sum(1 for i in items if i["l"] > 0)
    print(f"  有剧情关联 {linked} / {len(items)}")
    print(f"  标注为封面/主视觉 {sum(1 for i in items if i.get('k'))} 张")


if __name__ == "__main__":
    main()
