#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
剧情分片导出

每个剧情单元导出一个 JSON，前端点进去才加载，避免首屏拖几百 MB。
CG 以「第几行切到哪张图」的事件形式输出，阅读器据此按行显示，
不再「一个段落一张图撑到底」。

  python build/export_story.py
输出 public/data/story/{unit_id}.json
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
OUT = os.path.join(ROOT, "public", "data", "story")
SRC = os.environ.get("NIKKE_SRC", r"E:/test/nikke_extract")


# ---------------- 四语标题（en/ko/ja；zh 一律沿用现有中文字段） ----------------

# decrypted 里与剧情标题相关的 Locale 表和 key 过滤器（与 export_web.py 同一套）
LOCALE_TITLE_TABLES = {
    "Locale_Stage": ("chapter_name_%",),
    "Locale_MainScenario": ("%_title",),
    "Locale_SubScenario": ("%_title",),
    "Locale_NikkeEpisode": ("%_title",),
    "Locale_SuddenStory": ("%_title",),
    "Locale_SideStory": ("%_title",),
    "Locale_Counseling": ("%_title",),
    "Locale_SubQuest": ("sub_quest_description_%",),
    "Locale_Outpost": ("outpost_building_name_%",),
    "Locale_System": ("RECORD_EVENT_TITLE%", "STORY_DUNGEON_TITLE%"),
}


def load_locale_titles():
    """decrypted Locale 表里剧情标题相关 key 的四语值。

    返回 {lower(Key): {"zh","en","ko","ja"}}；同一 key 出现在多张表/多个 dec
    文件时先写入的非空值优先（与 build_db.backfill_line_locale 同规则）。
    """
    out = {}
    dec_dir = os.path.join(SRC, "decrypted")
    files = sorted(f for f in os.listdir(dec_dir) if f.endswith(".dec")) \
        if os.path.isdir(dec_dir) else []
    for fname in files:
        path = os.path.join(dec_dir, fname).replace("\\", "/")
        loc = None
        try:
            loc = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
            tables = {r[0] for r in loc.execute(
                "SELECT name FROM sqlite_master WHERE type='table'")}
            for table, conds in LOCALE_TITLE_TABLES.items():
                if table not in tables:
                    continue
                where = " OR ".join(["Key LIKE ?"] * len(conds))
                for key, en, ko, ja, zh in loc.execute(
                        f'SELECT Key, en, ko, ja, "zh-CN" FROM "{table}" WHERE {where}',
                        conds):
                    if not (en or ko or ja or zh):
                        continue
                    slot = out.setdefault(key.lower(), {})
                    for lang, v in (("en", en), ("ko", ko), ("ja", ja), ("zh", zh)):
                        if v and not slot.get(lang):
                            slot[lang] = v.strip()
        except Exception:
            pass
        finally:
            if loc is not None:
                loc.close()
    return out


