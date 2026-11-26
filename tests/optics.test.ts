import { describe, it, expect } from 'vitest';
import {
  WATER_TYPES,
  buildSpectrum,
  fitEffectiveOptics,
  integrateSpectrum,
  thinThickRatio,
  shaderTransmittance,
  thicknessScan,
} from '../src/physics/optics';

describe('海水光学物理', () => {
  const ocean1 = WATER_TYPES.find((w) => w.id === 'ocean1')!;
  const spec = buildSpectrum(ocean1);
  const optics = fitEffectiveOptics(spec);

  it('衰减系数 c = a + b 处处为正', () => {
    for (let i = 0; i < spec.c.length; i++) {
      expect(spec.c[i]).toBeCloseTo(spec.a[i] + spec.b[i], 10);
      expect(spec.c[i]).toBeGreaterThan(0);
    }
  });

  it('红光衰减强于蓝光（水呈蓝绿色的物理根源）', () => {
    // 长波段（620nm 红）吸收远大于短波段（450nm 蓝）
    expect(spec.a[12]).toBeGreaterThan(spec.a[3] * 10);
    expect(optics.sigmaRGB[0]).toBeGreaterThan(optics.sigmaRGB[2]);
  });

  it('Beer–Lambert：透光率随厚度单调下降且 d=0 时为 1', () => {
    const t0 = integrateSpectrum(spec, 0);
    expect(t0.Y).toBeCloseTo(1, 4);
    const t1 = integrateSpectrum(spec, 1);
    const t3 = integrateSpectrum(spec, 3);
    expect(t1.Y).toBeLessThan(1);
    expect(t3.Y).toBeLessThan(t1.Y);
  });

  it('厚度加倍时模型通道满足 T(2d)=T(d)²（纯指数）', () => {
    const T1 = shaderTransmittance(optics, 1.0);
    const T2 = shaderTransmittance(optics, 2.0);
    for (let ch = 0; ch < 3; ch++) {
      expect(T2[ch]).toBeCloseTo(T1[ch] * T1[ch], 6);
    }
  });

  it('单指数模型在 0.05–6m 范围内与光谱积分偏差 < 12%', () => {
    for (const e of optics.fitError) expect(e).toBeLessThan(0.12);
  });

  it('验收指标1：浪唇薄厚亮度比等于 e^{σY·Δd}，且与光谱积分一致（<8%）', () => {
    const r = thinThickRatio(spec, optics, 0.14, 2.8);
    // 理论恒等式
    expect(r.modelRatio).toBeCloseTo(Math.exp(optics.sigmaLum * (2.8 - 0.14)), 6);
    // 薄处比厚处亮
    expect(r.spectralRatio).toBeGreaterThan(1);
    // 模型与光谱积分一致
    expect(r.relativeError).toBeLessThan(0.08);
  });

  it('越清的水（I 型）亮度比越小、浑水（近岸 9 型）亮度比越大', () => {
    const clear = fitEffectiveOptics(buildSpectrum(WATER_TYPES[0]));
    const murky = fitEffectiveOptics(buildSpectrum(WATER_TYPES[6]));
    const rClear = thinThickRatio(buildSpectrum(WATER_TYPES[0]), clear, 0.14, 2.8);
    const rMurky = thinThickRatio(buildSpectrum(WATER_TYPES[6]), murky, 0.14, 2.8);
    expect(rMurky.modelRatio).toBeGreaterThan(rClear.modelRatio);
  });

  it('厚度扫描曲线单调、点数正确', () => {
    const scan = thicknessScan(spec, optics, 5, 50);
    expect(scan).toHaveLength(51);
    for (let i = 1; i < scan.length; i++) {
      expect(scan[i].Y).toBeLessThanOrEqual(scan[i - 1].Y + 1e-9);
    }
  });

  it('内散射项使深水颜色非零（不会黑成 0）', () => {
    const direct = integrateSpectrum(spec, 8, false);
    const withScatter = integrateSpectrum(spec, 8, true);
    expect(withScatter.Y).toBeGreaterThan(direct.Y);
    expect(withScatter.Y).toBeGreaterThan(0.001);
  });
});
