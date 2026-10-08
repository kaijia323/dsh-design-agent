/**
 * Design Preview — 客户端半（`@local/dsh-design-canvas`）。
 *
 * 形态：聊天旁边的设计预览框，**只挂在右侧栏标签页**（scope 是 session，
 * 天然表达"这是当前这个工作区的设计稿"）。没有无限画布：没有平移、缩放、
 * 坐标换算、拖动改位置、多屏并排。
 *
 * 入口：右侧栏的 guide 页（`+` 添加控件与空侧栏打开的都是它）会列出每个注册类型
 * 贡献的胶囊，点一下就 `openTab(kind)` —— 所以 `guide[]` 就是本插件唯一入口。
 * 不再有左侧栏图标，也不再有 main 面板座位。
 *
 * 三条硬约束（改这个文件时不要动）：
 * 1. 每屏 HTML 一律跑在 `<iframe sandbox="allow-scripts">` 里，**绝不加 allow-same-origin**。
 *    这是 AC10 的安全红线，已独立验收。
 * 2. 实时刷新是双保险：`workspaceFiles.changes` 流 + 900ms stat 轮询。AC7 靠它，
 *    且 T2 实测过 chokidar `depth:0` 收不到 `frames/` 子目录事件的坑。
 * 3. 写回通道只有一处：同源 `POST /design-canvas/api`（`postApi`），失败一律可见。
 *
 * 本文件无构建步骤、无 JSX，只能 `require('react')`。
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-design-canvas',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    // ---------------------------------------------------------------- 常量

    const NS = 'dsh-design-canvas';
    const TAB_ID = 'design-canvas';
    const TAB_KIND = 'design-canvas';
    const API_PATH = '/design-canvas/api';
    const DESIGN_DIR = '.design';
    const DESIGN_JSON = '.design/design.json';
    /** 单帧字节上限，与 host 的 MAX_FRAME_BYTES 一致（AC11）。 */
    const MAX_FRAME_BYTES = 2 * 1024 * 1024;
    /** 帧内探针多久没报 ready 就算渲染超时。 */
    const READY_TIMEOUT_MS = 6000;
    /** 自动打开的探测间隔；只在"从无到有"这一个转变上起作用。 */
    const AUTO_OPEN_INTERVAL_MS = 1500;
    /** 探针标记属性，写回前据此剥离，避免探针污染用户的设计文件。 */
    const PROBE_ATTR = 'data-dsh-canvas-probe';

    const SIZE_PRESETS = [
      { id: 'desktop', label: '桌面 1440×900', width: 1440, height: 900 },
      { id: 'laptop', label: '笔记本 1280×800', width: 1280, height: 800 },
      { id: 'tablet', label: '平板 834×1112', width: 834, height: 1112 },
      { id: 'phone', label: '手机 390×844', width: 390, height: 844 },
    ];

    /** 界面文案只做中文；`en` 也用这份，只作 harness 按语言取文件时的兜底。 */
    const copy = {
      title: '设计预览', guideTitle: '设计预览', guideDescription: '当前工作区的设计稿（.design/）',
      reload: '刷新读取', handoff: '落地到项目', prev: '上一屏',
      next: '下一屏', screen: '屏', size: '尺寸',
      expand: '放大', collapse: '还原', emptyTitle: '还没有任何画面',
      emptyHint: '在对话里说一句，例如「设计一个 SaaS 后台的订单列表页」，DSH 会帮你生成第一屏。', emptyReload: '重新读取工程', loading: '正在读取 .design 工程…',
      noSession: '当前没有可用的会话，无法定位 .design 工程。', frameEmpty: '这一帧是空文件', frameMissing: '这一帧还没有文件',
      frameUnreadable: '这一帧读不出来', frameTooLarge: '内容过大，已拒绝渲染', frameTimeout: '渲染超时：帧内脚本可能卡死了',
      reloadFrame: '重新加载这一屏', pickHint: '在预览里点一个元素，可以改它的属性，或就它写一条批注。', props: '元素属性',
      fieldText: '文字', fieldColor: '文字颜色', fieldBackground: '背景色',
      fieldFontSize: '字号', fieldPadding: '内边距', fieldMargin: '外边距',
      commentNew: '就这个元素写批注', commentPlaceholder: '例如：这个按钮太土了', commentSave: '保存批注',
      commentCancel: '取消', comments: '批注', commentResolve: '标记已处理',
      commentResolved: '已处理', commentLocate: '定位', commentUnanchored: '未锚定',
      commentUnanchoredHint: '找不到这个选择器指向的元素（HTML 可能被重写过），原文已保留。', noComments: '这一屏还没有批注。', close: '收起',
      deselect: '取消选中', handoffTitle: '落地到项目', handoffHint: '命令通道不可用，已降级为复制指令。把下面这段粘进对话框即可。',
      copy: '复制', copied: '已复制', opsFailed: '操作未保存：',
      rolledBack: '已回滚为磁盘上的内容。', readFailed: '读取失败：', writeFailed: '写入失败：',
      handoffSent: '已把落地指令投进对话。',
    };

    // ------------------------------------------------------------ 工具函数

    /** UTF-8 字节数。 */
    function byteLength(text) {
      const source = typeof text === 'string' ? text : String(text == null ? '' : text);
      if (typeof TextEncoder === 'function') return new TextEncoder().encode(source).length;
      return unescape(encodeURIComponent(source)).length;
    }

    /** 把任意抛出物转成可读中文。 */
    function msgOf(error) {
      if (error == null) return '未知错误';
      if (typeof error === 'string') return error;
      if (typeof error.message === 'string' && error.message) return error.message;
      return String(error);
    }

    /** 统一的失败信封。 */
    function failure(code, message, path) {
      const error = { code: code || 'EUNKNOWN', message: message || '未知错误' };
      if (path) error.path = path;
      return { ok: false, error: error };
    }

    /** 空工程：首次读取前、以及 design.json 损坏时使用。 */
    function emptyProject() {
      return { version: 2, viewport: { x: 0, y: 0, zoom: 1 }, tokens: {}, frames: [], comments: [] };
    }

    /** 把磁盘上的 design.json 收敛成渲染得动的结构（字段缺失也不崩）。 */
    function normalizeProject(raw) {
      const source = raw && typeof raw === 'object' ? raw : {};
      const frames = Array.isArray(source.frames) ? source.frames : [];
      const comments = Array.isArray(source.comments) ? source.comments : [];
      const viewport = source.viewport && typeof source.viewport === 'object' ? source.viewport : {};
      return {
        version: 2,
        viewport: {
          x: Number.isFinite(viewport.x) ? viewport.x : 0,
          y: Number.isFinite(viewport.y) ? viewport.y : 0,
          zoom: Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? viewport.zoom : 1,
        },
        tokens: source.tokens && typeof source.tokens === 'object' ? source.tokens : {},
        frames: frames
          .filter((frame) => frame && typeof frame === 'object' && typeof frame.id === 'string')
          .map((frame) => ({
            id: frame.id,
            name: typeof frame.name === 'string' && frame.name ? frame.name : frame.id,
            file: typeof frame.file === 'string' && frame.file ? frame.file : 'frames/' + frame.id + '.html',
            width: Number.isFinite(frame.width) && frame.width > 0 ? frame.width : 1280,
            height: Number.isFinite(frame.height) && frame.height > 0 ? frame.height : 800,
            status: frame.status === 'ready' ? 'ready' : 'draft',
          })),
        comments: comments
          .filter((comment) => comment && typeof comment === 'object' && typeof comment.id === 'string')
          .map((comment) => ({
            id: comment.id,
            frameId: typeof comment.frameId === 'string' ? comment.frameId : '',
            target: typeof comment.target === 'string' ? comment.target : '',
            text: typeof comment.text === 'string' ? comment.text : '',
            resolved: comment.resolved === true,
          })),
        selection: source.selection && typeof source.selection === 'object' ? source.selection : undefined,
      };
    }

    /** frame 对应的 .design 内路径。 */
    function framePath(frame) {
      return DESIGN_DIR + '/' + String(frame.file || 'frames/' + frame.id + '.html').replace(/^\.?\/*/, '');
    }

    // -------------------------------------------------------------- 帧内探针

    /**
     * 注入每一帧的探针。
     *
     * 它跑在 opaque origin（sandbox 无 allow-same-origin）里，只能碰自己的 DOM，
     * 与父页面之间只走 postMessage。三件事：
     * 1. hover 高亮 + 点击选中元素，回报 tag/文字/常用样式 + 一条 CSS 选择器路径；
     * 2. 接收父页面的改属性指令，改完把整篇文档回传（父页面剥离探针后写回文件）；
     * 3. 给有批注的元素画角标；选择器指不到元素时回报"未锚定"，绝不静默丢弃。
     */
    const PROBE_JS = [
      '(function(){',
      'var CMD="__dshDesignCmd";',
      'function post(m){ try{ parent.postMessage(Object.assign({__dshDesign:1}, m), "*"); }catch(e){} }',
      'var selected=null, hovered=null, hoverOutline=null, comments=[], layer=null;',
      'function cssPath(el){',
      '  var parts=[];',
      '  while(el && el.nodeType===1 && el!==document.documentElement){',
      '    var name=el.tagName.toLowerCase(), parent=el.parentNode;',
      '    if(parent){ var same=0, index=0, kids=parent.children||[];',
      '      for(var i=0;i<kids.length;i++){ if(kids[i].tagName===el.tagName){ same++; if(kids[i]===el) index=same; } }',
      '      if(same>1) name += ":nth-of-type("+index+")"; }',
      '    parts.unshift(name); el = parent;',
      '  }',
      '  return parts.length ? parts.join(" > ") : "body";',
      '}',
      'function describe(el){',
      '  var cs = getComputedStyle(el);',
      '  return { path: cssPath(el), tag: el.tagName ? el.tagName.toLowerCase() : "",',
      '    text: (el.textContent||"").slice(0,400), color: cs.color, background: cs.backgroundColor,',
      '    fontSize: cs.fontSize, padding: cs.padding, margin: cs.margin };',
      '}',
      'function unhover(){ if(hovered){ hovered.style.outline = hoverOutline || ""; hovered=null; hoverOutline=null; } }',
      'function ensureLayer(){',
      '  if(layer && layer.isConnected) return layer;',
      '  layer = document.createElement("div");',
      '  layer.setAttribute("data-dsh-comment-layer","1");',
      '  layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";',
      '  document.body.appendChild(layer);',
      '  return layer;',
      '}',
      '// 重画批注角标；回报锚定成功与失败的 id，让父页面显示"未锚定"而不是当成没有。',
      'function layoutComments(){',
      '  var L = ensureLayer();',
      '  L.innerHTML = "";',
      '  var anchored = [], missing = [];',
      '  for(var i=0;i<comments.length;i++){',
      '    var c = comments[i], el = null;',
      '    if(c.target){ try{ el = document.querySelector(c.target); }catch(e){ el = null; } }',
      '    if(!el){ missing.push(c.id); continue; }',
      '    var r = el.getBoundingClientRect();',
      '    var b = document.createElement("button");',
      '    b.type = "button"; b.textContent = String(i+1);',
      '    b.setAttribute("data-dsh-comment-mark", c.id);',
      '    b.style.cssText = "position:fixed;pointer-events:auto;cursor:pointer;width:18px;height:18px;border-radius:9px;border:none;background:#d97a45;color:#fff;font:600 11px/18px system-ui;text-align:center;padding:0;box-shadow:0 1px 4px rgba(0,0,0,.35)";',
      '    b.style.left = Math.max(2, r.right - 9) + "px";',
      '    b.style.top = Math.max(2, r.top - 9) + "px";',
      '    b.onclick = (function(id){ return function(ev){ ev.preventDefault(); ev.stopPropagation(); post({ type:"commentClick", id:id }); }; })(c.id);',
      '    L.appendChild(b); anchored.push(c.id);',
      '  }',
      '  post({ type:"commentAnchors", anchored: anchored, missing: missing });',
      '}',
      '// 序列化前摘掉探针自己加的节点（悬停描边 + 批注浮层），否则它们会被写进用户的设计文件。',
      'function serialize(){',
      '  unhover();',
      '  var parentNode = layer && layer.parentNode, next = layer && layer.nextSibling;',
      '  if(parentNode) parentNode.removeChild(layer);',
      '  var html = "<!DOCTYPE html>\\n" + document.documentElement.outerHTML;',
      '  if(parentNode) parentNode.insertBefore(layer, next);',
      '  return html;',
      '}',
      'document.addEventListener("mouseover", function(e){',
      '  if(!e.target || e.target===document.documentElement) return;',
      '  unhover(); hovered=e.target; hoverOutline=hovered.style.outline;',
      '  hovered.style.outline="2px solid #4c8dff";',
      '}, true);',
      'document.addEventListener("mouseout", function(e){ if(e.target===hovered) unhover(); }, true);',
      'document.addEventListener("click", function(e){',
      '  if(!e.target) return; e.preventDefault(); e.stopPropagation();',
      '  selected=e.target; unhover(); post({ type:"select", info: describe(selected) });',
      '}, true);',
      'document.addEventListener("submit", function(e){ e.preventDefault(); }, true);',
      'window.addEventListener("scroll", function(){ if(comments.length) layoutComments(); }, true);',
      'window.addEventListener("resize", function(){ if(comments.length) layoutComments(); });',
      'window.addEventListener("message", function(ev){',
      '  var d = ev.data;',
      '  if(!d || d[CMD]!==true) return;',
      '  if(d.cmd==="setComments"){ comments = Array.isArray(d.comments) ? d.comments : []; layoutComments(); return; }',
      '  if(d.cmd==="selectPath"){',
      '    var found=null; try{ found=document.querySelector(d.value); }catch(e){ found=null; }',
      '    if(found){ selected=found; post({ type:"select", info: describe(selected) }); }',
      '    return;',
      '  }',
      '  if(d.cmd==="clearSelection"){ selected=null; return; }',
      '  if(!selected) return;',
      '  if(d.cmd==="setText"){ selected.textContent = d.value; }',
      '  else if(d.cmd==="setStyle"){ try{ selected.style[d.prop] = d.value; }catch(e){} }',
      '  else { return; }',
      '  post({ type:"changed", html: serialize(), info: describe(selected) });',
      '})',
      'var sandbox = (function(){',
      '  var f = { opaqueOrigin: String(window.origin) === "null", parentReachable: null, parentError: null, cookieReadable: null, cookieError: null };',
      '  try { f.parentReachable = parent.document.title !== undefined; } catch (e) { f.parentReachable = false; f.parentError = e && e.name ? e.name : "Error"; }',
      '  try { f.cookieReadable = typeof document.cookie === "string" && document.cookie !== ""; } catch (e) { f.cookieReadable = false; f.cookieError = e && e.name ? e.name : "Error"; }',
      '  return f;',
      '})();',
      'post({ type:"ready", sandbox: sandbox });',
      '})();',
    ].join('\n');

    /**
     * 剥掉我们自己的痕迹，保证反复保存不会越积越多。
     *
     * 两样东西要清：
     * 1. 注入的探针 `<script>`；
     * 2. 探针挂在 body 上的批注浮层 `<div data-dsh-comment-layer>`。探针在序列化前会先把它
     *    摘下来，但**历史版本曾经把它写进过文件**，那份残留不会被探针自己认领，所以这里
     *    也必须清掉，否则会一代代传下去。
     */
    function stripProbe(html) {
      const script = new RegExp('<script[^>]*' + PROBE_ATTR + '="1"[^>]*>[\\s\\S]*?</script>', 'gi');
      const layer = /<div[^>]*data-dsh-comment-layer="1"[^>]*>[\s\S]*?<\/div>/gi;
      return String(html || '').replace(script, '').replace(layer, '');
    }

    /** 真正渲染进 iframe 的文档 = 源文件 + 一个探针。 */
    function withProbe(html) {
      const source = stripProbe(html);
      const tag = '<script ' + PROBE_ATTR + '="1">\n' + PROBE_JS + '\n<\/script>';
      const at = source.toLowerCase().lastIndexOf('</body>');
      return at >= 0 ? source.slice(0, at) + tag + source.slice(at) : source + tag;
    }

    // ---------------------------------------------------------------- 写通道

    /** 当前写入传输方式；`postApi` 是真身，`setTransport` 可换假的做自测。 */
    let transport = postApi;

    /** 装一个写入传输方式，或不传参恢复走 host 路由。 */
    function setTransport(fn) {
      transport = typeof fn === 'function' ? fn : postApi;
      return transport;
    }

    /**
     * 唯一一处 host 通道调用点：同源 `POST /design-canvas/api`。
     * 失败一律折成 `{ok:false, error:{code,message,path?}}`，不抛异常。
     */
    async function postApi(sessionId, body) {
      if (!sessionId) return failure('EUNKNOWN', '当前没有可用的会话（session），无法写入 .design 工程。');
      let response;
      try {
        response = await fetch(API_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(Object.assign({ sessionId: sessionId }, body)),
        });
      } catch (error) {
        return failure('EUNKNOWN', '无法连接画布写入服务（' + API_PATH + '）：' + msgOf(error));
      }
      let payload = null;
      try {
        payload = await response.json();
      } catch (error) {
        payload = null;
      }
      if (!response.ok) {
        return { ok: false, error: (payload && payload.error) || { code: 'EUNKNOWN', message: '写入服务返回 HTTP ' + response.status } };
      }
      if (!payload || payload.ok !== true) {
        return { ok: false, error: (payload && payload.error) || { code: 'EUNKNOWN', message: '写入服务返回了无法识别的响应。' } };
      }
      return payload;
    }

    // ------------------------------------------------------------------ bridge

    /**
     * 组件唯一能碰文件的地方。读走只读的 `workspaceFiles`，写走 {@link transport}。
     * 所有方法都返回信封、不抛异常。
     */
    function createBridge(ctx) {
      const files = ctx.remote && ctx.remote.workspaceFiles;

      /** 把 RemoteResult 的错误折成我们的形状。 */
      function remoteFailure(result, path) {
        const error = result && result.error ? result.error : undefined;
        const detail = error && error.details ? error.details : undefined;
        return {
          code: error && error.code ? String(error.code) : 'EUNKNOWN',
          message: error && error.message ? error.message : '读取 ' + path + ' 失败',
          path: (detail && detail.path) || path,
        };
      }

      /** 读一个工作区文本文件；`absent` 表示文件还不存在。 */
      async function readText(sessionId, path, signal) {
        if (!sessionId) return failure('EUNKNOWN', '当前没有可用的会话（session）。', path);
        if (!files || typeof files.read !== 'function') return failure('EUNKNOWN', '客户端缺少 workspaceFiles 服务。', path);
        let result;
        try {
          result = await files.read(sessionId, path, {}, signal);
        } catch (error) {
          return failure('EUNKNOWN', '读取 ' + path + ' 抛出异常：' + msgOf(error), path);
        }
        if (!result) return failure('EUNKNOWN', '读取 ' + path + ' 没有得到响应。', path);
        if (result.ok !== true) {
          const error = remoteFailure(result, path);
          return { ok: false, absent: error.code === 'workspace-file/not-found', error: error };
        }
        return { ok: true, text: result.value && typeof result.value.text === 'string' ? result.value.text : '', version: result.value && result.value.version };
      }

      /** 先 stat 拿字节数：0 字节和超限都不该靠"读取失败"来判断（AC11）。 */
      async function statFile(sessionId, path, signal) {
        const stat = files && typeof files.stat === 'function' ? files.stat : null;
        if (!sessionId || !stat) return failure('EUNKNOWN', '无法读取 ' + path + ' 的文件信息。', path);
        try {
          const result = await stat(sessionId, path, signal);
          if (result && result.ok === true) {
            return { ok: true, bytes: result.value && typeof result.value.bytes === 'number' ? result.value.bytes : null, version: result.value && result.value.version };
          }
          const error = remoteFailure(result, path);
          return { ok: false, absent: error.code === 'workspace-file/not-found', error: error };
        } catch (error) {
          return failure('EUNKNOWN', '读取 ' + path + ' 的文件信息时出错：' + msgOf(error), path);
        }
      }

      /** 读并归一化 design.json；非法 JSON 交给 host 走备份+回退（AC11）。 */
      async function readProject(sessionId, signal) {
        const read = await readText(sessionId, DESIGN_JSON, signal);
        if (!read.ok) {
          if (read.absent) return { ok: true, project: emptyProject(), absent: true };
          return { ok: false, error: read.error };
        }
        let parsed;
        try {
          parsed = JSON.parse(read.text);
        } catch (error) {
          const recovered = await transport(sessionId, { method: 'readProject' });
          return {
            ok: true,
            project: recovered && recovered.ok ? normalizeProject(recovered.project) : emptyProject(),
            version: read.version,
            invalid: true,
            error: {
              code: 'EJSON',
              message:
                (recovered && recovered.ok && typeof recovered.warning === 'string' && recovered.warning) ||
                'design.json 不是合法 JSON（' + msgOf(error) + '），已回退为空工程；坏文件由 host 备份为 design.json.bak。',
              path: DESIGN_JSON,
            },
          };
        }
        return { ok: true, project: normalizeProject(parsed), version: read.version };
      }

      /** 应用一批画布操作。 */
      function applyCanvasOps(sessionId, ops) {
        if (!Array.isArray(ops) || ops.length === 0) return Promise.resolve({ ok: true, applied: [], design: undefined });
        return transport(sessionId, { ops: ops });
      }

      /**
       * 写回一屏的 HTML（AC6）。用 host 的 `writeFrame`，只传 html，不动坐标与尺寸。
       *
       * **必须 stripProbe**：探针回传的是 `document.documentElement.outerHTML`，里面带着我们
       * 注入的那个 `<script>`。不剥掉就等于往用户的设计文件里塞我们的测试代码，而且每改一次
       * 就多一份、文件会一直涨（实测一次编辑 23444 → 28563 字节）。
       */
      function writeFrame(sessionId, frame, html) {
        return transport(sessionId, {
          method: 'writeFrame',
          frameId: frame.id,
          name: frame.name,
          html: stripProbe(html),
          width: frame.width,
          height: frame.height,
        });
      }

      /**
       * 订阅 `.design/` 变化（AC7）。
       *
       * changes 流是快路径；底下再跑一个 stat 轮询，因为目录 watch 的失效粒度是 host 的实现细节，
       * 而"只改 frames/x.html"必须也能触发刷新。两条路都汇到同一个刷新入口。
       * @param listPaths - 额外要轮询的工作区相对路径（各帧文件），每轮重新取。
       */
      function watch(sessionId, onEvent, listPaths) {
        let disposed = false;
        let stopStream = null;
        let pollTimer = null;
        let pollBusy = false;
        let lastStreamEventAt = 0;
        const versions = new Map();

        const poll = async () => {
          if (disposed || pollBusy) return;
          const stat = files && typeof files.stat === 'function' ? files.stat : null;
          if (!stat) return;
          pollBusy = true;
          try {
            let extra = [];
            if (typeof listPaths === 'function') {
              try {
                extra = listPaths() || [];
              } catch (error) {
                extra = [];
              }
            }
            for (const path of [DESIGN_JSON].concat(extra)) {
              if (!path || typeof path !== 'string') continue;
              let version = 'absent';
              try {
                const result = await stat(sessionId, path, undefined);
                if (result && result.ok === true) version = (result.value && result.value.version) || 'unknown';
              } catch (error) {
                /* 单次 stat 失败不应打死监听 */
              }
              const seen = versions.get(path);
              versions.set(path, version);
              if (seen === undefined || seen === version) continue;
              // 流刚刚报过同一次改动，别重复刷新。
              if (Date.now() - lastStreamEventAt < 2000) continue;
              onEvent({ kind: 'change', path: path, version: version, polled: true });
            }
          } finally {
            pollBusy = false;
          }
        };

        const startStream = () => {
          let stream;
          try {
            stream = ctx.remote.$stream({
              name: 'design-preview:.design changes',
              open: (signal) => files.changes(sessionId, DESIGN_DIR, signal),
              ended: () => new Error('.design 变更流已结束'),
            });
          } catch (error) {
            onEvent({ kind: 'degraded' });
            return;
          }
          if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') {
            onEvent({ kind: 'degraded' });
            return;
          }
          stopStream = () => {
            Promise.resolve().then(() => stream.dispose()).catch(() => undefined);
          };
          void (async () => {
            try {
              for await (const item of stream) {
                if (disposed) break;
                const frame = item && item.value;
                if (!frame) continue;
                if (frame.kind === 'ready') {
                  item.accept();
                  onEvent({ kind: 'ready' });
                  continue;
                }
                if (frame.kind === 'change') {
                  const change = frame.change || {};
                  lastStreamEventAt = Date.now();
                  onEvent({ kind: 'change', path: change.absolutePath, absent: change.absent === true, version: change.version });
                }
              }
              if (!disposed) onEvent({ kind: 'degraded' });
            } catch (error) {
              if (!disposed) {
                onEvent({ kind: 'error', error: msgOf(error) });
                onEvent({ kind: 'degraded' });
              }
            }
          })();
        };

        // 先定基线，再同时跑两条路。
        void (async () => {
          await poll();
          if (disposed) return;
          startStream();
          pollTimer = setInterval(() => void poll(), 900);
        })();

        return function stop() {
          disposed = true;
          if (pollTimer !== null) clearInterval(pollTimer);
          pollTimer = null;
          if (stopStream) stopStream();
        };
      }

      return { readText, statFile, readProject, applyCanvasOps, writeFrame, watch };
    }

    // -------------------------------------------------------------- 会话追踪

    /**
     * 记住用户最近在屏幕上的会话。
     *
     * 右侧栏是 session 作用域、props 直接给 sessionId；根作用域的自动打开器拿不到，
     * 而 `sidebarRight.mounted` 又会在全局面板占住中间列时变成 undefined。
     * 所以订阅它、把最后一个非空值留住。
     */
    function createSessionTracker(ctx) {
      let current;
      const listeners = new Set();
      const publish = (sessionId) => {
        if (!sessionId || sessionId === current) return;
        current = sessionId;
        for (const listener of Array.from(listeners)) {
          try {
            listener(current);
          } catch (error) {
            /* 单个订阅者出错不影响其它 */
          }
        }
      };
      const start = () => {
        const observable = ctx.sidebarRight && ctx.sidebarRight.mounted;
        if (!observable || typeof observable.subscribe !== 'function') return () => undefined;
        const read = () => {
          try {
            publish(observable.getSnapshot());
          } catch (error) {
            /* 瞬时读取失败忽略 */
          }
        };
        read();
        const unsubscribe = observable.subscribe(read);
        return typeof unsubscribe === 'function' ? unsubscribe : () => undefined;
      };
      return {
        get: () => current,
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        start,
      };
    }

    // ---------------------------------------------------------- 自动打开标签

    /**
     * 当 `.design/` **从无到有**（agent 首次生成 frame）时，自动打开设计标签。
     *
     * 只在"本来没有 frame → 现在有 frame"这一个转变上触发：页面刷新时已有工程不弹
     * （不打扰用户），用户手动关掉后也不会再抢回来。触发一次即停止轮询。
     */
    function createAutoOpener(ctx, bridge, tracker) {
      /** 待开标志最多等这么久，超时就放弃（用户可能一直很忙）。 */
      const PENDING_MAX_MS = 5 * 60 * 1000;
      /** 键盘空闲多久才算"手停下来了"。 */
      const QUIET_MS = 1500;

      let sessionId = null;
      let stopPolling = null;
      let lastKeyAt = 0;
      /** 非 0 表示"检测到从无到有、等着空闲再开"；置 0 即丢弃待开意图。 */
      let pendingSince = 0;
      /** 已经开过 / 用户自己开过的会话，不再自动开。 */
      const handled = new Set();

      // 用户刚敲过键盘就先别开：只在 window 上记时间戳，不读任何别的插件的 DOM。
      const noteKey = () => {
        lastKeyAt = Date.now();
      };
      window.addEventListener('keydown', noteKey, true);
      window.addEventListener('keyup', noteKey, true);

      /** 这一轮 agent 是否正在干活（`SessionSummary.running`，host 给的运行态）。 */
      const isRunning = (id) => {
        const list = ctx.sessions && ctx.sessions.list;
        if (!list || typeof list.getSnapshot !== 'function') return false;
        try {
          const row = list.getSnapshot().byId[id];
          return !!(row && row.running);
        } catch (error) {
          return false;
        }
      };

      /** 手是否停下来了。 */
      const isQuiet = () => Date.now() - lastKeyAt > QUIET_MS;

      const arm = (id) => {
        if (!id || id === sessionId) return;
        sessionId = id;
        if (stopPolling) stopPolling();
        stopPolling = null;
        let timer = null;
        let inFlight = false;
        let sawEmpty = false;

        const finish = () => {
          if (timer !== null) clearInterval(timer);
          timer = null;
        };

        const tick = async () => {
          if (inFlight) return;
          inFlight = true;
          try {
            if (handled.has(id)) {
              finish();
              return;
            }
            const stat = await bridge.statFile(id, DESIGN_JSON);
            if (!stat.ok) return;
            const result = await bridge.readProject(id);
            if (!result.ok) return;

            if (result.project.frames.length === 0) {
              sawEmpty = true;
              return;
            }
            // 页面刚打开时工程就已经有内容：不打扰，用户从 guide 自己开。
            if (!sawEmpty) {
              finish();
              return;
            }
            // 边沿：从"没有 frame"变成"有 frame"，记下待开意图（只记一次）。
            if (pendingSince === 0) pendingSince = Date.now();
            if (Date.now() - pendingSince > PENDING_MAX_MS) {
              pendingSince = 0;
              finish();
              return;
            }
            // 等到"这一轮跑完 + 手停下来"的那一刻再开，而不是边沿当场判断——
            // 否则 agent 正在生成时 running 恒为 true，这次就永远开不出来了。
            if (isRunning(id) || !isQuiet()) return;
            pendingSince = 0;
            finish();
            try {
              ctx.sidebarRight.openTab(TAB_KIND);
            } catch (error) {
              /* 当前没有 on-screen session 时打不开；下一次会话变化会重新 arm */
            }
          } finally {
            inFlight = false;
          }
        };

        void tick();
        timer = setInterval(() => void tick(), AUTO_OPEN_INTERVAL_MS);
        stopPolling = finish;
      };

      return {
        start() {
          const unsubscribe = tracker.subscribe(arm);
          arm(tracker.get());
          return () => {
            unsubscribe();
            window.removeEventListener('keydown', noteKey, true);
            window.removeEventListener('keyup', noteKey, true);
            if (stopPolling) stopPolling();
          };
        },
        /**
         * 面板一旦挂载就说明标签已经开着：丢弃待开意图，并且这个会话不再自动开。
         * 这样"用户自己点开的"和"我们自动开的"都算数，不用去猜标签栏的状态。
         */
        markOpened(id) {
          pendingSince = 0;
          if (id) handled.add(id);
        },
      };
    }

    // ---------------------------------------------------------------- 小组件

    const BORDER = 'var(--dsw-alias-border-l2, rgba(127,127,127,0.3))';

    /** 工具栏按钮。 */
    function ToolButton({ onClick, title, active, disabled, children }) {
      return h(
        'button',
        {
          type: 'button',
          title: title,
          disabled: disabled === true,
          onClick: onClick,
          style: { display: 'inline-flex', alignItems: 'center', gap: 4, height: 26, padding: '0 9px', fontSize: 12, lineHeight: 1, borderRadius: 6, border: '1px solid ' + BORDER, background: active ? 'var(--dsw-alias-interactive-bg-active, rgba(64,128,255,0.22))' : 'transparent', color: 'var(--dsw-alias-label-primary, inherit)', cursor: disabled === true ? 'default' : 'pointer', opacity: disabled === true ? 0.5 : 1, whiteSpace: 'nowrap', },
        },
        children,
      );
    }

    /** 错误/提示条；写回失败靠它可见（AC12）。 */
    function Banner({ tone, text, onDismiss, t }) {
      if (!text) return null;
      const danger = tone === 'error';
      return h(
        'div',
        {
          style: { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 10px', margin: '0 0 8px', fontSize: 12, lineHeight: 1.5, borderRadius: 7, border: '1px solid ' + (danger ? 'var(--dsw-alias-border-danger, rgba(220,80,80,0.55))' : BORDER), background: danger ? 'var(--dsw-alias-interactive-bg-hover-danger, rgba(220,80,80,0.12))' : 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.08))', color: 'var(--dsw-alias-label-primary, inherit)', wordBreak: 'break-word', },
        },
        h('span', { style: { flex: 1, minWidth: 0 } }, text),
        onDismiss
          ? h('button', {
              type: 'button',
              onClick: onDismiss,
              title: t('close'),
              style: { border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0 },
            }, '×')
          : null,
      );
    }

    /** `rgb()/rgba()` 转 `#rrggbb`，转不了返回 null。 */
    function rgbToHex(value) {
      const text = String(value || '').trim();
      if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
      const match = text.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
      if (!match) return null;
      const hex = (part) => Number(part).toString(16).padStart(2, '0');
      return '#' + hex(match[1]) + hex(match[2]) + hex(match[3]);
    }

    // -------------------------------------------------------------- 预览画布

    /**
     * 一屏的渲染本体。
     *
     * 沙箱属性只有 `allow-scripts`：加了 `allow-same-origin` 就等于把父窗口交给帧内脚本，
     * 那是 AC10 的红线，已独立验收，不要动。
     */
    function PreviewFrame(props) {
      const { frame, doc, reloadToken, onReload, onSelectElement, onElementChanged, onCommentClick, onAnchors, registerCommand, t } = props;
      const iframeRef = React.useRef(null);
      const [status, setStatus] = React.useState('loading');

      const html = doc && typeof doc.text === 'string' ? doc.text : '';
      const bytes = doc && typeof doc.bytes === 'number' ? doc.bytes : byteLength(html);
      const tooLarge = (doc && doc.tooLarge === true) || bytes > MAX_FRAME_BYTES;
      const missing = !!(doc && doc.missing === true);
      const readError = doc && typeof doc.error === 'string' ? doc.error : null;
      const isEmpty = !tooLarge && !missing && !readError && html.trim().length === 0;
      const renderable = !tooLarge && !missing && !readError && !isEmpty;

      // 每次重新加载都重置生命周期，并给死循环留一个超时出口。
      React.useEffect(() => {
        if (!renderable) return undefined;
        setStatus('loading');
        const timer = setTimeout(() => setStatus((current) => (current === 'loading' ? 'timeout' : current)), READY_TIMEOUT_MS);
        return () => clearTimeout(timer);
      }, [frame.id, reloadToken, renderable]);

      // 只认这帧自己的 window 发来的消息，防伪造。
      React.useEffect(() => {
        if (!renderable) return undefined;
        const onMessage = (event) => {
          const iframe = iframeRef.current;
          if (!iframe || event.source !== iframe.contentWindow) return;
          const data = event.data;
          if (!data || data.__dshDesign !== 1) return;
          if (data.type === 'ready') {
            setStatus('ok');
            if (data.sandbox) {
              const f = data.sandbox;
              // 帧自己测过边界；把结论打到页面控制台，AC10 要的就是这条拦截痕迹。
              console.info(
                '[design-preview] 沙箱生效 frame=' + frame.id + ' sandbox="allow-scripts"（无 allow-same-origin）' +
                  ' opaqueOrigin=' + f.opaqueOrigin +
                  ' parent.document=' + (f.parentReachable === false ? '已拦截(' + f.parentError + ')' : '允许') +
                  ' cookie=' + (f.cookieReadable ? '可读' : '已拦截(' + (f.cookieError || 'empty') + ')'),
              );
            }
            return;
          }
          if (data.type === 'select') return void (onSelectElement && onSelectElement(frame.id, data.info || null));
          if (data.type === 'changed') {
            setStatus('ok');
            return void (onElementChanged && onElementChanged(frame.id, typeof data.html === 'string' ? data.html : '', data.info || null));
          }
          if (data.type === 'commentClick') return void (onCommentClick && onCommentClick(data.id));
          if (data.type === 'commentAnchors') return void (onAnchors && onAnchors(frame.id, data.anchored || [], data.missing || []));
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
      }, [frame.id, reloadToken, renderable, onSelectElement, onElementChanged, onCommentClick, onAnchors]);

      /** 给帧内探针发指令；改动会以 `changed` 回传整篇文档。 */
      const command = React.useCallback((payload) => {
        const iframe = iframeRef.current;
        if (!iframe || !iframe.contentWindow) return;
        try {
          iframe.contentWindow.postMessage(Object.assign({ __dshDesignCmd: true }, payload), '*');
        } catch (error) {
          /* 帧可能已经没了，忽略 */
        }
      }, []);

      React.useEffect(() => {
        registerCommand(frame.id, command);
        return () => registerCommand(frame.id, null);
      }, [frame.id, command, registerCommand]);

      const placeholder = (label, hint) =>
        h(
          'div',
          {
            style: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, height: '100%', padding: 24, boxSizing: 'border-box', background: 'var(--dsw-alias-bg-layer-1, rgba(127,127,127,0.06))', color: 'var(--dsw-alias-label-secondary, inherit)', fontSize: 13, textAlign: 'center', },
          },
          h('div', { style: { fontSize: 15, fontWeight: 600, color: 'var(--dsw-alias-label-primary, inherit)' } }, label),
          hint ? h('div', { style: { opacity: 0.8, maxWidth: 380, lineHeight: 1.6 } }, hint) : null,
          h(ToolButton, { onClick: () => onReload(frame.id) }, t('reloadFrame')),
        );

      // 顺序要紧：读不出来/超限/缺失都不能被当成"空文件"，那是四种不同的失败。
      let body;
      if (tooLarge) {
        body = placeholder(t('frameTooLarge'), 'frames/' + frame.id + '.html 为 ' + (bytes / 1024 / 1024).toFixed(2) + ' MB，超过 2 MB 上限（AC11），预览不会渲染它。');
      } else if (missing) {
        body = placeholder(t('frameMissing'), 'frames/' + frame.id + '.html 还不存在。');
      } else if (readError) {
        body = placeholder(t('frameUnreadable'), '读取 frames/' + frame.id + '.html 失败：' + readError);
      } else if (isEmpty) {
        body = placeholder(t('frameEmpty'), 'frames/' + frame.id + '.html 是 0 字节。');
      } else {
        body = h(
          'div',
          { style: { position: 'relative', width: '100%', height: '100%', background: '#fff' } },
          h('iframe', {
            ref: iframeRef,
            key: frame.id + ':' + reloadToken,
            title: frame.name || frame.id,
            srcDoc: withProbe(html),
            // AC10：只给 allow-scripts，永远不要加 allow-same-origin。
            sandbox: 'allow-scripts',
            referrerPolicy: 'no-referrer',
            style: { display: 'block', width: '100%', height: '100%', border: 'none', background: '#fff' },
          }),
          status === 'timeout'
            ? h(
                'div',
                {
                  style: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24, boxSizing: 'border-box', textAlign: 'center', background: 'var(--dsw-alias-bg-mask-1, rgba(0,0,0,0.55))', color: '#fff', fontSize: 13, },
                },
                h('div', { style: { fontWeight: 600, fontSize: 15 } }, t('frameTimeout')),
                h(ToolButton, { onClick: () => onReload(frame.id) }, t('reloadFrame')),
              )
            : null,
        );
      }

      return h('div', { 'data-frame-id': frame.id, style: { width: '100%', height: '100%', minHeight: 0, overflow: 'hidden' } }, body);
    }

    // ------------------------------------------------------------ 元素检查器

    /** 抽屉：改元素属性 + 就这个元素写批注 + 当前屏批注列表。未选中元素时不占宽度。 */
    function Inspector({ frame, info, comments, anchoring, command, onDeselect, onSaveComment, onResolveComment, onFocusComment, t }) {
      const [text, setText] = React.useState('');
      const [color, setColor] = React.useState('#000000');
      const [background, setBackground] = React.useState('#ffffff');
      const [fontSize, setFontSize] = React.useState('');
      const [padding, setPadding] = React.useState('');
      const [margin, setMargin] = React.useState('');
      const [draft, setDraft] = React.useState('');
      const [showCommentBox, setShowCommentBox] = React.useState(false);

      React.useEffect(() => {
        if (!info) return;
        setText(typeof info.text === 'string' ? info.text : '');
        setColor(rgbToHex(info.color) || '#000000');
        setBackground(rgbToHex(info.background) || '#ffffff');
        setFontSize(info.fontSize || '');
        setPadding(info.padding || '');
        setMargin(info.margin || '');
        setShowCommentBox(false);
        setDraft('');
      }, [info]);

      const inputStyle = {
        flex: 1,
        minWidth: 0,
        height: 24,
        padding: '0 6px',
        fontSize: 12,
        boxSizing: 'border-box',
        borderRadius: 5,
        border: '1px solid ' + BORDER,
        background: 'var(--dsw-alias-bg-base, transparent)',
        color: 'var(--dsw-alias-label-primary, inherit)',
      };
      const row = (label, control) =>
        h('label', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 6 } },
          h('span', { style: { width: 62, flex: 'none', opacity: 0.75 } }, label), control);

      return h(
        'div',
        {
          style: { position: 'absolute', top: 8, right: 8, bottom: 8, width: 250, zIndex: 5, display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: 10, boxSizing: 'border-box', borderRadius: 8, border: '1px solid ' + BORDER, background: 'var(--dsw-alias-bg-layer-3, rgba(30,30,36,0.97))', color: 'var(--dsw-alias-label-primary, inherit)', boxShadow: '0 8px 26px rgba(0,0,0,0.35)', },
        },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 } },
          h('span', { style: { fontSize: 12, fontWeight: 600, flex: 1 } }, t('props')),
          h('button', {
            type: 'button',
            onClick: onDeselect,
            title: t('deselect'),
            style: { border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13, lineHeight: 1 },
          }, '×'),
        ),
        info
          ? h(
              'div',
              null,
              h('div', { style: { fontSize: 11, opacity: 0.7, marginBottom: 8, wordBreak: 'break-all', lineHeight: 1.5 } },
                (frame.name || frame.id) + ' · ' + info.tag + '\n' + (info.path || '')),
              row(t('fieldText'), h('textarea', {
                value: text,
                rows: 3,
                onChange: (event) => setText(event.target.value),
                onBlur: () => command({ cmd: 'setText', value: text }),
                style: Object.assign({}, inputStyle, { height: 'auto', padding: '4px 6px', resize: 'vertical', lineHeight: 1.5 }),
              })),
              row(t('fieldColor'), h('input', { type: 'color', value: color, onChange: (e) => { setColor(e.target.value); command({ cmd: 'setStyle', prop: 'color', value: e.target.value }); }, style: { width: 34, height: 24, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' } })),
              row(t('fieldBackground'), h('input', { type: 'color', value: background, onChange: (e) => { setBackground(e.target.value); command({ cmd: 'setStyle', prop: 'backgroundColor', value: e.target.value }); }, style: { width: 34, height: 24, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' } })),
              row(t('fieldFontSize'), h('input', { value: fontSize, onChange: (e) => setFontSize(e.target.value), onBlur: () => command({ cmd: 'setStyle', prop: 'fontSize', value: fontSize }), style: inputStyle })),
              row(t('fieldPadding'), h('input', { value: padding, onChange: (e) => setPadding(e.target.value), onBlur: () => command({ cmd: 'setStyle', prop: 'padding', value: padding }), style: inputStyle })),
              row(t('fieldMargin'), h('input', { value: margin, onChange: (e) => setMargin(e.target.value), onBlur: () => command({ cmd: 'setStyle', prop: 'margin', value: margin }), style: inputStyle })),
              showCommentBox
                ? h('div', { style: { marginTop: 6 } },
                    h('textarea', {
                      autoFocus: true,
                      rows: 3,
                      value: draft,
                      placeholder: t('commentPlaceholder'),
                      onChange: (e) => setDraft(e.target.value),
                      style: Object.assign({}, inputStyle, { width: '100%', height: 'auto', padding: '5px 6px', resize: 'vertical', lineHeight: 1.5 }),
                    }),
                    h('div', { style: { display: 'flex', gap: 6, marginTop: 6 } },
                      h(ToolButton, {
                        disabled: draft.trim().length === 0,
                        onClick: () => { onSaveComment(info.path, draft.trim()); setDraft(''); setShowCommentBox(false); },
                      }, t('commentSave')),
                      h(ToolButton, { onClick: () => { setShowCommentBox(false); setDraft(''); } }, t('commentCancel')),
                    ),
                  )
                : h('div', { style: { marginTop: 6 } }, h(ToolButton, { onClick: () => setShowCommentBox(true) }, t('commentNew'))),
            )
          : h('div', { style: { fontSize: 12, opacity: 0.7, lineHeight: 1.6 } }, t('pickHint')),
        h(
          'div',
          { style: { marginTop: 10, paddingTop: 10, borderTop: '1px solid ' + BORDER } },
          h('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 6 } }, t('comments') + '（' + comments.filter((c) => !c.resolved).length + '）'),
          comments.length === 0
            ? h('div', { style: { fontSize: 12, opacity: 0.65 } }, t('noComments'))
            : comments.map((comment) => {
                const unanchored = comment.target && anchoring.missing.indexOf(comment.id) >= 0;
                return h(
                  'div',
                  { key: comment.id, style: { fontSize: 12, padding: '6px 0', borderTop: '1px solid ' + BORDER, opacity: comment.resolved ? 0.5 : 1, lineHeight: 1.55 } },
                  h('div', { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, comment.text),
                  h('div', { style: { opacity: 0.6, marginTop: 2, fontSize: 11 } }, comment.resolved ? t('commentResolved') : ''),
                  // 锚点失效绝不静默丢弃：原文照留，并说明原因。
                  unanchored ? h('div', { style: { opacity: 0.6, fontSize: 11, lineHeight: 1.5, marginTop: 2 } }, t('commentUnanchored') + '：' + t('commentUnanchoredHint')) : null,
                  h('div', { style: { display: 'flex', gap: 6, marginTop: 4 } },
                    comment.target ? h(ToolButton, { onClick: () => onFocusComment(comment) }, t('commentLocate')) : null,
                    comment.resolved ? null : h(ToolButton, { onClick: () => onResolveComment(comment.id) }, t('commentResolve')),
                  ),
                );
              }),
        ),
      );
    }

    // -------------------------------------------------------------- 预览主体

    /**
     * 预览面板：单屏渲染 + 切屏 + 刷新 + 就地改 + 元素锚点批注 + 落地。
     * 按 `sessionId` 定位当前工作区的 `.design/`，所以它天然跟着当前会话走。
     */
    function Preview(props) {
      const { ctx, bridge, sessionId, t, onOpened } = props;

      const [project, setProject] = React.useState(null);
      const [doc, setDoc] = React.useState(null);
      const [loading, setLoading] = React.useState(true);
      const [ready, setReady] = React.useState(false);
      const [banner, setBanner] = React.useState(null);
      const [notice, setNotice] = React.useState(null);
      const [currentId, setCurrentId] = React.useState(null);
      const [reloadToken, setReloadToken] = React.useState(0);
      const [selected, setSelected] = React.useState(null);
      const [anchoring, setAnchoring] = React.useState({ anchored: [], missing: [] });
      const [handoffText, setHandoffText] = React.useState(null);
      const [copied, setCopied] = React.useState(false);

      const projectRef = React.useRef(null);
      const designVersionRef = React.useRef(null);
      const commandsRef = React.useRef(new Map());
      const currentIdRef = React.useRef(null);
      const sessionRef = React.useRef(null);

      React.useEffect(() => {
        currentIdRef.current = currentId;
      }, [currentId]);

      React.useEffect(() => {
        sessionRef.current = sessionId;
      }, [sessionId]);

      // 面板挂载 = 这个会话的标签已经开着，自动打开器可以收手了。
      React.useEffect(() => {
        if (onOpened) onOpened(sessionId);
      }, [onOpened, sessionId]);

      const report = React.useCallback((text, tone) => {
        if (!text) return;
        if (tone === 'error') setBanner({ tone: 'error', text: text });
        else setNotice({ text: text });
      }, []);

      const frames = project && project.frames ? project.frames : [];
      const currentFrame = frames.find((frame) => frame.id === currentId) || null;
      const comments = React.useMemo(
        () => (project && project.comments ? project.comments : []).filter((comment) => comment.frameId === currentId),
        [project, currentId],
      );
      // 只按内容签名重发角标清单；否则 comments 的数组身份每次都变，会自激成渲染死循环。
      const commentSig = React.useMemo(
        () => comments.filter((comment) => !comment.resolved).map((comment) => comment.id + '|' + comment.target).join('~'),
        [comments],
      );

      // ----------------------------------------------------------- 读取

      /** 先 stat 再决定读不读：0 字节与超 2MB 都不该走读取（AC11）。 */
      const readFrameDoc = React.useCallback(
        async (id, frame) => {
          const target = frame || (projectRef.current && projectRef.current.frames ? projectRef.current.frames.find((item) => item.id === id) : null);
          if (!target || !sessionRef.current) return null;
          const path = framePath(target);
          const stat = await bridge.statFile(sessionRef.current, path);
          if (stat.ok) {
            if (stat.bytes === 0) return { text: '', bytes: 0, empty: true };
            if (typeof stat.bytes === 'number' && stat.bytes > MAX_FRAME_BYTES) return { text: '', bytes: stat.bytes, tooLarge: true };
          }
          const read = await bridge.readText(sessionRef.current, path);
          if (!read.ok) {
            if (read.absent) return { text: '', bytes: null, missing: true };
            return { text: '', bytes: stat.ok ? stat.bytes : null, error: read.error.message };
          }
          return { text: read.text, bytes: byteLength(read.text) };
        },
        [bridge],
      );

      /** 读工程 + 当前这一屏。`first` 为真时才恢复上次停留的屏。 */
      const load = React.useCallback(
        async (first) => {
          if (!sessionId) {
            setLoading(false);
            setProject(emptyProject());
            return;
          }
          const result = await bridge.readProject(sessionId);
          if (!result.ok) {
            setLoading(false);
            setProject(emptyProject());
            report(t('readFailed') + result.error.message, 'error');
            return;
          }
          designVersionRef.current = typeof result.version === 'string' ? result.version : null;
          projectRef.current = result.project;
          setProject(result.project);
          setLoading(false);
          // 只在首次加载时清一次红条。之后**不能**在这里清：写失败会紧跟着回滚重读，
          // 一清就等于把刚报的错擦掉，用户根本看不见（AC12 要求的"失败可见"就废了）。
          if (result.invalid) report(result.error.message, 'error');
          else if (first) setBanner(null);

          const list = result.project.frames;
          // 刷新浏览器后尽量停在原来的那一屏：host 把选中态存在 design.json 的 selection 里。
          const remembered = result.project.selection && typeof result.project.selection.frameId === 'string' ? result.project.selection.frameId : null;
          const keep = currentIdRef.current && list.some((frame) => frame.id === currentIdRef.current) ? currentIdRef.current : null;
          const pick = (first && remembered && list.some((frame) => frame.id === remembered) ? remembered : keep) || (list[0] ? list[0].id : null);
          setCurrentId(pick);
          const frame = list.find((item) => item.id === pick);
          setDoc(frame ? await readFrameDoc(pick, frame) : null);
        },
        [bridge, sessionId, report, t, readFrameDoc],
      );

      // 首帧。
      React.useEffect(() => {
        let cancelled = false;
        void (async () => {
          await load(true);
          if (!cancelled) setReady(true);
        })();
        return () => {
          cancelled = true;
        };
      }, [load]);

      // 切屏时换文件。
      React.useEffect(() => {
        if (!ready || !currentId) return undefined;
        let cancelled = false;
        void (async () => {
          const next = await readFrameDoc(currentId);
          if (!cancelled) setDoc(next);
        })();
        return () => {
          cancelled = true;
        };
      }, [ready, currentId, readFrameDoc]);

      // 实时刷新（AC7）：防抖重读，只换内容，不动当前屏与选中态。
      React.useEffect(() => {
        if (!sessionId || !ready) return undefined;
        let timer = null;
        const stop = bridge.watch(
          sessionId,
          (event) => {
            if (event.kind === 'error') report('文件变更流不可用，已改用轮询监听：' + event.error, 'error');
            if (event.kind === 'degraded') setNotice({ text: '文件变更流不可用，已切换为轮询监听（约 0.9 秒一次）。' });
            if (event.kind !== 'change' && event.kind !== 'ready' && event.kind !== 'degraded') return;
            // 忽略我们自己写入引起的回声。
            if (event.kind === 'change' && typeof event.path === 'string' && event.path.indexOf('design.json') >= 0 && event.version && event.version === designVersionRef.current) return;
            if (timer !== null) clearTimeout(timer);
            timer = setTimeout(() => {
              timer = null;
              void load(false);
            }, 300);
          },
          () => {
            const list = projectRef.current && projectRef.current.frames ? projectRef.current.frames : [];
            return list.map((frame) => framePath(frame));
          },
        );
        return () => {
          if (timer !== null) clearTimeout(timer);
          stop();
        };
      }, [bridge, sessionId, ready, load, report]);

      // 把当前屏未处理的批注送进帧内画角标。
      React.useEffect(() => {
        const command = currentId ? commandsRef.current.get(currentId) : null;
        if (!command) return;
        command({
          cmd: 'setComments',
          comments: comments
            .filter((comment) => !comment.resolved)
            .map((comment) => ({ id: comment.id, target: comment.target || '', text: comment.text })),
        });
      }, [commentSig, currentId, doc]);

      // ----------------------------------------------------------- 写入

      const commit = React.useCallback(
        async (ops, failureNote) => {
          if (!sessionId) {
            report(t('noSession'), 'error');
            return false;
          }
          const result = await bridge.applyCanvasOps(sessionId, ops);
          if (!result.ok) {
            report((failureNote || t('opsFailed')) + result.error.message + ' ' + t('rolledBack'), 'error');
            await load(false);
            return false;
          }
          setBanner(null);
          if (result.design) {
            projectRef.current = normalizeProject(result.design);
            setProject(projectRef.current);
          }
          return true;
        },
        [bridge, sessionId, report, load, t],
      );

      /** 切到某一屏，并把选中态写回 design.json（下次刷新还停在这里）。 */
      const goTo = React.useCallback(
        (frameId) => {
          if (!frameId || frameId === currentId) return;
          setCurrentId(frameId);
          setSelected(null);
          setAnchoring({ anchored: [], missing: [] });
          if (!sessionId) return;
          // 切屏本身不阻塞用户，但写入失败仍要可见（AC12）——只是不打断切换。
          void bridge.applyCanvasOps(sessionId, [{ op: 'select', frameId: frameId }]).then((result) => {
            if (!result.ok) report('选中态未保存（不影响浏览）：' + result.error.message, 'error');
          });
        },
        [bridge, sessionId, currentId, report],
      );

      const step = React.useCallback(
        (delta) => {
          if (frames.length === 0) return;
          const at = frames.findIndex((frame) => frame.id === currentId);
          const next = frames[(at + delta + frames.length) % frames.length];
          goTo(next.id);
        },
        [frames, currentId, goTo],
      );

      const registerCommand = React.useCallback((frameId, fn) => {
        if (fn) commandsRef.current.set(frameId, fn);
        else commandsRef.current.delete(frameId);
      }, []);

      const onElementChanged = React.useCallback(
        (frameId, html, info) => {
          setDoc({ text: html, bytes: byteLength(html) });
          if (info) setSelected({ frameId: frameId, info: info });
          const frame = projectRef.current && projectRef.current.frames ? projectRef.current.frames.find((item) => item.id === frameId) : null;
          if (!frame || !sessionId) return;
          void bridge.writeFrame(sessionId, frame, html).then((result) => {
            if (result.ok) setBanner(null);
            if (!result.ok) {
              report(t('writeFailed') + result.error.message + ' ' + t('rolledBack'), 'error');
              void load(false);
            }
          });
        },
        [bridge, sessionId, report, load, t],
      );

      const onSelectElement = React.useCallback((frameId, info) => {
        setSelected(info ? { frameId: frameId, info: info } : null);
      }, []);

      /** 帧内角标回报；内容没变就保留原 state，避免"回报→重渲染→再回报"的自激。 */
      const onAnchors = React.useCallback((frameId, anchored, missing) => {
        setAnchoring((previous) =>
          previous.anchored.join(',') === anchored.join(',') && previous.missing.join(',') === missing.join(',')
            ? previous
            : { anchored: anchored, missing: missing },
        );
      }, []);

      const saveComment = React.useCallback(
        async (target, text) => {
          if (!currentId || !text) return;
          // 只存元素选择器，不存坐标：没有画布了，位置由 target 决定。
          await commit([{ op: 'add_comment', frameId: currentId, text: text, target: target, x: 0, y: 0 }], '批注未保存：');
        },
        [commit, currentId],
      );

      const resolveComment = React.useCallback((commentId) => void commit([{ op: 'resolve_comment', id: commentId, resolved: true }], '批注未保存：'), [commit]);

      const focusComment = React.useCallback(
        (comment) => {
          const command = commandsRef.current.get(currentId);
          if (command && comment.target) command({ cmd: 'selectPath', value: comment.target });
        },
        [currentId],
      );

      /** 点帧内角标 → 定位到那条批注。定义在 focusComment 之后，避免暂时性死区。 */
      const onCommentClick = React.useCallback(
        (id) => {
          const comment = comments.find((item) => item.id === id);
          if (comment) focusComment(comment);
        },
        [comments, focusComment],
      );

      // 关于「放大」：不再自己做一个按钮。
      // `ctx.layout.openRightbar(track, fullscreen)` 的文档原话是 "**Report** the right panel's
      // presentation without changing its expanded state" —— 它是「上报」，不是「命令」；第三方
      // 调它只会让布局对呈现方式的认知失真，实测面板宽度一点没变。
      // 右侧栏自己头部就有一个 Fullscreen 控件（aria-label="Fullscreen"），实测把预览从
      // 553px 拉到 1257px，所以全屏交给它，我们不自造。

      // ----------------------------------------------------------- 落地

      /** T4 `prompts/design-handoff.md` 第 3 节的指令模板。 */
      function handoffInstruction(frame) {
        return [
          '【落地到项目】把画布上选中的这一屏转成项目代码，并写进仓库。',
          '',
          '目标 frame：' + (frame.name || frame.id) + '（id: ' + frame.id + '，文件：' + framePath(frame) + '）',
          '目标目录：未指定，按 prompts/design-handoff.md 第 4 步推断',
          '',
          '按顺序做，不要跳步：',
          '1. 调用 design_status，确认该 frame 仍然存在，并读走它名下所有未处理的批注——批注里的修改意见必须体现在生成代码里。',
          '2. read 上面那个文件全文，再 read .design/tokens.css（这两个文件只读，不要修改）。',
          '3. 探测项目技术栈：先读 package.json 的 dependencies/devDependencies，再看 src/ 的现有目录与一个已有组件的写法，跟随现有约定。没有任何可识别技术栈时，默认 React + TypeScript 函数组件 + 同目录 CSS Module。',
          '4. 生成一个组件文件，视觉一比一还原这一屏；颜色一律取自 tokens，不要硬编码新颜色；示例数据写成命名清晰的常量；不要引用 .design/ 下的任何文件。',
          '5. read 回生成的文件复核一遍，然后回报写入的文件路径、取舍、以及没有一比一还原的地方与原因。',
        ].join('\n');
      }

      const handoff = React.useCallback(async () => {
        const frame = currentFrame;
        if (!frame || !sessionId) return;
        // 主方案：T4 定义的 session command。
        //
        // 注意（踩过的坑）：Cordis 的 context 代理在读取**未注入**的服务属性时是**直接抛异常**，
        // 不是返回 undefined。所以 `ctx.remote && ctx.remote.commands` 这种"看起来防御"的写法
        // 本身就会抛，而 try 只包住后面的 execute 是拦不住的 —— 降级分支会永远到不了。
        // 属性访问必须和 execute 一起包在 try 里。
        //
        // `remote.commands` 故意**不**写进 inject：host 侧没有注册 /design-handoff，
        // 声明它收益为零，却会让缺少该服务的 profile 里整个客户端半不激活。
        try {
          const commands = ctx.remote.commands;
          if (commands && typeof commands.execute === 'function') {
            const result = await commands.execute(sessionId, '/design-handoff ' + frame.id, []);
            if (result && result.ok && result.value !== undefined) {
              setNotice({ text: t('handoffSent') });
              return;
            }
          }
        } catch (error) {
          /* 命令通道不可用 → 落到降级方案 */
        }
        // 降级方案（T4 §2）：可复制的指令卡片。属降级，已上报 Lead 记 follow_ups。
        setCopied(false);
        setHandoffText(handoffInstruction(frame));
      }, [ctx, currentFrame, sessionId, t]);

      // ----------------------------------------------------------- 渲染

      if (!sessionId) {
        return h('div', { style: { padding: 20, fontSize: 13, color: 'var(--dsw-alias-label-secondary, inherit)' } }, t('noSession'));
      }

      const at = frames.findIndex((frame) => frame.id === currentId);
      const toolbar = h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderBottom: '1px solid ' + BORDER, flexWrap: 'wrap' } },
        h(ToolButton, { onClick: () => step(-1), disabled: frames.length < 2, title: t('prev') }, '‹'),
        h('span', { style: { fontSize: 12, minWidth: 78, textAlign: 'center', opacity: 0.85 } },
          frames.length === 0 ? '—' : '第 ' + (at + 1) + ' / ' + frames.length + ' ' + t('screen')),
        h(ToolButton, { onClick: () => step(1), disabled: frames.length < 2, title: t('next') }, '›'),
        currentFrame
          ? h('select', {
              value: currentFrame.id,
              onChange: (event) => goTo(event.target.value),
              title: t('screen'),
              style: { fontSize: 12, height: 26, maxWidth: 140, background: 'transparent', color: 'inherit', border: '1px solid ' + BORDER, borderRadius: 6, cursor: 'pointer' },
            }, frames.map((frame) => h('option', { key: frame.id, value: frame.id }, frame.name || frame.id)))
          : null,
        h('span', { style: { flex: 1 } }),
        currentFrame
          ? h('select', {
              value: (SIZE_PRESETS.find((preset) => preset.width === currentFrame.width && preset.height === currentFrame.height) || {}).id || '',
              onChange: (event) => {
                const preset = SIZE_PRESETS.find((item) => item.id === event.target.value);
                if (preset) void commit([{ op: 'resize_frame', id: currentFrame.id, width: preset.width, height: preset.height }], '改尺寸未保存：');
              },
              title: t('size'),
              style: { fontSize: 11, height: 26, background: 'transparent', color: 'inherit', border: '1px solid ' + BORDER, borderRadius: 6, cursor: 'pointer' },
            },
            h('option', { value: '' }, currentFrame.width + '×' + currentFrame.height),
            SIZE_PRESETS.map((preset) => h('option', { key: preset.id, value: preset.id }, preset.label)))
          : null,
        h(ToolButton, { onClick: () => { void load(false); setReloadToken((n) => n + 1); }, title: t('reload') }, t('reload')),
        // 批注入口：锚点失效的批注在预览里没有角标可点，必须另有一个总能打开列表的地方，
        // 否则"原文已保留"等于看不见——那就成了静默丢弃。
        comments.length > 0
          ? h(ToolButton, { active: !!selected, onClick: () => setSelected({ frameId: currentId, info: null }), title: t('comments') },
              t('comments') + '（' + comments.filter((comment) => !comment.resolved).length + '）')
          : null,
        currentFrame ? h(ToolButton, { onClick: () => void handoff(), title: t('handoff') }, t('handoff')) : null,
      );

      const emptyState =
        !loading && frames.length === 0
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, height: '100%', textAlign: 'center', padding: 32, boxSizing: 'border-box' } },
              h('div', { style: { fontSize: 16, fontWeight: 600 } }, t('emptyTitle')),
              h('div', { style: { maxWidth: 420, fontSize: 13, lineHeight: 1.7, color: 'var(--dsw-alias-label-secondary, inherit)' } }, t('emptyHint')),
              h(ToolButton, { onClick: () => void load(false) }, t('emptyReload')),
            )
          : null;

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, color: 'var(--dsw-alias-label-primary, inherit)' } },
        toolbar,
        h('div', { style: { padding: '8px 10px 0' } },
          h(Banner, { tone: 'error', text: banner ? banner.text : '', onDismiss: () => setBanner(null), t: t }),
          h(Banner, { tone: 'info', text: notice ? notice.text : '', onDismiss: () => setNotice(null), t: t }),
        ),
        h(
          'div',
          { style: { position: 'relative', flex: 1, minHeight: 0, margin: '8px 10px 10px', border: '1px solid ' + BORDER, borderRadius: 8, overflow: 'hidden' } },
          loading ? h('div', { style: { display: 'grid', placeItems: 'center', height: '100%', fontSize: 13, opacity: 0.75 } }, t('loading')) : null,
          emptyState,
          !loading && currentFrame
            ? h(PreviewFrame, {
                frame: currentFrame,
                doc: doc,
                reloadToken: reloadToken,
                onReload: () => setReloadToken((n) => n + 1),
                onSelectElement: onSelectElement,
                onElementChanged: onElementChanged,
                onCommentClick: onCommentClick,
                onAnchors: onAnchors,
                registerCommand: registerCommand,
                t: t,
              })
            : null,
          selected && currentFrame
            ? h(Inspector, {
                frame: currentFrame,
                info: selected.info,
                comments: comments,
                anchoring: anchoring,
                command: (payload) => {
                  const fn = commandsRef.current.get(currentFrame.id);
                  if (fn) fn(payload);
                },
                onDeselect: () => {
                  setSelected(null);
                  const fn = commandsRef.current.get(currentFrame.id);
                  if (fn) fn({ cmd: 'clearSelection' });
                },
                onSaveComment: (target, text) => void saveComment(target, text),
                onResolveComment: (id) => void resolveComment(id),
                onFocusComment: focusComment,
                t: t,
              })
            : null,
          handoffText
            ? h(
                'div',
                {
                  style: { position: 'absolute', inset: 12, zIndex: 10, display: 'flex', flexDirection: 'column', gap: 8, padding: 12, boxSizing: 'border-box', borderRadius: 8, border: '1px solid ' + BORDER, background: 'var(--dsw-alias-bg-layer-3, rgba(30,30,36,0.98))', color: 'var(--dsw-alias-label-primary, inherit)', },
                },
                h('div', { style: { fontSize: 13, fontWeight: 600 } }, t('handoffTitle')),
                h('div', { style: { fontSize: 12, opacity: 0.8, lineHeight: 1.6 } }, t('handoffHint')),
                h('textarea', {
                  readOnly: true,
                  value: handoffText,
                  style: { flex: 1, minHeight: 0, width: '100%', boxSizing: 'border-box', fontSize: 12, lineHeight: 1.6, padding: 8, borderRadius: 6, border: '1px solid ' + BORDER, background: 'var(--dsw-alias-bg-base, transparent)', color: 'inherit', resize: 'none' },
                }),
                h('div', { style: { display: 'flex', gap: 6, justifyContent: 'flex-end' } },
                  h(ToolButton, {
                    onClick: () => {
                      const nav = typeof navigator === 'undefined' ? null : navigator;
                      if (nav && nav.clipboard && nav.clipboard.writeText) {
                        void nav.clipboard.writeText(handoffText).then(() => setCopied(true), () => setCopied(false));
                      }
                    },
                  }, copied ? t('copied') : t('copy')),
                  h(ToolButton, { onClick: () => setHandoffText(null) }, t('close')),
                ),
              )
            : null,
        ),
      );
    }

    // ---------------------------------------------------------------- 座位

    /** 右侧栏标签页主体：唯一入口，scope 是 session，所以天然跟着当前工作区。 */
    function PreviewTabBody(props) {
      const { ctx, bridge, t, onOpened } = props;
      return h(Preview, { ctx: ctx, bridge: bridge, sessionId: props.sessionId, t: t, onOpened: onOpened });
    }

    /** 标签页标题。 */
    function PreviewTabTitle(props) {
      const t = props.t || ((key) => copy[key] || key);
      return h('span', null, t('title'));
    }

    // ---------------------------------------------------------------- 激活

    return {
      inject: ['slots', 'locale', 'layout', 'sessions', 'sidebarRightTabs', 'sidebarRight', 'remote', 'remote.workspaceFiles'],

      /** 写入传输方式开关，供无 host 时自测整条写回链路。 */
      setTransport: setTransport,

      /**
       * 注册右侧栏标签类型、它的主体与标题，并启动"从无到有自动打开"。
       * @param ctx - 客户端根上下文。
       */
      apply(ctx) {
        window.__dshDesignCanvas = {
          setTransport: setTransport,
          getTransport: function () {
            return transport;
          },
        };

        ctx.effect(() => ctx.locale.register(NS, { zh: copy, en: copy }), 'design-preview:dictionaries');
        const t = ctx.locale.bind(NS);

        const tracker = createSessionTracker(ctx);
        ctx.effect(() => tracker.start(), 'design-preview:session tracker');

        const bridge = createBridge(ctx);
        const autoOpener = createAutoOpener(ctx, bridge, tracker);
        ctx.effect(() => autoOpener.start(), 'design-preview:auto open');

        // 标签类型。`guide` 是唯一入口：右侧栏的「+」与空侧栏都渲染这份清单，
        // 点一个胶囊就 openTab(kind) 打开它。
        ctx.effect(
          () =>
            ctx.sidebarRightTabs.register({
              id: TAB_ID,
              kind: TAB_KIND,
              priority: 'extension',
              title: () => t('title'),
              guide: [
                {
                  id: 'design',
                  order: 30,
                  title: () => t('guideTitle'),
                  description: () => t('guideDescription'),
                },
              ],
            }),
          'design-preview:right tab type',
        );

        ctx.slots.inject('sidebar.right.pane.tab', () =>
          ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID, locale: NS }, (props) =>
            h(
              PreviewTabBody,
              Object.assign({}, props, {
                ctx: ctx,
                bridge: bridge,
                t: t,
                onOpened: (id) => autoOpener.markOpened(id),
              }),
            ),
          ),
        );

        ctx.slots.inject('sidebar.right.pane.tab.title', () =>
          ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: TAB_ID }, (props) =>
            h(PreviewTabTitle, Object.assign({}, props, { t: t })),
          ),
        );
      },
    };
  },
});
