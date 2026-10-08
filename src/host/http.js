/**
 * 画布 → host 的写通道：注册在既有 `ctx.webServer` 上的同源 exact route。
 *
 * 为什么不用 typert `@Remote`：那需要 `@deepseek-ai/dsh-typert-generator` 生成的
 * `typert.host.js` / `typert.remote-client.js` 产物（生成文件头写着 "do not edit"），
 * 等于引入代码生成步骤与依赖，Lead 已裁定不做。
 * 为什么不用 session command：`command/run` / `command/done` 每次调用都会写进
 * session log，且 dsh-client-ui-chat 会把它们渲染成聊天行（kind:"command",
 * target:"chat"），高频拖拽会刷屏并违背 AC7「不打断用户」。
 *
 * 安全模型（Lead 硬要求，缺一条不算完成）：route 绕过了 `/api` 的信任栅栏，
 * 所以必须自己补同源护栏，避免任意 localhost 页面 POST 进来写用户工作区文件。
 *
 * @module dsh-design-canvas/host/http
 */

import {
  applyCanvasOps,
  DesignError,
  readStatus,
  writeFrame,
} from './design-project.js';
import { API_METHODS, ERROR_CODES, MAX_BODY_BYTES, ROUTE_PATH } from './types.js';

export { ROUTE_PATH };

/**
 * 统一的 JSON 响应。始终带 `{ok:true,...}` 或 `{ok:false,error}` 信封，
 * 客户端只需读 `body.ok`，不必分支状态码（状态码仍然给 curl/验收用）。
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} payload
 * @param {Record<string, string>} [extraHeaders] - 例如超限时补 `connection: close`。
 */
function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

/** 中文失败信封。 */
function sendError(res, status, code, message, path, extraHeaders) {
  sendJson(
    res,
    status,
    {
      ok: false,
      error: { code, message, ...(path === undefined ? {} : { path }) },
    },
    extraHeaders,
  );
}

/**
 * 同源校验：Origin 与 Sec-Fetch-Site 双重。
 *
 * 期望 origin 从请求自己的 Host 头推导（`http://<host>`），这样换端口、换主机名
 * 都不用改代码，同时不接受任何外部来源。
 */
function checkSameOrigin(req) {
  const host = req.headers.host;
  if (typeof host !== 'string' || host === '') {
    return { ok: false, message: '请求缺少 Host 头，无法校验同源。' };
  }
  const expected = `http://${host}`;

  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin !== '' && origin !== expected) {
    return { ok: false, message: `Origin 非同源：${origin}（期望 ${expected}）；只接受本站页面发起的写操作。` };
  }

  const site = req.headers['sec-fetch-site'];
  const siteValue = Array.isArray(site) ? site[0] : site;
  if (typeof siteValue === 'string' && siteValue !== '' && siteValue !== 'same-origin') {
    return { ok: false, message: `Sec-Fetch-Site 为 ${siteValue}，只接受 same-origin。` };
  }

  return { ok: true };
}

/** `application/json`（允许带 charset）。 */
function isJsonContentType(value) {
  if (typeof value !== 'string') return false;
  return /^application\/json\s*(;.*)?$/iu.test(value.trim());
}

/**
 * 有上限地读 body：超过上限立刻停止读取，但**绝不在这里销毁 socket**。
 *
 * 踩过的坑：早先写成"超限就 `req.destroy()` 再回 413"，结果是 socket 先没了、
 * 413 根本写不出去，curl 只看到 `HTTP 100` + `Empty reply from server`（exit 52），
 * 浏览器侧是 `Failed to fetch`。护栏拦住了写入是对的，但对外契约里的 413 变成了不可读。
 *
 * 现在的做法：`req.pause()` 停流 + 返回结果，由调用方带着 `connection: close`
 * 把 413 写完，再让 Node 关闭连接。
 *
 * @returns {Promise<{ok: true, text: string} | {ok: false, tooLarge: boolean}>}
 */
function readBody(req) {
  return new Promise((resolve) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    let settled = false;

    /** 收尾：解绑监听、只 resolve 一次。 */
    const settle = (result) => {
      if (settled) return;
      settled = true;
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      resolve(result);
    };

    /** @param {Buffer} chunk */
    function onData(chunk) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // 只停读，不销毁：销毁会让 413 写不出去（见上面的注释）。
        req.pause();
        settle({ ok: false, tooLarge: true });
        return;
      }
      chunks.push(chunk);
    }

    function onEnd() {
      settle({ ok: true, text: Buffer.concat(chunks).toString('utf8') });
    }

    function onError() {
      settle({ ok: false, tooLarge: false });
    }

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

/**
 * 解析 sessionId → workspace 根。
 *
 * 硬约束：**绝不接受客户端传来的路径**。路径只由 host 从 session 事实里取。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {unknown} sessionId
 */
