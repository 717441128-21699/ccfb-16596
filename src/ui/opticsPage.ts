/**
 * 透光讲解页：
 *  - Beer–Lambert 公式与海水吸收/散射光谱表
 *  - 厚度扫描曲线（全光谱积分 vs shader 单指数模型，逐通道）
 *  - 浪唇最薄/最厚亮度比：理论值、光谱积分值、GPU 读回实测值
 *  - 厚度探针滑杆联动状态 dMin/dMax
 */
import type { Store } from '../state/state';
import {
  WAVELENGTHS,
  WATER_TYPES,
  thicknessScan,
  thinThickRatio,
  integrateSpectrum,
  type Spectrum,
} from '../physics/optics';
import type { Engine } from '../render/engine';
import { button, el, select, slider, stat } from './dom';

export function opticsPage(store: Store, engine: Engine): HTMLElement {
  const s = store.get();
  const spectrum: Spectrum = engine.getSpectrum();
  const optics = engine.getOptics();
  const ratio = thinThickRatio(spectrum, optics, s.dMin, s.dMax);

  // —— 公式卡片 ——
  const formula = el('div', { class: 'formula' }, [
    el('div', { class: 'formula-line', textContent: 'T(λ, d) = exp(−c(λ)·d)，c(λ) = a(λ) + b(λ)' }),
    el('div', { class: 'formula-sub', textContent: 'a：吸收系数（纯水 + CDOM + 颗粒）  b：散射系数（λ^-4.3 幂律）' }),
    el('div', { class: 'formula-line', textContent: 'L(d) = L₀·T + L_env·(b_b/c)·(1−T)' }),
    el('div', { class: 'formula-sub', textContent: '第二项为沿光路的环境内散射，厚浪壁呈深蓝绿即来自该项' }),
  ]);

  // —— 水型切换 ——
  const waterSel = select(
    '光谱数据水型',
    WATER_TYPES.map((t) => ({ value: t.id, text: t.label })),
    s.weather.waterTypeId,
    (v) => {
      store.patchWeather({ waterTypeId: v });
      engine.refreshOptics();
      rerender();
    },
  );

  // —— 厚度探针 ——
  const probe = el('div', { class: 'group' }, [
    slider('浪唇最薄厚度 dMin', { min: 0.05, max: 0.6, step: 0.01, value: s.dMin, unit: ' m' }, (v) => {
      store.update({ dMin: v });
      rerender();
    }),
    slider('浪壁最厚厚度 dMax', { min: 1, max: 6, step: 0.1, value: s.dMax, unit: ' m' }, (v) => {
      store.update({ dMax: v });
      rerender();
    }),
  ]);

  // —— 验收指标 1：亮度比 ——
  const ratioStats = el('div', { class: 'stats' }, [
    stat('光谱积分亮度比 Y(dMin)/Y(dMax)', ratio.spectralRatio.toFixed(2) + ' ×'),
    stat('Shader 模型比 e^{σY·Δd}', ratio.modelRatio.toFixed(2) + ' ×'),
    stat('模型 vs 光谱偏差', (ratio.relativeError * 100).toFixed(1) + ' %'),
    stat('Δd = dMax − dMin', `${(ratio.dMax - ratio.dMin).toFixed(2)} m`),
  ]);

  const gpuStat = stat('GPU 实测亮度比（HDR 目标读回）', '点击右侧按钮采样…');
  const gpuBtn = button('从 WebGPU 目标读回实测', async () => {
    gpuBtn.disabled = true;
    gpuStat.querySelector('.stat-value')!.textContent = '采样中…';
    try {
      const r = await engine.measureGpuRatio();
      const onScreen =
        r.thinUV[0] >= 0 && r.thinUV[0] <= 1 && r.thinUV[1] >= 0 && r.thinUV[1] <= 1 &&
        r.thickUV[0] >= 0 && r.thickUV[0] <= 1 && r.thickUV[1] >= 0 && r.thickUV[1] <= 1;
      gpuStat.querySelector('.stat-value')!.innerHTML =
        `${r.measured.toFixed(2)} ×（理论 ${r.theory.toFixed(2)}，偏差 ${(r.error * 100).toFixed(0)}%）` +
        `<br><span class="ok">采样厚度 ${r.dThin.toFixed(2)}m / ${r.dThick.toFixed(2)}m</span>` +
        (onScreen
          ? `<br><span class="ok">✓ 薄/厚探针均在画面内</span>`
          : `<br><span style="color:var(--warn)">探针部分在画面外，请在非镜头页用环绕视角把浪壁纳入画面后重试</span>`);
    } catch (e) {
      gpuStat.querySelector('.stat-value')!.textContent = '读回失败（见控制台）';
      console.error(e);
    }
    gpuBtn.disabled = false;
  }, 'primary');

  // —— 画布 1：吸收/散射光谱 ——
  const specCanvas = el('canvas', { class: 'chart', width: 560, height: 220 }) as HTMLCanvasElement;
  drawSpectrumChart(specCanvas, spectrum);

  // —— 画布 2：厚度扫描（模型 vs 光谱）——
  const scanCanvas = el('canvas', { class: 'chart', width: 560, height: 240 }) as HTMLCanvasElement;
  const scan = thicknessScan(spectrum, optics, Math.max(4, s.dMax + 1));
  drawThicknessChart(scanCanvas, scan);

  // —— 厚度数值表 ——
  const tableRows = [0.1, 0.3, 0.6, 1.0, 2.0, 3.0, 5.0].map((d) => {
    const sp = integrateSpectrum(spectrum, d);
    const T = optics.sigmaRGB.map((sig) => Math.exp(-sig * d));
    return el('tr', {}, [
      el('td', {}, [`${d.toFixed(1)} m`]),
      el('td', {}, [sp.Y.toFixed(4)]),
      el('td', {}, [sp.rgb.map((c) => c.toFixed(3)).join(', ')]),
      el('td', {}, [T.map((c) => c.toFixed(3)).join(', ')]),
    ]);
  });
  const table = el('table', { class: 'data-table' }, [
    el('thead', {}, [el('tr', {}, [el('th', {}, ['厚度']), el('th', {}, ['光谱亮度 Y']), el('th', {}, ['光谱 RGB']), el('th', {}, ['模型 RGB'])])]),
    el('tbody', {}, tableRows),
  ]);

  // —— 拟合误差 ——
  const fitStats = el('div', { class: 'stats' }, [
    stat('R 通道拟合误差', (optics.fitError[0] * 100).toFixed(1) + '%'),
    stat('G 通道拟合误差', (optics.fitError[1] * 100).toFixed(1) + '%'),
    stat('B 通道拟合误差', (optics.fitError[2] * 100).toFixed(1) + '%'),
    stat('拟合深度范围', '0.05–3.5 m'),
  ]);

  const host = el('div', { class: 'page optics-page' }, [
    el('h2', {}, ['透光讲解：海水吸收与散射']),
    formula,
    el('div', { class: 'group' }, [waterSel]),
    el('h3', {}, ['验收指标 1 · 浪唇最薄/最厚亮度比']),
    ratioStats,
    el('div', { class: 'group' }, [probe, el('div', { class: 'btn-row' }, [gpuBtn]), gpuStat]),
    el('h3', {}, ['吸收/散射光谱（17 波段，380–700nm）']),
    specCanvas,
    el('h3', {}, ['透光率随厚度：全光谱积分（实线）vs Shader 单指数（虚线）']),
    scanCanvas,
    fitStats,
    el('h3', {}, ['厚度数值表']),
    table,
  ]);

  function rerender(): void {
    host.replaceWith(opticsPage(store, engine));
  }
  return host;
}

