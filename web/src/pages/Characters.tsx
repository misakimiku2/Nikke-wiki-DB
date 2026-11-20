import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  accentFor, charPortrait, loadCharImages, loadCharMeta, loadCharMi, loadCharSpine,
  loadCharacters, loadSpecTexts, loadSquadNames, mainBase, nf, SPEC_CLS, SPEC_CORP, SPEC_ELEMENT, SPEC_WEAPON, tintFor,
  type CharImages, type CharMeta, type CharMetaMap, type Character, type SpecTexts, type SquadNames,
} from '../data'
import { pickLang, useLang } from '../lang'
import { useUI, type UIKey } from '../ui'

type SortMode = 'name' | 'squad'
type FilterKey = 'corp' | 'weapon' | 'burst' | 'cls' | 'element'
type Filters = Record<FilterKey, string[]>

/** 筛选类别：候选值按 order 顺序展示（只渲染站内实际存在的）；label 是 UI 词典 key */
const FILTER_GROUPS: Array<{
  key: FilterKey; label: UIKey; order: string[]
}> = [
  { key: 'corp', label: 'filter_corp', order: ['1', '2', '3', '4', '5', '101', '102', '103'] },
  { key: 'weapon', label: 'filter_weapon', order: ['ar', 'sg', 'rl', 'smg', 'sr', 'mg'] },
  { key: 'burst', label: 'filter_burst', order: ['1', '2', '3', '5'] },
  { key: 'cls', label: 'filter_cls', order: ['1', '2', '3'] },
  { key: 'element', label: 'filter_element', order: ['fire', 'water', 'wind', 'electric', 'iron'] },
]

/** 各筛选值的游戏图标（public/metaicon/，白色 sprite 由 mask 染 currentColor）。
 *  只覆盖有图标的取值：企业 101/102/103 无对应图标，故留空（不渲染）。 */
const FILTER_ICONS: Record<FilterKey, Record<string, string>> = {
  corp: { '1': 'corp_icn_1', '2': 'corp_icn_2', '3': 'corp_icn_3', '4': 'corp_icn_4', '5': 'corp_icn_5' },
  weapon: { ar: 'weapon_ar', sg: 'weapon_sg', rl: 'weapon_rl', smg: 'weapon_smg', sr: 'weapon_sr', mg: 'weapon_mg' },
  // 全爆裂（5）用游戏里的闪电徽章 icn_burst_04
  burst: { '1': 'burst_1', '2': 'burst_2', '3': 'burst_3', '5': 'burst_4' },
  cls: { '1': 'cls_attacker', '2': 'cls_defender', '3': 'cls_supporter' },
  element: { fire: 'element_fire', water: 'element_water', wind: 'element_wind', electric: 'element_elect', iron: 'element_iron' },
}

function FilterIcon({ icn }: { icn: string }) {
  return <i className="spec-icn filter-icn" style={{ ['--icn' as string]: `url(/metaicon/${icn}.webp)` }} aria-hidden />
}

/** 角色在某筛选类别下的取值（meta 缺失返回 null，参与筛选时视为不匹配） */
function metaVal(m: CharMeta | undefined, key: FilterKey): string | null {
  if (!m) return null
  const v = key === 'corp' ? m.corp
    : key === 'burst' ? m.burst
    : key === 'cls' ? m.cls
    : key === 'weapon' ? m.weapon
    : m.element
  return v == null ? null : String(v)
}

