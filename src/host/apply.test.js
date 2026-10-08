/**
 * 激活期冒烟测试（apply.test.js）：不启动 DSH，直接把 index.js 的 `apply()` 挂到假 ctx 上。
 *
 * 为什么这是 T2 最有价值的一个测试：host 插件是普通 ESM，DSH 的 loader 用不带 cache-bust 的
 * `import(name)` 加载，所以改了 host 代码**必须重启 profile**才生效。重启一次代价很高，
 * 而 apply() 一旦抛错，整条 fiber 就是 FAILED —— 插件全废、AC1 的图标都会消失。
 * 所以这里在重启前把"激活期才会炸的错误"全部榨出来：
 *   - 服务名写错 / 注册参数形态不对 / JSON Schema 用了子集外关键字
 *   - schema.required 里写了 properties 里没有的字段
 *   - 工具 execute 在真实文件系统上是否真能跑通
 *
 * 运行：`node --test src/host/apply.test.js`
 *
 * @module dsh-design-agent/host/apply.test
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { apply, inject } from '../../index.js';

/** 受支持的 JSON Schema 子集关键字（与 dsh-tools 的 assertSupportedJsonSchema 对齐）。 */
const ALLOWED_SCHEMA_KEYS = new Set([
  'type',
  'oneOf',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'const',
  'description',
  'title',
  'default',
  'examples',
]);

/**
 * 手写 schema 的静态检查：一旦用了子集外的关键字，`ctx.tools.register` 会在运行时抛错，
 * 插件直接挂掉。这里提前拦下来。
 * @param {any} schema
 * @param {string} path
 * @param {string[]} problems
 */
function checkSchemaSubset(schema, path, problems) {
  if (schema === null || typeof schema !== 'object') return;
  for (const key of Object.keys(schema)) {
    if (!ALLOWED_SCHEMA_KEYS.has(key)) problems.push(`${path} 使用了子集外关键字 .${key}`);
  }
  if (schema.properties !== undefined) {
    for (const [name, child] of Object.entries(schema.properties)) {
      checkSchemaSubset(child, `${path}.properties.${name}`, problems);
    }
  }
  if (schema.items !== undefined) checkSchemaSubset(schema.items, `${path}.items`, problems);
  if (Array.isArray(schema.oneOf)) {
    schema.oneOf.forEach((child, index) => checkSchemaSubset(child, `${path}.oneOf[${index}]`, problems));
  }
  if (schema.required !== undefined && schema.properties !== undefined) {
    for (const name of schema.required) {
      if (!(name in schema.properties)) problems.push(`${path}.required 里的 ${name} 不在 properties 中`);
    }
  }
}

let workspace;
before(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'design-canvas-smoke-'));
});
after(async () => {
  await rm(workspace, { recursive: true, force: true });
});

