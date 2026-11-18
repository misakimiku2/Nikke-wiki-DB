#!/usr/bin/env node
// 预渲染详情路由的静态 HTML（launch-seo.md B1）+ 生成 sitemap.xml（B2）。
// 在 vite build 之后执行（已接进 web/package.json 的 build 脚本）。
//
// 每个详情页 = dist/index.html 的副本，但替换：
//   - <title> 换成实体标题；
//   - 注入 description / canonical / OG / Twitter 卡片；
//   - <div id="root"> 里塞一段可读的正文摘要（爬虫不执行 JS 也能读到）。
// React 挂载后 #root 整棵被替换，用户无感；不要用 puppeteer 逐页渲染（2452 页太慢）。
//
// 域名只定义这一处（canonical / og:url / sitemap 都用它）：
// 对应 Pages 项目名 nikke-db-wiki；若 wrangler 部署输出的实际 URL 不同，
// 改这里或设环境变量 SITE_URL 后重新构建即可。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const DIST = path.join(ROOT, 'dist')
const PUB = path.join(ROOT, 'public')

const SITE_URL = (process.env.SITE_URL || 'https://nikke-db-wiki.pages.dev').replace(/\/+$/, '')

const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf-8'))
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
// 压平空白并截断（中文 80–120 字；去掉结尾的半个标点）
const clip = (s, n) => {
  const t = String(s).replace(/\s+/g, ' ').trim()
  if (t.length <= n) return t
  return t.slice(0, n - 1).replace(/[，、,;；.!？?\s]+$/, '') + '…'
}
const exists = (rel) => fs.existsSync(path.join(PUB, rel))

// 摘要的极简内联样式：JS 加载前用户会短暂看到它，React 挂载后整体替换
const SUMMARY_STYLE =
  'font-family:system-ui,-apple-system,sans-serif;line-height:1.7;max-width:720px;margin:0 auto;padding:48px 20px;color:#dfe3ea'

// canonical / sitemap 统一带尾斜杠：Cloudflare Pages 对目录型静态页会把
// /characters/94 308 到 /characters/94/，保持一致省得 Google 在两者之间打架。
function renderPage({ title, description, canonicalPath, ogImage, bodyHtml }) {
  let html = template.replace(/<title>.*?<\/title>/s, `<title>${esc(title)}</title>`)
  const metas = [
    `<meta name="description" content="${esc(description)}" />`,
    `<link rel="canonical" href="${SITE_URL}${canonicalPath}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${SITE_URL}${canonicalPath}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="NIKKE 资料库" />`,
    ogImage ? `<meta property="og:image" content="${SITE_URL}${ogImage}" />` : '',
    `<meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}" />`,
  ]
    .filter(Boolean)
    .join('\n    ')
  html = html.replace('</title>', `</title>\n    ${metas}`)
  html = html.replace('<div id="root"></div>', `<div id="root">\n${bodyHtml}\n</div>`)
  return html
}

const writePage = (relDir, html) => {
  const dir = path.join(DIST, relDir)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'index.html'), html)
}

// ---------- 数据 ----------
const template = fs.readFileSync(path.join(DIST, 'index.html'), 'utf-8')
if (!template.includes('<div id="root"></div>')) {
  throw new Error('dist/index.html 里找不到 <div id="root"></div>，请先 npm run build')
}

const chars = readJSON(path.join(PUB, 'data/characters.json')).items
const storyUnits = readJSON(path.join(PUB, 'data/story_index.json')).items
const cgItems = readJSON(path.join(PUB, 'data/cg_index.json')).items
const skillsByChar = readJSON(path.join(PUB, 'data/char_skills.json')).items
const charImages = readJSON(path.join(PUB, 'data/char_images.json'))

