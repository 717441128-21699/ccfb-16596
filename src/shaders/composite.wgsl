// ============================================================================
// composite.wgsl — 最终合成：场景 + 光束 + bloom，ACES 色调映射，镜头水滴
// 镜头水滴：程序化静态水滴贴图 + 缓慢下滑，折射背景、边缘菲涅尔亮环
// ============================================================================
#include "common.wgsl"

@group(0) @binding(1) var sceneTex: texture_2d<f32>;
@group(0) @binding(2) var rayTex: texture_2d<f32>;
@group(0) @binding(3) var bloomTex: texture_2d<f32>;
@group(0) @binding(4) var linearSampler: sampler;

struct CompositeParams {
  lensDrops: f32,
  exposure: f32,
  vignette: f32,
  pad: f32,
};
@group(0) @binding(5) var<uniform> cp: CompositeParams;

// 水滴场：两层单元格里的随机水滴，缓慢下滑、轻微晃动
fn dropField(uv: vec2f, cell: f32, scale: f32, t: f32) -> vec2f {
  let g = uv * cell;
  let id = floor(g);
  let f = fract(g);
  let rnd = hash21(id);
  let speed = mix(0.008, 0.03, hash21(id + 3.1)) * scale;
  let center = vec2f(
    0.5 + (hash21(id + 7.7) - 0.5) * 0.35 + sin(t * 0.6 + rnd * 9.0) * 0.015,
    fract(0.5 + rnd * 3.0 - t * speed)
  );
  let d = f - center;
  let rad = mix(0.06, 0.16, hash21(id + 5.3)) * scale;
  let rr = length(d * vec2f(1.0, 1.35));
  let body = smoothstep(rad, rad * 0.55, rr);
  let ring = smoothstep(rad * 1.25, rad, rr) - body;
  return vec2f(body, ring);
}

@fragment
fn fs(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let dims = vec2f(textureDimensions(sceneTex));
  let uv = frag.xy / dims;
  let t = S.camPos.w;

  var col = textureSample(sceneTex, linearSampler, uv).rgb;
  let rays = textureSample(rayTex, linearSampler, uv).rgb;
  let bloom = textureSample(bloomTex, linearSampler, uv).rgb;
  col += rays + bloom * 0.6;

  // —— 镜头水滴（两层大小水滴）——
  if (cp.lensDrops > 0.005) {
    let d1 = dropField(uv + vec2f(0.0, t * 0.004), 9.0, 1.0, t);
    let d2 = dropField(uv * 1.7 + vec2f(3.7, t * 0.002), 14.0, 0.6, t);
    let body = clamp(d1.x + d2.x, 0.0, 1.0) * cp.lensDrops;
    let ring = clamp(d1.y + d2.y, 0.0, 1.0) * cp.lensDrops;
    // 折射：沿水滴法线方向偏移采样
    let g1 = uv * 9.0;
    let g2 = uv * 1.7 * 14.0;
    let n1 = vec2f(hash21(floor(g1)), hash21(floor(g1) + 1.0)) - 0.5;
    let n2 = vec2f(hash21(floor(g2)), hash21(floor(g2) + 1.0)) - 0.5;
    let refrUV = uv + (n1 * d1.x + n2 * d2.x) * 0.02 * cp.lensDrops;
    let refracted = textureSample(sceneTex, linearSampler, refrUV).rgb;
    col = mix(col, refracted * 1.08 + vec3f(0.02, 0.05, 0.06), body * 0.85);
    // 水滴边缘亮环（菲涅尔感）
    col += ring * vec3f(0.5, 0.65, 0.75) * (0.4 + S.light1.w * 0.08);
  }

  // —— 曝光 + ACES filmic ——
  col *= cp.exposure;
  let a = 2.51;
  let b = 0.03;
  let cc = 2.43;
  let d = 0.59;
  let e = 0.14;
  col = clamp((col * (a * col + b)) / (col * (cc * col + d) + e), vec3f(0.0), vec3f(1.0));

  // —— 暗角 ——
  let q = uv - 0.5;
  let vig = 1.0 - dot(q, q) * cp.vignette * 1.4;
  col *= clamp(vig, 0.0, 1.0);

  // 线性 → sRGB
  col = pow(col, vec3f(1.0 / 2.2));
  return vec4f(col, 1.0);
}
