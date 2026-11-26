// ============================================================================
// ocean.wgsl — 浪前方开阔水面：涌浪位移、太阳闪光、水帘落点泡沫环、水雾雾团
// 网格为 XZ 平面（80×80，160m），vertex 阶段加 Gerstner 风格涌浪
// ============================================================================
#include "common.wgsl"

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) viewDir: vec3f,
  @location(3) localXZ: vec2f,
};

fn swellHeight(p: vec2f) -> f32 {
  let t = S.camPos.w;
  return 0.34 * sin(p.x * 0.22 + p.y * 0.11 - t * 1.1)
       + 0.22 * sin(p.x * 0.41 - p.y * 0.27 + t * 1.7)
       + 0.12 * sin((p.x + p.y) * 0.75 - t * 2.3);
}

@vertex
fn vs(@location(0) attr: vec2f) -> VsOut {
  // attr: x ∈ [-80,80], z ∈ [-20,140]（水面铺到洞口外）
  var p = vec3f(attr.x, 0.0, attr.y);
  p.y = swellHeight(attr);
  let e = 0.6;
  let hx = swellHeight(attr + vec2f(e, 0.0)) - swellHeight(attr - vec2f(e, 0.0));
  let hz = swellHeight(attr + vec2f(0.0, e)) - swellHeight(attr - vec2f(0.0, e));
  let n = normalize(vec3f(-hx / (2.0 * e), 1.0, -hz / (2.0 * e)));

  var o: VsOut;
  o.clip = S.viewProj * vec4f(p, 1.0);
  o.world = p;
  o.normal = n;
  o.viewDir = S.camPos.xyz - p;
  o.localXZ = attr;
  return o;
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let V = normalize(in.viewDir);
  let N = normalize(in.normal);
  let sunDir = S.light1.xyz;

  // 深水基色：内散射极限色压暗
  let base = S.optics2.xyz * 1.6 + vec3f(0.012, 0.04, 0.055);
  let F = fresnel(clamp(dot(N, V), 0.0, 1.0), 0.02);
  let R = reflect(-V, N);
  let refl = skyColor(normalize(R));
  let glitter = pow(max(dot(R, sunDir), 0.0), 380.0) * 6.0 * S.light1.w;

  var col = mix(base * S.light2.x, refl, F * 0.9) + vec3f(glitter);

  // —— 水帘落点泡沫：沿 Z 展开的冲击带（水帘落点在 X 方向，沿浪长拉成白沫带）——
  let dImpact = abs(in.localXZ.x - S.curtain2.z);
  let band = 1.0 - smoothstep(0.0, 3.2, dImpact);
  let ringN = fbm(in.localXZ * 1.8 + vec2f(0.0, S.camPos.w * 0.5));
  let impactFoam = band * smoothstep(0.42, 0.72, ringN) * S.wave3.w;

  // 散落泡沫斑块顺流漂走
  let drift = fbm(in.localXZ * 0.7 + vec2f(S.camPos.w * 0.15, -S.camPos.w * 0.3));
  let patches = smoothstep(0.72, 0.9, drift) * 0.5 * S.wave3.w;

  let foam = clamp(impactFoam + patches, 0.0, 1.0);
  let foamCol = vec3f(0.9, 0.96, 1.0) * (0.5 + S.light2.x * 0.6);
  col = mix(col, foamCol, foam);

  col = applyFog(col, length(in.viewDir));
  return vec4f(col, 1.0);
}
