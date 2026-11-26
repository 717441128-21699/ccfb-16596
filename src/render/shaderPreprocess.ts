/**
 * WGSL 预处理器：支持 #include "xxx.wgsl"
 * Vite 以 ?raw 导入所有 shader 源码，这里在 CPU 侧做一次文本展开，
 * 避免依赖第三方插件，且 include 只做一次（shader 模块缓存）。
 */
const cache = new Map<string, string>();

const rawModules = import.meta.glob('../shaders/*.wgsl', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function sourceOf(name: string): string {
  const key = `../shaders/${name}`;
  const src = rawModules[key];
  if (src === undefined) throw new Error(`shader 未找到: ${name}`);
  return src;
}

export function preprocess(entry: string): string {
  const seen = new Set<string>();
  const resolve = (name: string): string => {
    if (seen.has(name)) return ''; // 防重复包含
    seen.add(name);
    const lines = sourceOf(name).split('\n');
    const out: string[] = [];
    for (const line of lines) {
      const m = line.match(/^\s*#include\s+"([^"]+)"\s*$/);
      if (m) {
        out.push(resolve(m[1]));
      } else {
        out.push(line);
      }
    }
    return out.join('\n');
  };
  const key = `processed:${entry}`;
  let result = cache.get(key);
  if (!result) {
    result = resolve(entry);
    cache.set(key, result);
  }
  return result;
}
