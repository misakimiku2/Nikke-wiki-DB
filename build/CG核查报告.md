# 剧情 ↔ CG 全链路核查报告

- 数据库：`E:\test\nikke-web\data\nikke.db`
- 上游：`E:/test/nikke_extract`（游戏资源目录 `F:\NIKKE`）
- 当前规模：manifest CG **2129** 个 / `cg_assets` **2484** 条 / `cg_links` **1690** 条（覆盖 CG 1250 个）/ 实时 Spine 模型 **119** 个
- 最后更新：2026-11-22（数据重建于 2026-11-21 晚，报告同步刷新）

---

## 0. 当前结论摘要

| 核查项 | 状态 | 说明 |
|---|---|---|
| 上游索引 ↔ `cg_links` | ✅ 已对账 | 上游有库里无 0；多出的 8 条为 bg/前景配对补链 |
| 资产 / 图片可用性 | ✅ 全通过 | 无记录 0、manifest 无图 0、webp 缺失 0、webp 陈旧 0 |
| 行级结构 | ✅ 无异常 | 撞车 key 未把 CG 串到多单元；单行 >2 CG 为 0 |
| 导出事件 | ✅ 无异常 | hash / CG 名不在 manifest、行下标越界均为 0 |
| fx 特效层混入 | ✅ 为 0 | fx_ 是叠加特效，按约定不进 cg_links |
| 实时 Spine 动态 CG | ✅ 已修复 | 检修位 id 漏采后：**72 个 / 116 处**（修复前 20 / 32） |
| 26 张"无导出图" | ✅ 已修复 | 20 个是文件名不一致（别名），6 个是镜头合成键；全部映射到基名图，缺失归零 |
| 章节 / 活动归属 | ⚠️ 需人工甄别 | 44 处跨章、19 处活动 CG 出现在主线，多为游戏内合理复用/闪回，未改动 |
| 图集页 / `04_角色过场` 分类 | ⚠️ 待目视确认 | 5 张图集贴图页进了 manifest；44 个联动活动 CG 被当作剧情 CG |

`verify.py` 最终：**通过 15、失败 0**。

---

## 1. 上下游一致性与产物完整性

### 1.1 上游 `剧情CG对照索引` vs `cg_links`
- 上游 (line_key, cg) 对 **1661**，当前库 **1669**
- 上游有库里无：**0**；库里有上游无：**8**
- 那 8 条均为 `match_type=pair` 的 bg/前景配对补链（脚本只写 `EventScene_X` 或 `X_bg` 之一时，web 端补上另一半），属预期行为。

### 1.2 资产 / 图片可用性
- 链接涉及的 CG **1236** 个：`cg_assets` 无记录 **0**、manifest 无图 **0**、webp 缺失 **0**、webp 陈旧 **0**。

> 修复前这里曾是 26 个（见 §5.2）；2026-11-21 上游新导出 710 张 PNG（其中 249 张进 `cg_assets`），加上别名映射补齐后才归零。

### 1.3 行级结构
- 撞车 line_key **1713** 个；其中把 CG 串到多个单元的 **0** 个
- 单行挂 >2 个 CG 的行：**0**

### 1.4 导出 `story/*.json` 事件
- 数据库 `cg_links` 1669 条 → 导出事件 **22899** 处（按行合并后，含场景背景切换）
- 事件 hash 不在 manifest：**0**；CG 名不在 manifest：**0**；行下标越界：**0**；清空背景标记：15432

### 1.5 fx 特效层混入
- `cg_links` 中 `fx_` 前缀条目：**0**（`fx_EventScene_*` 是叠加演出特效，不是主画面 CG，按上游约定不进链接）
- 阅读器事件中 `fx_` 前缀引用：**0**

---

## 2. 实时 Spine 动态 CG 触发（修复后）

