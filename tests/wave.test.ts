import { describe, it, expect } from 'vitest';
import { WAVE_PRESETS, waveProfile, joinThickness, ballistic, curtainFlightTime, DEFAULT_CURTAIN } from '../src/physics/wave';

describe('卷浪剖面几何', () => {
  const p = WAVE_PRESETS.reefBomb.params;

  it('浪脚位于原点且浪唇位于卷管圆上', () => {
    const foot = waveProfile(p, 0);
    expect(foot.x).toBeCloseTo(-p.faceWidth, 6);
    expect(foot.y).toBeCloseTo(0, 6);
    const lip = waveProfile(p, 1);
    const cy = p.faceHeight + p.radius;
    const r = Math.hypot(lip.x, lip.y - cy);
    expect(r).toBeCloseTo(p.radius, 5);
  });

  it('厚度从浪脚到浪唇单调递减', () => {
    let prev = Infinity;
    for (let i = 0; i <= 50; i++) {
      const t = waveProfile(p, i / 50).thickness;
      expect(t).toBeLessThanOrEqual(prev + 1e-9);
      prev = t;
    }
  });

  it('浪唇厚度等于参数 tLip，浪脚厚度等于 tBase', () => {
    expect(waveProfile(p, 1).thickness).toBeCloseTo(p.tLip, 6);
    expect(waveProfile(p, 0).thickness).toBeCloseTo(p.tBase, 6);
  });

  it('浪面段与圆弧段在切点处厚度连续（无跳变）', () => {
    const a = waveProfile(p, p.faceU - 1e-6).thickness;
    const b = waveProfile(p, p.faceU + 1e-6).thickness;
    expect(Math.abs(a - b)).toBeLessThan(1e-3);
    expect(joinThickness(p)).toBeCloseTo(p.tBase * 0.35, 6);
  });

  it('切点处浪面切线水平（平滑接入圆弧在 θ=0 的水平切线）', () => {
    const n = waveProfile(p, p.faceU - 1e-4);
    // 切线水平 → 外法线竖直 → nx≈0
    expect(Math.abs(n.nx)).toBeLessThan(0.05);
  });

  it('所有预设都能生成无 NaN 的完整剖面', () => {
    for (const preset of Object.values(WAVE_PRESETS)) {
      for (let i = 0; i <= 20; i++) {
        const q = waveProfile(preset.params, i / 20);
        expect(Number.isFinite(q.x)).toBe(true);
        expect(Number.isFinite(q.y)).toBe(true);
        expect(Number.isFinite(q.thickness)).toBe(true);
        expect(Math.hypot(q.nx, q.ny)).toBeCloseTo(1, 4);
      }
    }
  });
});

describe('水帘弹道', () => {
  it('飞行时间解落到 y=0，且水平位移为正（甩向浪前方）', () => {
    const lipH = 5.4;
    const tf = curtainFlightTime(DEFAULT_CURTAIN, lipH);
    expect(tf).toBeGreaterThan(0);
    const [dx, dy] = ballistic(DEFAULT_CURTAIN, tf);
    expect(dx).toBeGreaterThan(0);
    expect(lipH + dy).toBeCloseTo(0, 5);
  });

  it('无重力时弹道为直线退化情形 sanity', () => {
    const c = { ...DEFAULT_CURTAIN, gravity: 0 };
    const [, dy] = ballistic(c, 1);
    expect(dy).toBeCloseTo(-c.launchSpeed * Math.sin(c.launchAngle), 6);
  });
});