function drawSpectrumChart(c: HTMLCanvasElement, spec: Spectrum): void {
  const ctx = c.getContext('2d')!;
  const W = c.width,
    H = c.height,
    pad = 38;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(10,18,28,0.55)';
  ctx.fillRect(0, 0, W, H);
  const maxC = Math.max(...spec.c) * 1.05;
  const x = (i: number) => pad + (i / (WAVELENGTHS.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - (v / maxC) * (H - pad * 2);
  // 网格
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.fillStyle = '#9fb4c8';
  ctx.font = '11px system-ui';
  for (let g = 0; g <= 4; g++) {
    const yy = pad + ((H - pad * 2) * g) / 4;
    ctx.beginPath();
    ctx.moveTo(pad, yy);
    ctx.lineTo(W - pad, yy);
    ctx.stroke();
    ctx.fillText((maxC * (1 - g / 4)).toFixed(2), 4, yy + 4);
  }
  const series: { data: number[]; color: string; name: string }[] = [
    { data: spec.a, color: '#ff7a59', name: '吸收 a' },
    { data: spec.b, color: '#59c2ff', name: '散射 b' },
    { data: spec.c, color: '#b7ff59', name: '衰减 c=a+b' },
  ];
  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    s.data.forEach((v, i) => (i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v))));
    ctx.stroke();
  }
  WAVELENGTHS.forEach((w, i) => {
    if (i % 2 === 0) ctx.fillText(String(w), x(i) - 10, H - 12);
  });
  ctx.fillStyle = '#fff';
  series.forEach((s, i) => {
    ctx.fillStyle = s.color;
    ctx.fillText(s.name, pad + i * 110, 16);
  });
}

