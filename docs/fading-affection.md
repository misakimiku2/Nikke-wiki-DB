# FADING AFFECTION 小游戏还原文档

> 还原对象：NIKKE 活动 `event_firstaffection`（FIRST AFFECTION）内的分支文字冒险小游戏
> 逆向与集成日期：2026-11-22
> 页面路由：`/game/fadingaffection`
> 上游工程：`E:\test\nikke_extract`，本站工程：`E:\test\nikke-web`

---

## 1. 这是什么

活动剧情（`event_firstaffection_01`~`08`）只是普通剧情；小游戏本体是另一套静态表
`EventTextAdvPlus*.mpk`，是一个带状态槽、多重结局、记忆解锁的分支文字冒险。

三条记录：

| 路线 | 内部 key | 主角 | 开场页 | 解锁条件 |
|---|---|---|---|---|
| 1 | 玛丽亚的记录 | Maria（过去） | 1001 | 默认开放 |
| 2 | 玛丽安的记录 | Marian + 指挥官（现在） | 2001 | 结局 8101「命运共同体」 |
| 3 | 7号的记录 | No.7（未来） | 3001 | 结局 8201「相守的梦」 |

规模：265 个页面、172 个选项、35 个结局、45 条记忆、59 张剧情 CG（含黑白与彩色）、174 张原版 UI 纹理。

结局按页号分类：

| 前缀 | 类型 | 例子 |
|---|---|---|
| 61xx | 路线1 死亡结局 | 6101「疏忽的下场」 |
| 62xx | 路线2 死亡结局 | 6205「饥饿的尽头」 |
| 63xx | 路线3 死亡结局 | — |
| 71xx / 72xx | 侵蚀结局（CorruptionEnd） | 7205「■要走■？」 |
| 81xx / 82xx / 83xx | TRUE END | 8101「命运共同体」 |
| 91xx / 92xx | HIDDEN END | 9101「挣脱枷锁的蝴蝶」 |

---

## 2. 数据来源与逆向

### 2.1 数据表

全部来自本机客户端 `StaticData.pack` → `staticdata/`，文本来自解密后的 `Locale_Event`。

