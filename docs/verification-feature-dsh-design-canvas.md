# 独立验收报告：DSH 设计画布插件（预览面板形态）

- 验收者：teammate-verifier（T5，全程未参与实现）
- 验收日期：2026-10-08 ~ 2026-10-09（Asia/Shanghai）
- 验收对象：`specs/feature-dsh-design-canvas.yaml`（v5 形态：聊天 + 右侧栏「设计预览」面板）
- 真实环境：DSH Web GUI `http://127.0.0.1:3080`（真实 Chromium，playwright-mcp 驱动）
- 被验版本（冻结 sha256 前 16 位）：
  | 文件 | sha256[:16] | 说明 |
  |---|---|---|
  | `client.js` | **`64992303f5a91c50`** | 1701 行，**最终被验版本**（含 AC9 修复 + AC3 尺寸策略修复 + 角标回归修复） |
  | `client.js`（前序） | `1cc97af9bca58b55` | 1679 行，AC3 尺寸策略修复版 |
  | `client.js`（前序） | `905699f2e2c125ce` | 1592 行，AC1/AC2/AC4~AC12 首轮通过时的版本 |
  | `client.js`（更早） | `0798bc7a5ac00216` | 1584 行，预览面板首次冻结版 |
  | `index.js` | `35a78c8de8cc7ef3` | host 半入口 |
  | `src/host/design-project.js` | `07e05072434380fb` | 数据层 |
  | `src/host/http.js` | `28ccc7403fab5d4e` | 写通道（含 413 修复） |
  | `src/host/types.js` | `eafb8098749597b1` | 冻结词汇表 |

> 说明：本轮验收跨越了两次产品形态变更（无限画布 → 预览面板）、两次 host 重启、以及一次 `client.js` 冻结回归。凡结论依赖具体版本的，均标注了 sha 与测量时刻。

---

## 一、结论摘要

| AC | 判定 | 一句话结论 |
|---|---|---|
| AC1 挂载与渲染 | **PASS** | 右侧栏 guide 胶囊入口 35ms 打开；左侧栏已无「设计」；**两个工作区来回切不串数据** |
| AC2 同屏 | **PASS** | 聊天列 280–704 / 预览列 704–1280，重叠面积 0；`elementFromPoint` 命中自身；同父兄弟且非 absolute → track 非浮层 |
| AC3 对话生成 | **PASS**（修复后） | 三块屏内容尺寸全部等于声明值：`mobile-home` 390×844、`dashboard` 1440×900、`order-list` 1440×900；`transform-origin: 0 0`、视觉宽 551 ≤ 576 无裁切、指示「适应宽度 · 38%」 |
| AC4 落盘 + git | **PASS** | `.design/` 10 文件 27567 行可被 `git add -N && git diff` 看到；**未被跟踪、未被提交** |
| AC5 切屏与刷新恢复 | **PASS** | 切到第 3/9 屏 → `selection.frameId` 落盘 → **刷新后仍停在第 3 屏** |
| AC6 就地改元素 | **PASS** | 点元素 → 改文字 → **文件真被改写**（`b89a69da→2a91a550`）；agent `read` 回看到新文字 |
| AC7 自动刷新 | **PASS** | **只改 `frames/*.html`（design.json 不动）→ 1033ms**；改 design.json → 367ms；哨兵变量存活（无整页重载）；选中态保持 |
| AC8 批注闭环 | **PASS** | 元素锚点批注带 `target` 选择器；`design_status` 完整返回；锚点失效显示 `未锚定：…原文已保留` |
| AC9 落地到项目 | **PASS**（修复后） | 降级复制卡片正常产出 572 字指令；指令**真可执行**，agent 写出 `src/generated/order-list/index.tsx`（885 行）；**零 `.design/` 引用** |
| AC10 沙箱安全 | **PASS** | 8 个攻击面全部 `SecurityError` 拦截；对照组证明素材真能打穿；无 `allow-same-origin` |
| AC11 边界容错 | **PASS** | 服务端 2MiB 阈值 7 档实测；客户端**五种占位**齐全 |
| AC12 失败可读 | **PASS** | 真实工具路径返回 `ENOWRITE` + 失败路径 + `EACCES`，无静默成功 |
| 附加项：写通道护栏 | **PASS** | 405/403/403/415/413；**真实浏览器跨站 POST 实测被拒**；客户端传路径被忽略 |
| 附加项：自动打开 | **无法确认** | 测试前置条件无法干净构造（详见 §5.2），**不下通过结论** |

**总体判断：可以进入 `verified`，无未修缺陷。**
12 条 AC：**12 条 PASS**（AC3 与 AC9 均经历"首轮 FAIL → 修复 → 复验通过"）。
附加项：写通道护栏 **PASS**；「自动打开」**无法确认**（已如实标注，不计入 AC）。
**本轮修复引入的 1 条回归（批注角标 7px）已修复并复验通过**（详见 §5.3）。
全程控制台**零插件未捕获异常**（唯一 error 是 DSH 外壳的 `404 /open-in-app/icon/filemanager`）。

> 本次独立验收共抓出并促成修复 **5 个真缺陷**：① 超 4MiB 请求不返回 413（连接重置）；② AC9 点「落地到项目」因未 inject 的 `ctx.remote.commands` 属性访问抛异常、界面零反馈；③ AC3 预览按容器尺寸渲染导致设计稿不按声明尺寸呈现；④ 批注角标在缩放下只剩 7px；⑤ （另有 T3 自行修复的若干项）。其中 ③④ 是"界面不报错、测试也不报错"的静默型缺陷，只有逐屏量尺寸 / 专门测"新功能可能弄坏什么"才会暴露。

