#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""独立静态契约核对：.design/frames/order-list.html
由 design-verifier 编写并实跑；只读，不修改任何被检查文件。"""
import re, sys, unicodedata, json
from pathlib import Path

WS = Path("/home/dsh/codes/dsh-design-agent")
FRAME = WS / ".design/frames/order-list.html"
PRESET = WS / "design-system/tokens/neutral-modern.css"
html = FRAME.read_text(encoding="utf-8")

def result(name, ok, detail):
    print(("PASS  " if ok else "FAIL  ") + name + " :: " + detail)
    return ok

fails = []

# ---------- 1. 零外链 / 零 script / 零 img ----------
ext_hits = []
for m in re.finditer(r'(?:src|href)\s*=\s*["\']([^"\']*)["\']', html):
    v = m.group(1).strip()
    if not v.startswith("#"):
        ext_hits.append(m.group(0))
tag_hits = re.findall(r'<\s*(link|script|img|iframe|object|embed|video|audio|picture|source)\b', html, re.I)
url_hits = re.findall(r'url\s*\(', html, re.I)
import_hits = re.findall(r'@import', html, re.I)
# 排除 xmlns 命名空间声明
http_hits = [h for h in re.findall(r'https?://[^\s"\'<>)]+', html) if 'www.w3.org' not in h]
ok = result("零外链(非#的 src/href)", not ext_hits, json.dumps(ext_hits, ensure_ascii=False) or "无")
if not ok: fails.append("外部引用 src/href")
ok = result("零 link/script/img/iframe 等外链标签", not tag_hits, str(tag_hits) or "无")
if not ok: fails.append("外链标签")
ok = result("零 url() / @import", not url_hits and not import_hits, f"url()={len(url_hits)} @import={len(import_hits)}")
if not ok: fails.append("url()/@import")
ok = result("零 http(s) 外链(除 SVG 命名空间)", not http_hits, json.dumps(http_hits) or "无(仅 xmlns=www.w3.org)")
if not ok: fails.append("http 外链")

# ---------- 2. 渐变 / emoji / Lorem ----------
grad = re.findall(r'\b(?:linear|radial|conic)-gradient\b', html, re.I)
ok = result("零渐变", not grad, str(grad) or "无")
if not ok: fails.append("渐变")

emoji = []
for ch in html:
    o = ord(ch)
    if (0x1F300 <= o <= 0x1FAFF) or (0x1F000 <= o <= 0x1F2FF) or (0x2600 <= o <= 0x27BF) \
       or o in (0x2705,0x274C,0x2728,0x2B50,0x1F004) or (0xFE0F == o) or (0x2190 <= o <= 0x21FF) \
       or (0x2B00 <= o <= 0x2BFF):
        emoji.append(f"U+{o:04X} {unicodedata.name(ch,'?')}")
ok = result("零 emoji / 零箭头符号", not emoji, "; ".join(sorted(set(emoji))) or "无")
if not ok: fails.append("emoji")

lorem = re.findall(r'lorem|ipsum|dolor sit|某某科技|张三|李四|Acme', html, re.I)
ok = result("零 Lorem / 零编造占位名", not lorem, str(lorem) or "无")
if not ok: fails.append("lorem")

# ---------- 3. :root 内联 vs 预设逐变量比对 ----------
def root_block(css_text):
    i = css_text.index(":root")
    j = css_text.index("{", i)
    depth, k = 0, j
    while k < len(css_text):
        if css_text[k] == "{": depth += 1
        elif css_text[k] == "}":
            depth -= 1
            if depth == 0: break
        k += 1
    return css_text[i:k+1]

def vars_of(block):
    body = block[block.index("{")+1: block.rindex("}")]
    body = re.sub(r'/\*.*?\*/', '', body, flags=re.S)
    out = {}
    order = []
    for m in re.finditer(r'(--[a-z0-9-]+)\s*:\s*([^;]+);', body):
        out[m.group(1)] = m.group(2).strip()
        order.append(m.group(1))
    return out, order

preset_css = PRESET.read_text(encoding="utf-8")
pv, po = vars_of(root_block(preset_css))
fv, fo = vars_of(root_block(html))
ok = result(":root 变量数量一致", len(pv) == len(fv), f"预设 {len(pv)} 个 / frame 内联 {len(fv)} 个")
if not ok: fails.append("变量数量")
missing = [k for k in pv if k not in fv]
extra = [k for k in fv if k not in pv]
ok = result(":root 变量名集合一致", not missing and not extra, f"缺={missing} 多={extra}")
if not ok: fails.append("变量名集合")
diff = [(k, pv[k], fv[k]) for k in pv if k in fv and pv[k] != fv[k]]
ok = result(":root 逐条取值一致", not diff, "全部逐字相同" if not diff else json.dumps(diff, ensure_ascii=False))
if not ok: fails.append("取值不一致")

# ---------- 4. :root 之外的色值 ----------
style_m = re.search(r'<style[^>]*>(.*?)</style>', html, re.S)
css = style_m.group(1)
css_nocomment = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
rb = root_block(css_nocomment)
outside = css_nocomment.replace(rb, "\n", 1)
rest = outside + re.sub(r'<style[^>]*>.*?</style>', '', html, flags=re.S)  # CSS 其余部分 + 全部 HTML
hexes = re.findall(r'#[0-9a-fA-F]{3,8}\b', rest)
# 排除 <use href="#id"> 与 href="#" 的锚点（# 后不是 3/6/8 位纯 hex 的已由上面正则限定了，这里再排 href）
hexes = [h for h in hexes if not re.search(r'href\s*=\s*["\']' + re.escape(h), rest)]
rgbs = re.findall(r'\brgba?\s*\(', rest)
named_raw = re.findall(r'(?:^|[;{:\s])((?:color|background|background-color|border|border-color|border-top|border-bottom|border-left|border-right|outline|outline-color|fill|stroke)\s*:\s*[^;{}]+)', outside)
NAMED = {"transparent","currentcolor","inherit","none","initial","unset","auto"}
named_used = []
for decl in named_raw:
    val = decl.split(":",1)[1]
    for tok in re.findall(r'[a-zA-Z-]+', val):
        t = tok.lower()
        if t in NAMED: continue
        if t.startswith("var") or t in ("srgb","color","mix","in"): continue
        if t in ("solid","dashed","dotted","hidden","nowrap","right","left","center","underline","2px","1px","3px","0"): continue
        if re.match(r'^(px|em|rem|s|ms|vh|vw|deg|is-active|is-checked|is-partial|sprite|icon)$', t): continue
        named_used.append(t)
ok = result(":root 之外零 #hex", not hexes, str(hexes) or "无")
if not ok: fails.append(":root 外 hex")
ok = result(":root 之外零 rgb()/rgba()", not rgbs, str(rgbs) or "无")
if not ok: fails.append(":root 外 rgb()")
print("NOTE  :root 之外出现的非 var 颜色关键字 -> " + (", ".join(sorted(set(named_used))) if named_used else "无"))
print("NOTE  :root 之外的 color-mix() 用量 -> %d 处（派生自 var(--color-*)）" % len(re.findall(r'color-mix\s*\(', outside)))

# ---------- 5. 字号 / 间距 / 行高 ----------
def decls(text):
    return re.findall(r'([a-z-]+)\s*:\s*([^;{}]+)', text)

d = decls(outside)
bad_fs = [(p, v.strip()) for p, v in d if p == "font-size" and not re.fullmatch(r'var\(--text-[a-z0-9]+\)', v.strip())]
ok = result("font-size 全部走 var(--text-*)", not bad_fs, str(bad_fs) or "全部合规")
if not ok: fails.append("font-size 非 token")
def space_ok(v):
    v = v.strip()
    parts = re.split(r'\s+', v)
    return all(p == "0" or p == "auto" or re.fullmatch(r'var\(--space-[0-9]\)', p) for p in parts)
bad_sp = [(p, v.strip()) for p, v in d if p in ("padding","margin","gap","row-gap","column-gap","padding-top","padding-bottom","padding-left","padding-right","margin-top","margin-bottom","margin-left","margin-right") and not space_ok(v)]
ok = result("内外边距/gap 全部走 var(--space-*)", not bad_sp, str(bad_sp) or "全部合规")
if not ok: fails.append("间距非 token")
bad_lh = [(p, v.strip()) for p, v in d if p == "line-height" and not re.fullmatch(r'var\(--leading-[a-z]+\)', v.strip())]
ok = result("line-height 全部走 var(--leading-*)", not bad_lh, str(bad_lh) or "全部合规")
if not ok: fails.append("line-height 非 token")
bad_col = [(p, v.strip()) for p, v in d if p in ("color","background","background-color","border-color","outline-color","fill","stroke","box-shadow") and not re.search(r'var\(--(color|shadow)-', v)]
print("NOTE  颜色类声明共 %d 条，其中非 var(--color-*)/var(--shadow-*) 的 -> %s" % (len([1 for p,_ in d if p in ("color","background","background-color","border-color","outline-color","fill","stroke","box-shadow")]), json.dumps(bad_col, ensure_ascii=False)))

# ---------- 6. 表格金额右对齐 + 等宽数字 ----------
ok = result(".num 右对齐 + tabular-nums",
            re.search(r'\.num\s*\{[^}]*text-align:\s*right[^}]*\}', outside) is not None
            and re.search(r'\.num\s*\{[^}]*font-variant-numeric:\s*tabular-nums[^}]*\}', outside) is not None,
            "规则 .num { text-align: right; font-variant-numeric: tabular-nums }")
if not ok: fails.append(".num 规则")
th_amount = re.search(r'<th class="num">([^<]*)</th>', html)
td_amount = re.findall(r'<td class="num amount">([^<]*)</td>', html)
ok = result("金额列 th/td 都套 .num", th_amount is not None and len(td_amount) == 7,
            f"表头='{th_amount.group(1) if th_amount else None}' 金额单元格 {len(td_amount)} 个: {td_amount}")
if not ok: fails.append("金额列类名")

# ---------- 7. 数据自洽 ----------
counts = dict(re.findall(r'>(全部|待支付|生效中|退款中|已关闭)<span class="tab-num">([\d,]+)<', html))
counts = {k: int(v.replace(",", "")) for k, v in counts.items()}
total = counts.get("全部")
sub = sum(v for k, v in counts.items() if k != "全部")
ok = result("状态筛选计数之和 = 全部", total == sub, f"{' + '.join(f'{k} {v}' for k,v in counts.items() if k!='全部')} = {sub} / 全部 = {total}")
if not ok: fails.append("状态计数不自洽")

amounts = [float(x.replace("¥","").replace(",","")) for x in td_amount]
sel_rows = re.findall(r'<tr class="is-selected">.*?<td class="num amount">([^<]+)</td>', html, re.S)
sel_vals = [float(x.replace("¥","").replace(",","")) for x in sel_rows]
bulk = re.search(r'已选 <strong>(\d+)</strong> 笔 · 合计 <strong class="bulk-sum">([^<]+)</strong>', html)
n_bulk, sum_bulk = int(bulk.group(1)), float(bulk.group(2).replace("¥","").replace(",",""))
ok = result("已选 N 笔 · 合计 与勾选行一致",
            n_bulk == len(sel_vals) and abs(sum_bulk - sum(sel_vals)) < 0.005,
            f"文案 已选 {n_bulk} 笔 合计 ¥{sum_bulk:,.2f} / 勾选 {len(sel_vals)} 行 {[f'¥{v:,.2f}' for v in sel_vals]} 求和 ¥{sum(sel_vals):,.2f}")
if not ok: fails.append("已选合计不自洽")

# 表尾总数 / 分页
foot = re.search(r'共 <strong>([\d,]+)</strong> 条 · 每页 <strong>(\d+)</strong> 条', html)
print("NOTE  表尾 -> 共 %s 条 · 每页 %s 条；实际渲染行数 %d" % (foot.group(1), foot.group(2), len(amounts)))
pages = re.findall(r'<button class="pg[^"]*"[^>]*>(\d+)</button>', html)
print("NOTE  分页按钮 -> %s（总页数应为 ceil(1286/20)=65）" % pages)

# ---------- 8. 交互语义 ----------
clickables = re.findall(r'<(div|span|td|li|p|section|h[1-6])\b[^>]*(?:onclick|role="button"|tabindex)', html, re.I)
ok = result("可点击元素均为 button/a（无 div/span 冒充按钮）", not clickables, str(clickables) or "无")
if not ok: fails.append("非button/a可点击")
input_m = re.search(r'<input\b[^>]*>', html)
ok = result("输入框有 aria-label 或 label 包裹",
            input_m is not None and 'aria-label' in input_m.group(0) and '<label class="search">' in html,
            input_m.group(0) if input_m else "无 input")
if not ok: fails.append("输入框无标签")
# 语义不只靠颜色：状态 pill 有文字
pills = re.findall(r'<span class="pill pill-\w+">([^<]+)</span>', html)
ok = result("状态不只靠颜色（pill 带文字）", all(p.strip() for p in pills) and len(pills) == 7,
            "7 个状态 pill: " + " / ".join(sorted(set(pills))))
if not ok: fails.append("状态仅靠颜色")
print("NOTE  aria 标注统计 -> role/aria-* 共 %d 处；图标 aria-hidden 共 %d 处" % (
    len(re.findall(r'aria-[a-z]+=|role=', html)), len(re.findall(r'aria-hidden="true"', html))))

# ---------- 9. 图标引用完整性 / id 唯一 ----------
symbols = set(re.findall(r'<symbol id="([^"]+)"', html))
uses = set(re.findall(r'<use href="#([^"]+)"', html))
broken = sorted(uses - symbols)
ok = result("所有 <use> 引用都有对应 <symbol>", not broken, f"symbol {len(symbols)} 个 / use 引用 {len(uses)} 个；缺失={broken or '无'}")
if not ok: fails.append("图标引用断裂")
ids = re.findall(r'\sid="([^"]+)"', html)
dup = sorted({i for i in ids if ids.count(i) > 1})
ok = result("id 唯一", not dup, str(dup) or f"{len(ids)} 个 id 无重复")
if not ok: fails.append("id 重复")

# ---------- 10. 中文排版机械项 ----------
cjk = r'[\u4e00-\u9fff]'
# 中英之间缺空格：中文紧跟拉丁字母/数字，或拉丁/数字紧跟中文（排除单位与专有写法）
nocjk_space = []
for m in re.finditer(cjk + r'[A-Za-z0-9]', html):
    nocjk_space.append(m.group(0))
for m in re.finditer(r'[A-Za-z0-9]' + cjk, html):
    nocjk_space.append(m.group(0))
ok = result("中英文之间无粘连（机械扫描）", not nocjk_space, json.dumps(sorted(set(nocjk_space)), ensure_ascii=False) or "无粘连")
if not ok: fails.append("中英粘连")
halfwidth = re.findall(r'[\u4e00-\u9fff][,;!?]', html)
ok = result("中文句子内无半角标点", not halfwidth, json.dumps(sorted(set(halfwidth)), ensure_ascii=False) or "无")
if not ok: fails.append("半角标点混用")
# 正文（含中文的文本节点）字号 >= 14px：抽查 body 基础字号
body_fs = re.search(r'body\s*\{[^}]*font-size:\s*([^;]+);', outside)
body_lh = re.search(r'body\s*\{[^}]*line-height:\s*([^;]+);', outside)
print("NOTE  body 基准 -> font-size: %s ; line-height: %s（--text-sm=14px, --leading-normal=1.65）" % (body_fs.group(1).strip(), body_lh.group(1).strip()))

# ---------- 11. h1 / 主操作 ----------
h1 = re.findall(r'<h1[^>]*>(.*?)</h1>', html, re.S)
ok = result("恰好一个 h1 主标题", len(h1) == 1, f"{len(h1)} 个: {h1}")
if not ok: fails.append("h1 数量")
prims = re.findall(r'class="btn btn-primary"[^>]*>(.*?)</button>', html, re.S)
ok = result("恰好一个主色按钮 btn-primary", len(prims) == 1, f"{len(prims)} 个: {re.sub(r'<[^>]+>', '', prims[0]).strip() if prims else None}")
if not ok: fails.append("主操作数量")

print()
print("SUMMARY fails=%d %s" % (len(fails), json.dumps(fails, ensure_ascii=False)))
