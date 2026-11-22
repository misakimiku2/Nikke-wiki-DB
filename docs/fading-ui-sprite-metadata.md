# 原版 UI 纹理的「可拉伸」机制调查（Unity Image / Sprite.border）

> 调查日期：2026-11-22
> 数据来源：`E:\test\nikke_extract` 的 core 资源池 bundle 14098–14112 / 26802–26813，
> 用 UnityPy 直接读 bundle 里的 **Sprite** 与 **MonoBehaviour(UnityEngine.UI.Image)** 对象。
> 结论：你观察到的「256×256 的 `marian_bg_paper` 被拉成长条」不是单纯拉伸，
> 而是 Unity UI 的 **Sprite 九宫格 border + Image.Type（Sliced / Tiled）** 机制。

---

## 1. 机制本身

Unity 的 UI 图片由两部分组成：

| 部分 | 内容 | 我们有没有 |
|---|---|---|
| `Texture2D` | 真正的 PNG 像素（256×256 等） | ✅ `export_fading_ui.py` 只导出了这部分 |
| `Sprite`（子资源） | `m_Rect`、`m_Pivot`、`m_Border`、`m_PixelsPerUnit` | ❌ 导出时被丢弃了 |
| `Image`（MonoBehaviour） | `m_Sprite` 引用 + `m_Type`（0 Simple / 1 Sliced / 2 Tiled / 3 Filled）+ RectTransform 尺寸 | ❌ 没导出 |

关键点：**九宫格 border 数值存在 Sprite 子资源里，不在 PNG 文件里**。
所以我们现在拿到的 244 张 PNG 是「没有说明书的零件」，编辑器只能按 100% 拉伸猜。

`Sprite.border` 是 `Vector4(x=left, y=bottom, z=right, w=top)`，注意顺序是 **左下右上**，
和 CSS `border-image-slice` 的 **上右下左** 顺序相反。

---

## 2. 实测的 border 数值（bundle 内 Sprite 原始数据）

| Sprite | 原图尺寸 | border (L, B, R, T) | 含义 |
|---|---|---|---|
| `marian_bg_paper` | 256×256 | **(20, 20, 20, 20)** | 四边九宫格，可任意放大 |
| `marian_bg_paper_erosion` | 256×256 | **(20, 20, 20, 20)** | 同上（侵蚀版） |
| `marian_bg_choice` | 512×64 | **(49, 0, 73, 0)** | 左右两端固定，中间横向拉伸 |
| `marian_btn_bg` | 500×212 | **(127, 0, 239, 0)** | 左右两端固定（胶带条） |
| `marian_bg_slot` | 256×192 | **(68, 0, 68, 0)** | 左右两端固定 |
| `marian_bg_tag` | 108×40 | **(16, 9, 12, 6)** | 四边九宫格 |
| `marian_bg_firstselect_03` | 56×48 | **(24, 0, 25, 0)** | 左右固定 |
| `marian_bg_route`（及其 shadow/line） | 128×160 | **(40, 0, 40, 0)** | 左右固定 |
| `marian_bg_highlight` | 100×44 | **(21, 0, 11, 0)** | 左右固定 |
| `marian_deco_line_01` | 256×104 | **(18, 7, 16, 32)** | 四边九宫格 |
| `marian_deco_line_02` | 256×28 | **(27, 17, 20, 6)** | 四边九宫格 |
| `marian_50round_shadow_only` | 128×128 | **(50, 50, 50, 50)** | 四边九宫格 |
| `marian_bg_choice_maria` / `_hidden` | 512×64 | (0,0,0,0) | **无 border**，纯拉伸 |
| `marian_bg_state` | 512×156 | (0,0,0,0) | 无 border，纯拉伸 |
| `marian_bg_tilte` | 512×104 | (0,0,0,0) | 无 border，纯拉伸 |
| `marian_texture_paper` | 1024×320 | (0,0,0,0) | 无 border，叠加噪波用 |

---

## 3. prefab 里 Image 组件实际怎么设置的

把 `m_Sprite` 的 PPtr 解析成贴图名后（bundle 14101 首选项 / 14111 剧情页）：

