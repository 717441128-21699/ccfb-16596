// ============================================================================
// bright.wgsl — 亮部提取（bloom 金字塔入口，1/4 分辨率）
// ============================================================================
#include "common.wgsl"

@group(0) @binding(1) var srcTex: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;

struct BrightParams {
  threshold: f32,
  knee: f32,
  pad1: f32,
  pad2: f32,
};
@group(0) @binding(3) var<uniform> bp: BrightParams;

@fragment
fn fs(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let dims = vec2f(textureDimensions(srcTex));
  let uv = frag.xy / dims;
  let c = textureSample(srcTex, linearSampler, uv).rgb;
  let lum = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  let k = smoothstep(bp.threshold, bp.threshold + bp.knee, lum);
  return vec4f(c * k, 1.0);
}
