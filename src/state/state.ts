import { WAVE_PRESETS, type WaveParams } from '../physics/wave';
import { WATER_TYPES, type WaterTypeDef } from '../physics/optics';

/** 灯光/天气参数 */
export interface WeatherParams {
  /** 太阳方位角（弧度，0=沿 +Z 即洞口方向，浪背光时取 0 附近） */
  sunAzimuth: number;
  /** 太阳高度角（弧度，地平线上） */
  sunElevation: number;
  /** 太阳照度（线性光乘性系数） */
  sunIntensity: number;
  /** 天空环境光强度 */
  ambientIntensity: number;
  /** 浑浊度 1–10，影响天空颜色与雾 */
  turbidity: number;
  /** 雾浓度 0–1（海面大气透视） */
  fog: number;
  /** 云量 0–1 */
  cloudiness: number;
  /** 水型 id */
  waterTypeId: string;
}

export const WEATHER_PRESETS: Record<string, { label: string; params: WeatherParams }> = {
  goldenHour: {
    label: '黄金时刻（默认，浪背透光）',
    params: {
      sunAzimuth: 0.08,
      sunElevation: 0.16,
      sunIntensity: 5.2,
      ambientIntensity: 0.55,
      turbidity: 4.5,
      fog: 0.18,
      cloudiness: 0.15,
      waterTypeId: 'ocean1',
    },
  },
  midday: {
    label: '正午直射',
    params: {
      sunAzimuth: 0.25,
      sunElevation: 1.25,
      sunIntensity: 7.0,
      ambientIntensity: 0.8,
      turbidity: 2.0,
      fog: 0.08,
      cloudiness: 0.05,
      waterTypeId: 'oceanIA',
    },
  },
  overcast: {
    label: '阴天柔光',
    params: {
      sunAzimuth: 0.1,
      sunElevation: 0.7,
      sunIntensity: 1.4,
      ambientIntensity: 1.1,
      turbidity: 8.0,
      fog: 0.4,
      cloudiness: 0.85,
      waterTypeId: 'coastal1',
    },
  },
  storm: {
    label: '风暴前（暗调高对比）',
    params: {
      sunAzimuth: -0.2,
      sunElevation: 0.12,
      sunIntensity: 2.6,
      ambientIntensity: 0.35,
      turbidity: 9.0,
      fog: 0.55,
      cloudiness: 0.95,
      waterTypeId: 'coastal5',
    },
  },
  tropical: {
    label: '热带碧绿（清水高太阳）',
    params: {
      sunAzimuth: 0.05,
      sunElevation: 1.05,
      sunIntensity: 6.4,
      ambientIntensity: 0.75,
      turbidity: 2.4,
      fog: 0.1,
      cloudiness: 0.2,
      waterTypeId: 'oceanI',
    },
  },
};

export type PageId = 'shot' | 'wave' | 'optics' | 'weather';

export interface AppState {
  page: PageId;
  wave: WaveParams;
  weather: WeatherParams;
  /** 浪唇光学厚度上下限（米），验收指标 1 的两个采样厚度 */
  dMin: number;
  dMax: number;
  /** 渲染分辨率缩放（1=4K 内部分辨率） */
  resolutionScale: number;
  /** 是否锁定 4K（3840×2160）内部渲染目标 */
  force4K: boolean;
  /** 水雾粒子数量上限 */
  particleCount: number;
  /** 镜头水滴强度 0–1 */
  lensDrops: number;
  /** 光束（god rays）强度 */
  godRayStrength: number;
  /** 电影镜头自动播放 */
  cinematicPlaying: boolean;
  /** 电影镜头时间（秒，0–10） */
  cinematicTime: number;
}

export function defaultState(): AppState {
  return {
    page: 'shot',
    wave: { ...WAVE_PRESETS.reefBomb.params },
    weather: { ...WEATHER_PRESETS.goldenHour.params },
    dMin: 0.14,
    dMax: 2.8,
    resolutionScale: 1,
    force4K: true,
    particleCount: 6000,
    lensDrops: 0.7,
    godRayStrength: 1.0,
    cinematicPlaying: true,
    cinematicTime: 0,
  };
}

export function waterTypeOf(state: AppState): WaterTypeDef {
  return WATER_TYPES.find((w) => w.id === state.weather.waterTypeId) ?? WATER_TYPES[2];
}

type Listener = (s: AppState) => void;

/** 极简响应式 store：浅拷贝更新 + 订阅通知 */
export class Store {
  private state: AppState;
  private listeners = new Set<Listener>();

  constructor(initial: AppState = defaultState()) {
    this.state = initial;
  }

  get(): AppState {
    return this.state;
  }

  update(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  patchWave(patch: Partial<WaveParams>): void {
    this.update({ wave: { ...this.state.wave, ...patch } });
  }

  patchWeather(patch: Partial<WeatherParams>): void {
    this.update({ weather: { ...this.state.weather, ...patch } });
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
