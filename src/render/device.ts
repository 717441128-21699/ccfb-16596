/** WebGPU 设备/上下文初始化与能力探测 */

export interface GpuContext {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  adapter: GPUAdapter;
}

export async function initWebGPU(canvas: HTMLCanvasElement): Promise<GpuContext> {
  if (!('gpu' in navigator)) {
    throw new Error('当前浏览器不支持 WebGPU，请使用 Chrome/Edge 113+ 或 Safari 18+（需开启 WebGPU）');
  }
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });
  if (!adapter) throw new Error('未找到可用的 GPU 适配器');
  const device = await adapter.requestDevice();
  device.lost.then((info) => {
    if (info.reason !== 'destroyed') {
      console.error('WebGPU device lost:', info.message);
    }
  });
  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('无法获取 WebGPU canvas 上下文');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format,
    alphaMode: 'opaque',
  });
  return { device, context, format, adapter };
}

export function gpuInfo(adapter: GPUAdapter): string {
  const i = adapter.info;
  // Chrome 121+ 提供 adapter.info
  if (!i) return 'WebGPU 设备（adapter.info 不可用）';
  return `${i.vendor ?? '未知厂商'} ${i.architecture ?? ''} ${i.device ?? ''} (${i.description ?? 'WebGPU 适配器'})`.trim();
}
