# 订单列表 frame 独立验收报告

## 被验版本（先看这里）

| 项 | 值 |
| --- | --- |
| 被验文件 | `.design/frames/order-list.html` |
| **文件 sha256** | `e4aa25b5c9574dd41323ff9f55d194941817606bbe9bcf22aef18999aecdeec4` |
| **字节数** | **36765**（591 行，UTF-8） |
| **mtime** | 2026-10-08 23:23:26 +0800 |
| 区域指纹 | `:root` 块 sha256[:16] = `729026296439cf04`（1809 B）；`<style>` sha256[:16] = `2bb38f9549b4f8e8`（16542 B）；`<body>` sha256[:16] = `5b5d7eae640c1c7b`（19757 B）；`<tbody>` sha256[:16] = `1eb80b1568313523`（8566 B） |
| 截图 sha256 | `ed0479da1d52c18120d3ca3e8a13300949caabe8ae64625674e79296b4ef4288`（`order-list-verify.png`，1440×900，205768 B） |

> 本报告所有数字均在该 sha256 对应的版本上实跑取得。若 `sha256sum .design/frames/order-list.html` 与上表不一致，本报告作废、需重验。
> 上一轮我验的是 **36241 字节**的旧版（本报告已整体重出，不再引用旧版数字）。

- **验收人**：design-verifier（独立取证，未采信 Lead 的结论）
- **验收时间**：2026-10-08 23:20–23:26（Asia/Shanghai），本轮重验 23:23–23:26
- **本轮需求**：订阅制 SaaS 后台订单列表页；只出 1 屏 1440×900；预设 neutral-modern（浅色）；不做详情页 / 空状态
- **本次变更**：订单号列下新增订单类型标记 —— 新购 4 行、续费 · 自动扣款 3 行（SUB-261007-0364 / SUB-261007-0351 / SUB-261006-0333）
- **总评**：**通过，可交付**

### 与上一轮结论的差异说明

**结论不变（通过，可交付）。** 版本确实变了，但变化只落在 `<tbody>` 的订单号单元格标记上：
- 静态侧：文件仍 591 行，颜色类声明仍是 105 条，`<style>`/`:root` 块未变，新增内容全部是标记 HTML；
- 渲染侧：行高仍 7×60px、仍无溢出、仍在 900px 内；
- **有实质变化的一条是 AC9「续费行 ≥ 1」**：上一轮我逐行读过旧版（36241 B）的 7 行，tbody 里没有「续费」字样，按 AC9 脚本口径续费行会是 **0**；本轮实测为 **3**，**该口径缺口已由本次改动补上**。

---

## 0. 取证环境与实跑命令（本轮）

| 步骤 | 实跑命令 | 结果 |
| --- | --- | --- |
| 起临时静态服务 | `cd /home/dsh/codes/dsh-design-agent && python3 -m http.server 7393 --bind 127.0.0.1`（后台 job `bash-44`） | 运行中 |
| 服务确实吐的是新版 | `curl -s -o /dev/null -w 'http=%{http_code} bytes=%{size_download}' http://127.0.0.1:7393/.design/frames/order-list.html` | `http=200 bytes=36765`（= 磁盘 sha256 对应字节数） |
| 渲染 | Playwright MCP：`browser_tabs action=new` → `browser_navigate` → `browser_resize 1440×900` → 再 `browser_navigate` 刷一次 → `browser_take_screenshot`（覆盖同名文件） | 见 §1 |
| 静态核对 | `python3 docs/evidence/order-list-static-check.py` | `SUMMARY fails=0` |
| AC9 复核 | 用 SPEC 原文脚本（`specs/feature-order-list-page.yaml` L277–299 逐字复制）跑一遍 | 见 §2.7 |
| 关服务 | `job_kill bash-44` + `curl -m 2` / `ss -ltnp` 复核 | 见 §5 末尾 |

浏览器：Playwright MCP（Chromium），视口 1440×900，DPR 1。

---

## 1. 渲染取证（Playwright，实跑）

**通过。** 截图（已覆盖为本轮新版）：[`.playwright-mcp/ac-evidence/order-list-verify.png`](../.playwright-mcp/ac-evidence/order-list-verify.png)（1440×900，205768 B）。
25% 缩略图：[`order-list-verify-25pct.png`](../.playwright-mcp/ac-evidence/order-list-verify-25pct.png)；2× 裁切：[`crop-order-col.png`](../.playwright-mcp/ac-evidence/crop-order-col.png)（新增的订单号列）、[`crop-head.png`](../.playwright-mcp/ac-evidence/crop-head.png)、[`crop-row1.png`](../.playwright-mcp/ac-evidence/crop-row1.png)、[`crop-footer.png`](../.playwright-mcp/ac-evidence/crop-footer.png)、[`crop-sidebar.png`](../.playwright-mcp/ac-evidence/crop-sidebar.png)、[`crop-bulk-header.png`](../.playwright-mcp/ac-evidence/crop-bulk-header.png)。

