# 上线与收录：需求 + 执行清单

> 交接文档。写于 2026-11-18 23:0x，仓库 HEAD = `51e3290`，工作区干净。
> 目标读者：接手继续做的 Agent（也可以是三个月后的自己）。
> 相关背景在 `README.md`（构建流程、目录约定、部署章节）。

## 0. 执行进度（2026-11-19 更新）

**A、B 两个任务包已全部做完**（详见下方原文），提交记录：A1 = `4116991`，B0 = `339e344`，B1–B4 见其后一笔。

- **A1 拆索引** ✅ `public/data/search/{0..3}.json` + `manifest.json`，4 片各约 7 MB；
  旧单文件不再生成（**注意 dist 不清空，历史残留要手删**，deploy 脚本的体检会拦）。
- **A2 / A3** ✅ 深链接回退与 robots 先拦后放，源文件后来移到 `build/site/`（`63e7c7c`），见 README 约定。
- **B0（新发现的隐藏前置）** ✅ 原来是 **HashRouter**，爬虫眼里全站只有一个 URL，B1 无从谈起；
  已切 BrowserRouter（`main.tsx` + CharacterDetail 的 calib 正则两处）。
- **B1 预渲染** ✅ `build/prerender_seo.mjs`（无第三方依赖），已接进 `web/package.json` 的 build 链，
  每次 `npm run build` 自动产出 2452 页 + sitemap；角色页塞名字/简介/技能名，剧情页塞标题/首段，
  CG 页塞名字/分类/缩略图；og:image 用 charhd（13 个角色无图则省略）。
- **B2 sitemap** ✅ 2456 条（首页 + 3 列表页 + 2452 详情）。
- **B3 放行** ✅ `web/index.html` 去掉 noindex 并补首页 description；robots.txt 换成 Allow + Sitemap。
- **B4 usePageTitle** ✅ `web/src/usePageTitle.ts`，三个详情页已接入。
- **B5 404 页** ⏭ 决定不做：保留 A2 的通配回退，未知路径由 SPA 内的 404 Stub 页接管（二者取一，取 SPA）。
- **部署脚本** ✅ `build/deploy_pages.sh`（构建 → 25 MiB/20000 文件体检 → `wrangler pages deploy dist`）。
- **待办（需要人）**：① `wrangler login` 后跑一次部署，**以 wrangler 输出的 URL 为准**，
  若不是 `https://nikke-db-wiki.pages.dev`，改 `build/prerender_seo.mjs` 的 `SITE_URL` 和 `build/site/robots.txt`
  两处后重新构建上传；② 提交 sitemap 到 Google Search Console。百度按放弃处理（境外托管 + 无备案）。

原任务描述保留如下，字段名/做法细节仍可参考。

## 1. 需求（用户原话的意思）

站点内容「差不多」之后就**公开上线，并让搜索引擎收录**，而不是无限期修复细节。

判断「差不多」的标准不是零瑕疵，而是这三条同时成立：

1. **能部署成功** —— 不撞托管平台的体积 / 文件数 / 单文件上限；
2. **链接不 404** —— 深链接（如 `/characters/94`）直接打开或刷新都能出页面；
3. **内容能被爬虫抓到** —— 详情页在**不执行 JS** 的爬虫眼里也有可读内容和独立标题。

第 3 条目前是 0 分，且是这个项目最容易被忽略的一环（见下）。

## 2. 现状体检（2026-11-18 实测，别再重复查）

