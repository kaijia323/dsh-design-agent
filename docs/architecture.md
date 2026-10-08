# 架构说明

> 这份文档记录"为什么这样设计"和"怎么跑起来"，供后续维护者与 agent 使用。
> 执行契约见 [`specs/feature-dsh-design-canvas.yaml`](../specs/feature-dsh-design-canvas.yaml)（12 条验收标准）。

## 一句话

DSH 原生插件：用户在对话里说需求，agent 在**无限画布**上以「**每屏一个真实 HTML**」为单位设计 UI；用户就地拖拽/批注或继续对话修改，满意后由 agent 把设计落成前端代码。

## 三条不可动摇的产品取舍

1. **真源是文件，不是画布 JSON。** `.design/` 下的 `design.json` + `frames/*.html` + `tokens.css` 就是设计本身，可进 git、可 diff、可 review、可被 agent 用普通 read/write/edit 直接改。画布只负责空间布局、编辑入口与实时同步。这一条来自调研结论：目前没有主流产品把"画布 JSON"当真源（open-design 用 `DESIGN.md` + 真实文件，Onlook 用代码本身）。
2. **画布上的元素是真实网页，不是矢量图形。** 每屏一个自包含 HTML，在沙箱 iframe 里渲染。agent 本来就擅长写 HTML/CSS，导出代码几乎无损；也避免了自研矢量编辑器这个无底洞。
3. **只做单向 设计 → 代码。** 不做"代码改动反推回设计"的双向同步——公开证据显示这是当前无人真正解决的问题，官方 Figma MCP 都被批"给的是设计上下文而非可生产代码"。

## 目录结构

```
.
├── package.json          # 插件清单：dsh.bundle.patch + dsh.client，无构建步骤
├── cordis.patch.yml      # 把插件行插入 profile
├── index.js              # Host 半入口：注册工具 / systemPrompt / 画布写通道
├── client.js             # Client 半（单文件、自包含）：无限画布本体
├── icon.svg              # 插件图标
├── locale/               # 插件显示元数据（meta.title / meta.description）
├── src/host/             # Host 侧模块（index.js 相对 import）
│   ├── design-project.js # .design/ 工程读写 = 唯一实现（工具与 HTTP 通道共用）
│   ├── tools.js          # 三个 Agent 工具
│   ├── http.js           # 画布写通道（同源 exact route）
│   └── types.js          # 跨端共享常量与类型
├── design-system/        # 设计契约层（让页面不丑的那一半）
│   ├── tokens/           # 3 套预设 + index.json
│   └── templates/        # 起步 frame 模板（自包含中文 HTML）
├── prompts/              # 注入 systemPrompt 的设计约定与落地流程
├── specs/                # SPEC 与查看器
└── docs/                 # 本文档与验收证据
```

## 插件如何挂进 DSH

| 能力 | 扩展点 | 备注 |
|---|---|---|
| 全屏画布 | client `main` slot，key = `design-canvas` | key 必须与 `sidebar.panellist` 的 id 相同，panel 才可被选中 |
| 左侧栏入口 | client `sidebar.panellist` slot | `ctx.layout.selectPanel('design-canvas')` 切换 |
| 边聊边看（同屏） | client `sidebarRightTabs` + `ctx.layout.openRightbar(track=true)` | track 模式会压缩聊天列，是真同屏；浮层遮挡不算 |
| Agent 工具 | host `ctx.tools.register` | 手写 JSON Schema，不引入 `@deepseek-ai/dsh-tools` |
| 设计约定 | host `ctx.systemPrompt.section` | 正文来自 `prompts/design-conventions.md`，读不到时用内置兜底 |
| 画布写回 | host `ctx.webServer.register`（exact route） | 见下节 |
| 文件变更通知 | 客户端已存在的 `workspaceFiles.changes` 流 | 单向：host 写文件 → 客户端感知 → 刷新，不另造推送通道 |

## 画布写通道与安全模型

`POST /design-canvas/api`，请求体 `{ sessionId, method?, ops?, ... }`。

**为什么不用 session command**：`command/run`、`command/done` 每次调用都会写进 session log，并且会被渲染成聊天里的一行。拖动 frame 是高频静默操作，用命令通道会把对话刷满，直接违背 AC7「不打断用户」。

**为什么必须自己补同源护栏**：`webServer` 注册的 handler 直接拿 node 原生 req/res，绕过了 `/api` 的信任栅栏。不加护栏就等于"任何能访问 127.0.0.1:3080 的页面都能写用户工作区文件"（典型 localhost CSRF）。因此 `src/host/http.js` 强制五条：

