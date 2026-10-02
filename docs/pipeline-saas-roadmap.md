# 流水线视频与 SaaS 部署落地方案

结论：本项目的生成链路、多租户隔离、积分账本、任务队列已经具备 SaaS 底座，不需要重写。要把它变成"能关门生产视频、并对外收钱"的平台，只有一个必须重构的地方——**把工作流调度从浏览器移到服务端**。其余五项是按依赖顺序补的工程补齐，改动面都不大。

本文是决策文档，不是进度记录。每个阶段都给出数据模型变更、接口契约、验收标准和风险，确认后再动手。

## 5 分钟版

| 阶段 | 目标 | 内容 | 是否阻塞目标 | 量级 |
| --- | --- | --- | --- | --- |
| 一 | 服务端工作流编排 | 工作流级运行记录 + DAG 推进器 + 对外运行接口 | **阻塞两个目标** | 大 |
| 二 | 成本与账务对齐 | 定价从"全局单价"改为"模型挂单价" | 阻塞毛利 | 中小 |
| 三 | 运维兜底 | 公网 URL 自检、SQLite 备份、Key Secret、Dockerfile 对齐 | 阻塞稳定上线 | 小 |
| 四 | 商业化闭环 | 支付通道、订单表、成片生命周期策略 | 阻塞收钱 | 中 |
| 五 | 存储与并发升级 | PostgreSQL + 对象存储 | 阻塞规模 | 大，可延后 |
| 六 | 横向扩展 | 拆独立服务、独立 worker 池 | 阻塞峰值 | 可延后 |

阶段一、二、三是"能对外收费的最小可行版本"，四才能真的收钱。五、六在真实压力出来之前不做。

## 一、现状盘点

### 已具备（不需要动）

| 能力 | 现有实现 | 判断 |
| --- | --- | --- |
| 流水线节点 | `src/data/nodeRegistry.ts`：文本输入、剧本生成、分镜拆解、提示词优化、图片生成、多图生视频、视频生成、预览、合并 | 齐 |
| 视频生成模式 | `text-to-video / image-to-video / images-to-video / shotlist-to-video` | 齐 |
| 生成任务队列 | `taskQueueService` + `generationWorker`：入库 `queued`、并发可配、重启恢复、冷启动续跑、软取消、统一重试 | 生产级 |
| 多租户隔离 | 任务、资产、素材集合按 `user_id` 过滤，有跨用户越权测试 | 齐 |
| 积分账本 | `credit_accounts` + `credit_transactions`（`grant/debit/refund/admin_adjustment/free_usage`），失败和取消幂等退款 | 齐 |
| 凭据安全 | AES-256-GCM 加密落库、server 模式禁止直传、server key 必须走平台模型、平台模型多路由优先级回退 | 齐 |
| 账号体系 | 登录、Session、邮箱验证码、邀请码、禁用、改密、审计日志 | 齐 |
| 部署形态 | 本地 / 单机 SaaS / API+Worker 分进程 / 可选网关转发五服务 / PM2 六进程配置 | 骨架齐 |
| 模型适配 | `videoProviderAdapters` 统一火山方舟、阿里百炼、xAI 三家协议 | 齐 |
| 质量保障 | 621 测试通过、`tsc`/`oxlint`/`mojibake`/`check:deploy`/`build` 全绿，含架构护栏测试 | 齐 |

### 缺口（按严重程度）

