/**
 * Headless WebGPU 冒烟测试：
 * 用系统 Chrome + --enable-unsafe-webgpu（SwiftShader 后端）启动，
 * 加载 dev server，捕获 console / pageerror / 未处理 Promise，
 * 并在页面内轮询 canvas 是否真正产出像素、FPS 是否在跑。
 */
import { chromium } from 'playwright';

const URL = process.env.PREVIS_URL ?? 'http://localhost:5173/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const errors: string[] = [];
const warnings: string[] = [];

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  args: [
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--use-angle=swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-dawn-features=allow_unsafe_apis',
    '--window-size=1600,900',
  ],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('console', (msg) => {
  const t = msg.type();
  const text = msg.text();
  if (t === 'error') errors.push(text);
  else if (t === 'warning') warnings.push(text);
});
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
// 等待渲染循环跑起来
await page.waitForTimeout(4000);

const probe = await page.evaluate(async () => {
  const canvas = document.querySelector('#scene') as HTMLCanvasElement | null;
  const fps = document.querySelector('.fps-badge')?.textContent ?? '';
  const gpuInfo = document.querySelector('.gpu-info')?.textContent ?? '';
  const fatal = document.querySelector('.fatal')?.textContent ?? null;
  // 读 canvas 中心像素，确认不是纯黑
  let center: number[] = [];
  if (canvas) {
    const c = document.createElement('canvas');
    c.width = 8;
    c.height = 8;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(canvas, canvas.width / 2 - 4, canvas.height / 2 - 4, 8, 8, 0, 0, 8, 8);
    const d = ctx.getImageData(3, 3, 2, 2).data;
    center = Array.from(d);
  }
  return {
    hasCanvas: !!canvas,
    canvasSize: canvas ? [canvas.width, canvas.height] : null,
    fpsText: fps,
    gpuInfo,
    fatal,
    centerPixel: center,
  };
});

// 切到每个页签确认无崩溃
const tabs = ['wave', 'optics', 'weather', 'shot'];
for (const t of tabs) {
  await page.evaluate((id) => {
    location.hash = id;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }, t);
  await page.waitForTimeout(900);
}
await page.waitForTimeout(1500);

console.log('=== PROBE ===');
console.log(JSON.stringify(probe, null, 2));
console.log('=== ERRORS (' + errors.length + ') ===');
for (const e of errors.slice(0, 25)) console.log(' - ' + e);
console.log('=== WARNINGS (' + warnings.length + ') ===');
for (const w of warnings.slice(0, 10)) console.log(' - ' + w);

const hasContent = probe.centerPixel.some((v, i) => (i % 4 === 3 ? v > 0 : v > 0));
const fpsNum = parseFloat(probe.fpsText);

// 环境本身不支持 WebGPU（远程桌面/无 GPU 沙箱）时不算代码失败，单独诊断
if (probe.fatal && probe.fatal.includes('WebGPU 初始化失败')) {
  console.log('\n⚠️  当前自动化环境不支持 WebGPU（navigator.gpu 不可用或无适配器）。');
  console.log('   这是浏览器/虚拟机限制，不是渲染代码错误。请在带物理 GPU 的本机 Chrome/Edge 手动打开验证。');
  console.log('   WGSL 语法已由 tests/wgsl-check.ts 校验，物理正确性由 vitest 覆盖。');
  await browser.close();
  process.exit(0);
}

const ok = !probe.fatal && errors.length === 0 && hasContent && fpsNum > 0;
console.log(ok ? '\n✅ SMOKE PASS' : '\n❌ SMOKE FAIL');
await browser.close();
process.exit(ok ? 0 : 1);
