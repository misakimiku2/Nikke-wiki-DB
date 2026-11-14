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
| `public/` | **不入库**。构建产物：CG 三档图、角色立绘、Spine 模型、`data/*.json` |
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
python build/build_char_hd.py             # → public/charhd      高清立绘
python build/export_char_images.py        # → public/data/char_images.json

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

## 部署

`dist/` 是纯静态产物，可整体上传到任意静态托管。注意两处体积限制：

- `public/data/search-index.json` 约 **29 MB**，超过 Cloudflare Pages 单文件 25 MiB 上限，
  需要拆分或改走对象存储
- `dist/` 约 **2.1 GB / 8455 个文件**，Cloudflare Pages 单项目上限 20000 文件，能放下但接近

素材与产物都不进 git，所以 CI 里没有素材可构建——部署方式是**本地构建后上传产物**。

## 备注

- 游戏大版本更新后，先在上游 `nikke_extract` 重跑解包，再按上面顺序重建本仓库数据。
- `build/schema.sql` 是数据库结构定义，改表结构后 `build_db.py` 会按它建库。
- `build/cg_flags.json`、`build/script_cg_map.json` 是人工校对过的映射表，属于源码而非产物，请一并维护。
