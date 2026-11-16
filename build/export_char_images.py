#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
扫描 public/char 生成角色立绘清单

  python build/export_char_images.py
输出 public/data/char_images.json  {"10": ["c010_00", "c010_01"], ...}
"""
import json
import os
import re
import sys
from collections import defaultdict

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "public", "char")
OUT = os.path.join(ROOT, "public", "data", "char_images.json")

# 部分 NPC 的 Locale_Character id 与 icons-char-full 资源代号并不一致，
# 直接按 id 取图会拿到别的角色（狗、机器人、中年妇女等）。这里按官方代号改正。
ART_FIX = {
    890: ["c890_00", "c236_00"],   # 芭比珑：旧形态 + 第49/50章新形态（c236_00）
    909: ["c914_00"],              # 伯宁姆 Burningum
    930: ["c113_01"],              # E.H.（NPC 形态，抽卡形态是 113 的 c113_00）
    931: ["c939_00"],              # 多万 Doban
    932: ["c922_00"],              # 真 Jin
    933: ["c943_00"],              # 莉莉维丝 Liliweiss
    934: ["c941_00"],              # 皮娜 Pinne
    935: ["c961_00", "c961_01"],   # 奥斯华 Oswald
    9031: ["c931_00", "c931_01"],  # 收集机器人 / 科姆
    967: ["c967_00", "c970_00"],   # 露咪：两套模型
    # 以下五位的 Locale id 已被上面的 930-935 挪走，条目另开 id 段，立绘要显式指回去
    9100: ["c930_00"],             # 碧翠丝（不是 id=930 的 E.H.）
    9101: ["c932_00"],             # 伏特MK.ll
    9102: ["c933_00"],             # 伏特
    9103: ["c934_00"],             # 安洁丽娜
    9104: ["c935_00"],             # 约瑟夫
    # 独立角色卡（异端形态）
    9200: ["c474_00", "c9027_00"],  # 桃乐丝：异端
    9201: ["c235_00"],             # 诺雅：异端
}
# 同一角色的额外形态：追加到已有立绘后面（不覆盖，默认立绘仍是原列表第一张）
ART_EXTRA = {
    10: ["c990_00", "c994_00"],    # 拉毗
    160: ["c985_00"],              # 尤妮
    220: ["c9013_00"],             # 白雪公主
    226: ["c966_00"],              # 长发公主：纯洁恩典（已实装角色，非皮肤）
    261: ["c9009_00"],             # 尼希利斯塔
    514: ["c510_00"],              # 格拉维（510 是重复空壳条目）
    901: ["c9031_00"],             # 舒恩（小舒恩）
    903: ["c942_00", "c942_01"],   # 安德森：剧情立绘灰大衣版（ScenarioCharacterSettingTable
                                   # 里 andersen_c -> spine/standing/c942/01_HD，RED ASH
                                   # 仙女小队时期的指挥官形象，49-50 章同款差分）
    934: ["c9001_00"],             # 皮娜（全息影像）
    973: ["c9032_00"],             # 智恩（幼年）
}
# 不是角色 / 重复条目 / 客户端无可用立绘：777 是部队名，908 与 890 芭比珑重复，
# 914 嚣嘈的 c909 只有缺图集区域的站姿模型（无法渲染），970 已并入露咪，
# 235/474/9027 已各自升格成独立角色卡，966 并入长发公主：纯洁恩典（id 226），
# 930/510 是 E.H. 与格拉维的空壳重复条目，944 与灰姑娘主立绘重复
DROP = {777, 908, 914, 970, 235, 474, 966, 9027, 930, 510, 944}


def main():
    if not os.path.isdir(SRC):
        print("! public/char 不存在，先跑 export_sd.py")
        return

    groups = defaultdict(list)
    for fn in os.listdir(SRC):
        if not fn.endswith(".webp"):
            continue
        stem = fn[:-5]
        m = re.match(r"^c(\d+)_(\d+)$", stem)
        if m:
            groups[int(m.group(1))].append(stem)

    # 按变体号排序
    for k in groups:
        groups[k].sort()

    for k in DROP:
        groups.pop(k, None)
    for k, arts in ART_FIX.items():
        groups[k] = list(arts)
    # 追加形态放在原立绘之后，保证 mainBase() 取到的 _00 仍是角色主形象
    for k, arts in ART_EXTRA.items():
        cur = list(groups.get(k, []))
        groups[k] = cur + [a for a in arts if a not in cur]

    payload = {str(k): v for k, v in sorted(groups.items())}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    total = sum(len(v) for v in groups.values())
    multi = sum(1 for v in groups.values() if len(v) > 1)
    print(f"角色 {len(groups)} 个，立绘 {total} 张（{multi} 个角色有多套皮肤）")
    print(f"输出 {OUT}  {os.path.getsize(OUT)/1024:.0f} KB")


if __name__ == "__main__":
    main()
