# 验收报告：点选设计元素 → @ 式引用胶囊进对话（去元素属性面板与批注入口）

- 执行者自查：**lead**（T1/T4，本次实现的执行者，**不是**独立复验）
- 独立复验：**teammate-verifier**（T3，全程未参与实现）—— 两轮：**§五 = v7 纯文本形态（历史）**、**§六 = v8 胶囊形态（现行）**
- 静态证据整理与文字核对：teammate-docs（T2，只整理 T1/T3 的结论，不产生运行级结论）
- 日期：2026-10-09（Asia/Shanghai）
- 验收对象：[`specs/feature-element-reference-to-composer.yaml`](../specs/feature-element-reference-to-composer.yaml)（AC1~AC8。**版本号随状态推进 +1**：v3 收录 AC3 判据裁定、**v6 收录胶囊形态的 AC1~AC8**；对版本请以文件内 `status_log` 为准，别拿本报告里出现的号去对文件）
- 真实环境：DSH Web GUI `http://127.0.0.1:3080`（真实 Chromium，playwright-mcp 驱动）
- 被验版本（冻结 sha256 前 16 位）：

  | 轮次 | 文件 | sha256[:16] | 说明 |
  |---|---|---|---|
  | **v8 胶囊（现行）** | `client.js` | **`2c603987bd84c1ef`** | 2149 行；v8 这一轮相对**已提交的 v7 版本** `git diff --numstat` = **+354 / −26**（含 D7 撤销边界修复） |
  | v7 纯文本（历史） | `client.js` | `7fb7b8ebadc473b0` | 1821 行；当时相对变更前 = +392 / −272 |
  | 两轮均未改动 | `index.js`、`src/host/**` | — | 契约要求"只改客户端 client.js" |

> **验收之后的改动（改名，行为不变）**：`2c603987bd84c1ef` 之后又有两笔**与功能无关**的提交——`7b8e4af` / `6c4d1a9`（包名与客户端模块 id `@local/dsh-design-canvas` → `dsh-design-agent`、`locale` 插件显示名改成「设计预览」）与紧接的一次 id 对齐（右侧栏标签 id `design-canvas` → `design-preview`、`systemPrompt` 段名 → `design-agent/conventions`、胶囊桥插槽 id、以及空态提示文案一处）。改名后 `client.js` sha256[:16] = **`cdc68197730c9471`**。**本报告的功能结论仍然对应 `2c603987bd84c1ef`**：改名只动标识符与一处文案，插入路径、胶囊结构、codec、降级链一行未改；改名后已实跑 `scripts/post-restart-check.mjs`（路由=ok 工具=3/3 数据层=ok 一把过）并在真实 GUI 复验面板与胶囊仍正常。**写通道 `/design-canvas/api`、`.design/` 目录名与两个历史文件名刻意保留**（冻结契约与真实目录，见 README 与 architecture 的命名说明）。

> **证据目录不在版本库里**：报告里引用的 `.playwright-mcp/ac-evidence/**`（原始 JSON、可复跑脚本、截图、冻结快照）是**本地验收产物**，按仓库卫生约定不纳入版本控制（见 `.gitignore`）；公开仓库里只有报告正文与 `docs/evidence/` 下少数留档文件。要复现请按每节给出的命令与判据自己跑一遍。

> **这份报告有两轮独立复验，别读串**：**§五 = v7 纯文本形态**（当时 7 PASS / 1 无法确认，AC5 失败分支构造不出来）；**§六 = v8 胶囊形态**（现行版本，AC1~AC8 全部 PASS，AC3 的 D7 撤销缺陷已由 T1 修复）。**现行判定一律以 §六 为准**，§五 作为形态演进的历史记录保留。
> **§一~§四 写的是实现侧证据，现在描述的是 v8 胶囊实现**：§五/§六 里出现的 `buildElementReference` 等旧函数名属于当时版本，v8 已拆成 `refPayload()` + `locatorText()`。运行级结论只在 §五/§六。
> **注意 §六 里的版本口径**：T5 的胶囊**首轮**复验跑在 `12dfaa9395401190`（2135 行）上，发现了 D7；Lead 修完得到现行的 `2c603987bd84c1ef`（2149 行），**T5 已在终版上做全量回归**（AC1~AC8 全部通过，D7 复验通过），详见 §6.5 与 §6.7。

> **v7 轮次的修复史（T1 提供，未经独立复验，属历史）**：`68a6472` → `399171d0` → `437666ba` → `87dbba` → `0f3bd9e1` → `3ca18672` → `8c0953f9` → `7fb7b8eb`。
> - D1 面板挂载即崩（test hook 的 `useEffect` 依赖数组撞 TDZ）→ 依赖数组摘掉、回调走 ref；
> - D2 `previewSessions()` 恒空 → `PreviewTabBody` 补转发 `onPreviewReady`；
> - D3 测试钩子两参形式参数错位、且**返回 true 却什么都没插**（"假装成功"）→ 按第 3 个实参是否存在判形态；
> - D4 插入后光标塌到文档开头（接着敲字会跑到引用前面）→ 新增 `collapseComposerCaretToEnd()`；
> - D5 修 D4 时引入的回归：`InputActions` 没有 `state`，"读草稿"是死代码、分隔符丢失、两条引用首尾相粘 → 删掉 `setDraft` 分支，改用 `composerDraftEmpty()` 读输入框 DOM 判空。

> **v8 轮次的缺陷（现行）**：**D6**（`ctx.inputTriggers` 属性访问被 try/catch 吞成 null → 胶囊路径静默消失，不报错不崩）已由 T1 修复，改用 `optionalService(ctx, key)` 内部的 `ctx.get`；**D7**（紧跟打字之后点元素，一次 `Ctrl+Z` 会连带吞掉刚打的草稿且不可恢复）已由 Lead 修复——`insertReferenceChip` 在插胶囊前先用带 tag 的 `insertText('', span)` 开一条独立历史边界，再重新取 span 把胶囊放进新边界（一次点选写两次编辑器，边界没开成时不阻断主流程）。两条的现场与证据见 §6.5；D7 修复版的回归数字由 T5 补。

> 凡是需要真实浏览器才能回答的问题（耗时、胶囊 DOM、`document.activeElement`、`scrollTop` 差值、发送时序列化出什么），§一~§四**一律不下"已通过"结论**，只在 §五/§六 由 T3 给出。

---

## 一、结论摘要

