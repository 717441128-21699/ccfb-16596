/**
 * 海水光学物理常数与函数（CPU 侧）。
 *
 * 数据来源：
 *  - Pope, R. M. & Fry, E. S. (1997), "Absorption spectrum (380–700 nm) of
 *    pure water. II. Integrating cavity measurements", Applied Optics 36(33).
 *    —— 纯水吸收系数（单位 m^-1），清澈热带海水在可见光段接近纯水。
 *  - Smith, R. C. & Baker, K. S. (1981) 作为浑浊度参考。
 *  - Morel, A. (1974) 海水分子散射，b(λ) ≈ b(550)·(550/λ)^4.32。
 *
 * 本模块是 CPU 与 WGSL 之间唯一的物理事实来源：shader 里的常数由
 * opticsToUniforms() 注入，UI 里的理论曲线也从这里计算，避免两边不一致。
 */

/** Pope & Fry 1997 纯水吸收系数采样点 [波长 nm, 吸收 m^-1]。 */
export const PURE_WATER_ABSORPTION: ReadonlyArray<readonly [number, number]> = [
  [380, 0.0220],
  [390, 0.0191],
  [400, 0.0171],
  [410, 0.0162],
  [420, 0.0153],
  [430, 0.0144],
  [440, 0.0145],
  [450, 0.0155],
  [460, 0.0167],
  [470, 0.0186],
  [480, 0.0218],
  [490, 0.0275],
  [500, 0.0355],
  [510, 0.0465],
  [520, 0.0557],
  [530, 0.0630],
  [540, 0.0693],
  [550, 0.0752],
  [560, 0.0844],
  [570, 0.0968],
  [580, 0.1110],
  [590, 0.1310],
  [600, 0.2070],
  [610, 0.2650],
  [620, 0.3100],
  [630, 0.3350],
  [640, 0.3500],
  [650, 0.4100],
  [660, 0.4290],
  [670, 0.4570],
  [680, 0.5110],
  [690, 0.5860],
  [700, 0.6500],
  [720, 1.1690],
  [740, 2.0080],
  [760, 2.6780],
  [780, 2.1920],
  [800, 2.0750],
];

/** sRGB 三原色主波长（CIE 单色等效波长，用于把光谱表压成 RGB 三通道）。 */
export const RGB_WAVELENGTHS = { r: 615, g: 550, b: 465 } as const;

/** 线性插值取吸收系数。 */
export function absorptionAt(nm: number): number {
  const table = PURE_WATER_ABSORPTION;
  if (nm <= table[0][0]) return table[0][1];
  const last = table[table.length - 1];
  if (nm >= last[0]) return last[1];
  for (let i = 1; i < table.length; i++) {
    const [n1, a1] = table[i];
    if (nm <= n1) {
      const [n0, a0] = table[i - 1];
      const t = (nm - n0) / (n1 - n0);
      return a0 + (a1 - a0) * t;
    }
  }
  return last[1];
}

/**
 * 三通道吸收系数（m^-1）。
 * 选用主波长等效：红 615nm、绿 550nm、蓝 465nm，是图形学中
 * "representative wavelength" 常用做法，数值可直接与光谱表对照。
 */
export function rgbAbsorption(): { r: number; g: number; b: number } {
  return {
    r: absorptionAt(RGB_WAVELENGTHS.r),
    g: absorptionAt(RGB_WAVELENGTHS.g),
    b: absorptionAt(RGB_WAVELENGTHS.b),
  };
}

/**
 * Morel 型分子散射（含少量颗粒散射），b(λ) = b550 · (550/λ)^4.32。
 * @param turbidity 0 = 清澈热带海水（b550 ≈ 0.0019 m^-1），1 = 近岸浑水
 */
export function rgbScattering(turbidity: number): { r: number; g: number; b: number } {
  const b550 = 0.0019 + 0.035 * Math.max(0, Math.min(1, turbidity));
  const power = 4.32;
  const b = (nm: number) => b550 * Math.pow(550 / nm, power);
  return {
    r: b(RGB_WAVELENGTHS.r),
    g: b(RGB_WAVELENGTHS.g),
    b: b(RGB_WAVELENGTHS.b),
  };
}

/** Beer–Lambert 单色透射率 T = exp(-a·d)。 */
export function transmittance(absorption: number, thicknessM: number): number {
  return Math.exp(-absorption * thicknessM);
}

/** RGB 透射（同时计入浑浊度带来的附加颗粒吸收，简化为均匀项）。 */
export function rgbTransmittance(
  thicknessM: number,
  absorb: { r: number; g: number; b: number },
  turbidity: number,
): { r: number; g: number; b: number } {
  const particleAbs = 0.06 * Math.max(0, Math.min(1, turbidity));
  const e = (a: number) => Math.exp(-(a + particleAbs) * thicknessM);
  return { r: e(absorb.r), g: e(absorb.g), b: e(absorb.b) };
}

/**
 * 理论亮度比：沿视线穿过水片的透射亮度（背光源为单位白光时）。
 * 最薄处 / 最厚处，分通道给出，同时给等权亮度比。
 */
export function thicknessBrightnessRatio(
  dMin: number,
  dMax: number,
  absorb: { r: number; g: number; b: number },
  turbidity: number,
): { perChannel: { r: number; g: number; b: number }; luminance: number } {
  const tMin = rgbTransmittance(dMin, absorb, turbidity);
  const tMax = rgbTransmittance(dMax, absorb, turbidity);
  const perChannel = {
    r: tMin.r / Math.max(tMax.r, 1e-6),
    g: tMin.g / Math.max(tMax.g, 1e-6),
    b: tMin.b / Math.max(tMax.b, 1e-6),
  };
  // Rec.709 线性亮度权重
  const lum = (t: { r: number; g: number; b: number }) => 0.2126 * t.r + 0.7152 * t.g + 0.0722 * t.b;
  return { perChannel, luminance: lum(tMin) / Math.max(lum(tMax), 1e-6) };
}

/** 透光讲解页曲线用：给定厚度区间，返回采样序列（厚度 m, RGB 透射 0..1）。 */
export function transmittanceCurve(
  dMin: number,
  dMax: number,
  samples: number,
  absorb: { r: number; g: number; b: number },
  turbidity: number,
): Array<{ d: number; r: number; g: number; b: number }> {
  const out: Array<{ d: number; r: number; g: number; b: number }> = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    // 对数厚度轴更贴合视觉
    const d = dMin * Math.pow(dMax / dMin, t);
    const rgb = rgbTransmittance(d, absorb, turbidity);
    out.push({ d, ...rgb });
  }
  return out;
}

/**
 * 内散射近似（单次散射、光源方向恒定）：
 * L_scatter = (b/(a+b)) · (1 - exp(-(a+b)·d)) · 相位项
 * 各通道独立计算。返回沿光路加到透射光上的散射光（单位与入射光一致）。
 */
export function rgbInScatter(
  thicknessM: number,
  absorb: { r: number; g: number; b: number },
  scatter: { r: number; g: number; b: number },
  phase: number,
): { r: number; g: number; b: number } {
  const ch = (a: number, b: number) => {
    const c = a + b;
    return (b / c) * (1 - Math.exp(-c * thicknessM)) * phase;
  };
  return {
    r: ch(absorb.r, scatter.r),
    g: ch(absorb.g, scatter.g),
    b: ch(absorb.b, scatter.b),
  };
}