interface ScanSample {
  d: number;
  spectral: [number, number, number];
  model: [number, number, number];
  Y: number;
}

function drawThicknessChart(c: HTMLCanvasElement, scan: ScanSample[]): void {
  const ctx = c.getContext('2d')!;
  const W = c.width,
    H = c.height,
    pad = 38;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(10,18,28,0.55)';
  ctx.fillRect(0, 0, W, H);
  const dMax = scan[scan.length - 1].d;
  const x = (d: number) => pad + (d / dMax) * (W - pad * 2);
  const y = (v: number) => H - pad - v * (H - pad * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.fillStyle = '#9fb4c8';
  ctx.font = '11px system-ui';
  for (let g = 0; g <= 4; g++) {
    const yy = pad + ((H - pad * 2) * g) / 4;
    ctx.beginPath();
    ctx.moveTo(pad, yy);
    ctx.lineTo(W - pad, yy);
    ctx.stroke();
    ctx.fillText((1 - g / 4).toFixed(1), 6, yy + 4);
  }
  const colors = ['#ff6b6b', '#6bff9e', '#6bb3ff'];
  const names = ['R', 'G', 'B'];
  for (let ch = 0; ch < 3; ch++) {
    // 光谱积分实线
    ctx.strokeStyle = colors[ch];
    ctx.lineWidth = 2;
    ctx.beginPath();
    scan.forEach((p, i) => (i === 0 ? ctx.moveTo(x(p.d), y(p.spectral[ch])) : ctx.lineTo(x(p.d), y(p.spectral[ch]))));
    ctx.stroke();
    // 模型虚线
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    scan.forEach((p, i) => (i === 0 ? ctx.moveTo(x(p.d), y(p.model[ch])) : ctx.lineTo(x(p.d), y(p.model[ch]))));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = colors[ch];
    ctx.fillText(names[ch], pad + ch * 30, 16);
  }
  // 亮度 Y 白实线
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  scan.forEach((p, i) => (i === 0 ? ctx.moveTo(x(p.d), y(p.Y)) : ctx.lineTo(x(p.d), y(p.Y))));
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.fillText('Y(亮度)', pad + 100, 16);
  ctx.fillStyle = '#9fb4c8';
  ctx.fillText('厚度 d (m) →', W - 90, H - 12);
}
