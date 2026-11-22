import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  loadFadingData, fadingCgSrc, choicesFor, firstFor, endingsOf, memoryOfEnding,
  type FadingData, type FadingPage, type FadingRoute, type FadingStatus, type FadingCost,
} from '../fadingData'
import { usePageTitle } from '../usePageTitle'
import './fading.css'

type View = 'home' | 'game' | 'endings' | 'memories'
type HistoryEntry = { id: number; text: string; title?: string }

const LS_ENDINGS = 'nikke_fading_endings_v1'
const LS_CHECKED = 'nikke_fading_checked_v1'

const LOCATION_BG: Record<string, string> = {
  '旧市区': 'DestroyedStreet', '湖': 'Lake', '新市区': 'City_d',
}

const STATUS_LABEL: Record<keyof FadingStatus, string> = { hp: '体力', food: '粮食', erosion: '侵蚀' }

function loadArr(key: string): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(v) ? v.filter((n) => typeof n === 'number') : []
  } catch { return [] }
}

function costText(cost: FadingCost): string {
  const parts: string[] = []
  for (const k of ['hp', 'food', 'erosion'] as const) {
    const v = cost[k] ?? 0
    if (v) parts.push(`${STATUS_LABEL[k]} ${v > 0 ? '+' : ''}${v}`)
  }
  return parts.join(' · ')
}

/** 路线解锁：路线1常开；路线2需看过路线1任一结局；路线3需看过路线2任一结局 */
function routeUnlocked(routeNo: number, found: number[]): boolean {
  if (routeNo === 1) return true
  const need = routeNo - 1
  return found.some((id) => Math.floor(id / 100) - 60 === need)
}

