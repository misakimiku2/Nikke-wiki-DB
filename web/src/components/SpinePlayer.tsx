import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import {
  AnimationState, AnimationStateData, AtlasAttachmentLoader, ClippingAttachment,
  GLTexture, ManagedWebGLRenderingContext, RegionAttachment, SceneRenderer, Skeleton,
  SkeletonBinary, TextureAtlas, Vector2, VertexAttachment,
} from '@esotericsoftware/spine-webgl'
import { loadSpineOverrides, type SpineOverride, type ViewTransform } from '../data'

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
export type SpineController = {
  play(): void
  pause(): void
  toggle(): void
  seek(t: number): void
  setSpeed(v: number): void
  setAnim(n: string): void
  resetView(): void
  saveFrame(filename?: string): void
  getStatus(): SpineStatus
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
  /** 自定义默认动画挑选（模型动画列表 → 动画名）；缺省自动挑 idle
      （站姿 idle / 战斗 aim_idle / 大招 Idle）。返回 undefined 时回落到 idle */
  pickDefaultAnim?: (names: string[]) => string | undefined
  /** 自带控制条右侧的额外内容 */
  extra?: ReactNode
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

/** 可见槽位中心的「中位数」——对少数飞散的特效件鲁棒（bbox 中心会被
    单个远处的 FX 网格拉偏，中位数不受影响），用作相机跟拍目标 */
function contentCenter(skeleton: any): [number, number] | null {
  const xs: number[] = []
  const ys: number[] = []
  for (const slot of skeleton.slots) {
    const b = slotBBox(slot)
    if (!b) continue
    xs.push((b[0] + b[2]) / 2)
    ys.push((b[1] + b[3]) / 2)
  }
  if (!xs.length) return null
  const med = (arr: number[]) => {
    const s = [...arr].sort((a, b) => a - b)
    return s[Math.floor(s.length / 2)]
  }
  return [med(xs), med(ys)]
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
  backgroundSrc, fitMode = 'contain', hideShadows, sceneBg, pickDefaultAnim, extra,
}: SpinePlayerProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneBgRef = useRef<HTMLImageElement>(null)
  /** 预加载好的背景图，供保存当前帧时与 WebGL 画面合成 */
  const bgImageRef = useRef<HTMLImageElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 自带控制条的展示状态；外部控制条模式下由 onTick 推送，这里只用于文字回显
  const [ui, setUi] = useState({ anims: [] as string[], current: '', paused: false, speed: 1, zoom: 1 })

  const callbacks = useRef({ onReady, onTick, onView, onError })
  callbacks.current = { onReady, onTick, onView, onError }
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
    let duration = 0
    let animNames: string[] = []
    let currentAnim = ''
    let playing = true
    let speed = 1
    let zoom = 1
    let ready = false
    let fitFn: (() => void) | null = null
    let pendingSave: string | null = null
    let lastTick = 0
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

        const atlas = new TextureAtlas(atlasText)
        // .atlas 头部的 pma:true 表示贴图 RGB 已经乘过 alpha。GLTexture 上传时会把
        // 浏览器内部预乘的位图反预乘回文件里的值，所以 GL 纹理里就是预乘数据，
        // drawSkeleton 必须按 pma 混合（ONE, ONE_MINUS_SRC_ALPHA）。
        // 绝对不要在构建阶段再乘一次 alpha —— 半透明层会变灰（腮红变褐、发光变灰圆斑）。
        const premultiplied = atlas.pages.length > 0 && atlas.pages.every((p) => p.pma)
        // 一个模型可能有多个图集页，每页都要加载自己的贴图
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
          // 图集部件紧贴排布，线性采样 + 无损贴图才没有边界细线
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

        const setAnim = (n: string) => {
          if (!state || !skeleton) return
          const a: any = data.animations.find((x: any) => x.name === n)
          if (!a) return
          currentAnim = n
          duration = a.duration || 0
          state.setAnimation(0, n, true)
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
        const idleFirst = animNames.find((a) => /(^|_)idle$/i.test(a)) || animNames[0] || ''
        const first = (pickDefaultAnim && pickDefaultAnim(animNames)) || idleFirst
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
          for (let i = 0; i < SAMPLE_N; i++) {
            if (track0) track0.trackTime = (i / SAMPLE_N) * duration
            state.update(0)
            state.apply(skeleton)
            applyHiddenSlots(skeleton)
            skeleton.updateWorldTransform()
            const b = contentBounds(skeleton)
            if (b) samples.push(b)
          }
          if (samples.length) {
            const med = (arr: number[]) => {
              const s = [...arr].sort((a, b) => a - b)
              return s[Math.floor(s.length / 2)]
            }
            const area = (b: [number, number, number, number]) => (b[2] - b[0]) * (b[3] - b[1])
            const medW0 = med(samples.map((b) => b[2] - b[0]))
            const medH0 = med(samples.map((b) => b[3] - b[1]))
            const kept = samples.filter(
              (b) => b[2] - b[0] <= medW0 * 8 && b[3] - b[1] <= medH0 * 8,
            )
            const use = kept.length ? kept : samples
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
            for (const b of use) {
              x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1])
              x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3])
            }
            if (x1 > x0 && y1 > y0) {
              unionRect = [x0, y0, x1, y1]
              const calm = [...use]
                .sort((a, b) => area(a) - area(b))
                .slice(0, Math.max(3, Math.floor(use.length / 2)))
              const cW = med(calm.map((b) => b[2] - b[0]))
              const cH = med(calm.map((b) => b[3] - b[1]))
              const cCx = med(calm.map((b) => (b[0] + b[2]) / 2))
              const cCy = med(calm.map((b) => (b[1] + b[3]) / 2))
              calmRect = { cx: cCx, cy: cCy, w: cW, h: cH }
              // 初始取景：典型范围 ×1.25 与并集的交集（交集退化则回退并集）
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
        if (!framed) {
          skeleton.getBounds(offset, size, [])
          bw = Math.max(1, size.x)
          bh = Math.max(1, size.y)
          cx0 = offset.x + bw / 2
          cy0 = offset.y + bh / 2
        }
        // 场景背景板：安静半场典型范围 ×1.15（max 维度），中心=典型中心——
        // 与角色本体成比例，随相机跟拍在画面里平移；舞台 overflow hidden 裁边
        const sceneRect = calmRect
          ? {
              cx: calmRect.cx,
              cy: calmRect.cy,
              side: Math.max(calmRect.w, calmRect.h) * 1.15,
            }
          : unionRect
            ? {
                cx: (unionRect[0] + unionRect[2]) / 2,
                cy: (unionRect[1] + unionRect[3]) / 2,
                side: Math.min(unionRect[2] - unionRect[0], unionRect[3] - unionRect[1]),
              }
            : sceneBg
              ? { cx: cx0, cy: cy0, side: Math.min(bw, bh) }
              : null
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

          // 场景背景层：世界矩形 → 屏幕矩形（与骨架共用同一相机）
          const sb = sceneBgRef.current
          if (sb && sceneRect) {
            const side = sceneRect.side * z
            sb.style.left = `${W / 2 + (sceneRect.cx - sceneRect.side / 2 - view.cx) * z}px`
            sb.style.top = `${H / 2 - (sceneRect.cy + sceneRect.side / 2 - view.cy) * z}px`
            sb.style.width = `${side}px`
            sb.style.height = `${side}px`
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
        const followUpdate = () => {
          if (!scene || !skeleton || !unionRect) return
          const target = contentCenter(skeleton)
          if (!target) return
          const vw = scene.camera.viewportWidth
          const vh = scene.camera.viewportHeight
          const [ux0, uy0, ux1, uy1] = unionRect
          let tx = target[0]
          let ty = target[1]
          tx = vw >= ux1 - ux0 ? (ux0 + ux1) / 2
            : Math.min(Math.max(tx, ux0 + vw / 2), ux1 - vw / 2)
          ty = vh >= uy1 - uy0 ? (uy0 + uy1) / 2
            : Math.min(Math.max(ty, uy0 + vh / 2), uy1 - vh / 2)
          view.cx += (tx - view.cx) * 0.06
          view.cy += (ty - view.cy) * 0.06
        }

        /** 把当前姿态画一帧。渲染循环和「尺寸变化后立即补帧」共用。 */
        const drawFrame = () => {
          if (!scene || !state || !skeleton) return
          state.apply(skeleton)
          applyHiddenSlots(skeleton)
          skeleton.updateWorldTransform()
          if (follow) followUpdate()
          apply()
          gl.clearColor(0, 0, 0, 0)
          gl.clear(gl.COLOR_BUFFER_BIT)
          scene.begin()
          scene.drawSkeleton(skeleton, premultiplied)
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
            follow = dir === 'spine_skillcut' && framed // 复位后恢复相机跟拍
          }
          apply()
          if (sizeChanged) drawFrame()
          emit(true)
        }
        fitFn = () => fit(true)
        fit(true)
        ro = new ResizeObserver(() => fit(false))
        if (boxRef.current) ro.observe(boxRef.current)

        const worldPerPx = () => 1 / (fitScale * view.zoom)

        const onWheel = (e: WheelEvent) => {
          e.preventDefault()
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

        let dragging = false
        let lx = 0
        let ly = 0
        const onDown = (e: PointerEvent) => {
          if (e.button !== 0) return
          dragging = true
          follow = false // 拖拽接管视图
          lx = e.clientX
          ly = e.clientY
          canvas.setPointerCapture(e.pointerId)
          canvas.style.cursor = 'grabbing'
        }
        const onMove = (e: PointerEvent) => {
          if (!dragging) return
          const w = worldPerPx()
          view.cx -= (e.clientX - lx) * w
          view.cy += (e.clientY - ly) * w
          lx = e.clientX
          ly = e.clientY
          apply()
        }
        const onUp = (e: PointerEvent) => {
          dragging = false
          try { canvas.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
          canvas.style.cursor = 'grab'
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
        canvas.style.cursor = 'grab'
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
            emit(true)
          },
          setSpeed(v) {
            speed = Math.max(0.1, Math.min(3, v))
            if (state) state.timeScale = speed
            emit(true)
          },
          setAnim(n) { setAnim(n) },
          resetView() { fitFn?.() },
          saveFrame(filename) { pendingSave = filename || `${name}.png` },
          getStatus() { return status() },
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
  }, [name, dir, controllerRef, fitMode, hideShadows, pickDefaultAnim, sceneBg])

  if (error) {
    return <div className={`spine-player err ${className}`}>模型加载失败：{error}</div>
  }

  return (
    <div className={`spine-player ${className}`}>
      <div className="spine-stage" ref={boxRef}>
        {sceneBg && (
          <img className="spine-scene-bg" ref={sceneBgRef} src={sceneBg} alt="" draggable={false} />
        )}
        <canvas ref={canvasRef} />
        {controls && <div className="spine-hint">滚轮缩放 · 拖拽平移 · 双击复位 · 空格播放/暂停</div>}
      </div>
      {controls && (
        <div className="spine-bar">
          <button className="sp-btn" onClick={() => localCtrl.current?.toggle()}>
            {ui.paused ? '▶ 播放' : '⏸ 暂停'}
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
