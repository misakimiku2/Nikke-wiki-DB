import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { usePageTitle } from '../usePageTitle'
import {
  accentFor, artLabel, charArt, charAvatar, charThumb, combatModelName, loadCharArt, loadCharCombat,
  loadCharImages, loadCharMessages, loadCharMeta, loadCharMi, loadCharSkills, loadCharSkillcut, loadCharStories,
  loadCharSpine, loadCharVoices, loadCharacters, loadCostumeTexts, loadSpecTexts, mainBase, nf, pickBurstAnim,
  burstBgSegment,
  skillcutModelName, SPEC_BURST, SPEC_CLS, SPEC_CORP, SPEC_ELEMENT, SPEC_WEAPON, tintFor, variantsOf,
  loadSquadIcons, loadCharStats, loadStatCurves, LB_MAX_LEVEL, LB_GAIN, affectionMax, AFFECTION_PER_LV,
  loadEquipStats, EQUIP_PARTS, EQUIP_PART_CN, EQUIP_TIERS, EQUIP_MAX_ENHANCE, EQUIP_ENHANCE_RATE, EQUIP_OPTIONS, EQUIP_TIER_ODDS,
  loadCubeStats, CUBE_MAX_LEVEL, cubeTierIndex, cubeIcon, detectFormVariants, type FormInfo,
  layerConfigFor,
  loadFavoriteStats, favoriteIcon, favoriteTierIndex, FAVORITE_EFFECTS, FAVORITE_GLOBAL_EFFECTS,
  type FavoriteStats, type FavoriteInfo,
  CORE_MAX, CORE_RATE, equipIcon, loadSquadNames,
  type CharArtMap, type CharBaseStat, type CharImages, type CharMetaMap, type Character, type CharMessagesData,
  type CharSkill, type CharSkillsData, type CharStoriesData, type CharVoiceData, type CostumeTextMap,
  type SkillcutIndex, type SpecTexts, type SquadIcons, type SquadNames, type StatCurves, type EquipStats, type EquipPart,
  type CubeStats,
} from '../data'
import CounselChat from '../components/CounselChat'
import ImageViewer from '../components/ImageViewer'
import PlayPauseIcon from '../components/PlayPauseIcon'
import { useImmersive, ExpandIcon, ImmersiveExitButton } from '../components/Immersive'
import MessageChat from '../components/MessageChat'
import SpinePlayer, { type SpineController, type SpineStatus } from '../components/SpinePlayer'
import VoiceList from '../components/VoiceList'
import { pickLang, useLang } from '../lang'
import { fmt, useUI, type UIKey } from '../ui'

const EMPTY: SpineStatus = {
  ready: false, playing: true, time: 0, duration: 0, speed: 1, zoom: 1, anim: '', anims: [],
}
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]

/** 装备词条：每件最多 3 条，类型 + 档位（1-15） */
type OptRow = { key: string; tier: number }
const OPT_ROWS = 3
const emptyOpts = (): Record<EquipPart, OptRow[]> => ({
  head: Array.from({ length: OPT_ROWS }, () => ({ key: '', tier: 0 })),
  arm: Array.from({ length: OPT_ROWS }, () => ({ key: '', tier: 0 })),
  body: Array.from({ length: OPT_ROWS }, () => ({ key: '', tier: 0 })),
  leg: Array.from({ length: OPT_ROWS }, () => ({ key: '', tier: 0 })),
})

/* ---- 配装导入 / 导出：把全部可调状态编码成一行分享码 ---- */
type BuildPreset = {
  v: 1
  lv: number                                   // 等级
  lb: number                                   // 突破星级
  co: number                                   // 极限突破
  af: number                                   // 好感
  eq: Record<EquipPart, [number, number]>      // 部位 → [品阶, 强化]
  op: Record<EquipPart, [string, number][]>    // 部位 → [[词条key, 档位], ...]
  cu: number | null                            // 魔方 id，null=未装备
  cl: number                                   // 魔方等级
  fv?: number | null                           // 珍藏品 id（可选，兼容旧配装码）
  fp?: number                                  // 珍藏品阶段 0-15
}
const PRESET_PREFIX = 'NKB1:'

function encodePreset(p: BuildPreset): string {
  const bytes = new TextEncoder().encode(JSON.stringify(p))
  let bin = ''
  bytes.forEach((b) => { bin += String.fromCharCode(b) })
  return PRESET_PREFIX + btoa(bin)
}

