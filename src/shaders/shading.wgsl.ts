/**
 * WGSL 着色与合成：
 *  - 管浪/水帘：Beer–Lambert 厚度透射（吸收系数即 Pope & Fry 表值）+ HG 单次内散射
 *  - 浪面：菲涅耳反射 + 泡沫条带（沿流向拉伸的程序化白条）
 *  - 水雾：光线步进体积散射，逆光形成光束（god rays）
 *  - 镜头：水滴折射（在生成视线前扭曲 uv）+ 水膜、暗角、胶片颗粒、ACES
 */
export const SHADING_WGSL = /* wgsl */ `

// ---------- 泡沫场 ----------

fn barrelFoam(h: Hit) -> f32 {
  let flow = P.post.z * P.skyHorizon.w;
  let q = angle01(h.theta);

  // 浪唇白沫环带
  let lip = smoothstep(0.80, 0.985, q);

  // 沿流向（theta 方向）拉长的泡沫条
  let sp = vec3f(h.theta * 5.5 * P.fx.w, h.pos.z * 1.6 - flow * 2.2, 2.7);
  let n = fbm3(sp);
  let streak = smoothstep(0.50, 0.80, n);

  let broken = 0.55 + 0.45 * fbm3(vec3f(h.pos.z * 0.9, h.theta * 9.0 - flow, 4.4));
  return clamp((lip * 0.92 + streak * (0.22 + 0.55 * q) * broken), 0.0, 1.0) * P.fx.x;
}

fn curtainFoam(h: Hit) -> f32 {
  let flow = P.post.z * P.skyHorizon.w;
  let n = fbm3(vec3f(h.sheetU * 7.0, h.pos.z * 1.4 - flow, 8.2));
  // 落水区与浪唇两端白沫最重
  let end = smoothstep(0.72, 1.0, h.sheetU / sheetMaxU());
  return clamp(smoothstep(0.45, 0.75, n) * 0.6 + end * 0.85, 0.0, 1.0) * P.fx.x;
}

fn waterFoam(p: vec3f) -> f32 {
  let uMax = sheetMaxU();
  let landX = P.curtainA.x + P.curtainA.z * uMax;
  let flow = P.post.z * P.skyHorizon.w;
  // 水帘落水区泡沫带，沿 z 拉成白条随流漂移
  let band = exp(-pow((p.x - landX) / 1.1, 2.0));
  let n = fbm3(vec3f(p.x * 1.3, p.z * 0.55 - flow * 1.4, 6.6));
  let streak = smoothstep(0.42, 0.72, n);
  // 浪脚处的白沫线（弱）
  let base = exp(-pow((p.x + P.barrel.x * 0.92) / 0.55, 2.0)) * 0.45;
  return clamp(band * (0.3 + 0.6 * streak) + base * streak, 0.0, 1.0) * P.fx.x * 0.8;
}

// ---------- 管浪弧面着色 ----------

fn shadeBarrel(h: Hit, ray: Ray) -> vec3f {
  let d = h.thickness;
  let aRGB = P.absorb.rgb;
  let bRGB = P.scatter.rgb;
  let partAbs = P.scatter.w;

  // ① Beer–Lambert：每通道 exp(-(a_water + a_particle)·d)
  let trans = exp(-(aRGB + vec3f(partAbs)) * d);

  // ② 单次内散射：(b/(a+b))·(1-exp(-(a+b)d))·HG(μ)
  let cRGB = aRGB + bRGB + vec3f(partAbs);
  let mu = clamp(dot(ray.d, P.sunDir.xyz), -1.0, 1.0);
  let phase = hgPhase(mu, P.env.z) * 0.03;
  let ins = (bRGB / cRGB) * (vec3f(1.0) - exp(-cRGB * d))
            * phase * P.sunColor.rgb * P.sunDir.w;

  let nrm = normalize(h.n);
  let inside = dot(ray.d, nrm) > 0.0;
  let V = -ray.d;

  // ③ 背光透射项：从管内看浪壁时，阳光从浪背穿过厚度。
  // 管内以水的透射光为主（带青绿光谱染色），背景天空只作小幅补充，
  // 这样即使薄区 trans≈1 也不会整片显示亮天空发白。
  let bg = skyColor(ray.d);
  // 强绿光谱染色：薄区也是绿青色而非中性白
  let spectralTint = vec3f(0.62, 1.12, 0.92);
  // 透射主光：用太阳/天光的环境亮度经水体染色，而非直接透背景
  let litTint = (P.skyHorizon.rgb * 0.6 + P.sunColor.rgb * P.sunDir.w * 0.1) * spectralTint;
  var col = trans * litTint * 1.25 + trans * bg * 0.22 + ins;

  // ④ 体积漫透射（非视线方向阳光被水散射进管内）：
  // 薄区此项弱、直射透光占比高更亮；厚区呈深青绿，绝不发白。
  let sunBack = max(dot(-nrm, P.sunDir.xyz), 0.0);
  let thickW = clamp(d / P.thickness.y, 0.0, 1.0);
  let diffuseTrans = (vec3f(1.0) - trans)
      * (0.18 + 0.5 * sunBack)
      * P.deepColor.rgb
      * (0.5 + 0.8 * thickW);
  col = col + diffuseTrans;

  // ⑤ 菲涅耳反射：仅掠射角显著，正视浪壁时反射很弱，保留透光本色
  let cosI = clamp(abs(dot(V, nrm)), 0.0, 1.0);
  let F = fresnelSchlick(cosI, 0.02);
  let H = normalize(V + P.sunDir.xyz);
  let spec = pow(max(dot(nrm, H), 0.0), mix(220.0, 28.0, P.env.w))
             * P.sunColor.rgb * P.sunDir.w * 0.4;
  let refl = skyColor(reflect(ray.d, nrm)) * 0.3 + spec;
  // 幂次压缩：正视（cosI≈1）时 F≈0.02，反射权重压到极低
  let reflW = pow(F, 1.4) * select(0.5, 1.0, inside);
  col = mix(col, refl, clamp(reflW, 0.0, 0.85));

  // ⑥ 泡沫白条
  let foam = barrelFoam(h);
  col = mix(col, vec3f(0.72, 0.82, 0.86) * (0.45 + 0.35 * max(spec.r, 0.0)), foam);
  // ⑦ 涟漪法线明暗：薄区打破平涂，产生随浪流动的明暗带
  let rippleShade = 0.85 + 0.3 * (fbm3(vec3f(h.theta * 3.0, h.pos.z * 0.6, P.post.z * 0.4)) - 0.5);
  return max(col * rippleShade, vec3f(0.0));
}

// ---------- 水帘着色（薄片，厚度小 → 偏亮白绿） ----------

fn shadeCurtain(h: Hit, ray: Ray) -> vec3f {
  let d = h.thickness;
  let trans = exp(-(P.absorb.rgb + vec3f(P.scatter.w)) * d);
  let cTot = P.absorb.rgb + P.scatter.rgb + vec3f(P.scatter.w);
  let muC = clamp(dot(ray.d, P.sunDir.xyz), -1.0, 1.0);
  let phaseC = hgPhase(muC, P.env.z) * 0.03;
  let insC = (P.scatter.rgb / cTot) * (vec3f(1.0) - exp(-cTot * d))
            * phaseC * P.sunColor.rgb * P.sunDir.w;
  var colC = trans * skyColor(ray.d) + insC;

  let nrmC = normalize(select(-h.n, h.n, dot(ray.d, h.n) > 0.0));
  let VC = -ray.d;
  let FC = fresnelSchlick(abs(dot(VC, nrmC)), 0.02);
  let HC = normalize(VC + P.sunDir.xyz);
  let specC = pow(max(dot(nrmC, HC), 0.0), 90.0) * P.sunColor.rgb * P.sunDir.w * 0.5;
  colC = mix(colC, skyColor(reflect(ray.d, nrmC)) * 0.5 + specC, FC);

  let foamC = curtainFoam(h);
  colC = mix(colC, vec3f(0.96, 0.99, 1.0), foamC);
  return max(colC, vec3f(0.0)) * clamp(P.curtainB.w + 0.15, 0.0, 1.0);
}

// ---------- 水面 ----------

fn shadeWater(h: Hit, ray: Ray) -> vec3f {
  let nrm = h.n;
  let V = -ray.d;
  let F = fresnelSchlick(max(dot(V, nrm), 0.0), 0.02);
  let rdir = reflect(ray.d, nrm);
  let refl = skyColor(rdir);
  // 折射/深水色：按视线掠射角混入
  let depthTint = P.deepColor.rgb * (0.35 + 0.3 * max(nrm.y, 0.0)) * 0.55;

  // 太阳高光
  let Hh = normalize(V + P.sunDir.xyz);
  let spec = pow(max(dot(nrm, Hh), 0.0), mix(300.0, 40.0, P.env.w))
             * P.sunColor.rgb * P.sunDir.w * 0.6;
  // 管内近距离水面几乎只显示深水本色，反射权重随距离和掠射角才起来
  let distFade = clamp(h.dist / 14.0, 0.0, 1.0);
  let reflW = clamp(F * 0.85, 0.0, 0.65) * distFade * distFade;
  var col = mix(depthTint, refl * 0.8, reflW);
  col = col + spec * (0.2 + 0.8 * distFade);

  let foam = waterFoam(h.pos);
  col = mix(col, vec3f(0.8, 0.88, 0.9), foam * 0.7);
  return col * 0.85;
}

// ---------- 冲浪者剪影 ----------

fn shadeSurfer(h: Hit, ray: Ray) -> vec3f {
  let nrm = h.n;
  let V = -ray.d;
  let Hh = normalize(V + P.sunDir.xyz);
  let diff = max(dot(nrm, P.sunDir.xyz), 0.0);
  let spec = pow(max(dot(nrm, Hh), 0.0), 60.0) * P.sunColor.rgb * P.sunDir.w * 0.4;
  // 深色湿衣剪影：整体压暗，仅边缘被洞口光勾亮
  let rim = pow(1.0 - max(dot(nrm, V), 0.0), 2.4);
  var col = vec3f(0.012, 0.018, 0.022) * (0.4 + diff * 0.6)
          + rim * P.sunColor.rgb * 0.7 + spec * 0.5;
  return col;
}

// ---------- 水雾体积散射（光线步进） ----------

fn mistDensity(p: vec3f) -> f32 {
  let flow = P.post.z * 0.6;
  // 雾是低频体积，2 阶噪声足够且省一次 vnoise 计算
  let q = vec3f(p.x * 0.42 + flow, p.y * 0.5, p.z * 0.42);
  let n = vnoise(q) * 0.6 + vnoise(q * 2.03 + 11.7) * 0.4;
  // 落水区水雾最浓
  let uMax = sheetMaxU();
  let landX = P.curtainA.x + P.curtainA.z * uMax;
  let landEnv = exp(-pow((p.x - landX) / 3.2, 2.0)) * exp(-pow(p.y / 2.6, 2.0));
  // 浪唇抛射线一带
  let lipEnv = exp(-pow((p.x - P.curtainA.x) / 4.0, 2.0))
             * exp(-pow((p.y - P.curtainA.y) / 2.2, 2.0));
  let envv = landEnv * 0.55 + lipEnv * 0.4;
  // 仅局部水雾；空气雾由 env.x 在合成阶段单独处理，避免全屏泛白
  return P.fx.y * envv * (0.12 + 0.7 * n);
}

fn volumetric(ray: Ray, maxT: f32, outAcc: ptr<function, vec3f>) -> f32 {
  // 近距离加密、远距离稀疏：6 步足够，落水区外密度≈0 时提前结束
  let steps = 6;
  var acc = vec3f(0.0);
  var beam = 1.0;
  let stepLen = maxT / f32(steps);
  let mu = clamp(dot(ray.d, P.sunDir.xyz), -1.0, 1.0);
  // 体积光整体压暗，只在逆光方向形成可见光束
  let light = P.sunColor.rgb * P.sunDir.w
              * (0.08 + 0.35 * hgPhase(mu, 0.82));
  for (var i = 0; i < steps; i = i + 1) {
    let p = ray.o + ray.d * (f32(i) + 0.5) * stepLen;
    let dens = mistDensity(p);
    if (dens > 0.001) {
      let dtr = exp(-dens * stepLen);
      acc = acc + beam * (vec3f(1.0) - dtr) * light;
      beam = beam * dtr;
    }
  }
  *outAcc = acc;
  return beam;
}

// ---------- 镜头水滴 / 水膜（扭曲视线 uv，折射免费获得） ----------

struct LensResult {
  uv: vec2f,
  tint: vec3f,
};

// 镜头水滴：每个网格单元按 hash 概率生成，沾水量越大存活概率越高；
// 尺寸小、折射弱，高光仅在边缘一圈，避免全屏规则亮斑。
fn lensDroplet(uvIn: vec2f) -> LensResult {
  let t = P.camPos.w;
  var uv = uvIn;
  var tint = vec3f(0.0);
  let N = 7.0;
  let grid = floor(uvIn * N);
  let h1 = hash31(vec3f(grid, 7.7));
  let h2 = hash31(vec3f(grid, 13.1));
  let h3 = hash31(vec3f(grid, 21.4));
  // 存活阈值：沾水量 0.45 时仅约 30% 单元有水滴
  let alive = step(1.0 - P.fx.z * 0.7, h3);
  if (alive > 0.5) {
    let center = (grid + vec2f(h1, h2) * 0.65 + 0.18) / N;
    let toC = uvIn - center;
    let r = (0.006 + 0.016 * h1) / N * 2.2;
    let dd = length(toC);
    if (dd < r) {
      let q = dd / r;
      let bend = (1.0 - q * q) * 0.006 * P.fx.z;
      uv = uvIn + normalize(toC + vec2f(1e-5)) * bend;
      // 边缘亮环 + 内部极轻微变暗
      let ring = smoothstep(r * 0.75, r, dd) * (1.0 - smoothstep(r, r * 1.06, dd));
      tint = (vec3f(0.85, 0.93, 1.0) * ring * 0.35 - vec3f(0.03) * (1.0 - q)) * P.fx.z;
    }
  }
  // 全画面水膜的缓慢流动畸变（很弱）
  let film = (fbm3(vec3f(uvIn * 6.0, t * 0.25)) - 0.5) * 0.0022 * P.fx.z;
  uv = uv + vec2f(film, film * 0.6);
  return LensResult(uv, tint);
}

// ---------- ACES + sRGB ----------

fn aces(x: vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}

fn linearToSrgb(c: f32) -> f32 {
  return select(1.055 * pow(c, 0.41666) - 0.055, 12.92 * c, c <= 0.0031308);
}

// ---------- 主入口 ----------

@vertex
fn mainVS(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var pos = array<vec2f, 3>(
    vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0)
  );
  return vec4f(pos[vi], 0.0, 1.0);
}

@fragment
fn mainFS(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let ndc = vec2f(
    (frag.x / P.resolution.x) * 2.0 - 1.0,
    1.0 - (frag.y / P.resolution.y) * 2.0
  );
  let uv0 = ndc * vec2f(0.5, -0.5) + vec2f(0.5);
  let lens = lensDroplet(uv0);
  let uv = lens.uv;
  let ray = makeRay(vec2f(ndc.x, -ndc.y));

  let hit = traceScene(ray);
  var sceneCol = skyColor(ray.d);
  var sceneDist = 80.0;
  if (hit.ok) {
    sceneDist = hit.dist;
    if (hit.mat == MAT_BARREL) {
      sceneCol = shadeBarrel(hit, ray);
    } else if (hit.mat == MAT_CURTAIN) {
      sceneCol = shadeCurtain(hit, ray);
    } else if (hit.mat == MAT_WATER) {
      sceneCol = shadeWater(hit, ray);
    } else {
      sceneCol = shadeSurfer(hit, ray);
    }
  }

  // 调试视图（跳过后期，直接线性输出后仅做 sRGB）
  if (P.dbg.x > 0.5) {
    var dbgCol = vec3f(0.02, 0.02, 0.02);
    if (P.dbg.x < 1.5) {
      // 材质 ID：浪壁按角度渐变（浪脚绿→浪唇紫）/ 水帘黄 / 水面蓝 / 冲浪者红 / 无命中黑
      if (hit.mat == MAT_BARREL) {
        let q = angle01(hit.theta);
        dbgCol = mix(vec3f(0.0, 0.9, 0.2), vec3f(0.75, 0.1, 0.95), q);
      }
      if (hit.mat == MAT_CURTAIN) { dbgCol = vec3f(1.0, 0.85, 0.1); }
      if (hit.mat == MAT_WATER) { dbgCol = vec3f(0.2, 0.45, 1.0); }
      if (hit.mat == MAT_SURFER) { dbgCol = vec3f(1.0, 0.2, 0.2); }
    }
    if (P.dbg.x >= 1.5 && P.dbg.x < 2.5) {
      if (hit.ok) { dbgCol = hit.n * 0.5 + 0.5; }
    }
    if (P.dbg.x >= 2.5 && P.dbg.x < 3.5) {
      if (hit.ok) {
        // 厚度热力：0.03m..4m 对数映射
        let tn = clamp(log(max(hit.thickness, 0.01) / 0.03) / log(4.0 / 0.03), 0.0, 1.0);
        dbgCol = vec3f(tn, 0.8 * (1.0 - abs(tn - 0.5) * 2.0), 1.0 - tn);
      }
    }
    if (P.dbg.x >= 3.5) {
      dbgCol = skyColor(ray.d);
    }
    // 5：浪壁原始 Beer–Lambert 透射（无反射/泡沫/后期）
    if (P.dbg.x >= 4.5 && P.dbg.x < 5.5) {
      if (hit.mat == MAT_BARREL || hit.mat == MAT_CURTAIN) {
        dbgCol = exp(-(P.absorb.rgb + vec3f(P.scatter.w)) * hit.thickness);
      } else if (hit.ok) {
        dbgCol = vec3f(0.1, 0.1, 0.1);
      } else {
        dbgCol = vec3f(0.0, 0.0, 0.0);
      }
    }
    // 6：浪壁厚度可视化（线性，红=厚 蓝=薄），并在 G 通道放 trans 亮度
    if (P.dbg.x >= 5.5 && P.dbg.x < 6.5) {
      if (hit.mat == MAT_BARREL) {
        let tr = exp(-(P.absorb.rgb + vec3f(P.scatter.w)) * hit.thickness);
        let tn = clamp(hit.thickness / P.thickness.y, 0.0, 1.0);
        dbgCol = vec3f(tn, (tr.r + tr.g + tr.b) / 3.0, 1.0 - tn);
      } else {
        dbgCol = vec3f(0.05, 0.05, 0.05);
      }
    }
    let dOut = vec3f(linearToSrgb(clamp(dbgCol.r, 0.0, 1.0)),
                     linearToSrgb(clamp(dbgCol.g, 0.0, 1.0)),
                     linearToSrgb(clamp(dbgCol.b, 0.0, 1.0)));
    return vec4f(dOut, 1.0);
  }

  // 水雾体积光：累积散射 + 剩余透射率合成
  var mistAcc = vec3f(0.0);
  let beam = volumetric(ray, min(sceneDist, 60.0), &mistAcc);
  var col = sceneCol * beam + mistAcc;
  // 远景空气雾（指数衰减，仅对未命中或远距离像素轻微混入地平线色）
  if (!hit.ok) {
    let airFog = (1.0 - exp(-P.env.x * sceneDist)) * 0.25;
    col = mix(col, P.skyHorizon.rgb * 0.5, airFog);
  }

  // 镜头水滴高光与水膜
  col = col + lens.tint;

  // 曝光 → ACES → 暗角 → 颗粒 → sRGB
  col = col * P.env.y;
  col = aces(col);
  let vig = 1.0 - P.post.y * pow(length(ndc * vec2f(0.85, 1.0)), 2.4);
  col = col * vig;
  let grain = (hash31(vec3f(frag.xy, P.camPos.w * 97.0)) - 0.5) * P.post.x;
  col = col + vec3f(grain);
  col = clamp(col, vec3f(0.0), vec3f(1.0));
  let out3 = vec3f(linearToSrgb(col.r), linearToSrgb(col.g), linearToSrgb(col.b));
  return vec4f(out3, 1.0);
}
`;
