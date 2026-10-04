# 服务端工作流运行 API 契约

> **阶段 0 冻结件**（前后端协作计划书第五节）。消费方：`frontend/`。
> 本文只描述**已实现的行为**，每条都标注了出处文件与行号；标注 ⚠️ 的地方是
> 「声明与实现不一致」，前端按本文写，不要按字段名猜语义。

---

## 零、先读这一条：功能开关默认关闭 ⚠️

这是接入前必须知道的**唯一前提**，否则会得到「提交成功但永远不跑」。

| 事实 | 出处 |
| --- | --- |
| 6 个运行路由**无条件注册** | `server/routes/workflowRunRoutes.cjs` |
| 推进运行的 worker 需要 `WORKBENCH_SERVER_SIDE_RUNS=true` 才启动 | `server/app.cjs:254`、`server/workers/workflowRunWorker.cjs:219` |
| 该开关**默认 false** | `parseBoolean(env.WORKBENCH_SERVER_SIDE_RUNS, false)` |
| 开关关闭时 `POST` 直接返回 **503**，不创建运行 | `server/routes/workflowRunRoutes.cjs` |

**开关关闭时的表现**（2026-10-03 起）：

```json
503 { "error": "Server-side workflow runs are disabled on this server. Set WORKBENCH_SERVER_SIDE_RUNS=true to enable them." }
```

护栏在查库之前，所以即使 `workflowId` 不存在也会先返回 503 而不是 404。
文案里直接给出打开方式——这是刻意的，免得运维回头翻源码。

> 在此之前的行为是「返回 201，然后运行永远停在 `queued`、不报任何错」，静默且难查。
> 决策记录：**只在功能开关关闭时拒绝；不看本进程有没有跑 worker**，
> 因为分进程部署下 API 进程本来就是 `WORKBENCH_START_WORKERS=false`（见第八节第 1 项）。

启用方式：

```bash
WORKBENCH_SERVER_SIDE_RUNS=true
```

启动横幅会打印实际状态（`Server-side workflow runs: enabled|disabled`），不用发请求就能确认。

### 分进程部署（模式三）目前跑不了 ⚠️

**单进程**（`npm start` / `npm run start:server`）下开关打开即可闭环推进。
但模式三（`start:api` + `start:worker`）**不行，且与开关无关**：

| 事实 | 出处 |
| --- | --- |
| `start:api` 强制 `WORKBENCH_START_WORKERS=false`，运行 worker 因此不启动 | `server/api.cjs:1`、`server/app.cjs:283` |
| 独立的 worker 进程**根本没有装配**运行推进器 | `createWorkflowRunWorker` 全仓只在 `server/app.cjs` 被调用；`server/worker.cjs` 走 `workerRuntime.cjs`，其中不含它 |

**实测**：API 进程与独立 worker 进程**同时运行**，提交一条只含 `textInput` 的运行，
8 秒后仍是 `run=queued` / `node=pending`；同一张图在单进程下 300ms 内 `succeeded`。

结论：**前端联调请用单进程**。分进程支持属于后续工作（见第八节第 6 项），不是配置问题。

---

## 一、身份与隔离

运行按 `userId` 隔离，规则来自 `server/services/requestIdentityService.cjs` 与 `server/security.cjs`：

1. 请求已登录（中间件填了 `req.authUser`）→ 用 `authUser.id`。
2. 否则回退到部署模式的默认用户。
3. 客户端通过 `x-user-id` 头、`?userId=`、`body.userId` **指定的身份默认不受信**
   （`WORKBENCH_TRUST_CLIENT_USER_ID` 默认 `false`，见 `security.cjs:94`）。

**访问别人的运行 → 404，不是 403。** 不暴露资源是否存在（`getWorkflowRunForUser` 查不到即 404）。

---

## 二、对象形状

