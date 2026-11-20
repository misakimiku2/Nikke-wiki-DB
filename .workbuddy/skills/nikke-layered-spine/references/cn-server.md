# 国服（WeGame PC 版）专属角色提取

2026-11-20 首次打通（婴宁 c8004 / 画皮 c8005）。国服数据结构、容器加密与国际服
com.shiftup.patch 完全不同，国际服工具链（catalog.ndb + store.cdb + export_cg_v2）
在这里全部用不上。本文记录完整链路，配两个脚本：

- `nikke_extract/scripts/decrypt_nkab_cn.py` — NKAB v4 解密器（内嵌密钥表刷新）
- `nikke_extract/scripts/export_char_cn.py` — 按角色 ID/中文名全量导出到 staging

## 一、国服客户端数据在哪

游戏根 `C:\Program Files\GAME\胜利女神：新的希望(2002017)\`（环境变量 `NIKKE_CN_GAME` 可覆盖）：

| 位置 | 内容 | 格式 |
|---|---|---|
| `nikke_Data/runtime_data/cache/<outer>/<哈希>` | **主资源池**（3.1 万条） | NKAB v4 加密（个别 `__info/__data` 目录形式=明文 UnityFS） |
| `nikke_Data/runtime_data/saus/zh_cn/ab/*.nab` | UI/语音池 | 明文 UnityFS |
| `nikke_Data/runtime_data/saus/saus/lss/*.lss` | 本地化表 | 明文 SQLite |
| `nikke_Data/StreamingAssets/aa/settings.json` | **KeySets 密钥表** | JSON |
| `%LOCALAPPDATA%Low/com_tencent/胜利女神：新的希望/com.unity.addressables/*.json` | **bundle 清单** | JSON |

要点：

1. **cache 的二级目录名 = bundle 文件名末尾的 32 hex 内容哈希**。bundle 名形如
   `{NK.Addressable.HostConst.HostDatapackLoadURL}\组名(hd)_assets_路径/xxx_<哈希>.bundle`，
   用哈希直接查 cache 即可，不需要任何 URL/MD5 换算。
2. addressables 的 7 份 JSON 是当前版（按 mtime 挑最新 7 个；旧版本会残留）。
   internalIds 里的 `{NK.Addressable.HostConst.XxxLoadURL}` 前缀剥离后才是 bundle 相对路径。
3. 角色中文名 → ID：`Locale_Character.lss` 表 `Locale_Character`，`Key` 形如 `8004_name`；
   `CharacterSearchTable_zh-CN.lss` 有别名表。**国服专属角色 ID 从 8000 起**（8004=婴宁、
   8005=画皮），国际服 roster（staging/spine_stand）里没有。
4. 国际服 catalog 里搜不到这些角色是正常的——他们从未在国际服上线，F 盘
   com.shiftup.patch 里**没有**他们的任何资源。

## 二、NKAB v4 加密（与社区 v3 的差异）

头部 132 字节（0x84）：`"NKAB"+u32 ver=4` + 6×u16 混淆字段 + 32B 密钥材料 + 16B Salt
+ 64B 签名区。混淆 = 存储值 + obf（obf 在**文件末 2 字节**，且这 2 字节同时是 bundle
最后一块的密文——不能当尾巴剔除）。字段解出后依次：
`blockCount / encryptFlags / keyIndex / keyMode / keyVersion / X`。

解密三步（全部在 `decrypt_nkab_cn.py`）：

```
tableKey = KeySets[keyVersion][keyIndex]        # 32B，来自客户端 settings.json
aesKey   = SHA256(tableKey ‖ file[0x14:0x34])   # 与 v3 同款拼接哈希
逐 16B 块: flags & (0x8000>>idx) 置位的块 AES-256-ECB 解密（无 IV、无链接）
```

- 掩码 idx 从 **payload 起点**按 16B 网格数，与 UnityFS 内部对齐无关。
- `blockCount==0` → 全文件按掩码；否则 v3 式头/尾分区（头 `>>8` 组、尾 `&0xFF` 组，
  每组 256B，中间明文）。sd/sfx 系 bundle 用分区模式，其余多为全文件模式。
- **KeySets 就在客户端自带 settings.json 里**（m_ExtraInitializationData[0].m_Data 是内嵌
  JSON 字符串），游戏更新追加新 keyVersion 时跑
  `python scripts/decrypt_nkab_cn.py --update-keysets` 刷新，不需要碰加密。
- 实测过的 flags：0xAAAA（奇偶交替）、0xDBBB、0xAE67 等；keyIndex 0-4 每版本 5 把钥匙。

## 三、导出流程（export_char_cn.py）

```
python nikke_extract/scripts/export_char_cn.py --name 婴宁
python nikke_extract/scripts/export_char_cn.py --id 8005 --kinds all
```

内部：7 份 addressables JSON 收集 `c8004(?!d)` 命中的 bundle → 哈希查 cache → NKAB
解密 → UnityPy 解包 → 按 staging 约定落盘：

| kind | bundle 组 | staging 输出 | 网站管线 |
|---|---|---|---|
| stand | spinestandingcharactergroup | `spine_stand/c8004_00/` | build --kind stand → public/spine_char/ |
| combat | spinecombatcharactergroup (aim/cover) | `spine_combat/c8004_aim_00/` 等 | build --kind combat → public/spine_combat/ |
| skillcut | **spotskillcutscene + livewallpaperprefabs** | `spine_char/c8004_00_skillcut/`（含 bg.png） | build --kind skillcut → public/spine_skillcut/ + 索引 |
| icons | icons-char-full / icons-char-mi | `cn_icons/` | 无（立绘卡） |
| sd / sfx | sdcharacters / sfx_* | `cn_sd/`、`cn_sfx/`（AudioClip 未解码） | 无 |

导出完在 nikke-web 里跑 `build/build_char_spine.py --kind stand,combat,skillcut`
即可入站（atlas 修尺寸、PNG→WebP、索引 json 都是构建期自动的）。

**专属皮肤**（c082_80 黄发垂髫 / c233_80 宴桃源 / c260_80 蝶恋花语等）同样用
`--code c082_80` 提取：bundle 路径里皮肤段写作 `c082/80`（spine 组）与
`c082_80`（icons/sd 组）两种形式，导出器两种都匹配。注意 catalog 里同一皮肤可能
存在两份不同哈希的 bundle（美术修订版共存）——导出器会自动把第二份存为
`__dup1` 目录，**先逐字节比对再决定删谁**（2026-11 实测 c233_80 两份完全相同）。
站内皮肤还需 SD 图（public/char/<code>.webp，见 `cn_saus/HANDOFF.md` §2.1），
语音则走 `build/export_char_voices.py` 的 `CN_SKIN_SETS`（已接好）。

## 四、踩过的坑（都验证过）

1. **cut_scene bundle 双角色串包**：c8004 的 `spotskillcutscene`/`livewallpaper`
   bundle 里同时打了 c8004 和 c8005 两份 skillcut TextAsset。导出必须按
   `c<id>_00_skillcut` 前缀过滤，否则两个角色的 atlas/skel 互相覆盖。
2. **obf 双重用途**：文件末 2 字节既是混淆值又是最后一块密文。整个余部（含尾部
   填充/footer）先按掩码解密，再按 UnityFS 头的 size 字段（BE i64 @payload+0x1E）
   裁剪。直接 `[:-2]` 会把最后一个 Unity 数据块切掉 2 字节 → LZ4 解压失败
   （只挂最后一个块，前 34 个都正常，极具迷惑性）。
3. **UnityFS v7+ 对齐**：header 后 16B 对齐；flags 0x200=BlockInfoNeedPaddingAtStart
   时数据块再对齐一次（0x16E→0x170）。手工校验块时注意，交给 UnityPy 则无需关心。
4. **blocksInfo 在头部的对齐位（payload+0x40）**，不是 size-cinfo 也不是文件尾——
   国际服 flags 语义（0x40=at-end）在 Unity 2021 新 flags 里是 0x40=combined、
   0x80=at-end、0x200=padding。手写解析极易在这三处浪费半天。
5. **Locale Character 表是明文 SQLite**，但 staticdata（Album/活动表）的国服包
   `StaticData.pack` 在 `%TEMP%/com_tencent/胜利女神：新的希望/`，其 salt 与国际服
   不同（国际服 salt 来自 packinfo，CN 侧未找到对应缓存）——尚未解。找活动 CG
   的替代法：对目录里全部 CG 类组（eventscene/album/memorial/…）解密后扫角色
   ID 字节（`tools/cn_saus/find_char_cg.py`），3461 个 bundle 全扫一遍 ~5 分钟。
6. **语音**：c8004/c8005 的配音在 `zh_cn/ab/*.nab`（明文）与 `sfx_assets_required*`
   （NKAB）里，AudioClip 需 fmod/vgmstream 解码，暂未处理。

## 五、2026-11 时两角色的资源清单（54 bundle，全在 cache，零缺失）

站姿(normal+prefab)、战斗 aim/cover、全身立绘 dp/uc 双份、mini 图标、SD、
大招 cut-in（Spine+场景层）、动态壁纸 cutscene、gacha 卡面 UI、技能特效、
技能数据、语音库。**没有任何独立活动 CG/剧情 CG**（3461 个 CG 类 bundle 全
扫描确认）——他们的演出内容就是大招 cut-in 与壁纸 cutscene。

## 六、StaticData.pack 与运行时配置（2026-11-20 二轮逆向）

国服静态表（CharacterTable/SkillInfoTable/CharacterShotTable/SquadInfoTable/
MessengerDialogTable 等 300+ 张 JSON）不在 addressables 池里，而是加密的
`%TEMP%/com_tencent/胜利女神：新的希望/StaticData.pack`（15.3MB）。
加密链与国际服同构（PBKDF2(固定password, salt, 10000) → 两层 AES-CBC/CTR），
但 **salt 只在每次启动时由 lobby 服务器 `staticdata/get`（protobuf
ResStaticDataPackInfoV2，field4/5）下发，本地不缓存**。

离线排查结论（全部验证过）：

1. 14 份 catalog、31269 条 cache、4022 个 CG 类 bundle 全查过：StaticData 不在
   addressables；`%TEMP%` 里只有 pack 本体（无 packinfo）。
2. 热更新 DLL 是明文 PE，在 `nikke_Data/runtime_data/assembly/StandaloneWindows64/`
   （NK.Runtime.dll 25MB 等）。用 `tools/cn_saus/il_dump.py`（dnfile+dncil）定向
   dump 类的 IL，比反汇编 GameAssembly 快得多。
3. `StreamingAssets/AppConfig.json` = base64 → AES-256-CBC。Key/IV 硬编码于
   `NK.Common.Util.EncryptHelper::.cctor`（Roslyn 数组经 `<PrivateImplementationDetails>`
   哈希命名字段的 FieldRVA 存储）。解出后 StaticDataUrl 为空——生产路由经 iTop
   （`api.jiazhang.qq.com`）运行时获取；dev 路由
   `https://a2.yongxinghudong.com.cn/route_config.json`（证书已过期）。
4. salt 获取唯一可行路径 = 游戏启动时抓包（明文 HTTP 直接可见；HTTPS 需系统代理
   MITM，HttpClient 默认信任 Windows 证书库）。工具：
   `cn_saus/CAPTURE_SALT.md` + `cn_saus/crack_pack_with_salts.py`
   （对抓包字节做 protobuf 32B 字段扫描 → PBKDF2 试解首块验 "PK\x03\x04"）。
5. 客户端会把服务器下发的部分状态写成明文 ZIP（LocalLow 的
   `NKSD_TRIGGER_<treeId>_<ver>`，header/meta/trigger.txt）——那是触发器状态同步，
   不是静态表。
6. 国服 lss 表内容量远超预期：个人剧情 944 条/巴拉短信 237/咨询 447/画皮活动剧情
   2495 条全在（`cn_saus/export_cn_texts.py` 一键导出）。**活动剧情文本会保留**，
   但活动 CG bundle 随版本轮换被 CDN 目录移除（14 份 catalog 零引用、cache 零
   孤儿条目可证），过期活动 CG 本地无法再取。
