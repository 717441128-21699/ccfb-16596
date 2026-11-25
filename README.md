# 管浪广告预演 · WebGPU Barrel Wave Previz

冲浪品牌广告镜头预演：在浏览器里按**卷浪几何**与**海水吸收/散射物理**实时渲染管浪内部视角。
浪面、水帘、泡沫、水雾全部在 WebGPU/WGSL 中用解析几何 + 程序化噪声绘制，界面用 TypeScript。

## 运行

```bash
npm install
npm run dev        # 开发服务器（默认 http://127.0.0.1:5173）
npm run build      # 类型检查 + 生产构建
npm run preview    # 预览构建产物
```

需要支持 WebGPU 的浏览器（Chrome / Edge 113+）。

## 四个页面

| 页签 | 内容 |
| --- | --- |
| 管浪镜头 | 10 秒管内 POV 运镜（深处低机位 → 沿浪脊推进 → 冲出洞口见亮光），镜头沾水/泡沫/水雾/曝光控制，分辨率切换与时间轴 |
| 浪形参数 | 卷浪几何（半径、包角、浪脊长度）、厚度场（dMin/dMax/衰减指数）、涟漪、水帘弹道、泡沫拉伸，含调试视图下拉 |
| 透光讲解 | Beer–Lambert 公式、Pope & Fry 1997 吸收系数表、透射率-厚度曲线、**GPU 读回 vs 理论值校验**、最薄/最厚亮度比 |
| 灯光天气 | 太阳高度/方位/照度、云量、雾、海水浑浊度，四个天气预设（正午/黄金时刻/逆光/阴天） |

## 物理模型

- **吸收**：Pope & Fry (1997) 纯水吸收光谱，取 615/550/465nm 三个代表波长压成 RGB 三通道吸收系数；浑浊度叠加颗粒吸收项。
- **厚度透射**：每通道 `T_c(d) = exp(-(a_c + a_particle)·d)`，浪面厚度由浪脚 dMax 到浪唇 dMin 指数变薄。
- **内散射**：单次散射 `b/(a+b)·(1-exp(-(a+b)d))`，Henyey–Greenstein 相位（g=0.82 强前向，逆光出光束）。
- CPU（`src/physics/waterOptics.ts`）与 WGSL 共用同一组系数，uniform 注入，杜绝两边不一致。

### 亮度比一致性

透光讲解页可一键运行 GPU 读回校验：用独立校验管线把 N 个厚度阶梯的 Beer–Lambert 结果渲染到离屏纹理再读回，与 CPU 理论值逐通道比较。当前默认参数（dMin=0.03m, dMax=3.2m）：

- 理论最薄/最厚亮度比：R 2.5× · G 1.3× · B 1.1×（等权亮度 1.4×）
- GPU vs 理论最大相对误差 < 0.4%（剩余为 RGBA8 的 1/255 量化误差）

## 性能

全屏一个全屏三角形 + 解析求交（管浪圆柱面 / 抛物线水帘 / 水面 / SDF 冲浪者），无网格、无纹理、无全屏后处理 pass，单 pass 出图。

HUD 用 WebGPU **timestamp-query** 直接量渲染通道 GPU 帧时（与 rAF/vsync 节流无关），4K60 门槛是 ≤16.67 ms。
在 RTX 4060 Laptop（D3D11 后端）实测 4K GPU 帧时约 **13.5 ms**，rAF 67–75 FPS，满足 10 秒镜头 4K ≥ 60 帧。

> 双显卡笔记本无头 Chrome 默认可能选核显。让浏览器/Chrome 走独显：Windows「设置 → 系统 → 显示 → 图形」把 Chrome 设为"高性能"，或注册表
> `HKCU\Software\Microsoft\DirectX\UserGpuPreferences` 下为 chrome.exe 加 `GpuPreference=2;`。

## 代码结构

```
src/
  physics/waterOptics.ts   海水吸收/散射物理（CPU 侧事实来源）
  state/params.ts          全部可调参数 + uniform 槽位布局 + 天气预设
  render/
    camera.ts              10s 运镜路径 + 冲浪者位置
    uniformBuilder.ts      参数 → 与 WGSL 对齐的 Float32Array
    renderer.ts            WebGPU 设备/管线/帧循环/透光校验/GPU 计时
  shaders/
    common.wgsl.ts         Params 结构、噪声、相机射线、天空
    scene.wgsl.ts          管浪/水帘/水面/冲浪者解析求交
    shading.wgsl.ts        Beer–Lambert 透光、泡沫、水雾体积光、镜头水滴、ACES
    validation.wgsl.ts     透光校验离屏管线
  ui/                      DOM 控件与四个页面
scripts/smoke.mjs          puppeteer 无头冒烟：错误采集/页签/校验/多分辨率/GPU 帧时
```