| AC | 实现侧结论（静态/代码级，v8 胶囊） | 独立复验判定（现行 = §六；括注为 v7 历史 = §五） |
|---|---|---|
| AC1 点选即出胶囊 | **就绪**：`onSelectElement`（`client.js:1604`）→ `refPayload` / `chipLabel` → `captureInsertion()` → `insertReferenceChip`（`372`）→ `actx.bail(actx, 'slash/input-insert-reference')`；界面文案与 JSX 里查不到「元素属性」 | **PASS**（§六）：**15~17ms** 出现胶囊（首轮 17ms、终版 15ms），DOM 是 `[data-lexical-decorator]` 内 `span[data-composer-chip="design-element"]`；**反向判据成立**——输入框里不再有整段纯文本（历史 v7：13~17ms 出现五行文本） |
| AC2 胶囊标签与模型文本 | **就绪**：`chipLabel`（`230`）= 「元素文字 · 屏名」（文字上限 14 字、屏名取 ` · ` 前主标题再截 12 字）；`codec.serialize`（`2066` 起）→ `locatorText`（`213`）产出五行 | **PASS**（§六）：标签 `导出 · 订阅订单列表`、`title` 一致；`serializeRef()` 走 **roster 路径**返回逐字五行、无 `no serializer`；长文本/无文字两种回落都对 |
| AC3 不打断、可接着写 | **就绪**：不调 `focus()`、不做 DOM 注入、不碰滚动；插入后把选区收拢到草稿末尾（`329`）。**D7 修复后**：插胶囊前先开一条独立历史边界（`insertReferenceChip` 内 `375`–`388`） | **PASS（终版）**（§六）：一次 `Ctrl+Z` 原子去掉胶囊**且草稿原样保留**（`ABCD` → 点选 → 一次撤销 → `ABCD`）；修 D7 之前这一步会连带吞掉刚打的草稿，Lead 已修、终版复验通过（见 §6.7）。不滚动 / 不跳视口、胶囊在末尾、光标落末尾、输入框高度仍 52px |
| AC4 可连续引用 | **就绪**：每次点选独立走 `captureInsertion()` + `bail`，胶囊是原子节点、顺序即点击顺序；`composerDraftEmpty`（`312`）的分隔符规则只服务纯文本降级路径 | **PASS**（§六）：连点两个元素 = 2 个胶囊、顺序与点击一致、第一个完整保留；先打字再连点的混合场景草稿在最前、无粘连 |
| AC5 失败可见与降级 | **就绪**：三级路径——胶囊 → 纯文本（`refDegraded` 提示，`1670`）→ 可见失败（`1676`）；`chipSourceReady`（`248`）是"source 注册成功才插胶囊"的门 | **PASS（本轮，与 §五 的"无法确认"不同）**（§六）：`setChipAvailable(false)` 实测降级可见（0 胶囊 + 纯文本五行 + 面板「已降级为纯文本引用：…」+ 状态条「（纯文本）」），恢复后回到胶囊；**仅"两条路都不通"那一层仍未构造出来** |
| AC6 边界不炸 | **就绪**：帧/id 找不到或 `info` 为空时只清空状态条并返回（`1607`）；父页面消息有 `event.source === iframe.contentWindow` 源校验（`1192`）；`locatorText` / `chipLabel` 对空 tag / 空路径 / 空文字都有兜底 | **PASS（两项未覆盖）**（§六）：无效选择器、切走的帧、不存在的 frameId、`info=null` 都不炸；空 path+tag+text 仍出合法胶囊与合法序列化文本；**0 字节帧 / 超限帧未做运行级** |
| AC7 批注 UI 退场、数据不丢、@ 菜单不被污染 | **就绪**：旧界面文案与 `Inspector` 在代码里归零；`candidates` 返回空数组 + `showGroupTitle:false`（`2058`）避免污染 `@` 菜单 | **PASS**（§六）：`@` 菜单 2 组（`Files & folders` 13 条 / `Sessions` 50 条）、**空分组 0**、无本插件分组或条目；`design_status` 仍返回 3 条 comments |
| AC8 无回归 | **通过（静态）**：`node --check client.js` 通过；`node --test src/host/*.test.js` → tests 50 / suites 16 / pass 50 / fail 0 | **PASS**（§六）：切屏正常、探针 `setText` 通道正常、`.design/frames/*.html` 三个文件与基线**逐字节相同**（零写盘） |

**现行汇总（T3 §六，终版 `2c603987bd84c1ef` / 2149 行）：AC1~AC8 全部 PASS**；AC3 = **PASS（终版）**，一次 `Ctrl+Z` 原子去掉胶囊且草稿原样保留（D7 修前会连带吞掉刚打的草稿，已修并复验，见 §6.7）。未取得有效证据 / 未覆盖：**0 字节帧与超限帧**、**AC5 的"两条路都不通"那一层**、**AC3 的 `scrollTop` 判据（本会话内容不足一屏，空转）**、**可信鼠标点击**（详见 §6.6）。
**历史汇总（T3 §五，v7 纯文本形态）**：7 PASS / 1 无法确认（AC5 失败分支当时构造不出来）；AC3 曾在 v1 判据下 FAIL，Lead 裁定改判据后复判 PASS。

**一句话**：8 条 AC 的**实现侧**都能在冻结版本里指出对应代码，但**实现侧的"就绪"不等于通过**——v7 的 AC3 被判据推翻过、v8 的 AC3 又被抓到 D7，都是运行级证据才暴露的；**现行判定一律以 §六 为准**。

---

## 二、验收环境与可复现方式

### 2.1 版本冻结

```bash
sha256sum client.js | cut -c1-16   # 2c603987bd84c1ef（v8 现行；v7 历史版是 7fb7b8ebadc473b0）
wc -l client.js                    # 2149（v7 是 1821）
git diff --numstat client.js       # 354  26  （v8 这一轮，相对已提交的 v7 版本）
```

### 2.2 静态自查命令与**实际输出**（T2 在 v7 冻结版本上跑过）

> 下面这段输出记录于 **v7 版 `7fb7b8ebadc473b0`**（`duration_ms` 每次不同，属正常）；**v8 终版 `2c603987bd84c1ef` 上 T3 复跑的结论同样是 `node --check` 通过、host `tests 50 / pass 50 / fail 0`、`.design/**` 零写入**（见 §6.3 AC8）。

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

