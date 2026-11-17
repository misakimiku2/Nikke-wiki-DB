import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import {
  AnimationState, AnimationStateData, AtlasAttachmentLoader, ClippingAttachment,
  GLTexture, ManagedWebGLRenderingContext, RegionAttachment, SceneRenderer, Skeleton,
  SkeletonBinary, TextureAtlas, Vector2, VertexAttachment,
} from '@esotericsoftware/spine-webgl'
import { loadSpineOverrides, type SpineOverride, type ViewTransform } from '../data'
import PlayPauseIcon from './PlayPauseIcon'

/** 播放器的实时状态，供外部时间轴 / 按钮区读取 */
export type SpineStatus = {
  ready: boolean
  playing: boolean
  time: number
  duration: number
  speed: number
  zoom: number
  anim: string
  anims: string[]
}

/** 外部控制条通过 ref 拿到的命令式接口 */
/** 校准模式导出的骨骼快照（世界矩阵 a,b,c,d,wx,wy） */
export type CalibBoneDump = { name: string; m: [number, number, number, number, number, number] }

/** 校准面板的微调量 */
export type CalibAdj = { dxPct: number; dyPct: number; scale: number; rot: number }

/** 校准面板「记录本帧」导出的单条数据：骨架原始矩阵 + 用户微调量，
    用于离线反推背景板与骨架的正确绑定公式 */
export type CalibSnapshot = {
  anim: string
  t: number
  /** 本条记录针对哪张背景（0 = bg，1 = bg2；单背景恒为 0） */
  bgIndex: number
  side0: number
  center0: [number, number]
  baseCx: number
  baseCy: number
  baseSide: number
  baseRot: number
  dxPct: number
  dyPct: number
  scale: number
  rot: number
  camBone: CalibBoneDump | null
  camParent: CalibBoneDump | null
  camChildren: CalibBoneDump[]
}

export type SpineController = {
  play(): void
  pause(): void
  toggle(): void
  seek(t: number): void
  setSpeed(v: number): void
  setAnim(n: string): void
  /**
   * 播放一次性过渡动画，播完后自动切到 followAnim 并循环。
   * 用于角色第二形态切换：先播 expression_0 变身动画，再停在形态②的待机。
   */
  playOnce(n: string, followAnim: string): void
  resetView(): void
  /** 镜头运镜开关：开=自动跟拍且禁用拖拽/缩放，关=固定/手动取景 */
  setCameraFollow?(on: boolean): void
  saveFrame(filename?: string): void
  getStatus(): SpineStatus
  /** 校准模式专用：当前帧的骨架矩阵 + 基础矩形（未含用户微调） */
  calibSnapshot?(): CalibSnapshot | null
}

export type SpinePlayerProps = {
  /** 模型名，例如 EventScene_CherryBlossom_01 / c010_00 */
  name: string
  /**
   * 模型所在目录（public 下的一级目录）：CG 是 spine，角色站姿是 spine_char，
   * 角色战斗姿态（背身射击/掩体）是 spine_combat，大招 cut-in 是 spine_skillcut
   */
  dir?: 'spine' | 'spine_char' | 'spine_combat' | 'spine_skillcut'
  className?: string
  /** 是否渲染自带控制条；二级查看页传 false，改用页面底部统一控制条 */
  controls?: boolean
  /** 加载并渲染出第一帧后回调（用于「静态合成图 → 实时模型」的过渡） */
  onReady?: () => void
  /** 约 10Hz 的状态推送，供时间轴刷新 */
  onTick?: (s: SpineStatus) => void
  /** 视图变化时推送相机变换，供外层独立背景层跟随缩放/平移 */
  onView?: (t: ViewTransform) => void
  onError?: (msg: string) => void
  controllerRef?: MutableRefObject<SpineController | null>
  /**
   * 独立背景图（有些 CG 的背景不在图集里，是单独导出的 *_bg.png）。
   * 舞台由外层统一叠这个背景，这里只用于「保存当前帧」时把背景一起合进 PNG。
   */
  backgroundSrc?: string
  /**
   * 取景方式：contain（默认，完整显示模型，供查看器缩放细看）/ cover（铺满容器）。
   * 剧情阅读器里的背景图与静态合成图都是 object-fit: cover，实时模型也要用
   * cover，三层才会按同一套比例缩放，不会出现「背景铺满、人物另算一套」。
   */
  fitMode?: 'contain' | 'cover'
  /**
   * 是否自动隐藏名字里带 shadow 的附件。CG 场景里的整屏阴影层在 Spine 数据里是
   * Normal 混合，实时绘制会在脸上留一块灰影，需要摘掉；角色站姿模型的
   * chest_shadow / hair_shadow 是正常的部位阴影（同样是 Normal），必须保留。
   * 默认跟随 dir：CG 开、角色关。显式传值可覆盖。
   */
  hideShadows?: boolean
  /**
   * 场景背景层（世界坐标）：大招 cut-in 的浴缸/场景图与骨架同属一个演出，
   * 按「角色内容范围」的世界矩形绘制在画布底下，与模型共用同一套取景——
   * 缩放/拖拽/复位时跟着动，不铺满舞台。未传则无此层。
   */
  sceneBg?: string
  /**
   * 第二张场景背景（多镜大招）：切镜点（camera 骨平移跳变处）之后换用。
   * 两张图共用同一套世界矩形基准与 camera 骨变换，仅内容不同。
   */
  sceneBg2?: string
  /** 校准模式：显示背景板微调面板（URL 带 calib=1 时由页面传入），
      用于人工对齐背景与骨架并导出数据 */
  calib?: boolean
  /** 自定义默认动画挑选（模型动画列表 → 动画名）；缺省自动挑 idle
      （站姿 idle / 战斗 aim_idle / 大招 Idle）。返回 undefined 时回落到 idle。
      第二参为模型名，供大招角色段覆盖表按模型命中（见 pickBurstAnim） */
  pickDefaultAnim?: (names: string[], model?: string) => string | undefined
  /** 自带控制条右侧的额外内容 */
  extra?: ReactNode
  /**
   * 额外的 Spine 图层（与主模型共用同一相机/取景，按 z 序叠加绘制）。
   * 用于一个立绘拆成多层的情况，例如灰姑娘:琉璃波光 = BG 场景 + 角色 + FG 更衣帘。
   * 各层模型放在 public/spine_layer/ 下，动画名与主模型一致时会自动同步播放
   * （setAnim / playOnce / seek 都会广播到含该动画的层），实现三层同时变身。
   */
  layerNames?: { bg?: string; fg?: string }
}

