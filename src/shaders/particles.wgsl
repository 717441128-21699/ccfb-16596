// ============================================================================
// particles.wgsl — 水雾/水滴 GPU 粒子
// compute：两类发射器（0=浪唇喷溅 1=落点冲击），位置积分、寿命回收、重生
// render：面向相机的 billboard，加色混合，迎太阳方向形成光束中的亮颗粒
// ============================================================================
#include "common.wgsl"

struct Particle {
  pos   : vec4f,  // xyz 位置, w 寿命进度 age/life（≥1 表示死亡待重生）
  vel   : vec4f,  // xyz 速度, w 发射器类型 0/1
  size  : vec4f,  // x 基础尺寸, y 寿命(秒), z 随机种子0..1, w 亮度
};

struct SimParams {
  dt: f32,
  count: u32,
  pad1: f32,
  pad2: f32,
};
@group(0) @binding(1) var<uniform> sim: SimParams;
@group(0) @binding(2) var<storage, read_write> particles: array<Particle>;

fn rand(seed: vec3f) -> f32 {
  return fract(sin(dot(seed, vec3f(12.9898, 78.233, 37.719))) * 43758.5453);
}

// 浪唇喷溅发射点（沿浪唇线 z 随机，取剖面 u≈1 的位置）
fn lipEmitPoint(z0: f32) -> vec3f {
  let p = wavePosition3(1.0, z0);
  return p;
}

fn spawn(pi: u32, seed: f32) {
  let kind = f32(pi & 1u); // 奇偶分配两类发射器
  let z0 = fract(seed * 7.13 + f32(pi) * 0.013);
  if (kind < 0.5) {
    // —— 浪唇喷溅：随水帘抛出，带向上扰动 ——
    let base = lipEmitPoint(z0);
    particles[pi].pos = vec4f(base + vec3f((rand(base.zyx) - 0.5) * 0.4, 0.0, 0.0), 0.0);
    let sp = mix(2.5, 7.0, rand(base.xxy + seed));
    let ang = S.curtain1.y + (rand(base.yyz) - 0.5) * 0.9;
    particles[pi].vel = vec4f(
      S.curtain1.x * 0.7 * cos(ang) + (rand(base.zxy) - 0.5) * 2.0,
      abs(sin(ang)) * sp + rand(base.xyz) * 2.2,
      (rand(base.yzx) - 0.5) * 2.4,
      0.0,
    );
    particles[pi].size = vec4f(mix(0.035, 0.11, rand(base.yxx)), mix(1.4, 3.2, rand(base.zzy)), seed, mix(0.5, 1.0, rand(base.xyy)));
  } else {
    // —— 落点冲击：水帘砸到水面处（impactX 沿线分布）向上炸散 ——
    let z = z0 * S.wave3.x;
    let impact = vec3f(S.curtain2.z, 0.15, z);
    impact.x += (rand(vec3f(seed, f32(pi), 1.0)) - 0.5) * 2.4;
    particles[pi].pos = vec4f(impact, 0.0);
    let az = rand(impact.zxy) * 6.2831;
    let up = mix(2.0, 6.5, rand(impact.xxz));
    let radial = mix(0.5, 3.0, rand(impact.yyx));
    particles[pi].vel = vec4f(cos(az) * radial, up, sin(az) * radial, 1.0);
    particles[pi].size = vec4f(mix(0.05, 0.16, rand(impact.zzy)), mix(0.9, 2.4, rand(impact.xxy)), seed, mix(0.6, 1.0, rand(impact.yzz)));
  }
}

@compute @workgroup_size(64)
fn cs(@builtin(global_invocation_id) gid: vec3u) {
  let pi = gid.x;
  if (pi >= sim.count) { return; }
  let dt = sim.dt;
  // 初始化/重生
  if (particles[pi].size.y <= 0.0 || particles[pi].pos.w >= 1.0) {
    let seed = rand(vec3f(f32(pi), S.camPos.w * 13.7, f32(pi) * 0.37));
    spawn(pi, seed);
    particles[pi].pos.w = 0.0;
    return;
  }
  // 积分（重力 + 轻微空气阻力）
  var v = particles[pi].vel.xyz;
  v.y -= S.curtain1.z * 0.62 * dt;
  v *= 1.0 - 0.35 * dt;
  particles[pi].pos = vec4f(particles[pi].pos.xyz + v * dt,
                            particles[pi].pos.w + dt / particles[pi].size.y);
  particles[pi].vel = vec4f(v, particles[pi].vel.w);
  // 落水回收
  if (particles[pi].pos.y < 0.05) {
    particles[pi].pos.w = 1.0;
  }
}

// ————————————————————————————————————————————————————————————————————————————
// 渲染：每个粒子 4 顶点 billboard
// ————————————————————————————————————————————————————————————————————————————
struct RenderVsOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) brightness: f32,
  @location(2) alpha: f32,
};

@vertex
fn vs_render(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> RenderVsOut {
  let p = particles[ii];
  let corner = array<vec2f, 4>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, 1.0),
  );
  let c = corner[vi];
  let fwd = normalize(S.camForward.xyz);
  let right = normalize(cross(vec3f(0.0, 1.0, 0.0), fwd));
  let up = cross(fwd, right);
  let age = clamp(p.pos.w, 0.0, 1.0);
  let grow = smoothstep(0.0, 0.15, age);
  let scale = p.size.x * (0.6 + grow * 1.1) * (1.0 + age * 1.8);
  let world = p.pos.xyz + (right * c.x + up * c.y) * scale;

  var o: RenderVsOut;
  o.clip = S.viewProj * vec4f(world, 1.0);
  o.uv = c * 0.5 + 0.5;
  o.brightness = p.size.w;
  o.alpha = (1.0 - age) * grow;
  return o;
}

@fragment
fn fs_render(in: RenderVsOut) -> @location(0) vec4f {
  // 软圆点：径向衰减
  let r = length(in.uv - 0.5) * 2.0;
  let soft = smoothstep(1.0, 0.15, r);
  if (soft <= 0.001) { discard; }
  // 迎太阳的水雾被照亮（偏暖白），背光面偏冷蓝
  let sunTint = mix(vec3f(0.55, 0.7, 0.95), vec3f(1.0, 0.93, 0.78),
                    clamp(dot(normalize(S.camForward.xyz), S.light1.xyz) * 0.5 + 0.5, 0.0, 1.0));
  let col = sunTint * in.brightness * (0.35 + S.light1.w * 0.18);
  return vec4f(col, soft * in.alpha * 0.55);
}