### 1.1 控制台

`browser_console_messages(all=true)` 输出：

```
Total messages: 0 (Errors: 0, Warnings: 0)
... [ERROR] Failed to load resource: the server responded with a status of 404 (File not found)
    @ http://127.0.0.1:7393/favicon.ico:0
```

判定：**通过**——唯一报错是临时 `python3 -m http.server` 没有 favicon，不是 frame 的缺陷（frame 内零外链，见 §2.1）。

### 1.2 实测数字（`browser_evaluate`，新版）

| 指标 | 实测值 | 判定 |
| --- | --- | --- |
| 视口 | 1440 × 900，DPR 1 | 通过 |
| `documentElement.scrollWidth` / `scrollHeight` | **1440 / 900**（`overflowX=false`、`overflowY=false`）；`body.scrollHeight`=900 | **≤1440 / ≤900，无横向溢出、无纵向滚动** |
| 越出右边界（right > 1441）的元素 | 0 个 | 通过 |
| `tbody tr` 行数 | 7 | 通过 |
| **每行高度** | **`60,60,60,60,60,60,60`（全部 60px）** | **改成两行后行高仍整齐** |
| **订单号列溢出（新增项）** | 7 行逐行实测 `td.scrollWidth = 144 / clientWidth = 144`，**`scrollWidth > clientWidth` 全为 false** | **无溢出** |
| 订单号列第 2 行是否折行 | 用 `Range.getClientRects().length` 逐行量：**7 行 `subLines = 1`**（单行），`subH = 16.8px`，`.cell-stack` 高 33.6px（= 16.8 + 16.8 两行） | 未折行，未挤压 |
| 全表文本溢出 | 扫 `td, th` → `[]`；扫 `.cell-stack/.cell-main/.cell-sub/.order-no/.pill/.amount` → 0 处 | 通过 |
| 底部边界 | 末行 bottom = 785.69；`.table-foot` bottom = 841.69；`.table-card` bottom = 842.69；`.content` bottom = 874.69（视口 900） | **未被裁切**，余 25.3px |
| 新标记计数 | 页面可见文本：**新购 = 4**、**续费 · 自动扣款 = 3** | 与需求描述一致 |
| 金额列 | 7 个单元格右边界仍全为 **975px**；`text-align: right` + `font-variant-numeric: tabular-nums` | 通过 |
| `h1` / 主操作 | `h1` 仅 1 个 =「订单」；`.btn-primary` 仅 1 个 =「新建订单」 | 通过 |
| 短视口鲁棒性（额外项，1440×700，上一轮已测） | `docScrollH=875 > 700` 可滚动，末行仍 60px | 不写死 height 截断 |

**结论：订单号列从一行变两行后，行高未变（仍 60px）、未折行、未溢出、1440×900 内不裁切。**

---

## 2. 静态契约核对（自写脚本实跑，当前版本）

脚本：[`docs/evidence/order-list-static-check.py`](order-list-static-check.py)（只读；`:root` 用括号配对抽取后逐变量 diff）。
实跑输出：**`SUMMARY fails=0`**（33 条检查全 PASS）。

### 2.1 零外链 / 零脚本

| 检查项 | 结果 |
| --- | --- |
| 非 `#` 的 `src`/`href` | `[]`（只有 `href="#"` 导航锚点与 `<use href="#i-...">` 片段引用） |
| `<link>/<script>/<img>/<iframe>/<object>/<embed>/<video>/<audio>/<picture>/<source>` | `[]` 全零 |
| `url(` / `@import` | 0 处 / 0 处 |
| `http(s)://` | 仅 `xmlns="http://www.w3.org/2000/svg"`（命名空间声明，非外链） |

**通过。**

### 2.2 `:root` 与预设逐变量比对

对比对象：`design-system/tokens/neutral-modern.css`（与 `.design/tokens.css` 逐字相同，已单独 read 核对）。

| 检查项 | 结果 |
| --- | --- |
| 变量数量 | 预设 56 个 / frame 内联 56 个 |
| 变量名集合 | 缺=`[]` 多=`[]` |
| 逐条取值 | **全部逐字相同**（diff 为空）；`:root` 块 sha256[:16] = `729026296439cf04` |

**通过。**

### 2.3 `:root` 之外的色值

