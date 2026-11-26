// ============================================================================
// wave.wgsl — 卷浪浪面：厚度透光、浪唇白沫、浪面拉条泡沫、菲涅尔天空反射
// 网格顶点属性：position.xy = (u, z0)，在 vertex 阶段解析为 3D 浪面
// ============================================================================
#include "common.wgsl"

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) thick: f32,
  @location(3) u: f32,
  @location(4) z0: f32,
  @location(5) viewDir: vec3f,
};

@vertex
fn vs(@location(0) attr: vec2f) -> VsOut {
  let u = clamp(attr.x, 0.0, 1.0);
  let z0 = attr.y;
  let world = wavePosition3(u, z0);
  // 有限差分求切向量 → 几何法线
  let eps = 0.004;
  let du = wavePosition3(clamp(u + eps, 0.0, 1.0), z0) - wavePosition3(clamp(u - eps, 0.0, 1.0), z0);
  let dz = wavePosition3(u, clamp(z0 + eps, 0.0, 1.0)) - wavePosition3(u, clamp(z0 - eps, 0.0, 1.0));
  let n = normalize(cross(dz, du));
  let prof = waveProfile(u);

  var o: VsOut;
  o.clip = S.viewProj * vec4f(world, 1.0);
  o.world = world;
  o.normal = n;
  o.thick = prof.thick;
  o.u = u;
  o.z0 = z0;
  o.viewDir = S.camPos.xyz - world;
  return o;
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let time = S.camPos.w;
  let V = normalize(in.viewDir);
  let N = normalize(in.normal);
  let sunDir = S.light1.xyz;
  let cosV = clamp(abs(dot(N, V)), 0.0, 1.0);

  // —— 微表面扰动（浪面细碎起伏，影响反射与泡沫形状）——
  let flow = time * S.wave3.z;
  let n1 = fbm(vec2f(in.z0 * 9.0 - flow * 0.25, in.u * 12.0));
  let n2 = fbm(vec2f(in.z0 * 22.0 - flow * 0.4 + 11.0, in.u * 26.0));
  let micro = (n1 - 0.5) * 0.16 + (n2 - 0.5) * 0.07;
  let Np = normalize(N + vec3f(micro, micro * 0.6, 0.0));

  // —— 背光：视线与太阳同侧（光从浪背透来）时用厚度 Beer–Lambert ——
  let backFactor = clamp(dot(-V, sunDir), 0.0, 1.0);
  // 斜射时光路按 1/cos 修正（浪壁内斜穿）
  let pathStretch = 1.0 / max(clamp(dot(-sunDir, Np), 0.15, 1.0), 0.15);
  let d = in.thick * mix(1.0, pathStretch, backFactor);
  let transmitted = backlitColor(d);

  // —— 菲涅尔反射天空 ——
  let F = fresnel(cosV, 0.02);
  let R = reflect(-V, Np);
  let sky = skyColor(normalize(R));
  // 弱镜面阳光高光
  let spec = pow(max(dot(R, sunDir), 0.0), 220.0) * 2.4 * S.light1.w;

  var col = mix(transmitted, sky, F * 0.85) + vec3f(spec);

  // —— 泡沫 1：浪唇白沫（u 接近 1 的窄带，被水流拉成不规则条带）——
  let lipBand = smoothstep(0.965, 0.998, in.u);
  let lipNoise = smoothstep(0.35, 0.75, fbm(vec2f(in.z0 * 14.0 + flow * 0.5, in.u * 60.0)));
  var foam = lipBand * lipNoise * S.wave3.w;

  // —— 泡沫 2：浪面白条（顺浪流拉长的 fBm 条带，随 flowSpeed 向下游移动）——
  let streakUv = vec2f(in.z0 * 7.0 - flow * 0.6, in.u * 26.0);
  let streak = fbm(streakUv * vec2f(0.35, 2.6));
  let streakMask = smoothstep(0.62, 0.82, streak) * smoothstep(0.12, 0.5, in.u) * (1.0 - lipBand);
  // 泡沫在薄浪壁处更明显（被光打亮的白）
  foam = clamp(max(foam, streakMask * S.wave3.w * 0.8), 0.0, 1.0);

  let foamCol = vec3f(0.92, 0.97, 1.0) * (0.55 + 0.45 * backFactor * S.light1.w * 0.4 + S.light2.x * 0.5);
  col = mix(col, foamCol, foam);

  // —— 雾 ——
  let dist = length(in.viewDir);
  col = applyFog(col, dist);

  return vec4f(col, 1.0);
}
