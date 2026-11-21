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
| `build/` | 数据构建脚本（Python）+ **人工维护的配置**（`cg_flags.json`、`spine_overrides.json`、`ref_characters.json`），把上游解包结果压成站点可用的 DB 与 JSON |
| `public/` | **不入库**，全部是生成物：CG 三档图、角色立绘 / 头像、Spine 模型、`data/*.json`、`build-meta.json` |
| `data/nikke.db` | **不入库**。`build_db.py` 生成的 SQLite（约 138 MB） |
| `dist/` | **不入库**。`npm run build` 输出，约 2.1 GB，直接用于静态托管 |

前端路由：`/` 首页、`/characters` 角色列表、`/characters/:id` 角色详情、
`/story` 剧情列表、`/story/:id` 剧情阅读、`/cg` CG 画廊、`/cg/:name` 单图查看、`/search` 全站搜索、
`/notice` 公告列表、`/notice/:slug` 公告详情（slug 发布后不要改，免得外链失效）。

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
- Node 20+（前端构建；`export_char_messages.mjs` 用 `node:sqlite`，需要 Node 22.5+）
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
python build/export_ui_icons.py equip     # → public/equipicon/             装备图标（95 张，按 Sprite 切图）
python build/export_ui_icons.py buff      # → public/staticon/              属性图标（HP/ATK/DEF 等 145 张）
python build/export_ui_icons.py equip --only "ie_"   # → 魔方图标 ie_XXXXX（256²，透明底）
python build/normalize_cube_icons.py                 # 统一裁紧 / 缩放，写入 public/cubeicon/
#   魔方图标在 dp 池 icons-equip(hd) 图集里，命名规则 ie_{外观ID}。
#   外观ID 来自 ItemHarmonyCubeTable 的「外观/主题色」那一列，**不等于序号**：
#   例如 7 号量子魔方是 11001、8 号体力神器是 13001、18 号外框是 10015。
#   图集里共 23 个 ie_ 立方体，其中若干是旧版遗留，实际用到的 18 个见 cube_stats.json 的 iconId。
python build/export_ui_icons.py "icons-favoriteitem(hd)" --out favoriteicon --only "si_favoriteitem_ar_00,si_favoriteitem_mg_00,si_favoriteitem_rl_00,si_favoriteitem_sg_00,si_favoriteitem_smg_00,si_favoriteitem_sr_00,favoriteitem_common_prop_00,favoriteitem_common_prop_01,favoriteitem_common_prop_02"
#   珍藏品图标：6 职业 Q 版娃娃（R/SR 共用），dp 池 icons-favoriteitem(hd)
python build/build_char_spine.py          # → public/spine_char  角色 Spine 站姿模型
python build/export_char_voices.py        # → public/voice + public/data/char_voices.json 角色语音（日配 + 国服中配 + 国际服英配/韩配）
#   英/韩语音来自游戏内下载的语言包：<patch>/en、<patch>/ko（结构同 ja 池）。
#   每种语言每个角色一条 OGG 雪碧图，保留每条语音的起止秒数。
# 角色三围（HP/ATK/DEF）由 nikke_extract 生成：python scripts/export_char_stats.py
#   → staging/char_stats.json、staging/stat_curves.json，拷到 public/data/ 即可
# 装备与魔方同理：python scripts/export_equip.py / export_cubes.py
#   → staging/equip_stats.json、staging/cube_stats.json，拷到 public/data/ 即可
# 珍藏品：python scripts/export_favorites.py
#   → staging/favorite_stats.json（12 款 × 16 级三围），拷到 public/data/ 即可

# 3. CG
python build/build_images.py              # → public/img         三档转码
python build/export_cg.py                 # → public/data/cg_index.json
python build/build_spine_models.py        # → public/spine       实时 Spine 模型
node build/gen_cg_merges.mjs              # → build/cg_merges.json 合并收录表（图集贴图页自动识别 + 人工条目）
python build/fill_spine_backgrounds.py    # → build/spine_overrides.json 补动态 CG 查看器背景
#   （消费上游 CG索引/动态CG背景对照.csv 的「建议背景」列；人工标注优先，可重复运行）

