# Nikke-wiki-DB

《胜利女神：NIKKE》的本地 Wiki 站点：角色图鉴、剧情阅读器、CG 画廊、全文搜索。
数据全部来自本机客户端的离线解包结果，不联网抓取。

React 18 + Vite + TypeScript 前端，数据层是预生成的 SQLite + JSON，纯静态部署。

> **仓库范围**：本仓库只含站点源码（`web/`）与数据构建脚本（`build/`）。
> 构建产物 `public/`（约 2.1 GB 图片与 Spine 模型）、`dist/`、`data/nikke.db`
> 属于游戏版权内容且体积远超仓库限制，一律不纳入版本控制，见 `.gitignore`。

## 目录结构

| 目录 | 内容 |
|---|---|
| `web/` | 前端源码。`src/` 下有 8 个页面路由组件、`components/` 与 `theme.ts` |
| `build/` | 数据构建脚本（Python），把上游解包结果压成站点可用的 DB 与 JSON |
| `public/` | **不入库**。构建产物：CG 三档图、角色立绘 / 头像、Spine 模型、`data/*.json` |
| `data/nikke.db` | **不入库**。`build_db.py` 生成的 SQLite（约 138 MB） |
| `dist/` | **不入库**。`npm run build` 输出，约 2.1 GB，直接用于静态托管 |

前端路由：`/` 首页、`/characters` 角色列表、`/characters/:id` 角色详情、
`/story` 剧情列表、`/story/:id` 剧情阅读、`/cg` CG 画廊、`/cg/:name` 单图查看、`/search` 搜索。

## 数据来源：上游仓库

数据由 [nikke_extract](../nikke_extract) 解包产出，本仓库通过环境变量 `NIKKE_SRC`
指向它。**两个仓库需要 clone 到同一父目录下**，`export_sd.py` 会按
`../nikke_extract/scripts` 的相对路径导入上游的 `export_cg_v2`：

```
workspace/
├── nikke_extract/     # 上游：解包 StaticData、导出 CG 与剧情
└── nikke-web/         # 本仓库：压库、建图、前端
```

路径可用环境变量覆盖：

```bat
set NIKKE_SRC=E:\test\nikke_extract
```

## 环境要求

- Python 3.10+，依赖见 `requirements.txt`
- Node 20+（前端构建）
- 上游 `nikke_extract` 已经跑完，`CG/`、`主线剧情/`、`其他剧情/`、`decrypted/`、`staticdata/` 齐备

```bash
pip install -r requirements.txt
cd web && npm install
```

## 构建流程

在仓库根目录依次执行。每一步的输入都来自 `NIKKE_SRC` 或上一步的产物：

```bash
# 1. 核心：把上游分散数据压进一个 SQLite
python build/build_db.py                  # → data/nikke.db

# 2. 角色数据
python build/build_characters.py          # → data/nikke.db 的角色表
python build/export_sd.py                 # → public/char        立绘
python build/build_char_hd.py             # → public/charhd      旧版合成立绘（页面已不再引用）
python build/export_char_mi.py            # → public/charmi      官方头像（列表预览用）
python build/export_char_images.py        # → public/data/char_images.json
python build/export_char_skills.py        # → public/data/char_skills.json  技能说明
python build/export_skill_icons.py        # → public/skillicon/             技能图标（502 张）
python build/build_char_spine.py          # → public/spine_char  角色 Spine 站姿模型

# 3. CG
python build/build_images.py              # → public/img         三档转码
python build/export_cg.py                 # → public/data/cg_index.json
python build/build_spine_models.py        # → public/spine       实时 Spine 模型

# 4. 剧情与搜索
python build/export_story.py              # → public/data/story/ 分章 JSON
python build/export_search.py             # → public/data/search-index.json
python build/export_web.py                # → public/data        其余聚合 JSON

# 5. 自检与前端构建
python build/verify.py                    # 校验各产物是否齐备
cd web && npm run build                   # → dist/
```

`build/rerender_spine.py` 用于单独重渲染某个 Spine 模型，不必全量重跑。

## 角色页的渲染方式

- **列表 / 皮肤缩略图**：`public/charmi/<名>.webp`，来自游戏自带的 `icons-char-mi(hd)`
  （256×512 透明底，头部到胸口）。旧做法是把站姿渲染图按 alpha 包围盒顶部 10% 猜头部位置再裁切，
  遇到举枪、宽帽檐、长发就会裁到枪管或胸口，已弃用。
- **详情页**：`public/spine_char/<名>/` 的站姿模型实时播放，`idle / delight / angry / sad /
  surprise / shy / think / action` 等表情动画可在页面里一键切换（多的一套有 16 段，其余收在
  「更多表情」下拉里），和 CG 查看器共用同一个 `SpinePlayer`；没有站姿模型的皮肤退回官方全身立绘
  （`public/char`，即 `icons-char-full(hd)`）。
- **静态立绘一律用官方图**：`public/charhd` 是旧管线把站姿模型渲染成单帧的合成图，
  姿势/表情/上色都和官方立绘对不上（阿妮斯那张最明显），页面已不再引用，仅保留作归档。
- **技能说明**：`public/data/char_skills.json`（`export_char_skills.py`）。
  技能 ID（Locale_Skill 的 5 位数字键）= 类型前缀(1=伤害系 / 2=增益系) + 角色号(3 位) + 槽位，
  名称与描述模板取自 Locale_Skill；每级数值取自 SkillInfoTable.mpk（记录尾部的
  count + [0x01][tag][len][bytes] 值序列，按 {description_value_NN} 的索引对应）。
  前端按等级填充占位符，默认 Lv.10，可切换。覆盖 211 个可玩角色；剧情 NPC 没有战斗技能。
  描述里的 <word_group=ID>词条</word_group> 保留原样，词组解释（游戏「技能资讯」弹窗）
  存在同文件 terms 字段（Locale_Skill 的 `<ID>_<行号>_add_des`，111 组），前端点击词条弹出。
  技能图标取自 icons-skill(hd) 池（502 张 128² 独立贴图，名字即 SkillInfoTable 的 icon
  引用，icn_skill_*），导出到 `public/skillicon/<引用名>.webp`，前端按 icon 字段取用。
- 站姿模型的图集是 `pma:true`，转换规则与 CG 一致：只把 alpha=0 的像素 RGB 清零，
  lossless WebP + `exact=True`，不要二次预乘。

## 部署

`dist/` 是纯静态产物，可整体上传到任意静态托管。注意两处体积限制：

- `public/data/search-index.json` 约 **29 MB**，超过 Cloudflare Pages 单文件 25 MiB 上限，
  需要拆分或改走对象存储
- `dist/` 约 **3.8 GB / 10700 个文件**，Cloudflare Pages 单项目上限 20000 文件，能放下但接近
- 若 `npm run build` 因为无权限清空旧 `dist/` 失败（批量删除保护），可以构建到新目录再换名：
  `cd web && npx vite build --outDir ../dist_new`，然后 `mv dist dist_old && mv dist_new dist`

素材与产物都不进 git，所以 CI 里没有素材可构建——部署方式是**本地构建后上传产物**。

## 备注

- 游戏大版本更新后，先在上游 `nikke_extract` 重跑解包，再按上面顺序重建本仓库数据。
- `build/schema.sql` 是数据库结构定义，改表结构后 `build_db.py` 会按它建库。
- `build/cg_flags.json`、`build/script_cg_map.json` 是人工校对过的映射表，属于源码而非产物，请一并维护。