| # | 缺口 | 证据 | 影响的用户场景 |
| --- | --- | --- | --- |
| 1 | **工作流只在浏览器里执行** | `src/engine/WorkflowEngine.ts` 用拓扑排序在前端调度；后端全部 177 个 `.cjs` 里没有 `runWorkflow` / `/api/workflows/:id/run` | 关标签页即中断、无法批量过夜生产、无法对外提供 API、断线后积分与任务对不上 |
| 2 | **积分定价是全局单价，不分模型** | `creditPricingService.cjs`：`imagePerItem: 10`、`videoPerSecond: 20`、`textPerRequest: 1`，全部来自 `WORKBENCH_CREDIT_*` 环境变量，与模型无关 | mini 与 2.5 同价、480P 与 1080P 同价，低档亏钱高档赶客 |
| 3 | 无支付通道 | 全库无 `recharge/payment/order/topup` 实现，积分只来自初始化账户和管理员 `admin_adjustment` | 无法自助充值，只能人工转账加积分 |
| 4 | SQLite + 同步驱动 | `better-sqlite3` 同步阻塞事件循环，API 与 worker 同进程共用单文件 | 批量跑流水线时登录、列表、轮询一起变慢 |
| 5 | 成片无生命周期 | `assetQuotaService` 只有上限（单文件/总容量/每日上传），无 TTL、无过期删除、无归档 | `outputs` 稳定增长直到打满磁盘 |
| 6 | 运维兜底缺失 | `.env` 无 `WORKBENCH_KEY_SECRET`；无备份脚本；`mediaUrlService.cjs` 仅 23 行且失败静默；`Dockerfile` 未提交且 `EXPOSE 3100` 与代码 3000 不符 | 公网 URL 配错不报错、Key 泄漏无法轮换、容器端口误导 |

## 二、设计原则

1. **不改生成链路。** 文本、图片、视频三类任务继续走现有 `taskQueueService` 和 `generationWorker`。阶段一只新增一层"上游编排"，复用已有全部能力（恢复、重试、退款、隔离）。
2. **不让前端变成第二个真相源。** 阶段一落地后，`WorkflowEngine.ts` 降级为"本地草稿预览"，正式运行以后端返回的状态为准。
3. **新表不碰老表。** 沿用现有 `runOneTimeMigration` + `CREATE TABLE IF NOT EXISTS` 机制。**注意 `tasks.node_type` 和 `tasks.status` 是带 `CHECK` 约束的列**，SQLite 改不了约束，所以工作流级信息必须放在新表里，不要试图往 `node_type` 里塞新值。
4. **成本随模型走。** 单价挂在模型能力上，而不是挂在环境变量上。
5. **先可观测，再优化。** 阶段三的自检和备份优先于阶段五的存储升级——不知道哪里坏了就没法安全地扩容。

## 三、阶段一：服务端工作流编排

这是唯一需要设计的部分，其余阶段都是执行。

### 3.1 数据模型

新增三张表。`nodes_json` / `edges_json` 直接复用工作流定义里的结构，不做格式转换。

```sql
CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  workflow_version_id TEXT,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  trigger TEXT NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual', 'api', 'schedule')),
  idempotency_key TEXT,
  graph_hash TEXT,
  definition_json TEXT NOT NULL,      -- 运行那一刻的节点/连线快照，模板改动不影响历史
  output_json TEXT,
  error_json TEXT,
  credit_cost INTEGER NOT NULL DEFAULT 0,
  credit_status TEXT NOT NULL DEFAULT 'none' CHECK (credit_status IN ('none', 'reserved', 'charged', 'refunded')),
  reserved_credits INTEGER NOT NULL DEFAULT 0,
  total_nodes INTEGER NOT NULL DEFAULT 0,
  finished_nodes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (workflow_id) REFERENCES workflows(id)
);

CREATE TABLE IF NOT EXISTS workflow_run_nodes (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,              -- 画布里的节点 id
  node_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'blocked', 'queued', 'running', 'succeeded', 'failed', 'skipped', 'cancelled')),
  task_id TEXT,                       -- 关联 tasks.id，复用现有队列
  attempt INTEGER NOT NULL DEFAULT 0,
  input_hash TEXT,                    -- 上游输入指纹，决定能否复用
  output_json TEXT,
  error_json TEXT,
  duration_ms INTEGER,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (run_id, node_id),
  FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_runs_idempotency
  ON workflow_runs(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_workflow_run_nodes_run_status
  ON workflow_run_nodes(run_id, status);
```

三个设计要点：

