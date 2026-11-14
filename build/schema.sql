-- NIKKE 剧情数据库 schema
-- 目标：把 1060 篇剧情 + 1463 张 CG + 76 个本地化库压进一个 SQLite

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============ 元信息 ============
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- ============ 剧情单元（章 / 活动 / 个人剧情 / 咨询 / 短信 / 支线）============
CREATE TABLE IF NOT EXISTS story_units (
  id             INTEGER PRIMARY KEY,
  category       TEXT NOT NULL,          -- main / event / nikke / counseling / side / side_story / daily / extra / sub
  category_label TEXT,                   -- 主线 / 活动剧情 / 妮姬个人剧情 ...
  bucket         TEXT NOT NULL,          -- d_main_01 / 1ann_mini / d_nikke_Mary_BayGoddess / s001
  title          TEXT,
  chapter_no     INTEGER,                -- 主线才有章节号
  sort_order     INTEGER,
  segment_count  INTEGER DEFAULT 0,
  line_count     INTEGER DEFAULT 0,
  char_count     INTEGER DEFAULT 0,
  source         TEXT DEFAULT 'export',  -- export（结构化导出）/ locale_fill（本地化表补全）
  UNIQUE(category, bucket)
);

-- ============ 段落（游戏内一个 group / scene）============
CREATE TABLE IF NOT EXISTS story_segments (
  id         INTEGER PRIMARY KEY,
  unit_id    INTEGER NOT NULL REFERENCES story_units(id) ON DELETE CASCADE,
  group_key  TEXT NOT NULL,              -- d_main_01_01_s
  title      TEXT,
  part       TEXT,                       -- 活动剧情的 part 字段
  sort_order INTEGER,
  line_count INTEGER DEFAULT 0,
  source     TEXT DEFAULT 'export',
  UNIQUE(unit_id, group_key)
);

-- ============ 台词行（核心表，44 万+ 行）============
-- 注意：line_key 在游戏里不保证全局唯一（同一段剧情存在回放副本），
-- 因此只做普通索引，唯一性靠自增 id。
CREATE TABLE IF NOT EXISTS story_lines (
  id         INTEGER PRIMARY KEY,
  segment_id INTEGER NOT NULL REFERENCES story_segments(id) ON DELETE CASCADE,
  unit_id    INTEGER NOT NULL,           -- 冗余，避免搜索时多一次 join
  seq        INTEGER,                    -- 原文 n
  line_key   TEXT NOT NULL,              -- d_main_01_01_s_1
  speaker    TEXT,
  speaker_id TEXT,
  portrait   TEXT,
  portrait_id TEXT,
  text_zh    TEXT,
  text_en    TEXT,
  text_ja    TEXT
);

-- ============ 角色 ============
CREATE TABLE IF NOT EXISTS characters (
  id           INTEGER PRIMARY KEY,
  speaker_id   TEXT UNIQUE,              -- marian
  name_zh      TEXT,
  name_en      TEXT,
  name_ja      TEXT,
  line_count   INTEGER DEFAULT 0,
  first_seen   TEXT,                     -- 首次登场的 line_key
  avatar_path  TEXT                      -- 立绘（阶段 4 再填）
);

-- ============ CG 资产 ============
CREATE TABLE IF NOT EXISTS cg_assets (
  id           INTEGER PRIMARY KEY,
  name         TEXT UNIQUE,              -- EventScene_Main_01_01_bg
  category     TEXT,                     -- 01_活动剧情CG ...
  sub_category TEXT,                     -- 活动/章节名
  src_path     TEXT,                     -- 原始相对路径
  file_size    INTEGER,
  width        INTEGER,
  height       INTEGER,
  has_spine    INTEGER DEFAULT 0,        -- 是否有动态模型
  is_spine_atlas INTEGER DEFAULT 0,      -- 是否为 .spine.png 图集贴图
  is_cover     INTEGER DEFAULT 0,        -- 人工标注：活动封面/主视觉（不是剧情 CG）
  webp_400     TEXT,
  webp_1280    TEXT,
  webp_2048    TEXT,
  link_count   INTEGER DEFAULT 0
);

-- ============ CG ↔ 台词 关联 ============
-- 一条链接可能命中多条台词（回放副本），所以主键用 line_id
CREATE TABLE IF NOT EXISTS cg_links (
  cg_name    TEXT NOT NULL,
  line_id    INTEGER NOT NULL,
  line_key   TEXT,
  match_type TEXT,                       -- 精确 / 近似
  unit_id    INTEGER,
  segment_id INTEGER,
  PRIMARY KEY (cg_name, line_id)
);

-- ============ 动态 CG（WebP 动图）============
CREATE TABLE IF NOT EXISTS cg_animations (
  id        INTEGER PRIMARY KEY,
  name      TEXT UNIQUE,
  src_path  TEXT,
  file_size INTEGER,
  frames    INTEGER,
  width     INTEGER,
  height    INTEGER,
  duration_ms INTEGER
);