# 4. 剧情与搜索
python build/export_char_stories.py       # → public/data/char_stories.json 好感剧情映射
python build/export_counsel_flow.py       # → public/data/counsel_flow.json 咨询分支流
python build/export_story.py              # → public/data/story/ 分章 JSON（读上面的映射改标题）
python build/export_search.py             # → public/data/search-index.json
python build/export_web.py                # → public/data        其余聚合 JSON
node build/export_char_messages.mjs       # → public/data/char_messages.json 角色巴拉短信（依赖 characters.json）
node build/export_story_sms.mjs           # → public/data/story_sms.json 剧情内嵌短信映射（依赖 story/<id>.json）

# 4.5 剧情卡封面（必须排在 export_web.py 之后：它会写回 story_index.json 的 cover）
python build/build_story_covers.py            # 评分选图 + 生成 public/cover/
python build/build_story_covers.py --report   # 只看选图会怎么变，不写文件
python build/build_story_covers.py --only 1,2 # 只重选指定单元

# 手动指定封面（两个途径，都写进 build/cg_cover_overrides.json，优先级高于自动选图）：
#   1) 编辑后台：npm run dev 后打开 /story/covers（剧情全文页也有「封面编辑」入口）。
#      选该单元已链接的 CG 或全库搜索；3:4 预览里拖动平移、滚轮/滑块缩放。
#      只保存 {单元id: {h, crop:{cx,cy,zoom}}}，封面由 build_story_covers.py 从
#      manifest 已有的原图现裁，不新增任何尺寸的 CG 图片；保存即重新生成该封面。
#   2) 直接改 JSON：{"单元id": "hash"} 沿用自动取景；值也可以是 public/cover/ 下
#      现成的文件名（如 skyontherock_cover），用于没有 CG 的活动主视觉。
# 动态 CG：候选列表里带 ▶ 的条目是实时 Spine 模型；选中后可用时间轴播放/拖动定位，
#   保存时抓当前帧转成 3:4 封面（写 public/cover/frame_<模型>_<毫秒>.webp）。
#   只存参数/帧文件，不改 CG 原图。