| 项 | 现状 | 影响 |
|---|---|---|
| `<title>` | 全站共用 `NIKKE 资料库`，代码里**没有任何 `document.title` 更新** | 312+489+1651 = 2452 个详情页在爬虫眼里是同一页 |
| `robots` meta | `web/index.html` 里 `<meta name="robots" content="noindex, nofollow">` | 全站禁止收录 |
| description / canonical / OG | 全部没有 | 搜索结果摘要和分享卡片都是空白 |
| `sitemap.xml` / `robots.txt` | 没有 | 爬虫没有入口 |
| SPA 回退 | 没有 `_redirects` / `404.html` | `/characters/94` 刷新即 404 |
| 搜索索引 | `public/data/search-index.json` = **26.75 MB** | 超过 Cloudflare Pages 单文件 25 MiB，**部署会直接失败** |
| 素材体积 | `public/` 6.4 GB；`dist/` 约 10700 文件（README 记 3.8G/10700，已增长） | Pages 上限 20000 文件，接近但仍有余量 |
| 渲染方式 | 纯客户端 SPA（React 18 + Vite） | 百度基本不执行 JS → 不预渲染等于没内容 |

路由规模（预渲染要用）：角色 **312**、剧情 **489**、CG **1651**。

## 3. 任务 A：技术上线闸（先做，改动小，不碰渲染逻辑）

### A1. 拆搜索索引（硬阻断，必须）

- 现状：`build/export_search.py` 产出单文件 `public/data/search-index.json`，
  结构是 `[文本, 单元ID, 说话人, 单元内行号]` 的扁平数组，按 `unit_id → segment.sort_order → line.seq` 排序。
  行号是**在导出时按顺序累加**的，所以**同一个 unit 的所有行必须落在同一个分片**，否则行号错位、跳转定位会错。
- 做法：
  1. `export_search.py` 改为按 **连续 unit 区间** 分 N 片（建议 4 片，每片约 6–7 MB），
     输出 `public/data/search/0.json … N-1.json` + `public/data/search/manifest.json`
     （记录分片数、每片覆盖的 unit 区间、总行数）。
  2. `web/src/pages/Search.tsx` 的 `useEffect` 里把单次 `fetch('/data/search-index.json')`
     改成读 manifest → `Promise.all` 拉所有分片 → 拼接后 `setIdx`。
     搜索逻辑（`row[0].toLowerCase().includes(k)`，`LIMIT = 200`）不用改。
  3. 旧单文件不再生成；`public/` 是忽略目录，直接删掉即可。
- 验收：`python build/export_search.py` 后每个分片 < 20 MB；搜索页能出结果、点结果能跳到剧情对应行。

### A2. SPA 深链接回退

- 新增 `public/_redirects`（`publicDir` 是 `../public`，构建时会带进 `dist/`）：

  ```
  /*  /index.html  200
  ```

- 验收：`npm run build` 后 `dist/_redirects` 存在；部署后任意深链接直接打开不 404。
  注意：真实存在的静态文件优先级更高，所以 A2 不影响 B 阶段生成的预渲染页面。

### A3. robots.txt（先拦、后放）

- 新增 `public/robots.txt`。A 阶段先写：

  ```
  User-agent: *
  Disallow: /
  ```

- B 阶段完成后改成 `Allow: /` 并加 `Sitemap:` 行（见 B3）。
- 注意：`noindex` meta 在 A 阶段保留不动。

## 4. 任务 B：收录闸（收益最大，需要动构建流程）

### B1. 每个详情路由预渲染静态 HTML（核心）

- 目标：`dist/characters/94/index.html`、`dist/story/123/index.html`、`dist/cg/xxx/index.html` 等约 **2452** 个文件，
  每份都是 `dist/index.html` 的副本，但：
  - `<title>` 换成实体标题，如 `贝斯蒂：战术升级 · NIKKE 资料库`；
  - `<meta name="description">` 用现成数据里的简介截 80–120 字；
  - `<link rel="canonical" href="https://<域名>/characters/94">`（同时解决 `?theme=light` 这类查询参数造成的重复内容）；
  - OG / Twitter 卡片（`og:title` / `og:description` / `og:image`，图片用 `public/char_mi` 或 `charhd`）；
  - 在 `<div id="root">` 里塞一段**可读的正文摘要**（角色名、简介、技能名；剧情标题 + 首段；CG 名 + 所属活动），
    React 挂载后会整棵替换，用户无感。
