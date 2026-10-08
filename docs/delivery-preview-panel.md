# 设计预览面板（v5）交付说明

> 归属：T3（teammate-canvas）独占维护。
> 对应产物：`client.js`（sha256[:16] = `1cc97af9bca58b55`，1679 行，冻结版本）。
> 冻结后任何改动都要重新复核本文件第 4 节的验证方式。

---

## 1. v5 改了什么

### 1.1 删掉

| 删除项 | 说明 |
|---|---|
| 无限画布相机 | 平移、滚轮缩放（含光标锚定）、`zoomBy` / `screenToWorld` / `frameAt` 等坐标换算 |
| 拖动与自由布局 | 拖动 frame 改位置、按 x/y 绝对定位的多屏并排世界层 |
| viewport 写回 | UI 不再调用 `set_viewport` |
| 世界坐标批注浮层 | 批注从"画布坐标 x/y"改为"元素选择器 `target`" |
| 左侧栏入口 | 删掉 `sidebar.panellist` 注册 |
| 主面板座位 | 删掉 `main`（key=`design-canvas`）注册 |
| 「放大/还原」按钮 | 见 §3.6：`openRightbar` 是上报不是命令，右侧栏自带 Fullscreen 已满足需求 |

### 1.2 保留（跨形态复用，语义未动）

- **沙箱渲染内核**：`<iframe sandbox="allow-scripts">` + `srcdoc` + 探针注入 + 写回前 `stripProbe`。**安全语义一行未改**（AC10）。
- **五种占位**：0 字节空帧 / 超 2 MB 拒绝 / 死循环渲染超时 / 文件不存在 / 读取失败。判定顺序保证"读不出来"不会被误报成"空文件"。
- **读写通道**：`postApi` 单点封装 + `setTransport` 可注入；`workspaceFiles.changes` 流 + 900 ms stat 轮询双保险（AC7）。
- **失败红条**：写失败显示 `error.message`（含 host 给的路径与原因），并自动从磁盘回滚（AC12）。
- **右侧栏标签页注册**：`sidebarRightTabs.register` + `sidebar.right.pane.tab` / `.title` keyed 注册（唯一入口）。
- **元素检查器**：点元素就地改文字 / 文字色 / 背景色 / 字号 / 内边距 / 外边距（AC6）。

### 1.3 新增

- **切屏**：`‹ 第 N / M 屏 ›` + 屏名下拉；切屏写回 `select`，刷新浏览器后从 `design.json` 的 `selection.frameId` 恢复到同一屏。
- **按声明尺寸渲染 + 等比缩放**（见 §3.8）：iframe 的**布局尺寸恒等于 frame 的声明尺寸**（1440 就是 1440），外层用 `transform: scale()` 缩到面板宽度、只缩不放；右下角显示「适应宽度 · NN%」，`ResizeObserver` 跟随面板宽度。
- **元素锚点批注**：点元素 → 「就这个元素写批注」→ 存 `{ frameId, text, target, x:0, y:0 }`（AC8）。
- **批注角标**：探针在帧内给有批注的元素画编号角标，并按 `1/缩放` 反向放大，**在任意缩放下保持屏幕上恒定 18px**；**锚点失效时角标消失，但工具栏「批注（n）」仍能打开列表并显示「未锚定 + 原文」**，绝不静默丢弃。
- **guide 入口**：`sidebarRightTabs.register({ guide: [...] })`。右侧栏的 `+` 添加控件与空侧栏渲染的都是 guide 页，所以入口天然可见，无需另做按钮。
- **延迟自动打开**：`.design/` 从"没有 / 0 屏"变成"有 frame"时记一个待开标志，等 `session.running === false` 且键盘空闲 1.5 s 再开一次；5 分钟超时丢弃；面板一旦挂载即 `markOpened` 收手（用户手动开的也算）。
  **状态：已实现，但未通过验证**（记为 unverified + follow_up）。独立验收把 `.design/` 临时挪走造空态，仍无法得到一个可判定的初始态，因此这条**没有通过/失败的结论**，不能当作已验证。本文件第 4 节与 §3 均不依赖它。

---

## 2. 不再被 UI 调用的 op