# 5. 自检与前端构建
python build/verify.py                    # 校验各产物是否齐备
cd web && npm run build                   # → dist/
VITE_NO_PUBLIC=1 npm run build            # 只出 assets，不拷 6G 素材（改 UI 时用）
```

`build/rerender_spine.py` 用于单独重渲染某个 Spine 模型，不必全量重跑。

### 多语言（简中 / 英文 / 韩文 / 日文）

- **文本**：`Locale_*.lsc` 本身是十语并列的 SQLite（`zh-CN / en / ja / ko / zh-TW / de / th / fr / es`）。
  `build_db.py` 的 `backfill_line_locale()` 会按台词 key 从所有 `Locale_*` 表回填
  `story_lines.text_en / text_ko / text_ja`，不依赖上游剧情 JSON 是否带这些字段；
  主线/活动之外的个人剧情、支线、咨询、日常也一次补齐。
- **角色 / 技能**：`build_characters.py` 读取 `desc_ja/desc_ko`、`intro_en/intro_ja/intro_ko`；
  `skill_strings` 本来就带 en/ja/ko，`export_char_skills.py` 输出
  `nameEn/nameKo/nameJa/descEn/descKo/descJa` 与 `termsEn/termsKo/termsJa`。
- **巴拉短信**：`export_char_messages.mjs` 在行尾追加英文/韩文/日文三列，前端按内容语言切换。
- **语音**：在游戏内把语音语言切到 English / 한국어，客户端会下载到 `<patch>/en`、`<patch>/ko`
  （与 `ja` 池同构）。`export_char_voices.py` 扫描三个池，输出 `.en.ogg` / `.ko.ogg` 雪碧图与每条的时间轴；
  日配就是主雪碧图 `<id>.ogg`，无需单独提取。
- **剧情标题**：`story_index.json` 的 `titles`、剧情分片每段的 `ts:[en,ko,ja]`、`char_stories.json` 的记录 `ts`
  与章节 `ts`（Locale_NikkeEpisode 官方章节名）由 `export_web.py / export_story.py / export_char_stories.py`
  按 bucket 前缀查 Locale 表生成；主线小节名来自 `build/main_section_names.json`
  （上游 `export_main_section_names.py` 现输出四语）。覆盖率见 `verify.py` 输出
  （main/side_story 单元 100%、nikke 89%、event 51%、sub 71%；查不到官方译名的一律回退中文）。
- **CG 剧情链接**：`export_cg.py` 给每条链接回填 `l4/s4/p4`（段落首句台词、说话人名、段落标题的
  en/ko/ja，来源 story_lines 四语列 + 角色档案 + Locale 标题/主线段名表）；无官方译名的（旁白、
  NPC 说话人、event 段名等）回退中文原文。
- **部队名**：`public/data/squad_names.json`（export_char_meta.mjs 产出）提供部队名与世界观介绍的四语译名，
  key 为中文名；人工部队名无官方译名不进表。
- **搜索**：`export_search.py` 按语言输出四套分片（manifest v2：`shards: {zh,en,ko,ja}`），
  前端按内容语言加载对应分片搜索，行号跨语言对齐。
- **界面**：顶栏 `中 / EN / KO / JA` 切换游戏内容文本与界面 chrome；界面文案词典在 `web/src/ui.ts`
  （四列元组，缺 key 回退简中）。公告正文仍为中文。

### 重新提取分层立绘素材（FG/BG）

`public/spine_layer/` 不入库，换机器后需从游戏资源重新提取。主模型在 `spine/standing/` 组，
但 BG/FG 层藏在 **dp 池 `spinestandingprefabgroup` 的 `00_decadent` prefab bundle** 里，
上游 `export_char_standing.py` 只取主模型、不含这层，需要单独跑一段脚本：

- 数据源：`../nikke_extract/catalogs/dp_catalog.ndb.dec`（SQLite）+ 游戏 patch 的
  `dp/chunk/store.cdb`（路径见 `nikke_extract/scripts/config.py` 的 `GAME_PATCH`）
- 复用 `export_cg_v2.rebuild(cat, cidx_map('dp'), store.cdb, zstd_decomp, file_id, size)` 重组 bundle
- SQL 找目标：`select file_id,key from files_chunktype where lower(key) like
  '%spinestandingprefabgroup%c515%decadent%' and lower(key) like '%hd%'`
- `UnityPy.load(io.BytesIO(bundle))` 后取 `TextAsset`（`*_fg.atlas` / `*_fg.skel` /
  `*_bg.atlas` / `*_bg.skel`）与 `Texture2D`（`read().image` 存 PNG）
- 落到 `public/spine_layer/<名>_fg/`、`<名>_bg/`，**PNG 转无损 WebP**（`lossless=True, exact=True`），
  并把各自 atlas 首行的 `<名>.png` 改成 `<名>.webp`（`pma:true` 原样保留）
- 三层共用同一相机坐标系，无需额外校准即可对齐；层名在 `data.ts` 的 `LAYERED_MODELS` 登记

构建用的是 `emptyOutDir: false` + 自定义的 `cleanDistAssets` 插件：每次只清 `dist/assets`
里的 hash 产物，`dist` 下的素材副本原地覆盖。这样避免整份 6G 的 `dist` 被删了再拷，
也避免本机的删除操作把 6G 塞进回收站。代价是**如果 `public/` 里删了文件，`dist/` 里的旧副本
不会自动消失**，需要时手动删对应目录即可。

## 角色页的渲染方式

- **列表 / 皮肤缩略图**：`public/charmi/<名>.webp`，来自游戏自带的 `icons-char-mi(hd)`
  （256×512 透明底，头部到胸口）。旧做法是把站姿渲染图按 alpha 包围盒顶部 10% 猜头部位置再裁切，
  遇到举枪、宽帽檐、长发就会裁到枪管或胸口，已弃用。
- **详情页**：`public/spine_char/<名>/` 的站姿模型实时播放，`idle / delight / angry / sad /
  surprise / shy / think / action` 等表情动画可在页面里一键切换（多的一套有 16 段，其余收在
  「更多表情」下拉里），和 CG 查看器共用同一个 `SpinePlayer`；没有站姿模型的皮肤退回官方全身立绘
  （`public/char`，即 `icons-char-full(hd)`）。
- **形态切换**：有第二形态的角色，把成套变体动画（`idle_02` / `idle_alt` / `angry_02` …）
  抽出来做成形态①/②按钮，切换整套表情；有过渡动画的（`expression_0` = ①→②，
  `expression_0_alt` = ②→①）会先播变身动画再停在目标形态。判定在 `data.ts` 的
  `detectFormVariants`，不做换装强度筛选；`FORM_FALSE_POSITIVES` 排除少数源数据异常
  （坎西 c402/c403 的「默认表情」其实是 action 副本、小红帽 c470 的只是静态差分红眼）。
- **分层立绘（BG / FG）**：个别皮肤的立绘拆成三层 Spine 叠加——`spine_char` 主模型 +
  `public/spine_layer/<名>_bg/`（场景）+ `public/spine_layer/<名>_fg/`（前景，如更衣帘），
  三层共用相机取景、切形态时同步播同名动画。目前只有灰姑娘:琉璃波光（c515，帘子从顶部导轨
  转一圈遮挡的换装演出）配了，映射写在 `data.ts` 的 `LAYERED_MODELS`，加角色只需加一条。
  ⚠️ 这些素材不入库（`public/` 被 gitignore），换机器 / CI 重建需重新提取，方法见下方。
- **大招 cut-in**：姿态切「大招」，播放 `public/spine_skillcut/<名>/` 的实时模型（约 233 个，
  `bySkin`/`byChar` 两级映射在 `char_spine_skillcut.json`，构建期算好）。大招动画段命名混乱
  （`skillcut_1` / `skillcut_0` / `skilcut_1` / `skill_cut` / `_OFF` 三段式…），由 `data.ts` 的
  `pickBurstAnim` 统一挑选；有手绘背景图的模型额外铺 `sceneBg` 世界坐标层（跟随运镜缩放/拖拽）。
  ⚠️ **13 个模型的 `skillcut_1` 是纯背景层**（全程只有 1 个 `bg` 附件，无角色部件），角色本体在
  `skillcut_0` / `skillcut_2` 段——游戏里这些段分层同时渲染，我们只播一段，按通用规则会命中背景段，
  表现为「大招只有背景图」。`BURST_CHAR_SEGMENT` 按模型名覆盖为角色段。判定方法：逐段采样
  0/25/50/75/99% 五点的可见槽位数（切到该模型的真实 skin；背景段全程 ≤23，角色段 ≥108）。
  资源更新后若又出现「只有背景」，用同样方法找出模型名与角色段，往表里加一条即可。
  - **角色+背景合并演出**：上面 13 个里已验证 3 个（艾玛:战术升级 c093、贝斯蒂:战术升级 c094、
  蕾贝儿 c582）的背景段与角色段共用同一套运镜，游戏里是两个骨架实例分别播再叠加。
  `BURST_BG_SEGMENT` 配背景段动画名，`SpinePlayer` 的 `bgSegment` prop 会加载同一模型的
  第二个独立骨架（z=-1）播它、与主角色时间同步。⚠️ 不能用同骨架第二轨道——两段骨骼变换会
  互相覆盖，只剩背景（历史踩坑）。其余 10 个背景段多为纯色板/特效，未逐一验证叠加观感，
  暂只播角色段；要新加照上面方式先离线渲染确认。
  ⚠️ 素材不入库，重建见 `nikke_extract` 的 `export_char_cutins.py` / `build_char_spine.py --kind skillcut`。
- **图集尺寸错配的两种情形**（`build_char_spine.py` 的 `rescale_atlas_pages()`，
  比例失配 >5% 才介入，2~3px 的 2 的幂取整差异不动）：
  - **实际 < 声明（压扁页）**：如 c094 第二页声明 2048×1398、实际只有 2048×1024。
    坐标按声明排布，所以必须把贴图拉伸回声明尺寸，atlas 原样保留（脚本打印 `[atlas fix]`）。
    拉伸要在「直通 alpha」空间做（`_stretch_page_straight`：解预乘 → 颜色/alpha 分别插值 →
    重新预乘）；直接在 PMA 数据上 resize 会把透明黑混进边缘 RGB，拉回后每个部件边缘残留
    一圈暗描边，紧贴偏亮的五官叠加层就成了眼睛/鼻子周围那圈白边。
  - **实际 > 声明（放大页）**：如 c094_01 青涩新生声明 1930、实际 2048²，整页被等比放大到
    2 的幂画布、内容跟着拉伸。归一化 UV（bounds ÷ 声明尺寸）采样时会自动乘到实际像素，
    **atlas 一个字都不能改**（脚本打印 `[atlas keep]`）。早先这里按比例缩放 bounds/offsets，
    部件世界尺寸会整体放大（c094_01 多 6%，裙摆/丝袜错位），rotate:90/270 的 region
    取样区还会偏掉、采到隔壁黑色 sprite，表现为边缘冒出的黑色三角碎片。
  改完要 `--force` 重建受影响的模型：站姿 c094_01/c200_00/c223_01/c230_00/c840_00/
  c840_01/c912_00，战斗 c150_aim_00/c150_aim_02/c150_cover_01，大招 c082_00_skillcut。
- **静态立绘一律用官方图**：`public/charhd` 是旧管线把站姿模型渲染成单帧的合成图，
  姿势/表情/上色都和官方立绘对不上（阿妮斯那张最明显），页面已不再引用，仅保留作归档。
- **好感剧情（个人剧情 + 咨询）**：详情页底部 `storybox` 区块，按角色内容显示
  个人剧情 / 咨询 / 语音 1–3 个 tab；巴拉短信在其下方单独成块（`#msgbox`）。
  映射来自 `public/data/char_stories.json`（`export_char_stories.py`）：bucket 后缀与角色
  英文名匹配（皮肤变体本来就是独立角色 id，如 17=阿妮斯：超级巨星），皮肤中文名从咨询
  会话标题解析。个人剧情卡点进 `/story/:id` 阅读器（标题已换成「角色名·个人剧情」）；
  咨询在页内以对话流呈现，**按选项裁剪分支**：`export_counsel_flow.py` 解析引擎
  脚本表 `staticdata/AttractiveCounselDialogTable.<会话>.mpk` 的 next 指针
  （记录尾部的跳转串，仅非顺序跳转时存在），还原「选项→分支内容→汇合」的走向；
  选项组由文本分类给候选、指针确认（组首行必须有跳过下一行的指针，
  开头旁白/铺垫误并的组逐级去首重试），最后要求所有选项组合的路径并集
  覆盖全部行才导出（99.4% 会话通过）。前端 `CounselChat.tsx` 沿指针游走渲染：
  未选选项时只显示到选项卡为止（必须选择才能往下，同游戏），选了哪支就只显示
  哪支的后续。个别源数据把选项后续做成玩家连续台词（ade_agentbunny_06
  「不是。」→「两个都喜欢。」），指针本身表达了这个彩蛋。
  `export_story.py` 依赖本映射改阅读器标题，须先于它运行。