| 检查项 | 结果 |
| --- | --- |
| `#hex` | 0 处 |
| `rgb()` / `rgba()` | 0 处 |
| `color-mix()` | 8 处，全部形如 `color-mix(in srgb, var(--color-*) N%, transparent)` |
| 颜色类声明总数 | 105 条，除下列重置值外全部引用 `var(--color-*)` / `var(--shadow-*)` |
| 非 var 的重置型关键字 | `color: inherit`（button/input 重置）、`background: none` ×2、`fill: none`、`stroke: currentColor`、`color: transparent`（`.cb` 未选中时藏对勾）、`background: currentColor`（pill 圆点） |
| 渲染期实测 | `backgroundImage` 集合 = `[]`（零渐变）；可见元素中 `rgb(0,0,0)` = 0 个；全屏 `box-shadow` 只有 1 种 `rgba(16,20,30,0.06) 0 1px 2px` = `--shadow-sm` |

**通过（附观察 a）。**

### 2.4 token 化程度

| 检查项 | 结果 |
| --- | --- |
| `font-size` | 全部 `var(--text-*)`，0 例字面量 |
| `padding/margin/gap/*-gap/*-top…` | 全部 `var(--space-*)` 或 `0`/`auto`，0 例字面量 |
| `line-height` | 全部 `var(--leading-*)`，0 例字面量 |
| 渲染期背景色集合 | 全部为 token 色或其 `color-mix` 派生，无集合外色值 |

**通过。**

### 2.5 表格与数据自洽

