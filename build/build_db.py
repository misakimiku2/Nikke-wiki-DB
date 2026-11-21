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

import cg_alias

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # nikke-web
SRC = os.environ.get("NIKKE_SRC", r"E:/test/nikke_extract")
DB_PATH = os.path.join(ROOT, "data", "nikke.db")
SCHEMA = os.path.join(ROOT, "build", "schema.sql")
CG_FLAGS = os.path.join(ROOT, "build", "cg_flags.json")
CG_EXCLUDE = os.path.join(ROOT, "build", "cg_exclude.json")
MAIN_SECTION_NAMES = os.path.join(ROOT, "build", "main_section_names.json")


def load_excluded_cg():
    """不该进图库 / 剧情关联的素材（裸贴图、无渲染插画）"""
    try:
        with open(CG_EXCLUDE, encoding="utf-8") as f:
            return set(json.load(f).get("names", []))
    except Exception:
        return set()

# 其他剧情的模块定义：(子目录, 文件名, category, 中文标签, 排序权重)
OTHER_MODULES = [
    ("活动剧情",            "活动剧情_全量.json",        "event",     "活动剧情",        10),
    ("妮姬个人剧情",        "妮姬个人剧情_全量.json",    "nikke",     "妮姬个人剧情",    20),
    ("支线剧情",            "支线剧情_全量.json",        "sub",       "支线剧情",        30),
    ("支线故事",            "支线故事_全量.json",        "side_story","支线故事",        40),
    ("外传与前哨基地日常",  "",                          "gaiden",    "外传与日常",      50),
    ("咨询对话",            "咨询对话_全量.json",        "counseling","咨询对话",        60),
    ("短信与日常对话",      "短信与日常对话_全量.json",  "daily",     "日常对话",        70),
    ("补充剧情文本",        "补充剧情文本_全量.json",    "extra",     "补充剧情",        80),
]


def log(msg):
    print(msg, flush=True)


SCHEMA_VERSION = 8


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
        "text_ko": raw.get("ko"),
    }


