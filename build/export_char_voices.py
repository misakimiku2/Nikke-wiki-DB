#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
提取角色语音（日语 + 国服中文）

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
  国服客户端 runtime_data/saus/zh_cn/ab/*.nab
      国服中文语音包。版本落后于国际服，部分角色/台词没有中文语音，
      按语音 ID 能对上多少就提取多少；前端缺中文时回退日语。

输出：
  public/voice/<角色 id>.ogg
  public/voice/<角色 id>.zh.ogg
      每个角色每种语言一条音频雪碧图（按表内顺序拼接），前端按
      start/end 时间点播放，避免生成上万个小文件。
  public/data/char_voices.json
      { "items": { "102": { "f": "/voice/102.ogg", "fz": "/voice/102.zh.ogg",
          "n": 42, "zc": 38,
          "cats": [ { "k": "lobby", "n": "大厅", "v": [
            { "id": "...", "t": "在大厅点击时I", "x": "中文", "j": "日文",
              "s": 0.0, "e": 2.25, "zs": 0.0, "ze": 2.1 } ] } ] } } }

用法：
  set FFMPEG=E:\\test\\ffmpeg\\...\\bin\\ffmpeg.exe
  python build/export_char_voices.py --only 102,352
  python build/export_char_voices.py
  python build/export_char_voices.py --no-cn
"""
from __future__ import annotations

import argparse
import audioop
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
# 国服客户端的中文语音池；可用 NIKKE_CN_ROOT 覆盖
CN_ROOT = Path(os.environ.get(
    "NIKKE_CN_ROOT",
    r"C:/Program Files/GAME/胜利女神：新的希望(2002017)/nikke_Data/runtime_data/saus/zh_cn",
))
CN_AB = CN_ROOT / "ab"
# 国服日语池：客户端按语音语言切换整个池子，切到日语时才有（结构同 zh_cn）
CN_JA_AB = CN_ROOT.parent / "ja" / "ab"
# 国服自己的翻译，和语音一起使用（国际服的 zh-CN 文本与国服配音可能不一致）
CN_LOCALE = CN_ROOT.parent / "saus" / "lss" / "Locale_Character.lss"

# ---- 表外语音（2026-11 国服 G23.x 聊斋版本引入）----
# 国服专属皮肤的语音套组：国际服语音分组表（CharacterVoiceGroupTable）里没有，
# 按本体角色同后缀条目克隆生成记录；音频来自国服 zh/ja 池。
# 注意：c010_01 白色诺言不在列——实测其 42 条音频与本体拉毗逐字节相同
# （国服皮肤包只是重打包本体录音，这也是国际服表从未收录它的原因），挂上去纯属重复。
CN_SKIN_SETS = ["c082_80", "c233_80", "c260_80"]
CN_SKIN_CHAR = {"c082_80": 82, "c233_80": 233, "c260_80": 260}
CN_SKIN_LABELS = {
    "c082_80": "黄发垂髫",
    "c233_80": "宴桃源",
    "c260_80": "蝶恋花语",
}
# 国服先行角色（整体不在国际服数据里）：ref = 借用标题/类别的参照角色前缀。
# 需要先把这些角色加进 char_images.json（public/data）才能挂到站点。
CN_FIRST_CHARS: list[dict] = [
    # {"prefix": "c8004", "cid": 8004, "ref": "c102"},   # 婴宁
    # {"prefix": "c8005", "cid": 8005, "ref": "c102"},   # 画皮
]

sys.path.insert(0, str(SRC / "scripts"))
import export_cg_v2 as v2  # noqa: E402
import UnityPy  # noqa: E402
import zstandard as zstd  # noqa: E402

TOKEN = re.compile(rb"[ -~]{4,}")
VOICE_RE = re.compile(r"^(c\d+(?:_\d+)?)_(.+)$")
CV_RE = re.compile(r"^\s*CV\s*[:：]\s*", re.I)


def clean_cv(s: str | None) -> str | None:
    if not s:
        return None
    return CV_RE.sub("", s).strip() or None


def is_cn_dub(cv_ja: str | None, cv_cn: str | None) -> bool:
    """国服是否真的配了中文。

    联动角色（2B / 千束 / Persona 等）国服没有中配，语音池里放的是日语原声，
    国服的 cv_zh_cn 也会直接沿用日配声优名。声优名相同或为「暂无」时视为无中配。
    """
    if not cv_cn:
        return False
    if cv_cn.strip() in ("暂无", "UNKNOWN", "未知"):
        return False
    return cv_cn != cv_ja


CATS = [
    ("lobby", "大厅"),
    ("outpost", "前哨基地"),
    ("upgrade", "获得与成长"),
    ("field", "野外"),
    ("battle", "战斗"),
    ("title", "登录"),
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


def normalize_wav(raw: bytes) -> tuple[bytes, float]:
    """把 AudioClip 的 WAV 统一成 48kHz / 单声道 / 16bit，返回 (wav, 秒数)。

    国服语音混用 44.1k 与 48k；ffmpeg 的 concat demuxer 不会逐段重采样，
    混采样率会把后面所有分段的时间轴推歪，表现为开头带上一句、尾音被掐。
    另外时长按实际采样数计算，不依赖 AudioClip.m_Length。
    """
    with wave.open(io.BytesIO(raw)) as w:
        rate = w.getframerate()
        ch = w.getnchannels()
        sw = w.getsampwidth()
        pcm = w.readframes(w.getnframes())
    if ch != 1:
        pcm = audioop.tomono(pcm, sw, 0.5, 0.5)
        ch = 1
    if sw != 2:
        pcm = audioop.lin2lin(pcm, sw, 2)
        sw = 2
    if rate != 48000:
        pcm, _ = audioop.ratecv(pcm, 2, 1, rate, 48000, None)
        rate = 48000
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(48000)
        w.writeframes(pcm)
    seconds = len(pcm) / (48000 * 2)
    return out.getvalue(), seconds


def cat_of(desc: str) -> str:
    if desc.startswith("titlecall"):
        return "title"
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


def synthesize_records(recs: list[dict]) -> list[dict]:
    """表外语音合成：国服皮肤套组（克隆本体同后缀条目）+ 全员登录语音（titlecall）。

    titlecall 官方不走语音分组表（引擎按 cXXX_titlecall_1 直取），两边 Locale 表
    也长期没有文本键，因此合成记录仅有音频无文本。合成记录的音频仍需在池里
    找得到，找不到会被可用性过滤自然丢弃。
    """
    out = list(recs)
    by_prefix: dict[str, dict[str, dict]] = {}
    for r in recs:
        by_prefix.setdefault(r["prefix"], {})[r["id"][len(r["prefix"]) + 1:]] = r

    def add(prefix: str, suffix: str, base: dict | None = None,
            title: str | None = None, cat: str | None = None) -> None:
        vid = f"{prefix}_{suffix}"
        if any(r["id"] == vid for r in out):
            return
        # 克隆记录只继承 desc（标题由 main 里按 desc 查 Locale_System 得出，与本体一致）；
        # 显式给定 title 的（登录语音等）写入 record，优先于 desc 推导。
        rec = {
            "order": len(out),
            "desc": base["desc"] if base else f"synthetic_{suffix}",
            "id": vid,
            "loc": vid,
            "cat": cat or (base["cat"] if base else "battle"),
            "prefix": prefix,
        }
        if title:
            rec["title"] = title
        out.append(rec)

    for pref in CN_SKIN_SETS:
        base_pref = pref.rsplit("_", 1)[0]
        for suffix, base in sorted(by_prefix.get(base_pref, {}).items()):
            add(pref, suffix, base=base)
    for pref in sorted(set(by_prefix) | set(CN_SKIN_SETS)):
        add(pref, "titlecall_1", title="登录", cat="title")
    for ch in CN_FIRST_CHARS:
        ref = by_prefix.get(ch.get("ref", ""), {})
        for suffix in sorted(ref):
            add(ch["prefix"], suffix, title=ref[suffix]["title"], cat=ref[suffix]["cat"])
        add(ch["prefix"], "titlecall_1", title="登录", cat="title")
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


def scan_audio_cn(voice_ids: set[str], root: Path = CN_AB) -> dict[str, tuple[str, int]]:
    """国服语音池（nab）扫描：语音 ID -> (nab 路径, AudioClip path_id)。"""
    files = sorted(root.glob("*.nab")) if root.exists() else []
    found: dict[str, tuple[str, int]] = {}
    t0 = time.time()
    for n, p in enumerate(files, 1):
        try:
            env = UnityPy.load(str(p))
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
                found.setdefault(nm, (str(p), o.path_id))
        if n % 40 == 0:
            print(f"  扫描国服语音包 {n}/{len(files)}，命中 {len(found)}，{time.time()-t0:.0f}s", flush=True)
    print(f"  国服语音包扫描完成：{len(found)}/{len(voice_ids)}，{time.time()-t0:.0f}s", flush=True)
    return found


def ffmpeg_exe() -> str:
    p = os.environ.get("FFMPEG") or shutil.which("ffmpeg")
    if not p:
        raise SystemExit("找不到 ffmpeg：请设置环境变量 FFMPEG 指向 ffmpeg.exe")
    return p


def stable_ver(suffix: str, clips: list[dict]) -> str:
    """用语音 ID + 时长生成稳定版本号，重跑不会让所有客户端重新下载。"""
    raw = suffix + "|" + "|".join(f"{c['id']}:{c['dur']:.3f}" for c in clips) + f"|gap{GAP:.2f}"
    return hashlib.md5(raw.encode("utf-8")).hexdigest()[:8]


def encode_sprite(char_id: str, suffix: str, clips: list[dict], raw_paths: dict[str, Path],
                  ffmpeg: str, tmp: Path) -> str | None:
    """把一组语音拼成 OGG 雪碧图，返回版本 hash；失败返回 None。"""
    valid = [c for c in clips if raw_paths.get(c["id"])]
    total = sum(c["dur"] for c in valid)
    if total <= 0:
        return None
    concat = tmp / f"concat_{char_id}{suffix}.txt"
    lines = []
    silence = tmp / "silence.wav"
    for i, c in enumerate(valid):
        p = raw_paths[c["id"]]
        lines.append("file '" + p.as_posix().replace("'", "'\\''") + "'")
        if i < len(valid) - 1:
            lines.append("file '" + silence.as_posix() + "'")
    concat.write_text("\n".join(lines) + "\n", encoding="utf-8")
    out = OUT_AUDIO / f"{char_id}{suffix}.ogg"
    cmd = [
        ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
        "-f", "concat", "-safe", "0", "-i", str(concat),
        "-vn", "-c:a", "libvorbis", "-b:a", "48k", "-ac", "1", "-ar", "48000",
        "-map_metadata", "-1", str(out),
    ]
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0 or not out.exists() or out.stat().st_size == 0:
        print(f"  ! {char_id}{suffix} 编码失败：{p.stderr.strip()[:160]}", flush=True)
        return None
    return stable_ver(suffix, valid)


def encode_char(char_id: str, clips: list[dict], raw_paths: dict[str, Path],
                ffmpeg: str, tmp: Path) -> tuple[str, dict | None]:
    """把一个角色的全部语音拼成一条 OGG 雪碧图，返回 (char_id, json 项)。"""
    ver = encode_sprite(char_id, "", clips, raw_paths, ffmpeg, tmp)
    if not ver:
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
            if c.get("cn") and c["cn"] != c["zh"]:
                vo["xz"] = c["cn"]
            vs.append(vo)
        cats.append({"k": k, "n": name, "v": vs})
    return char_id, {"f": f"/voice/{char_id}.ogg?v={ver}", "n": len(clips), "cats": cats}


def extract_cn_wavs(records: list[dict], cn_audio: dict[str, tuple[str, int]],
                    tmp: Path) -> tuple[dict[str, Path], dict[str, float]]:
    """从国服 nab 中导出中文 WAV，返回 (id -> wav, id -> 秒数)。"""
    raw_paths: dict[str, Path] = {}
    durs: dict[str, float] = {}
    by_file: dict[str, list[dict]] = {}
    for r in records:
        info = cn_audio.get(r["id"])
        if info:
            by_file.setdefault(info[0], []).append(r)
    t0 = time.time()
    for n, (path, rs) in enumerate(by_file.items(), 1):
        try:
            env = UnityPy.load(path)
        except Exception:
            continue
        by_pid = {o.path_id: o for o in env.objects if o.type.name == "AudioClip"}
        for r in rs:
            o = by_pid.get(cn_audio[r["id"]][1])
            if o is None:
                continue
            try:
                d = o.read()
                samples = d.samples
                if not samples:
                    continue
                raw = next(iter(samples.values()))
                raw, dur = normalize_wav(raw)
                safe = re.sub(r"[^\w.-]+", "_", r["id"])
                p = tmp / f"cn_{safe}.wav"
                p.write_bytes(raw)
                raw_paths[r["id"]] = p
                durs[r["id"]] = dur or float(d.m_Length or 0.0)
            except Exception:
                continue
        if n % 40 == 0:
            print(f"  解包国服 {n}/{len(by_file)} 个包，{time.time()-t0:.0f}s", flush=True)
    print(f"  写出 {len(raw_paths)} 个中文 WAV，{time.time()-t0:.0f}s", flush=True)
    return raw_paths, durs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="只处理这些角色 id，逗号分隔，例如 102,352")
    ap.add_argument("--limit", type=int, default=0, help="只处理前 N 个角色（调试）")
    ap.add_argument("--no-cn", action="store_true", help="跳过国服中文语音")
    ap.add_argument("--keep-temp", action="store_true")
    args = ap.parse_args()

    OUT_AUDIO.mkdir(parents=True, exist_ok=True)
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)

    print("1/4 解析语音表…")
    recs = parse_voice_table()
    recs = synthesize_records(recs)
    print(f"  {len(recs)} 条语音记录")

    print("2/4 读取本地化文本…")
    idx = locale_index()
    lines = load_locale(idx, "Locale_Character")
    sysdesc = load_locale(idx, "Locale_System")
    cn_lines: dict[str, str] = {}
    if CN_LOCALE.exists():
        try:
            cc = sqlite3.connect(f"file:{CN_LOCALE}?mode=ro", uri=True)
            cn_lines = {k: (zh or "") for k, zh in
                        cc.execute('SELECT Key, "zh-CN" FROM Locale_Character')}
            cc.close()
            print(f"  国服文本 {len(cn_lines)} 条")
        except Exception as e:
            print(f"  ! 国服文本读取失败：{e}")
    for r in recs:
        txt = lines.get(r["loc"], {})
        r["zh"] = txt.get("zh", "")
        r["ja"] = txt.get("ja", "")
        r["cn"] = cn_lines.get(r["loc"], "")
        d = sysdesc.get(r["desc"], {})
        # 合成记录可能已带标题（登录语音等表外条目），优先保留
        r["title"] = d.get("zh") or r.get("title") or r["desc"].replace("voice_description_", "")
    # 国服先行内容没有国际服文本时，直接用国服文本作为展示文本
    for r in recs:
        if not r["zh"] and r.get("cn"):
            r["zh"] = r["cn"]

    def cv_pair(cid: int) -> tuple[str | None, str | None]:
        ja = clean_cv((lines.get(f"{cid}_cv_ja") or {}).get("zh"))
        cn = clean_cv(cn_lines.get(f"{cid}_cv_zh_cn"))
        return ja, cn

    print("3/4 扫描语音包…")
    voice_ids = {r["id"] for r in recs}
    audio = scan_audio(voice_ids)
    # 国服池：中文（zh_cn）与日语（ja，客户端切到日语语音时才在）。
    # 国服先行/专属内容的音频只存在于国服池，国际服池找不到的 ID 在这里补上。
    cn_audio = scan_audio_cn(voice_ids) if not args.no_cn else {}
    cn_ja_audio = scan_audio_cn(voice_ids, CN_JA_AB) if CN_JA_AB.exists() else {}

    _, resolve = char_map()

    def resolve_any(pref: str) -> int | None:
        r = resolve(pref)
        return r if r is not None else CN_SKIN_CHAR.get(pref)

    chars = sorted({resolve_any(r["prefix"]) for r in recs if resolve_any(r["prefix"]) is not None})
    if args.only:
        want = {int(x) for x in args.only.split(",") if x.strip()}
        chars = [c for c in chars if c in want]
    if args.limit:
        chars = chars[:args.limit]
    char_set = set(chars)
    print(f"  目标角色 {len(chars)} 个")

    # 只保留有音频、且角色页存在的记录（仅中文可用的表外条目也放行，见下方分组）
    usable = [r for r in recs if (r["id"] in audio or r["id"] in cn_ja_audio or r["id"] in cn_audio)
              and resolve_any(r["prefix"]) in char_set]
    print(f"  可用语音 {len(usable)} 条")

    ffmpeg = ffmpeg_exe()
    tmp = Path(tempfile.mkdtemp(prefix="nikke_voice_"))
    write_silence(tmp / "silence.wav")
    print(f"4/4 导出音频…（临时目录 {tmp}）")
    raw_paths: dict[str, Path] = {}
    # 按 bundle 聚合，一个 bundle 只解一次
    by_bundle: dict[str, list[dict]] = {}
    for r in usable:
        if r["id"] in audio:
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
                raw, dur = normalize_wav(raw)
                safe = re.sub(r"[^\w.-]+", "_", r["id"])
                p = tmp / f"{safe}.wav"
                p.write_bytes(raw)
                raw_paths[r["id"]] = p
                r["dur"] = dur or float(d.m_Length or 0.0)
            except Exception:
                continue
        done += 1
        if done % 100 == 0:
            print(f"  解包 {done}/{len(by_bundle)} 个 bundle，{time.time()-t0:.0f}s", flush=True)
    cat.close()
    print(f"  写出 {len(raw_paths)} 个 WAV，{time.time()-t0:.0f}s")

    # 国服 ja 池补充提取（国际服没有的音频：国服专属皮肤套组等）
    cn_ja_records = [r for r in usable if r["id"] not in raw_paths and r["id"] in cn_ja_audio]
    if cn_ja_records:
        print(f"  国服 ja 池补充提取 {len(cn_ja_records)} 条…")
        w, durs = extract_cn_wavs(cn_ja_records,
                                  {r["id"]: cn_ja_audio[r["id"]] for r in cn_ja_records}, tmp)
        for r in cn_ja_records:
            if r["id"] in w:
                raw_paths[r["id"]] = w[r["id"]]
                r["dur"] = durs.get(r["id"], 0.0)
        print(f"  合计 {len(raw_paths)} 个日语 WAV")

    # 按角色聚合，保留表内顺序
    grouped: dict[int, list[dict]] = {}
    for r in usable:
        cid = resolve_any(r["prefix"])
        if cid is None:
            continue
        if r["id"] not in raw_paths:
            # 仅中文可用的表外条目（登录语音国服先配、国际服池无对应日语）：
            # 日语时间轴上零宽占位（s == e），前端日配模式按 e > s 过滤跳过
            if r["id"] not in cn_audio or not is_cn_dub(*cv_pair(cid)):
                continue
            r["dur"] = 0.0
        elif r.get("dur", 0) <= 0:
            continue
        grouped.setdefault(cid, []).append(r)
    for cid in grouped:
        grouped[cid].sort(key=lambda x: x["order"])
        t = 0.0
        last = len(grouped[cid]) - 1
        for i, r in enumerate(grouped[cid]):
            r["start"] = t
            # 零宽占位条目不占雪碧图空间，也不插静音
            t += r["dur"] + (GAP if i < last and r["dur"] > 0 else 0.0)

    # 同角色多套皮肤各有独立语音时，标出来源皮肤，避免「在大厅点击时I」重复出现
    art = {}
    if CHAR_ART.exists():
        art = json.loads(CHAR_ART.read_text(encoding="utf-8"))

    def skin_label(pref: str) -> str:
        if pref in CN_SKIN_LABELS:
            return CN_SKIN_LABELS[pref]
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

    # 国服中文语音：能对上多少提取多少，缺的角色保持纯日语
    if not args.no_cn and cn_audio:
        print("\n附加：国服中文语音提取…")
        cn_records = [r for r in usable if r["id"] in cn_audio]
        cn_wavs, cn_durs = extract_cn_wavs(cn_records, cn_audio, tmp)
        cn_grouped: dict[int, list[dict]] = {}
        for r in usable:
            if r["id"] not in cn_wavs or cn_durs.get(r["id"], 0) <= 0:
                continue
            cid = resolve_any(r["prefix"])
            if cid is None or str(cid) not in payload:
                continue
            ja_cv, cn_cv = cv_pair(cid)
            if not is_cn_dub(ja_cv, cn_cv):
                continue
            cn_grouped.setdefault(cid, []).append(r)

        def encode_zh(cid: int, rs: list[dict]):
            rs = sorted(rs, key=lambda x: x["order"])
            cs = []
            for r in rs:
                c = dict(r)
                c["dur"] = cn_durs[r["id"]]
                cs.append(c)
            t = 0.0
            last = len(cs) - 1
            for i, c in enumerate(cs):
                c["zstart"] = t
                t += c["dur"] + (GAP if i < last else 0.0)
            ver = encode_sprite(str(cid), ".zh", cs, cn_wavs, ffmpeg, tmp)
            return cid, cs, ver

        with ThreadPoolExecutor(max_workers=4) as pool:
            jobs = [pool.submit(encode_zh, cid, rs) for cid, rs in cn_grouped.items()]
            for f in as_completed(jobs):
                cid, cs, ver = f.result()
                if not ver:
                    continue
                item = payload.get(str(cid))
                if not item:
                    continue
                by_id = {it["id"]: it for cat in item["cats"] for it in cat["v"]}
                for c in cs:
                    it = by_id.get(c["id"])
                    if it is not None:
                        it["zs"] = round(c["zstart"], 3)
                        it["ze"] = round(c["zstart"] + c["dur"], 3)
                item["zc"] = sum(1 for c in cs if c["id"] in by_id)
                item["fz"] = f"/voice/{cid}.zh.ogg?v={ver}"
        n_zh = sum(v.get("zc", 0) for v in payload.values())
        print(f"  中文语音覆盖 {n_zh} 条，{sum(1 for v in payload.values() if v.get('fz'))} 个角色")
    elif not args.no_cn:
        print(f"  ! 未找到国服语音目录，跳过中文：{CN_AB}")

    # 声优：日配取国际服 {id}_cv_ja，中配取国服 {id}_cv_zh_cn
    for cid, item in payload.items():
        ja, cn = cv_pair(int(cid))
        if ja:
            item["cvj"] = ja
        if cn and is_cn_dub(ja, cn):
            item["cvz"] = cn

    # --only / --limit 调试时不要冲掉其余角色的索引
    merged: dict[str, dict] = {}
    if (args.only or args.limit) and OUT_JSON.exists():
        try:
            merged = json.loads(OUT_JSON.read_text(encoding="utf-8")).get("items", {})
        except Exception:
            merged = {}
    merged.update(payload)

    if not args.only and not args.limit:
        expected = {f"{k}.ogg" for k in payload}
        expected |= {f"{k}.zh.ogg" for k, v in payload.items() if v.get("fz")}
        for p in OUT_AUDIO.glob("*.ogg"):
            if p.name not in expected:
                p.unlink()

    OUT_JSON.write_text(
        json.dumps({"items": dict(sorted(merged.items(), key=lambda kv: int(kv[0])))},
                   ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    if not args.keep_temp:
        shutil.rmtree(tmp, ignore_errors=True)

    n_voice = sum(v["n"] for v in payload.values())
    n_zh = sum(v.get("zc", 0) for v in payload.values())
    size_mb = sum((OUT_AUDIO / f"{k}.ogg").stat().st_size for k in payload) / 1048576
    size_zh = sum((OUT_AUDIO / f"{k}.zh.ogg").stat().st_size
                  for k, v in payload.items() if v.get("fz")) / 1048576
    print(f"\n完成：{len(payload)} 个角色，{n_voice} 条语音（中配 {n_zh} 条），"
          f"音频 {size_mb:.1f} + {size_zh:.1f} MB")
    print(f"  音频目录 {OUT_AUDIO}")
    print(f"  索引 {OUT_JSON}  {OUT_JSON.stat().st_size/1024:.0f} KB")


if __name__ == "__main__":
    main()
