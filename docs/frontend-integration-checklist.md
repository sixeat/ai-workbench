# 前端对接清单（后端 → 前端）

> 面向对象：负责 `frontend/` 前端的 AI / 开发者。
> 后端已完成并验证。本清单说明**前端需要配合的改动**，按优先级排列。
>
> 项目结构：`F:\work\ai-workbench\` 下有 `backend\`（后端）与 `frontend\`（前端）。
> 下文路径均相对于项目根目录。
>
> 核对基准：后端 **594 测试 / 593 通过**，契约验证 **21/21 通过**。
>
> **进度更新（2026-10-02）**：下述两项 P0 已完成 ——
> 视频轮询超时已提到 30 分钟（`frontend/src/lib/runner.js` 的 `callVideo`），
> 注册表副本已同步（双侧哈希一致）。
>
> 另：后端内嵌的旧前端（原 `backend/src/`，含 30 个测试）已移除，由 `frontend/` 取代。
> 因此后端测试数由 740 降为 594。

---

## 结论先行

前端已完成的对接**质量很高**，契约层面 **21 项全部对得上**：

- `Authorization: Bearer` 头 ✅（后端确实两种都收）
- `login` 传 `username` 字段 ✅（后端确实是 `email` 的别名）
- 错误不套信封、`DELETE` 返回 JSON 主体 ✅
- 边字段 `data.sourceKey`/`targetKey`、哨兵 `__main_output`/`__main_input` ✅
- 执行指纹 `fingerprint(type, config, inputs, modelContext)` ✅
- `runner.js` 覆盖全部 **22** 个节点类型 ✅

**但有 1 个必修缺陷会让视频功能在真实使用中 100% 失败。**

---

## P0 · 必修：视频轮询超时

### 现象

`src/lib/runner.js` 的 `callVideo()` 用 `pollTask(taskId)`，走的是 `src/lib/api.js:116` 的默认值：

```js
export async function pollTask(taskId, { intervalMs = 2000, timeoutMs = 10 * 60 * 1000 } = {}) {
```

**默认 10 分钟。**

### 为什么必须改

后端实测的真实视频耗时（同一模型 `wan2.7-t2v`、2 秒 720P）：

| 实测 | 耗时 |
| --- | --- |
| 第 1 次 | 9 分 41 秒 |
| 第 2 次 | 11 分 4 秒 |
| 第 3 次 | 12 分 57 秒 |
| 第 4 次（第三方残留任务） | 19 分 |

**全部 ≥ 10 分钟**，且波动很大（取决于上游队列）。

### 不改的后果

```
前端 10 分钟 → 抛 ApiError('任务轮询超时')
后端           → 仍在跑，11~19 分钟后成功
积分           → 入队时已扣，不会自动退
用户看到的      → "任务失败"，但钱花了、视频其实生成了
```

用户还得自己去任务列表翻产物 —— **这是最难解释的一类 bug**。

### 改法

**推荐**：在调用点分别指定，而不是改全局默认值（否则文本任务也要等 30 分钟才报错）。

> ⚠️ **用函数名定位，不要依赖行号**——这份清单写就时前端文件正在被编辑，行号会漂移。
> 在 `src/lib/runner.js` 里搜 `await pollTask(taskId)`，会命中三处：

| 所属函数 | 现在 | 改为 |
| --- | --- | --- |
| **`callVideo()`** | `const task = await pollTask(taskId);` | `const task = await pollTask(taskId, { timeoutMs: 30 * 60 * 1000 });` |
| **`callImage()`** | `const task = await pollTask(taskId);` | `const task = await pollTask(taskId, { timeoutMs: 5 * 60 * 1000 });` |
| `callChat()` | `const task = await pollTask(taskId);` | 不用改 |

> 30 分钟是留了余量。实测最长 19 分钟，但上游队列会波动。

**定位锚点**（清单写就时的实际内容）：

```js
// src/lib/runner.js — callVideo() 内
const { taskId } = await wb.gen.video(opts);
const task = await pollTask(taskId);          // ← 这一行
```

```js
// src/lib/runner.js — callImage() 内
const { taskId } = await wb.gen.image(opts);
const task = await pollTask(taskId);          // ← 这一行
```

`src/lib/api.js` 的默认值（**可以不改**，改调用点更精确）：

```js
export async function pollTask(taskId, { intervalMs = 2000, timeoutMs = 10 * 60 * 1000 } = {}) {
```

### 更好的做法（可选）

视频改走**服务端运行**，前端完全不轮询任务。详见下文「P1 · 可选的架构升级」。

### 顺带建议

超时后不要直接显示"失败"——**任务还在后台跑**。前端应当：

1. 提示"生成时间较长，已转入后台"
2. 把 `taskId` 存下来
3. 提供"刷新状态"入口，重新 `GET /api/tasks/:id`

后端已验证这条路径可用：前端超时后仍能重新查询到终态与产物。

---

## ~~P0~~ · 已完成：同步节点注册表副本

> ✅ **2026-10-02 已完成**，当前双侧哈希一致（`377899a3…`）。
> 以下保留作为**未来再出现不一致时的处理方式**。

### 现象（当时）

`frontend/src/data/node-registry.json` 是后端 `backend/docs/node-registry.json` 的副本。
后端加了定价段后，副本一度过期：

```
后端最新（当时） sha256 377899a3781083ce200f696ac070b189494a5b530593885958955cd6a8c17a82
前端副本（当时） sha256 2dcb8b4f7d0cbb4254590e3ca1f5b0817b2a5008ab9dee3af7beef5e915af50e
```

### 改法（相对路径，换机器也适用）

在项目根目录 `F:\work\ai-workbench\` 下执行：

```
copy "api\docs\node-registry.json" "web\src\data\node-registry.json"
```

或直接在项目根目录跑校验（会给出准确的复制命令）：

```
node backend\scripts\checkRegistrySync.cjs frontend
```

### 安全性

**纯增量**：只多了 `creditPricing` 段。22 个节点类型、端口、配置字段、`mustNotInvent` 全部未变，不会破坏现有前端。

### 新增内容

```jsonc
{
  "creditPricing": {
    "note": "计费规则说明",
    "units": { "imagePerItem": "...", "textPerRequest": "...", "videoPerSecond": "..." },
    "fallbackDefaults": { "imagePerItem": 10, "textPerRequest": 1, "videoPerSecond": 20, ... },
    "benchmark": "图片 10 积分 ≈ ¥0.4；文本 1 积分 ≈ ¥0.005；视频 75 积分/秒 ≈ ¥0.6",
    "presets": [ /* 8 条按模型定价的档位 */ ]
  }
}
```

### 防止再次悄悄过期

后端新增了校验命令：

```
npm run check:registry-sync <前端项目路径>
```

副本过期时会指出两份哈希与复制命令。**建议在改节点定义后跑一次。**

---

## P1 · 可选的架构升级：改用服务端运行

### 背景

视频要 11~19 分钟，**浏览器会话天然不适合承载这种时长**。后端已实现服务端编排：**用户关掉页面，流水线照样跑完**。

### 端点（`docs/api-contract.md` §3.8）

需要后端设 `WORKBENCH_SERVER_SIDE_RUNS=true`（**默认关闭**，需与后端确认已开启）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/workflow-runs` | 提交运行，返回 **201** + `{run, nodes}` |
| `GET` | `/api/workflow-runs/:runId` | 查询运行与各节点状态 |
| `GET` | `/api/workflow-runs/:runId/plan` | 查看推进计划（哪些就绪/被阻塞） |
| `POST` | `/api/workflow-runs/:runId/cancel` | 取消（软取消，会退款） |
| `POST` | `/api/workflow-runs/:runId/retry` | 重跑失败节点 |
| `GET` | `/api/workflow-runs` | 列出运行 |

提交：

```json
POST /api/workflow-runs
{ "workflowId": "<id>", "idempotencyKey": "<可选，幂等键>" }
```

### 好处

- 前端**不需要**自己轮询任务，只需按需查询运行状态
- 断线/关页面不影响执行
- 各节点的 `status` / `durationMs` / `error` 由服务端维护，前端直接渲染
- 崩溃后可恢复（后端有 reconcile 机制）

> **注意**：若仍保留前端逐任务轮询的模式，请务必完成上面的 P0 超时修复。

---

## P2 · 建议：显示积分单价与预估成本

### 为什么重要

**一条 5 秒视频 = 375 积分**（75 积分/秒 × 5 秒），而一张图片只要 10 积分。用户在点"运行"前看不到这个数字，**很容易刷爆积分**。

### 定价档位（来自注册表 `creditPricing.presets`）

| 模型档 | 积分单价 | 实际上游成本 |
| --- | --- | --- |
| 文本 | 1 / 次 | ≈ ¥0.005 |
| 图片（wan2.7-image / wan2.6-image / wanx2.1） | 10 / 张 | ≈ ¥0.4 |
| 图片 Pro（wan2.7-image-pro，4K） | 30 / 张 | 更高 |
| 视频（wan*-t2v* / wan*-i2v*） | **75 / 秒** | ≈ ¥0.6/秒 |

**标定基准**：图片 10 积分 ≈ ¥0.4，即 **1 积分 ≈ ¥0.04**。

### 建议

1. 节点面板或运行按钮旁显示**预估成本**
2. 运行前若有明显消耗（如视频），给一次确认
3. 用 `GET /api/credits/me` 显示余额

### 计费时机

**任务入队时即扣费**。任务对象里带明细：

```json
{
  "creditCost": 375,
  "creditStatus": "charged",
  "creditKeyScope": "server_key",
  "billing": { "unit": 75, "unitName": "second", "quantity": 5 }
}
```

> **用户自有 Key（`creditKeyScope = user_key`）默认不扣积分。**

### 后端定价的 5 层回退（前端不必实现，了解即可）

1. 平台模型能力表里的 `creditCost`（运营覆盖价）
2. 平台模型路由所指 apiKeyModel 的 `creditCost`
3. 直接选 apiKeyModel 的 `creditCost`
4. 按 `model` + `providerId` 回算能力 preset
5. 全局默认价（环境变量）

**`0` 是合法的免费定价**，不是"未配置"。

---

## P2 · 建议：断线恢复

用户关页面再回来时，用 `GET /api/workflow-runs/:runId` 取回全部状态与产物。

若走的是逐任务模式，则用 `GET /api/tasks/:id` 恢复。

---

## 已验证无需改动的部分

以下是后端实测确认**前端已经写对**的，作为回归保护列出，**不要改**：

| 项 | 验证结果 |
| --- | --- |
| `GET /api/health` | HTTP 200，`status=ok` |
| `POST /api/auth/login` 传 `{username, password}` | HTTP 200，正确下发 `ai_workbench_session` |
| `Authorization: Bearer <token>` | 后端接受（与 `x-workbench-token` 等效） |
| `GET /api/auth/me` | `{user}` |
| 工作流 CRUD（含 duplicate / versions / restore） | 全部可用 |
| `GET /api/workflows` / `/api/assets` / `/api/tasks` | 均返回 `{..., count}` 形状 |
| `POST /api/images` / `/api/videos` | 202 + `taskId` |
| `POST /api/tasks/:id/cancel` | 200 |
| `POST /api/tasks/:id/retry` | 已取消任务返回 400 + `Only failed tasks can be retried.`——**这是正确防御，前端不必处理成错误弹窗** |
| 边字段 / 哨兵 / 目标推导 / 执行指纹 / `modelSource:'inherit'` | 与后端语义完全一致 |
| 节点类型覆盖 | `runner.js` 命中全部 22 个类型 |
| 资产相对路径补 API 前缀 | 处理正确 |

---

## 硬约束（重申）

`registry.mustNotInvent` 里的东西**后端不存在**，前端不得引入：

- 条件分支 / 条件判断（执行引擎只做拓扑排序与循环检测，无分支求值）
- 循环 / 迭代节点
- 知识库 / 向量检索节点
- 工具调用 / 函数调用节点
- 触发器类节点（入口只能是文本输入与图片输入）
- 任意形式的多分支路由

**新增类型不会报错，但保存后无法执行**——这是静默失败。

---

## 附：实测数据参考

### 视频耗时（`wan2.7-t2v`，2 秒 720P）

| 次 | 耗时 |
| --- | --- |
| 1 | 9 分 41 秒 |
| 2 | 11 分 4 秒 |
| 3 | 12 分 57 秒 |
| 4 | 19 分 0 秒 |

**结论：波动很大，前端超时至少给 30 分钟。**

### 成本

| 操作 | 上游成本 |
| --- | --- |
| 一次文本（qwen-plus） | ¥0.0047 |
| 一张图片（wan2.7-image） | ¥0.4 |
| 一条 5 秒视频（720P） | ≈ ¥3 |

**一条 10 镜的片子**（10 图 + 10 条 5 秒视频）≈ **¥4 图片 + ¥30 视频 = ¥34**，视频占 88%。

---

## 优先级汇总

| 优先级 | 事项 | 定位方式 |
| --- | --- | --- |
| **P0** | 视频轮询超时提到 30 分钟 | `src/lib/runner.js` 的 `callVideo()` / `callImage()`，搜 `pollTask(taskId)` |
| **P0** | 同步注册表副本 | `src/data/node-registry.json` |
| P2 | 显示单价与预估成本 | 用注册表的 `creditPricing.presets` |
| P2 | 断线恢复 | `GET /api/workflow-runs/:runId` |
| 可选 | 视频改走服务端运行 | `POST /api/workflow-runs` |

> 本清单写就时（后端 740 测试全绿）的实测状态：`api.js` 默认超时仍是 10 分钟，
> `runner.js` 三处 `pollTask` 均未传 `timeoutMs`，注册表副本哈希仍为旧值 `2dcb8b4f…`。

---

## 改完怎么自查

不需要真花钱调用视频就能验证关键路径。

### 1) 确认超时改对了

在 `src/lib/runner.js` 搜 `pollTask(`，确认 `callVideo` 那处带了 `timeoutMs`：

```bash
# 在 frontend 仓库根目录
grep -n "pollTask(" src/lib/runner.js
```

三处都应当是 `pollTask(taskId` 或 `pollTask(taskId, {...})`，
其中 **`callVideo` 那处必须带 `timeoutMs`**。

### 2) 确认注册表一致

在项目根目录 `F:\work\ai-workbench\` 下执行：

```bash
node backend/scripts/checkRegistrySync.cjs frontend
```

输出 `一致` 即通过；输出 `过期` 会给出准确的复制命令。

### 3) 确认节点类型没被改动

在 `frontend/` 目录下执行：

```bash
node -e "const r=require('./src/data/node-registry.json');console.log(r.summary.nodeTypeCount, Object.keys(r.summary.categories).join(','), r.creditPricing.presets.length)"
```

应当输出：`22 input,parameter,text,image,video,utility,output 8`

### 4) 契约冒烟（后端需可访问）

后端自带的契约验证脚本会打真实 HTTP 请求，覆盖前端 `api.js` 的每个调用：

```bash
cd F:/work/ai-workbench/api
node server/apiContract.test.cjs        # 双向字段校验
```

---

## 参考文档（后端仓库）

| 文档 | 内容 |
| --- | --- |
| `docs/api-contract.md` | 全部 88+6 个端点、计费模型、服务端运行章节 |
| `docs/node-registry.json` | 节点清单 + 端口 + 配置字段 + 定价档位 |
| `docs/workflow-execution-semantics.md` | 执行语义：端口信封、哨兵、推断规则、指纹 |
