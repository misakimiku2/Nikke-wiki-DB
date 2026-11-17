"""提取部队专属图标：dp 池 icons-squad(hd) 图集 → public/squadicon/{slug}.webp
并按 Locale_Character 的 {slug}_name 生成 public/data/squad_icons.json（部队中文名 → 图标路径）。
图标统一 contain 缩放进 320×240 画布居中（前端等比渲染，视觉大小一致）；
无专属图标的部队（联动/自创部队）由 _default 回退到反常企业图标。
"""
import io
import json
import os
import sqlite3
import sys

from PIL import Image

sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, r'E:/test/nikke_extract/scripts')
import config
import export_cg_v2 as v2
import UnityPy
import zstandard as zstd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'squadicon')
os.makedirs(OUT, exist_ok=True)

dec = zstd.ZstdDecompressor()
table = v2.cidx_map('dp')
cdb = config.GAME_PATCH / 'dp' / 'chunk' / 'store.cdb'
cat = sqlite3.connect(r'file:E:/test/nikke_extract/catalogs/dp_catalog.ndb.dec?mode=ro', uri=True)

fid, key = cat.execute(
    "select file_id,key from files_chunktype where key like 'icons-squad(hd)_assets_all%'").fetchone()
bundle, _np, missing = v2.rebuild(cat, table, cdb, dec, fid, cdb.stat().st_size)
assert bundle and not missing, f'{key} missing={missing}'

env = UnityPy.load(io.BytesIO(bundle))
slugs = []
for o in env.objects:
    if o.type.name != 'Sprite':
        continue
    sp = o.read()
    if not sp.m_Name.startswith('icn_'):
        continue
    slug = sp.m_Name[4:]
    img = sp.image.convert('RGBA')
    # 归一化画布：宽高比差异极大（5:1 字标 ~ 1:2 竖徽），contain 缩进统一画布居中，
    # 前端按画布比例渲染即可视觉统一
    CANVAS_W, CANVAS_H = 320, 240
    scale = min(CANVAS_W / img.width, CANVAS_H / img.height)
    w2, h2 = max(1, round(img.width * scale)), max(1, round(img.height * scale))
    if (w2, h2) != (img.width, img.height):
        img = img.resize((w2, h2), Image.LANCZOS)
    canvas = Image.new('RGBA', (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
    canvas.paste(img, ((CANVAS_W - w2) // 2, (CANVAS_H - h2) // 2), img)
    canvas.save(os.path.join(OUT, f'{slug}.webp'), 'WEBP', quality=95, method=4)
    slugs.append(slug)
print(f'icons: {len(slugs)}')


def open_locale():
    decdir = r'E:/test/nikke_extract/decrypted'
    for fn in sorted(os.listdir(decdir)):
        if not fn.endswith('.dec'):
            continue
        p = os.path.join(decdir, fn)
        try:
            con = sqlite3.connect(f'file:{p}?mode=ro', uri=True)
            hit = con.execute(
                "select name from sqlite_master where type='table' and name='Locale_Character'").fetchone()
            if hit:
                return con
            con.close()
        except Exception:
            pass
    return None


locale = open_locale()
slug2zh = {}
for k, z in locale.execute('select Key, "zh-CN" from Locale_Character where Key like "%_name"').fetchall():
    if k.endswith('_name') and z:
        slug2zh[k[:-5]] = z
locale.close()

# 图集 slug 与 Locale key 拼写不一致的部队（akademeia/t.t.star），手工对齐
slug2zh.update({'academia': '学术界部队', 'ttstar': 'T.T. STAR'})

icons = {}
for slug in sorted(slugs):
    zh = slug2zh.get(slug)
    if zh:
        icons[zh] = f'/squadicon/{slug}.webp'
# 无专属图标的部队（联动/自创部队）统一回退反常企业图标
icons['_default'] = '/squadicon/abnormal.webp'
with open(os.path.join(ROOT, 'public', 'data', 'squad_icons.json'), 'w', encoding='utf-8') as f:
    json.dump(icons, f, ensure_ascii=False, indent=1)
print(f'squad_icons.json: {len(icons) - 1} 个部队 + _default')
