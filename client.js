/**
 * Design Canvas — Client half of the `@local/dsh-design-canvas` bundle.
 *
 * What this file is:
 * - One self-contained browser module. No build step, no JSX (the factory runs
 *   before any transform), and no `require` outside the browser module table.
 * - Two seats share one canvas: `main` (key `design-canvas`) is the full-screen
 *   canvas, and the right Sidebar tab of the same kind is the "chat beside
 *   canvas" split that AC2 asks for. The right column takes a layout track, so
 *   the Conversation column narrows instead of being covered.
 *
 * Contracts this file is written against (all verified from the running build):
 * - `export const inject = [...]` names real Client services only.
 * - Slots register inside `apply` with `ctx.effect`; the factory stays
 *   side-effect free.
 * - `sidebarRightTabs.register({ id, kind, priority, title })` plus the keyed
 *   `sidebar.right.pane.tab` / `sidebar.right.pane.tab.title` seats keyed by the
 *   definition's `id`, then `sidebarRight.openTab(kind)` (the same trio the
 *   shipped `dsh-client-ui-sidebar-files` uses).
 * - Reads go through the read-only `workspaceFiles` Remote namespace:
 *   `read(sessionId, path, range, signal)` -> `RemoteResult`. It exposes no
 *   mutations, so every write goes through the Host HTTP route below.
 * - Writes go through `POST /design-canvas/api` with `{ sessionId, ops }`
 *   (same-origin, no session-log noise, so dragging can be chatty).
 *
 * Security: every frame renders in `<iframe sandbox="allow-scripts">`.
 * `allow-same-origin` is deliberately absent, which is what gives the frame an
 * opaque origin and makes `parent.document` / `document.cookie` unreachable.
 * Do not add it.
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-design-canvas',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    // ---------------------------------------------------------------- constants

    /** Locale namespace for every visible string of this plugin. */
    const NS = 'dsh-design-canvas';
    /** Main-panel id; the sidebar entry id must match so the panel is selectable. */
    const PANEL_ID = 'design-canvas';
    /** Right-tab definition id, which is also the key of its body and title seats. */
    const TAB_ID = 'design-canvas';
    /** Right-tab kind, the discriminator `openTab` names. */
    const TAB_KIND = 'design-canvas';

    /** Same-origin Host route that applies canvas operations. */
    const API_PATH = '/design-canvas/api';
    /** Design project directory, relative to the Session workspace root. */
    const DESIGN_DIR = '.design';
    /** The project manifest inside {@link DESIGN_DIR}. */
    const DESIGN_JSON = '.design/design.json';

    /** Frames above this size are refused instead of rendered (AC11). */
    const MAX_FRAME_BYTES = 2 * 1024 * 1024;
    /** Zoom envelope of the infinite canvas. */
    const MIN_ZOOM = 0.05;
    const MAX_ZOOM = 4;
    /** Height of a frame's title chrome, in world units. */
    const CHROME_HEIGHT = 30;
    /** How long a frame may stay silent before we call the render timed out. */
    const FRAME_READY_TIMEOUT_MS = 6000;

    /** Offered frame sizes, all in CSS pixels of the rendered page. */
    const SIZE_PRESETS = [
      { id: 'desktop', label: '桌面 1440×900', width: 1440, height: 900 },
      { id: 'laptop', label: '笔记本 1280×800', width: 1280, height: 800 },
      { id: 'tablet', label: '平板 834×1112', width: 834, height: 1112 },
      { id: 'phone', label: '手机 390×844', width: 390, height: 844 },
    ];

    /** Marker attribute identifying our injected probe, so re-injection stays idempotent. */
    const PROBE_ATTR = 'data-dsh-canvas-probe';

    // ------------------------------------------------------------------ copy

    /**
     * The one dictionary. The product ships Chinese only, so `en` mirrors it
     * rather than maintaining a second vocabulary; `ctx.locale` stays the
     * registration path because the Harness UI contract requires it.
     */
    const copy = {
      panel: '设计',
      title: '设计画布',
      tabTitle: '设计画布',
      split: '同屏聊天',
      fullscreen: '全屏画布',
      fit: '适应全部',
      zoomIn: '放大',
      zoomOut: '缩小',
      reload: '重新读取',
      reloadFrame: '重新加载',
      commentMode: '添加批注',
      commentModeOn: '点画布落点…',
      commentsToggle: '批注列表',
      commentNeedsFrame: '还没有任何画面，先让 DSH 生成一屏再留批注。',
      commentPlaceholder: '写点什么，例如：这个按钮太土了',
      commentSave: '保存批注',
      commentCancel: '取消',
      commentResolve: '标记已处理',
      commentResolved: '已处理',
      commentAnchor: '批注',
      emptyTitle: '还没有任何画面',
      emptyHint: '在对话里说一句，例如「设计一个 SaaS 后台的订单列表页」，DSH 会帮你生成第一屏。',
      emptyReload: '重新读取工程',
      loading: '正在读取 .design 工程…',
      frameEmpty: '这一帧是空文件',
      frameTooLarge: '内容过大，已拒绝渲染',
      frameTimeout: '渲染超时：帧内脚本可能卡死了',
      noSession: '当前没有可用的会话，无法定位 .design 工程。',
      inspectorTitle: '就地改元素',
      inspectorHint: '在画面里点一个元素，就能在这里改它的文字与样式。',
      fieldText: '文字',
      fieldColor: '文字颜色',
      fieldBackground: '背景色',
      fieldFontSize: '字号',
      fieldPadding: '内边距',
      fieldMargin: '外边距',
      apply: '应用',
      sizeLabel: '尺寸',
      selected: '已选中',
      elementSelected: '已选中元素',
      deselect: '取消选中',
      opsFailed: '操作未保存：',
      rolledBack: '已回滚为磁盘上的状态。',
      commentsTitle: '批注',
      noComments: '还没有批注。',
      readFailed: '读取失败：',
      writeFailed: '写入失败：',
    };

    // ------------------------------------------------------------------ utils

    /** Clamp `value` into `[lo, hi]`. */
    function clamp(value, lo, hi) {
      return value < lo ? lo : value > hi ? hi : value;
    }

    /** Byte length of a string in UTF-8, without allocating a copy of the file. */
    function byteLength(text) {
      const source = typeof text === 'string' ? text : String(text == null ? '' : text);
      if (typeof TextEncoder === 'function') return new TextEncoder().encode(source).length;
      return unescape(encodeURIComponent(source)).length;
    }

    /** Human-readable message of an unknown thrown value. */
    function msgOf(error) {
      if (error == null) return '未知错误';
      if (typeof error === 'string') return error;
      if (typeof error.message === 'string' && error.message) return error.message;
      return String(error);
    }

    /** A failure in the shape every bridge method returns. */
    function failure(code, message, path) {
      const error = { code: code || 'EUNKNOWN', message: message || '未知错误' };
      if (path) error.path = path;
      return { ok: false, error: error };
    }

    /** An empty but structurally valid project, used before the first read and on bad JSON. */
    function emptyProject() {
      return { version: 2, viewport: { x: 80, y: 80, zoom: 0.5 }, tokens: {}, frames: [], comments: [] };
    }

    /** Coerce whatever design.json held into something the canvas can render. */
    function normalizeProject(raw) {
      const source = raw && typeof raw === 'object' ? raw : {};
      const viewport = source.viewport && typeof source.viewport === 'object' ? source.viewport : {};
      const frames = Array.isArray(source.frames) ? source.frames : [];
      const comments = Array.isArray(source.comments) ? source.comments : [];
      return {
        version: 2,
        viewport: {
          x: Number.isFinite(viewport.x) ? viewport.x : 80,
          y: Number.isFinite(viewport.y) ? viewport.y : 80,
          zoom: Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? viewport.zoom : 0.5,
        },
        tokens: source.tokens && typeof source.tokens === 'object' ? source.tokens : {},
        frames: frames
          .filter((frame) => frame && typeof frame === 'object' && typeof frame.id === 'string')
          .map((frame, index) => ({
            id: frame.id,
            name: typeof frame.name === 'string' && frame.name ? frame.name : frame.id,
            file: typeof frame.file === 'string' && frame.file ? frame.file : 'frames/' + frame.id + '.html',
            width: Number.isFinite(frame.width) && frame.width > 0 ? frame.width : 1280,
            height: Number.isFinite(frame.height) && frame.height > 0 ? frame.height : 800,
            x: Number.isFinite(frame.x) ? frame.x : 120 + index * 60,
            y: Number.isFinite(frame.y) ? frame.y : 120 + index * 40,
            background: frame.background,
            status: frame.status === 'ready' ? 'ready' : 'draft',
          })),
        comments: comments
          .filter((comment) => comment && typeof comment === 'object' && typeof comment.id === 'string')
          .map((comment) => ({
            id: comment.id,
            frameId: typeof comment.frameId === 'string' ? comment.frameId : '',
            target: comment.target,
            text: typeof comment.text === 'string' ? comment.text : '',
            x: Number.isFinite(comment.x) ? comment.x : 0,
            y: Number.isFinite(comment.y) ? comment.y : 0,
            resolved: comment.resolved === true,
            createdAt: typeof comment.createdAt === 'string' ? comment.createdAt : '',
          })),
        selection: source.selection && typeof source.selection === 'object' ? source.selection : undefined,
      };
    }

    /** Absolute-ish workspace path of one frame's HTML file. */
    function framePath(frame) {
      const file = String(frame.file || 'frames/' + frame.id + '.html').replace(/^\.?\/*/, '');
      return DESIGN_DIR + '/' + file;
    }

    /** A short, stable label for one workspace path, for banners. */
    function shortPath(absolutePath) {
      const text = String(absolutePath || '');
      const marker = '/' + DESIGN_DIR + '/';
      const at = text.lastIndexOf(marker);
      return at >= 0 ? DESIGN_DIR + '/' + text.slice(at + marker.length) : text;
    }

    // -------------------------------------------------------------- the probe

    /**
     * Serialized probe injected into every frame document.
     *
     * It runs under `sandbox="allow-scripts"` in an opaque origin, so it can
     * touch its own DOM freely and can only ever reach the parent through
     * `postMessage`. Written as a plain string because the iframe is `srcdoc`.
     */
    const PROBE_JS = [
      '(function(){',
      'var CMD="__dshDesignCmd";',
      'function post(m){ try{ parent.postMessage(Object.assign({__dshDesign:1}, m), "*"); }catch(e){} }',
      'var selected=null, hovered=null, hoverOutline=null;',
      'function cssPath(el){',
      '  var parts=[];',
      '  while(el && el.nodeType===1 && el!==document.documentElement){',
      '    var name=el.tagName.toLowerCase();',
      '    var parent=el.parentNode;',
      '    if(parent){',
      '      var same=0, index=0, kids=parent.children||[];',
      '      for(var i=0;i<kids.length;i++){ if(kids[i].tagName===el.tagName){ same++; if(kids[i]===el) index=same; } }',
      '      if(same>1) name += ":nth-of-type("+index+")";',
      '    }',
      '    parts.unshift(name);',
      '    el = parent;',
      '  }',
      '  return parts.length ? parts.join(" > ") : "body";',
      '}',
      'function describe(el){',
      '  var cs = getComputedStyle(el);',
      '  return {',
      '    path: cssPath(el),',
      '    tag: el.tagName ? el.tagName.toLowerCase() : "",',
      '    text: (el.textContent||"").slice(0,400),',
      '    color: cs.color, background: cs.backgroundColor,',
      '    fontSize: cs.fontSize, padding: cs.padding, margin: cs.margin',
      '  };',
      '}',
      'function unhover(){ if(hovered){ hovered.style.outline = hoverOutline || ""; hovered=null; hoverOutline=null; } }',
      'document.addEventListener("mouseover", function(e){',
      '  if(!e.target || e.target===document.documentElement) return;',
      '  unhover(); hovered=e.target; hoverOutline=hovered.style.outline;',
      '  hovered.style.outline="2px solid #4c8dff";',
      '}, true);',
      'document.addEventListener("mouseout", function(e){ if(e.target===hovered) unhover(); }, true);',
      'document.addEventListener("click", function(e){',
      '  if(!e.target) return;',
      '  e.preventDefault(); e.stopPropagation();',
      '  selected=e.target; unhover();',
      '  post({ type:"select", info: describe(selected) });',
      '}, true);',
      'document.addEventListener("submit", function(e){ e.preventDefault(); }, true);',
      'window.addEventListener("message", function(ev){',
      '  var d = ev.data;',
      '  if(!d || d[CMD]!==true) return;',
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
      '  post({ type:"changed", html: "<!DOCTYPE html>\\n" + document.documentElement.outerHTML, info: describe(selected) });',
      '});',
      'post({ type:"ready", height: document.documentElement.scrollHeight });',
      '})();',
    ].join('\n');

    /** Remove a previously injected probe so re-saving never stacks copies. */
    function stripProbe(html) {
      const pattern = new RegExp('<script[^>]*' + PROBE_ATTR + '="1"[^>]*>[\\s\\S]*?</script>', 'gi');
      return String(html || '').replace(pattern, '');
    }

    /** The frame document the sandbox actually renders: source plus one probe. */
    function withProbe(html) {
      const source = stripProbe(html);
      const tag = '<script ' + PROBE_ATTR + '="1">\n' + PROBE_JS + '\n<\/script>';
      const at = source.toLowerCase().lastIndexOf('</body>');
      if (at >= 0) return source.slice(0, at) + tag + source.slice(at);
      return source + tag;
    }

    // ------------------------------------------------------------- transport

    /**
     * The single switch point for the write channel.
     *
     * Everything above this line is UI; everything below it is the frozen
     * contract. Swapping the Host transport is a change to this one function.
     *
     * @param sessionId - Session whose workspace the Host resolves; the client
     *   never sends a path, on purpose.
     * @param body - `{ ops }` or `{ method, ... }`, merged with `sessionId`.
     * @returns the Host envelope, or `{ ok: false, error }` when unreachable.
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
        const boxed = payload && payload.error ? payload.error : { code: 'EUNKNOWN', message: '写入服务返回 HTTP ' + response.status };
        return { ok: false, error: boxed };
      }
      if (!payload || payload.ok !== true) {
        const boxed = (payload && payload.error) || { code: 'EUNKNOWN', message: '写入服务返回了无法识别的响应。' };
        return { ok: false, error: boxed };
      }
      return payload;
    }

    /**
     * The active write transport.
     *
     * `postApi` — the Host route — is the real one. {@link setTransport} swaps
     * in a fake so the whole write path (optimistic move, failure banner,
     * rollback) can be exercised without a live Host, and restores it with no
     * argument. Nothing else in this file knows which one is installed.
     */
    let transport = postApi;

    /**
     * Install a write transport, or restore the Host route.
     *
     * @param fn - `(sessionId, body) => Promise<envelope>`, or omitted to reset.
     * @returns the transport now installed.
     */
    function setTransport(fn) {
      transport = typeof fn === 'function' ? fn : postApi;
      return transport;
    }

    // ---------------------------------------------------------------- bridge

    /**
     * The only place that talks to files.
     *
     * Reads use the read-only `workspaceFiles` Remote namespace; writes use
     * the swappable {@link transport}. Components never see either.
     *
     * @param ctx - Client root context.
     * @returns the bridge face shared by both canvas seats.
     */
    function createBridge(ctx) {
      const files = ctx.remote && ctx.remote.workspaceFiles;

      /** Normalize one `RemoteResult` failure into our own error shape. */
      function remoteFailure(result, path) {
        const error = result && result.error ? result.error : undefined;
        const code = error && error.code ? String(error.code) : 'EUNKNOWN';
        const detail = error && error.details ? error.details : undefined;
        const message = error && error.message ? error.message : '读取 ' + path + ' 失败';
        return { code: code, message: message, path: (detail && detail.path) || path };
      }

      /**
       * Read one workspace text file.
       * @returns `{ ok: true, text }`, or `{ ok: false, absent }` when no file exists yet.
       */
      async function readText(sessionId, path, signal) {
        if (!sessionId) return failure('EUNKNOWN', '当前没有可用的会话（session），无法读取 ' + path + '。', path);
        if (!files || typeof files.read !== 'function') {
          return failure('EUNKNOWN', '客户端缺少 workspaceFiles 服务，无法读取 ' + path + '。', path);
        }
        let result;
        try {
          result = await files.read(sessionId, path, {}, signal);
        } catch (error) {
          return failure('EUNKNOWN', '读取 ' + path + ' 抛出异常：' + msgOf(error), path);
        }
        if (!result) return failure('EUNKNOWN', '读取 ' + path + ' 没有得到响应。', path);
        if (result.ok !== true) {
          const error = remoteFailure(result, path);
          const absent = error.code === 'workspace-file/not-found';
          return { ok: false, absent: absent, error: error };
        }
        return { ok: true, text: result.value && typeof result.value.text === 'string' ? result.value.text : '', version: result.value && result.value.version };
      }

      /** Read and normalize `.design/design.json`. Bad JSON falls back to an empty project (AC11). */
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
          // Hand the broken file to the Host so its backup-and-recover path runs
          // (AC11), then show whatever it recovered.
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
        return {
          ok: true,
          project: normalizeProject(parsed),
          version: read.version,
          text: read.text,
          // A project that already carries a camera must keep it on reload (AC5).
          savedViewport: Boolean(parsed && typeof parsed === 'object' && parsed.viewport),
        };
      }

      /** Apply canvas operations through the active transport. */
      function applyCanvasOps(sessionId, ops) {
        if (!Array.isArray(ops) || ops.length === 0) return Promise.resolve({ ok: true, applied: [], design: undefined });
        return transport(sessionId, { ops: ops });
      }

      /**
       * Write one frame's HTML back to `frames/<id>.html` (AC6).
       *
       * Uses the Host's dedicated `writeFrame` method rather than an `add_frame`
       * op, so saving an edited document never races frame creation.
       */
      function writeFrame(sessionId, frame, html) {
        return transport(sessionId, {
          method: 'writeFrame',
          frameId: frame.id,
          name: frame.name,
          html: html,
          width: frame.width,
          height: frame.height,
          x: Math.round(frame.x),
          y: Math.round(frame.y),
        });
      }

      /**
       * Follow `.design/` for Host-side changes (AC7).
       *
       * Primary path is the `workspaceFiles.changes` stream. If it cannot open
       * or dies, the watcher degrades to stat polling so a refresh still lands
       * inside AC7's two seconds.
       *
       * @param sessionId - Session whose workspace is observed.
       * @param onEvent - receives `{kind:'ready'|'change'|'error', ...}`.
       * @returns a disposer.
       */
      function watch(sessionId, onEvent, listPaths) {
        let disposed = false;
        let stopStream = null;
        let pollTimer = null;
        let pollBusy = false;
        let ready = false;
        let lastStreamEventAt = 0;

        /** Workspace-relative path -> last observed version. */
        const versions = new Map();

        /**
         * Stat every observed file and report the ones whose version moved.
         *
         * The first pass only seeds the baseline. Stream events update the same
         * map with `absolutePath` keys, which cannot collide with our relative
         * ones, so a poll landing right behind a stream event is suppressed by
         * {@link lastStreamEventAt} instead of double-reporting the same edit.
         */
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
            const targets = [DESIGN_JSON, DESIGN_DIR + '/tokens.css'].concat(extra);
            for (const path of targets) {
              if (!path || typeof path !== 'string') continue;
              let version = 'absent';
              try {
                const result = await stat(sessionId, path, undefined);
                if (result && result.ok === true) version = (result.value && result.value.version) || 'unknown';
              } catch (error) {
                /* A single stat failure must not kill the watcher. */
              }
              const seen = versions.get(path);
              versions.set(path, version);
              if (seen === undefined || seen === version) continue;
              // A stream event for the same edit arrived moments ago: it already won.
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
              name: 'design-canvas:.design changes',
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
            Promise.resolve()
              .then(() => stream.dispose())
              .catch(() => undefined);
          };
          void (async () => {
            try {
              for await (const item of stream) {
                if (disposed) break;
                const frame = item && item.value;
                if (!frame) continue;
                if (frame.kind === 'ready') {
                  if (!ready) {
                    ready = true;
                    item.accept();
                    onEvent({ kind: 'ready' });
                  }
                  continue;
                }
                if (frame.kind === 'change') {
                  const change = frame.change || {};
                  lastStreamEventAt = Date.now();
                  onEvent({
                    kind: 'change',
                    path: change.absolutePath,
                    absent: change.absent === true,
                    version: change.version,
                  });
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

        // Seed the baseline first, then run both paths: the stream is the fast
        // signal, the poll guarantees AC7 regardless of a directory watch's
        // invalidation granularity.
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

      return {
        readText: readText,
        readProject: readProject,
        applyCanvasOps: applyCanvasOps,
        writeFrame: writeFrame,
        watch: watch,
      };
    }

    // ------------------------------------------------------- session tracking

    /**
     * Remembers the Session the user last had on screen.
     *
     * A Session-scoped seat (the right tab) receives `sessionId` in its props,
     * but the `main` seat does not — and `sidebarRight.mounted` goes undefined
     * exactly while a global panel like ours fills the middle column. So we
     * latch the last non-empty report and let both seats read it.
     *
     * @param ctx - Client root context.
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
            /* A broken subscriber must not break the others. */
          }
        }
      };

      /** Subscribe to the on-screen Session; returns the disposer `ctx.effect` wants. */
      const start = () => {
        const observable = ctx.sidebarRight && ctx.sidebarRight.mounted;
        if (!observable || typeof observable.subscribe !== 'function') return () => undefined;
        const read = () => {
          try {
            publish(observable.getSnapshot());
          } catch (error) {
            /* ignore a transient read failure */
          }
        };
        read();
        const unsubscribe = observable.subscribe(read);
        return typeof unsubscribe === 'function' ? unsubscribe : () => undefined;
      };

      return {
        get: () => current,
        report: publish,
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        start: start,
      };
    }

    /**
     * Resolve the Session this canvas instance belongs to.
     *
     * @param tracker - the plugin-level tracker.
     * @param explicit - a `sessionId` handed down by a Session-scoped seat.
     * @returns the Session id, or `undefined` before one is known.
     */
    function useSessionId(tracker, explicit) {
      const [latched, setLatched] = React.useState(() => explicit || tracker.get());

      React.useEffect(() => {
        if (explicit) {
          tracker.report(explicit);
          setLatched(explicit);
          return undefined;
        }
        setLatched(tracker.get());
        return tracker.subscribe(setLatched);
      }, [tracker, explicit]);

      return explicit || latched;
    }

    // ------------------------------------------------------------ small parts

    /** A toolbar button that matches the Harness chrome. */
    function ToolButton({ onClick, title, active, disabled, children }) {
      return h(
        'button',
        {
          type: 'button',
          title: title,
          disabled: disabled === true,
          onClick: onClick,
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            height: 26,
            padding: '0 9px',
            fontSize: 12,
            lineHeight: 1,
            borderRadius: 6,
            border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.3))',
            background: active ? 'var(--dsw-alias-interactive-bg-active, rgba(64,128,255,0.22))' : 'transparent',
            color: 'var(--dsw-alias-label-primary, inherit)',
            cursor: disabled === true ? 'default' : 'pointer',
            opacity: disabled === true ? 0.5 : 1,
            whiteSpace: 'nowrap',
          },
        },
        children,
      );
    }

    /** The dismissible strip that carries errors, warnings and hints (AC12 surfacing). */
    function Banner({ tone, text, onDismiss }) {
      if (!text) return null;
      const danger = tone === 'error';
      return h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            padding: '7px 10px',
            margin: '0 0 8px',
            fontSize: 12,
            lineHeight: 1.5,
            borderRadius: 7,
            border: '1px solid ' + (danger ? 'var(--dsw-alias-border-danger, rgba(220,80,80,0.55))' : 'var(--dsw-alias-border-l2, rgba(127,127,127,0.3))'),
            background: danger ? 'var(--dsw-alias-interactive-bg-hover-danger, rgba(220,80,80,0.12))' : 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.08))',
            color: 'var(--dsw-alias-label-primary, inherit)',
            wordBreak: 'break-word',
          },
        },
        h('span', { style: { flex: 1, minWidth: 0 } }, text),
        onDismiss
          ? h(
              'button',
              {
                type: 'button',
                onClick: onDismiss,
                title: '关闭',
                style: { border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0 },
              },
              '×',
            )
          : null,
      );
    }

    // ------------------------------------------------------------- frame view

    /**
     * One artboard: sandboxed iframe plus its chrome.
     *
     * The sandbox attribute carries `allow-scripts` and nothing else. Adding
     * `allow-same-origin` would give the frame the app's origin and make
     * `parent.document` reachable — that is the security red line for AC10.
     */
    function FrameView(props) {
      const { frame, html, selected, selectedElement, mode, zoom, reloadToken, onSelect, onElementSelected, onElementChanged, onMoveBy, onResize, onReloadFrame, onDelete, onStartComment, t } = props;

      const iframeRef = React.useRef(null);
      const [status, setStatus] = React.useState('loading');
      const [note, setNote] = React.useState('');

      const bytes = byteLength(html || '');
      const isEmpty = String(html || '').trim().length === 0;
      const tooLarge = bytes > MAX_FRAME_BYTES;

      // Reset the frame lifecycle whenever the document or the reload token changes.
      React.useEffect(() => {
        if (isEmpty || tooLarge) return undefined;
        setStatus('loading');
        const timer = setTimeout(() => {
          setStatus((current) => (current === 'loading' ? 'timeout' : current));
        }, FRAME_READY_TIMEOUT_MS);
        return () => clearTimeout(timer);
      }, [frame.id, reloadToken, isEmpty, tooLarge]);

      // Only accept messages that really came from this frame's window.
      React.useEffect(() => {
        if (isEmpty || tooLarge) return undefined;
        const onMessage = (event) => {
          const iframe = iframeRef.current;
          if (!iframe || event.source !== iframe.contentWindow) return;
          const data = event.data;
          if (!data || data.__dshDesign !== 1) return;
          if (data.type === 'ready') {
            setStatus('ok');
            return;
          }
          if (data.type === 'select') {
            if (onElementSelected) onElementSelected(frame.id, data.info || null);
            return;
          }
          if (data.type === 'changed') {
            setStatus('ok');
            if (onElementChanged) onElementChanged(frame.id, typeof data.html === 'string' ? data.html : '', data.info || null);
          }
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
      }, [frame.id, reloadToken, isEmpty, tooLarge, onElementSelected, onElementChanged]);

      /** Feed the probe a command; the probe replies with `changed` and the full document. */
      const command = React.useCallback((payload) => {
        const iframe = iframeRef.current;
        if (!iframe || !iframe.contentWindow) return;
        try {
          iframe.contentWindow.postMessage(Object.assign({ __dshDesignCmd: true }, payload), '*');
        } catch (error) {
          setNote('无法向帧内发送指令：' + msgOf(error));
        }
      }, []);

      // Expose the probe channel to the inspector through a ref-like prop.
      React.useEffect(() => {
        if (props.registerCommand) props.registerCommand(frame.id, command);
        return () => {
          if (props.registerCommand) props.registerCommand(frame.id, null);
        };
      }, [frame.id, command, props.registerCommand]);

      /** Drag the artboard by its title bar. */
      const onChromePointerDown = (event) => {
        if (event.button !== 0) return;
        if (onSelect) onSelect(frame.id);
        event.preventDefault();
        const startX = event.clientX;
        const startY = event.clientY;
        const originX = frame.x;
        const originY = frame.y;
        const target = event.currentTarget;
        let moved = false;
        // The committed position must be the dragged one, not this render's prop.
        let latestX = originX;
        let latestY = originY;

        const onMove = (moveEvent) => {
          const dx = (moveEvent.clientX - startX) / zoom;
          const dy = (moveEvent.clientY - startY) / zoom;
          if (Math.abs(dx) > 1 || Math.abs(dy) > 1) moved = true;
          latestX = originX + dx;
          latestY = originY + dy;
          if (onMoveBy) onMoveBy(frame.id, latestX, latestY, false);
        };
        const onUp = (upEvent) => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          try {
            target.releasePointerCapture(upEvent.pointerId);
          } catch (error) {
            /* capture may already be gone */
          }
          if (moved) {
            if (onMoveBy) onMoveBy(frame.id, latestX ?? originX, latestY ?? originY, true);
          } else if (onSelect) {
            onSelect(frame.id);
          }
        };

        try {
          target.setPointerCapture(event.pointerId);
        } catch (error) {
          /* pointer capture is best effort */
        }
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      };

      const chrome = h(
        'div',
        {
          onPointerDown: onChromePointerDown,
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            height: CHROME_HEIGHT,
            padding: '0 8px',
            boxSizing: 'border-box',
            background: selected ? 'var(--dsw-alias-interactive-bg-active, rgba(64,128,255,0.2))' : 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.12))',
            borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.3))',
            cursor: 'grab',
            userSelect: 'none',
            fontSize: 12,
          },
        },
        h('span', { style: { fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, frame.name || frame.id),
        h('span', { style: { opacity: 0.6, flex: 'none' } }, frame.width + '×' + frame.height),
        h('span', { style: { flex: 1 } }),
        h(
          'select',
          {
            value: (SIZE_PRESETS.find((preset) => preset.width === frame.width && preset.height === frame.height) || {}).id || '',
            onPointerDown: (event) => event.stopPropagation(),
            onChange: (event) => {
              const preset = SIZE_PRESETS.find((item) => item.id === event.target.value);
              if (preset && onResize) onResize(frame.id, preset.width, preset.height);
            },
            title: t('sizeLabel'),
            style: { fontSize: 11, background: 'transparent', color: 'inherit', border: 'none', cursor: 'pointer', maxWidth: 108 },
          },
          h('option', { value: '' }, t('sizeLabel')),
          SIZE_PRESETS.map((preset) => h('option', { key: preset.id, value: preset.id }, preset.label)),
        ),
        h(
          'button',
          {
            type: 'button',
            title: t('commentAnchor'),
            onPointerDown: (event) => event.stopPropagation(),
            onClick: (event) => {
              event.stopPropagation();
              if (onStartComment) onStartComment(frame.id);
            },
            style: { border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 2 },
          },
          '💬',
        ),
        h(
          'button',
          {
            type: 'button',
            title: t('reloadFrame'),
            onPointerDown: (event) => event.stopPropagation(),
            onClick: (event) => {
              event.stopPropagation();
              if (onReloadFrame) onReloadFrame(frame.id);
            },
            style: { border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 2 },
          },
          '⟳',
        ),
      );

      /** The placeholder that replaces the iframe for empty, oversized or hung frames. */
      const placeholder = (label, hint) =>
        h(
          'div',
          {
            style: {
              width: frame.width,
              height: frame.height,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              padding: 24,
              boxSizing: 'border-box',
              background: 'var(--dsw-alias-bg-layer-1, rgba(127,127,127,0.06))',
              color: 'var(--dsw-alias-label-secondary, inherit)',
              fontSize: 13,
              textAlign: 'center',
            },
          },
          h('div', { style: { fontSize: 15, fontWeight: 600, color: 'var(--dsw-alias-label-primary, inherit)' } }, label),
          hint ? h('div', { style: { opacity: 0.8, maxWidth: 420, lineHeight: 1.6 } }, hint) : null,
          h(
            'button',
            {
              type: 'button',
              onClick: () => onReloadFrame && onReloadFrame(frame.id),
              style: {
                height: 26,
                padding: '0 12px',
                fontSize: 12,
                borderRadius: 6,
                border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.3))',
                background: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
              },
            },
            t('reloadFrame'),
          ),
        );

      let body;
      if (isEmpty) {
        body = placeholder(t('frameEmpty'), 'frames/' + frame.id + '.html 是 0 字节。让 DSH 重新生成这一屏，或直接编辑该文件。');
      } else if (tooLarge) {
        body = placeholder(
          t('frameTooLarge'),
          'frames/' + frame.id + '.html 为 ' + (bytes / 1024 / 1024).toFixed(2) + ' MB，超过 2 MB 上限（AC11）。画布不会渲染它。',
        );
      } else {
        body = h(
          'div',
          { style: { position: 'relative', width: frame.width, height: frame.height, background: '#fff' } },
          h('iframe', {
            ref: iframeRef,
            key: frame.id + ':' + reloadToken,
            title: frame.name || frame.id,
            srcDoc: withProbe(html),
            // AC10: allow-scripts only. Never add allow-same-origin.
            sandbox: 'allow-scripts',
            referrerPolicy: 'no-referrer',
            scrolling: 'auto',
            style: { display: 'block', width: frame.width, height: frame.height, border: 'none', background: '#fff' },
          }),
          status === 'timeout'
            ? h(
                'div',
                {
                  style: {
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                    background: 'var(--dsw-alias-bg-mask-1, rgba(0,0,0,0.55))',
                    color: '#fff',
                    fontSize: 13,
                    textAlign: 'center',
                    padding: 24,
                    boxSizing: 'border-box',
                  },
                },
                h('div', { style: { fontWeight: 600, fontSize: 15 } }, t('frameTimeout')),
                h(
                  'button',
                  {
                    type: 'button',
                    onClick: () => onReloadFrame && onReloadFrame(frame.id),
                    style: { height: 26, padding: '0 12px', fontSize: 12, borderRadius: 6, border: '1px solid rgba(255,255,255,0.4)', background: 'transparent', color: '#fff', cursor: 'pointer' },
                  },
                  t('reloadFrame'),
                ),
              )
            : null,
          mode === 'comment'
            ? h('div', {
                onPointerDown: (event) => {
                  event.stopPropagation();
                  if (onStartComment) onStartComment(frame.id);
                },
                style: { position: 'absolute', inset: 0, cursor: 'crosshair', background: 'transparent' },
              })
            : null,
        );
      }

      const elementBadge =
        selected && selectedElement && selectedElement.tag
          ? h(
              'div',
              {
                style: {
                  position: 'absolute',
                  left: 8,
                  bottom: 8,
                  maxWidth: frame.width - 16,
                  padding: '3px 7px',
                  fontSize: 11,
                  borderRadius: 5,
                  background: 'rgba(20,20,24,0.82)',
                  color: '#fff',
                  pointerEvents: 'none',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                },
              },
              t('elementSelected') + '：' + selectedElement.tag + '  ·  ' + (selectedElement.path || ''),
            )
          : null;

      return h(
        'div',
        {
          'data-frame-id': frame.id,
          onPointerDown: () => onSelect && onSelect(frame.id),
          style: {
            position: 'absolute',
            left: frame.x,
            top: frame.y,
            width: frame.width,
            boxShadow: selected
              ? '0 0 0 2px var(--dsw-alias-brand-primary, #4c8dff), 0 8px 26px rgba(0,0,0,0.22)'
              : '0 2px 12px rgba(0,0,0,0.16)',
            borderRadius: 8,
            overflow: 'hidden',
            background: frame.background || 'var(--dsw-alias-bg-layer-1, #fff)',
          },
        },
        chrome,
        h('div', { style: { position: 'relative' } }, body, elementBadge, note ? h('div', { style: { padding: 6, fontSize: 11, color: 'var(--dsw-alias-label-caption, inherit)' } }, note) : null),
      );
    }

    // -------------------------------------------------------------- inspector

    /**
     * In-place element editor (AC6).
     *
     * Edits are sent into the frame's probe, which replies with the whole
     * rewritten document; the parent then persists it through `writeFrame`.
     */
    function ElementInspector({ frame, info, command, onDeselect, t }) {
      const [text, setText] = React.useState('');
      const [color, setColor] = React.useState('#000000');
      const [background, setBackground] = React.useState('#ffffff');
      const [fontSize, setFontSize] = React.useState('');
      const [padding, setPadding] = React.useState('');
      const [margin, setMargin] = React.useState('');

      React.useEffect(() => {
        if (!info) return;
        setText(typeof info.text === 'string' ? info.text : '');
        setColor(rgbToHex(info.color) || '#000000');
        setBackground(rgbToHex(info.background) || '#ffffff');
        setFontSize(info.fontSize || '');
        setPadding(info.padding || '');
        setMargin(info.margin || '');
      }, [info, frame.id]);

      if (!info) return null;

      const row = (label, control) =>
        h(
          'label',
          { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 6 } },
          h('span', { style: { width: 62, flex: 'none', opacity: 0.75 } }, label),
          control,
        );

      const inputStyle = {
        flex: 1,
        minWidth: 0,
        height: 24,
        padding: '0 6px',
        fontSize: 12,
        boxSizing: 'border-box',
        borderRadius: 5,
        border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.3))',
        background: 'var(--dsw-alias-bg-base, transparent)',
        color: 'var(--dsw-alias-label-primary, inherit)',
      };

      return h(
        'div',
        {
          style: {
            width: 250,
            flex: 'none',
            borderLeft: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.3))',
            background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.06))',
            padding: 10,
            boxSizing: 'border-box',
            overflowY: 'auto',
          },
        },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 } },
          h('span', { style: { fontSize: 12, fontWeight: 600, flex: 1 } }, t('inspectorTitle')),
          h(
            'button',
            {
              type: 'button',
              onClick: onDeselect,
              title: t('deselect'),
              style: { border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13, lineHeight: 1 },
            },
            '×',
          ),
        ),
        h('div', { style: { fontSize: 11, opacity: 0.7, marginBottom: 8, wordBreak: 'break-all', lineHeight: 1.5 } },
          (frame.name || frame.id) + '  ·  ' + info.tag + '\n' + (info.path || ''),
        ),
        row(
          t('fieldText'),
          h('textarea', {
            value: text,
            rows: 3,
            onChange: (event) => setText(event.target.value),
            onBlur: () => command && command({ cmd: 'setText', value: text }),
            style: Object.assign({}, inputStyle, { height: 'auto', padding: '4px 6px', resize: 'vertical', lineHeight: 1.5 }),
          }),
        ),
        row(t('fieldColor'), h('input', { type: 'color', value: color, onChange: (event) => { setColor(event.target.value); if (command) command({ cmd: 'setStyle', prop: 'color', value: event.target.value }); }, style: { width: 34, height: 24, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' } })),
        row(t('fieldBackground'), h('input', { type: 'color', value: background, onChange: (event) => { setBackground(event.target.value); if (command) command({ cmd: 'setStyle', prop: 'backgroundColor', value: event.target.value }); }, style: { width: 34, height: 24, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' } })),
        row(t('fieldFontSize'), h('input', { value: fontSize, onChange: (event) => setFontSize(event.target.value), onBlur: () => command && command({ cmd: 'setStyle', prop: 'fontSize', value: fontSize }), style: inputStyle })),
        row(t('fieldPadding'), h('input', { value: padding, onChange: (event) => setPadding(event.target.value), onBlur: () => command && command({ cmd: 'setStyle', prop: 'padding', value: padding }), style: inputStyle })),
        row(t('fieldMargin'), h('input', { value: margin, onChange: (event) => setMargin(event.target.value), onBlur: () => command && command({ cmd: 'setStyle', prop: 'margin', value: margin }), style: inputStyle })),
        h('div', { style: { fontSize: 11, opacity: 0.65, lineHeight: 1.6, marginTop: 4 } }, t('inspectorHint')),
      );
    }

    /** `rgb()/rgba()` (as `getComputedStyle` reports) to `#rrggbb`, or `null`. */
    function rgbToHex(value) {
      const text = String(value || '').trim();
      if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
      const match = text.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
      if (!match) return null;
      const hex = (part) => Number(part).toString(16).padStart(2, '0');
      return '#' + hex(match[1]) + hex(match[2]) + hex(match[3]);
    }

    // ----------------------------------------------------------------- canvas

    /**
     * The canvas itself, shared by the full-screen panel and the right tab.
     *
     * @param props.ctx - Client root context (for layout/sidebar navigation).
     * @param props.bridge - the file bridge.
     * @param props.sessionId - Session whose workspace holds `.design/`.
     * @param props.variant - `'main'` or `'tab'`, which decides the split control.
     */
    function Canvas(props) {
      const { ctx, bridge, sessionId, variant, t } = props;

      const [project, setProject] = React.useState(null);
      const [htmlById, setHtmlById] = React.useState({});
      const [loading, setLoading] = React.useState(true);
      const [banner, setBanner] = React.useState(null);
      const [notice, setNotice] = React.useState(null);
      const [mode, setMode] = React.useState('select');
      const [selectedFrameId, setSelectedFrameId] = React.useState(null);
      const [selectedElement, setSelectedElement] = React.useState(null);
      const [commentDraft, setCommentDraft] = React.useState(null);
      const [openCommentId, setOpenCommentId] = React.useState(null);
      // The comments column starts closed in the narrow right-tab seat, so the
      // split view keeps the chat and the canvas readable side by side (AC2).
      const [showComments, setShowComments] = React.useState(variant !== 'tab');
      const [reloadTokens, setReloadTokens] = React.useState({});
      const [ready, setReady] = React.useState(false);

      const hostRef = React.useRef(null);
      const viewportRef = React.useRef({ x: 80, y: 80, zoom: 0.5 });
      const [viewport, setViewport] = React.useState({ x: 80, y: 80, zoom: 0.5 });
      const commandsRef = React.useRef(new Map());
      /** Latest project, readable from callbacks that must not re-subscribe. */
      const projectRef = React.useRef(null);
      /** Version of the design.json we last read, so our own writes do not re-trigger a reload. */
      const designVersionRef = React.useRef(null);
      const saveTimerRef = React.useRef(null);

      React.useEffect(() => {
        viewportRef.current = viewport;
      }, [viewport]);

      const report = React.useCallback((text, tone) => {
        if (!text) return;
        if (tone === 'error') setBanner({ tone: 'error', text: text });
        else setNotice({ text: text });
      }, []);

      // ------------------------------------------------------------ reading

      /**
       * Read the project and every frame document.
       *
       * @param applyViewport - true only for the first paint, so later refreshes
       *   never move the user's camera (AC7).
       */
      const load = React.useCallback(
        async (applyViewport) => {
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
          const nextProject = result.project;
          projectRef.current = nextProject;
          setProject(nextProject);
          setLoading(false);
          if (result.invalid) report(result.error.message, 'error');
          else setBanner(null);

          if (applyViewport) {
            const next = nextProject.viewport;
            viewportRef.current = next;
            setViewport(next);
            shouldFitRef.current = result.savedViewport !== true;
          }

          const entries = await Promise.all(
            nextProject.frames.map(async (frame) => {
              const read = await bridge.readText(sessionId, framePath(frame));
              return [frame.id, read.ok ? read.text : ''];
            }),
          );
          setHtmlById(Object.fromEntries(entries));
        },
        [bridge, sessionId, report, t],
      );

      // First paint.
      React.useEffect(() => {
        let cancelled = false;
        void (async () => {
          if (cancelled) return;
          await load(true);
          if (!cancelled) setReady(true);
        })();
        return () => {
          cancelled = true;
        };
      }, [load]);

      // Live refresh (AC7): a debounced re-read that leaves the viewport alone.
      React.useEffect(() => {
        if (!sessionId || !ready) return undefined;
        let timer = null;
        const stop = bridge.watch(
          sessionId,
          (event) => {
            if (event.kind === 'error') report('文件变更流不可用，已改用轮询监听：' + event.error, 'error');
            if (event.kind === 'degraded') setNotice({ text: '文件变更流不可用，已切换为轮询监听（约 0.9 秒一次）。' });
            if (event.kind !== 'change' && event.kind !== 'ready' && event.kind !== 'degraded') return;
            // Panning writes design.json too; ignore the echo of our own write.
            if (
              event.kind === 'change' &&
              typeof event.path === 'string' &&
              event.path.indexOf('design.json') >= 0 &&
              event.version &&
              event.version === designVersionRef.current
            ) {
              return;
            }
            if (timer !== null) clearTimeout(timer);
            timer = setTimeout(() => {
              timer = null;
              void load(false);
            }, 300);
          },
          () => {
            const current = projectRef.current;
            const paths = [];
            if (current && Array.isArray(current.frames)) {
              for (const frame of current.frames) paths.push(framePath(frame));
            }
            return paths;
          },
        );
        return () => {
          if (timer !== null) clearTimeout(timer);
          stop();
        };
      }, [bridge, sessionId, ready, load, report]);

      // ------------------------------------------------------------ writing

      /** Persist the camera, debounced, so panning does not spam the Host. */
      const scheduleViewportSave = React.useCallback(
        (next) => {
          if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
          saveTimerRef.current = setTimeout(() => {
            saveTimerRef.current = null;
            if (!sessionId) return;
            void bridge
              .applyCanvasOps(sessionId, [{ op: 'set_viewport', x: Math.round(next.x), y: Math.round(next.y), zoom: Number(next.zoom.toFixed(4)) }])
              .then((result) => {
                if (!result.ok) report(t('opsFailed') + result.error.message, 'error');
              });
          }, 600);
        },
        [bridge, sessionId, report, t],
      );

      /** Run one batch of operations and roll the UI back to disk on failure. */
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
          if (result.design) setProject(normalizeProject(result.design));
          return true;
        },
        [bridge, sessionId, report, load, t],
      );

      // ------------------------------------------------------- interactions

      const selectFrame = React.useCallback(
        (frameId) => {
          setSelectedFrameId(frameId);
          if (!frameId) setSelectedElement(null);
          if (sessionId) void bridge.applyCanvasOps(sessionId, [{ op: 'select', frameId: frameId || undefined }]);
        },
        [bridge, sessionId],
      );

      const moveFrameLocal = React.useCallback((frameId, x, y) => {
        setProject((current) =>
          current ? Object.assign({}, current, { frames: current.frames.map((frame) => (frame.id === frameId ? Object.assign({}, frame, { x: x, y: y }) : frame)) }) : current,
        );
      }, []);

      const moveFrame = React.useCallback(
        (frameId, x, y, commitNow) => {
          if (!commitNow) {
            moveFrameLocal(frameId, x, y);
            return;
          }
          const rounded = { x: Math.round(x), y: Math.round(y) };
          moveFrameLocal(frameId, rounded.x, rounded.y);
          void commit([{ op: 'move_frame', id: frameId, x: rounded.x, y: rounded.y }], '移动未保存：');
        },
        [commit, moveFrameLocal],
      );

      const resizeFrame = React.useCallback(
        (frameId, width, height) => {
          setProject((current) =>
            current ? Object.assign({}, current, { frames: current.frames.map((frame) => (frame.id === frameId ? Object.assign({}, frame, { width: width, height: height }) : frame)) }) : current,
          );
          void commit([{ op: 'resize_frame', id: frameId, width: width, height: height }], '改尺寸未保存：');
        },
        [commit],
      );

      const reloadFrame = React.useCallback((frameId) => {
        setReloadTokens((current) => Object.assign({}, current, { [frameId]: (current[frameId] || 0) + 1 }));
      }, []);

      const registerCommand = React.useCallback((frameId, fn) => {
        if (fn) commandsRef.current.set(frameId, fn);
        else commandsRef.current.delete(frameId);
      }, []);

      const applyElementCommand = React.useCallback(
        (payload) => {
          if (!selectedFrameId) return;
          const command = commandsRef.current.get(selectedFrameId);
          if (command) command(payload);
        },
        [selectedFrameId],
      );

      /** The probe rewrote the document; persist it (AC6). */
      const onElementChanged = React.useCallback(
        (frameId, html, info) => {
          setHtmlById((current) => Object.assign({}, current, { [frameId]: html }));
          if (info) setSelectedElement({ frameId: frameId, info: info });
          const frame = project && project.frames ? project.frames.find((item) => item.id === frameId) : null;
          if (!frame || !sessionId) return;
          void bridge.writeFrame(sessionId, frame, html).then((result) => {
            if (!result.ok) {
              report(t('writeFailed') + result.error.message + ' ' + t('rolledBack'), 'error');
              void load(false);
            }
          });
        },
        [bridge, project, sessionId, report, load, t],
      );

      const onElementSelected = React.useCallback(
        (frameId, info) => {
          setSelectedFrameId(frameId);
          setSelectedElement(info ? { frameId: frameId, info: info } : null);
        },
        [],
      );

      // -------------------------------------------------------- pan and zoom

      React.useEffect(() => {
        const host = hostRef.current;
        if (!host) return undefined;
        const onWheel = (event) => {
          event.preventDefault();
          const rect = host.getBoundingClientRect();
          const px = event.clientX - rect.left;
          const py = event.clientY - rect.top;
          const current = viewportRef.current;
          const factor = Math.exp(-event.deltaY * 0.0015);
          const zoom = clamp(current.zoom * factor, MIN_ZOOM, MAX_ZOOM);
          const ratio = zoom / current.zoom;
          // Anchor the zoom at the pointer: the world point under the cursor stays put.
          const next = { zoom: zoom, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio };
          viewportRef.current = next;
          setViewport(next);
          scheduleViewportSave(next);
        };
        host.addEventListener('wheel', onWheel, { passive: false });
        return () => host.removeEventListener('wheel', onWheel);
      }, [scheduleViewportSave]);

      const onBackgroundPointerDown = (event) => {
        // Comment mode turns the next background click into an anchored note.
        if (mode === 'comment' && event.button === 0) {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          const point = screenToWorld(event.clientX - rect.left, event.clientY - rect.top, viewportRef.current);
          // The Host anchors every comment to a frame, so a click on blank
          // canvas falls back to the selected frame and then to the first one.
          const hit = frameAt(project, point.x, point.y);
          const anchor = hit || frames.find((item) => item.id === selectedFrameId) || frames[0] || null;
          if (!anchor) {
            report(t('commentNeedsFrame'), 'error');
            return;
          }
          setCommentDraft({ x: Math.round(point.x), y: Math.round(point.y), frameId: anchor.id, text: '' });
          return;
        }
        if (event.button === 1 || (event.button === 0 && mode === 'select')) {
          event.preventDefault();
          const startX = event.clientX;
          const startY = event.clientY;
          const origin = viewportRef.current;
          const target = event.currentTarget;
          const onMove = (moveEvent) => {
            const next = { x: origin.x + (moveEvent.clientX - startX), y: origin.y + (moveEvent.clientY - startY), zoom: origin.zoom };
            viewportRef.current = next;
            setViewport(next);
          };
          const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            scheduleViewportSave(viewportRef.current);
          };
          try {
            target.setPointerCapture(event.pointerId);
          } catch (error) {
            /* best effort */
          }
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
        }
      };

      /** One toolbar zoom step, anchored at the viewport centre. */
      const zoomStep = React.useCallback(
        (factor) => {
          const next = zoomBy(viewportRef.current, factor, null);
          viewportRef.current = next;
          setViewport(next);
          scheduleViewportSave(next);
        },
        [scheduleViewportSave],
      );

      const fitAll = React.useCallback(() => {
        const host = hostRef.current;
        const frames = project && project.frames ? project.frames : [];
        if (!host || frames.length === 0) return;
        const rect = host.getBoundingClientRect();
        const minX = Math.min.apply(null, frames.map((frame) => frame.x));
        const minY = Math.min.apply(null, frames.map((frame) => frame.y));
        const maxX = Math.max.apply(null, frames.map((frame) => frame.x + frame.width));
        const maxY = Math.max.apply(null, frames.map((frame) => frame.y + frame.height + CHROME_HEIGHT));
        const pad = 60;
        const zoom = clamp(Math.min((rect.width - pad * 2) / (maxX - minX), (rect.height - pad * 2) / (maxY - minY)), MIN_ZOOM, MAX_ZOOM);
        const next = { zoom: zoom, x: pad - minX * zoom + (rect.width - pad * 2 - (maxX - minX) * zoom) / 2, y: pad - minY * zoom + (rect.height - pad * 2 - (maxY - minY) * zoom) / 2 };
        viewportRef.current = next;
        setViewport(next);
        scheduleViewportSave(next);
      }, [project, scheduleViewportSave]);

      // Auto-fit once, the first time frames appear.
      const fittedRef = React.useRef(false);
      /** Whether this paint may frame the content itself; a stored camera wins. */
      const shouldFitRef = React.useRef(true);
      React.useEffect(() => {
        if (fittedRef.current || !ready || !project || project.frames.length === 0 || !shouldFitRef.current) return;
        fittedRef.current = true;
        fitAll();
      }, [ready, project, fitAll, shouldFitRef]);

      // ---------------------------------------------------------- comments

      const saveComment = React.useCallback(async () => {
        if (!commentDraft || !commentDraft.frameId || !commentDraft.text.trim()) return;
        const draft = commentDraft;
        setCommentDraft(null);
        await commit(
          [{ op: 'add_comment', frameId: draft.frameId, text: draft.text.trim(), x: draft.x, y: draft.y }],
          '批注未保存：',
        );
      }, [commentDraft, commit]);

      const resolveComment = React.useCallback(
        async (commentId) => {
          setOpenCommentId(null);
          await commit([{ op: 'resolve_comment', id: commentId, resolved: true }], '批注未保存：');
        },
        [commit],
      );

      // ------------------------------------------------------ split control

      const openSplit = React.useCallback(() => {
        try {
          ctx.layout.selectPanel(null);
        } catch (error) {
          report('切回对话失败：' + msgOf(error), 'error');
        }
        const openTab = () => {
          try {
            ctx.sidebarRight.openTab(TAB_KIND);
            ctx.layout.openRightbar(true, false);
            return true;
          } catch (error) {
            return false;
          }
        };
        setTimeout(() => {
          if (openTab()) return;
          setTimeout(() => {
            if (!openTab()) report('无法打开右侧画布标签页，请从右侧栏的「+」里手动选择「设计画布」。', 'error');
          }, 120);
        }, 0);
      }, [ctx, report]);

      const openFullscreen = React.useCallback(() => {
        try {
          ctx.layout.selectPanel(PANEL_ID);
        } catch (error) {
          report('切换全屏画布失败：' + msgOf(error), 'error');
        }
      }, [ctx, report]);

      // ------------------------------------------------------------ render

      if (!sessionId) {
        return h('div', { style: { padding: 20, fontSize: 13, color: 'var(--dsw-alias-label-secondary, inherit)' } }, t('noSession'));
      }

      const frames = project && project.frames ? project.frames : [];
      const comments = project && project.comments ? project.comments : [];
      const selectedFrame = frames.find((frame) => frame.id === selectedFrameId) || null;

      const toolbar = h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.3))', flexWrap: 'wrap' } },
        h('span', { style: { fontSize: 13, fontWeight: 600, marginRight: 4 } }, t('title')),
        h(ToolButton, { onClick: fitAll, title: t('fit') }, t('fit')),
        h(ToolButton, { onClick: () => zoomStep(1 / 1.2), title: t('zoomOut') }, '−'),
        h('span', { style: { fontSize: 12, minWidth: 46, textAlign: 'center', opacity: 0.8 } }, Math.round(viewport.zoom * 100) + '%'),
        h(ToolButton, { onClick: () => zoomStep(1.2), title: t('zoomIn') }, '+'),
        h(ToolButton, { active: mode === 'comment', onClick: () => setMode(mode === 'comment' ? 'select' : 'comment'), title: t('commentMode') }, mode === 'comment' ? t('commentModeOn') : t('commentMode')),
        h(ToolButton, { active: showComments, onClick: () => setShowComments(!showComments), title: t('commentsToggle') },
          t('commentsToggle') + '（' + comments.filter((comment) => !comment.resolved).length + '）'),
        h(ToolButton, { onClick: () => void load(false), title: t('reload') }, t('reload')),
        h('span', { style: { flex: 1 } }),
        variant === 'tab'
          ? h(ToolButton, { onClick: openFullscreen, title: t('fullscreen') }, t('fullscreen'))
          : h(ToolButton, { onClick: openSplit, title: t('split') }, t('split')),
      );

      const commentOverlays = comments
        .filter((comment) => !comment.resolved)
        .map((comment) =>
          h(
            'div',
            {
              key: comment.id,
              style: {
                position: 'absolute',
                left: comment.x,
                top: comment.y,
                // A pin belongs to the canvas but must stay readable at any zoom.
                transform: 'translate(-50%, -100%) scale(' + (1 / viewport.zoom) + ')',
                transformOrigin: 'bottom center',
              },
            },
            h(
              'button',
              {
                type: 'button',
                onPointerDown: (event) => event.stopPropagation(),
                onClick: (event) => {
                  event.stopPropagation();
                  setOpenCommentId(openCommentId === comment.id ? null : comment.id);
                },
                title: comment.text,
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  maxWidth: 240,
                  padding: '3px 8px',
                  fontSize: 12,
                  borderRadius: 12,
                  border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.4))',
                  background: 'var(--dsw-alias-bg-layer-3, #2a2a31)',
                  color: 'var(--dsw-alias-label-primary, #fff)',
                  cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
                  whiteSpace: 'nowrap',
                },
              },
              '💬',
              h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, comment.text),
            ),
            openCommentId === comment.id
              ? h(
                  'div',
                  {
                    onPointerDown: (event) => event.stopPropagation(),
                    style: {
                      position: 'absolute',
                      top: 'calc(100% + 4px)',
                      left: 0,
                      width: 200,
                      padding: 8,
                      fontSize: 12,
                      borderRadius: 7,
                      border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.4))',
                      background: 'var(--dsw-alias-bg-layer-3, #2a2a31)',
                      color: 'var(--dsw-alias-label-primary, #fff)',
                      boxShadow: '0 6px 20px rgba(0,0,0,0.3)',
                    },
                  },
                  h('div', { style: { marginBottom: 6, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, comment.text),
                  h('div', { style: { opacity: 0.65, marginBottom: 6 } }, comment.frameId || '—'),
                  h(ToolButton, { onClick: () => void resolveComment(comment.id) }, t('commentResolve')),
                )
              : null,
          ),
        );

      const draftOverlay = commentDraft
        ? h(
            'div',
            {
              onPointerDown: (event) => event.stopPropagation(),
              style: {
                position: 'absolute',
                left: Math.max(8, Math.min(commentDraft.x * viewport.zoom + viewport.x, 100000)),
                top: Math.max(8, commentDraft.y * viewport.zoom + viewport.y),
                zIndex: 20,
                width: 224,
                padding: 8,
                borderRadius: 8,
                border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.4))',
                background: 'var(--dsw-alias-bg-layer-3, #2a2a31)',
                color: 'var(--dsw-alias-label-primary, #fff)',
                boxShadow: '0 8px 24px rgba(0,0,0,0.32)',
              },
            },
            h('textarea', {
              autoFocus: true,
              value: commentDraft.text,
              placeholder: t('commentPlaceholder'),
              rows: 3,
              onChange: (event) => setCommentDraft(Object.assign({}, commentDraft, { text: event.target.value })),
              style: { width: '100%', boxSizing: 'border-box', fontSize: 12, padding: 6, borderRadius: 6, border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.4))', background: 'var(--dsw-alias-bg-base, transparent)', color: 'inherit', resize: 'vertical' },
            }),
            h('div', { style: { display: 'flex', gap: 6, marginTop: 6 } },
              h(ToolButton, { onClick: () => void saveComment() }, t('commentSave')),
              h(ToolButton, { onClick: () => setCommentDraft(null) }, t('commentCancel')),
            ),
          )
        : null;

      const emptyState =
        !loading && frames.length === 0
          ? h(
              'div',
              { style: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, textAlign: 'center', padding: 32, boxSizing: 'border-box' } },
              h('div', { style: { fontSize: 17, fontWeight: 600 } }, t('emptyTitle')),
              h('div', { style: { maxWidth: 460, fontSize: 13, lineHeight: 1.7, color: 'var(--dsw-alias-label-secondary, inherit)' } }, t('emptyHint')),
              h(ToolButton, { onClick: () => void load(false) }, t('emptyReload')),
            )
          : null;

      const commentsPanel = h(
        'div',
        { style: { width: 230, flex: 'none', borderLeft: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.3))', background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.06))', padding: 10, boxSizing: 'border-box', overflowY: 'auto' } },
        h('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 8 } }, t('commentsTitle') + '（' + comments.filter((comment) => !comment.resolved).length + '）'),
        comments.length === 0
          ? h('div', { style: { fontSize: 12, opacity: 0.65 } }, t('noComments'))
          : comments.map((comment) =>
              h(
                'div',
                { key: comment.id, style: { fontSize: 12, padding: '6px 0', borderTop: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.18))', opacity: comment.resolved ? 0.5 : 1, lineHeight: 1.55 } },
                h('div', { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, comment.text),
                h('div', { style: { opacity: 0.6, marginTop: 2, fontSize: 11 } }, (comment.frameId || '—') + (comment.resolved ? '  ·  ' + t('commentResolved') : '')),
                comment.resolved ? null : h('div', { style: { marginTop: 4 } }, h(ToolButton, { onClick: () => void resolveComment(comment.id) }, t('commentResolve'))),
              ),
            ),
      );

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, color: 'var(--dsw-alias-label-primary, inherit)' } },
        toolbar,
        h('div', { style: { padding: '8px 10px 0' } },
          h(Banner, { tone: 'error', text: banner ? banner.text : '', onDismiss: () => setBanner(null) }),
          h(Banner, { tone: 'info', text: notice ? notice.text : '', onDismiss: () => setNotice(null) }),
        ),
        h(
          'div',
          { style: { flex: 1, minHeight: 0, display: 'flex' } },
          h(
            'div',
            {
              ref: hostRef,
              onPointerDown: onBackgroundPointerDown,
              style: {
                position: 'relative',
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                cursor: mode === 'comment' ? 'crosshair' : 'grab',
                background: 'var(--dsw-alias-bg-base, rgba(0,0,0,0.06))',
                backgroundImage: 'radial-gradient(var(--dsw-alias-border-l2, rgba(127,127,127,0.35)) 1px, transparent 0)',
                backgroundSize: '24px 24px',
              },
            },
            loading ? h('div', { style: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 13, opacity: 0.75 } }, t('loading')) : null,
            emptyState,
            h(
              'div',
              {
                style: {
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  transform: 'translate(' + viewport.x + 'px, ' + viewport.y + 'px) scale(' + viewport.zoom + ')',
                  transformOrigin: '0 0',
                },
              },
              frames.map((frame) =>
                h(FrameView, {
                  key: frame.id,
                  frame: frame,
                  html: htmlById[frame.id] || '',
                  selected: frame.id === selectedFrameId,
                  selectedElement: selectedElement && selectedElement.frameId === frame.id ? selectedElement.info : null,
                  mode: mode,
                  zoom: viewport.zoom,
                  reloadToken: reloadTokens[frame.id] || 0,
                  onSelect: selectFrame,
                  onElementSelected: onElementSelected,
                  onElementChanged: onElementChanged,
                  onMoveBy: moveFrame,
                  onResize: resizeFrame,
                  onReloadFrame: reloadFrame,
                  onStartComment: (frameId) => {
                    const anchor = frames.find((item) => item.id === frameId);
                    setCommentDraft({
                      x: anchor ? Math.round(anchor.x + 16) : 40,
                      y: anchor ? Math.round(anchor.y - 12) : 40,
                      frameId: frameId,
                      text: '',
                    });
                  },
                  registerCommand: registerCommand,
                  t: t,
                }),
              ),
              commentOverlays,
            ),
          ),
          draftOverlay,
          selectedElement ? h(ElementInspector, { frame: selectedFrame || { id: selectedElement.frameId, name: selectedElement.frameId }, info: selectedElement.info, command: applyElementCommand, onDeselect: () => { setSelectedElement(null); applyElementCommand({ cmd: 'clearSelection' }); }, t: t }) : null,
          showComments ? commentsPanel : null,
        ),
      );
    }

    /** Zoom around the viewport centre, used by the toolbar buttons. */
    function zoomBy(current, factor, schedule) {
      const zoom = clamp(current.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      const next = { x: current.x, y: current.y, zoom: zoom };
      if (schedule) schedule(next);
      return next;
    }

    /** Screen point (canvas-local px) to world coordinates. */
    function screenToWorld(px, py, viewport) {
      return { x: (px - viewport.x) / viewport.zoom, y: (py - viewport.y) / viewport.zoom };
    }

    /** The topmost frame containing one world point, or `null`. */
    function frameAt(project, x, y) {
      const frames = project && project.frames ? project.frames : [];
      for (let index = frames.length - 1; index >= 0; index -= 1) {
        const frame = frames[index];
        if (x >= frame.x && x <= frame.x + frame.width && y >= frame.y && y <= frame.y + frame.height + CHROME_HEIGHT) return frame;
      }
      return null;
    }

    // ------------------------------------------------------------ seat parts

    /** Sidebar glyph: two overlapping artboards. */
    function DesignIcon() {
      return h(
        'svg',
        { viewBox: '0 0 64 64', width: 20, height: 20, 'aria-hidden': true, style: { display: 'block' } },
        h('rect', { x: 6, y: 10, width: 32, height: 42, rx: 5, fill: 'none', stroke: 'currentColor', strokeWidth: 4 }),
        h('rect', { x: 26, y: 24, width: 32, height: 26, rx: 5, fill: 'currentColor', fillOpacity: 0.18, stroke: 'currentColor', strokeWidth: 4 }),
      );
    }

    /** Full-screen seat: the `main` panel opened by the sidebar entry. */
    function DesignCanvasPage(props) {
      const { ctx, bridge, tracker, t } = props;
      const sessionId = useSessionId(tracker, undefined);
      return h(Canvas, { ctx: ctx, bridge: bridge, sessionId: sessionId, variant: 'main', t: t });
    }

    /** Split seat: the right Sidebar tab, which shares the column with the chat. */
    function DesignCanvasTabBody(props) {
      const { ctx, bridge, tracker, t } = props;
      const sessionId = useSessionId(tracker, props.sessionId);
      return h(Canvas, { ctx: ctx, bridge: bridge, sessionId: sessionId, variant: 'tab', t: t });
    }

    /** The tab chip's label. */
    function DesignTabTitle(props) {
      const t = props.t || ((key) => copy[key] || key);
      return h('span', null, t('tabTitle'));
    }

    // -------------------------------------------------------------- activate

    return {
      inject: ['slots', 'locale', 'layout', 'sidebarRightTabs', 'sidebarRight', 'remote', 'remote.workspaceFiles'],

      /** The write-transport switch, so the path is testable without a Host. */
      setTransport: setTransport,

      /**
       * Register both seats, the sidebar entry and the right-tab type.
       * @param ctx - Client root context.
       */
      apply(ctx) {
        // Console handle for manual verification: with no Host route yet, this is
        // how the full write path gets exercised (see `setTransport`).
        window.__dshDesignCanvas = {
          setTransport: setTransport,
          getTransport: function () {
            return transport;
          },
        };

        ctx.effect(() => ctx.locale.register(NS, { zh: copy, en: copy }), 'design-canvas:dictionaries');
        const t = ctx.locale.bind(NS);

        const tracker = createSessionTracker(ctx);
        ctx.effect(() => tracker.start(), 'design-canvas:session tracker');

        const bridge = createBridge(ctx);

        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, (props) =>
            h(DesignCanvasPage, Object.assign({}, props, { ctx: ctx, bridge: bridge, tracker: tracker, t: t })),
          ),
        );

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 40, label: () => t('panel'), locale: NS }, DesignIcon),
        );

        // Right Sidebar tab type, exactly the trio the shipped sidebar-files uses.
        ctx.effect(
          () =>
            ctx.sidebarRightTabs.register({
              id: TAB_ID,
              kind: TAB_KIND,
              priority: 'extension',
              title: () => t('tabTitle'),
            }),
          'design-canvas:right tab type',
        );

        ctx.slots.inject('sidebar.right.pane.tab', () =>
          ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID, locale: NS }, (props) =>
            h(DesignCanvasTabBody, Object.assign({}, props, { ctx: ctx, bridge: bridge, tracker: tracker, t: t })),
          ),
        );

        ctx.slots.inject('sidebar.right.pane.tab.title', () =>
          ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: TAB_ID }, (props) =>
            h(DesignTabTitle, Object.assign({}, props, { t: t })),
          ),
        );
      },
    };
  },
});