$ grep -c "元素属性" client.js        # 2 —— 两处都在设计注释里（v7 版 1164、1390 行；v8 版是 1359、1585 行），文案字典与 JSX 已归零
$ grep -c "就这个元素写批注" client.js  # 0
$ grep -c "批注（" client.js            # 0
$ grep -c "actions.state" client.js     # 0 —— 没有任何地方依赖 InputActions.state（它不存在）
```

> **口径说明（Lead 定，T2 采纳）**：`元素属性` 仅在**注释**里留了两句设计理由——1164 行"这里**不再有**元素属性抽屉"、1390 行"元素属性表把人逼进 6 个输入框"。留注释是刻意的：下一个人问"为什么砍掉"时，答案就在原地。判定口径是"**界面代码里归零**"，不是"全文件 0 次命中"。

### 2.3 验收者可用的钩子与故障注入点（都在 `window.__dshDesignCanvas` 上）

| 钩子 | 用途 |
|---|---|
| `selectElement(frameId, info)` / `selectElement(sessionId, frameId, info)` | 不开沙箱帧也能构造"点选事件"，走的是与真实点击**同一个** `onSelectElement`。**两种形态都要验**：早期版本两参形式参数错位、还会返回 `true` 却什么都没插（D3 "假装成功"），现在按"第 3 个实参是否存在"判形态（`client.js:1972`） |
| `command(frameId, payload)` | 直接给帧内探针发指令（例如 `{cmd:'highlight', value:选择器}`） |
| `composerInserters` / `clearComposerInserters()` | 故障注入：清空"会话 → 输入框动作面"登记，复现 AC5 的失败分支 |
| `previewSessions()` | 哪些会话的预览面板已挂载（钩子就绪的标志）；早期版本恒为空（D2），已由 `PreviewTabBody` 转发 `onPreviewReady` 修好（`client.js:1663`、`client.js:1672`） |

**工具的已知限制**（沿用 [画布形态报告 §2.2](verification-feature-dsh-design-canvas.md)）：沙箱帧 `sandbox="allow-scripts"` 无 `allow-same-origin`，自动化里在帧内点击不稳；`selectElement` 钩子是替代路径，但**帧内真实点击仍是首选证据**，两条路都走一遍更可信。

### 2.4 认证与打开方式

GUI 未认证访问返回 401，需要登录 cookie（自签方式见 [画布形态报告 §2.1](verification-feature-dsh-design-canvas.md)，凭据不写入任何会被提交的文件）。打开路径：右侧栏「+」→ 点「设计预览」胶囊。

---

## 三、逐条验收（AC 原文 + 实现侧证据）

> 每条的"AC 原文"逐字抄自 SPEC（v6，胶囊形态），未改写。
> 本节所有 `client.js:NNN` 行号均按**现行版 2149 行**（`2c603987bd84c1ef`）校对；§五/§六 里出现的旧行号与旧函数名属于各自轮次的版本。
> 本节写的是**实现侧**证据（v8 胶囊实现）；判定以 §六 为准（§五 是 v7 纯文本形态的历史结论）。

### 3.1 AC1 点选即出胶囊

> AC1 点选即出胶囊：在预览 iframe 里点任一元素（沙箱 allow-scripts、无 allow-same-origin），500ms 内聊天输入框里出现一个引用胶囊（DOM 上位于 [data-lexical-decorator] 内，渲染为 @ 标记 + 标签文本），且输入框里不再出现整段纯文本引用、也不再出现元素属性面板。

**实现侧证据**

- 帧内点击 → 探针 `postMessage({type:'select', info})` → 父页面消息处理（`client.js:1192`）先做源校验 `event.source !== iframe.contentWindow` 即丢弃 → `onSelectElement`（`1604`）。
- 点选路径：`refPayload()`（`174`）→ `chipLabel()`（`230`）→ `captureInsertion()`（`1641`）→ `insertReferenceChip()`（`372`）→ `actx.bail(actx, 'slash/input-insert-reference', {reference, span})`（`390`）；成功后收拢光标（`392`）。
- **输入框里不再出现整段纯文本**：五行定位文本只在两处产出——`codec.serialize`（发送时给 agent）与纯文本降级路径；两者共用 `locatorText()`（`213`）。
- 属性面板仍不存在：`Inspector` 组件在 v7 整体删除（旧文件 1011–1125 行，115 行），`selected` 选中态一并删除；`grep "元素属性"` 的 2 处命中均为注释（`1359` / `1585`）。

**运行级证据**：见 §六（15~17ms 出胶囊；DOM = `[data-lexical-decorator]` 内 `span[data-composer-chip="design-element"]`；反向判据：输入框里没有五行纯文本）。

### 3.2 AC2 胶囊标签与模型文本

> AC2 胶囊标签与模型文本：胶囊标签 = <元素文字或标签名> · <屏名>（元素文字空白归一化、按上限截断；无文字元素回落到标签名），胶囊 title 等于该标签；发送时模型收到五行定位文本（【设计元素】屏名（frame: id）/ 元素 / 选择器 / 当前文字 / 文件），由已注册 source 的 codec.serialize 产出，且该 source 能被输入框的引用 roster 解析（不得出现 no serializer）。

**实现侧证据**

- 标签 `chipLabel()`（`230`）= `元素文字 · 屏名`：元素文字上限 `REF_LABEL_TEXT_MAX = 14`（`120`），屏名先按 ` · ` 取主标题、再截 `REF_LABEL_FRAME_MAX = 12`（`121`、`236`–`237`）；没文字的元素回落到标签名。`title` 挂的就是这个标签。
- 模型文本 `locatorText()`（`213`）输出恰好 5 行：
  `【设计元素】<屏名>（frame: <id>）` / `元素：<tag>` / `选择器：<path>` / `当前文字：<text>` / `文件：.design/frames/<id>.html`。
- 文字处理 `refText(raw, max)`（`104`）：`\s+` 归一化为单空格 + `trim()`，超过 `REF_TEXT_MAX = 40`（`101`）截断并补 `…`。
- 序列化由 source 的 `codec.serialize(ref)` 完成（`codec` 在 `client.js:2065`、`serialize` 在 `2070`）：`decodeRef()`（`192`）解出自包含数据 → `locatorText()`；解不出来时 reject 并给出可读原因。
- **roster 解析**：`inputTriggers.serializeReference(source, ref, signal)` 按 `name` 找 owner，所以 `name`（`REF_SOURCE = 'design-element'`，`116`）必须与胶囊节点上的 `source` 一致；验收钩子 `serializeRef()`（`2001`）走的就是这条 roster 路径（比直接调 codec 更能证明接线对）。
- **刻意不写**颜色 / 字号 / 内外边距——代码注释写明理由："用户要点评的是元素本身，把计算样式铺进去只会让引用变成一张属性表"。

**运行级证据**：见 §六（标签三态；`serializeRef()` 返回逐字五行、无 `no serializer`；长文本截断、无文字回落）。

### 3.3 AC3 不打断、可接着写

> AC3 不打断、可接着写：插入后聊天列 scrollTop 与插入前一致、视口不跳；用户既有草稿内容一字不丢，胶囊落在草稿末尾；插入后光标落在末尾（紧接着打字落在末尾）；一次撤销即可去掉整个胶囊（原子节点）。

**实现侧证据**

- 插入路径不调 `focus()`（`grep -c "\.focus("` = 0）、不做 DOM 注入、不碰滚动；`onSelectElement` 内不含任何写文件调用，点选不会触发预览重载或滚动复位。
- 胶囊由输入框自己的管线插入（`insertReferenceChip`，`372`），span 来自 `captureInsertion()`（`1641`）；`draftRev` 不符时会被拒绝而不是覆盖。
- **光标落点是被主动处理的，不是自然结果**：插入成功后调用 `collapseComposerCaretToEnd()`（`329`，纯 DOM `Range`，同步 + `rAF` + 60ms 各一次，**不调 `focus()`**）把光标收拢到草稿末尾（`392`）。
- **一次撤销的边界是显式开的（D7 修复）**：`insertReferenceChip` 在 `bail` 之前先在同一位置做一次零长度写入 `insertText('', span)`（`382`），再重新 `captureInsertion()` 拿新 span（`383`），把胶囊放进独立的历史边界——否则胶囊会和"用户刚敲的那段字"并进同一条撤销记录。边界没开成时**不阻断主流程**（`385`–`387`）。

> ✅ **v7 的判据裁定（历史，2026-10-09）：改判据，不改实现。** v1 判据里的"`document.activeElement` 仍是预览侧元素"是设计阶段自加的技术细节，不是用户要求；要做到"引用完接着打字落在末尾"必须把选区收拢到草稿末尾——给 contenteditable 设 DOM 选区会让输入框成为 activeElement，这是手段的代价（T3 实测 0/50/150/400/900ms 一致）。因此 AC3 改为现在这版判据，`activeElement` 不再计入验收；v1 判据下的 FAIL 与改判过程保留在 §5.3。

**运行级证据**：见 §六（不滚动/视口不跳、草稿不丢、光标落末尾、一次 `Ctrl+Z` 原子去掉胶囊）；D7 的原始复现见 §6.5、修复后的终版复跑见 §6.7。一个不算缺陷的粒度细节也记在 §6.7：终版上"胶囊 + 紧接着打的字"会并成一步撤销（`草稿 + 胶囊 + ZZ` 一次撤销后剩 `草稿`），AC3 只要求"一次撤销去掉整个胶囊"，不受影响。

### 3.4 AC4 可连续引用

> AC4 可连续引用：连点同一屏的两个元素 → 两个胶囊都在、顺序与点击顺序一致、第一个完整保留；先打字再连点两个元素的混合场景读起来通顺（不出现胶囊与文本粘连成不可读的样子）。

**实现侧证据**

- 每次点选独立走 `captureInsertion()`（`1641`）+ `insertReferenceChip`（`372`），互不覆盖；胶囊是编辑器的原子节点，顺序就是点击顺序。
- 先打字再点选：胶囊追加在草稿末尾，草稿原样留在前面（胶囊之间、胶囊与文本之间的间距由编辑器节点处理）。
- `composerDraftEmpty()`（`312`）与 `separator`（`426`）的分隔符规则**只服务纯文本降级路径**（草稿非空就前置一个换行）；不能拿 `captureInsertion()` 的返回值判空——输入框失焦时它给的是 `{start: 0, end: 0}`（"没有选区"的默认值），v7 上一版正是这样把两条引用粘在了一起（D5）。

**运行级证据**：见 §六（空草稿连点 = 2 个胶囊、顺序一致；先打字再连点的混合场景草稿在最前、无粘连）。

### 3.5 AC5 失败可见与降级

> AC5 失败可见与降级：胶囊路径不可用（source 注册失败 / 取不到 session 作用域 / bail 未应用）时自动降级为纯文本引用并在面板内明确提示「已降级为纯文本引用」；两条路都不通时给出可见原因与可复制的引用文本；任何一步都不得静默。

**实现侧证据**

- 门是 `chipSourceReady`（`248`）：只有 `inputTriggers.registerSource` 成功才为 true（`2084`–`2086` 一带）。
- 三级路径都在 `onSelectElement` 里（`1604` 起）：
  1. **胶囊**（`1643`）——`insertReferenceChip` 返回 `{ok:false}` 时记下 reason，继续降级；
  2. **纯文本降级**（`1668` 起）——走 `insertReferenceIntoComposer`（`422`），成功后提示 `refDegraded` + reason（`1670`，文案 =「引用胶囊不可用，已降级为纯文本引用：…」），状态条形态标 `text`；
  3. **可见失败**（`1676`）——两条都不通时报 `refFailed` + reason + 「把这行复制到对话输入框即可。」，状态条标 `failed` 并保留可复制的完整定位文本。
- 状态条会显示这次是「胶囊」还是「纯文本」（`1868`），用户看得见。
- 故障注入钩子：`setChipAvailable(false)`（`2016`）直接复现降级分支；`clearComposerInserters()` 复现"取不到动作面"。

**运行级证据**：见 §六——**第一层（胶囊不可用 → 降级纯文本）PASS 且双向可复现**（`setChipAvailable(false)` → 0 胶囊 + 纯文本五行 + 面板提示 + 状态条「（纯文本）」；恢复后回到胶囊）；**第二层（两条路都不通）仍未构造出来**（要往生产代码加桩），只到代码级证据。

### 3.6 AC6 边界不炸

> AC6 边界不炸：对空帧（0 字节）、超限帧、被切走的帧发点选事件，客户端不抛未捕获异常且不写入坏数据；info.text 为空串、info.path 为空串时仍能生成合法胶囊与合法序列化文本。

**实现侧证据**

- 找不到 frame 或 `info` 为空（`1607`）：`setLastRef(null)` 后直接 `return`，不插入、不报错。
- 空帧 / 超限帧在读取阶段就进入占位状态（`frameEmpty` / `frameTooLarge`），不会渲染出可点的内容。
- **"被切走的帧"的准确口径**（§5.7.3 校正）：切屏后旧屏的选择器在新帧里 `querySelector` 找不到元素 → 探针根本不发 `select`；父页面因此收不到事件，输入框一字未变、不报错。
- 消息源校验（`1192`）：不是当前 iframe 发来的消息直接丢弃，构造不出"幽灵点选"。
- 空值兜底：`locatorText()`（`213`）给出 `元素：(未知元素)`、`选择器：(没有拿到选择器)`、`当前文字：(这个元素没有文字)`；`chipLabel()`（`230`）对没文字的元素回落到标签名（`232`），空 tag 时标签是 `元素 · <屏名>`。

**运行级证据**：见 §六（无效选择器 / 切走的帧 / 不存在的 frameId / `info=null` 都不炸；空 path+tag+text 仍出合法胶囊与合法序列化文本）；**0 字节帧 / 超限帧未做运行级**（当前工程没有这两种帧，造帧会污染用户工作区）。

### 3.7 AC7 批注 UI 退场、数据不丢、@ 菜单不被污染

> AC7 批注 UI 退场、数据不丢、@ 菜单不被污染：工具栏不再有「批注（N）」入口、点元素不再出现「就这个元素写批注」；.design/design.json 里既有 comments[] 不被删除、design_status 仍能返回；键盘打 @ 打开菜单时不出现空分组，仍只列文件/会话。

**实现侧证据（界面退场 + 菜单不污染）**

- 工具栏「批注（N）」入口与 `Inspector`（含"就这个元素写批注"）已删除；`grep -c` 实测：`就这个元素写批注` = 0、`批注（` = 0、`Inspector` = 0。
- 批注角标随缩放同步的两个发送点已删。
- **一处刻意保留**：探针里给旧父页面用的批注角标代码没删（新父页面不再发 `setComments`）——它是**兼容死代码**，不代表"批注功能还在"。
- **`@` 菜单**：source 注册时 `candidates` 返回空数组、`showGroupTitle:false`（`2058`），我们不走菜单枚举；空分组在菜单里渲染为 null，所以打 `@` 看到的仍只有文件/会话。

**静态证据（数据仍在）**：T2 用 `design_status` 工具实测（2026-10-09），返回 `comments[]` **3 条**，其中 `comment-2` 带元素锚点选择器：

| id | frameId | target | 原文 | resolved |
|---|---|---|---|---|
| `comment-1` | `order-list` | （无，v5 前的旧格式） | 这个按钮太土了 | false |
| `comment-2` | `dashboard` | `body > div:nth-of-type(1) > header > div:nth-of-type(1) > button:nth-of-type(1)` | 这个按钮太土了（元素锚点测试） | false |
| `comment-3` | `mobile-home` | `body > div:nth-of-type(1) > main > article > h1` | 这个按钮太土了 | false |

- host 半（`index.js`、`src/host/**`）本次零改动，`design_canvas_apply` 的 `add_comment` / `resolve_comment` 仍在 op 词表里且未改实现。
- 画布不再调用这两个 op，已记入 `docs/architecture.md` 的"UI 不再调用的 op"清单。

**运行级证据**：见 §六（`@` 菜单 2 组、**空分组 0**、无本插件分组或条目；`design_status` 仍返回 3 条）。

### 3.8 AC8 无回归

> AC8 无回归：node --check client.js 通过；node --test src/host/*.test.js 全绿；切屏、落地到项目、探针 setText 通道、帧内高亮不被破坏；全程不写 .design/**。

**实现侧证据**

- `node --check client.js`：退出码 0，无输出。
- `node --test src/host/*.test.js`：tests 50 / suites 16 / pass 50 / fail 0（§2.2 原文输出）。
- 本次改动只在 `client.js` 内，未触碰 host 工具与写通道；`落地到项目` 的降级复制卡片路径（`handoffText`）与探针 `setText` 分支都还在原处（`client.js:609`、`client.js:1877` 起）；帧内 `{cmd:'highlight'}` 脉冲仍在点选路径里（`client.js:1628`）。

**运行级证据**：见 §六（切屏正常、探针 `setText` 可用、`.design/frames/*.html` 三个文件与基线逐字节相同——零写盘）。

---

## 四、本报告没有取得结论的部分（如实标注）

> **两轮独立复验都已填写**：**§六（现行）= AC1~AC8 全部 PASS**（终版 `2c603987bd84c1ef` / 2149 行，含 D7 修复后的全量回归）；**§五（历史）= v7 纯文本形态 7 PASS / 1 无法确认（AC5）**。本节保留"实现侧自查当时不下结论"的原始口径；凡本节列出的项，**结论一律以 §六 为准**。

1. **所有运行级数字与文本**：500ms 内到达、输入框里出现的是胶囊还是纯文本、`document.activeElement`、`scrollTop` 差值、插入后光标落点与接着敲字的实际位置、连续两条引用的实际内容、失败 / 降级提示的实际渲染、空帧 / 超限帧 / 切走帧的行为——**本报告一条都没有下结论**，全部由 §五 / §六 的独立复验给出。
   另外，头部列的 D1~D7 是**实现方自述 / 复验中抓到的缺陷**：D1/D2/D3 属于"面板能不能起来、钩子能不能用"的前提，D4/D5 关系 AC3/AC4，**D6（静默降级）与 D7（一次撤销连带吞掉刚打的草稿）在 v8 轮被发现并修复**；现场见 §6.5、D7 修复后的终版回归见 §6.7，T3 已逐项复核（§5.2、§6.2、§6.7）。
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

---

## 六、胶囊形态复验（v6 独立复验）

> 本节由 T3（teammate-verifier）独立填写，对应 SPEC v6 的 AC1~AC8（引用改为 @ 式胶囊）。§五 是 v7 纯文本形态的历史结论，**本节不覆盖 §五**。
>
> **两轮、两个 sha，别读串**：
> - **首轮**：`12dfaa9395401190`（2135 行）——AC1~AC8 全部实测，**抓出缺陷 D7**（撤销吞草稿）。冻结副本 `frozen-v6-client.js`（全值 `12dfaa9395401190c0ce61e981bcd909a46f594000493fed52be3aa52f606303`）。
> - **终版 / 现行**：**`2c603987bd84c1ef`（2149 行，`git diff --numstat` = +354 / −26）**——Lead 修 D7 后的版本；T3 已在**这一版重跑 AC1~AC8 全量回归**（见 6.7，全部通过）。冻结副本 `frozen-v6-final.js`（全值 `2c603987bd84c1efcb3170d4ed109b4d6f5f9204b30a5941217dc806e981b738`）。
> - **判定以终版为准**：6.2 判定表按终版；6.3/6.5 里的 D7 原始数据是首轮记录，保留作审计轨迹。
>
> 探针脚本：`rerun-H.js`（AC1/AC2）、`rerun-I.js`（AC3/AC4）、`rerun-J.js`（AC5/AC6/AC7）、`rerun-K.js`（D7 专测 + AC1/AC2/AC3 回归）。检查式在动手前写在 `ac-check-plan-v6.md`。
> 服务端 bundle rev：首轮 `46bcb1a8e434`、终版 `e5b3275590be`；每段脚本前后都校验 rev（`bundleStable`），跨版本混测的轮次一律作废重跑（D7 首测就因此作废过一次）。

### 6.1 红基线与本轮取证经过（如实记录）

- **本轮专用的运行级红基线没抓到**：2026-10-09 01:19:24 我加载页面时服务端下发的还是 v5 纯文本版（rev `9d8b25a375be`）；01:19:55 跑红基线探针的 30 秒内，bundle rev 连续变成 `0270e3a160b5` → `c455fa732e09`——**这个插件会 HMR 热替换进已打开的页面**（`window.__dshDesignCanvas` 的键从 7 个变 10 个，预览面板随即重挂载），第一次探针返回的是"输入框空、面板 `lastRef=null`"的无效数据（已丢弃，截图改名 `midflight-0120-empty-probe.png`，不作为证据）。
- **替代红基线（运行级，不是源码级）**：v5 复验轮在冻结版 `7fb7b8ebadc473b0` 上用**同形状探针**（点选 → 读 `[data-composer-input]`）记录过旧行为——5 行纯文本、`innerHTML` = `<p dir="auto"><span data-lexical-text="true">【设计元素】…</span></p>`、chip 计数 0、一次 `Ctrl+Z` 整条消失（证据：`raw-results.json` 的 AC1/AC3 段、`rerun-D.js`、`ac1-final-build.png`）。
- **"同一探针先红后绿"成立**：红 = v5 运行时（纯文本五行 / chip 0）；绿 = v6 运行时（chip 1 / 无整段纯文本，见 6.3）。
- **本轮版本稳定**：所有测量前后都校验了服务端 bundle（`rev=46bcb1a8e434`，1,294,744 字符，含 `inputTriggers`/`input-insert-reference`/`已降级为纯文本引用`），`bundleStable: true`，**没有跨版本混测**。

### 6.2 逐条判定

| AC | 判定 | 一句话证据 |
| --- | --- | --- |
| AC1 点选即出胶囊 | **PASS** | 点选后 **15~17ms** 出现胶囊（首轮 17ms、终版 15ms）：`[data-lexical-decorator]` 内 `span[data-composer-chip="design-element"]`，含 `@` 标记 + 标签 + `title`；**反向判据成立**——`innerText` 不匹配五行正则、`选择器：/当前文字：/文件：` 全部不出现；无属性面板 |
| AC2 标签与模型文本 | **PASS** | 标签 `导出 · 订阅订单列表`（`title` 一致）；长文本 → `启元云 订阅中台 总览 仪表… · 订阅订单列表`；无文字 → `button · 订阅订单列表`；`serializeRef()` 走 **roster 路径**返回完整五行文本、无 `no serializer` |
| AC3 不打断、可接着写 | **PASS（终版）** | 草稿一字不丢且在最前、胶囊落在草稿末尾、光标落末尾（敲 `ZZ` 落最后）、**一次 `Ctrl+Z` 原子去掉胶囊并保留草稿**（终版实测：`ABCD`→点选→一次撤销→`ABCD`；中文草稿同样原样恢复）；scrollTop 与视口不变、输入框高度 52px 不变。首轮曾抓到缺陷 D7（撤销连带吞草稿），Lead 修复后已复验通过——见 6.5 与 6.7 |
| AC4 可连续引用 | **PASS** | 连点两个元素 → 2 个胶囊、顺序与点击一致（`导出 · 订阅订单列表` → `新建订单 · 订阅订单列表`）、第一个完整保留；先打字再连点两个的混合场景里草稿在最前、两个胶囊依次在后、无粘连 |
| AC5 失败可见与降级 | **PASS（双向）** | `setChipAvailable(false)` → 0 胶囊 + 纯文本五行 + 面板可见「引用胶囊不可用，已降级为纯文本引用：引用胶囊不可用（source 未注册）」，状态条标「（纯文本）」；恢复后回到胶囊、不再降级 |
| AC6 边界不炸 | **PASS（两项未覆盖）** | 无效选择器 / 切走的帧 / 不存在的 frameId / `info=null` 都不炸、不插入坏数据；**空 path + 空 tag + 空 text 仍生成合法胶囊**（标签 `元素 · 订阅订单列表`）且序列化三处兜底齐（`(未知元素)` / `(没有拿到选择器)` / `(这个元素没有文字)`）；未捕获异常 0；0 字节 / 超限帧仍未覆盖（见 6.6） |
| AC7 批注退场 + 数据不丢 + @ 菜单不被污染 | **PASS** | 打 `@` → 菜单 2 组（`Files & folders` 13 条、`Sessions` 50 条）、**无空分组**、没有本插件产生的分组或条目；静态：`就这个元素写批注`=0、`批注（`=0、`Inspector`=0；`design_status` 仍返回 3 条 comments |
| AC8 无回归 | **PASS** | `node --check` 通过；host `tests 50 / pass 50 / fail 0`；切屏正常、探针通道正常；**全程 `.design/frames/*.html` 三个文件 sha256 与基线逐字节相同**（`design.json` 仅 `selection/updatedAt` 因我手动切屏变化） |

### 6.3 运行级原始证据

**AC1 / AC2（真实输入框 DOM，`[data-composer-input]`）**

点选「导出」按钮后，胶囊的原样 DOM：

```html
<span data-composer-chip="design-element" contenteditable="false" data-lexical-decorator="true">
  <span class="…reference …chip" title="导出 · 订阅订单列表">
    <span class="…marker" aria-hidden="true">@</span>
    <span class="…label">导出 · 订阅订单列表</span>
  </span>
</span>
```

- 反向判据：`innerText` 里没有 `【设计元素】…文件：.design/frames/…` 这段文本，也没有 `选择器：` / `当前文字：` 字段行 → **整段纯文本引用确已消失**。
- 一个取值假象先说明，免得后人误判：`innerText` 读到的是 `@\n导出 · 订阅订单列表\n `（换行来自 block 子元素）；实测几何是 `inline-flex` 一行——marker 与 label 的 `getBoundingClientRect().top` **相同**，胶囊 150×16px，输入框高度仍是 52px（不撑高、不推动布局）。
- `lastRef()`：`label = "导出 · 订阅订单列表"`、`ref = "@design/eyJmIjoib3JkZXItbGlzdCIsIm4iOiLo…"`（298 字符，base64url）。
- `serializeRef()`（= `inputTriggers.sessionOf(actx).serializeReference(REF_SOURCE, ref, signal)`，roster 路径）返回**逐字五行**：
  `【设计元素】订阅订单列表 · SaaS 后台（frame: order-list）` / `元素：button` / `选择器：body > div > div > main > div:nth-of-type(1) > div:nth-of-type(2) > button:nth-of-type(1)` / `当前文字：导出` / `文件：.design/frames/order-list.html`。
- 标签三态：正常 `导出 · 订阅订单列表`；长文本元素 `启元云 订阅中台 总览 仪表… · 订阅订单列表`（元素文字截断，屏名取 ` · ` 前的主标题）；无文字元素 `button · 订阅订单列表`（回落标签名）。三者 `title` 均等于标签。
- 面板同步：`最近引用：导出 · 订阅订单列表（胶囊）` + 提示条「已作为引用胶囊插入对话输入框，接着打一句要改什么就行（发送前还能改）。」

**AC3（有草稿；真实中文草稿 `把导出按钮改成描边样式`）**

| 子判据 | 实测 |
| --- | --- |
| 草稿一字不丢、胶囊在草稿末尾 | ✅ `把导出按钮改成描边样式` + 胶囊，草稿是前缀 |
| 光标落末尾 | ✅ 插入后敲 `ZZ` → `…胶囊 ZZ`（`landedAtEnd: true`、`landedAtStart: false`） |
| 一次撤销去掉整个胶囊 | ✅ 空草稿场景：胶囊 → 一次 `Ctrl+Z` → 空（`decorators 1→0`，原子去掉） |
| 不滚动 / 视口不跳 | ✅ `window.scrollY`、`doc.scrollTop`、`[data-conversation-scroll].scrollTop`、面板几何、输入框高度（52px）全部不变 |
| `scrollTop` 判据的局限 | ⚠️ 本会话 `scrollHeight === clientHeight === 680`，该条仍是空转（沿用 §5.6.4 的口径） |

**AC4（两种场景）**

- 空草稿连点两次：`decorators: 2`，标签依次 `导出 · 订阅订单列表`、`新建订单 · 订阅订单列表`，与点击顺序一致，两个胶囊之间有空隙、无粘连。
- 有草稿连点两次：`把导出按钮改成描边样式` + 胶囊 + 胶囊，草稿仍在最前（`draftStillFirst: true`）。

**AC5（降级双向）**

- `setChipAvailable(false)` → 点选：`decorators: 0`、出现五行纯文本、面板出现 `引用胶囊不可用，已降级为纯文本引用：引用胶囊不可用（source 未注册）`，状态条 `最近引用：导出 · 订阅订单列表（纯文本）`。
- `setChipAvailable(true)` → 点选：回到胶囊、无降级提示、无纯文本。

**AC6（边界）**

- 无效选择器：输入框一字未变、胶囊 0；切到第 2 屏后用第 1 屏选择器点选：一字未变；`selectElement('no-such-frame', {…})` / `selectElement('order-list', null)`：不插入、不报错。
- 空 path/tag/text：胶囊照出（标签 `元素 · 订阅订单列表`），`serializeRef` 返回三处兜底文案的合法五行文本。
- 未捕获异常（`error` + `unhandledrejection`）：`[]`。

**AC7（@ 菜单结构与截图）**

- 菜单：`div[role="listbox"][aria-label="Trigger suggestions"]`，共 63 个 `role="option"`。
- 顺序扫描（标题与选项是**兄弟节点**，不是嵌套分组）→ 2 组：`Files & folders`（13 条）、`Sessions`（50 条），**空分组 0**；没有 `设计/design/element` 字样的分组，也没有本插件产生的条目。
- 自我纠错记录：我第一版探针按"分组容器"找 `class*=group/section`，把 `sectionTitle` 标题本身当成了空分组容器，误报 `emptyGroupCount: 2`；换成"顺序扫描标题与选项"后为空。**结论以校正后的探针为准。**
- 截图：`.playwright-mcp/ac-evidence/v6-element-ref/ac7-at-menu.png`。

**AC8（静态与写盘）**

- `node --check client.js` 通过；`node --test src/host/*.test.js` → `tests 50 / suites 16 / pass 50 / fail 0`；`src/host`、`index.js` 零改动。
- 静态：`就这个元素写批注`=0、`批注（`=0、`Inspector`=0、`元素属性`=2（均代码注释）；`candidates` 返回空数组 + `showGroupTitle:false`（源码 2045 行附近）。
- 写盘：`.design/frames/dashboard.html` `ec5c7d9d…`、`mobile-home.html` `75e37aba…`、`order-list.html` `d7aad170…` 与 v6 基线**逐字节相同**；`design.json` 仅 `selection/updatedAt`（`2026-10-08T17:23:52.755Z`，我切屏所致）变化，`frames[]`/`comments[]` 不变。

### 6.4 对抗式三问（v6 版）

1. **「胶囊只是预览面板里显示的假象」——证伪成功。**
   ① 证据取自 `[data-composer-input]` 内的真实节点 `span[data-composer-chip="design-element"][data-lexical-decorator="true"]`（不是面板 DOM）；② 一次 `Ctrl+Z` 能把胶囊原子去掉（进了编辑器撤销栈）；③ 插胶囊后整页 reload，胶囊仍在（ref 自包含 + 草稿持久化）；④ 面板状态条只是账本，与输入框内胶囊是两处独立证据，标签一致。
2. **「发送时模型拿到的是标签而不是定位文本」——证伪成功。**
   `serializeRef()` 走**输入框自己的 roster 路径**（`sessionOf(actx).serializeReference(source, ref, signal)`）取回的是**五行定位文本**，不是 `导出 · 订阅订单列表`；且没有 reject `no serializer`——证明 roster 按 name 找到了 source（而不只是 codec 本身对）。`ref` 是 `@design/<base64url(JSON)>`，自包含 frameId/选择器等。**注意证据强度的边界**：这条证明的是"输入框能把这个 ref 序列化成五行文本"，不是"某次真实发送后模型收到了什么"——后者需要真发一条消息，我没有替用户发送。
3. **「@ 菜单被我们的 source 弄出空分组」——证伪成功。**
   打 `@` 后菜单只有 `Files & folders` 与 `Sessions` 两组、各有 13/50 条，空分组 0，没有本插件的分组或条目（截图 + 顺序扫描断言，见 6.3）。

### 6.5 复验中抓到的缺陷

| 编号 | 现象 | 复现与证据 | 状态 |
| --- | --- | --- | --- |
| **D7** | **紧跟打字之后点元素，按一次 `Ctrl+Z` 会把刚打的草稿一起吃掉，且找不回来** | （首轮 `12dfaa9395401190` 复现）干净历史（reload）→ 打 `ABCD` → 点元素 → 输入框 `ABCD`+胶囊 → `Ctrl+Z` 一次 → **空**（胶囊与 `ABCD` 同时消失），再撤销仍为空；同类：`草稿找回测试` → `草稿找`、`草稿甲乙` → `草`。**对照实验**：只打字不点元素，`ABCD` → `Ctrl+Z` → 空（Lexical 正常的整段输入撤销）；打字后**等 2.5 秒**再点元素 → `Ctrl+Z` → **`ABCD`**（胶囊去掉、草稿保留，正确）。刷新页面后仍是残缺状态，**丢失的字不可恢复**。根因：胶囊插入未带独立 history tag，被并进"刚敲的那段字"的同一条 Lexical 撤销记录 | **已修（`2c603987bd84c1ef`）并复验通过**：Lead 在 `insertReferenceChip` 里先做一次零长度 `insertText('', span)` 开独立历史边界，再 `captureInsertion()` 取新 span 插胶囊；终版实测 `ABCD` → 点选 → 一次 `Ctrl+Z` → **`ABCD`**（胶囊掉、草稿留），中文草稿同样原样恢复，不再依赖 2.5 秒间隔，无多余空行/空格，一次撤销即掉胶囊（数字见 6.7） |
| D6（Lead 自报，T3 已核实机制） | `inputTriggers` 若用 `ctx.inputTriggers` 属性访问取不到，被 try/catch 吞成 null → **静默走降级**（不报错、不崩，只是功能没了） | 我 01:20 在 `05aee51690836a9b` 那次点选看到"纯文本、chip 0"就是这条；当前版用 `optionalService(ctx,'inputTriggers')`（内部 `ctx.get`）后正常 | 已修（`12dfaa9395401190` 上胶囊正常） |

> D7 的判定口径说明：SPEC v6 的 AC3 原文只写了「一次撤销即可去掉整个胶囊（原子节点）」——**按字面这条是过的**（胶囊确实被原子去掉）；但 AC3 标题是"不打断"，且 v5 的 AC 原文曾要求"一次撤销即可恢复到插入前的草稿"（v5 实测成立），**v6 这条不成立**。T3 不替 Lead 判 fail，按"字面 PASS + 缺陷上报"处理。

### 6.6 未取得结论 / 未覆盖（v6）

1. **不得作为结论的能力**：AC5 的"两条路都不通"（source 不可用 **且** 纯文本路也不可用）仍**无法确认**——我只构造出了"胶囊路不可用 → 降级纯文本"这一层；要构造第二层需要往生产代码加桩。只有代码级证据（error 提示 + 可复制引用文本）。
2. **0 字节帧 / 超限帧**：运行级仍未覆盖（工程里没有这两种帧，造帧会污染用户工作区）；仅静态核对，与 §5.6.2 同口径。
3. **可信鼠标点击**：仍未确认。这个 38% 缩放帧上 `locator.click()` 报 `Element is outside of the viewport`；本轮点选走的是探针 `selectPath` 通道（父页面 → 探针 → `postMessage` → 生产 `onSelectElement`），另可用帧内 `element.click()`。两者都进生产代码，但不是"可信鼠标事件"。
4. **"真实发送后模型收到什么"**：见 6.4 第 2 条的边界，未替用户发送消息。
5. **AC3 的 `scrollTop` 判据**：本会话会话内容不足一屏，该条仍是空转（与 §5.6.4 同）。

### 6.7 D7 修复后的终版复跑（`2c603987bd84c1ef`，2149 行）

**为什么全量重跑而不是只跑 D7**：D7 的修法动的是插入路径本身（`insertReferenceChip` 里先做一次零长度 `insertText('', span)` 开历史边界，再 `captureInsertion()` 取新 span 插胶囊），所以 AC1~AC8 都算受影响面。

**版本与稳定性**：服务端 bundle rev = `e5b3275590be`（1,295,399 字符，含 D7 修复标记），`rerun-K/I/J` 三段脚本的前后 `bundleStable` 均为 `true`。此前有一次复跑因为中途 rev 从 `46bcb1a8e434` 变成 `e5b3275590be` 被整体作废重来——**跨版本的数据一律不进报告**。

| AC | 终版判定 | 终版实测数字 |
| --- | --- | --- |
| AC1 | PASS | 出胶囊 **15ms**；`decorators: 1`；标签 `@ 导出 · 订阅订单列表`、`title = 导出 · 订阅订单列表`；`innerText` 无五行文本；DOM 结构同 6.3 |
| AC2 | PASS | `serializeRef()` 返回 **5 行**、逐字与 6.3 相同；`lastRef().ref` 前缀 `@design/eyJmIjoib3JkZXIt`；无 `no serializer` |
| AC3 | PASS | 草稿在胶囊之前且逐字保留；敲 `ZZ` 落末尾；**一次 `Ctrl+Z` → 胶囊消失、草稿原样**（`把导出按钮改成描边样式` / `ABCD` / `草稿找回测试` 三例）；`window.scrollY`、`doc.scrollTop`、会话 `scrollTop` 全 0；输入框 rect `[296,361,381,52]` 与面板 rect `[704,0,576,720]` 不变 |
| AC4 | PASS | 空草稿连点 → 2 个胶囊、标签顺序 `@ 导出 · 订阅订单列表` → `@ 新建订单 · 订阅订单列表`；有草稿连点 → 草稿仍在最前、2 个胶囊 |
| AC5 | PASS | 注入后 `decorators: 0` + 五行纯文本 + 面板「引用胶囊不可用，已降级为纯文本引用：引用胶囊不可用（source 未注册）」，状态条「（纯文本）」；恢复后 `decorators: 1`、无降级提示 |
| AC6 | PASS | 无效选择器/切走的帧/不存在的 frameId/`info=null` 均不炸不插入；未捕获异常 `[]` |
| AC7 | PASS | 顺序扫描（校正后的探针）：`Files & folders` 13 条、`Sessions` 50 条、**空分组 0**、无本插件分组；截图 `ac7-at-menu-final.png` |
| AC8 | PASS | `node --check` 通过；host `tests 50 / pass 50 / fail 0`；`git diff --numstat client.js` = **354 / 26**；`.design/frames/*.html` 三个 sha256 与基线逐字节相同 |

**D7 修复的专项验收（干净历史，每例前置 reload）**

| 场景 | 修前（`12dfaa9395401190`） | 修后（`2c603987bd84c1ef`） |
| --- | --- | --- |
| `ABCD` → 点选 → 一次 `Ctrl+Z` | 空（胶囊+草稿全没） | **`ABCD`**，`decorators: 0` ✅ |
| `草稿找回测试` → 点选 → 一次 `Ctrl+Z` | `草稿找` | **`草稿找回测试`**，`decorators: 0` ✅ |
| 打字后等 2.5 秒再点选 | `ABCD`（正确） | `ABCD`（仍正确，**不再依赖时间间隔**） |

副作用复核（对应 Lead 自测的三条）：**无多余空行/空格**（撤销后文本 `trim()` 与原文逐字相同；胶囊后的那一个空格是胶囊自身的尾随空格规则，DOM 仍是单段落）、**输入框高度仍 52px**、**一次 `Ctrl+Z` 即掉胶囊**（不是两次）。

一个如实记录的撤销粒度细节（**不是缺陷**）：终版上"胶囊 + 紧接着打的字"会并成一步撤销——例如 `草稿 + 胶囊 + 敲 ZZ`，一次 `Ctrl+Z` 后剩 `草稿`（胶囊和 ZZ 一起回退）。这是用户自己的最近输入与胶囊同一步回退，AC3 只要求"一次撤销去掉整个胶囊"，故不影响判定；写在这里免得后人当成新问题。

**未覆盖项无变化**：0 字节帧 / 超限帧、AC5 的"两条路都不通"、AC3 的 `scrollTop` 空转、可信鼠标点击（见 6.6）。

### 6.8 证据索引（`.playwright-mcp/ac-evidence/v6-element-ref/`）

| 文件 | 内容 |
| --- | --- |
| `ac-check-plan-v6.md` | 复验前写下的 v6 检查式（含红基线口径与对抗式三问） |
| `frozen-v6-client.js` / `.sha256` | 首轮被验版本 `12dfaa9395401190` 的冻结副本 |
| `frozen-v6-final.js` | **终版**被验版本 `2c603987bd84c1ef` 的冻结副本 |
| `rerun-H.js` / `rerun-I.js` / `rerun-J.js` | AC1~AC7 的复跑脚本（含 bundle rev 稳定性校验） |
| `rerun-K.js` | D7 专测 + AC1/AC2/AC3 终版回归 |
| `ac1-chip.png` / `ac1-chip-zoom.png` | 胶囊在输入框里的截图与几何实测 |
| `ac7-at-menu.png` / `ac7-at-menu-final.png` | `@` 菜单截图（首轮 / 终版，均无空分组） |
| `midflight-0120-empty-probe.png` | 红基线抓取失败那一刻的现场（已改名，避免误当证据） |
| `static-v6.txt` / `static-v6-final.txt` / `hashes-v6-before.txt` | 静态核对（首轮/终版）、写盘基线 |
| `raw-results-v6.json` / `raw-results-v6-final.json` | v6 首轮与终版的原始数据汇总 |
| `raw-results.json` | §五（v5）的原始数据 |
