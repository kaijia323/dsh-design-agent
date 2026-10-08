/**
 * 订阅订单列表（SaaS 后台）—— 由画布上的设计稿 `order-list` 落地而来。
 *
 * 结构：左侧导航 + 顶栏 + 标题区 + 状态筛选 + 工具栏 + 订单表格 + 分页。
 * 视觉与设计稿一致：层级、间距节奏、字号阶梯、圆角、阴影都照搬；
 * 颜色一律引用下面 token 块里的 CSS 变量，组件内没有任何自创色值。
 *
 * 交付形态说明：这是**单文件**组件，样式以作用域化的 CSS 字符串随组件渲染
 * （所有规则都挂在本组件根节点 `.qy-orders` 下，不会漏到宿主的其它页面）。
 * 要拆成 CSS Module 时，把 `componentStyles` 里的规则整段搬进 order-list.module.css，
 * 根节点选择器换成 `:global(.qy-orders)` 即可，类名无需改动。
 *
 * 表里的客户名、邮箱、订单号、金额都是设计稿里的演示数据，不是真实业务数据。
 */

import { Fragment, useEffect, useRef, useState } from 'react';

/* ────────────────────────────── 设计 token ────────────────────────────── */

/**
 * 设计 token（中性现代预设）。写成组件根节点上的 CSS 变量：
 * 换主题时整块替换这里即可，下面的规则只引用变量。
 */
