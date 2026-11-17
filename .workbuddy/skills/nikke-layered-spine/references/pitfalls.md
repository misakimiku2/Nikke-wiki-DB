# NIKKE 分层立绘 / Spine 多图层渲染：踩坑与判定指南

本文件记录从游戏资源定位分层 Spine、到网页端多图层叠加渲染过程中，靠直觉走不通、
必须实测才知道的关键点。配合 `scripts/extract_layered_spine.py` 使用。

## 一、资源定位：catalog 里搜不到 ≠ 不存在

### 症状
想找某个演出特效（如更衣帘），在解密后的 catalog SQLite 里用关键词搜
（`curtain` / `change` / `transition` / `dress` …）只出来音效 bundle（`sfx_scn_curtainopen`），
没有任何贴图/动画资源，于是误判"视觉资源没导出、没法做"。

### 真相
角色立绘的额外图层**不在 `spine/standing/` 或 `spineeventscenesgroup` 这些常见组里**，
而是藏在 **dp 资源池 `spinestandingprefabgroup` 的 `00_decadent` prefab bundle** 里。
上游 `export_char_standing.py` 只按 `spinestandingcharactergroup(hd)` 取主模型，
完全不会碰 prefab bundle，所以主模型资源里看不到任何帘子/场景层。

### 正确排查顺序
1. catalog 搜关键词只有音效 → 不要下结论，去翻 **prefab bundle 的对象结构**。
2. 定位 prefab：`files_chunktype` 里 `key like '%spinestandingprefabgroup%<角色id>%decadent%hd%'`。
   注意 bundle key 形如 `spinestandingprefabgroup(hd)_assets_spine/standing/c515/00_decadent_<hash>.bundle`，
   `(hd)` 在**前半段**，SQL pattern 里别把 `%hd%` 写到末尾（会匹配不到）。
3. 用 `export_cg_v2.rebuild()` 重组 bundle → `UnityPy.load()` → 遍历对象：
   - `TextAsset` 名字形如 `<名>_fg.atlas` / `<名>_fg.skel` / `<名>_bg.*`
   - `Texture2D` 名字形如 `<名>_fg` / `<名>_bg`，`read().image` 取图
4. **验证层内容**：atlas 的 region 名能直接看出是什么，例如 c515 FG 含
   `s1_curtain_open1~8` + `s2_curtain_close1~17`（帘子），BG 含 `bg1/bg2/bg_grass`。
   不要只凭"有 FG/BG 层"就认定是目标特效——c513/c582/c870 也有 FG atlas，
   但内容是别的特效，**全库只有 c515 的 FG 含 curtain**。

### 立绘的三层结构（已验证）
| 层 | 资源 | 内容 | 骨骼数/贴图数 |
|---|---|---|---|
| Main | `spine_char/c515_00` | 角色本体换装 | 403 / 372 |
| BG | `spine_layer/c515_00_bg` | 更衣室场景 | 108 / 70 |
| FG | `spine_layer/c515_00_fg` | 浴帘 + 灯光 | 38 / 24 |

三层各有 26 个**同名**动画（`expression_0` 5.60s / `expression_0_alt` 2.00s 等），
切形态时同步播放。贴图几乎不重叠 → 叠加渲染不会互相覆盖。

## 二、资源转换：atlas 引用的图片名必须同步改成 .webp

`public/` 里的整套素材是 WebP（省体积），从游戏提取的原始图集是 PNG。转换步骤：
1. `image.convert('RGBA').save(webp, 'WEBP', lossless=True, exact=True)`。
2. **把 atlas 首行的 `<名>.png` 改成 `<名>.webp`**，否则播放器 fetch 404。
3. `pma:true` 原样保留。不要二次预乘 alpha——半透明层会变灰（腮红变褐、发光变灰斑）。
4. 脚本已自动做这三步，产物与手工提取的 md5 一致。

## 三、多图层渲染：取景对齐是核心

