/**
 * 网站公告 / 发布说明。
 * 人工维护：发新公告时在数组头部加一条，重新构建部署即可（页面按数组顺序展示，最新在前）。
 * slug 用于详情页 URL（/notice/<slug>），发布后不要再改，免得外链失效。
 * tag 建议用：上线 / 功能 / 数据 / 修复 / 维护
 */
/** 正文条目：字符串 = 一行文字；对象 = 配图（img 为图片地址，cap 为可选图注）。
 *  图片可以用站内已有资源（如 /img/m/<CG哈希>.webp），也可以放 public/notice/ 下引用。 */
export type NoticeBodyItem = string | { img: string; cap?: string }

export type Notice = {
  /** 详情页 URL 标识，如 'site-search' → /notice/site-search */
  slug: string
  /** 发布日期，YYYY-MM-DD */
  date: string
  tag: string
  title: string
  /** 正文（文字行与配图按顺序混排），每个元素渲染为一行 / 一张图 */
  body: NoticeBodyItem[]
}

export const NOTICES: Notice[] = [
  {
    slug: 'site-search',
    date: '2026-11-19',
    tag: '功能',
    title: '全站搜索上线，公告页开放',
    body: [
      '顶部「搜索」升级为全站搜索：一次输入，同时检索角色、CG、剧情段落与台词，结果按类别分组展示。',
      'CG 除英文内部名外，也支持通过关联剧情的中文名检索（例：搜活动名可以直达该活动的 CG）。',
      '首页按钮「搜台词」改为「网站公告」，也就是当前页面；以后的数据更新、功能调整与问题修复都会在这里发布说明。',
      { img: '/img/m/7ef67c0f551bafb3.webp', cap: '全站搜索：角色 / CG / 剧情 / 台词 分组展示' },
    ],
  },
  {
    slug: 'launch',
    date: '2026-11-19',
    tag: '上线',
    title: 'NIKKE 资料库正式上线',
    body: [
      '站点部署于 Cloudflare Pages（nikke-db-wiki.pages.dev），纯静态托管，国内可直接访问。',
      '首版收录 312 名角色、528,256 条剧情台词、1,768 张 CG、668 个剧情单元，全部来自客户端本地解包，游戏更新即同步。',
      '后续的数据更新、功能调整与问题修复都会在公告页发布。',
      { img: '/img/m/ec039079e903c59a.webp', cap: 'NIKKE 资料库首版上线' },
    ],
  },
]
