/**
 * 卷浪（管浪）参数化几何
 * ---------------------------------------------------------------
 * 剖面在 XY 平面、沿 Z 方向挤出（管洞朝向 Z，镜头在管内沿 Z 朝洞口看）。
 *
 * 剖面由两段组成（参数 u ∈ [0,1]）：
 *   1) 浪面段 u ∈ [0, FACE_U]：从浪脚(0,0)到卷管切点，
 *      用幂次凹曲线构造，满足起点竖直、终点接圆切线；
 *   2) 圆弧段 u ∈ [FACE_U, 1]：从切点沿"卷过头"的圆弧走到浪唇，
 *      圆心在切点正上方 R 处，终点位于圆底偏左（开始甩出水帘）。
 *
 * 厚度场 t(u)：底部厚、沿浪面递减、进入圆弧后按指数快速变薄，
 * 浪唇 tLip 最薄。所有几何/厚度函数与 WGSL（shaders/common.wgsl）保持逐式一致。
 */

export interface WaveParams {
  /** 卷管半径（浪高≈2R），米 */
  radius: number;
  /** 浪面横向长度，米 */
  faceWidth: number;
  /** 浪面高度（到卷管切点），米 */
  faceHeight: number;
  /** 浪面曲线幂次（越大越凹） */
  facePower: number;
  /** 浪面段占整条剖面的参数比例 */
  faceU: number;
  /** 浪唇终点角（弧度；π=正圆底，略小于 π 表示尚未完全闭合） */
  lipAngle: number;
  /** 浪脚厚度，米 */
  tBase: number;
  /** 浪唇最薄厚度，米 */
  tLip: number;
  /** 沿挤出方向 Z 的浪长，米 */
  length: number;
  /** 浪的剥离角（弧度），浪沿线向一端推进、洞口斜切 */
  peelAngle: number;
  /** 浪面随浪流的沿流速度（m/s，用于泡沫白条拖尾与镜头运动感） */
  flowSpeed: number;
  /** 泡沫覆盖度 0–1 */
  foamAmount: number;
}

export const WAVE_PRESETS: Record<string, { label: string; params: WaveParams }> = {
  reefBomb: {
    label: '礁石炸弹（默认大浪）',
    params: {
      radius: 3.2,
      faceWidth: 7.5,
      faceHeight: 4.6,
      facePower: 2.2,
      faceU: 0.55,
      lipAngle: 3.02,
      tBase: 2.8,
      tLip: 0.14,
      length: 90,
      peelAngle: 0.62,
      flowSpeed: 7.5,
      foamAmount: 0.65,
    },
  },
  beachBreak: {
    label: '沙滩碎浪（小而厚）',
    params: {
      radius: 1.8,
      faceWidth: 4.6,
      faceHeight: 2.7,
      facePower: 1.8,
      faceU: 0.58,
      lipAngle: 3.05,
      tBase: 1.8,
      tLip: 0.22,
      length: 60,
      peelAngle: 0.5,
      flowSpeed: 5.0,
      foamAmount: 0.8,
    },
  },
  slab: {
    label: '薄板巨浪（极薄浪唇）',
    params: {
      radius: 4.2,
      faceWidth: 9.0,
      faceHeight: 5.6,
      facePower: 2.6,
      faceU: 0.52,
      lipAngle: 2.98,
      tBase: 3.4,
      tLip: 0.08,
      length: 110,
      peelAngle: 0.7,
      flowSpeed: 9.0,
      foamAmount: 0.5,
    },
  },
  closeout: {
    label: '闭合浪（浪唇压到水面）',
    params: {
      radius: 2.6,
      faceWidth: 6.2,
      faceHeight: 3.6,
      facePower: 2.0,
      faceU: 0.55,
      lipAngle: 3.12,
      tBase: 2.4,
      tLip: 0.18,
      length: 70,
      peelAngle: 0.35,
      flowSpeed: 6.2,
      foamAmount: 0.9,
    },
  },
};

export interface ProfilePoint {
  x: number;
  y: number;
  /** 外法线（XY 平面） */
  nx: number;
  ny: number;
  /** 光学厚度，米 */
  thickness: number;
}

