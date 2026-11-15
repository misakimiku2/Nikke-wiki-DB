# -*- coding: utf-8 -*-
"""角色 → 好感剧情 / 咨询 映射导出

来源：data/nikke.db 的 story_units（category=nikke/counseling，含 treasurestory_*）。
行数据本体不在这里复制——前端用现有的 /data/story/<unit_id>.json 按需加载
（个人剧情走 /story/:id 阅读器，咨询走详情页内的对话式查看器）。

角色映射（按优先级）：
  1. bucket 后缀与角色英文名全匹配（忽略非字母数字：anne_miraclefairy ≈ "Anne: Miracle Fairy"）
  2. 下划线拆分 base_skin：base 匹配角色名 → 皮肤剧情（marian_p 例外走 alias → 神罚）
  3. 级联前缀匹配拼接皮肤：arcanafortunemate → arcana + fortunemate
  4. alias 表（hongryeon 系 / marian_p）
  5. 都失败则丢弃并记录（c_*/ce* 联动与 NPC 剧情本来就不映射）

皮肤中文名：从咨询会话标题解析（"与阿妮斯：超级巨星的咨询：01" → 超级巨星），
同后缀的个人剧情皮肤共用；无咨询可借的用后缀伪化（Title Case）兜底。

输出：public/data/char_stories.json
      {"total": n, "items": {"<cid>": {
          "stories": [{"id","t","lines","segs","skin"}...],
          "counsel": [{"id","t","lines","sessions","skin"}...]}}}
"""
import json
import os
import re
import sqlite3

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, "data", "nikke.db")
OUT = os.path.join(ROOT, "public", "data", "char_stories.json")
SRC = os.environ.get("NIKKE_SRC", r"E:/test/nikke_extract")

# 手工兜底：bucket 名与角色内部命名不一致的
ALIAS = {
    "hongryeon": 222,               # 红莲（韩文音译 Hongryeon，英文叫 Scarlet）
    "hongryeon_blackshadow": 225,   # 红莲：暗影
    "hongryeon_goddeath": 472,      # 红莲：弑神
    "marian_p": 260,                # 神罚（Modernia）的内部模型名还叫 marian_p
}
# 联动 / NPC 剧情桶前缀，不映射到角色
SKIP = ("c_", "ce")


def log(m):
    print(m, flush=True)


def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def load_chars():
    chars = json.load(open(os.path.join(ROOT, "public", "data", "characters.json"),
                           encoding="utf-8"))["items"]
    en2, zh_of = {}, {}
    for ch in chars:
        key = norm(ch["names"].get("en"))
        if key and key not in en2:
            en2[key] = ch["id"]
        zh_of.setdefault(ch["id"], ch["name"])
    return en2, zh_of


def load_skin_names():
    """bucket(lower) → 皮肤中文名，从咨询会话标题解析"""
    path = os.path.join(SRC, "其他剧情", "咨询对话", "咨询对话_全量.json")
    if not os.path.exists(path):
        return {}
    data = json.load(open(path, encoding="utf-8"))
    out = {}
    for u in data:
        title = (u["groups"][0].get("title") or "") if u.get("groups") else ""
        m = re.match(r"^(?:与)?([^：]+)(?:：([^：]+))?的(?:咨询|追忆|回忆)：\d+$", title)
        if m and m.group(2):
            out[u["bucket"].lower()] = m.group(2)
    return out


def prettify(sfx):
    """无中文名可借时把后缀伪化成 'Sparkling Summer' 风格（最后手段）"""
    return re.sub(r"([a-z])([A-Z])", r"\1 \2", sfx).replace("_", " ").strip().capitalize()