async function fetchOK(url: string): Promise<Response> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} ${r.status}`)
  return r
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image()
    i.onload = () => res(i)
    i.onerror = () => rej(new Error(`image ${url}`))
    i.src = url
  })
}

function download(dataUrl: string, filename: string) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  // 立刻 remove 会让 Chromium 取消大尺寸 dataURL 的下载，等一拍再摘掉
  window.setTimeout(() => a.remove(), 1000)
}

/** 与 CSS `.cv-bg img { object-fit: contain }` 保持一致的取景 */
function drawContain(
  ctx: CanvasRenderingContext2D, img: HTMLImageElement, W: number, H: number,
) {
  const s = Math.min(W / img.naturalWidth, H / img.naturalHeight)
  const w = img.naturalWidth * s
  const h = img.naturalHeight * s
  ctx.drawImage(img, (W - w) * 0.5, (H - h) * 0.5, w, h)
}

const BBOX_SCRATCH = new Float32Array(8192)

/** 单个槽位附件的世界空间包围盒（只统计可见内容，color.a<=0 或未知类型跳过） */
function slotBBox(slot: any): [number, number, number, number] | null {
  const att: any = slot.getAttachment()
  if (!att || slot.color.a <= 0.01) return null
  if (att instanceof ClippingAttachment) return null
  let xs: number[] = []
  let ys: number[] = []
  try {
    if (att instanceof RegionAttachment) {
      att.computeWorldVertices(slot, BBOX_SCRATCH, 0, 2)
      xs = [BBOX_SCRATCH[0], BBOX_SCRATCH[2], BBOX_SCRATCH[4], BBOX_SCRATCH[6]]
      ys = [BBOX_SCRATCH[1], BBOX_SCRATCH[3], BBOX_SCRATCH[5], BBOX_SCRATCH[7]]
    } else if (att instanceof VertexAttachment) {
      const n: number = att.worldVerticesLength
      const out = n > BBOX_SCRATCH.length ? new Float32Array(n) : BBOX_SCRATCH
      att.computeWorldVertices(slot, 0, n, out, 0, 2)
      for (let i = 0; i < n; i += 2) { xs.push(out[i]); ys.push(out[i + 1]) }
    } else {
      return null
    }
  } catch {
    return null
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] < x0) x0 = xs[i]
    if (xs[i] > x1) x1 = xs[i]
    if (ys[i] < y0) y0 = ys[i]
    if (ys[i] > y1) y1 = ys[i]
  }
  if (x1 <= x0 || y1 <= y0) return null
  return [x0, y0, x1, y1]
}

/** 整个骨架当前姿态下「实际会画出来」的内容包围盒（比 getBounds 紧得多，
    后者会把隐藏/透明槽位的几何也算进去） */
function contentBounds(skeleton: any): [number, number, number, number] | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const slot of skeleton.slots) {
    const b = slotBBox(slot)
    if (!b) continue
    x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1])
    x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3])
  }
  return x1 > x0 ? [x0, y0, x1, y1] : null
}

/** 可见槽位中心的中位数 + 部件面积的中位数——对少数飞散的特效件鲁棒
    （bbox 中心会被单个远处的 FX 网格拉偏，中位数不受影响）。
    中心用作相机跟拍目标与场景背景板的锚点；面积中位数用来估计角色
    当前的「表观缩放」——大招的运镜烤进骨架后角色整体被放大，而特效
    件只占少数槽位，面积中位数天然落在角色本体上，背景板要跟着一起放大 */
function contentStats(
  skeleton: any, only?: Set<number>,
): { cx: number; cy: number; medArea: number } | null {
  const xs: number[] = []
  const ys: number[] = []
  const areas: number[] = []
  let i = 0
  for (const slot of skeleton.slots) {
    if (!only || only.has(i)) {
      const b = slotBBox(slot)
      if (b) {
        xs.push((b[0] + b[2]) / 2)
        ys.push((b[1] + b[3]) / 2)
        areas.push((b[2] - b[0]) * (b[3] - b[1]))
      }
    }
    i++
  }
  if (!xs.length) return null
  const med = (arr: number[]) => {
    const s = [...arr].sort((a, b) => a - b)
    return s[Math.floor(s.length / 2)]
  }
  return { cx: med(xs), cy: med(ys), medArea: med(areas) }
}

/** 每个可见槽位的面积（不可见为 0，按槽位下标对齐），供拟合期挑选本体槽位 */
function collectSlotAreas(skeleton: any): number[] {
  const out: number[] = []
  let i = 0
  for (const slot of skeleton.slots) {
    const b = slotBBox(slot)
    out[i] = b ? (b[2] - b[0]) * (b[3] - b[1]) : 0
    i++
  }
  return out
}

/** 每个可见槽位的中心 [cx,cy]（不可见为 null 槽位记 0,0），供拟合期取
    各镜「身体中心」——内容 bbox 会被 FX 撑大，身体槽位中位更可靠 */
function collectSlotCenters(skeleton: any): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const slot of skeleton.slots) {
    const b = slotBBox(slot)
    out.push(b ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : [0, 0])
  }
  return out
}

/**
 * spine-webgl 实时播放：
 *  - 图集是游戏导出的 pma:true 贴图；构建时用 exact 无损 WebP 保留全透明像素的
 *    RGB=0，线性采样才不会把隔壁图块的垃圾色渗到部件边界（灰色切片 / 白线）
 *  - 按 pma 混合绘制，腮红、发光、阴影这类半透明层才不会被乘两次 alpha
 *  - 滚轮以光标为锚点缩放、左键拖拽平移、双击复位
 *  - 可通过 controllerRef 暴露播放 / 暂停 / 时间轴 seek / 变速 / 复位 / 保存当前帧
 */
export default function SpinePlayer({
  name, dir = 'spine', className = '', controls = true, onReady, onTick, onView, onError, controllerRef,
  backgroundSrc, fitMode = 'contain', hideShadows, sceneBg, sceneBg2, pickDefaultAnim, extra, calib, layerNames,
}: SpinePlayerProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneBgRef = useRef<HTMLImageElement>(null)
  const sceneBg2Ref = useRef<HTMLImageElement>(null)
  /** 校准面板的实时微调量（按背景分槽：0 = bg，1 = bg2）；drawFrame 通过 ref
      读取，调整不会重建播放器 */
  const calibRef = useRef<Record<number, CalibAdj>>({ 0: { dxPct: 0, dyPct: 0, scale: 1, rot: 0 }, 1: { dxPct: 0, dyPct: 0, scale: 1, rot: 0 } })
  /** 校准模式开关（ref：渲染循环内读取，不触发 effect 重建） */
  const calibOnRef = useRef(false)
  const [calibAdj, setCalibAdj] = useState<Record<number, CalibAdj>>({
    0: { dxPct: 0, dyPct: 0, scale: 1, rot: 0 },
    1: { dxPct: 0, dyPct: 0, scale: 1, rot: 0 },
  })
  const [calibRecords, setCalibRecords] = useState<CalibSnapshot[]>([])
  const [calibOut, setCalibOut] = useState('')
  /** 双背景切镜点（秒）；null = 单背景 */
  const [calibCut, setCalibCut] = useState<number | null>(null)
  /** 校准面板用的当前动画时间（emit 里 ~10Hz 刷新） */
  const [calibTime, setCalibTime] = useState(0)
  /** 预加载好的背景图，供保存当前帧时与 WebGL 画面合成 */
  const bgImageRef = useRef<HTMLImageElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 自带控制条的展示状态；外部控制条模式下由 onTick 推送，这里只用于文字回显
  const [ui, setUi] = useState({ anims: [] as string[], current: '', paused: false, speed: 1, zoom: 1 })

  const callbacks = useRef({ onReady, onTick, onView, onError })
  callbacks.current = { onReady, onTick, onView, onError }
  calibRef.current = calibAdj
  calibOnRef.current = !!calib && !!sceneBg
  /** 自带控制条用的内部句柄；外部页面则传 controllerRef 拿同一个对象 */
  const localCtrl = useRef<SpineController | null>(null)

  /** 背景图单独预加载，不进主渲染 effect 的依赖，避免配置晚到时把播放器重建一遍 */
  useEffect(() => {
    bgImageRef.current = null
    if (!backgroundSrc) return
    let cancelled = false
    const img = new Image()
    img.onload = () => { if (!cancelled) bgImageRef.current = img }
    img.src = backgroundSrc
    return () => { cancelled = true }
  }, [backgroundSrc])

  useEffect(() => {
    let raf = 0
    let disposed = false
    let ro: ResizeObserver | null = null
    let scene: SceneRenderer | null = null
    const cleanups: Array<() => void> = []

    // 所有可变播放状态放在闭包里，由 controller 直接读写，避免每帧 setState
    let state: AnimationState | null = null
    let skeleton: Skeleton | null = null
    /** 额外图层（BG/FG）：与主模型共用相机取景，按 z 序绘制；动画同步广播 */
    const extraLayers: Array<{
      z: number
      state: AnimationState
      skeleton: Skeleton
      premultiplied: boolean
      animSet: Set<string>
    }> = []
    let duration = 0
    let animNames: string[] = []
    let currentAnim = ''
    let playing = true
    /** 镜头运镜总开关：开 = 自动跟拍 + 禁止手动移动/缩放；关 = 不跟拍，可手动。
        只对大招 cut-in 生效，立绘 / 战斗姿态 / CG 始终允许手动缩放和拖拽 */
    let cinemaOn = true
    const cinemaLock = () => cinemaOn && dir === 'spine_skillcut'
    let speed = 1
    let zoom = 1
    let ready = false
    let fitFn: (() => void) | null = null
    let pendingSave: string | null = null
    let lastTick = 0
    /** 一次性过渡动画播完后要切到的目标动画；null 表示当前不是过渡播放 */
    let pendingFollow: string | null = null
    /** 最近一次推给背景层的变换；保存当前帧时要在导出画布里复现 */
    let bgTransform: ViewTransform = { scale: 1, tx: 0, ty: 0 }

    const status = (): SpineStatus => ({
      ready, playing, time: currentTime(), duration, speed, zoom,
      anim: currentAnim, anims: animNames,
    })

    const currentTime = () => {
      if (!state) return 0
      const track: any = state.getCurrent(0)
      if (!track || !duration) return 0
      // loop 时 trackTime 会一直累加，动画内部用 trackTime % duration
      return track.trackTime % duration
    }

    const emit = (force = false) => {
      const now = performance.now()
      // 渲染循环每帧都会调用 emit，UI 与回调都节流到约 10Hz
      if (!force && now - lastTick < 90) return
      lastTick = now
      const s = status()
      setUi({ anims: s.anims, current: s.anim, paused: !s.playing, speed: s.speed, zoom: s.zoom })
      if (calibOnRef.current) setCalibTime(currentTime())
      callbacks.current.onTick?.(s)
    }

    ;(async () => {
      try {
        const folder = `/${dir}/${name}/`
        const [atlasText, skelBuf, overrides] = await Promise.all([
          fetchOK(`${folder}${name}.atlas`).then((r) => r.text()),
          fetchOK(`${folder}${name}.skel`).then((r) => r.arrayBuffer()),
          loadSpineOverrides().catch((): Record<string, SpineOverride> => ({})),
        ])
        const canvas = canvasRef.current!
        const context = new ManagedWebGLRenderingContext(canvas)
        scene = new SceneRenderer(canvas, context)
        const gl = context.gl

        /** 加载一个 Spine 层（atlas + 各页贴图 + skel），返回可绘制的层对象。
            主层和 BG/FG 额外层共用这套逻辑与同一个 GL context。 */
        const loadLayer = async (folder: string, nm: string) => {
          const atlasText = await fetchOK(`${folder}${nm}.atlas`).then((r) => r.text())
          const skelBuf = await fetchOK(`${folder}${nm}.skel`).then((r) => r.arrayBuffer())
          const atlas = new TextureAtlas(atlasText)
          // .atlas 头部的 pma:true 表示贴图 RGB 已经乘过 alpha。GLTexture 上传时会把
          // 浏览器内部预乘的位图反预乘回文件里的值，所以 GL 纹理里就是预乘数据，
          // drawSkeleton 必须按 pma 混合（ONE, ONE_MINUS_SRC_ALPHA）。
          // 绝对不要在构建阶段再乘一次 alpha —— 半透明层会变灰（腮红变褐、发光变灰圆斑）。
          const premultiplied = atlas.pages.length > 0 && atlas.pages.every((p) => p.pma)
          const pageImgs = await Promise.all(
            atlas.pages.map((pg) => loadImage(folder + pg.name).catch(() => null)),
          )
          const fallbackImg = pageImgs.find((x) => !!x) || null
          for (let i = 0; i < atlas.pages.length; i++) {
            const page = atlas.pages[i]
            const img = pageImgs[i] || fallbackImg
            if (!img) throw new Error(`page image missing: ${page.name}`)
            const tex = new GLTexture(context, img)
            page.setTexture(tex)
            page.width = img.width
            page.height = img.height
            tex.setFilters(gl.LINEAR, gl.LINEAR)
          }
          const data = new SkeletonBinary(new AtlasAttachmentLoader(atlas))
            .readSkeletonData(new Uint8Array(skelBuf))
          const sk = new Skeleton(data)
          if (data.defaultSkin) sk.setSkin(data.defaultSkin)
          sk.setSlotsToSetupPose()
          const st = new AnimationState(new AnimationStateData(data))
          st.timeScale = speed
          return { data, skeleton: sk, state: st, premultiplied }
        }

        // 主模型（原有逻辑不变：skeleton/state 仍是主层，status/timeline 都基于它）
        // atlasText / skelBuf 复用上方已获取的结果
        const atlas = new TextureAtlas(atlasText)
        const premultiplied = atlas.pages.length > 0 && atlas.pages.every((p) => p.pma)
        const pageImgs = await Promise.all(
          atlas.pages.map((pg) => loadImage(folder + pg.name).catch(() => null)),
        )
        const fallbackImg = pageImgs.find((x) => !!x) || null
        for (let i = 0; i < atlas.pages.length; i++) {
          const page = atlas.pages[i]
          const img = pageImgs[i] || fallbackImg
          if (!img) throw new Error(`page image missing: ${page.name}`)
          const tex = new GLTexture(context, img)
          page.setTexture(tex)
          page.width = img.width
          page.height = img.height
          tex.setFilters(gl.LINEAR, gl.LINEAR)
        }
        if (disposed) return
        const data = new SkeletonBinary(new AtlasAttachmentLoader(atlas))
          .readSkeletonData(new Uint8Array(skelBuf))
        skeleton = new Skeleton(data)
        if (data.defaultSkin) skeleton.setSkin(data.defaultSkin)
        skeleton.setSlotsToSetupPose()

        // 阴影贴图（*_shadow）在 CG 里靠 multiply 着色器绘制，Spine 数据里是 Normal
        // 混合，直接画会在脸上留一块灰影。这里和「按模型覆盖配置」一起逐帧隐藏：
        // state.apply 每帧都会重设 slot.color，所以不能只在初始化时设一次。
        // 角色站姿模型的同类命名的阴影是真实部位阴影，由 hideShadows 关掉这条规则。
        const shadowRule = hideShadows ?? dir === 'spine'
        const hiddenExact = new Set<string>()
        const hiddenPatterns: RegExp[] = []
        for (const rule of overrides[name]?.hiddenSlots || []) {
          if (rule.startsWith('/') && rule.endsWith('/')) {
            try { hiddenPatterns.push(new RegExp(rule.slice(1, -1), 'i')) } catch { /* ignore */ }
          } else hiddenExact.add(rule)
        }
        const isHiddenSlot = (sn: string) =>
          hiddenExact.has(sn) || hiddenPatterns.some((r) => r.test(sn))
        const applyHiddenSlots = (sk: any) => {
          for (const slot of sk.slots) {
            let att: any = null
            try { att = slot.getAttachment() } catch { att = null }
            const hide = isHiddenSlot(String(slot.data?.name || ''))
              || (shadowRule && att && /shadow/i.test(String(att.name || '')))
            // 必须真的摘掉附件，而不是只把 slot.color.a 置 0：
            // pma 混合下某些大画框/光板贴图仍会残留一层半透明浅色矩形；
            // setAttachment(null) 同时也让它们不参与 getBounds 取景，和离线渲染一致。
            if (hide) slot.setAttachment(null)
          }
        }

        state = new AnimationState(new AnimationStateData(data))
        animNames = data.animations.map((a: any) => a.name)
        state.timeScale = speed

        // 加载额外图层（BG 在角色下方、FG 在角色上方）。加载失败不影响主模型，
        // 只是没有分层效果——保证老角色/资源缺失时行为与单层完全一致。
        if (layerNames) {
          const layerFolder = '/spine_layer/'
          const specs: Array<{ nm: string; z: number }> = []
          if (layerNames.bg) specs.push({ nm: layerNames.bg, z: -1 })
          if (layerNames.fg) specs.push({ nm: layerNames.fg, z: 1 })
          const results = await Promise.all(specs.map(async (s) => {
            try {
              const L = await loadLayer(layerFolder + s.nm + '/', s.nm)
              return { ...L, z: s.z, animSet: new Set(L.data.animations.map((a: any) => a.name)) }
            } catch (e) {
              console.warn('[SpinePlayer] 额外图层加载失败:', s.nm, e)
              return null
            }
          }))
          for (const r of results) {
            if (r && !disposed) extraLayers.push(r)
          }
          extraLayers.sort((a, b) => a.z - b.z)
        }

        const setAnim = (n: string, loop = true, follow: string | null = null) => {
          if (!state || !skeleton) return
          const a: any = data.animations.find((x: any) => x.name === n)
          if (!a) return
          currentAnim = n
          duration = a.duration || 0
          pendingFollow = loop ? null : follow
          state.setAnimation(0, n, loop)
          // 广播到额外图层：只在该层确实含有同名动画时才播（分层资源往往与主模型
          // 动画名一致，例如三层同时播 expression_0 实现帘子+换装同步）
          for (const L of extraLayers) {
            if (L.animSet.has(n)) {
              L.state.setAnimation(0, n, loop)
              L.state.update(0)
              L.state.apply(L.skeleton)
              L.skeleton.updateWorldTransform()
            }
          }
          // 大招 cut-in（c513/c852 等）的背景层在同一个骨架里，游戏用两个实例
          // 分别播 <主动画> 与 <主动画>_bg；这里用第二轨道复现同一合成
          const bgAnim = dir === 'spine_skillcut'
            ? data.animations.find((x: any) => x.name === `${n}_bg`)
            : null
          if (bgAnim) state.setAnimation(1, bgAnim.name, true)
          else state.setEmptyAnimation(1, 0)
          state.update(0)
          state.apply(skeleton)
          applyHiddenSlots(skeleton)
          skeleton.updateWorldTransform()
          emit(true)
        }
        // 默认动画：站姿是 idle，战斗模型是 aim_idle / cover_idle，统一按
        // 「以 idle 结尾或就叫 idle」匹配，匹配不到再落第一个；
        // pickDefaultAnim 优先（大招 cut-in 的动画命名五花八门，见 pickBurstAnim）
        // 注意：不少模型的动画表按字母序把 bg_idle 排在 idle 前面，而 bg_* 是
        // 只驱动背景的空舞台动画（没有角色可见部件）。旧正则 /(^|_)idle$/i 会
        // 先命中 bg_idle 当默认动画 → 打开页面就是静帧；且 bg_* 被上层表情列表
        // 过滤掉，下拉的 value 指向一个不存在的 option，看起来像选了空的
        // 「更多表情」。所以挑选 idle 时先排除 bg_ / talk_ 这类前缀。
        const isIdleName = (a: string) => /(^|_)idle$/i.test(a)
        const visibleAnims = animNames.filter((a) => !/^(bg_|talk_)/i.test(a))
        const idleFirst = visibleAnims.find(isIdleName) || visibleAnims[0] || animNames[0] || ''
        const first = (pickDefaultAnim && pickDefaultAnim(animNames, name)) || idleFirst
        setAnim(first)

        // 相机 / 视图
        const offset = new Vector2()
        const size = new Vector2()
        let bw = 1
        let bh = 1
        let cx0 = 0
        let cy0 = 0
        let framed = false
        /** 大招动画全程的内容并集（相机跟拍的限位范围），初始为空 */
        let unionRect: [number, number, number, number] | null = null
        /** 「安静半场」的典型范围：FX 突发样本被排除后的角色本体典型 extent */
        let calmRect: { cx: number; cy: number; w: number; h: number } | null = null
        /** 安静半场样本的部件面积中位数：运行期估计角色表观缩放的基准（≤0 = 关闭跟随） */
        let areaRef = 0
        /** 「本体槽位」集合（按槽位下标）：拟合期从安静半场里挑出的稳定可见
            大件——运行期只统计这些槽位，中心/面积中位数就只跟着角色本体走，
            第二镜里大面积特效簇（all 子树自放大到 1.68×）不会再污染估计 */
        let bodySlots: Set<number> | null = null
        /** 第二镜的本体槽位与安静半场：多镜大招每个镜头可能用不同槽位组画
            角色（c352 第一镜 hailun*、第二镜另一组），基准摆放也各自独立 */
        let bodySlots2: Set<number> | null = null
        /** 「body」绑定模式下身体中心在 t=0 的位置（缩放轴心），首帧懒记录 */
        let bodyCenter0: { x: number; y: number } | null = null
        /** 背景板是否以角色身体为轴心跟随运镜缩放（data.ts sceneBgPivot） */
        const pivotBody = overrides[name]?.sceneBgPivot === 'body'
        let calmRect2: {
          cx: number; cy: number; w: number; h: number
          ref?: number; bodyCx?: number | null; bodyCy?: number | null
        } | null = null
        /** 切镜时刻的 camera 矩阵：bg2 的相对变换以它（而不是 t=0）为基准 */
        let sceneBoneCut: { a: number; b: number; c: number; d: number; x: number; y: number } | null = null
        // 运镜骨骼：优先按模型覆盖配置（sceneBone），默认 riggers 命名的
        // camera 骨。背景板直接绑定它相对 t=0 的仿射变换，与骨架内水花
        // 严格同变换——之前用本体槽位统计近似，角色身体局部动画（前倾/挥手）
        // 会把背景板带着一起晃，水花就溢出浴缸了
        let sceneBone: any = null
        if (dir === 'spine_skillcut') {
          const want = overrides[name]?.sceneBone
          const boneData: any = want
            ? data.bones.find((b: any) => String(b.name).toLowerCase() === want.toLowerCase())
            : data.bones.find((b: any) => /^camera$/i.test(String(b.name)))
          sceneBone = boneData
            ? skeleton.bones.find((b: any) => b.data === boneData || b.data?.name === boneData.name) || null
            : null
        }
        /** 「body」模式的缩放轴心骨（例如 hl1_body）：沿用它才能让校准
            导出的偏移在 t=0 与俯冲特写之间严格按缩放倍率对应 */
        let pivotBoneObj: any = null
        if (dir === 'spine_skillcut' && overrides[name]?.pivotBone) {
          const pb: any = data.bones.find((b: any) => String(b.name) === overrides[name]!.pivotBone)
          pivotBoneObj = pb ? skeleton.bones.find((b: any) => b.data === pb) || null : null
        }
        /** 轴心骨在 t=0 与切镜时刻的世界位置（分别供两张背景板使用） */
        let pivotBone0: { x: number; y: number } | null = null
        let pivotBoneCut: { x: number; y: number } | null = null
        /** 双背景切镜点：camera 骨平移的最大不连续处（Infinity = 无 bg2/无切镜） */
        let sceneCut = Infinity
        if (dir === 'spine_skillcut') {
          // 大招动画把角色的运镜烤进了骨架位移（游戏里是 Cinemachine 跟拍），
          // 按 t=0 的骨架 bounds 取景会随播放把角色甩出画面外。
          // 采样动画全程的「实际可见内容」包围盒：剔除离群样本后取稳健并集
          // （相机的活动限位），再用「安静半场」（面积较小的一半样本 ≈ 角色
          // 本体的典型范围，FX 突发被排除）决定取景与场景背景板的比例——
          // 否则被 FX 撑大的并集会把背景板/角色比例搞得失调。
          const track0: any = state.getCurrent(0)
          const SAMPLE_N = 16
          const samples: Array<[number, number, number, number]> = []
          const sampleTimes: number[] = []
          const slotAreaSamples: number[][] = []
          const slotCenterSamples: Array<Array<[number, number]>> = []
          for (let i = 0; i < SAMPLE_N; i++) {
            const st = (i / SAMPLE_N) * duration
            if (track0) track0.trackTime = st
            state.update(0)
            state.apply(skeleton)
            applyHiddenSlots(skeleton)
            skeleton.updateWorldTransform()
            const b = contentBounds(skeleton)
            if (b) {
              samples.push(b)
              sampleTimes.push(st)
              slotAreaSamples.push(collectSlotAreas(skeleton))
              slotCenterSamples.push(collectSlotCenters(skeleton))
            }
          }
          if (samples.length) {
            const med = (arr: number[]) => {
              const s = [...arr].sort((a, b) => a - b)
              return s[Math.floor(s.length / 2)]
            }
            const area = (b: [number, number, number, number]) => (b[2] - b[0]) * (b[3] - b[1])
            const medW0 = med(samples.map((b) => b[2] - b[0]))
            const medH0 = med(samples.map((b) => b[3] - b[1]))
            const keptIdx = samples
              .map((b, i) => i)
              .filter((i) => samples[i][2] - samples[i][0] <= medW0 * 8 && samples[i][3] - samples[i][1] <= medH0 * 8)
            const useIdx = keptIdx.length ? keptIdx : samples.map((_, i) => i)
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
            for (const i of useIdx) {
              const b = samples[i]
              x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1])
              x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3])
            }
            if (x1 > x0 && y1 > y0) {
              unionRect = [x0, y0, x1, y1]
              // 双背景切镜点：camera 骨平移的最大不连续处（粗采样定位 → 细采样
              // 收窄）。切镜瞬间背景板与角色一起瞬移，第二张场景图从此时换用。
              // 检测放在分段统计之前，样本要按 t < cut / t ≥ cut 分镜
              if (sceneBg2 && sceneBone && duration > 0) {
                const st0 = state!
                const sk0 = skeleton!
                const camPos = (tt: number): [number, number] => {
                  if (track0) track0.trackTime = tt
                  st0.update(0)
                  st0.apply(sk0)
                  sk0.updateWorldTransform()
                  return [sceneBone.worldX, sceneBone.worldY]
                }
                const COARSE = 16
                const pts: Array<[number, number, number]> = []
                for (let i = 0; i <= COARSE; i++) {
                  const tt = (i / COARSE) * duration
                  const pp = camPos(tt)
                  pts.push([tt, pp[0], pp[1]])
                }
                let bi = 0
                let bj = -1
                for (let i = 0; i < COARSE; i++) {
                  const dd = Math.hypot(pts[i + 1][1] - pts[i][1], pts[i + 1][2] - pts[i][2])
                  if (dd > bj) { bj = dd; bi = i }
                }
                if (bj > 1) {
                  const FINE = 16
                  let fa = pts[bi][0]
                  let fb = pts[bi + 1][0]
                  let fj = bj
                  for (let i = 0; i < FINE; i++) {
                    const t0 = pts[bi][0] + ((pts[bi + 1][0] - pts[bi][0]) * i) / FINE
                    const t1 = pts[bi][0] + ((pts[bi + 1][0] - pts[bi][0]) * (i + 1)) / FINE
                    const p0 = camPos(t0)
                    const p1 = camPos(t1)
                    const dd = Math.hypot(p1[0] - p0[0], p1[1] - p0[1])
                    if (dd >= fj) { fj = dd; fa = t0; fb = t1 }
                  }
                  sceneCut = (fa + fb) / 2
                  // 记录跳变完成时刻（fb）的 camera 矩阵——bg2 的相对变换以它
                  // 为参考帧。bone5 的 +4590 大跳变是把上一镜内容停走，不是
                  // 镜头移动，第二镜里 camera 骨保持静止（相对变换 = 恒等）
                  if (track0) track0.trackTime = fb
                  state.update(0)
                  state.apply(skeleton)
                  skeleton.updateWorldTransform()
                  sceneBoneCut = { a: sceneBone.a, b: sceneBone.b, c: sceneBone.c, d: sceneBone.d, x: sceneBone.worldX, y: sceneBone.worldY }
                  if (pivotBoneObj) {
                    pivotBoneCut = { x: pivotBoneObj.worldX, y: pivotBoneObj.worldY }
                  }
                }
              }
              // 按切镜点把样本分成两镜，各自算安静半场与本体槽位
              const segOf = (idxList: number[]) => {
                const calmIdx = [...idxList]
                  .sort((a, b) => area(samples[a]) - area(samples[b]))
                  .slice(0, Math.max(3, Math.floor(idxList.length / 2)))
                const cW = med(calmIdx.map((i) => samples[i][2] - samples[i][0]))
                const cH = med(calmIdx.map((i) => samples[i][3] - samples[i][1]))
                const cCx = med(calmIdx.map((i) => (samples[i][0] + samples[i][2]) / 2))
                const cCy = med(calmIdx.map((i) => (samples[i][1] + samples[i][3]) / 2))
                // 本体槽位：该镜安静半场里 ≥70% 样本可见的槽位按面积中位数排序
                // 取前 24 个；缩放基准取各样本「本体面积中位数」的低分位
                const visCount = new Map<number, number>()
                for (const i of calmIdx) {
                  const areas = slotAreaSamples[i]
                  for (let s = 0; s < areas.length; s++) {
                    if (areas[s] > 0) visCount.set(s, (visCount.get(s) || 0) + 1)
                  }
                }
                const need = Math.ceil(calmIdx.length * 0.7)
                const cand = [...visCount.entries()]
                  .filter(([, c]) => c >= need)
                  .map(([s]) => {
                    const list = calmIdx
                      .map((i) => slotAreaSamples[i][s])
                      .filter((a) => a > 0)
                      .sort((a, b) => a - b)
                    return [s, list[Math.floor(list.length / 2)]] as [number, number]
                  })
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 24)
                let slots: Set<number> | null = null
                let ref = 0
                let bodyCx: number | null = null
                let bodyCy: number | null = null
                if (cand.length >= 8) {
                  const set = new Set(cand.map(([s]) => s))
                  const centers: Array<[number, number]> = []
                  for (const i of calmIdx) {
                    const cs = slotCenterSamples[i]
                    const xs: number[] = []
                    const ys: number[] = []
                    for (const s of set) {
                      if (cs[s] && (cs[s][0] || cs[s][1])) { xs.push(cs[s][0]); ys.push(cs[s][1]) }
                    }
                    if (xs.length >= 6) centers.push([med(xs), med(ys)])
                  }
                  if (centers.length >= 3) {
                    bodyCx = med(centers.map((c) => c[0]))
                    bodyCy = med(centers.map((c) => c[1]))
                  }
                  const perSample = calmIdx
                    .map((i) => {
                      const list = [...set]
                        .map((s) => slotAreaSamples[i][s])
                        .filter((a) => a > 0)
                        .sort((a, b) => a - b)
                      return list.length >= 6 ? list[Math.floor(list.length / 2)] : 0
                    })
                    .filter((a) => a > 0)
                    .sort((a, b) => a - b)
                  if (perSample.length) {
                    slots = set
                    ref = perSample[Math.min(perSample.length - 1, Math.floor(perSample.length * 0.2))]
                  }
                }
                return { calm: { cx: cCx, cy: cCy, w: cW, h: cH }, slots, ref, bodyCx, bodyCy }
              }
              const preIdx = useIdx.filter((i) => sampleTimes[i] < sceneCut)
              const postIdx = useIdx.filter((i) => sampleTimes[i] >= sceneCut)
              const seg0 = segOf(preIdx.length >= 3 ? preIdx : useIdx)
              calmRect = seg0.calm
              if (seg0.slots) { bodySlots = seg0.slots; areaRef = seg0.ref }
              if (sceneBg2 && postIdx.length >= 3) {
                const seg1 = segOf(postIdx)
                calmRect2 = { ...seg1.calm, ref: seg1.ref, bodyCx: seg1.bodyCx, bodyCy: seg1.bodyCy }
                if (seg1.slots) bodySlots2 = seg1.slots
              }
              // 初始取景：第一镜典型范围 ×1.25 与并集的交集（交集退化则回退并集）
              const cW = calmRect.w
              const cH = calmRect.h
              const cCx = calmRect.cx
              const cCy = calmRect.cy
              const winW = cW * 1.25
              const winH = cH * 1.25
              const ix0 = Math.max(x0, cCx - winW / 2)
              const iy0 = Math.max(y0, cCy - winH / 2)
              const ix1 = Math.min(x1, cCx + winW / 2)
              const iy1 = Math.min(y1, cCy + winH / 2)
              if (ix1 - ix0 > cW * 0.4 && iy1 - iy0 > cH * 0.4) {
                bw = ix1 - ix0
                bh = iy1 - iy0
                cx0 = (ix0 + ix1) / 2
                cy0 = (iy0 + iy1) / 2
              } else {
                bw = x1 - x0
                bh = y1 - y0
                cx0 = (x0 + x1) / 2
                cy0 = (y0 + y1) / 2
              }
              framed = true
            }
          }
          // 采样后把动画拨回开头，与外部预期的初始状态一致
          if (track0) track0.trackTime = 0
          state.update(0)
          state.apply(skeleton)
          applyHiddenSlots(skeleton)
          skeleton.updateWorldTransform()
        }
        // 运镜骨骼 t=0 基准矩阵（拟合块最后已把动画拨回开头）
        let sceneBone0: { a: number; b: number; c: number; d: number; x: number; y: number } | null = null
        if (sceneBone) {
          sceneBone0 = { a: sceneBone.a, b: sceneBone.b, c: sceneBone.c, d: sceneBone.d, x: sceneBone.worldX, y: sceneBone.worldY }
        }
        if (pivotBoneObj) {
          pivotBone0 = { x: pivotBoneObj.worldX, y: pivotBoneObj.worldY }
        }
        if (dir === 'spine_skillcut' && sceneBg2) {
          setCalibCut(sceneCut === Infinity ? null : sceneCut)
        }
        if (!framed) {
          skeleton.getBounds(offset, size, [])
          bw = Math.max(1, size.x)
          bh = Math.max(1, size.y)
          cx0 = offset.x + bw / 2
          cy0 = offset.y + bh / 2
        }
        // 场景背景板：安静半场典型范围 ×1.15（max 维度），中心=典型中心——
        // 与角色本体成比例，随相机跟拍在画面里平移；舞台 overflow hidden 裁边。
        // 播放期间逐帧被 sceneBgUpdate 重写（绑定 camera 运镜骨或本体统计）
        let sceneRect: { cx: number; cy: number; side: number; rot: number } | null = calmRect
          ? {
              cx: calmRect.cx,
              cy: calmRect.cy,
              side: Math.max(calmRect.w, calmRect.h) * 1.15,
              rot: 0,
            }
          : unionRect
            ? {
                cx: (unionRect[0] + unionRect[2]) / 2,
                cy: (unionRect[1] + unionRect[3]) / 2,
                side: Math.min(unionRect[2] - unionRect[0], unionRect[3] - unionRect[1]),
                rot: 0,
              }
            : sceneBg
              ? { cx: cx0, cy: cy0, side: Math.min(bw, bh), rot: 0 }
              : null
        /** 背景板初始边长：运行期按表观缩放 k(t) 乘上去 */
        const sceneSide0 = sceneRect?.side ?? 0
        /** 背景板初始中心：camera 骨相对变换作用的原点 */
        const sceneCenter0 = sceneRect ? { x: sceneRect.cx, y: sceneRect.cy } : null
        /** 复位视图时背景板直接吸附到目标，不经过渐近 */
        let sceneSnap = false
        /** 第二张背景板（多镜大招）：基准取「切镜后样本」的安静半场（第二镜
            的角色摆位与第一镜无关），变换以切镜时刻的 camera 矩阵为基准 */
        const sceneRect2 =
          sceneBg2 && sceneRect
            ? {
                // 中心用第二镜「身体槽位中位」的典型位置（内容 bbox 被 FX 撑大）
                cx: calmRect2?.bodyCx ?? sceneRect.cx,
                cy: calmRect2?.bodyCy ?? sceneRect.cy,
                // 两张板来自同一张 512² 帧图集，游戏里按各自粒子尺寸铺在
                // 镜头前；这里以第一镜的自然边长为基准，具体倍率交给
                // spine_overrides.json 的 sceneBgBases[1].sideMul 校准
                side: sceneRect.side,
                rot: 0,
              }
            : null
        /** 每张背景的初始世界基准（矩形中心 + 边长）。override 的
            sceneBgBases[i] = { sideMul, cxOffPct, cyOffPct }：side_i = side0×mul，
            中心按各自身长的百分比偏移；缺省全部用校准拟合出的基准矩形 */
        const sceneBases: Array<{ cx: number; cy: number; side: number }> = (() => {
          // 没有场景背景板（非大招模型、或大招模型没有 bg 图）时 sceneCenter0
          // 为 null：这里直接返回空表，不能解引用——否则每个普通模型都会在
          // 初始化时抛 TypeError，被 catch 成「模型加载失败」退回静态图
          if (!sceneCenter0) return []
          const cfg = overrides[name]?.sceneBgBases
          const mk = (i: number, base: { cx: number; cy: number; side: number }) => {
            const c = cfg?.[i]
            const side = base.side * (c?.sideMul ?? 1)
            return {
              cx: base.cx + ((c?.cxOffPct ?? 0) / 100) * side,
              cy: base.cy + ((c?.cyOffPct ?? 0) / 100) * side,
              side,
            }
          }
          const arr = [mk(0, { cx: sceneCenter0!.x, cy: sceneCenter0!.y, side: sceneSide0 })]
          if (sceneRect2) arr.push(mk(1, { cx: sceneRect2.cx, cy: sceneRect2.cy, side: sceneRect2.side }))
          return arr
        })()
        let fitScale = 1
        const view = { zoom: 1, cx: cx0, cy: cy0 }
        /** 相机跟拍开关：大招默认开启，用户拖拽/滚轮接管后关闭，复位恢复 */
        let follow = dir === 'spine_skillcut' && framed

        const apply = () => {
          const el = boxRef.current
          if (!el || !scene) return
          const W = Math.max(1, el.clientWidth)
          const H = Math.max(1, el.clientHeight)
          const z = fitScale * view.zoom
          const cam = scene.camera
          cam.position.set(view.cx, view.cy, 0)
          cam.up.set(0, 1, 0)
          cam.direction.set(0, 0, -1)
          cam.viewportWidth = W / z
          cam.viewportHeight = H / z
          cam.update()
          gl.viewport(0, 0, canvas.width, canvas.height)

          // 场景背景层：世界矩形 → 屏幕矩形（与骨架共用同一相机）。
          // 多镜大招有两张板，按切镜点只显示当前那张
          const sb = sceneBgRef.current
          const sb2 = sceneBg2Ref.current
          const active = activeBg()
          if (sb && sceneRect) {
            const side = sceneRect.side * z
            sb.style.left = `${W / 2 + (sceneRect.cx - sceneRect.side / 2 - view.cx) * z}px`
            sb.style.top = `${H / 2 - (sceneRect.cy + sceneRect.side / 2 - view.cy) * z}px`
            sb.style.width = `${side}px`
            sb.style.height = `${side}px`
            sb.style.transformOrigin = '50% 50%'
            sb.style.transform = sceneRect.rot ? `rotate(${sceneRect.rot.toFixed(3)}deg)` : ''
            sb.style.visibility = active === 0 ? 'visible' : 'hidden'
          }
          if (sb2 && sceneRect2) {
            const side = sceneRect2.side * z
            sb2.style.left = `${W / 2 + (sceneRect2.cx - sceneRect2.side / 2 - view.cx) * z}px`
            sb2.style.top = `${H / 2 - (sceneRect2.cy + sceneRect2.side / 2 - view.cy) * z}px`
            sb2.style.width = `${side}px`
            sb2.style.height = `${side}px`
            sb2.style.transformOrigin = '50% 50%'
            sb2.style.transform = sceneRect2.rot ? `rotate(${sceneRect2.rot.toFixed(3)}deg)` : ''
            sb2.style.visibility = active === 1 ? 'visible' : 'hidden'
          }

          // 把 WebGL 相机的变换换算成 CSS translate/scale（transform-origin: 0 0），
          // 让外层独立背景层与人物共用同一取景、一起缩放平移。
          // contain 模式不留白，背景图才能和人物严格同框；cover 模式保留 0.96。
          const fitPad = fitMode === 'cover' ? 0.96 : 1
          const s = view.zoom * fitPad
          const dx = (cx0 - view.cx) * z
          const dy = (view.cy - cy0) * z
          bgTransform = {
            scale: s,
            tx: (1 - s) * W / 2 + dx,
            ty: (1 - s) * H / 2 + dy,
          }
          callbacks.current.onView?.(bgTransform)
        }

        /**
         * 相机跟拍：视角平滑追随当前可见内容的中心（限制在内容并集内），
         * 场景背景板随之在画面里平移——复现游戏里 Cinemachine 跟拍的观感。
         * 用户拖拽/滚轮会关闭跟随（follow=false），复位时恢复。
         */
        const followUpdate = (stats: { cx: number; cy: number }) => {
          if (!scene || !unionRect) return
          const vw = scene.camera.viewportWidth
          const vh = scene.camera.viewportHeight
          const [ux0, uy0, ux1, uy1] = unionRect
          let tx = stats.cx
          let ty = stats.cy
          tx = vw >= ux1 - ux0 ? (ux0 + ux1) / 2
            : Math.min(Math.max(tx, ux0 + vw / 2), ux1 - vw / 2)
          ty = vh >= uy1 - uy0 ? (uy0 + uy1) / 2
            : Math.min(Math.max(ty, uy0 + vh / 2), uy1 - vh / 2)
          view.cx += (tx - view.cx) * 0.06
          view.cy += (ty - view.cy) * 0.06
        }

        /** 校准模式：最近一帧的自然矩形 + 骨架矩阵（不含用户微调），供记录导出 */
        let calibBase: Omit<CalibSnapshot, 'anim' | 't' | 'dxPct' | 'dyPct' | 'scale' | 'rot'> | null = null
        const dumpBone = (b: any): CalibBoneDump | null =>
          b ? { name: String(b.data?.name ?? ''), m: [b.a, b.b, b.c, b.d, b.worldX, b.worldY] } : null
        /** 把校准面板的微调量叠加到当前矩形上 */
        /** 把校准面板的微调量叠加到指定背景的矩形上（calibAdj 按背景分槽） */
        const applyCalibAdj = (idx: number) => {
          const cal = calibRef.current[idx]
          if (!cal) return
          const rect = idx === 1 ? sceneRect2 : sceneRect
          if (!rect) return
          const baseSide = sceneBases[idx]?.side ?? sceneSide0
          if (!cal.dxPct && !cal.dyPct && cal.scale === 1 && !cal.rot) return
          rect.cx += (cal.dxPct / 100) * baseSide
          rect.cy += (cal.dyPct / 100) * baseSide
          rect.side *= cal.scale
          rect.rot += cal.rot
        }
        /** camera 骨相对参考帧（bg1 用 t=0，bg2 用切镜时刻）的仿射变换：
            r = 旋转/缩放分量，t = 平移分量，k = 表观缩放，rot = CSS 旋转角 */
        const camRel = (m0: { a: number; b: number; c: number; d: number; x: number; y: number }) => {
          const det0 = m0.a * m0.d - m0.c * m0.b || 1
          const i11 = m0.d / det0, i12 = -m0.c / det0, i21 = -m0.b / det0, i22 = m0.a / det0
          const a = sceneBone!.a, b = sceneBone!.b, c = sceneBone!.c, d = sceneBone!.d
          const r11 = a * i11 + c * i21
          const r12 = a * i12 + c * i22
          const r21 = b * i11 + d * i21
          const r22 = b * i12 + d * i22
          const qx = i11 * m0.x + i12 * m0.y
          const qy = i21 * m0.x + i22 * m0.y
          return {
            r11, r12, r21, r22,
            tx: sceneBone!.worldX - (a * qx + c * qy),
            ty: sceneBone!.worldY - (b * qx + d * qy),
            k: Math.max(0.05, Math.sqrt(Math.abs(r11 * r22 - r12 * r21))),
            rot: -Math.atan2(r21, r11) * 180 / Math.PI,
          }
        }
        /** 跟拍/吸附目标：当前镜的本体槽位统计 → 全槽位统计。多镜大招每个
            镜头可能用不同槽位组画角色（c352 第二镜的 hailun* 第一镜槽全被
            换装），所以要按当前镜选槽位集合。背景板是否跟随由 sceneBone /
            sceneBgPivot 决定，视角这里始终以角色为准（游戏镜头跟拍角色） */
        const followTarget = (): { cx: number; cy: number } | null => {
          const idx = activeBg()
          const slots = (idx === 1 ? bodySlots2 : bodySlots) ?? undefined
          const st = contentStats(skeleton!, slots) ?? contentStats(skeleton!)
          if (st) return { cx: st.cx, cy: st.cy }
          if (sceneBone && sceneBases.length) {
            const ref = idx === 1 && sceneBoneCut ? sceneBoneCut : sceneBone0
            if (!ref) return null
            const rel = camRel(ref)
            const base = sceneBases[idx] || sceneBases[0]
            return {
              cx: rel.r11 * base.cx + rel.r12 * base.cy + rel.tx,
              cy: rel.r21 * base.cx + rel.r22 * base.cy + rel.ty,
            }
          }
          return null
        }
        /** 覆盖补偿是否允许（校准模式关闭，保证记录的微调量相对自然矩形） */
        const coverageAllowed = () => !calibOnRef.current
        /** 当前应显示哪张背景：0 = bg，1 = bg2（无 bg2 恒为 0） */
        const activeBg = () => (sceneRect2 && currentTime() >= sceneCut ? 1 : 0)

        /**
         * 场景背景板跟随。首选：绑定 rig 自带的 camera 运镜骨骼——水花等
         * 场景件挂在这条链下，背景板套用「camera 骨相对 t=0 的仿射变换」，
         * 与骨架内的水花保持严格同变换（浴缸/水永不错位，也不会跟着角色
         * 身体的局部动画晃动）。没有 camera 骨的模型退回本体槽位统计近似
         * （中心=本体中心中位数、边长=面积中位数估出的表观缩放），该路径
         * 用小步长渐进平滑。
         */
        const sceneBgUpdate = (stats: { cx: number; cy: number; medArea?: number } | null) => {
          if (!sceneRect || !framed || !sceneCenter0) return
          /** 校准面板 / 记录用的骨架矩阵快照 */
          const dumpTree = () => ({
            camBone: dumpBone(sceneBone),
            camParent: sceneBone ? dumpBone(sceneBone.parent) : null,
            camChildren: ((sceneBone?.children || []) as any[])
              .map((c: any) => dumpBone(c))
              .filter((x: CalibBoneDump | null): x is CalibBoneDump => !!x),
          })
          // 刚性挂骨：第二镜人物会连续下沉+放大（hl2_Body_1 缩放 1.27→1.68），
          // 背景按该骨的实时变换运动，避免关键帧之间线性插值与人物脱节
          const active = activeBg()
          const bind = overrides[name]?.sceneBgBoneBinds?.[active]
          if (bind) {
            const bb: any = skeleton!.bones.find((b: any) => String(b.data?.name) === bind.bone)
            if (bb) {
              const det = bb.a * bb.d - bb.b * bb.c
              const s = Math.sqrt(Math.abs(det))
              const rect = active === 1 ? sceneRect2 : sceneRect
              if (rect) {
                rect.cx = bb.worldX + bind.vx * s
                rect.cy = bb.worldY + bind.vy * s
                rect.side = bind.side * s
                rect.rot = 0
              }
              if (calibOnRef.current) {
                const base = sceneBases[active] || sceneBases[0]
                const cur = rect || sceneRect
                calibBase = {
                  bgIndex: active,
                  side0: base.side,
                  center0: [base.cx, base.cy],
                  baseCx: cur.cx,
                  baseCy: cur.cy,
                  baseSide: cur.side,
                  baseRot: cur.rot,
                  ...dumpTree(),
                }
              }
              applyCalibAdj(active)
              return
            }
          }
          // 关键帧轨道：直接使用校准导出的绝对世界矩形（可复现骨骼上不存在的
          // 独立镜头推拉，例如第二镜结尾背景自己放大到 1.19×）
          const keys = overrides[name]?.sceneBgKeys
          const track = keys?.[active]
          if (track && track.length) {
            const t = currentTime()
            const arr = [...track].sort((a, b) => a.t - b.t)
            let kf: { t: number; cx: number; cy: number; side: number; rot?: number } | null = null
            // 由骨骼缩放驱动的插值参数：第二镜人物下沉/放大是骨骼连续动画，
            // 用它的缩放进度 u 来插值端点，比按时间线性插值贴合人物得多
            const drive = overrides[name]?.sceneBgKeyDrive?.[active]
            if (drive && arr.length >= 2) {
              const db: any = skeleton!.bones.find((b: any) => String(b.data?.name) === drive.bone)
              if (db) {
                const ds = Math.sqrt(Math.abs(db.a * db.d - db.b * db.c))
                const u = Math.min(1, Math.max(0, (ds - drive.s0) / (drive.s1 - drive.s0 || 1)))
                const a = arr[0]
                const z = arr[arr.length - 1]
                kf = {
                  t,
                  cx: a.cx + (z.cx - a.cx) * u,
                  cy: a.cy + (z.cy - a.cy) * u,
                  side: a.side + (z.side - a.side) * u,
                  rot: (a.rot ?? 0) + ((z.rot ?? 0) - (a.rot ?? 0)) * u,
                }
              }
            }
            if (!kf) {
              kf = arr[0]
              if (t >= arr[arr.length - 1].t) {
                kf = arr[arr.length - 1]
              } else if (t > arr[0].t) {
                for (let i = 0; i < arr.length - 1; i++) {
                  if (t >= arr[i].t && t <= arr[i + 1].t) {
                    const f = (t - arr[i].t) / (arr[i + 1].t - arr[i].t || 1)
                    kf = {
                      t,
                      cx: arr[i].cx + (arr[i + 1].cx - arr[i].cx) * f,
                      cy: arr[i].cy + (arr[i + 1].cy - arr[i].cy) * f,
                      side: arr[i].side + (arr[i + 1].side - arr[i].side) * f,
                      rot: (arr[i].rot ?? 0) + ((arr[i + 1].rot ?? 0) - (arr[i].rot ?? 0)) * f,
                    }
                    break
                  }
                }
              }
            }
            const rect = active === 1 ? sceneRect2 : sceneRect
            if (rect) {
              rect.cx = kf.cx
              rect.cy = kf.cy
              rect.side = kf.side
              rect.rot = kf.rot || 0
            }
            if (calibOnRef.current) {
              const base = sceneBases[active] || sceneBases[0]
              calibBase = {
                bgIndex: active,
                side0: base.side,
                center0: [base.cx, base.cy],
                baseCx: kf.cx,
                baseCy: kf.cy,
                baseSide: kf.side,
                baseRot: kf.rot || 0,
                ...dumpTree(),
              }
            }
            applyCalibAdj(active)
            return
          }
          // 「镜头式」绑定：只取运镜骨的缩放/旋转，以身体骨为轴心。
          // 游戏里角色俯冲 3.22× 是镜头推近，背景应绕角色一起放大；直接套
          // bone 的完整仿射会连它远离角色的世界原点一起缩放，面板被甩出屏。
          if (pivotBody && stats && sceneBone && sceneBone0 && sceneBases.length) {
            if (!bodyCenter0) bodyCenter0 = { x: stats.cx, y: stats.cy }
            const base0 = sceneBases[0]
            const base1 = sceneBases[1] || sceneBases[0]
            const rel0 = camRel(sceneBone0!)
            const rel1 = camRel(sceneBoneCut ?? sceneBone0!)
            const followOne = (
              base: { cx: number; cy: number; side: number },
              rel: { r11: number; r12: number; r21: number; r22: number; k: number; rot: number },
              pivot0: { x: number; y: number },
              pivotNow: { x: number; y: number },
            ) => {
              const k = Math.min(3.6, rel.k)
              const ox = (base.cx - pivot0.x) * k
              const oy = (base.cy - pivot0.y) * k
              return {
                cx: pivotNow.x + rel.r11 * ox + rel.r12 * oy,
                cy: pivotNow.y + rel.r21 * ox + rel.r22 * oy,
                side: base.side * k,
                rot: rel.rot,
              }
            }
            // 轴心：优先用配置的身体骨（hl1_body），它会随角色一起被俯冲
            // 缩放；没有配置才退回可见内容的中位中心
            const useBone = !!(pivotBoneObj && pivotBone0)
            const pivotNow = useBone ? { x: pivotBoneObj.worldX, y: pivotBoneObj.worldY } : { x: stats.cx, y: stats.cy }
            const bodyCenterCut =
              calmRect2?.bodyCx != null && calmRect2?.bodyCy != null
                ? { x: calmRect2.bodyCx, y: calmRect2.bodyCy }
                : bodyCenter0!
            const pivotCut = (useBone && pivotBoneCut) ? pivotBoneCut : bodyCenterCut
            const r0 = followOne(base0, rel0, useBone ? pivotBone0! : bodyCenter0!, pivotNow)
            sceneRect.cx = r0.cx
            sceneRect.cy = r0.cy
            sceneRect.side = r0.side
            sceneRect.rot = r0.rot
            if (sceneRect2) {
              const r1 = followOne(base1, rel1, pivotCut, pivotNow)
              sceneRect2.cx = r1.cx
              sceneRect2.cy = r1.cy
              sceneRect2.side = r1.side
              sceneRect2.rot = r1.rot
            }
            if (calibOnRef.current) {
              const base = active === 1 ? base1 : base0
              const cur = active === 1 ? (sceneRect2 || r0) : sceneRect
              calibBase = {
                bgIndex: active,
                side0: base.side,
                center0: [base.cx, base.cy],
                baseCx: cur.cx,
                baseCy: cur.cy,
                baseSide: cur.side,
                baseRot: cur.rot,
                ...dumpTree(),
              }
            }
            applyCalibAdj(0)
            applyCalibAdj(1)
            return
          }
          if (sceneBone && sceneBone0 && sceneSide0) {
            const active = activeBg()
            const base0 = sceneBases[0]
            const base1 = sceneBases[1] || sceneBases[0]
            const rel0 = camRel(sceneBone0!)
            const rel1 = camRel(sceneBoneCut ?? sceneBone0!)
            const anchorOf = (rel: typeof rel0, bx: number, by: number) => ({
              x: rel.r11 * bx + rel.r12 * by + rel.tx,
              y: rel.r21 * bx + rel.r22 * by + rel.ty,
            })
            const p0 = anchorOf(rel0, base0.cx, base0.cy)
            const p1 = anchorOf(rel1, base1.cx, base1.cy)
            const n0 = base0.side * rel0.k
            const n1 = base1.side * rel1.k
            const rot = rel0.rot
            const rot1 = rel1.rot
            // 覆盖补偿：角色冲出场景锚点（俯冲/特写）时跟拍视角跟着走，画面
            // 一角会露出舞台底色——此时以锚点为中心把面板放大到也盖住视口
            // （纹理绕锚点缩放，水/浴缸对齐不变）。锚点还在视口内时不扩，
            // 保留初始构图的留白；扩幅封顶 3×，切镜滑移时不会出现巨幅糊 zoom。
            // 校准模式下跳过（记录的微调量要相对自然矩形，方便离线拟合）。
            // 只作用在当前显示的那张板上，另一张保持自然尺寸。
            let covSide: number | null = null
            if (coverageAllowed() && follow && scene) {
              const anchor = active === 1 ? p1 : p0
              const cam = scene.camera
              const halfW = cam.viewportWidth / 2
              const halfH = cam.viewportHeight / 2
              const outside = anchor.x < view.cx - halfW || anchor.x > view.cx + halfW
                || anchor.y < view.cy - halfH || anchor.y > view.cy + halfH
              if (outside) {
                const dx0 = Math.abs(view.cx - halfW - anchor.x)
                const dx1 = Math.abs(view.cx + halfW - anchor.x)
                const dy0 = Math.abs(view.cy - halfH - anchor.y)
                const dy1 = Math.abs(view.cy + halfH - anchor.y)
                covSide = Math.min(
                  (active === 1 ? n1 : n0) * 3,
                  Math.max(active === 1 ? n1 : n0, 2 * Math.max(dx0, dx1, dy0, dy1)),
                )
              }
            }
            sceneRect.cx = p0.x
            sceneRect.cy = p0.y
            sceneRect.side = active === 0 ? (covSide ?? n0) : n0
            sceneRect.rot = rot
            if (sceneRect2) {
              sceneRect2.cx = p1.x
              sceneRect2.cy = p1.y
              sceneRect2.side = active === 1 ? (covSide ?? n1) : n1
              sceneRect2.rot = rot1
            }
            if (calibOnRef.current) {
              const base = active === 1 ? base1 : base0
              const anchor = active === 1 ? p1 : p0
              calibBase = {
                bgIndex: active,
                side0: base.side,
                center0: [base.cx, base.cy],
                baseCx: anchor.x,
                baseCy: anchor.y,
                baseSide: active === 1 ? (covSide ?? n1) : (covSide ?? n0),
                baseRot: rot,
                camBone: dumpBone(sceneBone),
                camParent: dumpBone(sceneBone.parent),
                camChildren: (sceneBone.children || [])
                  .map((c: any) => dumpBone(c))
                  .filter((x: CalibBoneDump | null): x is CalibBoneDump => !!x),
              }
            }
            applyCalibAdj(0)
            applyCalibAdj(1)
            return
          }
          if (!stats || areaRef <= 0 || !sceneSide0) return
          const k = Math.min(4, Math.max(0.5, Math.sqrt((stats.medArea ?? 0) / areaRef)))
          const tx = stats.cx
          const ty = stats.cy
          const tside = sceneSide0 * k
          if (sceneSnap) {
            sceneRect.cx = tx
            sceneRect.cy = ty
            sceneRect.side = tside
            sceneSnap = false
          } else {
            sceneRect.cx += (tx - sceneRect.cx) * 0.08
            sceneRect.cy += (ty - sceneRect.cy) * 0.08
            sceneRect.side += (tside - sceneRect.side) * 0.08
          }
          if (calibOnRef.current) {
            calibBase = {
              bgIndex: 0,
              side0: sceneSide0,
              center0: [sceneCenter0.x, sceneCenter0.y],
              baseCx: sceneRect.cx,
              baseCy: sceneRect.cy,
              baseSide: sceneRect.side,
              baseRot: sceneRect.rot,
              camBone: null,
              camParent: null,
              camChildren: [],
            }
          }
          applyCalibAdj(0)
        }

        /** 把当前姿态画一帧。渲染循环和「尺寸变化后立即补帧」共用。 */
        const drawFrame = () => {
          if (!scene || !state || !skeleton) return
          state.apply(skeleton)
          applyHiddenSlots(skeleton)
          skeleton.updateWorldTransform()
          if (framed && (follow || sceneRect)) {
            const stats = followTarget()
            if (stats) {
              if (follow) followUpdate(stats)
              sceneBgUpdate(stats)
            }
          }
          apply()
          gl.clearColor(0, 0, 0, 0)
          gl.clear(gl.COLOR_BUFFER_BIT)
          scene.begin()
          // 按 z 序绘制：z<0 的 BG 层在下，主模型居中，z>0 的 FG 层（帘子）在上。
          const below = extraLayers.filter((L) => L.z < 0)
          const above = extraLayers.filter((L) => L.z > 0)
          for (const L of below) {
            L.state.apply(L.skeleton)
            L.skeleton.updateWorldTransform()
            scene.drawSkeleton(L.skeleton, L.premultiplied)
          }
          scene.drawSkeleton(skeleton, premultiplied)
          for (const L of above) {
            L.state.apply(L.skeleton)
            L.skeleton.updateWorldTransform()
            scene.drawSkeleton(L.skeleton, L.premultiplied)
          }
          scene.end()
        }

        /**
         * 容器尺寸变化时重设 canvas。注意给 canvas.width/height 赋值会清空 WebGL
         * drawing buffer，若只等下一个 rAF 补画，收起/展开侧栏的过渡里每一帧都会
         * 闪一下空白 —— 所以在同一个同步调用里立刻 drawFrame() 补回来。
         * resetView=false 时保留用户已经缩放/平移的视图。
         */
        const fit = (resetView = false) => {
          const el = boxRef.current
          if (!el || !scene) return
          const dpr = Math.min(2, window.devicePixelRatio || 1)
          const W = Math.max(1, el.clientWidth)
          const H = Math.max(1, el.clientHeight)
          const cw = Math.round(W * dpr)
          const ch = Math.round(H * dpr)
          const sizeChanged = canvas.width !== cw || canvas.height !== ch
          if (sizeChanged) {
            canvas.width = cw
            canvas.height = ch
            canvas.style.width = W + 'px'
            canvas.style.height = H + 'px'
            fitScale = (fitMode === 'cover'
              ? Math.max(W / bw, H / bh)
              : Math.min(W / bw, H / bh)) * (fitMode === 'cover' ? 0.96 : 1)
          }
          if (resetView) {
            view.zoom = 1
            view.cx = cx0
            view.cy = cy0
            zoom = 1
            follow = cinemaOn && dir === 'spine_skillcut' && framed // 复位后恢复相机跟拍
            sceneSnap = true // 背景板吸附回当前时刻的角色位置/比例
          }
          apply()
          if (sizeChanged) drawFrame()
          canvas.style.cursor = cinemaLock() && !calibOnRef.current ? 'default' : 'grab'
          emit(true)
        }
        fitFn = () => fit(true)
        fit(true)
        ro = new ResizeObserver(() => fit(false))
        if (boxRef.current) ro.observe(boxRef.current)

        const worldPerPx = () => 1 / (fitScale * view.zoom)

        const onWheel = (e: WheelEvent) => {
          e.preventDefault()
          // 运镜开启时锁定取景：不接受滚轮缩放（仅大招 cut-in，calib 调试除外）
          if (cinemaLock() && !calibOnRef.current) return
          follow = false // 用户接管视图，相机跟拍暂停（复位恢复）
          const rect = canvas.getBoundingClientRect()
          const mx = e.clientX - rect.left - rect.width / 2
          const my = e.clientY - rect.top - rect.height / 2
          const w0 = worldPerPx()
          const px = view.cx + mx * w0      // 光标下的世界坐标
          const py = view.cy - my * w0
          const next = Math.min(6, Math.max(0.5, view.zoom * Math.exp(-e.deltaY * 0.0015)))
          if (Math.abs(next - view.zoom) < 1e-4) return
          view.zoom = next
          const w1 = worldPerPx()
          view.cx = px - mx * w1
          view.cy = py + my * w1
          zoom = next
          emit(true)
          apply()
        }
        canvas.addEventListener('wheel', onWheel, { passive: false })
        cleanups.push(() => canvas.removeEventListener('wheel', onWheel))

        // ---- 触屏手势：单指拖拽平移、双指捏合缩放（以两指中点为锚点）----
        // 用 pointer events 统一鼠标 / 触摸；pointers 记录当前按下的所有指针。
        const pointers = new Map<number, { x: number; y: number }>()
        let dragging: 'view' | 'bg' | null = null
        let lx = 0
        let ly = 0
        /** 捏合起点：初始两指间距 + 当时缩放 + 中点对应的世界坐标 */
        let pinch: { dist: number; zoom: number; wx: number; wy: number } | null = null
        /** 双击复位：最近一次落点的时间/坐标（触屏 dblclick 不一定可靠，自己判定） */
        let lastTap = 0
        let lastTapX = 0
        let lastTapY = 0
        let downX = 0
        let downY = 0
        /** 本次手势出现过两指（捏合），抬起时不做双击判定 */
        let multiTouch = false

        const midOf = () => {
          let x = 0, y = 0
          pointers.forEach((p) => { x += p.x; y += p.y })
          return { x: x / Math.max(1, pointers.size), y: y / Math.max(1, pointers.size) }
        }
        const distOf = () => {
          const it = pointers.values()
          const a = it.next().value!
          const b = it.next().value!
          return Math.hypot(a.x - b.x, a.y - b.y)
        }
        /** 屏幕坐标（相对画布中心）→ 世界坐标 */
        const screenToWorld = (clientX: number, clientY: number) => {
          const rect = canvas.getBoundingClientRect()
          const mx = clientX - rect.left - rect.width / 2
          const my = clientY - rect.top - rect.height / 2
          const w = worldPerPx()
          return { mx, my, wx: view.cx + mx * w, wy: view.cy - my * w }
        }

        const onDown = (e: PointerEvent) => {
          if (e.button !== 0) return
          // 运镜开启时锁定取景：不接受拖拽（仅大招 cut-in，calib 调试除外）
          if (cinemaLock() && !calibOnRef.current) return
          pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
          try { canvas.setPointerCapture(e.pointerId) } catch { /* ignore */ }
          downX = e.clientX
          downY = e.clientY

          if (pointers.size === 2) {
            // 进入捏合：记下起始间距 / 缩放 / 中点世界坐标，取消单指拖拽与相机跟拍
            multiTouch = true
            const mid = midOf()
            const anchor = screenToWorld(mid.x, mid.y)
            pinch = {
              dist: Math.max(1, distOf()),
              zoom: view.zoom,
              wx: anchor.wx,
              wy: anchor.wy,
            }
            dragging = null
            follow = false
            canvas.style.cursor = 'grabbing'
            return
          }
          if (pointers.size > 2) return

          // 单指：与原来相同的拖拽逻辑（含 calib 背景板）
          dragging = 'view'
          follow = false
          // 校准模式：按在「当前显示的背景板」上时，拖拽改为移动背景板
          //（其余区域仍是移动视角）
          if (calibOnRef.current) {
            const el = activeBg() === 1 ? sceneBg2Ref.current : sceneBgRef.current
            const r = el?.getBoundingClientRect()
            if (r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
              dragging = 'bg'
            }
          }
          lx = e.clientX
          ly = e.clientY
          canvas.style.cursor = 'grabbing'
        }

        const onMove = (e: PointerEvent) => {
          if (!pointers.has(e.pointerId)) return
          pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

          // 双指捏合：缩放 + 中点拖动。始终保持捏合开始时中点下的世界坐标
          // 落在当前中点，于是缩放围绕两指中心、同时支持双指整体平移。
          if (pointers.size >= 2 && pinch) {
            const dist = distOf()
            const mid = midOf()
            const rect = canvas.getBoundingClientRect()
            const mx = mid.x - rect.left - rect.width / 2
            const my = mid.y - rect.top - rect.height / 2
            const next = Math.min(6, Math.max(0.5, pinch.zoom * (dist / pinch.dist)))
            view.zoom = next
            const w1 = 1 / (fitScale * view.zoom)
            view.cx = pinch.wx - mx * w1
            view.cy = pinch.wy + my * w1
            zoom = next
            emit(true)
            apply()
            return
          }

          if (!dragging) return
          if (dragging === 'bg') {
            // 拖背景板：像素位移 → 世界位移 → side0 的百分比（与滑杆同一套数值）
            const w = worldPerPx()
            const dxPct = ((e.clientX - lx) * w / sceneSide0) * 100
            const dyPct = (-(e.clientY - ly) * w / sceneSide0) * 100
            const curIdx = activeBg()
            setCalibAdj((s) => {
              const cur = s[curIdx]
              return {
                ...s,
                [curIdx]: {
                  dxPct: Math.round((cur.dxPct + dxPct) * 1000) / 1000,
                  dyPct: Math.round((cur.dyPct + dyPct) * 1000) / 1000,
                  scale: cur.scale,
                  rot: cur.rot,
                },
              }
            })
            lx = e.clientX
            ly = e.clientY
            apply()
            return
          }
          const w = worldPerPx()
          view.cx -= (e.clientX - lx) * w
          view.cy += (e.clientY - ly) * w
          lx = e.clientX
          ly = e.clientY
          apply()
        }

        const onUp = (e: PointerEvent) => {
          pointers.delete(e.pointerId)
          try { canvas.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
          if (pointers.size < 2) pinch = null
          if (pointers.size === 1) {
            // 捏合退回单指：把拖拽基点重置到剩余手指，避免视图跳变
            const p = pointers.values().next().value!
            lx = p.x
            ly = p.y
            dragging = 'view'
          } else if (pointers.size === 0) {
            dragging = null
          }
          // 触屏双击复位（鼠标走原生 dblclick）：需是一次没怎么移动的轻点、且非捏合手势
          if (e.type === 'pointerup' && e.pointerType !== 'mouse' && !multiTouch &&
              Math.hypot(e.clientX - downX, e.clientY - downY) < 24) {
            const now = performance.now()
            if (now - lastTap < 320 && Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < 32) {
              fit(true)
              lastTap = 0
            } else {
              lastTap = now
              lastTapX = e.clientX
              lastTapY = e.clientY
            }
          }
          if (pointers.size === 0) multiTouch = false
          canvas.style.cursor = cinemaLock() && !calibOnRef.current ? 'default' : 'grab'
        }
        canvas.addEventListener('pointerdown', onDown)
        canvas.addEventListener('pointermove', onMove)
        canvas.addEventListener('pointerup', onUp)
        canvas.addEventListener('pointercancel', onUp)
        cleanups.push(() => {
          canvas.removeEventListener('pointerdown', onDown)
          canvas.removeEventListener('pointermove', onMove)
          canvas.removeEventListener('pointerup', onUp)
          canvas.removeEventListener('pointercancel', onUp)
        })
        canvas.style.cursor = cinemaLock() && !calibOnRef.current ? 'default' : 'grab'
        const onDbl = () => fit(true)
        canvas.addEventListener('dblclick', onDbl)
        cleanups.push(() => canvas.removeEventListener('dblclick', onDbl))

        // ---- 命令式控制接口 ----
        const ctrl: SpineController = {
          play() { playing = true; emit(true) },
          pause() { playing = false; emit(true) },
          toggle() { playing = !playing; emit(true) },
          seek(t) {
            if (!state || !skeleton || !duration) return
            const clamped = Math.max(0, Math.min(duration - 1e-4, t))
            state.setAnimation(0, currentAnim, true)
            const track: any = state.getCurrent(0)
            if (track) track.trackTime = clamped
            state.update(0)
            state.apply(skeleton)
            applyHiddenSlots(skeleton)
            skeleton.updateWorldTransform()
            // 额外图层跟随主模型 seek 到同一时间点（若该层有此动画）
            for (const L of extraLayers) {
              if (!L.animSet.has(currentAnim)) continue
              L.state.setAnimation(0, currentAnim, true)
              const tr: any = L.state.getCurrent(0)
              if (tr) tr.trackTime = clamped
              L.state.update(0)
              L.state.apply(L.skeleton)
              L.skeleton.updateWorldTransform()
            }
            // seek 是时间上的硬跳变，跟拍视角直接吸附到目标（不然切镜后
            // 画面要花一秒才追上，背景板还留在旧位置，校准拖拽会扑空）
            if (follow && unionRect) {
              const st = followTarget()
              if (st) {
                const vw = scene ? scene.camera.viewportWidth : 0
                const vh = scene ? scene.camera.viewportHeight : 0
                const [ux0, uy0, ux1, uy1] = unionRect
                const tx = vw >= ux1 - ux0 ? (ux0 + ux1) / 2
                  : Math.min(Math.max(st.cx, ux0 + vw / 2), ux1 - vw / 2)
                const ty = vh >= uy1 - uy0 ? (uy0 + uy1) / 2
                  : Math.min(Math.max(st.cy, uy0 + vh / 2), uy1 - vh / 2)
                view.cx = tx
                view.cy = ty
              }
            }
            sceneSnap = true
            emit(true)
          },
          setSpeed(v) {
            speed = Math.max(0.1, Math.min(3, v))
            if (state) state.timeScale = speed
            for (const L of extraLayers) L.state.timeScale = speed
            emit(true)
          },
          setAnim(n) { setAnim(n) },
          playOnce(n, followAnim) { setAnim(n, false, followAnim) },
          resetView() { fitFn?.() },
          setCameraFollow(on) {
            cinemaOn = on
            canvas.style.cursor = cinemaLock() && !calibOnRef.current ? 'default' : 'grab'
            if (on) {
              // 回到默认取景并恢复跟拍，避免保留用户之前拖出来的偏移
              fit(true)
            } else {
              follow = false
              emit(true)
            }
          },
          saveFrame(filename) { pendingSave = filename || `${name}.png` },
          getStatus() { return status() },
          calibSnapshot() {
            if (!calibBase) return null
            const cal = calibRef.current[calibBase.bgIndex] || { dxPct: 0, dyPct: 0, scale: 1, rot: 0 }
            return {
              anim: currentAnim,
              t: currentTime(),
              ...calibBase,
              dxPct: cal.dxPct,
              dyPct: cal.dyPct,
              scale: cal.scale,
              rot: cal.rot,
            }
          },
        }
        if (controllerRef) controllerRef.current = ctrl
        localCtrl.current = ctrl
        emit(true)

        let last = performance.now()
        const loop = (now: number) => {
          if (disposed || !scene || !state || !skeleton) return
          const dt = Math.min(0.05, (now - last) / 1000)
          last = now
          if (playing) state.update(dt)
          // 额外图层与主模型同步推进时间，保证三层动画严格对齐
          if (playing) {
            for (const L of extraLayers) L.state.update(dt)
          }
          // 一次性过渡动画（第二形态切换）播完后，自动切到目标动画并循环。
          // 用 track.isComplete() 判断：非循环 track 播到末尾会置位。
          if (pendingFollow && state && playing) {
            const tr: any = state.getCurrent(0)
            if (tr && tr.isComplete()) {
              const follow = pendingFollow
              pendingFollow = null
              setAnim(follow)
            }
          }
          drawFrame()

          // toDataURL 必须和绘制在同一个 rAF 回调里同步取，否则 drawing buffer 已被清空
          if (pendingSave) {
            try {
              const bg = bgImageRef.current
              let url = canvas.toDataURL('image/png')
              if (bg) {
                // 舞台是宽屏，但 CG 作品是正方形：导出时裁成中间的正方形，
                // 和静态合成图模式导出的 2048² 方图保持一致。
                const S = Math.min(canvas.width, canvas.height)
                const ox = (canvas.width - S) / 2
                const oy = (canvas.height - S) / 2
                const merged = document.createElement('canvas')
                merged.width = S
                merged.height = S
                const c = merged.getContext('2d')
                if (c) {
                  // 复现舞台上的 CSS 变换（transform-origin: 0 0），再按裁剪偏移平移
                  c.save()
                  c.translate(-ox, -oy)
                  c.translate(bgTransform.tx, bgTransform.ty)
                  c.scale(bgTransform.scale, bgTransform.scale)
                  drawContain(c, bg, canvas.width, canvas.height)
                  c.restore()
                  c.drawImage(canvas, -ox, -oy)
                  url = merged.toDataURL('image/png')
                }
              }
              download(url, pendingSave)
            } catch { /* ignore */ }
            pendingSave = null
          }
          if (!ready) {
            ready = true
            callbacks.current.onReady?.()
            emit(true)
          }
          emit()
          raf = requestAnimationFrame(loop)
        }
        raf = requestAnimationFrame(loop)
      } catch (e: any) {
        console.error(e)
        const msg = e?.message || String(e)
        setError(msg)
        callbacks.current.onError?.(msg)
      }
    })()

    return () => {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      ro?.disconnect()
      cleanups.forEach((fn) => fn())
      try { scene?.dispose() } catch { /* ignore */ }
      if (controllerRef) controllerRef.current = null
      localCtrl.current = null
    }
  }, [name, dir, controllerRef, fitMode, hideShadows, pickDefaultAnim, sceneBg, layerNames?.bg, layerNames?.fg])

  if (error) {
    return <div className={`spine-player err ${className}`}>模型加载失败：{error}</div>
  }

  /** 校准面板当前编辑哪张背景（随切镜点切换） */
  const calibActive: 0 | 1 = calibCut != null && calibTime >= calibCut ? 1 : 0
  const recordCalib = () => {
    const snap = localCtrl.current?.calibSnapshot?.()
    if (!snap) return
    setCalibRecords((r) => [...r, snap])
    // 记录后保留当前微调：校准值经常需要连续微调，归零会把刚调好的
    // 位置/缩放丢掉（要继续采下一帧时得从头再来）。需要归零用「重置调整」
  }
  /** ± 按钮微调（保留 3 位小数，避免浮点噪声累积）；只动当前背景的槽 */
  const nudgeCalib = (k: 'dxPct' | 'dyPct' | 'scale' | 'rot', d: number) =>
    setCalibAdj((s) => {
      const cur = s[calibActive]
      return { ...s, [calibActive]: { ...cur, [k]: Math.round((cur[k] + d) * 1000) / 1000 } }
    })
  const calibBtnCss = {
    width: 22, flexShrink: 0, padding: 0, fontSize: 12, lineHeight: '16px', cursor: 'pointer',
  }
  const exportCalib = async () => {
    const json = JSON.stringify(calibRecords)
    setCalibOut(json)
    try { await navigator.clipboard.writeText(json) } catch { /* 非安全上下文时降级为手动复制 */ }
  }

  return (
    <div className={`spine-player ${className}`} style={{ position: 'relative' }}>
      <div className="spine-stage" ref={boxRef}>
        {sceneBg && (
          <img className="spine-scene-bg" ref={sceneBgRef} src={sceneBg} alt="" draggable={false} />
        )}
        {sceneBg2 && (
          <img className="spine-scene-bg" ref={sceneBg2Ref} src={sceneBg2} alt="" draggable={false} />
        )}
        <canvas ref={canvasRef} />
        {controls && <div className="spine-hint">滚轮 / 捏合缩放 · 拖拽平移 · 双击复位 · 空格播放/暂停</div>}
      </div>
      {calib && sceneBg && (
        <div
          style={{
            position: 'absolute', top: 64, left: 10, zIndex: 30, width: 252,
            padding: '8px 10px', background: 'rgba(10,12,16,.85)', color: '#e8eaf0',
            borderRadius: 10, fontSize: 12, backdropFilter: 'blur(4px)',
            boxShadow: '0 2px 12px rgba(0,0,0,.4)',
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 2 }}>背景校准（calib）</div>
          {calibCut != null && (
            <div style={{ fontSize: 10, opacity: 0.85, marginBottom: 4 }}>
              第 {calibActive + 1} 张 / 共 2 张 · 切镜点 {calibCut.toFixed(2)}s
            </div>
          )}
          {([
            // 量程放宽：实际校准经常需要把背景推得很远 / 放得很大
            // （太窄的滑杆会在拖动时把超范围的值夹回去）
            ['平移X', 'dxPct', -300, 300, 0.1, 0.05, (v: number) => `${v.toFixed(2)}%`],
            ['平移Y', 'dyPct', -300, 300, 0.1, 0.05, (v: number) => `${v.toFixed(2)}%`],
            ['缩放', 'scale', 0.2, 6, 0.002, 0.002, (v: number) => `×${v.toFixed(3)}`],
            ['旋转', 'rot', -45, 45, 0.02, 0.02, (v: number) => `${v.toFixed(2)}°`],
          ] as const).map(([label, key, min, max, step, fine, fmt]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
              <span style={{ width: 100, flexShrink: 0 }}>{label} {fmt(calibAdj[calibActive][key])}</span>
              <button
                onClick={() => nudgeCalib(key, -fine)} title={`微调 −${fine}`}
                style={calibBtnCss}
              >−</button>
              <input
                type="range" min={min} max={max} step={step} value={calibAdj[calibActive][key]} style={{ flex: 1, minWidth: 0 }}
                onChange={(e) => setCalibAdj((s) => ({
                  ...s,
                  [calibActive]: { ...s[calibActive], [key]: Number(e.target.value) },
                }))}
              />
              <button
                onClick={() => nudgeCalib(key, fine)} title={`微调 +${fine}`}
                style={calibBtnCss}
              >＋</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
            <button onClick={recordCalib} style={{ flex: '1 1 auto', padding: '3px 6px', fontSize: 11, cursor: 'pointer' }}>
              记录本帧
            </button>
            <button
              onClick={() => setCalibAdj((s) => ({ ...s, [calibActive]: { dxPct: 0, dyPct: 0, scale: 1, rot: 0 } }))}
              style={{ flex: '1 1 auto', padding: '3px 6px', fontSize: 11, cursor: 'pointer' }}
            >
              重置调整
            </button>
            <button onClick={exportCalib} style={{ flex: '1 1 auto', padding: '3px 6px', fontSize: 11, cursor: 'pointer' }}>
              导出数据
            </button>
            {calibRecords.length > 0 && (
              <button
                onClick={() => { setCalibRecords([]); setCalibOut('') }}
                style={{ flex: '1 1 auto', padding: '3px 6px', fontSize: 11, cursor: 'pointer' }}
              >
                清空({calibRecords.length})
              </button>
            )}
          </div>
          {calibOut && (
            <textarea
              readOnly value={calibOut}
              style={{
                width: '100%', height: 90, marginTop: 6, fontSize: 10, fontFamily: 'monospace',
                background: 'rgba(255,255,255,.06)', color: 'inherit',
                border: '1px solid rgba(255,255,255,.25)', borderRadius: 6, boxSizing: 'border-box',
              }}
              onFocus={(e) => e.currentTarget.select()}
            />
          )}
          <div style={{ fontSize: 10, opacity: 0.78, marginTop: 6, lineHeight: 1.5 }}>
            暂停 → 拖时间轴 → 直接拖背景板移动它（拖其他区域仍是移动视角），
            或用滑杆 / −＋ 按钮精调，直到背景与骨架（水/浴缸）对齐 →
            记录本帧（记录后保留当前微调，不会被清空）。多个时刻各记一次
            （开头、推近、特写、结尾），滚轮放大可检查接缝。
          </div>
        </div>
      )}
      {controls && (
        <div className="spine-bar">
          <button className="sp-btn" onClick={() => localCtrl.current?.toggle()} title="播放 / 暂停（空格）">
            <span className="sp-btn-pause">
              <PlayPauseIcon playing={!ui.paused} size="11" />
              {ui.paused ? '播放' : '暂停'}
            </span>
          </button>
          {ui.anims.length > 1 && (
            <select value={ui.current} onChange={(e) => localCtrl.current?.setAnim(e.target.value)}>
              {ui.anims.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
          <button className="sp-btn" onClick={() => localCtrl.current?.resetView()} title="复位视图">
            {ui.zoom.toFixed(1)}× 复位
          </button>
          <label className="sp-speed">
            <input
              type="range" min={0.2} max={2} step={0.1} value={ui.speed}
              onChange={(e) => localCtrl.current?.setSpeed(Number(e.target.value))}
            />
            {ui.speed.toFixed(1)}×
          </label>
          {extra}
        </div>
      )}
    </div>
  )
}
