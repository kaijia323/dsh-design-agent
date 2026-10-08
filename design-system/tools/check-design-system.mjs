#!/usr/bin/env node
/**
 * DSH 设计契约自检脚本（零依赖、离线可跑）
 *
 * 用法：
 *   node design-system/tools/check-design-system.mjs
 * 退出码：
 *   0 = 全部通过；1 = 有失败项（每项都会打印具体文件与原因）
 *
 * 这个脚本是"设计契约没被悄悄改坏"的客观证据，独立验收者可以直接跑它核对：
 *   1) 三套 token 预设的变量表完全一致，只是取值不同；
 *   2) 每个模板内联的 :root 与它声明的预设逐个变量一致（这是 AC 之外的设计红线）；
 *   3) 模板零外链、零 script、零图片、零渐变、零 emoji、零自创颜色；
 *   4) 字号只用 --text-*，内外边距只用 --space-*。
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readText = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const readJson = (rel) => JSON.parse(readText(rel));

const results = [];
function check(name, fn) {
  try {
    const detail = fn();
    results.push({ ok: true, name, detail: detail || '' });
  } catch (err) {
    results.push({ ok: false, name, detail: err.message });
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const list = (arr, n = 4) => arr.slice(0, n).join('、') + (arr.length > n ? ` 等 ${arr.length} 项` : '');

/* ── 冻结的变量表 ─────────────────────────────── */
const COLOR_VARS = [
  '--color-primary', '--color-primary-hover', '--color-primary-weak', '--color-on-primary',
  '--color-accent', '--color-accent-weak',
  '--color-bg', '--color-surface', '--color-surface-sunken',
  '--color-border', '--color-border-strong',
  '--color-text', '--color-text-muted', '--color-text-faint',
  '--color-success', '--color-warning', '--color-danger', '--color-focus',
];
const REQUIRED_VARS = [
  ...COLOR_VARS,
  '--font-display', '--font-body', '--font-mono',
  '--text-xs', '--text-sm', '--text-md', '--text-lg', '--text-xl', '--text-2xl', '--text-3xl', '--text-4xl',
  '--leading-tight', '--leading-snug', '--leading-normal', '--leading-relaxed',
  '--weight-regular', '--weight-medium', '--weight-semibold', '--weight-bold',
  '--space-0', '--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--space-7', '--space-8',
  '--radius-sm', '--radius-md', '--radius-lg', '--radius-full',
  '--shadow-sm', '--shadow-md', '--shadow-lg',
  '--layout-max', '--layout-gutter', '--control-h',
];
const BANNED_TEXT = ['Lorem', 'lorem ipsum', 'TODO', 'FIXME'];
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F000}-\u{1F2FF}]/u;
const CJK_RE = /[\u4e00-\u9fff]/;

/* ── 解析工具 ─────────────────────────────────── */
function rootBlock(css) {
  const m = css.match(/:root\s*\{([\s\S]*?)\}/);
  return m ? m[1] : null;
}
function parseDecls(block) {
  const out = [];
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m;
  while ((m = re.exec(block))) out.push([m[1], m[2].trim().replace(/\s+/g, ' ')]);
  return out;
}
const px = (v) => {
  const m = /^(-?[\d.]+)px$/.exec(v.trim());
  return m ? Number(m[1]) : NaN;
};

/* ── 1. token 预设 ────────────────────────────── */
let tokensIndex = null;
let presetDecls = new Map();
let presetCss = new Map();

