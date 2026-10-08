# 设计预览（模板渲染证据）

这三张图是 `design-system/templates/` 里三个起步模板的真实渲染截图，用来证明"渲染出来能看"这件事，
也是"不是 AI 默认丑样式"的对照物。图都是 1:1 视口截图，没有任何后期处理。

> **这些图不入库**（体积大且可重新生成，理由见 `docs/evidence/README.md`）。
> 下表里的文件名是**本地文件名**——克隆仓库后并不存在，按本节末尾的命令重新生成即可。
> 目录里另有两张验收期顺带生成的图（`order-list-frame.png`、`inventory-list-frame.png`），同样不入库。

| 截图（本地文件） | 模板 | 预设 | 视口 | 看什么 |
|---|---|---|---|---|
| `order-list.png` | `design-system/templates/order-list.html` | neutral-modern（浅色） | 1440×900 | 后台页的信息层级：一屏一个主操作、指标条 → 筛选 → 表格 → 分页的节奏；状态标签用色克制；金额等宽右对齐 |
| `dashboard.png` | `design-system/templates/dashboard.html` | tech-dark（深色） | 1440×900 | 深色不等于纯黑：近黑蓝底 + 分层表面；青色主色只用在数据与主操作上；等宽数字承担读数 |
| `mobile-home.png` | `design-system/templates/mobile-home.html` | editorial-warm（浅色） | 390×844 | 中文长文排版：纸感底色、报头与发丝线、编号列表、正文行高 1.75；移动端不是把桌面页压扁 |

> 字体说明：三套预设都是**中文优先的本地字体栈**，零外链。`editorial-warm` 的标题栈首选 `Songti SC / 思源宋体 / Noto Serif SC`；
> 生成这三张图的 Linux 机器上只装了 `Noto Sans CJK SC`，所以截图里的中文标题落在无衬线兜底（在 macOS / Windows 上会显示为宋体）。
> 这是字体可用性问题，不是字体栈写错：自检脚本会核对 `tokens/index.json` 与 CSS 里的字体栈一致。

## 怎么重新生成这三张图

模板是自包含 HTML，直接渲染即可。Playwright MCP 默认禁止 `file:` 协议，所以用一次性的静态服务器：

```bash
# 1) 起一个临时静态服务（用完记得关）
cd /home/dsh/codes/dsh-design-agent
python3 -m http.server 7391 --bind 127.0.0.1

# 2) 浏览器里打开（逐个改视口尺寸，按上表的 width×height）
#    http://127.0.0.1:7391/design-system/templates/order-list.html
#    http://127.0.0.1:7391/design-system/templates/dashboard.html
#    http://127.0.0.1:7391/design-system/templates/mobile-home.html
#    然后按视口截图，覆盖本目录同名 png
```

截完把服务器关掉（`kill <pid>`）。注意控制台里出现 `favicon.ico 404` 是临时服务器没有图标，不是模板的问题——模板本身零外链、零脚本，不会发任何请求。

## 交付前必跑

```bash
node design-system/tools/check-design-system.mjs   # 12 项检查，退出码 0 才算过
```

其中第 9 项专门核对"模板内联的 `:root` 与它声明的预设逐个变量一致"，第 10/11/12 项核对零外链、零自创颜色、字号与间距只用 token。