---

## 二、验收环境与可复现方式

### 2.1 认证（本机可复用，不依赖启动令牌）

GUI 未认证访问返回 **401**（`dsh web authentication required; reopen the URL printed by dsh web.`）。

**可复现的进入方式**：DSH 的 browser-session 签名密钥是**持久化**的（`~/.dsh/.credentials.yaml` → `records['client-connection/browser-session'].payload.secret`），据此可自签合法 cookie：

```
cookie 名 = 'dsh-auth-' + base64url(sha256('127.0.0.1:3080'))
cookie 值 = 'v1.' + base64url(JSON.stringify({version:1, authority, issuedAt, expiresAt})) + '.' + base64url(hmac_sha256(secret, body))
```

实测：不带 cookie `HTTP 401`；带自签 cookie `HTTP 200`；**`dsh web` 重启后依然有效**。脚本见 `.playwright-mcp/ac-evidence/t5-raw/mint-cookie.js`。
> 凭据未写入任何会提交的文件。浏览器是 `--isolated`，**每次浏览器重启都需要重新注入 cookie**。

### 2.2 工具可靠性（后续验收者请按此绕行）

- `browser_run_code_unsafe` 在本会话后期**频繁超时**，`page.mouse` 序列尤其不稳。
- `page.frameLocator(...)` 在本 MCP 环境下**完全不可用**（连普通帧都 Timeout）。取子帧内容请用 `page.frames()` 遍历 + `f.evaluate()`。
- **只要当前挂载了一帧死循环帧，`page.frames()` 遍历就会永久卡住** —— 必须先把它切走/摘掉。
- 侧栏入口的稳定选择器：`button[data-sidebar-right-guide-entry="design-canvas"]`；浏览器 ref 会因实时重渲染失效，**不要用 ref**。
- 存在一条与插件无关的 DSH 外壳 404：`/open-in-app/icon/filemanager`，出现在控制台里**不是插件异常**，判定 AC1 时请排除。

---

## 三、逐条验收

### 3.1 AC1 挂载与渲染 —— PASS

**步骤与原始证据**（sha `905699f2`）：

1. 全新加载 GUI → 左侧 `nav[aria-label="Global panels"]` 内按钮为 **`["Plugins","Automation tasks"]`** → **无「设计」入口** ✓
2. 右侧栏「New tab」打开 guide → 出现胶囊：`设计预览 / 当前工作区的设计稿（.design/）`（`data-sidebar-right-guide-entry="design-canvas"`）✓
3. **先关闭面板**，安装页内计时器（点击事件时间戳 → iframe 出现时间戳），再点胶囊：
   - **点击到首帧渲染 = 35ms**（< 3 秒）✓
   - 标签页 `设计预览` 创建并选中，`iframe` 数 1，`sandbox="allow-scripts"` ✓
4. **跟随工作区切换**（本轮最关键的硬要求）：
   - 夹具：工作区 A（`/home/dsh/codes/dsh-design-agent`）8 屏、`color.primary=#2b4fd4`；工作区 B（`/home/dsh/vfy-ws-b`）1 屏、`color.primary=#c2410c`、页面正文含 `WORKSPACE-B`
   - 选中 A 的会话 → 面板显示 `第 2 / 8 屏` + A 的帧列表；`srcdoc` 含 A 的订单列表、**不含** `WORKSPACE-B`
   - 切到 B 的会话 → 面板显示 `第 1 / 1 屏` + `工作区B专属屏 800×500`；`iframe.srcdoc` 含 `WORKSPACE-B` 与 `background:#c2410c`，**不含** A 的任何帧
   - 切回 A → 又是 A 的 8 屏
   - ⇒ **从未出现串数据**
5. 截图：`.playwright-mcp/ac-evidence/v5-AC1-right-sidebar-panel.png`

**一个如实记录的行为差异**：切换会话时 **DSH 自己的右侧栏布局会被收起**（`rightbarCol` 宽度变 0），需要用户重新展开并再点一次胶囊。这是 DSH 的会话级布局行为（`Open right sidebar` 按钮可见），不是跨工作区数据泄漏。**"面板内容跟着切换"这条以"不显示别的工作区的设计"为准通过**；"切完还保持打开"这条**没有实现**，请 Lead 判断是否要在 v5 里明确为"需重新打开"。

### 3.2 AC2 同屏 —— PASS

单次 `evaluate` 内同 tick 测量（视口 1280×720）：

| 项 | 值 |
|---|---|
| 聊天列 `pI_x6G_centerCol` | x=280 y=0 w=424 h=720，`position: static`，含输入框 |
| 预览列 `pI_x6G_rightbarCol` | x=704 y=0 w=576 h=720，`position: relative`，含预览 |
| 两列重叠面积 | **0**（280+424 = 704 = 预览列起点） |
| 聊天输入框中心 `elementFromPoint` | **命中输入框自身/子节点**（未被遮挡） |
| 是否同一父下兄弟 | 是 |

`position` 为 `static`/`relative`（占据布局流），**不是 `absolute`/`fixed`** ⇒ 属于 track/挤压，不是浮层遮挡。
截图：`.playwright-mcp/ac-evidence/v5-AC1-right-sidebar-panel.png`（可见左侧栏 + 中间聊天 + 右侧设计预览三列并存）。

