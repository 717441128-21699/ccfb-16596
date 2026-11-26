/**
 * Engine：连接 store / 渲染器 / 相机 / 光学，驱动渲染循环。
 * 负责：uniform 上传、相机模式（电影镜头 vs 环绕）、太阳屏幕坐标、
 *       DRS 动态分辨率、10 秒基准测试与 GPU 透光比实测。
 */
import type { Store } from '../state/state';
import { waterTypeOf } from '../state/state';
import { buildSpectrum, fitEffectiveOptics, thinThickRatio, type EffectiveOptics, type Spectrum } from '../physics/optics';
import { DEFAULT_CURTAIN, wavePosition } from '../physics/wave';
import { cinematicCamera, orbitCamera, sunDirection, DEFAULT_ORBIT, type CameraMatrices, type OrbitState } from './camera';
import { Renderer } from './renderer';
import type { GpuContext } from './device';

export interface BenchmarkResult {
  fps: number;
  frameMs: number;
  resolution: [number, number];
  dipsBelow60: number;
  samples: number;
}

export class Engine {
  readonly renderer: Renderer;
  private store: Store;
  private raf = 0;
  private lastTs = 0;
  private simTime = 0;
  private optics: EffectiveOptics;
  private spectrum: Spectrum;
  private orbit: OrbitState = { ...DEFAULT_ORBIT, target: [...DEFAULT_ORBIT.target] as [number, number, number] };
  private lastCamera!: CameraMatrices;
  private dragging = false;
  private lastPointer: [number, number] = [0, 0];
  private canvas: HTMLCanvasElement;

  // DRS
  private currentScale = 1;
  private emaMs = 16.7;
  private bench: { start: number; frames: number; dips: number; times: number[] } | null = null;
  benchResolve: ((r: BenchmarkResult) => void) | null = null;

  // FPS 统计
  fps = 0;
  private fpsAccum = 0;
  private fpsFrames = 0;

  onFps?: (fps: number, ms: number) => void;

  constructor(canvas: HTMLCanvasElement, ctx: GpuContext, store: Store) {
    this.canvas = canvas;
    this.store = store;
    this.renderer = new Renderer(ctx);
    const wt = waterTypeOf(store.get());
    this.spectrum = buildSpectrum(wt);
    this.optics = fitEffectiveOptics(this.spectrum);
  }

  async init(): Promise<void> {
    await this.renderer.init();
    this.attachControls();
  }

  /** 当前光学结果（水型变化时重建） */
  getOptics(): EffectiveOptics {
    return this.optics;
  }

  getSpectrum(): Spectrum {
    return this.spectrum;
  }

  refreshOptics(): void {
    const wt = waterTypeOf(this.store.get());
    this.spectrum = buildSpectrum(wt);
    this.optics = fitEffectiveOptics(this.spectrum);
  }

  /** 浪唇薄厚亮度比（理论值，供 UI） */
  ratioInfo() {
    const s = this.store.get();
    return thinThickRatio(this.spectrum, this.optics, s.dMin, s.dMax);
  }

  private attachControls(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastPointer = [e.clientX, e.clientY];
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointerup', () => (this.dragging = false));
    c.addEventListener('pointermove', (e) => {
      if (!this.dragging || this.store.get().page === 'shot') return;
      const dx = e.clientX - this.lastPointer[0];
      const dy = e.clientY - this.lastPointer[1];
      this.lastPointer = [e.clientX, e.clientY];
      this.orbit.yaw -= dx * 0.006;
      this.orbit.pitch = Math.max(-0.2, Math.min(1.25, this.orbit.pitch + dy * 0.005));
    });
    c.addEventListener(
      'wheel',
      (e) => {
        if (this.store.get().page === 'shot') return;
        e.preventDefault();
        this.orbit.distance = Math.max(6, Math.min(80, this.orbit.distance * (1 + Math.sign(e.deltaY) * 0.08)));
      },
      { passive: false },
    );
  }

