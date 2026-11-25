/**
 * WebGPU 渲染器：主渲染管线 + 透光校验管线（离屏纹理 + 读回）。
 */
import { COMMON_WGSL } from '../shaders/common.wgsl';
import { SCENE_WGSL } from '../shaders/scene.wgsl';
import { SHADING_WGSL } from '../shaders/shading.wgsl';
import { VALIDATION_WGSL } from '../shaders/validation.wgsl';
import { rgbTransmittance } from '../physics/waterOptics';
import { UNIFORM_STRIDE, type WaveParams } from '../state/params';
import { UniformBuilder } from './uniformBuilder';
import { cameraAt, surferAt, type CameraFrame } from './camera';

export type ResolutionMode = 'auto' | '1080p' | '1440p' | '4k';

export interface ValidationSample {
  d: number;
  cpu: { r: number; g: number; b: number };
  gpu: { r: number; g: number; b: number };
}

export interface ValidationResult {
  samples: ValidationSample[];
  maxRelError: { r: number; g: number; b: number };
  meanRelError: { r: number; g: number; b: number };
  dMin: number;
  dMax: number;
}

const RES_TABLE: Record<ResolutionMode, [number, number] | null> = {
  auto: null,
  '1080p': [1920, 1080],
  '1440p': [2560, 1440],
  '4k': [3840, 2160],
};

export class Renderer {
  private canvas: HTMLCanvasElement;
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private format!: GPUTextureFormat;
  private uniformBuffer!: GPUBuffer;
  private pipeline!: GPURenderPipeline;
  private validationPipeline!: GPURenderPipeline;
  private sharedBindGroupLayout!: GPUBindGroupLayout;
  private bindGroup!: GPUBindGroup;
  private builder = new UniformBuilder();
  private raf = 0;
  private lastTs = 0;
  private simTime = 0;
  private shotT = 0;
  private params!: WaveParams;
  private fpsWindow: number[] = [];
  onFps?: (fps: number, resolution: [number, number]) => void;
  resolutionMode: ResolutionMode = 'auto';
  private currentSize: [number, number] = [1, 1];
  paused = false;
  private validationCount = 24;

  // GPU 帧时（timestamp query），与 rAF/vsync 节流无关的真实 GPU 耗时
  private timestampSupported = false;
  private querySet!: GPUQuerySet;
  private resolveBuffer!: GPUBuffer;
  private gpuFrameTimes: number[] = [];
  private frameCounter = 0;
  private readPending = false;
  onGpuTiming?: (avgMs: number, samples: number) => void;

