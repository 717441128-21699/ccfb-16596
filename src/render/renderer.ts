/**
 * 渲染器：管浪场景的全部 WebGPU 管线与逐帧编排
 * ---------------------------------------------------------------
 * 几何 pass（场景 HDR target + depth）：海面 → 浪面 → 水帘(alpha 混合)
 * 计算 pass：水雾粒子积分
 * 粒子 pass：billboard 加色混合
 * 后期：亮部提取(1/4) → 双向高斯 → 光束(1/2) → 合成(ACES+水滴) → 画布
 */
import type { GpuContext } from './device';
import { preprocess } from './shaderPreprocess';
import { UniformBuffer } from './uniforms';
import { createCurtainMesh, createOceanMesh, createWaveMesh, type Mesh } from './meshes';

const PARTICLE_STRUCT_FLOATS = 12; // pos/vel/size 三个 vec4
const MAX_PARTICLES = 12000;

interface RT {
  tex: GPUTexture;
  view: GPUTextureView;
}

export class Renderer {
  readonly ctx: GpuContext;
  readonly device: GPUDevice;
  readonly uniform: UniformBuffer;
  private waveMesh!: Mesh;
  private oceanMesh!: Mesh;
  private curtainMesh!: Mesh;

  private sceneBind!: GPUBindGroup;
  private particleSimBind!: GPUBindGroup;
  private particleRenderBind!: GPUBindGroup;

  private wavePipe!: GPURenderPipeline;
  private oceanPipe!: GPURenderPipeline;
  private curtainPipe!: GPURenderPipeline;
  private particleSimPipe!: GPUComputePipeline;
  private particleRenderPipe!: GPURenderPipeline;
  private brightPipe!: GPURenderPipeline;
  private blurPipe!: GPURenderPipeline;
  private rayPipe!: GPURenderPipeline;
  private compositePipe!: GPURenderPipeline;

  private particleBuffer!: GPUBuffer;
  private simUniform!: GPUBuffer;
  /** SimParams 混合视图：同一 16 字节缓冲的 f32/u32 双视图 */
  private simView!: { bytes: ArrayBuffer; f32: Float32Array; u32: Uint32Array };

  private sceneRT!: RT;
  private depthTex!: GPUTexture;
  private depthView!: GPUTextureView;
  private halfRT!: RT;
  private quarterA!: RT;
  private quarterB!: RT;
  private sampler!: GPUSampler;

  private width = 3840;
  private height = 2160;
  private scale = 1;

  // 各后期 pass 的独立 uniform 小缓冲
  private rayParamBuf!: GPUBuffer;
  private bloomParamBuf!: GPUBuffer;
  private brightParamBuf!: GPUBuffer;
  private compositeParamBuf!: GPUBuffer;

  constructor(ctx: GpuContext) {
    this.ctx = ctx;
    this.device = ctx.device;
    this.uniform = new UniformBuffer(this.device);
  }

