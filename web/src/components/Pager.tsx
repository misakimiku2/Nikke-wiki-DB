/** 从 URL 读页码参数（1 起始；缺省 / 非法回到第 1 页） */
export function pageParam(params: URLSearchParams, key: string): number {
  const n = parseInt(params.get(key) || '', 10)
  return Number.isFinite(n) && n > 1 ? n - 1 : 0
}

import { fmt, useUI } from '../ui'

/** 分页条：上一页 / 页码 / 下一页，翻页后滚回锚点（搜索页与公告页共用） */
export function Pager({ page, pages, onPage, anchorId }: {
  page: number
  pages: number
  onPage: (p: number) => void
  anchorId: string
}) {
  const t = useUI()
  if (pages <= 1) return null
  const go = (p: number) => {
    onPage(Math.max(0, Math.min(pages - 1, p)))
    requestAnimationFrame(() => {
      document.getElementById(anchorId)?.scrollIntoView({ block: 'start' })
    })
  }
  return (
    <div className="pager">
      <button type="button" className="chip" disabled={page === 0} onClick={() => go(page - 1)}>
        {t('pager_prev')}
      </button>
      <span className="pager-info">
        {fmt(t('pager_page'), { n: page + 1, t: pages.toLocaleString('zh-CN') })}
      </span>
      <button type="button" className="chip" disabled={page >= pages - 1} onClick={() => go(page + 1)}>
        {t('pager_next')}
      </button>
    </div>
  )
}
