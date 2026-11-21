import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  loadCgIndex, loadSpineModels, loadStoryIndex, nf, visibleCgs,
  type CgIndex, type CgItem, type StoryUnit,
} from '../data'
import SpinePlayer, { type SpineController, type SpineStatus } from '../components/SpinePlayer'

type Crop = { cx: number; cy: number; zoom: number }
type Edit = string | { h: string; crop?: Crop }
type Picked = { h: string; crop: Crop | null }
type Toast = { text: string; bad?: boolean }
type CoverSource = { w: number; h: number; name: string }

const ASPECT = 3 / 4
const UI_STATE_KEY = 'nikke:story-covers:ui'
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
/** 统一「自动取景」的两种写法（纯 hash / {h}）再比较，避免刚选中就误判为未保存 */
const canonEdit = (e: Edit | null | undefined) =>
  !e ? null : typeof e === 'string' ? { h: e, crop: null } : { h: e.h, crop: e.crop || null }

/** 与 build/build_story_covers.py 的 manual_crop 同款：3:4 的最小外接窗口 + 缩放 */
function cropWindow(w: number, h: number, c: Crop) {
  let cw = w
  let ch = w / ASPECT
  if (ch > h) {
    ch = h
    cw = h * ASPECT
  }
  cw /= c.zoom
  ch /= c.zoom
  const x = clamp(c.cx * w - cw / 2, 0, Math.max(0, w - cw))
  const y = clamp(c.cy * h - ch / 2, 0, Math.max(0, h - ch))
  return { x, y, cw, ch }
}

/**
 * 剧情卡封面编辑后台（开发期；路由只在 dev 注册，生产构建没有）。
 *
 * 选 CG：默认列出该单元在剧情里实际出现过的 CG（cg_index.links），
 *        也可切到「全库」按名字搜索。
 * 裁剪：在 3:4 预览框里拖动决定中心点、滑块控制缩放；只把 {h, crop}
 *       写进 build/cg_cover_overrides.json，由 build_story_covers.py
 *       从 manifest 已有的原图现裁出 public/cover/<hash>.webp——
 *       不新增任何尺寸的 CG 图片。
 */
