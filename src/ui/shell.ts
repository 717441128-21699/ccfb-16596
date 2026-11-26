import type { PageId } from '../state/state';

const TABS: { id: PageId; label: string; icon: string }[] = [
  { id: 'shot', label: '管浪镜头', icon: '🎬' },
  { id: 'wave', label: '浪形参数', icon: '🌊' },
  { id: 'optics', label: '透光讲解', icon: '🔬' },
  { id: 'weather', label: '灯光天气', icon: '☀️' },
];

export class Shell {
  readonly root: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly pageHost: HTMLElement;
  readonly fpsBadge: HTMLElement;
  private tabButtons: HTMLButtonElement[] = [];
  onNavigate?: (page: PageId) => void;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'scene';
    const viewport = el('div', { class: 'viewport', dataset: { zone: 'viewport' } }, [this.canvas]);
    this.fpsBadge = el('div', { class: 'fps-badge', textContent: '— FPS' });
    viewport.append(this.fpsBadge);

    this.pageHost = el('div', { class: 'page-host' });
    const tabs = el(
      'nav',
      { class: 'tabs' },
      TABS.map((t) => {
        const b = el('button', { class: 'tab', dataset: { page: t.id } }, [el('span', { class: 'tab-icon', textContent: t.icon }), t.label]);
        b.addEventListener('click', () => this.navigate(t.id));
        this.tabButtons.push(b);
        return b;
      }),
    );
    const side = el('aside', { class: 'side' }, [el('div', { class: 'brand' }, [el('strong', {}, ['管浪预演系统']), el('small', {}, ['Barrel Wave Previs · WebGPU'])]), tabs, this.pageHost]);

    this.root = el('div', { class: 'app' }, [viewport, side]);
  }

  navigate(page: PageId): void {
    location.hash = page;
  }

  setActive(page: PageId): void {
    for (const b of this.tabButtons) b.classList.toggle('active', b.dataset.page === page);
  }

  mountPage(node: Node): void {
    this.pageHost.replaceChildren(node);
  }
}

export function currentHashPage(): PageId {
  const h = location.hash.replace('#', '') as PageId;
  return (['shot', 'wave', 'optics', 'weather'] as PageId[]).includes(h) ? h : 'shot';
}

// 本地辅助，避免 dom.ts 循环依赖
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string; dataset?: Record<string, string> } = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v as string;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else (node as unknown as Record<string, unknown>)[k] = v;
  }
  for (const c of children) node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return node;
}
