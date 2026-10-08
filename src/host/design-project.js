/**
 * `.design/` 设计工程的 host 侧读写核心。
 *
 * 设计原则（SPEC constraints）：
 * 1) 真源是文件：`<workspace>/.design/design.json` + `frames/<id>.html` + `tokens.css`。
 *    这里不用 storage，不用内存缓存，任何一次调用都直接落盘，保证 AC4 的 `git diff` 可见。
 * 2) 一个操作一个实现：agent 工具与画布 HTTP 通道调用的是本文件同一批函数
 *    （cordis-plugin-development/references/user-actions.md 的"一个操作两个调用者"）。
 * 3) 绝不抛未捕获异常给调用方：所有失败收敛成 `DesignError`，带 `code` / `path` / 中文原因。
 *    唯一例外是 registry 边界——工具会把 DesignError 抛给工具运行时，由它渲染成失败结果。
 * 4) 非法 JSON 是"可恢复"而非"崩溃"：备份 design.json.bak 后回退空工程（AC11）。
 *
 * @module dsh-design-agent/host/design-project
 */

import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_FRAME_HEIGHT,
  DEFAULT_FRAME_WIDTH,
  DESIGN_DIR,
  DESIGN_JSON,
  DESIGN_JSON_BACKUP,
  DESIGN_JSON_VERSION,
  ERROR_CODES,
  FRAME_ID_PATTERN,
  FRAMES_DIR,
  MAX_FRAME_BYTES,
  OP_KINDS,
  TOKENS_FILE,
} from './types.js';

/** 插件包根目录（本文件位于 <root>/src/host/）。用于读 T4 的 design-system/。 */
export const PLUGIN_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** 设计契约在插件内的目录（T4 所有，T2 只读）。 */
const DESIGN_SYSTEM_DIR = join(PLUGIN_ROOT, 'design-system');

/** 带错误码的设计侧失败。 */
export class DesignError extends Error {
  /**
   * @param {string} code - `ERROR_CODES` 之一。
   * @param {string} message - 面向人与模型的中文原因，必须包含失败路径与原因。
   * @param {string} [path] - 失败涉及的绝对路径。
   */
  constructor(code, message, path) {
    super(message);
    this.name = 'DesignError';
    this.code = code;
    /** @type {string|undefined} */
    this.path = path;
  }

  /** 稳定的 JSON 形状，供 route 与工具共用。 */
  toShape() {
    return {
      ok: /** @type {const} */ (false),
      error: {
        code: this.code,
        message: this.message,
        ...(this.path === undefined ? {} : { path: this.path }),
      },
    };
  }
}

/**
 * 把任意底层错误收敛为带路径与中文原因的 DesignError（AC12 的核心）。
 * @param {unknown} error - 底层抛出的值。
 * @param {string} absolutePath - 失败涉及的绝对路径。
 * @param {string} action - 中文动作，如"写入"。
 * @returns {DesignError}
 */
export function toDesignError(error, absolutePath, action) {
  if (error instanceof DesignError) return error;
  const raw = error instanceof Error ? error : new Error(String(error));
  const reason = raw.message === '' ? raw.name : raw.message;
  return new DesignError(
    ERROR_CODES.NOWRITE,
    `无法${action} ${absolutePath}：${reason}`,
    absolutePath,
  );
}

/** `.design/` 下所有路径的统一出口；路径只由 host 拼接，绝不来自调用方。 */
export function projectPaths(cwd) {
  const designDir = join(cwd, DESIGN_DIR);
  return {
    cwd,
    designDir,
    designJson: join(designDir, DESIGN_JSON),
    designJsonBackup: join(designDir, DESIGN_JSON_BACKUP),
    framesDir: join(designDir, FRAMES_DIR),
    tokensFile: join(designDir, TOKENS_FILE),
  };
}

/** 空工程（回退用）。 */
export function emptyProject() {
  return {
    version: DESIGN_JSON_VERSION,
    viewport: { x: 0, y: 0, zoom: 1 },
    tokens: {},
    frames: [],
    selection: {},
  };
}