- **`definition_json` 存运行时快照。** 用户跑完一次之后改模板，历史运行必须还能复盘。
- **`input_hash` 是复用的依据。** 对应现在前端"输入没变就复用已完成节点"的能力，搬到服务端后语义不变：上游 output 与上次成功时一致 → 该节点直接 `succeeded` 并复用产物，不重复扣费。
- **`credit_status` 增加 `reserved`。** 现有 `tasks.credit_status` 没有预扣态，工作流级需要它（见 3.4）。`credit_accounts.reserved_balance` 字段**已经存在但全库没人写过**，阶段一正好把它用起来。

### 3.2 推进器

新增 `server/services/workflowRunService.cjs` 和 `server/workers/workflowRunWorker.cjs`，与现有 `generationWorker` 并列，共享同一个 SQLite。

推进循环，每轮只做一件事：

1. 取一个 `running` 或 `queued` 的 run；
2. 按 `workflow_run_nodes` 重建 DAG，计算每个 `pending` 节点的入度；
3. **入度为 0 的节点直接 `succeeded`**（输入节点：文本输入、图片输入、参数节点），把值写进 `output_json`；
4. **入度已满足且输入指纹变化的节点** → 调现有的 `/api/images` / `/api/videos` / `/api/chat` 入队逻辑，写回 `task_id`，状态置 `queued`；
5. **输入指纹未变化的节点** → 直接复用上次成功产物，状态置 `succeeded`，`skipped` 记在日志里；
6. 所有节点终态 → 汇总成 run 的 `output_json`（成片资产列表），结算积分，置终态。

关键约束：

- **推进器不自己调厂商 API。** 它只创建任务、观察任务状态、推进入度。真正的生成仍然由 `generationWorker` 执行。这样并发控制、凭据回退、能力过滤、失败退款全部自动继承。
- **幂等靠唯一约束，不靠内存。** 用 `workflow_runs(user_id, idempotency_key)` 唯一索引兜底，重复提交返回已有 run。
- **崩溃靠扫描恢复。** 进程重启后，扫描所有非终态 run：`queued`/`running` 且 `task_id` 对应任务已终态的，直接推进；`task_id` 对应任务丢失或长期无更新的，标 `failed` 并退款。复用现有"冷启动续跑"的写法。
- **取消要级联。** 调现有 `taskService` 的取消能力，取消该 run 下所有非终态节点，然后走工作流级退款。

### 3.3 接口契约

```
POST   /api/workflow-runs                    # 触发运行
GET    /api/workflow-runs                    # 运行列表（分页、按状态/工作流筛选）
GET    /api/workflow-runs/:runId             # 运行详情（含节点状态、产物、节点级 task id）
POST   /api/workflow-runs/:runId/cancel      # 取消整条运行
POST   /api/workflow-runs/:runId/retry       # 只重跑失败节点及下游
GET    /api/workflow-runs/:runId/events      # 进度流（先做轮询，SSE 留到有需要）
```

请求体：`{ workflowId, workflowVersionId?, inputs?, idempotencyKey? }`。全部沿用现有网关鉴权和 `getRequestUserId` 边界，不新增鉴权路径。

**这一组接口就是对外 SaaS 能力的地基**——客户 `POST /api/workflow-runs` 一次下单，轮询 `GET /api/workflow-runs/:runId` 拿成片，关掉浏览器不影响生产。

### 3.4 积分语义

现有语义是"单个任务扣费"，工作流级需要一个整体语义，建议：

| 环节 | 行为 |
| --- | --- |
| 创建 run | 按 DAG 预估总额，校验余额，**预扣**到 `reserved_balance`，`credit_status='reserved'` |
| 节点成功 | 从预留转入实扣，写一条 `debit` 交易并关联 run |
| 节点失败并重试 | 不额外扣，重试复用预留 |
| run 终态 | 结算：成功节点实扣，未执行节点的预留**释放**；全部成功则 `charged`，全失败则 `refunded` |
| 复用节点（输入未变） | 不扣费，写 `free_usage` 交易留痕 |

这样"用户按整条流水线看到总价"和"实际按节点结算"两个需求都能满足，也不会出现前端崩溃后积分悬空。**注意**：`reserved_balance` 目前是死字段，启用前要确认 `creditRepository` 里所有读写路径都带上它，避免对账错位。