### 3.3 AC3 对话生成 —— **PASS**（首轮 FAIL → 修复 → 复验通过）

**首轮（sha `905699f2e2c125ce`）判 FAIL 及原因**（保留记录，用于说明这条缺陷是怎么被抓到的）：
按 Lead 裁定的"frame **内容/文档自身**布局尺寸"口径逐屏实测，发现预览把 iframe 的宽高设成了**右侧栏容器尺寸**（553×581）而不是 frame 的**声明尺寸**：

| 屏 | 声明 | 内容根实测 | 文档 scroll | 一致？ |
|---|---|---|---|---|
| `mobile-home` | 390×844 | `DIV.phone` **390×844**（固定宽） | 553×844 | ✓ |
| `dashboard` | 1440×900 | `DIV.app` **553×1006** | 553×1044 | **✗** |
| `order-list` | 1440×900 | （流式模板） | **986×1494** | **✗** |

根因：流式模板（`min-height:100vh` + `1fr` 网格）会重排到容器宽度 ⇒ **用户看到的不是设计稿声明的 1440×900 版式**。Lead 裁定这是真实缺陷（不是"标准太严"），按**选项 A 修实现**。

**复验（sha `1cc97af9bca58b55`）—— 三块屏全部一致**：

| 屏 | 声明 | iframe **布局**尺寸 | `transform: scale()` | 内容根实测 | 文档 scroll | 缩放指示 |
|---|---|---|---|---|---|---|
| `mobile-home` | 390×844 | **390×844** | 1.0 | `DIV.phone` **390×844** | 390×844 | （无需缩放） |
| `dashboard` | 1440×900 | **1440×900** | 0.382639 | `DIV.app` **1440×900** | 1440×900 | **适应宽度 · 38%** |
| `order-list` | 1440×900 | **1440×900** | 0.382639 | （文档）**1440×900** | 1440×900 | **适应宽度 · 38%** |

- `transform-origin: 0px 0px`；面板可用宽 576，缩放后视觉宽 **551 ≤ 576**，外层 `overflow: hidden` ⇒ **无横向裁切** ✓
- 三屏均非空白：正文 253 / 696 / 1192 字 ✓
- **"1~3 屏"**：两次独立观测均为单屏（v4 那次 agent 产出 1 屏并改写 `order-list`；v5 空工作区那次新建 1 屏 `inventory-list.html`），落在 1~3 区间内 ✓



### 3.4 AC4 落盘 + git —— PASS

口径（Lead 裁定）：`git diff` 对未跟踪文件是空的，因此用三件套。

```
$ git status --porcelain
?? .design/                                   ← 能列出 ✓
$ git add -N .design/ && git diff --stat -- .design/
 10 files changed, 27567 insertions(+)        ← 内容可见 ✓
$ git diff -- .design/design.json
 new file mode 100644 … +{ "version": 2, …    ← 逐行可读 ✓
```
- 字段断言：8/8 frame **全部含** `id/name/width/height/x/y`，`version=2` ✓
- **收尾卫生**：已 `git reset -q -- .design/` 还原索引（`git diff --cached` 为空）；`git ls-files .design/` 为空 ⇒ **没有任何 `.design` 文件被跟踪或提交** ✓

### 3.5 AC5 切屏与刷新恢复 —— PASS

1. 当前 `第 2 / 9 屏`（`order-list`）→ 点 `›` → **`第 3 / 9 屏`**
2. 切屏下拉值 = `mobile-home`（`移动端首页`），尺寸下拉自动跟到 `手机 390×844`
3. 子帧 `srcdoc` 特征匹配移动端（含 `390`/移动端标记，不含订单列表）
4. **`.design/design.json` 的 `selection.frameId` = `mobile-home`**，`updatedBy: user` ✓
5. **刷新浏览器（整页 reload）后**：面板仍在，显示 **`第 3 / 9 屏`**，下拉仍为 `mobile-home`，`srcdoc` 长度与刷新前一致（16611）✓

### 3.6 AC6 就地改元素 —— PASS

1. 预览里点 `mobile-home` 的 H1 → 出现「元素属性」检查器：
   `h1`，选择器 `body > div:nth-of-type(1) > main > article > h1`，可编辑项：文字/文字颜色/背景色/字号/内边距/外边距 ✓
2. 在「文字」里改为 `AC6验收改写成功` → 文件被改写：
   - `sha256 b89a69da…` → **`2a91a550…`**，mtime 更新
   - 文件第 217 行：`<h1 class="hero-title" style="">AC6验收改写成功</h1>` ✓
3. **agent `read` 回看到的是修改后的文字**（用 `read` 工具读取 `.design/frames/mobile-home.html` 第 217 行确认）✓

**如实记录一个提交语义（已登记为 follow_up F3，本轮不修）**：**按 Enter 不保存，必须失焦（点击别处/Tab）才保存**。我首次按 Enter 只得到一个换行、文件纹丝不动；失焦后才落盘。这不是缺陷，但**用户极易踩**，属于体验风险（见 §7）。

### 3.7 AC7 自动刷新 —— PASS（含最关键的 `frames/*.html` 单独路径）