| 护栏 | 不满足时 |
|---|---|
| 只接受 `POST` | 405 |
| `Origin` 必须等于请求自身 Host 推导出的 origin | 403 |
| `Sec-Fetch-Site` 必须是 `same-origin`（存在时） | 403 |
| `Content-Type` 必须是 `application/json` | 415 |
| body ≤ 4MB，超限立刻中止读取 | 413 |

还有一条不在状态码里、但同样是硬约束：**route 绝不接受客户端传来的路径**。只收 `sessionId`，由 host 用 `ctx.agents.get(sessionId)` → `session.header.cwd` 自己解析工作区。

### 这条护栏的边界（别误读）

**完全不带 `Origin` 与 `Sec-Fetch-Site` 头的请求会被放行（200）。** 这是刻意的：浏览器发起跨站 POST 一定会带 `Origin`，所以"任意网页 CSRF 写用户工作区"这条威胁是被挡住的；但**本机任意非浏览器进程可以直接调这个接口**。

结论要说清楚：这是**浏览器威胁模型下的同源保护，不等于对本地进程设防**。本机进程本来就有权限直接改工作区文件，为它再加一层机制收益很低，所以不做。若将来插件被用在多用户或远程场景，这里必须重新设计。

**一个操作两个调用方**：画布 UI 走的 HTTP 通道和 agent 走的 `design_canvas_apply` 工具调用的是 `design-project.js` 里的同一个函数，不存在两套逻辑。

## Agent 工具

| 工具 | 作用 |
|---|---|
| `design_status` | 无副作用。返回工程、frames、tokens、**未处理批注**、当前选中项。agent 动手前应先调它。 |
| `design_frame_write` | 新建或覆写一屏（`id/name/html/width/height/x/y`），返回 `{id, file, bytes}`。 |
| `design_canvas_apply` | 应用一组画布操作。词表：`add_frame / move_frame / resize_frame / rename_frame / delete_frame / switch_tokens / add_comment / resolve_comment / set_viewport / select`；**未知操作整批拒绝**（`EUNKNOWN`），不做部分应用。 |

改某一屏的页面内容也可以**直接用 read/write/edit 改 `.design/frames/<id>.html`**——画布会自动刷新，不必绕工具。

唯一允许的例外：`design_status` 在发现 `design.json` 非法时，会按 AC11 把它备份成 `design.json.bak`（这是错误恢复的必要写入，不算违反"无副作用"）。

## 画布写通道的精确格式

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

画布操作对象用 **`op`** 作为判别字段；`kind` 作为兼容别名保留，内部会归一化。

## 数据格式

```
<workspace>/.design/
├── design.json   # viewport / selection / tokens 镜像 / frames[] / comments[]
├── tokens.css    # 选中预设的逐字拷贝（不改变量名）
└── frames/*.html # 每屏一个自包含 HTML
```

`design.json` 的 `tokens` 字段是 `tokens.css` 的只读镜像，解析规则：去掉 `--` 后把第一个 `-` 换成 `.`
（`--color-primary` → `color.primary`，`--space-2` → `space.2`）。

## 错误码

`ENOWRITE`（不可写，message 含失败路径与原因）、`EJSON`（design.json 非法，已备份为 `design.json.bak` 并回退空工程）、`ETOOLARGE`（单帧 >2MB）、`EEMPTY`（单帧 0 字节）、`ENOFRAME`、`EUNKNOWN`。

## 安装与生效

插件以**本地目录 link** 方式装进 `web` profile，所以：

- **改 `client.js`**：刷新浏览器页面即可（客户端模块按需重新拉取）。
- **改 Host 侧（`index.js` / `src/host/**`）**：由 HMR 重载；`plugin_manager` 的 `application` / `warnings` 字段才是判断"是否已生效"的依据，不要看日志或进程列表。
- **重装**（改了 `package.json` 或 `cordis.patch.yml` 时）：用 `plugin_manager` 的 `install_bundle`，target 传本目录绝对路径。**不要手改 profile 下的 `package.json` / `cordis.patch.yml`，也不要在 profile 目录里跑 pnpm**——那些是安装器负责的步骤。

## 验证

- 单测：`node --test src/host/`
- 设计契约自检：`node design-system/tools/check-design-system.mjs`
- 端到端：GUI `http://127.0.0.1:3080`（`dsh web` 启动时打印的 URL 带一次性 token；直接访问 `/` 会 401）
- 独立验收报告：`docs/verification-feature-dsh-design-canvas.md`
