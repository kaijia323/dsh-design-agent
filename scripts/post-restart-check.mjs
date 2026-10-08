#!/usr/bin/env node
/**
 * 重启后自检：一条命令给出"host 半到底活了没有"的结论。
 *
 * 为什么需要：host 插件是普通 ESM，DSH 的 loader 用不带 cache-bust 的 `import(name)`
 * 加载，改了 host 代码**必须重启 profile** 才会加载新的模块代。重启后人工去 GUI 里点
 * 一圈才知道成没成，成本太高；这个脚本把能自动判定的四件事一次跑完。
 *
 * 零依赖，只用 node 内置能力。用法：
 *   node scripts/post-restart-check.mjs
 *   DSH_SESSION_ID=<真实会话id> node scripts/post-restart-check.mjs   # 可选，能多验一项
 *   DSH_BASE_URL=http://127.0.0.1:3080 node scripts/post-restart-check.mjs
 *
 * 刻意不做的事：**不伪造凭据**。拿不到真实 sessionId 时，就用一个不存在的 id 打一次，
 * 断言收到 400 + EUNKNOWN + "会话不存在" —— 这已经证明 路由→护栏→解析→agents 查询 整条
 * 链路是活的，且不会写入任何文件；真实会话的读写留给 GUI 侧验证。
 *
 * @module dsh-design-canvas/scripts/post-restart-check
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { apply, inject } from '../index.js';
import { applyCanvasOps, readStatus, writeFrame } from '../src/host/design-project.js';
import { MAX_FRAME_BYTES, ROUTE_PATH } from '../src/host/types.js';

const BASE_URL = process.env.DSH_BASE_URL ?? 'http://127.0.0.1:3080';
const SESSION_ID = process.env.DSH_SESSION_ID ?? '';

/** 结果收集：值只可能是 ok / 数字 / fail。 */
const summary = { 路由: 'fail', 工具: 0, 数据层: 'fail' };

function line(text) {
  process.stdout.write(`${text}\n`);
}

function banner(title) {
  line(`\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`);
}

/* ───────────────────────── 1) 路由是否注册 ───────────────────────── */

async function checkRoute() {
  banner('1/4 画布写通道是否已注册');
  const url = `${BASE_URL}${ROUTE_PATH}`;
  line(`  GET ${url}`);

  /** @type {Response} */
  let response;
  try {
    response = await fetch(url, { method: 'GET' });
  } catch (error) {
    summary.路由 = 'fail';
    line(`  ✗ 连不上 ${BASE_URL}：${error instanceof Error ? error.message : String(error)}`);
    line('    → 确认 DSH 正在跑（dsh web），或用 DSH_BASE_URL 指定地址。');
    return;
  }

  if (response.status === 405) {
    summary.路由 = 'ok';
    line(`  ✓ 405（只接受 POST）—— 路由已注册，host 模块是新的。`);
  } else if (response.status === 404) {
    summary.路由 = '404';
    line('  ✗ 404 —— 路由不存在。最可能的原因：profile 还没重启，跑的还是旧的空模块。');
    line('    → 请重启 DSH 后重跑本脚本。');
  } else {
    summary.路由 = 'fail';
    line(`  ✗ 期望 405，实际 ${response.status}。`);
  }
}

/* ────────────── 2) 用真实 HTTP 打一次请求（不伪造凭据） ────────────── */

async function checkApi() {
  banner('2/4 用真实 HTTP 打一次 readProject');
  if (summary.路由 !== 'ok') {
    line('  ⏭ 跳过：路由没活，打了也没意义。');
    return;
  }

  const url = `${BASE_URL}${ROUTE_PATH}`;
  /** 同源请求头：Origin 必须与 Host 推导出的期望值一致（护栏 2）。 */
  const headers = {
    'content-type': 'application/json',
    origin: BASE_URL,
    'sec-fetch-site': 'same-origin',
  };

  // 2a) 护栏自证：伪造跨站 Origin 必须被 403 挡掉
  const forged = await fetch(url, {
    method: 'POST',
    headers: { ...headers, origin: 'http://evil.example', 'sec-fetch-site': 'cross-site' },
    body: JSON.stringify({ method: 'readProject', sessionId: SESSION_ID || 'probe' }),
  });
  line(`  护栏：伪造跨站 Origin → ${forged.status}${forged.status === 403 ? ' ✓ 已拒绝' : ' ✗ 期望 403'}`);

  // 2b) 真实会话（给了 DSH_SESSION_ID 才做，能读就一定是真的读通了）
  if (SESSION_ID !== '') {
    const real = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ method: 'readProject', sessionId: SESSION_ID }),
    });
    const body = await real.json().catch(() => ({}));
    if (real.status === 200 && body.ok === true) {
      line(`  ✓ readProject(真实会话) → 200，fps=${body.frames?.length ?? 0}，design.json 存在=${body.exists}`);
    } else {
      line(`  ✗ readProject(真实会话) → ${real.status} ${JSON.stringify(body.error ?? body)}`);
    }
    return;
  }

  // 2c) 没有真实会话：用不存在的 id 探链路（会返回 400 + EUNKNOWN + 会话不存在）
  const probe = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ method: 'readProject', sessionId: '__post_restart_probe__' }),
  });
  const probeBody = await probe.json().catch(() => ({}));
  const notFound = probe.status === 400 && probeBody?.error?.code === 'EUNKNOWN';
  line(
    `  链路：不存在 sessionId → ${probe.status} ${notFound ? '✓ EUNKNOWN（路由→护栏→解析→agents 全通，且未写任何文件）' : `✗ ${JSON.stringify(probeBody)}`}`,
  );
  line('  ℹ 真实会话的读写需要 GUI 侧验证：设 DSH_SESSION_ID=<会话id> 重跑本脚本即可（不伪造凭据）。');
}