def _load_main_section_names():
    """group_key -> 游戏内真实小节名（export_main_section_names.py 产出）。

    现格式为四语 {"zh","en","ko","ja"}；zh 之外的语言由 export_story.py /
    前端按需读取，这里只消费 zh（兼容旧版纯字符串值）。
    """
    try:
        with open(MAIN_SECTION_NAMES, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


MAIN_SECTION_NAMES_MAP = _load_main_section_names()


def main_section_title(group_key):
    """主线段落的节名：优先用游戏内真实名，后记/未覆盖的用序号兜底。

    d_main_01_01_s -> 第一次接触: A（来自 main_section_names.json）
    d_main_28af_02 -> 第28章·后记 02（后记无 quest 名）
    """
    real = MAIN_SECTION_NAMES_MAP.get(group_key)
    if isinstance(real, dict):
        real = real.get("zh")
    if real:
        return real
    m = re.match(r"^d_main_(\d+)(?:_?)(af|bf)_(\d+)$", group_key)
    if m:
        return f"第{int(m.group(1)):02d}章·后记 {int(m.group(3)):02d}"
    m = re.match(r"^d_main_(\d+)_(\d+)(?:_([se]))?$", group_key)
    if m:
        base = f"第{int(m.group(2)):02d}节"
        if m.group(3) == "s":
            base += "（前篇）"
        elif m.group(3) == "e":
            base += "（后篇）"
        return base
    return ""


def game_chapter_titles():
    """游戏章节标题（Locale_Stage:chapter_name_NN）。注意这张表是 0-based：
    chapter_name_00 = 坠落（第01章）、chapter_name_01 = 侵蚀（第02章）。
    只作对照用，不要拿 1-based 章号直接索引。"""
    dec_dir = os.path.join(SRC, "decrypted")
    path = None
    for f in os.listdir(dec_dir) if os.path.isdir(dec_dir) else []:
        if not f.endswith(".dec"):
            continue
        p = os.path.join(dec_dir, f)
        try:
            conn = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
            has = "Locale_Stage" in [r[0] for r in con_tables(conn)]
            conn.close()
            if has:
                path = p
                break
        except Exception:
            pass
    titles = {}
    if not path:
        return titles
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        for n in range(0, 51):
            row = conn.execute(
                'SELECT "zh-CN" FROM Locale_Stage WHERE Key=?',
                (f"chapter_name_{n:02d}",)).fetchone()
            if row and row[0]:
                titles[n] = row[0]
        conn.close()
    except Exception:
        pass
    return titles


def con_tables(conn):
    return conn.execute("SELECT name FROM sqlite_master WHERE type='table'")


def collect_story_units():
    """返回 [(unit_dict, [segment_dict, ...])]"""
    units = []

    # --- 主线 ---
    # 游戏章节以 Locale_Stage:chapter_name_NN 为准（0-based：00 坠落、01 侵蚀…）。
    # 上游 JSON 的 chapter 是 1-based 且把 d_main_01 整段塞进「第01章」，
    # 与游戏实际边界不符：d_main_01 的前半（01_01~01_03，5 节）属于第 0 章
    # 「坠落」，后半（01_04~01_07 + 01af 后记，12 节）属于第 1 章「侵蚀」。
    # 这里按游戏边界重切：d_main_01 拆成 00/01 两章，d_main_NN(NN>=2) 直接
    # 对应游戏第 NN 章（标题用 chapter_name_NN）。
    main_path = os.path.join(SRC, "主线剧情", "主线剧情_全量.json")
    if os.path.exists(main_path):
        d = json.load(open(main_path, encoding="utf-8"))
        gchap = game_chapter_titles()   # 0-based 章名
        main_units = []                 # (chapter_no, title, bucket, [section,...])

        def sec_dict(sec, so):
            gkey = sec.get("group") or sec.get("group_key") or ""
            return {
                "group_key": gkey,
                "title": sec.get("title") or main_section_title(gkey),
                "part": sec.get("part"),
                "sort_order": so,
                "lines": sec.get("lines") or [],
            }

        for order, ch in enumerate(d.get("chapters", []), start=1):
            no = ch.get("chapter")
            sections = list(ch.get("sections", []))
            if not sections:
                continue
            if no == 1:
                # 拆成游戏第 0 章（坠落：01_01~01_03）与第 1 章（侵蚀：其余）
                fall, erosion = [], []
                for sec in sections:
                    g = sec.get("group") or ""
                    m = re.match(r"^d_main_01_(\d+)", g)
                    (fall if m and int(m.group(1)) <= 3 else erosion).append(sec)
                if fall:
                    main_units.append((0, gchap.get(0) or "坠落", "d_main_00", fall))
                if erosion:
                    main_units.append((1, gchap.get(1) or "侵蚀", "d_main_01", erosion))
            else:
                main_units.append((no, gchap.get(no) or ch.get("title") or "",
                                   "d_main_%02d" % no, sections))

        for ch_no, ch_title, bucket, sections in main_units:
            unit = {
                "category": "main",
                "category_label": "主线剧情",
                "bucket": bucket,
                "title": ch_title,
                "chapter_no": ch_no,
                "sort_order": ch_no,
            }
            segs = [sec_dict(sec, so) for so, sec in enumerate(sections, start=1)]
            units.append((unit, segs))

        log(f"  主线：{len(main_units)} 章")

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
            if subdir == "短信与日常对话":
                # MessengerDialogTable 里的独立巴拉房间在角色页展示，剧情内嵌
                # 短信由 build/export_story_sms.mjs 映射回各自剧情单元并在阅读器
                # 里以内嵌气泡显示；这里不再单独建一个短信单元。
                data = [item for item in data if item.get("bucket") != "MessengerDialogTable"]
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
                             f["portrait"], f["portrait_id"], f["text_zh"], f["text_en"],
                             f["text_ja"], f["text_ko"]))
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
                    " portrait, portrait_id, text_zh, text_en, text_ja, text_ko)"
                    " VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
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
                    int(LINE_SUFFIX.match(k).group(2)), k, None, None, None, None, zh, en, ja, None)
                   for k, zh, en, ja in rows]
        con.executemany(
            "INSERT INTO story_lines(segment_id, unit_id, seq, line_key, speaker, speaker_id,"
            " portrait, portrait_id, text_zh, text_en, text_ja, text_ko)"
            " VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
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


def backfill_line_locale(con):
    """按台词 key 从 Locale_*.lsc 回填 en / ko。

    上游剧情 JSON 只导出 zh-CN（主线/部分活动带 en/ja），但本地化库本身是
    十语并列的。这里不再重跑上游导出，直接把 48 万条台词按 key 补上
    英文 / 韩文 / 日文；Locale_* 表之间 key 基本不重叠（实测仅 5 个），
    先写入的非空值优先，不会被后面的表覆盖。已有值的列（如主线的 ja）
    通过 COALESCE 保留，不会被覆盖。
    """
    log("[2.5/6] 回填英文 / 韩文 / 日文台词 …")
    line_keys = {k for (k,) in con.execute("SELECT DISTINCT line_key FROM story_lines")}
    str_keys = {k for (k,) in con.execute("SELECT key FROM locale_strings")}
    if not line_keys and not str_keys:
        return

    found: dict[str, tuple[str | None, str | None, str | None]] = {}
    dec_dir = os.path.join(SRC, "decrypted")
    files = sorted(f for f in os.listdir(dec_dir) if f.endswith(".dec")) \
        if os.path.isdir(dec_dir) else []
    for fname in files:
        path = os.path.join(dec_dir, fname).replace("\\", "/")
        try:
            loc = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        except Exception:
            continue
        try:
            tables = [r[0] for r in loc.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Locale_%'")]
            for table in tables:
                cols = {r[1] for r in loc.execute(f'PRAGMA table_info("{table}")')}
                if not {"Key", "en", "ko", "ja"} <= cols:
                    continue
                for key, en, ko, ja in loc.execute(f'SELECT Key, en, ko, ja FROM "{table}"'):
                    if key not in line_keys and key not in str_keys:
                        continue
                    old = found.get(key)
                    if old is None:
                        found[key] = (en or None, ko or None, ja or None)
                    else:
                        found[key] = (old[0] or en or None, old[1] or ko or None,
                                      old[2] or ja or None)
        except Exception as e:
            log(f"  ! {fname}: {type(e).__name__} {e}")
        finally:
            loc.close()

    line_updates = [(en, ko, ja, k) for k, (en, ko, ja) in found.items() if k in line_keys]
    con.executemany(
        "UPDATE story_lines SET"
        " text_en = COALESCE(NULLIF(text_en, ''), NULLIF(?, '')),"
        " text_ko = COALESCE(NULLIF(?, ''), text_ko),"
        " text_ja = COALESCE(NULLIF(text_ja, ''), NULLIF(?, ''))"
        " WHERE line_key = ?", line_updates,
    )
    str_updates = [(ko, k) for k, (_en, ko, _ja) in found.items() if k in str_keys and ko]
    con.executemany("UPDATE locale_strings SET value_ko=? WHERE key=?", str_updates)
    con.commit()
    n_en = con.execute(
        "SELECT COUNT(*) FROM story_lines WHERE text_en IS NOT NULL AND text_en != ''").fetchone()[0]
    n_ko = con.execute(
        "SELECT COUNT(*) FROM story_lines WHERE text_ko IS NOT NULL AND text_ko != ''").fetchone()[0]
    n_ja = con.execute(
        "SELECT COUNT(*) FROM story_lines WHERE text_ja IS NOT NULL AND text_ja != ''").fetchone()[0]
    log(f"  命中 {len(found):,} 个 key；台词英文 {n_en:,} / 韩文 {n_ko:,} / 日文 {n_ja:,} 条")


def import_characters(con, speakers):
    log("[3/6] 聚合角色 …")
    con.execute("DELETE FROM characters")
    rows = [(sid, v["zh"] or sid, v["en"], v["ja"], None, v["count"], v["first"])
            for sid, v in speakers.items()]
    con.executemany(
        "INSERT OR REPLACE INTO characters(speaker_id, name_zh, name_en, name_ja, name_ko,"
        " line_count, first_seen) VALUES(?,?,?,?,?,?,?)", rows,
    )
    con.commit()
    log(f"  角色 {len(rows)} 个（有台词的）")


# ---------------- CG ----------------

def import_cg_assets(con):
    log("[4/6] 扫描 CG 目录 …")
    con.execute("DELETE FROM cg_assets")
    cg_root = os.path.join(SRC, "CG")
    excluded = load_excluded_cg()
    rows = []
    for path in glob.glob(os.path.join(cg_root, "**", "*.png"), recursive=True):
        if os.path.basename(path)[:-4] in excluded:
            continue
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

    # 台词 CG 名与导出文件名不一致的别名（大小写差异 / 差分后缀回退，见
    # build/cg_alias.py）：上游索引已把这类 token 指向真实图片，web 端补同名
    # 资产行，链接/图鉴/阅读器才能按台词名查到图。共用真实图的源文件与分类。
    aliases = cg_alias.load_cg_aliases(SRC)
    for alias_name, real_name in aliases.items():
        if alias_name in merged and real_name in merged:
            continue
        if alias_name not in merged and real_name in merged:
            merged[alias_name] = dict(merged[real_name])

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


def harvest_cg_line_assets():
    """上游剧情 JSON（单一事实源）收集行级 CG 转场与动态模型/背景。

    上游（nikke_extract scripts/cg_refs.py）在行级落这些字段（各自只在发生
    变化的行写）：
      cg  = [EventScene_* token, ...]（差分逐个列出；空数组 = 触发行下一行的
            空转场，不含 CG，不入库）
      cgd = 该行动态 CG 的 spine 模型名（token 是模型名或其 X_bg 板时解析）
      cgb = 该行动态 CG 应铺的背景板（优先 X_bg 板，否则 06_剧情背景 / black）
      bg  = 场景切换列表（black=黑屏转场、none=清空背景、其余为场景板名，
            按记录内出现顺序）——CG 显示区间在后续行的 black/none 处切断，
            阅读器场景背景层也由它驱动
      fx  = 特效层命令 fx_EventScene_*（叠加演出特效，不是主画面 CG，不进
            cg_links；web 端可按需渲染叠加层）

    覆盖主线（主线剧情_全量.json）、其他剧情各 *_全量.json、Marian 结构化 JSON
    ——与 collect_story_units 同一批文件，替代旧版按段落逐个解 mpk 的
    parse_cg_events()（它只认 3 族 ScenarioDialog 表，支线故事/妮姬个人/Marian
    从来没有 CG 链接）。line_key 与 story_lines.line_key 同一生成器，撞车 key
    （回放副本）会命中多行、各自建链，与旧行为一致。

    返回 {line_key: {"cg": [名...], "model": cgd, "cgb": cgb,
                     "bg": [场景切换...], "fx": [特效...]}}
    """
    events = {}

    def eat(lines):
        for raw in lines or []:
            if not isinstance(raw, dict):
                continue
            key = raw.get("key") or raw.get("id") or raw.get("line_key")
            if not key:
                continue
            cgs = raw.get("cg")
            bgs = raw.get("bg")
            fxs = raw.get("fx")
            if not cgs and not bgs and not fxs:
                continue
            events[key] = {"cg": list(cgs) if cgs else [],
                           "model": raw.get("cgd") or "",
                           "cgb": raw.get("cgb") or "",
                           "bg": list(bgs) if bgs else [],
                           "fx": list(fxs) if fxs else []}

    main_path = os.path.join(SRC, "主线剧情", "主线剧情_全量.json")
    if os.path.exists(main_path):
        d = json.load(open(main_path, encoding="utf-8"))
        for ch in d.get("chapters", []):
            for sec in ch.get("sections", []):
                eat(sec.get("lines"))
    for subdir, fname, _cat, _label, _weight in OTHER_MODULES:
        folder = os.path.join(SRC, "其他剧情", subdir)
        paths = [os.path.join(folder, fname)] if fname \
            else sorted(glob.glob(os.path.join(folder, "*_全量.json")))
        for path in paths:
            if not os.path.exists(path):
                continue
            data = json.load(open(path, encoding="utf-8"))
            for item in data if isinstance(data, list) else []:
                for grp in item.get("groups", []):
                    eat(grp.get("lines"))
    marian = os.path.join(SRC, "其他剧情", "活动剧情", "Marian", "event_marian_结构化.json")
    if os.path.exists(marian):
        d = json.load(open(marian, encoding="utf-8"))
        for ch in d.get("chapters", []):
            eat(ch.get("lines"))
    return events


def import_cg_links(con):
    log("[5/6] 导入剧情↔CG 索引 …")
    con.execute("DELETE FROM cg_links")

    excluded = load_excluded_cg()
    key_map = defaultdict(list)
    for lid, lk, uid, sid in con.execute(
            "SELECT id, line_key, unit_id, segment_id FROM story_lines"):
        key_map[lk].append((lid, uid, sid))

    rows, seen = [], set()
    n_ev = n_hit = 0
    n_miss = 0
    events = harvest_cg_line_assets()
    for line_key, ev in events.items():
        hits = key_map.get(line_key)
        if not hits:
            n_miss += 1
            continue
        n_ev += 1
        for cg in ev["cg"]:
            if cg in excluded:
                continue
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
        if sib == cg or sib not in assets or sib in excluded or (sib, lid) in seen:
            continue
        seen.add((sib, lid))
        rows.append((sib, lid, lk, "pair", uid, sid))
        pairs += 1

    # 注：人工校对表 script_cg_map.json 已退役——上游行级 cg 字段成为单一事实源
    # 后它再无有效条目（差分覆盖类实为 fx 特效 token，见 harvest_cg_line_assets）。

    con.executemany(
        "INSERT OR REPLACE INTO cg_links(cg_name, line_id, line_key, match_type, unit_id, segment_id)"
        " VALUES(?,?,?,?,?,?)", rows,
    )
    con.execute("""
        UPDATE cg_assets SET link_count =
          (SELECT COUNT(*) FROM cg_links WHERE cg_name = cg_assets.name)
    """)
    con.commit()

    linked = con.execute("SELECT COUNT(DISTINCT cg_name) FROM cg_links").fetchone()[0]
    log(f"  上游行级 CG 转场 {n_ev:,} 处（{n_miss} 个 key 不在库内，多为已清空台词的残表）"
        f" → 链接 {n_hit:,} 条；bg/前景配对补 {pairs:,} 条")
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
        backfill_line_locale(con)
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
