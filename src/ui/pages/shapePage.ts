import { groupLabel, panel, slider } from '../controls';
import type { ParamStore } from '../../state/params';

/** 浪形参数页：卷浪几何、厚度场、水帘弹道、泡沫拉伸。 */
export function buildShapePage(store: ParamStore): HTMLElement {
  const p = panel('浪形参数', '按卷浪几何建模：圆柱弧面 + 抛物线水帘，浪面厚度由浪脚到浪唇指数变薄。');

  p.append(groupLabel('卷浪几何'));
  p.append(
    slider(store, { key: 'barrelRadius', label: '管浪半径 R (m)', min: 1.2, max: 4.5, step: 0.05 }),
    slider(store, { key: 'barrelHeight', label: '弧心高度 h (m)', min: 1.2, max: 3.6, step: 0.05 }),
    slider(store, { key: 'arcAngle', label: '浪墙包角 (rad)', min: 2.6, max: 4.4, step: 0.02 }),
    slider(store, { key: 'crestHalfLength', label: '浪脊半长 (m)', min: 12, max: 60, step: 1 }),
    slider(store, { key: 'lipAngle', label: '浪唇抛射角偏置 (rad)', min: -0.4, max: 0.4, step: 0.01 }),
  );

  p.append(groupLabel('厚度场（决定透光颜色）'));
  p.append(
    slider(store, { key: 'thicknessMin', label: '浪唇最薄厚度 dMin (m)', min: 0.01, max: 0.2, step: 0.005, format: (v) => `${(v * 100).toFixed(1)} cm` }),
    slider(store, { key: 'thicknessMax', label: '浪脚最厚厚度 dMax (m)', min: 1.0, max: 6.0, step: 0.1 }),
    slider(store, { key: 'thicknessFalloff', label: '厚度衰减指数', min: 0.8, max: 4.0, step: 0.05 }),
  );

  p.append(groupLabel('表面涟漪'));
  p.append(
    slider(store, { key: 'rippleAmp', label: '涟漪幅度 (m)', min: 0, max: 0.35, step: 0.01 }),
    slider(store, { key: 'rippleScale', label: '涟漪空间频率', min: 0.1, max: 1.5, step: 0.02 }),
  );

  p.append(groupLabel('水帘弹道'));
  p.append(
    slider(store, { key: 'jetVx', label: '抛射水平速度 (m/s)', min: 1.0, max: 7.0, step: 0.1 }),
    slider(store, { key: 'jetVy', label: '抛射垂直速度 (m/s)', min: 0.5, max: 6.0, step: 0.1 }),
    slider(store, { key: 'gravity', label: '重力（艺术化）', min: 2.0, max: 9.8, step: 0.1 }),
    slider(store, { key: 'curtainWidth', label: '水帘厚度 (m)', min: 0.08, max: 0.8, step: 0.02 }),
  );

  p.append(groupLabel('泡沫'));
  p.append(
    slider(store, { key: 'foamStretch', label: '白条流向拉伸倍数', min: 1, max: 12, step: 0.2 }),
    slider(store, { key: 'surfaceRoughness', label: '浪面微表面粗糙度', min: 0.02, max: 0.6, step: 0.01 }),
  );

  const btnRow = document.createElement('div');
  btnRow.className = 'btn-row';
  const reset = document.createElement('button');
  reset.className = 'ui-btn';
  reset.textContent = '恢复默认浪形';
  reset.addEventListener('click', () => store.reset());
  btnRow.append(reset);
  p.append(btnRow);

  p.append(groupLabel('调试视图'));
  const debugSel = document.createElement('select');
  debugSel.className = 'res-select';
  debugSel.style.width = '100%';
  const debugModes: Array<[number, string]> = [
    [0, '正常渲染'],
    [1, '材质 ID'],
    [2, '法线'],
    [3, '厚度热力'],
    [4, '天空'],
    [5, 'Beer–Lambert 透射'],
    [6, '厚度/透射分量'],
  ];
  for (const [v, label] of debugModes) {
    const opt = document.createElement('option');
    opt.value = String(v);
    opt.textContent = label;
    debugSel.append(opt);
  }
  debugSel.value = String(store.get().debugView);
  debugSel.addEventListener('change', () => store.set({ debugView: parseInt(debugSel.value, 10) }));
  store.subscribe((sp) => {
    if (parseInt(debugSel.value, 10) !== sp.debugView) debugSel.value = String(sp.debugView);
  });
  p.append(debugSel);

  return p;
}
