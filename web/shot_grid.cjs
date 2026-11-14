/** 角色列表页截图：node shot_grid.cjs [theme] */
const puppeteer = require('puppeteer-core')
const theme = process.argv[2] || 'dark'
const OUT = '../.shots'

;(async () => {
  const b = await puppeteer.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: 'new',
    args: ['--no-sandbox', '--hide-scrollbars', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 1580, height: 1100, deviceScaleFactor: 2 },
  })
  const p = await b.newPage()
  const logs = []
  p.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()) })
  await p.goto(`http://localhost:5273/?theme=${theme}#/characters`, { waitUntil: 'networkidle2' })
  await new Promise((r) => setTimeout(r, 2000))
  await p.screenshot({ path: `${OUT}/grid-${theme}-1.png` })
  await p.evaluate(() => window.scrollBy(0, 900))
  await new Promise((r) => setTimeout(r, 1200))
  await p.screenshot({ path: `${OUT}/grid-${theme}-2.png` })
  console.log(JSON.stringify({ logs: logs.slice(0, 8) }))
  await b.close()
})()
