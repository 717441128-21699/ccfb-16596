/**
 * 海水辐射传输光学核心
 * ---------------------------------------------------------------
 * 参考：
 *  - Jerlov (1976) Marine Optics 水型分类
 *  - Smith & Baker (1981) 纯水吸收系数
 *  - Pegau et al. 海水吸收测量；CDOM 指数衰减 a_g(λ)=a_g440·e^{-0.014(λ-440)}
 *  - CIE 1931 2° 标准色度观察者配色函数、CIE D65 标准照明体
 *
 * 管浪浪壁透光的直接光部分严格满足 Beer–Lambert 定律：
 *      T(λ, d) = exp(-c(λ)·d),  c = a + b   （衰减 = 吸收 + 散射）
 * 本模块对 380–700nm 光谱做离散积分（CIE 配色函数 → XYZ → 线性 sRGB），
 * 再拟合出每个 RGB 通道的等效衰减常数 sigma，供 WGSL shader 使用。
 */

/** 光谱采样波长（nm），20nm 步长，17 个采样点 */
export const WAVELENGTHS = [
  380, 400, 420, 440, 460, 480, 500, 520, 540, 560, 580, 600, 620, 640, 660, 680, 700,
] as const;

const LAMBDA = WAVELENGTHS.map((v) => (v as number) * 1e-9); // 仅文档用途，实际用 nm
void LAMBDA;

/** CIE 1931 2° 配色函数 x̄, ȳ, z̄ */
const CIE_X = [
  0.001368, 0.01431, 0.13438, 0.34828, 0.2908, 0.09564, 0.0049, 0.06327, 0.2904, 0.5945,
  0.9163, 1.0622, 0.85445, 0.4479, 0.1649, 0.04677, 0.011359,
];
const CIE_Y = [
  0.000039, 0.000396, 0.004, 0.023, 0.06, 0.13902, 0.323, 0.71, 1.162, 0.995, 0.87, 0.631,
  0.381, 0.175, 0.061, 0.017, 0.004102,
];
const CIE_Z = [
  0.00645, 0.06785, 0.6456, 1.77211, 1.6692, 0.81295, 0.272, 0.07825, 0.013, 0.0039,
  0.00165, 0.0008, 0.00019, 0.00005, 0.00002, 0.0, 0.0,
];

/** CIE D65 相对光谱功率分布 */
const D65 = [
  49.98, 82.75, 93.43, 121.7, 117.8, 115.9, 112.6, 104.8, 104.4, 100.0, 95.79, 94.72, 87.71,
  83.7, 80.21, 76.53, 71.61,
];

/** 纯水/清海水吸收系数 a_w(λ)，单位 m^-1（Smith & Baker 量级） */
const A_WATER = [
  0.0053, 0.0066, 0.0046, 0.0063, 0.0094, 0.015, 0.0257, 0.0477, 0.0558, 0.0716, 0.1058,
  0.2435, 0.3096, 0.329, 0.42, 0.462, 0.65,
];

/** Jerlov 风格水型：用 CDOM/颗粒吸收增量 + 500nm 散射基准参数化 */
export interface WaterTypeDef {
  id: string;
  label: string;
  /** CDOM（黄色物质）在 440nm 的吸收系数 m^-1 */
  ag440: number;
  /** 悬浮颗粒在 440nm 的吸收系数 m^-1 */
  ap440: number;
  /** 500nm 总散射系数 b(500) m^-1 */
  b500: number;
  /** 后向散射比 b_b / b（海水典型 0.01–0.05，颗粒约 0.01–0.03） */
  backscatterRatio: number;
}

export const WATER_TYPES: WaterTypeDef[] = [
  { id: 'oceanI', label: '大洋 I 型（极清）', ag440: 0.0, ap440: 0.0, b500: 0.003, backscatterRatio: 0.045 },
  { id: 'oceanIA', label: '大洋 IA 型', ag440: 0.002, ap440: 0.002, b500: 0.008, backscatterRatio: 0.04 },
  { id: 'ocean1', label: '大洋 1 型（清澈）', ag440: 0.005, ap440: 0.005, b500: 0.015, backscatterRatio: 0.035 },
  { id: 'ocean3', label: '大洋 3 型', ag440: 0.012, ap440: 0.012, b500: 0.035, backscatterRatio: 0.03 },
  { id: 'coastal1', label: '近岸 1 型', ag440: 0.05, ap440: 0.03, b500: 0.12, backscatterRatio: 0.025 },
  { id: 'coastal5', label: '近岸 5 型（绿）', ag440: 0.18, ap440: 0.08, b500: 0.3, backscatterRatio: 0.02 },
  { id: 'coastal9', label: '近岸 9 型（浑绿）', ag440: 0.4, ap440: 0.18, b500: 0.55, backscatterRatio: 0.018 },
];

