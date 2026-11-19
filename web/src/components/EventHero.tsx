import { Link } from 'react-router-dom'
import type { StoryDetail } from '../data'

/**
 * 活动主视觉（动态封面）。
 *
 * 素材是从客户端 eventui bundle 里拆出来的分层贴图（气球＋角色 / 篮筐 / 彩虹 /
 * Logo / 网点），按游戏开屏页的比例重新拼成一整块「舞台」，再用 CSS 让云、气球、
 * 彩虹分层动起来——比直接播视频轻，也比静态封面更接近游戏里的开屏效果。
 *
 * 新增活动只要在 public/event/<slug>/ 放同一批分层图（sky / char / basket /
 * flare / logo / dots）并在 EVENT_HERO 里登记即可；缺资源时组件不渲染。
 */
const EVENT_HERO: Record<number, string> = {
  161: 'skyontherock',
}

export function eventHeroSlug(id: number): string | null {
  return EVENT_HERO[id] ?? null
}

export default function EventHero({ detail, slug }: { detail: StoryDetail; slug: string }) {
  const base = `/event/${slug}`
  const firstChapter = detail.segments[0]
  const preview = (firstChapter?.l ?? [])
    .map((row) => row?.[2]?.replace(/\n/g, ' ') ?? '')
    .filter(Boolean)
    .join(' ')
    .slice(0, 108)

  return (
    <section className="event-hero" aria-label={`${detail.title} 活动主视觉`}>
      <div className="eh-art">
        {/* 舞台按 1080x1440 设计稿定位（游戏活动页就是 3:4），尺寸全部用百分比，容器怎么缩放都对齐 */}
        <div className="eh-stage">
          <div className="eh-layer eh-sky" style={{ backgroundImage: `url(${base}/sky.webp)` }} />
          <img className="eh-layer eh-char" src={`${base}/char.webp`} alt="" />
          <img className="eh-layer eh-basket" src={`${base}/basket.webp`} alt="" />
          <img className="eh-layer eh-flare" src={`${base}/flare.webp`} alt="" />
          <img className="eh-layer eh-logo" src={`${base}/logo.webp`} alt={detail.title} />
          <img className="eh-layer eh-dots" src={`${base}/dots.webp`} alt="" />
          <span className="eh-spark eh-spark-1" />
          <span className="eh-spark eh-spark-2" />
          <span className="eh-spark eh-spark-3" />
        </div>
        <noscript>
          <img className="eh-poster" src={`${base}/poster.webp`} alt={detail.title} />
        </noscript>
      </div>

      <div className="eh-info">
        <span className="eh-kicker">剧情活动</span>
        <h2 className="eh-title">{detail.title}</h2>
        <div className="eh-meta">
          <span>{detail.segments.length} 章</span>
          <span>{detail.segments.reduce((a, s) => a + s.l.length, 0)} 句</span>
          <span>简中文本</span>
        </div>
        {preview && <p className="eh-lede">{preview}…</p>}
        <div className="eh-actions">
          <Link className="btn primary" to={`/story/${detail.id}?ch=0`}>开始阅读</Link>
          <Link className="btn" to={`/story/${detail.id}?ch=0#chapter-list`}>章节目录</Link>
        </div>
      </div>
    </section>
  )
}
