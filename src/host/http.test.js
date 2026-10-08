/**
 * 画布写通道的护栏测试：只接受同源 POST + JSON，且从不采信客户端传来的路径。
 *
 * 这些用例就是 Lead 那 5 条硬护栏与 AC12 的证据；T5 会用"伪造 Origin 的跨站 POST"
 * 在真实 GUI 上再打一次。
 *
 * 运行：`node --test src/host/http.test.js`
 *
 * @module dsh-design-canvas/host/http.test
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { after, before, describe, it } from 'node:test';

import { handleDesignApi } from './http.js';
import { MAX_BODY_BYTES, ROUTE_PATH } from './types.js';

/** 真实临时工作区，作为唯一被允许的写入目标。 */
let workspace;
before(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'design-canvas-http-'));
});
after(async () => {
  await rm(workspace, { recursive: true, force: true });
});

/** 只有 s1 这一个已知会话，cwd 指向临时工作区。 */
const ctx = {
  agents: {
    get(sessionId) {
      if (sessionId !== 's1') return undefined;
      return { session: { header: { cwd: workspace } } };
    },
  },
};

/** 造一个够真的 IncomingMessage：可异步迭代，带 method/headers。 */
function fakeRequest({ method = 'POST', headers = {}, body = '' } = {}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  const stream = Readable.from(payload.length === 0 ? [] : [payload]);
  return Object.assign(stream, {
    method,
    headers: { host: '127.0.0.1:3080', ...headers },
  });
}

/** 造一个够真的 ServerResponse：记下状态码、头、正文。 */
function fakeResponse() {
  return {
    status: undefined,
    headers: undefined,
    body: undefined,
    headersSent: false,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
      this.headersSent = true;
    },
    setHeader() {},
    end(chunk) {
      this.body = chunk === undefined ? '' : String(chunk);
    },
    destroy() {},
  };
}

/** 发一次请求并返回解析后的响应。 */
async function call(options) {
  const req = fakeRequest(options);
  const res = fakeResponse();
  await handleDesignApi(ctx, req, res);
  return { status: res.status, headers: res.headers, json: JSON.parse(res.body) };
}

/** 一个合法请求的公共头。 */
const okHeaders = {
  origin: 'http://127.0.0.1:3080',
  'sec-fetch-site': 'same-origin',
  'content-type': 'application/json',
};

describe('护栏 1：只接受 POST', () => {
  it('GET → 405 且带 Allow: POST', async () => {
    const { status, json } = await call({ method: 'GET', headers: okHeaders });
    assert.equal(status, 405);
    assert.equal(json.ok, false);
  });

  it('OPTIONS → 405（不返回任何 CORS 头，跨站预检必失败）', async () => {
    const { status, headers } = await call({ method: 'OPTIONS', headers: okHeaders });
    assert.equal(status, 405);
    assert.equal(headers['access-control-allow-origin'], undefined);
  });
});

describe('护栏 2：同源（Origin + Sec-Fetch-Site）', () => {
  it('伪造跨站 Origin → 403', async () => {
    const { status, json } = await call({
      headers: { ...okHeaders, origin: 'http://evil.example' },
      body: JSON.stringify({ sessionId: 's1', ops: [] }),
    });
    assert.equal(status, 403);
    assert.match(json.error.message, /Origin 非同源/u);
    assert.ok(json.error.message.includes('http://evil.example'));
  });

  it('Sec-Fetch-Site: cross-site → 403（即使 Origin 缺失）', async () => {
    const { status, json } = await call({
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
      body: JSON.stringify({ sessionId: 's1', ops: [] }),
    });
    assert.equal(status, 403);
    assert.match(json.error.message, /Sec-Fetch-Site/u);
  });

  it('同源 Origin 但端口不同 → 403', async () => {
    const { status } = await call({
      headers: { ...okHeaders, origin: 'http://127.0.0.1:9999' },
      body: JSON.stringify({ sessionId: 's1', ops: [] }),
    });
    assert.equal(status, 403);
  });
});