const componentStyles = `
.qy-orders {
  --color-primary: #2b4fd4;
  --color-primary-hover: #2240b4;
  --color-primary-weak: #e9edfb;
  --color-on-primary: #ffffff;
  --color-accent: #d97a45;
  --color-accent-weak: #fbeee6;
  --color-bg: #f6f7f9;
  --color-surface: #ffffff;
  --color-surface-sunken: #eef0f4;
  --color-border: #e3e6eb;
  --color-border-strong: #c8ced7;
  --color-text: #16181d;
  --color-text-muted: #5c636e;
  --color-text-faint: #7d858f;
  --color-success: #1f7a4d;
  --color-warning: #9a6212;
  --color-danger: #c0392f;
  --color-focus: rgba(43, 79, 212, 0.28);
  --font-display: system-ui, -apple-system, "PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", "Noto Sans SC", sans-serif;
  --font-body: "PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", "Noto Sans SC", system-ui, -apple-system, sans-serif;
  --font-mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, "Courier New", monospace;
  --text-xs: 12px;
  --text-sm: 14px;
  --text-md: 16px;
  --text-lg: 18px;
  --text-xl: 22px;
  --text-2xl: 28px;
  --text-3xl: 36px;
  --text-4xl: 48px;
  --leading-tight: 1.2;
  --leading-snug: 1.4;
  --leading-normal: 1.65;
  --leading-relaxed: 1.8;
  --weight-regular: 400;
  --weight-medium: 500;
  --weight-semibold: 600;
  --weight-bold: 700;
  --space-0: 0;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
  --space-8: 64px;
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
  --radius-full: 999px;
  --shadow-sm: 0 1px 2px rgba(16, 20, 30, 0.06);
  --shadow-md: 0 1px 3px rgba(16, 20, 30, 0.07), 0 8px 24px -12px rgba(16, 20, 30, 0.18);
  --shadow-lg: 0 4px 12px rgba(16, 20, 30, 0.08), 0 24px 48px -24px rgba(16, 20, 30, 0.24);
  --layout-max: 1280px;
  --layout-gutter: 24px;
  --control-h: 36px;

  min-height: 100vh;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-body);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  -webkit-font-smoothing: antialiased;
}

.qy-orders *,
.qy-orders *::before,
.qy-orders *::after { box-sizing: border-box; }

.qy-orders button,
.qy-orders input { font: inherit; color: inherit; }
.qy-orders button { background: none; border: 0; padding: 0; cursor: pointer; }
.qy-orders a { color: inherit; text-decoration: none; }
.qy-orders :focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }

.qy-orders .sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip-path: inset(50%); white-space: nowrap;
}
.qy-orders .sprite { position: absolute; width: 0; height: 0; overflow: hidden; }
.qy-orders .icon {
  width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor;
  stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round;
}
.qy-orders .icon-xs { width: 14px; height: 14px; }
.qy-orders .icon-dot { stroke-width: 2.6; }

/* ── 骨架 ─────────────────────────────────────── */
.qy-orders .app { display: grid; grid-template-columns: 240px minmax(0, 1fr); min-height: 100vh; }
.qy-orders .main { display: flex; flex-direction: column; min-width: 0; background: var(--color-bg); }

/* ── 左侧导航 ─────────────────────────────────── */
.qy-orders .side {
  position: sticky; top: 0; height: 100vh; overflow-y: auto;
  display: flex; flex-direction: column; gap: var(--space-5);
  padding: var(--space-5) var(--space-3) var(--space-4);
  background: var(--color-surface);
  border-right: 1px solid var(--color-border);
}
.qy-orders .brand { display: flex; align-items: center; gap: var(--space-3); padding: 0 var(--space-2); }
.qy-orders .brand-mark {
  width: 30px; height: 30px; border-radius: var(--radius-sm);
  background: var(--color-primary); color: var(--color-on-primary);
  display: grid; place-items: center;
}
.qy-orders .brand-mark .icon { width: 17px; height: 17px; }
.qy-orders .brand-text { display: flex; flex-direction: column; }
.qy-orders .brand-name {
  font-family: var(--font-display); font-size: var(--text-md);
  font-weight: var(--weight-semibold); letter-spacing: -0.01em; line-height: var(--leading-snug);
}
.qy-orders .brand-tag { font-size: var(--text-xs); color: var(--color-text-faint); letter-spacing: 0.06em; line-height: var(--leading-tight); }

.qy-orders .nav { display: flex; flex-direction: column; gap: var(--space-1); flex: 1; }
.qy-orders .nav-group {
  margin: var(--space-4) var(--space-2) var(--space-1);
  font-size: var(--text-xs); font-weight: var(--weight-medium);
  letter-spacing: 0.06em; color: var(--color-text-faint);
}
.qy-orders .nav-group:first-child { margin-top: var(--space-0); }
.qy-orders .nav-item {
  display: flex; align-items: center; gap: var(--space-3);
  height: 36px; padding: 0 var(--space-3); border-radius: var(--radius-sm);
  font-size: var(--text-sm); color: var(--color-text-muted);
}
.qy-orders .nav-item:hover { background: var(--color-surface-sunken); color: var(--color-text); }
.qy-orders .nav-item.is-active {
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
  color: var(--color-primary); font-weight: var(--weight-medium);
}
.qy-orders .nav-count { margin-left: auto; font-size: var(--text-xs); color: var(--color-text-faint); font-variant-numeric: tabular-nums; }
.qy-orders .nav-item.is-active .nav-count { color: var(--color-primary); }

.qy-orders .quota {
  display: flex; flex-direction: column; gap: var(--space-2);
  padding: var(--space-3);
  background: var(--color-surface-sunken); border-radius: var(--radius-md);
}
.qy-orders .quota-head {
  display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2);
  font-size: var(--text-xs); color: var(--color-text-muted);
}
.qy-orders .quota-num { font-family: var(--font-mono); font-variant-numeric: tabular-nums; color: var(--color-text); }
.qy-orders .quota-bar { height: 6px; border-radius: var(--radius-full); background: color-mix(in srgb, var(--color-border-strong) 45%, transparent); overflow: hidden; }
.qy-orders .quota-bar i { display: block; height: 100%; border-radius: var(--radius-full); background: var(--color-primary); }
.qy-orders .quota-foot { margin: 0; font-size: var(--text-xs); color: var(--color-text-faint); }

/* ── 顶栏 ─────────────────────────────────────── */
.qy-orders .topbar {
  display: flex; align-items: center; gap: var(--space-4);
  height: 60px; padding: 0 var(--space-6);
  background: var(--color-surface); border-bottom: 1px solid var(--color-border);
}
.qy-orders .crumbs { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); color: var(--color-text-muted); }
.qy-orders .crumbs a:hover { color: var(--color-text); }
.qy-orders .crumb-sep { width: 12px; height: 12px; color: var(--color-text-faint); stroke-width: 2; }
.qy-orders .crumbs .is-current { color: var(--color-text); font-weight: var(--weight-medium); }
.qy-orders .topbar-right { margin-left: auto; display: flex; align-items: center; gap: var(--space-2); }
.qy-orders .env {
  display: inline-flex; align-items: center; height: 24px; padding: 0 var(--space-3);
  border: 1px solid var(--color-border); border-radius: var(--radius-full);
  font-size: var(--text-xs); color: var(--color-text-muted);
}
.qy-orders .icon-btn {
  position: relative; width: 32px; height: 32px;
  display: grid; place-items: center; border-radius: var(--radius-sm);
  color: var(--color-text-muted);
}
.qy-orders .icon-btn:hover { background: var(--color-surface-sunken); color: var(--color-text); }
.qy-orders .icon-btn .dot {
  position: absolute; top: 6px; right: 6px; width: 6px; height: 6px;
  border-radius: var(--radius-full); background: var(--color-danger);
  border: 2px solid var(--color-surface);
}
.qy-orders .topbar-divider { width: 1px; height: 20px; background: var(--color-border); }
.qy-orders .user-btn { display: flex; align-items: center; gap: var(--space-1); padding: var(--space-1); border-radius: var(--radius-full); }
.qy-orders .user-btn:hover { background: var(--color-surface-sunken); }
.qy-orders .avatar {
  width: 28px; height: 28px; border-radius: var(--radius-full);
  background: var(--color-surface-sunken); color: var(--color-text-muted);
  display: grid; place-items: center;
}

/* ── 按钮 ─────────────────────────────────────── */
/* 画布批注「这个按钮太土了」的落地：按钮族整体去掉平面直角的旧观感 ——
   圆角由 --radius-sm 提到 --radius-md，主按钮加一层 --shadow-sm 的起伏与 600 字重，
   hover 时底色加深 + 阴影抬到 --shadow-md，按下收回去；淡入淡出只有状态色，不加动效花活。
   颜色依旧全部来自 token，没有新色值。 */
.qy-orders .btn {
  display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2);
  height: var(--control-h); padding: 0 var(--space-4); border-radius: var(--radius-md);
  font-size: var(--text-sm); font-weight: var(--weight-medium); letter-spacing: 0.01em; white-space: nowrap;
  transition: background-color 140ms ease, border-color 140ms ease, box-shadow 140ms ease, color 140ms ease;
}
.qy-orders .btn-ghost { background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text); }
.qy-orders .btn-ghost:hover { border-color: var(--color-border-strong); background: var(--color-surface-sunken); box-shadow: var(--shadow-sm); }
.qy-orders .btn-primary {
  background: var(--color-primary); color: var(--color-on-primary); font-weight: var(--weight-semibold);
  box-shadow: var(--shadow-sm), inset 0 1px 0 color-mix(in srgb, var(--color-on-primary) 22%, transparent);
}
.qy-orders .btn-primary:hover {
  background: var(--color-primary-hover);
  box-shadow: var(--shadow-md), inset 0 1px 0 color-mix(in srgb, var(--color-on-primary) 26%, transparent);
}
.qy-orders .btn-primary:active { transform: translateY(1px); box-shadow: var(--shadow-sm); }
.qy-orders .btn-text { color: var(--color-text-muted); }
.qy-orders .btn-text:hover { color: var(--color-text); }
.qy-orders .btn-sm { height: 32px; padding: 0 var(--space-3); }

/* ── 内容区 ───────────────────────────────────── */
.qy-orders .content { display: flex; flex-direction: column; padding: var(--space-6); }
.qy-orders .page-head { display: flex; align-items: flex-end; gap: var(--space-4); margin-bottom: var(--space-5); }
.qy-orders .page-title {
  margin: 0; font-family: var(--font-display);
  font-size: var(--text-2xl); font-weight: var(--weight-semibold);
  letter-spacing: -0.02em; line-height: var(--leading-tight);
}
.qy-orders .page-sub { margin: var(--space-1) 0 0; font-size: var(--text-sm); color: var(--color-text-muted); }
.qy-orders .page-actions { margin-left: auto; display: flex; align-items: center; gap: var(--space-2); }

/* 状态筛选 */
.qy-orders .filter-row { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-4); }
.qy-orders .tabs {
  display: inline-flex; align-items: center; gap: var(--space-1);
  padding: var(--space-1); background: var(--color-surface-sunken); border-radius: var(--radius-md);
}
.qy-orders .tab {
  display: inline-flex; align-items: center; gap: var(--space-2);
  height: 28px; padding: 0 var(--space-3); border-radius: var(--radius-sm);
  font-size: var(--text-sm); color: var(--color-text-muted);
}
.qy-orders .tab:hover { color: var(--color-text); }
.qy-orders .tab.is-active { background: var(--color-surface); color: var(--color-text); font-weight: var(--weight-semibold); box-shadow: var(--shadow-sm); }
.qy-orders .tab-num { font-size: var(--text-xs); color: var(--color-text-faint); font-variant-numeric: tabular-nums; }
.qy-orders .tab.is-active .tab-num { color: var(--color-primary); }

/* 工具栏 */
.qy-orders .toolbar { display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-4); }
.qy-orders .search {
  display: flex; align-items: center; gap: var(--space-2);
  width: 300px; height: 32px; padding: 0 var(--space-3);
  background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-sm);
  color: var(--color-text-muted);
}
.qy-orders .search:focus-within { border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-focus); }
.qy-orders .search input { flex: 1; min-width: 0; border: 0; background: none; outline: none; font-size: var(--text-sm); color: var(--color-text); }
.qy-orders .search input::placeholder { color: var(--color-text-faint); }
.qy-orders .toolbar-right { margin-left: auto; display: flex; align-items: center; gap: var(--space-2); }

/* ── 表格 ─────────────────────────────────────── */
.qy-orders .table-card {
  background: var(--color-surface); border: 1px solid var(--color-border);
  border-radius: var(--radius-md); box-shadow: var(--shadow-sm); overflow: hidden;
}
.qy-orders .bulk {
  display: flex; align-items: center; gap: var(--space-3);
  height: 44px; padding: 0 var(--space-3);
  background: var(--color-primary-weak); border-bottom: 1px solid var(--color-border);
}
.qy-orders .bulk-text { font-size: var(--text-sm); }
.qy-orders .bulk-text strong { font-weight: var(--weight-semibold); font-variant-numeric: tabular-nums; }
.qy-orders .bulk-text .bulk-sum { font-family: var(--font-mono); }
.qy-orders .bulk-actions { margin-left: auto; display: flex; align-items: center; gap: var(--space-2); }

.qy-orders table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.qy-orders thead th {
  height: 44px; padding: 0 var(--space-3);
  background: var(--color-surface-sunken); border-bottom: 1px solid var(--color-border);
  font-size: var(--text-xs); font-weight: var(--weight-medium); color: var(--color-text-muted);
  letter-spacing: 0.04em; text-align: left; white-space: nowrap;
}
.qy-orders .th-sorted { display: inline-flex; align-items: center; gap: var(--space-1); color: var(--color-text); font-weight: var(--weight-semibold); }
.qy-orders tbody td {
  height: 60px; padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--color-border); vertical-align: middle;
}
.qy-orders tbody tr:last-child td { border-bottom: 0; }
.qy-orders tbody tr:hover td { background: color-mix(in srgb, var(--color-surface-sunken) 55%, transparent); }
.qy-orders tbody tr.is-selected td { background: color-mix(in srgb, var(--color-primary) 6%, transparent); }
.qy-orders tbody tr.is-selected:hover td { background: color-mix(in srgb, var(--color-primary) 10%, transparent); }
.qy-orders .num { text-align: right; font-variant-numeric: tabular-nums; }
.qy-orders .muted { color: var(--color-text-muted); }
.qy-orders .nowrap { white-space: nowrap; }
.qy-orders .col-check { padding-right: var(--space-0); }
.qy-orders .col-actions { white-space: nowrap; }

/* 复选框：用真 input（appearance 抹掉原生外观），方框与勾都跟设计稿一颗像素不差 */
.qy-orders .cb-field { position: relative; display: inline-flex; width: 16px; height: 16px; }
.qy-orders .cb {
  appearance: none; -webkit-appearance: none; margin: 0;
  width: 16px; height: 16px; cursor: pointer;
  border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm);
  background: var(--color-surface);
}
.qy-orders .cb:hover { border-color: var(--color-primary); }
.qy-orders .cb:checked,
.qy-orders .cb:indeterminate { background: var(--color-primary); border-color: var(--color-primary); }
.qy-orders .cb-face {
  position: absolute; inset: 0; display: grid; place-items: center;
  pointer-events: none; color: var(--color-on-primary);
}
.qy-orders .cb-face .icon { width: 12px; height: 12px; stroke-width: 2.6; opacity: 0; }
.qy-orders .cb:checked + .cb-face .icon { opacity: 1; }
.qy-orders .cb:indeterminate + .cb-face::after {
  content: ""; width: 8px; height: 2px; border-radius: var(--radius-full); background: var(--color-on-primary);
}

.qy-orders .cell-stack { display: flex; flex-direction: column; }
.qy-orders .cell-stack > span { line-height: var(--leading-snug); }
.qy-orders .cell-main { font-weight: var(--weight-medium); }
.qy-orders .cell-sub { font-size: var(--text-xs); font-weight: var(--weight-regular); color: var(--color-text-muted); }
.qy-orders .order-no { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--color-text); letter-spacing: -0.01em; }
.qy-orders .amount { font-family: var(--font-mono); font-size: var(--text-sm); font-weight: var(--weight-medium); font-variant-numeric: tabular-nums; }

.qy-orders .pill {
  display: inline-flex; align-items: center; gap: var(--space-2);
  height: 24px; padding: 0 var(--space-3); border-radius: var(--radius-full);
  font-size: var(--text-xs); font-weight: var(--weight-medium); white-space: nowrap;
}
.qy-orders .pill::before { content: ""; width: 6px; height: 6px; border-radius: var(--radius-full); background: currentColor; }
.qy-orders .pill-ok { color: var(--color-success); background: color-mix(in srgb, var(--color-success) 12%, transparent); }
.qy-orders .pill-warn { color: var(--color-warning); background: color-mix(in srgb, var(--color-warning) 14%, transparent); }
.qy-orders .pill-danger { color: var(--color-danger); background: color-mix(in srgb, var(--color-danger) 12%, transparent); }
.qy-orders .pill-off { color: var(--color-text-muted); background: var(--color-surface-sunken); }

.qy-orders .link-btn { font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--color-text); }
.qy-orders .link-btn:hover { color: var(--color-primary); text-decoration: underline; text-underline-offset: 3px; }
.qy-orders .row-actions { display: flex; align-items: center; gap: var(--space-1); }
.qy-orders .icon-btn-sm { width: 28px; height: 28px; }

.qy-orders .table-foot {
  display: flex; align-items: center; gap: var(--space-3);
  height: 56px; padding: 0 var(--space-3);
  border-top: 1px solid var(--color-border);
}
.qy-orders .foot-count { margin: 0; font-size: var(--text-xs); color: var(--color-text-muted); font-variant-numeric: tabular-nums; }
.qy-orders .foot-count strong { color: var(--color-text); font-weight: var(--weight-medium); }
.qy-orders .pager { margin-left: auto; display: flex; align-items: center; gap: var(--space-1); }
.qy-orders .pg {
  min-width: 30px; height: 30px; padding: 0 var(--space-2);
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: var(--radius-sm); font-size: var(--text-sm); color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}
.qy-orders .pg:hover { background: var(--color-surface-sunken); color: var(--color-text); }
.qy-orders .pg.is-active { background: var(--color-primary); color: var(--color-on-primary); font-weight: var(--weight-medium); }
.qy-orders .pg:disabled { color: var(--color-text-faint); }
.qy-orders .pg-gap { padding: 0 var(--space-1); color: var(--color-text-faint); font-size: var(--text-sm); }
`;

