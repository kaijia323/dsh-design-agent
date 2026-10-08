/**
 * Host 半入口：把设计画布的三块能力挂到 DSH 上。
 *
 * 1) 三个 Agent 工具（design_status / design_frame_write / design_canvas_apply）
 * 2) 画布 → host 的写通道（`POST /design-canvas/api`，同源护栏见 src/host/http.js）
 * 3) 设计约定注入 systemPrompt（正文由 T4 的 prompts/design-conventions.md 提供）
 *
 * 形态要求（T1 冻结）：只导出 `inject` 与 `apply`，不要混用 service class。
 *
 * @module @local/dsh-design-canvas
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { PLUGIN_ROOT } from './src/host/design-project.js';
import { registerDesignRoute } from './src/host/http.js';
import { registerDesignTools } from './src/host/tools.js';

/**
 * 必需的 Host 服务。四个都是本 profile 里真实存在的服务：
 * `tools` 注册工具，`systemPrompt` 注入设计约定，
 * `webServer` 承载画布写通道，`agents` 把 sessionId 解析成工作区路径。
 */
export const inject = ['tools', 'systemPrompt', 'webServer', 'agents'];

/** T4 的设计约定正文（未交付前用下面的兜底，保证 agent 不至于乱来）。 */
const CONVENTIONS_FILE = join(PLUGIN_ROOT, 'prompts', 'design-conventions.md');

/** 兜底约定：T4 交付后会被文件内容整体替换。 */
const FALLBACK_CONVENTIONS = [
  '# 设计画布约定（兜底）',
  '',
  '本工作区启用了设计画布插件：设计真源是 `.design/` 下的真实文件。',
  '',
  '- 动手前先调用 `design_status`，看现有 frame 与**未处理批注**（用户会直接在画布上留意见）。',
  '- 一次出 1~3 屏，每屏一个自包含 HTML（样式内联），用 `design_frame_write` 落盘。',
  '- 改某一屏的页面内容可以直接用 read/write/edit 编辑 `.design/frames/<id>.html`，画布会自动刷新。',
  '- 颜色与间距请用 `.design/tokens.css` 里的变量，不要自创颜色。',
  '- 用户批注必须先读后改，改完用 `design_canvas_apply` 的 `resolve_comment` 标记已处理。',
].join('\n');

/**
 * 激活 Host 半。
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host 插件上下文。
 */
export function apply(ctx) {
  // 设计约定正文：激活时读一次文件（T4 可能还没交付），失败就保持兜底。
  let conventions = FALLBACK_CONVENTIONS;
  ctx.effect(() => {
    let active = true;
    readFile(CONVENTIONS_FILE, 'utf8')
      .then((text) => {
        if (active && text.trim() !== '') conventions = text;
      })
      .catch(() => {
        /* T4 尚未交付时保持兜底文本 */
      });
    return () => {
      active = false;
    };
  }, 'design-canvas: conventions file');

  // 设计约定进 systemPrompt。order 取一个靠后的数值，避免插进 harness 核心指令中间。
  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: 'design-canvas/conventions',
        order: 500,
        text: () => conventions,
      }),
    'design-canvas: system prompt',
  );

  // 三个 Agent 工具。
  ctx.effect(() => registerDesignTools(ctx), 'design-canvas: tools');

  // 画布写通道：与工具共用 design-project.js 的同一批函数。
  ctx.effect(() => registerDesignRoute(ctx), 'design-canvas: canvas route');
}
