---
name: nikke-layered-spine
description: 为 NIKKE 角色图鉴（nikke-web）提取并接入分层立绘 Spine（BG 场景层 / FG 前景层，如灰姑娘:琉璃波光的更衣帘转场）、处理第二形态切换，以及提取国服专属角色（婴宁/画皮等 c8xxx，需 NKAB v4 解密）与其大招 cut-in 动画。当需要给某个角色加形态切换按钮、还原带特效的形态转场（帘子/场景层）、排查游戏中视觉资源在 catalog 里搜不到、或要从国服客户端提取国际服没有的角色资源时使用。
agent_created: true
---

# NIKKE 分层立绘与第二形态

## Overview

nikke-web 的角色详情默认只用 `public/spine_char/<名>/` 单个 Spine 模型。本 skill 处理两类扩展：

1. **第二形态切换**：把成套的变体动画（`idle_02`/`idle_alt` 等）抽成形态①/②按钮，
   有过渡动画（`expression_0`/`_alt`）时先播变身动画。
2. **分层立绘**：个别皮肤的立绘拆成三层 Spine（BG 场景 + 角色 + FG 前景），
   三层共用相机、切形态时同步播同名动画。例如灰姑娘:琉璃波光的更衣帘——
   帘子从顶部圆形导轨转一圈遮挡，换装后打开。

## Workflow

### 判断需求类型

- 只是"给角色加形态按钮" → 走【形态切换】，通常无需提资源。
- "还原某个形态转场特效"（帘子/场景/前景动画）→ 先走【定位资源】确认有无分层，
  再走【分层接入】。
- "提取国服专属角色"（婴宁/画皮等 c8xxx，国际服 F 盘池里没有）→
  走【国服专属角色提取】，读 `references/cn-server.md`。
- 遇到"catalog 里搜 `curtain`/`change` 只有音效"的死胡同 → 读 `references/pitfalls.md` 第一节，
  不要过早下"资源不存在"的结论。

### 国服专属角色提取（NKAB v4）

国服 WeGame 客户端的资源池/清单/加密与国际服完全不同（cache + addressables JSON +
NKAB v4 加密），工具链在 `nikke_extract/scripts/decrypt_nkab_cn.py` 与
`export_char_cn.py`：

```bash
# 按中文名或 ID 提取（站姿/战斗/大招 cut-in/立绘卡 → nikke_extract/staging/）
python nikke_extract/scripts/export_char_cn.py --name 婴宁
python nikke_extract/scripts/export_char_cn.py --id 8005 --kinds all

# 游戏更新追加新密钥版本后刷新（KeySets 在客户端 settings.json 里）
python nikke_extract/scripts/decrypt_nkab_cn.py --update-keysets
```

导出后在 nikke-web 里跑 `build/build_char_spine.py --kind stand,combat,skillcut`
即自动入站（atlas 修尺寸 / PNG→WebP / 索引 json 全自动）。专属皮肤用
`--code c082_80`（SD 图与皮肤名注册等站点侧收尾见 `cn_saus/HANDOFF.md`）。
完整格式说明、字段布局与踩坑记录（双角色串包、obf 双重用途、UnityFS 对齐语义等）见
`references/cn-server.md`。大招动画 = `spotskillcutscene` bundle 里的
`<c8xx>_00_skillcut` Spine；`livewallpaperprefabs` 同 bundle 附带场景层（BG/Glow/Leaf）。

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

### nikke_extract/scripts/（上游工具链，国服部分 2026-11-20 新增）
- `decrypt_nkab_cn.py` — 国服 NKAB v4 解密器（`--update-keysets` 从客户端刷新密钥表）
- `export_char_cn.py` — 国服角色全量导出（`--name 婴宁` / `--id 8004` / `--list`），
  产物直接落 `nikke_extract/staging/`，走 build_char_spine 即可入站

### references/
- `pitfalls.md` — 资源定位、atlas 转换、多图层取景/同步、形态判定、验证技巧的完整踩坑记录。
  排查疑难或新增角色时按需读取。
- `cn-server.md` — 国服专属角色提取：客户端数据结构、NKAB v4 格式与密钥派生、
  导出流程、已验证的坑（obf 双重用途/UnityFS 对齐/cut_scene 双角色串包等）。
