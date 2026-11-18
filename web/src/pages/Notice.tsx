import { useEffect, useState } from 'react'
import { Link, useSearchParams, useParams } from 'react-router-dom'
import { NOTICES, type Notice, type NoticeBodyItem } from '../notices'
import { Pager, pageParam } from '../components/Pager'
import { usePageTitle } from '../usePageTitle'

/** 每页公告条数 */
const NOTICE_PAGE_SIZE = 20

/** 是否手机端（与 index.css 公告卡片的 ≤620px 断点一致） */
function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 620px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 620px)')
    const onChange = (e: MediaQueryListEvent) => setMobile(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return mobile
}

const isText = (x: NoticeBodyItem): x is string => typeof x === 'string'
const isImg = (x: NoticeBodyItem): x is { img: string; cap?: string } => typeof x !== 'string'

/** 公告列表页（/notice）：分页卡片流，点标题进详情页 */
export default function Notice() {
  usePageTitle('网站公告')
  const [params, setParams] = useSearchParams()
  // 页码进 URL（?np=2）：返回 / 刷新 / 分享都能恢复现场
  const [page, setPage] = useState(() => pageParam(params, 'np'))

  const maxPage = Math.max(0, Math.ceil(NOTICES.length / NOTICE_PAGE_SIZE) - 1)
  const safePage = Math.min(page, maxPage)

  // 页码写回 URL（replace）
  useEffect(() => {
    const next = new URLSearchParams(params)
    if (safePage > 0) next.set('np', String(safePage + 1))
    else next.delete('np')
    if (next.toString() !== params.toString()) setParams(next, { replace: true })
    // params 不进依赖：本 effect 自己写的 URL 不应触发重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safePage])

  const shown = NOTICES.slice(safePage * NOTICE_PAGE_SIZE, (safePage + 1) * NOTICE_PAGE_SIZE)

  return (
    <div className="wrap">
      <div className="notice-deco" aria-hidden="true" />
      <div className="sec-head" id="notice-top">
        <div>
          <div className="idx">NOTICE</div>
          <h2>网站公告</h2>
        </div>
        <div className="meta">RELEASE NOTES · {NOTICES.length} 条</div>
      </div>

      <div className="notice-list">
        {shown.map((n, i) => (
          <NoticeCard key={n.slug} n={n} latest={safePage * NOTICE_PAGE_SIZE + i === 0} />
        ))}
      </div>

      <Pager
        page={safePage}
        pages={maxPage + 1}
        onPage={setPage}
        anchorId="notice-top"
      />

      <p className="pager-note">LAST UPDATED · {NOTICES[0]?.date || '—'} · 数据来自客户端本地解包，仅供学习交流</p>
    </div>
  )
}

/** 公告详情页（/notice/:slug） */
export function NoticeDetail() {
  const { slug } = useParams()
  const n = NOTICES.find((x) => x.slug === slug)
  usePageTitle(n ? `公告 · ${n.title}` : '网站公告')

  if (!n) {
    return (
      <div className="wrap">
        <div className="sec-head">
          <div>
            <div className="idx">NOTICE</div>
            <h2>公告不存在</h2>
          </div>
        </div>
        <div className="empty">
          这条公告可能已被删除。
          <div style={{ marginTop: 26 }}>
            <Link to="/notice" className="btn">
              返回公告列表
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="wrap">
      <div className="notice-deco" aria-hidden="true" />
      <div className="sec-head">
        <div>
          <div className="idx">NOTICE</div>
          <h2>网站公告</h2>
        </div>
        <div className="meta">{n.date} · {n.tag}</div>
      </div>

      <div className="notice-list">
        <article className="notice-item">
          <div className="notice-top">
            <span className="notice-date">{n.date}</span>
            <span className="notice-tag">{n.tag}</span>
          </div>
          <h3>{n.title}</h3>
          <ul>
            {n.body.map((item, i) =>
              isText(item) ? (
                <li key={i}>{item}</li>
              ) : (
                <li key={i} className="notice-img">
                  <img src={item.img} alt={item.cap || ''} loading="lazy" />
                  {item.cap && <span className="notice-cap">{item.cap}</span>}
                </li>
              ),
            )}
          </ul>
        </article>
      </div>

      <Link to="/notice" className="backlink">
        ← 返回公告列表
      </Link>
    </div>
  )
}

/**
 * 列表卡片：标题可点进详情。摘要显示前几行文字；正文里的第一张配图作为卡片
 * 右侧的背景装饰（绝对定位 + 向左渐隐，不占文档流高度，手机端也不额外撑高）。
 */
function NoticeCard({ n, latest }: { n: Notice; latest: boolean }) {
  const mobile = useIsMobile()
  const texts = n.body.filter(isText)
  const images = n.body.filter(isImg)
  const preview = texts.slice(0, mobile ? 1 : 2)
  const cover = images[0]
  const more = n.body.length - preview.length
  return (
    <article className={latest ? 'notice-item latest' : 'notice-item'}>
      {cover && (
        <div className="notice-bgimg" aria-hidden="true">
          <img src={cover.img} alt="" loading="lazy" />
        </div>
      )}
      <div className="notice-top">
        <span className="notice-date">{n.date}</span>
        <span className="notice-tag">{n.tag}</span>
        {latest && <span className="notice-new">NEW</span>}
      </div>
      <h3>
        <Link to={`/notice/${n.slug}`}>{n.title}</Link>
      </h3>
      <ul>
        {preview.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      {more > 0 ? (
        <Link to={`/notice/${n.slug}`} className="notice-link">
          查看全文（还有 {more} 条内容） →
        </Link>
      ) : (
        <Link to={`/notice/${n.slug}`} className="notice-link">
          查看全文 →
        </Link>
      )}
    </article>
  )
}
