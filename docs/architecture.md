# 架构说明

> 这份文档记录"为什么这样设计"和"怎么跑起来"，供后续维护者与 agent 使用。
> 执行契约见 [`specs/feature-dsh-design-canvas.yaml`](../specs/feature-dsh-design-canvas.yaml)（12 条验收标准，当前 v6）。

## 一句话

DSH 原生插件：用户在对话里说需求，agent 以「**每屏一个真实 HTML**」为单位设计 UI；用户在右侧栏的预览面板里边聊边看，可切换屏幕、点元素就地改属性、点元素写批注，满意后由 agent 把设计落成前端代码。

## 形态是怎么定下来的（重要，别走回头路）

第一版做的是**真无限画布**（平移/缩放/多屏并排/拖动改位置）。用户在实际界面里用过之后明确否决：

> 「整个画布都多余，我只要聊天 + 一个预览框」

随后确认预览框保留「点元素就地改属性」与「点元素写批注」两项能力。之后用户又指出挂载点的问题：

> 「放在左侧栏这样不好吧，我点击的时候都不知道这个设计是不是跟着这个工作区走的……放在右侧栏多一个设计的选项会更好？点击后打开当前工作区的 .design 里面的设计稿」

两条都成立，且第二条是真实的可用性缺陷：**左侧栏的面板列表是 root 作用域的（全局）**，而设计稿是**每个工作区各自一份**的，放在那里无法表达"这份设计属于哪个工作区"。右侧栏标签是 session 作用域的，天生跟随当前会话/工作区。

成本核对（当时的数据）：画布里"无限"那部分（相机与坐标换算）约 140 行、拖动约 60 行、并排世界图层约 60 行、世界坐标批注浮层约 150 行；而沙箱渲染、探针、读写通道、变更订阅、错误提示这些是**跨形态复用**的，占了绝大多数。

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
| 文件变更通知 | 客户端 `workspaceFiles.changes` 流 + 定期 stat 轮询 | 单向：host 写文件 → 客户端感知 → 刷新，不另造推送通道 |

**已废弃的挂载点（不要再加回来）**：`sidebar.panellist`（左侧栏全局入口）与 `main`（全屏主面板座位）。原因是全局面板列表无法表达"这份设计属于哪个工作区"。

### 两个容易踩的扩展点细节

- `openTab` 本身就会 reveal 右侧栏，**打开标签不需要额外调 `openRightbar`**；只有「放大」才需要。
- `dsh-fs-local` 对目录的监听参数是 `{ ignoreInitial: true, depth: 0 }`，**只监听 `.design` 收不到 `.design/frames/*.html` 的变更**。所以刷新用的是"changes 流 + 定期 stat"双保险，两处都要留着。

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
| `design_status` | 无副作用。返回工程、frames、tokens、**未处理批注**、当前选中项。agent 动手前应先调它。 |
| `design_frame_write` | 新建或覆写一屏（`id/name/html/width/height/x/y`），返回 `{id, file, bytes}`。 |
| `design_canvas_apply` | 应用一组画布操作。词表：`add_frame / move_frame / resize_frame / rename_frame / delete_frame / switch_tokens / add_comment / resolve_comment / set_viewport / select`；**未知操作整批拒绝**（`EUNKNOWN`），不做部分应用。 |

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
├── design.json   # viewport / selection / tokens 镜像 / frames[] / comments[]
├── tokens.css    # 选中预设的逐字拷贝（不改变量名）
└── frames/*.html # 每屏一个自包含 HTML
```

`design.json` 的 `tokens` 字段是 `tokens.css` 的只读镜像，解析规则：去掉 `--` 后把第一个 `-` 换成 `.`
（`--color-primary` → `color.primary`，`--space-2` → `space.2`）。三套预设各 56 个变量，切换预算是整块替换、页面样式一行不改。

**批注锚点**：v5 起 `comments[].target` 是元素选择器路径，`x/y` 写 0、不再承担定位语义。选择器在 agent 重写 HTML 后可能失效——此时该批注显示为「未锚定」并保留原文，**不静默丢弃**（见 SPEC follow_up F2）。

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
- 独立验收报告：`docs/verification-feature-dsh-design-canvas.md`。
- 沙箱验证要点：劫持帧的 `window.origin` 应为 `null`；控制台**不得**出现 Chrome 的 `can escape its sandboxing` 警告（出现即说明 `allow-same-origin` 被加上了）。

## 版本控制：`.design/` 该不该提交？

**在用户的项目里：应该提交。** 这是"真源是文件"这条取舍的前提——设计稿进了 git 才能 review、diff、回溯，也才能和代码改动一起被审查。

**在本插件仓库里：不提交，已写进 `.gitignore`。** 因为这里的 `.design/` 是开发与演示数据（还带着验收期留下的测试批注），不是插件源码。

需要留意的两点：

1. **验收时 AC4 的 git 口径（`git status --porcelain` 能看到 `.design/`）是在它"未跟踪但未被忽略"的状态下测的。** 加了忽略之后，同样的命令不再列出它——这**不影响** AC4 的实质（设计是磁盘上的真实文件、内容可 diff、agent 可直接 read/write/edit），只是口径变了。若将来要重跑那条口径，先临时移除 `.gitignore` 里的 `.design/` 一行。
2. 如果使用者项目里有宽泛的 ignore 规则把 `.design/` 吞掉，那是使用者的选择；插件不会替他改 `.gitignore`，但在 `README.md` 与本节都写明了建议。