/** @param {unknown} value @param {number} fallback */
function num(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** @param {unknown} value @param {string} fallback */
function str(value, fallback) {
  return typeof value === 'string' ? value : fallback;
}

/** @param {unknown} value */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 校验 frame id：既是路径安全要求，也保证客户端/模型传来的 id 不会穿越目录。
 * @param {unknown} id
 * @returns {string}
 */
export function assertFrameId(id) {
  if (typeof id !== 'string' || !FRAME_ID_PATTERN.test(id)) {
    throw new DesignError(
      ERROR_CODES.NOFRAME,
      `frameId 非法：${JSON.stringify(id)}；只允许 1~120 位字母、数字、点、下划线、连字符`,
    );
  }
  return id;
}

/**
 * 把外部读到的 JSON 归一化成完整 DesignProject，容忍缺字段与错类型（不抛错）。
 * @param {unknown} raw
 * @returns {import('./types.js').DesignProject}
 */
export function normalizeProject(raw) {
  const base = emptyProject();
  if (!isPlainObject(raw)) return base;

  const viewportRaw = isPlainObject(raw.viewport) ? raw.viewport : {};
  /** @type {Record<string, string>} */
  const tokens = {};
  if (isPlainObject(raw.tokens)) {
    for (const [key, value] of Object.entries(raw.tokens)) {
      if (typeof value === 'string') tokens[key] = value;
    }
  }

  /** @type {import('./types.js').Frame[]} */
  const frames = [];
  const seenFrameIds = new Set();
  if (Array.isArray(raw.frames)) {
    for (const candidate of raw.frames) {
      if (!isPlainObject(candidate)) continue;
      const id = candidate.id;
      if (typeof id !== 'string' || !FRAME_ID_PATTERN.test(id) || seenFrameIds.has(id)) continue;
      seenFrameIds.add(id);
      frames.push({
        id,
        name: str(candidate.name, id),
        // file 由 host 派生，忽略文件里存的值，避免出现指向目录外的相对路径。
        file: `${FRAMES_DIR}/${id}.html`,
        width: num(candidate.width, DEFAULT_FRAME_WIDTH),
        height: num(candidate.height, DEFAULT_FRAME_HEIGHT),
        x: num(candidate.x, 0),
        y: num(candidate.y, 0),
        ...(typeof candidate.background === 'string' ? { background: candidate.background } : {}),
        status: candidate.status === 'ready' ? 'ready' : 'draft',
      });
    }
  }

  const selectionRaw = isPlainObject(raw.selection) ? raw.selection : {};
  /** @type {import('./types.js').DesignProject['selection']} */
  const selection = {};
  if (typeof selectionRaw.frameId === 'string' && seenFrameIds.has(selectionRaw.frameId)) {
    selection.frameId = selectionRaw.frameId;
  }
  if (typeof selectionRaw.updatedAt === 'string') selection.updatedAt = selectionRaw.updatedAt;

  return {
    version: DESIGN_JSON_VERSION,
    viewport: {
      x: num(viewportRaw.x, 0),
      y: num(viewportRaw.y, 0),
      zoom: num(viewportRaw.zoom, 1),
    },
    tokens,
    frames,
    selection,
    ...(typeof raw.updatedAt === 'string' ? { updatedAt: raw.updatedAt } : {}),
    ...(raw.updatedBy === 'user' || raw.updatedBy === 'agent' || raw.updatedBy === 'plugin'
      ? { updatedBy: raw.updatedBy }
      : {}),
  };
}

/**
 * 解析 tokens.css 的 `:root` 块为 design.json 的 tokens 镜像。
 *
 * 命名规则（T4 冻结）：去掉 `--` 后把**第一个** `-` 换成 `.`。
 * `--color-primary` → `color.primary`；`--space-2` → `space.2`；`--radius` → `radius`。
 * @param {string} css
 * @returns {Record<string, string>}
 */
export function parseTokensCss(css) {
  /** @type {Record<string, string>} */
  const tokens = {};
  // 先剥掉注释：T4 的预设里每个变量组前面都有 /* 说明 */，
  // 而注释不以 ; 结尾，会让"按 ; 切段再整段匹配"的写法整段匹配失败、静默丢变量
  // （实测漏掉过 --color-primary / --font-display）。
  const stripped = css.replace(/\/\*[\s\S]*?\*\//gu, '');
  const rootBlocks = stripped.matchAll(/:root\s*\{([^}]*)\}/gu);
  for (const block of rootBlocks) {
    const body = block[1] ?? '';
    for (const match of body.matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;}]+)/gu)) {
      const rawName = match[1] ?? '';
      const value = (match[2] ?? '').trim();
      if (rawName === '' || value === '') continue;
      const bare = rawName.slice(2);
      const dot = bare.indexOf('-');
      tokens[dot === -1 ? bare : `${bare.slice(0, dot)}.${bare.slice(dot + 1)}`] = value;
    }
  }
  return tokens;
}

