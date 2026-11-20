import { useEffect, useState } from 'react'
import { Link, useSearchParams, useParams } from 'react-router-dom'
import { NOTICES, type Notice, type NoticeBodyItem, type NoticeText } from '../notices'
import { Pager, pageParam } from '../components/Pager'
import { usePageTitle } from '../usePageTitle'
import { pickLang, useLang, type ContentLang } from '../lang'
import { fmt, useUI, type UIKey } from '../ui'

/** 每页公告条数 */
const NOTICE_PAGE_SIZE = 20

/** tag（中文标签）→ UI 词典 key；不在表里的回退原文 */
const TAG_KEY: Record<string, UIKey> = {
  上线: 'notice_tag_online',
  功能: 'notice_tag_feature',
  数据: 'notice_tag_data',
  修复: 'notice_tag_fix',
  维护: 'notice_tag_maint',
}

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

const isImg = (x: NoticeBodyItem): x is { img: string; cap?: NoticeText } =>
  typeof x !== 'string' && 'img' in x

/** 公告文字统一按内容语言取值（缺失回退简中原文） */
const lineText = (lang: ContentLang) => (x: NoticeBodyItem): string =>
  isImg(x) ? '' : pickLang(lang, x.zh, x.en, x.ko, x.ja)
const titleText = (lang: ContentLang) => (n: Notice): string =>
  pickLang(lang, n.title.zh, n.title.en, n.title.ko, n.title.ja)
const tagText = (lang: ContentLang, tr: (k: UIKey) => string) => (n: Notice): string => {
  const key = TAG_KEY[n.tag]
  return key ? tr(key) : n.tag
}

/** 公告列表页（/notice）：分页卡片流，点标题进详情页（标题/摘要按内容语言显示） */
export default function Notice() {
  const t = useUI()
  const { lang } = useLang()
  const line = lineText(lang)
  const titleOf = titleText(lang)
  const tagOf = tagText(lang, t)
  usePageTitle(t('notice_title'))
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
          <h2>{t('notice_title')}</h2>
        </div>
        <div className="meta">{fmt(t('notice_count'), { n: NOTICES.length })}</div>
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
  const t = useUI()
  const { lang } = useLang()
  const line = lineText(lang)
  const titleOf = titleText(lang)
  const tagOf = tagText(lang, t)
  const n = NOTICES.find((x) => x.slug === slug)
  usePageTitle(n ? `${t('notice_title')} · ${titleOf(n)}` : t('notice_title'))

  if (!n) {
    return (
      <div className="wrap">
        <div className="sec-head">
          <div>
            <div className="idx">NOTICE</div>
            <h2>{t('notice_none')}</h2>
          </div>
        </div>
        <div className="empty">
          {t('notice_deleted')}
          <div style={{ marginTop: 26 }}>
            <Link to="/notice" className="btn">
              {t('notice_back')}
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
          <h2>{t('notice_title')}</h2>
        </div>
        <div className="meta">{n.date} · {tagOf(n)}</div>
      </div>

      <div className="notice-list">
        <article className="notice-item">
          <div className="notice-top">
            <span className="notice-date">{n.date}</span>
            <span className="notice-tag">{tagOf(n)}</span>
          </div>
          <h3>{titleOf(n)}</h3>
          <ul>
            {n.body.map((item, i) =>
              !isImg(item) ? (
                <li key={i}>{line(item)}</li>
              ) : (
                <li key={i} className="notice-img">
                  <img src={item.img} alt={item.cap ? pickLang(lang, item.cap.zh, item.cap.en, item.cap.ko, item.cap.ja) : ''} loading="lazy" />
                  {item.cap && <span className="notice-cap">{pickLang(lang, item.cap.zh, item.cap.en, item.cap.ko, item.cap.ja)}</span>}
                </li>
              ),
            )}
          </ul>
        </article>
      </div>

      <Link to="/notice" className="backlink">
        {t('notice_back')}
      </Link>
    </div>
  )
}

/**
 * 列表卡片：标题可点进详情。摘要显示前几行文字；正文里的第一张配图作为卡片
 * 右侧的背景装饰（绝对定位 + 向左渐隐，不占文档流高度，手机端也不额外撑高）。
 */
function NoticeCard({ n, latest }: { n: Notice; latest: boolean }) {
  const t = useUI()
  const { lang } = useLang()
  const line = lineText(lang)
  const titleOf = titleText(lang)
  const tagOf = tagText(lang, t)
  const mobile = useIsMobile()
  const texts = n.body.filter((x) => !isImg(x))
  const images = n.body.filter(isImg)
  const preview = texts.slice(0, mobile ? 1 : 2).map(line)
  // 有 thumb（通常是头像/头肩裁切）优先用作卡片封面：contain 显示，不裁人物
  const cover = n.thumb ? { img: n.thumb } : images[0]
  const more = n.body.length - preview.length
  return (
    <article className={latest ? 'notice-item latest' : 'notice-item'}>
      {cover && (
        <div className={n.thumb ? 'notice-bgimg thumb' : 'notice-bgimg'} aria-hidden="true">
          <img src={cover.img} alt="" loading="lazy" />
        </div>
      )}
      <div className="notice-top">
        <span className="notice-date">{n.date}</span>
        <span className="notice-tag">{tagOf(n)}</span>
        {latest && <span className="notice-new">NEW</span>}
      </div>
      <h3>
        <Link to={`/notice/${n.slug}`}>{titleOf(n)}</Link>
      </h3>
      <ul>
        {preview.map((text, i) => (
          <li key={i}>{text}</li>
        ))}
      </ul>
      {more > 0 ? (
        <Link to={`/notice/${n.slug}`} className="notice-link">
          {fmt(t('notice_more'), { n: more })}
        </Link>
      ) : (
        <Link to={`/notice/${n.slug}`} className="notice-link">
          {t('notice_read')}
        </Link>
      )}
    </article>
  )
}
