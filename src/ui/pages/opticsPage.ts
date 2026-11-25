import { groupLabel, panel } from '../controls';
import {
  PURE_WATER_ABSORPTION,
  RGB_WAVELENGTHS,
  rgbAbsorption,
  rgbScattering,
  rgbTransmittance,
  thicknessBrightnessRatio,
  transmittanceCurve,
} from '../../physics/waterOptics';
import type { ParamStore } from '../../state/params';
import type { Renderer, ValidationResult } from '../../render/renderer';

function drawCurve(canvas: HTMLCanvasElement, store: ParamStore): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const p = store.get();
  const absorb = rgbAbsorption();
  const data = transmittanceCurve(p.thicknessMin, p.thicknessMax, 128, absorb, p.turbidity);
  const padL = 42;
  const padB = 26;
  const padT = 12;
  const padR = 10;
  const plotW = w - padL - padR;
  const plotH = h - padB - padT;
  const xOf = (i: number) => padL + (i / (data.length - 1)) * plotW;
  const yOf = (v: number) => padT + (1 - v) * plotH;

  // 网格与轴
  ctx.strokeStyle = 'rgba(120,200,220,0.12)';
  ctx.lineWidth = 1;
  ctx.font = '10px monospace';
  ctx.fillStyle = '#8aa7b5';
  for (let g = 0; g <= 4; g++) {
    const y = padT + (g / 4) * plotH;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
    ctx.fillText(`${(1 - g / 4).toFixed(2)}`, 6, y + 3);
  }
  for (let g = 0; g <= 4; g++) {
    const t = g / 4;
    const d = p.thicknessMin * Math.pow(p.thicknessMax / p.thicknessMin, t);
    ctx.fillText(`${d < 1 ? `${(d * 100).toFixed(0)}cm` : `${d.toFixed(1)}m`}`, padL + t * plotW - 14, h - 8);
  }

  const channels: Array<{ key: 'r' | 'g' | 'b'; color: string }> = [
    { key: 'r', color: '#ff6b6b' },
    { key: 'g', color: '#4fd1c5' },
    { key: 'b', color: '#5b9dff' },
  ];
  for (const ch of channels) {
    ctx.beginPath();
    data.forEach((s, i) => {
      const x = xOf(i);
      const y = yOf(s[ch.key]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = ch.color;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.fillStyle = '#8aa7b5';
  ctx.fillText('厚度 →', w - 46, h - 8);
  ctx.save();
  ctx.translate(12, padT + plotH / 2 + 18);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('透射率 T', 0, 0);
  ctx.restore();
}

export function buildOpticsPage(store: ParamStore, renderer: Renderer): HTMLElement {
  const p = panel('透光讲解', '海水颜色由吸收/散射的波长相关性决定。shader 与本页共用同一份 Pope & Fry 1997 吸收系数。');

  // —— 公式 ——
  const formula = document.createElement('div');
  formula.className = 'formula';
  formula.innerHTML = `
<span class="c">// Beer–Lambert 厚度透射（每通道独立）</span><br>
<span class="k">T_c(d)</span> = exp( −(a_c + a_particle) · d )<br>
<span class="c">// 单次内散射（Henyey–Greenstein 相位）</span><br>
<span class="k">L_s</span> = b_c/(a_c+b_c) · (1 − exp(−(a_c+b_c)d)) · HG(μ, g)`;
  p.append(formula);

  p.append(groupLabel('当前参数下的理论结果'));
  const metricWrap = document.createElement('div');
  metricWrap.className = 'optics-grid';
  const ratioCard = document.createElement('div');
  ratioCard.className = 'metric-card';
  ratioCard.innerHTML = '<div class="mtitle">浪唇最薄 / 浪脚最厚 亮度比（理论）</div>';
  const ratioVal = document.createElement('div');
  ratioVal.className = 'mval';
  const ratioSub = document.createElement('div');
  ratioSub.className = 'msub';
  ratioCard.append(ratioVal, ratioSub);

  const tMinCard = document.createElement('div');
  tMinCard.className = 'metric-card';
  tMinCard.innerHTML = '<div class="mtitle">最薄处 RGB 透射</div>';
  const tMinVal = document.createElement('div');
  tMinVal.className = 'msub';
  tMinCard.append(tMinVal);

  const tMaxCard = document.createElement('div');
  tMaxCard.className = 'metric-card';
  tMaxCard.innerHTML = '<div class="mtitle">最厚处 RGB 透射</div>';
  const tMaxVal = document.createElement('div');
  tMaxVal.className = 'msub';
  tMaxCard.append(tMaxVal);
  metricWrap.append(ratioCard, tMinCard, tMaxCard);
  p.append(metricWrap);

  p.append(groupLabel('透射率–厚度曲线'));
  const chart = document.createElement('canvas');
  chart.className = 'chart';
  p.append(chart);
  const legend = document.createElement('div');
  legend.className = 'legend';
  legend.innerHTML =
    '<span><i style="background:#ff6b6b"></i>红 615nm</span>' +
    '<span><i style="background:#4fd1c5"></i>绿 550nm</span>' +
    '<span><i style="background:#5b9dff"></i>蓝 465nm</span>';
  p.append(legend);

  p.append(groupLabel('GPU 实测 vs 理论（同 uniform 读回）'));
  const runBtn = document.createElement('button');
  runBtn.className = 'ui-btn primary';
  runBtn.textContent = '运行 GPU 读回校验';
  const verifyWrap = document.createElement('div');
  verifyWrap.style.marginTop = '10px';
  p.append(runBtn, verifyWrap);

  p.append(groupLabel('纯水吸收系数（Pope & Fry 1997 节选）'));
  const tbl = document.createElement('table');
  tbl.className = 'verify';
  const absorbNow = rgbAbsorption();
  tbl.innerHTML =
    '<tr><th>λ(nm)</th><th>a (m⁻¹)</th><th>用途</th></tr>' +
    [400, 465, 500, 550, 600, 615, 650, 700]
      .map((nm) => {
        const a = PURE_WATER_ABSORPTION.find(([w]) => w === nm)?.[1] ?? 0;
        const use =
          nm === RGB_WAVELENGTHS.b ? '蓝通道基准' :
          nm === RGB_WAVELENGTHS.g ? '绿通道基准' :
          nm === RGB_WAVELENGTHS.r ? '红通道基准' : '—';
        const hl = nm === RGB_WAVELENGTHS.b || nm === RGB_WAVELENGTHS.g || nm === RGB_WAVELENGTHS.r ? 'color:#4fd1c5' : '';
        return `<tr><td style="${hl}">${nm}</td><td style="${hl}">${a.toFixed(4)}</td><td>${use}</td></tr>`;
      })
      .join('') +
    `<tr><td colspan="3" style="text-align:left;padding-top:8px">当前 b(550)=${rgbScattering(store.get().turbidity).g.toFixed(5)} m⁻¹（浑浊度 ${store.get().turbidity.toFixed(2)}），红=${absorbNow.r.toFixed(4)} 绿=${absorbNow.g.toFixed(4)} 蓝=${absorbNow.b.toFixed(4)} m⁻¹</td></tr>`;
  p.append(tbl);

  function refreshTheory(): void {
    const sp = store.get();
    const absorb = rgbAbsorption();
    const ratio = thicknessBrightnessRatio(sp.thicknessMin, sp.thicknessMax, absorb, sp.turbidity);
    ratioVal.textContent = `× ${ratio.luminance.toFixed(1)}`;
    ratioSub.innerHTML =
      `分通道 — R <b style="color:#ff6b6b">${ratio.perChannel.r.toFixed(1)}×</b> ` +
      `G <b style="color:#4fd1c5">${ratio.perChannel.g.toFixed(1)}×</b> ` +
      `B <b style="color:#5b9dff">${ratio.perChannel.b.toFixed(1)}×</b>`;
    const t1 = rgbTransmittance(sp.thicknessMin, absorb, sp.turbidity);
    const t2 = rgbTransmittance(sp.thicknessMax, absorb, sp.turbidity);
    tMinVal.innerHTML = `R ${t1.r.toFixed(4)} · G ${t1.g.toFixed(4)} · B ${t1.b.toFixed(4)}（d=${(sp.thicknessMin * 100).toFixed(1)}cm）`;
    tMaxVal.innerHTML = `R ${t2.r.toFixed(4)} · G ${t2.g.toFixed(4)} · B ${t2.b.toFixed(4)}（d=${sp.thicknessMax.toFixed(2)}m）`;
    drawCurve(chart, store);
  }

  runBtn.addEventListener('click', async () => {
    runBtn.disabled = true;
    runBtn.textContent = '校验中…';
    try {
      const res: ValidationResult = await renderer.validateOptics();
      const err = res.maxRelError;
      const pass = Math.max(err.r, err.g, err.b) < 0.06;
      verifyWrap.innerHTML =
        `<div class="metric-card"><div class="mtitle">最大相对误差（RGBA8 量化 ≈1/255）</div>` +
        `<div class="mval ${pass ? 'ok-pill' : 'bad-pill'}">${pass ? '✓ 通过' : '✗ 超差'} ` +
        `max ${(Math.max(err.r, err.g, err.b) * 100).toFixed(2)}%</div>` +
        `<div class="msub">R ${(err.r * 100).toFixed(2)}% · G ${(err.g * 100).toFixed(2)}% · B ${(err.b * 100).toFixed(2)}%` +
        `（含纹理存储量化误差）</div></div>` +
        '<table class="verify" style="margin-top:10px">' +
        '<tr><th>厚度</th><th>理论 R</th><th>GPU R</th><th>理论 G</th><th>GPU G</th><th>理论 B</th><th>GPU B</th></tr>' +
        res.samples
          .map((s) => {
            const f = (v: number) => v.toFixed(3);
            const dn = s.d < 1 ? `${(s.d * 100).toFixed(0)}cm` : `${s.d.toFixed(1)}m`;
            return `<tr><td>${dn}</td><td>${f(s.cpu.r)}</td><td>${f(s.gpu.r)}</td><td>${f(s.cpu.g)}</td><td>${f(s.gpu.g)}</td><td>${f(s.cpu.b)}</td><td>${f(s.gpu.b)}</td></tr>`;
          })
          .join('') +
        '</table>';
    } catch (e) {
      verifyWrap.innerHTML = `<div class="metric-card bad-pill">校验失败：${(e as Error).message}</div>`;
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = '运行 GPU 读回校验';
    }
  });

  store.subscribe(refreshTheory);
  // 面板挂载后再画（需要 clientWidth）
  queueMicrotask(refreshTheory);
  const ro = new ResizeObserver(() => drawCurve(chart, store));
  ro.observe(chart);
  return p;
}