| 检查项 | 结果 |
| --- | --- |
| `.num` 规则 | `text-align: right` + `font-variant-numeric: tabular-nums` 同一条规则内；7 个金额单元格右边界全 = 975px |
| 状态计数自洽 | 待支付 12 + 生效中 1,042 + 退款中 9 + 已关闭 223 = **1,286** = 「全部」1,286 ✅ |
| 「已选 N 笔 · 合计 X」 | 已选 **2** 笔 · ¥**7,730.00** = 勾选行 ¥6,480.00 + ¥1,250.00 ✅ |
| 表尾与分页 | 「共 1,286 条 · 每页 20 条」；分页 1/2/3/…/**65**，65 = ⌈1286/20⌉ ✅ |
| 金额明细 | ¥6,480.00 / ¥1,250.00 / ¥16,200.00 / ¥9,600.00 / ¥447.00 / ¥2,925.00 / ¥1,500.00（7 行非空） |

**通过。**

### 2.6 交互与可访问语义（当前版本重测）

| 检查项 | 结果 |
| --- | --- |
| 可点击元素标签 | `<div/span/td/li/p/section/h*>` 零 `onclick`、零 `role="button"`、零 `tabindex`；全部 38 个 `<button>` + 9 个 `<a>`（实测 `button=38 a=9`） |
| 无标签可点击元素 | 0 个 |
| 输入框 | 1 个 `<input type="search" aria-label="搜索订单">`，被 `<label class="search">` 包裹 |
| 图标 | 25 个 `<symbol>` ↔ 25 个 `<use>`，无断裂；装饰性 `<svg>` 23 处 `aria-hidden="true"` |
| 状态不只靠颜色 | 7 个状态 pill 全部「圆点 + 中文文字」；部分选中复选框 `aria-label="已选中部分行"`；当前页与当前导航项 `aria-current="page"` |
| id 唯一 | 是 |

**通过（附观察 b、c）。**

### 2.7 AC9 复核（SPEC 原文脚本逐字执行）

脚本来自 `specs/feature-order-list-page.yaml` L277–299（原文复制，未改逻辑），实跑输出：

```
表头 ['', '订单号', '客户', '订阅内容', '金额', '支付方式', '下单时间', '状态', '操作']
缺必需列 []
行数 7
状态 ['生效中', '生效中', '待支付', '退款中', '生效中', '已关闭', '生效中']
订阅内容 ['团队版 · 年付  12 个席位 · 到期 2027-10-08', '专业版 · 月付  5 个席位 · 到期 2026-11-08',
         '团队版 · 年付  30 个席位 · 14 天内可支付', '专业版 · 年付  8 个席位 · 退款审核中',
         '基础版 · 月付  3 个席位 · 到期 2026-11-07', '团队版 · 月付  15 个席位 · 逾期未支付',
         '专业版 · 月付  6 个席位 · 到期 2026-11-05']
状态缺筛选项 []
续费行 3 退款行 1 实物电商字样 []
```

对照 SPEC 的期望值：

| AC9 期望 | 实测 | 判定 |
| --- | --- | --- |
| 缺必需列为空（8 个中文列名、顺序一致） | `[]`（第 1 列是允许的空文案 `col-check` 复选框列） | 通过 |
| 行数 ≥ 7 | 7 | 通过 |
| 订阅内容无空值 | 7/7 非空，形如「团队版 · 年付 / 12 个席位 · 到期 2027-10-08」 | 通过 |
| 状态缺筛选项为空 | `[]`（生效中/待支付/退款中/已关闭 在筛选栏都有同名项） | 通过 |
| **续费行 ≥ 1** | **3**（SUB-261007-0364 / SUB-261007-0351 / SUB-261006-0333，标记「续费 · 自动扣款」） | **通过（本轮改动补上的口径缺口）** |
| 退款行 ≥ 1 | 1（「退款中」） | 通过 |
| 实物电商字样 0 命中 | `[]` | 通过 |

**AC9 通过。**

---

## 3. 人工判断（对照 `prompts/design-conventions.md` 第 4/6 节）

| # | 条目 | 判定 | 证据（当前版本实测） |
| --- | --- | --- | --- |
| 6.1 | 一屏一个主标题、一个主操作 | **通过** | DOM 中 `h1` 仅 1 个 =「订单」（28px/600/letter-spacing −0.56px ≈ −0.02em）；`.btn-primary` 仅 1 个 =「新建订单」；次操作「导出」为 ghost 按钮 |
| 6.1 | 缩到 25% 层级仍成立 | **通过** | 本轮新版截图重新缩到 360×225（[`order-list-verify-25pct.png`](../.playwright-mcp/ac-evidence/order-list-verify-25pct.png)）：侧栏 / 顶栏 / 标题行+蓝色主按钮 / 筛选条 / 工具栏 / 表格 / 表尾分页 七段仍可分辨，全屏唯一饱和蓝块仍是主按钮与当前页；新增的订单类型标记只增加了一行 12px 灰字，未产生新的视觉重心 |
| 6.2 | 留白：块间距 > 块内间距 | **通过** | 块间：page-head→筛选 24px、筛选→工具栏 16px、工具栏→表格卡 16px、内容区 padding 32px；块内：nav gap 4px、tab gap 8px、tab padding 12px、按钮内 gap 8px → 块间(16–32) 全部大于块内(4–12) |
| 6.3 | 同类元素一致 | **通过** | 表头统一 12px/500/+0.04em/muted；状态 pill 统一 24px 高 + 圆点 + 12px；按钮统一 `--control-h`(36px)/`btn-sm`(32px) + `--radius-sm`；新增的订单类型标记复用了与客户邮箱、订阅内容同一套 `.cell-sub`（12px/400/muted），**不是新造样式**；金额统一右对齐 + tabular-nums |
| 6.4 | 对比度 ≥ 4.5:1（正文） | **通过（附观察 d）** | 本轮重测：低于 4.5:1 的共 **12** 处，**全部**是 `--color-text-faint rgb(125,133,143)`（最低 3.27:1，出现在 `.tab-num` 计数与 `.quota-foot` 脚注）；正文/表头/状态文字/pill 文字最低 **5.19:1**；新增的「新购 / 续费 · 自动扣款」用 `.cell-sub` = `--color-text-muted`，实测 **6.06:1**（白底），**未用 faint 承载信息** |
| 6.5 | 中文排版 | **通过** | 标题 28px/**600**/**−0.02em** 对 小标签 12px/**500**/**+0.06em**（.nav-group 实测 ls=0.72px）；正文基准 14px / 行高 1.65（实测 lh=23.1px）；机械扫描「中英粘连」0 处、「中文句内半角标点」0 处；新增文案「续费 · 自动扣款」用中文间隔号并两侧留空格，与既有「团队版 · 年付」写法一致 |
| 6.6 | 克制：无第 4 节反例 | **通过** | ①无泛紫/蓝紫，`backgroundImage` 实测 `[]` → 零渐变；②零 emoji（按 U+1F300–1FAFF、U+2600–27BF、U+2190–21FF、U+2B00–2BFF 等区间全字符扫描 = 0），图标为 25 个统一 1.6 描边内联 SVG；③无卡片左侧 4px 色条；④无四件套卡片堆叠；⑤无圆角套娃与阴影叠加（圆角嵌套扫描只命中 `.tabs > .tab` 分段控件、`.quota > .quota-bar` 进度条轨道、`.user-btn > .avatar` 头像；全屏只有 1 种阴影）；⑥无居中 hero；⑦无大面积纯黑/纯白：底色 `--color-bg #f6f7f9`，可见元素纯黑 0 个 |
| 3.x | 一屏只有一个主色在说话 | **通过** | 背景色直方图仍以 白 / `#f6f7f9` / `#f3f5fc`(primary 12% 派生) / `#eef0f4` / `#e9edfb` 为主；饱和主色 `#2b4fd4` 只在主按钮、当前导航项、当前页码、选中复选框、进度条、激活 tab 计数等焦点位；新增标记为灰色文字，未引入新色 |
| 6.7 | 可改：改 token 即生效 | **通过** | 0 处写死色值、0 处写死字号/间距；frame 内联 `:root` 与预设逐字一致 |

