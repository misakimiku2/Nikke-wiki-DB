import { Link } from 'react-router-dom'
import type { StoryDetail } from '../data'

/**
 * 活动主视觉。
 *
 * 游戏开屏页在客户端里是「分层贴图 + Timeline」，但 Timeline 只驱动几个组节点
 * （board_camera / board_title / 粒子），贴图之间是刚性跟随。之前按层各自动
 * 画，一播就散架（气球和篮筐脱开），所以这里只用合成好的一整张 poster.webp，
 * 整幅画做一次极慢推镜——图层不可能再错位。
 *
 * 换活动时在 public/event/<slug>/ 放一张 poster.webp（3:4）并在 EVENT_HERO
 * 里登记即可；没有海报就不渲染。
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
        <div className="eh-stage">
          <img className="eh-poster" src={`${base}/poster.webp`} alt={`${detail.title} 主视觉`} />
        </div>
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
