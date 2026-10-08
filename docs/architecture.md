# 架构说明

> 这份文档记录"为什么这样设计"和"怎么跑起来"，供后续维护者与 agent 使用。
> 执行契约见 [`specs/feature-dsh-design-canvas.yaml`](../specs/feature-dsh-design-canvas.yaml)（12 条验收标准；本文描述的形态为 **v6**，元素交互的 v7 变更见 [`specs/feature-element-reference-to-composer.yaml`](../specs/feature-element-reference-to-composer.yaml)）。

## 一句话

DSH 原生插件：用户在对话里说需求，agent 以「**每屏一个真实 HTML**」为单位设计 UI；用户在右侧栏的预览面板里边聊边看，可切换屏幕、点一个元素就把它变成一个 **@ 式引用胶囊**放进聊天输入框（发送时展开成给 agent 的五行定位信息），接着说一句要怎么改，满意后由 agent 把设计落成前端代码。

## 形态是怎么定下来的（重要，别走回头路）

第一版做的是**真无限画布**（平移/缩放/多屏并排/拖动改位置）。用户在实际界面里用过之后明确否决：

> 「整个画布都多余，我只要聊天 + 一个预览框」

随后确认预览框保留「点元素就地改属性」与「点元素写批注」两项能力。之后用户又指出挂载点的问题：

> 「放在左侧栏这样不好吧，我点击的时候都不知道这个设计是不是跟着这个工作区走的……放在右侧栏多一个设计的选项会更好？点击后打开当前工作区的 .design 里面的设计稿」

两条都成立，且第二条是真实的可用性缺陷：**左侧栏的面板列表是 root 作用域的（全局）**，而设计稿是**每个工作区各自一份**的，放在那里无法表达"这份设计属于哪个工作区"。右侧栏标签是 session 作用域的，天生跟随当前会话/工作区。

成本核对（当时的数据）：画布里"无限"那部分（相机与坐标换算）约 140 行、拖动约 60 行、并排世界图层约 60 行、世界坐标批注浮层约 150 行；而沙箱渲染、探针、读写通道、变更订阅、错误提示这些是**跨形态复用**的，占了绝大多数。

### 第三轮：元素属性面板与批注交互退场（v7）

上一轮保留下来的「点元素就地改属性」与「点元素写批注」，用户在真实界面里点过之后也否决了：

> 「点击设计元素的时候，不要弹出这个（元素属性面板），应该直接在 dsh 的会话聊天中引用这个点击的元素才对，然后用户自然就会输入要怎么调整，这样的话标注就不需要了，因为用户会直接引用元素直接和 dsh 聊天框聊天」

判断：属性抽屉把"改设计"变成一张 6 个输入框的小表单（文字/颜色/字号/内外边距），而人真正想说的是自然语言（"这个按钮太土了"）。这条链路里真正缺的能力，是**把"我在说哪个元素"无损地告诉 agent**；聊天输入框是 DSH 里本来就有、用户天天在用的输入面。既然点一下就能把"说的是哪个"说清楚，再维护一套"点着元素写批注"的锚点 UI 就是同一种表达的第二套说法，没有存在理由。

改动与成本（`client.js` 单文件，`git diff --numstat` = **+392 / -272**；被验版本 sha256[:16] = `7fb7b8ebadc473b0`，1821 行）：

- **删掉**：`Inspector` 抽屉（旧文件 1011–1125 行，115 行：6 个属性输入框 + 批注列表 + 就这个元素写批注）、工具栏「批注（N）」入口、元素选中态 `selected`、一批只服务于它的文案 key（`fieldText` / `fieldColor` / `fieldFontSize` / `commentNew` / `commentSave` / `commentLocate` / `commentUnanchored` / `noComments` / `deselect` / `pickHint` 等）与 `rgbToHex()`，以及批注角标随缩放同步的两个发送点。
- **新增**：会话 → 输入框动作面的注入桥（模块级 `composerInserters` + 隐藏占位 `ComposerBridge`）、引用构造、插入函数 `insertReferenceIntoComposer`（v8 起它是降级路径）、探针的 `{cmd:'highlight'}` 脉冲高亮、预览底部的「最近引用」状态条与失败时的一键复制。引用构造在 v7 时是一个 `buildElementReference(frame, info)`；v8 起按"数据 / 文本"拆成 `refPayload()` + `locatorText()`（**旧名字 `buildElementReference` 已不存在**，读旧文档时注意换算）。
- **一处曾经刻意保留（后来也清掉了）**：v7 时探针里给旧父页面用的批注角标代码没删（新父页面不再发 `setComments`，缩放的 `setBadgeScale` 发送点已删），当时定性为**兼容死代码**；批注能力整体移除时，这段残留连同批注浮层一并删除，`client.js` 里不再有批注角标与浮层。设计理由仍以注释留在 `client.js`（"这里**不再有**\"元素属性\"抽屉"、"元素属性表把人逼进 6 个输入框"），下一个人问"为什么砍"时答案就在原地。

