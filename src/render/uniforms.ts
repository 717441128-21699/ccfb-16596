/**
 * SceneParams 的 JS 侧镜像（与 common.wgsl 的 struct 布局严格一致）。
 * 全部 vec4/ mat4 对齐，总长 208 字节 = 52 个 f32。
 */
import type { AppState } from '../state/state';
import type { EffectiveOptics } from '../physics/optics';
import { waveProfile, curtainFlightTime, DEFAULT_CURTAIN, type CurtainParams } from '../physics/wave';
import type { CameraMatrices } from './camera';
import { sunDirection } from './camera';

export const UNIFORM_FLOATS = 64;
export const UNIFORM_BYTES = UNIFORM_FLOATS * 4;

export class UniformBuffer {
  readonly data = new Float32Array(UNIFORM_FLOATS);
  readonly buffer: GPUBuffer;

  constructor(device: GPUDevice) {
    this.buffer = device.createBuffer({
      size: UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  write(
    device: GPUDevice,
    state: AppState,
    cam: CameraMatrices,
    optics: EffectiveOptics,
    time: number,
    curtain: CurtainParams,
  ): void {
    const d = this.data;
    // 0..15 viewProj（列主序，直接拷贝）
    d.set(cam.viewProj, 0);
    // 16 camPos + time
    d[16] = cam.position[0];
    d[17] = cam.position[1];
    d[18] = cam.position[2];
    d[19] = time;
    // 20 camForward + aspect
    d[20] = cam.forward[0];
    d[21] = cam.forward[1];
    d[22] = cam.forward[2];
    d[23] = cam.aspect;
    // 24 wave1: radius, faceWidth, faceHeight, facePower
    const w = state.wave;
    d[24] = w.radius;
    d[25] = w.faceWidth;
    d[26] = w.faceHeight;
    d[27] = w.facePower;
    // 28 wave2: faceU, lipAngle, tBase, tLip
    d[28] = w.faceU;
    d[29] = w.lipAngle;
    d[30] = w.tBase;
    d[31] = w.tLip;
    // 32 wave3: length, peelAngle, flowSpeed, foamAmount
    d[32] = w.length;
    d[33] = w.peelAngle;
    d[34] = w.flowSpeed;
    d[35] = w.foamAmount;
    // 36 light1: sunDir, sunIntensity
    const sun = sunDirection(state.weather);
    d[36] = sun[0];
    d[37] = sun[1];
    d[38] = sun[2];
    d[39] = state.weather.sunIntensity;
    // 40 light2: ambient, turbidity, fog, cloudiness
    d[40] = state.weather.ambientIntensity;
    d[41] = state.weather.turbidity;
    d[42] = state.weather.fog;
    d[43] = state.weather.cloudiness;
    // 44 optics1: sigmaRGB, sigmaLum
    d[44] = optics.sigmaRGB[0];
    d[45] = optics.sigmaRGB[1];
    d[46] = optics.sigmaRGB[2];
    d[47] = optics.sigmaLum;
    // 48 optics2: scatterRGB, dMin
    d[48] = optics.scatterRGB[0];
    d[49] = optics.scatterRGB[1];
    d[50] = optics.scatterRGB[2];
    d[51] = state.dMin;
    // 52 optics3: dMax, lensDrops, godRayStrength, pad —— 占用 52..55
    d[52] = state.dMax;
    d[53] = state.lensDrops;
    d[54] = state.godRayStrength;
    d[55] = 0;
    // 56 curtain1
    d[56] = curtain.launchSpeed;
    d[57] = curtain.launchAngle;
    d[58] = curtain.gravity;
    const lip = waveProfile(w, 1);
    const flight = curtainFlightTime(curtain, lip.y);
    d[59] = flight;
    // 60 curtain2: lipX, lipY, impactZ, pad
    d[60] = lip.x;
    d[61] = lip.y;
    const vx = curtain.launchSpeed * Math.cos(curtain.launchAngle);
    d[62] = lip.x + vx * flight; // 水帘落点 x（世界坐标，用作海面冲击带中心）
    d[63] = 0;

    device.queue.writeBuffer(this.buffer, 0, d.buffer, d.byteOffset, UNIFORM_BYTES);
  }
}
