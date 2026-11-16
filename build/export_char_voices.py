#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
提取角色语音（当前只有日语资源）

数据源：
  staticdata/CharacterVoiceGroupTable.mpk
      每条语音在表里是「说明 key / 语音 ID / 台词 key」三连：
      Locale_System:voice_description_lobby_reaction_1
      c102_Lobby_Touch_1
      Locale_Character:c102_Lobby_Touch_1
  decrypted/*.dec
      Locale_Character 提供台词文本（zh-CN / ja / ...），
      Locale_System 提供分类说明（「在大厅点击时I」等）。
  <patch>/ja/chunk/store.cdb
      日语语音包。AudioClip 名字就是语音 ID，用 catalog 的 chunk 表还原 bundle。

输出：
  public/voice/<角色 id>.ogg
      每个角色（含皮肤）一条音频雪碧图（按表内顺序拼接），前端按
      start/end 时间点播放，避免生成上万个小文件。
  public/data/char_voices.json
      { "items": { "102": { "f": "/voice/102.ogg", "n": 41,
          "cats": [ { "k": "lobby", "n": "大厅", "v": [
            { "id": "...", "t": "在大厅点击时I", "x": "中文", "j": "日文",
              "s": 0.0, "e": 2.25 } ] } ] } } }

用法：
  set FFMPEG=E:\\test\\ffmpeg\\...\\bin\\ffmpeg.exe
  python build/export_char_voices.py --only 102,352
  python build/export_char_voices.py
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import wave
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[1]
SRC = Path(os.environ.get("NIKKE_SRC", r"E:/test/nikke_extract"))
STATIC = SRC / "staticdata"
DEC = SRC / "decrypted"
OUT_AUDIO = ROOT / "public" / "voice"
OUT_JSON = ROOT / "public" / "data" / "char_voices.json"
CHAR_IMAGES = ROOT / "public" / "data" / "char_images.json"
CHAR_ART = ROOT / "public" / "data" / "char_art.json"

sys.path.insert(0, str(SRC / "scripts"))
import export_cg_v2 as v2  # noqa: E402
import UnityPy  # noqa: E402
import zstandard as zstd  # noqa: E402

TOKEN = re.compile(rb"[ -~]{4,}")
VOICE_RE = re.compile(r"^(c\d+(?:_\d+)?)_(.+)$")

CATS = [
    ("lobby", "大厅"),
    ("outpost", "前哨基地"),
    ("upgrade", "获得与成长"),
    ("field", "野外"),
    ("battle", "战斗"),
]

# 每条语音之间插入的静音。
# HTMLAudioElement 的 currentTime 更新有粒度，靠定时器在结尾 pause() 时可能已经
# 播进了下一条语音；留一段静音，越界时听到的是空白而不是别人的台词。
GAP = 0.40


def write_silence(path: Path, seconds: float = GAP, rate: int = 48000):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * int(rate * seconds))


def cat_of(desc: str) -> str:
    if desc.startswith("lobby_"):
        return "lobby"
    if desc.startswith("outpost_"):
        return "outpost"
    if desc.startswith(("character_obtain_", "character_power_up_", "present_gift_",
                        "attractive_level_up_", "team_set_")):
        return "upgrade"
    if desc.startswith("field_"):
        return "field"
    return "battle"


def parse_voice_table() -> list[dict]:
    raw = (STATIC / "CharacterVoiceGroupTable.mpk").read_bytes()
    toks = [m.group().decode("ascii", "replace") for m in TOKEN.finditer(raw)]
    out: list[dict] = []
    seen: set[str] = set()
    for i, t in enumerate(toks):
        if not t.startswith("Locale_System:voice_description_"):
            continue
        if i + 2 >= len(toks):
            break
        vid, loc = toks[i + 1], toks[i + 2]
        if not VOICE_RE.match(vid) or not loc.startswith("Locale_Character:"):
            continue
        if vid in seen:
            continue
        seen.add(vid)
        desc = t.split(":", 1)[1]
        short = desc[len("voice_description_"):] if desc.startswith("voice_description_") else desc
        out.append({
            "order": len(out),
            "desc": desc,
            "id": vid,
            "loc": loc.split(":", 1)[1],
            "cat": cat_of(short),
            "prefix": VOICE_RE.match(vid).group(1),
        })
    return out


def locale_index() -> dict[str, Path]:
    """Locale 表名 -> 解密后的 SQLite 文件。"""
    idx: dict[str, Path] = {}
    for p in DEC.glob("*.dec"):
        try:
            c = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
            for (t,) in c.execute("select name from sqlite_master where type='table'"):
                if t.startswith("Locale_"):
                    idx[t] = p
            c.close()
        except Exception:
            pass
    return idx


def load_locale(idx: dict[str, Path], table: str) -> dict[str, dict]:
    p = idx.get(table)
    if not p:
        return {}
    c = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
    rows = c.execute(f'SELECT "Key","zh-CN","ja" FROM "{table}"').fetchall()
    c.close()
    return {k: {"zh": zh or "", "ja": ja or ""} for k, zh, ja in rows}


def char_map() -> dict[str, int]:
    """立绘代号 -> 角色 id（c016_01 这类皮肤变体也指向所属角色页）。"""
    imgs = json.loads(CHAR_IMAGES.read_text(encoding="utf-8"))
    base2id: dict[str, int] = {}
    for cid, arr in imgs.items():
        for b in arr:
            base2id[b] = int(cid)

    def resolve(pref: str) -> int | None:
        if pref in base2id:
            return base2id[pref]
        for b, cid in base2id.items():
            if b.startswith(pref + "_"):
                return cid
        return None

    return base2id, resolve


def scan_audio(voice_ids: set[str]) -> dict[str, tuple[str, int]]:
    """语音 ID -> (bundle key, AudioClip path_id)。"""
    cat = sqlite3.connect(v2.manifest_path("ja"))
    table = v2.cidx_map("ja")
    cdb = v2.ROOT / "ja" / "chunk" / "store.cdb"
    size = cdb.stat().st_size
    dec = zstd.ZstdDecompressor()
    rows = cat.execute("select file_id,key from files_chunktype order by key").fetchall()
    found: dict[str, tuple[str, int]] = {}
    t0 = time.time()
    for n, (fid, key) in enumerate(rows, 1):
        data, _, missing = v2.rebuild(cat, table, cdb, dec, fid, size)
        if missing or not data:
            continue
        try:
            env = UnityPy.load(io.BytesIO(data))
        except Exception:
            continue
        for o in env.objects:
            if o.type.name != "AudioClip":
                continue
            try:
                nm = o.peek_name()
            except Exception:
                continue
            if nm in voice_ids:
                found.setdefault(nm, (key, o.path_id))
        if n % 500 == 0:
            print(f"  扫描语音包 {n}/{len(rows)}，命中 {len(found)}，{time.time()-t0:.0f}s", flush=True)
    cat.close()
    print(f"  语音包扫描完成：{len(found)}/{len(voice_ids)}，{time.time()-t0:.0f}s", flush=True)
    return found


def ffmpeg_exe() -> str:
    p = os.environ.get("FFMPEG") or shutil.which("ffmpeg")
    if not p:
        raise SystemExit("找不到 ffmpeg：请设置环境变量 FFMPEG 指向 ffmpeg.exe")
    return p


def encode_char(char_id: str, clips: list[dict], raw_paths: dict[str, Path],
                ffmpeg: str, tmp: Path) -> tuple[str, dict | None]:
    """把一个角色的全部语音拼成一条 OGG 雪碧图，返回 (char_id, json 项)。"""
    total = sum(c["dur"] for c in clips)
    if total <= 0:
        return char_id, None
    concat = tmp / f"concat_{char_id}.txt"
    lines = []
    valid = [c for c in clips if raw_paths.get(c["id"])]
    silence = tmp / "silence.wav"
    for i, c in enumerate(valid):
        p = raw_paths[c["id"]]
        lines.append("file '" + p.as_posix().replace("'", "'\\''") + "'")
        if i < len(valid) - 1:
            lines.append("file '" + silence.as_posix() + "'")
    if not lines:
        return char_id, None
    concat.write_text("\n".join(lines) + "\n", encoding="utf-8")
    out = OUT_AUDIO / f"{char_id}.ogg"
    cmd = [
        ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
        "-f", "concat", "-safe", "0", "-i", str(concat),
        "-vn", "-c:a", "libvorbis", "-b:a", "48k", "-ac", "1", "-ar", "48000",
        "-map_metadata", "-1", str(out),
    ]
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0 or not out.exists() or out.stat().st_size == 0:
        print(f"  ! {char_id} 编码失败：{p.stderr.strip()[:160]}", flush=True)
        return char_id, None

    by_cat: dict[str, list[dict]] = {}
    for c in clips:
        by_cat.setdefault(c["cat"], []).append(c)
    cats = []
    for k, name in CATS:
        items = by_cat.get(k)
        if not items:
            continue
        vs = []
        for c in items:
            vo = {
                "id": c["id"], "t": c["title"], "x": c["zh"], "j": c["ja"],
                "s": round(c["start"], 3), "e": round(c["start"] + c["dur"], 3),
            }
            if c.get("group"):
                vo["g"] = c["group"]
            vs.append(vo)
        cats.append({"k": k, "n": name, "v": vs})
    # clips 已按表内顺序排好；start 在调用前算好，这里只负责输出
    # 文件名不变，用内容 hash 做 query，避免 CDN/浏览器继续用旧雪碧图
    ver = hashlib.md5(out.read_bytes()).hexdigest()[:8]
    return char_id, {"f": f"/voice/{char_id}.ogg?v={ver}", "n": len(clips), "cats": cats}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="只处理这些角色 id，逗号分隔，例如 102,352")
    ap.add_argument("--limit", type=int, default=0, help="只处理前 N 个角色（调试）")
    ap.add_argument("--keep-temp", action="store_true")
    args = ap.parse_args()

    OUT_AUDIO.mkdir(parents=True, exist_ok=True)
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)

    print("1/4 解析语音表…")
    recs = parse_voice_table()
    print(f"  {len(recs)} 条语音记录")

    print("2/4 读取本地化文本…")
    idx = locale_index()
    lines = load_locale(idx, "Locale_Character")
    sysdesc = load_locale(idx, "Locale_System")
    for r in recs:
        txt = lines.get(r["loc"], {})
        r["zh"] = txt.get("zh", "")
        r["ja"] = txt.get("ja", "")
        d = sysdesc.get(r["desc"], {})
        r["title"] = d.get("zh") or r["desc"].replace("voice_description_", "")

    print("3/4 扫描日语语音包…")
    voice_ids = {r["id"] for r in recs}
    audio = scan_audio(voice_ids)

    _, resolve = char_map()
    chars = sorted({resolve(r["prefix"]) for r in recs if resolve(r["prefix"]) is not None})
    if args.only:
        want = {int(x) for x in args.only.split(",") if x.strip()}
        chars = [c for c in chars if c in want]
    if args.limit:
        chars = chars[:args.limit]
    char_set = set(chars)
    print(f"  目标角色 {len(chars)} 个")

    # 只保留有音频、且角色页存在的记录
    usable = [r for r in recs if r["id"] in audio and resolve(r["prefix"]) in char_set]
    print(f"  可用语音 {len(usable)} 条")

    ffmpeg = ffmpeg_exe()
    tmp = Path(tempfile.mkdtemp(prefix="nikke_voice_"))
    write_silence(tmp / "silence.wav")
    print(f"4/4 导出音频…（临时目录 {tmp}）")
    raw_paths: dict[str, Path] = {}
    # 按 bundle 聚合，一个 bundle 只解一次
    by_bundle: dict[str, list[dict]] = {}
    for r in usable:
        by_bundle.setdefault(audio[r["id"]][0], []).append(r)

    cat = sqlite3.connect(v2.manifest_path("ja"))
    table = v2.cidx_map("ja")
    cdb = v2.ROOT / "ja" / "chunk" / "store.cdb"
    size = cdb.stat().st_size
    dec = zstd.ZstdDecompressor()
    t0 = time.time()
    done = 0
    for bkey, rs in by_bundle.items():
        fid = cat.execute("select file_id from files_chunktype where key=?", (bkey,)).fetchone()
        if not fid:
            continue
        data, _, missing = v2.rebuild(cat, table, cdb, dec, fid[0], size)
        if missing or not data:
            continue
        env = UnityPy.load(io.BytesIO(data))
        by_pid = {o.path_id: o for o in env.objects if o.type.name == "AudioClip"}
        for r in rs:
            o = by_pid.get(audio[r["id"]][1])
            if o is None:
                continue
            try:
                d = o.read()
                samples = d.samples
                if not samples:
                    continue
                raw = next(iter(samples.values()))
                safe = re.sub(r"[^\w.-]+", "_", r["id"])
                p = tmp / f"{safe}.wav"
                p.write_bytes(raw)
                raw_paths[r["id"]] = p
                r["dur"] = float(d.m_Length or 0.0)
            except Exception:
                continue
        done += 1
        if done % 100 == 0:
            print(f"  解包 {done}/{len(by_bundle)} 个 bundle，{time.time()-t0:.0f}s", flush=True)
    cat.close()
    print(f"  写出 {len(raw_paths)} 个 WAV，{time.time()-t0:.0f}s")

    # 按角色聚合，保留表内顺序
    grouped: dict[int, list[dict]] = {}
    for r in usable:
        cid = resolve(r["prefix"])
        if cid is None or r["id"] not in raw_paths or r.get("dur", 0) <= 0:
            continue
        grouped.setdefault(cid, []).append(r)
    for cid in grouped:
        grouped[cid].sort(key=lambda x: x["order"])
        t = 0.0
        last = len(grouped[cid]) - 1
        for i, r in enumerate(grouped[cid]):
            r["start"] = t
            t += r["dur"] + (GAP if i < last else 0.0)

    # 同角色多套皮肤各有独立语音时，标出来源皮肤，避免「在大厅点击时I」重复出现
    art = {}
    if CHAR_ART.exists():
        art = json.loads(CHAR_ART.read_text(encoding="utf-8"))

    def skin_label(pref: str) -> str:
        info = art.get(pref) or art.get(pref + "_00") or {}
        return info.get("n") or pref

    for cid, clips in grouped.items():
        prefs = {r["prefix"] for r in clips}
        if len(prefs) > 1:
            # 表里第一组是默认形象，不用重复标注；其余皮肤才打标签
            base_pref = clips[0]["prefix"]
            for r in clips:
                if r["prefix"] != base_pref:
                    r["group"] = skin_label(r["prefix"])

    payload: dict[str, dict] = {}
    jobs = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        for cid, clips in grouped.items():
            jobs.append(pool.submit(encode_char, str(cid), clips, raw_paths, ffmpeg, tmp))
        for f in as_completed(jobs):
            cid, item = f.result()
            if item:
                payload[cid] = item

    # --only / --limit 调试时不要冲掉其余角色的索引
    merged: dict[str, dict] = {}
    if (args.only or args.limit) and OUT_JSON.exists():
        try:
            merged = json.loads(OUT_JSON.read_text(encoding="utf-8")).get("items", {})
        except Exception:
            merged = {}
    merged.update(payload)

    if not args.only and not args.limit:
        for p in OUT_AUDIO.glob("*.ogg"):
            if p.stem not in payload:
                p.unlink()

    OUT_JSON.write_text(
        json.dumps({"items": dict(sorted(merged.items(), key=lambda kv: int(kv[0])))},
                   ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    if not args.keep_temp:
        shutil.rmtree(tmp, ignore_errors=True)

    n_voice = sum(v["n"] for v in payload.values())
    size_mb = sum((OUT_AUDIO / f"{k}.ogg").stat().st_size for k in payload) / 1048576
    print(f"\n完成：{len(payload)} 个角色，{n_voice} 条语音，音频 {size_mb:.1f} MB")
    print(f"  音频目录 {OUT_AUDIO}")
    print(f"  索引 {OUT_JSON}  {OUT_JSON.stat().st_size/1024:.0f} KB")


if __name__ == "__main__":
    main()