- 阅读器中会播放实时模型的 CG：**72 个 / 116 处**（修复前 20 个 / 32 处）
- 高频项：
  - 6× `EventScene_Chap_04_01`（成员帧解析接入，见 §5.1）
  - 5× `EventScene_Main_01_01`
  - 4× `EventScene_ACPUFreeze_01`、4× `EventScene_BOOMSDAY_01`
  - 3× `EventScene_Chap_14_01_cut`、3× `EventScene_Chap_04_05`
  - 2× `EventScene_wisdomspring_01`、`NewyearNewsword_01`、`arkranger_03`、`OverZone_01`、`DirtyBackyard_01`、`KillTheLord_01` …

根因与修复过程见 §5.1；修复前的分区诊断存档见附录 A。

---

## 3. 章节 / 活动归属异常（需人工甄别，未改动）

- CG 名章节号与所在单元章号不符：**44**（含游戏中合理复用/闪回）
  - `EventScene_Chap_04_05` → `d_main_03`（第 3 章）
  - `EventScene_Chap_12_01` → `d_main_15`（第 15 章）
  - `EventScene_Chap_14_01_cut` → `d_main_21` / `d_main_48`
  - `EventScene_Chap_26_04`、`29_01`、`32_07` → `d_main_44`
  - `EventScene_Chap_33_05`、`34_02` → `d_main_50` …（其余略）
- 活动 CG 出现在主线单元：**19**
  - `EventScene_Marian_16_2`、`Side_01_02`、`arkranger_09_4/10_1` → `d_main_50`
  - `EventScene_OverZone_02` → `d_main_23/44/49`，`OverZone_09` → `d_main_44`
  - `EventScene_arkguardian_09_1` → `d_main_49`，`arkranger_04` → `d_main_47` …（其余略）

这些是台词里真实出现的引用，属游戏中常见的闪回/复用，不是采集错误，保持原样。

---

## 4. 其它已知项（待人工确认）

### 4.1 图集贴图页误入 manifest
不带 `.spine` 的图集页 5 个，均被收进 manifest：
- `EventScene_BowWowParadise_01.atlas` → `..._01_2.png`
- `EventScene_CherryBlossom_01.atlas` → `..._01_2.png`
- `EventScene_MaidInValentine_01.atlas` → `..._01_2.png`
- `EventScene_Chap_13_After_01.atlas` → `..._01_2.png`
- `EventScene_Chap_22_01.atlas` → `..._01_2.png`

它们作为静态插画出现在图鉴里，是否剔除需目视决定。

### 4.2 `04_角色过场` 分类
- 共 **283** 条：角色大招 cut-in **234** 条（实时模型直播 + 定格帧重渲，2026-11 重建；查看器按 `EventScene_<模型>` 映射 spine_skillcut 播放），其余 **49** 条为联动活动插画。
- 带剧情关联的 04 条目：**44 个 CG、62 条链接**，分布：
  `event_exnii2`×20、`event_exnii1`×15、`event_ce004`×10、`event_ce009`×8、`event_ce007`×5、`event_ce002`×2、`event_ce003`×2。
- 这些主要是 EVA / RE0 / Nier / Persona 等联动插画，多数为正常插画，需逐张目视确认是否混有模型切片。

---

## 5. 修复记录（2026-11-21 ~ 22）

### 5.1 演出位 id 漏采（动态 CG 只有背景没有模型）

**根因**：相当一部分动态 CG（章节过场 / 活动过场）在对话记录里只写「演出位 id」（如 `rapi_event`、`modenia_event`），游戏按位 id 从 `ScenarioCharacterSettingTable` 取 `spine/events/EventScene_X` 全屏播放；原采集 `cg_refs.collect_cgs` 只认行内字面 `EventScene_*` token，因此这批 CG 全部漏采——与最初 `EventScene_Chap_04_01`「只有背景没有模型」是同一类问题。