### 2.1 Run（`server/db.cjs:2848 rowToWorkflowRun`）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 运行 id（UUID） |
| `workflowId` | string | 来源工作流 id |
| `workflowVersionId` | string \| null | 指定版本运行时才有；否则 null |
| `userId` | string | 归属用户 |
| `status` | string | 见第四节 |
| `trigger` | string | `manual` / `api` / `schedule`。**本组路由固定写 `api`** |
| `idempotencyKey` | string \| null | 未使用幂等键时为 null |
| `graphHash` | string | 节点/连线指纹；**不含位置与 label**（挪动节点不改变语义） |
| `definition` | `{nodes, edges}` | 创建时的**图快照**，模板后续改动不影响它 |
| `output` | `{assets: Asset[]}` \| null | 仅终态且有产物时非 null |
| `error` | object \| null | 见 4.3 |
| `creditCost` | number | ⚠️ **恒为 0**，见第七节 |
| `creditStatus` | string | ⚠️ **恒为 `"none"`**，见第七节 |
| `reservedCredits` | number | ⚠️ **恒为 0**，见第七节 |
| `totalNodes` | number | 快照里的节点总数 |
| `finishedNodes` | number | `succeeded` + `skipped` 的节点数（`workflowRunService.cjs:299`） |
| `createdAt` / `updatedAt` | string | ISO 8601 |

`Asset` = `{ fileName, id, type, url }`，`type ∈ {image, video, asset}`，跨节点去重
（`workflowRunService.cjs:505 collectRunOutput`）。

### 2.2 RunNode（`server/db.cjs:2872 rowToWorkflowRunNode`）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 行 id |
| `runId` | string | 所属运行 |
| `nodeId` | string | **工作流图里的节点 id**（前端用它对应画布节点） |
| `nodeType` | string | 22 种节点类型之一，见 `node-registry.json` |
| `status` | string | 见第四节 |
| `taskId` | string \| null | 关联的生成任务；入队前为 null |
| `attempt` | number | 已提交次数，从 1 开始（重试**不**重置，见第六节） |
| `inputHash` | string | 当前未使用，恒为 `""` |
| `output` | object \| null | 节点产物信封，形状见 `workflow-execution-semantics.md` |
| `error` | object \| null | 见 4.3 |
| `durationMs` | number \| null | 任务耗时 |
| `startedAt` / `finishedAt` | string \| null | ISO 8601 |
| `createdAt` / `updatedAt` | string | ISO 8601 |

---

## 三、六个接口

所有响应均为 JSON。**错误响应永远是单字段**：`{ "error": "<字符串>" }`
（`server/httpErrors.cjs:1 sendSafeError`）。⚠️ 没有 `code`、没有结构化错误类型——
前端只能按 **HTTP 状态码**分支，不能按错误种类分支。

### 3.1 `GET /api/workflow-runs` — 列表

查询参数（`workflowRunRoutes.cjs:17`，`db.cjs:2947`）：

| 参数 | 说明 |
| --- | --- |
| `limit` | 默认 50，**夹紧到 1..200** |
| `offset` | 默认 0，负数按 0 处理 |
| `status` | 精确匹配，**不做校验**：传非法值只是返回 0 条，不报 400 |
| `workflowId` | 按来源工作流过滤 |

响应 `200`：

```json
{
  "runs": [ /* Run[]，按 createdAt 倒序 */ ],
  "count": 2,
  "total": 17,
  "limit": 50,
  "offset": 0
}
```

⚠️ `count` 是**本页条数**（`runs.length`），`total` 才是**匹配总数**
（`workflowRunService.cjs:143`）。前端做分页要用 `total`。

### 3.2 `POST /api/workflow-runs` — 创建

请求体：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `workflowId` | ✅ | 要跑的工作流 |
| `workflowVersionId` | ❌ | 指定版本快照；不传则用当前工作流 |
| `idempotencyKey` | ❌ | 幂等键，见第五节 |

响应 `201`（首次创建）：

```json
{ "created": true, "run": { /* Run */ } }
```

响应 `200`（幂等命中，**不是 201**）：

```json
{ "created": false, "run": { /* 已存在的 Run */ } }
```

错误：

