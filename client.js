/**
 * Design Preview — 客户端半（`dsh-design-agent`）。
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
  id: 'dsh-design-agent',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    // ---------------------------------------------------------------- 常量

    const NS = 'dsh-design-agent';
    const TAB_ID = 'design-preview';
    const TAB_KIND = 'design-preview';
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
      reloadFrame: '重新加载这一屏', fitWidth: '适应宽度',
      refLabel: '最近引用', refCopy: '复制引用', refCopied: '已复制引用',
      refEmpty: '点一个元素，它就会变成一个引用胶囊进对话输入框（还没引用过）。',
      refInsertedHint: '已作为引用胶囊插入对话输入框，接着打一句要改什么就行（发送前还能改）。',
      refDegraded: '引用胶囊不可用，已降级为纯文本引用：',
      refFailed: '引用没能插进对话输入框：',
      refFallbackHint: '把这行复制到对话输入框即可。', refNoSession: '找不到聊天输入框：会话可能没打开，或输入框当前被禁用。',
      close: '收起', handoffTitle: '落地到项目', handoffHint: '命令通道不可用，已降级为复制指令。把下面这段粘进对话框即可。',
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

    // -------------------------------------------------- 引用文本 / 输入框注入表

    /** 引用里元素文字的长度上限：引用是"指路"，不是"复述整段文案"。 */
    const REF_TEXT_MAX = 40;

    /** 归一化空白并截断：引用文本必须定长可读，不能被元素里的换行/空行撑破。 */
    function refText(raw, max) {
      const flat = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
      const limit = Number.isFinite(max) && max > 0 ? max : REF_TEXT_MAX;
      return flat.length > limit ? flat.slice(0, limit) + '…' : flat;
    }

    // ---- 引用胶囊：source 名 / 标签上限 / 自包含 ref 的编解码 ----

    /**
     * 引用 source 的名字。它同时是三个地方的路由键：
     * 1) `@` 菜单里的分组名；2) 胶囊节点上的 `source` 字段；3) 发送时按名字找 codec 的键。
     */
    const REF_SOURCE = 'design-element';
    /** ref 里的命名空间前缀，防止别的 source 的 ref 被我们误解析。 */
    const REF_PREFIX = '@design/';
    /** 胶囊标签里"元素文字"与"屏名"各自的长度上限（标签会长在输入框里，必须短）。 */
    const REF_LABEL_TEXT_MAX = 14;
    const REF_LABEL_FRAME_MAX = 12;

    /** UTF-8 → base64url（不用 btoa 的 latin1 捷径，中文屏名会炸）。 */
    function b64urlEncode(text) {
      const bytes = typeof TextEncoder === 'function' ? new TextEncoder().encode(text) : null;
      if (!bytes) return '';
      const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
      let out = '';
      for (let i = 0; i < bytes.length; i += 3) {
        const b0 = bytes[i];
        const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
        const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
        out += table[b0 >> 2];
        out += table[((b0 & 3) << 4) | ((b1 === undefined ? 0 : b1) >> 4)];
        if (b1 === undefined) break;
        out += table[((b1 & 15) << 2) | ((b2 === undefined ? 0 : b2) >> 6)];
        if (b2 === undefined) break;
        out += table[b2 & 63];
      }
      return out;
    }

    /** base64url → UTF-8 文本；解不出来返回 null（不抛）。 */
    function b64urlDecode(text) {
      const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
      const clean = String(text || '').replace(/[^A-Za-z0-9_-]/g, '');
      const bytes = [];
      let buffer = 0;
      let bits = 0;
      for (let i = 0; i < clean.length; i += 1) {
        const value = table.indexOf(clean.charAt(i));
        if (value < 0) continue;
        buffer = (buffer << 6) | value;
        bits += 6;
        if (bits >= 8) {
          bits -= 8;
          bytes.push((buffer >> bits) & 0xff);
        }
      }
      try {
        return new TextDecoder().decode(new Uint8Array(bytes));
      } catch (error) {
        return null;
      }
    }

    /**
     * 把一个点选到的元素压成"自包含"的引用数据。
     *
     * 为什么必须自包含：胶囊会被写进草稿并**跨刷新持久化**，页面重载后 `codec.serialize`
     * 只拿得到 `ref` 这一个字符串。任何"ref → 插件内存里的映射表"的写法都会在刷新后失联，
     * 而序列化失败会**阻塞发送**，等于把用户的输入卡死。所以定位信息全部编进 ref。
     */
    function refPayload(frame, info) {
      const safe = info && typeof info === 'object' ? info : {};
      return {
        f: frame && frame.id ? String(frame.id) : '',
        n: frame && frame.name ? String(frame.name) : frame && frame.id ? String(frame.id) : '未命名屏',
        h: frame ? framePath(frame) : '',
        t: String(safe.tag || '').trim(),
        s: String(safe.path || '').trim(),
        x: refText(safe.text),
      };
    }

    /** 引用数据 → 胶囊的 ref 字符串。 */
    function encodeRef(payload) {
      return REF_PREFIX + b64urlEncode(JSON.stringify(payload));
    }

    /** 胶囊的 ref 字符串 → 引用数据；不是我们的 ref 或解不出来返回 null。 */
    function decodeRef(ref) {
      const text = String(ref == null ? '' : ref);
      if (text.indexOf(REF_PREFIX) !== 0) return null;
      const json = b64urlDecode(text.slice(REF_PREFIX.length));
      if (!json) return null;
      try {
        const parsed = JSON.parse(json);
        return parsed && typeof parsed === 'object' ? parsed : null;
      } catch (error) {
        return null;
      }
    }

    /**
     * 引用数据 → **给 agent 看的那段话**（五行定位信息）。
     *
     * 只写定位必需的五样：哪一屏、什么元素、选择器、当前文字、在哪个文件。
     * 刻意不带颜色/字号/内外边距——用户要点评的是元素本身，把计算样式铺进去只会
     * 让引用变成一张属性表（那正是被砍掉的属性面板的毛病）。
     * 不写 Markdown 反引号：目标是"人能读、agent 能 grep"，反引号只会添噪。
     */
    function locatorText(payload) {
      const p = payload && typeof payload === 'object' ? payload : {};
      const tag = String(p.t || '').trim() || '(未知元素)';
      const selector = String(p.s || '').trim() || '(没有拿到选择器)';
      const text = String(p.x || '').trim() || '(这个元素没有文字)';
      const name = String(p.n || '').trim() || String(p.f || '').trim() || '未命名屏';
      const file = String(p.h || '').trim() || (p.f ? DESIGN_DIR + '/frames/' + p.f + '.html' : DESIGN_DIR + '/（未知文件）');
      return [
        '【设计元素】' + name + (p.f ? '（frame: ' + p.f + '）' : ''),
        '元素：' + tag,
        '选择器：' + selector,
        '当前文字：' + text,
        '文件：' + file,
      ].join('\n');
    }

    /** 引用数据 → 胶囊标签：`元素文字 · 屏名`（无文字回落到标签名）。 */
    function chipLabel(payload) {
      const p = payload && typeof payload === 'object' ? payload : {};
      const head = refText(p.x, REF_LABEL_TEXT_MAX) || refText(p.t, REF_LABEL_TEXT_MAX) || '元素';
      // 屏名常写成「订阅订单列表 · SaaS 后台」这种带子标题的形式；胶囊里只取主标题那一段，
      // 否则截断会切在「· Saa…」这种半截词上，比不截还难读。
      const rawName = String(p.n || '').trim();
      const mainName = rawName.split(' · ')[0] || rawName;
      const frame = refText(mainName, REF_LABEL_FRAME_MAX) || String(p.f || '').trim() || '未命名屏';
      return head + ' · ' + frame;
    }

    /**
     * 引用胶囊是否可用：只有 @ source 注册成功才为 true。
     *
     * 为什么必须守这一条：胶囊的模型文本由 source 的 codec 产出，`serializeReference` 找不到
     * owner 时会**拒绝**，也就是用户按发送会被 `no serializer` 拦下。所以注册失败时宁可降级成
     * 纯文本引用，也绝不插一个"发不出去"的胶囊。
     */
    let chipSourceReady = false;

    /** 最近一次引用的调试快照（`{payload, ref, label}`），供验收钩子读取。 */
    let lastRefDebug = null;

    /**
     * 读一个可选的客户端服务，读不到返回 null。
     *
     * 必须裹 try/catch：Cordis 的 context 代理在读**未注入**的服务属性时是直接抛异常，
     * 不是返回 undefined（这个坑在 remote.commands 上踩过一次）。`inputTriggers` 刻意
     * **不写进 inject**：它是胶囊这条增强路径的依赖，不该因为某个 profile 缺它就让整个
     * 预览面板激活失败。
     */
    function optionalService(ctx, key) {
      // 先走 ctx.get()：Cordis 里没有 inject 声明的服务，属性访问会抛（见上面的说明），
      // 而 ctx.get() 是按名字取服务的正规入口（同 profile 的 ui-skill 就是这么拿 inputTriggers 的）。
      try {
        if (typeof ctx.get === 'function') {
          const viaGet = ctx.get(key);
          if (viaGet) return viaGet;
        }
      } catch (error) {
        /* 取不到就走下面的属性访问兜底 */
      }
      try {
        return ctx[key] || null;
      } catch (error) {
        return null;
      }
    }

    /**
     * 会话 → 输入框动作面（`InputActions`）。
     *
     * 为什么需要这张表：插入文本的能力（`insertText`）属于**聊天列自己的**会话作用域插槽，
     * 而预览面板挂在右侧栏，两者只有"当前会话"这一个共同点。桥（见 `ComposerBridge`）
     * 会在聊天列上登记一份，预览面板优先用自己 props 上的，拿不到时回落到这里。
     */
    const composerInserters = {
      map: new Map(),
      register(sessionId, actions) {
        if (!sessionId || !actions) return () => undefined;
        this.map.set(sessionId, actions);
        return () => {
          if (this.map.get(sessionId) === actions) this.map.delete(sessionId);
        };
      },
      get(sessionId) {
        return (sessionId && this.map.get(sessionId)) || null;
      },
      /** 故障注入点：验收者用它构造"输入框动作面不可用"，走可见失败分支。 */
      clear() {
        this.map.clear();
      },
    };

    /**
     * 引用文本插进聊天输入框时，草稿非空要补的分隔符。
     *
     * 读的是输入框 DOM 的**空/非空**，不是它的内容：内容投影要处理引用 chip 与换行，容易出错，
     * 而我们只需要一个布尔量。空判断覆盖两件事——有没有文字节点、有没有引用 chip
     * （`data-composer-text-ref` / `data-lexical-decorator`），只算其中之一会把"只有 chip 的草稿"
     * 误判成空。
     */
    function composerDraftEmpty() {
      if (typeof document === 'undefined') return true;
      const box = document.querySelector('[data-composer-input]');
      if (!box) return true;
      if (typeof box.innerText === 'string' && box.innerText.trim() !== '') return false;
      return box.querySelectorAll('[data-composer-text-ref], [data-lexical-decorator]').length === 0;
    }

    /**
     * 把输入框的光标收拢到草稿末尾（**不聚焦**，所以不会把用户的视线从预览里抢走）。
     *
     * 为什么必须手动做这一步：插入走的是 `insertText`，而编辑器在没有焦点时插入完会把选区
     * 留在文档开头（实测：插入后再敲字变成 `ZZ【设计元素】…`）。纯 DOM 地设置 Range 就够——
     * 实测敲字会落在末尾（`REF-1ZZ`），Lexical 会认这个选区。
     *
     * 放在 rAF 里：`insertText` 之后 Lexical 自己还要提交一次 DOM 更新，抢在它前面设选区会被覆盖。
     */
    function collapseComposerCaretToEnd() {
      if (typeof window === 'undefined' || typeof document === 'undefined') return;
      const move = () => {
        const box = document.querySelector('[data-composer-input]');
        const selection = typeof window.getSelection === 'function' ? window.getSelection() : null;
        if (!box || !selection) return;
        const range = document.createRange();
        range.selectNodeContents(box);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      };
      // 立刻做一次（插入返回时选区正好在文档开头，先把它拨到末尾），再补两次：
      // Lexical 提交 DOM 更新与聚焦时的 reconciliation 都可能把选区改回去，只做一次不够。
      try {
        move();
      } catch (error) {
        /* 选区不可写时忽略：光标落点只影响体验，不影响引用是否插进去 */
      }
      if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(move);
      window.setTimeout(move, 60);
    }

    /** 取一个会话作用域的 Cordis ctx；取不到返回 null（胶囊路径需要它来派发 scoped 事件）。 */
    function sessionScopeOf(ctx, sessionId) {
      if (!ctx || !sessionId) return null;
      try {
        const sessions = ctx.sessions;
        if (!sessions || typeof sessions.scope !== 'function') return null;
        return sessions.scope(sessionId) || null;
      } catch (error) {
        return null;
      }
    }

    /**
     * 往输入框里插一个**引用胶囊**（不是文本）。
     *
     * 走的是输入框自己那条公开路径：session 作用域的 `slash/input-insert-reference` 事件
     * （`@mode bail`，由会话输入 shell 的同名监听器执行；返回 true 才代表编辑器真的应用了）。
     * 我们**不碰 contenteditable**、不自己造节点——胶囊的渲染、撤销、持久化、发送时序列化
     * 全部由那条管线负责。
     */
    function insertReferenceChip(ctx, sessionId, reference, span, actions) {
      const actx = sessionScopeOf(ctx, sessionId);
      if (!actx || typeof actx.bail !== 'function') return { ok: false, reason: '取不到会话作用域（会话可能未激活）' };
      // 先开一条独立的历史边界（踩过的坑 D7）：胶囊插入走的 `insertReference` 没带 history tag，
      // 会和"用户刚敲的那段字"并进同一条 Lexical 撤销记录——实测「打字 → 点元素 → Ctrl+Z」会把
      // 刚打的字一起吃掉、且找不回来。`insertText` 走的是**带 tag** 的编辑路径，所以在同一个位置
      // 先做一次零长度写入，就能把随后的胶囊放进它自己的那一步：一次撤销只去掉胶囊，草稿原样保留。
      let target = span;
      if (actions && typeof actions.insertText === 'function') {
        try {
          actions.insertText('', span);
          const fresh = typeof actions.captureInsertion === 'function' ? actions.captureInsertion() : null;
          if (fresh) target = fresh;
        } catch (error) {
          /* 边界没开成不影响主流程：胶囊仍可插入，只是撤销会并进上一步 */
        }
      }
      try {
        const applied = actx.bail(actx, 'slash/input-insert-reference', { reference: reference, span: target });
        if (applied === true) {
          collapseComposerCaretToEnd();
          return { ok: true };
        }
        return { ok: false, reason: '输入框未接受胶囊（编辑器可能被锁定）' };
      } catch (error) {
        return { ok: false, reason: msgOf(error) };
      }
    }

    /**
     * 把引用文本**追加**到聊天输入框草稿末尾。
     *
     * 只走 `captureInsertion()` + `insertText()`，不碰 `setDraft`。
     *
     * 两条实测教训（别退回去，退了就会出这两个坑）：
     * 1. `InputActions` **没有 `state`**（只有 captureInsertion / insertText / setDraft / persistDraft
     *    / addAttachments / removeAttachment / pruneAttachments / submit），所以"读一下草稿再决定"
     *    这条路没有数据源；草稿是否为空只能从输入框 DOM 的空/非空来判（见 {@link composerDraftEmpty}）。
     * 2. `setDraft` 虽然能把内容写对，但它会把光标留在文档开头：实测写完之后再敲字，字符会跑到
     *    整段草稿最前面（`ZZBEFORE…`）。`insertText` 则会把插入点留在写入内容之后，正好接上
     *    "用户接着打字往下一行写"。
     *
     * 分隔符规则：草稿非空就前置一个换行。输入框失焦时 `captureInsertion()` 给的是"没有选区"的
     * 默认值，不能拿它当"文档为空"的证据——这正是上一版两条引用首尾相粘的根因。
     *
     * 注意：**不调 `focus()`**。用户点元素时视线在预览里，抢焦点等于把输入位置从他手里拿走；
     * 引用只是把稿子备好，用户自己点一下输入框接着写。
     *
     * @returns {{ok: true} | {ok: false, reason: string}}
     */
    function insertReferenceIntoComposer(actions, text) {
      if (!actions || typeof actions.captureInsertion !== 'function' || typeof actions.insertText !== 'function') {
        return { ok: false, reason: '输入框动作面不可用' };
      }
      const separator = composerDraftEmpty() ? '' : '\n';
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const span = actions.captureInsertion();
          if (!span) break;
          if (actions.insertText(separator + text, span) === true) {
            collapseComposerCaretToEnd();
            return { ok: true };
          }
        } catch (error) {
          return { ok: false, reason: msgOf(error) };
        }
      }
      return { ok: false, reason: '插入被拒绝（输入框正在提交或被锁定）' };
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
      'var selected=null, hovered=null, hoverOutline=null, comments=[], layer=null, badgeScale=1;',
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
      '    var k = 1 / (badgeScale > 0 ? badgeScale : 1);',
      '    b.style.cssText = "position:fixed;pointer-events:auto;cursor:pointer;border:none;background:#d97a45;color:#fff;font-weight:600;font-family:system-ui;text-align:center;padding:0;box-shadow:0 1px 4px rgba(0,0,0,.35)"',
      '      + ";width:" + (18*k) + "px;height:" + (18*k) + "px;border-radius:" + (9*k) + "px;font-size:" + (11*k) + "px;line-height:" + (18*k) + "px";',
      '    b.style.left = Math.max(2, r.right - 9*k) + "px";',
      '    b.style.top = Math.max(2, r.top - 9*k) + "px";',
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
      '  if(insideMark(e.target)) return;',
      '  unhover(); hovered=e.target; hoverOutline=hovered.style.outline;',
      '  hovered.style.outline="2px solid #4c8dff";',
      '}, true);',
      'document.addEventListener("mouseout", function(e){ if(e.target===hovered) unhover(); }, true);',
      'function insideMark(node){ return !!(node && node.closest && node.closest("[data-dsh-comment-mark]")); }',
      'document.addEventListener("click", function(e){',
      '  if(!e.target) return;',
      '  if(insideMark(e.target)) return;  // 角标自己处理：放行给它的 onclick，别当成选中元素',
      '  e.preventDefault(); e.stopPropagation();',
      '  selected=e.target; unhover(); post({ type:"select", info: describe(selected) });',
      '}, true);',
      'document.addEventListener("submit", function(e){ e.preventDefault(); }, true);',
      'window.addEventListener("scroll", function(){ if(comments.length) layoutComments(); }, true);',
      'window.addEventListener("resize", function(){ if(comments.length) layoutComments(); });',
      'window.addEventListener("message", function(ev){',
      '  var d = ev.data;',
      '  if(!d || d[CMD]!==true) return;',
      '  if(d.cmd==="setComments"){ comments = Array.isArray(d.comments) ? d.comments : []; layoutComments(); return; }',
      '  if(d.cmd==="setBadgeScale"){ badgeScale = Number(d.scale) > 0 ? Number(d.scale) : 1; layoutComments(); return; }',
      '  if(d.cmd==="selectPath"){',
      '    var found=null; try{ found=document.querySelector(d.value); }catch(e){ found=null; }',
      '    if(found){ selected=found; post({ type:"select", info: describe(selected) }); }',
      '    return;',
      '  }',
      '  if(d.cmd==="clearSelection"){ selected=null; return; }',
      '  // 引用高亮：点选成功后由父页面点名脉冲一次，让用户看见"引用的是这个"。',
      '  // 用 rAF 自己衰减，不依赖 CSS 动画，也不往用户的设计文件里留任何痕迹。',
      '  if(d.cmd==="highlight"){',
      '    var target=null; try{ target = d.value ? document.querySelector(d.value) : selected; }catch(e){ target=null; }',
      '    if(!target) return;',
      '    var prevOutline=target.style.outline, prevOffset=target.style.outlineOffset, t0=0;',
      '    var step=function(ts){',
      '      if(!t0) t0=ts;',
      '      var k=Math.max(0, 1-(ts-t0)/520);',
      '      if(k<=0){ target.style.outline=prevOutline; target.style.outlineOffset=prevOffset; return; }',
      '      target.style.outline="3px solid rgba(76,141,255,"+(0.25+0.75*k).toFixed(3)+")";',
      '      target.style.outlineOffset=Math.round(2*k)+"px";',
      '      requestAnimationFrame(step);',
      '    };',
      '    requestAnimationFrame(step);',
      '    return;',
      '  }',
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

    // -------------------------------------------------------------- 预览画布

    /**
     * 一屏的渲染本体。
     *
     * 沙箱属性只有 `allow-scripts`：加了 `allow-same-origin` 就等于把父窗口交给帧内脚本，
     * 那是 AC10 的红线，已独立验收，不要动。
     */
    function PreviewFrame(props) {
      const { frame, doc, reloadToken, onReload, onSelectElement, registerCommand, t } = props;
      const iframeRef = React.useRef(null);
      /** 被测量的滚动容器：它的 clientWidth 决定缩放比。 */
      const hostRef = React.useRef(null);
      const [status, setStatus] = React.useState('loading');
      /** 视觉缩放比。iframe 内部的**布局尺寸始终等于声明尺寸**，缩放只发生在这层变换上。 */
      const [scale, setScale] = React.useState(1);

      const html = doc && typeof doc.text === 'string' ? doc.text : '';
      const bytes = doc && typeof doc.bytes === 'number' ? doc.bytes : byteLength(html);
      const tooLarge = (doc && doc.tooLarge === true) || bytes > MAX_FRAME_BYTES;
      const missing = !!(doc && doc.missing === true);
      const readError = doc && typeof doc.error === 'string' ? doc.error : null;
      const isEmpty = !tooLarge && !missing && !readError && html.trim().length === 0;
      const renderable = !tooLarge && !missing && !readError && !isEmpty;

      /**
       * 按声明尺寸布局、按面板宽度等比缩小。
       *
       * 关键点：iframe 的 width/height 一律等于 frame 的**声明值**（1440 就是 1440），
       * 所以帧内文档的布局尺寸与 design.json 一致（AC3）；缩放只是外层的一层 CSS 变换，
       * 不参与布局。`min(1, …)` 表示只缩不放，避免把小屏放大糊掉。
       * 用 ResizeObserver 跟随面板宽度（用户拖右侧栏宽度时实时变）。
       */
      React.useEffect(() => {
        const host = hostRef.current;
        if (!host || !renderable) return undefined;
        const measure = () => {
          // clientWidth 已排除滚动条；再留 2px，避免自己撑出横向滚动条。
          const available = host.clientWidth - 2;
          const next = Math.min(1, available > 0 ? available / frame.width : 1);
          setScale((current) => (Math.abs(current - next) < 0.001 ? current : next));
        };
        measure();
        if (typeof ResizeObserver === 'function') {
          const observer = new ResizeObserver(measure);
          observer.observe(host);
          return () => observer.disconnect();
        }
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
      }, [frame.width, renderable]);

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
          if (data.type === 'select') {
            setStatus('ok');
            return void (onSelectElement && onSelectElement(frame.id, data.info || null));
          }
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
      }, [frame.id, reloadToken, renderable, onSelectElement]);

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

      // 说明：这里曾经有一个"把缩放比同步给帧内批注角标"的 effect（`setBadgeScale`）。
      // 批注角标随批注 UI 一并退场，缩放不再需要通知帧内任何东西——帧只负责渲染和回报点选。
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
          // 外层按缩放后的尺寸占位：缩放是视觉变换，不改变 iframe 的布局盒子，
          // 所以必须给一个显式尺寸的裁切盒，否则 1440px 的自然宽会撑出横向滚动条。
          'div',
          {
            style: {
              position: 'relative',
              width: Math.round(frame.width * scale) + 'px',
              height: Math.round(frame.height * scale) + 'px',
              overflow: 'hidden',
              background: '#fff',
            },
          },
          h('iframe', {
            ref: iframeRef,
            key: frame.id + ':' + reloadToken,
            title: frame.name || frame.id,
            srcDoc: withProbe(html),
            // AC10：只给 allow-scripts，永远不要加 allow-same-origin。
            sandbox: 'allow-scripts',
            referrerPolicy: 'no-referrer',
            style: {
              display: 'block',
              // 布局尺寸 = 声明尺寸，一分不改（AC3 就靠这个）。
              width: frame.width + 'px',
              height: frame.height + 'px',
              border: 'none',
              background: '#fff',
              transform: 'scale(' + scale + ')',
              transformOrigin: 'top left',
            },
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

      return h(
        'div',
        { 'data-frame-id': frame.id, style: { position: 'relative', width: '100%', height: '100%', minHeight: 0, display: 'flex' } },
        // 滚动与测量都在这层：纵向可滚，横向裁掉，避免自己把宽度量小再触发重排震荡。
        h('div', { ref: hostRef, style: { flex: 1, minWidth: 0, overflowY: 'auto', overflowX: 'hidden' } }, body),
        // 缩放指示：绝对定位，不参与布局，所以不会反过来影响被测量的宽度。
        renderable && scale < 0.999
          ? h(
              'div',
              {
                style: {
                  position: 'absolute',
                  right: 8,
                  bottom: 8,
                  padding: '2px 7px',
                  fontSize: 11,
                  lineHeight: 1.6,
                  borderRadius: 5,
                  pointerEvents: 'none',
                  background: 'rgba(20,20,24,0.78)',
                  color: '#fff',
                },
              },
              t('fitWidth') + ' · ' + Math.round(scale * 100) + '%',
            )
          : null,
      );
    }

    // -------------------------------------------------------- 聊天输入框桥

    /**
     * 隐藏占位：把「这一会话的聊天输入框动作面」交给预览面板。
     *
     * 为什么需要它：插入引用靠 `inputActions.insertText`，而它属于**聊天列自己的**会话
     * 作用域插槽；预览面板在右侧栏，两者只共享"当前会话"。这个占位挂在
     * `conversation.input.dock`（聊天输入框上方的会话级插槽），拿到动作面后按 sessionId
     * 登记进 `composerInserters`，预览面板再取用。渲染 `null`：它不该被看见。
     *
     * 注意：`inputActions` 是会话作用域的标准 props，本来也会直接发给预览面板；
     * 这份登记是**回落**，两条路都不通时预览面板会给出可见的失败提示，不会静默。
     */
    function ComposerBridge({ sessionId, inputActions, onRegister }) {
      React.useEffect(() => {
        if (!sessionId || !inputActions) return undefined;
        return onRegister(sessionId, inputActions);
      }, [sessionId, inputActions, onRegister]);
      return null;
    }

    // -------------------------------------------------------------- 预览主体

    /**
     * 预览面板：单屏渲染 + 切屏 + 刷新 + 点元素引用进对话 + 落地。
     * 按 `sessionId` 定位当前工作区的 `.design/`，所以它天然跟着当前会话走。
     *
     * 这里**不再有"元素属性"抽屉**：点元素的语义是"我要就这个元素说句话"，
     * 落脚点必须是聊天输入框（用户原话：不要弹这个，直接在聊天框里引用这个元素）。
     */
    function Preview(props) {
      const { ctx, bridge, sessionId, t, onOpened, inputActions, onPreviewReady } = props;

      const [project, setProject] = React.useState(null);
      const [doc, setDoc] = React.useState(null);
      const [loading, setLoading] = React.useState(true);
      const [ready, setReady] = React.useState(false);
      const [banner, setBanner] = React.useState(null);
      const [notice, setNotice] = React.useState(null);
      const [currentId, setCurrentId] = React.useState(null);
      const [reloadToken, setReloadToken] = React.useState(0);
      /** 最近一次引用：{ frameId, frameName, tag, path, text, reference }。 */
      const [lastRef, setLastRef] = React.useState(null);
      const [refCopied, setRefCopied] = React.useState(false);
      const [handoffText, setHandoffText] = React.useState(null);
      const [copied, setCopied] = React.useState(false);

      const projectRef = React.useRef(null);
      const designVersionRef = React.useRef(null);
      const commandsRef = React.useRef(new Map());
      const currentIdRef = React.useRef(null);
      const sessionRef = React.useRef(null);
      /** 上面 props 上的动作面优先；它是会话作用域标准 props，理论上总是有。 */
      const inputActionsRef = React.useRef(null);
      inputActionsRef.current = inputActions && typeof inputActions.insertText === 'function' ? inputActions : null;

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

      /** 拿当前会话的输入框动作面：props 优先，桥的登记回落。 */
      const actionsNow = React.useCallback(() => inputActionsRef.current || composerInserters.get(sessionRef.current), []);

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
          setLastRef(null);
          setRefCopied(false);
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

      /**
       * 点选元素 = 引用进对话。整套交互的核心就这一段。
       *
       * 为什么不做"就地改属性"：用户看完成品明确否决了那个抽屉（"不要弹这个，
       * 应该在聊天框里引用这个元素，然后直接说要怎么改"）。元素属性表把人逼进
       * 6 个输入框，而人真正要说的是"这个按钮太土了"；把定位信息送进输入框，
       * 再把话语权还给聊天，才是这条链路该有的形状。
       *
       * 失败一律可见：插不进去就把引用文本摆出来让用户复制，绝不静默。
       */
      /**
       * 点选元素 = 在输入框里放一个**引用胶囊**。整套交互的核心就这一段。
       *
       * 用户对形态的要求是明确的（原话）：「点击元素的时候，不要在 DSH 的聊天框输入文字，
       * 而是应该像那个艾特符号或者调用指令的那种一样」——所以这里插的是胶囊节点，不是文本；
       * 五行定位信息改由胶囊的 codec 在**发送时**展开给 agent（见 apply 里的 source 注册）。
       *
       * 三级路径，每一级都可见：
       * 1) 胶囊（首选）：`slash/input-insert-reference` 由输入框自己应用；
       * 2) 纯文本（降级）：胶囊不可用（source 没注册上 / 取不到会话作用域 / 编辑器拒绝）时，
       *    用同一套定位信息走文本插入，并**明说已降级**——绝不硬塞一个发不出去的胶囊；
       * 3) 可见失败：两条都不通就报原因 + 把定位文本摆出来让用户复制。
       */
      const onSelectElement = React.useCallback(
        (frameId, info) => {
          const frame = projectRef.current && projectRef.current.frames ? projectRef.current.frames.find((item) => item.id === frameId) : null;
          if (!frame || !info) {
            setLastRef(null);
            return;
          }
          const payload = refPayload(frame, info);
          const reference = locatorText(payload);
          const label = chipLabel(payload);
          lastRefDebug = { payload: payload, ref: encodeRef(payload), label: label, reference: reference };
          setRefCopied(false);
          setLastRef({
            frameId: payload.f,
            frameName: payload.n,
            tag: payload.t,
            path: payload.s,
            text: payload.x,
            label: label,
            reference: reference,
            form: 'pending',
          });
          // 帧内脉冲一次：让用户看见"引用的是这个元素"（探针自己衰减，不留痕迹）。
          const command = commandsRef.current.get(frameId);
          if (command && info.path) command({ cmd: 'highlight', value: String(info.path) });

          const actions = actionsNow();
          if (!actions) {
            report(t('refFailed') + t('refNoSession') + ' ' + t('refFallbackHint'), 'error');
            setLastRef((previous) => (previous ? Object.assign({}, previous, { fallback: true, form: 'failed' }) : previous));
            return;
          }

          // 1) 胶囊。
          let chipReason = null;
          if (chipSourceReady) {
            try {
              const span = actions.captureInsertion();
              if (span) {
                const chip = insertReferenceChip(ctx, sessionId, {
                  source: REF_SOURCE,
                  ref: encodeRef(payload),
                  label: label,
                  clipboardText: '@设计元素:' + label,
                }, span, actions);
                if (chip.ok) {
                  setBanner(null);
                  report(t('refInsertedHint'));
                  setLastRef((previous) => (previous ? Object.assign({}, previous, { form: 'chip' }) : previous));
                  return;
                }
                chipReason = chip.reason;
              } else {
                chipReason = '拿不到插入位置';
              }
            } catch (error) {
              chipReason = msgOf(error);
            }
          } else {
            chipReason = '引用胶囊不可用（source 未注册）';
          }

          // 2) 降级：纯文本（编辑器此刻未被修改，重新取 span 也一定有效）。
          const result = insertReferenceIntoComposer(actions, reference);
          if (result.ok) {
            setBanner(null);
            report(t('refDegraded') + chipReason);
            setLastRef((previous) => (previous ? Object.assign({}, previous, { form: 'text' }) : previous));
            return;
          }

          // 3) 两条都不通：可见失败。
          report(t('refFailed') + result.reason + ' ' + t('refFallbackHint'), 'error');
          setLastRef((previous) => (previous ? Object.assign({}, previous, { fallback: true, form: 'failed' }) : previous));
        },
        [report, t, actionsNow, ctx, sessionId],
      );

      // 测试钩子出口：把"给本会话某帧的探针发指令"交出去（点选构造见下面的 selectElement）。
      //
      // 两条路都刻意复用生产代码：`__refSelect` 走的就是 `onSelectElement`（帧内真实点击最终
      // 也到这里），普通指令走的就是帧指令 ref。这样验收者不必去点沙箱帧，而验的又不是另一套
      // 逻辑。普通指令需要该帧的探针已登记（帧真的渲染出来了），帧没起来时返回 false。
      //
      // 注册**只做一次**：回调体和 onSelectElement 都走 ref。原因是踩过的坑——把
      // `onSelectElement` 写进依赖数组会让 effect 反复 cleanup+register，而 `React.useCallback`
      // 的恒定性不是契约；一旦它换了身份，注册就会在"删掉又登记"之间闪，钩子时灵时不灵
      // （实测：同样的调用，有时派发到回调、有时静默落空）。
      const selectRef = React.useRef(null);
      selectRef.current = onSelectElement;
      React.useEffect(() => {
        if (!onPreviewReady || !sessionId) return undefined;
        return onPreviewReady(sessionId, (frameId, payload) => {
          if (payload && payload.__refSelect) {
            const fn = selectRef.current;
            if (!fn) return false;
            fn(frameId, payload.info || null);
            return true;
          }
          const handler = commandsRef.current.get(frameId);
          if (!handler) return false;
          handler(payload);
          return true;
        });
      }, [onPreviewReady, sessionId]);

      /** 复制当前引用文本（失败时用户唯一需要的那一步）。 */
      const copyReference = React.useCallback(
        (text) => {
          const nav = typeof navigator === 'undefined' ? null : navigator;
          if (!nav || !nav.clipboard || typeof nav.clipboard.writeText !== 'function') {
            setRefCopied(false);
            return;
          }
          void nav.clipboard.writeText(text).then(
            () => setRefCopied(true),
            () => setRefCopied(false),
          );
        },
        [],
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
                registerCommand: registerCommand,
                t: t,
              })
            : null,
          // 引用状态条：引用成没成、引用了哪个元素，用户在这里能一眼核对。
          // 它是"引用"这件事在预览侧的可见账本——失败时唯一要做的动作（复制）也在这一行。
          currentFrame
            ? h(
                'div',
                {
                  style: { position: 'absolute', left: 8, right: 8, bottom: 8, zIndex: 4, display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 7, border: '1px solid ' + BORDER, background: 'var(--dsw-alias-bg-layer-3, rgba(30,30,36,0.94))', color: 'var(--dsw-alias-label-primary, inherit)', fontSize: 11, lineHeight: 1.5, },
                },
                lastRef
                  ? h(
                      'span',
                      { style: { flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, title: t('refLabel') + '：' + lastRef.reference },
                      t('refLabel') + '：' + (lastRef.label || lastRef.frameName) + (lastRef.form === 'text' ? '（纯文本）' : lastRef.form === 'chip' ? '（胶囊）' : ''),
                    )
                  : h('span', { style: { flex: 1, minWidth: 0, opacity: 0.7 } }, t('refEmpty')),
                lastRef
                  ? h(ToolButton, { onClick: () => copyReference(lastRef.reference), title: lastRef.reference }, refCopied ? t('refCopied') : t('refCopy'))
                  : null,
                lastRef ? h(ToolButton, { onClick: () => { setLastRef(null); setRefCopied(false); }, title: t('close') }, '×') : null,
              )
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
      return h(Preview, {
        ctx: ctx,
        bridge: bridge,
        sessionId: props.sessionId,
        // 会话作用域插槽的标准 props：插入引用的能力就是它带的（见 ComposerBridge 的说明）。
        inputActions: props.inputActions,
        // 测试钩子出口（在 apply 里注册）。漏了转发这一行，previewSessions() 会永远是空的。
        onPreviewReady: props.onPreviewReady,
        t: t,
        onOpened: onOpened,
      });
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
        /** 预览面板的注册表：会话 → { frameId → 给帧内探针发指令的函数 }。 */
        const frameCommands = new Map();
        /** 最近挂载的预览面板所在会话；测试钩子省略 sessionId 时用它。 */
        let lastPreviewSession = null;
        const sessionHandler = (sessionId) => (sessionId && frameCommands.get(sessionId)) || (lastPreviewSession && frameCommands.get(lastPreviewSession)) || null;
        const dispatch = (sessionId, frameId, payload) => {
          const handler = sessionHandler(sessionId);
          if (!handler) return false;
          return handler(frameId, payload);
        };

        window.__dshDesignCanvas = {
          setTransport: setTransport,
          getTransport: function () {
            return transport;
          },
          /**
           * 测试/诊断钩子：给验收者一个"不开沙箱帧也能构造点选事件"的入口。
           *
           * 沙箱帧（`sandbox="allow-scripts"`，无 `allow-same-origin`）在自动化里点不稳，
           * 而真实点击与这条路径在父页面走的是**同一个** `onSelectElement`，所以拿它做验收
           * 不会绕开被测逻辑。帧内真实点击仍是首选证据（见 docs/verification-*）。
           *
           * 两种形态（省略 sessionId 时用最近挂载的预览面板）：
           *   __dshDesignCanvas.selectElement('order-list', info)
           *   __dshDesignCanvas.selectElement(sessionId, 'order-list', info)
           * @returns 真派发到面板返回 true；面板没挂载或帧没注册返回 false。
           */
          selectElement: function (sessionId, frameId, info) {
            // 两种形态共用这一个入口，别改坏：
            //   selectElement(frameId, info)              → info 落在第 2 个形参
            //   selectElement(sessionId, frameId, info)   → 三个形参都在位
            if (info === undefined) return dispatch(null, sessionId, { __refSelect: true, info: frameId || null });
            return dispatch(typeof sessionId === 'string' ? sessionId : null, frameId, { __refSelect: true, info: info || null });
          },
          /** 测试/诊断钩子：直接给帧内探针发一条指令（例如 `{cmd:'highlight', value:选择器}`）。 */
          command: function (sessionId, frameId, payload) {
            return dispatch(typeof sessionId === 'string' ? sessionId : null, frameId, payload);
          },
          /** 故障注入：清空"输入框动作面"登记，用来复现"引用插不进去"的可见失败分支。 */
          clearComposerInserters: function () {
            composerInserters.clear();
          },
          composerInserters: composerInserters,
          /** 哪些会话的预览面板已经挂载（测试钩子就绪的标志）。 */
          previewSessions: function () {
            return Array.from(frameCommands.keys());
          },
          /** 最近一次引用的快照：`{payload, ref, label, reference}`（引用还没发生时返回 null）。 */
          lastRef: function () {
            return lastRefDebug;
          },
          /**
           * 走**输入框自己**的序列化路径，验证发送时模型会收到什么。
           * 传入 ref（省略则用最近一次引用的 ref）。这条路径证明 roster 能按 name 找到 source；
           * 直接调 codec 只能证明 codec 本身对，证明不了接线对。
           */
          serializeRef: function (ref) {
            const target = ref || (lastRefDebug ? lastRefDebug.ref : null);
            const triggerService = optionalService(ctx, 'inputTriggers');
            const actx = sessionScopeOf(ctx, lastPreviewSession);
            if (!target) return Promise.reject(new Error('还没有任何引用'));
            if (!triggerService || typeof triggerService.sessionOf !== 'function') return Promise.reject(new Error('inputTriggers 服务不可用'));
            if (!actx) return Promise.reject(new Error('取不到会话作用域'));
            try {
              const controller = triggerService.sessionOf(actx);
              return controller.serializeReference(REF_SOURCE, target, new AbortController().signal);
            } catch (error) {
              return Promise.reject(error);
            }
          },
          /** 故障注入：把胶囊路径标记为不可用，用来复现"已降级为纯文本引用"的可见分支。 */
          setChipAvailable: function (flag) {
            chipSourceReady = flag === true;
            return chipSourceReady;
          },
        };

        ctx.effect(() => ctx.locale.register(NS, { zh: copy, en: copy }), 'design-preview:dictionaries');
        const t = ctx.locale.bind(NS);

        const tracker = createSessionTracker(ctx);
        ctx.effect(() => tracker.start(), 'design-preview:session tracker');

        const bridge = createBridge(ctx);
        const autoOpener = createAutoOpener(ctx, bridge, tracker);
        ctx.effect(() => autoOpener.start(), 'design-preview:auto open');

        // 聊天输入框桥：挂在输入框上方的会话级插槽，只做一件事——把这一会话的
        // `inputActions` 登记进 composerInserters。渲染 null，不占地方。
        ctx.slots.inject('conversation.input.dock', () =>
          ctx.slots.register({ name: 'conversation.input.dock', id: 'design-preview-composer-bridge' }, (props) =>
            h(ComposerBridge, {
              sessionId: props.sessionId,
              inputActions: props.inputActions,
              onRegister: (sessionId, actions) => composerInserters.register(sessionId, actions),
            }),
          ),
        );

        // 引用胶囊的 @ source：注册成功，胶囊才可用（见 chipSourceReady 的说明）。
        //
        // 三件事都必须在 source 上：
        // 1) `codec` —— 发送时由输入框按 name 找到它，把 ref 展开成给 agent 看的定位文本；
        //    找不到 owner 或没有 codec 会 reject（`no serializer`），用户的发送会被拦下。
        // 2) `candidates` 返回空数组 + `showGroupTitle:false` —— 我们不走 @ 菜单这条路，
        //    但注册 source 是胶囊能被序列化的前提；空 ready 分组在菜单里渲染为 null，所以
        //    用户打 @ 时看到的仍然只有文件/会话，不会被塞一个空分组。
        // 3) `ref` 自包含 —— 草稿跨刷新持久化，序列化时只拿得到 ref 这一个字符串。
        const inputTriggers = optionalService(ctx, 'inputTriggers');
        if (inputTriggers && typeof inputTriggers.registerSource === 'function') {
          const source = {
            trigger: '@',
            name: REF_SOURCE,
            showGroupTitle: false,
            candidates: function () {
              return Promise.resolve([]);
            },
            onPick: function () {
              return undefined;
            },
            codec: {
              clipboardText: function (ref) {
                const payload = decodeRef(ref);
                return payload ? '@设计元素:' + chipLabel(payload) : '@设计元素';
              },
              serialize: function (ref) {
                const payload = decodeRef(ref);
                if (!payload) {
                  return Promise.reject(
                    new Error('无法解析这条设计元素引用（' + String(ref == null ? '' : ref).slice(0, 40) + '…）。请在输入框里删掉它，再重新点选元素。'),
                  );
                }
                return Promise.resolve(locatorText(payload));
              },
            },
          };
          ctx.effect(() => {
            let dispose = null;
            try {
              dispose = inputTriggers.registerSource(source);
              chipSourceReady = true;
            } catch (error) {
              chipSourceReady = false;
              console.error('[design-preview] 注册设计元素引用 source 失败，胶囊将不可用：', error);
            }
            return () => {
              chipSourceReady = false;
              if (typeof dispose === 'function') dispose();
            };
          }, 'design-preview: element reference source');
        }

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
                // 预览面板 → 测试钩子：按会话登记"给帧发指令"的函数。
                onPreviewReady: (sessionId, command) => {
                  frameCommands.set(sessionId, command);
                  lastPreviewSession = sessionId;
                  return () => {
                    if (frameCommands.get(sessionId) === command) frameCommands.delete(sessionId);
                    if (lastPreviewSession === sessionId) lastPreviewSession = null;
                  };
                },
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