| 表 | 内容 |
|---|---|
| `EventTextAdvPlusManagerTable.mpk` | 全局配置：三条状态各是「数值 a | 数值 b | 名称 key | 图标名」——体力 10/10、粮食 1/1、侵蚀度 100/50（见 2.4） |
| `EventTextAdvPlusRouteTable.mpk` | 3 条路线、名称/描述/开放时间/开场页 |
| `EventTextAdvPlusEventPageTable.mpk` | 265 个页面：正文 key、CG、BGM、下一页、**抵达本页授予的记忆 id** |
| `EventTextAdvPlusSelectOptionTable.mpk` | 172 个选项：文本/hint/SFX/目标页/**解锁条件 / 状态增量** |
| `EventTextAdvPlusFirstSelectTable.mpk` | 开场地点选择（旧市区 / 湖 / 新市区）+ 地点解锁条件 |
| `EventTextAdvPlusLootItemTable.mpk` | 45 条记忆（已储存 / 已删除 / 仅剩一部分），**记录 id = 记忆 id**，与授予页号不同源 |
| `EventTextAdvPlusSpecialIntroTable.mpk` | 特殊开场演出 |

### 2.2 MPK 二进制格式

逆向出的通用布局（详见 `nikke_extract/scripts/export_fadingaffection.py`）：

```
u32 记录数
每条记录:
  u8  flag          (0x08/0x0a/0x0f/0x15/0x1c...)
  i32 id
  i32 unknown       (因表而异：页号 / 路线号)
  i32 表常量 83501   (本活动专有 ParsingTableId)
  随后是紧密排列的字段：
    i32 >= 0        -> 整数
    i32 < 0         -> 字符串 tag，紧跟 u32 长度 + UTF-8
```

关键字符串 tag：

| tag | 含义 |
|---|---|
| -34 | 页面正文 key |
| -32 / -41 / -46 / -42 / -40 | 页面 CG（普通 / DeathEnd / CorruptionEnd / HiddenEnd / TrueEnd） |
| -26/-25/-24… | BGM |
| -37 | 选项文本 key |
| -42 | 选项提示 key |
| -21…-13 | SFX |
| -41/-48/-45/-20 | 路线名 / 描述 / 介绍 / 开放时间 |

跳转页号以左移 1~2 字节存放（如 `0x17d50000 = 6101 << 16`），必须逐字节扫描 i32 才能还原。

### 2.3 解锁条件（全部有数据依据，2026-11-23 重新逆向）

条件不是从 hint 文案猜的，而是表里的定长字段：

- **选项**：`-37` 选项文本 key 字符串之后（4 字节对齐）依次是
  `i32 condType` / `i32 condValue`。172 条选项里 **38 条带条件**，其中只有 25 条带 hint
  —— 只按 hint 处理会漏掉 13 条（含第一页的「寻找藏身之处」）。
- **页面**：`-34` 正文 key 之后第 9 字节是 `u8 kind`（0 普通页 / 1 授予记忆的节点 / 2 结局页），
  其后 `i32` 是**本页授予的记忆 id**（0 = 不授予）。46 次授予正好覆盖 45 条记忆
  （6203 与 6205 都授予 1203）。
- **地点**：FirstSelect 记录末尾同样是记忆 id / 结局页号。

| condType | 含义 | condValue |
|---|---|---|
| 0 | 无条件 | — |
| 1 | 需要某条记忆 | LootItemTable 记录 id（**不是页号**） |
| 2 | 状态门槛（粮食） | 门槛值，仅 111801「把食物分给猫」= 1 |
| 3 | 需要先抵达某结局 | 结局页号（7201/7202/7203/8201/9101） |

地点选择实测：

| 地点 | 条件 |
|---|---|
| 旧市区（三条路线） | 无 |
| 湖（路线1） | 记忆 1-14「小径」(id 1114)，由页面 **1142** 授予 |
| 湖（路线2） | 记忆 2-14「一起走的路」(id 1214)，由页面 **2122** 授予 |
| 新市区（路线2） | 结局 7205「■要走■？」 |

> 记忆 id ≠ 授予页号：例如 1-14「小径」的 id 是 1114，但授予页是 1142；
> 1-1「已删除的记忆：储备库」id 1117，由死亡结局 6108「小心夜路」授予。
> 判定一律用记忆 id：同一 `路线-序号` 在「已储存 / 已删除」两类里会撞（1-1 有两条）。

未满足条件的选项显示 `???` + 锁条（**与有没有 hint 无关**），满足后才显示正文与 HINT。

### 2.4 状态增量位于选项的可选字段（2026-11-25 修正）

体力 / 粮食 / 侵蚀度**都有 per-option 增减量**。此前漏读的原因是把记录按 4 字节对齐扫描，
而状态字段跟在可变长度的 hint 字符串后面，实际位置不固定。

选项 key 字符串之后顺序为：

```text
i32 condType
i32 condValue
u8 hasHint
[ -42 tag + u32 length + hint UTF-8 ]   # hasHint=1 时存在
i32 reserved                           # hasHint=0 时占位
u8 flag
i32 hpDelta
i32 foodDelta
i32 erosionDelta
... dest / sfx / 其他字段
```

无 hint 时三个增量从 key 结尾后第 14 字节开始；有 hint 时从 hint 结尾后第 1 字节开始。
导出器已按这个结构输出 `choices[].statusChange = { hp, food, erosion }`。

Manager 表 83501 的真实数值：

| 状态 | a | b | 名称（Locale_Event） | 图标 |
|---|---|---|---|---|
| 体力 | 10 | 10 | 体力 | `icn_fadingaffection_status_hp` |
| 粮食 | 1 | 1 | 粮食 | `icn_fadingaffection_status_food` |
| 侵蚀度 | 100 | 50 | 侵蚀度 | `icn_fadingaffection_status_erosion` |

可验证样本：

| 选项 | 文本 | hp | food | erosion |
|---|---|---:|---:|---:|
| 111801 | 将自己的食物分给猫。 | 0 | -1 | 0 |
| 114901 | 再跑得更快一点看看。 | -1 | 0 | 0 |
| 211901 | 扣动扳机。 | 0 | 0 | +10 |
| 223401 | 收下肉干。 | 0 | -1 | +10 |
| 312201 | 睁开双眼。 | +3 | -1 | 0 |

- 粮食上限 1，只有 111801 / 223401 / 312201 三个选项扣 1；condType 2 是选择前的粮食门槛。
- 侵蚀增量只出现在路线 2，分布为 +1（49 条）、+2（4 条）、+10（5 条）、+30/40/50/60/90，
  另有 12 条路线 2 选项不增加侵蚀（共 80 条，68 条增加）；路线 1/3 全部为 0。
- 状态值按 Manager 上限钳制。当前所有可达路径中，体力归零的下一点都已是显式死亡结局，
  因此不需要前端额外猜 forced ending；结局仍由 `dest` / `page.next` 决定。
- `erosion.second=50` 仍按触发刻度线展示；静态表无法单独证明它是阈值还是初值。

### 2.5 页面 BGM 的 tag 不止 -26/-25（2026-11-24 修正）

接音频时发现导出 JSON 只有 9 个 distinct BGM，而页面表里出现了 20 个 `event_bgm_maria-n_*`。
逐条对齐后确认：**每条页面记录只有一条 BGM 字段，但它挂的负 tag 从 -21 到 -34 都出现过**
（分布：-26 63 次、-31 18、-25 13、-24 7、-21 5、-22/-29 各 3、-27 3、-23 2、-28 1、-34 2）。
原先 `parse_pages` 只查 `-26/-25`，120 条带 BGM 的页面只收到 76 条，另外 44 页在网页上等于没配乐。

改法：先按常用 tag 找，找不到就退回「扫全部字符串字段、按值前缀 `event_bgm_` 判定」。
重跑后 `带 bgm 的页面 = 120 / 265`、`distinct = 20`。选项表的 SFX 不受影响（16 个全对得上）。

另外 `event_bgm_maria-n_daughter` / `plzstayalive` 这两个 key 在包里**没有同名音轨**：
正式内容是 96s / 74s 的 `_loop`，另有一个 0.7s / 1.2s 的 `_intro` 碎片单独打包。
导出器因此改成「把全部候选 bundle 摊开，按 同名 > `_loop` > 其它派生 > `_intro` 择优，
同级取更长」，而不是一命中就返回。

---

## 3. UI 素材

素材来自两个资源池的 bundle，由 `nikke_extract/scripts/export_fading_ui.py` 导出到
`public/fading_ui/`，目前 **244 张 PNG（约 34 MB）**：

| 资源池 | bundle | 内容 |
|---|---|---|
| core | 14098–14112 | `eventui-marian_assets_adventure_*`：主界面、路线选择、首选项、剧情、结局、回想、开场、弹窗等全部 UI |
| core | 14117 | 血迹/走马灯特效 |
| core | 14120–14126 | 结局类型图标（death/erosion/hidden/true）与状态图标（hp/food/erosion） |
| core | 26802–26813 | `view-fadingaffection*` 视图壳及其 atlas |
| dp | 5050 | `icons-event-89_marian(hd)`：教程插画 `ele_fadingaffection_tutorial_*` 与 `icn_fadingaffection_*` |

审计结果：上述 bundle 共含 247 张纹理，已导出 244 张；缺失的 3 张是 `2x2love` 活动的
通用资源与字体图集，小游戏不会用到。

> **重要**：这些 UI 纹理**不进入 CG 池**。它们只放在 `public/fading_ui/`，
> 与 `cg_index.json` / `manifest.json` / `CG/` 完全没有交集。CG 池里只有小游戏的
> 59 张剧情 CG（`EventScene_FadingAffection_*`，含黑白与彩色，由 `export_cg_v2.py` 走正常 CG 流程导出）。

| 素材 | 用途 |
|---|---|
| `marian_ptn_wood_01/02` | 桌面木纹（浅/深） |
| `marian_texture_paper` | 纸张褶皱纹理 |
| `marian_bg_tilte` | 标题条笔刷 |
| `marian_deco_01` | 左上角 ID 徽章 |
| `marian_deco_book` | 金属夹子 |
| `marian_deco_02/03/04/05` | 藤蔓装饰 |
| `marian_bg_choice_maria` | 普通选项条（蓝灰笔刷） |
| `marian_bg_choice` | Checked 选项条（白色） |
| `marian_bg_choice_hidden` | ??? 选项条（破损） |
| `marian_mask_scene` | CG 画框遮罩 |
| `marian_bg_state` / `marian_deco_state_01` | 底部状态栏 |
| `btn_marian_memory` | 内存卡 |
| `marian_txt_script` / `marian_txt_check` / `marian_icn_hint` | Script / Checked / HINT 印章 |
| `marian_txt_accessdenied` | ACCESS DENIED 印章 |
| `marian_routeselect_01/02/03` | 路线选择拍立得插画 |
| `marian_intro_title` | FADING Affection 标题 Logo |
| `marian_main_back_bg_01` | 主菜单 SILVERGUN PROJECT 档案纸 |

> 注意：`marian_bg_paper` 是干净纸张（用于卡片底），`marian_bg_texture` 是噪波叠加层，
> 不可平铺当木纹背景。

---

## 4. 数据链路与重建

```
本机 StaticData.pack / com.shiftup.patch
   │
   ├─ scripts/export_fadingaffection.py ──> public/data/fadingaffection.json
   │      （路线/页面/选项/结局/记忆/状态/背景 + 全部解锁条件）
   │
   └─ scripts/export_fading_ui.py ────────> public/fading_ui/*.png
          （从 core 资源池 bundles 14098-14112 提取原版 UI 纹理）

web/src/fadingData.ts      类型与数据加载
web/src/pages/FadingAffection.tsx   游戏逻辑与界面
web/src/pages/fading.css    （配合真实纹理的 CSS 还原）
web/src/App.tsx            /game/fadingaffection 路由 + 导航入口
```

重建命令（在上游工程根目录）：

```bash
python scripts/export_fadingaffection.py
python scripts/export_fading_ui.py            # --force 可覆盖
```

---

## 5. 游戏机制

- **状态**：体力 10 / 粮食 1 / 侵蚀度 0（上限 10 / 1 / 100）来自 Manager 表；
  每次选择按 `choices[].statusChange` 应用 hp / food / erosion 增量并钳制上限。
  选项显示真实增减标签，返回上一节点会恢复该节点状态。condType 2 使用当前粮食值判定。
- **侵蚀度按路线启用**：只有路线 2 存在「选项 → 侵蚀结局 7xxx」的跳转
  （路线 1 的 7101 由页面 1209 自动推进触发）。导出器据此给出 `routes[].erosion`，
  UI 在路线 1/3 把侵蚀条渲染为「未启用」的锁定条；路线 2 的长条上按表值画一根
  50/100 的触发刻度线。
- **结局到达**：死亡/侵蚀结局一律由数据显式指向，不做数值判定——
  6106「体力的极限」← 选项 114901、6111「生命的殒落」← 选项 113901、
  6205「饥饿的尽头」← 选项 223301、6207「心满意足的牺牲」← 页面 2246 的 next、
  6301「丧失的记忆」← 页面 3102 的 next、6101「疏忽的下场」← 页面 1103 的 next。
- **推进**：没有选项的页面（128 个）用 `page.next` 推进，即原版「点击画面继续」；
  有选项时以选项为准。`next` 可能直接指向结局（如 1103 → 6101）。
- **记忆**：只由「授予页」解锁（`memoryByPage`，来自页面表定长字段）；授予页既可能是普通页
  （1142 授予「小径」），也可能是死亡结局页（6108 授予「储备库」）。存档在 localStorage。
- **进度**：结局、记忆、访问页、已选选项分别存于 `nikke_fading_endings_v1` /
  `nikke_fading_seen_v1` / `nikke_fading_checked_v1`。首页与菜单提供「清除存档」。
- **Checked +1%**：选过的选项显示 Checked 印章与 +1%（还原原作达成率反馈）。

---

## 6. 已知近似与后续工作

| 项目 | 现状 |
|---|---|
| 选项状态变化 | **已修复**：增量位于可选 hint 之后的非对齐字段，导出为 `statusChange`（见 2.4）。早先按关键词推导的 `cost` 已废弃。 |
| 侵蚀 b 值语义 | Manager 给的 100/50 只能确定量尺与第二个数值；教程说「达到一定程度」，故按触发阈值渲染成刻度线，也可能是初值 50，表内无法区分。 |
| 侵蚀是否启用 | 由「该路线是否存在指向侵蚀结局 7xxx 的选项」推导（`routes[].erosion`），Manager 表没有显式开关字段。页面归属路线改用页面表 `st+9` 字段（11/12/13），不再按 id 前缀猜。 |
| 解锁条件 | 已改为读选项/页面表的定长字段（见 2.3）。**早期版本只在带 hint 的选项上判定条件**，导致路线 1 第一页的「寻找藏身之处」被误认为可直接点。 |
| 路线锁定的 TrueEnd | 依据「需看完前记录结局」的设定与 locale 文案，选用 8101/8201；静态表未发现明确字段。 |
| 背景图 | 小游戏无专用背景表。**2026-11-24 起不再沿用上一幕 CG**：只有页面表自带 `cg` 的页面才出图（265 页里 202 页无配图，直接留空；35 个结局页全部自带 CG，不受影响）。剧情 CG、回想缩略图与详情图均不应用 `grayscale`，保留原图饱和度。 |
| BGM / SFX | **已接入播放**（2026-11-24，见 11.10）：共 60 条音频（bgm 20 / sfx 17 / ui 15 / typing 1 / write 1 / ambient 6），导出器 `build/export_fading_audio.py`。表内只有 `page.bgm` 与 `choice.sfx` 两类；UI 音 `uis_mini_fad_*`、打字音、环境音 `ambient_fad_*` 都不在任何静态表里（由 prefab / 客户端代码驱动），key 列表与「地点→环境音」的对应是**按命名推断**写死在导出器与前端常量里的，不是表字段证据。载荷是 FMOD FSB5，UnityPy 直接解出 WAV 后 ffmpeg 转 ogg。
| UI 布局 | 游戏页仍是 CSS 按截图比例还原；新增了 dev-only 可视化编辑器用于精确拼图，产出的坐标/尺寸/九宫格参数可导出 JSON/CSS 供替换（见第 9 节）。 |
| 九宫格 / 平铺 | 原版 Sprite 的 border 已导出（见第 9 节）；编辑器已支持 sliced（.9 图）/ tiled，但游戏页 CSS 尚未整体切换过去。 |

---

## 7. 验证记录

- UI 完整性审计：小游戏 bundle 共 247 张纹理，已导出 244 张；与 CG 池零重叠。
- `npm run build` 通过，产物含 `dist/data/fadingaffection.json` 与 `dist/fading_ui/`。
- 59 张 CG 的哈希在 `cg_index.json` 中全部命中 `public/img/l/<hash>.webp`。
- **2026-11-23（清档实测，条件字段改版后）**：
  - 路线 1 首页 1101：选项 ii「寻找藏身之处」显示 `???` + 「需要【已删除的记忆：储备库】」，禁用；
    把授予页 6108 写入存档后同一选项变为可点。
  - 路线 1 全程选项侵蚀增量为 0，状态栏侵蚀条为「未启用」；路线 2 侵蚀条从 0% 开始，68/80 个选项带侵蚀增量。
  - 路线 1 开场地图：湖锁定「需要【已储存的记忆：小径】」；路线 2 的新市区锁定「观看【■要走■？】结局后解锁」。
  - 无选项页面出现「点击画面继续」，1101 → 1102 → 1103 → 继续 → 结局 6101，
    结局页正确显示「解锁记忆：已储存的记忆：袭击」。
  - 导出器自检：`gated options=38 (with hint 25)`、`gated locations=3`、`erosion routes=[2]`、
    `granted pages=45`，无未解析条件（`broken` 为空）。
- **2026-11-24（当时去掉虚构消耗，清档实测；状态规则已于 11-25 修正）**：
  - 导出器新增 `manager status: 体力 10,10 / 粮食 1,1 / 侵蚀度 100,50`（名称与图标直接取表）。
  - 当时误判「表里没有增减」，因此移除了消耗标签；11-25 已确认增量在非对齐可选字段，
    并恢复真实标签与状态写入（见 2.4）。
  - 路线 1 清档走到底：1101「继续前进。」→ 1102「无视。」→ 1103 →「点击画面继续」→
    结局 6101「疏忽的下场」，存档 `[6101]`，解锁「已储存的记忆：袭击」。
  - 回到 1101 后，选过的 110101 显示 `Checked`（存档 `nikke_fading_checked_v1=[110101,110201]`）。
  - 路线 2（写入结局 8101 解锁）：侵蚀条为启用态，0% 进度 + 一根 `left:50%` 的刻度线，
    悬停提示「达到 50 进入侵蚀状态」。
  - 页面 `st+9` 路线标记统计 81 / 133 / 51 = 265，结局页同样带标记
    （7205→2、6301→3、8101→1，与路线 2 需看完 8101 的设定互相印证）。
  - CG 只在页面自带时显示（不再沿用上一幕）：路线 1 实测 1101 有图
    （`EventScene_FadingAffection_1_01`）、1102 / 1103 无图；开场地图页无图；
    全表 202/265 页 `cg` 为空，35 个结局页全部有 `cg` 且都能在 `cgHashes` 命中。
  - `npm run build:quick` 通过。

## 8. 提交历史

| 仓库 | commit | 内容 |
|---|---|---|
| nikke_extract | `bf9bbf7` | 初版逆向脚本与文档 |
| nikke_extract | `e154bf2` | 精确地点/路线解锁条件 |
| nikke_extract | `46390f9` | HINT 选项独立触发条件 |
| nikke-web | `0f14f5d` | 初版页面接入 |
| nikke-web | `acd5ea5` | 按真实条件解锁地点与路线 |
| nikke-web | `2e8f9b5` | 精确 HINT 条件 + 清档按钮 |

---

## 9. UI 拼图编辑器（dev-only）

靠截图和文字描述反复猜坐标效率太低，因此加了一个网页端可视化编辑器，用真实素材把画面「拼」出来。

- 入口：`/game/fadingaffection/editor`（仅 `import.meta.env.DEV`，生产构建会被摇掉；游戏页顶部也有 dev 入口）
- 完整操作说明：`docs/fading-ui-editor.md`
- 原版九宫格机制调查：`docs/fading-ui-sprite-metadata.md`

### 能力

| 能力 | 说明 |
|---|---|
| 素材库 | 自动列出 `public/fading_ui/` 全部 244 张 PNG（按文件名前缀分组、搜索、悬停看原始尺寸与填充方式）。 |
| 图层 | 图片 / 文字 / 色块；x/y/宽高/旋转/透明度/圆角/混合模式；拖入素材按元数据自动选填充方式。 |
| 图层关系 | Ctrl 多选、编组/解组、拖动排序、拖进/拖出组；单选组时画布出现整组包围盒，可整组缩放/旋转。 |
| 九宫格 | 原版 Sprite border 来自 bundle（如 `marian_bg_paper` 20/20/20/20）。顶部「自由 / .9 图」切换；.9 图模式下拖橙色切线直接改 border；「边宽倍率」可把源图像素级粗边收细（含按图层尺寸自适应）；Shift 等比缩放。 |
| 视图 | 空格/中键平移、Ctrl+滚轮以鼠标为中心缩放、网格吸附 + 智能吸附（贴齐其它图层边/中心并显示参考线）、6 向对齐。 |
| 编辑效率 | 双击文字就地编辑；撤销/重做 120 步；骨架模板一键载入 28 层预摆脚手架；本地存档 + 项目落盘。 |
| 导出 | JSON（完整布局）+ CSS（`border-image` / `background-repeat` 等），供后续精确改 `fading.css`。 |

### 数据链路

```
nikke_extract/scripts/export_fading_ui.py
   ├─ Texture2D ──> public/fading_ui/*.png
   └─ Sprite ─────> build/fading_ui_sprites.json（border/rect/pivot）
                         │
web/vite.config.ts  ──> public/data/fading_ui_manifest.json（合并 border + 平铺标记）
                         │
web/src/pages/FadingUiEditor.tsx  ──> 导出 JSON / CSS
                         │
                    build/fading_ui_layout.json（「存到项目」，可入库）
```

> 注意：带 border 的素材一律按 .9 图处理，不能整张按网格平铺；只有零 border 的无缝纹理（木纹、纸纹噪波、分隔笔刷）才用 tiled。

---

## 10. 原版 UI 布局逆向（替代肉眼拼图）

编辑器的坐标终究是猜的。实际上 prefab bundle 里完整保存了每个 UI 节点的
`RectTransform`（锚点 / pivot / sizeDelta / anchoredPosition / scale）与 `Image`
（Sprite 引用 / Image.Type / m_Color），可以直接导出、按原版坐标还原。

### 10.1 数据链路

```
nikke_extract/scripts/export_fading_ui_layout.py
   └─ 读取 core bundle 14105–14112 的 RectTransform / Image / Sprite
        └─ build/fading_ui_layout/<screen>.json       （紧凑版，剔除 inactive 变体）
           build/fading_ui_layout/<screen>.full.json  （完整树，含各按钮 normal/checked/hint 状态）
                │
web/vite.config.ts fadingPrefabsPlugin ──> public/data/fading_prefabs/<screen>.json
                │
web/src/fadingPrefab.ts   类型 / 加载 / Unity 坐标 → CSS 换算
web/src/pages/FadingPrefab.tsx  递归渲染器（动态文本、选项按原坐标摆放）
```

重建：`python scripts/export_fading_ui_layout.py`（上游工程根目录）。

### 10.2 关键还原规则

| Unity | web |
|---|---|
| 锚点（stretch 时用锚点矩形**中心**） | `calc(百分比 + px)` 定位，外层固定设计画布 1080×1920 后整体等比缩放 |
| `Image.Type` Simple | `background-size: 100% 100%` |
| `Image.Type` Sliced | `border-image`，border 顺序 Unity `[L,B,R,T]` → CSS `[T,R,B,L]` |
| `Image.Type` Tiled | `background-repeat: repeat` |
| `Image.m_Color`（正片叠底染色） | CSS `mask-image` + `background-color`（渐变叠层会把透明区染成实心块，不能用） |
| 父节点 `scale` | 递归 Frame 变换，子节点坐标按累计缩放展开 |
| 运行时克隆的 `item_page` 选项模板 | 单独导出骨架，web 按 `btn_scenario_select_01..05` 原坐标放动态选项 |

### 10.3 当前状态

- **剧情页（14111）已接入**：`FadingAffection.tsx` 游戏画面默认走 prefab 还原；
  顶部可切「横屏 / 竖屏 / 旧版 UI」。横屏把同一套锚点放进 1920×1080 重新推导，
  无需横屏 prefab 也能自适应。
- prefab 里 `scenario_marian` / `scenario_commander` 两套纸张变体都在，按路线切换
  （路线 2 用 commander 版）。
- `board_hp_alert_vignette` / `board_shadow` / `board_transition` 是运行时才显示的
  整屏特效层，渲染器默认隐藏，否则会盖住正文。
- 其它界面（路线选择 14110、主菜单 14105、结局 14100、回想 14108）已具备导出能力，
  运行 `export_fading_ui_layout.py` 全量导出后即可按同样方式接入，尚未逐屏替换 CSS。
- **2026-11-23 更新**：游戏页现已改由第 11 节的「F 冷寂」UI 接管（纯 CSS，不再走 prefab 渲染）；
  `FadingPrefab.tsx` 保留为独立预览组件，目前未挂路由。

---

## 11. 前端 UI 重制（F · 冷寂）

> 2026-11-23。目标：**除 CG 外不使用任何游戏 UI 位图**，全部用 CSS + 内联 SVG 重绘；
> 并提供浅色 / 深色两套主题，跟随站点 `data-theme` 切换。

### 11.1 文件分工

| 文件 | 职责 |
|---|---|
| `web/src/pages/FadingCold.tsx` | 纯展示组件，`view: home / game / endings / memories`，不含任何存档与解锁判断 |
| `web/src/pages/fading-cold.css` | 全部样式；配色走 CSS 变量 `--fbg / --fpanel / --fink / --fline / --fmut / --fsteel / --fred / --ffig` |
| `web/src/pages/FadingAffection.tsx` | 只保留逻辑：存档、路线解锁、解锁条件判定、HINT、历史栈；渲染交给 `FadingCold` |
| `web/src/theme.ts` | `getInitialTheme` / `applyTheme`，`localStorage` 键 `nikke-theme`，支持 `?theme=light|dark` |
| `ui-concepts.html` | 五套概念稿（A 冷档案 / B 静默终端 / D 银幕 / E 瑞士红 / F 冷寂）单文件存档 |

主题变量挂在 `<html data-theme>` 上，`#cf` 内部再按 `[data-theme="light"] #cf` 覆盖一套，
所以同一个组件在两种主题下都只认语义变量，不需要写两遍颜色。

### 11.2 布局：一套「游戏画布」

四个视图共用 `.cf-fill` 标记：

```css
.fad-cold-root:has(.cf-fill){height:calc(100vh - 64px);overflow:hidden}
```

外层撑满视口 → `.cf-frame` → `.cf-inner` 逐层 `flex:1;min-height:0`，内部再分「固定页眉 + 滚动正文」。

| 视图 | 固定页眉 | 滚动区 |
|---|---|---|
| 主菜单 | 项目条 + `FADING AFFECTION` + 副题 | 导语 + 按钮组 + 三条记录 |
| 回想 | ← 返回路线选择、标题 + `x/35 ENDINGS` | 结局卡网格 |
| 记忆 | ← 返回、标题 + `x/40 MEMORIES` | 记忆条目网格 |
| 剧情 | 章节栏 + 章节标题 | 正文 / CG / 选项；体力栏固定在页脚 |

主菜单内部再分三段（对应设计稿的"切点"）：

```
.cf-home-head   项目条 + 大标题 + 副题            flex:none
.cf-home-art    主视觉 CG 预留槽（当前为空）        flex:1 1 auto
.cf-home-block  导语 + 按钮 + 三条记录，贴底        flex:none，1px 上边框即切点线
```

`.cf-home-art` 已写好 `img{max-width:100%;max-height:100%;object-fit:contain}`，
选定 CG 后直接往这个节点里塞 `<img>` 即可，横图竖图都不会溢出。

卡片高度 `height:min(240px,24vh)`，矮视口（`max-height:899px`）收到 `min(232px,24vh)`。
实测：

| 视口 | 面板高 | 卡片高 | CG 槽高 |
|---|---|---|---|
| 1280×900 | 814 | 216 | 165 |
| 1280×1280 | 1194 | 240 | 521 |
| 1280×760 | 674 | 182 | 59 |
| 430×860（单列） | — | 174×3，正文可滚 720 | 0 |

### 11.3 图形系统

- **内联 SVG 图标**：`ICO` 表 + `<I n="…" />` 组件，共 15 个（`hp / food / erosion / mem / lock / arrow / star / play / refresh / book / close / eye / mappin / back / home`）。
- **原版 PNG 只用 4 处**：NEW 角标、锁、箭头、CG `PLATE FINAL` 六边形水印。原图不透明像素只有 9~17%，
  直接当图片用太淡，因此统一走 `.icn-png{background-color:currentColor;mask-image:…}` 染色。
- **地图**：`public/fading_icons/map_mono.png` / `map_color.png`（取自原版 `map_fadingaffection_*`），
  三个标记：旧市区 (19%,62%)、湖 (41%,39%)、新市区 (74%,30%)；标记为 45° 菱形 + 白色 `mappin` SVG，
  浅色主题默认 `#11171B`、悬停 `#7EA6CC`，不放大。
- **状态栏三行**：体力 + 粮食 / 侵蚀长条（`padding-right:150px` 让出内存按钮）/ 内存（右下角两行）。
  侵蚀条按 `routes[].erosion` 分两种：启用时是百分比进度条，未启用时是斜纹空槽 + `🔒 未启用`。

### 11.4 已知取舍

- 视口很高时 CG 槽会留出大片空白（1280 高约 520px），这是**故意**留给主视觉的位置，等图。
- 760 高的笔记本上槽只剩 59px——优先保证标题、按钮、三张卡片都在首屏，不产生滚动。
- 若还要更多空白，只能把记录卡改成「序号 + 标题并排」的紧凑型，可再挤出 60~80px，暂未采用。

### 11.5 构建

| 命令 | 用途 | 耗时 |
|---|---|---|
| `npm run dev` | 日常调试，不复制素材（`public/` 直接当静态目录读） | 秒级 |
| `npm run build:quick` | 只验代码：`tsc -b` + `VITE_NO_PUBLIC=1 vite build` | 12~26s |
| `npm run build` | 发布：复制 2.1G 素材 + 预渲染 2933 页 | 视磁盘而定 |

`build_quick.mjs` 存在的意义：`publicDir` 指向上级 `public/`，全量构建每次都把整份素材重写到 `dist`，
日常验证完全没必要，也不利于 SSD 寿命。

### 11.6 交付包

`handoff/fading-affection/`（86 MB：166 节点 `layout-flat.md`、244 张 UI PNG、12 张 CG、概念稿截图）
是给外部 AI 的参考资料，**不入库**，仅本地保留。

### 11.7 换幕动画（2026-11-24）

原作不是「点了立刻跳下一幕」，而是淡入淡出换幕 → CG 像翻页一样摆入 → 正文逐字 →
文字全部出完后选项再自上而下依次淡入。现在按这个节奏做了四层：

| 阶段 | 时长 | 实现 |
|---|---|---|
| 这一幕淡出 | 200ms（`LEAVE_MS`） | `FadingAffection.transition(fn, kind)` 置 `fade-page` / `fade-view`，只淡真正变化的那块（见 11.8） |
| 新幕淡入 | 340ms | `.cf-scroll` 带 `key={sceneKey}`，换页即重挂载 → `cf-scene-in` |
| CG 翻页摆入 | 600ms，延迟 140ms | `cf-page-turn`：`transform-origin:left center` + `perspective(1400px) rotateY(-58deg→0)` |
| 正文逐字 | 24ms/字（约 42 字/秒） | `useTypewriter()`，未完成时 `.cf-script.typing::after` 光标闪烁 |
| 选项自上而下 | 320ms，每项延迟 `--i × 80ms` | 打字期间 `.cf-opts.pending{opacity:0;pointer-events:none}`，出完换成 `.ready` |

要点：

- **计时一律用 `requestAnimationFrame` + 已耗时间推算，不用 `setTimeout`/`setInterval`。**
  嵌入式/后台窗口里 Chrome 会把定时器节流到秒级，实测淡出会卡住好几秒、打字会一帧一字；
  rAF 方案在节流时只是不推进，回到前台立刻补到正确位置，不会停在暗场。
- **打字未完成时选项不可点**（`pointer-events:none`），点正文任意处可把剩余文字立刻补完。
- 动画全部用 `animation-fill-mode: backwards`，结束后不占用 `transform`，
  否则选项 hover 的 `translateX(4px)` 会被 fill-forwards 的动画终值盖掉。
- `prefers-reduced-motion: reduce` 时打字直接给全文、四层动画全部关闭。
- 幕次计数 `scene` 每次真正换页才 +1，因此回退（`goBack`）与重复进入同一页也会重新播放。

### 11.8 换幕补全与竖屏细节（2026-11-24 追加）

- **界面之间也要换幕，但只淡真正变化的那块**：`transition(fn, kind)` 的 `kind` 决定淡出范围，
  交给根节点上的 `fade-page` / `fade-view` 类。
  - 换页（选项、点击继续、回退）→ `fade-page`，只有 `.cf-scroll`（正文 / CG / 选项）淡出，
    外框 `.cf-frame`、章节栏 `.cf-bar`、标题 `.cf-head`、状态栏 `.sb` 全程 opacity=1。
  - 换视图（开始记录、内存、回想、返回）→ `fade-view`，淡的是 `.cf-inner`，外框仍然不动。
  - 实测：换页 t90 `frame=1 head=1 bar=1 inner=1 scroll=0.2 sb=1`；
    换视图 t90 `frame=1 inner=0.17`。
  - 之前整块 `.cf-frame` 一起淡，过剧情时边框和状态栏也跟着闪，已废弃那种做法。
- **内存/回想要能回到原处**：`backView` 记住进入列表页之前的视图。`route / node / history`
  在切换视图时不销毁，所以从游戏里点内存 → 记忆列表 → 「返回剧情」直接回到同一页（实测返回后
  正文仍是「就在这时……」那一页）；从主菜单进入时按钮仍写「返回路线选择」。
- **地图标记**：
  - 之前用 `cf-drop-in`（`translateY(-9px)→none`）把 `translate(-50%,-50%)` 的居中偏移覆盖掉了，
    所以标记会「从下往上跳一下」。现在换成 `cf-pin-in`，关键帧里带满 `translate(-50%,-50%) scale()`，
    实测动画期间 `transform=matrix(1,0,0,1,-28.9,-24.5)` 中心不漂移。
  - 配色全部改走主题变量，删掉硬编码的 `#7ea6cc / #11171b`：针 = `--fpanel` 底 + `--fsteel` 边 +
    45° 菱形，标签 = `--fpanel` 底 / `--fink` 字 / `--fline` 边，悬停 = `--fsteel` 底 + `--fbg` 字，
    锁定 = 虚线边 + `--fmut`。浅/深主题各自实测过一组值。
- **后台页面的兜底**：rAF 在页面隐藏时完全不跑，曾经把 `pending` 卡死、界面停在半暗且点不动。
  现在换幕与打字都额外挂一个 `setTimeout` 兜底提交，回到前台立刻是正确状态。

### 11.9 结局页的破碎 / 电子扰乱（2026-11-24）

到达结局页时叠一层电子干扰效果（`EndFx` + `EndBlocks`，挂在 `.cf-game-fixed` 上，
`pointer-events:none`；`cf-end-{death|erosion|true|hidden}` 由页号前缀推导）：

| 层 | 做法 |
|---|---|
| `fx-blk`（方块） | 每块独立抽签，不整批同进同退：尺寸分大 / 中 / 小三档（`30%~72%` / `9%~27%` / `2%~9%`），寿命各自 `60~300ms`（最慢 300ms），所以有的闪得快、有的留得久；透明度每块 `.45~.95` 随机。**在场数量本身也随机**：每 260~700ms 重抽一次 1~13，有时只有一两块、有时铺满一片。约 20% 的方块是「骑边块」，坐标固定在 `±3%` 处并允许溢出内容区。 |
| `cf-ghost-frame`（边框线也被撕） | 骑边方块光有色块还不够——边框线本身也得动。做法是把面板边框复制一层（`inset:-2px` + `1px solid var(--fline)`），加同一个 `filter:url(#fx-tear)`，再用同一份方块遮罩：方块骑在哪条边上，那一段边框线就被位移断开。实测约 4s 采样 673 个方块实例里 119 个是骑边块，其中 99 个真的画到了 `.cf-frame` 之外。 |
| `cf-ghost`（真正让内容扭曲的机制） | 把整块面板（`panel` = 章节栏 + 标题 + 正文 + 状态栏）**再渲染一份**，`position:absolute;inset:0;padding:inherit` 叠在原位（实测与 `.cf-inner` 零像素偏差），整层加 `filter:url(#fx-tear)`，再用方块矩形拼成 SVG 当 `mask-image`。于是只有方块覆盖到的区域显示这份被位移过的副本，方块之外完全干净。副本内部 `animation:none`，不会再跑一遍入场动画。 |
| `#fx-tear` | `feTurbulence(baseFrequency="0.002 0.05", numOctaves=1)` + `feDisplacementMap scale=26`，SMIL `calcMode=discrete` 每 0.28s 换 `seed`。横向几乎不变、纵向约 20px 一条 → 位移按粗水平条带整体错位，是撕裂而不是磨砂。 |
| `fx-slice` | 一次性数字撕裂（`clip-path:inset()` + `steps(9)`），结束归零 |
| `fx-noise` | `feTurbulence` 噪波，`mix-blend-mode:overlay`，只闪一下，结束归零（原先留 `.05` 在正文区糊成一片浅灰底，已去掉） |

侵蚀表现按状态触发，不随路线 2 常驻：仅在启用侵蚀条的路线里 `status.erosion >= Manager.second(50)`
时启用暗红局部主题与结局版 `0.5` 强度的持续干扰。用户给定流程的证据链是：
`210201 攻击(+1) → 210701 前往小径(+1) → 210801 看猫(+1) → 211201 独自进仓库(+0) → 211401 躲藏(+90)`，
所以选择 `211401` 后从 **3% 跳到 93%**，落在页面 **2115**；该页正文首次明确写“双眼已经变得赤红”，
下一页 **2117** 出现红眼 CG。回退到 2114 时状态恢复为 3%，侵蚀表现随之关闭。
进入侵蚀状态时先爆发一次约 **300ms** 的完整电子故障，并播放资源池中的专用音效
`uis_mini_fad_erosion_change`（core 池，单条 AudioClip，2.609s）：`strength=1`、`scale=26`，
8 条画面副本沿横向、纵向与斜向锯齿裂口独立大幅错位/斜切/局部放大，6 段外框线单独撕裂并突破原边框，7 个红/青色大块随机散布在画框内外，另有短闪白、CG 错位、标题分离与撕裂噪波；随后回落到半强度持续干扰：
在场数量降到 1~7（硬上限 8）、方块透明度减半、内容位移 `scale=13`，一次性撕裂与噪波延长并降到半透明。
到达结局后恢复 `strength=1`。从侵蚀剧情打开的回想/记忆浮层保持暗红，不修改站点全局主题，也不改变 CG 原图色彩。

断续节奏：干扰不是一直在响。`useBlocks` 里开了随机开关——亮一段 **0.9~2.2s**、
灭一段 **0.22~0.74s**（第一版正好反过来，灭得太久），灭的时候方块数组清空、遮罩为空，
画面完全干净。之前"整批按住 220~520ms 再齐刷刷换一批"虽然看得清，但节奏太整齐，显得刻意。
现在大小、快慢、数量三者都是各自随机的，遮罩矩形按 0~100 裁切，所以骑边块只贴到面板边缘为止。

要点与踩坑：

- **干扰必须作用在内容上，而且只作用在方块处。** 走过的弯路：① 实心色片叠在上面 → 一眼是贴纸；
  ② 整块正文加位移滤镜 → 画面全都在扭，跟方块位置无关。
- **`backdrop-filter` 在这个渲染环境里根本不生效**：`url(#filter)` 和 `invert(1)` 两种写法都试过，
  计算值读得到、画面没有任何变化，所以放弃用它做局部扭曲，改用「内容副本 + 遮罩」。
- 副本是同一份 JSX 渲染两遍（`.cf-ghost` 里 `{panel}` 再来一次），`pointer-events:none`，
  所以按钮不会重复响应；遮罩矩形每帧重算，扭曲区跟着方块一起跳。
- 干扰范围经历过两次纠正：先是只做正文区（用户框出的范围其实是整块面板），
  再是方块坐标可能溢出到面板外，现在按"先尺寸后坐标"夹在 2%~96% 内。
- `prefers-reduced-motion` 下 `.cf-ghost{display:none}`、方块不生成。

早先的放射裂纹（`fx-crack`）、常驻扫描线条纹（`fx-scan`）、红晕（`fx-vig`，原版
`board_hp_alert_vignette`）都已删除——用户要的是画面随机闪烁方块的电子干扰，
不要碎玻璃、不要背景条纹、也不要红色边框光晕。

按结局类型分强弱：

- **死亡 6xxx**：方块 + 撕裂 + 噪波，正文整体 `fx-shake` 抖 1.3s，CG 错位 3 跳，标题 RGB 分离。
- **侵蚀 7xxx**：同上，再叠 `filter:hue-rotate(-14deg) saturate(1.3)`，撕裂延长到 2.2s 且更亮。
- **TRUE 8xxx / HIDDEN 9xxx**：不抖不偏色，只有方块内的局部撕裂与极淡底噪。

要点：

- **`animation-fill-mode` 需要留残留态的层必须用 `forwards`**，写 `backwards` 会在爆发结束后
  弹回基样式（opacity 0），噪波和红晕直接消失；只有一次性的 `fx-slice` 该用 `backwards`。
- 方块生成用 rAF + 时间片（不是 `setInterval`）：后台窗口里 `setInterval` 会被节流到秒级，
  实测同样 1.2s 只撒出 2 块，换成 rAF 后是 126 块。
- 结局页的 CG 走的是普通 `.cf-fig`（`endCg()` 从未被调用，已删），所以 CG 错位选择器写 `figure img`。
- 配色全部走 `--fxline / --fxglow / --fxred`，浅色主题方块改 `multiply` 混合，两种主题都看得见。
- `prefers-reduced-motion: reduce` 时不生成方块，其余层 `animation:none`，只留 `.1` 的底噪。

- **选项条收窄并居中**：`.cf-opt{width:min(84%,540px)}` + `.cf-opts{align-items:center}`，
  不再与正文同宽、也不再贴左（实测滚动区 688 宽时选项 540，左右各留 ~74）。
  结局块 `.cf-end-block` 用 `width:100%` 保持原来的整幅居中排版。
- **悬停可读性**：原来只有 `.ix / .arrow / .cf-hint` 反色，`.cf-next .tx` 是 `--fmut`，
  在钢蓝底上等于深字压深底；现在 hover 一并把 `.tx` 设成 `--fbg`。
- **打字光标**：末字后面一根下划线（`height:2px`、`width:.6em`、`--fsteel`、1.1s 闪烁），
  不再是块状 `▌`。
- **未启用侵蚀的路线**（1、3）：整行只剩斜纹槽 + 居中 `LOCK`，连「侵蚀度」三个字都不出现。
- **竖屏（≤800px）**：三张记录卡保持横排三列（`.cf-routes{repeat(3,1fr)}` + 压缩内边距与字号），
  内存按钮仍然 `position:absolute` 钉右下角，斜纹槽用 `padding-right:104px` 让位。
  实测 430×860：列宽 122×3、`.sb-mem` 距右 10px / 距底 10px。

### 11.10 音频集成（2026-11-24）

小游戏原本只有 `page.bgm` / `choice.sfx` 两个字符串，没有任何音频文件。现在补齐了链路：

```
游戏资源池 catalog（已解密缓存 nikke_extract/catalogs/*.ndb.dec）
   └─ build/export_fading_audio.py
        ├─ 从 public/data/fadingaffection.json 收集 25 个 key（9 BGM + 16 SFX）
        ├─ 按 audiogroup[_子类]_assets_<key>_<md5>.bundle 在 catalog 里精确查 file_id
        │    BGM 在 dp 池，SFX 在 core 池（audiogroupscenario / audiogroupui）
        ├─ v2.rebuild 重建 bundle → UnityPy 取 AudioClip.samples（FSB5 已能直接解出 WAV）
        └─ ffmpeg libvorbis -q:a 5 → public/fading_audio/<key>.ogg + public/data/fading_audio.json
```

- 现在共 **60 条**：bgm 20 / sfx 17 / ui 15 / typing 1 / write 1 / ambient 6，全部命中。
  表外那三类是 `uis_mini_fad_*`（本小游戏专用 UI 音）与 `ambient_fad_*`（环境音床），
  静态表里没有引用、由 prefab / 客户端代码驱动，所以写死在导出器的 `STATE_KEYS` / `UI_KEYS` / `AMBIENT_KEYS` 里。
  侵蚀状态切换音是 `uis_mini_fad_erosion_change`（2.609s）；prefab 中没有找到直接绑定字符串，
  选择依据是资源池里的专用 key 与同名 AudioClip，不是静态表字段。
- BGM **不做单声道下混**（`export_char_voices.py` 里的 `normalize_wav` 是给雪碧图拼接用的），
  直接把原始 WAV 交给 ffmpeg，保留立体声。
- 播放层在 `web/src/fadingAudio.ts`：一条循环 BGM（切换时 0.38s 淡出、0.9s 淡入到 0.75 音量）
  + 一次性 SFX（0.85 音量）。页面 `bgm` 为空时保持上一首，与原版持续播放一致；
  离开剧情视图停 BGM。
- 静音按钮 `.cf-sound` 在主菜单右上角与剧情页章节栏右侧，状态存 `localStorage` 键
  `nikke_fading_mute`。浏览器可能拒绝非手势触发的播放，`play()` 的 rejection 统一吞掉，
  下一次点击自然带上声音。
- 播放层分六类音量：BGM 0.75、环境音 0.5、SFX 0.85、UI 0.8、打字 0.45、笔刷 0.5；
  BGM 与环境音各自独立循环，换条目做 0.38s 淡出 / 0.9s 交叉淡入。
- **两类"文字出现"的声音要分清**（第一版搞错了）：
  - 打字机咔哒 = `nv_textwriter`（52ms 的极短单音，全游戏剧情通用），由 `useTypewriter`
    的 reveal 回调触发，播放层按 70ms 限频——实测一页揭示打 30 下。
  - 书写笔刷 = `uis_mini_fad_scenario_up`（1.1s），它不是打字音，只是偶尔伴随文字出现，
    所以改成「距上次 ≥1.2s 且 45% 概率」才放——实测同一页只出现 3 下。
  原先把笔刷当咔哒用，听感就是"一直在写字"而不是"打字机"。
- **环境音床必须做响度归一化**：六条 `ambient_fad_*` 的原始响度差了近 20 dB
  （`fade` -21.2 dBFS、`river` -40.7 dBFS），固定音量放的话安静那几条等于没声音——
  表现就是"选地图时有环境音，点进去就没了"。导出器对 `kind == "ambient"` 加
  `-af loudnorm=I=-20:TP=-1.5:LRA=11`，重导后六条落在 -15.8 ~ -23.2 dBFS（差 7 dB），
  前端 `VOL.ambient = 0.5` 就够用。BGM / SFX 不动，它们本来就是混音成品。
- **环境音床按「时间 + 地点」选**：`FadingAffection.tsx` 的 `ambientKeyFor(pageId)`。
  默认按页号百位取地点（1=旧市区、2=湖泊、3=新市区，路线 1、2 的编号就是这么分的；x001 是开场平原），
  再叠一张 `AMBIENT_OVER` 区间表覆盖文本自己写明时间与地点的段落——路线 3 全是 31xx，
  地点却在同一批编号里从旧市区走到湖边再进新市区，光看页号必然错。
  侵蚀结局页（7xxx）用 `ambient_fadingaffection_erosion`。
  六条床的音色是频谱实测的：`fade` 53% 能量在 400Hz 以下 = 宽带风声；`night` 3kHz 以上有虫鸣音调；
  `river`/`birdriver` 76% 落在 0.4~3kHz = 水声（后者多鸟鸣）；`citymoving` 84% 在 400Hz 以下 = 车流低频。
  表里没有任何地点/时间到音频的映射字段（八张 EventTextAdvPlus 表 `ambient` 零命中），
  所以这段是文本证据 + 音色的推断，不对就改 `AMBIENT_OVER` 一处。
- **UI 音**：开始记录 `routeselect_start`、选地点 `special_firstselect_city|river|newcity`、
  选项点击一律先放 `uis_mini_fad_btn`（172 条选项里只有 74 条在表里带 `sfx`，
  其余点了没声就是缺这一层），带 `sfx` 的两声一起放、「点击画面继续」`btn`、回退 `back`、
  退出主菜单 `out`、内存/回想 `recall`、取消静音 `btn`。
- 实测（给 `window.Audio` 打桩记录每次 `new Audio(src)`）：地图页与点进旧市区之后都是
  `ambient_fad_fade` 在循环（同一条床不换，所以翻页不再重请求）；开内存、关内存、翻页都不重起音床，
  只有回首页才停。选项点击命中 `uis_mini_fad_btn` + `sfx_scn_footstepdirt`，
  回退、内存、返回各自的 UI 音也都命中。
- 重跑：`set FFMPEG=... && python build/export_fading_audio.py`（幂等，只补缺失；`--force` 全量）。

### 11.11 环境音接不上循环、放错段落（2026-11-24 追加）

用户实听反馈四条，逐条落到证据上：

1. **环境音循环末尾听得出断口。** 六条 `ambient_fad_*` 是 4~13s 的实地录音，不是成品 loop，
   `HTMLAudioElement.loop` 会把结尾硬接到开头。导出器改成先 `loudnorm`、再做一次拼接：
   把开头 F 秒叠到淡出后的尾部（`atrim` + `acrossfade`，输出长度 L-F），这样循环点两侧
   落在素材的同一时刻。顺序不能反——loudnorm 是动态增益，放在拼接之后会把循环点两侧
   拉成不同电平（erosion 实测仍差 9 倍）。
   **F 和淡化曲线不是拍脑袋**：在素材上把 (0.8/1.2/1.8/2.5s) × (qsin/tri) 各试一遍，
   判据是 `seam_cost` —— 把成品首尾相接，量接缝处 ±33ms 的二阶差分相对全片中位数。
   不能用头尾电平：erosion 是 ±10 dB、2.3Hz 的脉动低频，头 100ms 落在波峰还是波谷全看运气。
   「不拼」也当候选参与，citymoving 原素材本来就接得上（1.00x）所以没拼。
   六条最终落在 0.96 ~ 1.23x（1 附近 = 接缝和素材本身一样平）。
2. **旧市区开场放了夜里的虫鸣。** 原来按页号百位推地点、`old → night` 是纯猜。
   页号百位只编码地点不编码时间，而文本里明确写了天黑/天亮：1132「太阳完全西沉」、
   1136「伸手不见五指」到 1141「阳光从窗外洒落进来」才是夜段，开场那段是白天废墟，
   跟选地图时同一条风声床。频谱实测确认 `fade` 53% 能量在 400Hz 以下（宽带风声）、
   `night` 在 3kHz 以上有虫鸣音调，所以 `old → fade`、夜段进 `AMBIENT_OVER`。
3. **路线 3 的地点在页号里看不出来。** 3xxx 全是 31xx，百位恒为 1，但剧情从旧市区
   （3101）→ 夜里徘徊（3112）→ 湖边（3114）→ 新市区（3130、3132 晚霞）→ 教堂夜戏（3138 月光），
   所以这些段落按页面文本自己写明的地点/时间覆盖，区间和出处写在 `AMBIENT_OVER` 注释里。
   死亡页 6xxx 有两个来源的（6109 ← 1134 夜 / 2304 白天，6111 同理）无法定论，按地点给床。
4. **点了选项没声。** 172 条选项只有 74 条带表里的 `sfx`，剩下 98 条点了完全静音，
   补一层 `uis_mini_fad_btn` 通用按钮音，带 `sfx` 的两声一起放。

顺带修掉一个「看不见的打字音」：`useTypewriter` 原先以 `sceneKey` 作依赖，换视图时幕次 +1
会让正文重新逐字出现，而正文此时已经不在屏上——点「返回主菜单」就听到一串咔哒加笔刷音。
改成只跟 `text` 走：文本没变就不重打。副作用正好是对上了原作行为——从内存回到剧情页直接给全文。
同一条理由也让音床不再被内存往返打断：`view` 为 memories/endings 时不 `stopBgm`，只有回首页才停。

### 11.12 主菜单 BGM 与结局音乐赖着不走（2026-11-24 追加）

**两个 bug 同一个根因。** 之前把「页面没写 bgm 就沿用上一首」实现成了播放层的
「key 为空就什么都不做」（`FadingAudio.playBgm`），也就是按**播放历史**继承。
于是倒着走的时候最后响的那首会被一直保留：

- 结局页点「重新记录」→ 回到选地点，页面 1001/2001/3001 不在页面表里、没有 bgm
  → 保持式写法什么都不做 → 结局曲继续响。
- 结局页点顶部「返回上一节点」→ 上一页也没有 bgm 字段 → 同样留着结局曲。

现在改成按**走过的路径**回溯：`FadingAffection.tsx` 里 `useMemo` 出的 `bgm`，
本页有 `bgm` 用它，否则从 `history` 往前找到最近一个写了 bgm 的页，再找不到就用壳层曲。
`playBgm(null)` 的语义同时改成「停掉 BGM 层」，播放层不再自作主张保持上一首。

**主菜单是有背景乐的**（用户实听）。这首在静态表里查不到任何出处，都找过：

- `EventTextAdvPlus*` 八张表里 `event_bgm_` 只出现在页面表，`FirstSelect`/`Route`/`Manager`/
  `SpecialIntro` 四张界面表零音频串；`ambient_fad` 在这八张表里也是零命中。
- `BGMTriggerTable.mpk`（43 条 maria-n 行）里 `ambient_fad` 命中 0 次；它的尾部那批
  `ambient_marian_room / factory / ruinfactory / siren` 配 `event_bgm_maria-n_*` 的行是**主线 50 章**的。
- `SDLobbyBGMTable.mpk`（大厅背景乐表）整表只有 staranis 系列，没有本活动。
- 活动自己的 prefab 都重建过了（`view_assets_view-fadingaffection{main,routeselect,scenario,intro,
  ingameintro,ending,recall,achievement}`、`eventui-firstaffection_*`），里面没有任何
  `event_bgm_*` / `ambient_fad_*` 字面串——界面与音频的绑定在客户端代码里，表与 prefab 都不带。

**曲名靠 `JukeboxListTable.mpk`（游戏内"音乐收录"）对回来**：它的每一行按
「音频 key → 曲名 → 作曲者」排列，所以 OST 标题能直接反查 key。用户报的主菜单曲
「I Want to make you Smile / NieN」= **`event_bgm_maria-n_smile`**，接在 `MENU_BGM` 一行。
（此前按「裸名 + 小游戏零引用」猜的 `event_bgm_marian` 是另一首：Marian / Cosmograph，猜错了；
为试听导出的那 8 首候选已经删掉，回收 18.5 MB，清单回到 59 条。）

本活动曲目的 key ↔ 曲名/作曲者 对照（`-4`、`percent`、`102-202` 三行的曲名分词没被我的
正则收到，只留下署名）：

| key | 曲名 / 作曲者 |
| --- | --- |
| `theroom` | Room-00 / Cosmograph |
| `surface` | Surface / Cosmograph |
| `route-n` | Route-n / Cosmograph |
| `battledata-n` | BD-n / Cosmograph |
| `daughter` | Daughter / Cosmograph |
| `ijustsawmydeath` | I just saw my death / Cosmograph |
| `forwhat` | for_NULL / Cosmograph |
| `quietpeace` | Quiet Peace / Cosmograph |
| `wish` | Wish / Cosmograph |
| `plzstayalive` | Please Stay Alive / Cosmograph |
| `cheers` | cheers / Cosmograph |
| `-4` `percent` `102-202` | / Cosmograph |
| `command` | Command / **NieN** |
| `vow` | VOW / NieN |
| `butterfly` | Butterfly / NieN |
| `coldrain` | Coldrain / NieN |
| `smile` | **I Want to make you Smile / NieN** ← 主菜单专用（另有 7 个正文页也引用它） |
| `offline` | OFF-LINE / Nauts |
| `ed` | Call me name Again / Cosmograph feat. Kang Yunjeong |

**主菜单曲的播放规则（用户第二轮说清楚的行为，第一版我理解反了）**：

1. 只在主菜单有声。点关卡卡片进选地点，这首就淡掉——**选地点不放任何 BGM**，
   只有风声环境音（`bgm` 解析为 null 就是停，`playBgm` 不再自作主张保持上一首）。
2. 但它在后台**继续走进度**：离开主菜单只把音量拉到 0，绝不 `pause`。
   所以回主菜单是从当前位置接上（用户说的「在中间段开始播放」），不是每次从头放。
3. 从主菜单打开内存/回想仍算在主菜单里（用 `backView` 判断）；从剧情打开就是浮层，
   底下那层 BGM 与音床都不动。

实现上是**第三条独立循环层** `FadingAudio.setShell(key, on)`：它自己持有一个循环元素、
只用 `ramp` 切音量。它不进 `pool`——`smile` 同时被 7 个正文页引用，和剧情层共用一个元素
会被剧情那边的淡入淡出踩掉。

顺带修的四处：

1. 卸载时补 `stopBgm()`（切到站内其它页面，小游戏已经没了但循环层还在响），
   里面也一并停掉并释放主菜单曲那条元素。
2. BGM 那条 effect 把 `audioMap` 列进依赖——清单到达前 `sound` 还是空的，首屏那次会空放。
3. **同一首被建出多个实例叠着播**（开发模式下音量翻倍）：剧情/环境两层按 key 池化循环元素
   （`pool`）复用不重建；`ramp` 加 token，被重新启用的元素不会再被上一条淡出循环拉回零。
4. 浏览器在没有用户手势时会拒绝播放，循环层不能像一次性音那样直接放弃（那样刷新后
   主菜单就一直没声）：`tryPlay(el, true)` 把被拒的循环元素挂到下一次 `pointerdown`/`keydown` 补播。

实测（`window.Audio` 构造打桩 + 按元素身份去重，读 `volume`/`currentTime`/`paused`）：

- 主菜单：只有 `smile`，vol 0.75。点关卡卡片 → 选地点：`smile` vol 归 0 但**不暂停**
  （t 4.8 → 6.3 连续），有声的只剩 `ambient_fad_fade` 0.5。
- 进正文页 1101：`surface` 0.75、风 0.5、`smile` 仍然 vol 0 在走（t 15.5）。
  点顶部返回主菜单：`smile` 淡回 0.75 且是从 t=18.1 接上的，剧情层与环境层淡到 0 并 `paused`。
- 走到死亡结局 6101：`102-202` 0.75，其余全静音，`smile` 已走到 t=38.3。
  点「重新记录」回选地点：`102-202` 淡出并 `paused`，只剩风声，`smile` 在 t=47.1 继续走。



