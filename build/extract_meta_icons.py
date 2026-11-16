"""提取自包含图集的 sprite：attacktypeinfo(准心/武器) + gachacharacter(企业徽章)
输出 public/metaicon/，重命名干净的名字
"""
import io
import os
import sqlite3
import sys

sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, r'E:/test/nikke_extract/scripts')
import export_cg_v2 as v2
import UnityPy
import zstandard as zstd

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public', 'metaicon')
os.makedirs(OUT, exist_ok=True)

cat = sqlite3.connect(r'E:/test/nikke_extract/catalogs/core_catalog.ndb.dec')
table = v2.cidx_map('core')
dec = zstd.ZstdDecompressor()
CDB = v2.ROOT / 'core' / 'chunk' / 'store.cdb'
CSZ = CDB.stat().st_size

# (catalog key 匹配, sprite 名 -> 输出名 映射, 未列出的默认原名)
WANT = {
    '%view-characterattacktypeinfo%': {
        'icn_aim_symbol_inbattle': 'weapon_crosshair',
        'icn_weapon_01_s': 'weapon_icn_01',
        'icn_reload': 'weapon_reload',
        'icn_assault': 'weapon_assault',
        'icn_control': 'weapon_control',
    },
    '%gachacharacter_atlas%': {
        'ele_gacha_corp_deco_elysion_01': 'corp_elysion_a',
        'ele_gacha_corp_deco_elysion_02': 'corp_elysion_b',
        'ele_gacha_corp_deco_missilis_01': 'corp_missilis_a',
        'ele_gacha_corp_deco_missilis_02': 'corp_missilis_b',
        'ele_gacha_corp_deco_tetra_01': 'corp_tetra_a',
        'ele_gacha_corp_deco_tetra_02': 'corp_tetra_b',
        'ele_gacha_corp_deco_pilgrim_01': 'corp_pilgrim_a',
        'ele_gacha_corp_deco_pilgrim_02': 'corp_pilgrim_b',
        'ele_gacha_corp_deco_abnormal_01': 'corp_abnormal_a',
    },
}

for pat, mapping in WANT.items():
    rows = cat.execute(
        'select file_id,key from files_chunktype where key like ?', (pat,)).fetchall()
    if not rows:
        print('! 缺', pat)
        continue
    fid, key = rows[0]
    bundle, _p, missing = v2.rebuild(cat, table, CDB, dec, fid, CSZ)
    assert not missing, key
    env = UnityPy.load(io.BytesIO(bundle))
    for o in env.objects:
        if o.type.name != 'Sprite':
            continue
        sp = o.read()
        base = sp.m_Name
        for want, out in mapping.items():
            if base.startswith(want):
                img = sp.image.convert('RGBA')
                dst = os.path.join(OUT, f'{out}.webp')
                img.save(dst, 'WEBP', quality=95, method=4)
                print(f'{out}.webp  <- {base} {img.size}')