**批注能力已整体移除（界面 + 数据 + 接口 + 客户端残留）**：v7 让画布不再能写批注，剩下那套没人调用的骨架这一次也清掉了——`.design/design.json` 不再有 `comments[]`（老的带批注文件读入时按当前结构归一化，批注字段不会写回）、`design_status` 不再返回 `comments`（`includeResolved` 一并取消）、host 的 `add_comment` / `resolve_comment` 两个 op 与探针里的批注角标/浮层代码都已删除。要恢复批注视图，等于连数据格式一起重做。

**引用是怎么进输入框的**（技术路径在 DSH 源码里核对过，不是猜）：`@deepseek-ai/dsh-client-ui-conversation` 通过 `ctx.uiSession.provide({ props: ['inputActions'] })` 把 `InputActions` 发给每个 session 作用域的插槽组件；预览面板挂在 `sidebar.right.pane.tab`（session 级），props 上本来就有它。插件另外注册一个隐藏的 `conversation.input.dock` 占位（`ComposerBridge`，渲染 `null`）作为回落，从标准 props 取同一份 `inputActions`，按 `sessionId` 登记进 `composerInserters`；两条路都不通时预览面板给可见失败提示，不静默。

**插入只有一条通道**（v8 起这是**降级路径**，主路径是胶囊，见下一节）：`captureInsertion()` 拿插入区间 → `insertText(text, span)` 写入，不碰 `setDraft`。`InputActions` 上**没有 `state`**（只有 `captureInsertion` / `insertText` / `setDraft` / `persistDraft` / `addAttachments` / `removeAttachment` / `pruneAttachments` / `submit`），所以"先读草稿内容再决定"没有数据源；草稿空不空只能读输入框 DOM——`composerDraftEmpty()` 看 `[data-composer-input]` 的 `innerText` 与引用 chip 节点（`data-composer-text-ref` / `data-lexical-decorator`）。`setDraft` 虽然能把内容写对，但会把光标留在文档开头（实测写完之后再敲字，字符会跑到整段最前面），所以不用它。

`insertText` 落到 shell 自有的 Lexical 编辑器（`insertAsyncText`）上，**这个 API 不要求输入框有焦点**（≠"插入过程不会移动浏览器焦点"，见下面路障 2），一次插入算一步撤销；span 带 `draftRev` 校验，只在版本未变且编辑器可写时生效（该包 README 的原话是"异步消费者在插入被拒绝后负责保留结果，等待用户操作"）。所以用户正好在打字时这次插入会被拒——`insertReferenceIntoComposer` 重试一次拿新 rev，两次都失败就在面板里报出可见原因，并把引用文本留给用户复制。

**两个必须记住的路障**（都真踩过）：

1. **输入框失焦时 `captureInsertion()` 返回 `{start: 0, end: 0}`** —— 那是"没有选区"的默认值，**不等于文档为空**。拿它判空草稿，两条引用就会首尾相粘（少了分隔符）。判空要用 `composerDraftEmpty()`，分隔符规则只有一条：**草稿非空就前置一个换行**。
2. **"不主动聚焦"不等于"焦点不会变"**：`insertText` 之后编辑器会把选区留在文档开头，用户接着敲字会跑到引用前面去（实测 `ZZ【设计元素】…`）。所以插入成功后要显式把光标收拢到草稿末尾（`collapseComposerCaretToEnd()`，纯 DOM `Range`，同步 + `rAF` + 60ms 各做一次，**依然不调 `focus()`**；实测随后敲字落在末尾 `REF-1ZZ`）。只做一次不够——Lexical 提交 DOM 更新与聚焦时的 reconciliation 都可能把选区改回去。
   **最终口径（Lead 2026-10-09 裁定，别再改回去）**：插入路径**不调用 `focus()`、不滚动、不跳视口**；为了让用户"引用完接着打字"落在末尾，**会主动把编辑器选区收拢到文档末尾，输入框因此成为 `document.activeElement`**——这是为达成用户诉求付的、且刻意选择的一步，**不是缺陷**。AC3 的判据也据此改成"不打断、可接着写"（不滚动/不跳视口、草稿一字不丢、光标落在末尾、一次撤销可恢复），`activeElement` 不再计入验收（裁定记录见 `specs/feature-element-reference-to-composer.yaml` 的 status_log v3 条目；该文件 2026-10-09 收尾为 version 5 / status verified；详见 `docs/verification-element-reference-to-composer.md` §3.3）。**文档里不要写"不抢焦点"**，写"不主动聚焦 + 收拢选区到末尾"。

