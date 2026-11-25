import { groupLabel, panel, slider } from '../controls';
import { WEATHER_PRESETS, type ParamStore } from '../../state/params';

/** 灯光天气页：太阳几何、照度、云量、雾、浑浊度 + 预设。 */
export function buildLightPage(store: ParamStore): HTMLElement {
  const p = panel('灯光天气', '太阳方向决定透光强度与水雾光束；浑浊度同时改变颗粒吸收与散射系数。');

  p.append(groupLabel('天气预设'));
  const grid = document.createElement('div');
  grid.className = 'preset-grid';
  const descs: Record<string, string> = {
    noon: '高色温硬光，浪壁通透',
    golden: '低角度暖光，金绿透光',
    backlit: '导演指定逆光，光束最强',
    overcast: '柔光低对比，雾感重',
  };
  for (const preset of WEATHER_PRESETS) {
    const card = document.createElement('button');
    card.className = 'preset-card';
    card.innerHTML = `<span class="pname">${preset.label}</span><span class="pdesc">${descs[preset.id]}</span>`;
    card.addEventListener('click', () => store.set(preset.patch));
    grid.append(card);
  }
  p.append(grid);

  p.append(groupLabel('太阳'));
  p.append(
    slider(store, { key: 'sunElevation', label: '太阳高度角 (°)', min: 2, max: 85, step: 0.5, unit: '°' }),
    slider(store, { key: 'sunAzimuth', label: '太阳方位角 (°)', min: -90, max: 90, step: 1, unit: '°' }),
    slider(store, { key: 'sunIntensity', label: '太阳照度（HDR）', min: 0.5, max: 8, step: 0.1 }),
  );

  p.append(groupLabel('大气与海水'));
  p.append(
    slider(store, { key: 'cloudCoverage', label: '云量', min: 0, max: 1, step: 0.01 }),
    slider(store, { key: 'fogDensity', label: '空气雾密度', min: 0, max: 0.08, step: 0.001, format: (v) => v.toFixed(3) }),
    slider(store, { key: 'turbidity', label: '海水浑浊度', min: 0, max: 1, step: 0.01 }),
  );

  p.append(groupLabel('动画'));
  p.append(slider(store, { key: 'timeScale', label: '浪流时间流速', min: 0, max: 2.5, step: 0.05 }));
  return p;
}
