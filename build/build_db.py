#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NIKKE 剧情数据库构建脚本

把 nikke_extract 的分散数据压进一个 nikke.db：
  - 主线剧情 JSON       -> story_units / story_segments / story_lines
  - 其他剧情 8 个 JSON  -> 同上
  - CG 对照索引 CSV     -> cg_links
  - CG 目录扫描         -> cg_assets
  - 动态 CG 目录        -> cg_animations
  - 台词说话人聚合      -> characters

用法：
  python build/build_db.py            # 全量重建
  python build/build_db.py --only=story   # 只跑剧情部分
  python build/build_db.py --stats    # 只看现有库的统计
"""
import argparse
import glob
import json
import os
import re
import sqlite3
import sys
import time
from collections import Counter, defaultdict

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # nikke-web
SRC = os.environ.get("NIKKE_SRC", r"E:/test/nikke_extract")
DB_PATH = os.path.join(ROOT, "data", "nikke.db")
SCHEMA = os.path.join(ROOT, "build", "schema.sql")
CG_FLAGS = os.path.join(ROOT, "build", "cg_flags.json")

# 其他剧情的模块定义：(子目录, 文件名, category, 中文标签, 排序权重)
OTHER_MODULES = [
    ("活动剧情",            "活动剧情_全量.json",        "event",     "活动剧情",        10),
    ("妮姬个人剧情",        "妮姬个人剧情_全量.json",    "nikke",     "妮姬个人剧情",    20),
    ("支线剧情",            "支线剧情_全量.json",        "sub",       "支线剧情",        30),
    ("支线故事",            "支线故事_全量.json",        "side_story","支线故事",        40),
    ("外传与前哨基地日常",  "",                          "gaiden",    "外传与日常",      50),
    ("咨询对话",            "咨询对话_全量.json",        "counseling","咨询对话",        60),
    ("短信与日常对话",      "短信与日常对话_全量.json",  "daily",     "短信与日常",      70),
    ("补充剧情文本",        "补充剧情文本_全量.json",    "extra",     "补充剧情",        80),
]


def log(msg):
    print(msg, flush=True)


SCHEMA_VERSION = 6


FTS_TRIGGER_SQL = """
CREATE TRIGGER IF NOT EXISTS lines_ai AFTER INSERT ON story_lines BEGIN
  INSERT INTO line_fts(rowid, text_zh) VALUES (new.id, new.text_zh);
END;
CREATE TRIGGER IF NOT EXISTS lines_ad AFTER DELETE ON story_lines BEGIN
  INSERT INTO line_fts(line_fts, rowid, text_zh) VALUES('delete', old.id, old.text_zh);
END;
CREATE TRIGGER IF NOT EXISTS lines_au AFTER UPDATE ON story_lines BEGIN
  INSERT INTO line_fts(line_fts, rowid, text_zh) VALUES('delete', old.id, old.text_zh);
  INSERT INTO line_fts(rowid, text_zh) VALUES (new.id, new.text_zh);