export default function Characters() {
  const { lang } = useLang()
  const t = useUI()
  const [list, setList] = useState<Character[] | null>(null)
  const [imgs, setImgs] = useState<CharImages>({})
  const [mi, setMi] = useState<Set<string>>(new Set())
  const [spine, setSpine] = useState<Set<string>>(new Set())
  const [meta, setMeta] = useState<CharMetaMap>({})
  /** 筛选值显示名的官方本地化（企业/武器/兵种/属性，spec_texts.json） */
  const [specTexts, setSpecTexts] = useState<SpecTexts>({ weapon: {}, cls: {}, element: {}, corp: {}, squad: {} })
  /** 部队名的其他语言（squad_names.json，缺失时回退中文） */
  const [squadNames, setSquadNames] = useState<SquadNames>({ names: {}, lore: {} })
  // 搜索关键词同步进 URL（replace，不打历史）：从角色详情返回时恢复搜索现场
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState(() => params.get('q') || '')
  const [sort, setSort] = useState<SortMode>('squad')
  const [panelOpen, setPanelOpen] = useState(false)
  const [filters, setFilters] = useState<Filters>({ corp: [], weapon: [], burst: [], cls: [], element: [] })

  useEffect(() => {
    loadCharacters().then(setList).catch(() => setList([]))
    loadCharImages().then(setImgs).catch(() => {})
    loadCharMi().then(setMi).catch(() => {})
    loadCharSpine().then(setSpine).catch(() => {})
    loadCharMeta().then(setMeta).catch(() => {})
    loadSpecTexts().then(setSpecTexts).catch(() => {})
    loadSquadNames().then(setSquadNames).catch(() => {})
  }, [])

  // q 写回 URL（replace）：返回 / 刷新 / 分享链接都能带着搜索词
  useEffect(() => {
    if ((params.get('q') || '') === q) return
    const next = new URLSearchParams(params)
    if (q) next.set('q', q)
    else next.delete('q')
    setParams(next, { replace: true })
    // params 不进依赖：本 effect 自己写的 URL 不应触发重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  /**
   * 悬停预热：鼠标在卡片上停 350ms 就把站姿模型的 atlas / skel / 图集页拉进缓存，
   * 点进详情时模型基本已经就位，不会先空一段再淡入。扫过去的鼠标不会触发。
   */
  const hoverTimer = useRef<number | null>(null)
  const warmed = useRef<Set<string>>(new Set())
  const warm = useCallback((base: string | null) => {
    if (!base || !spine.has(base) || warmed.current.has(base)) return
    warmed.current.add(base)
    const dir = `/spine_char/${base}/`
    fetch(`${dir}${base}.atlas`).catch(() => {})
    fetch(`${dir}${base}.skel`).catch(() => {})
    // 图集页由 SpinePlayer 用 <img> 加载，这里同样用 Image 预热；第二页按需再取
    const page = new Image()
    page.src = `${dir}${base}.webp`
  }, [spine])
  const warmOn = useCallback((base: string | null) => {
    if (typeof window === 'undefined' || !window.matchMedia('(hover: hover)').matches) return
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current)
    hoverTimer.current = window.setTimeout(() => warm(base), 350)
  }, [warm])
  const warmOff = useCallback(() => {
    if (hoverTimer.current) { window.clearTimeout(hoverTimer.current); hoverTimer.current = null }
  }, [])
  useEffect(() => () => warmOff(), [warmOff])

  /** 有可用立绘/头像的条目（图鉴只收录有资源的角色），后续筛选都在其上进行 */
  const pool = useMemo(() => {
    if (!list) return []
    return list.filter((c) => !!mainBase(imgs, c.id))
  }, [list, imgs])

  /** 每个筛选类别实际存在的候选值（按预定顺序） */
  const options = useMemo(() => {
    const sets: Record<FilterKey, Set<string>> = {
      corp: new Set(), weapon: new Set(), burst: new Set(), cls: new Set(), element: new Set(),
    }
    for (const c of pool) {
      const m = meta[String(c.id)]
      for (const g of FILTER_GROUPS) {
        const v = metaVal(m, g.key)
        if (v) sets[g.key].add(v)
      }
    }
    const out = {} as Record<FilterKey, string[]>
    for (const g of FILTER_GROUPS) out[g.key] = g.order.filter((v) => sets[g.key].has(v))
    return out
  }, [pool, meta])

  const activeCount = FILTER_GROUPS.reduce((a, g) => a + filters[g.key].length, 0)
  const toggleFilter = (key: FilterKey, v: string) => {
    setFilters((f) => {
      const has = f[key].includes(v)
      return { ...f, [key]: has ? f[key].filter((x) => x !== v) : [...f[key], v] }
    })
  }
  const clearFilters = () => setFilters({ corp: [], weapon: [], burst: [], cls: [], element: [] })

  /** 搜索 + 多选筛选：各类别之间取交集，类别内命中任一即可；名称模式按英文名 A-Z 排序 */
  const shown = useMemo(() => {
    const k = q.trim().toLowerCase()
    let out = pool
    if (k) {
      out = out.filter(
        (c) =>
          c.name.toLowerCase().includes(k) ||
          (c.names.en || '').toLowerCase().includes(k) ||
          (c.names.ja || '').includes(q) ||
          (c.desc || '').includes(q),
      )
    }
    if (activeCount > 0) {
      out = out.filter((c) => {
        const m = meta[String(c.id)]
        return FILTER_GROUPS.every((g) => {
          const sel = filters[g.key]
          if (!sel.length) return true
          const v = metaVal(m, g.key)
          return v != null && sel.includes(v)
        })
      })
    }
    if (sort === 'name') {
      out = [...out].sort((a, b) => {
        const ka = (a.names.en || a.names.zh || '').toLowerCase()
        const kb = (b.names.en || b.names.zh || '').toLowerCase()
        return ka.localeCompare(kb, 'en')
      })
    }
    return out
  }, [pool, meta, q, filters, activeCount, sort])

  /** 部队模式：按部队分栏（顺序沿用默认排序里各部队首次出现的次序，无部队的排最后） */
  const squadGroups = useMemo(() => {
    if (sort !== 'squad') return null
    const map = new Map<string, Character[]>()
    for (const c of shown) {
      const s = meta[String(c.id)]?.squad ?? '暂无部队'
      const arr = map.get(s)
      if (arr) arr.push(c)
      else map.set(s, [c])
    }
    const none = [...map.entries()].filter(([s]) => s === '暂无部队')
    return [...[...map.entries()].filter(([s]) => s !== '暂无部队'), ...none]
  }, [shown, sort, meta])

  /** 筛选值显示名：企业/武器/兵种/属性走 specTexts 本地化（specName 模式），爆裂用 UI 词典 */
  const filterLabelOf = (key: FilterKey, v: string): string => {
    if (key === 'burst') {
      const b = Number(v)
      return t(b === 1 ? 'burst_1' : b === 2 ? 'burst_2' : b === 3 ? 'burst_3' : 'burst_all')
    }
    const zh = key === 'corp' ? (SPEC_CORP[Number(v)] ?? v)
      : key === 'weapon' ? (SPEC_WEAPON[v] ?? v)
        : key === 'cls' ? (SPEC_CLS[Number(v)] ?? v)
          : (SPEC_ELEMENT[v] ?? v)
    const e = key === 'corp' ? specTexts.corp[v]
      : key === 'weapon' ? specTexts.weapon[v]
        : key === 'cls' ? specTexts.cls[v]
          : specTexts.element[v]
    return pickLang(lang, e?.name || zh, e?.nameEn, e?.nameKo, e?.nameJa)
  }

  /** 部队分组标题：部队名接 loadSquadNames 译名，查不到回退中文；无部队哨兵用 UI 词典 */
  const squadLabel = (s: string): string => s === '暂无部队' ? t('squad_none')
    : pickLang(lang, s, squadNames.names[s]?.en, squadNames.names[s]?.ko, squadNames.names[s]?.ja)

  const renderCard = (c: Character) => {
    const base = mainBase(imgs, c.id)
    const face = !!base && mi.has(base)
    const src = charPortrait(base, mi)
    const title = pickLang(lang, c.name, c.names.en, c.names.ko, c.names.ja)
    return (
      <Link
        key={c.id}
        to={`/characters/${c.id}`}
        className="char-card"
        style={{ ['--tint' as string]: tintFor(c.id) }}
        onMouseEnter={() => warmOn(base)}
        onMouseLeave={warmOff}
      >
        <div className={`visual ${face ? 'is-face' : 'is-full'}`}>
          {src ? (
            <img src={src} alt={title} loading="lazy" />
          ) : (
            <span className="fallback">{title.slice(0, 1)}</span>
          )}
        </div>
        <div className="meta">
          <h3 title={title}>{title}</h3>
          <div className="row">
            <span>{c.code}</span>
            <span className="lines" style={{ color: accentFor(c.id) }}>
              {c.lines > 0 ? nf(c.lines) : '—'}
            </span>
          </div>
        </div>
      </Link>
    )
  }

  if (!list) return <div className="loading">LOADING…</div>

  const total = pool.length

  return (
    <div className="wrap">
      <div className="sec-head">
        <div>
          <div className="idx">01 / CHARACTER</div>
          <h2>{t('char_title')}</h2>
        </div>
        <div className="meta">
          {activeCount > 0 ? `${nf(shown.length)} / ${nf(total)}` : nf(total)} ENTRIES
        </div>
      </div>

      <div className="toolbar">
        <div className="search-box">
          <input
            className="search"
            placeholder={t('char_search_ph')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && (
            <button
              type="button"
              className="search-clear"
              onClick={() => setQ('')}
              aria-label="清空搜索"
              title="清空"
            >
              ×
            </button>
          )}
        </div>
        <div className="tool-sort" role="group" aria-label="排序方式">
          <button className={`chip ${sort === 'name' ? 'on' : ''}`} onClick={() => setSort('name')}>
            {t('sort_name')}
          </button>
          <button className={`chip ${sort === 'squad' ? 'on' : ''}`} onClick={() => setSort('squad')}>
            {t('sort_squad')}
          </button>
        </div>
        <button
          className={`chip tool-filter ${panelOpen ? 'on' : ''} ${activeCount > 0 ? 'has-active' : ''}`}
          onClick={() => setPanelOpen((o) => !o)}
          aria-expanded={panelOpen}
          title="按企业 / 武器 / 爆裂 / 兵种 / 属性筛选"
        >
          {t('filter_btn')}{activeCount > 0 ? ` · ${activeCount}` : ''}
        </button>
      </div>

      {panelOpen && (
        <div className="filter-panel">
          {FILTER_GROUPS.map((g) => (
            <div className="fp-group" key={g.key}>
              <div className="fp-title">{t(g.label)}</div>
              <div className="fp-chips">
                {options[g.key].length === 0 && <span className="fp-none">{t('filter_none')}</span>}
                {options[g.key].map((v) => (
                  <button
                    key={v}
                    className={`chip fp-chip ${filters[g.key].includes(v) ? 'on' : ''}`}
                    onClick={() => toggleFilter(g.key, v)}
                  >
                    {FILTER_ICONS[g.key][v] && <FilterIcon icn={FILTER_ICONS[g.key][v]} />}
                    {filterLabelOf(g.key, v)}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {activeCount > 0 && (
            <button className="chip fp-clear" onClick={clearFilters}>{t('filter_clear')}</button>
          )}
        </div>
      )}

      {shown.length === 0 ? (
        <div className="empty">NO MATCH</div>
      ) : sort === 'squad' && squadGroups ? (
        squadGroups.map(([squad, chars]) => (
          <section className="squad-sect" key={squad}>
            <div className="squad-head">
              <h3>{squadLabel(squad)}</h3>
              <span className="cnt">{nf(chars.length)} {t('count_nikke')}</span>
            </div>
            <div className="char-grid">{chars.map(renderCard)}</div>
          </section>
        ))
      ) : (
        <div className="char-grid">{shown.map(renderCard)}</div>
      )}
    </div>
  )
}