三层是三套**独立的小骨架**，但共用同一游戏坐标系，因此**只要用同一个相机取景就能对齐，
不需要任何校准/偏移配置**。测试过：直接三层 + 同一 camera，严丝合缝。

关键实现点（见 `SpinePlayer.tsx`）：
- 用主模型的 `skeleton.getBounds(offset, size, [])` 算包围盒（offset/size 必须是 `spine.Vector2`，
  不能是普通对象；第三参要传 `[]` 不是 null）。
- `fitScale = min(W/bw, H/bh)`；《contain》不留 padding，才能和外层独立背景严格同框。
- camera 设置用 iife 版 API：`cam.position.set(cx,cy,0)`、`cam.viewportWidth = W/z`、
  `cam.viewportHeight = H/z`、`cam.update()`。**不是** `cam.setZoom()/setViewport()`（那是别的版本）。
- 绘制顺序：BG(z=-1) → main → FG(z=+1)，每层各自 `state.apply` + `updateWorldTransform`。

### 同步广播（漏一个就穿帮）
- `setAnim` / `seek` / `setSpeed` 都要同步到额外层；额外层没有同名动画时跳过
  （例如 FG 没有纯 `idle`，待机时停在 setup pose 是对的）。
- 播放循环里 `if (playing)` 同时 `state.update(dt)` 所有层的 state。
- 一次性过渡动画（`playOnce`）的"播完切目标"只需看主层 track.isComplete()；
  触发 `setAnim(follow)` 时会自动广播到额外层。
- 额外层加载失败要降级成单层，不能让整个播放器报错。

## 四、形态判定：别只用后缀配对

### 数据规律
第二形态动画是同一批表情的双版本：`idle/idle_02`、`angry/angry_alt`、`idle/idle_blue`…
后缀不统一（`_02` / `_alt` / `_blue` / `_2`），**同一模型内部还会混用**
（桃乐丝 c233 的 idle 变体叫 `idle_alt`，angry 变体却叫 `angry_02`）。

判定规则（`data.ts` detectFormVariants）：
- 变体名去掉一个后缀得"纯基础名"且基础名存在 → 配对；**禁止链式**
  （灰姑娘 c511 有 `idle_blue` 又有 `idle_blue_02`，后者不能再当形态2）。
- 有**双向过渡动画** `expression_0` + `expression_0_alt` → 直接认定有形态，
  即使只有 1 对变体（拉普拉斯 c100 只有 idle_alt，但有完整变身动画）。
- 否则要求 ≥3 对变体且含 idle 变体。

### 已知的假阳性（FORM_FALSE_POSITIVES）
自动识别会把这些源数据异常误判成形态，已硬编码排除：
- c402/c403 坎西：`expression_0` 是 `action` 的**逐帧副本**（附件 100% 相同），不是变身动画。
- c470 小红帽：`expression_0` 是把 `images_1/images_2` 分层差分图叠上去的"红眼"，
  没有 idle 变体；切到所谓形态②后点别的动画又弹回形态①。

### 潘托姆 c580 的特例
c580 第二形态只摘面具/换眼镜（附件差异仅 3 个），确实是形态，别按换装强度筛掉。
圣洁怪盗皮肤 c580_01 切形态②的默认落点必须是 **`idle_alt`** 而非 `idle_02`
（`ex1_leg` 等形态2附件在 idle_alt 里，是变身动画末帧；落 idle_02 会跳帧）。

## 五、验证技巧

### 深链必须用 HashRouter 的 # 形式
本站用 `HashRouter`，所以角色页正确 URL 是 `http://127.0.0.1:5273/#/characters/515`。
直接访问 `/characters/515` 会被当首页（无头浏览器截图会截到首页，容易误判代码坏了）。

### 无头浏览器截图的两个坑
1. `--dump-dom` / `--screenshot` 对 React 异步数据页不可靠：模型/角色数据没加载完就抓，
   DOM 里角色名为空、canvas 为 0。用 CDP（`--remote-debugging-port` + Node 内置 WebSocket）
   导航后 `sleep` 再 `Runtime.evaluate` 才靠谱。
