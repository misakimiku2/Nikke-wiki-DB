import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { ViewTransform } from '../data'

export type ImageViewerApi = {
  reset(): void
  getScale(): number
  /** 导出当前显示的原始分辨率静帧（PNG，保留透明通道） */
  saveFrame(filename?: string): void
}

type Props = {
  src: string
  alt?: string
  /** 最大放大倍数 */
  max?: number
  className?: string
  /** 右下角工具条的额外按钮 */
  extra?: React.ReactNode
  /** false = 隐藏自带工具条，改由页面统一的控制条驱动 */
  bar?: boolean
  apiRef?: MutableRefObject<ImageViewerApi | null>
  onScaleChange?: (scale: number) => void
  /** 舞台上的独立背景图；保存静帧时一起合成进去 */
  backgroundSrc?: string
  /** 视图变化时推送变换，供外层独立背景层跟随缩放/平移 */
  onTransform?: (t: ViewTransform) => void
}

/** 最小缩放：允许缩到原尺寸的一半，方便看整图留白 */
const MIN = 0.5

/**
 * 可缩放/拖拽的图片查看器
 * - 滚轮以鼠标位置为中心缩放（0.5x ~ max）
 * - 拖拽平移（任意缩放级别都能拖）
 * - 双击在 1x / 2.5x 之间切换
 * - 触屏单指拖动、双指捏合
 */
export default function ImageViewer({
  src, alt = '', max = 6, className = '', extra, bar = true, apiRef, onScaleChange,
  backgroundSrc, onTransform,
}: Props) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const bgRef = useRef<HTMLImageElement | null>(null)
  const [scale, setScale] = useState(1)
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)
  const [dragging, setDragging] = useState(false)

  const state = useRef({ scale: 1, tx: 0, ty: 0 })
  state.current = { scale, tx, ty }

  const scaleCb = useRef(onScaleChange)
  scaleCb.current = onScaleChange
  useEffect(() => { scaleCb.current?.(scale) }, [scale])

  const transformCb = useRef(onTransform)
  transformCb.current = onTransform
  useEffect(() => { transformCb.current?.({ scale, tx, ty }) }, [scale, tx, ty])

  const clamp = (v: number) => Math.min(max, Math.max(MIN, v))

  const reset = useCallback(() => {
    setScale(1)
    setTx(0)
    setTy(0)
  }, [])

  useEffect(() => {
    bgRef.current = null
    if (!backgroundSrc) return
    let cancelled = false
    const im = new Image()
    im.onload = () => { if (!cancelled) bgRef.current = im }
    im.src = backgroundSrc
    return () => { cancelled = true }
  }, [backgroundSrc])

  // 供页面底部控制条调用：复位 / 读倍率 / 保存当前帧
  useEffect(() => {
    if (!apiRef) return
    apiRef.current = {
      reset,
      getScale: () => state.current.scale,
      saveFrame: (filename = 'frame.png') => {
        const img = imgRef.current
        if (!img || !img.complete || !img.naturalWidth) return
        const cv = document.createElement('canvas')
        cv.width = img.naturalWidth
        cv.height = img.naturalHeight
        const c = cv.getContext('2d')
        if (!c) return
        // 舞台背景是独立 DOM 层，导出时按 contain 取景补到底层
        const bg = bgRef.current
        if (bg) {
          const s = Math.min(cv.width / bg.naturalWidth, cv.height / bg.naturalHeight)
          const w = bg.naturalWidth * s
          const h = bg.naturalHeight * s
          c.drawImage(bg, (cv.width - w) * 0.5, (cv.height - h) * 0.5, w, h)
        }
        c.drawImage(img, 0, 0)
        const a = document.createElement('a')
        a.href = cv.toDataURL('image/png')
        a.download = filename
        document.body.appendChild(a)
        a.click()
        // 立刻 remove 会让 Chromium 取消大尺寸 dataURL 的下载
        window.setTimeout(() => a.remove(), 1000)
      },
    }
    return () => { if (apiRef) apiRef.current = null }
  }, [apiRef, reset])

  useEffect(() => {
    reset()
  }, [src, reset])

  /** 以容器内某点为锚点缩放 */
  const zoomAt = useCallback((px: number, py: number, nextScale: number) => {
    const s = state.current
    const target = clamp(nextScale)
    if (Math.abs(target - s.scale) < 1e-4) return
    const k = target / s.scale
    setTx(px - (px - s.tx) * k)
    setTy(py - (py - s.ty) * k)
    setScale(target)
  }, [max])

  // wheel 必须用原生监听才能 preventDefault（React 的 onWheel 是被动的）
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const factor = Math.exp(-e.deltaY * 0.002)
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, state.current.scale * factor)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  // 拖拽 + 双指捏合
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; scale: number } | null>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    // 工具条上的按钮/链接不参与拖拽
    if ((e.target as HTMLElement).closest('.iv-bar')) return
    const el = boxRef.current
    if (!el) return
    el.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 1) setDragging(true)
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        scale: state.current.scale,
      }
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId)
    if (!prev) return
    const next = { x: e.clientX, y: e.clientY }
    pointers.current.set(e.pointerId, next)

    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinch.current.dist > 0) {
        const el = boxRef.current!
        const rect = el.getBoundingClientRect()
        zoomAt(rect.width / 2, rect.height / 2, pinch.current.scale * (dist / pinch.current.dist))
      }
      return
    }

    // 任意缩放级别都允许拖，避免“缩小后动不了”的困惑
    setTx((v) => v + (next.x - prev.x))
    setTy((v) => v + (next.y - prev.y))
  }

  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (pointers.current.size === 0) setDragging(false)
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.iv-bar')) return
    const el = boxRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (state.current.scale > 1.05) {
      reset()
    } else {
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, 2.5)
    }
  }

  const cursor =
    scale >= max - 0.01 ? 'zoom-out' : scale <= MIN + 0.01 ? 'zoom-in' : dragging ? 'grabbing' : 'grab'

  return (
    <div
      ref={boxRef}
      className={`iv ${dragging ? 'is-dragging' : ''} ${className}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onDoubleClick={onDoubleClick}
    >
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        draggable={false}
        style={{ transform: `translate(${tx}px, ${ty}px) scale(${scale})`, cursor }}
      />
      {bar && (
        <div className="iv-bar" onPointerDown={(e) => e.stopPropagation()}>
          {extra}
          <span className="iv-scale">{scale.toFixed(1)}×</span>
          <button
            className="iv-btn"
            onClick={(e) => {
              e.stopPropagation()
              reset()
            }}
            title="复位到 1×"
            disabled={Math.abs(scale - 1) < 0.01 && tx === 0 && ty === 0}
          >⟲</button>
        </div>
      )}
    </div>
  )
}
