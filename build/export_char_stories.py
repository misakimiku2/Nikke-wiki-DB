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
          "stories": [{"id","t","lines","segs","skin","ts"}...],
          "counsel": [{"id","t","lines","sessions","skin","ts"}...]}}}
ts 为标题的其他语言（{"en","ko","ja"}，皮肤名来自 Locale_Counseling 会话标题）。
"""
import json
import os
import re
import sqlite3

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, "data", "nikke.db")
OUT = os.path.join(ROOT, "public", "data", "char_stories.json")
SRC = os.environ.get("NIKKE_SRC", r"E:/test/nikke_extract")

# 记录标题尾词的四语（「个人剧情 / 咨询」站内标签，与 web/src/ui.ts 的
# rel_stories / rel_counsel 行一致，非机翻）
REC_SUFFIX = {
    "story": {"en": "Story", "ko": "개인 스토리", "ja": "個人ストーリー"},
    "counsel": {"en": "Counseling", "ko": "상담", "ja": "カウンセリング"},
}

# 咨询会话标题里皮肤名的语言差异（「与阿妮斯：超级巨星的咨询：01 /
# Advising Anis: Star: 01 / 아니스 : 스타와의 상담 : 01 / アニス：スターとの面談：01」）
COUNSEL_SKIN_SUFFIX = {
    "zh": re.compile(r"的?(?:咨询|追忆|回忆)$"),
    "ko": re.compile(r"(?:와|과|와 함께|과 함께)?의?\s*상담$"),
    "ja": re.compile(r"との面談$"),
}


def load_locale_titles(table):
    """指定 Locale 表的 <key>_title 四语值，key 统一小写。"""
    out = {}
    dec_dir = os.path.join(SRC, "decrypted")
    files = sorted(f for f in os.listdir(dec_dir) if f.endswith(".dec")) \
        if os.path.isdir(dec_dir) else []
    for fname in files:
        path = os.path.join(dec_dir, fname).replace("\\", "/")
        loc = None
        try:
            loc = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
            if table not in {r[0] for r in loc.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'")}:
                continue
            for key, en, ko, ja, zh in loc.execute(
                    f'SELECT Key, en, ko, ja, "zh-CN" FROM {table}'
                    " WHERE Key LIKE '%_title'"):
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


def load_counsel_titles():
    """Locale_Counseling 的 <group>_title 四语值，key 统一小写。"""
    return load_locale_titles("Locale_Counseling")


def load_nikke_titles():
    """Locale_NikkeEpisode 的 <group>_title 四语值（个人剧情章节官方名）。"""
    return load_locale_titles("Locale_NikkeEpisode")


def skin_of_counsel(loc, slug, slug_index=None):
    """从 Locale_Counseling 会话标题解析皮肤名的四语值；解析失败的语言为空串。

    slug_index：norm(slug)（去下划线）-> 真实 slug，处理 bucket 与会话 slug
    下划线写法不一致的兜底（eleggboomandshock → elegg_boomandshock）。
    """
    if slug_index:
        slug = slug_index.get(slug.replace("_", ""), slug)
    slot = None
    for i in range(1, 21):
        s = loc.get(f"d_counseling_{slug}_{i:02d}_title".lower())
        if s and s.get("zh"):
            slot = s
            break
    if not slot:
        return {}
    out = {}
    for lang in ("zh", "en", "ko", "ja"):
        t = (slot.get(lang) or "").strip()
        if not t:
            continue
        t = re.sub(r"\s*[:：]\s*\d+\s*$", "", t)          # 尾部会话编号
        if lang == "zh":
            t = re.sub(r"^与", "", t)
        elif lang == "en":
            t = re.sub(r"^Advising\s+", "", t, flags=re.I)
        suf = COUNSEL_SKIN_SUFFIX.get(lang)
        if suf:
            t = suf.sub("", t)
        parts = re.split(r"\s*[:：]\s*", t) if t else []
        skin = parts[-1].strip() if parts else ""
        out[lang] = skin if skin and len(parts) > 1 else ""
    return out

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


def load_fullnames():
    """角色中文全名 -> id。剧情标题若正好命中，说明该卷属于这个具体角色卡。

    「艾玛：战术升级」这类独立抽卡角色和基础角色是同一个人，bucket 里只写了
    简写（emma_tactical），按 base+皮肤拆分会把整卷并到基础角色身上；英文名重名
    的角色（莱伊 / 零 都写作 Rei）也会互相抢，所以都用剧情标题反查。
    """
    chars = json.load(open(os.path.join(ROOT, "public", "data", "characters.json"),
                           encoding="utf-8"))["items"]
    return {ch["name"]: ch["id"] for ch in chars if ch["name"]}


COUNSEL_TITLE = re.compile(
    r"^(?:与)?([^：]+?)(?:：([^：]+?))?的(?:咨询|追忆|回忆)：\d+$")


def load_counsel_meta():
    """bucket(lower) -> (皮肤中文名, 完整角色中文名)，从咨询会话标题解析"""
    path = os.path.join(SRC, "其他剧情", "咨询对话", "咨询对话_全量.json")
    if not os.path.exists(path):
        return {}, {}
    data = json.load(open(path, encoding="utf-8"))
    skins, fulls = {}, {}
    for u in data:
        title = (u["groups"][0].get("title") or "") if u.get("groups") else ""
        m = COUNSEL_TITLE.match(title)
        if not m:
            continue
        lb = u["bucket"].lower()
        if m.group(2):
            skins[lb] = m.group(2)
            fulls[lb] = f"{m.group(1)}：{m.group(2)}"
        else:
            fulls[lb] = m.group(1)
    return skins, fulls


def prettify(sfx):
    """无中文名可借时把后缀伪化成 'Sparkling Summer' 风格（最后手段）"""
    return re.sub(r"([a-z])([A-Z])", r"\1 \2", sfx).replace("_", " ").strip().capitalize()


def main():
    en2, zh_of = load_chars()
    skin_names, counsel_full = load_counsel_meta()
    fullnames = load_fullnames()
    # 皮肤名的四语值（en/ko/ja）从 Locale_Counseling 会话标题解析
    counsel_titles4 = load_counsel_titles()
    counsel_slug_by_norm = {}
    for key in counsel_titles4:
        m = re.match(r"^d_counseling_(.+)_\d+_title$", key)
        if m:
            counsel_slug_by_norm.setdefault(m.group(1).replace("_", ""), m.group(1))

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
    # 章节名的官方四语（Locale_NikkeEpisode 的 <group>_title）
    nikke_titles4 = load_nikke_titles()

    def chapters_of(uid):
        """个人剧情的章节名与句数，供角色页直接展开（不必先跳阅读器）。

        ts = 章节名的 en/ko/ja（Locale_NikkeEpisode 官方文本）；库内中文名与
        Locale 简中对不上时不给 ts（宁缺毋滥，前端回退中文）。无标题的兜底
        「第 N 章」由脚本直接给出三语。"""
        out = []
        for i, (gk, t, n) in enumerate(con.execute(
                "select group_key, title, line_count from story_segments"
                " where unit_id=? and line_count>0 order by sort_order", (uid,)), start=1):
            ch = {"t": t or f"第 {i} 章", "n": n}
            loc4 = nikke_titles4.get(f"{gk}_title") if gk else None
            if loc4 and all(loc4.get(l) for l in ("en", "ko", "ja")) \
                    and (not t or loc4.get("zh") == t):
                ch["ts"] = {l: loc4[l] for l in ("en", "ko", "ja")}
            elif not t:
                ch["ts"] = {"en": f"Chapter {i}", "ko": f"제 {i}장", "ja": f"第{i}チャプター"}
            out.append(ch)
        return out

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
        # 先看剧情标题是不是某个独立抽卡角色的全名：这类角色（艾玛：战术升级）
        # 和基础角色共用前缀，按 bucket 拆分只会并到基础角色身上
        cid, skin = None, None
        n = norm(sfx)
        if not sfx.startswith(SKIP):
            if _title and _title in fullnames:
                cid = fullnames[_title]
            elif lb in counsel_full and counsel_full[lb] in fullnames:
                cid = fullnames[counsel_full[lb]]
        if cid is None:
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
        # 标题 ts（en/ko/ja）：皮肤名四语 + 站内标签尾词；解析不齐的整条不给
        ts = None
        if kind in ("story", "counsel"):
            suffix = REC_SUFFIX["counsel" if kind == "counsel" else "story"]
            if skin_zh:
                skin4 = skin_of_counsel(counsel_titles4, sfx, counsel_slug_by_norm)
                if (skin4.get("zh") == skin_zh
                        and all(skin4.get(l) for l in ("en", "ko", "ja"))):
                    ts = {l: f"{skin4[l]} · {suffix[l]}" for l in ("en", "ko", "ja")}
            else:
                ts = dict(suffix)
        if ts:
            rec["ts"] = ts
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
