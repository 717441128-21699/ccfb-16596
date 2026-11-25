/**
 * 10 秒管浪镜头运镜：相机在管内沿浪脊推进，从洞口冲出的 POV。
 * t ∈ [0,1] 对应 10 秒，帧率无关；外层按时间重映射循环。
 */

export interface CameraFrame {
  pos: [number, number, number];
  target: [number, number, number];
  fovY: number; // 弧度
}

export const SHOT_DURATION_S = 10;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * 镜头设计：
 *  0.0–0.25  管浪深处低机位，绿蓝色穹顶包住画面，洞口亮斑在前方
 *  0.25–0.7  沿浪脊推进，轻微手持起伏，浪唇水帘从画面右上方掠过
 *  0.7–1.0   加速冲出洞口，视野骤然变亮（曝光在 shader 内做柔和压缩）
 */
export function cameraAt(normalizedT: number, barrelRadius: number, barrelHeight: number): CameraFrame {
  const t = Math.max(0, Math.min(1, normalizedT));
  const R = barrelRadius;
  const h = barrelHeight;

  // 沿 z 轴从管内深处向洞口推进；洞口在 +z 尽头
  const z = -7.5 + 15.5 * smoothstep(0, 1, t);
  // 管内位置：弧心偏 -x（内壁侧）、与弧心大致同高，径向 0.4R，浪壁穹顶包裹画面；
  // 冲出段沿 +x 穿过浪唇开口移动到弧面之外
  const exit = smoothstep(0.66, 1, t);
  const radialIn = 0.4 * R;
  const radialOut = 1.9 * R;
  const radial = radialIn + (radialOut - radialIn) * exit;
  const x = -radial + 0.05 * R * Math.sin(t * Math.PI * 2) * (1 - exit);
  const y = h - 0.02 * R + 0.3 * R * exit + 0.03 * R * Math.sin(t * Math.PI * 5);

  // 注视点：管内水平看向 +z 洞口亮光，末端抬头见天空
  const lookZ = z + 7.0;
  const lookX = 0.15 * R + 1.4 * R * exit;
  const lookY = h + 0.02 * R + 0.45 * R * exit;

  // 起始稍广的广角增强包裹感，冲出时微收
  const fovY = (80 - 10 * exit) * (Math.PI / 180);

  return {
    pos: [x, y, z],
    target: [lookX, lookY, lookZ],
    fovY,
  };
}

/** 冲浪者剪影位置：相机前下方贴浪面，随镜头冲出洞口。 */
export function surferAt(normalizedT: number, barrelRadius: number, barrelHeight: number) {
  const t = Math.max(0, Math.min(1, normalizedT));
  const exit = smoothstep(0.6, 1, t);
  // 始终在相机前方约 3.5m、低 0.7m，落在水面浪面上
  const camZ = -7.5 + 15.5 * smoothstep(0, 1, t);
  const z = camZ + 3.6;
  // 管内在 +x 侧浪面（浪脚附近），冲出后外移
  const x = (0.55 + 1.0 * exit) * barrelRadius;
  // 贴水面：水面在弧心下方约一个半径处
  const y = Math.max(0.3, barrelHeight - barrelRadius + 0.45) + 0.25 * exit;
  // 身体压弯角度：管内蹲压低、出口站直
  const lean = 0.45 * (1 - exit) + 0.12;
  return { pos: [x, y, z] as [number, number, number], lean, exit };
}
