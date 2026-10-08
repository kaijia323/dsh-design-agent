# 落地到项目（design → code 出口）

<!-- 维护者：T4。这份文档定义「落地到项目」的完整链路与指令文本，T2（host 命令）、T3（画布按钮）按它实现，agent 按它执行。 -->

## 0. 一句话

画布上选中的那一屏，是**真实 HTML**，所以"落地"不需要转换格式：agent 读那一屏的 HTML 与 token，按项目现有技术栈重写成组件文件，写进 `src/`，返回路径。

## 1. 主方案（P0 采用）：session command 通道

一个操作、两个调用方——UI 按钮和 agent 走同一个 Host 方法（cordis-plugin-development 的 `references/user-actions.md` 里的标准做法）。

```
用户在画布上选中一屏 → 点「落地到项目」
   │
   ├─ T3（客户端）ctx.remote.commands.execute("design-handoff", { frameId, targetDir? })
   │
   ├─ T2（host）注册 session command `design-handoff`：
   │     1) 校验 frameId 存在（读 .design/design.json），不存在则返回可读错误
   │     2) 组装下面的「注入指令」（把 frameId / 文件路径 / 名称填进去）
   │     3) 把这段指令作为一条用户消息投递给当前会话
   │     4) 返回 { ok: true, command: "design-handoff", frameId }
   │
   └─ agent 收到指令 → 按下文第 3 节执行 → 写 src/ → 回报路径
```

要点：
- 命令**只投递指令，不自己写代码**；写代码是 agent 的活，这样用户能在对话里看到全过程并追加要求（"用 Tailwind"、"拆成两个组件"）。
- 命令注册的落点在 host 侧；客户端的 `/` 输入框里也能看到同名命令（用户手动敲 `/design-handoff order-list` 是等价入口）。
- 命名两头一致：命令名固定 `design-handoff`，参数 `{ frameId: string, targetDir?: string }`。

### 用户手动输入的形式

```
/design-handoff <frameId> [目标目录]
```
`frameId` 省略时用画布当前选中项；目标目录省略时按第 3.2 节推断。

## 2. 降级方案（Plan B，仅在命令通道不可用时）

若 T3 实测发现客户端无法把消息投进当前会话（命令通道不可用 / Remote 不可达），退化成：

1. 画布弹出「落地到项目」卡片，里面是第 3 节那段完整指令文本，带**一键复制**按钮；
2. 同时把同一段文本写进 `<workspace>/.design/handoff.md`（覆盖式），并在 `design.json` 的 frame 上留一个 `status: "handoff-requested"` 标记；
3. 用户把文本粘进对话框即完成闭环，效果与主方案一致，只多一次粘贴。

**降级一旦被触发，必须记进 SPEC 的 `follow_ups`，不要静默降级。**

## 3. 注入给 agent 的指令模板（固定文本）

> 下面的 `{frame}` / `{file}` / `{target}` 由 host 命令处理器填好后投递。方括号里是提示，不要原样投递。

```
【落地到项目】把画布上选中的这一屏转成项目代码，并写进仓库。

目标 frame：{frame}（id: {frameId}，文件：{file}）
目标目录：{target}［未指定则按第 4 步推断］

按顺序做，不要跳步：
1. 调用 design_status，确认该 frame 仍然存在，并读走它名下所有未处理的批注——批注里的修改意见必须体现在生成代码里。
2. read 上面那个文件全文，再 read .design/tokens.css（这两个文件只读，不要修改）。
3. 探测项目技术栈：先读 package.json 的 dependencies/devDependencies，再看 src/ 的现有目录与一个已有组件的写法，**跟随现有约定**（文件后缀、CSS 方案、命名风格、导入别名）。
   没有任何可识别技术栈时，默认 React + TypeScript 函数组件 + 同目录 CSS Module。
4. 生成一个组件文件：
   - 默认路径 src/pages/<kebab-case 名称>/index.tsx；项目已有 pages/components 结构时按现有结构放；{target} 指定了目录就用它。
   - 视觉一比一还原这一屏：层级、间距节奏、字号阶梯、圆角、阴影都与 frame 一致；颜色一律取自 tokens（转成项目里的 token 形式：CSS 变量、Tailwind theme 或主题对象都行），**不要硬编码新颜色**。
   - 示例数据写成命名清晰的常量，不要 Lorem，不要编造客户名与用户评价。
   - 不要引用 .design/ 下的任何文件，生成文件里不允许出现指向 .design/ 的相对路径。
   - 语义标签齐全，可点击元素用 button/a，表单元素带 label。
5. read 回生成的文件复核一遍，然后回报：
   - 写入的文件路径（仓库相对路径）
   - 从 frame 到组件的一处取舍或简化（如果有）
   - 没有一比一还原的地方与原因（如果有）

不要问用户要技术栈偏好再动手：先按第 3 步探测结果做，做完说明你按什么做的，用户不满意再改。
```

## 4. 技术栈与目标目录推断规则

| 项目特征 | 生成形态 | 默认路径 |
|---|---|---|
| `package.json` 有 `react` + `typescript` | `.tsx` 函数组件 + CSS Module | `src/pages/<kebab>/index.tsx` |
| `package.json` 有 `next` | `.tsx`，`"use client"` 只在需要交互时加 | `app/<kebab>/page.tsx` |
| `package.json` 有 `vue` | SFC `.vue`，`<script setup lang="ts">` | `src/views/<Kebab>.vue` |
| 只有 HTML/CSS 项目 | 独立 `.html` + 同目录 `.css` | `<kebab>.html` |
| 识别不出 | React + TS 函数组件 + CSS Module | `src/pages/<kebab>/index.tsx` |

- 组件名：frame 的 `name` 转 PascalCase（"后台订单列表" → `OrderList`；纯中文名取语义英文名，并在回复里说明取名依据）。
- 有 `targetDir` 时优先用它，其它规则照旧。
- 目标目录不存在就读 `src/` 现状后创建；写之前先用 `read`/`glob` 确认不会覆盖同名文件（要覆盖必须在回复里明确说出来）。

## 5. 验收对照（AC9）

| AC9 要求 | 本链路怎么满足 |
|---|---|
| 对选中的 frame 触发「落地到项目」 | 画布按钮 → `design-handoff` 命令，frameId 来自选中态 |
| agent 把该屏转成项目技术栈的组件文件写入 `src/` | 第 3 节指令 + 第 4 节推断规则 |
| 返回写入路径 | 第 5 步要求回报仓库相对路径 |
| 生成文件不含指向 `.design/` 的相对路径引用 | 第 4 步写死为禁止项，复核时可 `grep -n "\.design/" <生成文件>` |

## 6. 责任边界

| 谁 | 做什么 |
|---|---|
| T2（host） | 注册 `design-handoff` session command；校验 frame 存在；投递第 3 节指令；错误可读 |
| T3（客户端） | 画布「落地到项目」按钮；调用命令通道；失败时展示 Plan B 复制卡片 |
| T4（本文档） | 指令模板、技术栈推断规则、降级方案与 follow_ups 口径 |
| agent（systemPrompt） | 按 `prompts/design-conventions.md` 第 8 节与本文档执行 |

## 7. follow_ups 口径

- 主方案跑通：`follow_ups` 不加条目。
- 走降级方案：追加一条 —— `画布「落地到项目」暂用复制指令卡片（命令通道不可用：<具体报错>），P1 换成 session command 直投`。
- 生成结果需要手工调整：不算失败，在回复里说明取舍即可；连续两次同类取舍（例如同一个项目总是识别不出技术栈）才记 follow_up。