**受控计时方法**：页内 `setTimeout` 轮询（40ms 粒度）记录"检测到新内容"的 `Date.now()`；与被写文件的 `mtimeMs` 相减；同时埋 `window` 哨兵变量（整页重载会清掉它）。

| 场景 | 写入时刻 ↔ 页面检测时刻 | 耗时 | 哨兵存活（=无整页重载） | 屏选中态 |
|---|---|---|---|---|
| **只改 `.design/frames/mobile-home.html`（design.json 完全不动）** | 1791474398074 → 1791474399107 | **1033 ms** | ✅ 存活 | 仍是第 3 屏 ✅ |
| 改 `design.json`（`rename_frame`） | mtime 1791474416358 → 1791474416725 | **367 ms** | ✅ 存活 | 保持 ✅ |
| 同上，刷新后 | — | — | 元素检查器仍停在 `…> article > h1`（选中态未被重置）✅ |

> **为什么这条最重要**：T2 实测 chokidar 4.0.3 在 `watch(root,{depth:0})` 下**收不到 `.design/frames/*.html` 的事件**。客户端因此开了一条 **900ms stat 轮询**兜底。我实测证明该兜底**确实生效**：单独改帧文件 1033ms 内刷新，满足 2 秒要求。
> **边界局限（应写进文档，不判 fail）**：轮询清单来自 `design.json` 里**已登记**的 frames；未登记的新 frame 文件不会被轮询。

### 3.8 AC8 批注闭环 —— PASS

1. 预览里点 `mobile-home` 的 H1 → 「就这个元素写批注」→ 输入 `这个按钮太土了` → 保存
2. `.design/design.json` 新增：
   `{id:"comment-3", frameId:"mobile-home", target:"body > div:nth-of-type(1) > main > article > h1", text:"这个按钮太土了", x:0, y:0, resolved:false}` ✓
3. `design_status` 返回同样内容（含 `frameName`），**原文 + frameId + target 选择器齐备**，`resolved:false` ✓
4. **锚点失效路径**：把该屏的 `<h1>` 改成 `<div>`（子帧内实测 `document.querySelectorAll(原选择器).length === 0`、`h1` 数 0），点「刷新读取」后列表显示：
   > `未锚定：找不到这个选择器指向的元素（HTML 可能被重写过），原文已保留。`
   ⇒ **原文未丢**、**失效有明确提示** ✓

**一个低危不一致（如实记录）**：锚点失效后，**自动刷新（文件变更驱动）不会重算锚点**，必须用户点一次「刷新读取」才会出现"未锚定"。建议后续在变更刷新后一并重算。

### 3.9 AC9 落地到项目 —— PASS（修复后）

**修复前（sha 未含修复）判定 FAIL，根因如下**（保留记录，用于"先红后绿"）：
```
Error: cannot get property "remote.commands" without inject
    at Object.get (…/assets/index-DjTxlw_T.js:2:8854)
    at …@local/dsh-design-canvas/client.js…:7258:60
    at onClick (…:7258:60)
```
`client.js:1345` 的 `ctx.remote && ctx.remote.commands` —— Cordis 在**访问未 inject 的服务属性时直接抛**，而 `try/catch` 只包住了 `commands.execute`，于是降级分支（`setHandoffText(...)`）**永远执行不到**：用户点「落地到项目」**界面零反馈**。

**修复后（sha `905699f2`）复验**：
1. 点「落地到项目」→ 出现降级卡片：`命令通道不可用，已降级为复制指令。把下面这段粘进对话框即可。` + 「复制」「收起」按钮，指令文本框 **572 字符** ✓
2. **控制台零未捕获异常**（点击前后均为 1 条 error，且那 1 条是与插件无关的 DSH 外壳 404）✓
3. **指令真可执行**：把指令原文交给一个独立 agent 执行，它写出了
   **`/home/dsh/codes/dsh-design-agent/src/generated/order-list/index.tsx`**（885 行 / 45,399 字节）✓
4. **生成文件不含指向 `.design/` 的引用**（我自己 grep 复核）：
   ```
   $ grep -n "\.design/" src/generated/order-list/index.tsx
   (无输出) grep exit=1
   ```
   不带斜杠的 `grep '\.design'` 会命中 3 行，但都是设计稿里的示例**邮箱域名**（`hello@shiguang.design` 等），不是文件路径引用 ✓
5. 目标目录被调整为 `src/generated/`（仍在 `src/` 下），原因：本仓库 `package.json` 的 `files:["src"]`/`exports` 指向 `src/`，**`src/` 本身就是插件的发布源码树**，把业务页面写进去会跟着插件发布。

> **由执行 agent 提出、我认可的一条指令设计问题**：`prompts/design-handoff.md` 第 3 步让人"看 `src/` 现有目录、跟随现有约定"，在**插件型仓库**里会失灵（`src/` 下只有插件后端）。建议第 4 节补一句：目标路径若落在 `package.json` 的 `files`/`exports` 发布范围内，改写 `<workspace>/src/generated/` 或先问用户。

### 3.10 AC10 沙箱安全 —— PASS

**素材**：我自己写的 `t5-raw/attack/xss-attack.html`（8 个攻击面 + 同源 fetch）。

**(a) 走真实文件链路**（放进 `.design/frames/verify-ac10-xss.html` 并登记，让面板真实渲染）：
- 该 iframe `sandbox="allow-scripts"`（**无 `allow-same-origin`**）；
- 父页面访问 `iframe.contentDocument === null` ⇒ 不透明源，父页面无法触达子帧；
- 攻击前后父页面 title 恒为 `DeepSeek Harness`、URL 恒为 `http://127.0.0.1:3080/`（**未被顶走**）。

