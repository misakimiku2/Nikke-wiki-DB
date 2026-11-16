/**
 * 概览卡专项截图 —— node shot_spec.cjs <charId> <theme light|dark|''> <prefix>
 * 依次截：默认态 → 点击箭头展开态；并记录 404 资源
 */
const puppeteer = require('puppeteer-core')

const BASE = 'http://localhost:5273'
const OUT = '../.shots'
const id = process.argv[2] || '10'
const theme = process.argv[3] || ''
const prefix = process.argv[4] || 'spec'

;(async () => {
  const b = await puppeteer.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: 'new',
    args: ['--no-sandbox', '--hide-scrollbars', '--enable-unsafe-swiftshader', '--use-gl=angle'],
    defaultViewport: { width: 1580, height: 1000, deviceScaleFactor: 2 },
  })
  const p = await b.newPage()
  const logs = []
  p.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()) })
  p.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message))
  // 捕获 404 的具体 URL
  p.on('response', (r) => { if (r.status() === 404) logs.push('404 ' + r.url()) })

  await p.goto(`${BASE}/${theme ? `?theme=${theme}` : ''}#/characters/${id}`, { waitUntil: 'networkidle2' })
  await new Promise((r) => setTimeout(r, 2500))

  // 卡片区域特写（默认态）
  const card = await p.$('.spec')
  if (card) await card.screenshot({ path: `${OUT}/${prefix}-closed.png` })

  // 点击箭头展开
  const clicked = await p.evaluate(() => {
    const t = document.querySelector('.spec-toggle')
    if (!t) return false
    t.click()
    return true
  })
  await new Promise((r) => setTimeout(r, 500))
  if (clicked) {
    const card2 = await p.$('.spec')
    if (card2) await card2.screenshot({ path: `${OUT}/${prefix}-open.png` })
    // 再点回（收回）验证 toggle 双向可用
    await p.evaluate(() => { document.querySelector('.spec-toggle')?.click() })
    await new Promise((r) => setTimeout(r, 400))
    const card3 = await p.$('.spec')
    if (card3) await card3.screenshot({ path: `${OUT}/${prefix}-reclosed.png` })
  }

  // 点击第 N 个带弹窗的字段格（argv[5]，默认 0），截弹窗
  const popupIdx = Number(process.argv[5] || 0)
  const popupClicked = await p.evaluate((idx) => {
    const cells = document.querySelectorAll('.spec div.spec-click')
    if (!cells[idx]) return false
    cells[idx].click()
    return true
  }, popupIdx)
  await new Promise((r) => setTimeout(r, 400))
  if (popupClicked) {
    const modal = await p.$('.word-modal')
    if (modal) await modal.screenshot({ path: `${OUT}/${prefix}-popup.png` })
    await p.evaluate(() => { (document.querySelector('.word-modal') || document.querySelector('.word-card'))?.click() })
  }

  const info = await p.evaluate(() => ({
    items: [...document.querySelectorAll('.spec div')].map((d) => d.textContent),
    hasToggle: !!document.querySelector('.spec-toggle'),
    popupTitle: document.querySelector('.word-modal .word-title')?.textContent || null,
  }))
  console.log(JSON.stringify({ ...info, logs: logs.slice(0, 10) }, null, 1))
  await b.close()
})()