-- ============ 游戏角色档案（wiki 主体，来自 Locale_Character）============
CREATE TABLE IF NOT EXISTS character_entries (
  id          INTEGER PRIMARY KEY,   -- 游戏内角色 ID（10 = 拉毗）
  code        TEXT,                  -- c010
  name_zh     TEXT,
  name_en     TEXT,
  name_ja     TEXT,
  name_ko     TEXT,
  name_tw     TEXT,
  desc_zh     TEXT,                  -- c010_description 角色介绍
  desc_en     TEXT,
  desc_ja     TEXT,
  intro_zh    TEXT,                  -- 10_intro 角色签名
  cv          TEXT,                  -- 声优
  speaker_id  TEXT,                  -- 剧情说话人 id（marian），用于关联台词
  line_count  INTEGER DEFAULT 0,     -- 剧情台词数
  has_desc    INTEGER DEFAULT 0
);

-- ============ 技能说明（Locale_Skill）============
CREATE TABLE IF NOT EXISTS skill_strings (
  key       TEXT PRIMARY KEY,
  kind      TEXT,                    -- name / description / add_des / effect
  owner_id  INTEGER,                 -- 若能从 key 推断归属角色
  zh        TEXT,
  en        TEXT,
  ja        TEXT,
  ko        TEXT
);

-- ============ 本地化字符串（UI / 任务名 / 纪念品描述等，阶段 4 名词库用）============
CREATE TABLE IF NOT EXISTS locale_strings (
  key        TEXT PRIMARY KEY,
  table_name TEXT,
  value_zh   TEXT,
  value_en   TEXT,
  value_ja   TEXT
);

-- ============ 索引 ============
CREATE INDEX IF NOT EXISTS idx_units_cat     ON story_units(category, sort_order);
CREATE INDEX IF NOT EXISTS idx_units_source  ON story_units(source);
CREATE INDEX IF NOT EXISTS idx_seg_source    ON story_segments(source);
CREATE INDEX IF NOT EXISTS idx_seg_unit      ON story_segments(unit_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_lines_seg     ON story_lines(segment_id, seq);
CREATE INDEX IF NOT EXISTS idx_lines_unit    ON story_lines(unit_id);
CREATE INDEX IF NOT EXISTS idx_lines_key     ON story_lines(line_key);
CREATE INDEX IF NOT EXISTS idx_lines_speaker ON story_lines(speaker_id);
CREATE INDEX IF NOT EXISTS idx_cg_cat        ON cg_assets(category, sub_category);
CREATE INDEX IF NOT EXISTS idx_cglink_cg     ON cg_links(cg_name);
CREATE INDEX IF NOT EXISTS idx_cglink_line   ON cg_links(line_key);
CREATE INDEX IF NOT EXISTS idx_char_speaker  ON character_entries(speaker_id);
CREATE INDEX IF NOT EXISTS idx_char_lines    ON character_entries(line_count DESC);

-- ============ 全文搜索（trigram，中文免分词）============
CREATE VIRTUAL TABLE IF NOT EXISTS line_fts USING fts5(
  text_zh,
  content = 'story_lines',
  content_rowid = 'id',
  tokenize = 'trigram'
);

CREATE TRIGGER IF NOT EXISTS lines_ai AFTER INSERT ON story_lines BEGIN
  INSERT INTO line_fts(rowid, text_zh) VALUES (new.id, new.text_zh);
END;

CREATE TRIGGER IF NOT EXISTS lines_ad AFTER DELETE ON story_lines BEGIN
  INSERT INTO line_fts(line_fts, rowid, text_zh) VALUES('delete', old.id, old.text_zh);
END;

CREATE TRIGGER IF NOT EXISTS lines_au AFTER UPDATE ON story_lines BEGIN
  INSERT INTO line_fts(line_fts, rowid, text_zh) VALUES('delete', old.id, old.text_zh);
  INSERT INTO line_fts(rowid, text_zh) VALUES (new.id, new.text_zh);
END;

-- ============ 便利视图 ============
DROP VIEW IF EXISTS v_lines_full;
CREATE VIEW v_lines_full AS
SELECT
  l.id           AS line_id,
  l.line_key,
  l.seq,
  l.speaker,
  l.speaker_id,
  l.text_zh,
  s.id           AS segment_id,
  s.group_key,
  s.title        AS segment_title,
  u.id           AS unit_id,
  u.category,
  u.category_label,
  u.bucket,
  u.title        AS unit_title,
  u.chapter_no
FROM story_lines l
JOIN story_segments s ON s.id = l.segment_id
JOIN story_units    u ON u.id = l.unit_id;
