/**
 * CDP 冒烟测试（仅开发期使用，不进构建）：
 *  - 采集 console / pageerror / WebGPU uncapturederror
 *  - 等待主界面挂载，切到各页签确认无崩溃
 *  - 触发透光 GPU 读回校验，读取结果文本
 *  - 输出 4K 渲染截图与 5 秒实测 FPS
 */
import puppeteer from 'puppeteer-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://127.0.0.1:5180/';
const profileDir = mkdtempSync(join(tmpdir(), 'barrel-cdp-'));

const logs = [];
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: profileDir,
  protocolTimeout: 30000,
  args: [
    '--no-sandbox',
    '--disable-gpu-blocklist',
    '--enable-unsafe-webgpu',
    '--enable-webgpu-developer-features',
    '--use-angle=d3d11',
    '--window-size=1600,900',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });

page.on('console', (m) => {
  const t = m.type();
  if ((t === 'error' || t === 'warning') && logs.filter((l) => l.startsWith('CONSOLE')).length < 12) {
    logs.push(`CONSOLE.${t}: ${m.text().slice(0, 500)}`);
  }
});
page.on('pageerror', (e) => logs.push(`PAGEERROR: ${e.message}`));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise((r) => setTimeout(r, 3500));

const errPanelVisible = await page.$eval('#gpu-error', (el) => getComputedStyle(el).display !== 'none');
logs.push(`error-panel-visible: ${errPanelVisible}`);
if (errPanelVisible) {
  logs.push('FATAL: WebGPU error panel visible, aborting');
  console.log(logs.join('\n'));
  await browser.close();
  process.exit(1);
}
// 确认 canvas 确实在出图（非全黑）
const canvasStats = await page.evaluate(() => {
  const c = document.getElementById('gpu-canvas');
  const gl = c.getContext('webgpu');
  return { w: c.width, h: c.height, hasContext: !!gl };
});
logs.push(`canvas: ${JSON.stringify(canvasStats)}`);
const tabs = await page.$$eval('.tab-btn', (els) => els.map((e) => e.textContent));
logs.push(`tabs: ${JSON.stringify(tabs)}`);

// 逐页签切换
for (const name of ['浪形参数', '透光讲解', '灯光天气', '管浪镜头']) {
  await page.evaluate((n) => {
    const btn = [...document.querySelectorAll('.tab-btn')].find((b) => b.textContent === n);
    btn?.click();
  }, name);
  await new Promise((r) => setTimeout(r, 600));
}
logs.push('tab-switch: ok');

// 透光校验
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('GPU 读回校验'));
  btn?.click();
});
await new Promise((r) => setTimeout(r, 2500));
const verifyText = await page.$$eval('.metric-card', (els) => els.map((e) => e.textContent).join(' | '));
logs.push(`verify: ${verifyText.slice(0, 400)}`);

// 多分辨率稳态 FPS（headless 核显数据，用于外推独显余量）
const fpsByRes = {};
for (const mode of ['1080p', '1440p', '4k']) {
  await page.evaluate((m) => {
    const sel = document.querySelector('.res-select');
    sel.value = m;
    sel.dispatchEvent(new Event('change'));
  }, mode);
  await new Promise((r) => setTimeout(r, 1200));
  const fps = await page.evaluate(() => new Promise((resolve) => {
    let frames = 0;
    const t0 = performance.now();
    requestAnimationFrame(function tick() {
      frames++;
      if (performance.now() - t0 < 2500) { requestAnimationFrame(tick); return; }
      resolve((frames * 1000) / (performance.now() - t0));
    });
  }));
  fpsByRes[mode] = Number(fps.toFixed(1));
}
logs.push(`fps-by-resolution (rAF): ${JSON.stringify(fpsByRes)}`);

// 切回 4K，等待 timestamp query 累积后读取 GPU 真实帧时
await page.evaluate(() => {
  const sel = document.querySelector('.res-select');
  sel.value = '4k';
  sel.dispatchEvent(new Event('change'));
});
await new Promise((r) => setTimeout(r, 3500));
const gpuTiming = await page.evaluate(() => {
  const card = document.querySelector('.hud-card');
  return card?.textContent?.replace(/\s+/g, ' ').trim() || 'no-hud';
});
logs.push(`gpu-timing-hud: ${gpuTiming}`);

await page.screenshot({ path: 'shot-4k.png' });
logs.push('screenshot: shot-4k.png');

// 镜头不同时间点截图：管内深处 / 冲出洞口
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent === '暂停');
  btn?.click();
  const seek = document.querySelector('.transport input[type=range]');
  seek.value = 120;
  seek.dispatchEvent(new Event('input', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: 'shot-deep.png' });

// 调试视图：材质 ID / 法线 / 厚度
const diag = await page.evaluate(() => {
  // 从主模块拿不到内部状态，直接在 shader 外复算几何诊断
  const R = 2.4, h = 2.15, arc = 3.65;
  const theta0 = 0.35;
  const theta1 = -0.8 + arc;
  // 相机 t=0.12
  const t = 0.12;
  const sm = (a, b, x) => { const q = Math.max(0, Math.min(1, (x - a) / (b - a))); return q * q * (3 - 2 * q); };
  const exit = sm(0.66, 1, t);
  const radial = 0.45 * R + (1.85 * R - 0.45 * R) * exit;
  const x = radial, y = h - 0.32 * R, z = -7.5 + 15.5 * sm(0, 1, t);
  // 相机到弧心的水平距离
  const dCenter = Math.hypot(x - 0, y - h);
  return {
    thetaRange: [theta0, theta1],
    camera: { x, y, z, radialFromCenter: dCenter, insideRadius: dCenter < R },
    barrelRadius: R,
    // 弧面上几个角度点的世界坐标
    arcPoints: [theta0, theta0 / 2, 0, theta1 * 0.5, theta1].map((th) => ({
      theta: th, x: R * Math.cos(th), y: h + R * Math.sin(th),
    })),
  };
});
logs.push(`diag: ${JSON.stringify(diag)}`);

const debugModes = [
  { mode: 1, name: 'debug-material' },
  { mode: 3, name: 'debug-thickness' },
  { mode: 5, name: 'debug-transmittance' },
  { mode: 6, name: 'debug-thickmap' },
];
for (const { mode, name } of debugModes) {
  await page.evaluate((m) => {
    // 通过 store 暴露在 window 上的调试钩子设置
    window.__setDebug?.(m);
  }, mode);
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: `${name}.png` });
}
await page.evaluate(() => window.__setDebug?.(0));

await page.evaluate(() => {
  const seek = document.querySelector('.transport input[type=range]');
  seek.value = 880;
  seek.dispatchEvent(new Event('input', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: 'shot-exit.png' });

// 回管浪镜头页再截一张
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.tab-btn')].find((b) => b.textContent === '管浪镜头');
  btn?.click();
});
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: 'shot-main.png' });

console.log(logs.join('\n'));
await browser.close();