**修复（上游 `nikke_extract`）**：
- `scripts/cg_refs.py` 新增：
  - `load_movie_slots()`：解析 SettingTable → `{位 id: spine 模型名}`，共 82 条，进程内缓存；行结构实测为 `[位id][Locale_Character:*_name][default][spine/events/EventScene_X][服装变体]`。
  - `collect_movie_cgs()`：按 mpk 长度前缀字段解析模型槽位 `[位id][int32 0][槽位种类][动画名]`。槽位种类实测有 `1`/`5`/`event`/`idle`/`snowwhite`，早期只认数字，漏掉了 `marian_event_02 → EventScene_Main_01_02`（`#17 目标` 等）；现已放宽为短 token。仍用槽位结构避开 `noise`/`black`/`dorothy` 等与角色/转场 id 撞名的位 id。
  - `merge_cgs()`：去重保序合并。
  - 补导出：`export_spine_cg.py` 原按 `atlas 基名 + .skel` 找骨架，但 `EventScene_Main_01_02.atlas` 配的骨架叫 `c013_event_01.skel`，整包被跳过，导致 `#17 目标` 只有背景板没有模型；现允许包内唯一 `.skel` 作骨架并统一改名落盘。重跑导出后 Spine 模型 117 → **119**，该单元阅读器已能播 `EventScene_Main_01_02`。
- `export_mainstory.py`、`export_rest.py`、`export_story_v2.py`、`export_skyontherock.py` 的行级 CG 收集统一改为「字面 token + 位 id 引用模型名」，既有 `resolve_dynamic` 自动给出 `cgd`（模型）与 `cgb`（背景板）。
- `EventScene_Chap_04_01` 的成员帧（`04_02`/`04_03`）由 web 端 `build/cg_merges.json` 接入，未受影响。

**重生成**：上游剧情全量 JSON、CG 对照索引；web 侧 `build_db.py` / `export_story.py` / `export_web.py`，并同步 `dist/data`。

**验证**：阅读器实时模型 **20 / 32 → 67 / 92**（+47 个模型接入）；51 个新接入 CG 全部在 manifest 与 spine 清单内，无断链。

### 5.2 「26 张无导出图」复查与别名修复

**复查结论**：26 个名字里 **20 个图在上游存在**，只是文件名与台词 token 不一致；**6 个是镜头合成键**，本来就没有独立插画。

- 20 个别名：
  - 3 个大小写差异：`EventScene_Goldencoinrush_02` / `EventScene_marian_01` / `EventScene_CE007_01`。
  - 17 个 `icedragonsaga_*_N` 差分后缀，真实图为去掉后缀的基名。
  - 上游 `CG索引/剧情CG对照索引.csv` 的「静态图」列已正确记录映射，`build_cg_gallery.py` 据此生成缩略图；但 web 的 manifest / `cg_assets` 只按 PNG 文件名建索引，故漏掉。
- 6 个镜头合成键：`EventScene_oldtales_03_1_cinderella`、`..._03_1_redshoes`、`..._05_abe`、`..._05_cinderella`、`..._05_hansel`、`..._05_redshoes`。
  - 用 `F:\NIKKE` 的 catalog + UnityPy 逐 bundle 核对：`scenariobackground(hd)_assets_eventscene_oldtales_05_*.bundle` 等只含 `Texture2D/Sprite EventScene_oldtales_05`（及 `_03_1`），没有角色名后缀的图；游戏目录、全部 catalog 也搜不到。
  - 它们出现在对话表的 CG 槽位与 `ScenarioCameraSettingTable` 里，是「基名 CG + 角色 id」的镜头/图层合成键——游戏画基名整图、相机对准该角色，不存在独立插画可提取。

**另一个因素**：2026-11-21 上游新导出 710 张 PNG（其中 249 张进 `cg_assets`），但 web 的 DB/manifest 一直没重建；本次一并重跑了 `build_db.py` 与 `build_images.py`。

**修复（web 侧）**：
- 新增 `build/cg_alias.py`：从上游索引「静态图」列生成 20 条别名，另补 6 条镜头合成键 → 基名映射。
- `build_images.py`：为别名补 manifest 条目，共用真实图的 hash 与三档转码产物，仅多一个 name 并标 `alias_of`。
- `build_db.py`：为别名补 `cg_assets` 行。
- 重跑 `build_db.py` / `build_images.py` / `export_story.py` / `export_web.py`，同步 `dist/data` 与 `dist/manifest.json`。

**验证**：资产可用性四项全部为 **0**（26 → 0）；manifest 2103 → **2129** 条；阅读器 CG 切换 29,846 → **29,881** 处，`cgLinked` 1210 → **1230**；抽查 oldtales 合成键与 icedragonsaga 差分在 dist manifest 均有 `alias_of` 与共享 hash，阅读器事件正常出现。

