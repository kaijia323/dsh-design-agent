/**
 * design-project 的单元测试：读写、非法 JSON 回退、超限拒绝、op 整批拒绝、只读目录。
 *
 * 运行：`node --test src/host/`
 * 说明：这里用真实临时目录 + 真实文件，不打桩 —— AC11/AC12 说的就是真实文件行为。
 *
 * @module dsh-design-agent/host/design-project.test
 */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  DesignError,
  applyCanvasOps,
  emptyProject,
  parseTokensCss,
  readProject,
  readStatus,
  readTokenPreset,
  writeFrame,
} from './design-project.js';
import { ERROR_CODES, MAX_FRAME_BYTES } from './types.js';

/** 每个用例一个隔离的 workspace 根。 */
let root;
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'design-agent-test-'));
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

/** 建一个空 workspace。 */
async function freshWorkspace(name) {
  const cwd = join(root, name);
  await mkdir(cwd, { recursive: true });
  return cwd;
}

/** 断言抛出的 DesignError 带指定 code。 */
async function assertDesignError(promise, code) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof DesignError, `期望 DesignError，实际 ${error?.constructor?.name}: ${error?.message}`);
    assert.equal(error.code, code);
    return error;
  }
  throw new Error(`期望抛出 ${code}，但调用成功返回了`);
}

describe('写一屏 + 读回一致（AC4 基础）', () => {
  it('design_frame_write 落盘 frames/<id>.html 与 design.json，read 工具读回一致', async () => {
    const cwd = await freshWorkspace('write-frame');
    const html = '<!doctype html><html lang="zh"><body><h1>订单列表</h1></body></html>';

    const result = await writeFrame(cwd, { name: '订单列表', html, width: 1280, height: 900 }, 'agent');
    assert.equal(result.id, 'frame-1');
    assert.equal(result.file, 'frames/frame-1.html');
    assert.equal(result.bytes, Buffer.byteLength(html, 'utf8'));

    // 真实文件存在且内容一致
    const onDisk = await readFile(join(cwd, '.design', 'frames', 'frame-1.html'), 'utf8');
    assert.equal(onDisk, html);

    // design.json 里 frame 字段齐全（AC4 要求 id/name/width/height/x/y）
    const design = JSON.parse(await readFile(join(cwd, '.design', 'design.json'), 'utf8'));
    assert.equal(design.frames.length, 1);
    const frame = design.frames[0];
    for (const key of ['id', 'name', 'file', 'width', 'height', 'x', 'y']) {
      assert.ok(key in frame, `design.json 的 frame 缺字段 ${key}`);
    }
    assert.equal(frame.id, 'frame-1');
    assert.equal(frame.width, 1280);
    assert.equal(frame.file, 'frames/frame-1.html');

    // design_status 的读路径
    const status = await readStatus(cwd);
    assert.equal(status.frames.length, 1);
    assert.equal(status.exists, true);
    assert.equal(status.recovered, false);
  });

  it('覆盖同一 id 时更新而不是重复登记，并保留原坐标', async () => {
    const cwd = await freshWorkspace('overwrite');
    await writeFrame(cwd, { id: 'hero', name: '首页', html: '<h1>A</h1>', width: 1440, height: 900, x: 10, y: 20 }, 'agent');
    const second = await writeFrame(cwd, { id: 'hero', name: '首页', html: '<h1>B</h1>', width: 1440, height: 900 }, 'agent');
    assert.equal(second.design.frames.length, 1);
    assert.equal(second.design.frames[0].x, 10, '未传 x 时应保留原坐标');
    assert.equal(await readFile(join(cwd, '.design', 'frames', 'hero.html'), 'utf8'), '<h1>B</h1>');
  });
});

describe('非法 JSON 回退（AC11）', () => {
  it('design.json 被改成非法 JSON 时备份为 design.json.bak 并回退空工程，不抛异常', async () => {
    const cwd = await freshWorkspace('bad-json');
    const designDir = join(cwd, '.design');
    await mkdir(designDir, { recursive: true });
    await writeFile(join(designDir, 'design.json'), '{ "frames": [ this is not json', 'utf8');

    const result = await readProject(cwd);
    assert.equal(result.recovered, true, '应标记为已回退');
    assert.equal(result.project.frames.length, 0, '应回退空工程');
    assert.ok(result.warning?.includes('design.json.bak'), 'warning 里应说明备份路径');

    // 坏文件真的被另存了，且内容是原始坏文本
    const backup = await readFile(join(designDir, 'design.json.bak'), 'utf8');
    assert.equal(backup, '{ "frames": [ this is not json');

    // 回退后仍可正常写入
    const written = await writeFrame(cwd, { name: '恢复', html: '<p>ok</p>', width: 100, height: 100 }, 'agent');
    assert.equal(written.design.frames.length, 1);
  });

  it('design.json 顶层是数组时同样按非法处理', async () => {
    const cwd = await freshWorkspace('array-json');
    await mkdir(join(cwd, '.design'), { recursive: true });
    await writeFile(join(cwd, '.design', 'design.json'), '[]', 'utf8');
    const result = await readProject(cwd);
    assert.equal(result.recovered, true);
    assert.equal(result.project.version, 2);
  });
});

