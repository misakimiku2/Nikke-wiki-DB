"""nikke-db Characters.json 与本站游戏数据 char_meta.json 交叉校验
① attack_type 对 21 个用户锚点
② manufacturer/class/weapon_type 对我们游戏解出的 corp/cls/weapon（顺带钉死枚举方向）
"""
import json
import collections

ref = json.load(open(r'E:/test/nikke-web/build/ref_characters.json', encoding='utf-8'))
meta = json.load(open(r'E:/test/nikke-web/public/data/char_meta.json', encoding='utf-8'))
chars = json.load(open(r'E:/test/nikke-web/public/data/characters.json', encoding='utf-8'))['items']

print('ref 条目:', len(ref), '本站角色:', len(chars))
ref_by_id = {r['id']: r for r in ref}

# 锚点（中文名 → 期望属性）
ANCHORS = {
    '拉毗': 'Fire', '普丽瓦蒂': 'Water', '娜由塔': 'Wind', '灰姑娘': 'Electric', '小红帽': 'Iron',
    '爱丽丝': 'Fire', '神罚': 'Fire', '银华': 'Fire',
    '海伦': 'Water', '桃乐丝': '水冷', '布丽德': 'Water',
    '小美人鱼': 'Wind', '诺亚尔': 'Wind', '布兰儿': 'Wind',
    '娜嘉': 'Electric', '罗珊娜': 'Electric', '马斯特': 'Electric',
    '丽塔': 'Iron', '桑迪': 'Iron', '长发公主': 'Iron', '皇冠': 'Iron',
}
ANCHORS['桃乐丝'] = 'Water'

name2id = {}
for c in chars:
    name2id.setdefault(c['name'], str(c['id']))

print('\n--- ① 属性锚点校验 ---')
bad = 0
for nm, elem in ANCHORS.items():
    cid = name2id.get(nm)
    r = ref_by_id.get('c' + cid.lstrip('0').zfill(3)) or ref_by_id.get('c' + cid)
    got = r['weapon']['attack_type'] if r else None
    ok = '✓' if got == elem else '✗'
    if got != elem:
        bad += 1
    print(f'  {nm}({cid}): ref={got} 期望={elem} {ok}')
print(f'不一致: {bad}')

print('\n--- ② corp/cls/weapon 交叉校验 ---')
CORP_ZH = {1: '极乐净土', 2: '米西利斯', 3: '泰特拉', 4: '朝圣者', 7: '联动'}
REF_CORP = {'ELYSION': 1, 'MISSILIS': 2, 'TETRA': 3, 'PILGRIM': 4, 'ABNORMAL': 7, 'UNKNOWN': 0}
REF_CORP2 = {'MISSILIS': 1, 'ELYSION': 2, 'TETRA': 3, 'PILGRIM': 4, 'ABNORMAL': 7, 'UNKNOWN': 0}
CLS_ZH = {1: 'Attacker', 2: 'Defender', 3: 'Supporter'}
REF_CLS = {'Attacker': 1, 'Defender': 2, 'Supporter': 3}
WEAPON = {'AR': 'ar', 'SG': 'sg', 'RL': 'rl', 'SMG': 'smg', 'SR': 'sr', 'MG': 'mg'}

hits = collections.Counter()
mism_c = mism_w = mism_e = 0
for c in chars:
    cid = str(c['id'])
    m = meta.get(cid)
    r = ref_by_id.get('c' + cid.lstrip('0').zfill(3)) or ref_by_id.get('c' + cid)
    if not m or not r:
        continue
    if m.get('weapon'):
        w = WEAPON.get(r['weapon']['weapon_type'])
        if w and m['weapon'] != w:
            mism_w += 1
            if mism_w <= 8:
                print(f'  weapon 不一致: {c["name"]}({cid}) ours={m["weapon"]} ref={r["weapon"]["weapon_type"]}')
        else:
            hits['weapon✓'] += 1
    if m.get('cls') and r.get('class'):
        e = REF_CLS.get(r['class'])
        if e and m['cls'] != e:
            mism_e += 1
            if mism_e <= 8:
                print(f'  class 不一致: {c["name"]}({cid}) ours={m["cls"]}({CLS_ZH[m["cls"]]}) ref={r["class"]}')
        else:
            hits['cls✓'] += 1
    if m.get('corp') and r.get('manufacturer'):
        for mp, tag in ((REF_CORP, 'A'), (REF_CORP2, 'B')):
            e = mp.get(r['manufacturer'])
            if e and m['corp'] == e:
                hits[f'corp映射{tag}'] += 1

print(f'\nweapon 一致 {hits["weapon✓"]} / 不一致 {mism_w}')
print(f'class  一致 {hits["cls✓"]} / 不一致 {mism_e}')
print(f'corp 方向A(极乐=1) 命中 {hits["corp映射A"]} | 方向B(米西利斯=1) 命中 {hits["corp映射B"]}')
