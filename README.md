# 管浪预演系统 · Barrel Wave Previs（WebGPU）

冲浪品牌广告镜头的电脑预演：在 WebGPU 中按**卷浪真实几何**绘制浪面、水帘、泡沫与水雾，
浪壁透光颜色严格按**海水吸收/散射系数**计算，模拟冲浪者从管浪里钻出的 10 秒第一人称镜头。

## 运行

```bash
npm install
npm run dev        # 开发服务器（自动打开浏览器）
npm run build      # 类型检查 + WGSL 静态校验 + 生产构建
npm run test       # 物理/几何单元测试（vitest，17 项）
npm run wgsl       # WGSL 着色器静态语义校验
npm run smoke      # 可选：Playwright headless 冒烟（需环境支持 WebGPU）
```

需要支持 WebGPU 的浏览器：Chrome/Edge 113+，或 Safari 18+（开启功能标志）。

## 四个页签

| 页签 | 内容 |
| --- | --- |
| 🎬 管浪镜头 | 10 秒第一人称电影镜头（管内→洞口）、4K 锁定、DRS、10 秒基准测试、镜头水滴/光束/粒子调节 |
| 🌊 浪形参数 | 卷管半径、浪面幂次、浪唇终点角、**浪脚/浪唇厚度**、剥离角、浪流速度、泡沫度，4 种浪型预设 |
| 🔬 透光讲解 | Beer–Lambert 公式、Jerlov 水型光谱表、厚度扫描曲线（光谱积分 vs shader 模型）、**薄/厚亮度比验收指标**、GPU HDR 目标读回实测 |
| ☀️ 灯光天气 | 太阳方位/高度/照度、浑浊度、雾、云、光束强度、7 种 Jerlov 水型，5 种天气预设 |

## 渲染架构（全部在 WebGPU/WGSL 内完成）

```
浪面（参数化卷浪，厚度 Beer–Lambert 透光 + 菲涅尔 + 拉条泡沫）
海面（Gerstner 涌浪 + 太阳闪光 + 水帘落点泡沫带）
水帘（弹道薄水片，厚度递减 + 边缘碎裂白沫，alpha 混合）
水雾（compute 粒子：浪唇喷溅 + 落点冲击两类发射器，billboard 加色混合）
   ↓ HDR 场景 target (rgba16float) + depth
亮部提取(1/4) → 双向高斯 bloom → 径向光束(1/2，depth 遮蔽)
   → 合成：ACES 色调映射 + 程序化镜头水滴（折射 + 菲涅尔亮环）+ 暗角
```

## 物理模型（验收指标 1）

**直接光 Beer–Lambert**：`T(λ,d) = exp(−c(λ)·d)`，`c = a + b`

- 吸收 `a(λ)`：纯水（Smith & Baker）+ CDOM 指数衰减 + 颗粒吸收
- 散射 `b(λ)`：`b(500)·(500/λ)^4.3` 幂律，后向散射比按水型给定
- 在 380–700nm 取 17 个波段，用 CIE 1931 配色函数 + D65 光谱积分到 XYZ→线性 sRGB
- 拟合出每通道等效衰减常数 `σ_RGB` 送入 WGSL：`T_c(d) = exp(−σ_c·d)`
- **浪唇最薄/最厚亮度比**满足恒等式 `Y(dMin)/Y(dMax) = exp(σ_Y·(dMax−dMin))`，
  讲解页同时给出全光谱积分值、单指数模型值（两者偏差 <8%）与 GPU HDR 读回实测值。

红光 σ 远大于蓝/绿（见天气页光学常数），所以厚浪壁呈深蓝绿、薄浪唇被阳光打亮泛绿白——
与导演描述的"管浪里面是绿蓝色透光"一致。

## 性能（验收指标 2）

- 内部渲染目标锁定 **3840×2160 (4K)**；光束半分辨率、bloom 1/4 分辨率金字塔
- 浪面 160×160 参数网格（约 5 万三角形），粒子上限 12000，单次全屏后期 4 个 pass
- DRS 动态分辨率（非锁定模式按帧时间 EMA 在 55%–100% 间调节）
- 镜头页内置 **10 秒 4K 基准测试**：输出平均 FPS、帧时间、低于 60 帧的掉帧计数与判定

> 注：4K60 的实测帧率取决于本机 GPU（目标硬件为 RTX 4060 级别及以上独显）。
> 无独显/远程桌面环境会自动通过 DRS 降分辨率保流畅。

## 目录结构

```
src/
  physics/   optics.ts（光谱/CIE/Beer-Lambert 拟合）  wave.ts（卷浪剖面/弹道，与 WGSL 逐式一致）
  shaders/   common/wave/ocean/curtain/particles/godrays/bloom/bright/composite/fullscreen .wgsl
  render/    device / shaderPreprocess / uniforms / meshes / renderer / camera / engine
  state/     响应式 store、浪型与天气预设
  ui/        类型化 DOM 四个页签
tests/       vitest 物理几何测试、WGSL 静态校验、Playwright 冒烟
```