END;
"""


def fts_reset(con):
    """批量重建前清空 FTS。
    注意：external content 表绝不能 DELETE，那会静默破坏索引导致后续写操作报
    'database disk image is malformed'。必须用 delete-all 命令。"""
    for t in ("lines_ai", "lines_ad", "lines_au"):
        con.execute("DROP TRIGGER IF EXISTS %s" % t)
    con.execute("INSERT INTO line_fts(line_fts) VALUES('delete-all')")


def fts_rebuild(con):
    con.execute("INSERT INTO line_fts(line_fts) VALUES('rebuild')")
    con.executescript(FTS_TRIGGER_SQL)
    con.commit()


def connect():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    # schema 升级时旧库必须重建（CREATE TABLE IF NOT EXISTS 不会改结构）
    if os.path.exists(DB_PATH):
        try:
            old = sqlite3.connect(DB_PATH)
            row = old.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()
            old.close()
            if not row or int(row[0]) != SCHEMA_VERSION:
                log(f"  schema 版本变化，重建数据库")
                for suffix in ("", "-wal", "-shm"):
                    p = DB_PATH + suffix
                    if os.path.exists(p):
                        os.remove(p)
        except Exception:
            pass
    con = sqlite3.connect(DB_PATH)
    con.execute("PRAGMA journal_mode = WAL")
    con.execute("PRAGMA synchronous = OFF")
    with open(SCHEMA, encoding="utf-8") as f:
        con.executescript(f.read())
    con.execute("INSERT OR REPLACE INTO meta(key, value) VALUES('schema_version', ?)",
                (str(SCHEMA_VERSION),))
    return con


# ---------------- 剧情 ----------------

def iter_line_fields(raw):
    """统一抽取台词字段，兼容 zh-CN / text / content 等写法"""
    return {
        "seq": raw.get("n") or raw.get("index") or raw.get("seq"),
        "line_key": raw.get("key") or raw.get("id") or raw.get("line_key"),
        "speaker": raw.get("speaker") or raw.get("name"),
        "speaker_id": raw.get("speaker_id") or raw.get("speakerId"),
        "portrait": raw.get("portrait"),
        "portrait_id": raw.get("portrait_id") or raw.get("portraitId"),
        "text_zh": raw.get("zh-CN") or raw.get("zh_CN") or raw.get("text") or raw.get("content"),
        "text_en": raw.get("en"),
        "text_ja": raw.get("ja"),
    }


def game_chapter_titles():
    """游戏章节标题（Locale_Stage:chapter_name_NN）。注意这张表是 0-based：
    chapter_name_00 = 坠落（第01章）、chapter_name_01 = 侵蚀（第02章）。
    只作对照用，不要拿 1-based 章号直接索引。"""
    path = os.path.join(SRC, "decrypted", "2f3134ea528251fb735273e764276059.dec")
    titles = {}
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        for n in range(0, 50):
            row = conn.execute(
                'SELECT "zh-CN" FROM Locale_Stage WHERE Key=?',
                (f"chapter_name_{n:02d}",)).fetchone()
            if row and row[0]:
                titles[n] = row[0]
        conn.close()
    except Exception:
        pass
    return titles


def collect_story_units():
    """返回 [(unit_dict, [segment_dict, ...])]"""
    units = []

    # --- 主线 ---
    main_path = os.path.join(SRC, "主线剧情", "主线剧情_全量.json")
    if os.path.exists(main_path):
        d = json.load(open(main_path, encoding="utf-8"))
        for order, ch in enumerate(d.get("chapters", []), start=1):
            no = ch.get("chapter")
            sections = list(ch.get("sections", []))

            # 序章（第 00 章）没有独立的数据块，内容是 d_main_01 的首段：
            # BA-01 下坠 → ……遇敌！，共 35 句。压库时从第一章拆出来单独成章。
            if no == 1 and sections and sections[0].get("group") == "d_main_01_01_s":
                pro = sections.pop(0)
                units.append(({
                    "category": "main",
                    "category_label": "主线剧情",
                    "bucket": "d_main_00",
                    "title": "序章",
                    "chapter_no": 0,
                    "sort_order": 0,
                }, [{
                    "group_key": pro["group"],
                    "title": pro.get("title"),
                    "part": pro.get("part"),
                    "sort_order": 1,
                    "lines": pro.get("lines") or [],
                }]))
            if not sections:
                continue

            unit = {
                "category": "main",
                "category_label": "主线剧情",
                "bucket": "d_main_%02d" % (no or order),
                "title": ch.get("title"),
                "chapter_no": no,
                "sort_order": order,
            }
            segs = []
            for so, sec in enumerate(sections, start=1):
                segs.append({
                    "group_key": sec.get("group") or sec.get("group_key") or f"main_{order}_{so}",
                    "title": sec.get("title"),
                    "part": sec.get("part"),
                    "sort_order": so,
                    "lines": sec.get("lines") or [],
                })
            units.append((unit, segs))

        # --- 章节标题以结构化导出为准：d_main_NN 就是「第 NN 章」（第01章 坠落、
        #     第02章 侵蚀…），JSON 里的 title 已经是正确中文名。不要再用
        #     Locale_Stage 的 chapter_name_NN 覆盖——那张表是 0-based（00 坠落、
        #     01 侵蚀），直接按 1-based 章号取会整体错位一位，历史上曾因此把
        #     「决战」重复成第 49、50 两章。序章已在上面单独拆成 00 章。---
        log(f"  主线：{len(units)} 章")

    # --- 其他剧情 ---
    other_root = os.path.join(SRC, "其他剧情")
    seen_buckets = set()
    count_before = len(units)
    for subdir, fname, cat, label, weight in OTHER_MODULES:
        folder = os.path.join(other_root, subdir)
        if not os.path.isdir(folder):
            continue
        paths = [os.path.join(folder, fname)] if fname else sorted(glob.glob(os.path.join(folder, "*_全量.json")))
        for path in paths:
            if not os.path.exists(path):
                continue
            data = json.load(open(path, encoding="utf-8"))
            if not isinstance(data, list):
                continue
            added = 0
            for idx, item in enumerate(data, start=1):
                bucket = item.get("bucket") or item.get("event") or item.get("key") or f"{cat}_{idx}"
                if bucket in seen_buckets:
                    continue
                seen_buckets.add(bucket)
                unit = {
                    "category": cat,
                    "category_label": label,
                    "bucket": bucket,
                    "title": item.get("title") or item.get("name") or bucket,
                    "chapter_no": None,
                    "sort_order": weight * 10000 + idx,
                }
                segs = []
                for so, grp in enumerate(item.get("groups", []), start=1):
                    segs.append({
                        "group_key": grp.get("group") or f"{bucket}_{so}",
                        "title": grp.get("title"),
                        "part": grp.get("part"),
                        "sort_order": so,
                        "lines": grp.get("lines") or [],
                    })
                units.append((unit, segs))
                added += 1
            log(f"  {label}：{added} 个单元")

    # --- 最新活动（Marian）独立结构 ---
    marian = os.path.join(other_root, "活动剧情", "Marian", "event_marian_结构化.json")
    if os.path.exists(marian):
        d = json.load(open(marian, encoding="utf-8"))
        ev = d.get("event") or "event_marian"
        if ev not in seen_buckets:
            unit = {
                "category": "event",
                "category_label": "活动剧情",
                "bucket": ev,
                "title": "Marian",
                "chapter_no": None,
                "sort_order": 10 * 10000 + 9999,  # 排在活动剧情最前
            }
            segs = []
            for so, ch in enumerate(d.get("chapters", []), start=1):
                segs.append({
                    "group_key": ch.get("group") or f"{ev}_{so}",
                    "title": ch.get("title") or ch.get("label"),
                    "part": ch.get("part"),
                    "sort_order": so,
                    "lines": ch.get("lines") or [],
                })
            units.append((unit, segs))
            log(f"  Marian 活动：{len(segs)} 段")

    log(f"  剧情单元合计：{len(units)}（其他剧情新增 {len(units) - count_before}）")
    return units


def import_story(con):
    log("[1/5] 导入剧情文本 …")
    t0 = time.time()
    units = collect_story_units()

    fts_reset(con)
    con.execute("DELETE FROM story_lines")
    con.execute("DELETE FROM story_segments")
    con.execute("DELETE FROM story_units")

    speakers = defaultdict(lambda: {"zh": None, "en": None, "ja": None, "count": 0, "first": None})
    total_lines = 0

    for unit, segs in units:
        cur = con.execute(
            "INSERT INTO story_units(category, category_label, bucket, title, chapter_no, sort_order)"
            " VALUES(?,?,?,?,?,?)",
            (unit["category"], unit["category_label"], unit["bucket"],
             unit["title"], unit["chapter_no"], unit["sort_order"]),
        )
        unit_id = cur.lastrowid
        u_lines = 0
        u_chars = 0

        for seg in segs:
            cur = con.execute(
                "INSERT INTO story_segments(unit_id, group_key, title, part, sort_order)"
                " VALUES(?,?,?,?,?)",
                (unit_id, seg["group_key"], seg["title"], seg["part"], seg["sort_order"]),
            )
            seg_id = cur.lastrowid
            rows = []
            for raw in seg["lines"]:
                f = iter_line_fields(raw)
                lk = f["line_key"]
                if not lk:
                    continue
                rows.append((seg_id, unit_id, f["seq"], lk, f["speaker"], f["speaker_id"],
                             f["portrait"], f["portrait_id"], f["text_zh"], f["text_en"], f["text_ja"]))
                if f["speaker_id"]:
                    sp = speakers[f["speaker_id"]]
                    sp["count"] += 1
                    if f["speaker"]:
                        sp["zh"] = sp["zh"] or f["speaker"]
                    if f["text_en"]:
                        sp["en"] = sp["en"] or f["speaker"]
                    if sp["first"] is None:
                        sp["first"] = lk
            if rows:
                con.executemany(
                    "INSERT INTO story_lines(segment_id, unit_id, seq, line_key, speaker, speaker_id,"
                    " portrait, portrait_id, text_zh, text_en, text_ja) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                    rows,
                )
                u_lines += len(rows)
                u_chars += sum(len(r[8] or "") for r in rows)
            con.execute("UPDATE story_segments SET line_count=? WHERE id=?", (len(rows), seg_id))

        con.execute(
            "UPDATE story_units SET segment_count=?, line_count=?, char_count=? WHERE id=?",
            (len(segs), u_lines, u_chars, unit_id),
        )
        total_lines += u_lines

    con.commit()
    log(f"  台词 {total_lines:,} 条，耗时 {time.time()-t0:.1f}s")
    return speakers


# ---------------- 本地化表补全 ----------------

LINE_SUFFIX = re.compile(r"^(.*)_(\d+)$")
# 前缀 -> (category, 中文标签, 排序权重)
PREFIX_RULES = [
    (re.compile(r"^d_main_(\d+)"),        ("main",       "主线剧情",     1)),
    (re.compile(r"^d_nikke_"),            ("nikke",      "妮姬个人剧情", 20)),
    (re.compile(r"^d_counseling_"),       ("counseling", "咨询对话",     60)),
    (re.compile(r"^d_contents_"),         ("event",      "活动剧情",     10)),
    (re.compile(r"^event_"),              ("event",      "活动剧情",     10)),
    (re.compile(r"^d_subquest"),          ("sub",        "支线剧情",     30)),
    (re.compile(r"^sub_quest"),           ("sub",        "支线剧情",     30)),
    (re.compile(r"^d_ex_"),               ("sub",        "支线剧情",     30)),
    (re.compile(r"^s\d{3}"),              ("side_story", "支线故事",     40)),
]


def _normalize_group(g):
    """本地化表里主线段落用一位数（d_main_26_1_s），结构化导出用两位数
    （d_main_26_01_s）。统一补零后才能对上。"""
    return re.sub(r"^(d_main_\d+_)(\d+)(?=_|$)",
                  lambda m: m.group(1) + m.group(2).zfill(2), g)


def _slug_of(group):
    """从 group_key 提取活动/角色 slug，用于匹配已有单元"""
    g = group
    for pre in ("d_contents_", "d_nikke_", "d_counseling_", "d_ex_", "event_", "d_"):
        if g.startswith(pre):
            g = g[len(pre):]
            break
    tokens = [t for t in g.split("_") if t]
    # 去掉纯数字 token 和 s/e/b1 这类段落标记
    keep = [t for t in tokens if not t.isdigit() and not re.fullmatch(r"[seb]\d?", t)]
    return keep[0] if keep else (tokens[0] if tokens else "")


def import_locale_fill(con):
    """用本地化表补全结构化导出漏掉的剧情行"""
    log("[2/6] 本地化表补全 …")
    path = os.path.join(SRC, "其他剧情", "补充剧情文本", "补充剧情文本_全量.json")
    if not os.path.exists(path):
        log("  ! 找不到补充剧情文本，跳过")
        return

    con.execute("DELETE FROM story_lines WHERE segment_id IN"
                " (SELECT id FROM story_segments WHERE source='locale_fill')")
    con.execute("DELETE FROM story_segments WHERE source='locale_fill'")
    con.execute("DELETE FROM story_units WHERE source='locale_fill'")
    con.execute("DELETE FROM locale_strings")

    data = json.load(open(path, encoding="utf-8"))

    # 现有段落 / 单元
    seg_ids = {g: sid for g, sid in con.execute("SELECT group_key, id FROM story_segments")}
    units = con.execute(
        "SELECT id, category, bucket, chapter_no, title FROM story_units").fetchall()
    unit_by_chapter = {u[3]: u[0] for u in units if u[3] is not None}
    unit_by_bucket = {u[2]: u[0] for u in units}

    existing_keys = set(k for (k,) in con.execute("SELECT line_key FROM story_lines"))

    strings = []
    pending = defaultdict(list)   # group -> [(key, zh, en, ja)]
    for tbl in data:
        tname = tbl.get("table")
        for item in tbl.get("lines", []):
            k = item.get("key")
            if not k:
                continue
            # 支线任务的界面说明（「【第2章】调查…」）不是剧情台词，不补进正文
            if k.startswith("sub_quest_description"):
                continue
            zh = item.get("zh-CN") or item.get("zh_CN")
            en, ja = item.get("en"), item.get("ja")
            m = LINE_SUFFIX.match(k)
            if not m:
                strings.append((k, tname, zh, en, ja))
                continue
            group = _normalize_group(m.group(1))
            # 注意：group 已存在于库中也必须处理——它可能是 line_count=0 的空段落
            if k in existing_keys:
                continue
            pending[group].append((k, zh, en, ja))

    # 新建段落 + 单元
    new_seg = {}          # group -> seg_id
    new_units = {}        # (cat, bucket) -> unit_id
    added_lines = 0
    filled_existing = 0

    def ensure_unit(cat, label, bucket, chapter_no, weight):
        key = (cat, bucket)
        if key in new_units:
            return new_units[key]
        if chapter_no is not None and chapter_no in unit_by_chapter:
            new_units[key] = unit_by_chapter[chapter_no]
            return new_units[key]
        if bucket in unit_by_bucket:
            new_units[key] = unit_by_bucket[bucket]
            return new_units[key]
        cur = con.execute(
            "INSERT INTO story_units(category, category_label, bucket, title, chapter_no,"
            " sort_order, source) VALUES(?,?,?,?,?,?,'locale_fill')",
            (cat, label, bucket, bucket, chapter_no, weight * 10000 + 9990),
        )
        new_units[key] = cur.lastrowid
        return cur.lastrowid

    for group, rows in pending.items():
        cat, label, weight = "extra", "补充文本", 80
        chapter_no = None
        for pat, rule in PREFIX_RULES:
            m = pat.match(group)
            if m:
                cat, label, weight = rule
                if cat == "main" and m.groups():
                    chapter_no = int(m.group(1))
                break

        # 优先挂到已存在的同 group 段落（空段落补全）
        sid = seg_ids.get(group)
        if sid is None:
            slug = _slug_of(group)
            # 活动补全段（event_lastkingdom1_b01）的 slug 带部曲号，去掉数字
            # 才能挂回 event_lastkingdom 主卡，避免多出三张一句话活动卡
            if cat == "event":
                slug = re.sub(r"^(lastkingdom|miraclesnow)\d+$", r"\1", slug)
            # 支线任务按委托号精确归属。所有 d_subquest_* 的 slug 都是
            # 'subquest'，子串匹配会把孤儿段全挂到第一张卡上。
            sub_m = re.match(r"^(d_subquest_\d{3})\d(?:_[se])?$", group)
            exact = sub_m.group(1) if sub_m else None
            # main 类孤儿段落按章号直接归属（slug 提取会把 d_main_02af 这类 key 削成
            # 'main'，子串匹配会错挂到任意含 'main' 的单元——曾导致 af 段落进错章）
            if cat == "main" and chapter_no is not None and chapter_no in unit_by_chapter:
                uid = unit_by_chapter[chapter_no]
            elif exact and exact in unit_by_bucket:
                uid = unit_by_bucket[exact]
            else:
                bucket = None
                # 找 bucket 里含 slug 的已有单元
                for (uid, ucat, ubucket) in [(u[0], u[1], u[2]) for u in units]:
                    if slug and slug.lower() in (ubucket or "").lower() and ucat == cat:
                        new_units[(cat, ubucket)] = uid
                        bucket = ubucket
                        break
                if bucket is None:
                    bucket = slug or group
                uid = ensure_unit(cat, label, bucket, chapter_no, weight)
            cur = con.execute(
                "INSERT INTO story_segments(unit_id, group_key, title, sort_order, source)"
                " VALUES(?,?,?,?,'locale_fill')",
                (uid, group, None, 9990),
            )
            sid = cur.lastrowid
            new_seg[group] = sid
        else:
            uid = con.execute(
                "SELECT unit_id FROM story_segments WHERE id=?", (sid,)).fetchone()[0]
            filled_existing += 1

        payload = [(sid, uid,
                    int(LINE_SUFFIX.match(k).group(2)), k, None, None, None, None, zh, en, ja)
                   for k, zh, en, ja in rows]
        con.executemany(
            "INSERT INTO story_lines(segment_id, unit_id, seq, line_key, speaker, speaker_id,"
            " portrait, portrait_id, text_zh, text_en, text_ja) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            payload,
        )
        added_lines += len(payload)

    if strings:
        con.executemany(
            "INSERT OR REPLACE INTO locale_strings(key, table_name, value_zh, value_en, value_ja)"
            " VALUES(?,?,?,?,?)", strings)

    # 重算受影响的单元统计
    con.execute("""
        UPDATE story_segments SET line_count =
          (SELECT COUNT(*) FROM story_lines WHERE segment_id = story_segments.id)
    """)
    con.execute("""
        UPDATE story_units SET
          segment_count = (SELECT COUNT(*) FROM story_segments WHERE unit_id = story_units.id),
          line_count    = (SELECT COALESCE(SUM(line_count),0) FROM story_segments WHERE unit_id = story_units.id),
          char_count    = (SELECT COALESCE(SUM(LENGTH(text_zh)),0) FROM story_lines WHERE unit_id = story_units.id)
    """)
    con.commit()
    log(f"  补入台词 {added_lines:,} 条；空段落填充 {filled_existing} 个；"
        f"新增段落 {len(new_seg):,} 个；UI 字符串 {len(strings):,} 条入库")


def import_characters(con, speakers):
    log("[3/6] 聚合角色 …")
    con.execute("DELETE FROM characters")
    rows = [(sid, v["zh"] or sid, v["en"], v["ja"], v["count"], v["first"])
            for sid, v in speakers.items()]
    con.executemany(
        "INSERT OR REPLACE INTO characters(speaker_id, name_zh, name_en, name_ja, line_count, first_seen)"
        " VALUES(?,?,?,?,?,?)", rows,
    )
    con.commit()
    log(f"  角色 {len(rows)} 个（有台词的）")


# ---------------- CG ----------------

def import_cg_assets(con):
    log("[4/6] 扫描 CG 目录 …")
    con.execute("DELETE FROM cg_assets")
    cg_root = os.path.join(SRC, "CG")
    rows = []
    for path in glob.glob(os.path.join(cg_root, "**", "*.png"), recursive=True):
        rel = os.path.relpath(path, SRC).replace("\\", "/")
        name = os.path.basename(path)[:-4]
        is_atlas = name.endswith(".spine")
        if is_atlas:
            name = name[:-6]
        # 分类 = CG 下第一层目录
        parts = rel.split("/")
        category = parts[1] if len(parts) > 2 else ""
        sub = "/".join(parts[2:-1])
        rows.append((name, category, sub, rel, os.path.getsize(path), 1 if is_atlas else 0))

    # 同一 name 可能既有插画又有图集，合并成一行
    merged = {}
    for name, cat, sub, rel, size, atlas in rows:
        cur = merged.get(name)
        if cur is None:
            merged[name] = {"cat": cat, "sub": sub, "src": rel, "size": size if not atlas else 0,
                            "atlas": atlas, "has_art": 0 if atlas else 1}
        else:
            if not atlas:
                cur["src"] = rel
                cur["size"] = size
                cur["has_art"] = 1
            else:
                cur["atlas"] = 1

    payload = []
    for name, v in merged.items():
        has_spine = 1 if v["atlas"] else 0
        # is_spine_atlas 语义 = 「只有图集贴图、没有成品插画」，
        # 动态 CG 通常两者都有，不能被排除在插画之外
        only_atlas = 0 if v["has_art"] else 1
        payload.append((name, v["cat"], v["sub"], v["src"], v["size"], has_spine, only_atlas))
    con.executemany(
        "INSERT OR REPLACE INTO cg_assets(name, category, sub_category, src_path, file_size,"
        " has_spine, is_spine_atlas) VALUES(?,?,?,?,?,?,?)", payload,
    )
    con.commit()
    with_art = sum(1 for v in merged.values() if v["has_art"])
    log(f"  CG {len(payload)} 个（含成品插画 {with_art}，其中动态 CG {sum(1 for v in merged.values() if v['atlas'])}）")


CG_NAME = re.compile(r"^EventScene_[A-Za-z0-9_]+$")
SCENE_TOKENS = re.compile(rb"[ -~]{4,}")
# 台词记录的边界标记：Locale_XXX:<台词 key>。不同剧情类型的本地化表不同
# （主线 MainScenario、活动 SubScenario、个人 NikkeEpisode…），key 都以它为准。
LOCALE_MARK = re.compile(
    r"^Locale_(?:MainScenario|SubScenario|NikkeEpisode|SuddenStory|SideStory|Counseling):(.+)$")
GROUP_CSVS = [
    ("ScenarioDialog.Group.csv", "ScenarioDialogTable.{}.mpk"),
    ("EventScenarioDialog.Group.csv", "EventScenarioDialogTable.{}.mpk"),
    ("AttractiveScenarioDialog.Group.csv", "AttractiveScenarioDialogTable.{}.mpk"),
]


def cg_table_index():
    """group_key -> 对应的 ScenarioDialogTable.<group>.mpk 路径"""
    static = os.path.join(SRC, "staticdata")
    idx = {}
    for csv_name, tpl in GROUP_CSVS:
        p = os.path.join(static, csv_name)
        if not os.path.exists(p):
            continue
        with open(p, encoding="utf-8-sig") as f:
            for line in f:
                g = line.strip()
                if not g or g == "group_id":
                    continue
                t = os.path.join(static, tpl.format(g))
                if os.path.exists(t):
                    idx.setdefault(g, t)
    return idx


def parse_cg_events(group, path):
    """从 <前缀>Table.<group>.mpk 抽出「哪一行换了 CG」。

    一条台词一条记录：记录里 Locale_XXX:<台词key> 之后的字段才是这一行的演出
    参数（背景、BGM、EventScene_*）。所以用本地化 key 当记录边界，边界内出现的
    EventScene_* 就是「这一行起画面换成它」；没写字段的行沿用上一张。
    返回 [(line_key, [cg, ...]), ...]，只保留 CG 发生变化的行。
    """
    raw = open(path, "rb").read()
    toks = [m.group().decode("ascii", "replace") for m in SCENE_TOKENS.finditer(raw)]
    marks = []
    for i, s in enumerate(toks):
        m = LOCALE_MARK.match(s)
        if m:
            marks.append((i, m.group(1)))
    out = []
    prev = ()
    for k, (i, key) in enumerate(marks):
        end = marks[k + 1][0] if k + 1 < len(marks) else len(toks)
        cgs = tuple(dict.fromkeys(s for s in toks[i:end] if CG_NAME.match(s)))
        if not cgs or set(cgs) == set(prev):
            continue
        prev = cgs
        out.append((key, list(cgs)))
    return out


def import_cg_links(con):
    log("[5/6] 导入剧情↔CG 索引 …")
    con.execute("DELETE FROM cg_links")

    tables = cg_table_index()
    segs = defaultdict(list)
    for sid, uid, g in con.execute("SELECT id, unit_id, group_key FROM story_segments"):
        segs[g].append((sid, uid))
    key_map = defaultdict(list)
    for lid, lk, uid, sid in con.execute(
            "SELECT id, line_key, unit_id, segment_id FROM story_lines"):
        key_map[lk].append((lid, uid, sid))

    rows, seen = [], set()
    n_ev = n_hit = 0
    no_table = []
    for g in segs:
        path = tables.get(g)
        if not path:
            no_table.append(g)
            continue
        for line_key, cgs in parse_cg_events(g, path):
            hits = key_map.get(line_key)
            if not hits:
                continue
            n_ev += 1
            for cg in cgs:
                for lid, uid, sid in hits:
                    if (cg, lid) in seen:
                        continue
                    seen.add((cg, lid))
                    rows.append((cg, lid, line_key, "script", uid, sid))
                    n_hit += 1

    # ---- bg / 前景配对 ----
    # 脚本表常常只写 EventScene_X_bg（或只写 EventScene_X），阅读器要两层叠起来
    # 才还原游戏画面。这里把另一半补到同一行；只做同名配对，不再按 CG 名猜章节。
    # （旧逻辑把「没被脚本引用的 CG」一律塞进所属章节首段，正是第一章开头
    #   凭空冒出无关 CG 的根因。）
    assets = {n for (n,) in con.execute("SELECT name FROM cg_assets")}
    pairs = 0
    for cg, lid, lk, _mt, uid, sid in list(rows):
        base = cg[:-3] if cg.endswith("_bg") else cg
        sib = base if cg.endswith("_bg") else base + "_bg"
        if sib == cg or sib not in assets or (sib, lid) in seen:
            continue
        seen.add((sib, lid))
        rows.append((sib, lid, lk, "pair", uid, sid))
        pairs += 1

    con.executemany(
        "INSERT OR REPLACE INTO cg_links(cg_name, line_id, line_key, match_type, unit_id, segment_id)"
        " VALUES(?,?,?,?,?,?)", rows,
    )
    con.execute("""
        UPDATE cg_assets SET link_count =
          (SELECT COUNT(*) FROM cg_links WHERE cg_name = cg_assets.name)
    """)
    con.commit()

    if no_table:
        log(f"  ! {len(no_table)} 个段落没有脚本表、不参与关联："
            + "、".join(sorted(no_table)[:6]) + ("…" if len(no_table) > 6 else ""))
    linked = con.execute("SELECT COUNT(DISTINCT cg_name) FROM cg_links").fetchone()[0]
    log(f"  脚本行级 CG 切换 {n_ev:,} 处 → 链接 {n_hit:,} 条；bg/前景配对补 {pairs:,} 条")
    log(f"  链接合计 {len(rows):,} 条，覆盖 CG {linked:,} 个")


def apply_cg_flags(con):
    """套用人工标注（build/cg_flags.json）：哪些 CG 是活动封面/主视觉而非剧情画面。

    只写 cg_assets.is_cover，不动 cg_links —— 图鉴里打标签，阅读器照旧。
    """
    log("[4.5] 应用 CG 标注 …")
    con.execute("UPDATE cg_assets SET is_cover=0")
    if not os.path.exists(CG_FLAGS):
        log("  ！ 找不到 cg_flags.json，跳过")
        return
    with open(CG_FLAGS, encoding="utf-8") as f:
        d = json.load(f)
    names = [n for n in dict.fromkeys(d.get("cover") or []) if n]
    missing = []
    for n in names:
        cur = con.execute("UPDATE cg_assets SET is_cover=1 WHERE name=?", (n,))
        if not cur.rowcount:
            missing.append(n)
    con.commit()
    log(f"  封面/主视觉标注 {len(names) - len(missing)} 张"
        + (f"；{len(missing)} 个名字在图库里找不到：{'、'.join(missing[:5])}"
           if missing else ""))


def import_animations(con):
    log("[6/6] 扫描动态 CG …")
    con.execute("DELETE FROM cg_animations")
    # 离线合成的 WebP 动图已下线；动态 CG 现在统一由实时 Spine 模型清单判定，
    # 避免删掉 1.7GB 生成物后 cg_animations / 首页统计归零。
    meta = os.path.join(ROOT, "public", "data", "spine_models.json")
    rows = []
    if os.path.exists(meta):
        with open(meta, encoding="utf-8") as f:
            names = json.load(f).get("items", [])
        for name in names:
            folder = os.path.join(ROOT, "public", "spine", name)
            size = sum(
                os.path.getsize(p) for p in glob.glob(os.path.join(folder, "*"))
                if os.path.isfile(p)
            )
            rows.append((name, f"public/spine/{name}", size))
    con.executemany(
        "INSERT OR REPLACE INTO cg_animations(name, src_path, file_size) VALUES(?,?,?)", rows)
    con.commit()
    log(f"  动态 CG {len(rows)} 个（实时模型）")


# ---------------- 统计 ----------------

def print_stats(con):
    log("\n" + "=" * 56)
    log("数据对账")
    log("=" * 56)
    q = lambda sql: con.execute(sql).fetchone()[0]
    named = con.execute(
        "SELECT COUNT(*) FROM story_lines WHERE speaker IS NOT NULL AND speaker <> ''").fetchone()[0]
    log(f"  剧情单元   {q('SELECT COUNT(*) FROM story_units'):>10,}")
    log(f"  剧情段落   {q('SELECT COUNT(*) FROM story_segments'):>10,}")
    log(f"  台词行     {q('SELECT COUNT(*) FROM story_lines'):>10,}")
    log(f"  有名字台词 {named:>10,}")
    log(f"  角色       {q('SELECT COUNT(*) FROM characters'):>10,}")
    log(f"  CG 资产    {q('SELECT COUNT(*) FROM cg_assets'):>10,}")
    log(f"  CG 链接    {q('SELECT COUNT(*) FROM cg_links'):>10,}")
    log(f"  动态 CG    {q('SELECT COUNT(*) FROM cg_animations'):>10,}")
    log("-" * 56)
    log("  按分类：")
    for cat, label, n, lines in con.execute("""
        SELECT category, category_label, COUNT(*), SUM(line_count)
        FROM story_units GROUP BY category ORDER BY MIN(sort_order)
    """):
        log(f"    {label:<12} {n:>5} 单元 / {lines or 0:>8,} 条台词")
    log("-" * 56)
    top = con.execute(
        "SELECT name_zh, line_count FROM characters ORDER BY line_count DESC LIMIT 8").fetchall()
    log("  台词最多的角色：" + "、".join(f"{n}({c:,})" for n, c in top))
    log("=" * 56)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["story", "cg", "fill", "stats"], default=None)
    ap.add_argument("--stats", action="store_true")
    args = ap.parse_args()

    if not os.path.isdir(SRC):
        log(f"! 源目录不存在：{SRC}")
        sys.exit(1)

    con = connect()

    if args.stats:
        print_stats(con)
        return

    t0 = time.time()
    if args.only in (None, "story"):
        speakers = import_story(con)
        import_locale_fill(con)
        fts_rebuild(con)
        import_characters(con, speakers)
    if args.only in (None, "cg"):
        import_cg_assets(con)
        import_cg_links(con)
        apply_cg_flags(con)
        import_animations(con)

    con.execute("INSERT OR REPLACE INTO meta(key, value) VALUES('built_at', datetime('now'))")
    con.execute("INSERT OR REPLACE INTO meta(key, value) VALUES('source', ?)", (SRC,))
    con.commit()
    con.isolation_level = None
    con.execute("VACUUM")
    con.isolation_level = ""

    log(f"\n总耗时 {time.time()-t0:.1f}s")
    print_stats(con)
    log(f"\n输出：{DB_PATH}  ({os.path.getsize(DB_PATH)/1048576:.1f} MB)")


if __name__ == "__main__":
    main()
