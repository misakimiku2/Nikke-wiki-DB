import { useEffect, useMemo, useState } from 'react'
import {
  loadFadingData, fadingCgSrc, choicesFor, firstFor, endingsOf, memoryOfEnding,
  type FadingData, type FadingPage, type FadingRoute, type FadingStatus, type FadingCost, type FadingChoice,
} from '../fadingData'
import { usePageTitle } from '../usePageTitle'
import FadingCold, { type ColdView, type ColdChoice } from './FadingCold'

/* 所有游戏逻辑沿用原实现；UI 已替换为 F 冷寂双主题（FadingCold） */

const LS_ENDINGS = 'nikke_fading_endings_v1'
const LS_CHECKED = 'nikke_fading_checked_v1'
const LS_SEEN = 'nikke_fading_seen_v1'

const STATUS_LABEL: Record<keyof FadingStatus, string> = { hp: '体力', food: '粮食', erosion: '侵蚀' }
const CN_NUM = ['i.', 'ii.', 'iii.', 'iv.', 'v.', 'vi.', 'vii.', 'viii.', 'ix.', 'x.']

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

/** 路线解锁：按数据里的 unlockRequirement（TrueEnd 结局）判断 */
function routeUnlocked(route: FadingRoute, found: number[]): boolean {
  const req = route.unlockRequirement
  return !req || (req.kind === 'ending' && found.includes(req.page))
}