/* ────────────────────────────── 文案常量 ────────────────────────────── */

const BRAND = { name: '启元云', tag: '订阅中台' } as const;

const PAGE_HEADER = {
  breadcrumb: '交易',
  title: '订单',
  subtitle: '订阅的收款、续费与退款都在这里处理',
} as const;

const TOPBAR = { environment: '生产环境', unreadNotifications: 3 } as const;

const SEARCH_PLACEHOLDER = '搜索订单号、客户或发票号';

const DATERANGE_LABEL = '近 30 天';
const CHANNEL_LABEL = '全部渠道';

/** 附加筛选：2 表示当前已启用的附加条件数（设计稿里紧跟文字，中间不留空隙）。 */
const ADVANCED_FILTER = { label: '更多筛选', activeCount: 2 } as const;

const BULK_ACTIONS = ['批量开票', '导出所选'] as const;

/* ────────────────────────────── 导航 ────────────────────────────── */

interface NavItem {
  id: string;
  label: string;
  /** 内嵌 sprite 里的 symbol id */
  icon: string;
  count?: number;
  current?: boolean;
}

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: '总览',
    items: [
      { id: 'dashboard', label: '仪表盘', icon: 'qy-i-grid' },
      { id: 'activity', label: '实时动态', icon: 'qy-i-pulse', count: 3 },
    ],
  },
  {
    title: '交易',
    items: [
      { id: 'orders', label: '订单', icon: 'qy-i-receipt', current: true },
      { id: 'plans', label: '订阅计划', icon: 'qy-i-repeat' },
      { id: 'refunds', label: '退款与争议', icon: 'qy-i-refund', count: 9 },
      { id: 'invoices', label: '发票', icon: 'qy-i-file' },
    ],
  },
  {
    title: '客户',
    items: [
      { id: 'customers', label: '客户', icon: 'qy-i-users' },
      { id: 'seats', label: '席位与权限', icon: 'qy-i-shield' },
    ],
  },
];

