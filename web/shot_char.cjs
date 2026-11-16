/**
 * 角色页截图 —— node shot_char.cjs <charId> [variantName] [outPrefix] [light|dark] [滚动目标选择器]
 * 默认 10 / c010_00 / char
 */
const puppeteer = require('puppeteer-core')

const BASE = 'http://localhost:5273'
const OUT = '../.shots'
const id = process.argv[2] || '10'
const variant = process.argv[3] || ''
const prefix = process.argv[4] || 'char'
const theme = process.argv[5] === 'light' || process.argv[5] === 'dark' ? process.argv[5] : ''
const scrollTo = process.argv[6] || ''

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

  // 注意 hash 前不能多一个 /，否则 search 会变成 "?theme=dark/"，get('theme') 拿到 'dark/'
  await p.goto(`${BASE}/${theme ? `?theme=${theme}` : ''}#/characters/${id}`, { waitUntil: 'networkidle2' })
  await new Promise((r) => setTimeout(r, 1200))

  if (variant) {
    const ok = await p.evaluate((v) => {
      const btns = [...document.querySelectorAll('.detail-visual .variants button')]
      const i = btns.findIndex((x) => x.getAttribute('title')?.startsWith(v))
      if (i < 0) return false
      btns[i].click()
      return true
    }, variant)
    if (!ok) logs.push('variant not found: ' + variant)
    await new Promise((r) => setTimeout(r, 3500))
  } else {
    await new Promise((r) => setTimeout(r, 3000))
  }

  if (scrollTo) {
    const ok = await p.evaluate((sel) => {
      const el = document.querySelector(sel)
      if (!el) return false
      el.scrollIntoView({ block: 'start' })
      return true
    }, scrollTo)
    if (!ok) logs.push('scroll target not found: ' + scrollTo)
    await new Promise((r) => setTimeout(r, 800))
  }

  await p.screenshot({ path: `${OUT}/${prefix}-${id}${variant ? '-' + variant : ''}.png` })

  const info = await p.evaluate(() => {
    const c = document.querySelector('.char-stage canvas')
    const chips = [...document.querySelectorAll('.char-anims button')].map((x) => x.textContent)
    const on = document.querySelector('.char-anims button.on')?.textContent
    return {
      canvas: c ? { w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight } : null,
      chips, on,
      slots: [...document.querySelectorAll('.detail-slots .slot')].map((s) => s.textContent),
    }
  })
  console.log(JSON.stringify({ ...info, logs: logs.slice(0, 10) }, null, 1))
  await b.close()
})()
