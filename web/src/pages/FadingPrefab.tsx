import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  childRect, computeRects, computeSubtreeRects, findNode, imageStyle, rectStyle,
  type PrefabData, type PrefabNode, type Rect,
} from '../fadingPrefab'
import './fading-prefab.css'

export interface PrefabChoice {
  text: string
  variant?: 'normal' | 'checked' | 'hidden' | 'disable' | 'erosion'
  sub?: string
  cost?: string
  onClick?: () => void
  disabled?: boolean
}

export interface PrefabStageProps {
  data: PrefabData
  /** 路线对应的 prefab 变体：路线2 用 commander 版纸张装饰 */
  variant?: 'marian' | 'commander'
  orientation?: 'portrait' | 'landscape'
  scriptText?: string
  choices?: PrefabChoice[]
  /** 按节点名覆盖 prefab 里的占位文字 */
  textSlots?: Record<string, ReactNode>
  onBack?: () => void
  debug?: boolean
  children?: ReactNode
  /** 要隐藏的 prefab 节点名（默认隐藏运行时才显示的整屏特效层） */
  hide?: string[]
}

const CHOICE_PNGS: Record<string, string> = {
  normal: 'marian_bg_choice_maria.png',
  checked: 'marian_bg_choice.png',
  hidden: 'marian_bg_choice_hidden.png',
  disable: 'marian_bg_choice.png',
  erosion: 'marian_bg_choice.png',
}

