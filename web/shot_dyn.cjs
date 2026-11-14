const puppeteer = require('puppeteer-core')
;(async () => {
  const b = await puppeteer.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'],
    defaultViewport: { width: 1580, height: 950 },
  })
  const p = await b.newPage()
  await p.goto('http://localhost:5273/?theme=dark#/cg', { waitUntil: 'networkidle2' })
  await new Promise(r => setTimeout(r, 1500))
  // 搜索一个已知有动态版的 CG
  await p.evaluate(() => {
    const i = document.querySelector('input.search')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(i, 'ACPUFreeze_01')
    i.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await new Promise(r => setTimeout(r, 800))
  await p.screenshot({ path: '../.shots/dyn-card.png' })
  await p.evaluate(() => document.querySelector('.cg-cell')?.click())
  await new Promise(r => setTimeout(r, 1200))
  const info = await p.evaluate(() => ({
    src: document.querySelector('.lb-stage img')?.getAttribute('src'),
    btns: [...document.querySelectorAll('.lb-flag')].map(x => x.textContent),
  }))
  console.log(JSON.stringify(info))
  await p.screenshot({ path: '../.shots/dyn-lightbox.png' })
  await b.close()
})()