- **角色语音**：详情页 `storybox` 的「语音」tab。语音清单来自
  `staticdata/CharacterVoiceGroupTable.mpk`（说明 key / 语音 ID / 台词 key 三连），
  日文/国际服中文台词取 `Locale_Character`，国服中文台词取国服客户端自己的
  `runtime_data/saus/saus/lss/Locale_Character.lss`（国服翻译与国际服 zh-CN
  可能不同，中配列表显示国服文本、日配列表显示国际服文本）。角色页「声优」
  取国际服 `{id}_cv_ja`，语音区额外显示国服 `{id}_cv_zh_cn` 的中配声优。
  日语音频取国际服 `ja` 池；中文音频取国服客户端 `runtime_data/saus/zh_cn/ab/*.nab`
  （默认路径可用环境变量 `NIKKE_CN_ROOT` 覆盖），按语音 ID 能对上多少提取多少。
  每个角色每种语言拼成一条 OGG 雪碧图（`public/voice/<id>.ogg`、
  `public/voice/<id>.zh.ogg`），前端按 `char_voices.json` 里的 start/end
  用 Web Audio 分段播放；这样 1 万多条语音只生成 300 多个文件，不会顶爆静态
  托管的文件数上限。每条语音之间留 0.4s 静音。国服版本落后，中文覆盖不全：
  中配列表只显示确实有中文音频的条目，日配列表保留全套；中配模式下会提示
  还差多少条，整个角色没有中文时只显示日配。好感度大厅语音的 bundle 是
  国服客户端按角色/皮肤按需下载的，本机没在游戏里播放过时也会有 4 条
  （Touch 1~3 / Stay 1）缺失；页面只按实际提取结果提示「国服缺少 N 条」，
  不区分未下载与未上架。
  联动角色（2B / 千束 / Persona 等）
  国服没有中配、语音池里放的是日语原声，用国服 `cv_zh_cn` 与日配 `cv_ja` 相同
  来识别并归为仅日配。皮肤有独立语音时会标注皮肤名。
