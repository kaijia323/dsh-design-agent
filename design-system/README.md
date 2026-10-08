# 设计契约（design-system/）

这一层是产品对"AI 写的页面丑"的正面回答：**先给模型一套约束好的颜色、字号阶梯、间距节奏与模板，再让它动笔。**
画布只负责让改动变快，好不好看靠这里的 token 与模板。

写这里的内容**不需要**改任何代码，宿主（T2）与画布（T3）都按下面的路径与字段名读取。

## 目录

```
design-system/
├── tokens/
│   ├── index.json          三套预设的元数据（宿主 init 时读它选预设）
│   ├── neutral-modern.css  中性现代 · 浅色（默认）
│   ├── editorial-warm.css  编辑部暖调 · 浅色
│   └── tech-dark.css       科技工具 · 深色
├── templates/
│   ├── index.json          起步模板元数据（id/名称/尺寸/所用预设）
│   ├── order-list.html     后台订单列表 1440×900 · neutral-modern
│   ├── dashboard.html      监控仪表盘   1440×900 · tech-dark
│   └── mobile-home.html    移动端首页   390×844  · editorial-warm
└── tools/
    └── check-design-system.mjs  自检脚本（零依赖、离线可跑）
```

## 一、token 契约（冻结，改名前先问 Lead）

1. 预设文件路径固定为 `design-system/tokens/<id>.css`，id 只有三个：
   `neutral-modern`（默认）、`editorial-warm`、`tech-dark`。
2. **选中的预设被逐字拷贝**为 `<workspace>/.design/tokens.css`。拷贝时不许增删变量、不许改名、不许改值。
   画布切换预设 = 换用另一份文件的内容覆盖 `.design/tokens.css`。
3. 变量命名规则：`--<组>-<名>`，组只有九个：
   `color` `font` `text` `leading` `weight` `space` `radius` `shadow` `layout`。
   三套预设的**变量名与顺序完全一致**，只有取值不同——所以换预设不需要改任何页面样式。
4. 冻结变量共 56 个：
   - `--color-primary` `--color-primary-hover` `--color-primary-weak` `--color-on-primary`
     `--color-accent` `--color-accent-weak` `--color-bg` `--color-surface` `--color-surface-sunken`
     `--color-border` `--color-border-strong` `--color-text` `--color-text-muted` `--color-text-faint`
     `--color-success` `--color-warning` `--color-danger` `--color-focus`
   - `--font-display` `--font-body` `--font-mono`
   - `--text-xs` … `--text-4xl`（八档，逐档递增）
   - `--leading-tight` `--leading-snug` `--leading-normal` `--leading-relaxed`
   - `--weight-regular` `--weight-medium` `--weight-semibold` `--weight-bold`
   - `--space-0` … `--space-8`（4 的倍数：0/4/8/12/16/24/32/48/64）
   - `--radius-sm` `--radius-md` `--radius-lg` `--radius-full`
   - `--shadow-sm` `--shadow-md` `--shadow-lg`
   - `--layout-max` `--layout-gutter` `--control-h`
5. 颜色克制：每套只有 **1 个主色 + 1 个强调色**。`success/warning/danger` 是语义色，只用于状态（状态点、状态标签、错误提示），不当装饰色用。
   浅色底（如标签背景）不要新增变量，用 `color-mix(in srgb, var(--color-xxx) 12%, transparent)` 从现有 token 派生。
6. 字体全部是**中文优先的本地字体栈，零外链**。不是审美偏好，是硬约束：每屏跑在 sandbox iframe + `srcdoc` 里，没有同源、也没有可靠的外链加载时机，任何 CDN 字体会让"在设计者机器上好看、在别人机器上崩掉"。

## 二、design.json 的 tokens 镜像规则（宿主用）

`design.json.tokens` 是 `.design/tokens.css` 的只读镜像，键名由变量名推导：

> 取 `:root{}` 里的声明，变量名去掉 `--` 后**只把第一个 `-` 换成 `.`**，值原样保留字符串。

| CSS 变量 | design.json 键 |
|---|---|
| `--color-primary` | `color.primary` |
| `--color-primary-hover` | `color.primary-hover` |
| `--space-2` | `space.2` |
| `--text-md` | `text.md` |
| `--font-display` | `font.display` |

## 三、tokens/index.json 字段（冻结）

