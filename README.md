# dsh-design-canvas

> 在 DSH 里，一边聊天一边在无限画布上设计 UI；满意了再让 agent 落成前端代码。

## 为什么要做这个

现在直接让 agent 写前端页面，出来的东西常常很丑、没设计感。根因不是模型不会写 CSS，而是这条链路里少了"设计"这一步：

- 没有设计契约（token、字号阶梯、间距节奏），每页各写各的；
- 没有参考物，模型只能自由发挥，自由发挥必然平庸；
- 没有自检，它画完就交；
- 没有便宜的迭代手段——"再往左一点、间距大一点"要用文字来回聊二十轮。

所以这个插件的做法是：**把"先设计 UI、再写前端"这条流程搬回 AI 研发链路里**。用户跟 DSH 说话，agent 在画布上出设计；用户可以直接拖、直接改、直接在画布上留批注，也可以继续聊天改；设计定稿后再由 agent 落成项目代码。

Anthropic 的 [Claude Design](https://support.claude.com/en/articles/14604416-get-started-with-claude-design) 已经验证了这个形态（对话 + 画布 + 设计系统 + handoff 给编码 agent）。本项目的差异点很明确：**它是 DSH 的原生插件，不是另一个 app**——不用切窗口，设计、对话、代码都在同一个上下文里；而且它有一块现有开源方案都没有的**真·无限画布**（多屏并排、可拖拽缩放、可在画布上就地改）。

## 三条不可动摇的取舍

1. **真源是文件，不是画布 JSON。** `.design/` 下的 `design.json` + `frames/*.html` + `tokens.css` 就是设计本身：可进 git、可 diff、可 review、可被 agent 用普通 read/write/edit 直接改。画布只是空间容器和编辑入口。
2. **画布上的元素是真实网页，不是矢量图形。** 每屏一个自包含 HTML，在沙箱 iframe 里渲染。agent 本来就擅长写 HTML/CSS，导出代码几乎无损，也不用自研矢量编辑器。
3. **只做单向 设计 → 代码。** 不做"代码改动反推回设计"的双向同步——公开证据显示这是当前无人真正解决的问题。

## 现在能做什么

- **对话生成**：说一句"设计一个 SaaS 后台的订单列表页"，agent 在画布上出 1~3 屏真实页面。
- **无限画布**：平移、缩放（锚定光标）、适应全部、多屏并排。
- **就地修改**：在 frame 里点选元素，直接改文字/颜色/字号/内外边距，写回 HTML 文件。
- **批注**：在画布上留意见，agent 通过 `design_status` 读到原文与所属 frame，改完可标记已处理。
- **实时同步**：agent 改文件后画布自动刷新，且不打断你当前的缩放与位置。
- **同屏聊天**：点「同屏聊天」把画布停靠到右侧栏（track 模式，聊天列自动变窄），边聊边看。
- **落地到项目**：把选中的屏交给 agent，按项目技术栈生成组件写进 `src/`。

**不做**：图层面板、矢量钢笔、布尔运算、自动布局算法、多人实时协同、组件变体、Figma 导入、反向同步。这些每一样都能吃掉整个项目。

## 安装

本插件以本地目录 link 方式装进 DSH 的 profile：

```
plugin_manager  action: install_bundle  target: <本仓库绝对路径>
```

装完**需要重启一次 `dsh web`**：DSH 在启动时加载插件模块，替换已安装的包必须重启才能加载新的代码代（禁用/启用、卸载重装都不行，Node ESM 会缓存模块）。

## 数据格式

```
<workspace>/.design/
├── design.json     # viewport / selection / tokens 镜像 / frames[] / comments[]
├── tokens.css      # 选中的设计预设（逐字拷贝，不改变量名）
└── frames/*.html   # 每屏一个自包含 HTML（样式内联、零外链）
```

## 目录

| 路径 | 作用 |
|---|---|
| [index.js](index.js) | Host 半入口：注册工具、systemPrompt 约定、画布写通道 |
| [client.js](client.js) | Client 半（单文件、无构建）：无限画布本体 |
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

P0 窄闭环（对话 → 画布出屏 → 就地和聊天改 → 落代码）已实现。逐条验收结果见
[docs/verification-feature-dsh-design-canvas.md](docs/verification-feature-dsh-design-canvas.md)，
执行契约见 [specs/feature-dsh-design-canvas.yaml](specs/feature-dsh-design-canvas.yaml)。

## 致谢与来源

设计约定里的"反 AI 味清单"、五维自检、"一次给 2~3 个方向让用户挑"这些做法，来自公开的设计方法论项目（[alchaincyf/huashu-design](https://github.com/alchaincyf/huashu-design) 等）与 [nexu-io/open-design](https://github.com/nexu-io/open-design) 的实践。本仓库不复制其代码，只借鉴方法。

画布为自研，**未使用 tldraw**（其 SDK 非开源许可，生产环境需付费且免费档强制水印）。