describe('护栏 3：Content-Type 必须 application/json', () => {
  it('缺失 content-type → 415', async () => {
    const { status } = await call({
      headers: { origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' },
      body: '{}',
    });
    assert.equal(status, 415);
  });

  it('text/plain（跨站表单能发的类型）→ 415', async () => {
    const { status } = await call({
      headers: { ...okHeaders, 'content-type': 'text/plain' },
      body: '{"sessionId":"s1","ops":[]}',
    });
    assert.equal(status, 415);
  });

  it('application/json; charset=utf-8 允许', async () => {
    const { status } = await call({
      headers: { ...okHeaders, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ method: 'readProject', sessionId: 's1' }),
    });
    assert.equal(status, 200);
  });
});

describe('护栏 4：请求体上限 4MB', () => {
  it('超过上限 → 413', async () => {
    const huge = Buffer.alloc(MAX_BODY_BYTES + 1024, 0x20);
    const { status, json } = await call({ headers: okHeaders, body: huge });
    assert.equal(status, 413);
    assert.match(json.error.message, /上限/u);
  });
});

describe('护栏 5：绝不接受客户端传来的路径', () => {
  it('客户端传 cwd/path 一律忽略，只按 sessionId 解析工作区', async () => {
    const { status, json } = await call({
      headers: okHeaders,
      body: JSON.stringify({
        method: 'applyCanvasOps',
        sessionId: 's1',
        cwd: '/etc',
        path: '/etc/passwd',
        ops: [{ op: 'add_frame', id: 'probe', name: '探针', html: '<p>p</p>', width: 10, height: 10 }],
      }),
    });
    assert.equal(status, 200);
    assert.equal(json.ok, true);

    // 文件落在 session 的工作区，而不是 /etc
    const onDisk = JSON.parse(await readFile(join(workspace, '.design', 'design.json'), 'utf8'));
    assert.ok(onDisk.frames.some((frame) => frame.id === 'probe'));
    assert.equal(json.design.updatedBy, 'user');
  });

  it('未知 sessionId → 400 且不写任何文件', async () => {
    const { status, json } = await call({
      headers: okHeaders,
      body: JSON.stringify({ sessionId: 'nope', ops: [] }),
    });
    assert.equal(status, 400);
    assert.equal(json.error.code, 'EUNKNOWN');
    assert.match(json.error.message, /会话不存在/u);
  });

  it('缺少 sessionId → 400', async () => {
    const { status, json } = await call({ headers: okHeaders, body: JSON.stringify({ ops: [] }) });
    assert.equal(status, 400);
    assert.match(json.error.message, /sessionId/u);
  });
});

describe('逻辑方法（Lead 冻结的三个）', () => {
  it('readProject 返回 {ok:true, project}', async () => {
    const { status, json } = await call({
      headers: okHeaders,
      body: JSON.stringify({ method: 'readProject', sessionId: 's1' }),
    });
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.ok(Array.isArray(json.project.frames));
    assert.equal(json.project.version, 2);
  });

  it('writeFrame 写文件并返回 frame', async () => {
    const html = '<h1>订单列表</h1>';
    const { status, json } = await call({
      headers: okHeaders,
      body: JSON.stringify({
        method: 'writeFrame',
        sessionId: 's1',
        frameId: 'orders',
        name: '订单列表',
        html,
        width: 1280,
        height: 900,
      }),
    });
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.frame.id, 'orders');
    assert.equal(json.frame.file, 'frames/orders.html');
    assert.equal(json.bytes, Buffer.byteLength(html, 'utf8'));
    assert.equal(await readFile(join(workspace, '.design', 'frames', 'orders.html'), 'utf8'), html);
  });

  it('applyCanvasOps 返回 {applied, design}', async () => {
    const { status, json } = await call({
      headers: okHeaders,
      body: JSON.stringify({
        sessionId: 's1',
        ops: [{ op: 'move_frame', id: 'orders', x: 400, y: 200 }],
      }),
    });
    assert.equal(status, 200);
    assert.deepEqual(json.applied, ['move_frame:orders']);
    assert.equal(json.design.frames.find((frame) => frame.id === 'orders').x, 400);
  });

  it('逻辑失败走 400 + {ok:false,error{code,message,path?}}', async () => {
    const { status, json } = await call({
      headers: okHeaders,
      body: JSON.stringify({ sessionId: 's1', ops: [{ op: 'move_frame', id: 'ghost', x: 1, y: 1 }] }),
    });
    assert.equal(status, 400);
    assert.equal(json.ok, false);
    assert.equal(json.error.code, 'ENOFRAME');
    assert.ok(typeof json.error.message === 'string' && json.error.message.length > 0);
  });

  it('未知 method → 400 EUNKNOWN', async () => {
    const { status, json } = await call({
      headers: okHeaders,
      body: JSON.stringify({ method: 'drop_database', sessionId: 's1' }),
    });
    assert.equal(status, 400);
    assert.equal(json.error.code, 'EUNKNOWN');
  });

  it('非法 JSON 请求体 → 400', async () => {
    const { status, json } = await call({ headers: okHeaders, body: '{ not json' });
    assert.equal(status, 400);
    assert.match(json.error.message, /不是合法 JSON/u);
  });
});