| 状态 | `error` | 触发条件 |
| --- | --- | --- |
| 503 | `Server-side workflow runs are disabled on this server. Set WORKBENCH_SERVER_SIDE_RUNS=true to enable them.` | 功能开关关闭。**最先判断**，优先于下面的 400/404 |
| 400 | `workflowId is required.` | 缺 workflowId |
| 400 | `Workflow has no nodes to run.` | 图里没有节点 |
| 400 | `Workflow contains a cycle and cannot be executed.` | 存在循环依赖 |
| 404 | `Workflow not found.` | 工作流不存在或不属于该用户 |
| 404 | `Workflow version not found.` | 指定版本不存在 |
| 500 | `Unable to create workflow run.` | 其它异常 |

> 前端至少要把 **503** 与 400/404 分开处理：前者是部署配置问题（提示运维打开开关），
> 后者是这次请求本身有问题（提示用户）。

### 3.3 `GET /api/workflow-runs/:runId` — 详情

响应 `200`：`{ "nodes": [ /* RunNode[] */ ], "run": { /* Run */ } }`

轮询这个接口即可拿到节点进度与产物，**不需要**再逐个轮询 `GET /api/tasks/:id`。

错误：`404 Workflow run not found.`

### 3.4 `GET /api/workflow-runs/:runId/plan` — 推进计划（只读）

纯读取，**不改变任何状态**（`workflowRunService.cjs:154`）。调试与排障用。

响应 `200`：

```json
{
  "plan": {
    "ready":    ["node-id-1"],
    "runnable": ["node-id-2"],
    "blocked":  ["node-id-3"],
    "waiting":  ["node-id-4"],
    "hasPendingWork": true
  },
  "runId": "<run id>",
  "status": "running"
}
```

⚠️ 四个数组装的是**节点 id 字符串**，不是对象；且**不返回** Run 对象。
语义（`workflowGraph.cjs:236 planWorkflowRun`）：

| 数组 | 含义 |
| --- | --- |
| `ready` | 可以立刻入队执行的生成型节点 |
| `runnable` | 本地直接产出的节点（输入/参数类） |
| `blocked` | 上游失败或取消、**注定跑不成**的节点 |
| `waiting` | 上游还没跑完的节点 |

⚠️ **这里的 `blocked` 是计划分类，不是节点状态**。落库时它写成 `cancelled`，见 4.2。

### 3.5 `POST /api/workflow-runs/:runId/cancel` — 取消

响应 `200`：`{ "nodes": [ /* RunNode[] */ ], "run": { /* Run */ } }`

行为（`workflowRunService.cjs:328`）：

- 所有**非终态**节点 → `cancelled`，`error.message = "Run was cancelled."`
- 运行 → `cancelled`
- **对已终态的运行调用是幂等的**：直接返回当前状态，不做任何修改，仍是 200

错误：`404 Workflow run not found.`

### 3.6 `POST /api/workflow-runs/:runId/retry` — 重跑失败节点

响应 `200`：`{ "nodes": [...], "resetNodeIds": ["..."], "run": {...} }`

行为（`workflowRunService.cjs:400`）：

- 只重置 `failed` 与 `cancelled` 的节点 → `pending`（清空 `taskId`/`error`/产物/时间戳）
- **`succeeded` 的节点原样保留**，其产物会被复用而不是重新扣费
- 运行 → `queued`
- ⚠️ **`attempt` 不在这里累加**，只在真正入队时 +1（注释明确说明，避免双倍计数）

错误：

| 状态 | `error` |
| --- | --- |
| 400 | `This run already succeeded; there is nothing to retry.` |
| 409 | `This run is still in progress. Cancel it before retrying.` |
| 404 | `Workflow run not found.` |

⚠️ **409 是本组接口唯一的 409**，前端要单独处理（提示先取消）。

---

## 四、状态机

### 4.1 运行状态（5 个，全部会出现）

`queued` → `running` → `succeeded` / `failed` / `cancelled`

| 状态 | 何时写入 | 出处 |
| --- | --- | --- |
| `queued` | 创建时；重试时 | `workflowRunService.cjs:110,427` |
| `running` | 还有未完成节点时 | `:304` |
| `succeeded` | 所有节点成功（或全为 `skipped`） | `summarizeRunStatus` |
| `failed` | 至少一个节点 `failed` | 同上 |
| `cancelled` | 调用 cancel，或全部节点 `cancelled` | `:346` |