- **巴拉短信 / 主线短信**：详情页好感剧情区块下方的独立「巴拉短信」区域。
  「切换聊天」会打开覆盖聊天区的二级会话列表（全部 / 聊天 / 群组），
  带搜索、头像、最后一句预览，列表不设内部滚动条；
  数据来自 `public/data/char_messages.json`（`build/export_char_messages.mjs`，Node 脚本）。
  消息行取 `staticdata/MessengerDialogTable.mpk`，文本取 `Locale_SuddenMessage`；
  `m_ex_*` 归为「巴拉聊天」，`m_mainafter_*` 归为「主线短信」，测试房间不导出。
  私聊按房间 slug 精确匹配角色 / 皮肤（`marian_P` → 神罚、`anne_miraclefairy` →
  安妮：奇迹仙女、`rupee_wintershopper` → 露菲：冬日购物狂），群聊按
  `MessengerRoomTable` 成员并补上实际发过言的人。表格里 `f6=2` 的连续行是玩家
  可选回复，`ref` 是分支 / 合流跳转目标；前端沿跳转游走，支持选择与「重选」。
  剧情全文不再单独列「剧情内短信」单元：MessengerDialogTable 里的独立巴拉房间
  由角色页展示，剧情内嵌短信由 `build/export_story_sms.mjs` 映射回各自剧情单元，
  在阅读器对应段落、对应台词之间直接以巴拉短信气泡呈现（优先读
  `ScenarioDialogTable.*` / `EventScenarioDialogTable.*` 场景脚本里的真实触发点，
  找不到才退回房间 key 前缀匹配）；「日常对话」分类只保留气泡、
  场地、活动短对话等 7 类。
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

