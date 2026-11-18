import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Pager, pageParam } from '../components/Pager'
import {
  accentFor, charPortrait, loadCgIndex, loadCharImages, loadCharMeta, loadCharMi, loadCharacters,
  loadStoryIndex, mainBase, nf, SPEC_BURST, SPEC_CLS, SPEC_CORP, SPEC_ELEMENT, SPEC_WEAPON,
  tintFor, whereOf,
  type CgIndex, type CharImages, type CharMetaMap, type Character, type StoryUnit,
} from '../data'

/** 台词行：[文本, 剧情单元id, 说话人, 行号] */
type Row = [string, number, string, number]

/**
 * 台词索引的模块级缓存：其余数据 loader 在 data.ts 里都有缓存，只有这 9 MB 分片每次挂载都重拉。
 * 从结果页返回本页时组件会整个重挂载，没有这份缓存搜索页就会先空几秒。
 * in-flight 的 promise 也一并缓存，中途离开再回来不用从头拉。
 */
let cachedRows: Row[] | null = null
let rowsPromise: Promise<Row[]> | null = null

function loadLineIndex(): Promise<Row[]> {
  if (cachedRows) return Promise.resolve(cachedRows)
  if (!rowsPromise) {
    rowsPromise = fetch('/data/search/manifest.json')
      .then((r) => r.json())
      .then((m: { shards: { file: string }[] }) =>
        Promise.all(m.shards.map((s) => fetch(`/data/search/${s.file}`).then((r) => r.json()))),
      )
      .then((parts: Row[][]) => (cachedRows = parts.flat()))
      .catch((e) => {
        rowsPromise = null // 失败允许下次重试
        throw e
      })
  }
  return rowsPromise
}

/** 各分组分页大小（角色卡较大、剧情卡最高，页小一点；CG 与图鉴页一致用 60） */
const PAGE_CHARS = 20
const PAGE_CG = 60
const PAGE_UNITS = 24
const PAGE_LINES = 50