/** 侧栏底部的额度卡：进度条宽度由 used / total 算出来，不写死。 */
const ORDER_QUOTA = { used: 8214, total: 10000, note: '超出后按每单 ¥0.02 计费' } as const;

/* ────────────────────────────── 订单数据 ────────────────────────────── */

type OrderStatus = 'active' | 'pending' | 'refunding' | 'closed';

interface OrderRow {
  /** 订单号，同时用作列表 key 与选中态标识 */
  id: string;
  /** 新购 / 续费 · 自动扣款 */
  kind: string;
  customer: string;
  email: string;
  plan: string;
  /** 订阅内容第二行：席位数 + 到期/收款状态 */
  detail: string;
  /** 金额（元）：展示与批量合计都用它，避免两处写同一个数字 */
  amount: number;
  method: string;
  date: string;
  time: string;
  status: OrderStatus;
}

const STATUS_META: Record<OrderStatus, { label: string; tone: 'ok' | 'warn' | 'danger' | 'off' }> = {
  active: { label: '生效中', tone: 'ok' },
  pending: { label: '待支付', tone: 'warn' },
  refunding: { label: '退款中', tone: 'danger' },
  closed: { label: '已关闭', tone: 'off' },
};

type StatusTabId = 'all' | OrderStatus;

const STATUS_TABS: { id: StatusTabId; label: string; count: number }[] = [
  { id: 'all', label: '全部', count: 1286 },
  { id: 'pending', label: '待支付', count: 12 },
  { id: 'active', label: '生效中', count: 1042 },
  { id: 'refunding', label: '退款中', count: 9 },
  { id: 'closed', label: '已关闭', count: 223 },
];