/** 装出一个记录调用的假 Host 上下文。 */
function mountHost() {
  /** @type {any[]} */
  const tools = [];
  /** @type {any[]} */
  const routes = [];
  /** @type {any[]} */
  const sections = [];
  /** @type {string[]} */
  const effectLabels = [];
  /** @type {Array<() => void>} */
  const disposers = [];

  const ctx = {
    // 真实 cordis 的 ctx.effect(cb, label) 会立即执行 cb，并把 cb 的返回值当 cleanup。
    effect(callback, label) {
      effectLabels.push(String(label));
      const cleanup = callback();
      disposers.push(typeof cleanup === 'function' ? cleanup : () => {});
      return cleanup;
    },
    tools: {
      register(definition) {
        // 校验注册期就能暴露的错误：名字为空、缺 output、render 不是函数，真 registry 会直接抛。
        assert.ok(typeof definition.name === 'string' && definition.name !== '', '工具 name 不能为空');
        assert.notEqual(definition.name, 'run_code', 'run_code 是保留名');
        assert.ok(typeof definition.description === 'string' && definition.description !== '', `${definition.name} 缺 description`);
        assert.equal(typeof definition.execute, 'function', `${definition.name} 缺 execute`);
        assert.ok(definition.output !== undefined && typeof definition.output === 'object', `${definition.name} 缺 output`);
        assert.equal(typeof definition.output.render, 'function', `${definition.name} 的 output.render 必须是函数`);
        assert.ok(definition.output.schema !== undefined, `${definition.name} 缺 output.schema`);
        assert.equal(definition.parameters.type, 'object', `${definition.name} 的 parameters 必须是 object 根`);
        assert.ok(definition.parameters.properties !== undefined, `${definition.name} 的 parameters 缺 properties`);
        tools.push(definition);
        return () => {};
      },
    },
    webServer: {
      register(route) {
        // 真 webServer.register 会校验 (kind, path) 冲突与 handler 存在。
        assert.ok(route.kind === 'exact' || route.kind === 'prefix', 'route.kind 必须是 exact 或 prefix');
        assert.ok(typeof route.path === 'string' && route.path.startsWith('/'), 'route.path 必须是以 / 开头的字符串');
        assert.equal(typeof route.handler, 'function', 'route.handler 必须是函数');
        routes.push(route);
        return () => {};
      },
    },
    systemPrompt: {
      section(section) {
        assert.ok(typeof section.name === 'string' && section.name !== '', 'prompt section 缺 name');
        assert.equal(typeof section.order, 'number', `${section.name} 的 order 必须是数字`);
        assert.ok(
          typeof section.text === 'string' || typeof section.text === 'function',
          `${section.name} 的 text 必须是字符串或 provider`,
        );
        sections.push(section);
        return () => {};
      },
    },
    agents: { get: () => undefined },
  };

  apply(ctx);
  return { tools, routes, sections, effectLabels, disposers };
}

