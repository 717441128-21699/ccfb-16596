/**
 * 透光校验管线 fragment shader。
 * 沿屏幕 x 轴均匀铺 N 个厚度采样点（dMin..dMax），输出线性 RGB 透射率，
 * CPU 读回后与 waterOptics.ts 的理论值逐通道比较。
 * 与主渲染共用同一个 Params uniform 布局，吸收系数完全同源。
 */
export const VALIDATION_WGSL = /* wgsl */ `

struct ValParams {
  camPos: vec4f,
  camTarget: vec4f,
  sunDir: vec4f,
  sunColor: vec4f,
  absorb: vec4f,        // rgb 吸收系数, w 浑浊度
  scatter: vec4f,       // w = 颗粒附加吸收
  barrel: vec4f,
  thickness: vec4f,     // x=dMin, y=dMax
  curtainA: vec4f,
  curtainB: vec4f,
  fx: vec4f,
  env: vec4f,
  deepColor: vec4f,
  skyZenith: vec4f,
  skyHorizon: vec4f,
  resolution: vec4f,
  post: vec4f,
  reserved: vec4f,      // x = 采样点数 N
  dbg: vec4f,
};

@group(0) @binding(0) var<uniform> P: ValParams;

@vertex
fn mainVS(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var pos = array<vec2f, 3>(
    vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0)
  );
  return vec4f(pos[vi], 0.0, 1.0);
}

@fragment
fn mainFS(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let n = max(P.reserved.x, 1.0);
  let idx = clamp(floor((frag.x / P.resolution.x) * n), 0.0, n - 1.0);
  let t = idx / max(n - 1.0, 1.0);
  // 对数厚度轴
  let d = P.thickness.x * pow(P.thickness.y / P.thickness.x, t);
  let rgb = exp(-(P.absorb.rgb + vec3f(P.scatter.w)) * d);
  return vec4f(rgb, 1.0);
}
`;