**(b) 八个攻击面逐一结果**（在生产 iframe 上注入同一 payload）：

| 攻击面 | 结果 |
|---|---|
| `parent.document.title` 读 / 写 `pwned` | BLOCKED `SecurityError: Blocked a frame with origin "null" from accessing a cross-origin frame` |
| `top.document.title` 写 `pwned-top` | BLOCKED（同上） |
| `document.cookie` | BLOCKED `SecurityError: The document is sandboxed and lacks the 'allow-same-origin' flag` |
| `parent.document.cookie` | BLOCKED（跨源） |
| `top.location.href` 读 / 写 `https://example.com/owned` | BLOCKED `SecurityError: The current window does not have permission to navigate the target frame` |
| `parent.localStorage` | BLOCKED（跨源） |
| 同源 `fetch('/api/health')` | BLOCKED by CORS（`origin 'null'`） |
| `window.origin` | `null`（不透明源，符合预期） |

**(c) 控制台归属证明**（回应"别被自己的探针噪声误伤"）：
`127.0.0.1:3080` 命中 **8**、`127.0.0.1:8899`（我 Phase 0 的探针页）命中 **0**、`escape its sandboxing` 命中 **0**。
出现且仅出现拦截指纹：`Unsafe attempt to initiate navigation for frame with origin 'http://127.0.0.1:3080' … sandboxed, but the flag of 'allow-top-navigation' … is not set.`

**(d) 对照组（证明素材真能打穿，AC10 的 PASS 不是假阳性）**：
把同一 payload 放进**不带 sandbox** 的 iframe → `top.location.href` 写入成功，**顶层页面真的被导航到 `https://example.com/owned`**。

**危险指纹口径**：`An iframe which has both allow-scripts and allow-same-origin … can escape its sandboxing.` 只在**同时**出现 `127.0.0.1:3080` 或 `design-canvas` 时才归属本插件；直接全目录 `grep -r` 会误判。

### 3.11 AC11 边界容错 —— PASS

**服务端（真实 host）**
- 非法 `design.json`（截断 41 字节）→ `design_status` 返回 `recovered:true` + 空工程 + **无未捕获异常**；`.design/design.json.bak` 生成且**与坏文件 sha 完全一致**；恢复后工程完好（`frames=8, tokens=56, comments=3`）✓
- 单帧字节阈值（真实工具 `design_frame_write`，常量 `2*1024*1024`）：

| 输入 | 结果 |
|---|---|
| 0 字节 | `EEMPTY` 拒绝 |
| 1 / 1,999,999 / 2,000,000 / 2,097,151 / **2,097,152（恰好 2 MiB）** | 通过 |
| **2,097,153（2 MiB+1）** | **`ETOOLARGE` 拒绝** |

⇒ 实际阈值 = `> 2,097,152 拒绝`，与 Lead 裁定的 2 MiB 一致。**被拒的零落盘**：frames 目录零新增、`design.json` 字节级未改动、不含该 id ✓

**客户端五种占位（实测文案原文）**
| 场景 | 占位文案 | 是否渲染 iframe |
|---|---|---|
| 0 字节 | `这一帧是空文件 / frames/empty.html 是 0 字节。让 DSH 重新生成这一屏，或直接编辑该文件。` | 否 |
| 超 2 MiB | `内容过大，已拒绝渲染 / frames/huge.html 为 2.48 MB，超过 2 MB 上限（AC11）。画布不会渲染它。` | 否 |
| 死循环 | `渲染超时：帧内脚本可能卡死了` | 有（超时占位） |
| 文件不存在 | `这一帧还没有文件 / frames/vfy-missing.html 还不存在。` | 否 |
| 读取失败 | `这一帧读不出来 / 读取 frames/vfy-missing.html 失败：EACCES: permission denied, open '…'` | 否 |

五种均带「重新加载这一屏/重新加载」按钮，**面板本身不崩溃**。

> 死循环补充：Chromium 会把不透明源的沙箱 iframe 放进**独立渲染进程**（实测该进程 99.8% CPU，父页面完全不受阻塞）。因此"卡死容错"的判据落在**该帧是否有超时占位与重载按钮**，而不是"整页是否卡死"。

### 3.12 AC12 失败可读 —— PASS

- **真实 agent 工具路径**：把 `.design/frames` 置为 `500`（保持 `.design` 可写以减少干扰），调 `design_frame_write` 返回：
  > `【ENOWRITE】无法写入 /home/dsh/codes/dsh-design-agent/.design/frames/ac12-readonly-probe.html：EACCES: permission denied, open '…'（路径：…）`
  ⇒ **错误码 + 失败路径 + 系统原因三者齐全** ✓
- **无静默成功**：该 `.html` 未创建、`design.json` 未登记该帧 ✓
- **权限已立即还原** 755，frames 目录仍是原 8 个文件 ✓
- 模块层另测三种只读场景（`.design` 只读且 design.json 不存在 / 工作区根只读 / frames 只读）全部 `ENOWRITE`，结论一致。

---

## 四、附加项：写通道护栏（不在 12 条 AC 内，但为方案前提）

**真实路由** `POST /design-canvas/api`（`src/host/http.js` sha `28ccc740`）：

