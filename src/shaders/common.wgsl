// ============================================================================
// common.wgsl — 全部 shader 共享：uniform 布局、卷浪剖面、噪声、天空、海水透光
// 布局与 src/render/uniforms.ts 的 Float32Array 偏移严格一一对应（256 字节，64 个 f32）
// ============================================================================

struct SceneParams {
  viewProj      : mat4x4f,  //   0  (float 0..15)
  camPos        : vec4f,    //  64  (16..19) xyz + time
  camForward    : vec4f,    //  80  (20..23) xyz + aspect
  wave1         : vec4f,    //  96  (24..27) radius, faceWidth, faceHeight, facePower
  wave2         : vec4f,    // 112  (28..31) faceU, lipAngle, tBase, tLip
  wave3         : vec4f,    // 128  (32..35) length, peelAngle, flowSpeed, foamAmount
  light1        : vec4f,    // 144  (36..39) sunDir.xyz, sunIntensity
  light2        : vec4f,    // 160  (40..43) ambientIntensity, turbidity, fog, cloudiness
  optics1       : vec4f,    // 176  (44..47) sigmaR, sigmaG, sigmaB, sigmaLum
  optics2       : vec4f,    // 192  (48..51) scatterR, scatterG, scatterB, dMin
  optics3       : vec4f,    // 208  (52..55) dMax, lensDrops, godRayStrength, _pad
  curtain1      : vec4f,    // 224  (56..59) launchSpeed, launchAngle, gravity, flightTime
  curtain2      : vec4f,    // 240  (60..63) lipX, lipY, impactX, _pad
};

@group(0) @binding(0) var<uniform> S: SceneParams;

struct ProfileOut {
  pos   : vec2f,  // xy 剖面位置
  nrm   : vec2f,  // xy 外法线
  thick : f32,
};

// —— 卷浪剖面（与 src/physics/wave.ts waveProfile 逐式一致）——
fn waveProfile(u: f32) -> ProfileOut {
  var out: ProfileOut;
  let faceU = S.wave2.x;
  let R = S.wave1.x;
  if (u <= faceU) {
    let s = u / faceU;
    let x = -S.wave1.y * (1.0 - s);
    let y = S.wave1.z * (1.0 - pow(1.0 - s, S.wave1.w));
    let dxds = S.wave1.y;
    let dyds = S.wave1.z * S.wave1.w * pow(1.0 - s, S.wave1.w - 1.0);
    let invLen = 1.0 / max(length(vec2f(dxds, dyds)), 1e-5);
    let n = vec2f(dyds, -dxds) * invLen;
    let tBase = S.wave2.z;
    let tLip = S.wave2.w;
    let k = (tBase * 0.35 - tLip) / max(tBase - tLip, 1e-5);
    let frac = k + (1.0 - k) * pow(1.0 - s, 1.35);
    let t = tLip + (tBase - tLip) * frac;
    out = ProfileOut(vec2f(x, y), n, t);
  } else {
    let q = (u - faceU) / (1.0 - faceU);
    let theta = q * S.wave2.y;
    let cx = 0.0;
    let cy = S.wave1.z + R;
    let x = cx - R * sin(theta);
    let y = cy - R * cos(theta);
    let n = vec2f(-sin(theta), -cos(theta));
    let tJoinVal = S.wave2.z * 0.35;
    let t = S.wave2.w * exp((1.0 - q) * log(max(tJoinVal / S.wave2.w, 1e-5)));
    out = ProfileOut(vec2f(x, y), n, t);
  }
  return out;
}

// 3D 浪面位置（peel 斜切）
fn wavePosition3(u: f32, z0: f32) -> vec3f {
  let p = waveProfile(u);
  let z = z0 * S.wave3.x;
  let peel = (z / S.wave3.x) * S.wave3.y * S.wave1.x * 2.2;
  return vec3f(p.pos.x - peel, p.pos.y, z);
}

// ============================================================================
// 哈希 / 值噪声 / fBm（泡沫拉条、云、镜头水滴都用它）
// ============================================================================
fn hash21(p: vec2f) -> f32 {
  var x = fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123);
  return x;
}

fn vnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2f(1.0, 0.0));
  let c = hash21(i + vec2f(0.0, 1.0));
  let d = hash21(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm(p: vec2f) -> f32 {
  var v = 0.0;
  var amp = 0.5;
  var q = p;
  for (var i = 0; i < 4; i++) {
    v += amp * vnoise(q);
    q = q * 2.03 + vec2f(17.3, 9.1);
    amp *= 0.5;
  }
  return v;
}

// ============================================================================
// 程序化天空：瑞利风格梯度 + 太阳盘 + 浑浊雾霾 + 噪声云
// ============================================================================
fn skyColor(dir: vec3f) -> vec3f {
  let sunDir = S.light1.xyz;
  let el = max(dir.y, 0.0);
  let turb = S.light2.y;
  // 天顶到地平的蓝→暖白梯度
  let zenith = vec3f(0.16, 0.38, 0.78) / max(turb * 0.35, 0.4);
  let horizon = mix(vec3f(0.75, 0.78, 0.85), vec3f(1.05, 0.72, 0.42),
                    clamp(1.0 - sunDir.y * 3.0, 0.0, 1.0));
  var col = mix(horizon, zenith, pow(el, 0.55));
  // 太阳盘与晕
  let sd = max(dot(dir, sunDir), 0.0);
  let disc = smoothstep(0.9994, 0.9998, sd);
  let glow = pow(sd, 90.0) * 0.55 + pow(sd, 8.0) * 0.12;
  let sunTint = mix(vec3f(1.0, 0.75, 0.5), vec3f(1.0, 0.97, 0.9), clamp(sunDir.y * 2.0, 0.0, 1.0));
  col += sunTint * (disc * 6.0 + glow) * S.light1.w;
  // 云
  if (S.light2.w > 0.005) {
    let cuv = vec2f(atan2(dir.z, dir.x) * 1.8, el * 4.0);
    let cl = fbm(cuv * 1.6 + vec2f(S.camPos.w * 0.004, 0.0));
    let cloud = smoothstep(1.0 - S.light2.w * 0.85, 1.05 - S.light2.w * 0.2, cl) * smoothstep(0.02, 0.18, el);
    col = mix(col, vec3f(0.82, 0.84, 0.88), cloud * S.light2.w);
  }
  return col;
}

// ============================================================================
// 海水透光（与 src/physics/optics.ts 的单指数拟合模型一致）
// T_c(d) = exp(-sigma_c·d)；环境内散射 L_s·(b_b/c)·(1-T) 用极限色近似
// ============================================================================
fn waterTransmission(d: f32) -> vec3f {
  return exp(-S.optics1.xyz * d);
}

// 背光透射色：阳光穿过浪壁 + 沿途环境内散射
fn backlitColor(d: f32) -> vec3f {
  let T = waterTransmission(d);
  let scatter = S.optics2.xyz * (1.0 - T);
  return T * S.light1.w + scatter * S.light2.x;
}

// Schlick 菲涅尔
fn fresnel(cosTheta: f32, f0: f32) -> f32 {
  let c = clamp(1.0 - cosTheta, 0.0, 1.0);
  return f0 + (1.0 - f0) * c * c * c * c * c;
}

// 雾化（大气透视）
fn applyFog(col: vec3f, dist: f32) -> vec3f {
  let f = 1.0 - exp(-S.light2.z * dist * 0.018);
  let fogCol = skyColor(normalize(vec3f(S.camForward.x, 0.12, S.camForward.z)));
  return mix(col, fogCol, clamp(f, 0.0, 0.92));
}
