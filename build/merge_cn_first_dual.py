#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""国服先行角色（8004 婴宁 / 8005 画皮）中日双轨合成。

背景：国服客户端切换语音语言时会删掉另一语言的整个池子，两个池子永远无法同时
存在。流程分两步：
  1. 客户端在日语语音时：跑 export_char_voices.py --only 8004,8005
     → 得到日语主轨（/voice/<id>.ogg + char_voices.json 的 s/e 时间轴）。
  2. 客户端切回中文语音后：跑本脚本
     → 扫描中文池，重编码 /voice/<id>.zh.ogg，算出每条中文时间轴（zs/ze），
       以 fz/zs/ze/zc 写回 char_voices.json 的对应条目（Skin 套组的双轨模式，
       前端 VoiceList 已支持：默认中文、可切日配）。

用法：
  FFMPEG=... py -3.12 build/merge_cn_first_dual.py [--only 8004,8005]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "build"))

import export_char_voices as ev  # noqa: E402

JSON_PATH = ev.OUT_JSON
# 目标角色（与 export_char_voices.CN_FIRST_CHARS 一致）
DEFAULT_CHARS = [8004, 8005]
GAP = ev.GAP


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=",".join(str(c) for c in DEFAULT_CHARS))
    args = ap.parse_args()
    want = {int(x) for x in args.only.split(",") if x.strip()}

    data = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    items = data["items"]

    # 收集这些角色在 ja 主轨里的语音 ID（顺序 = 表内顺序）
    ids: dict[int, list[str]] = {}
    for cid in want:
        it = items.get(str(cid))
        if not it:
            print(f"! char_voices.json 里没有 {cid}（先跑 export_char_voices --only）")
            continue
        seq = [v["id"] for cat in it["cats"] for v in cat["v"]]
        ids[cid] = seq
    if not ids:
        return

    if not ev.CN_AB.exists():
        raise SystemExit(f"中文池不存在（客户端还没切回中文）：{ev.CN_AB}")

    all_ids = {i for seq in ids.values() for i in seq}
    print(f"扫描中文池，目标 {len(all_ids)} 条…")
    zh_audio = ev.scan_audio_cn(all_ids)
    missing = all_ids - set(zh_audio)
    if missing:
        print(f"! 中文池缺 {len(missing)} 条（例如 {sorted(missing)[:5]}）")

    ffmpeg = ev.ffmpeg_exe()
    tmp = ev.Path(os.environ.get("TMP", "/tmp")) / "nikke_zh_merge"
    tmp.mkdir(exist_ok=True)
    ev.write_silence(tmp / "silence.wav")

    for cid, seq in ids.items():
        rs = []
        for vid in seq:
            if vid not in zh_audio:
                continue
            rs.append({"id": vid, "file": zh_audio[vid][0], "pid": zh_audio[vid][1]})
        if not rs:
            print(f"! {cid} 无中文音频，跳过")
            continue
        # 提取 WAV 得时长
        wavs, durs = {}, {}
        for n, r in enumerate(rs):
            try:
                import UnityPy
                env = UnityPy.load(r["file"])
                o = next(o for o in env.objects
                         if o.type.name == "AudioClip" and o.path_id == r["pid"])
                d = o.read()
                samples = d.samples
                if not samples:
                    continue
                raw, dur = ev.normalize_wav(next(iter(samples.values())))
                p = tmp / f"{cid}_{n}.wav"
                p.write_bytes(raw)
                wavs[r["id"]] = p
                durs[r["id"]] = dur
            except Exception as e:
                print(f"  ! {r['id']}: {e}")
        clips = [{"id": vid, "dur": durs[vid]} for vid in seq if vid in wavs]
        ver = ev.encode_sprite(str(cid), ".zh", clips, wavs, ffmpeg, tmp)
        if not ver:
            print(f"! {cid} 中文雪碧图编码失败")
            continue
        # 写时间轴
        item = items[str(cid)]
        t = 0.0
        last = len(clips) - 1
        zmap = {}
        for i, c in enumerate(clips):
            zmap[c["id"]] = (round(t, 3), round(t + c["dur"], 3))
            t += c["dur"] + (GAP if i < last else 0.0)
        n_hit = 0
        for cat in item["cats"]:
            for v in cat["v"]:
                if v["id"] in zmap:
                    v["zs"], v["ze"] = zmap[v["id"]]
                    n_hit += 1
        item.pop("zhOnly", None)
        item["zc"] = n_hit
        item["fz"] = f"/voice/{cid}.zh.ogg?v={ver}"
        print(f"  {cid}: 中文 {n_hit}/{item['n']} 条 → fz={item['fz']}")

    JSON_PATH.write_text(
        json.dumps({"items": dict(sorted(items.items(), key=lambda kv: int(kv[0])))},
                   ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print("->", JSON_PATH)


if __name__ == "__main__":
    main()