export default function StoryCovers() {
  const [idx, setIdx] = useState<StoryUnit[]>([])
  const [cg, setCg] = useState<CgIndex | null>(null)
  const [sources, setSources] = useState<Record<string, CoverSource>>({})
  const [extUrl, setExtUrl] = useState('')
  const [extName, setExtName] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
  // 不在 cg_index / 外部清单里的封面（frame_* / *_cover），尺寸从预览图本身读
  const [loadedDims, setLoadedDims] = useState<{ h: string; w: number; h2: number } | null>(null)
  // 只要动过封面（选图 / 上传 / 裁剪 / 取景模式 / 时间轴）就允许保存，
  // 不能只靠 hash + crop 比较：动态 CG 换帧时 hash 根本不变。
  const [touched, setTouched] = useState(false)
  const [spine, setSpine] = useState<Set<string>>(new Set())
  const [modelName, setModelName] = useState<string | null>(null)
  const [spineStatus, setSpineStatus] = useState<SpineStatus | null>(null)
  const spineRef = useRef<SpineController | null>(null)
  const [edits, setEdits] = useState<Record<string, Edit>>({})
  const [apiOk, setApiOk] = useState(false)
  const [selId, setSelId] = useState<number | null>(null)
  const [picked, setPicked] = useState<Picked | null>(null)
  const [scope, setScope] = useState<'linked' | 'all'>('linked')
  const [q, setQ] = useState('')
  const [unitQ, setUnitQ] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)
  // 保存成功后由我们主动 reload；此时要放行 beforeunload，否则会弹「重新加载站点?」
  const suppressLeaveGuard = useRef(false)
  const dragRef = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const showToast = useCallback((text: string, bad = false) => {
    setToast({ text, bad })
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), bad ? 6000 : 3400)
  }, [])

  // 选中单元时把派生状态一并算好；显式传快照，供首次加载/保存后恢复时复用
  const applyUnit = useCallback((
    u: StoryUnit, editsSnap: Record<string, Edit>,
  ) => {
    setSelId(u.id)
    setTouched(false)
    const e = editsSnap[String(u.id)]
    // 动态 CG 抓帧封面在这里按静态图展示：动画自带随时间变化的 autoZoom，
    // 自动重播会让预览和已保存的那一帧对不上。要换帧再手动点 ▶ 模型。
    setModelName(null)
    if (typeof e === 'string') setPicked({ h: e, crop: null })
    else if (e && typeof e === 'object' && e.h) setPicked({ h: e.h, crop: e.crop || null })
    // 没有人工指定时，也把当前封面载入预览，方便直接对它重新裁剪
    else if (u.cover) setPicked({ h: u.cover, crop: null })
    else setPicked(null)
  }, [])

  useEffect(() => {
    let alive = true
    let saved: {
      scrollTop?: number; selId?: number; scope?: string; q?: string; unitQ?: string
    } | null = null
    try { saved = JSON.parse(sessionStorage.getItem(UI_STATE_KEY) || 'null') } catch { /* ignore */ }

    Promise.all([
      loadStoryIndex().catch(() => [] as StoryUnit[]),
      loadCgIndex().catch(() => null),
      loadSpineModels().catch(() => new Set<string>()),
      fetch('/data/cover_sources.json')
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({} as Record<string, CoverSource>)),
      fetch('/api/cover-edits')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('no api'))))
        .then((m: { edits?: Record<string, Edit> }) => ({ edits: m.edits || {}, ok: true }))
        .catch(() => ({ edits: {} as Record<string, Edit>, ok: false })),
    ]).then(([units, c, s, srcs, api]) => {
      if (!alive) return
      setIdx(units)
      setCg(c)
      setSpine(s)
      setSources(srcs || {})
      if (api.ok) { setEdits(api.edits); setApiOk(true) }
      if (!saved) return
      setUnitQ(saved.unitQ || '')
      if (saved.selId != null) {
        const target = units.find((u) => u.id === saved.selId)
        if (target) applyUnit(target, api.edits)
      }
      setScope(saved.scope === 'all' ? 'all' : 'linked')
      setQ(saved.q || '')
      // 列表渲染后再恢复滚动位置
      window.setTimeout(() => {
        if (listRef.current) listRef.current.scrollTop = saved?.scrollTop || 0
      }, 0)
    })
    return () => { alive = false }
  }, [applyUnit])

  const byHash = useMemo(() => {
    const m = new Map<string, CgItem>()
    if (cg) for (const it of cg.items) m.set(it.h, it)
    return m
  }, [cg])

  const unit = useMemo(() => idx.find((u) => u.id === selId) || null, [idx, selId])

  /** 该单元在剧情里出现过的 CG（按行序） */
  const linked = useMemo(() => {
    if (!cg || !unit) return []
    const best = new Map<string, number>()
    for (const [name, links] of Object.entries(cg.links)) {
      const item = cg.items.find((x) => x.n === name)
      if (!item) continue
      for (const l of links) {
        if (l.u !== unit.id) continue
        const i = l.i ?? 0
        if (!best.has(item.h) || i < best.get(item.h)!) best.set(item.h, i)
      }
    }
    const out: Array<{ item: CgItem; i: number }> = []
    const seenHash = new Set<string>()
    for (const [h, i] of [...best.entries()].sort((a, b) => a[1] - b[1])) {
      const it = byHash.get(h)
      if (!it) continue
      out.push({ item: it, i })
      seenHash.add(h)
      // 背景板 X_bg 对应的动态模型 X 也列出来，方便直接选它抓帧做封面
      if (it.n.endsWith('_bg')) {
        const model = it.n.slice(0, -3)
        if (spine.has(model)) {
          // 动态模型常被 cg_exclude.json 剔除（裸图集页），不在 cg_index.items 里，
          // 但仍可播放：合成一个仅用于展示/选择的条目。
          const mit: CgItem = cg.items.find((x) => x.n === model) || {
            h: model, n: model, c: '动态CG', s: '', w: 0, h2: 0, l: 0, d: 1,
          }
          if (!seenHash.has(mit.h)) {
            out.push({ item: mit, i: i + 0.5 })
            seenHash.add(mit.h)
          }
        }
      }
    }
    return out
  }, [cg, unit, byHash, spine])

  // 别名条目与真实图共用 hash，必须按 hash 去重，否则 React key 重复会在切范围时残留旧节点
  const allPool = useMemo(() => {
    if (!cg) return []
    const seen = new Set<string>()
    return visibleCgs(cg.items).filter((it) => (seen.has(it.h) ? false : (seen.add(it.h), true)))
  }, [cg])
  const pool = useMemo(() => {
    if (scope === 'linked') return linked.map((x) => x.item)
    const k = q.trim().toLowerCase()
    return allPool.filter((it) => !k || it.n.toLowerCase().includes(k) || it.s.toLowerCase().includes(k))
  }, [scope, linked, allPool, q])

  const filteredUnits = useMemo(() => {
    const k = unitQ.trim().toLowerCase()
    return idx.filter((u) => !k || u.bucket.toLowerCase().includes(k) || u.title.toLowerCase().includes(k))
  }, [idx, unitQ])

  const edit = selId != null ? edits[String(selId)] : undefined
  // 未保存 = 当前本地选图/裁剪与已落盘的人工指定不一致（而不是只看 edits 全局快照）
  const currentEdit = selId != null
    ? (picked ? (picked.crop ? { h: picked.h, crop: picked.crop } : { h: picked.h }) : null)
    : null
  // 没有人工指定时，预览里默认就是当前封面，这不算「未保存」
  const savedEdit = edit ?? (unit?.cover ? unit.cover : null)
  const dirty = apiOk && selId != null
    && (touched || JSON.stringify(canonEdit(currentEdit)) !== JSON.stringify(canonEdit(savedEdit)))

  const chooseUnit = useCallback((u: StoryUnit) => {
    applyUnit(u, edits)
    setScope('linked')
    setQ('')
  }, [applyUnit, edits, spine])

  const chooseCg = useCallback((it: CgItem) => {
    const isDyn = it.d === 1 || spine.has(it.n)
    setModelName(isDyn ? it.n : null)
    setSpineStatus(null)
    setTouched(true)
    if (isDyn) {
      // 动态 CG 用时间轴抓帧，不走静态裁剪
      setPicked({ h: it.h, crop: null })
      return
    }
    const same = typeof edit === 'object' && edit && edit.h === it.h
    const crop = same && edit.crop ? { ...edit.crop } : { cx: 0.5, cy: 0.5, zoom: 1 }
    setPicked({ h: it.h, crop })
  }, [edit, spine])

  /** 外部图片（网络 URL / 本地文件）：上传到 dev 后端保存原图，再走同一套裁剪流程 */
  const uploadExternal = useCallback(async (payload: { dataUrl?: string; url?: string; name?: string }) => {
    if (uploading) return
    setUploading(true)
    try {
      const r = await fetch('/api/cover-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const j: {
        ok?: boolean; error?: string; h?: string; w?: number; h2?: number; name?: string
      } = await r.json()
      const w = Number(j.w)
      const h2 = Number(j.h2)
      if (!j.ok || !j.h || !w || !h2) throw new Error(j.error || '导入失败')
      const key = j.h
      setSources((s) => ({ ...s, [key]: { w, h: h2, name: j.name || '外部图片' } }))
      setModelName(null)
      setTouched(true)
      setPicked({ h: key, crop: { cx: 0.5, cy: 0.5, zoom: 1 } })
      showToast('外部图片已导入，可拖动 / 缩放取景后保存')
    } catch (e) {
      showToast(`导入失败：${String(e)}`, true)
    } finally {
      setUploading(false)
    }
  }, [uploading, showToast])

  const onExternalFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!f.type.startsWith('image/')) {
      showToast('请选择图片文件', true)
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      void uploadExternal({ dataUrl: String(reader.result || ''), name: f.name })
    }
    reader.onerror = () => showToast('读取本地图片失败', true)
    reader.readAsDataURL(f)
  }

  const setCropField = (patch: Partial<Crop>) => {
    setTouched(true)
    setPicked((p) => (p ? { ...p, crop: { cx: 0.5, cy: 0.5, zoom: 1, ...(p.crop || {}), ...patch } } : p))
  }

  const finishSave = useCallback(async (body: unknown, msg: string) => {
    const r = await fetch('/api/cover-edits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const j: { ok?: boolean; edits?: Record<string, Edit>; error?: string } = await r.json()
    if (!j.ok) throw new Error(j.error || '保存失败')
    setEdits(j.edits || {})
    setTouched(false)
    showToast(msg)
    window.setTimeout(() => {
      // 记住左侧列表滚动位置与当前选中单元，刷新后原样恢复
      try {
        sessionStorage.setItem(UI_STATE_KEY, JSON.stringify({
          scrollTop: listRef.current?.scrollTop || 0,
          selId, scope, q, unitQ,
        }))
      } catch { /* ignore */ }
      suppressLeaveGuard.current = true
      window.location.reload()
    }, 1200)
  }, [showToast, selId, scope, q, unitQ])

  const save = useCallback(async (remove = false) => {
    if (!apiOk || selId == null || saving) return
    if (!remove && !picked) return
    // 从保存开始就放行 beforeunload：写盘时 Vite 也可能因 public/ 变化触发 full-reload
    suppressLeaveGuard.current = true
    setSaving(true)
    try {
      if (remove) {
        await finishSave({ id: selId, remove: true }, '已清除人工指定，封面重新生成中…')
        return
      }
      // 动态 CG：抓当前帧，由后台转成 3:4 封面；否则走静态 hash/裁剪参数
      if (modelName && spineRef.current) {
        const time = spineStatus?.time ?? 0
        spineRef.current.captureFrame(async (dataUrl) => {
          try {
            await finishSave(
              { id: selId, frame: { dataUrl, name: modelName, time } },
              '已保存动态 CG 当前帧作为封面，刷新中…',
            )
          } catch (e) {
            suppressLeaveGuard.current = false
            showToast(`保存失败：${String(e)}`, true)
            setSaving(false)
          }
        })
        return
      }
      const body = picked!.crop
        ? { id: selId, h: picked!.h, crop: picked!.crop }
        : { id: selId, h: picked!.h }
      await finishSave(body, '已写入 build/cg_cover_overrides.json，封面重新生成中…')
    } catch (e) {
      suppressLeaveGuard.current = false
      showToast(`保存失败：${String(e)}`, true)
      setSaving(false)
    }
  }, [apiOk, selId, picked, saving, showToast, finishSave, modelName, spineStatus])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save])

  useEffect(() => {
    if (!dirty) return
    const onLeave = (e: BeforeUnloadEvent) => {
      if (suppressLeaveGuard.current) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onLeave)
    return () => window.removeEventListener('beforeunload', onLeave)
  }, [dirty])

  const pickedItem = picked ? byHash.get(picked.h) : undefined
  const extSource = picked ? sources[picked.h] : undefined
  const dims = pickedItem
    ? { w: pickedItem.w || 1024, h: pickedItem.h2 || 1024 }
    : extSource ? { w: extSource.w, h: extSource.h }
    : loadedDims && picked && loadedDims.h === picked.h
      ? { w: loadedDims.w, h: loadedDims.h2 } : null
  const previewSrc = picked
    ? (extSource ? `/cover_src/${picked.h}.webp`
      : pickedItem ? `/img/l/${picked.h}.webp` : `/cover/${picked.h}.webp`)
    : ''
  const win = dims && picked?.crop
    ? cropWindow(dims.w, dims.h, picked.crop)
    : null

  const onDragStart = (e: React.MouseEvent) => {
    if (!picked?.crop) return
    dragRef.current = { x: e.clientX, y: e.clientY, cx: picked.crop.cx, cy: picked.crop.cy }
    e.preventDefault()
  }
  const onDragMove = (e: React.MouseEvent) => {
    const d = dragRef.current
    if (!d || !boxRef.current || !dims || !win) return
    const rect = boxRef.current.getBoundingClientRect()
    const dx = (e.clientX - d.x) / rect.width
    const dy = (e.clientY - d.y) / rect.height
    setCropField({
      cx: clamp(d.cx - dx * win.cw / dims.w, 0, 1),
      cy: clamp(d.cy - dy * win.ch / dims.h, 0, 1),
    })
  }
  const onDragEnd = () => { dragRef.current = null }

  // 滚轮缩放：以鼠标所在位置为锚点，和地图/图片编辑器的手感一致
  useEffect(() => {
    const el = boxRef.current
    if (!el || !picked?.crop || !dims || !win) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const c = picked!.crop!
      const z2 = clamp(Math.round((c.zoom + (e.deltaY < 0 ? 0.1 : -0.1)) * 100) / 100, 1, 3)
      if (z2 === c.zoom) return
      const rect = el.getBoundingClientRect()
      const mx = clamp((e.clientX - rect.left) / rect.width, 0, 1)
      const my = clamp((e.clientY - rect.top) / rect.height, 0, 1)
      const sx = win.x + mx * win.cw
      const sy = win.y + my * win.ch
      const cw2 = win.cw * c.zoom / z2
      const ch2 = win.ch * c.zoom / z2
      const x2 = clamp(sx - mx * cw2, 0, Math.max(0, dims.w - cw2))
      const y2 = clamp(sy - my * ch2, 0, Math.max(0, dims.h - ch2))
      setPicked((p) => (p ? {
        ...p,
        crop: { cx: clamp((x2 + cw2 / 2) / dims.w, 0, 1),
                cy: clamp((y2 + ch2 / 2) / dims.h, 0, 1), zoom: z2 },
      } : p))
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [picked, dims, win])

  if (!apiOk) {
    return (
      <main className="sc-page">
        <h1>剧情卡封面编辑</h1>
        <p className="sc-empty">后台接口不可用。请在项目根目录运行 <code>npm run dev</code> 后打开本页（生产构建不含此接口）。</p>
        <Link to="/story">← 返回剧情全文</Link>
      </main>
    )
  }

  return (
    <main className="sc-page">
      <header className="sc-head">
        <div>
          <div className="sc-kicker">STORY COVER STUDIO · DEV</div>
          <h1>剧情卡封面编辑</h1>
          <p>为该剧情单元指定一张 CG 并按 3:4 裁剪。只保存参数，封面由原图现裁，不新增 CG 图片。</p>
        </div>
        <div className="sc-head-actions">
          <Link to="/story">← 剧情全文</Link>
          <button className="sc-save" disabled={!dirty || saving || selId == null} onClick={() => void save()}>
            {saving ? '生成中…' : '保存封面'}
          </button>
        </div>
      </header>

      <div className="sc-layout">
        <aside className="sc-units">
          <input
            className="sc-search" placeholder="搜索单元 / bucket / 标题"
            value={unitQ} onChange={(e) => setUnitQ(e.target.value)}
          />
          <div className="sc-list" ref={listRef}>
            {filteredUnits.map((u) => (
              <button
                key={u.id}
                className={`sc-unit ${selId === u.id ? 'on' : ''}`}
                onClick={() => chooseUnit(u)}
              >
                <span className="sc-unit-thumb">
                  {u.cover
                    ? <img src={`/cover/${u.cover}.webp`} alt="" />
                    : <span className="sc-unit-none">—</span>}
                </span>
                <span className="sc-unit-text">
                  <b>#{u.id} {u.title || u.bucket}</b>
                  <small>{u.bucket} · {nf(u.lines)} 句{edits[String(u.id)] ? ' · 已指定' : ''}</small>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="sc-main">
          {!unit ? (
            <p className="sc-empty">从左侧选一个剧情单元开始编辑。</p>
          ) : (
            <>
              <div className="sc-title">
                <h2>#{unit.id} {unit.title || unit.bucket}</h2>
                <span>{unit.bucket} · {unit.label} · {nf(unit.lines)} 句</span>
              </div>

              <div className="sc-editor">
                <div className="sc-preview-wrap">
                  {modelName ? (
                    <>
                      <div className="sc-preview sc-spine-stage">
                        <SpinePlayer
                          name={modelName}
                          dir="spine"
                          controls={false}
                          fitMode="cover"
                          controllerRef={spineRef}
                          onTick={setSpineStatus}
                        />
                      </div>
                      <div className="sc-timeline">
                        <button
                          onClick={() => {
                            setTouched(true)
                            if (spineStatus?.playing) spineRef.current?.pause()
                            else spineRef.current?.play()
                          }}
                        >{spineStatus?.playing ? '暂停' : '播放'}</button>
                        <span>{spineStatus?.time.toFixed(2) ?? '0.00'}s</span>
                        <input
                          type="range" min={0} max={spineStatus?.duration || 1} step={0.01}
                          value={Math.min(spineStatus?.time ?? 0, spineStatus?.duration || 1)}
                          onChange={(e) => {
                            const t = Number(e.target.value)
                            spineRef.current?.seek(t)
                            setSpineStatus((s) => (s ? { ...s, time: t } : s))
                            setTouched(true)
                          }}
                        />
                        <span>{(spineStatus?.duration ?? 0).toFixed(2)}s</span>
                      </div>
                      <p className="sc-preview-note">
                        动态 CG：拖动时间轴定位，保存时使用当前帧作为封面（原图不变）。
                      </p>
                    </>
                  ) : (
                    <>
                      <div
                        ref={boxRef}
                        className={`sc-preview ${picked?.crop ? 'draggable' : ''}`}
                        onMouseDown={onDragStart}
                        onMouseMove={onDragMove}
                        onMouseUp={onDragEnd}
                        onMouseLeave={onDragEnd}
                      >
                        {picked && (
                          <img
                            src={previewSrc}
                            alt=""
                            draggable={false}
                            onLoad={(e) => {
                              const im = e.currentTarget
                              if (im.naturalWidth && im.naturalHeight && picked) {
                                setLoadedDims({ h: picked.h, w: im.naturalWidth, h2: im.naturalHeight })
                              }
                            }}
                            style={win && dims ? {
                              width: `${(dims.w / win.cw) * 100}%`,
                              left: `${-(win.x / win.cw) * 100}%`,
                              top: `${-(win.y / win.ch) * 100}%`,
                            } : { width: '100%', height: '100%', objectFit: 'cover', left: 0, top: 0 }}
                          />
                        )}
                        {!picked && <span className="sc-preview-empty">未选择 CG</span>}
                      </div>
                      <p className="sc-preview-note">
                        {picked?.crop
                          ? '拖动图片决定取景中心；鼠标滚轮或右侧滑块缩放（滚轮以光标为中心）。'
                          : '当前使用脚本自动取景；选择 CG 后可手动裁剪。'}
                      </p>
                    </>
                  )}
                </div>

                <div className="sc-controls">
                  {!modelName && <>
                  <div className="sc-field">
                    <label>裁剪方式</label>
                    <div className="sc-modes">
                      <button
                        className={picked?.crop ? '' : 'on'}
                        disabled={!picked}
                        onClick={() => {
                          setTouched(true)
                          setPicked((p) => (p ? { ...p, crop: null } : p))
                        }}
                      >自动取景</button>
                      <button
                        className={picked?.crop ? 'on' : ''}
                        disabled={!picked}
                        onClick={() => {
                          setTouched(true)
                          setPicked((p) => (
                            p ? { ...p, crop: p.crop || { cx: 0.5, cy: 0.5, zoom: 1 } } : p
                          ))
                        }}
                      >手动裁剪</button>
                    </div>
                  </div>
                  <div className="sc-field">
                    <label>缩放 <b>{picked?.crop?.zoom.toFixed(2) ?? '1.00'}×</b></label>
                    <input
                      type="range" min={1} max={3} step={0.05}
                      disabled={!picked?.crop}
                      value={picked?.crop?.zoom ?? 1}
                      onChange={(e) => setCropField({ zoom: Number(e.target.value) })}
                    />
                  </div>
                  <div className="sc-field sc-row">
                    <button disabled={!picked?.crop} onClick={() => setCropField({ cx: 0.5, cy: 0.5 })}>居中</button>
                    <button disabled={!picked?.crop} onClick={() => setCropField({ zoom: 1 })}>最小裁剪</button>
                  </div>
                  </>}
                  <div className="sc-field">
                    <label>当前封面</label>
                    <code>{picked?.h || unit.cover || '（文字兜底卡）'}</code>
                    {pickedItem && <small>{pickedItem.n} · {pickedItem.w}×{pickedItem.h2}</small>}
                    {extSource && <small>外部图片 · {extSource.name} · {extSource.w}×{extSource.h}</small>}
                  </div>
                  <div className="sc-field sc-row">
                    <button className="sc-clear" disabled={!edit} onClick={() => void save(true)}>
                      清除人工指定
                    </button>
                  </div>
                </div>
              </div>

              <div className="sc-external">
                <div className="sc-external-head">
                  <h3>外部图片</h3>
                  <span>数据包里已没有对应 CG 时，可粘贴网络图片地址或上传本地图片，同样按 3:4 取景。</span>
                </div>
                <div className="sc-external-row">
                  <input
                    className="sc-search" placeholder="网络图片地址（http/https）"
                    value={extUrl} onChange={(e) => setExtUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && extUrl.trim() && !uploading) {
                        void uploadExternal({ url: extUrl.trim(), name: extName.trim() || '网络图片' })
                      }
                    }}
                  />
                  <input
                    className="sc-search sc-ext-name" placeholder="备注名（可选）"
                    value={extName} onChange={(e) => setExtName(e.target.value)}
                  />
                  <button
                    type="button" disabled={uploading || !extUrl.trim()}
                    onClick={() => void uploadExternal({ url: extUrl.trim(), name: extName.trim() || '网络图片' })}
                  >网络图片</button>
                </div>
                <div className="sc-external-row">
                  <input
                    ref={fileRef} type="file" accept="image/*" hidden
                    onChange={onExternalFile}
                  />
                  <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()}>
                    {uploading ? '导入中…' : '上传本地图片'}
                  </button>
                  <span>支持 PNG / JPEG / WebP / GIF / BMP，最大 20MB；图片存到 public/cover_src/。</span>
                </div>
              </div>

              <div className="sc-picker">
                <div className="sc-picker-head">
                  <h3>选择 CG</h3>
                  <div className="sc-modes">
                    <button className={scope === 'linked' ? 'on' : ''} onClick={() => setScope('linked')}>
                      本剧情 ({linked.length})
                    </button>
                    <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>全库搜索</button>
                  </div>
                  {scope === 'all' && (
                    <input className="sc-search" placeholder="CG 名 / 活动键"
                      value={q} onChange={(e) => setQ(e.target.value)} />
                  )}
                </div>
                <div className="sc-grid">
                  {pool.map((it) => (
                    <button
                      key={it.n}
                      className={`sc-cell ${picked?.h === it.h ? 'on' : ''}`}
                      onClick={() => chooseCg(it)}
                      title={it.n}
                    >
                      <img
                        src={it.d === 1 || spine.has(it.n)
                          ? `/spine/${it.n}/${it.n}.spine.webp`
                          : `/img/s/${it.h}.webp`}
                        alt="" loading="lazy"
                      />
                      <span>{it.d === 1 || spine.has(it.n) ? '▶ ' : ''}{it.n}</span>
                    </button>
                  ))}
                  {pool.length === 0 && <p className="sc-empty">没有可选 CG。</p>}
                </div>
              </div>
            </>
          )}
        </section>
      </div>
      {toast && <div className={`sc-toast ${toast.bad ? 'bad' : ''}`}>{toast.text}</div>}
    </main>
  )
}
