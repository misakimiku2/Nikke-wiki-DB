import { useEffect, useMemo, useRef, useState } from 'react'
import {
  loadFadingData, fadingCgSrc, choicesFor, firstFor, endingsOf,
  memoryGrantedHere, unlockedMemoryIds, locationOf, applyFadingStatusChange,
  type FadingData, type FadingPage, type FadingRoute, type UnlockReq, type FadingStatus,
} from '../fadingData'
import { usePageTitle } from '../usePageTitle'
import { FadingAudio, loadFadingAudio, DEFAULT_GAINS, type FadingAudioMap, type FadingAudioGains } from '../fadingAudio'
import FadingCold, { type ColdView, type ColdChoice } from './FadingCold'

/* 所有游戏逻辑沿用原实现；UI 已替换为 F 冷寂双主题（FadingCold） */

const LS_ENDINGS = 'nikke_fading_endings_v1'
const LS_CHECKED = 'nikke_fading_checked_v1'
const LS_SEEN = 'nikke_fading_seen_v1'
const LS_MUTE = 'nikke_fading_mute'
const LS_VOL = 'nikke_fading_volume_v1'

/** 音量存在本地；坏值一律退回满音量（乘在基准音量上，100% 就是原来的手感） */
function loadGains(): FadingAudioGains {
  const pick = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1)
  try {
    const v = JSON.parse(localStorage.getItem(LS_VOL) || 'null') as Partial<FadingAudioGains> | null
    if (v && typeof v === 'object') return { bgm: pick(v.bgm), sfx: pick(v.sfx) }
  } catch { /* ignore */ }
  return { ...DEFAULT_GAINS }
}

/** 环境音床的选择。EventTextAdvPlus 八张表里没有任何音频字段（ambient 关键字零命中），
 *  所以按场景文本自己写明的「时间 + 地点」来定；每条床的音色是频谱实测出来的：
 *  fade 53% 能量在 400Hz 以下 = 废墟风声；night 3kHz 以上有虫鸣音调 = 夜；
 *  river 76% 落在 0.4~3kHz = 水声；citymoving 84% 在 400Hz 以下 = 车流低频。
 *  默认按页号百位取地点（1 旧市区 / 2 湖泊 / 3 新市区，路线 1、2 的编号就是这么分的），
 *  路线 3 的页号全是 31xx、地点却在同一批编号里换，所以再叠一张按下表文本覆盖的区间表。 */
const AMBIENT_OVER: [number, number, string][] = [
  [1132, 1140, 'night'],   // 1132「太阳完全西沉」、1136「伸手不见五指」，到 1141「阳光从窗外洒落进来」结束
  [3112, 3113, 'night'],   // 3112「时间来到夜晚」
  [3114, 3129, 'river'],   // 3114「沿着小径走了又走，7号终于抵达湖边」
  [3130, 3137, 'citymoving'], // 3130「朝新市区跑去」、3132「被称为新市区的城市，入口染上晚霞」
  [3138, 3146, 'night'],   // 3138「弥漫的尘埃映着月光」起的教堂夜戏
]

export function ambientKeyFor(node: number | null): string | null {
  if (node == null) return null
  if (node >= 7000 && node < 8000) return 'ambient_fadingaffection_erosion'
  const ov = AMBIENT_OVER.find(([a, b]) => node >= a && node <= b)
  if (ov) return `ambient_fad_${ov[2]}`
  const loc = locationOf(node)
  if (loc === 'lake') return 'ambient_fad_river'
  if (loc === 'city') return 'ambient_fad_citymoving'
  return 'ambient_fad_fade'
}

/** 开场选地点的三条专用音效（旧市区 / 湖 / 新市区） */
const FIRSTSELECT: Record<string, string> = {
  旧市区: 'uis_mini_fad_special_firstselect_city',
  湖: 'uis_mini_fad_special_firstselect_river',
  新市区: 'uis_mini_fad_special_firstselect_newcity',
}