- 实现建议：新建 `build/prerender_seo.mjs`（Node，无第三方依赖），构建后执行：
  `node build/prerender_seo.mjs`，读 `dist/index.html` + `public/data/*.json`，写各路由文件。
  **不要用 puppeteer 逐页截图式预渲染**（2452 页会跑几小时）。
- 数据来源：`public/data/characters.json`（items 有 id/name/desc）、`story_index.json`、`cg_index.json`、
  `char_skills.json`、`char_images.json`。字段名先读现有导出脚本确认，别猜。
- 验收：`curl -s file://.../dist/characters/94/index.html | grep '<title>'` 得到实体标题；
  页面在浏览器里打开与线上 SPA 表现一致（内容被 React 替换，不出现两遍）。

### B2. sitemap.xml

- `build/prerender_seo.mjs` 顺手生成 `dist/sitemap.xml`：首页 + 列表页（/characters /story /cg）+ 2452 个详情页。
  URL 用 canonical 里的绝对地址（域名写在一个常量里，改域名只改一处）。
- 超过 5 万条才需要拆 sitemap，现在不用。

### B3. 去掉 noindex + robots 放行

- `web/index.html`：删掉 `<meta name="robots" content="noindex, nofollow">`。
- `public/robots.txt` 改成：

  ```
  User-agent: *
  Allow: /

  Sitemap: https://<域名>/sitemap.xml
  ```

### B4. 每页更新 document.title（对 Google 有效，对百度靠 B1 的静态 HTML）

- 在 `CharacterDetail` / `StoryReader` / `CgView` 等详情页的 `useEffect` 里设置
  `document.title = '<实体标题> · NIKKE 资料库'`，卸载时还原。抽一个 `usePageTitle(str)` hook 复用。

### B5. 404 页（建议，不阻断）

- `public/404.html` 放一个简单的「页面不存在 → 回首页 / 搜索」页。
  Cloudflare Pages 会自动对未命中路径用它（配合 A2 的 `_redirects` 时注意优先级：
  若希望未知路径回退到 SPA，保留 A2；若希望展示 404 页，就去掉 A2 的通配规则，二者取一）。

## 5. 顺序与验证

1. A1 → A2 → A3，`npm run dev` 自测 + `npm run build` 检查 `dist/_redirects`。
2. 部署一次（首次上传 6.4 GB，很慢），确认：首页、角色页、深链接刷新、搜索、CG 灯箱都正常。
3. B1 → B2 → B4 → B3（顺序别反：先有内容再放行收录）。
4. 提交 sitemap 到 Google Search Console + 百度站长平台；收录是慢过程（Google 几天，百度 1–4 周），
   这期间**不要改 URL 结构**。

## 6. 已知事项 / 不要当回归

- c094_00 五官白边、c094_01 黑色碎片错位已修（`5126e92`），图集失配规则见 README「图集尺寸错配的两种情形」。
  若重建素材后问题复发，先看 `public/spine_char/<名>/` 是否被旧构建覆盖、以及构建日志里是 `[atlas fix]` 还是 `[atlas keep]`。
- `build_char_spine.py` 的 `--size` 降采样分支仍在 PMA 空间用 LANCZOS（默认不启用）。要用 `--size` 前先按
  `_stretch_page_straight` 的思路改成直通 alpha 重采样，否则边缘会出白点。
- 其余角色可能仍有零星贴图瑕疵：**按规则批量修，不要逐个手改**。
- 素材不入库（`public/` 全忽略）；人工配置都在 `build/`（`spine_overrides.json`、`cg_flags.json`），
  vite 会在 dev/build 前把前者同步进 `public/data/`。不要把手改文件放回 `public/`。
- 构建上下文写在 `public/build-meta.json`（游戏版本指纹 + commit），排障时先看它。

## 7. 待和用户确认

- 托管选型（Cloudflare Pages？境外托管 + 无备案会让百度抓取变慢，若主要面向百度需要单独讨论）。
- 正式域名（sitemap / canonical 需要写死）。
- 预渲染摘要的口径：角色页要不要把技能描述也塞进去（有利于长尾搜索，但会拉长 HTML）。