### 第四轮：引用改为 @ 式胶囊（v8）

五行纯文本插进输入框这件事，用户看过之后又改了要求：

> 「点击元素的时候，不要在 DSH 的聊天框输入文字，而是应该像那个艾特符号或者调用指令的那种一样」

判断：纯文本引用信息是完整的，但在输入框里就是"一坨"，和 DSH 里已有的 `@文件` / `@会话` 不是同一种东西；用户心里对"引用"的预期就是那个胶囊。改成胶囊之后有一条界必须守住：**用户看到的变短了（一个胶囊），agent 看到的不能变**——胶囊的序列化结果仍然是 v7 那五行定位文本（`【设计元素】屏名（frame: id）` / 元素 / 选择器 / 当前文字 / 文件），所以 agent 侧的约定、`prompts/design-conventions.md` 的定位规则一个字都不用改。

**技术路径**（全在 `client.js`；参考实现是 DSH 自带的 `@deepseek-ai/dsh-client-ui-reference`，它注册文件/会话 source）：

- **注册 @ source**：`ctx.get('inputTriggers')` → `inputTriggers.registerSource({ trigger:'@', name: REF_SOURCE('design-element'), showGroupTitle:false, candidates: ()=>Promise.resolve([]), onPick: ()=>undefined, codec:{ clipboardText(ref), serialize(ref) } })`。
- **插入胶囊**：`ctx.sessions.scope(sessionId)` 拿 session 作用域 ctx → `actx.bail(actx, 'slash/input-insert-reference', { reference:{ source, ref, label, clipboardText }, span })`；`span` 来自 `inputActions.captureInsertion()`；**返回 true 才算插进去了**。**不传 `appearance`**，所以胶囊是「@ + 标签」的样子（不是文件图标，也没有"可点开"的样式）。胶囊的渲染、撤销、跨刷新持久化、发送时序列化全由输入框那条管线负责，插件**不碰 contenteditable**。
- **ref 必须自包含**：`@design/<base64url(JSON{f,n,h,t,s,x})>`（frame id / 屏名 / 文件 / 标签名 / 选择器 / 元素文字）。胶囊会被写进草稿并跨刷新持久化，页面重载后 `codec.serialize(ref)` 只拿得到这一个字符串——任何"ref → 插件内存映射表"的写法都会在刷新后失联，而序列化失败会**阻塞发送**（见路障 1）。实测：插胶囊 → 刷新页面 → 胶囊还在、`serialize` 仍返回五行文本。
- **标签**：`chipLabel()` = 「元素文字 · 屏名」，元素文字上限 14 字；屏名先按 ` · ` 取主标题（"订阅订单列表 · SaaS 后台" → "订阅订单列表"）再截 12 字——不这么做会截出"订阅订单列表 · Saa…"这种半截词。没文字的元素回落到标签名（`button · 订阅订单列表`）。
- **不污染 @ 菜单**：`candidates` 返回空数组 + `showGroupTitle:false`。我们不走"从菜单里搜元素"这条路（用户是在预览里点元素），空分组在菜单里渲染为 null，所以打 `@` 看到的仍然只有文件/会话。
- **三级降级，每一级都可见**：胶囊 →（source 没注册上 / 取不到会话作用域 / 编辑器拒绝）纯文本 + 面板提示「引用胶囊不可用，已降级为纯文本引用：<原因>」 →（两条都不通）可见失败 + 可复制文本。状态条会标出这次是「胶囊」还是「纯文本」。
- **给验收者的钩子**：`window.__dshDesignCanvas.serializeRef(ref)` 走的是**输入框自己的**序列化路径（证明 roster 能按 name 找到 source，而不只是 codec 本身对）；`lastRef()` 返回最近一次引用的 `{payload, ref, label, reference}`；`setChipAvailable(false)` 把胶囊路径标记为不可用，用来复现降级分支。

