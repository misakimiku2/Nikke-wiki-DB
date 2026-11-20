import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import ImageViewer, { type ImageViewerApi } from '../components/ImageViewer'
import PlayPauseIcon from '../components/PlayPauseIcon'
import { useImmersive, ExpandIcon, ImmersiveExitButton } from '../components/Immersive'
import { usePageTitle } from '../usePageTitle'
import SpinePlayer, { type SpineController, type SpineStatus } from '../components/SpinePlayer'
import {
  coverOf, loadCgIndex, loadCharacters, loadSpineModels, loadSpineOverrides, loadStoryIndex,
  loadStoryUnit, mergedBgOf, nf,
  setLinks, setMembersOf, visibleCgs,
  type CgIndex, type CgItem, type Character, type SpineOverride, type StoryDetail, type StoryLine,
  type StoryUnit, type ViewTransform,
} from '../data'
import { commanderName, pickLang, useLang } from '../lang'
import { fmt, useUI, type UIKey } from '../ui'

const EMPTY: SpineStatus = {
  ready: false, playing: true, time: 0, duration: 0, speed: 1, zoom: 1, anim: '', anims: [],
}
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]
/** 窄屏断点：与 index.css 里 CG 查看器的抽屉布局断点保持一致 */
const NARROW = '(max-width: 980px)'

/** cg_index 的分类键 → UI 词典 key（与 CgGallery 的 CG_CAT_KEY 同一张表） */
const CV_CAT_KEY: Record<string, UIKey> = {
  '01_活动剧情CG': 'cg_cat_event',
  '02_主线剧情CG': 'cg_cat_main',
  '03_支线剧情CG': 'cg_cat_sub',
  '04_角色过场': 'cg_cat_chara',
  '05_其他动态CG': 'cg_cat_other',
}