汇总规则（`workflowGraph.cjs:293 summarizeRunStatus`）按此优先级：
还有未完成节点 → `running`；否则有失败 → `failed`；否则有取消 → `cancelled`；否则 `succeeded`。
（边界：节点数为 0 → `succeeded`。）

### 4.2 节点状态 ⚠️ 只有 5 个会真正出现

```
pending ──本地节点直接产出──────────────→ succeeded
pending ──生成型节点入队──→ queued ──→ succeeded | failed | cancelled
pending ──上游失败/取消传播───────────→ cancelled
pending/queued ──整次 cancel──────────→ cancelled
queued ──任务丢失（进程重启恢复）─────→ failed
failed | cancelled ──retry────────────→ pending
```

**实际会被写入的状态只有 5 个**：`pending`、`queued`、`succeeded`、`failed`、`cancelled`。
出处：`workflowRunService.cjs` 第 181/190/222/236/268/276/282/338/374/417 行，
这是全部节点状态写入点（已核对全仓 `updateWorkflowRunNode` 调用方）。

数据库 CHECK 允许 8 个值（`db.cjs:365`），但其中三个是**死值**：

| 值 | 现状 |
| --- | --- |
| `blocked` | **从不写入**。上游失败导致跑不成的下游，落库写的是 `cancelled` |
| `running` | **从不写入**。`workflowRunService.cjs:304` 那处 `status: 'running'` 写的是**运行**对象，不是节点 |
| `skipped` | **从不写入**。仅在终态集合与计数里被识别（`:299`、`workflowGraph.cjs:184`） |

**前端必须注意的两点**：

1. **不要等 `running` 来显示「进行中」。** 生成型节点从入队到出结果**全程是 `queued`**，
   而视频生成实测要 11~19 分钟。UI 应当把 `queued` 视为「已提交，等待上游」。
2. **`cancelled` 有两种含义，结构上无法区分**：用户主动取消 vs 上游失败被拖死。
   唯一线索是 `error.message`：
   - `"Run was cancelled."` — 整次取消
   - `"Skipped because an upstream node did not succeed."` — 上游失败传播（`:183`）

   ⚠️ 靠文案匹配是脆弱的，阶段 0 待决策（见第八节）。

### 4.3 error 对象

| 场景 | 形状 | 出处 |
| --- | --- | --- |
| 运行失败 | `{message: "One or more workflow nodes failed.", failedNodeIds: [...]}` | `:316` |
| 运行取消 | `{message: "Run was cancelled."}` | `:347` |
| 节点上游受阻 | `{message: "Skipped because an upstream node did not succeed."}` | `:183` |
| 节点任务失败 | `{message: "<任务错误>"}` | `:284` |
| 节点任务被取消 | `{message: "Node task was cancelled."}` | `:278` |
| 进程恢复时任务丢失 | `{message: "...", recoverable: true}` | `:376` |

---

## 五、幂等规则

- 幂等键**按用户隔离**：`WHERE user_id = ? AND idempotency_key = ?`（`db.cjs:2940`）。
  两个用户可以用同一个键，互不影响。
- 命中已有运行时返回 **200 + `created: false`**；首次创建返回 **201 + `created: true`**。
- 空字符串 / 全空白键视为**没有传**（`workflowRunService.cjs:83`），每次都会新建运行。
- `workflow_runs` 上**没有** `(user_id, idempotency_key)` 唯一索引，靠查询实现。
  ⚠️ 并发同键提交存在竞态窗口，前端不要依赖它做严格去重。

---

## 六、断线恢复规则

运行状态**持久化在 SQLite**，与浏览器会话无关：关掉页面后 worker 继续推进，
重新打开靠 `GET /api/workflow-runs/:runId` 取回。恢复由 worker 的每一轮 `tick` 完成
（`workers/workflowRunWorker.cjs:129`，默认间隔 2 秒，可用
`WORKBENCH_WORKFLOW_RUN_POLL_INTERVAL_MS` 调整）：