/** 读取 T4 的 token 预设索引；缺失时返回 null（T4 尚未产出也不该让 T2 崩）。 */
async function readPresetIndex() {
  try {
    const text = await readFile(join(DESIGN_SYSTEM_DIR, 'tokens', 'index.json'), 'utf8');
    const parsed = JSON.parse(text);
    if (!isPlainObject(parsed) || !Array.isArray(parsed.presets)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 把索引里的 `file` 解析成绝对路径（兼容"仓库相对路径"与"presets 目录内文件名"两种写法）。
 * @param {string} file
 */
function presetFileToAbsolute(file) {
  return file.startsWith('design-system/')
    ? join(PLUGIN_ROOT, file)
    : join(DESIGN_SYSTEM_DIR, 'tokens', file);
}

/**
 * 取一套 token 预设的 CSS 文本。
 * @param {string} [presetId] - 缺省用索引里的 `default`。
 * @returns {Promise<{id: string, css: string, file: string} | null>} null = T4 还没交付预设。
 */
export async function readTokenPreset(presetId) {
  const index = await readPresetIndex();
  if (index === null) return null;
  const presets = /** @type {Array<Record<string, unknown>>} */ (index.presets);
  const wanted = presetId ?? (typeof index.default === 'string' ? index.default : undefined);
  const entry = presets.find((preset) => preset.id === wanted) ?? presets[0];
  if (entry === undefined) return null;
  const file = typeof entry.file === 'string' ? entry.file : `tokens/${String(entry.id)}.css`;
  const absolute = presetFileToAbsolute(file);
  const css = await readFile(absolute, 'utf8');
  return { id: String(entry.id), css, file: absolute };
}

/** 列出可用预设 id，供工具报错时给出可选项。 */
export async function listPresetIds() {
  const index = await readPresetIndex();
  if (index === null) return [];
  return /** @type {Array<Record<string, unknown>>} */ (index.presets)
    .map((preset) => String(preset.id))
    .filter((id) => id !== 'undefined');
}

/** 读 T4 的 frame 模板目录索引。 */
async function readTemplateIndex() {
  try {
    const text = await readFile(join(DESIGN_SYSTEM_DIR, 'templates', 'index.json'), 'utf8');
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return { templates: parsed };
    if (isPlainObject(parsed) && Array.isArray(parsed.templates)) return parsed;
    return null;
  } catch {
    return null;
  }
}

/**
 * 模板 id → 绝对路径。同时接受直接给文件名（`orders.html`）。
 * @param {string} templateId
 */
async function templateFileToAbsolute(templateId) {
  const bare = templateId.replace(/\.html$/u, '');
  if (!/^[A-Za-z0-9._-]{1,120}$/u.test(bare)) {
    throw new DesignError(ERROR_CODES.UNKNOWN, `模板 id 非法：${JSON.stringify(templateId)}`);
  }
  const index = await readTemplateIndex();
  const entries = index === null ? [] : /** @type {Array<Record<string, unknown>>} */ (index.templates);
  const entry = entries.find((candidate) => candidate.id === bare || candidate.file === templateId);
  const file = entry !== undefined && typeof entry.file === 'string' ? entry.file : `${bare}.html`;
  return file.startsWith('design-system/') ? join(PLUGIN_ROOT, file) : join(DESIGN_SYSTEM_DIR, 'templates', file);
}

/** 可用模板 id 列表。 */
export async function listTemplateIds() {
  const index = await readTemplateIndex();
  if (index === null) return [];
  return /** @type {Array<Record<string, unknown>>} */ (index.templates)
    .map((template) => String(template.id ?? template.file ?? ''))
    .filter((id) => id !== '');
}

/**
 * 读设计工程。**非法 JSON 不抛错**：备份 design.json.bak 后回退空工程（AC11）。
 * @param {string} cwd - workspace 根。
 * @returns {Promise<{project: import('./types.js').DesignProject, exists: boolean, recovered: boolean, warning?: string}>}
 */
export async function readProject(cwd) {
  const paths = projectPaths(cwd);
  /** @type {string} */
  let raw;
  try {
    raw = await readFile(paths.designJson, 'utf8');
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
      return { project: emptyProject(), exists: false, recovered: false };
    }
    throw toDesignError(error, paths.designJson, '读取');
  }

  try {
    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed)) throw new SyntaxError('design.json 顶层必须是 JSON 对象');
    return { project: normalizeProject(parsed), exists: true, recovered: false };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    /** @type {string|undefined} */
    let warning;
    try {
      await copyFile(paths.designJson, paths.designJsonBackup);
      warning = `design.json 非法（${reason}），已备份为 ${paths.designJsonBackup}，本次按空工程继续。`;
    } catch (backupError) {
      const backupReason = backupError instanceof Error ? backupError.message : String(backupError);
      warning = `design.json 非法（${reason}），且备份失败（${backupReason}），本次按空工程继续。`;
    }
    return { project: emptyProject(), exists: true, recovered: true, warning };
  }
}

