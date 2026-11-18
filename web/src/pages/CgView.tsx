import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import ImageViewer, { type ImageViewerApi } from '../components/ImageViewer'
import PlayPauseIcon from '../components/PlayPauseIcon'
import { useImmersive, ExpandIcon, ImmersiveExitButton } from '../components/Immersive'
import { usePageTitle } from '../usePageTitle'
import SpinePlayer, { type SpineController, type SpineStatus } from '../components/SpinePlayer'
import {
  coverOf, loadCgIndex, loadSpineModels, loadSpineOverrides, loadStoryIndex, mergedBgOf, nf,
  setLinks, setMembersOf, visibleCgs, whereOf,
  type CgIndex, type CgItem, type SpineOverride, type StoryUnit, type ViewTransform,
} from '../data'

const EMPTY: SpineStatus = {
  ready: false, playing: true, time: 0, duration: 0, speed: 1, zoom: 1, anim: '', anims: [],
}
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]
/** 窄屏断点：与 index.css 里 CG 查看器的抽屉布局断点保持一致 */
const NARROW = '(max-width: 980px)'

function fmtTime(t: number): string {
  if (!Number.isFinite(t) || t < 0) return '0:00.0'
  const m = Math.floor(t / 60)
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`
}

/**
 * CG 二级查看页
 *  左：CG 目录（文件名 + 搜索）  中：查看区（静态合成先显示，模型就绪后淡入）+ 底部控制条
 *  右：CG 元信息与对应剧情段落
 * 动态 CG 不再播放离线合成的动画 WebP，统一走实时 Spine 模型。
 */
export default function CgView() {
  const { name = '' } = useParams()
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
    setToast(`已保存 ${filename}`)
    window.setTimeout(() => setToast(null), 2200)
  }, [useModel, status.time, name])

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
        <h2>找不到这张 CG</h2>
        <p>{name}</p>
        <Link to="/cg" className="btn primary">← 返回 CG 图鉴</Link>
      </div>
    )
  }

  const zoomText = `${(useModel ? status.zoom : stillScale).toFixed(1)}×`
  const i = pool.findIndex((x) => x.n === anchorName)
  const pct = status.duration > 0
    ? Math.max(0, Math.min(100, status.time / status.duration * 100)) : 0

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
          <Link to="/cg" className="cv-back">← CG 图鉴</Link>
          <span className="cv-dir-count">{nf(list.length)} / {nf(pool.length)}</span>
          <button
            className="cv-drawer-close"
            onClick={() => setLeftOpen(false)}
            aria-label="收起目录"
            title="收起目录"
          >×</button>
        </div>
        <div className="cv-search-wrap">
          <input
            className="cv-search"
            placeholder="搜索 CG 文件名 / 活动键"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && <button className="cv-search-x" onClick={() => setQ('')} aria-label="清空">×</button>}
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
                  {spine.has(it.n) && <span className="cv-dir-dyn">动</span>}
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
              加载更多（还有 {nf(list.length - limit)} 张）
            </button>
          )}
          {list.length === 0 && <div className="cv-dir-empty">没有匹配的 CG</div>}
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
                title={leftOpen ? '收起目录（[）' : '展开目录（[）'}
              >
                {leftOpen ? '‹' : '›'} 目录
              </button>
              <span className={`cv-badge ${useModel ? 'live' : ''}`}>
                {useModel ? '◉ 实时模型' : isSpine ? '静态合成' : '静态 CG'}
              </span>
            </div>
            <div className="cv-top-group">
              <span className="cv-stage-idx">{i + 1} / {nf(pool.length)}</span>
              <button
                className="cv-panel-toggle"
                onClick={() => setRightOpen((v) => !v)}
                title={rightOpen ? '收起信息（]）' : '展开信息（]）'}
              >
                信息 {rightOpen ? '›' : '‹'}
              </button>
            </div>
          </div>

          {isSpine && !modelReady && !modelError && (
            <div className="cv-loading"><span className="cv-spin" />实时模型加载中…</div>
          )}
          {modelError && (
            <div className="cv-error">模型加载失败，已保留静态合成图 · {modelError}</div>
          )}
          {toast && <div className="cv-toast">{toast}</div>}
          <div className="cv-hint">滚轮 / 双指捏合缩放 · 拖拽平移 · 双击复位</div>
        </div>

        <div className="cv-controls">
          <div className="cv-timeline">
            <button
              className="cv-play"
              onClick={togglePlay}
              disabled={!isSpine || !modelReady}
              title="播放 / 暂停（空格）"
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
              aria-label="动画时间轴"
            />
            <span className="cv-time dim">{fmtTime(status.duration)}</span>
          </div>

          <div className="cv-buttons">
            <label className="cv-field">
              速度
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
                动画
                <select
                  value={status.anim}
                  disabled={!canAnimate}
                  onChange={(e) => spineRef.current?.setAnim(e.target.value)}
                >
                  {status.anims.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </label>
            )}
            <button className="cv-btn" onClick={resetView} title="缩放复位（R）">
              ⟲ 缩放重置 <b>{zoomText}</b>
            </button>
            <button className="cv-btn" onClick={saveFrame} title="保存当前帧为 PNG（S）">
              ⤓ 保存当前帧
            </button>
            <button className="cv-btn" onClick={immersive.toggle} title="全屏查看（Esc 退出）">
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
            aria-label="收起信息"
            title="收起信息"
          >×</button>
          <div className="cv-kicker">CG / {cur.c.replace(/^\d+_/, '')}</div>
          <h1 className="cv-title">{cur.n}</h1>
          <div className="cv-sub">
            {cur.s ? `${cur.s} · ` : ''}{cur.w}×{cur.h2}
          </div>
          <div className="cv-tags">
            <span className={`cv-tag ${isSpine ? 'live' : ''}`}>
              {isSpine ? '实时模型' : '静态插画'}
            </span>
            <span className="cv-tag">{links.length} 处剧情</span>
          </div>
          {absorbedBy && (
            <div className="cv-absorbed">
              本图已并入{' '}
              <Link to={`/cg/${encodeURIComponent(absorbedBy)}`}>{absorbedBy}</Link>
            </div>
          )}
        </div>

        <div className="cv-nav-btns">
          <button disabled={i <= 0} onClick={() => go(-1)}>‹ 上一张</button>
          <button disabled={i < 0 || i >= pool.length - 1} onClick={() => go(1)}>下一张 ›</button>
        </div>

        {/* 相似画集：连图/分层拆成的多条 CG 已并入同一集，封面与成员都在这里，
            点任意一张在集内切换（左侧目录保持展开，回封面点标着「封面」的那张） */}
        {setItems.length > 1 && (
          <section className="cv-set">
            <h2>相似画集（{setItems.length} 张）</h2>
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
                  {m.n === setCover && <span className="cv-set-cover">封面</span>}
                  <span className="cv-set-name">{m.n}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="cv-links">
          <h2>对应剧情段落（{links.length}）</h2>
          {links.length > 0 ? (
            links.map((lk, k) => {
              const u = unitMap[lk.u]
              return (
                <Link key={k} className="cv-link" to={`/story/${lk.u}?line=${lk.i}`}>
                  <span className="cv-link-where">
                    {whereOf(u, lk.u)}{lk.p ? ` · ${lk.p}` : ''}
                  </span>
                  <span className="cv-link-text">
                    {lk.s && <b>{lk.s}：</b>}{lk.t}
                    {lk.n ? <span className="cv-link-n">共 {lk.n} 句</span> : null}
                  </span>
                  <span className="cv-link-go">→</span>
                </Link>
              )
            })
          ) : (
            <div className="cv-links-empty">这张 CG 没有对应的台词记录</div>
          )}
        </section>

        <div className="cv-keys">
          <b>快捷键</b>
          <span>空格 播放/暂停 · ←/→ 换图</span>
          <span>R 缩放复位 · S 保存当前帧 · ESC 返回</span>
          <span>[ 收起/展开目录 · ] 收起/展开信息</span>
        </div>
      </aside>
    </div>
  )
}