### 3.5 验收标准

沿用现有验收习惯，每步都要过全套门（`npm test`、`tsc`、`lint`、`check:mojibake`、`build`），并新增：

| 验收项 | 测试落点 |
| --- | --- |
| 工作流能从服务端跑完整条链路并产出成片资产 | `server/workflowRunService.test.cjs`（用假上游） |
| 进程重启后未完成的 run 能继续推进 | 模仿 `splitProcessRuntime.test.cjs` 真实起进程 |
| 重复提交同一个 `idempotencyKey` 只产生一个 run | 唯一索引 + 服务层测试 |
| 输入未变的节点不重复扣费 | 积分交易条数断言 |
| 取消 run 会级联取消下游并释放预留 | 取消 + 退款测试 |
| 跨用户无法读取或取消他人 run | 越权测试，对齐现有 `assetCollectionRoutesIsolation` 风格 |
| 失败节点重试只重算失败节点及下游 | DAG 推进测试 |
| 编排层不直接 import db 或 repository | 扩展现有 `backendModuleBoundary.test.cjs` |

### 3.6 风险

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| 前端双写冲突 | 过渡期前端本地调度和后端 run 同时存在，状态可能打架 | 加 `WORKBENCH_SERVER_SIDE_RUNS=true` 开关，先只对新工作流启用；server 模式下前端禁止本地运行 |
| 推进器与生成队列竞争 | 两者共用 SQLite，同步驱动下轮询会互相拖慢 | 推进轮询间隔独立可配，默认不低于 1s；阶段五换 Postgres 后消失 |
| 复用语义回归 | `input_hash` 漏算某个参数会导致错误复用、产出旧图 | hash 覆盖节点完整 config + 所有上游 output；加"参数改动必须触发重跑"的专项测试 |
| 预留积分对账 | `reserved_balance` 首次启用，历史数据没有该字段语义 | 迁移时把现有账户 `reserved_balance` 显式置 0；加对账脚本校验 `balance + reserved` 守恒 |

## 四、阶段二：成本与账务对齐

**目标**：让积分定价跟着真实上游成本走，保住毛利。

**改动点**（小）：

1. 在 `modelCapabilities.cjs` 的 preset 里增加成本字段，例如 `creditCost: { imagePerItem?, videoPerSecond?, textPerRequest? }`。这张表已经按 `providerId + modelPattern` 组织，天然是挂单价的落点。
2. `creditPricingService.estimate()` 改为优先取模型级单价，取不到再回落到全局默认。**保持现有环境变量作为兜底，不破坏现有部署。**
3. 平台模型表 `platform_models` 增加可选覆盖字段，让管理员能对特定平台模型单独定价（比如促销价）。
4. `/api/credit/prices` 之类的公开读接口，让前端在运行前显示预估消耗。

**注意这是定价语义变更**：从"按调用类型"变成"按模型"。已产生的历史任务不要回算，只对新任务生效；前端展示的预估价格要同步。

**验收**：同一时长下 mini 与全参模型扣费不同；未声明单价的模型回落到全局默认；预估价格与实际结算一致（加断言测试）。

## 五、阶段三：运维兜底（半天到一天，收益最高）

| 项 | 做法 | 验收 |
| --- | --- | --- |
| 公网 URL 自检 | 启动时校验 `WORKBENCH_PUBLIC_BASE_URL`：必须是 https、必须能通过 `/api/health` 自访问、反代场景下校验 `X-Forwarded-Proto/Host` 是否透传。非法则 **拒绝启动**（server 模式）而不是静默降级 | `deploymentCheck` 新增校验和测试 |
| SQLite 备份 | 定时任务 + SQLite 在线备份 API（不能直接拷文件，WAL 模式下会拷出损坏副本），保留 N 份，备份后校验可打开 | 备份脚本 + 恢复演练脚本各一个，手动跑一次留下记录 |
| `WORKBENCH_KEY_SECRET` | 补进 `.env.example` 并给出生成命令；文档写明轮换流程（新旧双密钥解密窗口） | `check:deploy` 在 server 模式下缺失即报错 |
| Dockerfile 对齐 | `EXPOSE` 与 `PROXY_PORT` 一致；`.dockerignore` 排除 `.env`、`data/`、`outputs/`、`node_modules`、三个 `.tar/.tgz`；数据目录用 volume | `docker build` + `docker run` 起一个容器并过 `/api/health` |
| 仓库卫生 | 三个部署包（约 4.1 MB）移出仓库或加 `.gitignore` | `git status` 干净 |