1. `reconcileRun` — `queued`/`running` 的节点如果**任务已不存在**，标 `failed`
   （`error.recoverable = true`），否则会永远等一个不会来的结果（`:359`）。
   标完必须再结算一次，否则被它挡住的下游会停在 `pending`（代码注释明确说明）。
2. `pollVideoNodes` — 视频是「提交 → 轮询 → 落盘」两段式，服务端编排下必须由 worker
   承担，否则节点永远停在 `queued`（`workflowRunWorker.cjs:88-90`）。
3. `syncNodeOutcomes` — 把已终态任务的产物回流到运行节点。
4. `advanceRunOnce` — 传播失败、产出本地节点、入队就绪节点、汇总运行终态。

**前端要点**：

- 视频节点长时间停在 `queued` 是**正常**的，不要按超时判失败——
  计划书里的 30 分钟下限同样适用。
- `failed` 且 `error.recoverable === true` 表示「进程重启导致任务丢失」，
  与「上游真的失败」不同，UI 可以提示「可重试」。

---

## 七、计费 ⚠️ 运行级字段是预留的，未实现

| 事实 | 出处 |
| --- | --- |
| `workflow_runs` 有 `credit_cost`/`credit_status`/`reserved_credits` 三列 | `db.cjs:346-348` |
| 创建运行时**不传**这三个值 → 默认 `0` / `"none"` / `0` | `workflowRunService.cjs:105` |
| 全仓**没有任何**运行级积分写入 | 已核对所有 `updateWorkflowRun` 调用点 |
| 真正的计费在**任务级** | `services/creditService.cjs`、`tasks.credit_cost` |

**结论：前端不要用 `run.creditCost` 显示本次运行的消耗——它恒为 0。**
要显示费用得读任务级字段（`GET /api/tasks/:id` 的 `creditCost`/`creditStatus`）。

任务级 `creditStatus` 取值与运行级枚举**不同**：任务侧是 `charged` / `free` / `refunded`
（`creditService.cjs:225` 等），运行级枚举是 `none` / `reserved` / `charged` / `refunded`。
别把两套混用。

> 这直接影响计划书阶段 4 的验收项「重试不会重复扣费」：目前该保证来自
> 「成功的节点不被重试重置、其任务不重新入队」，而不是运行级预扣/退款。

---

## 八、阶段 0 待决策（需要 Kimi 评审）

| # | 问题 | 现状 | 建议 |
| --- | --- | --- | --- |
| 1 | ~~worker 未启用时静默不推进~~ **已解决** | 开关关闭时 `POST /api/workflow-runs` 返回 **503** + 可操作文案，护栏在查库之前，不再出现「201 之后静默卡死」 | 前端把 503 与其他 4xx 分开提示即可；`/api/health` 暴露能力位仍未做（横幅已有） |
| 2 | **`cancelled` 无法区分「主动取消」与「上游拖死」** | 只能匹配 `error.message` 文案 | 落库为真正的 `blocked`（枚举已存在，无需改 schema），或给 `error` 加稳定 `code` |
| 3 | **`running` 节点状态永不出现** | UI 若等 `running` 会一直显示「未开始」 | 前端按 `queued` 显示「已提交/等待上游」；后端考虑是否补写 `running` |
| 4 | **错误响应无结构化 code** | 只有 `{error: "<字符串>"}` | 至少给可预期的 4xx 加 `code` 字段 |
| 5 | ~~写端点响应契约测试缺失~~ **已补齐** | `apiContract.test.cjs` 新增「工作流运行写端点」测试：201/200 幂等、详情、计划、409、取消与重试 | 无需决策 |
| 6 | **分进程部署下运行不推进** | API 进程不启动 worker（`api.cjs:1`），独立的 worker 进程没有装配运行推进器。实测两进程同跑仍停在 `queued` | 把推进器接进 `workerRuntime.cjs`——需要先把入队装配从 `app.cjs` 提取成可复用模块；在那之前用单进程（模式二） |

---

## 九、参考

- 路由清单与全局响应约定：`docs/api-contract.md`
- 节点端口、连接推断、产物信封形状：`docs/workflow-execution-semantics.md`
- 22 种节点类型：`docs/node-registry.json`
- 路由清单自动核对：`npm run check:routes`
