// ============================================================================
// bloom.wgsl — 亮部提取 + 模糊（在 1/4 分辨率金字塔上运行两遍高斯）
// ============================================================================
#include "common.wgsl"

@group(0) @binding(1) var srcTex: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;

struct BloomParams {
  threshold: f32,
  direction: vec2f, // (1/width,0) 或 (0,1/height)
  pad1: f32,
  pad2: f32,
};
@group(0) @binding(3) var<uniform> bp: BloomParams;

@fragment
fn fs(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let dims = vec2f(textureDimensions(srcTex));
  let uv = frag.xy / dims;
  let o = bp.direction;
  // 9 抽头高斯
  let w = [0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216];
  var c = textureSample(srcTex, linearSampler, uv).rgb * w[0];
  c += textureSample(srcTex, linearSampler, uv + o * 1.3846).rgb * w[1];
  c += textureSample(srcTex, linearSampler, uv - o * 1.3846).rgb * w[1];
  c += textureSample(srcTex, linearSampler, uv + o * 3.2308).rgb * w[2];
  c += textureSample(srcTex, linearSampler, uv - o * 3.2308).rgb * w[2];
  c += textureSample(srcTex, linearSampler, uv + o * 4.7692).rgb * w[3];
  c += textureSample(srcTex, linearSampler, uv - o * 4.7692).rgb * w[3];
  c += textureSample(srcTex, linearSampler, uv + o * 6.1538).rgb * w[4];
  c += textureSample(srcTex, linearSampler, uv - o * 6.1538).rgb * w[4];
  return vec4f(c, 1.0);
}