// ---------- 角色 ----------
const charCount = (() => {
  let n = 0
  for (const c of chars) {
    const en = c.names?.en || ''
    const desc = clip(c.desc || c.intro || `${c.name}（${en}）的立绘、技能、配装、好感剧情与台词档案，来自客户端本地解包数据。`, 120)
    const codes = charImages[String(c.id)] || []
    const ogImage = codes.length
      ? exists(`charhd/${codes[0]}.webp`)
        ? `/charhd/${codes[0]}.webp`
        : exists(`charmi/${codes[0]}.webp`) ? `/charmi/${codes[0]}.webp` : null
      : null

    const skills = (skillsByChar[String(c.id)] || [])
      .map((s) => `<li>${esc(s.kind)}：${esc(s.name)}</li>`)
      .join('')
    const body = `<div style="${SUMMARY_STYLE}">
  <h1>${esc(c.name)}${en ? ` · ${esc(en)}` : ''}</h1>
  ${c.desc ? `<p>${esc(c.desc).replace(/\n/g, '<br />')}</p>` : ''}
  ${c.intro ? `<p>「${esc(c.intro)}」</p>` : ''}
  ${skills ? `<h2>技能</h2><ul>${skills}</ul>` : ''}
  <p><a href="/">返回 NIKKE 资料库首页</a></p>
</div>`

    writePage(
      `characters/${c.id}`,
      renderPage({ title: `${c.name} · NIKKE 资料库`, description: desc, canonicalPath: `/characters/${c.id}/`, ogImage, bodyHtml: body }),
    )
    n++
  }
  return n
})()

// ---------- 剧情 ----------
const storyCount = (() => {
  let n = 0
  for (const u of storyUnits) {
    let firstLines = []
    try {
      const d = readJSON(path.join(PUB, 'data/story', `${u.id}.json`))
      for (const seg of d.segments) {
        for (const line of seg.l) {
          const txt = (line[2] || '').trim()
          if (txt) firstLines.push(txt)
          if (firstLines.length >= 4) break
        }
        if (firstLines.length >= 4) break
      }
    } catch {
      /* 单元 JSON 缺失就用兜底描述 */
    }
    const desc = clip(
      firstLines.join(' ') || `${u.label} · ${u.title} 的剧情全文，来自客户端本地解包数据。`,
      120,
    )
    const ogImage = u.cover && exists(`cover/${u.cover}.webp`) ? `/cover/${u.cover}.webp` : null
    const body = `<div style="${SUMMARY_STYLE}">
  <h1>${esc(u.title)}</h1>
  <p>${esc(u.label)}${u.chapter != null ? ` · 第 ${u.chapter} 章` : ''} · ${u.lines} 句</p>
  ${firstLines.map((t) => `<p>${esc(t)}</p>`).join('\n  ')}
  <p><a href="/">返回 NIKKE 资料库首页</a></p>
</div>`

    writePage(
      `story/${u.id}`,
      renderPage({
        title: `${u.title} · ${u.label} · NIKKE 资料库`,
        description: desc,
        canonicalPath: `/story/${u.id}/`,
        ogImage,
        bodyHtml: body,
      }),
    )
    n++
  }
  return n
})()

// ---------- CG ----------
const cgCount = (() => {
  let n = 0
  for (const g of cgItems) {
    const where = [g.c, g.s].filter(Boolean).join(' · ')
    const desc = clip(`${g.n}${where ? `（${where}）` : ''}：NIKKE 的 CG 插画，可查看大图与关联剧情。`, 120)
    const body = `<div style="${SUMMARY_STYLE}">
  <h1>${esc(g.n)}</h1>
  ${where ? `<p>${esc(where)}</p>` : ''}
  ${g.h ? `<img src="/img/s/${esc(g.h)}.webp" alt="${esc(g.n)}" width="320" />` : ''}
  <p><a href="/">返回 NIKKE 资料库首页</a></p>
</div>`

    writePage(
      `cg/${g.n}`,
      renderPage({
        title: `${g.n} · CG 图鉴 · NIKKE 资料库`,
        description: desc,
        canonicalPath: `/cg/${g.n}/`,
        ogImage: g.h ? `/img/l/${g.h}.webp` : null,
        bodyHtml: body,
      }),
    )
    n++
  }
  return n
})()

// ---------- sitemap.xml（B2）----------
const today = new Date().toISOString().slice(0, 10)
const urls = [
  '/',
  '/characters',
  '/story',
  '/cg',
  '/notice',
  ...chars.map((c) => `/characters/${c.id}/`),
  ...storyUnits.map((u) => `/story/${u.id}/`),
  ...cgItems.map((g) => `/cg/${g.n}/`),
]
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((p) => `  <url><loc>${SITE_URL}${p}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>
`
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), sitemap)

console.log(
  `预渲染完成：角色 ${charCount} + 剧情 ${storyCount} + CG ${cgCount} = ${charCount + storyCount + cgCount} 页，` +
    `sitemap ${urls.length} 条；域名 ${SITE_URL}`,
)
