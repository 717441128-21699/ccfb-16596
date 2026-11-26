import type { Store } from '../state/state';
import { WAVE_PRESETS } from '../physics/wave';
import { button, el, select, slider } from './dom';

export function wavePage(store: Store): HTMLElement {
  const s = store.get();
  const presets = select(
    '浪型预设',
    Object.entries(WAVE_PRESETS).map(([value, p]) => ({ value, text: p.label })),
    'reefBomb',
    (v) => store.update({ wave: { ...WAVE_PRESETS[v].params } }),
  );

  const w = s.wave;
  const sliders = el('div', { class: 'group' }, [
    slider('卷管半径 R', { min: 1.2, max: 5, step: 0.1, value: w.radius, unit: ' m' }, (v) => store.patchWave({ radius: v })),
    slider('浪面宽度', { min: 3, max: 12, step: 0.1, value: w.faceWidth, unit: ' m' }, (v) => store.patchWave({ faceWidth: v })),
    slider('浪面高度', { min: 2, max: 7, step: 0.1, value: w.faceHeight, unit: ' m' }, (v) => store.patchWave({ faceHeight: v })),
    slider('浪面凹度幂次', { min: 1.2, max: 3.2, step: 0.05, value: w.facePower }, (v) => store.patchWave({ facePower: v })),
    slider('浪面段比例', { min: 0.4, max: 0.7, step: 0.01, value: w.faceU }, (v) => store.patchWave({ faceU: v })),
    slider('浪唇终点角', {
      min: 2.6, max: 3.14, step: 0.01, value: w.lipAngle,
      format: (v) => `${((v * 180) / Math.PI).toFixed(0)}°`,
    }, (v) => store.patchWave({ lipAngle: v })),
    slider('浪脚厚度', { min: 1, max: 4, step: 0.05, value: w.tBase, unit: ' m' }, (v) => store.patchWave({ tBase: v })),
    slider('浪唇厚度', { min: 0.05, max: 0.4, step: 0.01, value: w.tLip, unit: ' m' }, (v) => store.patchWave({ tLip: v })),
    slider('浪长（挤出）', { min: 40, max: 140, step: 2, value: w.length, unit: ' m' }, (v) => store.patchWave({ length: v })),
    slider('剥离角', {
      min: 0.1, max: 1.0, step: 0.02, value: w.peelAngle,
      format: (v) => `${((v * 180) / Math.PI).toFixed(0)}°`,
    }, (v) => store.patchWave({ peelAngle: v })),
    slider('浪流速度', { min: 2, max: 12, step: 0.1, value: w.flowSpeed, unit: ' m/s' }, (v) => store.patchWave({ flowSpeed: v })),
    slider('泡沫覆盖度', { min: 0, max: 1, step: 0.02, value: w.foamAmount, format: (v) => `${Math.round(v * 100)}%` }, (v) =>
      store.patchWave({ foamAmount: v }),
    ),
  ]);

  const hint = el('p', {
    class: 'hint',
    textContent: '提示：浪唇厚度与浪脚厚度的比值决定透光亮度跨度；具体理论比值见「透光讲解」页。环绕查看：画布上拖拽旋转、滚轮缩放。',
  });

  return el('div', { class: 'page' }, [
    el('h2', {}, ['浪形参数']),
    el('div', { class: 'group' }, [presets, el('div', { class: 'btn-row' }, [
      button('恢复默认浪型', () => store.update({ wave: { ...WAVE_PRESETS.reefBomb.params } })),
    ])]),
    sliders,
    hint,
  ]);
}