**注意：host 侧这些 op 全部保留，不是漏接。** 保留理由是 host 层已通过独立验收（含 50 项单测与护栏实测），删掉要重开验收、净收益为负。`design.json` 的 `x` / `y` / `viewport` 字段同样保留但 UI 不再使用。

| op | 为什么不再调用 |
|---|---|
| `set_viewport` | 没有画布相机了 |
| `move_frame` | 没有拖动改位置了 |
| `add_frame` | 屏由 agent 生成；UI 改元素内容走 `method:'writeFrame'`，不新建 frame |
| `rename_frame` | 没有重命名 UI |
| `delete_frame` | 没有删除 UI（收尾清理时由人工/工具调用） |
| `switch_tokens` | 没有 token 切换 UI |

仍在调用：`select`（切屏写选中态）、`resize_frame`（尺寸预设）、`add_comment`（只带 `target`，x/y 恒 0）、`resolve_comment`；另有 `method:'writeFrame'`（元素改动写回）。

---

## 3. 本轮修掉的真 bug

每条都是**实测发现**，不是代码走查的猜测。

### 3.1 渲染死循环（面板直接不可用）

- **现象**：面板一打开就持续重渲染。
- **根因**：`comments` 每次渲染都用 `.filter()` 新建数组 → 送角标的 `useEffect` 依赖数组身份，每次都触发 → 帧内回报角标 → `setAnchoring`（新对象）→ 再渲染 → 自激。
- **修法**：`comments` 改 `useMemo`；effect 只依赖内容签名 `id|target`；`setAnchoring` 内容不变就返回原 state。
- **怎么验的**：真实 GUI 里打开面板不再自激；`setComments` 只在签名变化时下发。

### 3.2 `focusComment` 暂时性死区（一渲染就崩）

- **现象**：面板挂载即抛 `Cannot access 'focusComment' before initialization`。
- **根因**：把内联箭头函数改成 `useCallback` 时，`onCommentClick` 的依赖数组 `[comments, focusComment]` 在 `focusComment` 定义之前就要取值。
- **修法**：把 `onCommentClick` 移到 `focusComment` 之后定义。
- **怎么验的**：冒烟脚本升级成**真挂载测试**（迷你渲染器会递归调用函数组件）。为确认测试不是走过场，**把 bug 人为放回去**，脚本报 `MOUNT FAILED: Cannot access 'focusComment' before initialization`；修好后 `SMOKE PASS`。

### 3.3 探针被写进用户的设计文件

- **现象**：改一次元素文字，`frames/*.html` 从 23444 涨到 28563 字节，文件里出现 `<script data-dsh-canvas-probe="1">`。
- **根因**：探针回传的是 `document.documentElement.outerHTML`，天然带着它自己；`writeFrame` 直接落盘，没调已经写好的 `stripProbe`。
- **修法**：`writeFrame` 写入前 `stripProbe(html)`。
- **怎么验的**：再改一次文字后 `grep -c data-dsh-canvas-probe` = 0，文件大小回落到正常量级，HTML 仍以 doctype 开头、`</html>` 结尾。

### 3.4 批注浮层残留会被一代代继承

- **现象**：探针挂在 body 上的 `<div data-dsh-comment-layer>` 也会被序列化进文件。
- **根因**：两层原因叠加 —— (a) 序列化时没摘掉自己的浮层；(b) **历史版本已经污染过的那份残留**不属于当前探针实例，`serialize()` 不认识它，于是每写一次就把它往后传一代。
- **修法**：探针新增 `serialize()`，序列化前先 `unhover()` 并临时摘掉自己的浮层，写完再插回；同时 `stripProbe` 再兜一层，清理文件里历史遗留的浮层节点。
- **怎么验的**：复验后 `grep -c data-dsh-comment-layer` = 0、probe = 0、编辑生效、HTML 合法；冒烟脚本新增"探针源码必须定义并调用 `serialize()`"的断言。

### 3.5 失败红条被自己的回滚擦掉（直接违背 AC12）

