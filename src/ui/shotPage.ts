import type { Store } from '../state/state';
import type { Engine, BenchmarkResult } from '../render/engine';
import { button, el, slider, stat, toggle } from './dom';

export function shotPage(store: Store, engine: Engine): HTMLElement {
  const s = store.get();

  const timeSlider = slider('镜头时间（10 秒循环）', {
    min: 0, max: 10, step: 0.02, value: s.cinematicTime, unit: ' s',
  }, (v) => store.update({ cinematicTime: v, cinematicPlaying: false }));

  const playBtn = button(s.cinematicPlaying ? '⏸ 暂停' : '▶ 播放', () => {
    store.update({ cinematicPlaying: !store.get().cinematicPlaying });
    rerender();
  }, 'primary');

  const resStat = stat('内部渲染目标', '3840 × 2160');
  const benchStat = stat('10 秒 4K 基准', '未运行');
  const ratioStat = stat('薄/厚亮度比（理论）', engine.ratioInfo().modelRatio.toFixed(2) + ' ×');

  // 每 0.5s 刷新一次动态数值
  const timer = window.setInterval(() => {
    if (!document.body.contains(host)) {
      window.clearInterval(timer);
      return;
    }
    resStat.querySelector('.stat-value')!.textContent = engine.renderer.internalResolution.join(' × ');
    ratioStat.querySelector('.stat-value')!.textContent = engine.ratioInfo().modelRatio.toFixed(2) + ' ×';
    timeSlider.querySelector('input')!.value = String(store.get().cinematicTime);
    timeSlider.querySelector('.sv')!.textContent = `${store.get().cinematicTime.toFixed(2)} s`;
  }, 500);

  const benchBtn = button('▶ 运行 10 秒 4K 基准测试', async () => {
    benchBtn.disabled = true;
    benchStat.querySelector('.stat-value')!.textContent = '测试中（10s）…';
    const r: BenchmarkResult = await engine.runBenchmark();
    benchStat.querySelector('.stat-value')!.innerHTML =
      `${r.fps.toFixed(1)} FPS · ${r.frameMs.toFixed(2)} ms<br><span class="${r.fps >= 60 ? 'ok' : 'bad'}">${r.fps >= 60 ? '✓ 达标 ≥60' : '✗ 未达标'}</span> · 掉帧 ${r.dipsBelow60}/${r.samples}`;
    benchBtn.disabled = false;
  }, 'primary');

  const controls = el('div', { class: 'group' }, [
    playBtn,
    timeSlider,
    toggle('锁定 4K（3840×2160）内部目标', s.force4K, (v) => store.update({ force4K: v })),
    slider('分辨率缩放（非锁定时 DRS 上限）', {
      min: 0.5, max: 1, step: 0.05, value: s.resolutionScale,
      format: (v) => `${Math.round(v * 100)}%`,
    }, (v) => store.update({ resolutionScale: v })),
    slider('水雾粒子数', { min: 1000, max: 12000, step: 500, value: s.particleCount }, (v) =>
      store.update({ particleCount: Math.round(v) }),
    ),
    slider('镜头水滴强度', { min: 0, max: 1, step: 0.02, value: s.lensDrops, format: (v) => `${Math.round(v * 100)}%` }, (v) =>
      store.update({ lensDrops: v }),
    ),
    slider('光束强度', { min: 0, max: 2.5, step: 0.05, value: s.godRayStrength }, (v) =>
      store.update({ godRayStrength: v }),
    ),
  ]);

  const story = el('div', { class: 'story' }, [
    el('div', { class: 'story-title', textContent: '镜头设计（冲浪者第一人称，10 秒）' }),
    el('ol', {}, [
      el('li', {}, ['0–3s：管内深处，绿蓝透光浪壁环绕，浪唇白沫在头顶掠过']),
      el('li', {}, ['3–7s：沿管前进，斜切洞口亮光逐渐扩大，水雾中出现光束']),
      el('li', {}, ['7–10s：冲出管浪，水滴打上镜头，正面水面泡沫带与阳光闪光']),
    ]),
  ]);

  const host = el('div', { class: 'page' }, [
    el('h2', {}, ['管浪镜头']),
    el('div', { class: 'stats' }, [resStat, benchStat, ratioStat]),
    controls,
    el('div', { class: 'btn-row' }, [benchBtn]),
    story,
  ]);

  function rerender(): void {
    const fresh = shotPage(store, engine);
    host.replaceWith(fresh);
  }
  return host;
}