### 5.3 剧情卡封面被重跑冲掉（反复出现）

- 现象：重建数据后剧情全文列表卡片封面重复、裂图（如第 02、08 张）。
- 根因：`export_web.py` 每次都从 `cg_index.json` 重新算 `cover`（第一张静态 CG / 名字模糊匹配 / 借相邻章节），直接覆盖 `story_index.json`。而评分选图与封面文件是 `build_story_covers.py` 生成的，且它必须排在 `export_web.py` 之后（README §4.5）。AI 改动时往往只重跑 `export_web.py`，于是把选好的封面冲成 naive 版本，并留下指向未生成 `public/cover/<hash>.webp` 的 hash（29 处）。
- 另因本次漏跑 `export_cg.py`，`cg_index.json` 停留在 106 个单元有链接的旧状态，评分器对大量单元找不到候选而留空，进一步放大了重复借用。
- 修复：
  - `build/export_web.py`：写 `story_index.json` 前先读回已有 `cover`，只要对应 `public/cover/<hash>.webp` 或 `public/img/{l,m,s}/<hash>.webp` 仍存在就沿用；重跑不再冲掉已选封面。
  - `build/verify.py`：封面文件缺失从「仅警告」改为计入失败（`fail += 1`），下次漏跑会直接报错。
  - 按正确顺序重跑：`export_cg.py` → `build_story_covers.py` → `export_web.py`，并同步 `dist/data` 与 `dist/cover`。
- 验证：封面文件缺失 **29 → 0**，主线前 12 张不再重复（00/01 已不同）；`verify.py` 通过 15、失败 0。剩余少量重复来自确实无 CG 的章节（1/5/18/25 章）借相邻封面，属既有设计。

### 5.4 剧情卡封面编辑后台（dev `/story/covers`）

- 需求：给剧情单元手动指定不同 CG 作为封面，并按 3:4 裁剪；只引用已有 CG 数据，不新增尺寸的 CG 图。
- 实现（沿用 `/cg/albums` 的 dev-only 模式）：
  - `web/vite.config.ts` 新增 `/api/cover-edits` GET/POST，读写 `build/cg_cover_overrides.json`；
    POST 后调用 `build_story_covers.py --only <id> --force` 立即重生成封面并整页刷新。生产构建无此接口。
  - `build/cg_cover_overrides.json` 的值扩展为 `{h, crop:{cx,cy,zoom}}`（兼容原有纯 hash 与现成封面文件名）。
  - `build/build_story_covers.py` 新增 `manual_crop()`：按归一化中心 + 缩放取 3:4 窗口，
    从 `manifest` 已有的原图现裁出 `public/cover/<hash>.webp`；用 `<hash>.crop.json` 参数指纹
    保证改参数即使 mtime 不变也会重生成；人工指定不再被全局去重改判。
  - `web/src/pages/StoryCovers.tsx`：左侧单元列表 + 右侧预览与裁剪面板；候选 CG 默认取
    `cg_index.links` 里该单元实际出现的图，可切「全库搜索」；预览支持拖动平移、
    鼠标滚轮（以光标为锚点）与滑块缩放；保存/清除人工指定，Ctrl/Cmd+S、离开提醒、toast。
  - `App.tsx` dev 路由、`Story.tsx` dev 入口按钮、`index.css` `.sc-*` 主题化样式（浅色/深色都可读）。
  - 修了两个实测 bug：① 别名 CG 与真实图共用 hash 导致 React `key` 重复，从「全库搜索」切回「本剧情」会残留旧节点——现按 hash 去重、key 改用 CG 名；② 浅色模式选中行用了硬编码深色背景导致文字不可读——改用 `--text`/`--surface-2`/`--red` 主题变量。
  - 滚轮缩放：以光标为锚点，1.0～3.0×，与滑块联动。
  - 动态 CG 抓帧：候选里带 ▶ 的是实时 Spine 模型（含 `_bg` 自动配对的模型）；选中后
    复用 `SpinePlayer` 渲染，提供播放/暂停与时间轴拖动（`seek`）。保存时通过新增的
    `captureFrame()` 在 rAF 同帧取 `canvas.toDataURL`，POST 给 `/api/cover-edits`，
    后台用 `build_story_covers.py --frame` 转成 3:4 WEBP 存 `public/cover/frame_*`，
    并把文件名写进 override，再重生成 `story_index.json` 的 cover。原 CG 图不变。