describe('单帧大小边界（AC11）', () => {
  it('0 字节 → EEMPTY，且不落盘', async () => {
    const cwd = await freshWorkspace('empty-frame');
    const error = await assertDesignError(
      writeFrame(cwd, { id: 'blank', name: '空白', html: '', width: 100, height: 100 }, 'agent'),
      ERROR_CODES.EMPTY,
    );
    assert.match(error.message, /0 字节/u);
    await assert.rejects(stat(join(cwd, '.design', 'frames', 'blank.html')));
  });

  it('超过 2MB → ETOOLARGE，且不落盘', async () => {
    const cwd = await freshWorkspace('huge-frame');
    const html = 'x'.repeat(MAX_FRAME_BYTES + 1);
    const error = await assertDesignError(
      writeFrame(cwd, { id: 'huge', name: '超大', html, width: 100, height: 100 }, 'agent'),
      ERROR_CODES.TOOLARGE,
    );
    assert.match(error.message, /2MB/u);
    await assert.rejects(stat(join(cwd, '.design', 'frames', 'huge.html')));
  });

  it('正好 2MB 允许写入', async () => {
    const cwd = await freshWorkspace('exact-frame');
    const html = 'y'.repeat(MAX_FRAME_BYTES);
    const result = await writeFrame(cwd, { id: 'exact', name: '刚好', html, width: 10, height: 10 }, 'agent');
    assert.equal(result.bytes, MAX_FRAME_BYTES);
  });

  it('AC11 的七个边界值：阈值是 2 MiB = 2,097,152 字节（不是十进制 2,000,000）', async () => {
    assert.equal(MAX_FRAME_BYTES, 2 * 1024 * 1024);
    assert.equal(MAX_FRAME_BYTES, 2_097_152);

    const cwd = await freshWorkspace('boundaries');
    /** 验收会打的七个值 -> 期望结果 */
    const cases = [
      { bytes: 0, ok: false, code: ERROR_CODES.EMPTY },
      { bytes: 1, ok: true },
      { bytes: 1_999_999, ok: true },
      { bytes: 2_000_000, ok: true },
      { bytes: 2_000_001, ok: true },
      { bytes: 2_097_152, ok: true },
      { bytes: 2_097_153, ok: false, code: ERROR_CODES.TOOLARGE },
    ];

    for (const testCase of cases) {
      const id = `b${testCase.bytes}`;
      const html = 'z'.repeat(testCase.bytes);
      if (testCase.ok) {
        const result = await writeFrame(cwd, { id, name: id, html, width: 10, height: 10 }, 'agent');
        assert.equal(result.bytes, testCase.bytes, `${testCase.bytes} 字节应写入成功`);
      } else {
        const error = await assertDesignError(
          writeFrame(cwd, { id, name: id, html, width: 10, height: 10 }, 'agent'),
          testCase.code,
        );
        assert.ok(error.message.length > 0);
        await assert.rejects(stat(join(cwd, '.design', 'frames', `${id}.html`)), `${testCase.bytes} 字节不应落盘`);
      }
    }
  });
});

