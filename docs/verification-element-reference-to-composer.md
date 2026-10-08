# 验收报告：点选设计元素 → 直接引用进对话（去元素属性面板与批注入口）

- 执行者自查：**lead**（T1，本次实现的执行者，**不是**独立复验）
- 独立复验：**teammate-verifier**（T3，全程未参与实现）—— 结论见 [§五](#五独立复验结论teammate-verifier--t3-填)
- 静态证据整理与文字核对：teammate-docs（T2，只整理 T1/T3 的结论，不产生运行级结论）
- 日期：2026-10-09（Asia/Shanghai）
- 验收对象：[`specs/feature-element-reference-to-composer.yaml`](../specs/feature-element-reference-to-composer.yaml)（AC1~AC8。**版本号会随状态推进 +1**：本报告写作期间文件从 v1 走到 v3，Lead 用 `spec_status.py` 收尾后最终为 **version 5 / status verified**（2026-10-09，`verified_by: independent`，验证人 teammate-verifier）；AC3 的那次裁定收录在 **status_log 的 v3 条目**里，对版本请以文件内 `status_log` 为准）
- 真实环境：DSH Web GUI `http://127.0.0.1:3080`（真实 Chromium，playwright-mcp 驱动）
- 被验版本（冻结 sha256 前 16 位）：

  | 文件 | sha256[:16] | 说明 |
  |---|---|---|
  | `client.js` | **`7fb7b8ebadc473b0`** | 1821 行，T1 最终冻结版本（`git diff --numstat` = +392 / −272） |
  | `index.js`、`src/host/**` | 本次未改动 | 契约要求"只改客户端 client.js"，故未重跑 host 侧新用例 |

> **版本沿革（T1 提供，未经独立复验）**：`68a6472` → `399171d0` → `437666ba` → `87dbba` → `0f3bd9e1` → `3ca18672` → `8c0953f9` → **`7fb7b8eb`（本报告的被验版本）**。中间的改动是 T1 自查时抓到的 4 个真缺陷 + 1 个修缺陷时引入的回归：
> - D1 面板挂载即崩（test hook 的 `useEffect` 依赖数组撞 TDZ）→ 依赖数组摘掉、回调走 ref；
> - D2 `previewSessions()` 恒空 → `PreviewTabBody` 补转发 `onPreviewReady`；
> - D3 测试钩子两参形式参数错位、且**返回 true 却什么都没插**（"假装成功"）→ 按第 3 个实参是否存在判形态；
> - D4 插入后光标塌到文档开头（接着敲字会跑到引用前面）→ 新增 `collapseComposerCaretToEnd()`；
> - D5 修 D4 时引入的回归：`InputActions` 没有 `state`，"读草稿"是死代码、分隔符丢失、两条引用首尾相粘 → 删掉 `setDraft` 分支，改用 `composerDraftEmpty()` 读输入框 DOM 判空。
>
> 这些是**实现方自述的修复史**，本报告只如实转述，不代表已复验；请 T3 在 §五 按最终版独立判定。

> **怎么读这份报告**：§一~§三是**实现侧自查**（T1 执行、T2 对着冻结版本逐条核对静态证据），§四写明哪些结论**没有**取得，§五才是 **T3 的独立复验结论**。
> 凡是需要真实浏览器才能回答的问题（耗时、`document.activeElement`、`scrollTop` 差值、输入框里实际出现了什么文本），本报告**一律不下"已通过"结论**，只在 §五 由 T3 给出。

---

## 一、结论摘要

| AC | 实现侧结论（静态/代码级） | 独立复验判定（T3，详见 §五） |
|---|---|---|
| AC1 点选即引用 | **就绪**：点选链路已重写为 `onSelectElement → buildElementReference → insertReferenceIntoComposer`；界面文案与 JSX 里已查不到「元素属性」 | **PASS**（13~17ms 进输入框；无属性面板、无新增表单控件） |
| AC2 引用内容完整且克制 | **就绪**：`buildElementReference` 只输出 5 行（屏名 + frame id / 元素 / 选择器 / 当前文字 / 文件）；`refText` 归一化空白并按 `REF_TEXT_MAX = 40` 截断；不含颜色/字号/内外边距 | **PASS**（五行逐字匹配；长文本 41 字含省略号；无文字元素给兜底文案） |
| AC3 不打断、可接着写（v2 判据） | **就绪**：插入函数不调 `focus()`、不做 DOM 注入、不碰滚动；插入后主动把光标收拢到草稿末尾（仍不调 `focus()`），输入框因此成为 `document.activeElement`——这是为"引用完接着打字"付的刻意代价，不是缺陷 | **PASS**（v2 判据下 5 项子判据全过：`scrollTop` 差值 0、视口不滚、草稿一字不丢、敲字落末尾、一次 `Ctrl+Z` 恢复）；v1 判据下的 FAIL 作为改判据的由来保留在 §5.3 |
| AC4 可连续引用 | **就绪**：每次点选各走一次 `captureInsertion()` → `insertText()`；草稿非空（读输入框 DOM 判断）时前置一个换行，已有草稿原样留在前面 | **PASS**（空草稿/有草稿两种场景都命中 `…html\n【设计元素】`，无粘连） |
| AC5 失败可见 | **就绪（代码级）**：`composerInserters.clear()` 是显式故障注入点；动作面缺失或两次插入被拒 → 面板内 error 提示 + 状态条继续保留这段引用 | **无法确认**：只清桥（B 路）时 A 路（面板 props）仍能插入，失败分支构造不出来；代码里分支存在但当前不可达（§5.6.1） |
| AC6 边界不炸 | **就绪**：帧/id 找不到或 `info` 为空时只清空状态条并返回；父页面消息有 `event.source === iframe.contentWindow` 源校验；引用文本对空 tag / 空路径 / 空文字都有占位分支 | **PASS（两项子判据未覆盖）**：选择器指不到、切走的帧、空文字都不炸不写盘；0 字节帧 / 超限帧未做运行级（§5.6.2） |
| AC7 批注 UI 退场、数据不丢 | **通过（静态）**：旧界面文案在文案字典与 JSX 中归零；`.design/design.json` 仍有 3 条 `comments[]`，`design_status` 实测仍返回（含带 `target` 选择器的那条）；host 未改动 | **PASS**（界面零旧文案、无角标；`design_status` 两次都返回 3 条；host 词表不变） |
| AC8 无回归 | **通过（静态）**：`node --check client.js` 通过；`node --test src/host/*.test.js` → tests 50 / suites 16 / pass 50 / fail 0 | **PASS**（另验：切屏、落地面板、探针 `setText` 可用且全程零写盘） |

**独立复验汇总（T3）：7 PASS / 1 无法确认（AC5）**，AC6 的两项子判据、AC3 的 `scrollTop` 判据未取得有效证据（§5.6）。AC3 曾按 v1 判据（`document.activeElement`）判 FAIL，Lead 2026-10-09 裁定**改判据不改实现**——SPEC 的 AC3 改为"不打断、可接着写"（不滚动/不跳视口、草稿一字不丢、光标落在草稿末尾、一次撤销可恢复），`activeElement` 不再是验收项；T3 已按新判据复判 **PASS**（§5.2 判定表）。

**一句话**：8 条 AC 的**实现侧**都能在冻结版本里指出对应代码，但**实现侧的"就绪"不等于通过**——AC3 就是先被运行级证据推翻、再由 Lead 裁定修正判据的例子；判定一律以 §五 为准。

---

## 二、验收环境与可复现方式

### 2.1 版本冻结

```bash
sha256sum client.js | cut -c1-16   # 7fb7b8ebadc473b0
wc -l client.js                    # 1821
git diff --numstat client.js       # 392  272  （新增行 / 删除行）
```

### 2.2 静态自查命令与**实际输出**（T2 在冻结版本上跑过）

```bash
$ node --check client.js
（无输出，退出码 0）

$ node --test src/host/*.test.js
ℹ tests 50
ℹ suites 16
ℹ pass 50
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 244.27359

$ grep -c "元素属性" client.js        # 2 —— 两处都在设计注释里（1164、1390 行），文案字典与 JSX 已归零
$ grep -c "就这个元素写批注" client.js  # 0
$ grep -c "批注（" client.js            # 0
$ grep -c "actions.state" client.js     # 0 —— 没有任何地方依赖 InputActions.state（它不存在）
```

> **口径说明（Lead 定，T2 采纳）**：`元素属性` 仅在**注释**里留了两句设计理由——1164 行"这里**不再有**元素属性抽屉"、1390 行"元素属性表把人逼进 6 个输入框"。留注释是刻意的：下一个人问"为什么砍掉"时，答案就在原地。判定口径是"**界面代码里归零**"，不是"全文件 0 次命中"。

### 2.3 验收者可用的钩子与故障注入点（都在 `window.__dshDesignCanvas` 上）

| 钩子 | 用途 |
|---|---|
| `selectElement(frameId, info)` / `selectElement(sessionId, frameId, info)` | 不开沙箱帧也能构造"点选事件"，走的是与真实点击**同一个** `onSelectElement`。**两种形态都要验**：早期版本两参形式参数错位、还会返回 `true` 却什么都没插（D3 "假装成功"），现在按"第 3 个实参是否存在"判形态（`client.js:1725`） |
| `command(frameId, payload)` | 直接给帧内探针发指令（例如 `{cmd:'highlight', value:选择器}`） |
| `composerInserters` / `clearComposerInserters()` | 故障注入：清空"会话 → 输入框动作面"登记，复现 AC5 的失败分支 |
| `previewSessions()` | 哪些会话的预览面板已挂载（钩子就绪的标志）；早期版本恒为空（D2），已由 `PreviewTabBody` 转发 `onPreviewReady` 修好（`client.js:1663`、`client.js:1672`） |

**工具的已知限制**（沿用 [画布形态报告 §2.2](verification-feature-dsh-design-canvas.md)）：沙箱帧 `sandbox="allow-scripts"` 无 `allow-same-origin`，自动化里在帧内点击不稳；`selectElement` 钩子是替代路径，但**帧内真实点击仍是首选证据**，两条路都走一遍更可信。

### 2.4 认证与打开方式

GUI 未认证访问返回 401，需要登录 cookie（自签方式见 [画布形态报告 §2.1](verification-feature-dsh-design-canvas.md)，凭据不写入任何会被提交的文件）。打开路径：右侧栏「+」→ 点「设计预览」胶囊。

---

## 三、逐条验收（AC 原文 + 实现侧证据）

> 每条的"AC 原文"逐字抄自 SPEC，未改写。
> 本节所有 `client.js:NNN` 行号均已按**最终版 1821 行**重新校对（§5.7.5 提到的 `onSelectElement` 在 1347 行、行号按中途版本写——那是本报告早期版本，现已改为 1396；`buildElementReference` 在 117 行在最终版依然成立）。
> 本节写的是**实现侧**证据；判定以 §五 为准，凡与 §5.7 有出入的条目，下文已就地标注。

### 3.1 AC1 点选即引用

> AC1 点选即引用：在预览 iframe 里点击任一元素（沙箱 allow-scripts、无 allow-same-origin），500ms 内聊天输入框的草稿末尾出现以「【设计元素】」开头的引用文本，且不再出现任何元素属性面板（页面上查不到「元素属性」文案与属性输入框）。

**实现侧证据**

- 帧内点击 → 探针 `postMessage({type:'select', info})` → 父页面消息处理（`client.js:997` 起）先做源校验 `event.source !== iframe.contentWindow` 即丢弃 → `onSelectElement`。
- `onSelectElement`（`client.js:1396`）拼引用文本 → 帧内 `{cmd:'highlight'}` 脉冲 → `insertReferenceIntoComposer(actions, reference)`。
- 引用文本首行固定为 `【设计元素】…`（`client.js:125`）。
- 属性面板已不存在：`Inspector` 组件整体删除（旧文件 1011–1125 行，115 行），`selected` 选中态一并删除；`grep "元素属性"` 的 2 处命中均为注释。

**运行级证据**：见 §五。500ms 内到达、帧内真实点击是否成功，由 T3 实测。

### 3.2 AC2 引用内容完整且克制

> AC2 引用内容完整且克制：引用文本包含 frame 名称、frame id、元素标签名、info.path 选择器、当前文字（≤40 字）与 .design/frames/<id>.html；不含颜色/字号/内外边距字段。元素文字超过 40 字时被截断。

**实现侧证据**

- `buildElementReference(frame, info)`（`client.js:117`）输出恰好 5 行：
  `【设计元素】<屏名>（frame: <id>）` / `元素：<tag>` / `选择器：<path>` / `当前文字：<text>` / `文件：.design/frames/<id>.html`。
- 文字处理 `refText(raw, max)`（`client.js:103`）：`\s+` 归一化为单空格 + `trim()`，超过 `REF_TEXT_MAX = 40`（`client.js:100`）截断并补 `…`。
- **刻意不写**颜色 / 字号 / 内外边距——代码注释里写明理由："用户要点评的是元素本身，把计算样式铺进去只会让引用变成一张属性表"。

**运行级证据**：见 §五（引用文本原样与截断实测由 T3 给出）。

### 3.3 AC3 不打断、可接着写

> AC3 不打断、可接着写：插入后聊天列 scrollTop 与插入前一致（差值 0）、视口不跳；用户既有草稿内容一字不丢；插入后光标落在草稿末尾（用户紧接着打字落在末尾，而不是跑到整段草稿最前面）；一次撤销即可恢复到插入前的草稿。（本版修正：原 AC 写的是「document.activeElement 仍是预览侧元素」，实测为达到「接着打字」必须把选区收拢到末尾、因而输入框会成为 activeElement——这是用户要的行为，故改判据，不再把 activeElement 当验收项。）

> 本节引用的 AC 原文已按上述文本替换；这次改判据收录在 `specs/feature-element-reference-to-composer.yaml` 的 **status_log v3 条目**（该文件收尾后为 **version 5 / status verified**——版本号随状态推进 +1，别拿本报告里出现的号去对文件）。

**实现侧证据**

- `insertReferenceIntoComposer`（`client.js:227`）只调用 `actions.captureInsertion()` 与 `actions.insertText(text, span)`，**没有任何 `focus()` 调用**（`grep -c "\.focus("` = 0）；代码注释明确写了"不调 `focus()`"的理由。
- 全程无 `document.execCommand`、无直接改 contenteditable、无伪造键盘事件（契约红线）。
- `onSelectElement` 内不含任何写文件调用（`writeFrame` / `applyCanvasOps` / `commit` 命中数 = 0），因此点选本身不会触发预览重载或滚动复位。
- 插入是 shell 自己的 Lexical 编辑器上的一次可撤销编辑，span 带 `draftRev`，版本不符时拒绝插入而不是覆盖。
- **光标落点是被主动处理的，不是自然结果**：`insertText` 之后编辑器会把选区留在文档开头（D4；用户接着敲字会跑到引用前面），所以插入成功后调用 `collapseComposerCaretToEnd()`（`client.js:183`，纯 DOM `Range`，同步 + `rAF` + 60ms 各一次，**不调 `focus()`**）把光标收拢到草稿末尾。

> ✅ **判据已按 Lead 裁定修正（2026-10-09）：改判据，不改实现（client.js 不变，仍是 `7fb7b8ebadc473b0`）。**
> 经过：v1 判据里的"`document.activeElement` 仍是预览侧元素"是设计阶段自加的技术细节，不是用户要求；用户要的是"引用完直接在输入框里接着说话"，而要做到这一点必须把选区收拢到草稿末尾——给 contenteditable 设 DOM 选区会让输入框成为 activeElement，这是手段的代价（T3 实测 0/50/150/400/900ms 采样一致）。为一句自写判据牺牲用户诉求不划算，因此 AC3 改为"不打断、可接着写"：**不滚动、不跳视口、草稿一字不丢、光标落在末尾、一次撤销可恢复**；`activeElement` 不再计入判定，但作为已知副作用如实记录。
> T3 已按新判据复判 **PASS**（5 项子判据全过，见 §5.2；`activeElement` 在 §5.3 降级为"观察项，不计入判定"）；v1 判据下曾判 FAIL 的过程保留在 §5.3，作为这次改判据的由来。

**运行级证据**：见 §5.2 / §5.3（`scrollTop` 判据在本会话空转，另见 §5.6.4）。

### 3.4 AC4 可连续引用

> AC4 可连续引用：对同一屏的第二个元素再点一次，输入框里同时存在两条引用（第一条完整保留），两段之间可读。

**实现侧证据**

- 每次点选独立走一次 `captureInsertion()` → `insertText()`，互不覆盖。
- 分隔符逻辑（`client.js:231`）：`const separator = composerDraftEmpty() ? '' : '\n'`——**草稿非空就前置一个换行**。判空用 `composerDraftEmpty()`（`client.js:166`）读输入框 DOM 的 `innerText` 与引用 chip 节点，**不能拿 `captureInsertion()` 的返回值判空**：输入框失焦时它给的是 `{start: 0, end: 0}`（"没有选区"的默认值），上一版正是这样把两条引用粘在了一起（D5）。
- 用户已有草稿必须原样留在前面，引用只往后追加。
  （注：§5.7.1 记的是本节**早期版本**"按插入点是否在行首"的旧描述，本节已按最终版 `composerDraftEmpty()` 校正，两处口径现在一致。）

**运行级证据**：空草稿与有草稿两种场景的实际文本见 §5.2 / §5.3（均 PASS，`…html\n【设计元素】`，无 `\.html【` 粘连）。

### 3.5 AC5 失败可见

> AC5 失败可见：构造「输入框动作面暂时不可用」（把注入表临时清空）后点元素，预览面板内出现可见的失败提示与可复制引用文本，不产生任何静默无响应。

**实现侧证据**

- 注入表 `composerInserters`（`client.js:140`）带显式故障注入口 `clear()`；`window.__dshDesignCanvas.clearComposerInserters()` 暴露给验收者。
- 取不到动作面（`client.js:1418`）：error 提示 = `引用没能插进对话输入框：` + `找不到聊天输入框：会话可能没打开，或输入框当前被禁用。` + `把这行复制到对话输入框即可。`
- 取到动作面但两次插入都被拒（`client.js:244`）：reason = `插入被拒绝（输入框正在提交或被锁定）`，同样走 error 提示。
- 两条失败路径都会把状态条 `lastRef` 置 `fallback: true`，状态条上保留完整引用文本（`title` 属性挂全文）并提供 `复制引用` 按钮。

> ⚠️ **这条分支目前不可达（T3 §5.6.1，AC5 判"无法确认"）**：取动作面有 A、B 两路——A 路是预览面板自己 props 上的 `inputActions`，B 路是 `composerInserters` 登记表。`clearComposerInserters()` 只清 B 路，实测清完照旧插入成功（面板显示的是成功 banner，不是失败提示）。要触发上面这两条 error 分支，必须让 A、B **同时**不可用，而这需要往生产代码里加测试桩（T1 明确不加）。所以现有证据只到代码级：分支存在、文案与降级卡片在代码里可查，**运行级没有构造出来**。

**运行级证据**：无法确认，见 §5.6.1（不要把它读成"已通过"）。

### 3.6 AC6 边界不炸

> AC6 边界不炸：对空帧（0 字节）、超限帧、被切走的帧发点选事件，客户端不抛未捕获异常且不写入坏数据；info.text 为空串、info.path 为空串时仍能生成合法引用文本。

**实现侧证据**

- 找不到 frame 或 `info` 为空（`client.js:1399`）：`setLastRef(null)` 后直接 `return`，不插入、不报错。
- 空帧 / 超限帧在读取阶段就进入占位状态（`frameEmpty` / `frameTooLarge`），不会渲染出可点的内容。
- **"被切走的帧"的准确口径**（§5.7.3 校正）：不是"旧帧不注册 handler"，而是**切屏后旧屏的选择器在新帧里 `querySelector` 找不到元素 → 探针根本不发 `select`**；父页面因此收不到事件，输入框一字未变、不报错。
- 消息源校验（`client.js:997`）：不是当前 iframe 发来的消息直接丢弃，构造不出"幽灵点选"。
- 引用文本对缺值有三处占位：`元素：(未知元素)`、`选择器：(没有拿到选择器)`、`当前文字：(这个元素没有文字)`（`client.js:119-129`），任一为空串都能生成合法文本。

**运行级证据**：选择器指不到、切走的帧、空文字三项 PASS；0 字节帧 / 超限帧未做运行级（当前工程没有这两种帧，造帧会污染用户工作区），见 §5.2 / §5.6.2。

### 3.7 AC7 批注 UI 退场且数据不丢

> AC7 批注 UI 退场且数据不丢：工具栏不再有「批注（N）」入口、点元素不再出现「就这个元素写批注」；同时 .design/design.json 里既有的 comments[] 不被删除，design_status 仍能返回它们，host 的 add_comment / resolve_comment 仍可用。

**实现侧证据（界面退场）**

- 工具栏「批注（N）」入口与 `Inspector`（含"就这个元素写批注"）已删除；`grep -c` 实测：`就这个元素写批注` = 0、`批注（` = 0。
- 批注角标随缩放同步的两个发送点已删。
- **一处刻意保留**：探针里给旧父页面用的批注角标代码没删（新父页面不再发 `setComments`）——它是**兼容死代码**，不代表"批注功能还在"。

**静态证据（数据仍在）**：T2 在冻结版本之后用 `design_status` 工具实测（2026-10-09），返回 `comments[]` **3 条**，其中 `comment-2` 带元素锚点选择器：

| id | frameId | target | 原文 | resolved |
|---|---|---|---|---|
| `comment-1` | `order-list` | （无，v5 前的旧格式） | 这个按钮太土了 | false |
| `comment-2` | `dashboard` | `body > div:nth-of-type(1) > header > div:nth-of-type(1) > button:nth-of-type(1)` | 这个按钮太土了（元素锚点测试） | false |
| `comment-3` | `mobile-home` | `body > div:nth-of-type(1) > main > article > h1` | 这个按钮太土了 | false |

- host 半（`index.js`、`src/host/**`）本次零改动，`design_canvas_apply` 的 `add_comment` / `resolve_comment` 仍在 op 词表里且未改实现。
- 画布不再调用这两个 op，已记入 `docs/architecture.md` 的"UI 不再调用的 op"清单。

**运行级证据**：见 §五（T3 复核 `design_status` 返回与工具可用性）。

### 3.8 AC8 无回归

> AC8 无回归：node --check client.js 通过；node --test src/host/*.test.js 全绿；design_frame_write、落地到项目、探针 setText 通道等既有能力不被破坏（手工回归点到）。

**实现侧证据**

- `node --check client.js`：退出码 0，无输出。
- `node --test src/host/*.test.js`：tests 50 / suites 16 / pass 50 / fail 0（§2.2 原文输出）。
- 本次改动只在 `client.js` 内，未触碰 host 工具与写通道；`落地到项目` 的降级复制卡片路径（`handoffText`）与探针 `setText` 分支都还在原处（`client.js:414`、`client.js:1630` 起）。

**运行级证据**：手工回归点到由 T3 完成，见 §五。

---

## 四、本报告没有取得结论的部分（如实标注）

> **§五 现已填写**：**7 PASS / 1 无法确认（AC5）**——AC1/AC2/AC4/AC6/AC7/AC8 = PASS，AC3 按 Lead 修正后的判据复判 = PASS（v1 判据下曾判 FAIL，改判由来看 §5.3），AC5 = 无法确认（失败分支不可达）。本节保留"实现侧自查当时不下结论"的原始口径；凡本节列出的项，结论一律以 §五 为准。

1. **所有运行级数字与文本**：500ms 内到达、输入框里引用文本的原样、`document.activeElement`、`scrollTop` 差值、插入后光标落点与接着敲字的实际位置、连续两条引用的实际内容（含中间的分隔换行）、失败提示的实际渲染、空帧 / 超限帧 / 切走帧的行为——**本报告一条都没有下结论**，全部由 §五 的独立复验给出。
   另外，"版本沿革"里的 D1~D5 是**实现方自述**：D1/D2/D3 属于"面板能不能起来、钩子能不能用"的前提，D4/D5 直接关系 AC3/AC4 的判定，T1 报"已修"不等于已复验（T3 已在 §5.2 逐项复核：D2/D3/D4/D5 均成立；D4 的修复让输入框成为 `activeElement`，AC3 判据因此由 Lead 裁定改为"不打断、可接着写"）。
2. **本报告没有覆盖的范围**：沙箱逃逸攻击面（`allow-same-origin` 类）、写通道同源护栏、容器/尺寸策略、自动打开行为——这些在 [画布形态报告](verification-feature-dsh-design-canvas.md) 里已验，本次改动未触碰相关代码，**没有重跑**。
3. **未跑**：`node design-system/tools/check-design-system.mjs`（设计契约自检）与 `node scripts/post-restart-check.mjs`（重启后体检）——本次不涉及设计契约与 host 注册，未跑就不要写成"通过"。

---

## 五、独立复验结论（teammate-verifier / T3 填）

> **本节由 T3 追加填写，T1 与 T2 都不在此处下结论。**
>
> 填写要求（来自 task-3）：
> 1. 被验版本 = 本文档冻结的 `client.js`（sha256[:16] **`7fb7b8ebadc473b0`**，1821 行；若 T3 实测时版本不同，请写明实际 sha 与差异原因）。
> 2. 逐条 AC 给出 **pass / fail** 判定与证据（选择器、文本、时间、截图路径均可）；判定为 fail 的，写清复现步骤。
> 3. 附对抗式验证的三条尝试及证据强度：①「引用没进输入框却看起来成功」；②「插入把用户既有草稿冲掉」；③「属性面板其实还在」。
> 4. **重点复核 T1 自述修复过的四处**（§头部"版本沿革"里的 D1~D5）：两参形式 `selectElement(frameId, info)` 真的插进去了（D3）、`previewSessions()` 非空（D2）、插入后接着敲字落在引用末尾而不是文档开头（D4）、连续两条引用之间有一个换行而不是首尾相粘（D5）。
> 5. 追加，不要覆盖 §一~§四；如与实现侧描述有出入，以本节实测为准，并在本节明确写出差异。

**T3 已填写（2026-10-09）**：被验版本与 §2.1 冻结版**一致**（`7fb7b8ebadc473b0`，1821 行），无需版本差异说明。填写要求第 4 条「重点复核 T1 自述修复过的四处」的结论见 5.2/5.5（D2/D3/D4/D5 四项均已复验，其中 D4 的修复带来一条 AC3 子项不达标，见 5.3）。

---

### 5.1 被验版本、红基线、复现方式

**被验版本**：`client.js` sha256[:16] = **`7fb7b8ebadc473b0`（1821 行）**，与 §2.1 冻结版一致。冻结副本 `.playwright-mcp/ac-evidence/v6-element-ref/frozen-final-authored.js`（全值 `7fb7b8ebadc473b0b43af10968e53e0105174e067b16eef3db4a367e7e54f8e0`）。**§五所有运行级数字都在这一版上重跑过。**

复验期间的版本沿革（T3 亲历，用于解释为什么 §2.1 之前出现过别的 sha）：

| sha256[:16] | 说明 |
| --- | --- |
| `64992303f5a91c50` | 变更前的旧构建（`git HEAD`，红基线对象） |
| `68a647223e098150` | T1 首版：T3 一打开面板即崩（D1） |
| `399171d0e75640ff` | 修 D1 后 |
| `437666ba3cfde7be` | 修 D2 后（此时空草稿连续引用通过、有草稿场景失败） |
| `0f3bd9e12691bc18` | 修 D3、试修 D4，引入 D5（分隔符回归，AC4 一度失败） |
| **`7fb7b8ebadc473b0`** | **最终冻结版；以下结论只对这一版负责** |

**红基线（证据强度：diff / 源码级，非运行级——不含糊成"运行级"）**

- 冻结旧源码 `.playwright-mcp/ac-evidence/v6-element-ref/frozen-old-client.js`（= `git show HEAD:client.js`，`64992303f5a91c50…`）里 `insertText` / `inputActions` / `captureInsertion` 命中 **0 / 0 / 0**：旧构建根本不存在任何"把文本写进聊天输入框"的调用，本探针的绿判据在旧构建上不可能成立。
- 同一文件里 `元素属性`、`就这个元素写批注`、`Inspector` 各命中 2 次（旧行为的代码本体）；`git diff` 删除行含 `function Inspector(` 起 115 行、工具栏「批注（N）」入口、`props: '元素属性'`、`commentNew: '就这个元素写批注'`（见 `red-baseline-diff.txt`）。
- **为什么不是运行级红基线**：T1 的实现先于 T3 开跑落到磁盘，旧构建的运行态已不存在；旧版也没有验收钩子，无法在不改代码的前提下构造同一条探针。旧行为的运行级记录见上一轮报告 `docs/verification-feature-dsh-design-canvas.md` §3.6（点元素 → 属性抽屉）。

**环境与复现方式**

- 真实 GUI `http://127.0.0.1:3080`，独立 `--isolated` headless Chromium；自签 cookie：无 cookie `401`、带 cookie `200`（`auth-check.txt`，2026-10-09T00:39:22+08:00）；铸造脚本 `mint-cookie.cjs`（只读 `~/.dsh/.credentials.yaml` 的 browser-session secret，未重启 `dsh web`、未打印密钥）。
- 真值只取**真实输入框 DOM**：`div[data-composer-input][contenteditable="true"]`（Lexical 根同时带 `data-lexical-editor="true"`），按 `:scope > p` 逐段读 `innerText` 再拼行；不读任何自家状态变量。
- 触发点选三条路：① 帧内 `element.click()`（走探针 **capture 相位**的 click 监听，探针不检查 `isTrusted`）；② 父页面 `iframe.contentWindow.postMessage({__dshDesignCmd:true,cmd:'selectPath',value})`（走探针 `selectPath` → `post({type:'select'})` → 父页面同源校验）；③ 钩子 `window.__dshDesignCanvas.selectElement(...)`。三条最终都汇入生产代码 `onSelectElement`。
- 脚本（可 `browser_run_code_unsafe({filename})` 直接复跑）：`rerun-A.js`（AC1/AC2/AC3）、`rerun-B.js`（AC4/AC5/AC6/AC7+对抗）、`rerun-C.js`（插入通道与草稿深挖）、`rerun-D.js`（终局 AC1~AC4）、`rerun-E.js`（终局 AC5~AC8）。

### 5.2 逐条 AC 判定

| AC | 判定 | 一句话证据 |
| --- | --- | --- |
| AC1 点选即引用 | **PASS** | 空草稿点选 → 输入框 DOM 出现五行引用，**13~17ms**（预算 500ms）；页面与面板查不到「元素属性」「就这个元素写批注」；右栏表单控件选中前后都是 2 个 `<select>`（切屏器 + 视口预设），**没有新增属性输入框** |
| AC2 内容完整且克制 | **PASS** | 五行逐字匹配；长文本截断为 **41 字（40 + `…`）**；无文字元素给 `(这个元素没有文字)`；全文不含颜色/字号/内边距/外边距字段 |
| AC3 不打断、可接着写（**判据已按 Lead 裁定更新**） | **PASS** | 5 项子判据全部实测通过：聊天列 `scrollTop` 差值 0；窗口/文档视口不滚（`window.scrollY` / `doc.scrollTop` 全程 0，所有滚动容器与面板几何不变）；草稿一字不丢；插入后敲 `ZZ` 落**末尾**；一次 `Ctrl+Z` 恢复草稿。**原判据「`document.activeElement` 仍是预览侧元素」已由 Lead 裁定移除**（理由与改判过程见 5.3）；`activeElement` 变成输入框作为该行为的已知副作用如实记录，不再计入判定 |
| AC4 可连续引用 | **PASS** | 空草稿连点两条：`…order-list.html\n【设计元素】…`；有草稿连点两条：草稿完整在最前、两条引用依次在后、都有换行 |
| AC5 失败可见 | **无法确认** | 故障注入只清桥（B 路）；A 路（面板 props）实测可用 → "两条路都不通"的失败分支构造不出来。见 5.6 |
| AC6 边界不炸 | **PASS（两项子判据未覆盖）** | 选择器指不到、切走的帧、`text` 为空串均不炸、不插入坏数据、不写盘；0 字节帧 / 超限帧运行级未覆盖（理由见 5.6） |
| AC7 批注 UI 退场且数据不丢 | **PASS** | 界面零旧文案、无「批注（N）」按钮、无 `data-dsh-comment-mark` 角标；`design_status` 仍返回 3 条 comments（含锚点）；host 零改动、`add_comment`/`resolve_comment` 仍在词表 |
| AC8 无回归 | **PASS** | `node --check` 退出码 0；host `tests 50 / pass 50 / fail 0`；切屏、落地面板、探针 `setText` 通道可用且**全程零写盘** |

**对填写要求第 4 条（T1 自述修复的四处）的逐项复核**

| 自述 | T3 实测 | 判定 |
| --- | --- | --- |
| D2 `previewSessions()` 非空 | `previewSessions()` = `['session-a83bcc55-1fb0-4d36-afc2-85847f1fe983']`；面板渲染「第 1 / 3 屏」，无 `[data-slot-error]` | ✅ 成立 |
| D3 两参形式真的插入 | `selectElement('order-list', {path,tag,text:'TWO-ARG'})` 返回 true **且**输入框出现引用（`当前文字：TWO-ARG`）；三参形式同样成立 | ✅ 成立 |
| D4 敲字落在引用末尾 | 插入后（`activeElement` 已是输入框）直接敲 `ZZ` → 文本末尾为 `…order-list.htmlZZ`，`zzLandedAtEnd: true` | ✅ 成立（代价见 AC3） |
| D5 两条引用之间有换行 | 空草稿连点两条 + 有草稿连点两条，均命中 `/\.html\n【设计元素】/`，无 `\.html【` 粘连 | ✅ 成立 |

### 5.3 运行级原始证据

**AC1 / AC2（最终版；就绪探针：`[data-slot-error]` 不存在、`previewSessions()` 非空、`insertersMapSize = 1`）**

点选 `body > div > div > main > div:nth-of-type(1) > div:nth-of-type(2) > button:nth-of-type(1)`（文字"导出"）后，`[data-composer-input]` 的 `:scope > p` 逐段文本：

```
【设计元素】订阅订单列表 · SaaS 后台（frame: order-list）
元素：button
选择器：body > div > div > main > div:nth-of-type(1) > div:nth-of-type(2) > button:nth-of-type(1)
当前文字：导出
文件：.design/frames/order-list.html
```

- 计时：`postMessage` → 输入框 DOM 出现 `【设计元素】` = **17ms**（另有 13ms / 14ms 两轮），远小于 500ms。
- 选择器自洽性：帧内用探针同款算法独立复算同一按钮的路径，与引用里的**逐字相同**；把引用里的选择器回灌探针（`selectPath`）仍命中同一元素。
- 克制性：引用全文不含 `颜色`、`背景色`、`字号`、`内边距`、`外边距`、`#` 色值、`px` 数值。
- 截断：容器 `body > div` → `当前文字：启元云 订阅中台 总览 仪表盘 实时动态3 交易 订单 订阅计划 退款与争议9 …`（**41 字**，空白归一化为单空格，末尾 `…`）。
- 无文字元素（页头图标按钮）→ `当前文字：(这个元素没有文字)`。
- 无属性面板：`body.innerText` 与面板文本都不含「元素属性」「就这个元素写批注」「文字颜色」「内边距」「保存批注」；选中前后右栏 `input,select,textarea,[contenteditable],[role=textbox]` 计数都是 **2**，且**两个都是 `<select>`**（`select[3]` 切屏器 + `select[5]` 视口预设）；`data-dsh-comment-mark` = 0。

**AC3（最终版；真实中文草稿 `把导出按钮改成描边样式`）**

| 子判据（**按 SPEC v3 新原文**） | 实测 |
| --- | --- |
| ① 聊天列 `scrollTop` 与插入前一致（差值 0） | ⚠️/✅ 数值成立（0 → 0），但本会话 `scrollHeight === clientHeight === 680`（会话内容不足一屏），**该条在本会话是空转的**；我没有把它当成"不滚动"的有效证据（另见 5.6.4） |
| ② 视口不跳 | ✅ 直接实测：`window.scrollY` = 0、`document.documentElement.scrollTop` = 0（插入前后、两次插入后均不变）；`[data-sidebar-right-panel]` 几何不变（`[704,0,576,720]`）；所有"可滚动"容器的 `scrollTop` 不变。**关键对照实验**：手工往输入框打 5 行（输入框 52→124px）与插入一条引用（52→172px）**都不会让预览 iframe 在屏幕上移动**（`iframe.getBoundingClientRect().y` 三种状态都是 170）——说明"输入框变高"不会推动预览布局。（唯一一次例外：刚打开面板那一轮的首个快照 `y=128`、700ms 后 `y=170`；同轮对照证明与插入无关，判定为面板挂载后的布局落定） |
| ③ 用户既有草稿一字不丢 | ✅ 插入后 = `把导出按钮改成描边样式\n【设计元素】…`，草稿原样作为前缀保留；连点两次后草稿仍在最前 |
| ④ 插入后光标落在草稿末尾（紧接着打字落末尾） | ✅ 插入后直接敲 `ZZ` → `…order-list.htmlZZ`（落最末尾；`zzLandedAtStart: false`） |
| ⑤ 一次撤销即可恢复到插入前的草稿 | ✅ `Ctrl+Z` 一次整条引用消失、草稿回原文——证明是 Lexical 的真实编辑而非 DOM 塞字 |
| 补充实测（观察项，不在新判据内） | `document.activeElement`：插入前 `body` → 插入后 `composer`，0/50/150/400/900ms 采样一直是 composer；`Ctrl+Shift+Z` 重做未恢复引用 |

> **改判说明（原 FAIL → 现 PASS）**：本节最初按 SPEC v1 原文判 **FAIL**，理由是插入后 `document.activeElement` 变成输入框，与旧原文「仍是预览侧元素（不是输入框）」不符。Lead 随后裁定**改判据、不改实现**：那条是设计阶段自加的技术细节，而用户诉求是"引用完直接在聊天框里说话"，把选区收拢到文档末尾正是达成它的手段、`activeElement` 成为输入框是该手段的代价。SPEC 已更新（status_log 记录了这次裁定；文件头的版本号此后继续随状态推进递增，本节不钉死具体数字），新 AC3 原文为「不打断、可接着写：……scrollTop 差值 0、视口不跳；草稿一字不丢；光标落在草稿末尾；一次撤销可恢复」，constraints 同步改为「允许把编辑器选区收拢到文档末尾……但不允许因此产生滚动、视口跳动或草稿损失」。
>
> 依新原文 5 项子判据全部满足 → **AC3 改判 PASS**。改动只发生在判据文本与本节判定；**被验物 `client.js` 未变（仍 `7fb7b8ebadc473b0`，1821 行），其它 AC 的结论与证据未重跑、未改动**。判定基准变更时间：2026-10-09（Lead 裁定）。
>
> 注：Lead 通知里写"version 2"，指的是 **AC3 判据的第 2 版**（判据版本）；spec 文件头的 `version:` 是**文档版本**，随 status_log 递增（收录这场裁定时读到的是 3，成稿时已因后续状态推进继续变化）。两者不矛盾——引用时请说"AC3 判据第 2 版"，不要拿文件头的数字去指判据版本。

**AC4（最终版实际文本）**

- 空草稿：点「导出」→ 点「新建订单」→ `…order-list.html\n【设计元素】…`（`firstIntact: true`、`/\.html\n【设计元素】/=true`、无 `\.html【` 粘连）。
- 有草稿：`把导出按钮改成描边样式\n【设计元素】（导出）…\n【设计元素】（新建订单）…`（`secondAtStart: false`、`gluedToDraft: false`）。

**AC6（最终版）**

- 选择器指不到任何元素：输入框文本**一字未变**、无异常。
- 切到第 2 屏（`监控仪表盘`，帧内 `document.title = 观测台 · 科技工具`）后用第 1 屏的选择器发点选：**输入框一字未变**、不报错。
- `info.text` 为空串：走兜底文案（见 AC2）。
- 未捕获异常收集器（`error` + `unhandledrejection`）在各轮点选后均为 `[]`。

**AC7（最终版：运行 + 数据 + host）**

- 运行级：无「元素属性」「就这个元素写批注」；无匹配 `/^批注（\d+）$/` 的按钮；`data-dsh-comment-mark` = 0。
- 静态：最终版 `grep -c` → `就这个元素写批注` = 0、`批注（` = 0、`Inspector` = 0；`元素属性` = 2，**都在代码注释里**（"这里不再有『元素属性』抽屉" / "元素属性表把人逼进 6 个输入框"）。
- 数据：`design_status` 两次返回 `comments[]` = 3 条，与 §3.7 表格逐条一致（`comment-1` 无锚点、`comment-2/3` 带 `target`，`resolved` 均 false）。
- host：`git diff --stat -- src/host index.js` 为空；`src/host/tools.js` 词表仍含 `add_comment` / `resolve_comment`。

**AC8（最终版）**

- `node --check client.js` → 退出码 0、无输出；`node --test src/host/*.test.js` → `tests 50 / suites 16 / pass 50 / fail 0`。
- 切屏：第 1 屏 ↔ 第 2 屏正常，iframe 重渲染、标题随帧变化。
- 探针 `setText` 通道仍活：帧内 `导出` → `X`（改的是 iframe DOM），**且不产生新引用**（父页面不再处理探针 `changed`），点「刷新读取」后帧内 DOM 从磁盘恢复为 `导出`。
- **零写盘**：`.design/frames/*.html` 三个文件 sha256 与 00:41 基线**逐字节相同**；`.design/design.json` 仅 `selection.frameId/updatedAt` 因手动切屏变化（2026-10-08T16:48:47.849Z），`frames[]` / `comments[]` / `tokens` 无变化。
- 沙箱红线未动：探针自报 `sandbox="allow-scripts"`、`opaqueOrigin=true`、`parent.document` 与 `cookie` 均 SecurityError（控制台原文）。
- 代码面无禁用手段：`.focus(` = 0、`execCommand` = 0、无 contenteditable 直改、无伪造键盘事件；插入唯一出口是 `actions.insertText(text, span)`。

### 5.4 对抗式三问（逐条给证据强度）

1. **「引用没真进输入框，只是面板里显示了」——证伪成功。**
   ① 真值是 `div[data-composer-input]` 里的 Lexical 文本节点，`innerHTML` 形如 `<p dir="auto"><span data-lexical-text="true">【设计元素】…</span></p>`；② `[data-composer-text-ref]` chip 数 = 0、无 `\uFFFC`（纯文本，不是引用胶囊）；③ `Ctrl+Z` 一次整条引用消失（进了编辑器撤销栈）；④ **整页 reload 后草稿仍在**（写进了会话草稿模型）；⑤ 面板「最近引用」状态条只是账本，与输入框真值独立、文本一致。
2. **「插入把用户既有草稿冲掉 / 光标被挪走」——最终版证伪成功，但中途确实翻过两次车（D4/D5）。**
   最终版：草稿逐字保留且在最前、引用在草稿之后并带换行、插入后打字落末尾、一次 `Ctrl+Z` 恢复草稿。中途：`437666ba` 上"有草稿连点两次"第二条插到最前并与草稿首字粘连；`0f3bd9e1` 上分隔符整个丢失（`BEFORE【设计元素】…`、两条引用首尾粘连、AC4 直接失败）。原始文本见 5.5。
3. **「属性面板其实还在，只是换了样子」——证伪成功。**
   选中前后右栏表单控件计数都是 2 且都是 `<select>`（切屏器/视口预设，与选中无关）；面板只多出「最近引用」状态条 + 一条 info banner（文案已照抄）；无任何输入框/文本域/contenteditable 新增；旧文案全零。

### 5.5 复验中抓到、由 T1 修复的缺陷（按发现顺序）

| 编号 | 现象 | 证据 | 状态 |
| --- | --- | --- | --- |
| D1 | 面板挂载即崩：`ReferenceError: Cannot access 'onSelectElement' before initialization`，插槽被兜成 `<div data-slot-error="sidebar.right.pane.tab">`，面板空白 | `defect-1-slot-crash.json/.png`；根因：effect 依赖数组在 `const onSelectElement` 之前求值（TDZ） | 已修 `399171d0`；复验：面板正常、无 slot-error |
| D2 | `previewSessions()` 恒空、`selectElement()`/`command()` 全 false | 面板已渲染但 `previewSessions()` = `[]`；根因：`PreviewTabBody` 白名单转发漏 `onPreviewReady` | 已修 `437666ba`；复验：返回当前 sessionId、钩子可用 |
| D3 | 文档承诺的两参 `selectElement(frameId, info)` **返回 true 却什么都没插**（参数错位） | 两参 true + 输入框 `"\n"`；三参 true + 引用进框 | 已修 `0f3bd9e1` 起；最终版两参/三参都真的插入 |
| D4 | 异步插入后**光标塌到文档开头**：插入后敲 `ZZ` 得到 `ZZBEFORE…`；有草稿连点两次第二条插最前并粘连 | `rerun-B/C` 原始文本 | 已修 `7fb7b8eb`；复验：`ZZ` 落末尾（代价：`activeElement` 变输入框；Lead 已据此改 AC3 判据，改判 PASS，见 5.3） |
| D5 | 试修 D4 时引入：`setDraft` 追加分支是**死代码**（`actions.state` 不存在，实测计数器 `setDraft: 0 / insertText: 8`），且**分隔符丢失** → AC4 由通过变失败 | `actionsShape.hasState:false`；`BEFORE【设计元素】…`、`…html【设计元素】…` | 已修 `7fb7b8eb`；复验：AC4 两种场景通过 |

> D1/D2/D3 曾在"实现自称完成、`node --check` 通过、host 测试全绿"的状态下存在——**静态门与单元测试拦不住这三类问题，只有真实 GUI 能**。

### 5.6 未取得结论 / 未覆盖（如实标注，不凑通过）

1. **AC5 失败分支：无法确认。** 实测"清桥（B 路）后点选"引用照样进输入框（面板 props 的 A 路可用：`mapEmptyAtSend = 0` 仍插入成功，面板显示的是成功 banner，不是失败提示）。要触发 `refFailed` 分支必须让 A、B 两路同时不可用，而这需要往生产代码加测试桩（T1 明确不加）。现有证据只到代码级：失败分支存在、`report(...,'error')` 渲染在面板内、状态条保留 `复制引用` 按钮且 `title` 挂全文。
2. **0 字节帧 / 超限帧：运行级未覆盖。** 当前工程没有这两种帧，造帧会污染用户工作区；只做静态核对（读取阶段 `frameEmpty` / `frameTooLarge` 占位，本次变更未触碰该路径；上一轮报告 §3.11 已运行级验证边界容错）。
3. **可信鼠标点击：未确认。** `frame.locator(...).click()` 在这个缩放帧上不可用（先 `Timeout 3000ms exceeded`，`{force:true}` 时 `Element is outside of the viewport`）。改用帧内 `element.click()`（探针 click 监听在 capture 相位且不检查 `isTrusted`，走同一段生产代码）与探针 `selectPath` 通道。
4. **AC3 的 `scrollTop` 判据空转**：本会话 `scrollHeight === clientHeight`，`scrollTop` 恒为 0，差值 0 不构成"不滚动"的有效证据。
5. **`Ctrl+Shift+Z` 重做**：插入后重做未恢复引用（观察项，不在 AC 内，未深挖是键盘焦点还是 Lexical 历史的行为）。
6. 未跑 `design-system/tools/check-design-system.mjs` 与 `scripts/post-restart-check.mjs`（理由同 §四.3）。

### 5.7 与 §三 实现侧描述的出入

1. **§3.4 分隔符规则**：最终版实际是**读输入框 DOM 判断草稿空/非空**（`composerDraftEmpty()`），而不是 §3.4 写的"插入点正好在行首时不加"。原因：异步插入后投影选区会塌成 `{0,0}`，用 `start === 0` 判断会把"位置 0"误当"空文档"（D5 粘连的来源）。**结论一致，机制描述需按最终版更新。**
2. **§3.5 失败分支可达性**：§3.5 暗示"构造 `clear()` 后点选"能看到失败提示；实测看不到（A 路兜住），该分支目前不可达。
3. **§3.6 "被切走的帧不会注册命令 handler"**：更准确的实测口径是"切屏后旧屏选择器在新帧里 `querySelector` 找不到元素 → 探针不发 `select`"。结论相同（不炸、不写入），措辞需校正。
4. **§3.3 "没有任何 `focus()` 调用"**：静态成立（`grep -c '\.focus('` = 0），但最终版通过收拢 DOM 选区使 `document.activeElement` 变成输入框——**"没调 focus()" ≠ "焦点没被移动"**。**该事实已由 Lead 裁定为可接受代价并据此改判据（判据文本见 §5.3 改判说明），AC3 最终判定 PASS**；本条保留为"静态描述与运行级事实的差异"记录，不再是判定分歧。
5. **§3.1/§3.2/§3.3 里 client.js 的行号**（如 `onSelectElement` 在 1347 行、`buildElementReference` 在 117 行）是按中途版本写的，最终版 1821 行；引用行号请以最终版为准。

### 5.8 证据索引（`.playwright-mcp/ac-evidence/v6-element-ref/`）

| 文件 | 内容 |
| --- | --- |
| `ac-check-plan.md` | 复验前写下的 AC1~AC8 可判定检查式（探针设计） |
| `frozen-old-client.js` / `frozen-new-client.js` / `frozen-run-client.js` / `frozen-final-authored.js` | 四个被验快照（旧构建 / T1 首版 / 中途 / 最终），配套 `.sha256` |
| `red-baseline-diff.txt` | 红基线：diff 统计 + 被删旧行为锚点 + 旧构建 `insertText` 命中 0 |
| `rerun-A.js` … `rerun-E.js` | 五段可直接复跑的验收脚本 |
| `defect-1-slot-crash.json` / `.png` | D1 崩溃现场（控制台原文 + `data-slot-error` 节点 + 空面板截图） |
| `ac1-reference-in-composer.png` / `ac1-final-build.png` / `final-build-ac-evidence.png` | 输入框里出现引用 + 面板状态条截图 |
| `static-final.txt` / `host-tests-prechange.log` | 最终版静态核对与 host 测试输出 |
| `hashes-before.txt` / `auth-check.txt` / `session-cookie.json` / `mint-cookie.cjs` | 写盘基线、认证复核、cookie 铸造 |
