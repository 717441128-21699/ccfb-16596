import { describe, it, expect } from 'vitest';
import {
  WATER_TYPES,
  buildSpectrum,
  fitEffectiveOptics,
  integrateSpectrum,
  shaderTransmittance,
  thinThickRatio,
} from '../src/physics/optics';

/**
 * 跨全部 Jerlov 水型的不变量测试，保证导演调节水型/天气时
 * 透光物理在任何组合下都成立（而不仅在默认大洋 1 型下正确）。
 */
describe('全水型物理不变量', () => {
  it('每种水型的 RGB 衰减常数都为有限正数（清水中红端衰减最强）', () => {
    for (const t of WATER_TYPES) {
      const o = fitEffectiveOptics(buildSpectrum(t));
      for (const sig of o.sigmaRGB) {
        expect(Number.isFinite(sig)).toBe(true);
        expect(sig).toBeGreaterThan(0);
      }
    }
    // 清水（大洋 I 型）纯水吸收主导：红光 σ 显著强于绿、蓝
    const clear = fitEffectiveOptics(buildSpectrum(WATER_TYPES[0]));
    expect(clear.sigmaRGB[0]).toBeGreaterThan(clear.sigmaRGB[1]);
    expect(clear.sigmaRGB[0]).toBeGreaterThan(clear.sigmaRGB[2] * 5);
  });

  it('每种水型 d=0 透光率归一化为白光 (1,1,1)，亮度 Y=1', () => {
    for (const t of WATER_TYPES) {
      const spec = buildSpectrum(t);
      const r = integrateSpectrum(spec, 0);
      expect(r.Y).toBeCloseTo(1, 4);
      r.rgb.forEach((c) => expect(c).toBeCloseTo(1, 3));
    }
  });

  it('shader 模型在浪壁真实厚度区间（0.05–3.5m）单调递减', () => {
    for (const t of WATER_TYPES) {
      const o = fitEffectiveOptics(buildSpectrum(t));
      let prev = 1;
      for (const d of [0.05, 0.14, 0.3, 0.6, 1, 1.6, 2.4, 3.5]) {
        const T = shaderTransmittance(o, d);
        const lum = 0.2126 * T[0] + 0.7152 * T[1] + 0.0722 * T[2];
        expect(lum).toBeLessThanOrEqual(prev + 1e-9);
        prev = lum;
      }
    }
  });

  it('浪唇(0.14m)/浪脚(2.8m)亮度比在所有水型下都 >1 且模型与光谱一致', () => {
    for (const t of WATER_TYPES) {
      const spec = buildSpectrum(t);
      const o = fitEffectiveOptics(spec);
      const r = thinThickRatio(spec, o, 0.14, 2.8);
      expect(r.spectralRatio).toBeGreaterThan(1);
      expect(r.modelRatio).toBeGreaterThan(1);
      // 亮度通道（决定画面观感）的模型偏差控制在 10% 内
      expect(r.relativeError).toBeLessThan(0.1);
    }
  });

  it('亮度比仅取决于厚度差：相同 Δd 不同绝对厚度给出相同模型比', () => {
    const o = fitEffectiveOptics(buildSpectrum(WATER_TYPES[2]));
    const r1 = thinThickRatio(buildSpectrum(WATER_TYPES[2]), o, 0.2, 1.2);
    const r2 = thinThickRatio(buildSpectrum(WATER_TYPES[2]), o, 1.0, 2.0);
    expect(r1.modelRatio).toBeCloseTo(r2.modelRatio, 6);
  });

  it('默认浪型（礁石炸弹 tLip=0.14, tBase=2.8）的理论亮度比为有限且 >1', () => {
    const spec = buildSpectrum(WATER_TYPES[2]);
    const o = fitEffectiveOptics(spec);
    const r = thinThickRatio(spec, o, 0.14, 2.8);
    expect(Number.isFinite(r.modelRatio)).toBe(true);
    expect(r.modelRatio).toBeGreaterThan(1); // 薄唇亮于厚浪脚
  });
});