/** 一组完整光谱量（按 WAVELENGTHS 排列） */
export interface Spectrum {
  a: number[];
  b: number[];
  c: number[];
  bb: number[];
}

/** 计算指定水型的吸收/散射光谱 */
export function buildSpectrum(type: WaterTypeDef): Spectrum {
  const n = WAVELENGTHS.length;
  const a = new Array<number>(n);
  const b = new Array<number>(n);
  const c = new Array<number>(n);
  const bb = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const lambda = WAVELENGTHS[i];
    // CDOM 指数吸收（斜率 0.014 nm^-1）
    const ag = type.ag440 * Math.exp(-0.014 * (lambda - 440));
    // 颗粒吸收（斜率约 0.01 nm^-1）
    const ap = type.ap440 * Math.exp(-0.01 * (lambda - 440));
    a[i] = A_WATER[i] + ag + ap;
    // 散射光谱近似 λ^-4.3（分子+颗粒混合幂律）
    b[i] = type.b500 * Math.pow(500 / lambda, 4.3);
    c[i] = a[i] + b[i];
    bb[i] = b[i] * type.backscatterRatio;
  }
  return { a, b, c, bb };
}

/** XYZ → 线性 sRGB（未做 gamma，保留线性光） */
export function xyzToLinearRgb(x: number, y: number, z: number): [number, number, number] {
  return [
    3.2406 * x - 1.5372 * y - 0.4986 * z,
    -0.9689 * x + 1.8758 * y + 0.0415 * z,
    0.0557 * x - 0.204 * y + 1.057 * z,
  ];
}

export interface SpectralResult {
  /** 线性 sRGB 三通道透光率（已对无衰减白光归一化，d=0 时为 1,1,1） */
  rgb: [number, number, number];
  /** 相对亮度 Y（白光照入时 Y=1） */
  Y: number;
  /** 每个波长的直接透光率 T(λ) */
  T: number[];
}

const N = WAVELENGTHS.length;
const DL = 20; // nm 积分步长

// 白光归一化常数（D65 积分 Y）
let whiteY = 0;
let whiteRgb: [number, number, number] = [1, 1, 1];
{
  let wx = 0,
    wy = 0,
    wz = 0;
  for (let i = 0; i < N; i++) {
    const s = D65[i] * DL;
    wx += s * CIE_X[i];
    wy += s * CIE_Y[i];
    wz += s * CIE_Z[i];
  }
  whiteY = wy;
  whiteRgb = xyzToLinearRgb(wx / wy, 1, wz / wy);
}

/**
 * 谱积分：阳光（D65）穿过厚度 d（米）的水体后的颜色与亮度。
 * 直接光：T(λ)=e^{-c(λ)d}；环境内散射项可选（inScatter=true 时叠加近似单散射）。
 */
export function integrateSpectrum(spec: Spectrum, d: number, inScatter = false): SpectralResult {
  let X = 0,
    Y = 0,
    Z = 0;
  const T = new Array<number>(N);
  for (let i = 0; i < N; i++) {
    const t = Math.exp(-spec.c[i] * d);
    T[i] = t;
    // 近似环境内散射：L_add ≈ b_b/c · (1 - T) · 环境光（此处环境光取 D65 单位白）
    const scatter = inScatter ? (spec.bb[i] / spec.c[i]) * (1 - t) : 0;
    const rad = D65[i] * (t + scatter);
    const s = rad * DL;
    X += s * CIE_X[i];
    Y += s * CIE_Y[i];
    Z += s * CIE_Z[i];
  }
  const [r, g, bl] = xyzToLinearRgb(X / whiteY, Y / whiteY, Z / whiteY);
  return {
    rgb: [r / whiteRgb[0], g / whiteRgb[1], bl / whiteRgb[2]],
    Y: Y / whiteY,
    T,
  };
}

export interface EffectiveOptics {
  /** 每通道等效 Beer–Lambert 衰减常数 sigma（m^-1），shader 用 */
  sigmaRGB: [number, number, number];
  /** 亮度等效衰减常数（m^-1），用于亮度比理论值 */
  sigmaLum: number;
  /** 内散射光颜色（线性 RGB，单位环境光） */
  scatterRGB: [number, number, number];
  /** 拟合参考深度 m */
  fitDepth: number;
  /** 各通道单指数拟合的最大相对误差（0–1），供讲解页展示模型精度 */
  fitError: [number, number, number];
}