### 本轮范围核对

- 只出 1 屏：`design_status` → `order-list` 1440×900、status=ready；本轮无新增第二屏。**通过。**
- 不做详情页 / 空状态：本屏无这两类区块。**通过。**
- 未处理批注：`design_status(includeResolved=true)` → `comments: []`。**通过。**
- 预设：`<html data-preset="neutral-modern">`，与 `design-system/tokens/neutral-modern.css` 一致。**通过。**

---

## 4. 非阻塞观察（当前版本逐条复核，仍然成立）

**(a) `.cb { color: transparent }`** —— `:root` 之外唯一的「具名颜色关键字」，用途是未选中时隐藏对勾。不是设计色值，不判违规。
复现：`grep -n 'transparent' .design/frames/order-list.html` → 命中 `.cb` 规则。
期望：保持现状即可；更严格可改 `color: var(--color-surface)`。

**(b) 复选框是 `<span class="cb" role="img" aria-label="…">`，共 8 个**（表头 1 个部分选中 + 表体 7 个），**不可点击、不可键盘操作**。它压根不可点击，所以不违反「可点击元素必须是 button/a」，作为静态设计稿成立。
复现：`browser_evaluate → [...document.querySelectorAll('.cb')].map(e => e.tagName + '/' + e.getAttribute('role'))` → `SPAN/img` × 8。
期望：**落地成组件时必须换成 `<input type="checkbox">`**（表头带 `indeterminate`），否则表格选择功能不可用。

**(c) 侧栏额度条 `.quota-bar` 没有 `role="progressbar"`**，但数值以文字「8,214 / 10,000」+ 脚注给出，信息不靠颜色单独承载。
复现：`document.querySelectorAll('[role="progressbar"], progress').length` → `0`。
期望：可选优化，加 `role="progressbar"` + `aria-valuenow/valuemin/valuemax`。

**(d) 对比度最弱处 3.27:1**（`--color-text-faint #7d858f` 落在 `.tabs` 灰底上，例如「待支付 12」里的 12；共 12 处，全部是 faint 次要标注）。
最小复现（页面控制台）：
```js
getComputedStyle(document.querySelector('.tab-num')).color          // rgb(125, 133, 143)
getComputedStyle(document.querySelector('.tabs')).backgroundColor    // rgb(238, 240, 244)
// 对比度 = 3.27:1
```
期望：按约定「`--color-text-faint` 只用于次要标注」，可接受；若希望状态计数更清晰，把 `.tab-num` 换成 `--color-text-muted`（实测 5.31:1）即可。

---

## 5. 汇总

| 分区 | 检查条数 | 通过 | 不通过 | 未取证 |
| --- | --- | --- | --- | --- |
| 一、渲染取证（含新增的订单号列溢出/行高实测） | 10 | 10 | 0 | 0 |
| 二、静态契约（含 AC9 SPEC 原文脚本 7 项） | 40 | 40 | 0 | 0 |
| 三、人工判断（约定 6.1–6.7 + 范围核对） | 11 | 11 | 0 | 0 |
| 合计 | 61 | 61 | 0 | 0 |

- **不通过项**：无。
- **未取证项**：无（渲染、控制台、尺寸、行高、溢出、对比度、语义、AC9 均由实跑取得）。
- **非阻塞观察**：4 条（(a) transparent / (b) 复选框语义 / (c) progressbar 角色 / (d) faint 对比度 3.27:1），在 sha256 `e4aa25b5…` 这版上逐条复核仍然成立。
- **重复性**：静态检查可重跑 `python3 docs/evidence/order-list-static-check.py`；AC9 脚本见 `specs/feature-order-list-page.yaml` L277–299；渲染取证需重起 `python3 -m http.server 7393`（命令见 §0）。
- **服务清理**：取证结束后 `job_kill bash-44`，并用 `curl -m 2` 与 `ss -ltnp | grep 7393` 复核，确认端口已无监听。

**总评：通过，可交付。**（被验版本 sha256 `e4aa25b5c9574dd41323ff9f55d194941817606bbe9bcf22aef18999aecdeec4`，36765 字节）
