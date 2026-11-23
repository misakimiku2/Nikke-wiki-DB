/**
 * FADING AFFECTION 主菜单动态 CG
 *
 * 图层与坐标取自原版 intro 界面 prefab（bundle 14102 `adventure_intro_marian`，
 * 设计分辨率 1080×1920），由 nikke_extract/scripts/export_fading_ui_layout.py 导出，
 * 按 web/src/fadingPrefab.ts 的 place() 递归算出每个节点的世界矩形后写死在这里。
 * 人物与前景栏杆走 Spine（bundle 14102 里的 MinigameTitle_fadingaffection_01 三件套，
 * 由 nikke_extract/scripts/export_fading_intro_spine.py 抽到 public/spine/），
 * 其余图层是静态位图。
 *
 * 关于"动态"的边界：原版 effect 节点下那批粒子（dust / smoke / sun / light_01..03 /
 * bokeh_01..03 / rainbow_01..03）在 prefab 里只有 scale=0 的占位变换、没有贴图，
 * 这里没法还原；雾与光只是用 CSS 做的缓慢位移，不是原版的粒子轨迹。
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  AnimationState, AnimationStateData, AtlasAttachmentLoader, GLTexture,
  ManagedWebGLRenderingContext, SceneRenderer, Skeleton, SkeletonBinary, TextureAtlas,
} from '@esotericsoftware/spine-webgl'

/** 设计坐标系（原版竖屏画布） */
const DW = 1080
const DH = 1920

/**
 * Spine 骨架 → 设计像素的映射，两个数都从 prefab 推出来，不是试出来的：
 * SkeletonGraphic 节点的 pivot 世界坐标 = (554, 1838.8)，累计缩放 = 1.2 × 1.008 = 1.210。
 * 骨架坐标 y 朝上，设计坐标 y 朝下，所以换算时纵向取反。
 */
const SPINE_ORIGIN: [number, number] = [554, 1838.8]
const SPINE_UNIT = 1.210

const SPINE_DIR = '/spine/MinigameTitle_fadingaffection_01'
const SPINE_NAME = 'MinigameTitle_fadingaffection_01'

/** 图集页是 pma:true，浏览器解码后仍是预乘数据；关掉运行时的再次预乘，
 *  否则半透明层被乘两次 alpha，部件边缘会出现灰白细线（与 SpinePlayer 同一处理）。 */
GLTexture.DISABLE_UNPACK_PREMULTIPLIED_ALPHA_WEBGL = true

type Layer = {
  png: string
  /** 世界矩形 [x, y, w, h]，单位是设计像素，y 向下 */
  r: [number, number, number, number]
  a?: number
  /** 动效种类 */
  fx?: 'fog' | 'light' | 'breathe'
}

/**
 * 绘制顺序即数组顺序（与 prefab 的兄弟顺序一致）。
 * 人物和前景栏杆（f_stair / f_stair_grass）由 Spine 画，位置由下面的 <canvas> 决定，
 * 所以这里不再放 marian_intro_chr_top.png——它是 SkeletonGraphic 关掉时的静态替身。
 */
const LAYERS: Layer[] = [
  { png: 'marian_intro_bg.png', r: [-420, -10, 1935.4, 1935.4], fx: 'breathe' },
  { png: 'marian_intro_stair_light.png', r: [527.2, 592, 688.1, 1334.6], a: 0.98, fx: 'light' },
  { png: 'marian_intro_stair_back.png', r: [606.1, 743.9, 1258.6, 1407], a: 0.98 },
  { png: 'marian_intro_chr_shadow.png', r: [801.3, 1304.6, 246, 229.8], a: 0.98 },
]

/** Spine 之后绘制的层（光斑压在人物身上、雾在最下、电线在最上，与 prefab 一致） */
const LAYERS_ABOVE: Layer[] = [
  { png: 'marian_intro_stair_light_02.png', r: [-40.2, 360.5, 1317.5, 833.7], a: 0.98, fx: 'light' },
  { png: 'marian_intro_fog.png', r: [327.7, 1183.2, 1466.3, 928.1], a: 0.98, fx: 'fog' },
  { png: 'marian_intro_deco_top.png', r: [1016.4, -126.8, 480.3, 706.6], a: 0.98 },
]

function Img({ l }: { l: Layer }) {
  return <img src={`/fading_ui/${l.png}`} alt="" draggable={false}
    className={l.fx ? `in-${l.fx}` : undefined}
    style={{
      position: 'absolute', left: l.r[0], top: l.r[1], width: l.r[2], height: l.r[3],
      opacity: l.a ?? 1,
    } as CSSProperties} />
}