**v8 的三个路障**（都真踩过）：

1. **没注册成功就插胶囊 = 用户发不出去。** 发送时 `serializeReference(source, ref, signal)` 按 `name` 在 roster 里找 owner，**owner 缺失或没有 `codec` 直接 reject**——`slash: no serializer for reference source "<name>"`；源码注释的原话是"提交会被拦住，而不是静默降级成剪贴板文本"。所以 `chipSourceReady` 为 false 时**绝不插胶囊**，宁可降级为纯文本引用。
2. **胶囊会和"刚打的那段字"并进同一条撤销记录（D7）。** 胶囊插入走的 `insertReference` **不带 history tag**，于是「打字 → 点元素 → 一次 `Ctrl+Z`」会把刚打的草稿一起吃掉，而且找不回来（实测：`ABCD` → 空、`草稿找回测试` → `草稿找`；打字后**等 2.5 秒**再点元素就正常——因为 Lexical 自己已经切了历史边界）。
   修法是**插胶囊之前先开一条独立的历史边界**：`insertReferenceChip` 在 `bail` 之前先在同一位置做一次零长度写入（`actions.insertText('', span)`——`insertText` 走的是**带 tag** 的编辑路径），再重新 `captureInsertion()` 拿新 span，把胶囊放进这条新边界里。代价是**一次点选对编辑器写两次**（零长度定界 + 插胶囊）；边界没开成时**不阻断主流程**（胶囊照插，只是撤销会并进上一步）。实测：没有多余空行、输入框高度仍是 52px、一次 `Ctrl+Z` 只掉胶囊、草稿原样保留。
3. **`ctx.inputTriggers` 会静默失败。** Cordis 的 context 代理读**未注入**的服务属性是直接抛异常（不是返回 undefined）；把这个访问包在 try/catch 里取服务，会被吞成 null、然后悄悄走进降级路径——**不报错、不崩，功能就这么没了**，只有"必须出现胶囊"的断言能拦住它（D6）。取可选服务的正确姿势是 `optionalService(ctx, key)`：先 `ctx.get(key)`，失败再退属性访问。

## 三条不可动摇的产品取舍

1. **真源是文件，不是 UI 状态。** `.design/` 下的 `design.json` + `frames/*.html` + `tokens.css` 就是设计本身：可进 git、可 diff、可 review、可被 agent 用普通 read/write/edit 直接改。UI 只负责渲染、编辑入口与实时同步。（调研结论：没有主流产品把"画布 JSON"当真源——open-design 用 `DESIGN.md` + 真实文件，Onlook 用代码本身。）
2. **每一屏是真实网页，不是矢量图形。** 每屏一个自包含 HTML，在沙箱 iframe 里渲染。agent 本来就擅长写 HTML/CSS，导出代码几乎无损；也避免了自研矢量编辑器这个无底洞。
3. **只做单向 设计 → 代码。** 不做"代码改动反推回设计"的双向同步——公开证据显示这是当前无人真正解决的问题，官方 Figma MCP 都被批"给的是设计上下文而非可生产代码"。

## 目录结构

```
.
├── package.json          # 插件清单：dsh.bundle.patch + dsh.client，无构建步骤
├── cordis.patch.yml      # 把插件行插入 profile
├── index.js              # Host 半入口：注册工具 / systemPrompt / 写通道
├── client.js             # Client 半（单文件、自包含）：右侧栏预览面板
├── icon.svg              # 插件图标
├── locale/               # 插件显示元数据（meta.title / meta.description）
├── src/host/             # Host 侧模块（index.js 相对 import）
│   ├── design-project.js # .design/ 工程读写 = 唯一实现（工具与 HTTP 通道共用）
│   ├── tools.js          # 三个 Agent 工具
│   ├── http.js           # 写通道（同源 exact route）
│   └── types.js          # 跨端共享常量与类型
├── design-system/        # 设计契约层（让页面不丑的那一半）
│   ├── tokens/           # 3 套预设 + index.json
│   ├── templates/        # 起步 frame 模板（自包含中文 HTML）
│   └── tools/            # 设计契约自检脚本
├── prompts/              # 注入 systemPrompt 的设计约定与落地流程
├── scripts/              # 重启后自检脚本
├── specs/                # SPEC 与查看器
└── docs/                 # 本文档与验收证据
```

