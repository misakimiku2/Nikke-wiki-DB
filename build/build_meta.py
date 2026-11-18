#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把这次构建的上下文写进 public/build-meta.json。

素材不进版本库（public/ 整个被忽略），部署之后很难回答
「这份贴图是哪次构建、对应哪个游戏版本、哪个 commit」。
构建脚本结束时调用一次，把答案写在站点根目录，浏览器直接打开
/build-meta.json 就能看到，也方便出问题时贴出来对照。

    python build/build_meta.py                       # 手动刷新一次
    from build_meta import write_meta; write_meta(...)  # 构建脚本内部调用
"""
from __future__ import annotations

import datetime
import json
import os
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
META = PUBLIC / "build-meta.json"

GAME_PATCH = pathlib.Path(os.environ.get(
    "NIKKE_PATCH", r"F:\NIKKE\Unity\com_proximabeta_NIKKE\com.shiftup.patch"))
PACKAGE_JSON = ROOT / "web" / "package.json"


def _iso(ts: float | None) -> str | None:
    if ts is None:
        return None
    try:
        return datetime.datetime.fromtimestamp(ts).astimezone().isoformat(timespec="seconds")
    except (OSError, OverflowError, ValueError):
        return None


def _mtime(path: pathlib.Path) -> str | None:
    try:
        return _iso(path.stat().st_mtime)
    except OSError:
        return None


def _git(*args: str) -> str:
    try:
        p = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, timeout=5)
        return p.stdout.strip() if p.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def _site() -> dict:
    version = ""
    try:
        version = json.loads(PACKAGE_JSON.read_text(encoding="utf-8")).get("version", "")
    except (OSError, ValueError):
        pass
    return {
        "version": version,
        "branch": _git("rev-parse", "--abbrev-ref", "HEAD"),
        "commit": _git("rev-parse", "--short", "HEAD"),
        # 有未提交改动时标出来：这种素材和 commit 对不上，排查时别被误导
        "dirty": bool(_git("status", "--porcelain")),
    }


def _game() -> dict:
    """游戏资源池的指纹。没装游戏（或路径不对）时字段留空，不报错。"""
    store = GAME_PATCH / "dp" / "chunk" / "store.cdb"
    catalog = GAME_PATCH / "dp" / "catalog.ndb"
    size = None
    try:
        size = round(store.stat().st_size / 1024 ** 3, 2)
    except OSError:
        pass
    return {
        "patchDir": str(GAME_PATCH),
        "patchMtime": _mtime(GAME_PATCH),
        "catalogMtime": _mtime(catalog),
        "storeGB": size,
    }


def write_meta(*, kind: str = "", only: str = "", models: int | None = None,
               pages: int | None = None, note: str = "") -> pathlib.Path:
    """写 public/build-meta.json；参数描述刚跑完的那一批，缺省就不写该字段。"""
    PUBLIC.mkdir(parents=True, exist_ok=True)
    last: dict = {}
    if kind:
        last["kind"] = kind
    if only:
        last["only"] = only
    if models is not None:
        last["models"] = models
    if pages is not None:
        last["pages"] = pages
    if note:
        last["note"] = note

    data = {
        "schema": 1,
        "_note": "构建上下文：站点代码版本 + 游戏资源池指纹 + 最近一次素材构建。"
                 "由 build/build_meta.py 生成，public/ 不入库，所以每次构建会重写。",
        "builtAt": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "site": _site(),
        "game": _game(),
        "lastRun": last,
    }
    META.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return META


if __name__ == "__main__":
    p = write_meta(note="手工刷新（build_meta.py）")
    print(f"written {p}")
    print(p.read_text(encoding="utf-8"))
