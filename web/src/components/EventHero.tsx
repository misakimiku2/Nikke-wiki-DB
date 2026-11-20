import { Link } from 'react-router-dom'
import type { StoryDetail } from '../data'

/**
 * 剧情主视觉卡片（主线 / 活动章节目录页顶部）。
 *
 * 游戏开屏页在客户端里是「分层贴图 + Timeline」，但 Timeline 只驱动几个组节点
 * （board_camera / board_title / 粒子），贴图之间是刚性跟随。之前按层各自动
 * 画，一播就散架（气球和篮筐脱开），所以这里只用合成好的一整张 poster.webp，
 * 整幅画做一次极慢推镜——图层不可能再错位。
 *
 * 艺术图优先级：
 *   1. EVENT_HERO 登记的专属开屏主视觉（public/event/<slug>/poster.webp，3:4）；
 *   2. 该单元的剧情封面 CG（public/cover/<hash>.webp，同样是 3:4）；
 *   3. 两者都没有 → 不渲染图片区，退化为纯文字卡片。
 * 换活动时只需在 public/event/<slug>/ 放 poster.webp 并登记 EVENT_HERO。
 */
const EVENT_HERO: Record<number, string> = {
  161: 'skyontherock',
}

export function eventHeroSlug(id: number): string | null {
  return EVENT_HERO[id] ?? null
}

export default function EventHero({
  detail,
  slug,
  cover,
}: {
  detail: StoryDetail
  slug: string | null
  cover?: string | null
}) {
  // 专属 poster 优先，否则用剧情封面 CG；两者都无则 art = null
  const art = slug
    ? `/event/${slug}/poster.webp`
    : cover
      ? `/cover/${cover}.webp`
      : null
  const kicker = detail.cat === 'main' ? '主线剧情' : '剧情活动'
  const firstChapter = detail.segments[0]
  const preview = (firstChapter?.l ?? [])
    .map((row) => row?.[2]?.replace(/\n/g, ' ') ?? '')
    .filter(Boolean)
    .join(' ')
    .slice(0, 108)

  return (
    <section className={`event-hero${art ? '' : ' no-art'}`} aria-label={`${detail.title} 剧情卡片`}>
      {art && (
        <div className="eh-art">
          <div className="eh-stage">
            <img className="eh-poster" src={art} alt={`${detail.title} 主视觉`} />
          </div>
        </div>
      )}

      <div className="eh-info">
        <span className="eh-kicker">{kicker}</span>
        <h2 className={`eh-title${slug ? '' : ' eh-title-alt'}`}>{detail.title}</h2>
        <div className="eh-meta">
          <span>{detail.segments.length} 章</span>
          <span>{detail.segments.reduce((a, s) => a + s.l.length, 0)} 句</span>
          <span>简中文本</span>
        </div>
        {preview && <p className="eh-lede">{preview}…</p>}
        <div className="eh-actions">
          <Link className="btn primary" to={`/story/${detail.id}?ch=0`}>开始阅读</Link>
        </div>
      </div>
    </section>
  )
}
