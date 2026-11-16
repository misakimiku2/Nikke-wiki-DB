"""从 icon-atlased(hd)_assets_all 提取兵种/爆裂/企业图标 → public/metaicon/"""
import io
import sys

sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, r'E:/test/nikke_extract/scripts')
import os
import sqlite3
import export_cg_v2 as v2
import UnityPy
import zstandard as zstd

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public', 'metaicon')
os.makedirs(OUT, exist_ok=True)

WANT = {
    # 兵种（概览卡用）
    'icn_class_attacker': 'cls_attacker',
    'icn_class_defender': 'cls_defender',
    'icn_class_supporter': 'cls_supporter',
    # 爆裂阶段徽章
    'icn_burst_01': 'burst_1',
    'icn_burst_02': 'burst_2',
    'icn_burst_03': 'burst_3',
    'icn_burst_04': 'burst_4',
    # 企业编号图标
    'icn_corp_01': 'corp_icn_1',
    'icn_corp_02': 'corp_icn_2',
    'icn_corp_03': 'corp_icn_3',
    'icn_corp_04': 'corp_icn_4',
    'icn_corp_05': 'corp_icn_5',
    'icn_corp_99': 'corp_icn_99',
    # 武器类型图标（备用，与准心并存）
    'icn_weapon_ar': 'weapon_ar',
    'icn_weapon_smg': 'weapon_smg',
    'icn_weapon_sg': 'weapon_sg',
    'icn_weapon_rl': 'weapon_rl',
    'icn_weapon_sr': 'weapon_sr',
    'icn_weapon_mg': 'weapon_mg',
}

cat = sqlite3.connect(r'E:/test/nikke_extract/catalogs/core_catalog.ndb.dec')
table = v2.cidx_map('core')
dec = zstd.ZstdDecompressor()
CDB = v2.ROOT / 'core' / 'chunk' / 'store.cdb'
CSZ = CDB.stat().st_size


def pull(pat):
    rows = cat.execute(
        'select file_id,key from files_chunktype where key like ?', (pat,)).fetchall()
    fid, key = rows[0]
    bundle, _p, missing = v2.rebuild(cat, table, CDB, dec, fid, CSZ)
    assert not missing, f'{key} missing={missing}'
    return bundle


def pull_exact(key):
    fid = cat.execute('select file_id from files_chunktype where key=?', (key,)).fetchone()[0]
    bundle, _p, missing = v2.rebuild(cat, table, CDB, dec, fid, CSZ)
    assert not missing, f'{key} missing={missing}'
    return bundle


streams = [io.BytesIO(pull('icon-atlased(hd)_assets_all%'))]
# sprite 反向引用 SpriteAtlas 对象（HD 大包里的 sprite 引用的是 SD 版图集定义等混合外部），
# 把整个 icon-spriteatlas 家族一起装进环境让 PPtr 可解析；裸 .spriteatlas 资源文件跳过
atlas_rows = cat.execute(
    "select file_id,key from files_chunktype where key like 'icon-spriteatlas%'").fetchall()
for fid, key in atlas_rows:
    try:
        streams.append(io.BytesIO(pull_exact(key)))
    except Exception as e:
        print(f'跳过 {key[:60]}: {e}')
env = UnityPy.load(*streams)

got = {}
for o in env.objects:
    if o.type.name != 'Sprite':
        continue
    sp = o.read()
    if sp.m_Name in WANT:
        img = sp.image.convert('RGBA')
        img.save(os.path.join(OUT, WANT[sp.m_Name] + '.webp'), 'WEBP', quality=95, method=4)
        got[WANT[sp.m_Name]] = img.size
for k in sorted(got):
    print(f'{k}.webp {got[k]}')
missing_keys = set(WANT.values()) - set(got)
if missing_keys:
    print('! 未找到:', sorted(missing_keys))