## 六、阶段四：商业化闭环

| 项 | 内容 |
| --- | --- |
| 订单与支付 | 新增 `orders` 表（`id / user_id / amount_cny / credits / status / provider / provider_order_id / idempotency_key / created_at / paid_at`）。支付回调必须**幂等 + 验签 + 金额校验**，回调成功才写 `grant` 交易。通道按你的目标客户选（微信/支付宝当面付，或 Stripe） |
| 套餐与权益 | 现在积分是唯一权益维度。若要卖会员，建议新增 `plans` / `subscriptions`，把"月度积分额度 + 并发上限 + 优先队列"作为权益，而不是改积分账本 |
| 成本对账 | 每次任务都记录上游实际用量（现有 `output_json.request` 里已有 model/duration/resolution），按月汇总出"上游成本 vs 积分收入"，这是定价的唯一依据 |
| 成片生命周期 | 按套餐设保留期（如免费 7 天 / 付费 90 天）；到期任务：标记 → 延迟删除 → 删资产文件但保留元数据和缩略图。必须**先有用户可见的到期提醒**，否则是投诉源 |

## 七、阶段五与六：规模升级（压力出现前不做）

**阶段五：PostgreSQL + 对象存储**

现有 repository 层已经收口（`server/repositories/*` 是唯一 import `db.cjs` 的地方），换库的落点清楚。但有一个真实成本要提前认：**`better-sqlite3` 是同步 API，PostgreSQL 驱动是异步的**，repository 的方法签名会从同步变异步，调用方（services、workers、routes）全部要跟着改成 `await`。这是阶段五最大的工作量，不是换驱动那么简单。

建议顺序：先把资产存储换成对象存储（接口已预留），再把数据库换 Postgres，最后把 `reserved/claim` 换成带租约的队列语义。

**阶段六：横向扩展**

现有网关已经支持按服务边界转发到内部服务（`WORKBENCH_GATEWAY_*_URL`），PM2 六进程配置也在。到时按压力逐个拆，优先把 workflow run 推进器和 generation worker 做成可水平扩展的独立进程池——**这一步的前提是阶段五已完成**，否则多进程抢同一个 SQLite 会立刻出错。

## 八、如果只做一件事

**做阶段一的服务端工作流编排。**

理由：它同时是"流水线视频生产"和"SaaS 部署"两个目标的共同前提。没有它，视频只能一条条手动开浏览器跑，SaaS 也只是一个"单人工作台的多用户版"，卖不出工作流的价值。其余五项都是在它成立之后才有意义的补齐。

## 附：新增环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `WORKBENCH_SERVER_SIDE_RUNS` | `false` | 是否启用服务端工作流运行，灰度开关 |
| `WORKBENCH_WORKFLOW_RUN_CONCURRENCY` | `2` | 单实例同时推进的 run 数量 |
| `WORKBENCH_WORKFLOW_RUN_POLL_INTERVAL_MS` | `2000` | 推进器轮询间隔，避免与生成队列抢 SQLite |
| `WORKBENCH_WORKFLOW_RESERVE_CREDITS` | `true` | 是否启用工作流级积分预扣 |
| `WORKBENCH_PUBLIC_BASE_URL` | — | 已有变量，阶段三起在 server 模式下改为强校验 |
| `WORKBENCH_KEY_SECRET` | — | 已有变量，阶段三起补进 `.env.example` 并在 server 模式强校验 |