def main():
    en2, zh_of = load_chars()
    skin_names = load_skin_names()

    con = sqlite3.connect(DB)
    units = con.execute(
        "select id, bucket, title, segment_count, line_count, sort_order "
        "from story_units where category in ('nikke','counseling') order by sort_order"
    ).fetchall()
    # 咨询会话数按「有标题的段」计：sort>=9000 是误挂进来的皮肤杂段（无标题）
    titled = dict(con.execute(
        "select unit_id, count(*) from story_segments "
        "where sort_order < 9000 and title is not null and title != '' group by unit_id"
    ).fetchall())

    def chapters_of(uid):
        """个人剧情的章节名与句数，供角色页直接展开（不必先跳阅读器）。"""
        return [
            {"t": t or f"第 {i} 章", "n": n}
            for i, (t, n) in enumerate(con.execute(
                "select title, line_count from story_segments"
                " where unit_id=? and line_count>0 order by sort_order", (uid,)), start=1)
        ]

    items = {}
    dropped = []
    for uid, bucket, _title, segs, lines, _so in units:
        lb = bucket.lower()
        m = re.match(r"^d_(nikke|counseling)_([a-z0-9_]+)$", lb)
        treasure = False
        if not m:
            m = re.match(r"^treasurestory_([a-z0-9]+)$", lb)
            treasure = True
        if not m:
            dropped.append((bucket, "unrecognized"))
            continue
        kind = "treasure" if treasure else ("counsel" if m.group(1) == "counseling" else "story")
        sfx = m.group(2 if not treasure else 1)

        # ---- 角色匹配 ----
        cid, skin = None, None
        n = norm(sfx)
        if n in en2:
            cid = en2[n]
        elif sfx in ALIAS:
            cid = ALIAS[sfx]
        elif "_" in sfx and not sfx.startswith(SKIP):
            base, sk = sfx.rsplit("_", 1)
            if base in ALIAS:
                cid = ALIAS[base]
            elif norm(base) in en2:
                cid = en2[norm(base)]
                skin = sk
        if cid is None and not sfx.startswith(SKIP):
            # 拼接皮肤：最长角色名前缀
            for key in sorted(en2, key=len, reverse=True):
                if n.startswith(key) and len(n) - len(key) >= 3:
                    cid = en2[key]
                    skin = sfx[len(key):]
                    break
        if cid is None:
            dropped.append((bucket, "no char"))
            continue

        # ---- 皮肤中文名 ----
        skin_zh = None
        if skin:
            skin_zh = (skin_names.get(f"d_counseling_{sfx}")
                       or skin_names.get(f"d_nikke_{sfx}")
                       or prettify(skin))

        # ---- 条目标题 ----
        if kind == "treasure":
            t = "宝物剧情"
        elif skin_zh:
            t = f"{skin_zh}·个人剧情" if kind == "story" else f"{skin_zh}·咨询"
        else:
            t = "个人剧情" if kind == "story" else "咨询"

        entry = items.setdefault(cid, {"stories": [], "counsel": []})
        arr = entry["counsel"] if kind == "counsel" else entry["stories"]
        rec = {"id": uid, "t": t, "lines": lines}
        if skin_zh:
            rec["skin"] = skin_zh
        if kind == "counsel":
            rec["sessions"] = titled.get(uid, segs)
        else:
            rec["segs"] = segs
            rec["chapters"] = chapters_of(uid)
        arr.append(rec)

    # 排序：无皮肤在前，皮肤按名字
    for cid, e in items.items():
        rank = lambda r: (0 if "skin" not in r else 1, r["t"], r["id"])
        e["stories"].sort(key=rank)
        e["counsel"].sort(key=rank)

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"total": len(items), "items": items}, f,
                  ensure_ascii=False, separators=(",", ":"))

    n_story = sum(len(e["stories"]) for e in items.values())
    n_counsel = sum(len(e["counsel"]) for e in items.values())
    log(f"角色 {len(items)} 个：个人/宝物剧情 {n_story} 卷，咨询 {n_counsel} 组")
    log(f"丢弃 {len(dropped)} 个未映射单元：")
    for b, why in dropped:
        log(f"  - {b} ({why})")

    # 校验：前端要按 id 拉 /data/story/<id>.json
    story_dir = os.path.join(ROOT, "public", "data", "story")
    missing = []
    for e in items.values():
        for r in e["stories"] + e["counsel"]:
            if not os.path.exists(os.path.join(story_dir, f"{r['id']}.json")):
                missing.append(r["id"])
    if missing:
        log(f"! 缺少 story JSON: {missing}")
    else:
        log("story JSON 全部齐备")


if __name__ == "__main__":
    main()
