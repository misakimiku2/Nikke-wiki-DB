import { useEffect, useRef } from 'react'

/**
 * 通用 2D 转场粒子层。
 *
 * NIKKE 里部分角色的第二形态切换不是 Spine 图层，而是 Unity Timeline +
 * ParticleSystem 驱动的纯 2D 特效（花瓣 / 刀刃 / 光带），只在切换瞬间出现。
 * 这里用 Canvas 2D 粒子近似复现：贴图来自游戏解包，粒子行为按截图手工调参。
 *
 * 每层贴图都可配，通过这个组件 + data.ts 的 VFX_CONFIG 复用到其它角色。
 */
export type VfxConfig = {
  /** 贴图目录（public 下，以 / 开头） */
  dir: string
  /** 转场时长（毫秒） */
  duration: number
  /** 花瓣贴图文件名 */
  petal?: string
  /** 刀刃 / 主特效贴图 */
  slash?: string
  /** 光带贴图 */
  ribbon?: string
  /** 火花图集（可选，切成小片随机闪） */
  sparks?: string
  /** 整体色调（用于全屏闪光），默认红 */
  flash?: string
}

type Particle = {
  kind: 'petal' | 'slash' | 'ribbon' | 'spark'
  img: HTMLImageElement
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  vr: number
  size: number
  life: number
  maxLife: number
  alpha: number
  /** 出场延迟（0~1，占总时长比例） */
  delay: number
}

const rand = (a: number, b: number) => a + Math.random() * (b - a)