/** 演示数据（与设计稿逐行一致，不是真实业务数据）。设计稿只画了前 7 行示意。 */
const ORDER_ROWS: OrderRow[] = [
  {
    id: 'SUB-261008-0421', kind: '新购', customer: '拾光文化', email: 'hello@shiguang.design',
    plan: '团队版 · 年付', detail: '12 个席位 · 到期 2027-10-08', amount: 6480,
    method: '对公转账', date: '2026-10-08', time: '14:32', status: 'active',
  },
  {
    id: 'SUB-261008-0418', kind: '新购', customer: '青柚设计', email: 'finance@qingyou.design',
    plan: '专业版 · 月付', detail: '5 个席位 · 到期 2026-11-08', amount: 1250,
    method: '微信支付', date: '2026-10-08', time: '11:07', status: 'active',
  },
  {
    id: 'SUB-261008-0392', kind: '新购', customer: '山海教育', email: 'caiwu@shanhai-edu.cn',
    plan: '团队版 · 年付', detail: '30 个席位 · 14 天内可支付', amount: 16200,
    method: '支付宝', date: '2026-10-08', time: '09:41', status: 'pending',
  },
  {
    id: 'SUB-261007-0364', kind: '续费 · 自动扣款', customer: '木棉影像', email: 'pay@mumian.studio',
    plan: '专业版 · 年付', detail: '8 个席位 · 退款审核中', amount: 9600,
    method: '信用卡 · 4417', date: '2026-10-07', time: '20:15', status: 'refunding',
  },
  {
    id: 'SUB-261007-0351', kind: '续费 · 自动扣款', customer: '南岸书店', email: 'hi@nanan.store',
    plan: '基础版 · 月付', detail: '3 个席位 · 到期 2026-11-07', amount: 447,
    method: '微信支付', date: '2026-10-07', time: '16:52', status: 'active',
  },
  {
    id: 'SUB-261006-0333', kind: '续费 · 自动扣款', customer: '云边工作室', email: 'team@yunbian.work',
    plan: '团队版 · 月付', detail: '15 个席位 · 逾期未支付', amount: 2925,
    method: '支付宝', date: '2026-10-06', time: '10:26', status: 'closed',
  },
  {
    id: 'SUB-261005-0318', kind: '新购', customer: '洄游动画', email: 'studio@huiyou.design',
    plan: '专业版 · 月付', detail: '6 个席位 · 到期 2026-11-05', amount: 1500,
    method: '对公转账', date: '2026-10-05', time: '18:03', status: 'active',
  },
];

/** 设计稿里勾选的两笔：拾光文化 ¥6,480.00 + 青柚设计 ¥1,250.00 = ¥7,730.00，与批量条一致。 */
const INITIALLY_SELECTED_ORDER_IDS = ['SUB-261008-0421', 'SUB-261008-0418'];

const PAGINATION = { total: 1286, pageSize: 20, current: 1, pages: [1, 2, 3], lastPage: 65 } as const;

const AMOUNT_FORMAT = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const COUNT_FORMAT = new Intl.NumberFormat('zh-CN');

/** 金额展示：¥6,480.00（列内右对齐 + 等宽数字由 CSS 的 tabular-nums 负责）。 */
const formatAmount = (value: number) => `¥${AMOUNT_FORMAT.format(value)}`;

/* ────────────────────────────── 图标 ────────────────────────────── */

/** 统一引用组件内嵌的 SVG sprite，零外链、无图标字体。 */
function Icon({ name, className = 'icon' }: { name: string; className?: string }) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`#${name}`} />
    </svg>
  );
}