describe('只读目录（AC12）', () => {
  it('.design 是普通文件时写入失败，错误含路径与原因', async () => {
    const cwd = await freshWorkspace('blocked-by-file');
    await writeFile(join(cwd, '.design'), 'not a directory', 'utf8');

    const error = await assertDesignError(
      writeFrame(cwd, { name: '写不进去', html: '<p>x</p>', width: 10, height: 10 }, 'agent'),
      ERROR_CODES.NOWRITE,
    );
    assert.ok(error.message.includes(join(cwd, '.design')), `message 应含失败路径，实际：${error.message}`);
    assert.ok(error.path?.startsWith(join(cwd, '.design')), 'error.path 应是失败的绝对路径');
    assert.match(error.message, /无法(创建目录|写入|读取)/u);
    assert.match(error.message, /ENOTDIR|EEXIST/u);
  });

  it('目录权限只读时写入失败并报 ENOWRITE（root 下自动跳过）', async (t) => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      t.skip('以 root 运行，权限位拦不住写入，跳过');
      return;
    }
    const cwd = await freshWorkspace('readonly-dir');
    const designDir = join(cwd, '.design');
    // 注意：必须让 frames/ 不存在。目录只读只挡"新建/删除条目"，
    // 已存在且自身可写的 design.json 仍能被覆盖，那样就测不到 EACCES。
    await mkdir(designDir, { recursive: true });
    await writeFile(join(designDir, 'design.json'), JSON.stringify(emptyProject()), 'utf8');
    await chmod(designDir, 0o555);

    try {
      const error = await assertDesignError(
        writeFrame(cwd, { name: '只读', html: '<p>x</p>', width: 10, height: 10 }, 'agent'),
        ERROR_CODES.NOWRITE,
      );
      assert.ok(error.message.includes(designDir), `message 应含失败路径，实际：${error.message}`);
      assert.match(error.message, /EACCES|permission denied|EPERM/u);
    } finally {
      await chmod(designDir, 0o755);
    }
  });
});

describe('画布操作 applyCanvasOps', () => {
  it('新增/移动/改尺寸/重命名/批注/选中/视口 一次跑通', async () => {
    const cwd = await freshWorkspace('ops');
    const { applied, design } = await applyCanvasOps(
      cwd,
      [
        { op: 'add_frame', name: '订单列表', html: '<h1>orders</h1>', width: 1280, height: 900, x: 0, y: 0 },
        { op: 'move_frame', id: 'frame-1', x: 640, y: 120 },
        { op: 'resize_frame', id: 'frame-1', width: 1440, height: 1000 },
        { op: 'rename_frame', id: 'frame-1', name: '订单列表页' },
        { op: 'add_comment', frameId: 'frame-1', text: '这个按钮太土了', x: 100, y: 200 },
        { op: 'select', frameId: 'frame-1' },
        { op: 'set_viewport', x: -100, y: -50, zoom: 0.75 },
      ],
      'user',
    );

    assert.deepEqual(applied, [
      'add_frame:frame-1',
      'move_frame:frame-1',
      'resize_frame:frame-1',
      'rename_frame:frame-1',
      'add_comment:comment-1',
      'select',
      'set_viewport',
    ]);

    const frame = design.frames[0];
    assert.equal(frame.x, 640);
    assert.equal(frame.width, 1440);
    assert.equal(frame.name, '订单列表页');
    assert.equal(frame.status, 'draft');
    assert.equal(design.comments.length, 1);
    assert.equal(design.comments[0].text, '这个按钮太土了'); // AC8：批注原文
    assert.equal(design.comments[0].frameId, 'frame-1'); // AC8：所属 frameId
    assert.equal(design.comments[0].resolved, false);
    assert.equal(design.selection.frameId, 'frame-1');
    assert.deepEqual(design.viewport, { x: -100, y: -50, zoom: 0.75 });

    // AC5：视口与坐标真的写进文件，刷新浏览器还在
    const onDisk = JSON.parse(await readFile(join(cwd, '.design', 'design.json'), 'utf8'));
    assert.equal(onDisk.frames[0].x, 640);
    assert.equal(onDisk.viewport.zoom, 0.75);
    assert.equal(onDisk.updatedBy, 'user');
  });

  it('判别字段兼容 kind（Lead 早期冻结稿写法），内部归一化为 op', async () => {
    const cwd = await freshWorkspace('kind-alias');
    const { applied, design } = await applyCanvasOps(
      cwd,
      [
        { kind: 'add_frame', name: 'A', html: '<p>a</p>', width: 10, height: 10 },
        { kind: 'move_frame', id: 'frame-1', x: 7, y: 9 },
      ],
      'user',
    );
    assert.deepEqual(applied, ['add_frame:frame-1', 'move_frame:frame-1']);
    assert.equal(design.frames[0].x, 7);
  });

  it('未知 op → EUNKNOWN，且整批不落地（无部分应用）', async () => {
    const cwd = await freshWorkspace('unknown-op');
    await applyCanvasOps(cwd, [{ op: 'add_frame', name: 'A', html: '<p>a</p>', width: 10, height: 10 }], 'agent');
    const before = await readFile(join(cwd, '.design', 'design.json'), 'utf8');

    await assertDesignError(
      applyCanvasOps(
        cwd,
        [
          { op: 'move_frame', id: 'frame-1', x: 999, y: 999 },
          { op: 'nuke_everything' },
        ],
        'user',
      ),
      ERROR_CODES.UNKNOWN,
    );

    const after = await readFile(join(cwd, '.design', 'design.json'), 'utf8');
    assert.equal(after, before, '整批拒绝后 design.json 不应有任何变化');
  });

  it('不存在或非法的 frameId → ENOFRAME', async () => {
    const cwd = await freshWorkspace('no-frame');
    await assertDesignError(applyCanvasOps(cwd, [{ op: 'move_frame', id: 'nope', x: 1, y: 1 }], 'user'), ERROR_CODES.NOFRAME);
    await assertDesignError(
      applyCanvasOps(cwd, [{ op: 'move_frame', id: '../../etc/passwd', x: 1, y: 1 }], 'user'),
      ERROR_CODES.NOFRAME,
    );
  });

  it('删除 frame 同时删文件与它的批注', async () => {
    const cwd = await freshWorkspace('delete-frame');
    await applyCanvasOps(
      cwd,
      [
        { op: 'add_frame', id: 'temp', name: '临时', html: '<p>t</p>', width: 10, height: 10 },
        { op: 'add_comment', frameId: 'temp', text: '删掉', x: 0, y: 0 },
      ],
      'user',
    );
    const { design } = await applyCanvasOps(cwd, [{ op: 'delete_frame', id: 'temp' }], 'user');
    assert.equal(design.frames.length, 0);
    assert.equal(design.comments.length, 0);
    const entries = await readdir(join(cwd, '.design', 'frames'));
    assert.deepEqual(entries, []);
  });

  it('resolve_comment 标记已处理（AC8 闭环后半段）', async () => {
    const cwd = await freshWorkspace('resolve-comment');
    await applyCanvasOps(
      cwd,
      [
        { op: 'add_frame', id: 'f', name: 'F', html: '<p>f</p>', width: 10, height: 10 },
        { op: 'add_comment', id: 'c1', frameId: 'f', text: '太土了', x: 1, y: 1 },
      ],
      'user',
    );
    const { design } = await applyCanvasOps(cwd, [{ op: 'resolve_comment', id: 'c1' }], 'agent');
    assert.equal(design.comments[0].resolved, true);

    // 只读返回未处理批注
    const status = await readStatus(cwd);
    assert.equal(status.comments.length, 1);
    assert.equal(status.comments.filter((comment) => !comment.resolved).length, 0);
  });
});

