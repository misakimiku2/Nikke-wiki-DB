#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""为剧情卡生成 3:4 竖版封面。

默认的 object-fit: cover 会把方形 CG 居中裁一刀，人物不在正中时就会
「歪」；白底合成图还会留下大片空白。这里按主体包围盒（alpha 或非背景色）
重新取景，透明 CG 再垫一层模糊背景，输出固定 3:4，卡片里不再需要裁剪。

封面质量参差主要是「选图」问题：某段剧情的第一张 CG 可能是速度线特效帧、
过暗的过场、失焦镜头或已经并入其它条目的重复帧。这里不再无脑用第一张，
而是把该剧情关联到的候选 CG 都打开打个分（曝光 / 色彩丰富度 / 清晰度 /
构图密度 / 长宽比），选最适合做封面的那张；用户整理过的数据（cg_merges
的成员帧、cg_flags 里标成主视觉/动态的条目）自动降权。

  python build/build_story_covers.py            # 评分选优 + 生成
  python build/build_story_covers.py --report   # 只打印选图变化，不写回
  python build/build_story_covers.py --force    # 忽略 mtime 重生成全部封面（换裁剪参数后用）
  python build/build_story_covers.py --only 1,2 # 只处理指定单元 id

手动指定封面：在 build/cg_cover_overrides.json 里写 {"单元id": "hash"}，
优先级最高（hash 见 CG 图鉴灯箱 URL 或 public/img/l/ 文件名）。