  start(): void {
    this.lastTs = performance.now();
    const loop = (ts: number) => {
      this.frame(ts);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  private frame(ts: number): void {
    const state = this.store.get();
    let dt = Math.min((ts - this.lastTs) / 1000, 0.05);
    this.lastTs = ts;

    // 电影镜头时间推进（固定 10 秒循环；基准测试时也用真实 dt）
    if (state.cinematicPlaying && state.page === 'shot') {
      this.simTime = (this.simTime + dt) % 10;
      this.store.update({ cinematicTime: this.simTime });
    } else if (state.page === 'shot') {
      this.simTime = state.cinematicTime;
    } else {
      this.simTime += dt; // 非镜头页仍让泡沫/粒子运动
    }
    const time = this.simTime;

    // 画布尺寸（CSS 像素 → 物理像素）；内部目标按 force4K 锁定 4K 基准
    const cssW = this.canvas.clientWidth || 1;
    const cssH = this.canvas.clientHeight || 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetBase: [number, number] = state.force4K
      ? [3840, 2160]
      : [Math.round(cssW * dpr), Math.round(cssH * dpr)];
    const wantCanvas = [Math.round(cssW * dpr), Math.round(cssH * dpr)];
    if (this.canvas.width !== wantCanvas[0] || this.canvas.height !== wantCanvas[1]) {
      this.canvas.width = wantCanvas[0];
      this.canvas.height = wantCanvas[1];
    }

    // DRS：仅在非强制 4K 模式下自动调节；force4K 时保持 scale=1
    const frameMs = dt * 1000;
    this.emaMs = this.emaMs * 0.92 + frameMs * 0.08;
    if (state.force4K) {
      this.currentScale = state.resolutionScale;
    } else {
      if (this.emaMs > 17.5 && this.currentScale > 0.55) this.currentScale = Math.max(0.55, this.currentScale - 0.05);
      else if (this.emaMs < 13.5 && this.currentScale < state.resolutionScale)
        this.currentScale = Math.min(state.resolutionScale, this.currentScale + 0.05);
    }
    this.renderer.resize(targetBase[0], targetBase[1], this.currentScale);

    // 相机
    const aspect = wantCanvas[0] / wantCanvas[1];
    let cam: CameraMatrices;
    if (state.page === 'shot') {
      cam = cinematicCamera(this.simTime, state.wave.length, state.wave.radius, aspect);
    } else {
      this.orbit.target = [0, state.wave.radius * 0.8, state.wave.length * 0.35];
      cam = orbitCamera(this.orbit, aspect);
    }

    this.lastCamera = cam;

    this.renderer.uniform.write(this.renderer.device, state, cam, this.optics, time, DEFAULT_CURTAIN);

    // 太阳屏幕坐标（光束中心）。WebGPU NDC：x 向右为正、y 向上为正，
    // 而纹理/片段 UV 的 v 向下为正，因此 y 取 0.5 - ndcY/2。
    const sun = sunDirection(state.weather);
    const sunView = transformPoint(cam.viewProj, [sun[0] * 80, sun[1] * 80, sun[2] * 80]);
    const sunScreen: [number, number] = [sunView[0] * 0.5 + 0.5, 0.5 - sunView[1] * 0.5];

    const frameStart = performance.now();
    this.renderer.render({
      dt,
      time,
      sunScreen,
      particleCount: state.particleCount,
      lensDrops: state.page === 'shot' ? state.lensDrops : state.lensDrops * 0.4,
      godRayStrength: state.godRayStrength,
    });

    // FPS
    this.fpsAccum += dt;
    this.fpsFrames++;
    if (this.fpsAccum >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAccum;
      this.onFps?.(this.fps, this.fpsAccum * 1000 / this.fpsFrames);
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }

    // 基准测试记录
    if (this.bench) {
      const ms = performance.now() - frameStart;
      this.bench.times.push(ms);
      this.bench.frames++;
      if (ms > 16.8) this.bench.dips++;
      if (performance.now() - this.bench.start >= 10000) {
        const times = this.bench.times;
        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        const r: BenchmarkResult = {
          fps: 1000 / avg,
          frameMs: avg,
          resolution: this.renderer.internalResolution,
          dipsBelow60: this.bench.dips,
          samples: this.bench.frames,
        };
        this.bench = null;
        this.benchResolve?.(r);
        this.benchResolve = null;
      }
    }
  }

  /** 10 秒 4K 基准测试（强制 4K 内部分辨率，统计帧率与掉帧） */
  runBenchmark(): Promise<BenchmarkResult> {
    const s = this.store.get();
    this.store.update({ force4K: true, resolutionScale: 1, cinematicPlaying: true, page: 'shot' });
    this.currentScale = 1;
    this.renderer.resize(3840, 2160, 1);
    this.bench = { start: performance.now(), frames: 0, dips: 0, times: [] };
    return new Promise((resolve) => {
      this.benchResolve = resolve;
    });
  }

  /**
   * GPU 实测透光亮度比（验收指标 1 的 GPU 侧取证）。
   * 取剖面 u 最薄（浪唇 u=1，厚度=tLip）与最厚（浪脚 u=0，厚度=tBase）处的真实浪面 3D 点，
   * 沿浪长中段（z0=0.45）投影到当前屏幕，对 3×3 邻域平均后求亮度比。
   * 理论比用这两个真实几何厚度计算，保证与实测探针口径一致；
   * 场景 HDR target 保留未经色调映射的线性光，可直接与理论比对照。
   */
  async measureGpuRatio(): Promise<{
    measured: number;
    theory: number;
    error: number;
    thinUV: [number, number];
    thickUV: [number, number];
    dThin: number;
    dThick: number;
  }> {
    const state = this.store.get();
    const w = state.wave;
    const dThin = w.tLip;
    const dThick = w.tBase;
    const theory = thinThickRatio(this.spectrum, this.optics, dThin, dThick).modelRatio;
    // 等一帧确保当前 target 已写入最新 uniform
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const cam = this.lastCamera;
    const z0 = 0.45;
    const thin3 = wavePosition(w, 1, z0);
    const thick3 = wavePosition(w, 0, z0);
    const toUV = (p: [number, number, number]): [number, number] => {
      const [nx, ny] = transformPoint(cam.viewProj, p);
      return [nx * 0.5 + 0.5, 0.5 - ny * 0.5];
    };
    const thinUV = toUV(thin3);
    const thickUV = toUV(thick3);
    const [W, H] = this.renderer.internalResolution;
    const sample = async (uv: [number, number]): Promise<number> => {
      const cx = Math.max(2, Math.min(W - 3, Math.floor(uv[0] * W)));
      const cy = Math.max(2, Math.min(H - 3, Math.floor(uv[1] * H)));
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const px = await this.renderer.readPixel(cx + dx, cy + dy);
          sum += 0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2];
        }
      }
      return sum / 9;
    };
    const lumThin = await sample(thinUV);
    const lumThick = await sample(thickUV);
    const measured = lumThin / Math.max(lumThick, 1e-6);
    return {
      measured,
      theory,
      error: Math.abs(measured - theory) / theory,
      thinUV,
      thickUV,
      dThin,
      dThick,
    };
  }
}

/** 点 × 列主序 mat4 */
function transformPoint(m: Float32Array, p: [number, number, number]): [number, number] {
  const x = p[0],
    y = p[1],
    z = p[2];
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [cx / cw, cy / cw];
}