## 插件如何挂进 DSH

| 能力 | 扩展点 | 备注 |
|---|---|---|
| 预览面板（**唯一入口**） | client `sidebarRightTabs.register` + `sidebar.right.pane.tab` / `.title`（keyed，session 级） | 天然绑定当前工作区，这是选它而不是左侧栏的原因 |
| 用户怎么打开 | 右侧栏的添加控件打开的 **guide 页**；侧栏空态本身就是 guide，会列出各注册类型的胶囊 | 胶囊 `description` 写明"当前工作区的设计稿（.design/）" |
| 放大 | `ctx.layout.openRightbar(true, true)` / 还原 `(true, false)` | `track` = 是否占网格轨道；`fullscreen` = 铺满整帧并隐藏把手 |
| Agent 工具 | host `ctx.tools.register` | 手写 JSON Schema，不引入 `@deepseek-ai/dsh-tools` |
| 设计约定 | host `ctx.systemPrompt.section` | 正文来自 `prompts/design-conventions.md`，读不到时用内置兜底 |
| 写回 | host `ctx.webServer.register`（exact route） | 见下节 |
| 引用进对话 | ① `@` source：client `inputTriggers.registerSource`（`trigger:'@'`、`name:'design-element'`、`codec.serialize` 产出五行定位文本、`candidates` 空 + `showGroupTitle:false`）；② 插入：session 作用域 `actx.bail(actx, 'slash/input-insert-reference', …)`，span 来自 `inputActions.captureInsertion()`；③ 兜底：`conversation.input.dock` 隐藏占位（`ComposerBridge`）拿本会话 `inputActions` 走纯文本插入 | 胶囊的渲染/撤销/持久化/序列化全归输入框管线，插件不碰 contenteditable。**注意**：插入后会把选区收拢到草稿末尾（让用户接着打字落在末尾），输入框因此成为 `document.activeElement`——刻意选择，见上"路障 2"；source 没注册成功时必须降级为纯文本，见 v8 路障 1 |
| 文件变更通知 | 客户端 `workspaceFiles.changes` 流 + 定期 stat 轮询 | 单向：host 写文件 → 客户端感知 → 刷新，不另造推送通道 |

**已废弃的挂载点（不要再加回来）**：`sidebar.panellist`（左侧栏全局入口）与 `main`（全屏主面板座位）。原因是全局面板列表无法表达"这份设计属于哪个工作区"。

### 两个容易踩的扩展点细节

- `openTab` 本身就会 reveal 右侧栏，**打开标签不需要额外调 `openRightbar`**；只有「放大」才需要。
- `dsh-fs-local` 对目录的监听参数是 `{ ignoreInitial: true, depth: 0 }`，**只监听 `.design` 收不到 `.design/frames/*.html` 的变更**。所以刷新用的是"changes 流 + 定期 stat"双保险，两处都要留着。
- `insertText` 的 span 带 `draftRev`：**capture 与 insert 之间用户只要敲了字，这次插入就会被拒**。这不是 bug，是设计（拒绝比覆盖用户草稿安全），正确处理是重新 capture 重试一次；两次都失败才走可见失败分支。

> **命名说明（2026-10-09）**：包名、客户端模块 id、插件显示名已统一为 `dsh-design-agent` / 「设计预览」，但**写通道路径 `/design-canvas/api` 与 `.design/` 目录名保留不改**——前者是已验收的冻结契约（改它等于让上一轮的验收证据失效），后者是用户工作区里真实存在的目录（改名会破坏所有已有工作区）。同理，`specs/feature-dsh-design-canvas.yaml` 与 `docs/verification-feature-dsh-design-canvas.md` 是**画布形态那一轮**的历史文件名，按 id 稳定性保留。

## 写通道与安全模型

`POST /design-canvas/api`，请求体 `{ sessionId, method?, ops?, ... }`。

**为什么不用 session command 做高频写**：`command/run`、`command/done` 每次调用都会写进 session log，并被渲染成聊天里的一行；改设计是高频静默操作，用命令通道会把对话刷满，直接违背 AC7「不打断用户」。（低频、用户主动的动作——例如落地——用命令通道是合适的；AC9 目前走的是"复制指令卡片"降级方案，已登记为 SPEC 的 follow_up F1。）

