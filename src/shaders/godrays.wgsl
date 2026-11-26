// ============================================================================
// godrays.wgsl — 屏空间光束：以太阳屏幕坐标为中心径向采样 + 软遮蔽
// 半分辨率运行（4K 时 1920×1080，控制 fill-rate 成本）
// ============================================================================
#include "common.wgsl"

@group(0) @binding(1) var sceneTex: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;
@group(0) @binding(3) var depthTex: texture_2d<f32>;

struct RayParams {
  sunScreen: vec2f,  // 太阳屏幕 UV
  strength: f32,
  pad: f32,
};
@group(0) @binding(4) var<uniform> rp: RayParams;

@fragment
fn fs(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let dims = vec2f(textureDimensions(sceneTex));
  let uv = frag.xy / dims;
  let dir = rp.sunScreen - uv;
  let dist = length(dir);
  let step = dir / 26.0;
  var p = uv;
  var acc = vec3f(0.0);
  var weight = 0.9;
  for (var i = 0; i < 26; i++) {
    p += step;
    if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) { break; }
    let c = textureSample(sceneTex, linearSampler, p).rgb;
    // 亮度提取：只让亮部（天空、透光薄浪壁、白沫）产生光束
    let lum = dot(c, vec3f(0.2126, 0.7152, 0.0722));
    let bright = max(lum - 0.55, 0.0);
    // 浪壁遮蔽：有几何的位置衰减光束
    let depthUV = clamp(p, vec2f(0.0), vec2f(1.0));
    let dcoord = vec2u(depthUV * vec2f(textureDimensions(depthTex)));
    dcoord = min(dcoord, textureDimensions(depthTex) - vec2u(1));
    let d = textureLoad(depthTex, dcoord, 0).x;
    let occ = select(0.25, 1.0, d >= 0.9999);
    acc += c * bright * occ * weight;
    weight *= 0.92;
  }
  let falloff = 1.0 - smoothstep(0.0, 1.35, dist);
  let rays = acc * 0.09 * rp.strength * (0.35 + falloff);
  return vec4f(rays, 1.0);
}
