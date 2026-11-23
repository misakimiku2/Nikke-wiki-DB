#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""导出 FADING AFFECTION 小游戏的 BGM / SFX 到 public/fading_audio/。

数据来源是 fadingaffection.json 里已经带出的字符串 key（页面 bgm、选项 sfx），
每个 key 对应游戏资源池里一个 bundle，命名规律固定：

    audiogroup[_<子类>]_assets_<key>_<md5>.bundle

所以不需要扫全部 bundle，直接在已解密的 catalog 里按
`instr(key, '_assets_<KEY>_')` 精确子串查 file_id，重建 bundle、取出 AudioClip 的
WAV 字节，再用 ffmpeg 编成 ogg。BGM 保留立体声（不做 normalize_wav 的单声道下混）。
环境音床另外做两件事：loudnorm 拉平六条之间近 20 dB 的响度差，以及把开头 F 秒交叉淡化
接回结尾——它们是 4~13s 的实地录音而不是成品 loop，直接 loop 会听见断口（见 loop_window）。

用法：
  set FFMPEG=E:\\test\\ffmpeg\\...\\bin\\ffmpeg.exe
  python build/export_fading_audio.py            # 只补缺失
  python build/export_fading_audio.py --force    # 全部重导
  python build/export_fading_audio.py --only event_bgm_maria-n_102-202,sfx_fad_waterstep

输出：
  public/fading_audio/<key>.ogg
  public/data/fading_audio.json   { key: {f, dur, kind, pool} }