/** 卷浪剖面（CPU 镜像，测试与讲解页使用；WGSL 版本见 common.wgsl） */
export function waveProfile(p: WaveParams, u: number): ProfilePoint {
  const R = p.radius;
  if (u <= p.faceU) {
    // —— 浪面段：f(s)=faceHeight·(1-(1-s)^power)，终点切向竖直 ——
    const s = u / p.faceU; // 0..1
    const x = -p.faceWidth * (1 - s);
    const y = p.faceHeight * (1 - Math.pow(1 - s, p.facePower));
    const dxds = p.faceWidth;
    const dyds = p.faceHeight * p.facePower * Math.pow(1 - s, p.facePower - 1);
    const len = Math.hypot(dxds, dyds);
    // 切向 (dx,dy)（随 s 增大方向），外法线指向浪背（左侧）：(dy,-dx) 归一化
    const nx = dyds / len;
    const ny = -dxds / len;
    // 厚度：浪脚 tBase → 切点 0.35·tBase（与圆弧段 q=0 严格连续），幂次过渡
    const k = (p.tBase * 0.35 - p.tLip) / (p.tBase - p.tLip);
    const frac = k + (1 - k) * Math.pow(1 - s, 1.35);
    const t = p.tLip + (p.tBase - p.tLip) * frac;
    return { x, y, nx, ny, thickness: t };
  }
  // —— 圆弧段：圆心 (0, faceHeight+R)，切点处 θ=0，随 u 增大顺时针卷过 ——
  const q = (u - p.faceU) / (1 - p.faceU); // 0..1
  const theta = q * p.lipAngle;
  const cx = 0;
  const cy = p.faceHeight + R;
  const x = cx - R * Math.sin(theta);
  const y = cy - R * Math.cos(theta);
  // 外法线 = 径向向外
  const nx = -Math.sin(theta);
  const ny = -Math.cos(theta);
  // 厚度：切点 0.35·tBase（与浪面段 s=1 严格连续）指数变薄到浪唇 tLip
  const tJoinVal = p.tBase * 0.35;
  const t = p.tLip * Math.exp((1 - q) * Math.log(tJoinVal / p.tLip));
  return { x, y, nx, ny, thickness: t };
}

/** 剖面终点厚度（圆弧段 q=0），用于校验两段厚度连续 */
export function joinThickness(p: WaveParams): number {
  return p.tBase * 0.35;
}

/**
 * 3D 浪面位置。网格属性 (u ∈ [0,1], z0 ∈ [0,1])。
 * 浪沿 Z 以 peelAngle 斜切：每推进 1m，浪"年轻" peelX 米，
 * 使镜头在管内沿 Z 看到斜向明亮洞口。
 */
export function wavePosition(p: WaveParams, u: number, z0: number): [number, number, number] {
  const prof = waveProfile(p, u);
  const z = z0 * p.length;
  const peel = (z / p.length) * p.peelAngle * p.radius * 2.2;
  return [prof.x - peel, prof.y, z];
}

/** 水帘弹道：浪唇抛出的水片在重力下落到前方水面 */
export interface CurtainParams {
  /** 抛出初速 m/s（约 √(gR) 量级） */
  launchSpeed: number;
  /** 抛出方向相对水平面向下的角度（弧度） */
  launchAngle: number;
  /** 水帘条数（沿 Z） */
  strips: number;
  /** 每条水帘的网格段数 */
  segments: number;
  gravity: number;
}

export const DEFAULT_CURTAIN: CurtainParams = {
  launchSpeed: 6.5,
  launchAngle: 0.35,
  strips: 26,
  segments: 22,
  gravity: 9.81,
};

/** 弹道点：返回相对浪唇的位移 (dx, dy)，dy 向下为负 */
export function ballistic(c: CurtainParams, t: number): [number, number] {
  const vx = c.launchSpeed * Math.cos(c.launchAngle);
  const vy = -c.launchSpeed * Math.sin(c.launchAngle);
  return [vx * t, vy * t - 0.5 * c.gravity * t * t];
}

/** 求水帘落到 y=0 的飞行时间 */
export function curtainFlightTime(c: CurtainParams, lipHeight: number): number {
  const vy = -c.launchSpeed * Math.sin(c.launchAngle);
  // lipHeight + vy·t - 0.5g·t² = 0  →  0.5g·t² - vy·t - lipHeight = 0
  const disc = vy * vy + 2 * c.gravity * lipHeight;
  return (vy + Math.sqrt(disc)) / c.gravity;
}