describe('index.js 的导出形态与注册结果', () => {
  it('只导出 inject + apply，inject 是四个真实服务', () => {
    assert.deepEqual(inject, ['tools', 'systemPrompt', 'webServer', 'agents']);
  });

  it('apply() 注册三个工具、一条画布路由、一段 systemPrompt', () => {
    const { tools, routes, sections, effectLabels } = mountHost();

    assert.deepEqual(
      tools.map((tool) => tool.name).sort(),
      ['design_canvas_apply', 'design_frame_write', 'design_status'],
    );

    assert.equal(routes.length, 1);
    assert.equal(routes[0].kind, 'exact');
    assert.equal(routes[0].path, '/design-canvas/api');
    assert.equal(typeof routes[0].handler, 'function');

    assert.equal(sections.length, 1);
    assert.equal(sections[0].name, 'design-agent/conventions');
    assert.equal(typeof sections[0].order, 'number');
    // text 允许是字符串或 provider；我们用 provider 以便 T4 交付后热替换。
    const text = typeof sections[0].text === 'function' ? sections[0].text({}) : sections[0].text;
    assert.equal(typeof text, 'string');
    assert.ok(text.length > 50, 'systemPrompt 段不应是空壳');
    assert.match(text, /[一-龥]/u, '设计约定必须是中文');
    assert.ok(effectLabels.length >= 3, '每个注册都应包在 ctx.effect 里');
  });

  it('三个工具都带合法 JSON Schema（不含子集外关键字）且有 output.schema/render', () => {
    const { tools } = mountHost();
    assert.equal(tools.length, 3);
    for (const tool of tools) {
      const problems = [];
      checkSchemaSubset(tool.parameters, `${tool.name}.parameters`, problems);
      checkSchemaSubset(tool.output.schema, `${tool.name}.output.schema`, problems);
      assert.deepEqual(problems, [], `${tool.name} 的 schema 有问题`);
      assert.equal(tool.parameters.type, 'object');
      assert.equal(typeof tool.output.render, 'function');
      assert.equal(typeof tool.execute, 'function');
      assert.notEqual(tool.name, 'run_code');
      assert.ok(typeof tool.description === 'string' && tool.description.length > 20, '描述应是有意义的中文说明');
      assert.match(tool.description, /[\u4e00-\u9fa5]/u, '描述必须是中文（用户要求不做 i18n）');
    }
  });

  it('工具描述写清了两件必须说的事：可直接改 frame 文件、批注先 design_status', () => {
    const { tools } = mountHost();
    const status = tools.find((tool) => tool.name === 'design_status');
    const frameWrite = tools.find((tool) => tool.name === 'design_frame_write');
    assert.match(status.description, /批注/u);
    assert.match(frameWrite.description, /read\/write\/edit/u);
    assert.match(frameWrite.description, /\.design\/frames\//u);
    // 用户会直接在画布上留意见，所以每个改设计的工具都要提醒先读未处理批注。
    assert.match(frameWrite.description, /design_status/u);
    assert.match(tools.find((tool) => tool.name === 'design_canvas_apply').description, /design_status/u);
  });

  it('dispose 全调一遍不抛错（卸载路径也要干净）', () => {
    const { disposers } = mountHost();
    assert.ok(disposers.length >= 3, `期望至少 3 个 effect，实际 ${disposers.length}`);
    for (const dispose of disposers) {
      assert.doesNotThrow(() => dispose());
    }
  });
});

describe('工具 execute 端到端（真实写文件）', () => {
  /** 假 exec：cwd 指向临时工作区，等价于 GUI 里 agent 调工具时的上下文。 */
  const exec = { agent: { session: { header: { cwd: '' } } } };

  it('design_frame_write 落盘并在 design_status 里读回来', async () => {
    const { tools } = mountHost();
    const frameWrite = tools.find((tool) => tool.name === 'design_frame_write');
    const status = tools.find((tool) => tool.name === 'design_status');
    const runExec = { agent: { session: { header: { cwd: workspace } } } };

    const written = await frameWrite.execute(
      { name: '订单列表', html: '<!doctype html><h1>订单列表</h1>', width: 1280, height: 900 },
      runExec,
    );
    assert.equal(written.id, 'frame-1');
    assert.equal(written.file, 'frames/frame-1.html');
    assert.equal(written.bytes, Buffer.byteLength('<!doctype html><h1>订单列表</h1>', 'utf8'));

    // 用 read 工具读回内容一致（AC4 的完成判据）
    const onDisk = await readFile(join(workspace, '.design', 'frames', 'frame-1.html'), 'utf8');
    assert.equal(onDisk, '<!doctype html><h1>订单列表</h1>');

    const readBack = await status.execute({}, runExec);
    assert.equal(readBack.frames.length, 1);
    assert.equal(readBack.frames[0].name, '订单列表');
    assert.equal(readBack.project.version, 2);
  });

  it('design_canvas_apply 用工具写批注，design_status 能读出原文与 frameId（AC8）', async () => {
    const { tools } = mountHost();
    const canvasApply = tools.find((tool) => tool.name === 'design_canvas_apply');
    const status = tools.find((tool) => tool.name === 'design_status');
    const runExec = { agent: { session: { header: { cwd: workspace } } } };

    const applied = await canvasApply.execute(
      {
        ops: [
          { op: 'add_frame', id: 'orders-detail', name: '订单详情', html: '<h1>detail</h1>', width: 1280, height: 900 },
          { op: 'add_comment', frameId: 'orders-detail', text: '这个按钮太土了', x: 12, y: 34 },
          { op: 'select', frameId: 'orders-detail' },
        ],
      },
      runExec,
    );
    assert.deepEqual(applied.applied, ['add_frame:orders-detail', 'add_comment:comment-1', 'select']);

    const readBack = await status.execute({}, runExec);
    assert.equal(readBack.comments.length, 1);
    assert.equal(readBack.comments[0].text, '这个按钮太土了');
    assert.equal(readBack.comments[0].frameId, 'orders-detail');
    assert.equal(readBack.selection.frameId, 'orders-detail');
  });

  it('工具失败时抛出带错误码与路径的中文原因（AC12）', async () => {
    const { tools } = mountHost();
    const frameWrite = tools.find((tool) => tool.name === 'design_frame_write');
    const runExec = { agent: { session: { header: { cwd: workspace } } } };

    await assert.rejects(
      () => frameWrite.execute({ name: '空', html: '', width: 10, height: 10 }, runExec),
      (error) => {
        assert.match(error.message, /EEMPTY/u);
        assert.match(error.message, /0 字节/u);
        return true;
      },
    );

    await assert.rejects(
      () => frameWrite.execute({ name: '孤儿', html: '<p>x</p>', width: 10, height: 10 }, {}),
      (error) => {
        assert.match(error.message, /无法确定工作区/u);
        return true;
      },
    );
  });
});
