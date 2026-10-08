# dsh-design-canvas

> 在 DSH 里聊天时，右侧栏开一个设计预览：agent 把界面画成真实 HTML，你边聊边看、点元素就地改、点元素写批注，满意了让它落成前端代码。

## 为什么要做这个

现在直接让 agent 写前端页面，出来的东西常常很丑、没设计感。根因不是模型不会写 CSS，而是这条链路里少了"设计"这一步：

- 没有设计契约（token、字号阶梯、间距节奏），每页各写各的；
- 没有参考物，模型只能自由发挥，自由发挥必然平庸；
- 没有自检，它画完就交；
- 没有便宜的迭代手段——"再往左一点、间距大一点"要用文字来回聊二十轮。

所以这个插件的做法是：**把"先设计 UI、再写前端"这条流程搬回 AI 研发链路里**。用户跟 DSH 说话，agent 出设计稿；用户可以直接点着元素改、可以留批注，也可以继续聊天改；设计定稿后再落成项目代码。

Anthropic 的 [Claude Design](https://support.claude.com/en/articles/14604416-get-started-with-claude-design) 已经验证了这个形态（对话 + 设计画布 + 设计系统 + handoff 给编码 agent）。本项目的差异点是：**它是 DSH 的原生插件，不是另一个 app**——不用切窗口，设计、对话、代码在同一个上下文里；而且带着一套**中文优先的设计契约层**（预设 token + 反 AI 味清单 + 出稿自检）。

## 三条不可动摇的取舍

1. **真源是文件，不是 UI 状态。** `.design/` 下的 `design.json` + `frames/*.html` + `tokens.css` 就是设计本身：可进 git、可 diff、可 review、可被 agent 用普通 read/write/edit 直接改。UI 只是渲染与编辑入口。
2. **每一屏是真实网页，不是矢量图形。** 每屏一个自包含 HTML，在沙箱 iframe 里渲染。agent 本来就擅长写 HTML/CSS，导出代码几乎无损。
3. **只做单向 设计 → 代码。** 不做"代码改动反推回设计"的双向同步——公开证据显示这是当前无人真正解决的问题。

> 早期版本做过"真无限画布"（平移缩放、多屏并排、拖动改位置），实测后**已砍掉**：用户看完的判断是"整个画布都多余，我只要聊天 + 一个预览框"。原因与取舍记录在 [docs/architecture.md](docs/architecture.md)。

## 现在能做什么

- **对话生成**：说一句"设计一个 SaaS 后台的订单列表页"，agent 出 1~3 屏真实页面。
- **右侧栏预览**：设计稿作为右侧栏的一个标签，**跟着当前工作区走**（切换工作区，内容随之切换），边聊边看不用切窗口；需要更大视野就用右侧栏自带的 **Fullscreen** 控件（实测 553px → 1257px，缩放随之变大）。
- **切屏**：多屏时用顶部控件切换，刷新浏览器后仍停在你刚才那一屏。
- **就地改元素**：在预览里点选元素，直接改文字/颜色/字号/内外边距，写回 HTML 文件。
- **元素锚点批注**：点着某个按钮写"这个太土了"，agent 通过 `design_status` 读到原文与所属屏；锚点失效时不丢批注，会标成"未锚定"。
- **实时同步**：agent 改文件后预览自动刷新，且不打断你的滚动位置与选中态。
- **落地到项目**：把当前屏交给 agent，按项目技术栈生成组件写进 `src/`。

**不做**：无限画布与空间编排、图层面板、矢量钢笔、布尔运算、自动布局算法、多人实时协同、组件变体、Figma 导入、反向同步。

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
| [specs/](specs/) | 执行契约（12 条验收标准）与查看器 |
| [docs/architecture.md](docs/architecture.md) | 架构、扩展点、安全模型、安装与生效方式 |
| [docs/evidence/](docs/evidence/) | 验收证据截图 |

## 自检

```bash
node --test src/host/*.test.js                    # host 层单测
node design-system/tools/check-design-system.mjs  # 设计契约自检（12 项）
node scripts/post-restart-check.mjs               # 重启后：路由/工具/数据层三项体检
```

## 状态

形态已定稿为「聊天 + 右侧栏预览面板」（SPEC v6）。逐条验收结果见
[docs/verification-feature-dsh-design-canvas.md](docs/verification-feature-dsh-design-canvas.md)，
执行契约见 [specs/feature-dsh-design-canvas.yaml](specs/feature-dsh-design-canvas.yaml)。

## 致谢与来源

设计约定里的"反 AI 味清单"、五维自检、"一次给 2~3 个方向让用户挑"这些做法，来自公开的设计方法论项目（[alchaincyf/huashu-design](https://github.com/alchaincyf/huashu-design) 等）与 [nexu-io/open-design](https://github.com/nexu-io/open-design) 的实践。本仓库不复制其代码，只借鉴方法。

预览面板为自研，**未使用 tldraw**（其 SDK 非开源许可，生产环境需付费且免费档强制水印）。