function resolveWorkspace(ctx, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') {
    return { ok: false, code: ERROR_CODES.UNKNOWN, message: '缺少 sessionId；工作区路径由 host 解析，客户端不要传路径。' };
  }
  const agent = ctx.agents.get(/** @type {any} */ (sessionId));
  if (agent === undefined) {
    return { ok: false, code: ERROR_CODES.UNKNOWN, message: `会话不存在或已结束：${sessionId}` };
  }
  const cwd = agent.session.header.cwd;
  if (typeof cwd !== 'string' || cwd === '') {
    return { ok: false, code: ERROR_CODES.UNKNOWN, message: `会话 ${sessionId} 没有工作区路径（session.header.cwd 为空）` };
  }
  return { ok: true, cwd };
}

/** 分发三个逻辑方法。 */
async function dispatch(ctx, body) {
  const method = typeof body.method === 'string' ? body.method : body.ops !== undefined ? 'applyCanvasOps' : undefined;
  if (method === undefined) {
    return { status: 400, payload: { ok: false, error: { code: ERROR_CODES.UNKNOWN, message: `缺少 method；可用：${API_METHODS.join(' | ')}（也可只传 ops 直接应用画布操作）` } } };
  }
  if (!API_METHODS.includes(method)) {
    return { status: 400, payload: { ok: false, error: { code: ERROR_CODES.UNKNOWN, message: `未知 method=${JSON.stringify(method)}；可用：${API_METHODS.join(' | ')}` } } };
  }

  const workspace = resolveWorkspace(ctx, body.sessionId);
  if (!workspace.ok) {
    return { status: 400, payload: { ok: false, error: { code: workspace.code, message: workspace.message } } };
  }
  const cwd = workspace.cwd;

  try {
    if (method === 'readProject') {
      return { status: 200, payload: { ok: true, ...(await readStatus(cwd)) } };
    }
    if (method === 'writeFrame') {
      const result = await writeFrame(
        cwd,
        {
          id: typeof body.frameId === 'string' && body.frameId !== '' ? body.frameId : undefined,
          name: typeof body.name === 'string' ? body.name : undefined,
          html: body.html,
          width: typeof body.width === 'number' ? body.width : undefined,
          height: typeof body.height === 'number' ? body.height : undefined,
          x: typeof body.x === 'number' ? body.x : undefined,
          y: typeof body.y === 'number' ? body.y : undefined,
        },
        'user',
      );
      return { status: 200, payload: { ok: true, frame: result.frame, file: result.file, bytes: result.bytes, design: result.design } };
    }
    const result = await applyCanvasOps(cwd, body.ops, 'user');
    return { status: 200, payload: { ok: true, applied: result.applied, design: result.design } };
  } catch (error) {
    if (error instanceof DesignError) {
      return { status: 400, payload: error.toShape() };
    }
    const reason = error instanceof Error ? error.message : String(error);
    return { status: 500, payload: { ok: false, error: { code: ERROR_CODES.UNKNOWN, message: `设计写通道内部错误：${reason}` } } };
  }
}

/**
 * 路由处理器（导出以便单测直接打）。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
export async function handleDesignApi(ctx, req, res) {
  // 护栏 1：只接受 POST。
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST');
    sendError(res, 405, ERROR_CODES.UNKNOWN, `只接受 POST，收到 ${req.method ?? '未知'}。`);
    return;
  }

  // 护栏 2：同源（Origin + Sec-Fetch-Site）。
  const origin = checkSameOrigin(req);
  if (!origin.ok) {
    sendError(res, 403, ERROR_CODES.UNKNOWN, origin.message);
    return;
  }

  // 护栏 3：Content-Type 必须是 application/json（跨站表单无法伪造，且预检必失败）。
  if (!isJsonContentType(req.headers['content-type'])) {
    sendError(res, 415, ERROR_CODES.UNKNOWN, `Content-Type 必须是 application/json，收到 ${req.headers['content-type'] ?? '（缺失）'}。`);
    return;
  }

  // 护栏 4：body 上限 4MB。
  const body = await readBody(req);
  if (!body.ok) {
    if (body.tooLarge) {
      // 带 connection: close 把 413 写完，让 Node 在响应后关连接；
      // 请求体已被 pause，不会再被读进内存。
      sendError(
        res,
        413,
        ERROR_CODES.UNKNOWN,
        `请求体超过 ${MAX_BODY_BYTES} 字节（4MiB）上限，已拒绝；请改用 applyCanvasOps 分批提交。`,
        undefined,
        { connection: 'close' },
      );
    } else {
      sendError(res, 400, ERROR_CODES.UNKNOWN, '读取请求体失败。');
    }
    return;
  }

  /** @type {any} */
  let parsed;
  try {
    parsed = JSON.parse(body.text === '' ? '{}' : body.text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    sendError(res, 400, ERROR_CODES.UNKNOWN, `请求体不是合法 JSON：${reason}`);
    return;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    sendError(res, 400, ERROR_CODES.UNKNOWN, '请求体必须是 JSON 对象。');
    return;
  }

  const { status, payload } = await dispatch(ctx, parsed);
  sendJson(res, status, payload);
}

/**
 * 注册画布写通道。
 * @param {import('@deepseek-ai/cordis').Context} ctx - 已 inject webServer / agents 的 host 上下文。
 * @returns {() => void} 卸载函数。
 */
export function registerDesignRoute(ctx) {
  return ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_PATH,
    handler: (req, res) => handleDesignApi(ctx, req, res),
  });
}