export default function FadingAffection() {
  usePageTitle('FADING AFFECTION · 渐逝的爱意')
  const [data, setData] = useState<FadingData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>('home')
  const [route, setRoute] = useState<FadingRoute | null>(null)
  const [node, setNode] = useState<number | null>(null)
  const [lastCg, setLastCg] = useState<string | null>(null)
  const [status, setStatus] = useState<FadingStatus>({ hp: 10, food: 10, erosion: 0 })
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [found, setFound] = useState<number[]>(() => loadArr(LS_ENDINGS))
  const [checked, setChecked] = useState<number[]>(() => loadArr(LS_CHECKED))
  const [observe, setObserve] = useState<number | null>(null)
  const [menu, setMenu] = useState(false)

  useEffect(() => {
    loadFadingData().then((d) => { setData(d); setStatus({ ...d.status.init }) })
      .catch((e) => setError(String(e)))
  }, [])
  useEffect(() => { try { localStorage.setItem(LS_ENDINGS, JSON.stringify(found)) } catch { /* ignore */ } }, [found])
  useEffect(() => { try { localStorage.setItem(LS_CHECKED, JSON.stringify(checked)) } catch { /* ignore */ } }, [checked])

  const endings = useMemo(() => (data ? endingsOf(data) : []), [data])
  const page: FadingPage | null = node != null && data ? data.pages[String(node)] ?? null : null
  const isIntro = node != null && !!route && node === route.start
  const text = isIntro ? route?.introText || '' : page?.text || ''
  const cgName = isIntro ? null : page?.cg || lastCg
  const choices = data && node != null ? (isIntro ? [] : choicesFor(data, node)) : []
  const firsts = data && node != null && isIntro ? firstFor(data, node) : []
  const routeNo = route?.no ?? 0
  const learned = found.some((id) => Math.floor(id / 100) - 60 === routeNo)
  const unlockedMemories = useMemo(() => {
    if (!data) return new Set<string>()
    const s = new Set<string>()
    for (const id of found) { const m = memoryOfEnding(data, id); if (m) s.add(`${m.route}-${m.index}`) }
    return s
  }, [data, found])

  function start(r: FadingRoute) {
    if (!routeUnlocked(r.no, found)) return
    setRoute(r); setNode(r.start); setLastCg(null)
    setStatus(data ? { ...data.status.init } : { hp: 10, food: 10, erosion: 0 })
    setHistory([]); setObserve(null); setView('game'); setMenu(false)
  }

  function applyCost(cost: FadingCost): FadingStatus {
    if (!data) return status
    const max = data.status.max, next = { ...status }
    for (const k of ['hp', 'food', 'erosion'] as const) {
      next[k] = Math.max(0, Math.min(max[k], next[k] + (cost[k] ?? 0)))
    }
    return next
  }

  function affordable(cost: FadingCost): boolean {
    if (!data) return true
    const max = data.status.max
    return status.hp + (cost.hp ?? 0) >= 0
      && status.food + (cost.food ?? 0) >= 0
      && status.erosion + (cost.erosion ?? 0) <= max.erosion
  }

  function forcedEnding(st: FadingStatus): number | null {
    if (st.hp <= 0 || st.food <= 0) return routeNo === 1 ? 6106 : routeNo === 2 ? 6205 : 6301
    if (st.erosion >= (data?.status.max.erosion ?? 10)) return routeNo === 1 ? 6111 : routeNo === 2 ? 6207 : 6301
    return null
  }

  function go(next: number | null, cost: FadingCost = {}, choiceId?: number) {
    if (next == null || !data) return
    const st = applyCost(cost); setStatus(st)
    const target = forcedEnding(st) ?? next
    setNode(target); setObserve(null)
    const p = data.pages[String(target)]
    if (p?.cg) setLastCg(p.cg)
    setHistory((h) => [...h, {
      id: target, text: p?.text || '',
      title: p?.ending?.title ?? (forcedEnding(st) ? '状态崩溃' : undefined),
    }].slice(-120))
    if (p?.ending) setFound((f) => (f.includes(target) ? f : [...f, target].sort((a, b) => a - b)))
    if (choiceId != null) setChecked((c) => (c.includes(choiceId) ? c : [...c, choiceId]))
  }

  const cgSrc = data ? fadingCgSrc(data, cgName) : null
  const ending = page?.ending
  const memory = ending && data ? memoryOfEnding(data, node ?? 0) : null

  if (error) return <div className="fad-root"><div className="fad-empty">数据加载失败：{error}</div></div>
  if (!data) return <div className="fad-root"><div className="fad-empty">正在读取活动数据…</div></div>

  /* ---------------- 首页 / 路线选择 ---------------- */
  if (view === 'home') {
    return (
      <div className="fad-root">
        <div className="fad-home">
          <Link to="/story" className="fad-back">← 返回剧情列表</Link>
          <header className="fad-home-hero">
            <div className="fad-home-doc">
              <div className="fad-kicker">SILVERGUN PROJECT · RESEARCH DEPARTMENT</div>
              <img className="fad-logo" src="/fading_ui/marian_intro_title.png" alt="FADING AFFECTION" />
              <div className="fad-doc-id">MARIA — {found.length ? 'RESTORED' : 'INITIALIZE'}</div>
              <p className="fad-lead">
                三段记录，三种人生。选择会消耗体力与粮食，死亡并非终点——
                留下的记忆是解锁新路线与新地点的钥匙。
              </p>
              <div className="fad-stats">
                <span><b>{data.routes.length}</b> 条路线</span>
                <span><b>{Object.keys(data.pages).length}</b> 个节点</span>
                <span><b>{endings.length}</b> 种结局</span>
                <span><b>{data.memories.length}</b> 段记忆</span>
              </div>
              <div className="fad-actions">
                <button className="fad-tape-btn" onClick={() => setView('memories')}>记忆 {unlockedMemories.size}/{data.memories.length}</button>
                <button className="fad-tape-btn" onClick={() => setView('endings')}>回想 {found.length}/{endings.length}</button>
              </div>
            </div>
          </header>
          <h2 className="fad-section-title">选择路线</h2>
          <div className="fad-routes">
            {data.routes.map((r) => {
              const ok = routeUnlocked(r.no, found)
              return (
                <button key={r.no} className={`fad-route ${ok ? '' : 'locked'}`} disabled={!ok} onClick={() => start(r)}>
                  <div className="fad-route-no">RECORD {String(r.no).padStart(2, '0')}</div>
                  <div className="fad-route-name">{ok ? r.name : 'NO SIGNAL'}</div>
                  <div className="fad-route-desc">{ok ? r.desc : `观看【${data.routes[r.no - 2]?.name ?? '前一条记录'}】的结局后解锁`}</div>
                  <div className="fad-route-foot">
                    <span>{ok ? (r.unlock ? `开放于 ${r.unlock.slice(0, 10)}` : '活动首日开放') : 'LOCKED'}</span>
                    <span className="fad-route-go">{ok ? '开始 →' : '🔒'}</span>
                  </div>
                </button>
              )
            })}
          </div>
          <p className="fad-note">路线解锁、结局进度与记忆保存在本机浏览器。界面为原作纸张档案风格的 CSS 还原。</p>
        </div>
      </div>
    )
  }

  /* ---------------- 结局图鉴 / 记忆档案 ---------------- */
  if (view === 'endings' || view === 'memories') {
    return (
      <div className="fad-root">
        <div className="fad-home">
          <button className="fad-back" onClick={() => setView('home')}>← 返回路线选择</button>
          {view === 'endings' ? (
            <>
              <h1 className="fad-title-sm">回想 <small>{found.length} / {endings.length}</small></h1>
              <div className="fad-endings">
                {endings.map((p) => {
                  const got = found.includes(p.id)
                  const src = fadingCgSrc(data, p.cg)
                  return (
                    <div key={p.id} className={`fad-ending ${got ? 'got' : 'locked'}`}>
                      <div className="fad-ending-img">{src && got ? <img src={src} alt="" loading="lazy" /> : <span>?</span>}</div>
                      <div className="fad-ending-meta">
                        <div className="fad-ending-id">#{String(p.id).slice(-4)}</div>
                        <div className="fad-ending-name">{got ? p.ending?.title : '尚未收录的结局'}</div>
                        <div className="fad-ending-hint">{got ? p.ending?.hint : '继续探索以解锁'}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          ) : (
            <>
              <h1 className="fad-title-sm">记忆 <small>{unlockedMemories.size} / {data.memories.length}</small></h1>
              <p className="fad-note">记录在 NIMPH 里的记忆，是开启新路线的钥匙。</p>
              <div className="fad-memories">
                {data.memories.map((m) => {
                  const got = unlockedMemories.has(`${m.route}-${m.index}`)
                  return (
                    <div key={`${m.route}-${m.index}`} className={`fad-memory ${got ? 'got' : 'locked'}`}>
                      <div className="fad-memory-id">R{m.route} · {String(m.index).padStart(2, '0')}</div>
                      <div className="fad-memory-name">{got ? m.name : '未储存的记忆'}</div>
                      <div className="fad-memory-short">{got ? m.short : '???'}</div>
                      <div className="fad-memory-desc">{got ? m.desc : '在对应结局中死亡后解锁。'}</div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  /* ---------------- 纸张档案游戏画面 ---------------- */
  const statusMax = data.status.max
  const stamp = routeNo === 1 ? 'MARIA' : routeNo === 2 ? 'MARIA-n' : 'No.7'
  return (
    <div className="fad-root fad-playing">
      <div className="fad-desk">
        {/* 菜单条 */}
        <div className="fad-deskbar">
          <button className="fad-mini" onClick={() => setView('home')}>← 路线</button>
          <button className="fad-mini" onClick={() => setView('memories')}>记忆 {unlockedMemories.size}</button>
          <button className="fad-mini" onClick={() => setView('endings')}>回想 {found.length}</button>
          <button className="fad-mini" onClick={() => setMenu((v) => !v)}>☰</button>
          {menu && (
            <div className="fad-popover">
              <div>状态：{costText(status)}</div>
              <button className="fad-mini" onClick={() => { setHistory([]); route && start(route) }}>重新记录</button>
              <div className="fad-popover-tip">已记录 {history.length} 步</div>
            </div>
          )}
        </div>

        <div className="fad-doc">
          <div className="fad-doc-clip" aria-hidden />
          <div className="fad-doc-leaf left" aria-hidden />
          <div className="fad-doc-leaf right" aria-hidden />
          <div className="fad-bullet b1" aria-hidden /><div className="fad-bullet b2" aria-hidden />
          <div className="fad-bullet b3" aria-hidden /><div className="fad-hole h1" aria-hidden />
          <div className="fad-hole h2" aria-hidden />

          {/* 页眉 */}
          <div className="fad-doc-head">
            <div className="fad-doc-tag">{stamp}</div>
            <div className="fad-doc-title">{route?.name}</div>
            <div className="fad-doc-stamp">{routeNo === 3 ? 'IN ACTION' : `MARIA - ${routeNo}`}</div>
            <div className="fad-doc-nav">
              <button disabled={history.length === 0} onClick={() => {
                const prev = history[history.length - 2]
                if (!prev) return
                setHistory((h) => h.slice(0, -1)); setNode(prev.id)
                const p = data.pages[String(prev.id)]; if (p?.cg) setLastCg(p.cg)
              }}>◀</button>
              <button onClick={() => route && start(route)}>⏎</button>
            </div>
          </div>

          <div className="fad-doc-body">
            {cgSrc && (
              <div className="fad-frame">
                <img key={cgName || ''} src={cgSrc} alt={cgName || ''} />
                <span className="fad-frame-tag">Script</span>
              </div>
            )}
            <div className="fad-script-tag">Script</div>
            <div className="fad-script">{text}</div>

            {isIntro ? (
              <div className="fad-choices">
                {firsts.map((c) => {
                  const locBg = LOCATION_BG[c.text]
                  const locked = (c.text === '湖' && !learned) || (c.text === '新市区' && !found.includes(7205))
                  return (
                    <button key={c.key} className={`fad-choice ${locked ? 'locked' : ''}`} disabled={locked} onClick={() => go(c.dest)}>
                      <span className="fad-choice-main">{locked ? '???' : c.text}</span>
                      {locked && <span className="fad-choice-req">{c.text === '新市区' ? '观看【结局 7205】后解锁' : '观看任一结局后解锁'}</span>}
                    </button>
                  )
                })}
              </div>
            ) : choices.length ? (
              <div className="fad-choices">
                {choices.map((c) => {
                  const isChecked = checked.includes(c.id)
                  const hintLocked = !!c.hint && !learned
                  const can = !hintLocked && affordable(c.cost)
                  const cost = costText(c.cost)
                  return (
                    <button key={c.id} className={`fad-choice ${hintLocked ? 'locked' : ''} ${isChecked ? 'checked' : ''} ${c.hint ? 'withhint' : ''}`}
                      disabled={!can} onClick={() => can && go(c.dest, c.cost, c.id)}>
                      {isChecked && <span className="fad-checked">Checked</span>}
                      {hintLocked ? <span className="fad-choice-main">???</span> : (
                        <>
                          {c.hint && <span className="fad-hint-badge">HINT</span>}
                          <span className="fad-choice-main">{c.text}</span>
                          {c.hint && <span className="fad-hint-text">{c.hint}</span>}
                          {c.hint && !isChecked && (
                            <span className="fad-observe" onClick={(e) => { e.stopPropagation(); setObserve(observe === c.id ? null : c.id) }}>
                              观察【{observe === c.id ? '记忆' : '???'}】
                            </span>
                          )}
                          {cost && <span className="fad-choice-cost">{cost}</span>}
                          {isChecked && <span className="fad-plus">👁 +1%</span>}
                          {!can && !hintLocked && <span className="fad-choice-req">状态不足，无法执行</span>}
                        </>
                      )}
                    </button>
                  )
                })}
              </div>
            ) : ending ? (
              <div className="fad-ending-panel">
                <div className="fad-ending-label">RECORD CLOSED · {found.includes(node ?? 0) ? '结局已收录' : '新结局'}</div>
                <div className="fad-ending-title">{ending.title}</div>
                <div className="fad-ending-tip">{ending.hint}</div>
                {memory && <div className="fad-memory-unlock">◆ 解锁记忆：{memory.name}</div>}
                <div className="fad-actions">
                  <button className="fad-btn" onClick={() => route && start(route)}>重新记录</button>
                  <button className="fad-btn fad-btn-ghost" onClick={() => setView('endings')}>回想</button>
                </div>
              </div>
            ) : page?.next ? (
              <div className="fad-next" onClick={() => go(page.next)}>点击画面继续 ▸</div>
            ) : null}
          </div>

          {/* 底部状态栏 */}
          <div className="fad-doc-foot">
            <div className="fad-status">
              <div className="fad-status-cell">
                <span className="fad-status-name">体力</span>
                <span className="fad-status-val">💙 {status.hp}/{statusMax.hp}</span>
              </div>
              <div className="fad-status-cell">
                <span className="fad-status-name">粮食</span>
                <span className="fad-status-val">🍖 {status.food}</span>
              </div>
              <button className="fad-memory-card" onClick={() => setView('memories')}>内存 <span>{unlockedMemories.size}</span></button>
            </div>
            <div className="fad-erosion">
              <span className="fad-erosion-eye">👁</span>
              <span className="fad-erosion-name">侵蚀程度</span>
              <div className="fad-erosion-track"><div style={{ width: `${(status.erosion / statusMax.erosion) * 100}%` }} /></div>
              <span className="fad-erosion-num">{Math.round((status.erosion / statusMax.erosion) * 100)}%</span>
            </div>
            <div className="fad-access">ACCESS DENIED</div>
          </div>
        </div>
        <p className="fad-footer-note">逆向自 EventTextAdvPlus 静态表 · 纸张档案 UI 为 CSS 风格还原 · {data.version}</p>
      </div>
    </div>
  )
}
