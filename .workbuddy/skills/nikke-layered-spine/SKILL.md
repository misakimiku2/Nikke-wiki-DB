---
name: nikke-layered-spine
description: 为 NIKKE 角色图鉴（nikke-web）提取并接入第二形态切换及其转场特效：分层立绘 Spine（BG 场景层 / FG 前景层，如灰姑娘:琉璃波光的更衣帘）、Unity 粒子特效（如红莲:弑神的红刃花瓣）。当需要给某个角色加形态切换按钮、还原带特效的形态转场（帘子/场景层/粒子）、或排查游戏中视觉资源在 catalog 里搜不到时使用。
agent_created: true
---

# NIKKE 分层立绘与第二形态

## Overview

nikke-web 的角色详情默认只用 `public/spine_char/<名>/` 单个 Spine 模型。本 skill 处理三类扩展：

1. **第二形态切换**：把成套的变体动画（`idle_02`/`idle_alt` 等）抽成形态①/②按钮，
   有过渡动画（`expression_0`/`_alt`）时先播变身动画。
2. **分层立绘**：个别皮肤的立绘拆成三层 Spine（BG 场景 + 角色 + FG 前景），
   三层共用相机、切形态时同步播同名动画。例如灰姑娘:琉璃波光的更衣帘——
   帘子从顶部圆形导轨转一圈遮挡，换装后打开。
3. **粒子转场特效**：另一些角色（红莲:弑神等）的转场是 prefab 里的 Unity Timeline +
   ParticleSystem 驱动的纯 2D 特效，**不是 Spine 层**，网页端用 Canvas 2D 粒子近似复现。

## Workflow

### 判断需求类型

- 只是"给角色加形态按钮" → 走【形态切换】，通常无需提资源。
- "还原某个形态转场特效" → 先走【判断特效类型】分清是 Spine 分层还是 Unity 粒子，再选对应路径。
- 遇到"catalog 里搜 `curtain`/`change` 只有音效"的死胡同 → 读 `references/pitfalls.md` 第一节，
  不要过早下"资源不存在"的结论。

### 判断特效类型（关键分岔）

同一个 `00_decadent` prefab bundle 里可能同时有 Spine 层和粒子系统。用 UnityPy 统计 bundle 里的
`ParticleSystem` 数量：**> 0 是粒子特效，走【粒子转场】；= 0 且有 `*_fg.atlas` 才是 Spine 分层**。
全库参考：c515 帘子 = 0 粒子（Spine 分层）；c472 红莲 = 31 粒子、c580 潘托姆 = 22、c103 = 26
（粒子特效）。不要看到 decadent prefab 就以为一定是分层 Spine。

### 形态切换（data.ts + UI 已实现，通常只需确认/微调）

判定逻辑在 `web/src/data.ts` 的 `detectFormVariants`。新增角色一般自动生效；
若出现假阳性（把普通表情差分当成形态），在 `FORM_FALSE_POSITIVES` 加正则排除。
细节、已知特例（潘托姆摘眼镜、坎西 action 副本、小红帽红眼差分）见
`references/pitfalls.md` 第四节。

### 定位并提取分层资源

运行 `scripts/extract_layered_spine.py`（依赖 nikke_extract 工具链，脚本自动定位仓库；
找不到时用环境变量 `NIKKE_EXTRACT` 指定）：

```bash
# 列出所有含 decadent prefab 的皮肤（有 prefab 不代表一定有 FG/BG 层）
python .workbuddy/skills/nikke-layered-spine/scripts/extract_layered_spine.py --list

# 扫描某皮肤的层，不写盘
python .workbuddy/skills/nikke-layered-spine/scripts/extract_layered_spine.py c515_00 --scan

# 正式提取到 public/spine_layer/
python .workbuddy/skills/nikke-layered-spine/scripts/extract_layered_spine.py c515_00
```

脚本会：从 dp 池找 decadent prefab bundle → UnityPy 取 `*_fg`/`*_bg` 的 atlas/skel/贴图 →
PNG 转无损 WebP → atlas 首行改名 `.webp` → 打印 region 概览。**检查 region 名确认层内容**
（如 curtain 相关字样），别只看"有 FG 层"就认定目标特效。

产物写入 `public/spine_layer/<名>_fg/`、`<名>_bg/`（素材被 gitignore，不入库）。

### 接入网页

1. 在 `web/src/data.ts` 的 `LAYERED_MODELS` 登记主模型 → 层名映射。
2. `SpinePlayer` 已内置多图层支持（`layerNames` prop）：加载额外层、`setAnim`/`seek`/调速
   同步广播、按 z 序绘制、共用相机取景。CharacterDetail 传 `layerNames={layerConfigFor(current)}`，
   新角色自动生效，无需改组件。
3. 实现细节与同步陷阱见 `references/pitfalls.md` 第三节。

### 粒子转场特效（Timeline + ParticleSystem）

当特效是 Unity 粒子（红刃/花瓣/光带），**不要**往分层 Spine 方向做。步骤：

1. 从同一个 decadent prefab bundle 导出所有 `Texture2D`（`read().image`，带 alpha），
   筛 `fx_` 前缀。c472 用的关键几张：`uv_01` 花瓣、`uv_02` 光带、`uv_06` 刀刃、
   `atlas` 火花；其余 `uv_03~05`/`mask` 是细线/噪声/遮罩，一般不用。
2. 转无损 WebP（保留 alpha）落到 `public/vfx/<模型名>/`（素材 gitignore，不入库）。
3. 在 `web/src/data.ts` 的 `VFX_MODELS` 登记 `VfxConfig`：`dir` / `duration` / 各贴图名 / `flash` 色调。
4. `VfxBurst` 组件（Canvas 2D）读配置生成粒子：slash 大贴图斜向划入、ribbon 光带、
   petal 花瓣飘散、spark 火花；带出场延迟与淡入淡出。`CharacterDetail.switchForm` 在
   `playOnce` 过渡动画时递增 `vfxSignal` 触发，与变身同步。**粒子行为是照截图手工调参，
   非逐帧 1:1**——先用 CDP 截图看效果，再调粒子数/尺寸/闪光强度。
5. 已知 9 个角色有粒子特效：c017/c019/c103/c471/c472/c513/c580/c871/c872。
   接入新角色只需加一条 `VFX_MODELS` 配置，组件与触发逻辑通用。

### 验证

- 角色页深链必须带 `#`：`http://127.0.0.1:5273/#/characters/515`（本站是 HashRouter）。
- 无头浏览器对 React 异步数据页不可靠，用 CDP + `sleep` 后再 `Runtime.evaluate`。
- **不要在无头浏览器里靠真实播放等转场完成**（rAF 极慢）。写独立测试页用
  `state.update(t)` 跳到关键帧截图（帘子合拢约 1.5s、形态②约 5.5s），验证完删掉测试页。
- 完整技巧见 `references/pitfalls.md` 第五节。

## Resources

### scripts/
- `extract_layered_spine.py` — 参数化的分层资源提取器（`--list` / `--scan` / 正式提取），
  产物与手工提取 md5 一致。

### references/
- `pitfalls.md` — 资源定位、atlas 转换、多图层取景/同步、形态判定、验证技巧的完整踩坑记录。
  排查疑难或新增角色时按需读取。
