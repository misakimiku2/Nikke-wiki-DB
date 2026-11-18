import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import ImageViewer, { type ImageViewerApi } from '../components/ImageViewer'
import PlayPauseIcon from '../components/PlayPauseIcon'
import { useImmersive, ExpandIcon, ImmersiveExitButton } from '../components/Immersive'
import { usePageTitle } from '../usePageTitle'
import SpinePlayer, { type SpineController, type SpineStatus } from '../components/SpinePlayer'
import {
  loadCgIndex, loadSpineModels, loadSpineOverrides, loadStoryIndex, nf, whereOf,
  type CgIndex, type SpineOverride, type StoryUnit, type ViewTransform,
} from '../data'

const EMPTY: SpineStatus = {
  ready: false, playing: true, time: 0, duration: 0, speed: 1, zoom: 1, anim: '', anims: [],
}
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]

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
  const [showModel, setShowModel] = useState(true)
  const [status, setStatus] = useState<SpineStatus>(EMPTY)
  const [stillScale, setStillScale] = useState(1)
  const [toast, setToast] = useState<string | null>(null)
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
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
    setShowModel(true)
    setStatus(EMPTY)
    setStillScale(1)
    setToast(null)
    seeking.current = false
  }, [name])

  const cur = useMemo(() => index?.items.find((x) => x.n === name) || null, [index, name])
  usePageTitle(cur?.n)
  const isSpine = spine.has(name)
  const useModel = isSpine && modelReady && showModel
  const canAnimate = useModel && status.duration > 0
  const links = index?.links[name] || []
  modeRef.current = useModel ? 'model' : 'still'

  // 切换显示模式 / 换 CG 时，把背景层恢复到对应模式的取景
  useEffect(() => {
    paintBg(useModel ? (bgModel.current || bgStill.current) : bgStill.current)
  }, [useModel, name, paintBg])

  /**
   * 有些动态 CG 的背景是独立导出的 *_bg.png（不在图集里），只在剧情阅读器里
   * 作为第二层叠上去。CG 查看器补同一个背景层，静态合成图和实时模型共用，
   * 切换时背景不动，不会闪。配置支持写 CG 名或直接写图片 URL。
   */
  const bgSrc = useMemo(() => {
    const spec = overrides[name]?.background
    if (!spec || !index) return null
    if (spec.startsWith('/')) return spec
    const h = index.items.find((x) => x.n === spec)?.h
    return h ? `/img/l/${h}.webp` : null
  }, [overrides, name, index])

  const unitMap = useMemo(() => {
    const m: Record<number, StoryUnit> = {}
    for (const u of units) m[u.id] = u
    return m
  }, [units])

  const list = useMemo(() => {
    const items = index?.items || []
    const k = q.trim().toLowerCase()
    if (!k) return items
    return items.filter((it) => it.n.toLowerCase().includes(k) || it.s.toLowerCase().includes(k))
  }, [index, q])

  const visible = useMemo(() => list.slice(0, limit), [list, limit])
  useEffect(() => setLimit(160), [q])

  // 切换 CG 后把目录里的当前项滚进可视区
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('.cv-dir-item.on')
    el?.scrollIntoView({ block: 'nearest' })
  }, [name, visible])

  const go = useCallback((delta: number) => {
    if (!index) return
    const i = index.items.findIndex((x) => x.n === name)
    const next = index.items[i + delta]
    if (next) navigate(`/cg/${encodeURIComponent(next.n)}`)
  }, [index, name, navigate])

  const togglePlay = useCallback(() => {
    if (!isSpine || !modelReady) return
    if (!showModel) { setShowModel(true); return }
    spineRef.current?.toggle()
  }, [isSpine, modelReady, showModel])

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
  const i = index.items.findIndex((x) => x.n === name)
  const pct = status.duration > 0
    ? Math.max(0, Math.min(100, status.time / status.duration * 100)) : 0

  return (
    <div className={`cv-shell ${leftOpen ? '' : 'cv-left-off'} ${rightOpen ? '' : 'cv-right-off'}`}>
      {immersive.active && <ImmersiveExitButton onClick={immersive.exit} />}
      {/* ---------- 左：目录 ---------- */}
      <aside className="cv-dir">
        <div className="cv-dir-head">
          <Link to="/cg" className="cv-back">← CG 图鉴</Link>
          <span className="cv-dir-count">{nf(list.length)} / {nf(index.total)}</span>
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
          {visible.map((it) => (
            <button
              key={it.h}
              className={`cv-dir-item ${it.n === name ? 'on' : ''}`}
              title={it.n}
              onClick={() => navigate(`/cg/${encodeURIComponent(it.n)}`)}
            >
              <img src={`/img/s/${it.h}.webp`} alt="" loading="lazy" />
              <span className="cv-dir-name">{it.n}</span>
              {spine.has(it.n) && <span className="cv-dir-dyn">动</span>}
            </button>
          ))}
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
              <span className="cv-stage-idx">{i + 1} / {nf(index.total)}</span>
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
            {isSpine && modelReady && (
              <button className="cv-btn" onClick={() => setShowModel((v) => !v)}>
                {showModel ? '▣ 看静态合成' : '▶ 看实时模型'}
              </button>
            )}
            <button className="cv-btn" onClick={immersive.toggle} title="全屏查看（Esc 退出）">
              <ExpandIcon />
            </button>
          </div>
        </div>
      </main>

      {/* ---------- 右：信息与剧情段落 ---------- */}
      <aside className="cv-info">
        <div className="cv-info-head">
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
        </div>

        <div className="cv-nav-btns">
          <button disabled={i <= 0} onClick={() => go(-1)}>‹ 上一张</button>
          <button disabled={i < 0 || i >= index.total - 1} onClick={() => go(1)}>下一张 ›</button>
        </div>

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
