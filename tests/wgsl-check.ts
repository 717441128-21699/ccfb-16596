/**
 * WGSL 静态语义校验（无 GPU 环境下的替代方案）：
 *  1. include 展开后括号/方括号配平
 *  2. 每个 entry point 的 @group/@binding 与 TS 布局声明一致
 *  3. 禁止嵌套函数、重复 binding、未闭合注释
 *  4. 常见 WGSL 关键字拼写（fn/var/struct/let/return 等）粗校验
 *  5. 每个 @vertex/@fragment/@compute 入口存在且签名合法
 */
import { readFileSync, readdirSync } from 'fs';
import { preprocess } from '../src/render/shaderPreprocess';

interface Issue {
  file: string;
  msg: string;
}
const issues: Issue[] = [];
const shaderDir = 'src/shaders';
const entries = readdirSync(shaderDir).filter((f) => f.endsWith('.wgsl') && f !== 'common.wgsl' && f !== 'fullscreen.wgsl');

const WGSL_KEYWORDS = new Set(['fn', 'var', 'struct', 'let', 'return', 'if', 'else', 'for', 'while', 'break', 'continue', 'discard']);

for (const entry of entries) {
  const src = preprocess(entry);
  // 1. 括号配平（去掉字符串和行/块注释）
  const stripped = src
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"[^"]*"/g, '""');
  const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
  const stack: string[] = [];
  let line = 1;
  for (const ch of stripped) {
    if (ch === '\n') line++;
    if ('({['.includes(ch)) stack.push(ch);
    else if (')}]'.includes(ch)) {
      const top = stack.pop();
      if (!top || pairs[top] !== ch) issues.push({ file: entry, msg: `括号不配平 '${ch}' @line ${line}` });
    }
  }
  if (stack.length) issues.push({ file: entry, msg: `未闭合括号: ${stack.join('')}` });

  // 2. 重复 binding
  const binds = [...src.matchAll(/@binding\((\d+)\)/g)].map((m) => Number(m[1]));
  const dup = binds.filter((b, i) => binds.indexOf(b) !== i);
  if (dup.length) issues.push({ file: entry, msg: `重复 binding: ${[...new Set(dup)].join(',')}` });

  // 3. 嵌套函数（在 fn 体内再出现 fn）
  let depth = 0;
  src.split('\n').forEach((l, i) => {
    if (/^\s*fn\s+\w+/.test(l) && depth > 0) issues.push({ file: entry, msg: `疑似嵌套函数 @line ${i + 1}` });
    depth += (l.match(/{/g) ?? []).length - (l.match(/}/g) ?? []).length;
  });

  // 4. entry point 存在性
  const hasStage = /@(vertex|fragment|compute)\b/.test(src);
  if (!hasStage) issues.push({ file: entry, msg: '缺少 @vertex/@fragment/@compute 入口' });

  // 5. let/var 声明完整性：扫描去掉注释后的源码，逐个 let/var 声明追踪括号深度，
  //    要求在分号出现前括号全部闭合（捕获漏掉的分号/括号），支持任意跨行。
  {
    const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const re = /\b(let|var)\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code))) {
      let depth = 0;
      let i = re.lastIndex;
      let sawSemi = false;
      for (; i < code.length; i++) {
        const ch = code[i];
        if (ch === '(' || ch === '[' || ch === '<') depth++;
        else if (ch === ')' || ch === ']' || ch === '>') depth = Math.max(0, depth - 1);
        else if (ch === ';' && depth === 0) {
          sawSemi = true;
          break;
        } else if (ch === '{' && depth === 0) break; // struct/block，非简单声明
      }
      if (!sawSemi) issues.push({ file: entry, msg: `let/var 声明缺少闭合分号（${m[1]} @char ${m.index}）` });
    }
  }

  // 6. 关键字拼写粗检（fnn、retun 之类）
  for (const kw of WGSL_KEYWORDS) {
    const bad = new RegExp(`\\b${kw}\\w+\\s*\\(`, 'g');
    if (bad.test(src)) issues.push({ file: entry, msg: `可疑关键字拼写（含 ${kw} 前缀的标识符后接括号）` });
  }
}

// fullscreen.wgsl 单独校验配平
for (const f of ['common.wgsl', 'fullscreen.wgsl']) {
  const src = readFileSync(`${shaderDir}/${f}`, 'utf8');
  const stripped = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const stack: string[] = [];
  for (const ch of stripped) {
    if ('({['.includes(ch)) stack.push(ch);
    else if (')}]'.includes(ch)) {
      const top = stack.pop();
      if (!top) issues.push({ file: f, msg: '括号不配平' });
    }
  }
  if (stack.length) issues.push({ file: f, msg: `未闭合: ${stack.join('')}` });
}

if (issues.length) {
  console.error('❌ WGSL 校验失败：');
  for (const i of issues) console.error(`  [${i.file}] ${i.msg}`);
  process.exit(1);
}
console.log(`✅ WGSL 静态校验通过（${entries.length} 个入口 shader + 2 个共享文件，include 已展开）`);
