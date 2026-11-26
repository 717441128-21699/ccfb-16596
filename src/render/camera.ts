import type { WeatherParams } from '../state/state';

export interface CameraMatrices {
  view: Float32Array;
  proj: Float32Array;
  viewProj: Float32Array;
  position: [number, number, number];
  /** 视线方向（单位向量） */
  forward: [number, number, number];
  fovY: number;
  aspect: number;
  near: number;
  far: number;
}

export interface OrbitState {
  yaw: number;
  pitch: number;
  distance: number;
  target: [number, number, number];
  fovY: number;
}

export const DEFAULT_ORBIT: OrbitState = {
  yaw: 0,
  pitch: 0.18,
  distance: 24,
  target: [0, 2.6, 30],
  fovY: (55 * Math.PI) / 180,
};

export function perspective(fovY: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = far / (near - far);
  m[11] = -1;
  m[14] = (far * near) / (near - far);
  return m;
}

export function lookAt(eye: number[], center: number[], up: number[]): Float32Array {
  const [ex, ey, ez] = eye;
  let zx = ex - center[0],
    zy = ey - center[1],
    zz = ez - center[2];
  let l = Math.hypot(zx, zy, zz);
  zx /= l;
  zy /= l;
  zz /= l;
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz);
  xx /= l;
  xy /= l;
  xz /= l;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  const m = new Float32Array(16);
  // 列主序
  m[0] = xx;
  m[1] = yx;
  m[2] = zx;
  m[3] = 0;
  m[4] = xy;
  m[5] = yy;
  m[6] = zy;
  m[7] = 0;
  m[8] = xz;
  m[9] = yz;
  m[10] = zz;
  m[11] = 0;
  m[12] = -(xx * ex + xy * ey + xz * ez);
  m[13] = -(yx * ex + yy * ey + yz * ez);
  m[14] = -(zx * ex + zy * ey + zz * ez);
  m[15] = 1;
  return m;
}

export function multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

export function orbitCamera(o: OrbitState, aspect: number): CameraMatrices {
  const cp = Math.cos(o.pitch);
  const eye: [number, number, number] = [
    o.target[0] + o.distance * cp * Math.sin(o.yaw),
    o.target[1] + o.distance * Math.sin(o.pitch),
    o.target[2] + o.distance * cp * Math.cos(o.yaw),
  ];
  const view = lookAt(eye, o.target, [0, 1, 0]);
  const proj = perspective(o.fovY, aspect, 0.1, 400);
  return {
    view,
    proj,
    viewProj: multiply(proj, view),
    position: eye,
    forward: normalize3([o.target[0] - eye[0], o.target[1] - eye[1], o.target[2] - eye[2]]),
    fovY: o.fovY,
    aspect,
    near: 0.1,
    far: 400,
  };
}

function normalize3(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * 10 秒电影镜头：第一人称从管内深处向斜切洞口前进（冲浪者钻出管浪视角）。
 * 路径沿 Z 前进、略微抬升并带手持晃动；FOV 在冲出瞬间轻微扩大。
 * 时间 t ∈ [0,10]，循环播放。
 */
export function cinematicCamera(t: number, waveLength: number, radius: number, aspect: number): CameraMatrices {
  const phase = t / 10; // 0..1
  const zStart = 6;
  const zEnd = waveLength * 0.62;
  const z = zStart + (zEnd - zStart) * smoothstep(0, 1, phase);
  // 管内位置：卷管中心偏下偏前（站在板上的视角）
  const eye: [number, number, number] = [
    -radius * 0.18 + Math.sin(t * 1.7) * 0.06,
    radius * 0.85 + Math.sin(t * 2.3 + 1) * 0.05,
    z,
  ];
  // 视线沿洞口方向（+Z），轻微向亮处抬
  const sway = Math.sin(t * 0.9) * 0.03;
  const center: [number, number, number] = [
    eye[0] + sway,
    eye[1] + 0.12 + phase * radius * 0.25,
    eye[2] + 1,
  ];
  const fovY = ((62 + phase * 8) * Math.PI) / 180;
  const view = lookAt(eye, center, [0, 1, 0]);
  const proj = perspective(fovY, aspect, 0.08, 400);
  const fwd = normalize3([center[0] - eye[0], center[1] - eye[1], center[2] - eye[2]]);
  return {
    view,
    proj,
    viewProj: multiply(proj, view),
    position: eye,
    forward: fwd,
    fovY,
    aspect,
    near: 0.08,
    far: 400,
  };
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** 太阳方向单位向量（指向太阳） */
export function sunDirection(w: WeatherParams): [number, number, number] {
  const ce = Math.cos(w.sunElevation);
  return [
    Math.sin(w.sunAzimuth) * ce,
    Math.sin(w.sunElevation),
    Math.cos(w.sunAzimuth) * ce,
  ];
}