function loadImg(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

export default function VfxBurst({
  config,
  signal,
}: {
  config?: VfxConfig | null
  /** 每次递增触发一次播放；0 表示未触发 */
  signal: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef(0)
  const imgsRef = useRef<Record<string, HTMLImageElement>>({})

  // 预加载贴图（只加载一次，按 dir 缓存）
  useEffect(() => {
    if (!config) return
    let cancelled = false
    const files = [config.petal, config.slash, config.ribbon, config.sparks].filter(Boolean) as string[]
    Promise.all(files.map((f) => loadImg(`${config.dir}/${f}`))).then((loaded) => {
      if (cancelled) return
      const map: Record<string, HTMLImageElement> = {}
      files.forEach((f, i) => {
        if (loaded[i]) map[f] = loaded[i]!
      })
      imgsRef.current = map
    })
    return () => { cancelled = true }
  }, [config?.dir, config?.petal, config?.slash, config?.ribbon, config?.sparks])

  // signal 变化 → 播放一次
  useEffect(() => {
    if (!config || signal <= 0) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = canvas.clientWidth
    const H = canvas.clientHeight
    if (W <= 0 || H <= 0) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const imgs = imgsRef.current
    const particles: Particle[] = []
    const dur = config.duration || 2400
    const flash = config.flash || '255, 60, 70'

    // 刀刃：几条大贴图斜向划过（截图里最显眼的红白刀锋）
    if (config.slash && imgs[config.slash]) {
      const img = imgs[config.slash]
      const n = 6
      for (let i = 0; i < n; i++) {
        const fromLeft = i % 2 === 0
        particles.push({
          kind: 'slash', img,
          x: fromLeft ? rand(-0.1, 0.25) * W : rand(0.75, 1.1) * W,
          y: rand(-0.1, 0.7) * H,
          vx: (fromLeft ? 1 : -1) * rand(0.55, 1.1) * W,
          vy: rand(-0.15, 0.25) * H,
          rot: rand(-0.9, 0.9),
          vr: rand(-0.5, 0.5),
          size: rand(0.85, 1.7) * Math.min(W, H) * 0.95,
          life: 0, maxLife: 1, alpha: rand(0.75, 1),
          delay: rand(0, 0.28),
        })
      }
    }
    // 光带：横向流动的红色带子
    if (config.ribbon && imgs[config.ribbon]) {
      const img = imgs[config.ribbon]
      for (let i = 0; i < 3; i++) {
        const fromLeft = i % 2 === 0
        particles.push({
          kind: 'ribbon', img,
          x: fromLeft ? -0.3 * W : 1.3 * W,
          y: rand(0.05, 0.85) * H,
          vx: (fromLeft ? 1 : -1) * rand(1.2, 1.9) * W,
          vy: rand(-0.1, 0.1) * H,
          rot: rand(-0.25, 0.25), vr: rand(-0.15, 0.15),
          size: rand(0.9, 1.6) * W,
          life: 0, maxLife: 1, alpha: rand(0.55, 0.9),
          delay: rand(0.05, 0.4),
        })
      }
    }
    // 花瓣：大量小片飘散
    if (config.petal && imgs[config.petal]) {
      const img = imgs[config.petal]
      const n = 38
      for (let i = 0; i < n; i++) {
        const cx = rand(0.15, 0.85) * W
        const cy = rand(0.2, 0.8) * H
        const ang = rand(0, Math.PI * 2)
        const spd = rand(0.15, 0.6) * Math.min(W, H)
        particles.push({
          kind: 'petal', img,
          x: cx, y: cy,
          vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd - rand(0, 0.1) * H,
          rot: rand(0, Math.PI * 2), vr: rand(-5, 5),
          size: rand(0.05, 0.16) * Math.min(W, H),
          life: 0, maxLife: 1, alpha: rand(0.65, 1),
          delay: rand(0, 0.5),
        })
      }
    }
    // 火花：图集切小片随机闪
    if (config.sparks && imgs[config.sparks]) {
      const atlas = imgs[config.sparks]
      const cells = 4
      for (let i = 0; i < 18; i++) {
        const sx = Math.floor(rand(0, cells)) / cells
        const sy = Math.floor(rand(0, cells)) / cells
        // 用离屏 canvas 裁出单格
        const cell = document.createElement('canvas')
        cell.width = 64; cell.height = 64
        const cctx = cell.getContext('2d')!
        cctx.drawImage(atlas, sx * atlas.width / cells, sy * atlas.height / cells,
          atlas.width / cells, atlas.height / cells, 0, 0, 64, 64)
        const img2 = new Image()
        img2.src = cell.toDataURL()
        particles.push({
          kind: 'spark', img: img2,
          x: rand(0, W), y: rand(0, H),
          vx: rand(-0.1, 0.1) * W, vy: rand(-0.15, 0.05) * H,
          rot: rand(0, 6.28), vr: rand(-2, 2),
          size: rand(0.02, 0.06) * Math.min(W, H),
          life: 0, maxLife: 1, alpha: rand(0.5, 1),
          delay: rand(0, 0.6),
        })
      }
    }

    let start = 0
    let stopped = false
    const frame = (ts: number) => {
      if (stopped) return
      if (!start) start = ts
      const t = (ts - start) / dur
      ctx.clearRect(0, 0, W, H)
      if (t >= 1) {
        ctx.clearRect(0, 0, W, H)
        return
      }

      // 全屏红色闪光：前 30% 冲到峰值，之后快速衰减
      const flashA = t < 0.25 ? (t / 0.25) * 0.34 : Math.max(0, 0.34 - (t - 0.25) * 0.62)
      if (flashA > 0.001) {
        const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7)
        g.addColorStop(0, `rgba(${flash}, ${flashA * 0.75})`)
        g.addColorStop(0.55, `rgba(${flash}, ${flashA * 0.4})`)
        g.addColorStop(1, `rgba(${flash}, 0)`)
        ctx.fillStyle = g
        ctx.fillRect(0, 0, W, H)
      }

      ctx.save()
      ctx.globalCompositeOperation = 'screen'
      for (const p of particles) {
        const local = (t - p.delay) / (1 - p.delay)
        if (local < 0 || local > 1) continue
        // 淡入(前15%) → 保持 → 淡出(后35%)
        const fade = local < 0.15 ? local / 0.15
          : local > 0.65 ? Math.max(0, (1 - local) / 0.35) : 1
        const a = p.alpha * fade
        if (a <= 0.01) continue
        const px = p.x + p.vx * local
        const py = p.y + p.vy * local
        const s = p.size * (p.kind === 'slash'
          ? 0.5 + Math.min(1, local * 3) * 0.7
          : 1)
        ctx.save()
        ctx.globalAlpha = a
        ctx.translate(px, py)
        ctx.rotate(p.rot + p.vr * local)
        ctx.drawImage(p.img, -s / 2, -s / 2, s, s)
        ctx.restore()
      }
      ctx.restore()
      rafRef.current = requestAnimationFrame(frame)
    }
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(frame)
    return () => {
      stopped = true
      cancelAnimationFrame(rafRef.current)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
    }
  }, [config, signal])

  if (!config) return null
  return <canvas ref={canvasRef} className="vfx-burst" aria-hidden="true" />
}
