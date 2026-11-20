# 剧情 ↔ CG 全链路核查报告

- 数据库：`E:\test\nikke-web\data\nikke.db`
- 上游：`E:/test/nikke_extract`
- manifest CG 1654 个 / 实时 Spine 模型 117 个

## 1. 人工映射表 script_cg_map.json
- 当前 `build/` 中引用它的脚本：**['build_db.py']**

## 2. 上游 `剧情CG对照索引` vs `cg_links`
- 上游 (line_key, cg) 对 1054，当前库 1480
- 上游有库里无：**0**；库里有上游无：**426**

## 3. `script_cg_map.json` 条目覆盖
- 人工表 1378 条；当前库对应单元有该 CG 1365 条，**缺失 13 条**
  - `d_main_04_04_e` → `EventScene_Chap_04_05_blood` 期望=['d_main_04'] 实际=[]
  - `d_main_04_04_e` → `EventScene_Chap_04_05_deco` 期望=['d_main_04'] 实际=[]
  - `d_main_04_04_e` → `EventScene_Chap_04_05_flare` 期望=['d_main_04'] 实际=[]
  - `d_main_07_06_e` → `EventScene_Chap_07_02_smoke` 期望=['d_main_07'] 实际=[]
  - `d_main_07_06_e` → `EventScene_Chap_07_02_crack` 期望=['d_main_07'] 实际=[]
  - `d_main_22_12_e` → `EventScene_Chap_22_06_flare` 期望=['d_main_22'] 实际=[]
  - `d_main_22_12_s` → `EventScene_Chap_22_02_aura` 期望=['d_main_22'] 实际=[]
  - `d_main_22_12_s` → `EventScene_Chap_22_02_light` 期望=['d_main_22'] 实际=[]
  - `d_main_24_14_e` → `EventScene_Chap_24_04_smoke` 期望=['d_main_24'] 实际=[]
  - `re_event_ce02_2_06_e` → `EventScene_ce_02_02` 期望=[] 实际=['event_ce002']
  - `re_event_ce02_3_06_s` → `EventScene_ce_02_01` 期望=[] 实际=['event_ce002']
  - `snowfall_episode_noirblanc_08` → `EventScene_snowfalloasis_01_1` 期望=[] 实际=['event_snowfall']
  - `snowfall_episode_noirblanc_08` → `EventScene_snowfalloasis_01_2` 期望=[] 实际=['event_snowfall']

## 4. 资产 / 图片可用性
- 链接涉及的 CG 1128 个：`cg_assets` 无记录 26，manifest 无图 26，webp 缺失 0，webp 陈旧 0
- `cg_assets` 无记录的 CG：`EventScene_GoldenCoinRush_02`、`EventScene_Marian_01`、`EventScene_ce007_01`、`EventScene_icedragonsaga_01_1`、`EventScene_icedragonsaga_01_2`、`EventScene_icedragonsaga_02_1_1`、`EventScene_icedragonsaga_05_1_1`、`EventScene_icedragonsaga_05_1_2`、`EventScene_icedragonsaga_05_1_3`、`EventScene_icedragonsaga_06_1`、`EventScene_icedragonsaga_06_2`、`EventScene_icedragonsaga_09_1_1`、`EventScene_icedragonsaga_09_1_2`、`EventScene_icedragonsaga_09_1_3`、`EventScene_icedragonsaga_09_2_1`、`EventScene_icedragonsaga_10_2_1`、`EventScene_icedragonsaga_11_1`、`EventScene_icedragonsaga_11_2`、`EventScene_icedragonsaga_11_3`、`EventScene_icedragonsaga_11_4`、`EventScene_oldtales_03_1_cinderella`、`EventScene_oldtales_03_1_redshoes`、`EventScene_oldtales_05_abe`、`EventScene_oldtales_05_cinderella`、`EventScene_oldtales_05_hansel`、`EventScene_oldtales_05_redshoes`
- manifest 无图的 CG：`EventScene_GoldenCoinRush_02`、`EventScene_Marian_01`、`EventScene_ce007_01`、`EventScene_icedragonsaga_01_1`、`EventScene_icedragonsaga_01_2`、`EventScene_icedragonsaga_02_1_1`、`EventScene_icedragonsaga_05_1_1`、`EventScene_icedragonsaga_05_1_2`、`EventScene_icedragonsaga_05_1_3`、`EventScene_icedragonsaga_06_1`、`EventScene_icedragonsaga_06_2`、`EventScene_icedragonsaga_09_1_1`、`EventScene_icedragonsaga_09_1_2`、`EventScene_icedragonsaga_09_1_3`、`EventScene_icedragonsaga_09_2_1`、`EventScene_icedragonsaga_10_2_1`、`EventScene_icedragonsaga_11_1`、`EventScene_icedragonsaga_11_2`、`EventScene_icedragonsaga_11_3`、`EventScene_icedragonsaga_11_4`、`EventScene_oldtales_03_1_cinderella`、`EventScene_oldtales_03_1_redshoes`、`EventScene_oldtales_05_abe`、`EventScene_oldtales_05_cinderella`、`EventScene_oldtales_05_hansel`、`EventScene_oldtales_05_redshoes`