## 部署与日常更新

**站点已上线：https://nikke-db-wiki.pages.dev**（Cloudflare Pages 免费版，2026-11-19 首次部署）。

`dist/` 是纯静态产物；素材与产物都不进 git，所以不能用 Pages 的 Git 自动构建——
部署方式是**本地构建后上传产物**，脚本一键完成：

```bash
bash build/deploy_pages.sh   # 构建（tsc + vite + 预渲染 SEO 页）→ 体检 → wrangler 增量上传
```

- 上传按文件内容哈希去重：没改的文件不重传，日常小改动几十秒到几分钟传完
- 体检会拦截单文件超 25 MiB（Pages 上限）和总数超 20000 的部署
- 生效速度：HTML 立即生效；`/data/*.json` 有 5 分钟 CDN 缓存（见 `build/site/_headers`）
- 前置（只需一次）：`npm install -g wrangler` + `wrangler login`；
  项目名默认 `nikke-db-wiki`，可用 `NIKKE_PAGES_PROJECT` 环境变量覆盖
- 域名常量在 `build/prerender_seo.mjs`（`SITE_URL`，影响 canonical / sitemap / og:url）
  和 `build/site/robots.txt`（Sitemap 行）两处；换域名两处一起改

**日常更新对照**（改完跑一次上面的部署命令即可）：

