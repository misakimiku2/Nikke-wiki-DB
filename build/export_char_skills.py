#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
角色技能说明导出

数据链路（全部来自本机解包，不联网）：
  1. skill_strings（nikke.db 的 Locale_Skill）——技能名 / 描述模板。
     技能 ID（5 位）编码 = 类型前缀(1=伤害系, 2=增益系) + 角色号(3 位) + 槽位(1 位)，
     例：20111 = 尼恩(011) 的技能1「尼恩特制弹」；10123 = 阿妮斯(012) 的爆裂「针点飞弹」。
     描述键可能是 `<sid>_description` 或 `<sid>_description_1`（变体后缀），
     以 SkillInfoTable 记录里的引用为准。
  2. SkillInfoTable.mpk —— 每个 (技能, 等级) 一条记录：
       [0a][composite][sid][level][composite2][counter][icon][name][desc][kind][count][values]
     字符串均为 int32 长度前缀；kind 引用（skill_name_1001=爆裂技能 / 1002=技能1 /
     1003=技能2）之后是数值区：[count][count × (0x01 + tag i32 + [len i32 + bytes])]，
     tag=0 表示空槽。数值串按描述里 {description_value_NN} 的顺序排列。

输出：public/data/char_skills.json（技能条目带 icon 字段，图标本体在 public/skillicon/，
      由 export_skill_icons.py 从 icons-skill(hd) 池导出）
      {"total": n, "items": {"10": [ {sid, kind, name, desc, values[][], levels} ]}}
描述保留 {description_value_NN} 占位符，由前端按等级填充。

  python build/export_char_skills.py [--probe]