- **现象**：写失败时红条闪一下就不见了，用户看不到任何提示。
- **根因**：`load()` 里有一句 `else setBanner(null)`；写失败后立刻调 `load()` 做回滚重读，这句把刚报的错当场清掉。
- **修法**：`load` 只在首帧清红条；之后只有**写成功**才清（`commit` 与 `writeFrame` 的成功分支）。
- **怎么验的**：用 `setTransport` 注入必失败通道，走真实写回路径，面板稳定显示
  `写入失败：<绝对路径> 不可写：EACCES（权限不足） 已回滚为磁盘上的内容。`

### 3.6 附带：`openRightbar` 不是命令，别自造全屏按钮

- **现象**：自造的「放大」按钮文案能切到「还原」，但面板宽度一点没变（帧仍 553 px），是个"按了没反应"的按钮。
- **根因**：`ctx.layout.openRightbar(track, fullscreen)` 的文档原话是 *"**Report** the right panel's presentation without changing its expanded state"* —— 它是**上报**，不是**命令**；第三方调它只会让布局对呈现方式的认知失真。
- **修法**：删掉自造按钮，改用右侧栏自带的 Fullscreen 控件（`aria-label="Fullscreen"`），代码里留注释防止后人加回来。
- **怎么验的**：点框架自带控件后帧宽 553 px → **1257 px**，`data-sidebar-right-panel` 变为 `fullscreen`。

### 3.7 AC9「落地到项目」整条被短路（T5 验收发现）

- **现象**：点「落地到项目」什么都不发生——没有卡片、没有提示，控制台抛未捕获异常
  `Error: cannot get property "remote.commands" without inject`。T4 设计的降级方案（复制指令卡片）永远执行不到。
- **根因**：Cordis 的 context 代理在读取**未注入**的服务属性时是**直接抛异常**，不是返回 `undefined`。
  原来的写法 `const commands = ctx.remote && ctx.remote.commands;` 看起来是防御性的，但它**本身就是抛点**；
  而外层的 `try` 只包住了后面的 `commands.execute`，包不住属性访问。`remote.commands` 又确实没写进 `inject`。
- **修法**：把**属性访问和 execute 一起**放进同一个 `try`，让"抛异常"和"返回 undefined"两条路都能落到降级卡片。
  **不加进 `inject`**：host 侧没有注册 `/design-handoff`，声明它收益为零，反而会让缺少该服务的 profile 里整个客户端半不激活。
- **怎么验的**：真实 GUI 点「落地到项目」→ 降级卡片出现（「命令通道不可用，已降级为复制指令…」+ 复制 / 收起），
  控制台 **0 error / 0 未捕获异常**；卡片里的指令文本完整，且已填入真实 frame（id 与文件路径）。
  另在冒烟脚本里新增 **inject 完整性检查**（见 §4），并把 bug 人为放回去验证它确实会报
  `ctx.remote.commands is not inside a try block`。

**同源排查结论**（本轮一并做了）：`client.js` 里所有 `ctx.<svc>` 访问逐条核对过 `inject`，
唯一未声明的是 `ctx.remote.commands`（已按上面用 try/catch 兜住，并在冒烟脚本里登记为白名单）。
`ctx.remote.$stream` 是 `remote` 服务自身的 API（`$` 前缀），不是命名空间，`remote` 在 inject 里即可。
**待议**：`layout` 仍在 `inject` 里，但自「放大」按钮删除后已无任何真实代码使用它（只在注释中出现）。
本轮按"一次只改一个东西"未动它；若要收紧激活面，可以后续把它从 inject 移除。

### 3.8 AC3：预览按容器尺寸渲染，用户看到的不是设计稿的版式（T5 验收发现）

- **现象**：右侧栏里三屏设计，`mobile-home` 内容尺寸 390×844（等于声明值），但
  `dashboard` 内容根是 **553×1006**、`order-list` 文档 scroll 是 **986×1494** —— 都等于面板宽度而不是声明的 1440。
- **根因**：iframe 的宽高被设成了**容器尺寸**（`width:100%; height:100%`）。固定宽度的内容碰巧对上，
  流式布局（`min-height:100vh` + `1fr` 网格）就直接重排到 553px。**用户看到的不是他选的那个版式**，
  落成代码后也无法与"设计时所见"对齐。