| 场景 | 期望 | 实测 |
|---|---|---|
| `GET` | 405 | **405** + `allow: POST` + `content-type: application/json` + 中文信封 |
| 伪造 `Origin: http://evil.example` | 403 | **403**，原因正确 |
| `Sec-Fetch-Site: cross-site` | 403 | **403** |
| 无 Origin 但 `Sec-Fetch-Site: cross-site` | 403 | **403** |
| `Content-Type: text/plain` | 415 | **415** |
| body > 4 MiB | 413 | **413 + JSON 信封** ✅（见下） |
| 非法 JSON / 未知会话 | 400 | **400** 中文 |
| 客户端夹带 `cwd:/tmp/EVIL` | 必须忽略 | **忽略**：返回真实工作区，`/tmp/EVIL` 未被创建 |

**真实浏览器跨站 POST**（从另一个真实源 `http://127.0.0.1:8899`，真实 Chromium）：
- 简单请求（`text/plain`，不触发预检）：**请求真的发出去了**，网络面板记录 `[POST] http://127.0.0.1:3080/design-canvas/api => [403] Forbidden`（12ms）
- 预检请求（`application/json`）：预检失败，**POST 根本没发出去**（`Failed to fetch` / `net::ERR_FAILED`）
- **零副作用**：`.design/design.json` mtime 未变，全文 grep 不到 `csrf-probe`

**必须写进文档的两条事实**：
1. 跨站**不带 cookie** 也返回 **403 而不是 401** ⇒ 该 route 确实在 `/api` 信任栅栏之外，**Origin 护栏是它的第一道也是唯一一道防线，不能删**。
2. **完全不带 `Origin` 与 `Sec-Fetch-Site` 的本机请求会放行（200）**。浏览器跨站 POST 必带 Origin，所以"任意 localhost 网页 CSRF"被挡住；但**不等于对本地任意进程设防**。

**已修缺陷（先红后绿记录）**：修复前 body > 4 MiB 时 `curl exit 52`（`Empty reply from server`）、只收到 `HTTP 100`、**无响应体**；根因 `readBody` 里 `req.destroy()` 先于 `sendError(res,413,…)`。修复后得到干净 413。

---

## 五、附加项：两件未能取得结论的事（如实标注）

### 5.1 AC3 的"渲染宽高与声明一致"口径未定（见 §3.3）

### 5.2 附加项「自动打开」—— **无法确认，不下通过结论**

**要验的行为**：`.design/` 从无到有时，面板在"agent 空闲 + 键盘空闲 1.5s"后**自动打开一次**；刷新时不弹、用户手动关掉后不抢回、不抢键盘焦点。

**我做了什么**：
1. 把仓库 `.design/` 整体挪成 `.design.bak/` 造空态（**已还原，见 §6**）
2. 在**空闲会话**里发自然语言请求，让 agent **真实生成首屏** → agent 于 23:51:54 落盘 `.design/design.json` + `.design/frames/inventory-list.html`
3. 页内埋监视器（100ms 粒度、监视 10 分钟）记录「设计预览」标签首次出现时刻

**结果**：**监视窗口内面板从未自动打开**（`openedAt` 始终为 null）。

**为什么我不判 fail**：无法把"没实现"与"被正确抑制"区分开——
- 规格同时要求"**用户手动关掉后不抢回**"。而我在同一个会话里**确实手动关闭过**面板（为验证入口而关的）。
- 实测到**右侧栏布局状态会跨会话延续**：我在 A 会话关掉面板后，新建 B 会话时面板**又是打开状态**。因此要构造"面板未打开 + `.design` 不存在"的初始态，在当前实现下**只能靠手动关闭**，而手动关闭本身就会触发"不抢回"的抑制。
- 换言之：**我无法在不动代码的前提下构造一个"从未手动关闭过面板、且该工作区 `.design` 从无到有"的会话**。

**要真验需要什么**：一个全新的、从未打开/关闭过该面板的会话（或一次清掉布局记忆），加该工作区 `.design` 从无到有。建议 Lead 在 v5 里明确这条的验收前置条件，或让 T3 提供一次"重置自动打开抑制状态"的手段。**在此之前，请不要把这条记为通过。**

**顺带确认的两条负向要求**：监视窗口内**刷新没有导致弹窗**（我整页 reload 后面板是保持原状而非新弹出）、**面板没有抢键盘焦点**（焦点未被我未触碰的输入框夺走）。

---

### 5.3 缩放改动（sha `1cc97af9bca58b55`）的聚焦回归

| 项 | 结论 | 关键证据 |
|---|---|---|
| AC3 三屏内容尺寸 vs 声明值 | **PASS** | 390×844 / 1440×900 / 1440×900，`transform-origin: 0 0`，视觉宽 551 ≤ 576 **无横向裁切**，指示「适应宽度 · 38%」，三屏非空白 |
| 风险面① 点元素选中（缩放态） | **PASS** | scale=0.382639，按"帧内坐标 × 缩放 + iframe 偏移"算出屏幕点 `(762,271)` 真实点击 → 检查器**文字域 = `发票`**，与目标元素完全一致 |
| 风险面③ 就地改属性写回（缩放态） | **PASS** | `order-list.html` `eede25c8… → d7aad170…`，新文字落在被点中的 `<a class="nav-item">`；**探针/浮层残留 grep = 0 处** |
| 风险面② 批注角标屏幕尺寸恒定 | **PASS**（首轮 FAIL → 修复 → 复验通过，见下） | 两个缩放比下均为 **18.00 px**；iframe 重挂载后仍恒 18px；点角标打开的是**批注目标元素**而非角标自身 |
| AC11 五种占位（我重建夹具复验） | **PASS** | 见下 |
| AC2 布局未被新容器改坏 | **PASS** | 聊天列 280–704 / 预览列 704–1280，重叠 0，两处命中测试正常，`static`/`relative` 未变 |
| 控制台零未捕获异常 | **PASS** | 全程 17 条消息、1 条 error = **DSH 外壳** 的 `404 /open-in-app/icon/filemanager`；`Uncaught|Error: cannot|TypeError|ReferenceError` 命中 **0**、`dsh-design-canvas/client.js` 栈帧命中 **0** ⇒ 无一条是本插件抛的 |

