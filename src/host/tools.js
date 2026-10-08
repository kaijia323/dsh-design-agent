/**
 * 三个 Agent 设计工具的注册（hand-written JSON Schema，不依赖 @deepseek-ai/dsh-tools）。
 *
 * 为什么手写 schema：`ctx.tools.register` 运行时只要求 `output { schema, render }`
 * 是受支持的 JSON Schema 子集 + `name !== "run_code"`；`defineTool` 只是把它编译一遍，
 * 引它进来会多一个运行时依赖（Lead 已裁定不新增依赖）。
 *
 * 工具与画布 HTTP 通道（src/host/http.js）调用的是 design-project.js 里同一批函数，
 * 不存在两套逻辑。
 *
 * @module dsh-design-agent/host/tools
 */

import { DesignError, applyCanvasOps, readStatus, writeFrame } from './design-project.js';
import { ERROR_CODES, MAX_FRAME_BYTES } from './types.js';

/** 工具名常量，客户端 toolview slot（P1）与验收都按这些名字找。 */
export const TOOL_STATUS = 'design_status';
export const TOOL_FRAME_WRITE = 'design_frame_write';
export const TOOL_CANVAS_APPLY = 'design_canvas_apply';

/**
 * 把 DesignError 变成模型能读懂的中文失败文本（AC12：必须含失败路径与原因）。
 * @param {unknown} error
 * @returns {Error}
 */
function toToolFailure(error) {
  if (error instanceof DesignError) {
    const location = error.path === undefined ? '' : `（路径：${error.path}）`;
    return new Error(`【${error.code}】${error.message}${location}`);
  }
  const reason = error instanceof Error ? error.message : String(error);
  return new Error(`【${ERROR_CODES.UNKNOWN}】设计工具执行失败：${reason}`);
}

/**
 * 从工具执行上下文解析 workspace 根目录。
 *
 * 工作区路径**只由 host 解析**，绝不接受模型/客户端传来的路径：
 * session cwd 是 DSH 自己的会话事实（dsh-tool-fs 用同一来源）。
 * @param {{agent?: {session: {header: {cwd?: string}}}}} exec
 * @returns {string}
 */
function resolveCwd(exec) {
  const cwd = exec.agent?.session.header.cwd;
  if (typeof cwd !== 'string' || cwd === '') {
    throw new Error(
      `【${ERROR_CODES.UNKNOWN}】无法确定工作区：设计工具必须在带 cwd 的 agent 会话里调用（session.header.cwd 为空）。`,
    );
  }
  return cwd;
}

/** 统一的 JSON 文本渲染。 */
function renderJson(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
}

/** design_status 的输出 schema。 */
const STATUS_OUTPUT = {
  type: 'object',
  properties: {
    project: { type: 'object', description: '完整设计工程（design.json 归一化结果）' },
    frames: { type: 'array', items: { type: 'object' }, description: '所有 frame' },
    tokens: { type: 'object', description: 'tokens.css 的只读镜像' },
    comments: { type: 'array', items: { type: 'object' }, description: '批注（含原文与 frameId）' },
    selection: { type: 'object', description: '用户当前选中态' },
    exists: { type: 'boolean', description: 'design.json 是否已存在' },
    recovered: { type: 'boolean', description: '本次是否因 design.json 非法而回退空工程' },
    warning: { type: 'string', description: '回退或预设缺失时的中文说明' },
    designDir: { type: 'string', description: '.design 目录绝对路径' },
  },
};

/** design_frame_write 的输出 schema。 */
const FRAME_WRITE_OUTPUT = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    file: { type: 'string', description: '相对 .design 的路径' },
    bytes: { type: 'integer' },
  },
};

/** design_canvas_apply 的输出 schema。 */
const CANVAS_APPLY_OUTPUT = {
  type: 'object',
  properties: {
    applied: { type: 'array', items: { type: 'string' } },
    design: { type: 'object' },
  },
};

/**
 * 注册三个设计工具。
 * @param {import('@deepseek-ai/cordis').Context} ctx - 已 inject tools 的 host 上下文。
 * @returns {() => void} 卸载函数。
 */