"""
import argparse
import json
import os
import re
import sqlite3
import struct
import sys
import time

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NIKKE_SRC = os.environ.get("NIKKE_SRC", r"E:/test/nikke_extract")
STATIC = os.path.join(NIKKE_SRC, "staticdata")
DB = os.path.join(ROOT, "data", "nikke.db")
OUT = os.path.join(ROOT, "public", "data", "char_skills.json")
# 国服 Locale_Skill（明文 SQLite）：国服先行角色（8004/8005）的技能文案只在这里
CN_SKILL_DB = os.environ.get(
    "NIKKE_CN_LOCALE",
    r"C:/Program Files/GAME/胜利女神：新的希望(2002017)/nikke_Data/runtime_data/saus/saus/lss/Locale_Skill.lss",
)

NAME_RE = re.compile(r"^Locale_Skill:(\d+)_name$")


def snorkel(b, lo=0, hi=None):
    """按 int32 长度前缀扫描可打印 ASCII 字符串，返回 (位置, 文本)"""
    out = []
    pos = lo
    n = len(b) if hi is None else hi
    while pos + 4 <= n:
        ln = struct.unpack("<i", b[pos:pos + 4])[0]
        if 1 <= ln <= 96 and pos + 4 + ln <= n:
            s = b[pos + 4:pos + 4 + ln]
            if all(32 <= c < 127 for c in s):
                out.append((pos, s.decode("ascii")))
                pos += 4 + ln
                continue
        pos += 1
    return out


def clean(text):
    """去掉 color 标签；<word_group=NN>词条</word_group> 保留原样，
    前端把它渲染成可点击的专有名词（解释文本在词组表里）"""
    if not text:
        return ""
    text = re.sub(r"<color=[^>]*>", "", text)
    text = text.replace("</color>", "")
    return text.strip()


def read_values(b, pos):
    """数值区：[count i32][count × (0x01 + tag i32 [+ len i32 + bytes])]"""
    count = struct.unpack("<i", b[pos:pos + 4])[0]
    if not (0 <= count <= 32):
        return None, pos + 4
    pos += 4
    values = []
    for _ in range(count):
        if pos + 5 > len(b) or b[pos] != 0x01:
            break
        tag = struct.unpack("<i", b[pos + 1:pos + 5])[0]
        pos += 5
        if tag == 0:
            values.append(None)
            continue
        ln = struct.unpack("<i", b[pos:pos + 4])[0]
        if not (0 <= ln <= 64):
            break
        raw = b[pos + 4:pos + 4 + ln]
        try:
            values.append(raw.decode("ascii") if ln else None)
        except UnicodeDecodeError:
            break
        pos += 4 + ln
    return values, pos


def parse_skill_info():
    """SkillInfoTable.mpk → {sid: {"kind": 引用键, "desc_ref": 键, "levels": {level: [values]}}}"""
    b = open(os.path.join(STATIC, "SkillInfoTable.mpk"), "rb").read()
    strs = snorkel(b)
    out = {}
    for i, (p, s) in enumerate(strs):
        m = NAME_RE.match(s)
        if not m:
            continue
        sid = int(m.group(1))
        pat = struct.pack("<i", sid)
        # 只接受同一条记录里的 sid（记录里 name 引用距 sid ≤ ~120 字节，
        # 文件里还混有不含 sid 的兄弟记录，窗口大了会把上一条记录的 sid 错配过来）
        back = b.rfind(pat, max(0, p - 120), p)
        if back < 0:
            continue
        level = struct.unpack("<i", b[back + 4:back + 8])[0]
        if not (1 <= level <= 20):
            continue
        # name 之后的两个 Locale_Skill 引用：desc、kind
        after = [t for pp, t in strs[i + 1:] if pp < p + 700 and t.startswith("Locale_Skill:")]
        desc_ref = after[0] if after else None
        kind_ref = after[1] if len(after) > 1 else None
        values = None
        if kind_ref:
            kpos = p + 700
            for pp, t in strs[i + 1:]:
                if t == kind_ref:
                    kpos = pp + 4 + len(t)
                    break
            values, _ = read_values(b, kpos)
        # 图标引用 = name 引用紧邻的上一个字符串（icn_skill_*）
        icon = strs[i - 1][1] if i > 0 and strs[i - 1][1].startswith("icn_") else ""
        rec = out.setdefault(sid, {"kind": kind_ref, "desc_ref": desc_ref,
                                   "icon": icon, "levels": {}})
        rec["levels"][level] = values if values is not None else []
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--probe", action="store_true")
    args = ap.parse_args()

    t0 = time.time()
    info = parse_skill_info()
    print(f"SkillInfoTable: {len(info)} 个技能，耗时 {time.time()-t0:.1f}s")

    db = sqlite3.connect(DB)
    chars = json.load(open(os.path.join(ROOT, "public", "data", "characters.json"), encoding="utf-8"))["items"]

    kind_label = {}
    for (k, zh) in db.execute("select key, zh from skill_strings where key like 'skill_name_%'"):
        kind_label[k] = zh

    def text(key):
        if not key:
            return None
        r = db.execute("select zh from skill_strings where key=?", (key,)).fetchone()
        return r[0] if r else None

    # 国服文案回退：表内键与国际服同构（{sid}_name / {sid}_description / {gid}_{n}_add_des）
    cn_db = None
    cn_strings = {}
    try:
        cdb = sqlite3.connect(f"file:{CN_SKILL_DB}?mode=ro", uri=True)
        cn_strings = {k: (zh or "") for k, zh in cdb.execute('select Key, "zh-CN" from Locale_Skill')}
        cdb.close()
        print(f"国服 Locale_Skill {len(cn_strings)} 条")
    except Exception as e:
        print(f"! 国服 Locale_Skill 读取失败（跳过）：{e}")

    def text_any(key):
        return text(key) or cn_strings.get(key) or None

    # 词组表：<词组ID>_<行号>_add_des → 专有名词解释（游戏内「技能资讯」弹窗）
    terms = {}
    for (k, zh) in db.execute("select key, zh from skill_strings where key like '%_add_des'"):
        m = re.match(r"^(\d+)_(\d+)_add_des$", k)
        if m and zh:
            terms.setdefault(int(m.group(1)), []).append((int(m.group(2)), clean(zh)))
    for k, zh in cn_strings.items():
        m = re.match(r"^(\d+)_(\d+)_add_des$", k)
        if m and zh:
            terms.setdefault(int(m.group(1)), []).append((int(m.group(2)), clean(zh)))
    terms = {gid: [t for _n, t in sorted(lines)] for gid, lines in terms.items()}

    items = {}
    no_level = 0
    for ch in chars:
        uid = ch["id"]
        skills = []
        for pre in "12":
            for slot in range(10):
                sid_s = f"{pre}{uid:03d}{slot}"
                nm = text_any(sid_s + "_name")
                if not nm:
                    continue
                sid = int(sid_s)
                rec = info.get(sid)
                if rec is None:
                    desc = text_any(sid_s + "_description") or ""
                    if uid >= 8000:
                        # 国服先行角色（SkillInfoTable 无行）：kind 由槽位推导，无逐级数值
                        kind = {1: "技能1", 2: "技能2", 3: "爆裂技能"}.get(slot, "")
                        skills.append({"sid": sid, "kind": kind, "name": nm, "desc": clean(desc),
                                       "values": [], "levels": 10, "icon": ""})
                    else:
                        skills.append({"sid": sid, "kind": "", "name": nm, "desc": clean(desc),
                                       "values": [], "levels": 0, "icon": ""})
                    no_level += 1
                    continue
                kind = kind_label.get((rec["kind"] or "").removeprefix("Locale_Skill:"), "")
                desc_ref = rec["desc_ref"] or (sid_s + "_description")
                desc = text(desc_ref.removeprefix("Locale_Skill:")) \
                    or text(f"{sid_s}_description") or ""
                levels = rec["levels"]
                max_lv = max(levels)
                values = [levels.get(lv) or [] for lv in range(1, max_lv + 1)]
                skills.append({"sid": sid, "kind": kind, "name": nm,
                               "desc": clean(desc), "values": values, "levels": max_lv,
                               "icon": rec.get("icon", "")})
        if skills:
            order = {"技能1": 0, "技能2": 1, "爆裂技能": 2}
            skills.sort(key=lambda s: (order.get(s["kind"], 3), s["sid"]))
            items[str(uid)] = skills

    if args.probe:
        for uid in ("12", "10"):
            print(json.dumps({uid: items.get(uid)}, ensure_ascii=False, indent=1)[:2000])

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"total": len(items), "items": items, "terms": terms}, f,
                  ensure_ascii=False, separators=(",", ":"))

    n_skills = sum(len(v) for v in items.values())
    print(f"角色 {len(items)}，技能 {n_skills} 条，无等级数据 {no_level} 条")
    print(f"输出 {OUT}  {os.path.getsize(OUT)/1024:.0f} KB  耗时 {time.time()-t0:.1f}s")


if __name__ == "__main__":
    main()
