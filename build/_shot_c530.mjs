/**
 * Screenshot the c530 burst cut-in over one animation cycle.
 * Usage: node build/_shot_c530.mjs <outPrefix> [baseUrl] [charUrlPath]
 */
import puppeteer from 'puppeteer-core';
import fs from 'fs';

const prefix = process.argv[2] || 'shot_c530';
const base = process.argv[3] || 'http://localhost:5273';
const charPath = process.argv[4] || '/characters/c530';

const CHROME_CANDIDATES = [
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const exe = CHROME_CANDIDATES.find(p => p && fs.existsSync(p));
if (!exe) { console.error('no chrome found'); process.exit(1); }

const browser = await puppeteer.launch({
    executablePath: exe,
    headless: 'new',
    args: ['--no-sandbox', '--window-size=1200,1500'],
    defaultViewport: { width: 1100, height: 1400, deviceScaleFactor: 1.5 },
});
const page = await browser.newPage();
page.on('console', m => { if (m.type() === 'error') console.log('[page]', m.text().slice(0, 160)); });
await page.goto(base + charPath, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise(r => setTimeout(r, 4000));

// 点「大招」按钮（找不到则说明该角色无 burst）
const clicked = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const b = btns.find(x => x.textContent?.trim() === '大招');
    if (b) { b.click(); return true; }
    return false;
});
console.log('burst clicked:', clicked);
if (!clicked) { await browser.close(); process.exit(2); }
await new Promise(r => setTimeout(r, 5000));

// 连拍一个 5.33s 周期：0.55s 间隔 x 10 帧
for (let i = 0; i < 10; i++) {
    const el = await page.$('.spine-player');
    if (!el) { console.error('no .spine-player found'); break; }
    const box = await el.boundingBox();
    const shot = `${prefix}_${(i * 0.55).toFixed(2)}s.png`;
    if (box) {
        await page.screenshot({ path: shot, clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
        console.log('saved', shot);
    }
    await new Promise(r => setTimeout(r, 550));
}
await browser.close();
console.log('done');
