import { useEffect, useMemo, useRef, useState } from 'react'
import {
  loadFadingData, fadingCgSrc, choicesFor, firstFor, endingsOf,
  memoryGrantedHere, unlockedMemoryIds,
  type FadingData, type FadingPage, type FadingRoute, type UnlockReq,
} from '../fadingData'
import { usePageTitle } from '../usePageTitle'
import FadingCold, { type ColdView, type ColdChoice } from './FadingCold'

/* 所有游戏逻辑沿用原实现；UI 已替换为 F 冷寂双主题（FadingCold） */

const LS_ENDINGS = 'nikke_fading_endings_v1'
const LS_CHECKED = 'nikke_fading_checked_v1'
const LS_SEEN = 'nikke_fading_seen_v1'

const CN_NUM = ['i.', 'ii.', 'iii.', 'iv.', 'v.', 'vi.', 'vii.', 'viii.', 'ix.', 'x.']

/** 一幕淡出的时长（ms）——到点后落新页，新页自己做淡入 + 打字 */
const LEAVE_MS = 200

function loadArr(key: string): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(v) ? v.filter((n) => typeof n === 'number') : []
  } catch { return [] }
}

/** 路线解锁：按数据里的 unlockRequirement（TrueEnd 结局）判断 */
function routeUnlocked(route: FadingRoute, found: number[]): boolean {
  const req = route.unlockRequirement
  return !req || (req.kind === 'ending' && found.includes(req.id))
}