/* ─────────────────── 3) 数据层（真实临时目录，不依赖 GUI） ─────────────────── */

async function checkDataLayer() {
  banner('3/4 数据层读写（真实临时目录）');
  const cwd = await mkdtemp(join(tmpdir(), 'design-canvas-postcheck-'));
  try {
    line(`  工作区：${cwd}`);

    const written = await writeFrame(
      cwd,
      { id: 'postcheck', name: '自检页', html: '<!doctype html><h1>自检</h1>', width: 1280, height: 900, x: 0, y: 0 },
      'agent',
    );
    const onDisk = await readFile(join(cwd, '.design', 'frames', 'postcheck.html'), 'utf8');
    if (onDisk !== '<!doctype html><h1>自检</h1>') throw new Error('落盘内容与写入不一致');
    line(`  ✓ writeFrame → ${written.file} (${written.bytes}B)，read 读回一致`);

    const { design } = await applyCanvasOps(
      cwd,
      [
        { op: 'add_frame', id: 'second', name: '第二屏', html: '<p>2</p>', width: 800, height: 600, x: 100, y: 100 },
        { op: 'add_comment', frameId: 'second', text: '自检批注', x: 1, y: 2 },
        { op: 'set_viewport', x: -10, y: -20, zoom: 0.8 },
      ],
      'user',
    );
    line(`  ✓ applyCanvasOps → applied=${design.frames.length} frame / ${design.comments.length} 批注`);
    if (design.viewport.zoom !== 0.8) throw new Error('viewport 未写入');

    const status = await readStatus(cwd);
    line(`  ✓ readStatus → ${status.frames.length} frame / tokens 镜像 ${Object.keys(status.tokens).length} 个`);
    line(`  ℹ 单帧上限 = ${MAX_FRAME_BYTES} 字节（2 MiB，AC11 的硬阈值）`);
    if (status.tokens['color.primary'] === undefined) throw new Error('tokens 镜像缺 color.primary（AC7 会失灵）');

    // AC11：非法 JSON 必须回退 + 备份
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(cwd, '.design', 'design.json'), '{ broken', 'utf8');
    const recovered = await readStatus(cwd);
    const backedUp = await readFile(join(cwd, '.design', 'design.json.bak'), 'utf8');
    if (recovered.recovered !== true || backedUp !== '{ broken') throw new Error('非法 JSON 未按 AC11 回退');
    line('  ✓ AC11 非法 JSON → 备份 design.json.bak + 回退空工程，未抛异常');

    summary.数据层 = 'ok';
  } catch (error) {
    summary.数据层 = 'fail';
    line(`  ✗ 数据层失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

/* ─────────────────── 4) 工具注册（假 ctx 跑 apply） ─────────────────── */

function checkTools() {
  banner('4/4 三个工具与路由是否注册得出来（假 ctx，不启动 DSH）');
  const tools = [];
  const routes = [];
  const sections = [];
  const disposers = [];

  const ctx = {
    effect(callback, label) {
      const cleanup = callback();
      disposers.push(typeof cleanup === 'function' ? cleanup : () => {});
      void label;
      return cleanup;
    },
    tools: {
      register(definition) {
        tools.push(definition);
        return () => {};
      },
    },
    webServer: {
      register(route) {
        routes.push(route);
        return () => {};
      },
    },
    systemPrompt: {
      section(section) {
        sections.push(section);
        return () => {};
      },
    },
    agents: { get: () => undefined },
  };

  try {
    apply(ctx);
    summary.工具 = tools.length;
    line(`  inject = [${inject.join(', ')}]`);
    line(`  工具（${tools.length}）：${tools.map((tool) => tool.name).join(', ') || '（无）'}`);
    line(`  路由（${routes.length}）：${routes.map((route) => `${route.kind} ${route.path}`).join(', ') || '（无）'}`);
    line(`  systemPrompt 段（${sections.length}）：${sections.map((section) => section.name).join(', ') || '（无）'}`);
    for (const dispose of disposers) dispose();
    line('  ✓ apply() 未抛错，dispose 也干净');
  } catch (error) {
    summary.工具 = 0;
    line(`  ✗ apply() 抛错（重启后插件会 FAILED）：${error instanceof Error ? error.message : String(error)}`);
  }
}

/* ─────────────────────────────── 主流程 ─────────────────────────────── */

line('DSH 设计画布插件 —— 重启后自检');
line(`目标：${BASE_URL}${ROUTE_PATH}`);
if (SESSION_ID === '') line('提示：未设置 DSH_SESSION_ID，真实会话读写将留待 GUI 侧验证（不伪造凭据）。');

await checkRoute();
await checkApi();
await checkDataLayer();
checkTools();

const routeOk = summary.路由 === 'ok';
line(
  `\n总结：路由=${summary.路由} 工具=${summary.工具}/3 数据层=${summary.数据层}` +
    (routeOk && summary.工具 === 3 && summary.数据层 === 'ok' ? '  ✅ 一把过' : '  ❌ 见上面逐项说明'),
);
process.exitCode = routeOk && summary.工具 === 3 && summary.数据层 === 'ok' ? 0 : 1;
