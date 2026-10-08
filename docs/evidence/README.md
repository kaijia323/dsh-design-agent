# 证据目录说明

**这个目录里入库的是"文本证据"，不入库的是"可视证据"。**

| 类型 | 是否入库 | 在哪 |
|---|---|---|
| 验收结论、命令、原始输出（Markdown/YAML/脚本） | ✅ 入库 | 本目录与 `docs/verification-feature-dsh-design-canvas.md` |
| 截图、录屏（PNG/WebP/MP4） | ❌ 不入库，留在本地磁盘 | 本目录 `*.png` 与 `.playwright-mcp/ac-evidence/` |

## 为什么不入库

截图体积大（本仓库曾有 11 张、约 1.3 MB，占仓库总体积七成），而且它们要么**可由脚本重新生成**，
要么是**某一时刻的快照**——后者即便重跑也证明不了同一件事。入库的是结论与可复核的命令/输出，
可视证据留在本地供人眼复核。

## 需要看图时怎么复现

- **设计模板预览**（`docs/design-preview/`）：见该目录的 `README.md`，里面有逐张的复现命令。
- **验收截图**：原始证据在 `.playwright-mcp/ac-evidence/`（含总索引 `EVIDENCE-INDEX.md`）；
  按 `docs/verification-feature-dsh-design-canvas.md` §2 的环境说明重跑即可。
- **当前成品长什么样**：打开 GUI `http://127.0.0.1:3080` → 右侧栏添加标签 → 「设计预览」。

> 注：`.gitignore` 里对 `docs/evidence/**/*.png` 与 `docs/design-preview/*.png` 显式设了忽略规则。
> 如果将来有需要入库的示意图（例如架构图），改放到别的目录，别把这条规则放宽。