/**
 * 把全光谱结果拟合为 shader 可用的每通道单指数 T_c(d)=e^{-sigma_c·d}。
 * 在 0.05–3.5m（真实浪壁厚度工作区间）对 log(T) 做过原点最小二乘拟合，
 * 并给出拟合误差；该区间内单指数近似误差可控制在 ~10% 以内。
 */
export function fitEffectiveOptics(spec: Spectrum): EffectiveOptics {
  const depths = [0.05, 0.1, 0.2, 0.35, 0.55, 0.8, 1.1, 1.5, 2.0, 2.6, 3.2, 3.5];
  const samples = depths.map((d) => integrateSpectrum(spec, d, false));
  const fitChannel = (ch: 0 | 1 | 2) => {
    // 对 y = -ln(T) 做过原点最小二乘：sigma = Σ d·y / Σ d²
    let num = 0,
      den = 0;
    for (let i = 0; i < depths.length; i++) {
      const t = Math.max(samples[i].rgb[ch], 1e-6);
      const y = -Math.log(t);
      num += depths[i] * y;
      den += depths[i] * depths[i];
    }
    return num / den;
  };
  const sigmaRGB: [number, number, number] = [fitChannel(0), fitChannel(1), fitChannel(2)];

  // 亮度 sigma
  let num = 0,
    den = 0;
  for (let i = 0; i < depths.length; i++) {
    num += depths[i] * -Math.log(Math.max(samples[i].Y, 1e-6));
    den += depths[i] * depths[i];
  }
  const sigmaLum = num / den;

  // 拟合误差：工作深度上模型与光谱积分的最大复合偏差。
  // 采用 max(相对误差, 绝对误差)，避免通道信号趋零时小分母把微小绝对差放大。
  const fitError: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < depths.length; i++) {
    for (let ch = 0 as 0 | 1 | 2; ch < 3; ch = (ch + 1) as 0 | 1 | 2) {
      const model = Math.exp(-sigmaRGB[ch] * depths[i]);
      const exact = samples[i].rgb[ch];
      const rel = Math.abs(model - exact) / Math.max(exact, 0.05);
      const abs = Math.abs(model - exact);
      fitError[ch] = Math.max(fitError[ch], Math.max(rel, abs));
    }
  }

  // 内散射颜色：d→∞ 极限（b_b/c 加权的环境光谱积分）
  const deep = integrateSpectrum(spec, 30, true);
  const direct = integrateSpectrum(spec, 30, false);
  const scatterRGB: [number, number, number] = [
    Math.max(deep.rgb[0] - direct.rgb[0], 0),
    Math.max(deep.rgb[1] - direct.rgb[1], 0),
    Math.max(deep.rgb[2] - direct.rgb[2], 0),
  ];

  return { sigmaRGB, sigmaLum, scatterRGB, fitDepth: 1.0, fitError };
}

export interface RatioResult {
  /** 全光谱积分得到的亮度比 Y(dMin)/Y(dMax) */
  spectralRatio: number;
  /** shader 单指数模型的亮度比 e^{sigmaLum·(dMax-dMin)} */
  modelRatio: number;
  /** 两者相对偏差 */
  relativeError: number;
  dMin: number;
  dMax: number;
}

/** 浪唇最薄处与最厚处的亮度比（导演验收指标 1） */
export function thinThickRatio(spec: Spectrum, optics: EffectiveOptics, dMin: number, dMax: number): RatioResult {
  const yMin = integrateSpectrum(spec, dMin).Y;
  const yMax = integrateSpectrum(spec, dMax).Y;
  const spectralRatio = yMin / yMax;
  const modelRatio = Math.exp(optics.sigmaLum * (dMax - dMin));
  return {
    spectralRatio,
    modelRatio,
    relativeError: Math.abs(spectralRatio - modelRatio) / spectralRatio,
    dMin,
    dMax,
  };
}

/** shader 透光模型（CPU 侧镜像，供测试与讲解页数值表使用） */
export function shaderTransmittance(optics: EffectiveOptics, d: number): [number, number, number] {
  return [
    Math.exp(-optics.sigmaRGB[0] * d),
    Math.exp(-optics.sigmaRGB[1] * d),
    Math.exp(-optics.sigmaRGB[2] * d),
  ];
}

/** 生成厚度扫描曲线数据（讲解页图表用） */
export function thicknessScan(spec: Spectrum, optics: EffectiveOptics, dMax: number, steps = 96) {
  const out: { d: number; spectral: [number, number, number]; model: [number, number, number]; Y: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const d = (dMax * i) / steps;
    const sp = integrateSpectrum(spec, d);
    out.push({ d, spectral: sp.rgb, model: shaderTransmittance(optics, d), Y: sp.Y });
  }
  return out;
}
