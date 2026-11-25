import { panel, slider } from '../controls';
import type { ParamStore } from '../../state/params';

/** 管浪镜头页：播放控制、分辨率、镜头沾水量等画面级参数。 */
export function buildShotPage(store: ParamStore): HTMLElement {
  const p = panel('管浪镜头', '10 秒管内 POV 运镜：深处低机位 → 沿浪脊推进 → 冲出洞口见亮光。');
  const g1 = document.createElement('div');
  g1.append(
    slider(store, { key: 'lensWater', label: '镜头沾水量（水滴/水膜）', min: 0, max: 1, step: 0.01 }),
    slider(store, { key: 'foamAmount', label: '泡沫总量', min: 0, max: 1, step: 0.01 }),
    slider(store, { key: 'mistAmount', label: '水雾总量（光束强度）', min: 0, max: 1, step: 0.01 }),
    slider(store, { key: 'curtainOpacity', label: '水帘不透明度', min: 0.2, max: 1, step: 0.01 }),
    slider(store, { key: 'exposure', label: '曝光', min: 0.5, max: 2.2, step: 0.01 }),
  );
  p.append(g1);
  return p;
}