export default function Search() {
  const [idx, setIdx] = useState<Row[] | null>(null)
  const [units, setUnits] = useState<StoryUnit[]>([])
  const [chars, setChars] = useState<Character[]>([])
  const [cg, setCg] = useState<CgIndex | null>(null)
  const [imgs, setImgs] = useState<CharImages>({})
  const [mi, setMi] = useState<Set<string>>(new Set())
  const [meta, setMeta] = useState<CharMetaMap>({})
  const [params, setParams] = useSearchParams()
  const initial = params.get('q') || ''
  const [q, setQ] = useState(initial)
  const [debounced, setDebounced] = useState(initial)
  const [charPage, setCharPage] = useState(() => pageParam(params, 'pc'))
  const [cgPage, setCgPage] = useState(() => pageParam(params, 'pg'))
  const [unitPage, setUnitPage] = useState(() => pageParam(params, 'ps'))
  const [linePage, setLinePage] = useState(() => pageParam(params, 'pl'))
  const timer = useRef<number | null>(null)

  useEffect(() => {
    loadStoryIndex().then(setUnits).catch(() => {})
    loadCharacters().then(setChars).catch(() => {})
    loadCgIndex().then(setCg).catch(() => {})
    loadCharImages().then(setImgs).catch(() => {})
    loadCharMi().then(setMi).catch(() => {})
    loadCharMeta().then(setMeta).catch(() => {})
    // 台词索引按连续 unit 区间拆成多个分片（见 build/export_search.py），进页面才拉。
    // 分片序号顺序即全量顺序，按序拼接后与单文件时代逐行一致。
    loadLineIndex().then(setIdx).catch(() => setIdx([]))
  }, [])

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setDebounced(q.trim()), 220)
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [q])

  // 换关键词后所有分组回到第一页。
  // 只在关键词真正变化时触发：effect 首次挂载也会跑一次，而返回本页的挂载
  // 要用 URL 上的页码恢复现场，不能在这里清掉。
  const prevQuery = useRef(debounced)
  useEffect(() => {
    if (prevQuery.current === debounced) return
    prevQuery.current = debounced
    setCharPage(0)
    setCgPage(0)
    setUnitPage(0)
    setLinePage(0)
  }, [debounced])

  // 关键词与各分组页码一起同步进 URL（replace，不打历史）：
  // 在输入框里搜完点进结果，浏览器返回时 URL 上有完整现场；翻页后刷新也不会丢。
  // 页码按 1 起始存储（对人类可读），第 1 页不写参数。
  useEffect(() => {
    const next = new URLSearchParams(params)
    if (debounced) next.set('q', debounced)
    else next.delete('q')
    const pages: [string, number][] = [
      ['pc', charPage], ['pg', cgPage], ['ps', unitPage], ['pl', linePage],
    ]
    for (const [key, p] of pages) {
      if (p > 0) next.set(key, String(p + 1))
      else next.delete(key)
    }
    if (next.toString() !== params.toString()) setParams(next, { replace: true })
    // params 不进依赖：本 effect 自己写的 URL 不应触发重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, charPage, cgPage, unitPage, linePage])

  const unitMap = useMemo(() => {
    const m: Record<number, StoryUnit> = {}
    for (const u of units) m[u.id] = u
    return m
  }, [units])

  // 每张 CG 的检索文本：内部名 + 系列 + 关联剧情的中文名（内部名是英文，靠关联标题支持中文检索）
  const cgText = useMemo(() => {
    const t: Record<string, string> = {}
    if (!cg) return t
    for (const it of cg.items) {
      let s = `${it.n} ${it.s || ''}`
      for (const lk of cg.links[it.n] || []) {
        const u = unitMap[lk.u]
        if (u) s += ` ${u.title} ${u.label}`
      }
      t[it.n] = s.toLowerCase()
    }
    return t
  }, [cg, unitMap])

  const charHits = useMemo(() => {
    if (!chars || debounced.length < 1) return []
    const k = debounced.toLowerCase()
    const out = chars.filter((c) => {
      const n = c.names || {}
      // 档案维度也参与匹配：搜「反击部队」「伊甸园」「火力型」都能找到对应角色
      const m = meta[String(c.id)]
      const corp = m ? SPEC_CORP[Number(m.corp)] || '' : ''
      const squad = m?.squad || ''
      const cls = m ? SPEC_CLS[Number(m.cls)] || '' : ''
      const weapon = m?.weapon ? SPEC_WEAPON[m.weapon] || '' : ''
      const element = m?.element ? SPEC_ELEMENT[m.element] || '' : ''
      const burst = m ? SPEC_BURST[Number(m.burst)] || '' : ''
      const hay = `${c.name} ${n.en || ''} ${n.ja || ''} ${n.ko || ''} ${n.tw || ''} ${c.code} ${c.cv || ''} ${corp} ${squad} ${cls} ${weapon} ${element} ${burst}`.toLowerCase()
      return hay.includes(k)
    })
    // 名字以关键词开头的排前面（搜「拉」时 拉毗 在 拉毗:冬日购物狂 前面）
    out.sort((a, b) => Number(!a.name.toLowerCase().startsWith(k)) - Number(!b.name.toLowerCase().startsWith(k)))
    return out
  }, [chars, meta, debounced])

  const cgHits = useMemo(() => {
    if (!cg || debounced.length < 1) return []
    const k = debounced.toLowerCase()
    return cg.items.filter((it) => (cgText[it.n] || '').includes(k))
  }, [cg, cgText, debounced])

  const unitHits = useMemo(() => {
    if (debounced.length < 1) return []
    const k = debounced.toLowerCase()
    const out = units.filter((u) => `${u.title} ${u.label} ${u.bucket}`.toLowerCase().includes(k))
    out.sort((a, b) => Number(!a.title.toLowerCase().startsWith(k)) - Number(!b.title.toLowerCase().startsWith(k)))
    return out
  }, [units, debounced])

  // 台词先做全量统计（不再截断），展示层按页渲染。
  // 小写文本缓存一次，避免每次按键都对 52 万行做 toLowerCase。
  const lowerLines = useMemo(() => (idx ? idx.map((r) => r[0].toLowerCase()) : null), [idx])
  const lineHits = useMemo(() => {
    if (!lowerLines || debounced.length < 1) return []
    const k = debounced.toLowerCase()
    const out: number[] = []
    for (let i = 0; i < lowerLines.length; i++) {
      if (lowerLines[i].includes(k)) out.push(i)
    }
    return out
  }, [lowerLines, debounced])

  const loading = !idx || !cg
  const total = charHits.length + cgHits.length + unitHits.length + lineHits.length

  // 页码钳制：URL 上的页码可能超出当前命中数（换过关键词的旧链接），渲染时压回范围内
  const clampPage = (p: number, size: number, n: number) =>
    Math.min(p, Math.max(0, Math.ceil(n / size) - 1))
  const safeCharPage = clampPage(charPage, PAGE_CHARS, charHits.length)
  const safeCgPage = clampPage(cgPage, PAGE_CG, cgHits.length)
  const safeUnitPage = clampPage(unitPage, PAGE_UNITS, unitHits.length)
  const safeLinePage = clampPage(linePage, PAGE_LINES, lineHits.length)

  return (
    <div className="wrap">
      <div className="sec-head">
        <div>
          <div className="idx">04 / SEARCH</div>
          <h2>全站搜索</h2>
        </div>
        <div className="meta">
          {loading
            ? 'LOADING INDEX…'
            : `${nf(chars.length)} CHARS · ${nf(cg!.total)} CG · ${nf(units.length)} UNITS · ${nf(idx!.length)} LINES`}
        </div>
      </div>

      <div className="search-hero">
        <input
          className="search search-lg"
          autoFocus
          placeholder="搜索角色、CG、剧情与台词，例：拉毗、EventScene、活下去"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {loading && <div className="search-hint">正在载入搜索索引（台词索引压缩后约 9 MB，之后会缓存）</div>}
        {!loading && debounced && total > 0 && (
          <div className="search-hint">共找到 {nf(total)} 条结果</div>
        )}
      </div>

      {debounced && (
        <>
          {charHits.length > 0 && (
            <Group kind="角色" id="grp-chars" cnt={charHits.length}>
              <div className="char-grid">
                {charHits.slice(safeCharPage * PAGE_CHARS, (safeCharPage + 1) * PAGE_CHARS).map((c) => (
                  <CharCard key={c.id} c={c} imgs={imgs} mi={mi} />
                ))}
              </div>
              <Pager page={safeCharPage} pages={Math.ceil(charHits.length / PAGE_CHARS)} onPage={setCharPage} anchorId="grp-chars" />
            </Group>
          )}

          {cgHits.length > 0 && (
            <Group kind="CG" id="grp-cg" cnt={cgHits.length}>
              <div className="cg-grid">
                {cgHits.slice(safeCgPage * PAGE_CG, (safeCgPage + 1) * PAGE_CG).map((it) => (
                  <Link
                    key={it.n}
                    to={`/cg/${encodeURIComponent(it.n)}`}
                    className="cg-cell"
                    title={`${it.n} · 打开查看器`}
                  >
                    <img src={`/img/s/${it.h}.webp`} alt={it.n} loading="lazy" />
                    {it.l > 0 && <span className="cg-badge">{it.l}</span>}
                  </Link>
                ))}
              </div>
              <Pager page={safeCgPage} pages={Math.ceil(cgHits.length / PAGE_CG)} onPage={setCgPage} anchorId="grp-cg" />
            </Group>
          )}

          {unitHits.length > 0 && (
            <Group kind="剧情" id="grp-units" cnt={unitHits.length}>
              <div className="story-grid">
                {unitHits.slice(safeUnitPage * PAGE_UNITS, (safeUnitPage + 1) * PAGE_UNITS).map((u) => (
                  <Link key={u.id} to={`/story/${u.id}`} className="story-card">
                    <div className="story-cover">
                      {u.cover
                        ? <img src={`/cover/${u.cover}.webp`} alt="" loading="lazy" />
                        : <span className="story-cover-fallback">{u.title.slice(0, 2)}</span>}
                      <span className="story-no">
                        {u.chapter !== null && u.chapter !== undefined
                          ? String(u.chapter).padStart(2, '0')
                          : u.label.slice(0, 2)}
                      </span>
                    </div>
                    <div className="story-body">
                      <h3>{whereOf(u, u.id)}</h3>
                      <div className="story-meta">
                        <span>{u.label}</span>
                        <span>{nf(u.lines)} 句</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
              <Pager page={safeUnitPage} pages={Math.ceil(unitHits.length / PAGE_UNITS)} onPage={setUnitPage} anchorId="grp-units" />
            </Group>
          )}

          {lineHits.length > 0 && (
            <Group kind="台词" id="grp-lines" cnt={lineHits.length}>
              <div className="result-list">
                {lineHits.slice(safeLinePage * PAGE_LINES, (safeLinePage + 1) * PAGE_LINES).map((i) => {
                  const [text, uid, speaker, lineNo] = idx![i]
                  const u = unitMap[uid]
                  return (
                    <Link key={`${uid}-${lineNo}-${i}`} to={`/story/${uid}?line=${lineNo}`} className="result">
                      <div className="result-text">
                        <Highlight text={text} keyword={debounced} />
                      </div>
                      <div className="result-meta">
                        {speaker && <span className="result-spk">{speaker}</span>}
                        <span className="result-where">{u ? `${u.label} · ${u.title}` : `单元 ${uid}`}</span>
                        <span className="result-jump">→</span>
                      </div>
                    </Link>
                  )
                })}
              </div>
              <Pager page={safeLinePage} pages={Math.ceil(lineHits.length / PAGE_LINES)} onPage={setLinePage} anchorId="grp-lines" />
            </Group>
          )}

          {!loading && total === 0 && <div className="empty">没有找到与「{debounced}」相关的内容</div>}
        </>
      )}
    </div>
  )
}

/** 搜索结果里的角色卡：与角色图鉴页同一套卡片样式（立绘 / 头像 + 名字 + 台词数） */
function CharCard({ c, imgs, mi }: { c: Character; imgs: CharImages; mi: Set<string> }) {
  const base = mainBase(imgs, c.id)
  const face = !!base && mi.has(base)
  const src = charPortrait(base, mi)
  return (
    <Link to={`/characters/${c.id}`} className="char-card" style={{ ['--tint' as string]: tintFor(c.id) }}>
      <div className={`visual ${face ? 'is-face' : 'is-full'}`}>
        {src ? (
          <img src={src} alt={c.name} loading="lazy" />
        ) : (
          <span className="fallback">{c.name.slice(0, 1)}</span>
        )}
      </div>
      <div className="meta">
        <h3 title={c.name}>{c.name}</h3>
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

/** 结果分组标题：类别名 + 数量，内容直接铺网格或列表 */
function Group({ kind, id, cnt, children }: { kind: string; id: string; cnt: number | string; children: ReactNode }) {
  return (
    <section className="sgroup" id={id}>
      <div className="sgroup-head">
        <span className="sgroup-kind">{kind}</span>
        <span className="sgroup-cnt">{typeof cnt === 'number' ? nf(cnt) : cnt}</span>
      </div>
      {children}
    </section>
  )
}

function Highlight({ text, keyword }: { text: string; keyword: string }) {
  if (!keyword) return <>{text}</>
  const k = keyword.toLowerCase()
  const t = text
  const parts: { s: string; hit: boolean }[] = []
  let from = 0
  let at = t.toLowerCase().indexOf(k, from)
  if (at === -1) return <>{text}</>
  while (at !== -1) {
    if (at > from) parts.push({ s: t.slice(from, at), hit: false })
    parts.push({ s: t.slice(at, at + keyword.length), hit: true })
    from = at + keyword.length
    at = t.toLowerCase().indexOf(k, from)
  }
  if (from < t.length) parts.push({ s: t.slice(from), hit: false })
  return (
    <>
      {parts.map((p, i) => (p.hit ? <mark key={i}>{p.s}</mark> : <span key={i}>{p.s}</span>))}
    </>
  )
}
