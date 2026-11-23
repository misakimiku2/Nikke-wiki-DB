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

规模：265 个页面、172 个选项、35 个结局、40 段记忆、59 张黑白 CG、174 张原版 UI 纹理。

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
| `EventTextAdvPlusManagerTable.mpk` | 全局配置，状态初值/上限（体力 10、粮食 10、侵蚀 0） |
| `EventTextAdvPlusRouteTable.mpk` | 3 条路线、名称/描述/开放时间/开场页 |
| `EventTextAdvPlusEventPageTable.mpk` | 265 个页面：正文 key、CG、BGM、下一页 |
| `EventTextAdvPlusSelectOptionTable.mpk` | 172 个选项：文本/hint/SFX/目标页/条件 |
| `EventTextAdvPlusFirstSelectTable.mpk` | 开场地点选择（旧市区 / 湖 / 新市区） |
| `EventTextAdvPlusLootItemTable.mpk` | 40 段「已储存的记忆」，记录 id = 授予该记忆的页面 |
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

### 2.3 解锁条件（全部有数据依据）

**地点选择**（FirstSelect 记录里目标页之后的末位 4 位数）：

| 地点 | 条件 |
|---|---|
| 旧市区 | 无 |
| 湖（路线1） | 记忆 1-14「小径」（抵达页面 1114） |
| 湖（路线2） | 记忆 2-14「一起走的路」（页面 1214） |
| 新市区 | 结局 7205 |

**HINT 选项**（22 条，条件字段在选项 key 之后）：

| 类型值 | 含义 | 例 |
|---|---|---|
| 1 | 需要某记忆（值=授予页） | 「戒备」需 1101→记忆 1-1「袭击」 |
| 3 | 需要某结局（值=结局页） | 2108_02 需 7201、3101_02 需 8201 |
| 2 | 状态条件 | 「把食物分给猫」需粮食 |

未满足条件时显示 `???` 破损条，满足后显示 HINT 条与提示文本。

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
> 59 张黑白剧情 CG（`EventScene_FadingAffection_*`，由 `export_cg_v2.py` 走正常 CG 流程导出）。

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

- **状态**：体力/粮食/侵蚀，初值来自 Manager 表；选项明示消耗并据此禁用（状态不足）。
- **状态崩溃**：体力或粮食归零 → 路线对应的死亡结局；侵蚀满 → 侵蚀结局。
- **记忆**：由访问页面（`memoryByPage`）或达成结局（`memoryOfEnding`）解锁，存档在 localStorage。
- **进度**：结局、记忆、访问页、已选选项分别存于 `nikke_fading_endings_v1` /
  `nikke_fading_seen_v1` / `nikke_fading_checked_v1`。首页与菜单提供「清除存档」。
- **Checked +1%**：选过的选项显示 Checked 印章与 +1%（还原原作达成率反馈）。

---

## 6. 已知近似与后续工作

| 项目 | 现状 |
|---|---|
| 选项状态消耗 | **按选项文本关键词推导**（吃/跑/躲/黑暗等），非静态表直接字段；界面已明示。之前发现的 `5375/6143` 等数值是字节对齐伪值，不是状态标志。 |
| 路线锁定的 TrueEnd | 依据「需看完前记录结局」的设定与 locale 文案，选用 8101/8201；静态表未发现明确字段。 |
| 背景图 | 小游戏无专用背景表，页面无 CG 时沿用上一幕并做模糊压暗。 |
| BGM / SFX | 数据已导出（页面 `bgm`、选项 `sfx`），但当前未接入音频播放。 |
| UI 布局 | 游戏页仍是 CSS 按截图比例还原；新增了 dev-only 可视化编辑器用于精确拼图，产出的坐标/尺寸/九宫格参数可导出 JSON/CSS 供替换（见第 9 节）。 |
| 九宫格 / 平铺 | 原版 Sprite 的 border 已导出（见第 9 节）；编辑器已支持 sliced（.9 图）/ tiled，但游戏页 CSS 尚未整体切换过去。 |

---

## 7. 验证记录

- UI 完整性审计：小游戏 bundle 共 247 张纹理，已导出 244 张；与 CG 池零重叠。
- `npm run build` 通过，产物含 `dist/data/fadingaffection.json` 与 `dist/fading_ui/`。
- 实测：全新存档 → 湖锁定（显示需要「小径」）→ 走到页面 1114 → 湖解锁。
- 实测：HINT 选项按各自条件从 ??? 变为 HINT 条。
- 实测：清档按钮重置三个 localStorage key 并回到路线选择。
- 59 张 CG 的哈希在 `cg_index.json` 中全部命中 `public/img/l/<hash>.webp`。

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
| `web/src/pages/FadingAffection.tsx` | 只保留逻辑：存档、路线解锁、cost 结算、强制结局、HINT、历史栈；渲染交给 `FadingCold` |
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