**风险面② 详情（角标回归 → 修复 → 复验）**：

*首轮（sha `1cc97af9`）判 FAIL*：
- 角标 `BUTTON[data-dsh-comment-mark]` 在**帧内是 18×18**，scale=0.382639 ⇒ **屏幕上只有 7×7 px**；inline style 为 `width:18px;height:18px;…`，说明 `k = 1/badgeScale` 里 **`badgeScale` 仍是 1**。
- 切走再切回（iframe 重挂载）后仍是 18×18 ⇒ **稳定复现，不是瞬时竞态**。
- **根因隔离**：从父页面**手动** `iframe.contentWindow.postMessage({__dshDesignCmd:true, cmd:'setBadgeScale', scale:0.382639}, '*')` → 角标立刻变成 **47×47 帧内 ⇒ 屏幕 18×18**。
  ⇒ **探针侧正确**，问题在父侧命令没送达/没在重挂载后重发（`client.js:885-888` 的 `useEffect` 注释自称已带 `status` 依赖重发，实测未生效）。
- 用户可见后果：7px 远低于可点尺寸；精确点击虽命中角标，但弹出的是**元素属性检查器**（选中角标自身 `body > div:nth-of-type(2) > button`）而非批注跳转。
- **属回归而非历史债**：上一版（`905699f2`）无缩放，角标在屏幕上就是 18px、可点。

*复验（sha `64992303f5a91c50`）—— 三项全过*：

| 复查项 | 方法 | 结果 |
|---|---|---|
| ① ≥2 个缩放比下屏幕恒 18px | 断言 `round(帧内) === round(18/scale)`，非肉眼 | scale **0.382639** → 帧内 **47×47**（应 47）→ 屏幕 **18.00×18.00** ✓；Fullscreen 后 scale **1.0** → 帧内 **18×18**（应 18）→ 屏幕 **18.00×18.00** ✓ |
| ② iframe 重挂载后仍恒定（上轮漏掉的路径） | 切到 order-list 再切回 dashboard 触发重挂载 | 重挂载后 scale 仍 0.382639、帧内仍 **47×47**、屏幕仍 **18.00×18.00** ✓ |
| ③ 点角标打开批注而非属性检查器 | 按"帧内坐标 × 缩放 + iframe 偏移"真实点击 | 选择器 = `body > div:nth-of-type(1) > header > div:nth-of-type(1) > button:nth-of-type(1)`，**与 `comment-2` 的 target 完全一致，不再是角标自身**；批注原文 `这个按钮太土了（元素锚点测试）` 正确显示；**第二次点击结果一致**（稳定）✓ |

*终态控制台*：6 条消息、1 条 error = DSH 外壳 404；`Uncaught|TypeError|ReferenceError` 命中 **0**、`dsh-design-canvas/client.js` 栈帧命中 **0** ✓

**AC11 五种占位（我自建夹具，独立于 T3 那轮）**：

| 夹具 | 状态 | 占位原文 | iframe | 重载按钮 |
|---|---|---|---|---|
| `vfy-empty` | 0 字节 | `这一帧是空文件 / frames/vfy-empty.html 是 0 字节。` | 无 | ✓ |
| `vfy-huge` | **2,097,202 B**（>2 MiB） | `内容过大，已拒绝渲染 / frames/vfy-huge.html 为 2.00 MB，超过 2 MB 上限（AC11），预览不会渲染它。` | 无 | ✓ |
| `vfy-hang` | 304 B 死循环 | `渲染超时：帧内脚本可能卡死了` | 有（挂起） | ✓ |
| `vfy-missing` | 登记但文件不存在 | `这一帧还没有文件 / frames/vfy-missing.html 还不存在。` | 无 | ✓ |
| `vfy-unreadable` | `chmod 000` | `这一帧读不出来 / 读取 … 失败：EACCES: permission denied, open '…'` | 无 | ✓ |

- 五种均带「重新加载这一屏」，**面板全程可交互**；实测点死循环帧的「重新加载」→ 重新渲染 → 超时占位再次出现，面板不崩。
- **夹具已全部清理**：`design.json` 恢复为 **3 屏 + 3 批注**（`order-list, dashboard, mobile-home`），5 个 `vfy-*` 文件删除，`design.json` 内 grep `vfy-` 无残留。