- 待跟进：`EventScene_Main_01_02`（`#17 目标`）虽已补导出模型，但游戏 bundle 里的 atlas
  缺少序列帧 `ac_b2` 等多个附件、与 `c013_event_01.skel` 不匹配，SpinePlayer 加载报错。
  为避免阅读器出现「模型加载失败」，已在 `cg_refs.py` 与 `build/build_spine_models.py`
  把它列入损坏清单：不生成行级 `d` 引用、不进 `spine_models.json`，该单元退回背景板 `_bg`。
  属源数据问题，需从 `SpineAtlasAsset` MonoBehaviour 还原完整图集页；其它动态 CG 抓帧正常。
- 验证：`tsc -b` 通过；浏览器实测选图 → 缩放 → 保存，JSON 落盘、封面与指纹文件生成、
  `story_index.json` 更新；清除人工指定后恢复；`verify.py` 通过 15、失败 0。

---

## 附录 A：修复前的动态 CG 可达性诊断（存档）

> 以下内容是修复前的分析，结论已被 §5.1 的修复取代，保留供溯源。

- 修复前口径：`spine_models.json` 实时模型 117 个；「可达」= 剧情分片 refs 里被名字引用或挂在 `d` 字段。结论为可达 20 / 不可达 97。
- 不可达 97 个的分区（对 staticdata 9835 个表、291 MB 做带边界 token 扫描）：

| 分区 | 数量 | 依据 |
|---|---|---|
| A. ScenarioCharacterSettingTable 有 `spine/events/EventScene_X` 演出位绑定 | 75 | 可解析采集，现已修复 |
| B. 仅 LiveWallpaperTable（`livewallpaper/…` 动态壁纸/主视觉） | 13 | 非剧情播放，不进阅读器 |
| C. staticdata 无任何命中 | 9 | EventTitle×5、minigameCG、ARK_GUARDIAN_01、CE007_01、oldtales_02 |

- 主线 3 个名（Chap_07_02 / 22_02 / 22_06）在 `ScenarioDialogTable` 的命中全部是 `fx_EventScene_X_*` 叠层 token 的子串，不是主画面 `cg` token；上游按 fx 收集。
- A 类播放机制：对话记录通过演出位 id 间接引用（如 `…|Locale_MainScenario:d_main_02af_05_9|rapi_event|1|idle|`），游戏按位 id 取 spine 模型全屏播放。修复前端到端抽查（以实际 SettingTable 解析为准）：
  - `mustang_event` → `EventScene_Chap_04_After_01`
  - `rapi_event` → `EventScene_Chap_02_After_01` → `d_main_02af_04`
  - `rapi_elevator` → `EventScene_Main_01_03` → `d_main_01af_01`
  - `modenia_event` → `EventScene_Chap_07_02` → `d_main_04_04_e`
- B 类 13 个：`EventScene_Aesigthediver_01`、`CE005_02`、`Goldencoinrush_02`、`absolute_01`、`boomtheghost_01`、`ce009_01`、`marian_01`、`oldtales_01`、`projectmatis_02`、`staranis_03`、`terminusticket_01`、`twoxtwolove_01`、`unbreakablesphere_01`。
- C 类 9 个：`EventScene_ARK_GUARDIAN_01`、`CE007_01`、`oldtales_02`、`EventTitle_CE004_01`、`EventTitle_CE005_01`、`EventTitle_NEVERLAND_02`、`EventTitle_ce008_01`、`EventTitle_lastkingdom_03`、`minigameCG`。
- 注：旧版 §11 的若干位 id → 模型举例有误（如把 `rapi_event` 写成 `Chap_04_After_01`），实际映射以 SettingTable 解析结果为准，修复代码不依赖这些举例。
