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
python build/build_char_spine.py          # → public/spine_char  角色 Spine 站姿模型
python build/export_char_voices.py        # → public/voice + public/data/char_voices.json 角色语音（日语+国服中文）
# 角色三围（HP/ATK/DEF）由 nikke_extract 生成：python scripts/export_char_stats.py
#   → staging/char_stats.json、staging/stat_curves.json，拷到 public/data/ 即可
# 装备与魔方同理：python scripts/export_equip.py / export_cubes.py
#   → staging/equip_stats.json、staging/cube_stats.json，拷到 public/data/ 即可

# 3. CG
python build/build_images.py              # → public/img         三档转码
python build/export_cg.py                 # → public/data/cg_index.json
python build/build_spine_models.py        # → public/spine       实时 Spine 模型

# 4. 剧情与搜索
python build/export_char_stories.py       # → public/data/char_stories.json 好感剧情映射
python build/export_counsel_flow.py       # → public/data/counsel_flow.json 咨询分支流
python build/export_story.py              # → public/data/story/ 分章 JSON（读上面的映射改标题）
python build/export_search.py             # → public/data/search-index.json
python build/export_web.py                # → public/data        其余聚合 JSON
node build/export_char_messages.mjs       # → public/data/char_messages.json 角色巴拉短信（依赖 characters.json）
node build/export_story_sms.mjs           # → public/data/story_sms.json 剧情内嵌短信映射（依赖 story/<id>.json）

# 5. 自检与前端构建
python build/verify.py                    # 校验各产物是否齐备
cd web && npm run build                   # → dist/
VITE_NO_PUBLIC=1 npm run build            # 只出 assets，不拷 6G 素材（改 UI 时用）
```

`build/rerender_spine.py` 用于单独重渲染某个 Spine 模型，不必全量重跑。

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