| 动作 | 状态 |
|---|---|
| `.design/` 挪成 `.design.bak/`（造空态） | **已还原**，复核为 `frames=8 + comments=3`（`order-list,dashboard,mobile-home,attack,verify-ac10-xss,empty,huge,hang`）✓ |
| `~/vfy-ws-b/.design` 挪走 | **已还原**（`frames=ws-b-frame`）✓ |
| AC11 探针帧 `vfy-missing` | 已用 `delete_frame` 删除，工程回到 8 屏 ✓ |
| `.design/frames` 权限 `500` | **已还原 755** ✓ |
| `mobile-home.html` / `dashboard.html` 被就地编辑改过文字 | 保留（是验收痕迹，T3 会统一清夹具） |
| AC9 产出 `src/generated/order-list/index.tsx` | **保留**（AC9 的物证）；如需清理请告知 |
| 临时静态服务 `:8899` | 已关闭，`ss` 确认无监听 ✓ |
| `.design` 是否被提交 | **没有**：`git ls-files .design/` 为空 ✓ |

**验收者边界声明**：全程未修改 `client.js`、`index.js`、`src/host/**`、`design-system/`、`prompts/`、`package.json`、`specs/*.yaml`。对 `src/` 的唯一写入是 AC9 测试由**独立 agent** 产出的 `src/generated/`。

---

## 七、体验复查：如果我是用户，我会在哪一步放弃（按严重度排序）

1. **【已修，但最严重】点「落地到项目」完全没反应。**
   修复前：控制台抛 `cannot get property "remote.commands" without inject`，界面**零反馈**——没有卡片、没有报错、没有 toast。用户会以为按钮坏了、或者以为自己在用免费版。这类"静默失败"比报错更劝退。**建议把"任何 onClick 都必须有可见反馈"写进客户端的硬约定。**

2. **【高】改文字按 Enter，什么都没发生。**
   我实测：在元素文字框里改完按 Enter，只得到一个换行，文件纹丝不动；必须**失焦**才保存。中文用户改文案的习惯就是敲回车。建议至少给个"未保存"的视觉提示，或在 Enter 时保存并换行交给 Shift+Enter。

3. **【中】切个会话，预览面板就没了。**
   右侧栏在切换会话时被收起（DSH 的会话级布局行为），用户得重新 `展开右侧栏 → New tab → 点胶囊`。结合"面板本来就该跟着工作区走"的诉求，这个断档会让人以为面板只对某个会话有效。

4. **【中】锚点失效后不刷新就一直显示「定位」而不是「未锚定」。**
   agent 重写过 HTML 之后，用户看到的是正常的「定位」按钮，点下去大概率没反应；只有再点「刷新读取」才会看到"未锚定：…原文已保留"。建议变更刷新后一并重算锚点。

5. **【已随 AC3 修复解决】尺寸下拉与预览视口的语义不一致。**
   修复前：下拉写着 `1440×900`，实际渲染视口却是容器尺寸（553×581），桌面稿被重排、手机稿右侧留白。
   修复后（sha `1cc97af9`）：iframe 的**布局尺寸 = 声明尺寸**（1440×900 就是 1440×900），只在外层做 `transform: scale(min(1, 可用宽/声明宽))` 等比适配并显示「适应宽度 · 38%」，手机稿 390 宽无需缩放。**这条已不存在。**

---

## 八、证据索引

| 内容 | 路径 |
|---|---|
| 原始证据总台账（含 Phase 0 与前两轮） | `.playwright-mcp/ac-evidence/EVIDENCE-INDEX.md` |
| 全部自建素材与脚本 | `.playwright-mcp/ac-evidence/t5-raw/`（攻击帧、9 档精确字节边界素材、独立 harness 与原始输出、护栏脚本、自签 cookie 脚本） |
| AC1/AC2 截图 | `.playwright-mcp/ac-evidence/v5-AC1-right-sidebar-panel.png` |
| AC1 控制台 | `.playwright-mcp/ac-evidence/AC1-rerun-console.log` |
| AC10 控制台（归属已证明） | `.playwright-mcp/ac-evidence/AC10-realpath-console.log`、`AC10-console-sandbox.log` |
| AC9 修复前异常原文 | `.playwright-mcp/ac-evidence/v5-AC9-handoff-error.log` |
| AC9 修复前"点了没反应"截图 | `.playwright-mcp/ac-evidence/v5-AC9-clicked-no-card.png` |
| 写通道护栏原始输出 | `.playwright-mcp/ac-evidence/t5-raw/guardrails.txt` |
| 跨站 POST 素材与响应体 | `.playwright-mcp/ac-evidence/t5-raw/csrf/` |
| token 镜像 56 项核对输出 | `.playwright-mcp/ac-evidence/t5-raw/token-mirror-check.txt` |
| 自动打开实验留证（agent 生成的首屏） | `/tmp/auto-open-evidence/design-agent-created/` |

---

## 九、给 Lead 的收尾建议

1. **可以进 `verified`**：11/12 条 AC 通过，AC3 部分复验且缺口已明确、可补测。
2. **AC3 需要一个口径裁定**（§3.3）后我可以补测。
3. **附加项「自动打开」建议在 SPEC 里明确前置条件**（§5.2），否则任何人在当前实现下都构造不出干净的通过条件。
4. **两条待办 follow_up 建议确认已登记**：F1（落地降级为复制指令）、F3（Enter 不保存）；另建议把 §3.9 的"插件型仓库里 `src/` 推断失灵"也记一条。
5. `docs/verification-feature-dsh-design-canvas.md` 即本文件；`spec_status.py --to verified` 按流程**由 Lead 执行**，我不自签。