**为什么必须自己补同源护栏**：`webServer` 注册的 handler 直接拿 node 原生 req/res，**绕过了 `/api` 的信任栅栏**。不加护栏就等于"任何能访问 127.0.0.1:3080 的页面都能写用户工作区文件"（典型 localhost CSRF）。因此 `src/host/http.js` 强制五条：

| 护栏 | 不满足时 |
|---|---|
| 只接受 `POST` | 405 |
| `Origin` 必须等于请求自身 Host 推导出的 origin | 403 |
| `Sec-Fetch-Site` 必须是 `same-origin`（存在时） | 403 |
| `Content-Type` 必须是 `application/json` | 415 |
| body ≤ 4 MiB，超限立刻停止读取（不销毁 socket，否则响应写不出去） | 413 |

还有一条不在状态码里、但同样是硬约束：**route 绝不接受客户端传来的路径**。只收 `sessionId`，由 host 用 `ctx.agents.get(sessionId)` → `session.header.cwd` 自己解析工作区。

### 这条护栏的边界（别误读）

**完全不带 `Origin` 与 `Sec-Fetch-Site` 头的请求会被放行（200）。** 这是刻意的：浏览器发起跨站 POST 一定会带 `Origin`，所以"任意网页 CSRF 写用户工作区"这条威胁是被挡住的；但**本机任意非浏览器进程可以直接调这个接口**。

结论要说清楚：这是**浏览器威胁模型下的同源保护，不等于对本地进程设防**。本机进程本来就有权限直接改工作区文件，为它再加一层机制收益很低，所以不做。若将来插件被用在多用户或远程场景，这里必须重新设计。

**一条实测事实**：跨站请求即使**不带 cookie**，拿到的也是 403 而不是 401——说明这条 route 确实在 `/api` 的信任栅栏之外，**Origin / Sec-Fetch-Site 护栏是它第一道、也是唯一一道防线**，任何时候都不能删。真实浏览器跨站 POST 实测：简单请求（不触发预检）真的发出去了，被 403 拦下；带 `application/json` 的预检直接失败、POST 根本没出去；两种情况下工作区文件零改动。

**一个操作两个调用方**：预览面板走的 HTTP 通道和 agent 走的 `design_canvas_apply` 工具调用的是 `design-project.js` 里的同一个函数，不存在两套逻辑。

## Agent 工具

| 工具 | 作用 |
|---|---|
| `design_status` | 无副作用。返回工程、frames、tokens、当前选中项。agent 动手前应先调它。 |
| `design_frame_write` | 新建或覆写一屏（`id/name/html/width/height/x/y`），返回 `{id, file, bytes}`。 |
| `design_canvas_apply` | 应用一组画布操作。词表：`add_frame / move_frame / resize_frame / rename_frame / delete_frame / switch_tokens / set_viewport / select`；**未知操作整批拒绝**（`EUNKNOWN`），不做部分应用。 |

改某一屏的页面内容也可以**直接用 read/write/edit 改 `.design/frames/<id>.html`**——预览面板会自动刷新，不必绕工具。

**UI 不再调用的 op**（保留以兼容与复用，别当漏接）：`move_frame`、`set_viewport`；`add_frame` 的 `x/y` 也不再影响任何布局。

唯一允许的例外：`design_status` 在发现 `design.json` 非法时，会按 AC11 把它备份成 `design.json.bak`（这是错误恢复的必要写入，不算违反"无副作用"）。

## 写通道的精确格式

```
POST /design-canvas/api            （exact、同源）
{ "method": "readProject" | "writeFrame" | "applyCanvasOps",
  "sessionId": "<会话 id>", ...参数 }
```
只给 `{ sessionId, ops }` 时等价于 `applyCanvasOps`。

响应恒为 `{ok:true, ...}` 或 `{ok:false, error:{code, message, path?}}`，**客户端只读 `body.ok`**；状态码仅给 curl 与验收用：

| 状态码 | 含义 |
|---|---|
| 200 | 成功 |
| 400 | 逻辑失败（`ENOFRAME` / `EUNKNOWN` / `EJSON`） |
| 403 | 非同源（Origin 或 Sec-Fetch-Site 不符） |
| 405 | 非 POST |
| 413 | body 超 4 MiB |
| 415 | Content-Type 不是 `application/json` |

