const puppeteer = require('puppeteer-core')
const name = process.argv[2] || 'CherryBlossom_01'
;(async () => {
  const b = await puppeteer.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: 'new', args: ['--no-sandbox', '--hide-scrollbars', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 1580, height: 1000, deviceScaleFactor: 2 },
  })
  const p = await b.newPage()
  await p.goto('http://localhost:5273/?theme=dark#/cg', { waitUntil: 'networkidle2' })
  await new Promise(r => setTimeout(r, 1000))
  await p.evaluate((n) => {
    const i = document.querySelector('input.search')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(i, n); i.dispatchEvent(new Event('input', { bubbles: true }))
  }, name)
  await new Promise(r => setTimeout(r, 800))
  await p.evaluate(() => document.querySelector('.cg-cell')?.click())
  await new Promise(r => setTimeout(r, 3500))
  await p.screenshot({ path: `../.shots/face-${name}.png` })
  await b.close()
})()