输出 public/cover/<hash>.webp，并把最终选定写回 story_index.json 的 cover 字段。
"""
import json
import math
import os
import re
import sys
from collections import defaultdict
from statistics import median

from PIL import Image, ImageChops, ImageEnhance, ImageFilter, ImageOps, ImageStat

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data", "story_index.json")
CG_INDEX = os.path.join(ROOT, "public", "data", "cg_index.json")
CG_MERGES = os.path.join(ROOT, "public", "data", "cg_merges.json")
OVERRIDES = os.path.join(ROOT, "build", "cg_cover_overrides.json")
IMG = os.path.join(ROOT, "public", "img")
OUT = os.path.join(ROOT, "public", "cover")
TW, TH = 480, 640          # 3:4
ASPECT = TW / TH

MAX_CANDS = 8              # 每个单元最多评分的候选数
SCORE_W = 320              # 评分时缩到的宽度


def source_path(h):
    for sub in ("l", "m", "s"):
        p = os.path.join(IMG, sub, f"{h}.webp")
        if os.path.exists(p):
            return p
    return None


# ---------------------------------------------------------------- 候选收集

def load_candidates():
    """单元 id → 有序候选 hash 列表（按剧情行序）。

    排序原则：普通剧情画面 > 被并入其它条目的成员帧（重复画面）> 主视觉(k)/动态(d)
    > 纯背景板。同类内按出现行号排，重复 hash 只保留首次。
    """
    with open(CG_INDEX, encoding="utf-8") as f:
        cg = json.load(f)
    try:
        with open(CG_MERGES, encoding="utf-8") as f:
            merges = json.load(f)
    except FileNotFoundError:
        merges = {}
    members = set()
    for v in merges.values():
        if isinstance(v, list):
            members.update(v)

    meta = {it["n"]: it for it in cg.get("items", [])}
    cand = defaultdict(list)
    for name, links in cg.get("links", {}).items():
        it = meta.get(name)
        if not it:
            continue
        for lk in links:
            cand[lk["u"]].append({
                "h": it["h"],
                "i": lk.get("i", 0),
                "rank": 2 if name in members else 0,
                "kd": bool(it.get("k") or it.get("d")),
            })
    # 现有 cover（来自 export_web 的链接首图 / 名字模糊匹配）也进候选池兜底。
    # 模糊匹配来的封面没有行号，排在最后当保底（i 用一个大数）。
    with open(DATA, encoding="utf-8") as f:
        idx = json.load(f)
    linked = {u["id"] for u in idx.get("items", []) if cand.get(u["id"])}
    # 旧 cover 对应的 CG 若已从 manifest 移除（例如被 cg_exclude.json 过滤），
    # 它的 webp 文件仍留在磁盘上，不能再当兜底候选捡回来。
    live_hashes = {it["h"] for it in cg.get("items", [])}
    for u in idx.get("items", []):
        if u.get("cover") and u["id"] not in linked and u["cover"] in live_hashes:
            cand[u["id"]].append({"h": u["cover"], "i": 10 ** 6, "rank": 1, "kd": False})
    for arr in cand.values():
        seen, out = set(), []
        for c in sorted(arr, key=lambda x: (x["i"], x["rank"], x["h"])):
            if c["h"] in seen:
                continue
            seen.add(c["h"])
            out.append(c)
        arr[:] = out[:MAX_CANDS]
    return idx, cand


# ---------------------------------------------------------------- 图像评分

def border_color(img, pad=8):
    w, h = img.size
    px = []
    for box in ((0, 0, w, pad), (0, h - pad, w, h),
                (0, 0, pad, h), (w - pad, 0, w, h)):
        px.extend(img.crop(box).convert("RGB").getdata())
    return tuple(int(median(c[i] for c in px)) for i in range(3))


def has_alpha(img):
    return img.mode == "RGBA" and img.getchannel("A").getextrema()[0] < 250


def score_image(path):
    """封面适配度：各项 0~1，加权总分。只追求相对排序，绝对值无含义。"""
    img = Image.open(path)
    img.load()
    w, h = img.size
    ar_penalty = 0.0
    ratio = max(w / h, h / w)
    if ratio > 2.6:                       # 长条连图 / 拼接帧，裁出来也是碎片
        ar_penalty = min(1.0, (ratio - 2.6) / 3.0)

    small = img.convert("RGB").resize((SCORE_W, max(1, round(SCORE_W * h / w))),
                                      Image.Resampling.BOX)
    stat = ImageStat.Stat(small)
    lum = sum(stat.mean) / 3
    # 曝光：过暗（过场黑屏）或过白（白屏/闪光）都当不了封面
    exposure = 1.0
    if lum < 34:
        exposure = max(0.0, (lum - 6) / 28)
    elif lum > 228:
        exposure = max(0.0, (250 - lum) / 22)

    hsv = small.convert("HSV")
    sat = ImageStat.Stat(hsv.getchannel("S")).mean[0] / 255
    # 色相分布熵：单色特效帧（速度线/白闪）熵极低，正片画面色彩分布宽
    hue = hsv.getchannel("H").resize((64, 64)).histogram()
    total = sum(hue) or 1
    ent = 0.0
    for c in hue:
        if c:
            p = c / total
            ent -= p * math.log(p)
    hue_ent = min(1.0, ent / 3.2)
    colorfulness = 0.45 * min(1.0, sat / 0.35) + 0.55 * hue_ent

    edges = small.filter(ImageFilter.FIND_EDGES)
    ed = ImageStat.Stat(edges.convert("L"))
    sharp = min(1.0, (ed.stddev[0] or 0) / 34)   # 失焦/运动模糊帧边缘能量低

    # 明暗对比：发白的空景（漫天云、沙漠）和发灰的雾帧 stddev 很低，
    # 缩成缩略图后几乎没内容，不适合当封面
    contrast = min(1.0, (ImageStat.Stat(small.convert("L")).stddev[0] or 0) / 52)

    return {
        "score": (0.28 * colorfulness + 0.24 * exposure + 0.24 * sharp
                  + 0.16 * contrast + 0.08 * (1 - ar_penalty)),
        "lum": lum, "sat": sat, "hue_ent": hue_ent, "sharp": sharp,
        "contrast": contrast, "ar": ar_penalty,
    }


# ---------------------------------------------------------------- 取景裁剪

def density_crop(img):
    """按主体密度重心取 3:4 窗口。

    不用 alpha 包围盒：活动 CG 常有散落的光点/碎片，包围盒会横跨整张图，
    结果人物被挤到一边。这里把密度（alpha 或与背景的色差）缩小后按平方加权，
    重心会落在人物/主体上，而不是被零星像素拉偏。

    主体已经占满画面（大特写）时不再二次取景：特写再裁一刀只会切掉
    脸的上下沿，改成整图按 3:4 拟合。
    """
    w, h = img.size
    if has_alpha(img):
        d = img.getchannel("A")
    else:
        rgb = img.convert("RGB")
        bg = border_color(rgb)
        diff = ImageChops.difference(rgb, Image.new("RGB", rgb.size, bg))
        d = diff.convert("L").point(lambda v: min(255, v * 2))

    n = 128
    small = d.resize((n, n), Image.Resampling.BOX)
    px = list(small.getdata())
    weights = [(v / 255.0) ** 2 for v in px]
    total = sum(weights)
    if total <= 1e-6:
        cx, cy = w / 2, h / 2
        frac = 1.0
    else:
        cx = sum((i % n) * wt for i, wt in enumerate(weights)) / total / n * w
        cy = sum((i // n) * wt for i, wt in enumerate(weights)) / total / n * h
        # 密度越集中（单个主体）就裁得越紧，越分散（全身/大场景）留得越多
        s2 = sum(wt * wt for wt in weights)
        frac = ((total * total) / s2) / (n * n) if s2 else 1.0

    if frac >= 0.5:
        # 特写/满幅主体：整图拟合，只裁长边，不再向密度重心推进
        zoom = 1.0
    else:
        zoom = 0.55 + 0.17 * max(0.0, min(1.0, (frac - 0.10) / 0.45))
    cw = min(w, h * ASPECT) * zoom
    ch = cw / ASPECT
    if cw > w:
        cw = w
        ch = cw / ASPECT
    if ch > h:
        ch = h
        cw = ch * ASPECT
    x = min(max(cx - cw / 2, 0), w - cw)
    y = min(max(cy - ch / 2, 0), h - ch)
    return (round(x), round(y), round(x + cw), round(y + ch))


def make_cover(src, dst):
    img = Image.open(src)
    img.load()
    if has_alpha(img):
        # 透明 CG（游戏里的分层立绘 / 贴纸式画面）：
        # 1) 先按 alpha 包围盒去掉四周空白；
        # 2) 在包围盒内做密度取景，再铺满 3:4 —— 主体不会被缩小；
        # 3) 背景用它自己放大模糊后压暗垫底，透明区垫深灰（之前直接拿含透明
        #    区的整图做底，透明处合成出来是黑的，卡片四边发黑）。
        box = img.getchannel("A").getbbox()
        art = img.crop(box) if box else img
        fg = art.crop(density_crop(art)).resize((TW, TH), Image.Resampling.LANCZOS)
        bg = ImageOps.fit(art, (TW, TH), method=Image.Resampling.LANCZOS,
                          centering=(0.5, 0.4))
        flat = Image.new("RGBA", bg.size, (22, 22, 26, 255))
        flat.alpha_composite(bg)
        bg = flat.filter(ImageFilter.GaussianBlur(30))
        bg = ImageEnhance.Brightness(bg).enhance(0.62)
        bg.alpha_composite(fg)
        out = bg.convert("RGB")
    else:
        crop = density_crop(img)
        out = img.crop(crop).resize((TW, TH), Image.Resampling.LANCZOS).convert("RGB")

    out.save(dst, "WEBP", quality=84, method=6)


# ---------------------------------------------------------------- 主流程

def main():
    report_only = "--report" in sys.argv
    force = "--force" in sys.argv
    only_ids = None
    if "--only" in sys.argv:
        only_ids = {int(x) for x in
                    sys.argv[sys.argv.index("--only") + 1].split(",") if x.strip()}

    idx, cand = load_candidates()
    overrides = {}
    if os.path.exists(OVERRIDES):
        with open(OVERRIDES, encoding="utf-8") as f:
            raw = json.load(f)
        # 允许 "_note" 之类的说明键混在里面
        overrides = {int(k): v for k, v in raw.items()
                     if not k.startswith("_") and k.strip().isdigit()}

    os.makedirs(OUT, exist_ok=True)
    changed = []
    score_cache = {}
    picked_hashes = set()
    # 单元 id → (封面 hash, 是否来自它自己的剧情 CG)。
    # 「自己的」= 通过 cg_index.links 关联到，而不是 export_web 里借邻居/模糊匹配来的。
    picked: dict[int, tuple[str | None, bool]] = {}
    ranked: dict[int, list[str]] = {}   # 单元的候选 hash（按选图优先级）

    def score(h):
        if h not in score_cache:
            p = source_path(h)
            score_cache[h] = score_image(p) if p else None
        return score_cache[h]

    for u in idx.get("items", []):
        if only_ids and u["id"] not in only_ids:
            continue
        if u["id"] in overrides:
            want = overrides[u["id"]]
            picked[u["id"]] = (want, True)
            if want:
                picked_hashes.add(want)
            continue
        cands = cand.get(u["id"], [])
        if not cands:
            picked[u["id"]] = (None, False)
            continue
        own = any(c["i"] < 10 ** 6 for c in cands)
        # 质量分只当「否决器 + 微调」，主排序依据是剧情行序：
        # 一话的第一张剧情 CG 通常就是这一话的主视觉，靠后的特效帧/过场即使
        # 色彩更艳丽也不该顶替它（纯质量分会选中标志图、爆炸、大特写）。
        n = len(cands)
        scored = []
        for pos, c in enumerate(cands):
            s = score(c["h"])
            if not s:
                continue
            pos_frac = pos / (n - 1) if n > 1 else 0.0
            adj = s["score"] - 0.16 * pos_frac           # 行序越靠后越吃亏
            if c["rank"] >= 2:
                adj -= 0.12                              # 已并入其它条目的重复帧
            if c["kd"]:
                adj -= 0.10                              # 主视觉 / 动态条目
            scored.append((adj, c["h"], s))
        if not scored:
            picked[u["id"]] = (None, False)
            continue
        # 否决线：明显坏帧（黑屏/白闪/模糊/长条）先剔除；全都不合格才退回最优
        ok = [x for x in scored if x[2]["score"] >= 0.42]
        scored = ok or scored
        scored.sort(key=lambda x: -x[0])
        ranked[u["id"]] = [x[1] for x in scored]
        picked[u["id"]] = (scored[0][1], own)

    # —— 去重 ——
    # 目录里连排同一张图看着像 bug，哪怕是「真实出现在两部剧情里」的 CG：
    # 目录是用来快速区分各话的，封面必须尽量不同。处置顺序：
    #   1) 同一 hash 被多个单元选中 → 只留优先级最高的一个（自身 CG 优先），
    #      其余从自己的候选里换一张没被占用的，没有就退回文字兜底卡。
    #   2) 不同 hash 但属同一章节的连续差分帧（Chap_24_01 / Chap_24_02 这类
    #      上一秒下一秒的图）→ 视觉上几乎一样，同样要拆开。
    if not only_ids:
        # hash -> CG 名，用于识别章节差分
        try:
            with open(CG_INDEX, encoding="utf-8") as _f:
                cg_items = json.load(_f).get("items", [])
        except Exception:
            cg_items = []
        name_of = {it["h"]: it["n"] for it in cg_items}
        chapter_re = re.compile(r"^EventScene_Chap_(\d+)_")

        def chapter_of(h):
            m = chapter_re.match(name_of.get(h, ""))
            return m.group(1) if m else None

        # 按单元 id 排序处理，保证「留谁」结果稳定
        used = {}   # hash -> 章节号
        for uid in sorted(picked):
            h, is_own = picked[uid]
            if not h:
                continue
            ch = chapter_of(h)
            clash = h in used
            # 借来的封面（非自身剧情 CG）若与已分配的自身封面同章节，
            # 通常是相邻话的连续差分帧，目录里看着就是同一张，要拆开。
            if not clash and not is_own and ch:
                clash = any(c == ch for c in used.values())
            if not clash:
                used[h] = ch
                continue
            # 换一张没被占用的候选；借来的封面还要避开同章节差分
            alt = None
            for x in ranked.get(uid, []):
                if x == h or x in used:
                    continue
                if not is_own and ch and chapter_of(x) == ch:
                    continue
                alt = x
                break
            picked[uid] = (alt, bool(alt))
            if alt:
                used[alt] = chapter_of(alt)

    # —— 应用 ——
    for u in idx.get("items", []):
        if only_ids and u["id"] not in only_ids:
            continue
        want = picked.get(u["id"], (None, False))[0]
        old = u.get("cover")
        if old != want:
            u["cover"] = want
            changed.append((u, f"{old} -> {want}"))
        if want:
            picked_hashes.add(want)

    if not report_only:
        with open(DATA, "w", encoding="utf-8") as f:
            json.dump(idx, f, ensure_ascii=False, separators=(",", ":"))
        print(f"story_index.json 写回：换图 {len(changed)} 个单元")

    # 生成（或刷新）选定封面的图
    missing = done = 0
    for h in sorted(picked_hashes):
        if not h:
            continue
        src = source_path(h)
        dst = os.path.join(OUT, f"{h}.webp")
        if not src:
            missing += 1
            print(f"  缺源图: {h}")
            continue
        if (force or not os.path.exists(dst)
                or os.path.getmtime(dst) < os.path.getmtime(src)):
            if not report_only:
                make_cover(src, dst)
            done += 1
    total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT)
                if f.endswith(".webp"))
    print(f"封面图：需生成 {done}，缺源 {missing}，目录合计 {total / 1048576:.1f} MB")
    if changed:
        print(f"-- 选图变化 {len(changed)} 处 --")
        for u, note in changed:
            print(f"  #{u['id']:<4} {u['title'][:16]:<16} {note}")


if __name__ == "__main__":
    main()
