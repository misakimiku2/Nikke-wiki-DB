import { useEffect } from 'react'

const BASE_TITLE = 'NIKKE 资料库'

/**
 * 详情页设置 document.title（对 Google 有效；百度靠预渲染的静态 HTML）。
 * 传 null / undefined 时不动，卸载或换页时还原成站点默认标题。
 */
export function usePageTitle(title: string | null | undefined) {
  useEffect(() => {
    if (!title) return
    document.title = `${title} · ${BASE_TITLE}`
    return () => {
      document.title = BASE_TITLE
    }
  }, [title])
}