| 想改什么 | 改哪里 |
|---|---|
| 角色 / 剧情 / CG 数据（游戏版本更新） | 对应 build / export 脚本重建 `public/`，流程见上文「构建」章节 |
| 前端界面 / 文案 / 样式 | `web/src/` |
| 发布网站公告 / 更新日志 | `web/src/notices.ts`（数组头部加一条，slug 保持稳定） |
| 站点根配置（robots / SPA 回退 / 缓存头） | `build/site/`（入库源文件，`public/` 里的是同步副本） |
| 人工标注（模型覆盖 / CG 封面标记 / 合并收录） | `build/spine_overrides.json` / `build/cg_flags.json` / `build/cg_merges.json` |
| 详情页 SEO（标题 / 摘要 / OG 规则） | `build/prerender_seo.mjs` |
| 首页标题与描述 | `web/index.html` |

注意：更新内容不影响搜索引擎收录（Google 会自动抓新版），但**不要改 URL 结构**
（`/characters/<id>`、`/story/<id>`、`/cg/<名>` 已进 sitemap）。

历史备注：旧的单文件 `search-index.json`（29 MB 超 Pages 25 MiB 上限）已拆分为
`public/data/search/{0..3}.json` + `manifest.json`；`dist/` 现约 17900 个文件，接近但低于 20000 上限。
若 `npm run build` 因为无权限清空旧 `dist/` 失败（批量删除保护），可以构建到新目录再换名：
`cd web && npx vite build --outDir ../dist_new`，然后 `mv dist dist_old && mv dist_new dist`

为此留了两个约定：

- **素材来源可追溯**：每次跑 `build_char_spine.py` / `build_spine_models.py` 会重写
  `public/build-meta.json`（构建时间、git 分支/commit/是否有未提交改动、游戏资源池
  指纹、上一轮构建了哪些模型）。部署后直接访问 `/build-meta.json` 就能核对
  「线上这份素材是哪来的」，出问题时贴这个文件比贴截图有用。也可以 `python build/build_meta.py` 手动刷新。
- **人工配置不放在 `public/`**：`spine_overrides.json` 已移到 `build/`（和 `cg_flags.json` 一致），
  vite 在 dev / build 前由 `spineOverridesPlugin` 拷一份到 `public/data/`，改完即时同步并刷新页面。
  前端仍按 `/data/spine_overrides.json` 取，`nikke_extract` 的静态渲染脚本读的也是这份产物，路径不用改。
  同一插件也同步 `build/cg_merges.json`（CG 合并收录表，`node build/gen_cg_merges.mjs` 生成，
  自动识别图集贴图页并保留人工条目）。
- **站点根文件**（`_redirects` SPA 回退 / `robots.txt` / `_headers` 缓存头）同样入库在 `build/site/`，
  由 `siteFilesPlugin` 同步进 `public/`。这三个文件只在部署时生效，但放在 `public/` 里就等于不进版本库
  （`public/` 整个被 ignore），`git status` 也看不见——想改就改 `build/site/` 下的那份。

## 备注

- 游戏大版本更新后，先在上游 `nikke_extract` 重跑解包，再按上面顺序重建本仓库数据。
- `build/schema.sql` 是数据库结构定义，改表结构后 `build_db.py` 会按它建库。
- `build/cg_flags.json`、`build/spine_overrides.json` 是人工校对过的映射表，属于源码而非产物，请一并维护。
- `build/script_cg_map.json` 已基本退役：CG 链接改为消费上游剧情 JSON 的 `cg/cgd/cgb` 字段
  （build_db.harvest_cg_line_assets，上游为单一事实源），人工表现在只剩 1 条生效
  （event_cherryblossom_06_e → CherryBlossom_01，行级 token 提取覆盖不到的演出引用），
  待上游确认口径后即可删除；9 条差分覆盖类（blood/flare/smoke…）上游契约不含且资产未导出，
  永不生效。