describe('tokens.css 镜像命名规则（T4 冻结）', () => {
  it('去掉 -- 后把第一个 - 换成 .', () => {
    const css = `
      :root {
        --color-primary: #1f6feb;
        --space-2: 8px;
        --radius: 12px;
        --font-body: "Inter", system-ui, sans-serif;
      }
    `;
    assert.deepEqual(parseTokensCss(css), {
      'color.primary': '#1f6feb',
      'space.2': '8px',
      radius: '12px',
      'font.body': '"Inter", system-ui, sans-serif',
    });
  });

  it('非 :root 块不参与镜像', () => {
    assert.deepEqual(parseTokensCss('[data-theme="dark"] { --color-primary: #000; }'), {});
  });

  it('变量组前的 /* 注释 */ 不会让变量被丢掉（T4 预设的真实写法）', () => {
    const css = `
      :root {
        /* 颜色：1 主色 + 1 强调色 */
        --color-primary: #2b4fd4;
        --color-bg: #f6f7f9;

        /* 字体 */
        --font-display: system-ui, sans-serif;
      }
    `;
    assert.deepEqual(parseTokensCss(css), {
      'color.primary': '#2b4fd4',
      'color.bg': '#f6f7f9',
      'font.display': 'system-ui, sans-serif',
    });
  });

  it('真实 T4 预设能被完整镜像（关键变量一个都不能少）', async () => {
    const preset = await readTokenPreset('neutral-modern');
    if (preset === null) {
      // T4 尚未交付时跳过，不把别人的进度当成自己的失败
      return;
    }
    const mirror = parseTokensCss(preset.css);
    for (const key of ['color.primary', 'color.accent', 'color.bg', 'color.text', 'font.body', 'space.2', 'radius.md']) {
      assert.ok(key in mirror, `预设 ${preset.id} 的镜像缺 ${key}`);
    }
  });
});