/** 表格里的复选框：真 input + 覆盖在上面的勾/横杠，保持设计稿的样子与键盘可达性。 */
function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  label,
}: {
  checked: boolean;
  /** 半选态（表头全选）：只能通过 DOM 属性设置，HTML 没有对应的 attribute */
  indeterminate?: boolean;
  onChange: () => void;
  label: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label className="cb-field">
      <input
        ref={inputRef}
        type="checkbox"
        className="cb"
        checked={checked}
        onChange={onChange}
        aria-label={label}
      />
      <span className="cb-face" aria-hidden="true">
        <Icon name="qy-i-check" />
      </span>
    </label>
  );
}

/* ────────────────────────────── 页面组件 ────────────────────────────── */

export function OrderListPage() {
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>(INITIALLY_SELECTED_ORDER_IDS);
  const [activeStatusTab, setActiveStatusTab] = useState<StatusTabId>('all');

  const selectedOrders = ORDER_ROWS.filter((row) => selectedOrderIds.includes(row.id));
  const selectedCount = selectedOrders.length;
  const selectedAmount = selectedOrders.reduce((sum, row) => sum + row.amount, 0);
  const allSelected = selectedCount === ORDER_ROWS.length;
  const someSelected = selectedCount > 0 && !allSelected;

  const toggleOrder = (id: string) => {
    setSelectedOrderIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const toggleAll = () => {
    setSelectedOrderIds(allSelected ? [] : ORDER_ROWS.map((row) => row.id));
  };

  const quotaPercent = Math.round((ORDER_QUOTA.used / ORDER_QUOTA.total) * 100);

  return (
    <div className="qy-orders">
      <style>{componentStyles}</style>

      <svg className="sprite" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
        <symbol id="qy-i-cube" viewBox="0 0 16 16"><path d="M8 1.9l5.6 3v6.2L8 14.1l-5.6-3V4.9z" /><path d="M2.4 4.9 8 7.9l5.6-3M8 7.9v6.2" /></symbol>
        <symbol id="qy-i-grid" viewBox="0 0 16 16"><rect x="2.25" y="2.25" width="4.5" height="4.5" rx="1" /><rect x="9.25" y="2.25" width="4.5" height="4.5" rx="1" /><rect x="2.25" y="9.25" width="4.5" height="4.5" rx="1" /><rect x="9.25" y="9.25" width="4.5" height="4.5" rx="1" /></symbol>
        <symbol id="qy-i-pulse" viewBox="0 0 16 16"><path d="M1.9 8h3l1.6-3.4L9 11.4 10.6 8h3.5" /></symbol>
        <symbol id="qy-i-receipt" viewBox="0 0 16 16"><path d="M3.25 2.25h9.5v11.5l-2.4-1.5-2.35 1.5-2.35-1.5-2.4 1.5z" /><path d="M5.75 5.75h4.5M5.75 8.25h3" /></symbol>
        <symbol id="qy-i-repeat" viewBox="0 0 16 16"><path d="M2.9 6.6A3.6 3.6 0 0 1 6.5 3h4.4" /><path d="M9.4 1.4 11.6 3 9.4 4.6" /><path d="M13.1 9.4A3.6 3.6 0 0 1 9.5 13H5.1" /><path d="M6.6 14.6 4.4 13l2.2-1.6" /></symbol>
        <symbol id="qy-i-refund" viewBox="0 0 16 16"><path d="M2.9 8a5.1 5.1 0 1 0 1.9-3.9" /><path d="M2.6 2.6v3.2h3.2" /></symbol>
        <symbol id="qy-i-file" viewBox="0 0 16 16"><path d="M3.9 2.4h5.2l3.1 3.1v8.1H3.9z" /><path d="M9.1 2.5v3.2h3.1" /><path d="M6.2 8.6h3.9M6.2 10.9h2.6" /></symbol>
        <symbol id="qy-i-users" viewBox="0 0 16 16"><circle cx="6.25" cy="6" r="2.25" /><path d="M2.5 13.25c0-2.2 1.7-3.5 3.75-3.5s3.75 1.3 3.75 3.5" /><path d="M10.75 4.4a2.1 2.1 0 0 1 0 3.6M11.7 10c1.25.5 2 1.5 2 3" /></symbol>
        <symbol id="qy-i-shield" viewBox="0 0 16 16"><path d="M8 2.1 13 3.9v4.3c0 2.6-2 4.6-5 5.7-3-1.1-5-3.1-5-5.7V3.9z" /><path d="M6.2 7.9 7.5 9.2l2.4-2.6" /></symbol>
        <symbol id="qy-i-search" viewBox="0 0 16 16"><circle cx="7.1" cy="7.1" r="4.4" /><path d="M10.4 10.4 13.9 13.9" /></symbol>
        <symbol id="qy-i-calendar" viewBox="0 0 16 16"><rect x="2.4" y="3.4" width="11.2" height="10.2" rx="2" /><path d="M2.4 6.6h11.2M5.6 1.9v3M10.4 1.9v3" /></symbol>
        <symbol id="qy-i-columns" viewBox="0 0 16 16"><rect x="2.4" y="3.4" width="11.2" height="9.2" rx="2" /><path d="M6.6 3.4v9.2" /></symbol>
        <symbol id="qy-i-refresh" viewBox="0 0 16 16"><path d="M13.1 8a5.1 5.1 0 1 1-1.7-3.8" /><path d="M13.4 2.6v3.4h-3.4" /></symbol>
        <symbol id="qy-i-download" viewBox="0 0 16 16"><path d="M8 2.6v8" /><path d="M5 7.6 8 10.6l3-3" /><path d="M2.8 13.4h10.4" /></symbol>
        <symbol id="qy-i-plus" viewBox="0 0 16 16"><path d="M8 3.4v9.2M3.4 8h9.2" /></symbol>
        <symbol id="qy-i-check" viewBox="0 0 16 16"><path d="M3.4 8.4 6.5 11.5 12.6 4.9" /></symbol>
        <symbol id="qy-i-chevron-down" viewBox="0 0 16 16"><path d="M4.4 6.4 8 10l3.6-3.6" /></symbol>
        <symbol id="qy-i-chevron-left" viewBox="0 0 16 16"><path d="M9.6 4.4 6 8l3.6 3.6" /></symbol>
        <symbol id="qy-i-chevron-right" viewBox="0 0 16 16"><path d="M6.4 4.4 10 8l-3.6 3.6" /></symbol>
        <symbol id="qy-i-sort-desc" viewBox="0 0 16 16"><path d="M8 3.6v8.8" /><path d="M4.8 9.2 8 12.4l3.2-3.2" /></symbol>
        <symbol id="qy-i-more" viewBox="0 0 16 16"><path className="dot" d="M4 8h.01M8 8h.01M12 8h.01" /></symbol>
        <symbol id="qy-i-bell" viewBox="0 0 16 16"><path d="M4.6 11.4V7.3a3.4 3.4 0 0 1 6.8 0v4.1" /><path d="M3.2 11.4h9.6" /><path d="M6.7 13.4a1.5 1.5 0 0 0 2.6 0" /></symbol>
        <symbol id="qy-i-help" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.8" /><path d="M6.6 6.6a1.5 1.5 0 1 1 2.2 1.5c-.5.3-.8.6-.8 1.1v.3" /><path d="M8 11.6h.01" /></symbol>
        <symbol id="qy-i-user" viewBox="0 0 16 16"><circle cx="8" cy="6" r="2.5" /><path d="M3.4 13.4c0-2.5 2-4 4.6-4s4.6 1.5 4.6 4" /></symbol>
      </svg>

      <div className="app">
        <aside className="side">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true"><Icon name="qy-i-cube" /></span>
            <span className="brand-text">
              <span className="brand-name">{BRAND.name}</span>
              <span className="brand-tag">{BRAND.tag}</span>
            </span>
          </div>

          <nav className="nav" aria-label="主导航">
            {NAV_GROUPS.map((group) => (
              <Fragment key={group.title}>
                <p className="nav-group">{group.title}</p>
                {group.items.map((item) => (
                  <a
                    key={item.id}
                    className={item.current ? 'nav-item is-active' : 'nav-item'}
                    href="#"
                    aria-current={item.current ? 'page' : undefined}
                  >
                    <Icon name={item.icon} />
                    {item.label}
                    {item.count === undefined ? null : <span className="nav-count">{item.count}</span>}
                  </a>
                ))}
              </Fragment>
            ))}
          </nav>

          <div className="quota">
            <div className="quota-head">
              <span>本月订单额度</span>
              <span className="quota-num">{COUNT_FORMAT.format(ORDER_QUOTA.used)} / {COUNT_FORMAT.format(ORDER_QUOTA.total)}</span>
            </div>
            <div className="quota-bar">
              <i style={{ width: `${quotaPercent}%` }} />
            </div>
            <p className="quota-foot">{ORDER_QUOTA.note}</p>
          </div>
        </aside>

        <div className="main">
          <header className="topbar">
            <nav className="crumbs" aria-label="面包屑">
              <a href="#">{PAGE_HEADER.breadcrumb}</a>
              <Icon name="qy-i-chevron-right" className="icon crumb-sep" />
              <span className="is-current" aria-current="page">{PAGE_HEADER.title}</span>
            </nav>
            <div className="topbar-right">
              <span className="env">{TOPBAR.environment}</span>
              <button className="icon-btn" type="button" aria-label="帮助"><Icon name="qy-i-help" /></button>
              <button className="icon-btn" type="button" aria-label={`通知，${TOPBAR.unreadNotifications} 条未读`}>
                <Icon name="qy-i-bell" />
                <span className="dot" aria-hidden="true" />
              </button>
              <span className="topbar-divider" aria-hidden="true" />
              <button className="user-btn" type="button" aria-label="账号菜单">
                <span className="avatar"><Icon name="qy-i-user" /></span>
                <Icon name="qy-i-chevron-down" className="icon icon-xs" />
              </button>
            </div>
          </header>

          <main className="content">
            <div className="page-head">
              <div>
                <h1 className="page-title">{PAGE_HEADER.title}</h1>
                <p className="page-sub">{PAGE_HEADER.subtitle}</p>
              </div>
              <div className="page-actions">
                <button className="btn btn-ghost" type="button"><Icon name="qy-i-download" />导出</button>
                <button className="btn btn-primary" type="button"><Icon name="qy-i-plus" />新建订单</button>
              </div>
            </div>

            <div className="filter-row">
              <div className="tabs" role="tablist" aria-label="按订单状态筛选">
                {STATUS_TABS.map((tab) => {
                  const isActive = tab.id === activeStatusTab;
                  return (
                    <button
                      key={tab.id}
                      className={isActive ? 'tab is-active' : 'tab'}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => setActiveStatusTab(tab.id)}
                    >
                      {tab.label}
                      <span className="tab-num">{COUNT_FORMAT.format(tab.count)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="toolbar">
              <label className="search">
                <Icon name="qy-i-search" />
                <input type="search" placeholder={SEARCH_PLACEHOLDER} aria-label="搜索订单" />
              </label>
              <button className="btn btn-ghost btn-sm" type="button">
                <Icon name="qy-i-calendar" />{DATERANGE_LABEL}<Icon name="qy-i-chevron-down" className="icon icon-xs" />
              </button>
              <button className="btn btn-ghost btn-sm" type="button">
                {CHANNEL_LABEL}<Icon name="qy-i-chevron-down" className="icon icon-xs" />
              </button>
              <button className="btn btn-ghost btn-sm" type="button">
                {ADVANCED_FILTER.label}{ADVANCED_FILTER.activeCount}
              </button>
              <div className="toolbar-right">
                <button className="btn btn-ghost btn-sm" type="button"><Icon name="qy-i-columns" />列设置</button>
                <button className="icon-btn" type="button" aria-label="刷新列表"><Icon name="qy-i-refresh" /></button>
              </div>
            </div>

            <section className="table-card" aria-label="订单列表">
              <div className="bulk">
                <p className="bulk-text">
                  已选 <strong>{selectedCount}</strong> 笔 · 合计 <strong className="bulk-sum">{formatAmount(selectedAmount)}</strong>
                </p>
                <div className="bulk-actions">
                  {BULK_ACTIONS.map((action) => (
                    <button key={action} className="btn btn-ghost btn-sm" type="button">{action}</button>
                  ))}
                  <button className="btn btn-text btn-sm" type="button" onClick={() => setSelectedOrderIds([])}>取消选择</button>
                </div>
              </div>

              <table>
                <caption className="sr-only">订阅订单列表</caption>
                <colgroup>
                  <col style={{ width: 40 }} />
                  <col style={{ width: 144 }} />
                  <col />
                  <col style={{ width: 208 }} />
                  <col style={{ width: 116 }} />
                  <col style={{ width: 132 }} />
                  <col style={{ width: 112 }} />
                  <col style={{ width: 100 }} />
                  <col style={{ width: 88 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th className="col-check" scope="col">
                      <Checkbox
                        checked={allSelected}
                        indeterminate={someSelected}
                        onChange={toggleAll}
                        label="选中本页全部订单"
                      />
                    </th>
                    <th scope="col">订单号</th>
                    <th scope="col">客户</th>
                    <th scope="col">订阅内容</th>
                    <th className="num" scope="col">金额</th>
                    <th scope="col">支付方式</th>
                    <th scope="col" aria-sort="descending">
                      <span className="th-sorted">
                        下单时间<Icon name="qy-i-sort-desc" className="icon icon-xs" />
                      </span>
                    </th>
                    <th scope="col">状态</th>
                    <th className="col-actions" scope="col">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {ORDER_ROWS.map((row) => {
                    const status = STATUS_META[row.status];
                    const isSelected = selectedOrderIds.includes(row.id);
                    return (
                      <tr key={row.id} className={isSelected ? 'is-selected' : undefined}>
                        <td className="col-check">
                          <Checkbox
                            checked={isSelected}
                            onChange={() => toggleOrder(row.id)}
                            label={`选中订单 ${row.id}`}
                          />
                        </td>
                        <td>
                          <span className="cell-stack">
                            <span className="order-no">{row.id}</span>
                            <span className="cell-sub">{row.kind}</span>
                          </span>
                        </td>
                        <td>
                          <span className="cell-stack">
                            <span className="cell-main">{row.customer}</span>
                            <span className="cell-sub">{row.email}</span>
                          </span>
                        </td>
                        <td>
                          <span className="cell-stack">
                            <span className="cell-main">{row.plan}</span>
                            <span className="cell-sub">{row.detail}</span>
                          </span>
                        </td>
                        <td className="num amount">{formatAmount(row.amount)}</td>
                        <td className="muted nowrap">{row.method}</td>
                        <td>
                          <span className="cell-stack">
                            <span className="cell-main">{row.date}</span>
                            <span className="cell-sub">{row.time}</span>
                          </span>
                        </td>
                        <td><span className={`pill pill-${status.tone}`}>{status.label}</span></td>
                        <td className="col-actions">
                          <span className="row-actions">
                            <button className="link-btn" type="button">详情</button>
                            <button className="icon-btn icon-btn-sm" type="button" aria-label={`订单 ${row.id} 的更多操作`}>
                              <Icon name="qy-i-more" className="icon icon-dot" />
                            </button>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <footer className="table-foot">
                <p className="foot-count">
                  共 <strong>{COUNT_FORMAT.format(PAGINATION.total)}</strong> 条 · 每页 <strong>{PAGINATION.pageSize}</strong> 条
                </p>
                <nav className="pager" aria-label="分页">
                  <button className="pg" type="button" aria-label="上一页" disabled>
                    <Icon name="qy-i-chevron-left" className="icon icon-xs" />
                  </button>
                  {PAGINATION.pages.map((page) => {
                    const isActive = page === PAGINATION.current;
                    return (
                      <button
                        key={page}
                        className={isActive ? 'pg is-active' : 'pg'}
                        type="button"
                        aria-current={isActive ? 'page' : undefined}
                      >
                        {page}
                      </button>
                    );
                  })}
                  <span className="pg-gap">…</span>
                  <button className="pg" type="button">{PAGINATION.lastPage}</button>
                  <button className="pg" type="button" aria-label="下一页">
                    <Icon name="qy-i-chevron-right" className="icon icon-xs" />
                  </button>
                </nav>
              </footer>
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}

export default OrderListPage;
