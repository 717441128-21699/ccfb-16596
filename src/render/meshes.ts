/** 各渲染对象的网格构建（顶点缓冲仅存参数化属性，真实位置在 vertex shader 解析） */

export interface Mesh {
  buffer: GPUBuffer;
  vertexCount: number;
  /** 波浪/水帘网格的索引缓冲（四边形拆三角形）；海面为规则网格也走索引 */
  indexBuffer?: GPUBuffer;
  indexCount?: number;
}

function makeGridAttrs(nu: number, nv: number, uMax = 1, vMax = 1): { verts: Float32Array<ArrayBuffer>; indices: Uint32Array<ArrayBuffer> } {
  const verts: number[] = [];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      verts.push((i / nu) * uMax, (j / nv) * vMax);
    }
  }
  const indices: number[] = [];
  const row = nu + 1;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * row + i;
      indices.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
    }
  }
  return { verts: new Float32Array(verts), indices: new Uint32Array(indices) };
}

/** 卷浪浪面：160×160 参数网格（约 5 万三角形，4K 下余量充足） */
export function createWaveMesh(device: GPUDevice): Mesh {
  const { verts, indices } = makeGridAttrs(160, 160);
  return uploadIndexed(device, verts, indices);
}

/** 水帘：24 段弹道 × 32 条 */
export function createCurtainMesh(device: GPUDevice): Mesh {
  const { verts, indices } = makeGridAttrs(28, 40);
  return uploadIndexed(device, verts, indices);
}

/** 前方海面：100×100，属性为世界 XZ（x∈[-80,80], z∈[-20,140]） */
export function createOceanMesh(device: GPUDevice): Mesh {
  const nx = 100;
  const nz = 100;
  const verts: number[] = [];
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = -80 + (160 * i) / nx;
      const z = -20 + (160 * j) / nz;
      verts.push(x, z);
    }
  }
  const indices: number[] = [];
  const row = nx + 1;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * row + i;
      indices.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
    }
  }
  return uploadIndexed(device, new Float32Array(verts), new Uint32Array(indices));
}

function uploadIndexed(device: GPUDevice, verts: Float32Array<ArrayBuffer>, indices: Uint32Array<ArrayBuffer>): Mesh {
  const buffer = device.createBuffer({
    size: Math.max(verts.byteLength, 16),
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(buffer, 0, verts);
  const indexBuffer = device.createBuffer({
    size: Math.max(indices.byteLength, 16),
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(indexBuffer, 0, indices);
  return { buffer, vertexCount: verts.length / 2, indexBuffer, indexCount: indices.length };
}
