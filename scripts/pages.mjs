import puppeteer from 'puppeteer-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profileDir = mkdtempSync(join(tmpdir(), 'barrel-pages-'));
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, userDataDir: profileDir, protocolTimeout: 30000,
  args: ['--no-sandbox', '--disable-gpu-blocklist', '--enable-unsafe-webgpu', '--use-angle=d3d11', '--window-size=1600,900'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
await page.goto('http://127.0.0.1:5180/', { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise((r) => setTimeout(r, 2500));

for (const [name, file] of [['透光讲解', 'page-optics.png'], ['灯光天气', 'page-light.png'], ['浪形参数', 'page-shape.png']]) {
  await page.evaluate((n) => {
    [...document.querySelectorAll('.tab-btn')].find((b) => b.textContent === n)?.click();
  }, name);
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: file });
}
// 透光页跑一次校验并截图
await page.evaluate(() => {
  [...document.querySelectorAll('.tab-btn')].find((b) => b.textContent === '透光讲解')?.click();
});
await new Promise((r) => setTimeout(r, 500));
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('GPU 读回校验'))?.click());
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: 'page-optics-verify.png' });
console.log('page screenshots done');
await browser.close();
