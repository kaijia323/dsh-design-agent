# dsh-design-canvas

> 在 DSH 里聊天时，右侧栏开一个设计预览：agent 把界面画成真实 HTML，你边聊边看，点一个元素就把它作为一个 @ 式引用胶囊放进聊天输入框，接着打一句话说要改什么，满意了再让它落成前端代码。

## 为什么要做这个

现在直接让 agent 写前端页面，出来的东西常常很丑、没设计感。根因不是模型不会写 CSS，而是这条链路里少了"设计"这一步：

- 没有设计契约（token、字号阶梯、间距节奏），每页各写各的；
- 没有参考物，模型只能自由发挥，自由发挥必然平庸；
- 没有自检，它画完就交；
- 没有便宜的迭代手段——"再往左一点、间距大一点"要用文字来回聊二十轮。

所以这个插件的做法是：**把"先设计 UI、再写前端"这条流程搬回 AI 研发链路里**。用户跟 DSH 说话，agent 出设计稿；看稿时点中哪个元素，那个元素就变成一个 @ 式引用胶囊落进聊天输入框，用户补一句"太土了，换成主色描边按钮"，agent 就照着改；设计定稿后再落成项目代码。

Anthropic 的 [Claude Design](https://support.claude.com/en/articles/14604416-get-started-with-claude-design) 已经验证了这个形态（对话 + 设计画布 + 设计系统 + handoff 给编码 agent）。本项目的差异点是：**它是 DSH 的原生插件，不是另一个 app**——不用切窗口，设计、对话、代码在同一个上下文里；而且带着一套**中文优先的设计契约层**（预设 token + 反 AI 味清单 + 出稿自检）。

## 三条不可动摇的取舍

1. **真源是文件，不是 UI 状态。** `.design/` 下的 `design.json` + `frames/*.html` + `tokens.css` 就是设计本身：可进 git、可 diff、可 review、可被 agent 用普通 read/write/edit 直接改。UI 只是渲染与编辑入口。
2. **每一屏是真实网页，不是矢量图形。** 每屏一个自包含 HTML，在沙箱 iframe 里渲染。agent 本来就擅长写 HTML/CSS，导出代码几乎无损。
3. **只做单向 设计 → 代码。** 不做"代码改动反推回设计"的双向同步——公开证据显示这是当前无人真正解决的问题。

> 早期版本做过"真无限画布"（平移缩放、多屏并排、拖动改位置），实测后**已砍掉**：用户看完的判断是"整个画布都多余，我只要聊天 + 一个预览框"。原因与取舍记录在 [docs/architecture.md](docs/architecture.md)。

> 之后又砍掉了点元素弹出来的「元素属性」面板和画布上的批注入口。用户原话：
> 「点击设计元素的时候，不要弹出这个（元素属性面板），应该直接在 dsh 的会话聊天中引用这个点击的元素才对，然后用户自然就会输入要怎么调整，这样的话标注就不需要了，因为用户会直接引用元素直接和 dsh 聊天框聊天」
> 留下的是聊天这条路：**点元素 = 往输入框里放一个 @ 式引用胶囊，改法用自然语言说**。原因与取舍同样记录在 [docs/architecture.md](docs/architecture.md)。

> 引用形态后来又改过一轮。用户原话：
> 「点击元素的时候，不要在 DSH 的聊天框输入文字，而是应该像那个艾特符号或者调用指令的那种一样」
> 于是引用不再是一段五行纯文本，而是和 `@文件`、`@会话` 同源的**胶囊节点**：**输入框里看到的变短了（一个胶囊），发送给 agent 的没变（还是那五行定位信息）**——胶囊在发送那一刻由它自己的 codec 展开。技术细节与踩过的坑见 [docs/architecture.md](docs/architecture.md) 的「v8」。

## 现在能做什么

- **对话生成**：说一句"设计一个 SaaS 后台的订单列表页"，agent 出 1~3 屏真实页面。
- **右侧栏预览**：设计稿作为右侧栏的一个标签，**跟着当前工作区走**（切换工作区，内容随之切换），边聊边看不用切窗口；需要更大视野就用右侧栏自带的 **Fullscreen** 控件（实测 553px → 1257px，缩放随之变大）。
- **切屏**：多屏时用顶部控件切换，刷新浏览器后仍停在你刚才那一屏。
- **点元素 = 放一个 @ 式引用胶囊**：在预览里点一个元素，聊天输入框草稿末尾出现一个引用胶囊，标签是「元素文字 · 屏名」（元素没有文字就用标签名，如「button · 订阅订单列表」）。你接着说一句要怎么改、再发送就行。**发送那一刻，胶囊展开成给 agent 的五行定位信息**（哪一屏、什么标签、CSS 选择器、当前文字、在哪个文件）——用户看到的变短了，agent 看到的没变。插入不会动聊天列的滚动位置，草稿一字不丢；光标落在末尾，接着打字就是往胶囊后面写。
- **引用看得见、失败不静默**：预览底部有一条「最近引用」状态条，显示刚引用了哪个屏的哪个元素（并标出这次是「胶囊」还是「纯文本」），可一键复制发送时的那段定位信息；胶囊路径不可用时会**自动降级为纯文本引用并明确说明原因**，两条路都不通时给出可见失败与可复制文本。
- **帧内点选反馈**：点中元素时，被点的那个元素会在帧里脉冲高亮一下，让你确认引用的就是它（纯视觉，不写文件）。
- **实时同步**：agent 改文件后预览自动刷新，不会把你切到别的屏上去。
- **落地到项目**：把当前屏交给 agent，按项目技术栈生成组件写进 `src/`。

**不做**：无限画布与空间编排、图层面板、矢量钢笔、布尔运算、自动布局算法、多人实时协同、组件变体、Figma 导入、反向同步；**元素属性面板与画布内的批注编辑器也不再做了**——点选只把元素引用进对话（批注的数据结构、工具与已有数据保留，只是不再有写批注的界面）。

## 安装

```bash
# 以本地目录 link 方式装进 DSH 的 profile
plugin_manager  action: install_bundle  target: <本仓库绝对路径>
```

装完**需要重启一次 `dsh web`**：DSH 用 `await import()` 加载 host 模块且无 cache-bust，替换已安装的包必须重启才能拿到新的代码代（禁用/启用、卸载重装都无效）。客户端改动刷新页面即可。

装完后打开方式：右侧栏的添加控件（侧栏空着时本身就是它）→ 点「设计预览」胶囊。

## 数据格式

```
<workspace>/.design/
├── design.json     # selection / tokens 镜像 / frames[] / comments[]
├── tokens.css      # 选中的设计预设（逐字拷贝，不改变量名）
└── frames/*.html   # 每屏一个自包含 HTML（样式内联、零外链）
```

## 目录

| 路径 | 作用 |
|---|---|
| [index.js](index.js) | Host 半入口：注册工具、systemPrompt 约定、写通道 |
| [client.js](client.js) | Client 半（单文件、无构建）：右侧栏预览面板 |
| [src/host/](src/host/) | 设计工程读写、agent 工具、HTTP 写通道 |
| [design-system/](design-system/) | 3 套中文设计预设 + 3 个起步模板 + 自检脚本 |
| [prompts/](prompts/) | 注入 systemPrompt 的设计约定与落地流程 |
| [specs/](specs/) | 执行契约（画布 12 条 + 元素引用 8 条）与查看器 |
| [docs/architecture.md](docs/architecture.md) | 架构、扩展点、安全模型、安装与生效方式 |
| [docs/evidence/](docs/evidence/) | 验收证据截图 |

## 自检

```bash
node --test src/host/*.test.js                    # host 层单测
node design-system/tools/check-design-system.mjs  # 设计契约自检（12 项）
node scripts/post-restart-check.mjs               # 重启后：路由/工具/数据层三项体检
```

## 状态

形态已定稿为「聊天 + 右侧栏预览面板」（**形态 v6**）；元素交互在 v7 改成「点元素引用进对话」，属性面板与批注入口退场。
> 口径说明：「形态 v6 / v7」指产品形态的第几轮定稿，与各 SPEC 文件内部的 `version` 字段不是一回事（`feature-dsh-design-canvas.yaml` 现为 version 12，`feature-element-reference-to-composer.yaml` 现为 version 5）。

- 画布形态：[执行契约 specs/feature-dsh-design-canvas.yaml](specs/feature-dsh-design-canvas.yaml) · [验收报告 docs/verification-feature-dsh-design-canvas.md](docs/verification-feature-dsh-design-canvas.md)
- 元素引用：[执行契约 specs/feature-element-reference-to-composer.yaml](specs/feature-element-reference-to-composer.yaml) · [验收报告 docs/verification-element-reference-to-composer.md](docs/verification-element-reference-to-composer.md)

## 致谢与来源

设计约定里的"反 AI 味清单"、五维自检、"一次给 2~3 个方向让用户挑"这些做法，来自公开的设计方法论项目（[alchaincyf/huashu-design](https://github.com/alchaincyf/huashu-design) 等）与 [nexu-io/open-design](https://github.com/nexu-io/open-design) 的实践。本仓库不复制其代码，只借鉴方法。

预览面板为自研，**未使用 tldraw**（其 SDK 非开源许可，生产环境需付费且免费档强制水印）。