def main():
    con = sqlite3.connect(DB)
    os.makedirs(OUT, exist_ok=True)
    # 不整批删除旧分片（沙箱批量删除保护）：下面按当前单元 id 逐个覆盖写出，
    # 已消失单元的旧文件留着也无害（前端只按 story_index 的 id 加载）。

    # cg_name -> webp hash（阅读器直接显示用），与 export_cg.py 同源走 manifest.json
    man_path = os.path.join(ROOT, "public", "manifest.json")
    cg_hash = {}
    if os.path.exists(man_path):
        with open(man_path, encoding="utf-8") as f:
            for it in json.load(f).get("items", []):
                cg_hash[it["name"]] = it["hash"]

    # 动态 CG 不再引用离线合成的动画 WebP，改由实时模型清单判定。
    spine_path = os.path.join(ROOT, "public", "data", "spine_models.json")
    spine_models: set[str] = set()
    if os.path.exists(spine_path):
        with open(spine_path, encoding="utf-8") as f:
            spine_models = set(json.load(f).get("items", []))

    def cg_ref(name):
        """CG 名 -> 前端引用；同名的 bg/前景两层都会各自成项，由阅读器合帧。"""
        h = cg_hash.get(name)
        if not h:
            return None
        item = {"h": h, "n": name}
        if name in spine_models:
            item["d"] = name      # 有实时 Spine 模型，阅读器背景直接播模型
        return item

    # 好感剧情/咨询的友好标题：char_stories.json（export_char_stories.py 产出）
    # 里有 unit → 角色条目映射；没有它就退回原始 bucket（不影响其他分类）。
    title_fix = {}
    cs_path = os.path.join(ROOT, "public", "data", "char_stories.json")
    ch_path = os.path.join(ROOT, "public", "data", "characters.json")
    if os.path.exists(cs_path) and os.path.exists(ch_path):
        with open(cs_path, encoding="utf-8") as f:
            cs = json.load(f).get("items", {})
        with open(ch_path, encoding="utf-8") as f:
            zh_of = {c["id"]: c["name"] for c in json.load(f).get("items", [])}
        for cid_s, entry in cs.items():
            zh = zh_of.get(int(cid_s))
            if not zh:
                continue
            for r in entry.get("stories", []) + entry.get("counsel", []):
                title_fix[r["id"]] = f"{zh}·{r['t']}"

    # 好感剧情/咨询的友好标题：char_stories.json（export_char_stories.py 产出）
    # 里有 unit → 角色条目映射；没有它就退回原始 bucket（不影响其他分类）。
    title_fix = {}
    cs_path = os.path.join(ROOT, "public", "data", "char_stories.json")
    ch_path = os.path.join(ROOT, "public", "data", "characters.json")
    if os.path.exists(cs_path) and os.path.exists(ch_path):
        with open(cs_path, encoding="utf-8") as f:
            cs = json.load(f).get("items", {})
        with open(ch_path, encoding="utf-8") as f:
            zh_of = {c["id"]: c["name"] for c in json.load(f).get("items", [])}
        for cid_s, entry in cs.items():
            zh = zh_of.get(int(cid_s))
            if not zh:
                continue
            for r in entry.get("stories", []) + entry.get("counsel", []):
                title_fix[r["id"]] = f"{zh}·{r['t']}"

    # (segment_id, line_id) -> [cg_name, ...]，同一行同时出主帧与 _bg 时两件都在
    cg_by_line = defaultdict(list)
    for seg_id, line_id, name in con.execute(
            "SELECT l.segment_id, l.id, c.cg_name FROM cg_links c"
            " JOIN story_lines l ON l.id = c.line_id"
            " ORDER BY l.segment_id, l.seq, c.rowid"):
        cg_by_line[(seg_id, line_id)].append(name)

    # 单元标题的四语（story_index.json 由 export_web.py 产出，这里只按 id 消费）
    index_titles = {}
    idx_path = os.path.join(ROOT, "public", "data", "story_index.json")
    if os.path.exists(idx_path):
        try:
            with open(idx_path, encoding="utf-8") as f:
                index_titles = {u["id"]: u["titles"] for u in json.load(f).get("items", [])
                                if u.get("titles")}
        except Exception:
            index_titles = {}

    # 段落标题的四语：主线小节名来自 main_section_names.json（export_main_section_names.py
    # 产出，build_db.py 只消费其中的 zh），其余按 <group>_title 在 Locale 表里查
    locale_titles = load_locale_titles()
    section_names = {}
    try:
        with open(os.path.join(ROOT, "build", "main_section_names.json"), encoding="utf-8") as f:
            section_names = json.load(f)
    except Exception:
        section_names = {}

    def seg_ts4(cat, group_key):
        """段落标题的 [en, ko, ja]；一个语言都没有则返回 None。绝不机翻。"""
        key = group_key.lower()
        slot = None
        if cat == "main":
            slot = section_names.get(key)
            if slot is None:
                # 后记段两种命名都存在：d_main_49af_01 与 d_main_49_af_01
                m = re.match(r"^(d_main_\d+)_(af|bf)_(.+)$", key)
                if m:
                    slot = section_names.get(f"{m.group(1)}{m.group(2)}_{m.group(3)}")
            if not isinstance(slot, dict):
                return None
        else:
            slot = locale_titles.get(key + "_title")
            if slot is None and re.search(r"_[se]$", key):
                # 事件的前篇/后篇段：官方只有整章一个 <group>_title
                slot = locale_titles.get(re.sub(r"_[se]$", "", key) + "_title")
            if slot is None:
                # 支线任务段落：描述本身就是官方四语章节名（【第2章】… / Chapter 2 - …）
                m = re.match(r"^d_subquest_(\d{3})(\d)(?:_\d+)?(?:_[se])?$", key)
                if m:
                    slot = locale_titles.get(f"sub_quest_description_{m.group(1)}{m.group(2)}")
            if slot is None:
                # 支线故事的 B 分支段没有自己的标题，继承主段（上游中文也是继承 +（B1））
                m = re.match(r"^(s\d+_\d+)_b\d+(?:_[se])?$", key)
                if m:
                    slot = locale_titles.get(m.group(1) + "_title")
            if not slot:
                return None
        ts = [slot.get("en") or "", slot.get("ko") or "", slot.get("ja") or ""]
        return ts if any(ts) else None

    units = con.execute(
        "SELECT id, category, category_label, bucket, title, chapter_no,"
        " segment_count, line_count, source FROM story_units ORDER BY sort_order"
    ).fetchall()

    total_bytes = 0
    total_lines = 0
    total_events = 0
    for (uid, cat, label, bucket, title, ch, segs, lines, source) in units:
        seg_rows = con.execute(
            "SELECT id, group_key, title, part, line_count FROM story_segments"
            " WHERE unit_id=? ORDER BY sort_order", (uid,)
        ).fetchall()

        payload_segs = []
        for (sid, group_key, stitle, part, lcount) in seg_rows:
            if not lcount:
                continue
            ls = con.execute(
                "SELECT id, speaker, speaker_id, text_zh, text_en, text_ko, text_ja"
                " FROM story_lines WHERE segment_id=? ORDER BY seq", (sid,)
            ).fetchall()
            # 段内 CG 事件：[行下标, [CG 引用, ...]]，主帧在前、_bg 在前景之后
            events = []
            for idx, (lid, _sp, _spid, _txt, _en, _ko, _ja) in enumerate(ls):
                refs = [r for r in (cg_ref(n) for n in cg_by_line.get((sid, lid), [])) if r]
                if not refs:
                    continue
                refs.sort(key=lambda x: x["n"].endswith("_bg"))
                events.append([idx, refs])
            seg = {
                "g": group_key,
                "t": stitle or part or "",
                # [说话人, 说话人 id, 简中, 英文, 韩文, 日文]
                "l": [[sp or "", spid or "", txt or "", en or "", ko or "", ja or ""]
                      for _lid, sp, spid, txt, en, ko, ja in ls],
                "e": events,
            }
            # 段落标题的其他语言：[en, ko, ja]，缺语言为空串
            ts = seg_ts4(cat, group_key)
            if ts:
                seg["ts"] = ts
            payload_segs.append(seg)
            total_events += len(events)

        if not payload_segs:
            continue

        # 个人剧情/咨询单元的 title 在库里就是 bucket 原文，换成友好标题
        if title == bucket or not title:
            if uid in title_fix:
                title = title_fix[uid]
            elif cat == "counseling" and payload_segs and payload_segs[0]["t"]:
                title = re.sub(r"：\d+$", "", payload_segs[0]["t"])

        payload = {
            "id": uid,
            "cat": cat,
            "label": label,
            "bucket": bucket,
            "title": title or bucket,
            "chapter": ch,
            "source": source,
            "segments": payload_segs,
        }
        # 单元标题的其他语言（与 story_index.json 的 titles 同源）
        if uid in index_titles:
            payload["titles"] = index_titles[uid]
        path = os.path.join(OUT, f"{uid}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        total_bytes += os.path.getsize(path)
        total_lines += sum(len(s["l"]) for s in payload_segs)

    n = len([f for f in os.listdir(OUT) if f.endswith(".json")])
    print(f"导出 {n} 个剧情分片，{total_lines:,} 条台词，{total_events:,} 处 CG 切换，"
          f"合计 {total_bytes/1048576:.1f} MB")
    sizes = sorted((os.path.getsize(os.path.join(OUT, f)), f) for f in os.listdir(OUT) if f.endswith(".json"))
    if sizes:
        print(f"  最小 {sizes[0][0]/1024:.0f} KB ({sizes[0][1]})")
        print(f"  最大 {sizes[-1][0]/1024:.0f} KB ({sizes[-1][1]})")
        print(f"  中位 {sizes[len(sizes)//2][0]/1024:.0f} KB")


if __name__ == "__main__":
    main()