"""
from __future__ import annotations

import argparse
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
from pathlib import Path


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[1]
SRC = Path(os.environ.get("NIKKE_SRC", r"E:/test/nikke_extract"))
sys.path.insert(0, str(SRC / "scripts"))
import export_cg_v2 as v2  # noqa: E402
import numpy as np  # noqa: E402
import UnityPy  # noqa: E402
import zstandard as zstd  # noqa: E402

OUT_DIR = ROOT / "public" / "fading_audio"
OUT_JSON = ROOT / "public" / "data" / "fading_audio.json"
DATA_JSON = ROOT / "public" / "data" / "fadingaffection.json"

# 静态表里没有、由 prefab / 客户端代码驱动的一族音效（uis_mini_fad_* = 本小游戏专用）。
# 名字来自资源池 catalog 检索，用途按命名与 prefab 结构推断，接错只改这一处。
UI_KEYS = {
    "uis_mini_fad_btn": "ui",                      # 通用按钮
    "uis_mini_fad_back": "ui",                     # 返回上一节点
    "uis_mini_fad_out": "ui",                      # 退出到主菜单
    "uis_mini_fad_x": "ui",                        # 关闭
    "uis_mini_fad_popup": "ui",                    # 弹窗打开
    "uis_mini_fad_recall": "ui",                   # 回想 / 记忆界面
    "uis_mini_fad_routeselect": "ui",
    "uis_mini_fad_routeselect_btn": "ui",
    "uis_mini_fad_routeselect_start": "ui",        # 开始记录
    "uis_mini_fad_special_firstselect": "ui",      # 开场选地点
    "uis_mini_fad_special_firstselect_city": "ui",
    "uis_mini_fad_special_firstselect_newcity": "ui",
    "uis_mini_fad_special_firstselect_river": "ui",
    "uis_mini_fad_hint_toast": "ui",
    "uis_mini_fad_status_erosion": "ui",
}
# 逐字出现的两类声音：打字机咔哒（全游戏剧情通用）与书写笔刷（偶尔出现）
TYPING_KEYS = {
    "nv_textwriter": "typing",
    "uis_mini_fad_scenario_up": "write",
}
AMBIENT_KEYS = {
    "ambient_fad_fade": "ambient",                 # 废墟平原 / 旧市区
    "ambient_fad_night": "ambient",
    "ambient_fad_river": "ambient",                # 湖
    "ambient_fad_birdriver": "ambient",
    "ambient_fad_citymoving": "ambient",           # 新市区
    "ambient_fadingaffection_erosion": "ambient",  # 侵蚀
}


def ffmpeg_exe() -> str:
    p = os.environ.get("FFMPEG") or shutil.which("ffmpeg")
    if not p:
        raise SystemExit("找不到 ffmpeg：请设置环境变量 FFMPEG 指向 ffmpeg.exe")
    return p


def needed_keys() -> dict[str, str]:
    """从活动数据里收集要导出的 key：页面 bgm + 选项 sfx，kind 记下来。"""
    data = json.loads(DATA_JSON.read_text(encoding="utf-8"))
    keys: dict[str, str] = {}
    for page in data["pages"].values():
        k = page.get("bgm")
        if k:
            keys.setdefault(k, "bgm")
    for ch in data["choices"].values():
        k = ch.get("sfx")
        if k:
            keys.setdefault(k, "sfx")
    keys.update(UI_KEYS)
    keys.update(TYPING_KEYS)
    keys.update(AMBIENT_KEYS)
    return keys


def pools() -> list[str]:
    """本机已有的资源池（有 catalog 与 chunk 存储的才算）。"""
    out = []
    for d in sorted(p.name for p in v2.ROOT.iterdir() if p.is_dir()):
        if (v2.ROOT / d / "chunk" / "store.cdb").exists():
            out.append(d)
    return out


def find_bundles(cat: sqlite3.Connection, key: str) -> list[tuple[int, str]]:
    """某个池子里所有 bundle 名含 `_assets_<key>_` 的记录。

    注意这是子串匹配，`ambient_fad_river` 也会命中 `..._river_dark_...`，
    所以候选要全部试一遍，由 pick_clip 判断里面到底有没有要的音轨。
    """
    return cat.execute(
        "select file_id, key from files_chunktype where instr(key, ?) > 0",
        (f"_assets_{key}_",),
    ).fetchall()


def clips_of(pool: str, bkey: str) -> dict[str, tuple[bytes, float]]:
    """重建 bundle，返回 {AudioClip 名: (WAV 字节, 秒数)}。"""
    cat = sqlite3.connect(v2.manifest_path(pool))
    table = v2.cidx_map(pool)
    cdb = v2.ROOT / pool / "chunk" / "store.cdb"
    size = cdb.stat().st_size
    dec = zstd.ZstdDecompressor()
    try:
        fid = cat.execute("select file_id from files_chunktype where key=?", (bkey,)).fetchone()
        if not fid:
            return {}
        data, _, missing = v2.rebuild(cat, table, cdb, dec, fid[0], size)
    finally:
        cat.close()
    if missing or not data:
        return {}
    env = UnityPy.load(io.BytesIO(data))
    out: dict[str, tuple[bytes, float]] = {}
    for o in env.objects:
        if o.type.name != "AudioClip":
            continue
        try:
            name = o.peek_name()
        except Exception:
            continue
        d = o.read()
        samples = d.samples
        if not samples:
            continue
        raw = next(iter(samples.values()))
        out[name] = (raw, clip_seconds(raw, d))
    return out


def resolve(key: str, available: list[str]) -> tuple[str, bytes, float] | None:
    """在资源池里找这个音频 key，返回 (池子, WAV, 秒数)。

    `_assets_<key>_` 是子串匹配，一个 key 可能对应多个 bundle，而 bundle 里的音轨名
    又不一定与 key 相同：`event_bgm_maria-n_daughter` 就没有同名轨，正式内容是一条
    96s 的 `_loop`，另有一个 0.7s 的 `_intro` 碎片单独打包。所以要把全部候选都摊开，
    按 同名 > _loop > 其它派生 > _intro 择优，同级取更长的，不能一命中就返回。
    """
    pools = ["dp", "core"] + [p for p in available if p not in ("dp", "core")]
    cands: list[tuple[str, str]] = []
    for pool in pools:
        cat = sqlite3.connect(v2.manifest_path(pool))
        try:
            cands += [(pool, bkey) for _, bkey in find_bundles(cat, key)]
        except sqlite3.OperationalError:
            pass
        finally:
            cat.close()
        if cands:
            break  # 命名规律只会在一个池子里，避免把全部池子扫一遍
    best: tuple[int, float, int, str, bytes, float] | None = None
    for idx, (pool, bkey) in enumerate(cands):
        try:
            clips = clips_of(pool, bkey)
        except Exception:
            continue
        for name, (raw, dur) in clips.items():
            if name != key and not name.startswith(key + "_"):
                continue
            if name == key:
                pri = 0
            elif name.endswith("_loop"):
                pri = 1
            elif name.endswith("_intro"):
                pri = 3
            else:
                pri = 2
            cand = (pri, -dur, idx, pool, raw, dur)
            if best is None or cand < best:
                best = cand
    if best is None:
        return None
    return best[3], best[4], best[5]


def clip_seconds(raw: bytes, clip) -> float:
    """优先按实际采样数算时长，取不到再回退 AudioClip 自带的 m_Length。"""
    try:
        with wave.open(io.BytesIO(raw)) as w:
            return w.getnframes() / float(w.getframerate() or 1)
    except Exception:
        return float(getattr(clip, "m_Length", 0.0) or 0.0)


NORM = "loudnorm=I=-20:TP=-1.5:LRA=11"
LOOP_WINDOWS = (0.8, 1.2, 1.8, 2.5)
LOOP_CURVES = ("qsin", "tri")


def read_mono(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path)) as r:
        sr = r.getframerate()
        return np.frombuffer(r.readframes(r.getnframes()), dtype="<i2").astype(np.float32), sr


def seam_cost(y: np.ndarray, sr: int) -> float:
    """把文件首尾相接，量接缝附近 ±33ms 的二阶差分相对全片中位数。
    接近 1 = 接缝和素材本身一样平，明显大于 1.5 = 听得出的断口。
    这里不用头尾电平做判据：erosion 是 ±10 dB、2.3 Hz 的脉动低频，
    头尾各取 100ms 落在波峰还是波谷全看运气，这项指标才稳定。"""
    loop = np.concatenate([y, y])
    rough = np.abs(np.diff(loop, 2))
    c = len(y)
    m = max(1, int(sr * 0.033))
    return float(np.mean(rough[c - m:c + m]) / (np.median(rough) + 1e-9))


def crossfade(src: Path, dest: Path, ff: str, win: float, curve: str) -> None:
    """把开头 win 秒叠到尾部淡出之后，输出长度 L-win：
    循环点两侧都落在素材的同一时刻，所以接得上。"""
    fc = ("[0:a]asplit=2[a0][a1];"
          f"[a0]atrim=start={win},asetpts=PTS-STARTPTS[body];"
          f"[a1]atrim=duration={win},asetpts=PTS-STARTPTS[head];"
          f"[body][head]acrossfade=d={win}:c1={curve}:c2={curve}[out]")
    subprocess.run([ff, "-y", "-hide_banner", "-loglevel", "error", "-i", str(src),
                    "-filter_complex", fc, "-map", "[out]", "-c:a", "pcm_s16le", str(dest)],
                   check=True)


def run(*cmd: str) -> None:
    subprocess.run(list(cmd), check=True)


def encode(raw: bytes, dest: Path, ff: str, tmp: Path, bed: bool = False) -> tuple[float, str]:
    """转 ogg，返回 (实际秒数, 循环接法说明)。

    环境音床（bed=True）多做两件事：
    1) loudnorm 拉平六条之间近 20 dB 的响度差（fade -21 dBFS、river -40 dBFS），
       否则前端按固定音量放，安静那几条等于没声音；
    2) 拼成能无缝循环的版本。六条床都是 4~13s 的实地录音而不是成品 loop，
       直接 loop 会把结尾硬接到开头，用户听出来的就是那个断口。
       窗口和淡化曲线不拍脑袋定：把候选在素材上各试一遍，按 seam_cost 选最平的一组，
       连「不拼」也当候选参与比较（citymoving 原素材本来就接得上）。
       loudnorm 必须在拼接之前——它是动态增益，放在后面会把循环点两侧拉成不同电平。
    """
    src = tmp / (dest.stem + ".wav")
    src.write_bytes(raw)
    if not bed:
        run(ff, "-y", "-hide_banner", "-loglevel", "error", "-i", str(src),
            "-c:a", "libvorbis", "-q:a", "5", str(dest))
        src.unlink(missing_ok=True)
        return probe_seconds(dest, ff), ""

    norm = tmp / (dest.stem + ".norm.wav")
    run(ff, "-y", "-hide_banner", "-loglevel", "error", "-i", str(src),
        "-af", NORM, "-ar", "44100", str(norm))
    mono = tmp / (dest.stem + ".mono.wav")
    run(ff, "-y", "-hide_banner", "-loglevel", "error", "-i", str(norm), "-ac", "1", str(mono))
    y, sr = read_mono(mono)
    best: tuple[float, float, str] = (seam_cost(y, sr), 0.0, "none")
    for win in LOOP_WINDOWS:
        if win > len(y) / sr * 0.35:
            continue
        for curve in LOOP_CURVES:
            cand = tmp / (dest.stem + f".try{win}.wav")
            crossfade(norm, cand, ff, win, curve)
            z, zsr = read_mono(cand)
            cost = seam_cost(z, zsr)
            cand.unlink(missing_ok=True)
            if cost < best[0]:
                best = (cost, win, curve)
    cost, win, curve = best
    body = norm if win == 0 else tmp / (dest.stem + ".loop.wav")
    if win:
        crossfade(norm, body, ff, win, curve)
    run(ff, "-y", "-hide_banner", "-loglevel", "error", "-i", str(body),
        "-c:a", "libvorbis", "-q:a", "5", str(dest))
    for p in (src, norm, mono, body):
        p.unlink(missing_ok=True)
    return probe_seconds(dest, ff), (f"loop {win}s/{curve} {cost:.2f}x" if win
                                     else f"无需拼接 {cost:.2f}x")


def probe_seconds(path: Path, ff: str) -> float:
    """用 ffmpeg 读回实际秒数（循环拼接会把素材缩短一个窗口）。"""
    p = subprocess.run([ff, "-hide_banner", "-i", str(path), "-f", "null", "-"],
                       capture_output=True, text=True)
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", p.stderr)
    if not m:
        return 0.0
    h, mi, s = m.groups()
    return int(h) * 3600 + int(mi) * 60 + float(s)


def safe(key: str) -> str:
    return re.sub(r"[^\w.-]+", "_", key)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="已存在的也重导")
    ap.add_argument("--only", help="逗号分隔的 key 白名单")
    args = ap.parse_args()

    if not DATA_JSON.exists():
        raise SystemExit(f"缺少 {DATA_JSON}，请先跑 nikke_extract 的 export_fadingaffection.py")

    keys = needed_keys()
    if args.only:
        want = {k.strip() for k in args.only.split(",") if k.strip()}
        keys = {k: v for k, v in keys.items() if k in want}

    ff = ffmpeg_exe()
    available = pools()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix="fading_audio_"))
    print(f"需要 {len(keys)} 个音频（bgm {sum(1 for v in keys.values() if v == 'bgm')} / "
          f"sfx {sum(1 for v in keys.values() if v == 'sfx')}），本机资源池：{available}", flush=True)

    out: dict[str, dict] = {}
    if OUT_JSON.exists():
        out = json.loads(OUT_JSON.read_text(encoding="utf-8"))
    missing: list[str] = []
    t0 = time.time()
    for n, (key, kind) in enumerate(sorted(keys.items()), 1):
        dest = OUT_DIR / f"{safe(key)}.ogg"
        if dest.exists() and not args.force and key in out:
            continue
        try:
            hit = resolve(key, available)
        except Exception as e:  # 单个 bundle 坏了不影响其它
            hit = None
            print(f"  [{n}/{len(keys)}] 解析失败 {key}: {e}", flush=True)
        if not hit:
            missing.append(key)
            print(f"  [{n}/{len(keys)}] 找不到音轨：{key}", flush=True)
            continue
        pool, raw, dur = hit
        actual, how = encode(raw, dest, ff, tmp, bed=(kind == "ambient"))
        out[key] = {"f": f"/fading_audio/{dest.name}", "dur": round(actual or dur, 3),
                    "kind": kind, "pool": pool}
        print(f"  [{n}/{len(keys)}] {key} <- {pool} {round(dur, 1)}s {how} "
              f"{dest.stat().st_size // 1024}KB", flush=True)

    shutil.rmtree(tmp, ignore_errors=True)
    OUT_JSON.write_text(json.dumps(out, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")
    print(f"完成：写出 {len(out)} 条到 {OUT_DIR}，缺 {len(missing)} 条，"
          f"{time.time() - t0:.0f}s", flush=True)
    if missing:
        print("缺失清单：" + ", ".join(missing), flush=True)


if __name__ == "__main__":
    main()