export default function FadingPrefab({
  data, variant = 'marian', orientation = 'portrait', scriptText = '', choices = [],
  textSlots = {}, onBack, debug = false, children,
  hide = ['board_hp_alert_vignette', 'board_shadow', 'board_transition'],
}: PrefabStageProps) {
  const outerRef = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState({ scale: 1, left: 0, top: 0 })

  // 横屏：把同一套锚点放进 1920×1080 的框里重新推导（即「锚点自适应」）
  const canvas = useMemo(() => orientation === 'portrait'
    ? { w: data.canvas.w, h: data.canvas.h }
    : { w: data.canvas.h, h: data.canvas.w }, [data, orientation])

  const rects = useMemo(() => computeRects(data, canvas), [data, canvas])
  const variantName = `scenario_${variant}`

  // 按外层容器等比缩放舞台
  useEffect(() => {
    const el = outerRef.current
    if (!el) return
    const fit = () => {
      const s = Math.min(el.clientWidth / canvas.w, el.clientHeight / canvas.h)
      const scale = Number.isFinite(s) && s > 0 ? s : 1
      // transform 不改变布局盒，flex 居中会把未缩放的画布算进去导致偏移；
      // 直接把缩放后的画布在容器里居中。
      setFit({
        scale,
        left: (el.clientWidth - canvas.w * scale) / 2,
        top: (el.clientHeight - canvas.h * scale) / 2,
      })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [canvas.w, canvas.h])

  // —— 动态内容的位置：从 prefab 的 item_page 模板按原坐标算出来 ——
  const layout = useMemo(() => {
    const scrollPath = `/adventure_scenario_marian/board_ui_ver/${variantName}/board_base/board_contents/board_base/button_area/board_scenario_scroll`
    const scrollRect = rects.get(scrollPath)
    const item = data.templates.item_page
    if (!scrollRect || !item) return null
    const itemRect = childRect(item, scrollRect)
    const sub = computeSubtreeRects(item, scrollRect)
    // 逐层找（board_scenario_select 不是 item_page 直接子节点的情况）
    const walkFind = (n: PrefabNode, name: string, path: string): Rect | undefined => {
      if (n.name === name) return sub.get(path)
      for (const c of n.children || []) {
        const hit = walkFind(c, name, `${path}/${c.name}`)
        if (hit) return hit
      }
      return undefined
    }
    const labelRect = sub.get('/item_page/txt_label_01')
      || walkFind(item, 'txt_label_01', '/item_page')
    const selectRect = sub.get('/item_page/board_scenario_select')
      || walkFind(item, 'board_scenario_select', '/item_page')
    const btnRects: Rect[] = []
    if (selectRect) {
      const sel = findNode(item, 'board_scenario_select')
      for (let i = 1; i <= 5; i++) {
        const btn = sel && findNode(sel, `btn_scenario_select_0${i}`)
        btnRects.push(btn ? childRect(btn, selectRect) : { ...selectRect, y: selectRect.y + (i - 1) * 138 })
      }
    }
    return { itemRect, labelRect, selectRect, btnRects }
  }, [data, rects, variantName])

  // 所有矩形都是「相对画布」的世界坐标，因此把节点拍平成舞台的直接子节点；
  // 若保留 prefab 的嵌套结构，left/top 会相对父 div 再偏移一次。
  const flat: Array<{ node: PrefabNode; path: string; rect: Rect }> = []
  const walk = (nodes: PrefabNode[], path: string) => {
    nodes.forEach((n) => {
      if (n.name === 'scenario_marian' && variantName !== 'scenario_marian') return
      if (n.name === 'scenario_commander' && variantName !== 'scenario_commander') return
      if (hide.includes(n.name)) return
      const p = `${path}/${n.name}`
      const r = rects.get(p)
      if (r) flat.push({ node: n, path: p, rect: r })
      walk(n.children || [], p)
    })
  }
  walk(data.tree, '')

  const stageStyle: CSSProperties = {
    width: canvas.w,
    height: canvas.h,
    left: fit.left,
    top: fit.top,
    transform: `scale(${fit.scale})`,
    transformOrigin: 'top left',
  }

  return (
    <div className={`fad-pf-outer fad-pf-${orientation}`} ref={outerRef}>
      <div className="fad-pf-stage" style={stageStyle}>
        {flat.map(({ node: n, path, rect: r }, i) => {
          const meta = n.image ? data.spriteMeta[String(n.image.spritePathId)] : undefined
          const bg = n.image ? imageStyle(n.image, meta, debug ? { outline: '1px solid rgba(255,0,0,.35)' } : undefined) : undefined
          const slot = textSlots[n.name]
          const content = slot !== undefined ? slot : (n.text || null)
          return (
            <div key={`${path}/${i}`} data-name={n.name} data-path={path} style={{ ...rectStyle(r), pointerEvents: 'none' }}>
              {n.image && <div style={bg} />}
              {content != null && <div className="fad-pf-text">{content}</div>}
            </div>
          )
        })}

        {/* 脚本正文（原版 txt_label_01 的位置） */}
        {layout?.labelRect && (
          <div className="fad-pf-script" style={rectStyle(layout.labelRect)}>
            {scriptText}
          </div>
        )}

        {/* 选项：按原版 btn_scenario_select_01..05 的位置摆放 */}
        {layout?.btnRects.map((r, i) => {
          const c = choices[i]
          if (!c) return null
          const v = c.variant || 'normal'
          return (
            <button
              key={i}
              style={rectStyle(r, {
                backgroundImage: `url(/fading_ui/${CHOICE_PNGS[v] || CHOICE_PNGS.normal})`,
                backgroundSize: '100% 100%',
                backgroundRepeat: 'no-repeat',
                border: 0,
                cursor: c.disabled ? 'default' : 'pointer',
                opacity: c.disabled ? 0.7 : 1,
              })}
              className="fad-pf-choice"
              disabled={c.disabled}
              onClick={c.onClick}
            >
              {v === 'hidden' ? (
                <span className="fad-pf-hidden">???</span>
              ) : (
                <>
                  <span className="fad-pf-choice-label">{c.text}</span>
                  {c.sub && <span className="fad-pf-choice-sub">{c.sub}</span>}
                  {c.cost && <span className="fad-pf-choice-cost">{c.cost}</span>}
                </>
              )}
            </button>
          )
        })}

        {onBack && (
          <button className="fad-pf-back" onClick={onBack} style={{ left: 24, top: 20 }}>← 返回</button>
        )}
        {children}
      </div>
    </div>
  )
}