check('tokens/index.json 结构完整（version / default / presets）', () => {
  tokensIndex = readJson('design-system/tokens/index.json');
  assert(tokensIndex.version === 1, 'version 必须是 1');
  assert(Array.isArray(tokensIndex.presets) && tokensIndex.presets.length === 3, 'presets 必须是 3 套');
  const ids = tokensIndex.presets.map((p) => p.id);
  assert(new Set(ids).size === ids.length, '预设 id 不能重复');
  assert(ids.includes(tokensIndex.default), `default=${tokensIndex.default} 必须存在于 presets`);
  for (const p of tokensIndex.presets) {
    for (const k of ['id', 'name', 'description', 'file', 'mode']) assert(typeof p[k] === 'string' && p[k], `${p.id}: 缺字段 ${k}`);
    assert(['light', 'dark'].includes(p.mode), `${p.id}: mode 必须是 light|dark`);
    for (const k of ['bg', 'surface', 'primary', 'accent', 'text']) assert(p.swatches?.[k], `${p.id}: 缺 swatches.${k}`);
    for (const k of ['display', 'body', 'mono']) assert(p.fonts?.[k], `${p.id}: 缺 fonts.${k}`);
    for (const k of ['base', 'unit', 'radius']) assert(typeof p.scale?.[k] === 'number', `${p.id}: 缺 scale.${k}`);
    assert(CJK_RE.test(p.name) && CJK_RE.test(p.description), `${p.id}: name/description 必须是中文`);
    assert(p.file === `design-system/tokens/${p.id}.css`, `${p.id}: file 必须是 design-system/tokens/<id>.css（仓库相对路径）`);
  }
  return `默认预设 ${tokensIndex.default}；共 ${ids.length} 套`;
});

check('每个预设文件存在，且声明了全部冻结变量', () => {
  const problems = [];
  for (const p of tokensIndex?.presets ?? []) {
    if (!existsSync(join(ROOT, p.file))) { problems.push(`${p.file} 不存在`); continue; }
    const css = readText(p.file);
    presetCss.set(p.id, css);
    const block = rootBlock(css);
    if (!block) { problems.push(`${p.file} 缺少 :root 块`); continue; }
    const decls = parseDecls(block);
    presetDecls.set(p.id, decls);
    const names = decls.map((d) => d[0]);
    const missing = REQUIRED_VARS.filter((v) => !names.includes(v));
    const extra = names.filter((v) => !REQUIRED_VARS.includes(v));
    if (missing.length) problems.push(`${p.id} 缺变量：${list(missing)}`);
    if (extra.length) problems.push(`${p.id} 多出未冻结变量：${list(extra)}`);
    if (new Set(names).size !== names.length) problems.push(`${p.id} 有重复变量`);
  }
  assert(!problems.length, problems.join('；'));
  return `${presetDecls.size} 个文件 / 每个 ${REQUIRED_VARS.length} 个变量`;
});

check('三套预设的变量名顺序完全一致', () => {
  const ref = presetDecls.get(tokensIndex.default)?.map((d) => d[0]) ?? [];
  const problems = [];
  for (const [id, decls] of presetDecls) {
    const names = decls.map((d) => d[0]);
    if (names.join(',') !== ref.join(',')) {
      const diff = names.filter((n, i) => ref[i] !== n);
      problems.push(`${id} 与 ${tokensIndex.default} 顺序不同（首个差异：${diff[0] ?? '长度不同'}）`);
    }
  }
  assert(!problems.length, problems.join('；'));
  return `统一 ${ref.length} 个变量`;
});