- **修法**：**按声明尺寸布局，再用一层 CSS 变换等比缩放**。
  iframe 的 `width`/`height` 一律等于 `frame.width`/`frame.height`（1440 就是 1440，参与布局），
  外层 `transform: scale(s)` + `transform-origin: top left` 只做视觉缩放（不参与布局）；
  `s = min(1, 面板可用宽 / frame.width)`（只缩不放，避免小屏放大糊掉），用 `ResizeObserver` 跟随面板宽度，
  并在右下角显示「适应宽度 · NN%」。
- **附带修掉的第二个问题**：批注角标原本是帧内 18px 的固定尺寸，缩到 38% 后屏幕上只剩 **6.9px**，
  既看不清也点不动 —— 这属于"缩放破坏了交互"。改成按 `1/缩放` 反向放大，屏幕上恒定 18px。
- **怎么验的**（真实 GUI，缩放态下逐项实测）：

  | 屏 | 声明 | iframe 布局尺寸 | 帧内文档 scroll | 内容根实测 |
  |---|---|---|---|---|
  | `mobile-home` | 390×844 | 390×844 | 390×844 | `DIV.phone` 390×844 |
  | `dashboard` | 1440×900 | 1440×900 | 1440×900 | `DIV.app` **1440×900** |
  | `order-list` | 1440×900 | 1440×900 | 1440×900 | `DIV.app` **1440×900** |

  缩放指示 `适应宽度 · 38%`；把视口从 1280 收窄到 1000 → 缩放 0.3826 → 0.3604（指示同步变 36%），恢复后回到 0.3826。
  角标屏幕上实测 **18px**。缩放态下用真实鼠标事件点 `a.nav-item`：检查器回报
  `a` / `body > div:nth-of-type(1) > aside > nav > a:nth-of-type(3)`，**与点的元素一致**（变换没有破坏命中测试）。
  缩放态下改文字 → 文件 md5 变化、新文字落盘、无探针/浮层残留；失败通道下红条照常显示路径与原因。控制台 0 error。
- **额外确认（幂等性）**：连续写回不会无限漂移 —— 点选后不改任何内容直接失焦（走一次完整往返），
  文件 md5 与字节数与写回前**完全一致**（`cf3abdaba12b3d0b093eb72dcf83439b`，37393 B）。

---

## 4. 每条功能的验证方式

| 功能 | 验证方式 |
|---|---|
| 左侧栏入口已删 | `nav[aria-label="Global panels"]` 内按钮只剩 Plugins / Automation tasks |
| guide 入口 | 断言 `[data-sidebar-right-guide-entry="design-canvas"]` 存在，文案为「设计预览 / 当前工作区的设计稿（.design/）」 |
| 点胶囊开面板 | 点击后出现 `[data-frame-id]`，且 `iframe[sandbox] === "allow-scripts"` |
| 跟随当前工作区 | 面板按 `sessionId` 解析，渲染当前工作区 `.design/` 的屏 |
| 按声明尺寸渲染（AC3） | 缩放态下逐屏实测：iframe 布局尺寸 = 声明值；帧内文档 scroll 与内容根 = 声明值（1440×900 / 390×844）；见 §3.8 表格 |
| 缩放跟随面板宽度 | 视口 1280→1000 时缩放 0.3826→0.3604 且指示同步变 36%，恢复后回到 0.3826（`ResizeObserver`） |
| 切屏 | 连点「下一屏」两次再「上一屏」，`data-frame-id` 依次 order-list → dashboard → mobile-home → dashboard，计数同步 |
| 刷新后停在同一屏 | 整页 reload 后 `[data-frame-id]` 仍为 dashboard（读 `selection.frameId`） |
| 点元素 → 检查器 | 帧内点 button，抽屉显示 tag 与选择器路径 `body > div > header > div:nth-of-type(1) > button:nth-of-type(1)` |
| 就地改属性写回（AC6） | 改文字后 `md5sum .design/frames/dashboard.html` 变化、`grep` 到新文字、文件仍以 doctype 开头 `</html>` 结尾 |
| 写批注（AC8） | `design.json` 的 `comments[]` 新增条目，含 `frameId` 与 `target` 选择器，`x` / `y` 为 0 |
| 批注角标 | 帧内存在 `[data-dsh-comment-mark="<commentId>"]` |
| 锚点失效不丢弃 | 把 `target` 改成不存在的选择器：角标消失，工具栏「批注（1）」仍可打开列表并显示「未锚定…原文已保留」 |
| 失败可见（AC12） | `setTransport` 注入失败通道 → 红条显示含路径与原因的 `error.message` + 「已回滚为磁盘上的内容。」 |
| 落地到项目（AC9） | 点按钮 → 降级卡片出现且指令文本填入真实 frame；控制台无未捕获异常 |
| 实时刷新（AC7） | `workspaceFiles.changes` + 900 ms stat 轮询双保险；本项目未删除该链路 |
| 沙箱（AC10） | 帧内自测回报 `opaqueOrigin=true`、`parent.document`/`cookie` 均 `SecurityError`，控制台可见；**判定方式见第 5 节** |
| 自动打开 | **未验证**：需要"从无到有"边沿；独立验收把 `.design/` 临时挪走造空态后仍无法得到可判定的初始态，故无通过/失败结论（unverified + follow_up） |

