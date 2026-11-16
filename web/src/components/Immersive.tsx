/**
 * 沉浸全屏查看：隐藏顶栏与页面其它元素，只留模型/舞台铺满视口。
 *
 * 通过给 <body> 加 immersive-mode 类实现——顶栏在 App.tsx、舞台在页面组件里，
 * 用 body 类可以让两侧 CSS 同时响应，不必把状态提升到路由之外。
 */
import { useCallback, useEffect, useState } from 'react'

export function useImmersive() {
  const [active, setActive] = useState(false)

  useEffect(() => {
    document.body.classList.toggle('immersive-mode', active)
    return () => document.body.classList.remove('immersive-mode')
  }, [active])

  // ESC 退出（页面自己的 ESC 快捷键需判断 active，避免叠加动作）
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setActive(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  const toggle = useCallback(() => setActive((v) => !v), [])
  const exit = useCallback(() => setActive(false), [])
  return { active, toggle, exit }
}

/** 进入全屏的四角展开图标（currentColor，避免 emoji） */
export function ExpandIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" aria-hidden="true">
      <path d="M4 9V4h5M20 9V4h-5M20 15v5h-5M4 15v5h5" />
    </svg>
  )
}

/** 退出全屏的四角收拢图标 */
export function CollapseIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" aria-hidden="true">
      <path d="M9 4v5H4M15 4v5h5M15 20v-5h5M9 20v-5H4" />
    </svg>
  )
}

/** 沉浸模式下悬浮在右上角的退出按钮 */
export function ImmersiveExitButton({ onClick }: { onClick(): void }) {
  return (
    <button className="immersive-exit" onClick={onClick} title="退出全屏（Esc）" aria-label="退出全屏">
      <CollapseIcon />
    </button>
  )
}