function fmtTime(t: number): string {
  if (!Number.isFinite(t) || t < 0) return '0:00.0'
  const m = Math.floor(t / 60)
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`
}

/** 单元全文按全局行序摊平（与阅读器 ?line= 的行号同一套口径），取 [at, at+count) 一段作原文。
 *  count 缺失时兜底取 20 行，避免异常数据把剩余全文全吐出来。 */
function paragraphLines(d: StoryDetail, at: number, count: number): StoryLine[] {
  const flat: StoryLine[] = []
  for (const seg of d.segments) flat.push(...seg.l)
  return flat.slice(at, at + (count > 0 ? count : 20))
}

/** 说话人显示名：简中直接用原文；指挥官/选项走固定译名；其余按角色档案本地化（StoryReader 同款） */
function speakerDisplay(
  lang: ReturnType<typeof useLang>['lang'],
  sp: string, spid: string,
  speakerMap: Record<string, Character>, nameMap: Record<string, Character>,
): string {
  const c = speakerMap[spid] || nameMap[sp]
  const isCmd = spid === 'Self' || spid === 'Choice' || sp === '指挥官'
  return lang === 'zh' ? sp
    : isCmd ? commanderName(lang)
      : pickLang(lang, sp, c?.names.en, c?.names.ko, c?.names.ja)
}

/**
 * CG 二级查看页
 *  左：CG 目录（文件名 + 搜索）  中：查看区（静态合成先显示，模型就绪后淡入）+ 底部控制条
 *  右：CG 元信息与对应剧情段落
 * 动态 CG 不再播放离线合成的动画 WebP，统一走实时 Spine 模型。
 */
export default function CgView() {
  const { name = '' } = useParams()
  const t = useUI()
  const { lang } = useLang()
  const navigate = useNavigate()
  const [index, setIndex] = useState<CgIndex | null>(null)
  const [units, setUnits] = useState<StoryUnit[]>([])
  const [spine, setSpine] = useState<Set<string>>(new Set())
  const [overrides, setOverrides] = useState<Record<string, SpineOverride>>({})
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(160)
  const [modelReady, setModelReady] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)
  const [status, setStatus] = useState<SpineStatus>(EMPTY)
  const [stillScale, setStillScale] = useState(1)
  const [toast, setToast] = useState<string | null>(null)
  /** 段落原文：展开的链接下标；剧情单元全文按需加载（loadStoryUnit 有缓存，同一章节只拉一次）；
   *  角色表用于说话人名本地化，同样懒加载 */
  const [openLinks, setOpenLinks] = useState<Set<number>>(new Set())
  const [unitText, setUnitText] = useState<Record<number, StoryDetail | null>>({})
  const [chars, setChars] = useState<Character[]>([])
  // 窄屏（≤980px）是抽屉布局：目录/信息默认收起，靠舞台顶部按钮开合；
  // 桌面端维持原来的默认展开
  const [leftOpen, setLeftOpen] = useState(() => !window.matchMedia(NARROW).matches)
  const [rightOpen, setRightOpen] = useState(() => !window.matchMedia(NARROW).matches)
  /** 沉浸全屏：隐藏顶栏与页面其它元素，只留舞台 */
  const immersive = useImmersive()

  const spineRef = useRef<SpineController | null>(null)
  const stillRef = useRef<ImageViewerApi | null>(null)
  const bgRef = useRef<HTMLImageElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const wasPlaying = useRef(false)
  const seeking = useRef(false)

  /**
   * 独立背景图与人物层是一张作品，必须共用同一套取景与变换。
   * 两种显示模式各自推送变换，切换时重新套用当前模式的缓存值。
   */
  const modeRef = useRef<'still' | 'model'>('still')
  const bgStill = useRef<ViewTransform>({ scale: 1, tx: 0, ty: 0 })
  const bgModel = useRef<ViewTransform | null>(null)
  const paintBg = useCallback((t: ViewTransform) => {
    const el = bgRef.current
    if (el) el.style.transform = `translate(${t.tx}px, ${t.ty}px) scale(${t.scale})`
  }, [])
  const onStillView = useCallback((t: ViewTransform) => {
    bgStill.current = t
    if (modeRef.current === 'still') paintBg(t)
  }, [paintBg])
  const onModelView = useCallback((t: ViewTransform) => {
    bgModel.current = t
    if (modeRef.current === 'model') paintBg(t)
  }, [paintBg])

  useEffect(() => {
    loadCgIndex().then(setIndex).catch(() => setIndex({ total: 0, items: [], links: {} }))
    loadStoryIndex().then(setUnits).catch(() => {})
    loadSpineModels().then(setSpine).catch(() => {})
    loadSpineOverrides().then(setOverrides).catch(() => {})
  }, [])

  // 换 CG：模型状态全部归零，静态合成图立刻顶上，等新模型加载完再淡入
  useEffect(() => {
    setModelReady(false)
    setModelError(null)
    setStatus(EMPTY)
    setStillScale(1)
    setToast(null)
    seeking.current = false
    // 窄屏抽屉：切 CG 后自动收起，让新 CG 直接可见
    if (window.matchMedia(NARROW).matches) {
      setLeftOpen(false)
      setRightOpen(false)
    }
  }, [name])

  // 跨越窄屏断点（旋转 / 拖窗口）时恢复该布局的默认开合：
  // 回到桌面时两侧面板展开，回到窄屏时抽屉全部收起
  useEffect(() => {
    const mq = window.matchMedia(NARROW)
    const onChange = () => {
      setLeftOpen(!mq.matches)
      setRightOpen(!mq.matches)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const cur = useMemo(() => index?.items.find((x) => x.n === name) || null, [index, name])
  usePageTitle(cur?.n)
  const isSpine = spine.has(name)
  const useModel = isSpine && modelReady
  const canAnimate = useModel && status.duration > 0
  /** 剧情段落：封面按整集（自身 + 成员）取并集，连图集的封面常常不是剧情里出现的那一帧 */
  const links = useMemo(() => (index ? setLinks(index, name) : []), [index, name])
  /** 出现段落覆盖的剧情文本总句数（各段行数求和），信息栏与段落数并排展示 */
  const totalLines = useMemo(
    () => links.reduce((a, lk) => a + (lk.n || 0), 0),
    [links],
  )

  // ---- 段落原文展开 ----
  // 换 CG 时收起所有展开的段落；已加载的单元全文保留（unitText 跨 CG 复用）
  useEffect(() => {
    setOpenLinks(new Set())
  }, [name])

  /** 说话人名本地化用的角色表（speaker_id / 中文名双索引，StoryReader 同款） */
  const speakerMap = useMemo(() => {
    const m: Record<string, Character> = {}
    for (const c of chars) if (c.speaker) m[c.speaker] = c
    return m
  }, [chars])
  const nameMap = useMemo(() => {
    const m: Record<string, Character> = {}
    for (const c of chars) if (c.names.zh) m[c.names.zh] = c
    return m
  }, [chars])

  /** 首次展开某条段落时拉取它所在的剧情单元全文（+ 角色表）；null = 加载中 */
  const toggleFullText = (k: number, uid: number) => {
    setOpenLinks((s) => {
      const n = new Set(s)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })
    if (uid in unitText) return
    setUnitText((m) => ({ ...m, [uid]: null }))
    Promise.all([loadStoryUnit(uid), loadCharacters()])
      .then(([d, cs]) => {
        setUnitText((m) => ({ ...m, [uid]: d }))
        setChars(cs)
      })
      .catch(() => setUnitText((m) => {
        const c = { ...m }
        delete c[uid] // 失败时回到未加载态，下次展开可重试
        return c
      }))
  }

  modeRef.current = useModel ? 'model' : 'still'

  // 切换显示模式 / 换 CG 时，把背景层恢复到对应模式的取景
  useEffect(() => {
    paintBg(useModel ? (bgModel.current || bgStill.current) : bgStill.current)
  }, [useModel, name, paintBg])

  /**
   * 有些动态 CG 的背景是独立导出的 *_bg.png（不在图集里），只在剧情阅读器里
   * 作为第二层叠上去。CG 查看器补同一个背景层，静态合成图和实时模型共用，
   * 切换时背景不动，不会闪。取材优先级：overrides 显式配置（写 CG 名或直接
   * 写图片 URL）→ 合并收录的独立背景 CG（X 与 X_bg 拆成两条的那种，自动垫底）。
   */
  const bgSrc = useMemo(() => {
    if (!index) return null
    const spec = overrides[name]?.background
    if (spec) {
      if (spec.startsWith('/')) return spec
      const h = index.items.find((x) => x.n === spec)?.h
      return h ? `/img/l/${h}.webp` : null
    }
    const bg = mergedBgOf(index.items, name)
    return bg ? `/img/l/${bg.h}.webp` : null
  }, [overrides, name, index])

  const unitMap = useMemo(() => {
    const m: Record<number, StoryUnit> = {}
    for (const u of units) m[u.id] = u
    return m
  }, [units])

  // 合并收录后的可见 CG：目录、上一张/下一张、计数都基于它，
  // X_bg 与图集贴图页（cg_merges.json）不再作为独立条目出现在浏览序列里
  const pool = useMemo(() => visibleCgs(index?.items || [], index?.merges), [index])

  // 当前 CG 是否是被并入某主 CG 的条目（直接 URL 访问时给出去向提示）
  const absorbedBy = useMemo(() => coverOf(index?.merges, name), [index, name])

  // 当前 CG 所属的集：封面页与成员页都算，没有集则为 null。
  // 有了它，进入集内任意一张后左侧目录能保持展开、右侧能一直看到整集。
  const setCover = useMemo(() => {
    if (!index?.merges) return null
    if (setMembersOf(index.merges, name).length > 0) return name
    return coverOf(index.merges, name)
  }, [index, name])

  // 集内全部条目（含封面），供左侧展开与右侧「相似画集」共用
  const setItems = useMemo(() => {
    if (!index || !setCover) return [] as CgItem[]
    return [setCover, ...setMembersOf(index.merges, setCover)]
      .map((n) => index.items.find((x) => x.n === n))
      .filter((x): x is CgItem => !!x)
  }, [index, setCover])

  // 左侧目录展开时列在封面下面的成员（不含封面本身）
  const setMembers = useMemo(
    () => setItems.filter((x) => x.n !== setCover),
    [setItems, setCover],
  )

  // 浏览锚点：被并入的条目按它所属的封面定位，成员页的上一张/下一张仍可用
  const anchorName = absorbedBy ?? name

  const list = useMemo(() => {
    const k = q.trim().toLowerCase()
    if (!k) return pool
    return pool.filter((it) => it.n.toLowerCase().includes(k) || it.s.toLowerCase().includes(k))
  }, [pool, q])

  const visible = useMemo(() => list.slice(0, limit), [list, limit])
  useEffect(() => setLimit(160), [q])

  /**
   * 把目录滚到当前 CG：只在被遮住时补“最少”的滚动距离，已可见就完全不动。
   * 之前写成「取能容纳整组的偏移量」，效果是把选中项底边对齐到面板底部——
   * 用户手动滚过列表后再点条目，选中项会突然掉到最下方。
   * 所在集整组放得下时以整组为目标（让展开的成员一起可见），
   * 整组比视口还高时只保证当前项本身可见。
   */
  const scrollDirToCurrent = useCallback(() => {
    const box = listRef.current
    const on = box?.querySelector<HTMLElement>('.cv-dir-item.on')
    if (!box || !on) return
    const sub = on.closest('.cv-dir-sub') as HTMLElement | null
    // 当前项是封面时，展开的成员组是它的下一个兄弟节点
    const next = on.nextElementSibling as HTMLElement | null
    const group = sub ?? (next?.classList.contains('cv-dir-sub') ? next : null)
    const cover = (sub ? (sub.previousElementSibling as HTMLElement | null) : null) ?? on
    const last = (group?.lastElementChild as HTMLElement | null) ?? on
    const boxRect = box.getBoundingClientRect()
    const rel = (el: HTMLElement) => {
      const r = el.getBoundingClientRect()
      return {
        top: r.top - boxRect.top + box.scrollTop,
        bottom: r.bottom - boxRect.top + box.scrollTop,
      }
    }
    const g = rel(cover)
    const gBottom = rel(last).bottom
    const PAD = 8
    const fits = gBottom - g.top <= box.clientHeight - PAD * 2
    const targetTop = fits ? g.top : rel(on).top
    const targetBottom = fits ? gBottom : rel(on).bottom
    const viewTop = box.scrollTop
    const viewBottom = viewTop + box.clientHeight
    if (targetTop < viewTop + PAD) {
      box.scrollTop = Math.max(0, targetTop - PAD)
    } else if (targetBottom > viewBottom - PAD) {
      box.scrollTop = targetBottom - box.clientHeight + PAD
    }
  }, [])

  // 切换 CG 后把目录里的当前项（含所在集）滚进可视区
  useEffect(() => {
    scrollDirToCurrent()
  }, [name, visible, scrollDirToCurrent])

  // 窄屏抽屉是滑入的：打开时目录刚从屏幕外回来，需要重新定位
  useEffect(() => {
    if (!leftOpen) return
    scrollDirToCurrent()
  }, [leftOpen, scrollDirToCurrent])

  const go = useCallback((delta: number) => {
    const i = pool.findIndex((x) => x.n === anchorName)
    const next = pool[i + delta]
    if (next) navigate(`/cg/${encodeURIComponent(next.n)}`)
  }, [pool, anchorName, navigate])

  const togglePlay = useCallback(() => {
    if (!isSpine || !modelReady) return
    spineRef.current?.toggle()
  }, [isSpine, modelReady])

  const resetView = useCallback(() => {
    if (useModel) spineRef.current?.resetView()
    else stillRef.current?.reset()
  }, [useModel])

  const saveFrame = useCallback(() => {
    const suffix = useModel ? status.time.toFixed(2) : 'still'
    const filename = `${name}_${suffix}.png`
    if (useModel) spineRef.current?.saveFrame(filename)
    else stillRef.current?.saveFrame(filename)
    setToast(fmt(t('cg_saved'), { n: filename }))
    window.setTimeout(() => setToast(null), 2200)
  }, [useModel, status.time, name, t])

  // 全局快捷键：空格播放/暂停，←/→ 换图，R 复位，S 保存帧，ESC 回图鉴
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const tag = t?.tagName
      // 只让文本输入/下拉/可编辑区域自己处理按键。
      // range 必须放行：拖过时间轴后焦点会留在滑块上，若在这里 return，
      // 空格会被浏览器默认行为吃掉（还会画出 focus 外框），播放/暂停就失效了。
      const typing = t?.isContentEditable || tag === 'SELECT' || tag === 'TEXTAREA'
        || (tag === 'INPUT' && (t as HTMLInputElement).type !== 'range')
      if (typing) return
      if (immersive.active) return // 全屏时 ESC 只负责退出全屏（见 useImmersive）
      if (e.code === 'Space') { e.preventDefault(); togglePlay() }
      else if (e.key === 'Escape') navigate('/cg')
      else if (e.key === 'ArrowRight' && tag !== 'INPUT') go(1)
      else if (e.key === 'ArrowLeft' && tag !== 'INPUT') go(-1)
      else if (e.key === 'r' || e.key === 'R') resetView()
      else if (e.key === 's' || e.key === 'S') saveFrame()
      else if (e.key === '[') setLeftOpen((v) => !v)
      else if (e.key === ']') setRightOpen((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, navigate, go, resetView, saveFrame, immersive.active])

  const onSeekStart = () => {
    if (!canAnimate) return
    wasPlaying.current = status.playing
    seeking.current = true
    spineRef.current?.pause()
  }
  const onSeekEnd = () => {
    if (!seeking.current) return
    seeking.current = false
    if (wasPlaying.current) spineRef.current?.play()
    // 鼠标拖动结束就交还焦点，避免滑块一直带着 focus 外框
    if (document.activeElement instanceof HTMLInputElement
      && document.activeElement.type === 'range') document.activeElement.blur()
  }
  const onSeek = (v: number) => {
    setStatus((s) => ({ ...s, time: v }))
    spineRef.current?.seek(v)
  }

  if (!index) return <div className="loading">LOADING…</div>
  if (!cur) {
    return (
      <div className="cv-404">
        <div className="idx">404 / CG</div>
        <h2>{t('cgview_none')}</h2>
        <p>{name}</p>
        <Link to="/cg" className="btn primary">{t('cg_back')}</Link>
      </div>
    )
  }

  const zoomText = `${(useModel ? status.zoom : stillScale).toFixed(1)}×`
  const i = pool.findIndex((x) => x.n === anchorName)
  const pct = status.duration > 0
    ? Math.max(0, Math.min(100, status.time / status.duration * 100)) : 0

  /** 剧情段落归属行：单元标题按内容语言取官方翻译（whereOf 的本地化版），缺失回退中文 */
  const whereText = (u: StoryUnit | undefined, uid: number): string => {
    if (!u) return fmt(t('search_unit'), { n: uid })
    const base = (u.title || '').trim()
    // 只把真正的 snake_case slug（event_stt_xxx）当占位标题；
    // 不能带 i 标志，否则 SNOWFALL 这类全大写官方名会被误判回退成分类名
    if (!base || base === u.bucket || /^[a-z0-9_]+$/.test(base)) return u.label
    return pickLang(lang, base, u.titles?.en, u.titles?.ko, u.titles?.ja)
  }
  /** 信息栏副行：主 CG 的「第 N 章」按内容语言显示，活动键等原文保留 */
  const subS = cur.s && /^第(\d+)章$/.test(cur.s)
    ? fmt(t('cv_s_chapter'), { n: Number(/^第(\d+)章$/.exec(cur.s)![1]) })
    : cur.s

  return (
    <div className={`cv-shell ${leftOpen ? '' : 'cv-left-off'} ${rightOpen ? '' : 'cv-right-off'}`}>
      {immersive.active && <ImmersiveExitButton onClick={immersive.exit} />}
      {/* 窄屏抽屉遮罩：任一抽屉展开时盖住舞台，点它收起（桌面恒隐藏） */}
      <div
        className="cv-drawer-backdrop"
        onClick={() => { setLeftOpen(false); setRightOpen(false) }}
        aria-hidden="true"
      />
      {/* ---------- 左：目录 ---------- */}
      <aside className="cv-dir">
        <div className="cv-dir-head">
          <Link to="/cg" className="cv-back">{t('cg_back')}</Link>
          <span className="cv-dir-count">{nf(list.length)} / {nf(pool.length)}</span>
          <button
            className="cv-drawer-close"
            onClick={() => setLeftOpen(false)}
            aria-label={t('cg_toc_collapse')}
            title={t('cg_toc_collapse')}
          >×</button>
        </div>
        <div className="cv-search-wrap">
          <input
            className="cv-search"
            placeholder={t('cg_search_ph')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && <button className="cv-search-x" onClick={() => setQ('')} aria-label={t('common_clear')}>×</button>}
        </div>
        <div className="cv-dir-list" ref={listRef}>
          {visible.map((it) => {
            // 当前所在的集在目录里展开：封面行下面列出成员，点哪个就在集内切到哪张，
            // 集上下文（左侧展开 + 右侧相似画集）始终保留
            const expanded = setCover === it.n && setMembers.length > 0
            // 所有集封面都标张数，方便在列表里认出哪些是合集（展开只针对当前集）
            const mergedCount = index?.merges?.[it.n]
            const setSize = Array.isArray(mergedCount) ? mergedCount.length + 1 : 0
            return (
              <Fragment key={it.h}>
                <button
                  className={`cv-dir-item ${it.n === name ? 'on' : ''}`}
                  title={it.n}
                  onClick={() => navigate(`/cg/${encodeURIComponent(it.n)}`)}
                >
                  <img src={`/img/s/${it.h}.webp`} alt="" loading="lazy" />
                  <span className="cv-dir-name">{it.n}</span>
                  {setSize > 0 && <span className="cv-dir-set">{setSize}</span>}
                  {spine.has(it.n) && <span className="cv-dir-dyn">{t('cg_badge_anim')}</span>}
                </button>
                {expanded && (
                  <div className="cv-dir-sub">
                    {setMembers.map((m) => (
                      <button
                        key={m.h}
                        className={`cv-dir-item cv-dir-subitem ${m.n === name ? 'on' : ''}`}
                        title={m.n}
                        onClick={() => navigate(`/cg/${encodeURIComponent(m.n)}`)}
                      >
                        <img src={`/img/s/${m.h}.webp`} alt="" loading="lazy" />
                        <span className="cv-dir-name">{m.n}</span>
                      </button>
                    ))}
                  </div>
                )}
              </Fragment>
            )
          })}
          {list.length > limit && (
            <button className="cv-more" onClick={() => setLimit((v) => v + 160)}>
              {fmt(t('cg_load_more'), { n: nf(list.length - limit) })}
            </button>
          )}
          {list.length === 0 && <div className="cv-dir-empty">{t('cg_none')}</div>}
        </div>
      </aside>

      {/* ---------- 中：查看区 + 控制条 ---------- */}
      <main className="cv-main">
        <div className="cv-stage">
          {bgSrc && <div className="cv-bg"><img ref={bgRef} src={bgSrc} alt="" /></div>}
          {/* 静态合成图：永远先显示；模型就绪后淡出但保持挂载，方便随时切回 */}
          <div className={`cv-layer cv-still ${useModel ? 'behind' : ''}`}>
            <ImageViewer
              src={`/img/l/${cur.h}.webp`}
              alt={cur.n}
              bar={false}
              backgroundSrc={bgSrc || undefined}
              apiRef={stillRef}
              onScaleChange={setStillScale}
              onTransform={onStillView}
            />
          </div>

          {isSpine && (
            <div className={`cv-layer cv-model ${useModel ? 'on' : ''}`}>
              <SpinePlayer
                name={name}
                controls={false}
                backgroundSrc={bgSrc || undefined}
                controllerRef={spineRef}
                onReady={() => setModelReady(true)}
                onTick={setStatus}
                onView={onModelView}
                onError={setModelError}
              />
            </div>
          )}

          <div className="cv-stage-top">
            <div className="cv-top-group">
              <button
                className="cv-panel-toggle"
                onClick={() => setLeftOpen((v) => !v)}
                title={leftOpen ? t('cg_toc_collapse') : t('cg_toc_expand')}
              >
                {leftOpen ? '‹' : '›'} {t('reader_toc')}
              </button>
              <span className={`cv-badge ${useModel ? 'live' : ''}`}>
                {useModel ? `◉ ${t('cg_live_model')}` : isSpine ? t('cg_static_composite') : t('cg_static')}
              </span>
            </div>
            <div className="cv-top-group">
              <span className="cv-stage-idx">{i + 1} / {nf(pool.length)}</span>
              <button
                className="cv-panel-toggle"
                onClick={() => setRightOpen((v) => !v)}
                title={rightOpen ? t('cg_info_collapse') : t('cg_info_expand')}
              >
                {t('cg_info')} {rightOpen ? '›' : '‹'}
              </button>
            </div>
          </div>

          {isSpine && !modelReady && !modelError && (
            <div className="cv-loading"><span className="cv-spin" />{t('cgview_loading')}</div>
          )}
          {modelError && (
            <div className="cv-error">{t('cg_model_error')} · {modelError}</div>
          )}
          {toast && <div className="cv-toast">{toast}</div>}
          <div className="cv-hint">{t('cgview_sc_zoom')}</div>
        </div>

        <div className="cv-controls">
          <div className="cv-timeline">
            <button
              className="cv-play"
              onClick={togglePlay}
              disabled={!isSpine || !modelReady}
              title={t('voice_play_pause')}
            >
              <PlayPauseIcon playing={canAnimate && status.playing} size="15" />
            </button>
            <span className="cv-time">{fmtTime(status.time)}</span>
            <input
              className="cv-seek"
              type="range"
              min={0}
              max={status.duration || 1}
              step={0.01}
              value={Math.min(status.time, status.duration || 1)}
              disabled={!canAnimate}
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

          <div className="cv-buttons">
            <label className="cv-field">
              {t('cv_speed')}
              <select
                value={status.speed}
                disabled={!canAnimate}
                onChange={(e) => spineRef.current?.setSpeed(Number(e.target.value))}
              >
                {SPEEDS.map((v) => <option key={v} value={v}>{v.toFixed(2)}×</option>)}
              </select>
            </label>
            {status.anims.length > 1 && (
              <label className="cv-field">
                {t('cv_anim')}
                <select
                  value={status.anim}
                  disabled={!canAnimate}
                  onChange={(e) => spineRef.current?.setAnim(e.target.value)}
                >
                  {status.anims.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </label>
            )}
            <button className="cv-btn" onClick={resetView} title={t('cg_zoom_reset')}>
              ⟲ {t('cv_zoom')} <b>{zoomText}</b>
            </button>
            <button className="cv-btn" onClick={saveFrame} title={t('cg_save_frame')}>
              {t('cg_save_frame_btn')}
            </button>
            <button className="cv-btn" onClick={immersive.toggle} title={t('cg_fullscreen')}>
              <ExpandIcon />
            </button>
          </div>
        </div>
      </main>

      {/* ---------- 右：信息与剧情段落 ---------- */}
      <aside className="cv-info">
        <div className="cv-info-head">
          <button
            className="cv-drawer-close"
            onClick={() => setRightOpen(false)}
            aria-label={t('cg_info_collapse')}
            title={t('cg_info_collapse')}
          >×</button>
          <div className="cv-kicker">CG / {CV_CAT_KEY[cur.c] ? t(CV_CAT_KEY[cur.c]) : cur.c.replace(/^\d+_/, '')}</div>
          <h1 className="cv-title">{cur.n}</h1>
          <div className="cv-sub">
            {subS ? `${subS} · ` : ''}{cur.w}×{cur.h2}
          </div>
          <div className="cv-tags">
            <span className={`cv-tag ${isSpine ? 'live' : ''}`}>
              {isSpine ? t('cg_live_model') : t('cg_static_illust')}
            </span>
            <span className="cv-tag">{fmt(t('cg_links_n'), { n: links.length })}</span>
            <span className="cv-tag">{fmt(t('cg_text_lines'), { m: totalLines })}</span>
          </div>
          {absorbedBy && (
            <div className="cv-absorbed">
              {t('cg_absorbed')}{' '}
              <Link to={`/cg/${encodeURIComponent(absorbedBy)}`}>{absorbedBy}</Link>
            </div>
          )}
        </div>

        <div className="cv-nav-btns">
          <button disabled={i <= 0} onClick={() => go(-1)}>{t('cg_prev')}</button>
          <button disabled={i < 0 || i >= pool.length - 1} onClick={() => go(1)}>{t('cgview_next')}</button>
        </div>

        {/* 相似画集：连图/分层拆成的多条 CG 已并入同一集，封面与成员都在这里，
            点任意一张在集内切换（左侧目录保持展开，回封面点标着「封面」的那张） */}
        {setItems.length > 1 && (
          <section className="cv-set">
            <h2>{fmt(t('cg_set_title'), { n: setItems.length })}</h2>
            <div className="cv-set-grid">
              {setItems.map((m) => (
                <Link
                  key={m.n}
                  className={`cv-set-item ${m.n === name ? 'on' : ''}`}
                  to={`/cg/${encodeURIComponent(m.n)}`}
                  title={m.n}
                  aria-current={m.n === name ? 'page' : undefined}
                >
                  <img src={`/img/s/${m.h}.webp`} alt={m.n} loading="lazy" />
                  {m.n === setCover && <span className="cv-set-cover">{t('cg_badge_cover')}</span>}
                  <span className="cv-set-name">{m.n}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="cv-links">
          <h2>{fmt(t('cg_links_title'), { n: links.length })}</h2>
          {links.length > 0 ? (
            links.map((lk, k) => {
              const u = unitMap[lk.u]
              const speaker = lk.s ? pickLang(lang, lk.s, lk.s4?.en, lk.s4?.ko, lk.s4?.ja) : ''
              const text = pickLang(lang, lk.t, lk.l4?.en, lk.l4?.ko, lk.l4?.ja)
              const sect = lk.p ? pickLang(lang, lk.p, lk.p4?.en, lk.p4?.ko, lk.p4?.ja) : ''
              const open = openLinks.has(k)
              const detail = unitText[lk.u]
              return (
                <div key={k} className={`cv-link-wrap ${open ? 'open' : ''}`}>
                  <div className="cv-link-row">
                    <Link className="cv-link" to={`/story/${lk.u}?line=${lk.i}`}>
                      <span className="cv-link-where">
                        {whereText(u, lk.u)}{sect ? ` · ${sect}` : ''}
                      </span>
                      <span className="cv-link-text">
                        {speaker && <b>{speaker}：</b>}{text}
                        {lk.n ? <span className="cv-link-n">{fmt(t('cg_link_n'), { n: lk.n })}</span> : null}
                      </span>
                    </Link>
                    {/* 右侧开关：展开该段原文（首次展开时按需拉取单元 JSON）；条目本体仍是阅读器跳转链接 */}
                    <button
                      type="button"
                      className="cv-link-toggle"
                      onClick={() => toggleFullText(k, lk.u)}
                      aria-expanded={open}
                      title={open ? t('cg_link_collapse') : t('cg_link_expand')}
                    >{open ? '▾' : '▸'}</button>
                  </div>
                  {open && (
                    <div className="cv-link-full">
                      {detail == null ? (
                        <span className="cv-link-loading">{t('common_loading')}</span>
                      ) : paragraphLines(detail, lk.i, lk.n || 0).map(([sp, spid, zh, en, ko, ja], x) => (
                        <p key={x} className={spid === 'Choice' ? 'choice' : ''}>
                          <b>{speakerDisplay(lang, sp, spid, speakerMap, nameMap)}</b>
                          {pickLang(lang, zh, en, ko, ja)}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )
            })
          ) : (
            <div className="cv-links-empty">{t('cgview_no_lines')}</div>
          )}
        </section>

        <div className="cv-keys">
          <b>{t('cgview_shortcuts')}</b>
          <span>{t('cgview_sc_play')}</span>
          <span>{t('cg_sc_footer1')}</span>
          <span>{t('cg_sc_footer2')}</span>
        </div>
      </aside>
    </div>
  )
}