  private constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  static async create(canvas: HTMLCanvasElement): Promise<Renderer> {
    if (!('gpu' in navigator)) {
      throw new Error('navigator.gpu 不存在');
    }
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('未找到 WebGPU 适配器');
    const canTimestamp = adapter.features.has('timestamp-query');
    const device = await adapter.requestDevice({
      requiredFeatures: canTimestamp ? (['timestamp-query'] as GPUFeatureName[]) : [],
    });
    device.addEventListener('uncapturederror', (ev) => {
      const err = (ev as GPUUncapturedErrorEvent).error;
      console.error(`[WebGPU] ${err.constructor.name}: ${err.message}`);
    });
    const r = new Renderer(canvas);
    r.device = device;
    r.timestampSupported = canTimestamp;
    if (canTimestamp) r.initTimestamps();
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('无法获取 webgpu context');
    r.context = context;
    r.format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format: r.format, alphaMode: 'opaque' });
    r.uniformBuffer = device.createBuffer({
      size: UNIFORM_STRIDE * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    r.buildPipelines();
    r.bindGroup = device.createBindGroup({
      layout: r.sharedBindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: r.uniformBuffer } }],
    });
    return r;
  }

  private buildPipelines(): void {
    // 两条管线共用显式 bind group layout：uniform buffer 布局完全一致，
    // 避免 auto layout 因 struct 字段名不同而判定不兼容。
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
    });
    const pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
    this.sharedBindGroupLayout = bindGroupLayout;

    const mainShader = COMMON_WGSL + SCENE_WGSL + SHADING_WGSL;
    const module = this.device.createShaderModule({ code: mainShader });
    this.pipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: { module, entryPoint: 'mainVS' },
      fragment: { module, entryPoint: 'mainFS', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });
    const valModule = this.device.createShaderModule({ code: VALIDATION_WGSL });
    this.validationPipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: { module: valModule, entryPoint: 'mainVS' },
      fragment: { module: valModule, entryPoint: 'mainFS', targets: [{ format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-list' },
    });
  }

  private initTimestamps(): void {
    this.querySet = this.device.createQuerySet({ type: 'timestamp', count: 2 });
    this.resolveBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
  }

  private resize(): [number, number] {
    const fixed = RES_TABLE[this.resolutionMode];
    let w: number;
    let h: number;
    if (fixed) {
      [w, h] = fixed;
    } else {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.max(2, Math.floor(this.canvas.clientWidth * dpr));
      h = Math.max(2, Math.floor(this.canvas.clientHeight * dpr));
    }
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.currentSize = [w, h];
    return [w, h];
  }

  setParams(p: WaveParams): void {
    this.params = p;
  }

  seekShot(t01: number): void {
    this.shotT = Math.max(0, Math.min(1, t01));
  }

  getShotT(): number {
    return this.shotT;
  }

  start(): void {
    const loop = (ts: number) => {
      if (!this.lastTs) this.lastTs = ts;
      const dt = Math.min((ts - this.lastTs) / 1000, 0.1);
      this.lastTs = ts;
      if (!this.paused && this.params) {
        this.simTime += dt * this.params.timeScale;
        this.shotT = (this.shotT + dt / 10) % 1;
      }
      this.render();
      this.fpsWindow.push(ts);
      while (this.fpsWindow.length > 2 && this.fpsWindow[this.fpsWindow.length - 1] - this.fpsWindow[0] > 1000) {
        this.fpsWindow.shift();
      }
      if (this.fpsWindow.length >= 2 && this.onFps) {
        const span = (this.fpsWindow[this.fpsWindow.length - 1] - this.fpsWindow[0]) / 1000;
        this.onFps((this.fpsWindow.length - 1) / Math.max(span, 1e-4), this.currentSize);
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  private render(): void {
    if (!this.params) return;
    const [w, h] = this.resize();
    const cam: CameraFrame = cameraAt(this.shotT, this.params.barrelRadius, this.params.barrelHeight);
    const surfer = surferAt(this.shotT, this.params.barrelRadius, this.params.barrelHeight);
    const buf = this.builder.update(this.params, cam, this.simTime, { width: w, height: h });
    // reserved.xyz/w 放冲浪者位置与压弯角
    const off = 17 * 4;
    buf[off] = surfer.pos[0];
    buf[off + 1] = surfer.pos[1];
    buf[off + 2] = surfer.pos[2];
    buf[off + 3] = surfer.lean;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, buf);

    const encoder = this.device.createCommandEncoder();
    const useTs = this.timestampSupported;
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0.05, g: 0.08, b: 0.12, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      ...(useTs
        ? { timestampWrites: { querySet: this.querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } }
        : {}),
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3);
    pass.end();

    // 每 30 帧读一次 GPU 帧时（异步、低频，不影响主循环）
    if (useTs) {
      this.frameCounter++;
      if (this.frameCounter % 30 === 0 && !this.readPending) {
        this.readPending = true;
        encoder.resolveQuerySet(this.querySet, 0, 2, this.resolveBuffer, 0);
        const staging = this.device.createBuffer({
          size: 16,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        encoder.copyBufferToBuffer(this.resolveBuffer, 0, staging, 0, 16);
        this.device.queue.submit([encoder.finish()]);
        void staging.mapAsync(GPUMapMode.READ).then(() => {
          const times = new BigUint64Array(staging.getMappedRange());
          const start = times[0];
          const end = times[1];
          // timestamp 单位为纳秒
          const ms = Number(end - start) / 1e6;
          if (ms > 0) this.gpuFrameTimes.push(ms);
          if (this.gpuFrameTimes.length > 60) this.gpuFrameTimes.shift();
          staging.unmap();
          staging.destroy();
          if (this.onGpuTiming && this.gpuFrameTimes.length > 0) {
            const avg = this.gpuFrameTimes.reduce((a, b) => a + b, 0) / this.gpuFrameTimes.length;
            this.onGpuTiming(avg, this.gpuFrameTimes.length);
          }
          this.readPending = false;
        });
        return;
      }
    }
    this.device.queue.submit([encoder.finish()]);
  }

  /**
   * 透光校验：用校验管线渲染一条横向厚度阶梯，读回后与 CPU Beer–Lambert 理论值对比。
   * 注意 RGBA8 存储有 ~1/255 量化误差，结果中一并返回。
   */
  async validateOptics(): Promise<ValidationResult> {
    if (!this.params) throw new Error('params 未设置');
    const N = this.validationCount;
    const [w, h] = [N * 8, 16];
    const tex = this.device.createTexture({
      size: [w, h],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });

    const cam = cameraAt(0, this.params.barrelRadius, this.params.barrelHeight);
    const buf = this.builder.update(this.params, cam, this.simTime, { width: w, height: h });
    buf[17 * 4] = N; // reserved.x = 采样点数
    this.device.queue.writeBuffer(this.uniformBuffer, 0, buf);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: tex.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' },
      ],
    });
    pass.setPipeline(this.validationPipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3);
    pass.end();

    const readBuf = this.device.createBuffer({
      size: w * h * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    encoder.copyTextureToBuffer(
      { texture: tex },
      { buffer: readBuf, bytesPerRow: w * 4, rowsPerImage: h },
      { width: w, height: h },
    );
    this.device.queue.submit([encoder.finish()]);
    await readBuf.mapAsync(GPUMapMode.READ);
    const raw = new Uint8Array(readBuf.getMappedRange());

    const samples: ValidationSample[] = [];
    const p = this.params;
    const maxRel = { r: 0, g: 0, b: 0 };
    const sumRel = { r: 0, g: 0, b: 0 };
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const d = p.thicknessMin * Math.pow(p.thicknessMax / p.thicknessMin, t);
      const cpu = rgbTransmittance(d, {
        r: this.builder.buffer[4 * 4],
        g: this.builder.buffer[4 * 4 + 1],
        b: this.builder.buffer[4 * 4 + 2],
      }, p.turbidity);
      // 每段取中间像素
      const px = (i * 8 + 4) * 4;
      const gpu = { r: raw[px] / 255, g: raw[px + 1] / 255, b: raw[px + 2] / 255 };
      samples.push({ d, cpu, gpu });
      const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(a, 0.02);
      maxRel.r = Math.max(maxRel.r, rel(cpu.r, gpu.r));
      maxRel.g = Math.max(maxRel.g, rel(cpu.g, gpu.g));
      maxRel.b = Math.max(maxRel.b, rel(cpu.b, gpu.b));
      sumRel.r += rel(cpu.r, gpu.r);
      sumRel.g += rel(cpu.g, gpu.g);
      sumRel.b += rel(cpu.b, gpu.b);
    }
    readBuf.unmap();
    readBuf.destroy();
    tex.destroy();
    return {
      samples,
      maxRelError: maxRel,
      meanRelError: {
        r: sumRel.r / N,
        g: sumRel.g / N,
        b: sumRel.b / N,
      },
      dMin: p.thicknessMin,
      dMax: p.thicknessMax,
    };
  }
}
