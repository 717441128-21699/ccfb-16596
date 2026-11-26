// ============================================================================
// curtain.wgsl — 浪唇抛出的水帘（弹道薄水片）
// 网格属性：attr.x = 弹道时间 t∈[0,1]，attr.y = 沿浪向 z0∈[0,1]
// 浪唇位置取剖面 u=1 点（curtain2.xy），按 peel 斜切沿 Z 展开
// ============================================================================
#include "common.wgsl"

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) t: f32,
  @location(3) edge: f32,
  @location(4) z0: f32,
  @location(5) viewDir: vec3f,
};

fn posAt(t: f32, z0: f32) -> vec3f {
  let speed = S.curtain1.x;
  let ang = S.curtain1.y;
  let g = S.curtain1.z;
  let vx = speed * cos(ang);
  let vy = -speed * sin(ang);
  let z = z0 * S.wave3.x;
  let peel = (z / S.wave3.x) * S.wave3.y * S.wave1.x * 2.2;
  let lip = vec3f(S.curtain2.x - peel, S.curtain2.y, z);
  let s = t * S.curtain1.w;
  return lip + vec3f(vx * s, vy * s - 0.5 * g * s * s, 0.0);
}

@vertex
fn vs(@location(0) attr: vec2f) -> VsOut {
  let t = attr.x;
  let z0 = attr.y;
  let g = S.curtain1.z;
  let world = posAt(t, z0);

  // 数值法线：对 t 与 z0 差分
  let eps = 0.01;
  let pt = posAt(clamp(t + eps, 0.0, 1.0), z0) - posAt(clamp(t - eps, 0.0, 1.0), z0);
  let pz = posAt(t, clamp(z0 + eps, 0.0, 1.0)) - posAt(t, clamp(z0 - eps, 0.0, 1.0));
  let n = normalize(cross(pz, pt));

  var o: VsOut;
  o.clip = S.viewProj * vec4f(world, 1.0);
  o.world = world;
  o.normal = n;
  o.t = t;
  o.edge = 0.0;
  o.z0 = z0;
  o.viewDir = S.camPos.xyz - world;
  return o;
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let V = normalize(in.viewDir);
  let N = normalize(in.normal);
  let sunDir = S.light1.xyz;

  // 水帘厚度：随飞行时间快速变薄（0.25m → 0.02m），碎裂后 alpha 降低
  let d = mix(0.25, 0.02, pow(in.t, 0.8));
  let T = waterTransmission(d);

  // 边缘与末端碎裂噪声（沿 z 拉伸的不规则水片）
  let tear = fbm(vec2f(in.z0 * 18.0, in.t * 10.0 - S.camPos.w * 0.4));
  let edgeFade = smoothstep(0.0, 0.08, in.t) * (1.0 - smoothstep(0.78, 1.0, in.t) * step(0.45, tear));
  let holes = smoothstep(0.28, 0.5, tear);
  let alpha = edgeFade * (1.0 - holes * smoothstep(0.5, 1.0, in.t) * 0.85);

  let F = fresnel(clamp(abs(dot(N, V)), 0.0, 1.0), 0.02);
  let R = reflect(-V, N);
  let refl = skyColor(normalize(R));
  let back = clamp(dot(-V, sunDir), 0.0, 1.0);

  var col = mix(T * (S.light1.w * 0.5 * back + S.light2.x), refl, F);
  // 水片白沫：末端与碎裂边
  let white = clamp(smoothstep(0.66, 0.95, in.t) + (1.0 - edgeFade), 0.0, 1.0);
  col = mix(col, vec3f(0.93, 0.97, 1.0) * (0.6 + S.light2.x * 0.5), white * 0.85);

  col = applyFog(col, length(in.viewDir));
  return vec4f(col, alpha);
}
