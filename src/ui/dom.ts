/** 类型化 DOM 构建小工具（无框架，保持依赖最小） */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string; dataset?: Record<string, string> } = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v as string;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else (node as unknown as Record<string, unknown>)[k] = v;
  }
  for (const c of children) {
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export interface SliderOpts {
  min: number;
  max: number;
  step: number;
  value: number;
  unit?: string;
  format?: (v: number) => string;
}

/** 带数值标签的滑杆 */
export function slider(label: string, opts: SliderOpts, onInput: (v: number) => void): HTMLDivElement {
  const valueText = el('span', { class: 'sv', textContent: opts.format ? opts.format(opts.value) : `${opts.value}${opts.unit ?? ''}` });
  const input = el('input', {
    type: 'range',
    min: String(opts.min),
    max: String(opts.max),
    step: String(opts.step),
    value: String(opts.value),
  }) as HTMLInputElement;
  input.addEventListener('input', () => {
    const v = Number(input.value);
    valueText.textContent = opts.format ? opts.format(v) : `${v}${opts.unit ?? ''}`;
    onInput(v);
  });
  return el('div', { class: 'ctrl' }, [el('label', {}, [label, valueText]), input]);
}

export function select(label: string, options: { value: string; text: string }[], current: string, onChange: (v: string) => void): HTMLDivElement {
  const sel = el('select', {}) as HTMLSelectElement;
  for (const o of options) sel.append(new Option(o.text, o.value, o.value === current, o.value === current));
  sel.addEventListener('change', () => onChange(sel.value));
  return el('div', { class: 'ctrl' }, [el('label', {}, [label]), sel]);
}

export function button(label: string, onClick: () => void, kind: 'default' | 'primary' = 'default'): HTMLButtonElement {
  const b = el('button', { class: kind === 'primary' ? 'btn primary' : 'btn', textContent: label });
  b.addEventListener('click', onClick);
  return b;
}

export function toggle(label: string, value: boolean, onChange: (v: boolean) => void): HTMLDivElement {
  const cb = el('input', { type: 'checkbox', checked: value }) as HTMLInputElement;
  cb.addEventListener('change', () => onChange(cb.checked));
  return el('div', { class: 'ctrl switch' }, [el('label', {}, [label]), cb]);
}

export function stat(label: string, value: string): HTMLDivElement {
  return el('div', { class: 'stat' }, [el('div', { class: 'stat-label', textContent: label }), el('div', { class: 'stat-value', textContent: value })]);
}
