import type { Store } from '../state/state';
import { WEATHER_PRESETS } from '../state/state';
import { WATER_TYPES } from '../physics/optics';
import type { Engine } from '../render/engine';
import { button, el, select, slider, stat } from './dom';

export function weatherPage(store: Store, engine: Engine): HTMLElement {
  const s = store.get();
  const w = s.weather;

  const presets = select(
    '天气/灯光预设',
    Object.entries(WEATHER_PRESETS).map(([value, p]) => ({ value, text: p.label })),
    'goldenHour',
    (v) => {
      store.update({ weather: { ...WEATHER_PRESETS[v].params } });
      engine.refreshOptics();
      rerender();
    },
  );

  const water = select(
    '海水类型（Jerlov）',
    WATER_TYPES.map((t) => ({ value: t.id, text: t.label })),
    w.waterTypeId,
    (v) => {
      store.patchWeather({ waterTypeId: v });
      engine.refreshOptics();
      rerender();
    },
  );

  const sunGroup = el('div', { class: 'group' }, [
    slider('太阳方位角', {
      min: -0.8, max: 0.8, step: 0.01, value: w.sunAzimuth,
      format: (v) => `${((v * 180) / Math.PI).toFixed(0)}°（0=洞口背光）`,
    }, (v) => store.patchWeather({ sunAzimuth: v })),
    slider('太阳高度角', {
      min: 0.04, max: 1.45, step: 0.01, value: w.sunElevation,
      format: (v) => `${((v * 180) / Math.PI).toFixed(0)}°`,
    }, (v) => store.patchWeather({ sunElevation: v })),
    slider('太阳照度', { min: 0.5, max: 9, step: 0.1, value: w.sunIntensity }, (v) => store.patchWeather({ sunIntensity: v })),
    slider('环境光', { min: 0.1, max: 1.6, step: 0.02, value: w.ambientIntensity }, (v) =>
      store.patchWeather({ ambientIntensity: v }),
    ),
  ]);

  const skyGroup = el('div', { class: 'group' }, [
    slider('大气浑浊度', { min: 1, max: 10, step: 0.1, value: w.turbidity }, (v) => store.patchWeather({ turbidity: v })),
    slider('海面雾浓度', { min: 0, max: 1, step: 0.02, value: w.fog, format: (v) => `${Math.round(v * 100)}%` }, (v) =>
      store.patchWeather({ fog: v }),
    ),
    slider('云量', { min: 0, max: 1, step: 0.02, value: w.cloudiness, format: (v) => `${Math.round(v * 100)}%` }, (v) =>
      store.patchWeather({ cloudiness: v }),
    ),
    slider('光束强度', { min: 0, max: 2.5, step: 0.05, value: s.godRayStrength }, (v) => store.update({ godRayStrength: v })),
  ]);

  const o = engine.getOptics();
  const stats = el('div', { class: 'stats' }, [
    stat('红光衰减 σ_R', `${o.sigmaRGB[0].toFixed(3)} /m`),
    stat('绿光衰减 σ_G', `${o.sigmaRGB[1].toFixed(3)} /m`),
    stat('蓝光衰减 σ_B', `${o.sigmaRGB[2].toFixed(3)} /m`),
    stat('亮度衰减 σ_Y', `${o.sigmaLum.toFixed(3)} /m`),
  ]);

  const host = el('div', { class: 'page' }, [
    el('h2', {}, ['灯光与天气']),
    el('div', { class: 'group' }, [presets, water, el('div', { class: 'btn-row' }, [
      button('恢复黄金时刻', () => {
        store.update({ weather: { ...WEATHER_PRESETS.goldenHour.params } });
        engine.refreshOptics();
        rerender();
      }),
    ])]),
    el('h3', {}, ['太阳']),
    sunGroup,
    el('h3', {}, ['大气']),
    skyGroup,
    el('h3', {}, ['当前水体光学常数']),
    stats,
  ]);

  function rerender(): void {
    host.replaceWith(weatherPage(store, engine));
  }
  return host;
}
