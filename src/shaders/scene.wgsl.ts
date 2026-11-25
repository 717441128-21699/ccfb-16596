/**
 * WGSL 场景求交：
 *  - 管浪弧面：沿 z 轴的圆柱面，半径带程序化涟漪扰动，厚度从浪脚到浪唇递减
 *  - 水帘：浪唇抛射的抛物线薄片（解析二次求根 + 噪声细化），带破洞与毛边
 *  - 水面：y=0 平面 + 多层波形法线
 *  - 冲浪者：板（盒）+ 身体（胶囊）+ 头（球）的程序化剪影
 */
export const SCENE_WGSL = /* wgsl */ `

const MAT_NONE: f32 = 0.0;
const MAT_BARREL: f32 = 1.0;
const MAT_CURTAIN: f32 = 2.0;
const MAT_WATER: f32 = 3.0;
const MAT_SURFER: f32 = 4.0;

struct Hit {
  ok: bool,
  dist: f32,
  mat: f32,
  pos: vec3f,
  n: vec3f,
  thickness: f32,
  theta: f32,
  sheetU: f32,
};

fn noHit() -> Hit {
  return Hit(false, 1e9, MAT_NONE, vec3f(0.0), vec3f(0.0, 1.0, 0.0), 0.0, 0.0, 0.0);
}

// ---------- 管浪弧面 ----------

// 弧面角度域（连续，无 ±π 接缝）：
//  浪脚 theta0 ≈ -π/2（弧心正下方，接水面），逆时针经 0（+x 外壁）、
//  π/2（头顶）、π（-x 内壁），到浪唇 theta1 ≈ 4.35，弯回相机前上方。
//  相机在管内沿 +z 看洞口，整片穹顶包住画面。
fn barrelThetaRange() -> vec2f {
  return vec2f(-PI * 0.5, min(-PI * 0.5 + P.barrel.z + P.deepColor.w, 4.45));
}

fn angle01(theta: f32) -> f32 {
  let rng = barrelThetaRange();
  return clamp((theta - rng.x) / (rng.y - rng.x), 0.0, 1.0);
}

// atan2 结果直接落在本弧面的连续域内（-π/2 .. ~4.45），无需重映射
fn angleContinuous(rel: vec2f) -> f32 {
  return atan2(rel.y, rel.x);
}

fn barrelRipple(theta: f32, z: f32) -> f32 {
  let flow = P.post.z * P.skyHorizon.w;
  let n = fbm3(vec3f(cos(theta) * 2.1 + 4.0, sin(theta) * 2.1, z * P.curtainB.z + flow));
  return P.thickness.w * (n - 0.5) * 2.0;
}

fn barrelRadius(theta: f32, z: f32) -> f32 {
  return P.barrel.x + barrelRipple(theta, z);
}

// 厚度：浪脚(theta0)最厚 dMax，浪唇(theta1)最薄 dMin，指数衰减
fn barrelThickness(theta: f32) -> f32 {
  let q = angle01(theta);
  let w = pow(1.0 - q, P.thickness.z);
  return P.thickness.y + (P.thickness.x - P.thickness.y) * (1.0 - w);
}

// 端部毛边：有效半长随噪声收窄
fn barrelEnd(theta: f32, z: f32) -> f32 {
  let rag = fbm3(vec3f(theta * 2.0, 3.1, z * 0.25));
  return P.barrel.w - 1.4 * rag;
}

fn hitBarrel(ray: Ray) -> Hit {
  let C = vec2f(0.0, P.barrel.y);
  let oc = ray.o.xy - C;
  let a = dot(ray.d.xy, ray.d.xy);
  let b = 2.0 * dot(oc, ray.d.xy);
  let disc = b * b - 4.0 * a * (dot(oc, oc) - P.barrel.x * P.barrel.x);
  if (disc < 0.0) { return noHit(); }
  let sq = sqrt(disc);
  let t1 = (-b - sq) / (2.0 * a);
  let t2 = (-b + sq) / (2.0 * a);
  let rng = barrelThetaRange();

  // 两个根各做一次涟漪细化，取近处有效根
  for (var rootPass = 0; rootPass < 2; rootPass = rootPass + 1) {
    var tCand = select(t2, t1, rootPass == 0);
    if (tCand <= 0.05) { continue; }
    var t = tCand;
    var theta = 0.0;
    var valid = true;
    for (var it = 0; it < 2; it = it + 1) {
      let p = ray.o + ray.d * t;
      let rel = p.xy - C;
      theta = angleContinuous(rel);
      if (theta < rng.x || theta > rng.y) { valid = false; break; }
      let rSurf = barrelRadius(theta, p.z);
      let rNow = length(rel);
      let radial = normalize(rel);
      let denom = dot(ray.d.xy, radial);
      if (abs(denom) < 1e-4) { valid = false; break; }
      t = t - (rNow - rSurf) / denom;
    }
    if (!valid) { continue; }
    let p = ray.o + ray.d * t;
    let rel = p.xy - C;
    theta = angleContinuous(rel);
    if (theta < rng.x || theta > rng.y || t <= 0.05) { continue; }
    if (abs(p.z) > barrelEnd(theta, p.z)) { continue; }

    // 法线：参数面 S(theta,z) 解析叉积（含涟漪梯度，有限差分）
    let dth = 0.06;
    let dz = 0.25;
    let drdth = (barrelRipple(theta + dth, p.z) - barrelRipple(theta - dth, p.z)) / (2.0 * dth);
    let drdz = (barrelRipple(theta, p.z + dz) - barrelRipple(theta, p.z - dz)) / (2.0 * dz);
    let r = barrelRadius(theta, p.z);
    let ct = cos(theta);
    let st = sin(theta);
    let tTheta = vec3f(drdth * ct - r * st, drdth * st + r * ct, 0.0);
    let tZ = vec3f(drdz * ct, drdz * st, 1.0);
    let n = normalize(cross(tTheta, tZ));

    var h = noHit();
    h.ok = true; h.dist = t; h.mat = MAT_BARREL; h.pos = p;
    h.n = n; h.thickness = barrelThickness(theta); h.theta = theta;
    return h;
  }
  return noHit();
}

// ---------- 抛物线水帘 ----------

fn sheetMaxU() -> f32 {
  let y0 = P.curtainA.y;
  let vy = P.curtainA.w;
  let g = P.curtainB.x;
  return (vy + sqrt(max(vy * vy + 2.0 * g * y0, 0.01))) / g;
}

fn sheetPoint(u: f32, z: f32) -> vec3f {
  let n = fbm3(vec3f(u * 3.2, z * 0.4 + 8.0, P.post.z * 0.5));
  let rx = 0.16 * (n - 0.5);
  return vec3f(
    P.curtainA.x + P.curtainA.z * u + rx,
    P.curtainA.y + P.curtainA.w * u - 0.5 * P.curtainB.x * u * u,
    z
  );
}

fn hitCurtain(ray: Ray) -> Hit {
  let x0 = P.curtainA.x;
  let y0 = P.curtainA.y;
  let vx = P.curtainA.z;
  let vy = P.curtainA.w;
  let g = P.curtainB.x;
  let uMax = sheetMaxU();

  // 在 xy 平面把光线与抛物线 c(u) 求交，选数值更稳的分量做参数
  var roots = vec2f(-1.0, -1.0);
  if (abs(ray.d.x) >= abs(ray.d.y)) {
    let k = ray.d.y / ray.d.x;
    let A = 0.5 * g;
    let B = k * vx - vy;
    let C = ray.o.y + k * (x0 - ray.o.x) - y0;
    let dc = B * B - 4.0 * A * C;
    if (dc < 0.0) { return noHit(); }
    roots = vec2f((-B - sqrt(dc)) / (2.0 * A), (-B + sqrt(dc)) / (2.0 * A));
  } else {
    let k = ray.d.x / ray.d.y;
    let A = 0.5 * g * k;
    let B = -k * vy - vx;
    let C = ray.o.x - x0 - k * (y0 - ray.o.y);
    let dc = B * B - 4.0 * A * C;
    if (dc < 0.0 || abs(A) < 1e-5) { return noHit(); }
    roots = vec2f((-B - sqrt(dc)) / (2.0 * A), (-B + sqrt(dc)) / (2.0 * A));
  }

  for (var rootPass = 0; rootPass < 2; rootPass = rootPass + 1) {
    let u = select(roots.y, roots.x, rootPass == 0);
    if (u < 0.0 || u > uMax) { continue; }

    // 用含噪声的实际片位置做两次细化
    var uRef = u;
    var s = 1e9;
    for (var it = 0; it < 2; it = it + 1) {
      let c0 = vec2f(x0 + vx * uRef, y0 + vy * uRef - 0.5 * g * uRef * uRef);
      if (abs(ray.d.x) >= abs(ray.d.y)) {
        s = (c0.x - ray.o.x) / ray.d.x;
      } else {
        s = (c0.y - ray.o.y) / ray.d.y;
      }
      let p = ray.o + ray.d * s;
      let cFull = sheetPoint(uRef, p.z);
      // 修正 u：让曲线 x 追上光线点 x
      if (abs(ray.d.x) >= abs(ray.d.y)) {
        let s2 = (cFull.x - ray.o.x) / ray.d.x;
        let p2 = ray.o + ray.d * s2;
        let dy = p2.y - cFull.y;
        let slope = vy - g * uRef;
        if (abs(slope) > 0.05) { uRef = clamp(uRef + dy / slope, 0.0, uMax); }
        s = s2;
      } else {
        let s2 = (cFull.y - ray.o.y) / ray.d.y;
        s = s2;
      }
    }
    if (s <= 0.05) { continue; }
    let p = ray.o + ray.d * s;

    // z 范围：水帘只在洞口前方一段，沿 z 两端用噪声收毛边，不延伸到管内深处
    let zHalf = P.barrel.w * 0.5 - 1.0 * fbm3(vec3f(u * 2.0, 5.5, p.z * 0.3));
    let zCenter = P.barrel.w * 0.55;
    if (abs(p.z - zCenter) > zHalf) { continue; }
    // 相机在管内深处（z < 洞口起点）时，水帘整体不参与，保证管内视线只遇到浪壁
    if (P.camPos.z < P.barrel.w * 0.15 && p.z < P.barrel.w * 0.35) { continue; }
    // 水帘破洞
    let hole = fbm3(vec3f(uRef * 4.5, p.z * 0.55 + 2.0, P.post.z * 0.3));
    if (hole > 0.74) { continue; }

    // 法线：切向量（对 u 求导，含重力）叉 z 向切向量
    let du = 0.04;
    let pA = sheetPoint(max(uRef - du, 0.0), p.z);
    let pB = sheetPoint(min(uRef + du, uMax), p.z);
    let tanU = normalize(pB - pA);
    let tanZ = normalize(sheetPoint(uRef, p.z + 0.2) - sheetPoint(uRef, p.z - 0.2));
    let n = normalize(cross(tanU, tanZ));

    let taper = 1.0 - 0.4 * (uRef / uMax);
    let d = P.curtainB.y * taper * (0.75 + 0.5 * fbm3(vec3f(uRef * 6.0, p.z, 0.0)));

    var h = noHit();
    h.ok = true; h.dist = s; h.mat = MAT_CURTAIN; h.pos = p;
    h.n = n; h.thickness = max(d, 0.02); h.sheetU = uRef;
    return h;
  }
  return noHit();
}

// ---------- 水面 ----------

fn waterHeight(x: f32, z: f32) -> f32 {
  let t = P.post.z;
  return 0.10 * sin(x * 1.25 + t * 1.15)
       + 0.06 * sin(z * 2.2 - t * 0.9 + x * 0.4)
       + 0.035 * (fbm3(vec3f(x * 0.5, z * 0.5, t * 0.15)) - 0.5);
}

fn waterNormal(x: f32, z: f32) -> vec3f {
  let e = 0.12;
  let hL = waterHeight(x - e, z);
  let hR = waterHeight(x + e, z);
  let hD = waterHeight(x, z - e);
  let hU = waterHeight(x, z + e);
  return normalize(vec3f((hL - hR) / (2.0 * e), 1.0, (hD - hU) / (2.0 * e)));
}

fn hitWater(ray: Ray) -> Hit {
  // 与 y=h(x,z) 迭代求交，3 次足够（波幅远小于尺度）
  var t = (0.0 - ray.o.y) / ray.d.y;
  if (t <= 0.05 || ray.d.y >= -0.001) {
    // 向下俯视时仍允许一次平面求交
    if (ray.d.y >= -0.001) { return noHit(); }
  }
  for (var it = 0; it < 3; it = it + 1) {
    let p = ray.o + ray.d * t;
    let h = waterHeight(p.x, p.z);
    t = (h - ray.o.y) / ray.d.y;
    if (t <= 0.05) { return noHit(); }
  }
  let p = ray.o + ray.d * t;
  var h = noHit();
  h.ok = true; h.dist = t; h.mat = MAT_WATER; h.pos = p;
  h.n = waterNormal(p.x, p.z);
  h.thickness = 8.0;
  return h;
}

// ---------- 冲浪者剪影（SDF） ----------

fn sdfBox(p: vec3f, half: vec3f) -> f32 {
  let q = abs(p) - half;
  let outside = length(max(q, vec3f(0.0)));
  let inside = min(max(q.x, max(q.y, q.z)), 0.0);
  return outside + inside;
}

fn sdfCapsule(p: vec3f, a: vec3f, b: vec3f, r: f32) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let hh = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * hh) - r;
}

fn hitSurfer(ray: Ray) -> Hit {
  let c = P.reserved.xyz;
  // 用球体包围先剔除（冲浪者整体约 1.2m 高）
  let oc = ray.o - c;
  let bb = dot(oc, ray.d);
  let cc = dot(oc, oc) - 1.3 * 1.3;
  if (bb * bb - cc < 0.0) { return noHit(); }

  // 球步进收敛到剪影
  var t = max(-bb - sqrt(max(bb * bb - cc, 0.0)), 0.1);
  var best = 1e9;
  for (var it = 0; it < 14; it = it + 1) {
    let p = ray.o + ray.d * t;
    let lp = p - c;
    let board = sdfBox(lp - vec3f(0.0, 0.02, 0.0), vec3f(0.5, 0.03, 0.13));
    let body = sdfCapsule(lp, vec3f(0.0, 0.1, 0.0), vec3f(0.05, 0.62, 0.0), 0.11);
    let head = length(lp - vec3f(0.07, 0.76, 0.0)) - 0.09;
    let d = min(board, min(body, head));
    if (d < 0.008) { best = t; break; }
    t = t + max(d * 0.85, 0.01);
    if (t > 25.0) { break; }
  }
  if (best > 1e8) { return noHit(); }
  let p = ray.o + ray.d * best;
  var h = noHit();
  h.ok = true; h.dist = best; h.mat = MAT_SURFER; h.pos = p;
  h.n = normalize(p - (c + vec3f(0.03, 0.4, 0.0)));
  return h;
}

// ---------- 场景最近命中 ----------

fn traceScene(ray: Ray) -> Hit {
  var best = noHit();
  let h1 = hitBarrel(ray);
  let h2 = hitCurtain(ray);
  let h3 = hitWater(ray);
  let h4 = hitSurfer(ray);
  if (h1.ok) { best = h1; }
  if (h2.ok && h2.dist < best.dist) { best = h2; }
  if (h3.ok && h3.dist < best.dist) { best = h3; }
  if (h4.ok && h4.dist < best.dist) { best = h4; }
  return best;
}
`;