export default function FadingAffection() {
  usePageTitle('FADING AFFECTION · 渐逝的爱意')
  const [data, setData] = useState<FadingData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<ColdView>('home')
  const [route, setRoute] = useState<FadingRoute | null>(null)
  const [node, setNode] = useState<number | null>(null)
  const [history, setHistory] = useState<{ id: number; text: string; title?: string }[]>([])
  const [found, setFound] = useState<number[]>(() => loadArr(LS_ENDINGS))
  const [checked, setChecked] = useState<number[]>(() => loadArr(LS_CHECKED))
  const [seen, setSeen] = useState<number[]>(() => loadArr(LS_SEEN))
  /** 换幕状态：fade = 正在淡出的范围（page 只淡正文区，view 淡整块正文）；scene = 幕次 */
  const [fade, setFade] = useState<'none' | 'page' | 'view'>('none')
  const [scene, setScene] = useState(0)
  /** 换幕计时句柄：pending = 正在淡出（期间屏蔽点击） */
  const anim = useRef({ raf: 0, timer: 0, pending: false })
  /** 打开内存/回想时所在的视图，用来回到原处（游戏中点开内存要能回到同一页） */
  const [backView, setBackView] = useState<ColdView>('home')

  useEffect(() => {
    loadFadingData().then((d) => setData(d)).catch((e) => setError(String(e)))
  }, [])
  useEffect(() => { try { localStorage.setItem(LS_ENDINGS, JSON.stringify(found)) } catch { /* ignore */ } }, [found])
  useEffect(() => { try { localStorage.setItem(LS_CHECKED, JSON.stringify(checked)) } catch { /* ignore */ } }, [checked])
  useEffect(() => { try { localStorage.setItem(LS_SEEN, JSON.stringify(seen)) } catch { /* ignore */ } }, [seen])
  useEffect(() => () => {
    cancelAnimationFrame(anim.current.raf); clearTimeout(anim.current.timer)
  }, [])

  const endings = useMemo(() => (data ? endingsOf(data) : []), [data])
  const page: FadingPage | null = node != null && data ? data.pages[String(node)] ?? null : null
  const isIntro = node != null && !!route && node === route.start
  const text = isIntro ? route?.introText || '' : page?.text || ''
  /** CG 只在页面自带时显示；没有配图的页面（202/265）不再沿用上一幕 */
  const cgName = isIntro ? null : page?.cg ?? null
  const cgSrc = data ? fadingCgSrc(data, cgName) : null
  const choices = data && node != null ? (isIntro ? [] : choicesFor(data, node)) : []
  const firsts = data && node != null && isIntro ? firstFor(data, node) : []
  const routeNo = route?.no ?? 0
  const ending = page?.ending
  /** 无选项的页面靠 next 推进（原版「点击画面继续」）；有选项时以选项为准 */
  const autoNext = !isIntro && choices.length === 0 && !ending ? page?.next ?? null : null
  const memory = data ? memoryGrantedHere(data, node) : null

  /** 已解锁记忆：由访问过的「授予页」反查。判定用记忆 id——同一 route-序号在
   *  已储存/已删除两类里会撞（如 1-1 既是存档「袭击」也是删除「储备库」）。 */
  const unlockedMem = useMemo(
    () => (data ? unlockedMemoryIds(data, [...seen, ...found]) : new Set<number>()),
    [data, seen, found])

  function markSeen(id: number | null) {
    if (id == null) return
    setSeen((s) => (s.includes(id) ? s : [...s, id]))
  }

  /** 解锁条件取自选项表字段，与有没有 hint 无关（38 条带条件、仅 25 条带 hint） */
  function reqMet(req: UnlockReq | null): boolean {
    if (!req) return true
    if (req.kind === 'memory') return unlockedMem.has(req.id)
    if (req.kind === 'ending') return req.page != null && found.includes(req.page)
    return (data?.status.init.food ?? 0) >= req.id
  }

  function reqLockText(req: UnlockReq): string {
    if (req.kind === 'memory') return `需要【${req.name}】`
    if (req.kind === 'ending') return `观看【${req.name}】结局后解锁`
    return `需要${req.name}`
  }

  function clearSave() {
    if (!window.confirm('清除全部本地进度？\n（结局、记忆、访问过的页面、已选选项全部重置）')) return
    ;[LS_ENDINGS, LS_CHECKED, LS_SEEN].forEach((k) => {
      try { localStorage.removeItem(k) } catch { /* ignore */ }
    })
    setFound([]); setChecked([]); setSeen([])
    setHistory([]); setView('home'); setRoute(null); setNode(null)
  }

  function start(r: FadingRoute) {
    if (!routeUnlocked(r, found)) return
    transition(() => {
      setRoute(r); setNode(r.start)
      markSeen(r.start)
      setHistory([]); setView('game')
    }, 'view')
  }

  /** 小游戏内任何界面跳转都要走换幕；顺带记住来源，内存/回想看完能回到原处 */
  function nav(v: ColdView) {
    if (v === view) return
    if (v === 'memories' || v === 'endings') setBackView(view)
    transition(() => setView(v), 'view')
  }

  /**
   * 推进到下一页。原版的状态（体力/粮食/侵蚀度）在静态表里没有任何增减量，
   * 死亡/侵蚀结局都由表里的选项或页面 next 显式指向，所以这里不做数值判定。
   */
  function commit(next: number, choiceId?: number) {
    if (!data) return
    setNode(next)
    const p = data.pages[String(next)]
    setHistory((h) => [...h, {
      id: next, text: p?.text || '', title: p?.ending?.title,
    }].slice(-120))
    if (p?.ending) setFound((f) => (f.includes(next) ? f : [...f, next].sort((a, b) => a - b)))
    if (choiceId != null) setChecked((c) => (c.includes(choiceId) ? c : [...c, choiceId]))
    markSeen(next)
  }

  /** 原作换幕：先淡出，LEAVE_MS 后落新内容再淡入。用 rAF 计时，节流时也不会卡在暗场。
   *  kind 决定淡出范围：page = 只淡正文/CG/选项，view = 淡整块正文区（外框与状态栏不动）。 */
  function transition(fn: () => void, kind: 'page' | 'view' = 'page') {
    if (anim.current.pending) return
    anim.current.pending = true
    setFade(kind)
    const done = () => {
      if (!anim.current.pending) return
      anim.current.pending = false
      cancelAnimationFrame(anim.current.raf); clearTimeout(anim.current.timer)
      fn()
      setScene((s) => s + 1)
      setFade('none')
    }
    const t0 = performance.now()
    const step = (now: number) => {
      if (now - t0 >= LEAVE_MS) { done(); return }
      anim.current.raf = requestAnimationFrame(step)
    }
    anim.current.raf = requestAnimationFrame(step)
    /* 页面在后台时 rAF 根本不跑，用定时器兜底提交，避免卡在暗场 */
    anim.current.timer = window.setTimeout(done, LEAVE_MS + 150)
  }

  function go(next: number | null, choiceId?: number) {
    if (next == null) return
    transition(() => commit(next, choiceId))
  }

  /** 回退到上一个节点 */
  function goBack() {
    if (history.length === 0) return
    const prev = history[history.length - 2]
    transition(() => {
      setHistory((h) => h.slice(0, -1))
      setNode(prev?.id ?? route?.start ?? null)
    })
  }

  /* ---------- 把数据映射成展示组件需要的选项 ---------- */
  const coldChoices: ColdChoice[] = isIntro
    ? firsts.map((c, i) => {
        const locked = !reqMet(c.unlock)
        return {
          key: c.key, index: CN_NUM[i] ?? `${i + 1}.`,
          text: c.text, locked,
          lockText: locked && c.unlock ? reqLockText(c.unlock) : undefined,
          disabled: locked,
          onClick: () => go(c.dest),
        }
      })
    : choices.map((c, i) => {
        const isChecked = checked.includes(c.id)
        const locked = !reqMet(c.req)
        return {
          key: c.id, index: CN_NUM[i] ?? `${i + 1}.`,
          text: c.text,
          hint: c.hint && !isChecked ? c.hint : undefined,
          locked,
          lockText: locked && c.req ? reqLockText(c.req) : undefined,
          checked: isChecked,
          disabled: locked,
          onClick: () => !locked && go(c.dest, c.id),
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
      fade={fade}
      sceneKey={scene}
      status={data.status}
      erosionActive={!!route?.erosion}
      choices={coldChoices}
      ending={ending || null}
      endingId={node}
      memoryUnlocked={memory}
      found={found}
      endings={endings}
      memories={data.memories}
      unlockedMemories={unlockedMem}
      onStart={start}
      onNavigate={nav}
      backView={backView}
      onRestart={() => route && start(route)}
      onBack={goBack}
      canBack={history.length > 0}
      canNext={autoNext != null}
      onNext={() => go(autoNext)}
      onChoice={(c) => c.onClick()}
      onClearSave={clearSave}
      onMemClick={() => nav('memories')}
      routeUnlocked={(r) => routeUnlocked(r, found)}
    />
  )
}