```json
{
  "version": 1,
  "default": "neutral-modern",
  "presets": [
    {
      "id": "neutral-modern",
      "name": "中性现代",
      "description": "一句话说清定位与适用场景",
      "file": "design-system/tokens/neutral-modern.css",
      "mode": "light",
      "swatches": { "bg": "#…", "surface": "#…", "primary": "#…", "accent": "#…", "text": "#…" },
      "fonts": { "display": "…", "body": "…", "mono": "…" },
      "scale": { "base": 16, "unit": 4, "radius": 10 }
    }
  ]
}
```

- `file` 是**仓库相对路径**，不是相对 `design-system/` 的路径。
- `swatches` / `fonts` / `scale` 必须与 CSS 文件里的取值一致（自检脚本会反查）：
  `scale.base` = `--text-md` 的数值，`scale.unit` = `--space-1` 的数值，`scale.radius` = `--radius-md` 的数值。
- 宿主 init 默认用 `default` 指定的那套。

## 四、模板契约

1. 模板就是"能直接当 `.design/frames/<id>.html` 用"的一屏：**自包含 HTML，零外链、零 `<script>`、零 `<img>`、零渐变、零 emoji、零自创颜色**。
2. 每个模板第一行注释声明元数据，与 `templates/index.json` 一致：
   `<!-- @design-template id=order-list preset=neutral-modern width=1440 height=900 -->`
   并且 `<html data-template="…" data-preset="…">` 也写同一份信息。
3. 模板内联的 `:root{}` 必须与它声明的预设**逐字一致**（逐变量、按顺序比对）。这样把整块 `:root` 换掉就等于换预设。
4. 模板里出现颜色只能写 `var(--color-*)` 或 `color-mix(… var(--color-*) …)`；字号只能写 `var(--text-*)`；内外边距只能写 `var(--space-*)`（1~2px 的发丝线是唯一例外）。这不是洁癖——这条纪律被脚本检查，也保证了"改 token 就能整站换风格"这个产品承诺。
5. 尺寸：桌面 1440×900，移动 390×844。`templates/index.json` 的 `width/height` 要与头部注释一致。

## 五、自检脚本

```bash
node design-system/tools/check-design-system.mjs   # 退出码 0 = 全过，1 = 有问题
```

零第三方依赖、不联网、大概一秒跑完。检查 12 项：

1. `tokens/index.json` 结构完整、`default` 存在、三套预设字段齐全且描述是中文；
2. 每个预设文件存在、`--` 变量无缺无多无重复；
3. 三套预设变量名顺序完全一致；
4. `index.json` 的 swatches / fonts / scale 与 CSS 取值一致；
5. 间距是 4 的倍数、字号阶梯递增、字号不低于 12px、正文行高不低于 1.5；
6. 预设无外链 / 无渐变 / 无 `@import`；
7. `templates/index.json` 字段完整、`preset` 必须存在、`file` 路径规则正确；
8. 模板头部注释、`data-*`、`index.json` 三处一致；
9. **模板内联 `:root` 与所选预设逐字一致**（独立验收可用它核对）；
10. 模板零外链 / 零 `<script>` / 零 `<img>` / 零渐变 / 零 emoji / 无 Lorem / 有中文文案；
11. 模板 `:root` 之外没有颜色字面量（`#hex`、`rgb()`、具名颜色）；
12. 模板字号只用 `--text-*`，内外边距只用 `--space-*`。

## 六、怎么扩展

- **加一套预设**：复制任意 `tokens/*.css` → 改取值（保持 56 个变量名与顺序）→ 在 `tokens/index.json` 的 `presets` 追加一项 → 跑自检。
- **加一个模板**：在 `templates/` 放 `<id>.html`，内联某个预设的 `:root`，写上头部注释与 `data-*` → 在 `templates/index.json` 追加一项 → 跑自检 → 截图存 `docs/design-preview/`。
- **改配色**：只改 `tokens/*.css` 里 `--color-*` 的值。任何"顺手在页面里写死一个颜色"的改动都会让自检脚本第 11 项失败。

## 七、谁读这些文件

| 读的人 | 读什么 | 用来做什么 |
|---|---|---|
| 宿主（T2 `design-project.ts`） | `tokens/index.json` + `tokens/<id>.css` | 初始化 `.design/`，把选中预设写进 `.design/tokens.css` 并镜像进 `design.json.tokens` |
| 画布（T3） | `tokens/index.json` | 预设切换菜单、frame 背景色 |
| agent（systemPrompt） | `prompts/design-conventions.md` + 目标项目里的 `.design/tokens.css` | 出稿时只允许用项目已有 token |
| 独立验收（T5） | `tools/check-design-system.mjs` | 核对设计契约没被改坏 |
