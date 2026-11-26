import type { Store, PageId } from './state/state';
import { Store as StoreClass } from './state/state';
import { initWebGPU, gpuInfo } from './render/device';
import { Engine } from './render/engine';
import { Shell, currentHashPage } from './ui/shell';
import { shotPage } from './ui/shotPage';
import { wavePage } from './ui/wavePage';
import { opticsPage } from './ui/opticsPage';
import { weatherPage } from './ui/weatherPage';
import './styles.css';

async function bootstrap(): Promise<void> {
  const app = document.getElementById('app')!;
  const store: Store = new StoreClass();
  store.update({ page: currentHashPage() });

  const shell = new Shell();
  app.append(shell.root);

  // WebGPU 失败时显示可诊断的错误面板
  let engine: Engine;
  try {
    const ctx = await initWebGPU(shell.canvas);
    engine = new Engine(shell.canvas, ctx, store);
    await engine.init();
    const info = document.createElement('div');
    info.className = 'gpu-info';
    info.textContent = gpuInfo(ctx.adapter);
    shell.root.querySelector('.viewport')!.append(info);
  } catch (e) {
    const err = document.createElement('div');
    err.className = 'fatal';
    err.innerHTML = `<h2>WebGPU 初始化失败</h2><p>${String(e instanceof Error ? e.message : e)}</p>
      <p>请使用支持 WebGPU 的浏览器（Chrome/Edge 113+，或 Safari 18+ 在“功能标志”中开启 WebGPU），并确认硬件加速已开启。</p>`;
    app.append(err);
    return;
  }

  engine.onFps = (fps, ms) => {
    shell.fpsBadge.innerHTML = `${fps.toFixed(0)} FPS <span>· ${ms.toFixed(1)} ms</span>`;
    shell.fpsBadge.classList.toggle('low', fps < 50);
  };
  engine.start();

  const mountPage = (page: PageId): void => {
    switch (page) {
      case 'shot':
        shell.mountPage(shotPage(store, engine));
        break;
      case 'wave':
        shell.mountPage(wavePage(store));
        break;
      case 'optics':
        shell.mountPage(opticsPage(store, engine));
        break;
      case 'weather':
        shell.mountPage(weatherPage(store, engine));
        break;
    }
  };

  const navigate = (page: PageId): void => {
    store.update({ page });
    shell.setActive(page);
    mountPage(page);
  };
  shell.onNavigate = navigate;
  window.addEventListener('hashchange', () => navigate(currentHashPage()));
  navigate(currentHashPage());

  // 水型变化时刷新光学（天气页已直接调用，这里做兜底）
  let lastWater = store.get().weather.waterTypeId;
  store.subscribe((st) => {
    if (st.weather.waterTypeId !== lastWater) {
      lastWater = st.weather.waterTypeId;
      engine.refreshOptics();
    }
  });
}

bootstrap();