describe('路由路径', () => {
  it('冻结路径是 /design-canvas/api（exact）', () => {
    assert.equal(ROUTE_PATH, '/design-canvas/api');
  });
});

describe('真实 socket（不是 mock req/res）', () => {
  /** 起一个真实 node:http 服务，只挂我们的 handler。 */
  async function withServer(run) {
    const { createServer } = await import('node:http');
    const server = createServer((req, res) => {
      handleDesignApi(ctx, req, res).catch(() => {
        res.writeHead(500);
        res.end();
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
    try {
      await run(`http://127.0.0.1:${port}`);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  it('同源 POST 走通，跨站 Origin 被 403', async () => {
    await withServer(async (base) => {
      const okResponse = await fetch(`${base}/design-canvas/api`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: base,
          'sec-fetch-site': 'same-origin',
        },
        body: JSON.stringify({ method: 'readProject', sessionId: 's1' }),
      });
      assert.equal(okResponse.status, 200);
      const okBody = await okResponse.json();
      assert.equal(okBody.ok, true);
      assert.ok(Array.isArray(okBody.project.frames));

      const forged = await fetch(`${base}/design-canvas/api`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://evil.example',
          'sec-fetch-site': 'cross-site',
        },
        body: JSON.stringify({ method: 'readProject', sessionId: 's1' }),
      });
      assert.equal(forged.status, 403);
      assert.equal((await forged.json()).ok, false);
      assert.equal(forged.headers.get('access-control-allow-origin'), null);
    });
  });

  it('真实 GET 得到 405', async () => {
    await withServer(async (base) => {
      const response = await fetch(`${base}/design-canvas/api`);
      assert.equal(response.status, 405);
      assert.equal(response.headers.get('allow'), 'POST');
    });
  });

  it('真实 socket：body 超过 4MiB 必须回 413 + JSON 信封，不能是连接重置', async () => {
    await withServer(async (base) => {
      const huge = Buffer.alloc(MAX_BODY_BYTES + 4096, 0x20); // 4MiB + 4KiB
      /** @type {Response} */
      let response;
      try {
        response = await fetch(`${base}/design-canvas/api`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: base,
            'sec-fetch-site': 'same-origin',
          },
          body: huge,
        });
      } catch (error) {
        // 连接被重置时 fetch 直接 reject —— 这正是要防的回归（客户端只会看到 "Failed to fetch"）
        assert.fail(`超限请求应拿到 413 响应，实际连接失败：${error instanceof Error ? error.message : String(error)}`);
      }

      assert.equal(response.status, 413, '必须是 413，而不是连接重置');
      const text = await response.text();
      assert.ok(text.length > 0, '响应体不能为空（空响应 = 客户端拿不到原因）');
      const body = JSON.parse(text);
      assert.equal(body.ok, false);
      assert.equal(typeof body.error.code, 'string');
      assert.match(body.error.message, /上限/u);
    });
  });
});
