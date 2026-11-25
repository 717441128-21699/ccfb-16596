/**
 * 全局可调参数与 GPU uniform 布局。
 * WGSL 中的 Params 结构必须与这里的 SLOT 顺序逐字段对应（全部 vec4，无对齐陷阱）。
 */

export type PageId = 'shot' | 'shape' | 'optics' | 'light';

export interface WaveParams {
  // —— 卷浪几何 ——
  barrelRadius: number;      // 管浪弧面半径 (m)
  barrelHeight: number;      // 弧心距水面高度 (m)
  arcAngle: number;          // 浪墙包角 (rad)，决定卷曲程度
  crestHalfLength: number;   // 浪脊沿 z 方向半长 (m)
  thicknessMin: number;      // 浪唇最薄厚度 (m)
  thicknessMax: number;      // 浪脚最厚厚度 (m)
  thicknessFalloff: number;  // 厚度沿弧面变化指数
  rippleAmp: number;         // 表面涟漪扰动幅度 (m)
  rippleScale: number;       // 涟漪空间频率
  lipAngle: number;          // 浪唇抛射点在弧面上的角度偏置 (rad)
  // —— 水帘（抛物线弹道） ——
  jetVx: number;             // 浪唇抛射水平速度 (m/s)
  jetVy: number;             // 浪唇抛射垂直速度 (m/s)
  gravity: number;           // 艺术化重力 (m/s²)
  curtainWidth: number;      // 水帘厚度 (m)
  curtainOpacity: number;    // 水帘不透明度
  // —— 泡沫 / 水雾 / 镜头 ——
  foamAmount: number;        // 泡沫总量 0..1
  foamStretch: number;       // 泡沫沿流向拉伸倍数
  mistAmount: number;        // 水雾总量 0..1
  lensWater: number;         // 镜头沾水量 0..1
  surfaceRoughness: number;  // 浪面微表面粗糙度
  // —— 灯光与天气 ——
  sunElevation: number;      // 太阳高度角 (deg)
  sunAzimuth: number;        // 太阳方位角 (deg)，0 = 沿 +x
  sunIntensity: number;      // 太阳照度（线性 HDR）
  turbidity: number;         // 海水浑浊度 0..1
  cloudCoverage: number;     // 云量 0..1
  fogDensity: number;        // 空气雾密度
  exposure: number;          // 曝光值
  // —— 动画 ——
  timeScale: number;         // 浪流时间流速
  // —— 调试 ——
  debugView: number;         // 0 正常 1 材质ID 2 法线 3 厚度热力 4 仅天空
}

export const DEFAULT_PARAMS: WaveParams = {
  barrelRadius: 2.4,
  barrelHeight: 2.15,
  arcAngle: 3.65,
  crestHalfLength: 32,
  thicknessMin: 0.03,
  thicknessMax: 3.2,
  thicknessFalloff: 2.3,
  rippleAmp: 0.11,
  rippleScale: 0.55,
  lipAngle: 0.0,
  jetVx: 3.4,
  jetVy: 2.7,
  gravity: 5.4,
  curtainWidth: 0.32,
  curtainOpacity: 0.92,
  foamAmount: 0.85,
  foamStretch: 5.5,
  mistAmount: 0.7,
  lensWater: 0.45,
  surfaceRoughness: 0.18,
  sunElevation: 26,
  sunAzimuth: -18,
  sunIntensity: 2.4,
  turbidity: 0.12,
  cloudCoverage: 0.22,
  fogDensity: 0.012,
  exposure: 0.9,
  timeScale: 1.0,
  debugView: 0,
};

/** Weather presets —— 灯光天气页一键切换。 */
export interface WeatherPreset {
  id: string;
  label: string;
  patch: Partial<WaveParams>;
}

export const WEATHER_PRESETS: WeatherPreset[] = [
  {
    id: 'noon',
    label: '正午晴空',
    patch: { sunElevation: 62, sunAzimuth: -10, sunIntensity: 3.6, turbidity: 0.08, cloudCoverage: 0.12, fogDensity: 0.006, exposure: 1.0 },
  },
  {
    id: 'golden',
    label: '黄金时刻',
    patch: { sunElevation: 12, sunAzimuth: -22, sunIntensity: 2.8, turbidity: 0.14, cloudCoverage: 0.25, fogDensity: 0.02, exposure: 1.1 },
  },
  {
    id: 'backlit',
    label: '逆光透光（默认）',
    patch: { sunElevation: 26, sunAzimuth: -18, sunIntensity: 3.2, turbidity: 0.12, cloudCoverage: 0.22, fogDensity: 0.012, exposure: 1.05 },
  },
  {
    id: 'overcast',
    label: '阴天柔光',
    patch: { sunElevation: 35, sunAzimuth: 40, sunIntensity: 1.3, turbidity: 0.28, cloudCoverage: 0.85, fogDensity: 0.04, exposure: 1.2 },
  },
];

/**
 * Uniform 槽位定义：每项一个 vec4。
 * WGSL 端 struct Params 必须按相同顺序声明。
 */
export const UNIFORM_SLOTS = [
  'u_camPos',        // xyz 相机位置, w 场景时间
  'u_camTarget',     // xyz 注视点, w fov 缩放
  'u_sunDir',        // xyz 太阳方向(指向太阳), w 太阳照度
  'u_sunColor',      // rgb 太阳颜色, w 云量
  'u_absorb',        // rgb 吸收系数, w 浑浊度
  'u_scatter',       // rgb 散射系数, w 颗粒附加吸收
  'u_barrel',        // R, h, arcAngle, crestHalfLen
  'u_thickness',     // dMin, dMax, falloff, rippleAmp
  'u_curtainA',      // x0, y0, vx, vy（抛射起点/速度）
  'u_curtainB',      // gravity, width, rippleScale, curtainOpacity
  'u_fx',            // foam, mist, lensWater, foamStretch
  'u_env',           // fogDensity, exposure, phase, surfaceRoughness
  'u_deepColor',     // rgb 深水色, w lipAngle
  'u_skyZenith',     // rgb 天顶色, w 太阳角直径
  'u_skyHorizon',    // rgb 地平线色, w 卷浪沿 z 相位流动
  'u_resolution',    // width, height, aspect, dither
  'u_post',          // filmGrain, vignette, waveTime, jetProgress
  'u_reserved',      // xyz 冲浪者位置, w 压弯角
  'u_debug',         // debugView, 预留3
] as const;

export const UNIFORM_STRIDE = UNIFORM_SLOTS.length * 4;

export function slotIndex(name: (typeof UNIFORM_SLOTS)[number]): number {
  return UNIFORM_SLOTS.indexOf(name) * 4;
}

type Listener = (p: WaveParams) => void;

/** 极简响应式 store：深拷贝比较 + 订阅。 */
export class ParamStore {
  private params: WaveParams;
  private listeners = new Set<Listener>();

  constructor(initial: WaveParams = { ...DEFAULT_PARAMS }) {
    this.params = { ...initial };
  }

  get(): WaveParams {
    return this.params;
  }

  set(patch: Partial<WaveParams>): void {
    this.params = { ...this.params, ...patch };
    this.listeners.forEach((l) => l(this.params));
  }

  reset(): void {
    this.set({ ...DEFAULT_PARAMS });
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}