静态自检（每次改动都应重跑）：

```bash
node --check client.js
node /tmp/canvas-smoke.mjs     # 座位断言 + inject 完整性审计 + 探针源码可解析 + 组件树真挂载
grep -c "sandbox: 'allow-scripts'" client.js   # 必须为 1
```

冒烟脚本里的 **inject 完整性审计**是 §3.7 的护栏：它去掉注释后抽出所有 `ctx.<svc>` 与 `ctx.remote.<ns>` 访问，
逐个比对 `inject`；白名单（`ctx.remote.commands`）还要求它确实位于 `try` 块内。新增未声明的访问会直接 `SMOKE FAIL`。

---

## 5. 判 AC10 的经验：读上下文，不要数命中数

`grep -c allow-same-origin client.js` 会得到 **5**，但那是**假阳性**：这 5 处全在注释与字符串里，写着"绝不加它"，用来提醒后来者。在本次冻结版本（`1cc97af9bca58b55`）里它们位于第 13 / 150 / 777 / 846 / 930 行，全部是说明文字或日志文案。

真正的 iframe 属性**只有一处**，在**第 931 行**：

```js
sandbox: 'allow-scripts',
```

审查 AC10 时应当：**找到真正的 `sandbox` 属性、读它所在那几行的上下文**，而不是统计关键字出现次数；判断"帧是否拿到 opaque origin"要看帧内的 `window.origin === 'null'` 与 `parent.document` 是否抛 `SecurityError`，那才是硬证据。这条对后续维护者与独立验收者都适用。

---

## 6. 收尾清理记录

验证素材已按计划清出交付面，最终 `.design/` 只留三屏真实设计：

| frame id | 名称 | 文件 | 尺寸 |
|---|---|---|---|
| `order-list` | 订阅订单列表 · SaaS 后台 | `frames/order-list.html` | 1440×900 |
| `dashboard` | 监控仪表盘 | `frames/dashboard.html` | 1440×900 |
| `mobile-home` | 移动端首页 | `frames/mobile-home.html` | 390×844 |

- 删除的 5 个夹具（经 `design_canvas_apply` 的 `delete_frame`）：`attack`、`verify-ac10-xss`、`empty`、`huge`(2.6 MB)、`hang`。**frame 条目与 html 文件同时清掉，`frames/` 无孤儿文件**（已用"design.json 声明集合 vs 磁盘文件集合"对拍验证：orphans = none、missing = none）。
- 顺带还原了一个验证期改动的名字：`mobile-home` 曾被改名为「AC7改名验证」，已改回「移动端首页」。
- `.design/design.json.bak`（41 B）**保留**：那是 AC11 的运行时产物（design.json 被改成非法 JSON 时 host 自动备份），属于产品行为而不是测试夹具。
- `.design/` 仍随工作区走、未加入 `.gitignore`，符合 SPEC 中"可进 git、可 diff"的约定（AC4）。