export default function FadingAffection() {
  usePageTitle('FADING AFFECTION · 渐逝的爱意')
  const [data, setData] = useState<FadingData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<ColdView>('home')
  const [route, setRoute] = useState<FadingRoute | null>(null)
  const [node, setNode] = useState<number | null>(null)
  const [lastCg, setLastCg] = useState<string | null>(null)
  const [status, setStatus] = useState<FadingStatus>({ hp: 10, food: 10, erosion: 0 })
  const [history, setHistory] = useState<{ id: number; text: string; title?: string }[]>([])
  const [found, setFound] = useState<number[]>(() => loadArr(LS_ENDINGS))
  const [checked, setChecked] = useState<number[]>(() => loadArr(LS_CHECKED))
  const [seen, setSeen] = useState<number[]>(() => loadArr(LS_SEEN))

  useEffect(() => {
    loadFadingData().then((d) => { setData(d); setStatus({ ...d.status.init }) })
      .catch((e) => setError(String(e)))
  }, [])
  useEffect(() => { try { localStorage.setItem(LS_ENDINGS, JSON.stringify(found)) } catch { /* ignore */ } }, [found])
  useEffect(() => { try { localStorage.setItem(LS_CHECKED, JSON.stringify(checked)) } catch { /* ignore */ } }, [checked])
  useEffect(() => { try { localStorage.setItem(LS_SEEN, JSON.stringify(seen)) } catch { /* ignore */ } }, [seen])

  const endings = useMemo(() => (data ? endingsOf(data) : []), [data])
  const page: FadingPage | null = node != null && data ? data.pages[String(node)] ?? null : null
  const isIntro = node != null && !!route && node === route.start
  const text = isIntro ? route?.introText || '' : page?.text || ''
  const cgName = isIntro ? null : page?.cg || lastCg
  const cgSrc = data ? fadingCgSrc(data, cgName) : null
  const choices = data && node != null ? (isIntro ? [] : choicesFor(data, node)) : []
  const firsts = data && node != null && isIntro ? firstFor(data, node) : []
  const routeNo = route?.no ?? 0
  const ending = page?.ending
  const memory = ending && data ? memoryOfEnding(data, node ?? 0) : null

  const unlockedMemories = useMemo(() => {
    if (!data) return new Set<string>()
    const s = new Set<string>()
    for (const id of found) { const m = memoryOfEnding(data, id); if (m) s.add(`${m.route}-${m.index}`) }
    for (const id of seen) { const m = data.memoryByPage[String(id)]; if (m) s.add(`${m.route}-${m.index}`) }
    return s
  }, [data, found, seen])

  function markSeen(id: number | null) {
    if (id == null) return
    setSeen((s) => (s.includes(id) ? s : [...s, id]))
  }

  function hintUnlocked(c: FadingChoice): boolean {
    const req = c.hintReq
    if (!req) return true
    if (req.kind === 'memory') return unlockedMemories.has(req.memory ?? '')
    if (req.kind === 'ending') return found.includes(req.page)
    return status.food >= 1
  }

  function clearSave() {
    if (!window.confirm('清除全部本地进度？\n（结局、记忆、访问过的页面、已选选项全部重置）')) return
    ;[LS_ENDINGS, LS_CHECKED, LS_SEEN].forEach((k) => {
      try { localStorage.removeItem(k) } catch { /* ignore */ }
    })
    setFound([]); setChecked([]); setSeen([])
    setHistory([]); setView('home'); setRoute(null); setNode(null); setLastCg(null)
  }

  function start(r: FadingRoute) {
    if (!routeUnlocked(r, found)) return
    setRoute(r); setNode(r.start); setLastCg(null)
    markSeen(r.start)
    setStatus(data ? { ...data.status.init } : { hp: 10, food: 10, erosion: 0 })
    setHistory([]); setView('game')
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
    setNode(target)
    const p = data.pages[String(target)]
    if (p?.cg) setLastCg(p.cg)
    setHistory((h) => [...h, {
      id: target, text: p?.text || '',
      title: p?.ending?.title ?? (forcedEnding(st) ? '状态崩溃' : undefined),
    }].slice(-120))
    if (p?.ending) setFound((f) => (f.includes(target) ? f : [...f, target].sort((a, b) => a - b)))
    if (choiceId != null) setChecked((c) => (c.includes(choiceId) ? c : [...c, choiceId]))
    markSeen(target)
  }

  /** 回退到上一个节点：从历史栈弹出，恢复该页的 CG */
  function goBack() {
    if (history.length === 0) return
    const prev = history[history.length - 2]
    setHistory((h) => h.slice(0, -1))
    if (!prev) { setNode(route?.start ?? null); setLastCg(null); return }
    setNode(prev.id)
    const p = data?.pages[String(prev.id)]
    if (p?.cg) setLastCg(p.cg)
    else setLastCg(null)
  }

  /* ---------- 把数据映射成展示组件需要的选项 ---------- */
  const coldChoices: ColdChoice[] = isIntro
    ? firsts.map((c, i) => {
        const req = c.unlock
        const locked = !!req && !(
          req.kind === 'memory' ? unlockedMemories.has(req.memory ?? '') : found.includes(req.page)
        )
        return {
          key: c.key, index: CN_NUM[i] ?? `${i + 1}.`,
          text: c.text, locked,
          lockText: locked ? (req?.kind === 'memory' ? `需要回忆【${req.name}】` : `观看【${req.name}】结局后解锁`) : undefined,
          disabled: locked,
          onClick: () => go(c.dest),
        }
      })
    : choices.map((c, i) => {
        const isChecked = checked.includes(c.id)
        const hintLocked = !!c.hint && !hintUnlocked(c)
        const can = !hintLocked && affordable(c.cost)
        return {
          key: c.id, index: CN_NUM[i] ?? `${i + 1}.`,
          text: c.text,
          cost: costText(c.cost) || undefined,
          hint: c.hint && !isChecked ? c.hint : undefined,
          locked: hintLocked,
          lockText: hintLocked
            ? (c.hintReq?.kind === 'memory' ? `需要回忆【${c.hintReq.name}】`
              : c.hintReq?.kind === 'ending' ? `观看【${c.hintReq.name}】结局后解锁` : '需要特定状态')
            : undefined,
          checked: isChecked,
          disabled: !can,
          onClick: () => can && go(c.dest, c.cost, c.id),
        }
      })

  if (error) return <div style={{ padding: 80, textAlign: 'center', color: '#ccc' }}>数据加载失败：{error}</div>
  if (!data) return <div style={{ padding: 80, textAlign: 'center', color: '#ccc' }}>正在读取活动数据…</div>

  return (
    <FadingCold
      data={data}
      view={view}
      route={route}
      pageText={text}
      cgSrc={cgSrc}
      cgAlt={cgName || undefined}
      isRegionSelect={isIntro}
      status={status}
      statusMax={data.status.max}
      choices={coldChoices}
      ending={ending || null}
      endingId={node}
      memoryUnlocked={memory}
      found={found}
      endings={endings}
      memories={data.memories}
      unlockedMemories={unlockedMemories}
      onStart={start}
      onNavigate={setView}
      onRestart={() => route && start(route)}
      onBack={goBack}
      canBack={history.length > 0}
      onChoice={(c) => c.onClick()}
      onClearSave={clearSave}
      onMemClick={() => setView('memories')}
      routeUnlocked={(r) => routeUnlocked(r, found)}
    />
  )
}
