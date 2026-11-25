/**
 * WGSL 公共库：Params 结构（与 UNIFORM_SLOTS 逐字段对齐）、噪声、天空、相机射线。
 */
export const COMMON_WGSL = /* wgsl */ `

struct Params {
  camPos: vec4f,        // xyz 相机位置, w 场景时间
  camTarget: vec4f,     // xyz 注视点, w fovY
  sunDir: vec4f,        // xyz 指向太阳, w 太阳照度
  sunColor: vec4f,      // rgb 太阳颜色, w 云量
  absorb: vec4f,        // rgb Pope&Fry 吸收系数, w 浑浊度
  scatter: vec4f,       // rgb Morel 散射系数, w 颗粒附加吸收
  barrel: vec4f,        // R, h, arcAngle, crestHalfLen
  thickness: vec4f,     // dMin, dMax, falloff, rippleAmp
  curtainA: vec4f,      // x0, y0, vx, vy
  curtainB: vec4f,      // gravity, width, rippleScale, curtainOpacity
  fx: vec4f,            // foam, mist, lensWater, foamStretch
  env: vec4f,           // fogDensity, exposure, HG g, surfaceRoughness
  deepColor: vec4f,     // rgb 深水色, w lipAngle
  skyZenith: vec4f,     // rgb 天顶色, w 太阳角直径
  skyHorizon: vec4f,    // rgb 地平线色, w 浪面流动速度
  resolution: vec4f,    // width, height, aspect, dither
  post: vec4f,          // filmGrain, vignette, waveTime, jetProgress
  reserved: vec4f,      // xyz 冲浪者位置, w 压弯角
  dbg: vec4f,           // x = debugView
};

@group(0) @binding(0) var<uniform> P: Params;

const PI: f32 = 3.14159265359;

// ---------- 哈希 / 值噪声 / fbm（无贴图，全部程序化） ----------

fn hash31(p3: vec3f) -> f32 {
  var p = fract(p3 * vec3f(0.1031, 0.1030, 0.0973));
  p = p + dot(p, p.zyx + vec3f(31.32, 28.17, 23.71));
  return fract((p.x + p.y) * p.z);
}

fn vnoise(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let n000 = hash31(i + vec3f(0.0, 0.0, 0.0));
  let n100 = hash31(i + vec3f(1.0, 0.0, 0.0));
  let n010 = hash31(i + vec3f(0.0, 1.0, 0.0));
  let n110 = hash31(i + vec3f(1.0, 1.0, 0.0));
  let n001 = hash31(i + vec3f(0.0, 0.0, 1.0));
  let n101 = hash31(i + vec3f(1.0, 0.0, 1.0));
  let n011 = hash31(i + vec3f(0.0, 1.0, 1.0));
  let n111 = hash31(i + vec3f(1.0, 1.0, 1.0));
  let nx00 = mix(n000, n100, u.x);
  let nx10 = mix(n010, n110, u.x);
  let nx01 = mix(n001, n101, u.x);
  let nx11 = mix(n011, n111, u.x);
  let nxy0 = mix(nx00, nx10, u.y);
  let nxy1 = mix(nx01, nx11, u.y);
  return mix(nxy0, nxy1, u.z);
}

fn fbm3(p: vec3f) -> f32 {
  var sum = 0.0;
  var amp = 0.5;
  var q = p;
  for (var k = 0; k < 3; k = k + 1) {
    sum = sum + amp * vnoise(q);
    q = q * 2.03 + vec3f(11.7, 7.3, 5.1);
    amp = amp * 0.5;
  }
  return sum;
}

// ---------- 相机射线 ----------

struct Ray {
  o: vec3f,
  d: vec3f,
};

fn makeRay(uv: vec2f) -> Ray {
  let ro = P.camPos.xyz;
  let fwd = normalize(P.camTarget.xyz - ro);
  let right = normalize(cross(fwd, vec3f(0.0, 1.0, 0.0)));
  let up = cross(right, fwd);
  let focal = 1.0 / tan(P.camTarget.w * 0.5);
  let rd = normalize(fwd * focal + right * uv.x * P.resolution.z + up * uv.y);
  return Ray(ro, rd);
}

// ---------- 天空（含太阳盘、天光、程序化云层） ----------

fn skyColor(rd: vec3f) -> vec3f {
  let h = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
  var col = mix(P.skyHorizon.rgb, P.skyZenith.rgb, pow(h, 1.25));

  // 程序化云层：沿视线投影到高空平面采样 fbm
  if (rd.y > 0.02) {
    let cloudPlane = 90.0;
    let cp = (ro_or_zero() + rd * (cloudPlane / max(rd.y, 0.02)));
    let n = fbm3(vec3f(cp.x * 0.018, cp.z * 0.018, P.camPos.w * 0.006));
    let mask = smoothstep(1.0 - P.sunColor.w - 0.25, 1.05 - P.sunColor.w, n);
    let cloudCol = mix(vec3f(0.85, 0.87, 0.9), vec3f(0.55, 0.58, 0.64), 0.5);
    col = mix(col, cloudCol, mask * P.sunColor.w * 0.9);
  }

  // 太阳盘与辉光
  let mu = clamp(dot(rd, P.sunDir.xyz), 0.0, 1.0);
  let ang = P.skyZenith.w;
  let disc = smoothstep(1.0 - ang * 1.6, 1.0 - ang * 0.25, mu);
  let glow = pow(mu, 220.0) * 0.25 + pow(mu, 24.0) * 0.05;
  let sunVis = 1.0 - P.sunColor.w * 0.85;
  col = col + P.sunColor.rgb * P.sunDir.w * (disc * 1.6 + glow) * sunVis;
  return col;
}

// 云层采样辅助（相机高度无关，使用固定投影中心）
fn ro_or_zero() -> vec3f {
  return vec3f(P.camPos.x * 0.0, 0.0, P.camPos.z);
}

// Henyey–Greenstein 相位（省略 4π 归一化，整体强度在调用处调）
fn hgPhase(mu: f32, g: f32) -> f32 {
  let g2 = g * g;
  return (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * mu, 0.0001), 1.5);
}

fn fresnelSchlick(cosTheta: f32, f0: f32) -> f32 {
  let c = clamp(cosTheta, 0.0, 1.0);
  return f0 + (1.0 - f0) * pow(1.0 - c, 5.0);
}
`;