/**
 * 写 design.json。写入来源会记进 design.json（SPEC failure_handling：
 * 每次写入附带 user/agent 便于追溯）。
 * @param {string} cwd
 * @param {import('./types.js').DesignProject} project
 * @param {'user'|'agent'|'plugin'} [source]
 */
export async function writeProject(cwd, project, source = 'plugin') {
  const paths = projectPaths(cwd);
  const next = {
    ...normalizeProject(project),
    updatedAt: new Date().toISOString(),
    updatedBy: source,
  };
  try {
    await mkdir(paths.designDir, { recursive: true });
    await writeFile(paths.designJson, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  } catch (error) {
    throw toDesignError(error, paths.designJson, '写入');
  }
  return next;
}

/**
 * 规格化一次 HTTP 响应用的项目快照（只读，不回写）。
 * @param {string} cwd
 */
export async function readStatus(cwd) {
  const { project, exists, recovered, warning } = await readProject(cwd);
  const paths = projectPaths(cwd);
  return {
    project,
    frames: project.frames,
    tokens: project.tokens,
    selection: project.selection,
    exists,
    recovered,
    ...(warning === undefined ? {} : { warning }),
    designDir: paths.designDir,
  };
}

/**
 * 首次使用时建工程：创建目录、套用 T4 的默认 token 预设、写空 design.json。
 * design-system/ 还没就绪时不失败，只把原因记进 warning。
 * @param {string} cwd
 * @param {{presetId?: string}} [options]
 */
export async function initProject(cwd, options = {}) {
  const paths = projectPaths(cwd);
  /** @type {string[]} */
  const warnings = [];
  try {
    await mkdir(paths.framesDir, { recursive: true });
  } catch (error) {
    throw toDesignError(error, paths.framesDir, '创建目录');
  }

  /** @type {Record<string, string>} */
  let tokens = {};
  try {
    const preset = await readTokenPreset(options.presetId);
    if (preset === null) {
      warnings.push('design-system/tokens/index.json 尚不可用，未写入 tokens.css（T4 交付后重跑即可）。');
    } else {
      await writeFile(paths.tokensFile, preset.css, 'utf8');
      tokens = parseTokensCss(preset.css);
    }
  } catch (error) {
    warnings.push(`套用 token 预设失败：${error instanceof Error ? error.message : String(error)}`);
  }

  const existing = await readProject(cwd);
  const project = existing.exists && !existing.recovered
    ? existing.project
    : { ...emptyProject(), tokens };
  if (existing.exists && !existing.recovered) project.tokens = { ...tokens, ...project.tokens };

  const written = await writeProject(cwd, project, 'plugin');
  return { project: written, warnings, paths };
}

/** 工程不存在时自动建，保证第一次 design_frame_write 就能产出完整工程。 */
async function ensureProject(cwd) {
  const { exists } = await readProject(cwd);
  if (!exists) return initProject(cwd);
  return null;
}

/**
 * 单帧 HTML 合法性：0 字节与 >2MB 都拒绝（AC11）。
 * @param {unknown} html
 * @param {string} label - 报错里显示的 frame 标识。
 * @returns {string}
 */
export function assertFrameHtml(html, label) {
  if (typeof html !== 'string') {
    throw new DesignError(ERROR_CODES.EMPTY, `frame ${label} 的 html 必须是字符串`);
  }
  const bytes = Buffer.byteLength(html, 'utf8');
  if (bytes === 0) {
    throw new DesignError(ERROR_CODES.EMPTY, `frame ${label} 的 html 是 0 字节，已拒绝写入；请给出非空的自包含 HTML`);
  }
  if (bytes > MAX_FRAME_BYTES) {
    throw new DesignError(
      ERROR_CODES.TOOLARGE,
      `frame ${label} 的 html 为 ${bytes} 字节，超过 2MB 上限（${MAX_FRAME_BYTES} 字节），已拒绝写入；请拆分或压缩该屏`,
    );
  }
  return html;
}

/** 生成不与现有 frame 冲突的 id。 */
export function makeFrameId(project) {
  const used = new Set(project.frames.map((frame) => frame.id));
  for (let index = 1; index <= 10000; index += 1) {
    const candidate = `frame-${index}`;
    if (!used.has(candidate)) return candidate;
  }
  return `frame-${Date.now()}`;
}

/**
 * 写一屏：落 `frames/<id>.html` 并更新 design.json。
 * @param {string} cwd
 * @param {{id?: string, name?: string, html: string, width?: number, height?: number, x?: number, y?: number, background?: string}} input
 * @param {'user'|'agent'|'plugin'} [source]
 * @returns {Promise<{id: string, frame: import('./types.js').Frame, file: string, bytes: number, design: import('./types.js').DesignProject}>}
 */
export async function writeFrame(cwd, input, source = 'agent') {
  await ensureProject(cwd);
  const { project } = await readProject(cwd);
  const paths = projectPaths(cwd);

  const id = input.id === undefined || input.id === '' ? makeFrameId(project) : assertFrameId(input.id);
  const html = assertFrameHtml(input.html, id);
  const bytes = Buffer.byteLength(html, 'utf8');

  const existing = project.frames.find((frame) => frame.id === id);
  const index = project.frames.findIndex((frame) => frame.id === id);
  /** @type {import('./types.js').Frame} */
  const frame = {
    id,
    name: str(input.name, existing?.name ?? id),
    file: `${FRAMES_DIR}/${id}.html`,
    width: num(input.width, existing?.width ?? DEFAULT_FRAME_WIDTH),
    height: num(input.height, existing?.height ?? DEFAULT_FRAME_HEIGHT),
    x: num(input.x, existing?.x ?? (project.frames.length % 4) * 320),
    y: num(input.y, existing?.y ?? Math.floor(project.frames.length / 4) * 320),
    ...(typeof input.background === 'string' ? { background: input.background } : {}),
    status: existing?.status ?? 'draft',
  };

  const absoluteFramePath = join(paths.framesDir, `${id}.html`);
  try {
    await mkdir(paths.framesDir, { recursive: true });
    await writeFile(absoluteFramePath, html, 'utf8');
  } catch (error) {
    throw toDesignError(error, absoluteFramePath, '写入');
  }

  if (index === -1) project.frames.push(frame);
  else project.frames[index] = frame;

  const design = await writeProject(cwd, project, source);
  return { id, frame, file: frame.file, bytes, design };
}

/**
 * 读一屏的 HTML（模板替换时用）。
 * @param {string} cwd
 * @param {string} id
 */
export async function readFrameHtml(cwd, id) {
  assertFrameId(id);
  const paths = projectPaths(cwd);
  const absolute = join(paths.framesDir, `${id}.html`);
  try {
    return await readFile(absolute, 'utf8');
  } catch (error) {
    throw toDesignError(error, absolute, '读取');
  }
}

/**
 * op 结构校验 + 归一化：字段缺失/类型错也归 EUNKNOWN，且整批拒绝。
 *
 * 判别字段同时接受 `op`（T2/T3 现行契约）与 `kind`（Lead 早期冻结稿的写法），
 * 内部一律归一化成 `op`，避免两端因为一个字段名对不上而整批失败。
 * 归一化后的对象返回给调用方继续处理。
 */
function normalizeOp(raw) {
  if (!isPlainObject(raw)) {
    throw new DesignError(ERROR_CODES.UNKNOWN, `画布操作必须是对象：${JSON.stringify(raw)}`);
  }
  const kind = typeof raw.op === 'string' ? raw.op : typeof raw.kind === 'string' ? raw.kind : undefined;
  if (kind === undefined) {
    throw new DesignError(ERROR_CODES.UNKNOWN, `画布操作缺少 op 字段：${JSON.stringify(raw)}`);
  }
  if (!OP_KINDS.includes(kind)) {
    throw new DesignError(ERROR_CODES.UNKNOWN, `未知画布操作 op=${JSON.stringify(kind)}；可用：${OP_KINDS.join(' | ')}`);
  }
  const op = { ...raw, op: kind };
  const needsString = (key) => {
    if (typeof op[key] !== 'string' || op[key] === '') {
      throw new DesignError(ERROR_CODES.UNKNOWN, `画布操作 ${kind} 缺少字符串字段 ${key}`);
    }
  };
  switch (kind) {
    case 'add_frame':
      needsString('name');
      if (typeof op.html !== 'string' && typeof op.template !== 'string') {
        throw new DesignError(ERROR_CODES.UNKNOWN, 'add_frame 需要 html 或 template 之一');
      }
      break;
    case 'move_frame':
    case 'resize_frame':
    case 'rename_frame':
    case 'delete_frame':
      needsString('id');
      break;
    case 'switch_tokens':
      needsString('preset');
      break;
    default:
      break;
  }
  return op;
}

/**
 * 应用一批画布操作。**先整体校验再落盘**：任一 op 非法就整批拒绝，不留半成品。
 *
 * @param {string} cwd - workspace 根。
 * @param {Array<Record<string, any>>} ops
 * @param {'user'|'agent'|'plugin'} [source] - user = 画布 UI 写回；agent = 工具调用。
 * @returns {Promise<{applied: string[], design: import('./types.js').DesignProject}>}
 */
export async function applyCanvasOps(cwd, ops, source = 'user') {
  if (!Array.isArray(ops) || ops.length === 0) {
    throw new DesignError(ERROR_CODES.UNKNOWN, '画布操作必须是非空数组');
  }
  // 先整体归一化 + 校验，任一 op 非法就整批拒绝，不做部分应用。
  const normalizedOps = ops.map(normalizeOp);

  await ensureProject(cwd);
  const { project } = await readProject(cwd);
  const paths = projectPaths(cwd);
  /** @type {string[]} */
  const applied = [];
  /** 需要写文件的 frame，统一在 design.json 之前落盘。 */
  /** @type {Array<{path: string, html: string}>} */
  const frameWrites = [];

  const requireFrame = (id) => {
    const frame = project.frames.find((candidate) => candidate.id === id);
    if (frame === undefined) {
      throw new DesignError(ERROR_CODES.NOFRAME, `frameId 不存在：${id}；先调用 design_status 看现有 frame`, join(paths.framesDir, `${id}.html`));
    }
    return frame;
  };

  for (const op of normalizedOps) {
    switch (op.op) {
      case 'add_frame': {
        const id = op.id === undefined || op.id === '' ? makeFrameId(project) : assertFrameId(op.id);
        if (project.frames.some((frame) => frame.id === id)) {
          throw new DesignError(ERROR_CODES.UNKNOWN, `add_frame 的 id 已存在：${id}；改内容请用 design_frame_write`);
        }
        /** @type {string} */
        let html;
        if (typeof op.html === 'string') {
          html = assertFrameHtml(op.html, id);
        } else {
          const templatePath = await templateFileToAbsolute(String(op.template));
          try {
            html = await readFile(templatePath, 'utf8');
          } catch (error) {
            throw toDesignError(error, templatePath, '读取模板');
          }
          assertFrameHtml(html, id);
        }
        const frame = {
          id,
          name: str(op.name, id),
          file: `${FRAMES_DIR}/${id}.html`,
          width: num(op.width, DEFAULT_FRAME_WIDTH),
          height: num(op.height, DEFAULT_FRAME_HEIGHT),
          x: num(op.x, (project.frames.length % 4) * 320),
          y: num(op.y, Math.floor(project.frames.length / 4) * 320),
          ...(typeof op.background === 'string' ? { background: op.background } : {}),
          status: /** @type {'draft'|'ready'} */ ('draft'),
        };
        frameWrites.push({ path: join(paths.framesDir, `${id}.html`), html });
        project.frames.push(frame);
        applied.push(`add_frame:${id}`);
        break;
      }
      case 'move_frame': {
        const frame = requireFrame(String(op.id));
        frame.x = num(op.x, frame.x);
        frame.y = num(op.y, frame.y);
        applied.push(`move_frame:${frame.id}`);
        break;
      }
      case 'resize_frame': {
        const frame = requireFrame(String(op.id));
        frame.width = num(op.width, frame.width);
        frame.height = num(op.height, frame.height);
        applied.push(`resize_frame:${frame.id}`);
        break;
      }
      case 'rename_frame': {
        const frame = requireFrame(String(op.id));
        frame.name = String(op.name);
        applied.push(`rename_frame:${frame.id}`);
        break;
      }
      case 'delete_frame': {
        const frame = requireFrame(String(op.id));
        project.frames = project.frames.filter((candidate) => candidate.id !== frame.id);
        if (project.selection.frameId === frame.id) delete project.selection.frameId;
        frameWrites.push({ path: join(paths.framesDir, `${frame.id}.html`), html: null });
        applied.push(`delete_frame:${frame.id}`);
        break;
      }
      case 'switch_tokens': {
        /** @type {{id: string, css: string, file: string} | null} */
        let preset;
        try {
          preset = await readTokenPreset(String(op.preset));
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          throw new DesignError(ERROR_CODES.UNKNOWN, `读取 token 预设失败：${reason}；可用预设：${(await listPresetIds()).join(' | ') || '（design-system 尚未就绪）'}`);
        }
        if (preset === null) {
          throw new DesignError(ERROR_CODES.UNKNOWN, `token 预设不存在：${op.preset}；可用预设：${(await listPresetIds()).join(' | ') || '（design-system 尚未就绪）'}`);
        }
        try {
          await writeFile(paths.tokensFile, preset.css, 'utf8');
        } catch (error) {
          throw toDesignError(error, paths.tokensFile, '写入');
        }
        project.tokens = parseTokensCss(preset.css);
        applied.push(`switch_tokens:${preset.id}`);
        break;
      }
      case 'set_viewport': {
        project.viewport = {
          x: num(op.x, project.viewport.x),
          y: num(op.y, project.viewport.y),
          zoom: num(op.zoom, project.viewport.zoom),
        };
        applied.push('set_viewport');
        break;
      }
      case 'select': {
        /** @type {import('./types.js').DesignProject['selection']} */
        const selection = {};
        if (typeof op.frameId === 'string' && op.frameId !== '') selection.frameId = assertFrameId(op.frameId);
        selection.updatedAt = new Date().toISOString();
        project.selection = selection;
        applied.push('select');
        break;
      }
      default:
        throw new DesignError(ERROR_CODES.UNKNOWN, `未知画布操作 op=${String(op.op)}`);
    }
  }

  // 先写 frame 文件，再写 design.json：这样 design.json 里出现的 frame 一定有对应文件。
  for (const pending of frameWrites) {
    try {
      if (pending.html === null) await rm(pending.path, { force: true });
      else {
        await mkdir(paths.framesDir, { recursive: true });
        await writeFile(pending.path, pending.html, 'utf8');
      }
    } catch (error) {
      throw toDesignError(error, pending.path, pending.html === null ? '删除' : '写入');
    }
  }

  const design = await writeProject(cwd, project, source);
  return { applied, design };
}