操作对象用 **`op`** 作为判别字段；`kind` 作为兼容别名保留，内部会归一化。

## 数据格式

```
<workspace>/.design/
├── design.json   # viewport / selection / tokens 镜像 / frames[]
├── tokens.css    # 选中预设的逐字拷贝（不改变量名）
└── frames/*.html # 每屏一个自包含 HTML
```

`design.json` 的 `tokens` 字段是 `tokens.css` 的只读镜像，解析规则：去掉 `--` 后把第一个 `-` 换成 `.`
（`--color-primary` → `color.primary`，`--space-2` → `space.2`）。三套预设各 56 个变量，切换预算是整块替换、页面样式一行不改。

**不再被 UI 使用的字段**：`viewport`、`frames[].x/y`（保留仅为向后兼容）。

## 错误码

`ENOWRITE`（不可写，message 含失败路径与原因）、`EJSON`（design.json 非法，已备份为 `design.json.bak` 并回退空工程）、`ETOOLARGE`（单帧 >2 MiB）、`EEMPTY`（单帧 0 字节）、`ENOFRAME`、`EUNKNOWN`（同时覆盖未知方法 / 未知 op / 会话不存在，message 带中文原因）。

## 安装与生效（这段最容易踩坑）

插件以**本地目录 link** 方式装进 `web` profile：

```
plugin_manager  action: install_bundle  target: <本仓库绝对路径>
```

| 改了什么 | 怎么生效 |
|---|---|
| `client.js` / `locale/` | **刷新浏览器页面**即可（客户端模块按需重新拉取） |
| `index.js` / `src/host/**` | **必须重启 `dsh web`**。DSH 用 `await import(name)` 加载 host 模块且无 cache-bust，Node ESM 按 URL 缓存——禁用/启用插件行、甚至 `remove_bundle` + `install_bundle` 都拿不到新模块代。这是 DSH 的既定行为，不是插件 bug。 |
| `package.json` / `cordis.patch.yml` | 用 `plugin_manager` 的 `install_bundle` 重装。**不要手改 profile 下的 `package.json` / `cordis.patch.yml`，也不要在 profile 目录里跑 pnpm**——那是安装器负责的步骤。 |

判断变更是否真的生效：看 `plugin_manager` 返回的 `application` / `warnings`，不要看日志或进程列表。

## 验证

```bash
node --test src/host/*.test.js                    # host 层单测（50 项）
node design-system/tools/check-design-system.mjs  # 设计契约自检（12 项）
node scripts/post-restart-check.mjs               # 重启后：路由 / 工具 / 数据层三项体检
```

- 端到端：GUI `http://127.0.0.1:3080`（`dsh web` 启动时打印的 URL 带一次性 token；直接访问 `/` 会 401，重启后 token 会变）。
- 画布形态的独立验收报告：`docs/verification-feature-dsh-design-canvas.md`。
- 元素引用形态的验收报告：`docs/verification-element-reference-to-composer.md`（其中「独立复验结论」小节由未参与实现的验收者填写）。
- 沙箱验证要点：劫持帧的 `window.origin` 应为 `null`；控制台**不得**出现 Chrome 的 `can escape its sandboxing` 警告（出现即说明 `allow-same-origin` 被加上了）。

## 版本控制：`.design/` 该不该提交？

**在用户的项目里：应该提交。** 这是"真源是文件"这条取舍的前提——设计稿进了 git 才能 review、diff、回溯，也才能和代码改动一起被审查。

**在本插件仓库里：不提交，已写进 `.gitignore`。** 因为这里的 `.design/` 是开发与演示数据，不是插件源码。

需要留意的两点：

1. **验收时 AC4 的 git 口径（`git status --porcelain` 能看到 `.design/`）是在它"未跟踪但未被忽略"的状态下测的。** 加了忽略之后，同样的命令不再列出它——这**不影响** AC4 的实质（设计是磁盘上的真实文件、内容可 diff、agent 可直接 read/write/edit），只是口径变了。若将来要重跑那条口径，先临时移除 `.gitignore` 里的 `.design/` 一行。
2. 如果使用者项目里有宽泛的 ignore 规则把 `.design/` 吞掉，那是使用者的选择；插件不会替他改 `.gitignore`，但在 `README.md` 与本节都写明了建议。
