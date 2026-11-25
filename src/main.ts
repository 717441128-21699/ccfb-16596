import './ui/styles.css';
import { ParamStore, type PageId, type WaveParams } from './state/params';
import { Renderer, type ResolutionMode } from './render/renderer';
import { SHOT_DURATION_S } from './render/camera';
import { buildShotPage } from './ui/pages/shotPage';
import { buildShapePage } from './ui/pages/shapePage';
import { buildOpticsPage } from './ui/pages/opticsPage';
import { buildLightPage } from './ui/pages/lightPage';

const TABS: Array<{ id: PageId; label: string }> = [
  { id: 'shot', label: '管浪镜头' },
  { id: 'shape', label: '浪形参数' },
  { id: 'optics', label: '透光讲解' },
  { id: 'light', label: '灯光天气' },
];

function showError(detail: string): void {
  const el = document.getElementById('gpu-error')!;
  el.hidden = false;
  document.getElementById('gpu-error-detail')!.textContent = detail;
}

async function main(): Promise<void> {
  const canvas = document.getElementById('gpu-canvas') as HTMLCanvasElement;
  const root = document.getElementById('ui-root')!;

  let renderer: Renderer;
  try {
    renderer = await Renderer.create(canvas);
  } catch (e) {
    showError((e as Error).message);
    return;
  }

  const store = new ParamStore();
  // 调试钩子：冒烟测试/控制台用，window.__setDebug(0..4)
  (window as unknown as { __setDebug?: (m: number) => void }).__setDebug = (m: number) => {
    store.set({ debugView: m });
  };
  renderer.setParams(store.get());
  store.subscribe((p: WaveParams) => renderer.setParams(p));

  // ---------- 页签 ----------
  const tabBar = document.createElement('div');
  tabBar.className = 'tab-bar';
  const pages = new Map<PageId, HTMLElement>([
    ['shot', buildShotPage(store)],
    ['shape', buildShapePage(store)],
    ['optics', buildOpticsPage(store, renderer)],
    ['light', buildLightPage(store)],
  ]);
  for (const tab of TABS) {
    const btn = document.createElement('button');
    btn.className = 'tab-btn';
    btn.textContent = tab.label;
    btn.addEventListener('click', () => switchPage(tab.id));
    tabBar.append(btn);
  }
  root.append(tabBar);
  pages.forEach((el) => root.append(el));

  function switchPage(id: PageId): void {
    tabBar.querySelectorAll('.tab-btn').forEach((b, i) => {
      b.classList.toggle('active', TABS[i].id === id);
    });
    pages.forEach((el, key) => {
      el.hidden = key !== id;
    });
  }
  switchPage('shot');

  // ---------- HUD：状态卡 + 播放控制 ----------
  const hud = document.createElement('div');
  hud.className = 'hud';

  const statusCard = document.createElement('div');
  statusCard.className = 'hud-card';
  hud.append(statusCard);

  const transport = document.createElement('div');
  transport.className = 'hud-card transport';
  const playBtn = document.createElement('button');
  playBtn.className = 'ui-btn primary';
  playBtn.textContent = '暂停';
  playBtn.addEventListener('click', () => {
    renderer.paused = !renderer.paused;
    playBtn.textContent = renderer.paused ? '播放' : '暂停';
  });

  const seek = document.createElement('input');
  seek.type = 'range';
  seek.min = '0';
  seek.max = '1000';
  seek.value = '0';
  let seeking = false;
  seek.addEventListener('pointerdown', () => {
    seeking = true;
  });
  seek.addEventListener('input', () => {
    renderer.seekShot(parseInt(seek.value, 10) / 1000);
  });
  window.addEventListener('pointerup', () => {
    seeking = false;
  });

  const resSel = document.createElement('select');
  resSel.className = 'res-select';
  (['auto', '1080p', '1440p', '4k'] as ResolutionMode[]).forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m === 'auto' ? '自适应' : m === '4k' ? '4K (3840×2160)' : m === '1440p' ? '2K (2560×1440)' : '1080p';
    resSel.append(opt);
  });
  resSel.value = '4k';
  renderer.resolutionMode = '4k';
  resSel.addEventListener('change', () => {
    renderer.resolutionMode = resSel.value as ResolutionMode;
  });

  transport.append(playBtn, seek, resSel);
  hud.append(transport);
  root.append(hud);

  // ---------- FPS / 状态回显 ----------
  let lastHud = 0;
  let gpuMs: number | null = null;
  let gpuSamples = 0;
  renderer.onGpuTiming = (avgMs, samples) => {
    gpuMs = avgMs;
    gpuSamples = samples;
  };
  renderer.onFps = (fps, [w, h]) => {
    if (!seeking) seek.value = String(Math.round(renderer.getShotT() * 1000));
    const now = performance.now();
    if (now - lastHud < 250) return;
    lastHud = now;
    const tSec = (renderer.getShotT() * SHOT_DURATION_S).toFixed(2);
    const target = w >= 3840 ? 60 : 60;
    const fpsCls = fps >= target ? '' : fps >= 45 ? 'warn' : 'bad';
    const mode = resSel.value === 'auto' ? '自适应' : `${resSel.value}`;
    statusCard.innerHTML =
      `<b>${w}×${h}</b>（${mode}） · <span class="${fpsCls}">${fps.toFixed(1)} FPS</span>（目标 ≥${target}）<br>` +
      `镜头时间 <b>${tSec}s</b> / ${SHOT_DURATION_S}s · WebGPU 解析管浪渲染<br>` +
      `吸收系数: R ${store.get() && ''}`;
    // 第二行改为物理参数摘要 + GPU 真实帧时
    const p = store.get();
    const gpuLine = gpuMs === null
      ? 'GPU 帧时测量不可用（浏览器未启用 timestamp-query）'
      : `GPU 帧时 <b class="${gpuMs <= 16.67 ? '' : 'warn'}">${gpuMs.toFixed(2)} ms</b>（4K60 需 ≤16.67ms，${gpuSamples} 帧均值）`;
    statusCard.innerHTML =
      `<b>${w}×${h}</b>（${mode}） · <span class="${fpsCls}">${fps.toFixed(1)} FPS</span>（rAF，目标 ≥60）<br>` +
      `${gpuLine}<br>` +
      `镜头时间 <b>${tSec}s</b> / ${SHOT_DURATION_S}s · 厚度 ${(p.thicknessMin * 100).toFixed(0)}cm→${p.thicknessMax.toFixed(1)}m · 浑浊度 ${p.turbidity.toFixed(2)}`;
  };

  renderer.start();
}

main().catch((e) => showError(String(e)));