2. 无头环境 rAF 推进极慢（6 秒实时只推进 0.1 秒动画），截图看不到转场完成。
   验证动画各帧应写独立测试页，用 `state.update(t)` 直接跳到指定时间点再截图，
   而不是靠等待真实播放。

### 一张图胜过十行日志
确认三层对齐/帘子效果的最快方式：写个独立 HTML 用 iife 版 spine-webgl
（`/node_modules/@esotericsoftware/spine-webgl/dist/iife/spine-webgl.js`，全局名 `spine`），
加载三层 + 同一 camera，`state.update(t)` 到 1.5s（帘子合拢）/5.5s（形态②）分别截图。
验证完把测试页从 public 删掉，别带进 dist。

## 六、新增分层角色的完整清单

1. `python extract_layered_spine.py <skin> --scan` 看有没有 FG/BG 层。
2. 有层则跑完整提取（写进 `public/spine_layer/`）。
3. `web/src/data.ts` 的 `LAYERED_MODELS` 加一条映射。
4. 确认主模型与额外层有同名动画（`expression_0` 等），否则不会同步。
5. 构建 + 在角色页实测。`public/` 素材不入库，CI/换机器必须重跑提取脚本。

## 七、粒子转场特效：不是 Spine，别往分层方向做

**症状**：某角色切形态有华丽的 2D 特效（红刃/花瓣/光带），但它们不在 FG/BG Spine 层里，
prefab 的 FG atlas 也搜不到相关贴图。

**根因**：这类特效是 Unity **Timeline（PlayableDirector）+ ParticleSystem** 驱动的，
在 decadent prefab 的 GameObject/Mesh/材质里，跟 Spine 前景层是两套完全不同的机制。
判断方法：用 UnityPy 统计 bundle 里的 `ParticleSystem` 数量——c472 有 31 个、c580 有 22 个、
c103 有 26 个；而 c515 帘子是 **0 粒子**（纯 Spine 分层）。有粒子就不要去翻 `*_fg.atlas`。

**贴图**：特效用的图也是 `Texture2D`，名字形如 `fx_<角色>_<皮肤>_normal_uv_01`：
- c472 实测：`uv_01` 花瓣群（256²，白底红瓣但 alpha 正常）、`uv_02` 红色光带、
  `uv_06` 红白刀刃（最显眼）、`atlas` 小火花图集（512²）；`uv_03~05`/`mask` 是细线/噪声/遮罩，可不接。
- 导出时 `read().image` 带 alpha，转无损 WebP 别丢 alpha（`lossless=True, exact=True`）。

**网页复现**：用 `VfxBurst`（Canvas 2D 粒子）而非多层 Spine。几个要点：
- 粒子行为无源数据可精确还原（Timeline 曲线能读到 `m_PositionCurves` 等，但重建 Unity 发射器
  工程量极大），**按游戏截图手工调参**即可，用户接受"近似"。
- 混合模式用 `screen`，让刀刃/花瓣叠加发亮又不糊；全屏红色渐变闪光前 25% 冲峰值、之后衰减。
- 出场加 `delay`（各粒子 0~0.5 随机）错开，不然齐刷刷一起出现很假。
- 调参经验（c472）：刀刃 6 条、size ≈ `min(W,H)` 的 0.85~1.7 倍、alpha 0.75~1；
  花瓣 38 片、size 为 min(W,H) 的 5%~16%；闪光峰值 alpha 0.34（太高会盖住角色）。
- 触发：`CharacterDetail.switchForm` 里只在有过渡动画（`playOnce`）时递增 `vfxSignal`，
  这样瞬时切换的角色不会误触发。`vfxConfigFor(name)` 返回 undefined 时不渲染组件。

**范围**：全库约 9 个角色有粒子特效（c017/c019/c103/c471/c472/c513/c580/c871/c872）。
新增角色只加一条 `VFX_MODELS` 配置。素材在 `public/vfx/`（gitignore），换机器要重跑提取。