/** 标题页 Spine：只画 idle 一条动画，透明背景，尺寸就是整个设计画布。 */
function IntroSpine({ reduce }: { reduce: boolean }) {
  const cv = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const canvas = cv.current
    if (!canvas || failed) return
    let alive = true
    let scene: SceneRenderer | null = null
    let gl: WebGLRenderingContext | null = null
    let raf = 0

    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(DW * dpr)
    canvas.height = Math.round(DH * dpr)

    ;(async () => {
      const [atlasText, skelBuf, pageImg] = await Promise.all([
        fetch(`${SPINE_DIR}/${SPINE_NAME}.atlas`).then((r) => { if (!r.ok) throw new Error(`atlas ${r.status}`); return r.text() }),
        fetch(`${SPINE_DIR}/${SPINE_NAME}.skel`).then((r) => { if (!r.ok) throw new Error(`skel ${r.status}`); return r.arrayBuffer() }),
        new Promise<HTMLImageElement>((res, rej) => {
          const i = new Image()
          i.onload = () => res(i)
          i.onerror = () => rej(new Error('atlas page image'))
          i.src = `${SPINE_DIR}/${SPINE_NAME}.spine.webp`
        }),
      ])
      if (!alive) return

      const ctx = new ManagedWebGLRenderingContext(canvas)
      scene = new SceneRenderer(canvas, ctx)
      gl = ctx.gl
      const atlas = new TextureAtlas(atlasText)
      const premultiplied = atlas.pages.length > 0 && atlas.pages.every((p) => p.pma)
      const tex = new GLTexture(ctx, pageImg)
      atlas.pages[0].setTexture(tex)
      tex.setFilters(gl.LINEAR, gl.LINEAR)

      const data = new SkeletonBinary(new AtlasAttachmentLoader(atlas))
        .readSkeletonData(new Uint8Array(skelBuf))
      const skeleton = new Skeleton(data)
      if (data.defaultSkin) skeleton.setSkin(data.defaultSkin)
      skeleton.setSlotsToSetupPose()

      const state = new AnimationState(new AnimationStateData(data))
      const anim = data.animations.some((a) => a.name === 'idle') ? 'idle' : data.animations[0]?.name
      if (anim) state.setAnimation(0, anim, true)

      /* 相机把「骨架单位」换算成设计像素：可见世界宽 = 画布宽 / 单位缩放，
         相机中心取设计画布中心所对应的骨架坐标（纵向取反）。 */
      const cam = scene.camera
      cam.viewportWidth = DW / SPINE_UNIT
      cam.viewportHeight = DH / SPINE_UNIT
      cam.position.x = (DW / 2 - SPINE_ORIGIN[0]) / SPINE_UNIT
      cam.position.y = (SPINE_ORIGIN[1] - DH / 2) / SPINE_UNIT

      const draw = () => {
        if (!scene || !gl) return
        gl.disable(gl.SCISSOR_TEST)
        gl.clearColor(0, 0, 0, 0)
        gl.clear(gl.COLOR_BUFFER_BIT)
        scene.begin()
        scene.drawSkeleton(skeleton, premultiplied)
        scene.end()
      }

      let last = performance.now()
      const loop = (now: number) => {
        if (!alive) return
        state.update((now - last) / 1000)
        last = now
        state.apply(skeleton)
        skeleton.updateWorldTransform()
        draw()
        raf = requestAnimationFrame(loop)
      }
      if (reduce) {
        state.apply(skeleton)
        skeleton.updateWorldTransform()
        draw()
      } else {
        raf = requestAnimationFrame(loop)
      }
    })().catch(() => { if (alive) setFailed(true) })

    return () => {
      alive = false
      cancelAnimationFrame(raf)
      // 主菜单可能反复进出，WebGL 上下文有数量上限，必须显式释放（与 SpinePlayer 一致）
      try { scene?.dispose() } catch { /* ignore */ }
      scene = null
    }
  }, [reduce, failed])

  if (failed) {
    // Spine 加载失败退回静态上半身，整屏背景不至于缺人
    return <Img l={{ png: 'marian_intro_chr_top.png', r: [679.9, 605.3, 275.6, 430.6] }} />
  }
  return (
    <canvas ref={cv} className="cf-intro-spine"
      style={{ position: 'absolute', left: 0, top: 0, width: DW, height: DH } as CSSProperties} />
  )
}

/** fit=cover 时铺满容器（原版竖屏构图，按容器比例裁），fit=contain 时整幅装下。 */
export default function FadingIntro({ fit = 'cover', className }: {
  fit?: 'cover' | 'contain'
  className?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const [k, setK] = useState(0)
  const reduce = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const { width: cw, height: ch } = el.getBoundingClientRect()
      if (!cw || !ch) return
      setK(fit === 'cover' ? Math.max(cw / DW, ch / DH) : Math.min(cw / DW, ch / DH))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [fit])

  return (
    <div ref={box} className={`cf-intro${className ? ' ' + className : ''}${reduce ? ' no-fx' : ''}`}
      aria-hidden="true">
      <div className="cf-intro-stage"
        style={{ width: DW, height: DH, transform: `translate(-50%,-50%) scale(${k})` }}>
        {LAYERS.map((l) => <Img key={l.png} l={l} />)}
        <IntroSpine reduce={reduce} />
        {LAYERS_ABOVE.map((l) => <Img key={l.png} l={l} />)}
      </div>
    </div>
  )
}