/** 主菜单曲 = `event_bgm_maria-n_smile`。
 *  出处是 `JukeboxListTable.mpk`：它的每一行按「音频 key → 曲名 → 作曲者」排列，
 *  该行的曲名分词是 Want/make/you/Smile、署名 NieN，即 「I Want to make you Smile」，
 *  与游戏内收录一致（对照：裸名的 `event_bgm_marian` 是另一首 Marian / Cosmograph）。
 *  只在主菜单有声——点关卡卡片进选地点就淡掉，但进度继续走，回来时从当前位置接上。 */
const MENU_BGM = 'event_bgm_maria-n_smile'

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
  const [status, setStatus] = useState<FadingStatus>({ hp: 10, food: 1, erosion: 0 })
  const [history, setHistory] = useState<{ id: number; text: string; title?: string; status: FadingStatus }[]>([])
  const [found, setFound] = useState<number[]>(() => loadArr(LS_ENDINGS))
  const [checked, setChecked] = useState<number[]>(() => loadArr(LS_CHECKED))
  const [seen, setSeen] = useState<number[]>(() => loadArr(LS_SEEN))
  /** 三个进度数组的同步副本：授予要「到达即入库」，不能只等 useEffect 那一拍；
   *  同一 tick 内连续授予时也不会拿到旧数组。 */
  const seenRef = useRef(seen)
  const foundRef = useRef(found)
  const checkedRef = useRef(checked)
  useEffect(() => { seenRef.current = seen }, [seen])
  useEffect(() => { foundRef.current = found }, [found])
  useEffect(() => { checkedRef.current = checked }, [checked])
  /** 换幕状态：fade = 正在淡出的范围（page 只淡正文区，view 淡整块正文）；scene = 幕次 */
  const [fade, setFade] = useState<'none' | 'page' | 'view'>('none')
  const [scene, setScene] = useState(0)
  /** 换幕计时句柄：pending = 正在淡出（期间屏蔽点击） */
  const anim = useRef({ raf: 0, timer: 0, pending: false })
  /** 打开内存/回想时所在的视图，用来回到原处（游戏中点开内存要能回到同一页） */
  const [backView, setBackView] = useState<ColdView>('home')
  /** 点击带 HINT 的锁定项时弹出的提示横幅，几秒后自动收起 */
  const [hintToast, setHintToast] = useState<string | null>(null)
  const [hintClosing, setHintClosing] = useState(false)
  /** 音频：清单 + 播放器实例 + 静音开关 + 音量（都存在本地） */
  const [audioMap, setAudioMap] = useState<FadingAudioMap | null>(null)
  const [muted, setMuted] = useState(() => {
    try { return localStorage.getItem(LS_MUTE) === '1' } catch { return false }
  })
  const [gains, setGains] = useState<FadingAudioGains>(loadGains)
  const sound = useRef<FadingAudio | null>(null)
  /** 音效音量试听限频：拖动时不能每个像素都“咔”一声 */
  const lastPreview = useRef(0)

  useEffect(() => {
    loadFadingData().then((d) => {
      setData(d)
      setStatus({ ...d.status.init })
    }).catch((e) => setError(String(e)))
    loadFadingAudio().then(setAudioMap).catch(() => setAudioMap({}))
  }, [])
  /* 初始静音 / 音量在构造时就带上，别指望 effect 补——实例比 effect 晚到（见 fadingAudio 注释） */
  useEffect(() => {
    if (audioMap && !sound.current) sound.current = new FadingAudio(audioMap, { muted, gains })
  }, [audioMap]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    sound.current?.setMuted(muted)
    try { localStorage.setItem(LS_MUTE, muted ? '1' : '0') } catch { /* ignore */ }
  }, [muted, audioMap])
  useEffect(() => {
    sound.current?.setGains(gains)
    try { localStorage.setItem(LS_VOL, JSON.stringify(gains)) } catch { /* ignore */ }
  }, [gains, audioMap])
  useEffect(() => { try { localStorage.setItem(LS_ENDINGS, JSON.stringify(found)) } catch { /* ignore */ } }, [found])
  useEffect(() => { try { localStorage.setItem(LS_CHECKED, JSON.stringify(checked)) } catch { /* ignore */ } }, [checked])
  useEffect(() => { try { localStorage.setItem(LS_SEEN, JSON.stringify(seen)) } catch { /* ignore */ } }, [seen])
  useEffect(() => {
    if (!hintToast || hintClosing) return
    const t = setTimeout(() => setHintClosing(true), 3000)
    return () => clearTimeout(t)
  }, [hintToast, hintClosing])
  useEffect(() => {
    if (!hintClosing) return
    const t = setTimeout(() => { setHintToast(null); setHintClosing(false) }, 280)
    return () => clearTimeout(t)
  }, [hintClosing])
  useEffect(() => () => {
    cancelAnimationFrame(anim.current.raf); clearTimeout(anim.current.timer)
    /* 切到站内其它页面时小游戏已经卸载，循环层得一起停，不然 BGM 会一直响 */
    sound.current?.stopBgm()
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

  /** 本页该放哪首 BGM：页面自己写了 bgm 就用它，没写就沿走过的路径往前回溯到最近一首。
   *  不能按「上一次播放了什么」来继承——从结局页点「重新记录」或顶部的「返回上一节点」时，
   *  上一次响的是结局曲，那样写结局音乐就会一直留着。回溯不到就是不放音乐
   *  （选地点那屏只有风声环境音，原作不在这里放曲子）。 */
  const bgm = useMemo(() => {
    if (page?.bgm) return page.bgm
    for (let i = history.length - 2; i >= 0; i--) {
      const b = data?.pages[String(history[i].id)]?.bgm
      if (b) return b
    }
    return null
  }, [data, page, history])

  /** 主菜单曲只跟着主菜单——点关卡卡片进选地点就淡掉，但只淡音量不暂停，
   *  进度一直在走，所以回到主菜单是从当前位置接上（原作行为），不是每次从头放。
   *  从主菜单打开的内存/回想仍然算在主菜单里，靠 backView 判断。
   *  关卡选择屏也算主菜单——原版是点了关卡卡片进「选地点」才把这首淡掉的。
   *  从剧情打开的内存/回想是浮层，底下那层 BGM 与音床都不动。 */
  useEffect(() => {
    const onMenu = view === 'home' || view === 'routes'
      || ((view === 'memories' || view === 'endings') && (backView === 'home' || backView === 'routes'))
    sound.current?.setShell(MENU_BGM, onMenu)
    if (view === 'home' || view === 'routes') { sound.current?.playBgm(null); sound.current?.playAmbient(null); return }
    if (view !== 'game') return
    sound.current?.playBgm(bgm)
    sound.current?.playAmbient(ambientKeyFor(node))
    /* audioMap 进来之前 sound 还是空的，首屏那次会空放，所以清单也要当依赖 */
  }, [view, bgm, node, audioMap, backView])

  const ui = (key: string) => sound.current?.playUi(key)

  /** 静音键：先把状态落到播放器再放反馈音，否则「取消静音」这一下自己听不见 */
  function toggleMute() {
    const next = !muted
    setMuted(next)
    sound.current?.setMuted(next)
    if (next) ui('uis_mini_fad_btn')
  }

  /** 音量条：先同步给播放器再试听，拖到哪就听到哪（音效档位用按钮音试） */
  function changeGain(k: keyof FadingAudioGains, v: number) {
    const next = { ...gains, [k]: v }
    setGains(next)
    sound.current?.setGains(next)
    if (k !== 'sfx' || v <= 0) return
    const now = performance.now()
    if (now - lastPreview.current < 170) return
    lastPreview.current = now
    sound.current?.playUi('uis_mini_fad_btn')
  }

  /** 原版点锁定的 HINT 项会弹一条提示并响 hint_toast 音，不推进剧情 */
  function showHint(text: string) {
    ui('uis_mini_fad_hint_toast')
    setHintToast(text)
    setHintClosing(false)
  }

  /** 换幕时提前收起提示（走同一段淡出，不会留到下一页） */
  function closeHint() { setHintClosing(true) }

  /** 已解锁记忆：由访问过的「授予页」反查。判定用记忆 id——同一 route-序号在
   *  已储存/已删除两类里会撞（如 1-1 既是存档「袭击」也是删除「储备库」）。 */
  const unlockedMem = useMemo(
    () => (data ? unlockedMemoryIds(data, [...seen, ...found]) : new Set<number>()),
    [data, seen, found])

  /** 已打开过的路线：原作卡片右上角那枚 NEW 是 prefab 里的 reddot_v2（新内容红点），
   *  由运行时状态驱动，RouteTable 里没有这个字段。本地没有红点系统，就用「这条路线
   *  的页面有没有被访问过」来推——进路线第一件事就是 markSeen(start)，所以点开即消失。
   *  开发用「全解锁」会把所有页面写进 seen，因此点完它不会再亮任何 NEW。 */
  const openedRoutes = useMemo(() => {
    const touched = new Set<number>()
    if (!data) return touched
    for (const id of seen) {
      const rn = data.pages[String(id)]?.route
      if (rn != null) touched.add(rn)
    }
    /* 三条路线的开场页（1001/2001/3001）在页面表里没有 route 字段，
       只能按 route.start 反查——进路线第一件事就是 markSeen(start) */
    for (const r of data.routes) if (seen.includes(r.start)) touched.add(r.no)
    return touched
  }, [data, seen])

  /** 记一笔「已获得」并立即落盘。访问页 / 结局 / 已选选项都走这里。
   *  之所以不等 useEffect：结局页一出现就该算数，用户这时直接点「返回上一节点」
   *  或者刷新走人，也不能让这条记忆凭空丢掉。 */
  function grant(
    ref: { current: number[] },
    set: (v: number[]) => void,
    key: string,
    id: number,
    sorted = false,
  ) {
    if (ref.current.includes(id)) return
    const next = sorted
      ? [...ref.current, id].sort((a, b) => a - b)
      : [...ref.current, id]
    ref.current = next
    set(next)
    try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* ignore */ }
  }

  function markSeen(id: number | null) {
    if (id == null) return
    grant(seenRef, setSeen, LS_SEEN, id)
  }

  /** 解锁条件取自选项表字段，与有没有 hint 无关（38 条带条件、仅 25 条带 hint） */
  function reqMet(req: UnlockReq | null): boolean {
    if (!req) return true
    if (req.kind === 'memory') return unlockedMem.has(req.id)
    if (req.kind === 'ending') return req.page != null && found.includes(req.page)
    return status.food >= req.id
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
    foundRef.current = []; checkedRef.current = []; seenRef.current = []
    setHistory([]); setView('home'); setRoute(null); setNode(null)
    setStatus(data ? { ...data.status.init } : { hp: 10, food: 1, erosion: 0 })
  }

  function start(r: FadingRoute) {
    if (!routeUnlocked(r, found)) return
    ui('uis_mini_fad_routeselect_start')
    transition(() => {
      setRoute(r); setNode(r.start)
      setStatus(data ? { ...data.status.init } : { hp: 10, food: 1, erosion: 0 })
      markSeen(r.start)
      setHistory([]); setView('game')
    }, 'view')
  }

  /** 「重新记录」= 确认这次结局：把结局页和它授予的记忆写进存档，再重开路线。
   *  这是结局唯一的入库时机——结局页本身落上去时不写（见 commit），
   *  所以点「返回上一节点」就等于放弃这次记录。 */
  function confirmRestart() {
    if (!route) return
    const end = node != null ? data?.pages[String(node)] : null
    if (end?.ending) {
      grant(foundRef, setFound, LS_ENDINGS, end.id, true)
      grant(seenRef, setSeen, LS_SEEN, end.id)
    }
    start(route)
  }

  /** 小游戏内任何界面跳转都要走换幕；顺带记住来源，内存/回想看完能回到原处 */
  function nav(v: ColdView) {
    if (v === view) return
    if (v === 'memories' || v === 'endings') { setBackView(view); ui('uis_mini_fad_recall') }
    else if (v === 'home') ui('uis_mini_fad_out')
    else if (v === 'routes') ui('uis_mini_fad_routeselect_start')
    else ui('uis_mini_fad_back')
    transition(() => setView(v), 'view')
  }

  /** 推进到下一页，并应用选项表里的 hp / food / erosion 增量。
   * 结局页例外：落上去只是「待确认」，不写任何存档。结局与它授予的记忆要等玩家
   * 在结局面板点「重新记录」才入库（见 confirmRestart）；直接点「返回上一节点」
   * 等于放弃这次记录——结局页也不会记进访问过，因此对应的记忆仍是锁着的。 */
  function commit(next: number, choiceId?: number) {
    if (!data) return
    const change = choiceId != null
      ? data.choices[String(choiceId)]?.statusChange
      : { hp: 0, food: 0, erosion: 0 }
    const nextStatus = applyFadingStatusChange(status, change ?? { hp: 0, food: 0, erosion: 0 }, data.status.max)
    setStatus(nextStatus)
    setNode(next)
    const p = data.pages[String(next)]
    setHistory((h) => [...h, {
      id: next, text: p?.text || '', title: p?.ending?.title, status: nextStatus,
    }].slice(-120))
    if (choiceId != null) grant(checkedRef, setChecked, LS_CHECKED, choiceId)
    if (!p?.ending) markSeen(next)
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
    if (hintToast) closeHint()
    transition(() => commit(next, choiceId))
  }

  /** 回退到上一个节点 */
  function goBack() {
    if (history.length === 0) return
    const prev = history[history.length - 2]
    ui('uis_mini_fad_back')
    transition(() => {
      setHistory((h) => h.slice(0, -1))
      setNode(prev?.id ?? route?.start ?? null)
      setStatus(prev?.status ?? (data ? { ...data.status.init } : { hp: 10, food: 1, erosion: 0 }))
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
          onClick: () => { ui(FIRSTSELECT[c.text] || 'uis_mini_fad_special_firstselect'); go(c.dest) },
        }
      })
    : choices.map((c, i) => {
        const isChecked = checked.includes(c.id)
        const locked = !reqMet(c.req)
        // 原版：带 HINT 的锁定项仍可点，点下去只弹提示（音效 uis_mini_fad_hint_toast），不推进
        const hintLocked = locked && !!c.hint
        return {
          key: c.id, index: CN_NUM[i] ?? `${i + 1}.`,
          text: c.text,
          hint: c.hint && !isChecked ? c.hint : undefined,
          locked,
          lockText: locked && c.req ? reqLockText(c.req) : undefined,
          checked: isChecked,
          statusChange: c.statusChange,
          disabled: locked && !hintLocked,
          hintOnly: hintLocked,
          onClick: () => {
            if (hintLocked) { showHint(c.hint); return }
            if (locked) return
            /* 172 条选项里只有 74 条在表里带 sfx（剧情音），点哪条都要有一声按钮音兜底 */
            ui('uis_mini_fad_btn')
            sound.current?.playSfx(c.sfx)
            go(c.dest, c.id)
          },
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
      status={status}
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
      onRestart={confirmRestart}
      onBack={goBack}
      canBack={history.length > 0}
      canNext={autoNext != null}
      onNext={() => { ui('uis_mini_fad_btn'); go(autoNext) }}
      onChoice={(c) => c.onClick()}
      hintToast={hintToast}
      hintClosing={hintClosing}
      onHint={showHint}
      onClearSave={clearSave}
      onMemClick={() => nav('memories')}
      muted={muted}
      onToggleMute={toggleMute}
      gains={gains}
      onGainChange={changeGain}
      onGainReset={() => { setGains({ ...DEFAULT_GAINS }); sound.current?.setGains(DEFAULT_GAINS) }}
      onType={() => sound.current?.playTyping()}
      onErosionBurst={() => sound.current?.playSfx('uis_mini_fad_erosion_change')}
      routeUnlocked={(r) => routeUnlocked(r, found)}
      routeIsNew={(r) => !openedRoutes.has(r.no)}
    />
  )
}