  async init(): Promise<void> {
    const device = this.device;
    this.sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    // —— 粒子缓冲（storage，compute 写 / render 读）——
    this.particleBuffer = device.createBuffer({
      size: MAX_PARTICLES * PARTICLE_STRUCT_FLOATS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    // 初始清零（size.w=0 触发首帧重生）
    device.queue.writeBuffer(this.particleBuffer, 0, new Float32Array(MAX_PARTICLES * PARTICLE_STRUCT_FLOATS));
    this.simUniform = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const simBytes = new ArrayBuffer(16);
    this.simView = { bytes: simBytes, f32: new Float32Array(simBytes), u32: new Uint32Array(simBytes) };

    // —— 网格 ——
    this.waveMesh = createWaveMesh(device);
    this.oceanMesh = createOceanMesh(device);
    this.curtainMesh = createCurtainMesh(device);

    this.createPipelines();
    this.resize(3840, 2160, 1);
  }

  private module(entry: string): GPUShaderModule {
    return this.device.createShaderModule({ code: preprocess(entry) });
  }

  private createPipelines(): void {
    const device = this.device;
    const sceneLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }],
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [sceneLayout] });

    const vertexLayout: GPUVertexBufferLayout = {
      arrayStride: 8,
      attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
    };
    const depthState: GPUDepthStencilState = {
      format: 'depth24plus',
      depthWriteEnabled: true,
      depthCompare: 'less',
    };
    const target: GPUColorTargetState = { format: 'rgba16float', blend: undefined, writeMask: GPUColorWrite.ALL };

    // 浪面
    this.wavePipe = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: { module: this.module('wave.wgsl'), entryPoint: 'vs', buffers: [vertexLayout] },
      fragment: { module: this.module('wave.wgsl'), entryPoint: 'fs', targets: [target] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: depthState,
    });
    // 海面
    this.oceanPipe = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: { module: this.module('ocean.wgsl'), entryPoint: 'vs', buffers: [vertexLayout] },
      fragment: { module: this.module('ocean.wgsl'), entryPoint: 'fs', targets: [target] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: depthState,
    });
    // 水帘（alpha 混合，双面）
    const blendTarget: GPUColorTargetState = {
      format: 'rgba16float',
      blend: {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      },
      writeMask: GPUColorWrite.ALL,
    };
    this.curtainPipe = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: { module: this.module('curtain.wgsl'), entryPoint: 'vs', buffers: [vertexLayout] },
      fragment: { module: this.module('curtain.wgsl'), entryPoint: 'fs', targets: [blendTarget] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { ...depthState, depthWriteEnabled: false },
    });

    this.sceneBind = device.createBindGroup({
      layout: sceneLayout,
      entries: [{ binding: 0, resource: { buffer: this.uniform.buffer } }],
    });

    // —— 粒子 compute ——
    const simLayoutRW = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    this.particleSimPipe = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [simLayoutRW] }),
      compute: { module: this.module('particles.wgsl'), entryPoint: 'cs' },
    });
    this.particleSimBind = device.createBindGroup({
      layout: simLayoutRW,
      entries: [
        { binding: 0, resource: { buffer: this.uniform.buffer } },
        { binding: 1, resource: { buffer: this.simUniform } },
        { binding: 2, resource: { buffer: this.particleBuffer } },
      ],
    });

    // —— 粒子 render（无顶点缓冲，vertex_index + instance_index）——
    const renderLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });
    this.particleRenderPipe = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [renderLayout] }),
      vertex: { module: this.module('particles.wgsl'), entryPoint: 'vs_render' },
      fragment: {
        module: this.module('particles.wgsl'),
        entryPoint: 'fs_render',
        targets: [
          {
            format: 'rgba16float',
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            },
            writeMask: GPUColorWrite.ALL,
          },
        ],
      },
      primitive: { topology: 'triangle-strip' },
      depthStencil: { ...depthState, depthWriteEnabled: false },
    });
    this.particleRenderBind = device.createBindGroup({
      layout: renderLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniform.buffer } },
        { binding: 2, resource: { buffer: this.particleBuffer } },
      ],
    });

    this.createPostPipelines();
  }

  private makeRT(w: number, h: number, format: GPUTextureFormat = 'rgba16float'): RT {
    const tex = this.device.createTexture({
      size: [w, h],
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    return { tex, view: tex.createView() };
  }

  private createPostPipelines(): void {
    const device = this.device;
    const fullModule = this.module('fullscreen.wgsl');

    // 亮部提取
    const brightLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    this.brightPipe = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [brightLayout] }),
      vertex: { module: fullModule, entryPoint: 'vs_fullscreen' },
      fragment: { module: this.module('bright.wgsl'), entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
    });
    this.brightParamBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // 高斯模糊
    const blurLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    this.blurPipe = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [blurLayout] }),
      vertex: { module: fullModule, entryPoint: 'vs_fullscreen' },
      fragment: { module: this.module('bloom.wgsl'), entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
    });
    this.bloomParamBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // 光束
    const rayLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    this.rayPipe = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [rayLayout] }),
      vertex: { module: fullModule, entryPoint: 'vs_fullscreen' },
      fragment: { module: this.module('godrays.wgsl'), entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
    });
    this.rayParamBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // 合成
    const compLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    this.compositePipe = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [compLayout] }),
      vertex: { module: fullModule, entryPoint: 'vs_fullscreen' },
      fragment: { module: this.module('composite.wgsl'), entryPoint: 'fs', targets: [{ format: this.ctx.format }] },
    });
    this.compositeParamBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  }

  /** 重建渲染目标（4K 内部分辨率 × DRS 缩放） */
  resize(baseW: number, baseH: number, scale: number): void {
    const w = Math.max(2, Math.round(baseW * scale));
    const h = Math.max(2, Math.round(baseH * scale));
    if (this.sceneRT && w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.scale = scale;
    const device = this.device;
    this.sceneRT?.tex.destroy();
    this.depthTex?.destroy();
    this.halfRT?.tex.destroy();
    this.quarterA?.tex.destroy();
    this.quarterB?.tex.destroy();

    this.sceneRT = this.makeRT(w, h);
    this.depthTex = device.createTexture({
      size: [w, h],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.depthView = this.depthTex.createView();
    this.halfRT = this.makeRT(Math.max(2, w >> 1), Math.max(2, h >> 1));
    this.quarterA = this.makeRT(Math.max(2, w >> 2), Math.max(2, h >> 2));
    this.quarterB = this.makeRT(Math.max(2, w >> 2), Math.max(2, h >> 2));
  }

  get internalResolution(): [number, number] {
    return [this.width, this.height];
  }

  private drawIndexed(
    pass: GPURenderPassEncoder,
    pipe: GPURenderPipeline,
    bind: GPUBindGroup,
    mesh: Mesh,
  ): void {
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bind);
    pass.setVertexBuffer(0, mesh.buffer);
    if (mesh.indexBuffer) {
      pass.setIndexBuffer(mesh.indexBuffer, 'uint32');
      pass.drawIndexed(mesh.indexCount ?? 0);
    } else {
      pass.draw(mesh.vertexCount);
    }
  }

  private postBindGroup(
    layout: GPUBindGroupLayout,
    entries: GPUBindGroupEntry[],
  ): GPUBindGroup {
    return this.device.createBindGroup({ layout, entries });
  }

  /**
   * 逐帧渲染。
   * @param sunScreen 太阳在屏幕空间的 UV（光束中心）
   * @param particleCount 本帧激活粒子数
   */
  render(params: {
    dt: number;
    time: number;
    sunScreen: [number, number];
    particleCount: number;
    lensDrops: number;
    godRayStrength: number;
  }): void {
    const device = this.device;
    const encoder = device.createCommandEncoder();

    // —— 1. 粒子 compute ——
    // WGSL SimParams 布局为 (f32 dt, u32 count, f32, f32)，
    // 必须用混合视图写入，count 走 u32 位模式而非浮点重解释。
    this.simView.f32[0] = params.dt;
    this.simView.u32[1] = params.particleCount;
    this.simView.f32[2] = 0;
    this.simView.f32[3] = 0;
    device.queue.writeBuffer(this.simUniform, 0, this.simView.bytes);
    {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.particleSimPipe);
      pass.setBindGroup(0, this.particleSimBind);
      pass.dispatchWorkgroups(Math.ceil(params.particleCount / 64));
      pass.end();
    }

    // —— 2. 场景几何 ——
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: this.sceneRT.view,
            clearValue: { r: 0.02, g: 0.05, b: 0.09, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
        depthStencilAttachment: {
          view: this.depthView,
          depthClearValue: 1,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      });
      this.drawIndexed(pass, this.oceanPipe, this.sceneBind, this.oceanMesh);
      this.drawIndexed(pass, this.wavePipe, this.sceneBind, this.waveMesh);
      this.drawIndexed(pass, this.curtainPipe, this.sceneBind, this.curtainMesh);
      // 粒子 billboard（4 顶点/实例）
      pass.setPipeline(this.particleRenderPipe);
      pass.setBindGroup(0, this.particleRenderBind);
      pass.draw(4, params.particleCount);
      pass.end();
    }

    const w = this.width;
    const h = this.height;

    // —— 3. 亮部提取（1/4）——
    device.queue.writeBuffer(this.brightParamBuf, 0, new Float32Array([0.85, 0.35, 0, 0]));
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: this.quarterA.view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      });
      pass.setPipeline(this.brightPipe);
      pass.setBindGroup(
        0,
        this.postBindGroup(this.brightPipe.getBindGroupLayout(0), [
          { binding: 0, resource: { buffer: this.uniform.buffer } },
          { binding: 1, resource: this.sceneRT.view },
          { binding: 2, resource: this.sampler },
          { binding: 3, resource: { buffer: this.brightParamBuf } },
        ]),
      );
      pass.draw(3);
      pass.end();
    }

    // —— 4. 双向高斯（quarterA → quarterB → quarterA）——
    const blurOnce = (src: GPUTextureView, dst: GPUTextureView, dir: [number, number]): void => {
      device.queue.writeBuffer(this.bloomParamBuf, 0, new Float32Array([0, dir[0], dir[1], 0]));
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: dst, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      });
      pass.setPipeline(this.blurPipe);
      pass.setBindGroup(
        0,
        this.postBindGroup(this.blurPipe.getBindGroupLayout(0), [
          { binding: 0, resource: { buffer: this.uniform.buffer } },
          { binding: 1, resource: src },
          { binding: 2, resource: this.sampler },
          { binding: 3, resource: { buffer: this.bloomParamBuf } },
        ]),
      );
      pass.draw(3);
      pass.end();
    };
    blurOnce(this.quarterA.view, this.quarterB.view, [1 / (w >> 2), 0]);
    blurOnce(this.quarterB.view, this.quarterA.view, [0, 1 / (h >> 2)]);

    // —— 5. 光束（1/2 分辨率）——
    device.queue.writeBuffer(
      this.rayParamBuf,
      0,
      new Float32Array([params.sunScreen[0], params.sunScreen[1], params.godRayStrength, 0]),
    );
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: this.halfRT.view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      });
      pass.setPipeline(this.rayPipe);
      pass.setBindGroup(
        0,
        this.postBindGroup(this.rayPipe.getBindGroupLayout(0), [
          { binding: 0, resource: { buffer: this.uniform.buffer } },
          { binding: 1, resource: this.sceneRT.view },
          { binding: 2, resource: this.sampler },
          { binding: 3, resource: this.depthView },
          { binding: 4, resource: { buffer: this.rayParamBuf } },
        ]),
      );
      pass.draw(3);
      pass.end();
    }

    // —— 6. 合成 → 画布（内部 4K RT 缩放到实际画布尺寸，viewport 显式映射）——
    device.queue.writeBuffer(this.compositeParamBuf, 0, new Float32Array([params.lensDrops, 1.0, 0.55, 0]));
    const canvasTex = this.ctx.context.getCurrentTexture();
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: canvasTex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      });
      // 全屏三角形按画布物理像素设置视口，内部 HDR（可能为 4K）由采样器缩放到画布
      pass.setViewport(0, 0, canvasTex.width, canvasTex.height, 0, 1);
      pass.setPipeline(this.compositePipe);
      pass.setBindGroup(
        0,
        this.postBindGroup(this.compositePipe.getBindGroupLayout(0), [
          { binding: 0, resource: { buffer: this.uniform.buffer } },
          { binding: 1, resource: this.sceneRT.view },
          { binding: 2, resource: this.halfRT.view },
          { binding: 3, resource: this.quarterA.view },
          { binding: 4, resource: this.sampler },
          { binding: 5, resource: { buffer: this.compositeParamBuf } },
        ]),
      );
      pass.draw(3);
      pass.end();
    }

    device.queue.submit([encoder.finish()]);
  }

  /** 读取场景 target 单个像素（GPU 实测透光亮度比，验收指标 1）。
   *  copyTextureToBuffer 要求 bytesPerRow 为 256 的倍数，单像素也要按 256 字节/行对齐。 */
  async readPixel(x: number, y: number): Promise<[number, number, number, number]> {
    const device = this.device;
    const BYTES_PER_ROW = 256; // 16 字节像素向上对齐到 256
    const buffer = device.createBuffer({
      size: BYTES_PER_ROW,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture: this.sceneRT.tex, origin: [x, y] },
      { buffer, bytesPerRow: BYTES_PER_ROW, rowsPerImage: 1 },
      { width: 1, height: 1, depthOrArrayLayers: 1 },
    );
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    // 真实像素在行首前 16 字节
    const arr = new Float32Array(buffer.getMappedRange().slice(0, 16));
    buffer.unmap();
    buffer.destroy();
    return [arr[0], arr[1], arr[2], arr[3]];
  }

  destroy(): void {
    this.sceneRT.tex.destroy();
    this.depthTex.destroy();
    this.halfRT.tex.destroy();
    this.quarterA.tex.destroy();
    this.quarterB.tex.destroy();
    this.particleBuffer.destroy();
    this.uniform.buffer.destroy();
  }
}