export function registerDesignTools(ctx) {
  const disposers = [];

  disposers.push(
    ctx.tools.register({
      name: TOOL_STATUS,
      description:
        '读取设计画布的当前状态：设计工程、所有 frame（id/name/尺寸/坐标）、token 镜像、用户批注、当前选中项。无副作用。' +
        '用户会在画布上留批注，**改设计前必须先调用本工具**：未处理批注在 comments 里（resolved=false），带批注原文与所属 frameId。' +
        '只想看某一屏的 HTML 时，直接用 read 工具读 .design/frames/<id>.html。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          includeResolved: {
            type: 'boolean',
            description: '是否连已处理批注一起返回，默认 false（只给未处理的）。',
          },
        },
      },
      output: { schema: STATUS_OUTPUT, render: renderJson },
      execute(args, exec) {
        const cwd = resolveCwd(exec);
        return readStatus(cwd)
          .then((status) => {
            if (args.includeResolved === true) return status;
            return { ...status, comments: status.comments.filter((comment) => !comment.resolved) };
          })
          .catch((error) => {
            throw toToolFailure(error);
          });
      },
    }),
  );

  disposers.push(
    ctx.tools.register({
      name: TOOL_FRAME_WRITE,
      description:
        '创建或覆盖画布上的一屏：写入 .design/frames/<id>.html，并在 design.json 里登记/更新该 frame。' +
        '**动手前先调用 design_status 读未处理批注**——用户会直接在画布上留意见，不看就改等于白改。' +
        '只改某一屏的页面内容时，**也可以直接用 read/write/edit 编辑 .design/frames/<id>.html**（画布会监听文件变更自动刷新），' +
        '但新增一屏、改尺寸或改坐标请用本工具，这样 design.json 才同步。' +
        `单屏 HTML 必须自包含（样式内联），0 字节或超过 ${MAX_FRAME_BYTES} 字节（2MB）会被拒绝。`,
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'html', 'width', 'height'],
        properties: {
          id: {
            type: 'string',
            description: 'frame id；不传则自动分配 frame-N。只允许字母、数字、点、下划线、连字符。',
          },
          name: { type: 'string', description: '这一屏的中文名，例如「订单列表」。' },
          html: { type: 'string', description: '自包含 HTML（样式与 token 内联）。' },
          width: { type: 'integer', description: '这一屏的渲染宽（像素）。' },
          height: { type: 'integer', description: '这一屏的渲染高（像素）。' },
          x: { type: 'integer', description: '画布坐标 x；不传则自动摆放。' },
          y: { type: 'integer', description: '画布坐标 y；不传则自动摆放。' },
        },
      },
      output: { schema: FRAME_WRITE_OUTPUT, render: renderJson },
      async execute(args, exec) {
        const cwd = resolveCwd(exec);
        try {
          const result = await writeFrame(
            cwd,
            {
              id: args.id,
              name: args.name,
              html: args.html,
              width: args.width,
              height: args.height,
              x: args.x,
              y: args.y,
            },
            'agent',
          );
          return { id: result.id, file: result.file, bytes: result.bytes };
        } catch (error) {
          throw toToolFailure(error);
        }
      },
    }),
  );

  disposers.push(
    ctx.tools.register({
      name: TOOL_CANVAS_APPLY,
      description:
        '对画布应用一组操作（新增/移动/改尺寸/重命名/删除 frame、切换 token 预设、加批注/标记批注已处理、写视口、写选中态）。' +
        '任一操作非法则整批拒绝、不做部分应用。用户批注要先 design_status 读出来再改。' +
        '可用 op：add_frame | move_frame | resize_frame | rename_frame | delete_frame | switch_tokens | add_comment | resolve_comment | set_viewport | select。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['ops'],
        properties: {
          ops: {
            type: 'array',
            description: '要应用的操作列表，按顺序执行。',
            items: {
              type: 'object',
              additionalProperties: true,
              required: ['op'],
              properties: {
                op: {
                  type: 'string',
                  enum: [
                    'add_frame',
                    'move_frame',
                    'resize_frame',
                    'rename_frame',
                    'delete_frame',
                    'switch_tokens',
                    'add_comment',
                    'resolve_comment',
                    'set_viewport',
                    'select',
                  ],
                  description: '操作类型。',
                },
                id: { type: 'string', description: 'frame id（move/resize/rename/delete 必填）。' },
                frameId: { type: 'string', description: 'frame id（add_comment 必填）。' },
                name: { type: 'string', description: 'frame 名称（add_frame/rename_frame 用）。' },
                html: { type: 'string', description: 'add_frame 的自包含 HTML。' },
                template: { type: 'string', description: 'add_frame 套用 design-system/templates 里的模板 id（与 html 二选一）。' },
                width: { type: 'integer' },
                height: { type: 'integer' },
                x: { type: 'number' },
                y: { type: 'number' },
                zoom: { type: 'number', description: 'set_viewport 用。' },
                preset: { type: 'string', description: 'switch_tokens 的预设 id。' },
                text: { type: 'string', description: 'add_comment 的批注原文。' },
                target: { type: 'string', description: 'add_comment 指向的元素选择器（可选）。' },
                resolved: { type: 'boolean', description: 'resolve_comment 用，默认 true。' },
                commentId: { type: 'string', description: 'select 用。' },
              },
            },
          },
        },
      },
      output: { schema: CANVAS_APPLY_OUTPUT, render: renderJson },
      async execute(args, exec) {
        const cwd = resolveCwd(exec);
        try {
          return await applyCanvasOps(cwd, args.ops, 'agent');
        } catch (error) {
          throw toToolFailure(error);
        }
      },
    }),
  );

  return () => {
    for (const dispose of disposers) dispose();
  };
}
