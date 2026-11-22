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

素材来自资源池 `core` 的 `eventui-marian_assets_adventure_*` bundle（file_id **14098–14112**），
由 `nikke_extract/scripts/export_fading_ui.py` 导出到 `public/fading_ui/`（174 张 PNG）。

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
| UI 布局 | CSS 按截图比例还原，非原版 Unity 布局文件直接转换。 |

---

## 7. 验证记录

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