check('index.json 的 swatches / fonts / scale 与 CSS 文件取值一致', () => {
  const problems = [];
  for (const p of tokensIndex.presets) {
    const map = new Map(presetDecls.get(p.id) ?? []);
    const expect = {
      bg: map.get('--color-bg'), surface: map.get('--color-surface'), primary: map.get('--color-primary'),
      accent: map.get('--color-accent'), text: map.get('--color-text'),
    };
    for (const [k, v] of Object.entries(expect)) if (p.swatches[k] !== v) problems.push(`${p.id}.swatches.${k}=${p.swatches[k]} ≠ ${v}`);
    for (const k of ['display', 'body', 'mono']) {
      const cssVal = map.get(`--font-${k}`)?.replace(/"/g, '"');
      if (p.fonts[k] !== cssVal) problems.push(`${p.id}.fonts.${k} 与 --font-${k} 不一致`);
    }
    if (p.scale.base !== px(map.get('--text-md'))) problems.push(`${p.id}.scale.base 应等于 --text-md 的数值`);
    if (p.scale.unit !== px(map.get('--space-1'))) problems.push(`${p.id}.scale.unit 应等于 --space-1 的数值`);
    if (p.scale.radius !== px(map.get('--radius-md'))) problems.push(`${p.id}.scale.radius 应等于 --radius-md 的数值`);
  }
  assert(!problems.length, problems.join('；'));
  return 'swatches / fonts / scale 三项均可从 CSS 反查';
});

check('间距是 4 的倍数、字号阶梯递增、行高递增、字号不低于 12px', () => {
  const problems = [];
  for (const p of tokensIndex.presets) {
    const map = new Map(presetDecls.get(p.id) ?? []);
    const spaces = [];
    for (let i = 0; i <= 8; i += 1) {
      const raw = (map.get(`--space-${i}`) ?? '').trim();
      const v = raw === '0' ? 0 : px(raw);
      if (Number.isNaN(v)) { problems.push(`${p.id}: --space-${i} 不是 px 值`); continue; }
      if (v % 4 !== 0) problems.push(`${p.id}: --space-${i}=${raw} 不是 4 的倍数`);
      spaces.push(v);
    }
    for (let i = 1; i < spaces.length; i += 1) if (spaces[i] <= spaces[i - 1]) problems.push(`${p.id}: 间距节奏没有递增（第 ${i} 档）`);
    const sizes = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl'].map((k) => px(map.get(`--text-${k}`)));
    for (const s of sizes) if (!(s >= 12)) problems.push(`${p.id}: 存在小于 12px 的字号（中文正文会糊）`);
    for (let i = 1; i < sizes.length; i += 1) if (sizes[i] <= sizes[i - 1]) problems.push(`${p.id}: 字号阶梯没有递增（第 ${i} 档）`);
    const leads = ['tight', 'snug', 'normal', 'relaxed'].map((k) => Number(map.get(`--leading-${k}`)));
    for (let i = 1; i < leads.length; i += 1) if (!(leads[i] > leads[i - 1])) problems.push(`${p.id}: 行高没有递增（第 ${i} 档）`);
    if (Number(map.get('--leading-normal')) < 1.5) problems.push(`${p.id}: 正文行高(--leading-normal) 低于 1.5，中文排版偏挤`);
  }
  assert(!problems.length, problems.join('；'));
  return '三套预设的节奏检查通过';
});

check('预设文件无外链、无渐变、无脚本', () => {
  const problems = [];
  for (const p of tokensIndex.presets) {
    const css = presetCss.get(p.id) ?? '';
    if (/https?:\/\//.test(css)) problems.push(`${p.id}: 含外链 URL`);
    if (/@import|url\(/.test(css)) problems.push(`${p.id}: 含 @import 或 url()`);
    if (/gradient\(/.test(css)) problems.push(`${p.id}: 含渐变`);
  }
  assert(!problems.length, problems.join('；'));
  return '零外链 / 零渐变';
});

/* ── 2. frame 模板 ────────────────────────────── */
let templatesIndex = null;

check('templates/index.json 字段完整，且预设 id 均存在', () => {
  templatesIndex = readJson('design-system/templates/index.json');
  assert(templatesIndex.version === 1, 'version 必须是 1');
  const tpls = templatesIndex.templates;
  assert(Array.isArray(tpls) && tpls.length >= 2 && tpls.length <= 3, '模板数量应为 2~3 个');
  const presetIds = tokensIndex.presets.map((p) => p.id);
  for (const t of tpls) {
    for (const k of ['id', 'name', 'description', 'file', 'preset']) assert(typeof t[k] === 'string' && t[k], `${t.id}: 缺字段 ${k}`);
    assert(presetIds.includes(t.preset), `${t.id}: preset=${t.preset} 不在 tokens/index.json 中`);
    assert(t.file === `design-system/templates/${t.id}.html`, `${t.id}: file 必须是 design-system/templates/<id>.html`);
    assert(Number.isInteger(t.width) && Number.isInteger(t.height) && t.width > 0 && t.height > 0, `${t.id}: width/height 必须是正整数`);
    assert(CJK_RE.test(t.name) && CJK_RE.test(t.description), `${t.id}: name/description 必须是中文`);
  }
  return `${tpls.length} 个模板，覆盖预设 ${list([...new Set(tpls.map((t) => t.preset))])}`;
});

const templateCache = new Map();
function loadTemplate(t) {
  if (!templateCache.has(t.id)) templateCache.set(t.id, readText(t.file));
  return templateCache.get(t.id);
}

check('模板头部注释与 data-* 属性同 index.json 一致', () => {
  const problems = [];
  for (const t of templatesIndex.templates) {
    if (!existsSync(join(ROOT, t.file))) { problems.push(`${t.file} 不存在`); continue; }
    const html = loadTemplate(t);
    const meta = html.match(/@design-template\s+id=(\S+)\s+preset=(\S+)\s+width=(\d+)\s+height=(\d+)/);
    if (!meta) { problems.push(`${t.id}: 缺少 @design-template 头部注释`); continue; }
    if (meta[1] !== t.id || meta[2] !== t.preset || Number(meta[3]) !== t.width || Number(meta[4]) !== t.height) {
      problems.push(`${t.id}: 头部注释 ${meta.slice(1).join('/')} 与 index.json 不一致`);
    }
    const tag = html.match(/<html[^>]*data-template="([^"]+)"[^>]*data-preset="([^"]+)"/);
    if (!tag) { problems.push(`${t.id}: <html> 缺少 data-template / data-preset`); continue; }
    if (tag[1] !== t.id || tag[2] !== t.preset) problems.push(`${t.id}: data-* 属性与 index.json 不一致`);
  }
  assert(!problems.length, problems.join('；'));
  return '注释 / 属性 / index.json 三处一致';
});

check('模板内联 :root 与所选预设逐字一致（逐变量比对）', () => {
  const problems = [];
  for (const t of templatesIndex.templates) {
    const html = loadTemplate(t);
    const block = rootBlock(html);
    if (!block) { problems.push(`${t.id}: 缺少内联 :root 块`); continue; }
    const own = parseDecls(block);
    const ref = presetDecls.get(t.preset) ?? [];
    if (own.length !== ref.length) { problems.push(`${t.id}: 声明 ${own.length} 条，预设 ${t.preset} 有 ${ref.length} 条`); continue; }
    for (let i = 0; i < ref.length; i += 1) {
      if (own[i][0] !== ref[i][0]) { problems.push(`${t.id}: 第 ${i + 1} 个变量是 ${own[i][0]}，预设是 ${ref[i][0]}`); break; }
      if (own[i][1] !== ref[i][1]) { problems.push(`${t.id}: ${own[i][0]} 取值 ${own[i][1]} ≠ 预设 ${ref[i][1]}`); break; }
    }
  }
  assert(!problems.length, problems.join('；'));
  return `3 个模板 × ${REQUIRED_VARS.length} 个变量全部一致`;
});

check('模板零外链、零 script、零图片、零渐变、零 emoji', () => {
  const problems = [];
  for (const t of templatesIndex.templates) {
    const html = loadTemplate(t);
    const rules = [
      [/https?:\/\/(?!www\.w3\.org)/, '含外链 URL'],
      [/<link\b/, '含 <link>'],
      [/<img\b/, '含 <img>'],
      [/<script\b/i, '含 <script>'],
      [/@import/, '含 @import'],
      [/url\(/, '含 url()'],
      [/srcset=/, '含 srcset'],
      [/gradient\(/, '含渐变'],
    ];
    for (const [re, msg] of rules) if (re.test(html)) problems.push(`${t.id}: ${msg}`);
    if (EMOJI_RE.test(html)) problems.push(`${t.id}: 含 emoji（应用图标或文字表达，不用 emoji 当图标）`);
    for (const bad of BANNED_TEXT) if (html.includes(bad)) problems.push(`${t.id}: 含占位文本 ${bad}`);
    if (!CJK_RE.test(html)) problems.push(`${t.id}: 没有中文文案`);
  }
  assert(!problems.length, problems.join('；'));
  return '自包含，可直接当 frames/<id>.html 用';
});

check('模板：颜色只来自 token（:root 之外没有颜色字面量）', () => {
  const problems = [];
  for (const t of templatesIndex.templates) {
    const html = loadTemplate(t).replace(/:root\s*\{[\s\S]*?\}/, '');
    const hex = html.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    const fn = html.match(/\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\(/g) ?? [];
    const named = html.match(/:\s*(?:red|blue|green|purple|orange|pink|violet|magenta|cyan|yellow|brown|black|white)\b/g) ?? [];
    if (hex.length) problems.push(`${t.id}: 自创颜色 ${list(hex, 3)}`);
    if (fn.length) problems.push(`${t.id}: 自创颜色函数 ${list(fn, 3)}`);
    if (named.length) problems.push(`${t.id}: 具名颜色 ${list(named, 3)}`);
  }
  assert(!problems.length, problems.join('；'));
  return '全部走 var(--color-*) 或 color-mix 派生';
});

check('模板：字号只用 --text-*，内外边距只用 --space-*', () => {
  const problems = [];
  const badFont = [];
  for (const t of templatesIndex.templates) {
    const css = loadTemplate(t).replace(/:root\s*\{[\s\S]*?\}/, '');
    for (const m of css.matchAll(/font-size\s*:\s*([^;}]+)/g)) {
      if (!/^var\(--text-(xs|sm|md|lg|xl|2xl|3xl|4xl)\)$/.test(m[1].trim())) badFont.push(`${t.id}: font-size:${m[1].trim()}`);
    }
    for (const m of css.matchAll(/(?:^|[;{\s"'])((?:padding|margin)(?:-(?:top|right|bottom|left))?|gap|row-gap|column-gap)\s*:\s*([^;}]+)/g)) {
      for (const token of m[2].trim().split(/\s+/)) {
        const ok = token === '0' || token === 'auto' || token === 'inherit' || token === '100%'
          || /^var\(--space-[0-8]\)$/.test(token) || /^(?:1|2)px$/.test(token);
        if (!ok) problems.push(`${t.id}: ${m[1]}:${m[2].trim()}（用 --space-* 代替）`);
      }
    }
  }
  if (badFont.length) problems.push(...badFont);
  assert(!problems.length, list(problems, 3));
  return '字号与间距全部走 token（仅允许 1~2px 发丝线例外）';
});

/* ── 输出 ─────────────────────────────────────── */
const failed = results.filter((r) => !r.ok);
const width = Math.max(...results.map((r) => [...r.name].length)) + 2;
console.log('\nDSH 设计契约自检 · design-system/\n' + '─'.repeat(width + 30));
for (const r of results) {
  console.log(`${r.ok ? '通过' : '失败'}  ${r.name.padEnd(width, ' ')} ${r.detail}`);
}
console.log('─'.repeat(width + 30));
console.log(`合计 ${results.length} 项，通过 ${results.length - failed.length} 项，失败 ${failed.length} 项。`);
if (failed.length) {
  console.log('\n失败明细：');
  for (const f of failed) console.log(`  - ${f.name}\n    ${f.detail}`);
}
console.log(failed.length ? '\n结果：不通过（请修好上面列出的问题再交付）。\n' : '\n结果：全部通过。\n');
process.exit(failed.length ? 1 : 0);