/** 解析 + 结构校验 + 范围钳制；角色相关上限（好感/魔方存在性）由调用方再处理 */
function parsePreset(raw: string): BuildPreset | null {
  const code = raw.trim()
  if (!code.startsWith(PRESET_PREFIX)) return null
  let obj: Record<string, unknown>
  try {
    const bin = atob(code.slice(PRESET_PREFIX.length))
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    obj = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
  if (!obj || obj.v !== 1) return null
  const num = (x: unknown, lo: number, hi: number, dflt: number) =>
    typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : dflt
  const eq = {} as BuildPreset['eq']
  const op = {} as BuildPreset['op']
  const rawEq = (obj.eq && typeof obj.eq === 'object' ? obj.eq : {}) as Record<string, unknown>
  const rawOp = (obj.op && typeof obj.op === 'object' ? obj.op : {}) as Record<string, unknown>
  for (const part of EQUIP_PARTS) {
    const e = rawEq[part]
    eq[part] = [
      num(Array.isArray(e) ? e[0] : 1, 1, EQUIP_TIERS.length, 1),
      num(Array.isArray(e) ? e[1] : 0, 0, EQUIP_MAX_ENHANCE, 0),
    ]
    const rows = rawOp[part]
    const arr: [string, number][] = Array.isArray(rows)
      ? rows.slice(0, OPT_ROWS).map((r: unknown) => {
          const t = r as [unknown, unknown]
          const key = typeof t?.[0] === 'string' && EQUIP_OPTIONS.some((o) => o.key === t[0]) ? t[0] : ''
          return [key, key ? num(t[1], 1, 15, 1) : 0] as [string, number]
        })
      : []
    while (arr.length < OPT_ROWS) arr.push(['', 0])
    op[part] = arr
  }
  return {
    v: 1,
    lv: num(obj.lv, 1, LB_MAX_LEVEL[LB_MAX_LEVEL.length - 1], 1),
    lb: num(obj.lb, 0, LB_MAX_LEVEL.length - 1, 3),
    co: num(obj.co, 0, CORE_MAX, 0),
    af: num(obj.af, 0, 1000, 0),
    eq,
    op,
    cu: typeof obj.cu === 'number' ? obj.cu : null,
    cl: num(obj.cl, 1, CUBE_MAX_LEVEL, 1),
    fv: obj.fv === undefined ? null : (typeof obj.fv === 'number' ? obj.fv : null),
    fp: num(obj.fp, 0, 15, 0),
  }
}
/** 游戏内首次 Overload 的词条固定为 11 档 */
const DEFAULT_TIER = 11

/** 通用下拉：完整文案 + 文本区横向滚动（原生 select 在窄格子里会截断） */
type SelectOpt = { value: string; label: string; short?: string; title?: string }

function OptSelect({
  value, onChange, options, label, placeholder = '—',
}: {
  value: string
  onChange: (v: string) => void
  options: SelectOpt[]
  label: string
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const cur = options.find((o) => o.value === value)
  return (
    <div className="opt-select" ref={ref}>
      <button
        type="button"
        className="opt-select-btn"
        onClick={() => setOpen((v) => !v)}
        title={cur?.title || cur?.label || placeholder}
        aria-label={label}
        aria-expanded={open}
      >
        <span className="opt-select-text">{cur?.short ?? cur?.label ?? placeholder}</span>
        <i className="opt-select-arrow" aria-hidden />
      </button>
      {open && (
        <ul className="opt-select-menu" role="listbox">
          {options.map((o) => (
            <li key={o.value}>
              <button
                type="button"
                className={o.value === value ? 'on' : ''}
                onClick={() => { onChange(o.value); setOpen(false) }}
                title={o.title}
              >{o.label}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** 装备统计图标：三根柱状条 */
function ChartIcon() {
  return (
    <svg viewBox="0 0 20 20" className="stat-toggle-icn" aria-hidden>
      <g stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
        <line x1="5" y1="16.5" x2="5" y2="10.5" />
        <line x1="10" y1="16.5" x2="10" y2="5" />
        <line x1="15" y1="16.5" x2="15" y2="12.5" />
      </g>
    </svg>
  )
}

/** 配装导入导出图标：双向箭头穿过方框 */
function IoIcon() {
  return (
    <svg viewBox="0 0 20 20" className="stat-toggle-icn" aria-hidden>
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6.5h9M9.5 4 12 6.5 9.5 9" />
        <path d="M17 13.5H8M10.5 11 8 13.5 10.5 16" />
      </g>
    </svg>
  )
}

/** 魔方图标缺失时的占位：线框立方体，跟随主题色，风格与三围图标一致 */
function CubeGhost() {
  return (
    <svg className="cube-ghost" viewBox="0 0 48 48" aria-hidden>
      <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
        <path d="M24 5.5 40.5 14.7v18.6L24 42.5 7.5 33.3V14.7z" opacity=".7" />
        <path d="M7.5 14.7 24 23.9l16.5-9.2M24 23.9v18.6" opacity=".4" />
      </g>
    </svg>
  )
}

/** 三围图标：对齐游戏 STATUS 面板的星芒 / 横条箭头 / 盾形，内联 SVG 便于双主题染色 */
function StatIcon({ kind }: { kind: 'hp' | 'atk' | 'def' }) {
  if (kind === 'hp') {
    return (
      <svg viewBox="0 0 20 20" className="stat-icn" aria-hidden>
        <g stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
          <line x1="10" y1="3" x2="10" y2="17" />
          <line x1="4" y1="6.5" x2="16" y2="13.5" />
          <line x1="16" y1="6.5" x2="4" y2="13.5" />
        </g>
      </svg>
    )
  }
  if (kind === 'atk') {
    return (
      <svg viewBox="0 0 20 20" className="stat-icn" aria-hidden>
        <g stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" fill="none">
          <line x1="3" y1="5.6" x2="11" y2="5.6" />
          <line x1="3" y1="10" x2="15" y2="10" />
          <line x1="3" y1="14.4" x2="9" y2="14.4" />
          <path d="M12.6 7.6 L15.4 10 L12.6 12.4" />
        </g>
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 20 20" className="stat-icn" aria-hidden>
      <path
        d="M10 2.2 L16.6 4.6 V9.2 C16.6 13.4 13.5 16.3 10 17.8 C6.5 16.3 3.4 13.4 3.4 9.2 V4.6 Z"
        fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * 表情按钮只放这几个「主表情」，其余（surprise / pain / rage / *_02 …）收进下拉，
 * 否则 420px 的侧栏会被十几个按钮挤爆。每套模型不一定都齐，缺的自动跳过。
 * label 是 UI 词典 key（渲染时 t() 取当前语言）。
 */
const CHIP_DEFS: Array<{ re: RegExp; label: UIKey }> = [
  { re: /^idle/, label: 'chip_idle' },
  { re: /^delight/, label: 'chip_delight' },
  { re: /^angry/, label: 'chip_angry' },
  { re: /^sad/, label: 'chip_sad' },
  { re: /^surp|^surpreise/, label: 'chip_surp' },
  { re: /^shy/, label: 'chip_shy' },
  { re: /^think/, label: 'chip_think' },
  { re: /^action|^battle/, label: 'chip_action' },
]

/** 战斗姿态（aim / cover）的动作 chips；to_aim / to_cover 是过渡，不进按钮 */
const COMBAT_CHIP_DEFS: Array<{ re: RegExp; label: UIKey }> = [
  { re: /_idle$/, label: 'chip_idle' },
  { re: /_fire$/, label: 'chip_fire' },
  { re: /_reload$/, label: 'chip_reload' },
  { re: /_hit$/, label: 'chip_hit' },
  { re: /_stun$/, label: 'chip_stun' },
]

/** 大招 cut-in：主动画由 pickBurstAnim 挑（命名太乱），其余 idle 当待机 */
function pickBurstChips(anims: string[], model?: string): { label: UIKey; anim: string }[] {
  const out: { label: UIKey; anim: string }[] = []
  const burst = pickBurstAnim(anims, model)
  if (burst) out.push({ label: 'pose_burst', anim: burst })
  const idle = anims.find((a) => /(^|_)idle/i.test(a))
  if (idle && idle !== burst) out.push({ label: 'chip_idle', anim: idle })
  return out
}

/** 各枚举对应的游戏图标（public/metaicon/，白色 sprite，前端 mask 染色） */
const SPEC_CORP_ICN: Record<number, string> = {
  1: 'corp_icn_1', 2: 'corp_icn_2', 3: 'corp_icn_3', 4: 'corp_icn_4',
}
const SPEC_CLS_ICN: Record<number, string> = {
  1: 'cls_attacker', 2: 'cls_defender', 3: 'cls_supporter',
}
const SPEC_ELEMENT_ICN: Record<string, string> = {
  fire: 'element_fire', water: 'element_water', wind: 'element_wind',
  electric: 'element_elect', iron: 'element_iron',
}

/** 装备部位 → UI 词典 key（zh 列与 data.ts 的 EQUIP_PART_CN 一致） */
const EQUIP_PART_KEY: Record<EquipPart, UIKey> = {
  head: 'equip_part_head', arm: 'equip_part_arm', body: 'equip_part_body', leg: 'equip_part_leg',
}
/** T10 词条 key → UI 词典 key（zh 列与 data.ts 的 EQUIP_OPTIONS label 一致） */
const EQUIP_OPT_KEY: Record<string, UIKey> = {
  atk: 'opt_atk', def: 'opt_def', elem: 'opt_elem', critdmg: 'opt_critdmg', crit: 'opt_crit',
  ammo: 'opt_ammo', hit: 'opt_hit', charge: 'opt_charge', chargespd: 'opt_chargespd',
}
/** 珍藏品效果名（data.ts 中文 label）→ UI 词典 key；未映射的回退原文 */
const FAV_FX_KEY: Record<string, UIKey> = {
  核心伤害增加: 'fav_fx_core',
  防御力增加: 'opt_def',
  最大装弹数增加: 'fav_fx_ammo',
  普通攻击伤害增加: 'fav_fx_natk',
  蓄力伤害增加: 'opt_charge',
  所受伤害减少: 'fav_fx_dmgred',
  掩体最大体力增加: 'fav_fx_coverhp',
}

/** 企业弹窗文案：游戏内无官方说明，人工撰写（与社区共识一致）；反常(5)有官方文本，不在此列 */
const SPEC_CORP_DESC: Record<number, string[]> = {
  1: ['三大军工企业之一，倾向稳健持久的战斗风格，擅长防御与续航。'],
  2: ['三大军工企业之一，倾向激进的高火力路线，热衷尖端科技。'],
  3: ['三大军工企业之一，擅长特殊效果与辅助玩法，业务遍及娱乐产业。'],
  4: ['游离于人类编制之外的传奇妮姬，行踪神秘，实力超群。'],
  101: ['统治方舟的官方机构，统辖政府军与情报部门，主导地面收复与方舟的日常运作。'],
  102: ['游离于方舟体制之外的势力，与方舟保持距离，目的不明。'],
  103: ['活跃于地表的武装势力，行事低调，底细鲜为人知。'],
}
/** 爆裂弹窗文案：游戏内无独立的阶段说明文本，按战斗机制人工撰写 */
const SPEC_BURST_DESC: Record<number, string[]> = {
  1: ['爆裂循环第一档发动的爆裂技能。战斗中爆裂按 Ⅰ → Ⅱ → Ⅲ 的顺序循环推进。'],
  2: ['爆裂循环第二档发动的爆裂技能。战斗中爆裂按 Ⅰ → Ⅱ → Ⅲ 的顺序循环推进。'],
  3: ['爆裂循环第三档发动的爆裂技能。战斗中爆裂按 Ⅰ → Ⅱ → Ⅲ 的顺序循环推进。'],
  5: ['可在 Ⅰ / Ⅱ / Ⅲ 任意档位发动的爆裂技能。'],
}

/** 概览卡图标：白色 sprite 走 mask 染 currentColor（--icn 传图片地址，双主题自适应） */
function SpecIcon({ icn }: { icn: string }) {
  return <i className="spec-icn" style={{ ['--icn' as string]: `url(/metaicon/${icn}.webp)` }} aria-hidden />
}

/** EXPR_LABEL（data.ts 中文动画名）→ UI 词典 key；下拉选项按内容语言显示 */
const EXPR_KEY: Record<string, UIKey> = {
  idle: 'chip_idle', delight: 'chip_delight', angry: 'chip_angry', sad: 'chip_sad',
  sorrow: 'expr_sorrow', surprise: 'chip_surp', surp: 'chip_surp', surpreise: 'chip_surp',
  surprised: 'chip_surp', shy: 'chip_shy', shy2: 'chip_shy', think: 'chip_think',
  worry: 'expr_worry', worried: 'expr_worry', no: 'expr_no', yes: 'expr_yes',
  special: 'expr_special', action: 'chip_action', battle: 'expr_battle',
  smile: 'expr_smile', happy: 'expr_happy', good: 'expr_good', pain: 'expr_pain',
  rage: 'expr_rage', mad: 'expr_mad', cry: 'expr_cry', tear: 'expr_tear',
  panic: 'expr_panic', scared: 'expr_scared', sleep: 'expr_sleep', serious: 'expr_serious',
  void: 'expr_void', etc: 'expr_etc', go: 'expr_go', bad: 'expr_bad', close: 'expr_close',
  expression_0: 'expr_expr0', expression_1: 'expr_expr1', bg_idle: 'expr_bg_idle',
}

function animLabel(a: string, tr: (k: UIKey) => string): string {
  if (EXPR_KEY[a]) return tr(EXPR_KEY[a])
  const base = a.replace(/(?:_0?\d+|_alt|_blue)+$/, '')
  const tail = a.slice(base.length).replace(/^_/, '')
  const key = EXPR_KEY[base]
  if (key) return tail ? `${tr(key)} ${tail}` : tr(key)
  if (a.startsWith('talk')) return `${tr('anim_talk')} ` + a.slice(5).toUpperCase()
  return a
}

/** 与 CG 查看器一致的时间显示：0:05.3 */
function fmtTime(t: number): string {
  if (!Number.isFinite(t) || t < 0) return '0:00.0'
  const m = Math.floor(t / 60)
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`
}

/** 技能描述：把 {description_value_NN} 按当前等级的数值表填充，数值用主题色标出 */
/** 描述分词：{description_value_NN} 按等级填充；<word_group=NN>词条</word_group> 渲染成可点击名词 */
function SkillRow({ skill, lv, accent, onWord }: {
  skill: CharSkill; lv: number; accent: string
  onWord: (gid: number, term: string) => void
}) {
  const { lang } = useLang()
  const t = useUI()
  const kind = pickLang(lang, skill.kind, skill.kindEn, skill.kindKo, skill.kindJa)
  const name = pickLang(lang, skill.name, skill.nameEn, skill.nameKo, skill.nameJa)
  const desc = pickLang(lang, skill.desc, skill.descEn, skill.descKo, skill.descJa)
  const idx = Math.min(Math.max(lv, 1), Math.max(1, skill.levels)) - 1
  const vals = skill.values[idx] || []
  const nodes: ReactNode[] = []
  const re = /\{description_value_(\d+)\}|<word_group=(\d+)>([\s\S]*?)<\/word_group>/g
  let last = 0
  let key = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(desc))) {
    if (m.index > last) nodes.push(<span key={key++}>{desc.slice(last, m.index)}</span>)
    if (m[1]) {
      nodes.push(
        <b key={key++} className="skill-val" style={{ color: accent }}>
          {vals[Number(m[1]) - 1] ?? '—'}
        </b>,
      )
    } else {
      const gid = Number(m[2])
      const term = m[3] || ''
      nodes.push(
        <button key={key++} className="word-ref" style={{ color: accent }}
          onClick={() => onWord(gid, term)} title={t('term_hint')}>
          {term}
        </button>,
      )
    }
    last = m.index + m[0].length
  }
  if (last < desc.length) nodes.push(<span key={key++}>{desc.slice(last)}</span>)
  return (
    <div className="skill">
      {skill.icon ? (
        <img
          className="skill-icon"
          src={`/skillicon/${skill.icon}.webp`}
          alt=""
          loading="lazy"
          draggable={false}
        />
      ) : (
        <span className="skill-icon skill-icon-ph" aria-hidden />
      )}
      <div className="skill-main">
        <div className="skill-name">
          <em className="skill-kind">{kind || t('skill_kind_fallback')}</em>
          <b>{name}</b>
          <span className="skill-lv">Lv.{Math.min(Math.max(lv, 1), Math.max(1, skill.levels))}</span>
        </div>
        {desc && <div className="skill-desc">{nodes}</div>}
      </div>
    </div>
  )
}

function pickChips(anims: string[], defs = CHIP_DEFS): { label: UIKey; anim: string }[] {
  const out: { label: UIKey; anim: string }[] = []
  for (const d of defs) {
    const hit = anims.find((a) => d.re.test(a))
    if (hit) out.push({ label: d.label, anim: hit })
  }
  return out
}

/** 姿态标签的默认展开态：移动端（与详情页单列布局同断点）收起，给舞台上的模型腾地方 */
function defaultModesOpen(): boolean {
  return window.innerWidth > 1000
}

export default function CharacterDetail() {
  const { id } = useParams()
  const { lang } = useLang()
  const t = useUI()
  const [list, setList] = useState<Character[] | null>(null)
  const [imgs, setImgs] = useState<CharImages>({})
  const [mi, setMi] = useState<Set<string>>(new Set())
  const [spine, setSpine] = useState<Set<string>>(new Set())
  const [combat, setCombat] = useState<Set<string>>(new Set())
  /** 大招 cut-in 索引；null = 还没加载完（避免加载完前误判「无模型」回退姿态） */
  const [skillcut, setSkillcut] = useState<SkillcutIndex | null>(null)
  /** 舞台姿态：stand 立绘（站姿模型/静态图），aim 背身射击，cover 掩体，burst 大招 */
  const [pose, setPose] = useState<'stand' | 'aim' | 'cover' | 'burst'>('stand')
  /** 站姿模型的第二形态：0=形态①（基础），1=形态②（变体） */
  const [form, setForm] = useState(0)
  const [pick, setPick] = useState<string | null>(null)
  const [status, setStatus] = useState<SpineStatus>(EMPTY)
  const [modelReady, setModelReady] = useState(false)
  /** 站姿模型解析失败（源数据缺图集区域的皮肤）时退回静态立绘，不留一个红字报错框 */
  const [modelError, setModelError] = useState(false)
  const [skillData, setSkillData] = useState<CharSkillsData>({ items: {}, terms: {} })
  const [skillLv, setSkillLv] = useState(10)
  const [storiesMap, setStoriesMap] = useState<CharStoriesData>({})
  const [voiceMap, setVoiceMap] = useState<Record<string, CharVoiceData>>({})
  const [msgData, setMsgData] = useState<CharMessagesData | null>(null)
  const [art, setArt] = useState<CharArtMap>({})
  /** 皮肤文案：名字 / 获取方式 / 专属档案介绍（换肤后介绍会变的来源） */
  const [costumeTexts, setCostumeTexts] = useState<CostumeTextMap>({})
  /** 游戏元数据：部队 / 企业 / 武器 / 爆裂 / 兵种 */
  const [charMeta, setCharMeta] = useState<CharMetaMap>({})
  /** 概览卡字段的官方说明文本（武器/兵种），企业/爆裂/部队由前端生成 */
  const [specTexts, setSpecTexts] = useState<SpecTexts>({ weapon: {}, cls: {}, element: {}, corp: {}, squad: {} })
  /** 概览卡展开态：默认 6 项，右下角箭头展开其余 */
  const [specOpen, setSpecOpen] = useState(false)
  /** 姿态标签展开态：收起时标签向左滑出，只留左上角的展开按钮。
      移动端（与详情页单列布局同断点）默认收起，给舞台上的模型腾地方 */
  const [modesOpen, setModesOpen] = useState(defaultModesOpen)
  /** 皮肤切换区展开态：默认收起，只留底部居中的展开按钮 */
  const [skinsOpen, setSkinsOpen] = useState(false)
  /** 概览卡字段说明弹窗（与技能词条弹窗同款样式） */
  const [specPopup, setSpecPopup] = useState<{ title: string; lines: string[]; img?: string } | null>(null)
  /** 角色基础属性：等级 / 突破 / 好感三档可调，数值实时重算 */
  const [charStats, setCharStats] = useState<Record<string, CharBaseStat>>({})
  const [statCurves, setStatCurves] = useState<StatCurves | null>(null)
  const [level, setLevel] = useState(1)
  const [limitBreak, setLimitBreak] = useState(3)
  /** 极限突破（核心强化）0–7 级 */
  const [core, setCore] = useState(0)
  const [affection, setAffection] = useState(0)
  /** 好感折叠区：默认收起 */
  const [affOpen, setAffOpen] = useState(false)
  /** 属性卡页签：等级 / 装备 / 魔方 */
  const [statTab, setStatTab] = useState<'level' | 'equip' | 'cube'>('level')
  /** 魔方：18 种，等级 1-15，等级决定三围固定加成与技能档位 */
  const [cubeData, setCubeData] = useState<CubeStats>({ levels: [], cubes: [], elemental: [], tierBounds: [2, 6, 15] })
  /** null = 未装备魔方 */
  const [cubeId, setCubeId] = useState<number | null>(null)
  /** 魔方选择弹窗（九宫格，卡片内浮层） */
  const [cubePickOpen, setCubePickOpen] = useState(false)
  const cubePopRef = useRef<HTMLDivElement>(null)
  const [cubeLv, setCubeLv] = useState(1)
  /** 记录图标 404 的魔方 id（外框魔方等最新魔方本地图集未收录） */
  const [cubeIconBroken, setCubeIconBroken] = useState<number | null>(null)
  /** 珍藏品：12 款 × 16 阶段（0-15），三围加成计入总面板 */
  const [favoriteData, setFavoriteData] = useState<FavoriteStats>([])
  /** null = 未装备珍藏品 */
  const [favoriteId, setFavoriteId] = useState<number | null>(null)
  const [favoritePhase, setFavoritePhase] = useState(0)
  const [favPickOpen, setFavPickOpen] = useState(false)
  const favPopRef = useRef<HTMLDivElement>(null)
  const [favIconBroken, setFavIconBroken] = useState(false)
  /** 装备：4 部位各自选品阶与强化等级，外加两条 T10 词条 */
  const [equipData, setEquipData] = useState<EquipStats>({ items: [] })
  const [equip, setEquip] = useState<Record<EquipPart, { tier: number; enhance: number }>>({
    head: { tier: 1, enhance: 0 },
    arm: { tier: 1, enhance: 0 },
    body: { tier: 1, enhance: 0 },
    leg: { tier: 1, enhance: 0 },
  })
  /** 词条：每件装备最多 3 条（类型 + 档位） */
  const [equipOpts, setEquipOpts] = useState<Record<EquipPart, OptRow[]>>(emptyOpts)
  /** 装备统计面板：右上角按钮展开，列出三围与全部词条汇总 */
  const [statOpen, setStatOpen] = useState(false)
  /** 配装导入导出浮层：卡片内小弹窗 */
  const [ioOpen, setIoOpen] = useState(false)
  const [ioText, setIoText] = useState('')
  const [ioMsg, setIoMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const ioPopRef = useRef<HTMLDivElement>(null)
  const ioFileRef = useRef<HTMLInputElement>(null)
  /** 部队专属图标（部队中文名 → 图标路径，来自游戏 icons-squad 图集） */
  const [squadIcons, setSquadIcons] = useState<SquadIcons>({})
  /** 部队名的其他语言 + 部队 lore 翻译（squad_names.json，按部队中文名索引，缺失时回退中文） */
  const [squadNames, setSquadNames] = useState<SquadNames>({ names: {}, lore: {} })
  const [relTab, setRelTab] = useState<'stories' | 'counsel' | 'voices'>('stories')
  const [termPopup, setTermPopup] = useState<{ gid: number; term: string } | null>(null)
  const spineRef = useRef<SpineController | null>(null)
  /** 大招镜头运镜开关：默认开启（自动跟拍 + 锁定取景），关闭后可手动拖拽/缩放 */
  const [cameraFollow, setCameraFollow] = useState(true)
  /** 拖时间轴时先暂停，松手后按拖前的状态继续（与 CG 查看器同一套交互） */
  const wasPlaying = useRef(false)
  const seeking = useRef(false)
  /** 沉浸全屏：隐藏顶栏与页面其它元素，只留模型舞台 */
  const immersive = useImmersive()

  useEffect(() => {
    loadCharacters().then(setList).catch(() => setList([]))
    loadCharImages().then(setImgs).catch(() => {})
    loadCharMi().then(setMi).catch(() => {})
    loadCharSpine().then(setSpine).catch(() => {})
    loadCharCombat().then(setCombat).catch(() => {})
    loadCharSkillcut().then(setSkillcut).catch(() => {})
    loadCharSkills().then(setSkillData).catch(() => {})
    loadCharStories().then(setStoriesMap).catch(() => {})
    loadCharVoices().then(setVoiceMap).catch(() => {})
    loadCharMessages().then(setMsgData).catch(() => {})
    loadCharArt().then(setArt).catch(() => {})
    loadCostumeTexts().then(setCostumeTexts).catch(() => {})
    loadCharMeta().then(setCharMeta).catch(() => {})
    loadSpecTexts().then(setSpecTexts).catch(() => {})
    loadSquadIcons().then(setSquadIcons).catch(() => {})
    loadSquadNames().then(setSquadNames).catch(() => {})
    loadCharStats().then(setCharStats).catch(() => {})
    loadStatCurves().then(setStatCurves).catch(() => setStatCurves({}))
    loadEquipStats().then(setEquipData).catch(() => {})
    loadCubeStats().then(setCubeData).catch(() => {})
    loadFavoriteStats().then(setFavoriteData).catch(() => {})
  }, [])

  useEffect(() => {
    if (!cubePickOpen && !ioOpen && !favPickOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setCubePickOpen(false)
      setIoOpen(false)
      setFavPickOpen(false)
    }
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null
      // 点浮层内部或对应触发按钮都不算「点外面」
      if (t?.closest?.('.cube-pop, .cube-orb, .io-pop, .stat-io-btn, .fav-pop, .fav-orb')) return
      setCubePickOpen(false)
      setIoOpen(false)
      setFavPickOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [cubePickOpen, ioOpen, favPickOpen])

  useEffect(() => {
    setPick(null)
    setPose('stand')
    setForm(0)
    setStatus(EMPTY)
    setModelReady(false)
    setModelError(false)
    setSpecOpen(false)
    setModesOpen(defaultModesOpen())
    setSkinsOpen(false)
    setLevel(1)
    setLimitBreak(3)
    setCore(0)
    setAffection(0)
    setAffOpen(false)
    setStatTab('level')
    setEquipOpts(emptyOpts())
    setStatOpen(false)
    setCubePickOpen(false)
    setFavoriteId(null)
    setFavoritePhase(0)
    setFavPickOpen(false)
  }, [id])

  // 换皮肤 / 切姿态时也要把状态归零，否则控制条会短暂显示上一套模型的动作与时长
  useEffect(() => {
    setStatus(EMPTY)
    setModelReady(false)
    setModelError(false)
    // 换皮肤 / 切姿态后模型会重建，镜头运镜恢复默认开启
    setCameraFollow(true)
    // 换皮肤后新模型未必有第二形态，回到形态①（模型加载后按 anims 重新判定）
    setForm(0)
  }, [pick, pose])

  const c = list?.find((x) => String(x.id) === id) || null
  usePageTitle(c ? pickLang(lang, c.name, c.names.en, c.names.ko, c.names.ja) : null)
  // 旧版渲染图（art 表里 old: true）不是皮肤，混在切换条里会让人以为是错图；
  // c010_01 这类曾被误标的，已按 ScenarioCharacterSettingTable / 皮肤表核实后恢复
  const vars = (c ? variantsOf(imgs, c.id) : []).filter((v) => !art[v]?.old)
  const current = pick || (c ? mainBase(imgs, c.id) : null) || ''
  /** 选中皮肤的文案；基础皮没有条目，介绍回退到角色默认（c.intro） */
  const ct = costumeTexts[current]
  const artName = current ? artLabel(art, current) : ''
  const currentLabel = !artName ? '' : (c && !artName.startsWith(c.name) ? `${c.name} · ${artName}` : artName)
  const staticSrc = current ? charArt(current) : ''
  const hasModel = !!current && spine.has(current) && !modelError
  /** 当前皮肤可用的战斗姿态模型（c010_00 → c010_aim_00 / c010_cover_00） */
  const combatAvail = useMemo(() => ({
    aim: current ? combatModelName(current, 'aim', combat) : null,
    cover: current ? combatModelName(current, 'cover', combat) : null,
  }), [current, combat])
  /** 当前皮肤的大招模型（先查皮肤级映射，再查角色级兜底） */
  const burstName = useMemo(
    () => (current && skillcut ? skillcutModelName(current, skillcut) : null),
    [current, skillcut],
  )
  // 切了皮肤后当前姿态的模型不存在（该皮肤没出战斗/大招模型）就退回立绘
  useEffect(() => {
    if (pose === 'aim' && !combatAvail.aim) setPose('stand')
    else if (pose === 'cover' && !combatAvail.cover) setPose('stand')
    else if (pose === 'burst' && current && skillcut && !burstName) setPose('stand')
  }, [combatAvail, burstName, pose, current, skillcut])
  const combatName = pose === 'aim' ? combatAvail.aim : pose === 'cover' ? combatAvail.cover : null
  /** 舞台挂的是不是实时模型（立绘站姿/战斗姿态/大招都算） */
  const stageLive = pose === 'stand' ? hasModel : pose === 'burst' ? !!burstName : !!combatName
  const skills = id ? skillData.items[String(id)] : null
  const rel = id ? storiesMap[String(id)] : null
  const relStories = rel?.stories ?? []
  const relCounsel = rel?.counsel ?? []
  const voice = id ? voiceMap[String(id)] : null
  const hasVoices = !!voice && voice.n > 0
  const msg = id ? msgData?.items[String(id)] : null
  const msgRooms = msg?.rooms ?? []
  const hasMsg = msgRooms.length > 0
  const hasStoryRel = relStories.length > 0 || relCounsel.length > 0 || hasVoices
  /** 切角色时把 tab 复位到有内容的那一边 */
  useEffect(() => {
    setRelTab((t) => {
      const has = {
        stories: relStories.length > 0,
        counsel: relCounsel.length > 0,
        voices: hasVoices,
      }
      if (has[t]) return t
      if (has.stories) return 'stories'
      if (has.counsel) return 'counsel'
      if (has.voices) return 'voices'
      return 'stories'
    })
  }, [id, hasVoices, relStories.length, relCounsel.length])
  // 口型（talk_*）是配合台词的 0 时长姿态；bg_* 只驱动背景（有的模型里这两类
  // 动画根本没有可见部件，选中会只剩空舞台）；战斗模式的 to_aim/to_cover 是
  // 姿态间过渡，都不列出来
  const anims = useMemo(
    () => status.anims.filter((a) => !a.startsWith('talk') && !a.startsWith('bg_')
      && !(pose !== 'stand' && a.startsWith('to_'))),
    [status.anims, pose],
  )
  // 第二形态（只对站姿模型有意义）：把成套变体动画分成两组，用独立按钮切换。
  // 形态①/②各自驱动一套表情按钮，避免变体动画挤在「更多表情」下拉里。
  const formInfo = useMemo(
    () => (pose === 'stand' ? detectFormVariants(anims, current) : null),
    [anims, pose, current],
  )
  const shownAnims = useMemo(
    () => (formInfo ? (form === 0 ? formInfo.form1 : formInfo.form2) : anims),
    [formInfo, form, anims],
  )
  const chips = useMemo(
    () => (pose === 'burst' ? pickBurstChips(shownAnims, burstName || undefined)
      : pickChips(shownAnims, pose === 'stand' ? CHIP_DEFS : COMBAT_CHIP_DEFS)),
    [shownAnims, pose, burstName],
  )
  const extras = useMemo(() => {
    const used = new Set(chips.map((c) => c.anim))
    return shownAnims.filter((a) => !used.has(a))
  }, [shownAnims, chips])
  const onChip = chips.some((c) => c.anim === status.anim)
  /** 当前动画是否在「更多表情」下拉里。都不在（如被过滤的 bg_/talk_ 动画，
      或换皮肤瞬间 status 还没跟上）时下拉应回落到空占位，否则 value 指向一个
      不存在的 option，浏览器会把它显示成选中的「更多表情」——看着像静帧 bug。 */
  const onMore = !onChip && extras.includes(status.anim)
  /** 切第二形态：有过渡动画就先播变身动画、播完自动停在目标形态；否则直接切。
   *  目标动画优先保持当前表情（idle↔idle_02），无配对则回该形态待机。 */
  const switchForm = useCallback((next: number) => {
    if (!formInfo || next === form) return
    const list = next === 0 ? formInfo.form1 : formInfo.form2
    const pair = formInfo.pairs.find((p) => p[1] === status.anim || p[2] === status.anim)
    let target = pair ? (next === 0 ? pair[1] : pair[2]) : undefined
    // 待机的特殊处理：切到形态②时优先落在 form2Idle（如 idle_alt），因为变身动画的
    // 末帧姿势与 idle_02 不同，直接用 idle_02 会让画面在切换完成瞬间跳一下。
    if (next === 1 && formInfo.form2Idle && (!pair || /^idle/.test(pair[0]))) {
      target = formInfo.form2Idle
    }
    if (!target || !list.includes(target)) {
      target = (next === 1 ? formInfo.form2Idle : null)
        || list.find((a) => a === 'idle')
        || list.find((a) => /(^|_)idle$/i.test(a) && !/^(bg_|talk_)/i.test(a))
        || list[0]
    }
    const trans = next === 1 ? formInfo.toForm2 : formInfo.toForm1
    setForm(next)
    if (target) {
      if (trans) spineRef.current?.playOnce(trans, target)
      else spineRef.current?.setAnim(target)
    }
  }, [formInfo, form, status.anim])
  /** 时间轴已播放段的填充比例，写入 --cv-pct 给滑块画进度 */
  const pct = status.duration > 0
    ? Math.max(0, Math.min(100, status.time / status.duration * 100)) : 0

  const toggle = useCallback(() => spineRef.current?.toggle(), [])
  const resetView = useCallback(() => spineRef.current?.resetView(), [])
  const saveFrame = useCallback(() => {
    const nm = pose === 'stand' ? current
      : pose === 'burst' ? (burstName || current) : (combatName || current)
    spineRef.current?.saveFrame(`${nm}_${status.anim}_${status.time.toFixed(2)}.png`)
  }, [current, burstName, combatName, pose, status.anim, status.time])

  /** 群聊里每个发言人的官方头肩头像；没有头像的 NPC 返回 null */
  const avatarOf = useCallback((cid: number) => {
    const base = mainBase(imgs, cid)
    return charAvatar(base, mi)
  }, [imgs, mi])

  // ---- 时间轴（与 CG 查看器同一套交互：拖动时暂停、松手续播、交还焦点）----
  const canSeek = hasModel && modelReady && status.duration > 0
  const onSeekStart = () => {
    if (!canSeek) return
    wasPlaying.current = status.playing
    seeking.current = true
    spineRef.current?.pause()
  }
  const onSeekEnd = () => {
    if (!seeking.current) return
    seeking.current = false
    if (wasPlaying.current) spineRef.current?.play()
    // 焦点留在滑块上会让空格被浏览器吃掉，还会画出 focus 外框，拖完就 blur
    if (document.activeElement instanceof HTMLInputElement
      && document.activeElement.type === 'range') document.activeElement.blur()
  }
  const onSeek = (v: number) => {
    setStatus((s) => ({ ...s, time: v }))
    spineRef.current?.seek(v)
  }

  // 键盘：空格播放/暂停，R 复位取景。只排除文本类输入；type=range 必须放行，
  // 否则拖过时间轴后焦点留在滑块上，空格播放/暂停会失效
  useEffect(() => {
    if (!hasModel) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const tag = t?.tagName
      const typing = t?.isContentEditable || tag === 'SELECT'
        || tag === 'TEXTAREA'
        || (tag === 'INPUT' && (t as HTMLInputElement).type !== 'range')
      if (typing) return
      if (e.code === 'Space') { e.preventDefault(); toggle() }
      else if (e.key === 'r' || e.key === 'R') resetView()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hasModel, toggle, resetView])

  if (!list) return <div className="loading">LOADING…</div>
  if (!c) return <div className="empty">CHARACTER NOT FOUND</div>

  /** 属性卡内的部位 / 词条 / 珍藏品效果名按内容语言显示，未映射的回退中文原文 */
  const partName = (p: EquipPart) => t(EQUIP_PART_KEY[p])
  const optLabel = (key: string) => {
    const k = EQUIP_OPT_KEY[key]
    if (k) return t(k)
    return EQUIP_OPTIONS.find((x) => x.key === key)?.label ?? key
  }
  const fxLabel = (label: string) => {
    const k = FAV_FX_KEY[label]
    return k ? t(k) : label
  }

  const desc = (pickLang(lang, c.desc, c.descEn, c.descKo, c.descJa) || '').split('\n').filter(Boolean)
  const displayName = pickLang(lang, c.name, c.names.en, c.names.ko, c.names.ja)
  const latinName = lang === 'zh' ? c.names.en : c.names.zh
  // 皮肤文案只有中文；切到其他语言时用角色本体的对应语言签名，而不是半截中文
  const introText = lang === 'zh'
    ? (ct?.intro || c.intro)
    : pickLang(lang, c.intro, c.introEn, c.introKo, c.introJa)
  const palette = tintFor(c.id)
  /** 校准模式：URL query 带 calib=1 时在大招视图显示背景板微调面板（人工对齐采数） */
  const calibMode = /[?&]calib=1/.test(window.location.search)

  /** 概览卡条目：游戏元数据（部队/企业/武器/爆裂/兵种/属性）优先，缺失的自动跳过；popup = 点击弹窗内容 */
  const meta = charMeta[String(c.id)]

  /* ---- 基础属性卡：等级滑块 / 突破星级 / 好感折叠 / 装备与词条 ---- */
  const baseStat = charStats[String(c.id)]
  const curve = baseStat && statCurves ? statCurves[String(baseStat.template)] : undefined
  const lbMax = LB_MAX_LEVEL[limitBreak]
  const lv = Math.min(level, lbMax)

  /* 装备：4 部位按当前角色职业取表，强化每级 +10% */
  const equipCls = baseStat?.cls ?? 1
  const equipRows = EQUIP_PARTS.map((part) => {
    const sel = equip[part]
    const row = equipData.items.find((r) => r.part === part && r.cls === equipCls && r.tier === sel.tier)
    const mul = 1 + sel.enhance * EQUIP_ENHANCE_RATE
    return {
      part,
      tier: sel.tier,
      enhance: sel.enhance,
      atk: row ? Math.round(row.atk * mul) : 0,
      hp: row ? Math.round(row.hp * mul) : 0,
      def: row ? Math.round(row.def * mul) : 0,
    }
  })
  const equipTotal = equipRows.reduce(
    (a, r) => ({ atk: a.atk + r.atk, hp: a.hp + r.hp, def: a.def + r.def }),
    { atk: 0, hp: 0, def: 0 },
  )

  /** 词条里的攻击力/防御力百分比，汇总后乘在最终三围上（只有 T10 装备才有词条） */
  let optAtkPct = 0
  let optDefPct = 0
  for (const part of EQUIP_PARTS) {
    if (equip[part].tier !== 10) continue
    for (const o of equipOpts[part]) {
      if (!o.key || o.tier < 1) continue
      const opt = EQUIP_OPTIONS.find((x) => x.key === o.key)
      const v = opt?.tiers[o.tier - 1]
      if (v == null) continue
      if (o.key === 'atk') optAtkPct += v
      else if (o.key === 'def') optDefPct += v
    }
  }

  const updateOpt = (part: EquipPart, idx: number, patch: Partial<OptRow>) => {
    setEquipOpts((prev) => ({
      ...prev,
      [part]: prev[part].map((x, k) => (k === idx ? { ...x, ...patch } : x)),
    }))
  }
  const typeOptions: SelectOpt[] = [
    { value: '', label: '—' },
    ...EQUIP_OPTIONS.map((o) => ({ value: o.key, label: optLabel(o.key) })),
  ]

  /** 装备统计：9 类词条各自累计（只有 T10 装备才有词条） */
  const optSummary = EQUIP_OPTIONS.map((opt) => {
    let total = 0
    for (const part of EQUIP_PARTS) {
      if (equip[part].tier !== 10) continue
      for (const o of equipOpts[part]) {
        if (o.key === opt.key && o.tier > 0) total += opt.tiers[o.tier - 1] ?? 0
      }
    }
    return { key: opt.key, label: optLabel(opt.key), total }
  })

  /** 角色基础装弹数（CharacterShotTable 逆向）；装备/魔方/珍藏品的加成在下方汇总 */
  const ammoPct = optSummary.find((o) => o.key === 'ammo')?.total ?? 0
  const baseAmmo = meta?.ammo ?? null

  /** 魔方：等级决定三围固定加成（18 种魔方共用），技能效果按 Lv1-2 / 3-6 / 7-15 三档 */
  /** 未装备魔方时为 null，此时三围不含任何魔方加成 */
  const cube = cubeId == null ? null : cubeData.cubes.find((x) => x.id === cubeId) ?? null
  const cubeLvCur = Math.min(Math.max(1, cubeLv), CUBE_MAX_LEVEL)
  const cubeRow = cube ? cubeData.levels[cubeLvCur - 1] ?? null : null
  const cubeTier = cubeTierIndex(cubeLvCur, cubeData.tierBounds)
  const cubeEffectVal = cube ? cube.tiers[cubeTier] ?? 0 : 0
  const cubeElem = cube ? cubeData.elemental[cubeLvCur - 1] ?? null : null
  const cubeFlat = {
    atk: cubeRow?.atk ?? 0,
    def: cubeRow?.def ?? 0,
    hp: cubeRow?.hp ?? 0,
  }
  const cubeHpPct = cube?.affects === 'hp' ? cubeEffectVal : 0
  const cubeDefPct = cube?.affects === 'def' ? cubeEffectVal : 0

  /** 珍藏品按武器职业分类：每个妮姬只能用自己武器类型的 R / SR 两款 */
  const favWeapon = meta?.weapon ?? null
  const favoriteChoices = favoriteData.filter((f) => f.cls === favWeapon)
  /** 珍藏品：选中款在对应阶段的三围固定加成（加法，与装备/魔方同类） */
  const favorite = favoriteId == null ? null : favoriteData.find((f) => f.id === favoriteId && f.cls === favWeapon) ?? null
  const favoritePhaseCur = Math.min(Math.max(0, favoritePhase), 15)
  const favRow = favorite?.levels[favoritePhaseCur] ?? null
  const favoriteFlat = {
    hp: favRow?.hp ?? 0,
    atk: favRow?.atk ?? 0,
    def: favRow?.def ?? 0,
  }
  const favTier = favoriteTierIndex(favoritePhaseCur)
  const favEffects = favorite ? FAVORITE_EFFECTS[favorite.cls] ?? [] : []
  const favoriteIconSrc = favorite ? favoriteIcon(favorite.cls) : ''
  /** 珍藏品「防御力增加」（心灵的支柱）按阶段分档，计入 DEF 百分比乘算；其他战斗效果暂不计入 */
  const favDefEffect = favEffects.find((e) => e.label === '防御力增加')
  const favoriteDefPct = favDefEffect ? favDefEffect.tiers[favTier] ?? 0 : 0

  /** 总装弹数：装备词条 + 魔方「最大装弹数增加」+ 珍藏品「最大装弹数增加」的百分比先加算，
   *  再一次乘到基础值上（与三围词条的 Σ% 乘算同构），最后 round。 */
  const cubeAmmoPct = cube?.key === 'artifact_all_6' ? cubeEffectVal : 0
  const favAmmoEffect = favEffects.find((e) => e.label === '最大装弹数增加')
  const favoriteAmmoPct = favAmmoEffect ? favAmmoEffect.tiers[favTier] ?? 0 : 0
  const totalAmmoPct = ammoPct + cubeAmmoPct + favoriteAmmoPct
  const totalAmmo = baseAmmo != null && totalAmmoPct > 0
    ? Math.round(baseAmmo * (1 + totalAmmoPct / 100)) : null

  /** 曲线基础值 → 逐星突破（×1.02 + 固定值）→ 极限 ×1.02 → 好感 → ＋装备＋魔方＋珍藏品 → ×百分比 */
  let statCalc: {
    hp: number; atk: number; def: number
    /** 百分比换算出的固定值，用于面板核对 */
    optAtkFlat: number; optDefFlat: number
    cubeHpFlat: number; cubeDefFlat: number; favoriteDefFlat: number
  } | null = null
  if (curve && baseStat) {
    const i = Math.max(0, lv - 1)
    if (i < curve.hp.length) {
      let hp = curve.hp[i]
      let atk = curve.atk[i]
      let dfn = curve.def[i]
      const g = LB_GAIN[baseStat.rarity] || LB_GAIN.SSR
      for (let k = 0; k < limitBreak; k++) {
        hp = hp * 1.02 + g.hp
        atk = atk * 1.02 + g.atk
        dfn = dfn * 1.02 + g.def
      }
      // 极限突破（核心强化）：每级 +2%，无固定值
      const coreMul = (1 + CORE_RATE) ** core
      hp *= coreMul
      atk *= coreMul
      dfn *= coreMul
      // 好感按比例加，装备/魔方/珍藏品按固定值加（游戏内都是加法）
      const affMul = 1 + affection * AFFECTION_PER_LV
      hp = hp * affMul + equipTotal.hp + cubeFlat.hp + favoriteFlat.hp
      atk = atk * affMul + equipTotal.atk + cubeFlat.atk + favoriteFlat.atk
      dfn = dfn * affMul + equipTotal.def + cubeFlat.def + favoriteFlat.def
      // 百分比（装备词条 + 魔方技能 + 珍藏品防御）作用在「含固定加成的白板」上
      const optAtkFlat = atk * optAtkPct / 100
      const optDefFlat = dfn * optDefPct / 100
      const cubeDefFlat = dfn * cubeDefPct / 100
      const cubeHpFlat = hp * cubeHpPct / 100
      const favoriteDefFlat = dfn * favoriteDefPct / 100
      atk += optAtkFlat
      dfn += optDefFlat + cubeDefFlat + favoriteDefFlat
      hp += cubeHpFlat
      statCalc = {
        hp: Math.round(hp),
        atk: Math.round(atk),
        def: Math.round(dfn),
        optAtkFlat: Math.round(optAtkFlat),
        optDefFlat: Math.round(optDefFlat),
        cubeHpFlat: Math.round(cubeHpFlat),
        cubeDefFlat: Math.round(cubeDefFlat),
        favoriteDefFlat: Math.round(favoriteDefFlat),
      }
    }
  }
  const affMax = affectionMax(meta?.corp)

  /* ---- 配装导入导出 ---- */
  const openIo = () => {
    const preset: BuildPreset = {
      v: 1,
      lv: level, lb: limitBreak, co: core, af: affection,
      eq: Object.fromEntries(EQUIP_PARTS.map((p) => [p, [equip[p].tier, equip[p].enhance]])) as BuildPreset['eq'],
      op: Object.fromEntries(EQUIP_PARTS.map((p) => [p, equipOpts[p].filter((r) => r.key).map((r) => [r.key, r.tier])])) as BuildPreset['op'],
      cu: cubeId, cl: cubeLv,
      fv: favoriteId, fp: favoritePhase,
    }
    setIoText(encodePreset(preset))
    setIoMsg(null)
    setStatOpen(false)
    setCubePickOpen(false)
    setIoOpen(true)
  }

  const applyPreset = (raw: string) => {
    const p = parsePreset(raw)
    if (!p) {
      setIoMsg({ ok: false, text: t('io_invalid') })
      return
    }
    setLevel(Math.min(p.lv, LB_MAX_LEVEL[p.lb]))
    setLimitBreak(p.lb)
    setCore(p.co)
    setAffection(Math.min(p.af, affMax))
    setCubeLv(p.cl)
    setCubeId(p.cu != null && cubeData.cubes.some((cb) => cb.id === p.cu) ? p.cu : null)
    setFavoritePhase(p.fp ?? 0)
    setFavoriteId(p.fv != null && favoriteData.some((f) => f.id === p.fv) ? p.fv : null)
    setFavIconBroken(false)
    setEquip(Object.fromEntries(EQUIP_PARTS.map((part) => [part, { tier: p.eq[part][0], enhance: p.eq[part][1] }])) as typeof equip)
    setEquipOpts(Object.fromEntries(EQUIP_PARTS.map((part) => [
      part,
      p.op[part].map(([key, tier]) => ({ key, tier })),
    ])) as typeof equipOpts)
    setIoText(encodePreset(p))
    setIoMsg({ ok: true, text: t('io_applied') })
  }

  const copyIo = async () => {
    try {
      await navigator.clipboard.writeText(ioText)
      setIoMsg({ ok: true, text: t('io_copied') })
    } catch {
      setIoMsg({ ok: false, text: t('io_copy_fail') })
    }
  }

  const importIoFile = (file: File | undefined) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '').trim()
      setIoText(text)
      applyPreset(text)
    }
    reader.onerror = () => setIoMsg({ ok: false, text: t('io_read_fail') })
    reader.readAsText(file)
  }

  const exportIoFile = () => {
    const blob = new Blob([ioText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `NIKKE-配装-Lv${lv}.txt`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    setIoMsg({ ok: true, text: t('io_exported') })
  }

  /** 概览卡里的游戏术语按内容语言取官方文本，缺失时回退中文。 */
  const specName = (e: { name?: string; nameEn?: string; nameKo?: string; nameJa?: string } | undefined, fallbackZh: string) =>
    pickLang(lang, e?.name || fallbackZh, e?.nameEn, e?.nameKo, e?.nameJa)
  const specDesc = (e: { desc?: string; descEn?: string; descKo?: string; descJa?: string } | undefined) =>
    pickLang(lang, e?.desc || '', e?.descEn, e?.descKo, e?.descJa)

  const specItems: { key: string; label: string; node: ReactNode; style?: CSSProperties; popup?: { title: string; lines: string[]; img?: string } }[] = []
  if (meta?.squad) {
    // 部队官方世界观介绍（游戏内部队档案原文），弹窗顶部带游戏内部队专属图标；
    // 部队名与 lore 翻译在 squad_names.json（按部队中文名索引），缺失时回退中文
    const loreZh = specTexts.squad[meta.squad]
    const loreLoc = squadNames.lore[meta.squad]
    const lore = loreZh != null
      ? pickLang(lang, loreZh, loreLoc?.en, loreLoc?.ko, loreLoc?.ja).split('\n')
      : ['该妮姬在游戏档案中的所属部队。']
    const squadName = pickLang(lang, meta.squad,
      squadNames.names[meta.squad]?.en, squadNames.names[meta.squad]?.ko, squadNames.names[meta.squad]?.ja)
    specItems.push({
      key: 'squad', label: t('spec_squad'), node: squadName, style: { fontSize: 15 },
      popup: { title: fmt(t('popup_about'), { n: squadName }), lines: lore, img: squadIcons[meta.squad] || squadIcons._default },
    })
  }
  if (meta?.corp && SPEC_CORP[meta.corp]) {
    // 企业官方世界观介绍（回收研究所文本）；中央政府/伊甸园/V.T.C.(101-103)无官方文本，回退自拟
    const cp = specTexts.corp[String(meta.corp)]
    const corpName = specName(cp, SPEC_CORP[meta.corp])
    const corpDesc = specDesc(cp)
    const corpLines = corpDesc
      ? corpDesc.split('\n').filter(Boolean)
      : SPEC_CORP_DESC[meta.corp]
    specItems.push({
      key: 'corp', label: t('spec_corp'), style: { fontSize: 15 },
      node: (
        <span className="spec-weapon">
          {SPEC_CORP_ICN[meta.corp] && <SpecIcon icn={SPEC_CORP_ICN[meta.corp]} />}
          {corpName}
        </span>
      ),
      popup: { title: fmt(t('popup_about'), { n: corpName }), lines: corpLines },
    })
  }
  if (meta?.weapon && SPEC_WEAPON[meta.weapon]) {
    const wt = specTexts.weapon[meta.weapon]
    const weaponName = specName(wt, SPEC_WEAPON[meta.weapon])
    const weaponDesc = specDesc(wt)
    specItems.push({
      key: 'weapon', label: t('spec_weapon'), style: { fontSize: 15 },
      node: (
        <span className="spec-weapon">
          <SpecIcon icn={`weapon_${meta.weapon}`} />
          {weaponName}
          {baseAmmo != null && (
            <span
              className="spec-ammo"
              title={totalAmmoPct > 0
                ? `${t('spec_gv_ammo')} ${baseAmmo} × (1 + ${totalAmmoPct.toFixed(2)}%) = ${totalAmmo}`
                : t('spec_gv_ammo')}
            >
              <SpecIcon icn="weapon_reload" />{totalAmmo ?? baseAmmo}
            </span>
          )}
        </span>
      ),
      popup: weaponDesc ? { title: fmt(t('popup_about'), { n: weaponName }), lines: [weaponDesc] } : undefined,
    })
  }
  if (meta?.burst && SPEC_BURST[meta.burst]) {
    // 爆裂阶段显示名没有游戏文本，用 UI 词典（SPEC_BURST 数值 1/2/3/5 映射）
    const burstLabel = meta.burst === 1 ? t('burst_1')
      : meta.burst === 2 ? t('burst_2')
        : meta.burst === 3 ? t('burst_3') : t('burst_all')
    specItems.push({
      key: 'burst', label: t('spec_burst'),
      // 爆裂徽章用游戏原图标；5 = 全爆裂（小红帽），并列显示 Ⅰ Ⅱ Ⅲ 三枚
      node: meta.burst <= 3 ? (
        <SpecIcon icn={`burst_${meta.burst}`} />
      ) : (
        <span className="spec-weapon">
          {[1, 2, 3].map((b) => <SpecIcon key={b} icn={`burst_${b}`} />)}
        </span>
      ),
      popup: { title: fmt(t('popup_about'), { n: burstLabel }), lines: SPEC_BURST_DESC[meta.burst] },
    })
  }
  if (meta?.cls && SPEC_CLS[meta.cls]) {
    const ct = specTexts.cls[String(meta.cls)]
    const className = specName(ct, SPEC_CLS[meta.cls])
    const classDesc = specDesc(ct)
    specItems.push({
      key: 'cls', label: t('spec_cls'), style: { fontSize: 15 },
      node: (
        <span className="spec-weapon">
          {SPEC_CLS_ICN[meta.cls] && <SpecIcon icn={SPEC_CLS_ICN[meta.cls]} />}
          {className}
        </span>
      ),
      popup: classDesc ? { title: fmt(t('popup_about'), { n: className }), lines: [classDesc] } : undefined,
    })
  }
  if (meta?.element && SPEC_ELEMENT[meta.element]) {
    const et = specTexts.element[meta.element]
    const elementName = specName(et, SPEC_ELEMENT[meta.element])
    const elementDesc = specDesc(et)
    specItems.push({
      key: 'element', label: t('spec_element'), style: { fontSize: 15 },
      node: (
        <span className="spec-weapon">
          <SpecIcon icn={SPEC_ELEMENT_ICN[meta.element]} />
          {elementName}
        </span>
      ),
      popup: elementDesc
        ? { title: fmt(t('popup_about'), { n: elementName }), lines: [elementDesc] }
        : undefined,
    })
  }
  specItems.push(
    { key: 'lines', label: t('spec_lines'), node: c.lines > 0 ? nf(c.lines) : '—' },
    { key: 'cv', label: t('spec_cv'), node: c.cv || t('spec_cv_none'), style: { fontSize: 15 } },
    { key: 'arts', label: t('spec_arts'), node: vars.length || '—' },
    { key: 'gid', label: 'GAME ID', node: c.id, style: { fontSize: 15 } },
    { key: 'ja', label: t('spec_ja_name'), node: c.names.ja || '—', style: { fontSize: 15 } },
    { key: 'ko', label: t('spec_ko_name'), node: c.names.ko || '—', style: { fontSize: 15 } },
  )
  /** 默认显示 6 个（与旧版一致），其余收进箭头展开；展开后再点收回 */
  const SPEC_DEFAULT = 6
  const specShown = specOpen ? specItems : specItems.slice(0, SPEC_DEFAULT)
  const specHidden = specItems.length - SPEC_DEFAULT
  /** 首项带角色高亮色（不少 NPC 没有部队，高亮固定在部队字段会落空） */
  if (specItems.length > 0) {
    specItems[0].style = { ...specItems[0].style, color: accentFor(c.id) }
  }

  /** 弹窗：技能词条弹窗与概览卡说明弹窗共用同一套样式 */
  const termLines = lang === 'en'
    ? skillData.termsEn?.[termPopup?.gid ?? -1]
    : lang === 'ko'
      ? skillData.termsKo?.[termPopup?.gid ?? -1]
      : lang === 'ja'
        ? skillData.termsJa?.[termPopup?.gid ?? -1]
        : skillData.terms[termPopup?.gid ?? -1]
  const popup = termPopup
    ? {
        title: fmt(t('popup_about'), { n: termPopup.term }),
        lines: termLines?.length ? termLines : (skillData.terms[termPopup.gid] || []),
      }
    : specPopup
  const closePopup = () => {
    setTermPopup(null)
    setSpecPopup(null)
  }

  return (
    <div className="detail-page">
      {immersive.active && <ImmersiveExitButton onClick={immersive.exit} />}
      {popup && (
        <div className="word-modal" onClick={closePopup}>
          <div className="word-card" onClick={(e) => e.stopPropagation()}>
            <button className="word-close" onClick={closePopup} aria-label={t('common_close')}>×</button>
            {popup.img && <i className="word-logo" style={{ ['--logo' as string]: `url(${popup.img})` }} aria-hidden />}
            <div className="word-title">{popup.title}</div>
            {popup.lines.map((line, i) => (
              <div className="word-line" key={i}><i>◇</i><span>{line}</span></div>
            ))}
            {popup.lines.length === 0 && (
              <div className="word-line"><i>◇</i><span>{t('term_none')}</span></div>
            )}
          </div>
        </div>
      )}
      <div className="detail">
        <div className="detail-visual" style={{ ['--tint' as string]: palette }}>
          {/* 模型就绪前不铺旧静态图：那帧的姿势/取景和实时模型对不上，看着像渲染错误 */}
          <div className={`stage char-stage ${stageLive ? 'is-live' : ''} ${modelReady ? 'is-ready' : ''}`}>
            {pose === 'stand' ? (
              hasModel ? (
                <SpinePlayer
                  name={current}
                  dir="spine_char"
                  layerNames={layerConfigFor(current)}
                  controls={false}
                  controllerRef={spineRef}
                  onTick={setStatus}
                  onReady={() => setModelReady(true)}
                  onError={() => setModelError(true)}
                />
              ) : current ? (
                <ImageViewer
                  key={current}
                  src={staticSrc}
                  alt={c.name}
                  max={4}
                  extra={(
                    <a
                      className="iv-btn"
                      href={staticSrc}
                      target="_blank"
                      rel="noreferrer"
                      title={t('char_view_orig')}
                    >↗</a>
                  )}
                />
              ) : (
                <div className="char-empty-mark">{c.name.slice(0, 1)}</div>
              )
            ) : pose === 'burst' && burstName ? (
              <SpinePlayer
                name={burstName}
                dir="spine_skillcut"
                pickDefaultAnim={pickBurstAnim}
                bgSegment={burstBgSegment(burstName)}
                sceneBg={skillcut?.bg.has(burstName) ? `/spine_skillcut/${burstName}/bg.webp` : undefined}
                sceneBg2={skillcut?.bg2.has(burstName) ? `/spine_skillcut/${burstName}/bg2.webp` : undefined}
                sceneBg3={skillcut?.bg3.has(burstName) ? `/spine_skillcut/${burstName}/bg3.webp` : undefined}
                sceneBg4={skillcut?.bg4.has(burstName) ? `/spine_skillcut/${burstName}/bg4.webp` : undefined}
                calib={calibMode}
                controls={false}
                controllerRef={spineRef}
                onTick={setStatus}
                onReady={() => setModelReady(true)}
                onError={() => setPose('stand')}
              />
            ) : combatName ? (
              <SpinePlayer
                name={combatName}
                dir="spine_combat"
                controls={false}
                controllerRef={spineRef}
                onTick={setStatus}
                onReady={() => setModelReady(true)}
                onError={() => setPose('stand')}
              />
            ) : null}
            {stageLive && !modelReady && (
              <div className="char-loading"><span className="cv-spin" />{t('char_loading_model')}</div>
            )}
            {/* 有战斗/大招模型时徽标换成姿态切换；否则维持原来的实时徽标 */}
            {(combatAvail.aim || combatAvail.cover || burstName) ? (
              <div className={`char-modes ${modesOpen ? '' : 'is-collapsed'}`}>
                <div className="char-modes-tabs">
                  <button className={pose === 'stand' ? 'on' : ''} onClick={() => setPose('stand')}>
                    {t('pose_stand')}
                  </button>
                  {combatAvail.aim && (
                    <button className={pose === 'aim' ? 'on' : ''} onClick={() => setPose('aim')}>
                      {t('pose_aim')}
                    </button>
                  )}
                  {combatAvail.cover && (
                    <button className={pose === 'cover' ? 'on' : ''} onClick={() => setPose('cover')}>
                      {t('pose_cover')}
                    </button>
                  )}
                  {burstName && (
                    <button className={pose === 'burst' ? 'on' : ''} onClick={() => setPose('burst')}>
                      {t('pose_burst')}
                    </button>
                  )}
                </div>
                <button
                  className="char-modes-toggle"
                  onClick={() => setModesOpen((v) => !v)}
                  aria-expanded={modesOpen}
                  title={modesOpen ? t('modes_collapse') : t('modes_expand')}
                >
                  <i className="char-modes-arrow" aria-hidden />
                </button>
              </div>
            ) : (
              <div className={`char-live ${modelReady ? 'on' : ''}`}>
                <i />{modelReady ? t('cg_live_model') : t('char_live_loading')}
              </div>
            )}

            {/* 皮肤切换条：绝对定位浮在舞台底部居中，不占布局——收起/展开
                都不会移动舞台与角色。展开钮排在缩略图行末尾：展开时随图标
                一起从中间滑到右侧并放大，收起时图标塌缩、按钮滑回居中缩小 */}
            {vars.length > 1 && (
              <div className={`variants ${skinsOpen ? '' : 'is-collapsed'}`}>
                <div className="variants-body">
                  {vars.map((v) => {
                    const label = artLabel(art, v)
                    return (
                      <button
                        key={v}
                        className={`vt-thumb ${v === current ? 'on' : ''}`}
                        onClick={() => setPick(v)}
                        title={`${spine.has(v) ? `${label} · ${t('vt_live_tag')}` : label}${costumeTexts[v]?.desc ? `\n${costumeTexts[v].desc.replace(/\n/g, ' ')}` : ''}`}
                      >
                        <img src={charThumb(v, mi)} alt={label} loading="lazy" />
                        {spine.has(v) && <i className="vt-live" />}
                      </button>
                    )
                  })}
                  <button
                    className="variants-toggle"
                    onClick={() => setSkinsOpen((v) => !v)}
                    aria-expanded={skinsOpen}
                    title={skinsOpen ? t('variants_collapse') : t('variants_expand')}
                  >
                    <i className="variants-toggle-arrow" aria-hidden />
                  </button>
                </div>
                <div className="variants-foot">
                  <div className="variant-caption">
                    {currentLabel}
                    {ct?.desc && (
                      <span className="variant-caption-desc"> · {ct.desc.replace(/\n/g, ' ')}</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 实时模型控制条：表情 / 时间轴 / 速度 / 取景 / 保存当前帧 */}
          {hasModel && (
            <div className="char-bar">
              <div className="char-anims">
                {/* 第二形态切换：仅站姿模型存在成套变体动画时出现 */}
                {formInfo && (
                  <div className="char-form-switch" role="group" aria-label={t('form_1')}>
                    <button
                      className={form === 0 ? 'on' : ''}
                      onClick={() => switchForm(0)}
                      title={t('form_1')}
                    >{t('form_1')}</button>
                    <button
                      className={form === 1 ? 'on' : ''}
                      onClick={() => switchForm(1)}
                      title={t('form_2_title')}
                    >{t('form_2')}</button>
                  </div>
                )}
                {chips.length === 0 && (
                  <span className="char-anims-hint">
                    {pose === 'stand' ? t('anims_loading_stand')
                      : pose === 'burst' ? t('anims_loading_burst') : t('anims_loading_combat')}
                  </span>
                )}
                {chips.map((c2) => (
                  <button
                    key={c2.anim}
                    className={c2.anim === status.anim ? 'on' : ''}
                    onClick={() => spineRef.current?.setAnim(c2.anim)}
                    title={c2.anim}
                  >
                    {t(c2.label)}
                  </button>
                ))}
                {extras.length > 0 && (
                  <select
                    className={`char-more ${onMore ? 'on' : ''}`}
                    value={onMore ? status.anim : ''}
                    onChange={(e) => e.target.value && spineRef.current?.setAnim(e.target.value)}
                    title={pose === 'stand' ? t('more_anims_stand')
                      : pose === 'burst' ? t('more_anims_burst') : t('more_anims_combat')}
                  >
                    <option value="">
                      {pose === 'stand' ? t('more_anims_stand')
                        : pose === 'burst' ? t('more_anims_burst') : t('more_anims_combat')}
                    </option>
                    {extras.map((a) => <option key={a} value={a}>{animLabel(a, t)}</option>)}
                  </select>
                )}
              </div>
              <div className="char-timeline">
                <span className="cv-time">{fmtTime(status.time)}</span>
                <input
                  className="cv-seek"
                  type="range"
                  min={0}
                  max={status.duration || 1}
                  step={0.01}
                  value={Math.min(status.time, status.duration || 1)}
                  disabled={!canSeek}
                  style={{ '--cv-pct': `${pct}%` } as CSSProperties}
                  onPointerDown={onSeekStart}
                  onPointerUp={onSeekEnd}
                  onPointerCancel={onSeekEnd}
                  onBlur={onSeekEnd}
                  onChange={(e) => onSeek(Number(e.target.value))}
                  aria-label={t('cg_timeline')}
                />
                <span className="cv-time dim">{fmtTime(status.duration)}</span>
              </div>
              <div className="char-bar-row">
                <button className="cb-play" onClick={toggle} disabled={!modelReady} title={t('voice_play_pause')}>
                  <PlayPauseIcon playing={status.playing} size="15" />
                </button>
                <label className="cb-speed">
                  <select
                    value={status.speed}
                    onChange={(e) => spineRef.current?.setSpeed(Number(e.target.value))}
                  >
                    {SPEEDS.map((v) => <option key={v} value={v}>{v}×</option>)}
                  </select>
                </label>
                <span className="cb-spacer" />
                {pose === 'burst' && (
                  <button
                    className={`cb-btn cb-camera ${cameraFollow ? 'on' : ''}`}
                    disabled={!modelReady}
                    onClick={() => {
                      const next = !cameraFollow
                      setCameraFollow(next)
                      spineRef.current?.setCameraFollow?.(next)
                    }}
                    title={cameraFollow ? t('cam_t_follow_on') : t('cam_t_follow_off')}
                  >
                    {t('cam_follow')} {cameraFollow ? t('cam_on') : t('cam_off')}
                  </button>
                )}
                <button className="cb-btn" onClick={resetView} title={t('char_reset_title')}>
                  ⟲ {status.zoom.toFixed(1)}×
                </button>
                <button className="cb-btn" onClick={saveFrame} title={t('char_save_title')}>⤓</button>
                <button className="cb-btn" onClick={immersive.toggle} title={t('char_fullscreen_title')}>
                  <ExpandIcon />
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="detail-info">
          <Link to="/characters" className="reader-back">{t('detail_back')}</Link>

          <div className="detail-code" style={{ marginTop: 22 }}>{c.code}</div>
          <h1 className="detail-title">{displayName}</h1>
          <div className="detail-latin">{latinName || '—'}</div>

          {introText && (
            <div className="detail-quote">「{introText}」</div>
          )}

          <div className="detail-desc">
            {desc.length > 0 ? (
              desc.map((p, i) => <p key={i}>{p}</p>)
            ) : (
              <p style={{ color: 'var(--dim-2)' }}>{t('detail_desc_none')}</p>
            )}
          </div>

          <div className={`spec ${specItems.length > SPEC_DEFAULT ? 'spec-has-more' : ''} ${specOpen ? 'spec-open' : ''}`}>
            {specShown.map((it, i) => (
              <div
                key={it.key}
                className={`${i >= SPEC_DEFAULT ? 'spec-extra' : ''} ${it.popup ? 'spec-click' : ''}`}
                onClick={it.popup ? () => setSpecPopup(it.popup!) : undefined}
                title={it.popup ? t('spec_click_hint') : undefined}
                role={it.popup ? 'button' : undefined}
              >
                <span>{it.label}</span>
                <b className={it.key === 'gid' ? 'mono' : ''} style={it.style}>{it.node}</b>
              </div>
            ))}
            {specHidden > 0 && (
              <button
                className="spec-toggle"
                onClick={() => setSpecOpen((v) => !v)}
                aria-expanded={specOpen}
                title={specOpen ? t('story_cast_collapse') : fmt(t('spec_expand'), { n: specHidden })}
              >
                <i className="spec-toggle-arrow" aria-hidden />
              </button>
            )}
          </div>

          {statCalc && baseStat && (
            <>
            <section className="statbox" style={{ ['--acc' as string]: accentFor(c.id) }}>
              <div className="statbox-head">
                <div className="stat-tabbar" role="tablist">
                  <button
                    role="tab"
                    className={statTab === 'level' ? 'on' : ''}
                    onClick={() => setStatTab('level')}
                    aria-selected={statTab === 'level'}
                  >{t('stat_tab_level')} <i>LEVEL</i></button>
                  <button
                    role="tab"
                    className={statTab === 'equip' ? 'on' : ''}
                    onClick={() => setStatTab('equip')}
                    aria-selected={statTab === 'equip'}
                  >{t('stat_tab_equip')} <i>EQUIP</i></button>
                  <button
                    role="tab"
                    className={statTab === 'cube' ? 'on' : ''}
                    onClick={() => setStatTab('cube')}
                    aria-selected={statTab === 'cube'}
                  >{t('stat_tab_cube')} <i>CUBE</i></button>
                </div>
                <div className="statbox-head-end">
                  {statTab === 'level'
                    ? <b className="statbox-lv"><i>LV.</i>{lv}</b>
                    : statTab === 'cube'
                      ? (cube
                        ? <b className="statbox-lv"><i>LV.</i>{cubeLvCur}</b>
                        : <b className="statbox-lv is-none" title={t('cube_none_title')}>—</b>)
                      : (
                        <button
                          type="button"
                          className={`stat-toggle ${statOpen ? 'on' : ''}`}
                          onClick={() => setStatOpen((v) => !v)}
                          aria-expanded={statOpen}
                          aria-label={t('equip_stat_title')}
                          title={statOpen ? t('equip_stat_collapse') : t('equip_stat_expand')}
                        ><ChartIcon /></button>
                      )}
                  <button
                    type="button"
                    className={`stat-toggle stat-io-btn ${ioOpen ? 'on' : ''}`}
                    onClick={openIo}
                    aria-haspopup="dialog"
                    aria-expanded={ioOpen}
                    aria-label={t('io_title')}
                    title={t('io_title')}
                  ><IoIcon /></button>
                </div>
              </div>

              {statTab === 'level' ? (
              <div className="statbox-body">
                <input
                  className="stat-range"
                  type="range"
                  min={1}
                  max={lbMax}
                  value={lv}
                  onChange={(e) => setLevel(Number(e.target.value))}
                  aria-label={t('skill_lv')}
                />

                <div className="stat-grid">
                  <div>
                    <span><StatIcon kind="hp" />HP</span>
                    <b>{nf(statCalc.hp)}</b>
                  </div>
                  <div>
                    <span><StatIcon kind="atk" />ATK</span>
                    <b>{nf(statCalc.atk)}</b>
                  </div>
                  <div>
                    <span><StatIcon kind="def" />DEF</span>
                    <b>{nf(statCalc.def)}</b>
                  </div>
                </div>

                <div className="stat-row">
                  <span className="stat-label">{t('stat_lb')}</span>
                  <div className="stat-stars" role="group" aria-label={t('stat_lb')}>
                    {[1, 2, 3].map((n) => (
                      <button
                        key={n}
                        className={n <= limitBreak ? 'on' : ''}
                        onClick={() => setLimitBreak(limitBreak === n ? n - 1 : n)}
                        title={fmt(t('stat_lb_title'), { n, m: LB_MAX_LEVEL[n] })}
                        aria-pressed={n <= limitBreak}
                      >★</button>
                    ))}
                  </div>
                  <span className="stat-hint">{fmt(t('stat_hint_lb'), { r: baseStat.rarity, n: lbMax })}</span>
                </div>

                <div className="stat-row">
                  <span className="stat-label">{t('stat_core')}</span>
                  <div className="stat-core" role="group" aria-label={t('stat_core')}>
                    {Array.from({ length: CORE_MAX }, (_, i) => (
                      <button
                        key={i}
                        className={i < core ? 'on' : ''}
                        onClick={() => setCore(core === i + 1 ? i : i + 1)}
                        title={fmt(t('stat_core_title'), { n: i + 1, p: ((i + 1) * CORE_RATE * 100).toFixed(0) })}
                        aria-pressed={i < core}
                      />
                    ))}
                  </div>
                  <span className="stat-hint">Lv.{core} · +{(core * CORE_RATE * 100).toFixed(0)}%</span>
                </div>

                <div className={`stat-aff ${affOpen ? 'open' : ''}`}>
                  <button
                    className="stat-aff-head"
                    onClick={() => setAffOpen((v) => !v)}
                    aria-expanded={affOpen}
                  >
                    <span className="stat-label">{t('stat_aff')}</span>
                    <b>{affection}</b>
                    <span className="stat-aff-pct">+{(affection * AFFECTION_PER_LV * 100).toFixed(1)}%</span>
                    <i className="stat-aff-arrow" aria-hidden />
                  </button>
                  {affOpen && (
                    <div className="stat-aff-body">
                      <input
                        className="stat-range"
                        type="range"
                        min={0}
                        max={affMax}
                        value={affection}
                        onChange={(e) => setAffection(Number(e.target.value))}
                        aria-label={t('stat_aff')}
                      />
                      <span className="stat-hint">{fmt(t('stat_aff_max'), { n: affMax })}</span>
                    </div>
                  )}
                </div>

                {/* 珍藏品：好感下方，点击娃娃图标选择，阶段滑块实时计入三围 */}
                <div className={`fav ${favorite ? 'has' : ''} ${favPickOpen ? 'pop-open' : ''}`}>
                  <div className="fav-head">
                    <span className="stat-label">{t('stat_fav')}</span>
                    <button
                      type="button"
                      className={`fav-orb ${favorite ? `rare-${favorite.rare.toLowerCase()}` : 'is-empty'}`}
                      onClick={() => setFavPickOpen(true)}
                      aria-haspopup="dialog"
                      aria-expanded={favPickOpen}
                      aria-label={favorite ? fmt(t('cube_sel_aria'), { n: favorite.name }) : t('stat_fav_pick')}
                      title={favorite ? t('stat_fav_change') : t('stat_fav_pick')}
                    >
                      {favorite && !favIconBroken ? (
                        <img src={favoriteIconSrc} alt="" onError={() => setFavIconBroken(true)} />
                      ) : (
                        <span className="fav-ghost">◇</span>
                      )}
                    </button>
                    <div className="fav-meta">
                      <b className={favorite ? '' : 'is-none'}>
                        {favorite ? favorite.name : t('stat_unequipped')}
                      </b>
                      <span>
                        {favorite
                          ? `${favorite.rare} · ${favorite.weapon} · P${favoritePhaseCur}`
                          : t('stat_fav_pick_hint')}
                      </span>
                    </div>
                  </div>

                  {favorite && (
                    <>
                      <input
                        className="stat-range fav-range"
                        type="range"
                        min={0}
                        max={15}
                        value={favoritePhaseCur}
                        onChange={(e) => setFavoritePhase(Number(e.target.value))}
                        aria-label={t('stat_fav')}
                      />
                      <div className="stat-grid fav-grid">
                        <div><span><StatIcon kind="hp" />HP</span><b>+{nf(favoriteFlat.hp)}</b></div>
                        <div><span><StatIcon kind="atk" />ATK</span><b>+{nf(favoriteFlat.atk)}</b></div>
                        <div><span><StatIcon kind="def" />DEF</span><b>+{nf(favoriteFlat.def)}</b></div>
                      </div>
                      <div className="fav-effects">
                        {favEffects.map((fx, i) => {
                          const isDef = fx.label === '防御力增加'
                          return (
                            <div className={`fav-fx-row ${isDef ? 'is-def' : ''}`} key={i}>
                              <span>{fxLabel(fx.label)} <i>{fx.skill}</i></span>
                              <b>+{fx.tiers[favTier]}{fx.unit}</b>
                              {isDef && statCalc && favoriteDefPct > 0 && (
                                <em>{fmt(t('stat_fav_def_note'), { n: nf(statCalc.favoriteDefFlat) })}</em>
                              )}
                            </div>
                          )
                        })}
                        {FAVORITE_GLOBAL_EFFECTS.map((fx, i) => (
                          <div className="fav-fx-row is-global" key={`g${i}`}>
                            <span>{fxLabel(fx.label)}</span>
                            <b>+{fx.tiers[favTier]}{fx.unit}</b>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {favPickOpen && (
                    <div className="fav-pop" role="dialog" aria-label={t('stat_fav_pick')} ref={favPopRef}>
                      <div className="cube-pop-head">
                        <span>{t('stat_fav_pick')} <i>FAVORITE ITEM</i></span>
                        <button
                          type="button"
                          className="cube-pop-close"
                          onClick={() => setFavPickOpen(false)}
                          aria-label={t('common_close')}
                        >×</button>
                      </div>
                      <div className="fav-grid-pick">
                        <button
                          type="button"
                          className={`cube-cell ${favoriteId == null ? 'on' : ''}`}
                          onClick={() => { setFavoriteId(null); setFavPickOpen(false) }}
                        >
                          <span className="cube-cell-orb is-empty"><span className="fav-ghost">◇</span></span>
                          <span className="cube-cell-name">{t('stat_unequipped')}</span>
                        </button>
                        {favoriteChoices.map((f) => (
                          <button
                            key={f.id}
                            type="button"
                            className={`cube-cell ${favoriteId === f.id ? 'on' : ''}`}
                            onClick={() => {
                              setFavoriteId(f.id)
                              setFavoritePhase(0)
                              setFavIconBroken(false)
                              setFavPickOpen(false)
                            }}
                            title={`${f.name} · ${f.rare} ${f.weapon}`}
                          >
                            <span className={`cube-cell-orb rare-${f.rare.toLowerCase()}`}>
                              <img src={favoriteIcon(f.cls)} alt="" loading="lazy" />
                            </span>
                            <span className="cube-cell-name">{f.rare} {f.name.replace(/（限量版）/, '')}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              ) : statTab === 'equip' ? (
              <div className="statbox-body">
                <div className="equip-grid">
                  {equipRows.map((r) => {
                    const pn = partName(r.part)
                    return (
                    <div className={`equip-cell ${r.tier < 10 ? 'is-simple' : ''}`} key={r.part}>
                      <div className="equip-cell-head">
                        <img
                          className="equip-icn"
                          src={equipIcon(r.part, equipCls, r.tier)}
                          alt=""
                          loading="lazy"
                        />
                        <span className="equip-part">{pn}</span>
                      </div>
                      <div className="equip-cell-sel">
                        <select
                          className="equip-sel"
                          value={r.tier}
                          onChange={(e) => setEquip((v) => ({
                            ...v, [r.part]: { ...v[r.part], tier: Number(e.target.value) },
                          }))}
                          aria-label={fmt(t('equip_tier_aria'), { p: pn })}
                        >
                          {EQUIP_TIERS.map((tv) => <option key={tv} value={tv}>T{tv}</option>)}
                        </select>
                        <select
                          className="equip-sel"
                          value={r.enhance}
                          onChange={(e) => setEquip((v) => ({
                            ...v, [r.part]: { ...v[r.part], enhance: Number(e.target.value) },
                          }))}
                          aria-label={fmt(t('equip_enh_aria'), { p: pn })}
                        >
                          {Array.from({ length: EQUIP_MAX_ENHANCE + 1 }, (_, k) => (
                            <option key={k} value={k}>+{k}</option>
                          ))}
                        </select>
                      </div>
                      <div className="equip-cell-nums">
                        {r.atk > 0 && <i>ATK {nf(r.atk)}</i>}
                        {r.hp > 0 && <i>HP {nf(r.hp)}</i>}
                        {r.def > 0 && <i>DEF {nf(r.def)}</i>}
                      </div>
                      {r.tier === 10 && <div className="equip-cell-opts">
                        {equipOpts[r.part].map((o, i) => {
                          const opt = EQUIP_OPTIONS.find((x) => x.key === o.key)
                          const tierOptions: SelectOpt[] = opt
                            ? opt.tiers.map((v, k) => ({
                              value: String(k + 1),
                              label: `Lv.${k + 1} · ${v.toFixed(2)}%`,
                              short: `Lv.${k + 1}`,
                              title: `${optLabel(opt.key)} Lv.${k + 1} · ${v.toFixed(2)}%（${fmt(t('equip_odds'), { n: EQUIP_TIER_ODDS[k] })}）`,
                            }))
                            : [{ value: '', label: '—' }]
                          return (
                            <div className="equip-opt-row" key={i}>
                              <OptSelect
                                value={o.key}
                                onChange={(v) => updateOpt(r.part, i, {
                                  key: v,
                                  tier: v ? (o.tier || DEFAULT_TIER) : 0,
                                })}
                                options={typeOptions}
                                label={fmt(t('equip_opt_type_aria'), { p: pn, i: i + 1 })}
                              />
                              <OptSelect
                                value={o.tier ? String(o.tier) : ''}
                                onChange={(v) => updateOpt(r.part, i, { tier: Number(v) || 0 })}
                                options={tierOptions}
                                label={fmt(t('equip_opt_tier_aria'), { p: pn, i: i + 1 })}
                                placeholder={opt ? t('equip_tier_ph') : '—'}
                              />
                            </div>
                          )
                        })}
                      </div>}
                    </div>
                    )
                  })}
                </div>

                <div className="equip-total">
                  <span>{t('equip_total')}</span>
                  <i>ATK +{nf(equipTotal.atk)}</i>
                  <i>HP +{nf(equipTotal.hp)}</i>
                  <i>DEF +{nf(equipTotal.def)}</i>
                  {totalAmmo != null && (
                    <i title={fmt(t('equip_ammo_title'), {
                      b: baseAmmo ?? 0, e: ammoPct.toFixed(2), c: cubeAmmoPct.toFixed(2), f: favoriteAmmoPct.toFixed(2),
                    })}>
                      {t('equip_ammo_tag')} {nf(totalAmmo)}
                    </i>
                  )}
                </div>

                {statOpen && (
                  <div className="equip-summary">
                    <div className="equip-summary-head">{t('equip_stat_title')}</div>
                    <div className="equip-summary-main">
                      <div><span>{t('equip_sum_atk')}</span><b>+{nf(equipTotal.atk)}</b></div>
                      <div><span>{t('equip_sum_hp')}</span><b>+{nf(equipTotal.hp)}</b></div>
                      <div><span>{t('equip_sum_def')}</span><b>+{nf(equipTotal.def)}</b></div>
                    </div>
                    <div className="equip-summary-grid">
                      {optSummary.map((o) => {
                        const flat = o.key === 'atk' ? statCalc.optAtkFlat
                          : o.key === 'def' ? statCalc.optDefFlat : 0
                        const ammoTotal = o.key === 'ammo' ? totalAmmo : null
                        return (
                          <div key={o.key}>
                            <span>{o.label}</span>
                            <span className="equip-summary-vals">
                              <b className={o.total > 0 ? '' : 'is-zero'}>
                                {o.total > 0 ? `+${o.total.toFixed(2)}%` : '—'}
                              </b>
                              {flat > 0 && <em>≈+{nf(flat)}</em>}
                              {ammoTotal != null && (
                                <em title={fmt(t('equip_ammo_note'), {
                                  e: ammoPct, c: cubeAmmoPct, f: favoriteAmmoPct,
                                })}>
                                  {fmt(t('equip_ammo_flat'), { b: baseAmmo ?? 0, n: nf(ammoTotal) })}
                                </em>
                              )}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
              ) : (
              <div className={`statbox-body cube-body ${cubePickOpen ? 'pop-open' : ''}`}>
                <div className="cube-hero">
                  <button
                    type="button"
                    className={`cube-orb ${cube ? '' : 'is-empty'}`}
                    style={{ ['--cube' as string]: cube?.color ? `#${cube.color}` : undefined }}
                    onClick={() => setCubePickOpen(true)}
                    aria-haspopup="dialog"
                    aria-label={cube ? fmt(t('cube_sel_aria'), { n: cube.name }) : t('cube_none_aria')}
                    title={cube ? `${cube.name} · ${t('cube_change')}` : t('cube_pick')}
                  >
                    {!cube || cubeIconBroken === cube.iconId ? (
                      <CubeGhost />
                    ) : (
                      <img
                        src={cubeIcon(cube.iconId)}
                        alt=""
                        draggable={false}
                        onError={() => setCubeIconBroken(cube.iconId)}
                      />
                    )}
                  </button>
                  <span className="cube-name">
                    {cube ? pickLang(lang, cube.name, cube.nameEn) : t('stat_unequipped')}
                    <i>{t('cube_change')}</i>
                  </span>
                </div>

                <input
                  className="stat-range"
                  type="range"
                  min={1}
                  max={CUBE_MAX_LEVEL}
                  value={cubeLvCur}
                  disabled={!cube}
                  onChange={(e) => setCubeLv(Number(e.target.value))}
                  aria-label={t('cube_lv_aria')}
                />

                <div className="stat-grid">
                  <div>
                    <span><StatIcon kind="hp" />HP</span>
                    <b>{nf(cubeFlat.hp)}</b>
                  </div>
                  <div>
                    <span><StatIcon kind="atk" />ATK</span>
                    <b>{nf(cubeFlat.atk)}</b>
                  </div>
                  <div>
                    <span><StatIcon kind="def" />DEF</span>
                    <b>{nf(cubeFlat.def)}</b>
                  </div>
                </div>

                <div className="cube-fx">
                  <div className="cube-fx-row">
                    <span>{cube?.effect ?? t('cube_effect')}</span>
                    <b className={cube && cubeEffectVal > 0 ? '' : 'is-none'}>
                      {cube && cubeEffectVal > 0 ? `+${cubeEffectVal}${cube.unit}` : '—'}
                    </b>
                  </div>
                  <div className="cube-fx-row">
                    <span>{t('opt_elem')}</span>
                    <b className={cubeElem != null ? '' : 'is-none'}>
                      {cubeElem != null ? `+${cubeElem}%` : '—'}
                    </b>
                  </div>
                  <div className="cube-fx-row is-meta">
                    <span>{t('cube_slots')}</span>
                    <b>{cubeRow ? `${cubeRow.slots} ${t('cube_slots_n')}` : '—'}</b>
                  </div>
                </div>

                <p className="cube-note">
                  {t('cube_note')}
                </p>

                {cubePickOpen && (
                  <div className="cube-pop" role="dialog" aria-label={t('cube_pick')} ref={cubePopRef}>
                      <div className="cube-pop-head">
                        <span>{t('cube_pick')} <i>CUBE</i></span>
                        <button
                          type="button"
                          className="cube-pop-close"
                          onClick={() => setCubePickOpen(false)}
                          aria-label={t('common_close')}
                        >×</button>
                      </div>
                      <div className="cube-grid">
                        <button
                          type="button"
                          className={`cube-cell ${cubeId == null ? 'on' : ''}`}
                          onClick={() => { setCubeId(null); setCubePickOpen(false) }}
                        >
                          <span className="cube-cell-orb is-empty"><CubeGhost /></span>
                          <span className="cube-cell-name">{t('stat_unequipped')}</span>
                        </button>
                        {cubeData.cubes.map((cb) => (
                          <button
                            key={cb.id}
                            type="button"
                            className={`cube-cell ${cubeId === cb.id ? 'on' : ''}`}
                            style={{ ['--cube' as string]: `#${cb.color}` }}
                            onClick={() => { setCubeId(cb.id); setCubePickOpen(false) }}
                            title={`${cb.name} · ${cb.nameEn}｜${cb.effect}`}
                          >
                            <span className="cube-cell-orb">
                              <img src={cubeIcon(cb.iconId)} alt="" loading="lazy" />
                            </span>
                            <span className="cube-cell-name">{cb.name}</span>
                          </button>
                        ))}
                      </div>
                  </div>
                )}
              </div>
              )}

              {ioOpen && (
                <div className="io-pop" role="dialog" aria-label={t('io_title')} ref={ioPopRef}>
                  <div className="cube-pop-head">
                    <span>{t('io_title')} <i>BUILD CODE</i></span>
                    <button
                      type="button"
                      className="cube-pop-close"
                      onClick={() => setIoOpen(false)}
                      aria-label={t('common_close')}
                    >×</button>
                  </div>
                  <div className="io-body">
                    <p className="io-lead">
                      {t('io_lead')}
                    </p>
                    <textarea
                      className="io-code"
                      value={ioText}
                      onChange={(e) => { setIoText(e.target.value); setIoMsg(null) }}
                      spellCheck={false}
                      aria-label={t('io_title')}
                      placeholder={t('io_ph')}
                    />
                    {ioMsg && (
                      <p className={`io-msg ${ioMsg.ok ? 'ok' : 'err'}`}>{ioMsg.text}</p>
                    )}
                    <div className="io-actions">
                      <button type="button" className="io-act primary" onClick={copyIo}>{t('io_copy')}</button>
                      <button type="button" className="io-act" onClick={() => applyPreset(ioText)}>{t('io_apply')}</button>
                    </div>
                    <div className="io-actions sub">
                      <button type="button" className="io-act ghost" onClick={exportIoFile}>{t('io_export_file')}</button>
                      <button type="button" className="io-act ghost" onClick={() => ioFileRef.current?.click()}>{t('io_import_file')}</button>
                    </div>
                    <input
                      ref={ioFileRef}
                      type="file"
                      accept=".txt,text/plain"
                      className="io-file"
                      onChange={(e) => {
                        importIoFile(e.target.files?.[0])
                        e.target.value = ''
                      }}
                    />
                  </div>
                </div>
              )}
            </section>

            <div className="statbox-disclaimer">
              {t('stat_disclaimer')}
            </div>
            </>
          )}

          {skills && skills.length > 0 && (
            <section className="skillbox" style={{ ['--acc' as string]: accentFor(c.id) }}>
              <div className="skillbox-head">
                <span className="skillbox-title">{t('skill_title')} <i>SKILLS</i></span>
                <label className="skill-lv">
                  {t('skill_lv')}
                  <select value={skillLv} onChange={(e) => setSkillLv(Number(e.target.value))}>
                    {Array.from({ length: Math.max(...skills.map((s) => s.levels), 1) },
                      (_, k) => k + 1).map((lv) => (
                        <option key={lv} value={lv}>Lv.{lv}</option>
                      ))}
                  </select>
                </label>
              </div>
              {skills.map((sk) => (
                <SkillRow key={sk.sid} skill={sk} lv={skillLv} accent={accentFor(c.id)}
                  onWord={(gid, term) => setTermPopup({ gid, term })} />
              ))}
            </section>
          )}

          {hasStoryRel && (
            <section className="storybox" id="storybox" style={{ ['--acc' as string]: accentFor(c.id) }}>
              <div className="storybox-head">
                <span className="storybox-title">
                  {relStories.length || relCounsel.length ? t('rel_title') : t('char_voice_title')}
                  {' '}<i>{relStories.length || relCounsel.length ? 'STORIES' : 'VOICE'}</i>
                </span>
                <div className="story-tabs">
                  {relStories.length > 0 && (
                    <button className={relTab === 'stories' ? 'on' : ''} onClick={() => setRelTab('stories')}>
                      {t('rel_stories')} <b>{relStories.length}</b>
                    </button>
                  )}
                  {relCounsel.length > 0 && (
                    <button className={relTab === 'counsel' ? 'on' : ''} onClick={() => setRelTab('counsel')}>
                      {t('rel_counsel')} <b>{relCounsel.reduce((a, x) => a + (x.sessions || 0), 0)}</b>
                    </button>
                  )}
                  {hasVoices && (
                    <button className={relTab === 'voices' ? 'on' : ''} onClick={() => setRelTab('voices')}>
                      {t('rel_voices')} <b>{voice.n}</b>
                    </button>
                  )}
                </div>
              </div>

              {relTab === 'stories' ? (
                <div className="story-blocks">
                  {relStories.map((r) => (
                    <div key={r.id} className="story-block">
                      {/* 只有多卷时才需要卷名分隔；单卷直接平铺章节 */}
                      {relStories.length > 1 && (
                        <div className="story-block-label"><b>{pickLang(lang, r.t, r.ts?.en, r.ts?.ko, r.ts?.ja)}</b></div>
                      )}
                      <div className="story-eps">
                        {(r.chapters ?? []).map((ch, ci) => (
                          <Link key={ci} to={`/story/${r.id}?ch=${ci}`} className="story-ep">
                            <span className="story-ep-no">{String(ci + 1).padStart(2, '0')}</span>
                            <span className="story-ep-name">
                              {pickLang(lang, ch.t, ch.ts?.en, ch.ts?.ko, ch.ts?.ja)}
                            </span>
                            <span className="story-ep-meta">{nf(ch.n)} {t('unit_lines')}</span>
                            <span className="story-ep-go">→</span>
                          </Link>
                        ))}
                        {!r.chapters?.length && (
                          <Link to={`/story/${r.id}`} className="story-ep">
                            <span className="story-ep-no">01</span>
                            <span className="story-ep-name">{t('story_read_all')}</span>
                            <span className="story-ep-meta">{nf(r.lines)} {t('unit_lines')}</span>
                            <span className="story-ep-go">→</span>
                          </Link>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : relTab === 'counsel' && relCounsel.length > 0 ? (
                <CounselChat
                  units={relCounsel}
                  accent={accentFor(c.id)}
                  avatar={charAvatar(mainBase(imgs, c.id), mi)}
                  charName={displayName}
                  chars={list ?? []}
                />
              ) : relTab === 'voices' && voice ? (
                <VoiceList key={c.id} data={voice} accent={accentFor(c.id)} />
              ) : null}
            </section>
          )}

          {hasMsg && msgData && (
            <section className="storybox msgbox" id="msgbox" style={{ ['--acc' as string]: accentFor(c.id) }}>
              <div className="storybox-head">
                <span className="storybox-title">{t('msg_title')} <i>BLA BLA</i></span>
                <span className="msgbox-meta">{fmt(t('msg_count_meta'), { n: msgRooms.length, m: nf(msg?.lines ?? 0) })}</span>
              </div>
              <MessageChat
                key={c.id}
                data={msgData}
                rooms={msgRooms}
                accent={accentFor(c.id)}
                charName={displayName}
                chars={list ?? []}
                avatarOf={avatarOf}
              />
            </section>
          )}

          <Link to="/characters" className="backlink">{t('detail_backlist')}</Link>
        </div>
      </div>
    </div>
  )
}
