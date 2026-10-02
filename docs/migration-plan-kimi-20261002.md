> ⚠️ **本文档已过时（存档用）**
>
> 这是 Kimi 于 2026-10-02 编写的迁移方案，其中提议的目标路径
> （`F:\Code_X\agent_work\ai-workflow\`，子目录 `backend\` / `frontend\`）
> **未被采用**。
>
> **实际采用的方案**：
> - 项目根目录：`F:\work\ai-workbench\`
> - 子目录：`api\`（后端）与 `web\`（前端）
> - 迁移已于 2026-10-02 完成并验证
>
> 现存的约定请看 `AGENTS.md`（项目根目录）。
> 保留本文档是因为其中的**占用排查步骤**（1.2 节）与**迁移前检查项**仍然有参考价值。

---
# 项目迁移与统一管理清单

> 目标：把前端（Kimi 维护）与后端（DeepSeek 维护）收拢到统一根目录，便于整体管理。
> 编写时间：2026-10-02。以下「现状」均为当日实测。

---

## 0. 现状盘点（已摸查）

| 项 | 前端 | 后端 |
| --- | --- | --- |
| 当前路径 | `F:\KimiData\kimi\Workspaces\AI-work\workflow-platform` | `F:\Code_X\agent_work\ai-workbench` |
| Git 仓库 | ❌ 否（只有 .gitignore） | ✅ 是（有 .git） |
| 敏感文件 | 无 | ⚠️ 有 `.env`（必须随目录一起动） |
| 数据文件 | localStorage（浏览器侧，不受影响） | ⚠️ `data/` 目录（SQLite，随目录动） |
| 路径硬编码 | ✅ 零处 | ⚠️ 仅 1 处：`docs/frontend-integration-checklist.md`（文档引用，非代码） |
| 部署配置 | 无 | `ecosystem.config.cjs`（PM2）、`Dockerfile`、部署 tar 包——⚠️ 未逐一检查内部路径 |
| 体积大头 | node_modules / dist / .vite | node_modules / dist / 部署包 |

关键事实：**两个项目都在 F: 盘**，同盘移动是瞬时重命名，node_modules 直接带走即可，无需重装。

⚠️ **已实测的坑**：直接 `mv` 后端目录报 Permission denied——当时没有进程监听项目端口，但目录仍被占用（极可能是资源管理器窗口、编辑器、终端的 cwd 停在里面）。迁移前必须按 1.2 逐项关闭。

---

## 1. 迁移前准备

### 1.1 定目标结构（先拍板再动手）

建议（与现有 `agent_work` 平级管理，命名直白）：

```
F:\Code_X\agent_work\ai-workflow\
  ├─ backend\      ← 现 ai-workbench
  └─ frontend\     ← 现 workflow-platform
```

备选：`F:\Projects\ai-workflow\...`。选哪个都行，但**定下来就不要再动第二次**——两边的文档、脚本、AI 助手上下文都要跟着改。

### 1.2 关闭一切占用源（上次失败的根因）

- [ ] 关闭后端的所有运行实例（`npm run start:server` / PM2 / Docker 容器）
- [ ] 关闭前端的 dev server（vite）
- [ ] 关闭打开着这两个目录的 VS Code / 编辑器窗口
- [ ] 关闭 cwd 停在项目目录里的终端（包括 DeepSeek 的会话终端）
- [ ] 关闭停在项目目录的资源管理器窗口
- [ ] 自检：`netstat -ano | findstr "LISTENING"` 确认项目端口无监听

### 1.3 安全兜底

- [ ] 后端：`git status` 确认无未提交改动；有则先 commit 或 stash（**移动不丢 git 历史，但脏工作区出问题时难定位**）
- [ ] 后端：确认 `.env` 存在且包含全部密钥（移动后第一件事就是核对它还在）
- [ ] 前端：当前不在 git 里——**建议迁移后顺手 `git init` 纳管**（见 3.4），迁移前可先整目录压缩备份一份
- [ ] 记录两边当前 commit / 文件状态，作为回退基准

---

## 2. 迁移执行（按序）

- [ ] 2.1 创建根目录 `F:\Code_X\agent_work\ai-workflow`
- [ ] 2.2 移动后端：`ai-workbench` → `ai-workflow\backend`
- [ ] 2.3 移动前端：`workflow-platform` → `ai-workflow\frontend`
- [ ] 2.4 立刻核对：后端 `.env`、`data/`、`.git` 三者都在新位置
- [ ] 2.5 原位置确认已空，无残留副本

---

## 3. 迁移后验证（必须全绿才算完）

### 3.1 后端（在新路径下）

- [ ] `npm test` —— 740 测试应保持 739+ 通过（迁移前的基线）
- [ ] `node server/apiContract.test.cjs` —— 契约验证 21/21
- [ ] 检查 `ecosystem.config.cjs` / `Dockerfile` / 部署脚本里是否有旧绝对路径
- [ ] `.env` 里的相对路径配置（如 `outputDir`、`dbPath`）确认不受目录迁移影响

### 3.2 前端（在新路径下）

- [ ] `npm run build` 通过
- [ ] `npm run dev` 能起，页面正常（浏览器 localStorage 按 origin 存，换路径不影响已存的草稿）
- [ ] `node backend/scripts/checkRegistrySync.cjs <新前端路径>` 输出「一致」

### 3.3 路径引用更新

- [ ] 后端 `docs/frontend-integration-checklist.md`：更新文中两个仓库路径
- [ ] 后端其他文档若提到旧路径一并更新（已实测只有这一处，但迁移后建议再 grep 一遍旧路径字符串确认）
- [ ] 若有 VS Code workspace 文件 / 收藏夹 / 快捷方式，更新指向

### 3.4 统一管理收尾

- [ ] 前端 `git init` + 首次提交（.gitignore 已就绪），或作为子目录纳入某个父仓库——**与后端保持各自独立仓库**，不要合并成一个
- [ ] 根目录放一个 `README.md`：说明前后端分工、启动命令、各自负责人（Kimi / DeepSeek）
- [ ] 可选：根目录加 `ai-workflow.code-workspace`，一个窗口开两个文件夹

---

## 4. 两边 AI 助手的上下文切换（容易忘）

- [ ] **告诉 DeepSeek**：后端新路径 `F:\Code_X\agent_work\ai-workflow\backend`，注册表同步脚本用法变为
  `node scripts/checkRegistrySync.cjs F:\Code_X\agent_work\ai-workflow\frontend`
- [ ] **告诉 Kimi（我）**：前端新路径 `F:\Code_X\agent_work\ai-workflow\frontend`——迁出 Kimi 工作区后，后续改动我会直接基于新路径操作；工作区里 `reference-docs\` 的文档快照保持只读参考
- [ ] 后端文档里给前端的对接清单，以新路径为准再发一次（或确认我已读到更新版）

---

## 5. 不做的事（明确边界）

- ❌ 不合并前后端为一个 git 仓库（独立仓库、独立提交历史）
- ❌ 不动后端 `.env` 内容、不动 `data/` 数据库内容
- ❌ 不在迁移的同时做代码改动（迁移和改动分开，出问题好定位）
- ❌ 不删除 Kimi 工作区里的 `reference-docs\` 快照（保留作只读参考）