| 贴图 | Image.Type | 使用位置 | RectTransform.sizeDelta（Unity 单位） |
|---|---|---|---|
| `marian_bg_paper` | Tiled（原作）→ 本站按 **Sliced/.9 图**处理 | `img_paper`（整张纸底） | **1326.71 × 1955.34** / 1330 × 1955 |
| `marian_bg_paper` | Sliced | `img_transition` | 0 × 0 |
| `marian_bg_paper_erosion` | **Sliced** | `img_paper`（侵蚀版纸底） | 1326.71 × 1955.34 / 1330 × 1955 |
| `marian_bg_choice_maria` | **Simple** | `img_bg`（普通选项条） | **1060 × 146** |
| `marian_bg_choice_hidden` | **Simple** | `img_bg`（??? 选项条） | **1060 × 146** |
| `marian_bg_choice` | **Simple** | `img_bg` / `img_bg_color` | 1060 × 146 |
| `marian_bg_choice` | **Sliced** | `Fill`（进度填充） | 0 × 10 |
| `marian_bg_state` | Simple | 底部状态栏 | 1044 × 362.8 |
| `marian_bg_tilte` | Simple | 标题条 | 88.57 × 60（小块拼用） |
| `marian_ptn_wood_01/02` | **Tiled** | 桌面木纹底 | 1600 × 1600 |
| `marian_ptn_paper` | **Tiled** | 纸张纹理 | 1600 × 1600 |
| `marian_deco_line_01/02/04` | **Sliced / Tiled** | 分隔线 | 依位置而定 |
| `marian_divider_02/03` | **Tiled** | 分隔笔刷 | 1000 × 17.8 |
| `marian_mask_map` / `marian_shadow_line` | **Tiled** | 地图 / 阴影 | 950×1150 等 |

### 这说明什么

1. 你举例的 `marian_bg_paper`：256 方图被放到 **1326×1955 Unity 单位**的大框里。
   原作 prefab 里是 **Tiled**，Unity 会保留四周 20px border，中间按原尺寸重复。
   但按你的要求，本站**不按网格平铺**，而是按 **.9 图 / Sliced** 处理：四角固定、中间拉伸。
   侵蚀版 `marian_bg_paper_erosion` 原作就是 **Sliced**，行为一致。
   > 结论修正：`Tiled` 在这里不是「整张图无缝平铺」，而是「九宫格 + 中间重复」；
   > 无论 Tiled 还是 Sliced，四角/边缘都必须保持原样，不能把整张图当网格铺开。
2. 截图里那条很长的**选项条**（`marian_bg_choice_maria` 等）反而是 **Simple 纯拉伸**
   （1060×146 的框），所以当前 CSS 用 `background-size:100% 100%` 对它是**正确**的。
3. 进度条填充 `Fill` 用 `marian_bg_choice` + **Sliced**（border 49/0/73/0），
   这样无论进度多长，两端笔刷都在。
4. 分隔符 / 木纹 / 纸纹这类纹理基本都是 **Tiled**，靠重复而不是拉伸来适配大区域。

---

## 4. 对网页还原的影响

| Unity 类型 | 正确还原方式 |
|---|---|
| Simple (0) | `background-size: 100% 100%`（现在编辑器/游戏页就是这么做的，对这类没问题） |
| Sliced (1) | CSS `border-image`：<br>`border-image-source: url(...);`<br>`border-image-slice: T R B L fill;`<br>`border-image-width: Tpx Rpx Bpx Lpx;`<br>`border-image-repeat: stretch;`<br>注意 border 数值顺序换算：Unity `(L,B,R,T)` → CSS `(T,R,B,L)` |
| Tiled (2) | `background-repeat: repeat` + 原尺寸（`background-size: auto`），或 `border-image-repeat: round/repeat` 配合 border 让边缘保留 |
| Filled (3) | 进度条用 clip / width 控制，本活动主要是 `Fill` 那个 Sliced 条 |

**因此当前编辑器的 `fill / contain / cover` 三档并不够**：缺了 `sliced` 和 `tiled`，
而这正是「碎片素材拼大背景」的关键。

---

## 5. 已落地的实现

1. ✅ `scripts/export_fading_ui.py` 同时读 Texture2D 与 Sprite，导出
   `build/fading_ui_sprites.json`（236 项，`{name: {border:[L,B,R,T], rect:[w,h], pivot:[x,y]}}`）。
2. ✅ Vite 的 `fadingUiManifestPlugin` 把 border 合并进
   `public/data/fading_ui_manifest.json`（244 项）；**只有零 border 的无缝纹理才标记 `tiled`**。
3. ✅ 编辑器的图片图层填充模式扩为 `fill / contain / cover / sliced / tiled`：
   - 拖入素材时按元数据自动选：**有非零 border → `sliced`（.9 图）**；零 border 的无缝纹理 → `tiled`；其余 → `fill`。
   - 属性面板可手动切换并显示/编辑 border 数值（左/下/右/上）；无 border 的 sliced 退化为纯拉伸。
   - 骨架模板里的纸底已改为 `marian_bg_paper` + `sliced`，border `[20,20,20,20]`。
   - 旧存档自动迁移：带 border 却存成 `tiled` 的图层会改回 `sliced`。
4. ✅ `exportCss()` 对 sliced 输出 `border-image`（.9 图），对 tiled 输出 `background-repeat: repeat`（仅限零 border 纹理）。
5. ⬜ 游戏页 `fading.css` 尚未切换：等你用编辑器拼好并导出 JSON/CSS 后再统一替换，
   避免现在改坏已有可用画面。

这样编辑器里看到的就会和原作一致，而不再需要靠猜「这块图为什么被拉长了」。