## 5. 行级结构
- 撞车 line_key 1713 个；其中把 CG 串到多个单元的 **0** 个
- 单行挂 >2 个 CG 的行：0

## 6. 导出 story/*.json 事件
- 数据库 cg_links 1480 条 → 导出事件 1414 处（按行合并后）
- 事件 hash 不在 manifest：0；CG 名不在 manifest：0；行下标越界：0

## 7. 章节 / 活动归属异常
- CG 名章节号与所在单元章号不符：42（含游戏中合理复用/闪回，需人工甄别）
  - `EventScene_Chap_04_05` → `d_main_03`（第 3 章）
  - `EventScene_Chap_12_01` → `d_main_15`（第 15 章）
  - `EventScene_Chap_13_01` → `d_main_15`（第 15 章）
  - `EventScene_Chap_13_01` → `d_main_49`（第 49 章）
  - `EventScene_Chap_13_04` → `d_main_48`（第 48 章）
  - `EventScene_Chap_26_04` → `d_main_44`（第 44 章）
  - `EventScene_Chap_29_01` → `d_main_44`（第 44 章）
  - `EventScene_Chap_32_07` → `d_main_44`（第 44 章）
  - `EventScene_Chap_33_05` → `d_main_50`（第 50 章）
  - `EventScene_Chap_34_02` → `d_main_50`（第 50 章）
  - `EventScene_Chap_34_07` → `d_main_38`（第 38 章）
  - `EventScene_Chap_34_10_01` → `d_main_44`（第 44 章）
- 活动 CG 出现在主线单元：19
  - `EventScene_Marian_16_2` → `d_main_50`
  - `EventScene_OverZone_02` → `d_main_23`
  - `EventScene_OverZone_02` → `d_main_44`
  - `EventScene_OverZone_02` → `d_main_49`
  - `EventScene_OverZone_09` → `d_main_44`
  - `EventScene_Side_01_02` → `d_main_50`
  - `EventScene_Side_03_02_5` → `d_main_42`
  - `EventScene_Side_04_03` → `d_main_44`
  - `EventScene_arkguardian_09_1` → `d_main_49`
  - `EventScene_arkranger_04` → `d_main_47`
  - `EventScene_arkranger_09_4` → `d_main_50`
  - `EventScene_arkranger_10_1` → `d_main_50`

## 8. 实时 Spine 模型触发
- 阅读器中会播放实时模型的 CG：20 个，共 26 处
  - 4× `EventScene_Main_01_01`
  - 3× `EventScene_ACPUFreeze_01`
  - 2× `EventScene_arkranger_03`
  - 1× `EventScene_icedragonsaga_03`
  - 1× `EventScene_footstepwalkrun_06_2`
  - 1× `EventScene_memoriesteller_01`
  - 1× `EventScene_memoriesteller_02`
  - 1× `EventScene_coinsinrush_02`
  - 1× `EventScene_goddessfall_02`
  - 1× `EventScene_Chap_13_02`
  - 1× `EventScene_chocolateplease_01`
  - 1× `EventScene_twoxtwolove2_hidden_01_2`

## 9. 图集贴图页误入 manifest
- 不带 `.spine` 的图集页 5 个（其中被收进 manifest 5 个）
  - `EventScene_BowWowParadise_01.atlas` → `EventScene_BowWowParadise_01_2.png` 在manifest=True
  - `EventScene_CherryBlossom_01.atlas` → `EventScene_CherryBlossom_01_2.png` 在manifest=True
  - `EventScene_MaidInValentine_01.atlas` → `EventScene_MaidInValentine_01_2.png` 在manifest=True
  - `EventScene_Chap_13_After_01.atlas` → `EventScene_Chap_13_After_01_2.png` 在manifest=True
  - `EventScene_Chap_22_01.atlas` → `EventScene_Chap_22_01_2.png` 在manifest=True

## 10. `04_角色过场` 分类被当作剧情 CG
- 43 个 CG、61 条链接
- 分布：`event_exnii2`×20、`event_exnii1`×15、`event_ce004`×10、`event_ce009`×8、`event_ce007`×4、`event_ce002`×2、`event_ce003`×2
- 说明：这些主要是联动活动（EVA / RE0 / Nier / Persona 等）CG，多数为正常插画，需逐张目视确认是否混有模型切片。

