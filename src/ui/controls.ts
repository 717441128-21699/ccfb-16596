import type { WaveParams } from '../state/params';
import type { ParamStore } from '../state/params';

type Key = keyof WaveParams;

export interface SliderSpec {
  key: Key;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
  format?: (v: number) => string;
}

export function slider(store: ParamStore, spec: SliderSpec): HTMLElement {
  const row = document.createElement('div');
  row.className = 'slider-row';
  const meta = document.createElement('div');
  meta.className = 'slider-meta';
  const lab = document.createElement('label');
  lab.textContent = spec.label;
  const val = document.createElement('span');
  val.className = 'val';
  const fmt = spec.format ?? ((v: number) => `${v.toFixed(spec.step < 0.01 ? 3 : spec.step < 1 ? 2 : 1)}${spec.unit ?? ''}`);
  val.textContent = fmt(store.get()[spec.key]);
  meta.append(lab, val);

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(spec.min);
  input.max = String(spec.max);
  input.step = String(spec.step);
  input.value = String(store.get()[spec.key]);
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    store.set({ [spec.key]: v } as Partial<WaveParams>);
    val.textContent = fmt(v);
  });
  // 外部参数变化（预设/重置）时回显
  store.subscribe((p) => {
    if (parseFloat(input.value) !== p[spec.key]) {
      input.value = String(p[spec.key]);
      val.textContent = fmt(p[spec.key]);
    }
  });

  row.append(meta, input);
  return row;
}

export function groupLabel(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'group-label';
  el.textContent = text;
  return el;
}

export function panel(title: string, subtitle: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'panel';
  const h = document.createElement('h2');
  h.textContent = title;
  const s = document.createElement('p');
  s.className = 'subtitle';
  s.textContent = subtitle;
  el.append(h, s);
  return el;
}
