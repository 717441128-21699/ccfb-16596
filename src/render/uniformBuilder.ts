/**
 * 把 WaveParams + 相机帧 + 时间写入与 WGSL struct Params 对齐的 Float32Array。
 * 槽位定义见 state/params.ts 的 UNIFORM_SLOTS，顺序不可随意调整。
 */
import { rgbAbsorption, rgbScattering } from '../physics/waterOptics';
import { slotIndex, UNIFORM_STRIDE, type WaveParams } from '../state/params';
import type { CameraFrame } from './camera';

function sunDirection(elevDeg: number, azDeg: number): [number, number, number] {
  const el = (elevDeg * Math.PI) / 180;
  const az = (azDeg * Math.PI) / 180;
  // 方位角 0 = +x，高度角从水平面起算
  return [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
}

/** 太阳颜色：低度光偏暖金，正午偏白；阴天去饱和压灰。 */
function sunColor(elevDeg: number, cloud: number): [number, number, number] {
  const warmth = Math.max(0, Math.min(1, (32 - elevDeg) / 32));
  const clear: [number, number, number] = [
    1.0,
    1.0 - 0.28 * warmth,
    1.0 - 0.55 * warmth,
  ];
  const overcast: [number, number, number] = [0.78, 0.82, 0.88];
  const c = cloud;
  return [
    clear[0] * (1 - c) + overcast[0] * c,
    clear[1] * (1 - c) + overcast[1] * c,
    clear[2] * (1 - c) + overcast[2] * c,
  ];
}

/** 深水色：白光走过约 2.5 m 水体后的散射主导色（用于浪面暗部与平面水体）。 */
function deepWaterColor(
  absorb: { r: number; g: number; b: number },
  scatter: { r: number; g: number; b: number },
  turbidity: number,
): [number, number, number] {
  const d = 2.5;
  const particle = 0.06 * turbidity;
  const ch = (a: number, b: number) => {
    const trans = Math.exp(-(a + particle) * d);
    const scat = (b / (a + b + 1e-5)) * (1 - trans);
    // 深水基色：压暗整体、抬绿压红蓝，形成导演要的深绿青色调
    return 0.3 * trans + 1.05 * scat;
  };
  const raw = [ch(absorb.r, scatter.r), ch(absorb.g, scatter.g), ch(absorb.b, scatter.b)];
  return [raw[0] * 0.55, raw[1] * 1.2, raw[2] * 0.85];
}

function skyPalettes(elevDeg: number, cloud: number) {
  const warmth = Math.max(0, Math.min(1, (28 - elevDeg) / 28));
  const zenithClear: [number, number, number] = [0.16 + 0.12 * warmth, 0.38 + 0.05 * warmth, 0.78 - 0.1 * warmth];
  const horizonClear: [number, number, number] = [0.75, 0.82 - 0.1 * warmth, 0.92 - 0.25 * warmth];
  const zenithCloud: [number, number, number] = [0.42, 0.45, 0.5];
  const horizonCloud: [number, number, number] = [0.62, 0.64, 0.68];
  const mix = (a: number[], b: number[]): [number, number, number] => [
    a[0] * (1 - cloud) + b[0] * cloud,
    a[1] * (1 - cloud) + b[1] * cloud,
    a[2] * (1 - cloud) + b[2] * cloud,
  ];
  return {
    zenith: mix(zenithClear, zenithCloud),
    horizon: mix(horizonClear, horizonCloud),
  };
}

export class UniformBuilder {
  readonly buffer = new Float32Array(new ArrayBuffer(UNIFORM_STRIDE * 4));

  update(
    p: WaveParams,
    cam: CameraFrame,
    time: number,
    resolution: { width: number; height: number },
  ): Float32Array<ArrayBuffer> {
    const b = this.buffer;
    b.fill(0);
    const absorb = rgbAbsorption();
    const scatter = rgbScattering(p.turbidity);
    const sun = sunDirection(p.sunElevation, p.sunAzimuth);
    const sCol = sunColor(p.sunElevation, p.cloudCoverage);
    const deep = deepWaterColor(absorb, scatter, p.turbidity);
    const sky = skyPalettes(p.sunElevation, p.cloudCoverage);
    const particleAbs = 0.06 * p.turbidity;

    let i = slotIndex('u_camPos');
    b.set([cam.pos[0], cam.pos[1], cam.pos[2], time], i);
    i = slotIndex('u_camTarget');
    b.set([cam.target[0], cam.target[1], cam.target[2], cam.fovY], i);
    i = slotIndex('u_sunDir');
    b.set([sun[0], sun[1], sun[2], p.sunIntensity], i);
    i = slotIndex('u_sunColor');
    b.set([sCol[0], sCol[1], sCol[2], p.cloudCoverage], i);
    i = slotIndex('u_absorb');
    b.set([absorb.r, absorb.g, absorb.b, p.turbidity], i);
    i = slotIndex('u_scatter');
    b.set([scatter.r, scatter.g, scatter.b, particleAbs], i);
    i = slotIndex('u_barrel');
    b.set([p.barrelRadius, p.barrelHeight, p.arcAngle, p.crestHalfLength], i);
    i = slotIndex('u_thickness');
    b.set([p.thicknessMin, p.thicknessMax, p.thicknessFalloff, p.rippleAmp], i);

    // 浪唇抛射点（弧面 theta1 处，新角度域：浪脚 -π/2 起算）
    const thetaMax = -Math.PI / 2 + p.arcAngle + p.lipAngle;
    const lipX = p.barrelRadius * Math.cos(thetaMax);
    const lipY = p.barrelHeight + p.barrelRadius * Math.sin(thetaMax);
    i = slotIndex('u_curtainA');
    b.set([lipX, lipY, p.jetVx, p.jetVy], i);
    i = slotIndex('u_curtainB');
    b.set([p.gravity, p.curtainWidth, p.rippleScale, p.curtainOpacity], i);
    i = slotIndex('u_fx');
    b.set([p.foamAmount, p.mistAmount, p.lensWater, p.foamStretch], i);
    i = slotIndex('u_env');
    // HG 相位不对称因子 g：逆光散射强烈前向
    b.set([p.fogDensity, p.exposure, 0.82, p.surfaceRoughness], i);
    i = slotIndex('u_deepColor');
    b.set([deep[0], deep[1], deep[2], p.lipAngle], i);
    i = slotIndex('u_skyZenith');
    b.set([sky.zenith[0], sky.zenith[1], sky.zenith[2], 0.025], i); // w = 太阳角直径
    i = slotIndex('u_skyHorizon');
    // w = 浪面沿 z 的流动相位速度
    b.set([sky.horizon[0], sky.horizon[1], sky.horizon[2], 0.35], i);
    i = slotIndex('u_resolution');
    b.set([resolution.width, resolution.height, resolution.width / resolution.height, 1.0], i);
    i = slotIndex('u_post');
    b.set([0.035, 0.28, time * p.timeScale, 0], i); // filmGrain, vignette, waveTime, jetProgress
    i = slotIndex('u_debug');
    b.set([p.debugView, 0, 0, 0], i);
    return b;
  }
}
