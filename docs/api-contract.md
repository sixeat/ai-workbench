# API 契约

结论：后端提供 **88 个 REST 路由**，全部挂在未版本化的 `/api/*` 下。这份文档固定全局约定、给出完整路由清单，并说明**哪些端点的响应形状已经被自动化验证过**。

**为什么需要它**：接口契约过去只写在旧前端的 `src/lib/apiProxy.ts`（60+ 个手写 `Proxy*` 接口）里。前端一重写，这份描述就没了，新实现只能读 `.cjs` 源码反推。本文档 + `server/apiContract.test.cjs` 把契约从旧前端里**剥离出来并变成可执行的**。

## 5 分钟版

| 项 | 约定 |
| --- | --- |
| 前缀 | `/api/*`，**无版本号** |
| 鉴权 | 默认要求登录（Session Cookie）。`Authorization: Bearer` 或 `x-workbench-token` 走访问令牌；管理员另有 `x-workbench-admin-token` |
| 成功响应 | 直接返回业务对象，**不套 `{data: ...}` 信封**。集合端点带 `count` / `total` / `limit` / `offset` |
| 错误响应 | **统一为 `{ error: string }`**，HTTP 状态码表达语义 |
| 删除 | **所有 DELETE 都返回 JSON 主体**，不返回 204 |
| 分页 | 查询参数 `limit` / `offset`；列表响应里 `count` 是**本页条数**，`total` 是符合条件的总数（部分端点没有 `total`） |
| ID 风格 | 路径参数统一 `:xxxId`（如 `:taskId`、`:apiKeyId`、`:workflowId`） |
| 资产 URL | 后端落库的是**相对路径** `/api/assets/<id>`。分离部署时前端必须自行补 API 前缀 |
| 时间 | 全部为 ISO 8601 字符串 |
| 敏感字段 | 服务端错误会剥离 `Bearer` / `sk-*` / URL / data URL，见 `httpErrors.cjs` 的 `sanitizeSensitiveText` |

---

## 一、自动化契约检查

`server/apiContract.test.cjs` 会**真实启动一次后端**（local 模式、免登录、独立临时数据库），逐个端点取响应，做**两个方向**的核对：

| 方向 | 检查内容 | 能发现的问题 |
| --- | --- | --- |
| 正向 | 后端响应是否**包含** TS 接口声明的必需字段，且**类型一致** | 后端删字段、改字段类型 |
| 反向 | 后端响应是否出现了 TS 接口**未声明**的顶层字段 | 类型文档漂移，前端"看不到已经存在的数据" |

任一方向不一致即测试失败，并直接给出处理建议。

### 1.1 当前覆盖范围（13 个端点）

| 端点 | 验证内容 |
| --- | --- |
| `GET /api/health` | `status` / `time` / `deploymentMode` / `serveStatic` |
| `GET /api/admin/health` | 公开字段 + `host` / `outputDir` / `dbPath` / `defaultUserId` / 四个计数 |
| `GET /api/auth/me` | `authenticated` / `user`(可 null) / `deploymentMode` / `requireLogin` |
| `GET /api/tasks` | `{tasks, count}` + `ProxyTask` 元素必需字段 |
| `GET /api/assets` | `{assets, count}` + `ProxyAsset` 元素必需字段 |
| `GET /api/workflows` | `{workflows, count}` + `ProxyWorkflowProject` 元素必需字段 |
| `GET /api/credits/me` | `{account}` |
| `GET /api/credits/transactions` | `{transactions, total}` |
| `GET /api/platform-models` | `{models, count}` |
| `GET /api/model-catalog` | `{personalModels, platformModels, count}` |
| `GET /api/providers` | `{providers, count}` |
| `GET /api/model-capability-presets` | `{presets}` |
| `GET /api/asset-collections` | `{collections, count}` |

**注意覆盖范围有限**：88 个路由里只验证了 13 个（读端点）。**写端点（POST / PATCH / PUT）的响应形状尚未纳入自动检查**——这是当前最大的契约盲区。

### 1.2 如何扩充

在 `server/apiContract.test.cjs` 里加一条即可：

```js
// 正向：期望的必需字段与类型
ENDPOINT_CONTRACT['GET /api/tasks/:taskId'] = {
  task: J('object'),
};

// 集合元素：
ELEMENT_CONTRACT['GET /api/asset-collections'] = {
  field: 'collections',
  typeName: 'ProxyAssetCollection',
  expected: { id: J('string'), name: J('string'), createdAt: J('string') },
};

// 反向（可选，只对确认要严格核对的端点开）：
UNDECLARED_FIELD_CONTRACT['GET /api/tasks/:taskId'] = ['task'];
```

`J(...kinds)` 接受运行时 `typeof` 结果（`'string'` / `'number'` / `'boolean'` / `'object'` / `'array'` / `'null'`）。

> **无依赖端点要求**：检查在 local 模式、免登录、空数据库下运行。新加的端点必须能在这种状态下返回 200，否则需要准备数据。

---

## 二、鉴权模型

| 方式 | 请求头 | 说明 |
| --- | --- | --- |
| 登录会话 | Cookie `ai_workbench_session` | 默认路径。server 模式跨域部署需 `SameSite=None` + `Secure` |
| 访问令牌 | `Authorization: Bearer <token>` 或 `x-workbench-token` | `WORKBENCH_ACCESS_TOKEN`，或禁用登录时的替代方式 |
| 管理员令牌 | `x-workbench-admin-token` | `WORKBENCH_ADMIN_TOKEN`。或使用 `role === 'admin'` 的登录会话 |
| 免登录 | — | `WORKBENCH_REQUIRE_LOGIN=false` 时全部请求落到默认用户（仅本地/测试用） |

**放行规则**（`apiAuthMiddlewareService.cjs`）：

- `/health` 及 `/auth/*` 前缀**跳过 API 鉴权**（登录、注册、找回密码必须匿名可达）
- 其余 `/api/*`：`requireLogin` 为真时必须有 `req.authUser`，否则 `401 {error:'Login is required.'}`

**管理端点**全部在 `/api/admin/*` 下，需要管理员身份，否则 `403 {error:'Admin token is required.'}`。

---

## 三、完整路由清单（88 个）

### 3.1 认证与账号（18）

| 方法 | 路径 |
| --- | --- |
| `POST` | `/api/auth/login` |
| `POST` | `/api/auth/logout` |
| `GET` | `/api/auth/me` |
| `POST` | `/api/auth/password-reset/request` |
| `POST` | `/api/auth/password-reset/verify` |
| `POST` | `/api/auth/register/request` |
| `POST` | `/api/auth/register/verify` |
| `GET` | `/api/auth/sessions` |
| `DELETE` | `/api/auth/sessions/:sessionId` |
| `POST` | `/api/auth/sessions/logout-all` |
| `GET` | `/api/admin/users` |
| `POST` | `/api/admin/users` |
| `PATCH` | `/api/admin/users/:userId/password` |
| `PATCH` | `/api/admin/users/:userId/status` |
| `GET` | `/api/admin/invitations` |
| `POST` | `/api/admin/invitations` |
| `DELETE` | `/api/admin/invitations/:invitationId` |
| `GET` | `/api/admin/audit-logs` |

### 3.2 积分（5）

| 方法 | 路径 |
| --- | --- |
| `GET` | `/api/credits/me` |
| `GET` | `/api/credits/transactions` |
| `GET` | `/api/admin/credits/users` |
| `GET` | `/api/admin/credits/transactions` |
| `POST` | `/api/admin/credits/adjust` |

#### 计费模型（按模型分档）

任务在**入队时即扣费**，`task.creditCost` 与 `task.billing` 记录实际扣费明细：

```json
{
  "creditCost": 375,
  "creditStatus": "charged",
  "creditKeyScope": "server_key",
  "billing": { "unit": 75, "unitName": "second", "quantity": 5, "creditPolicy": "server_key_debit" }
}
```

单价按**模型**分档，逐层回退：

| 优先级 | 来源 |
| --- | --- |
| 1 | 平台模型能力表里的 `creditCost`（运营覆盖价，改配置即生效） |
| 2 | 平台模型路由所指 apiKeyModel 的 `creditCost` |
| 3 | 直接选 apiKeyModel 的 `creditCost` |
| 4 | 按 `body.model` + `body.providerId` 回算能力 preset |
| 5 | 全局默认价（`WORKBENCH_CREDIT_*` 环境变量） |

`creditCost` 支持的字段：`textPerRequest` / `imagePerItem` / `videoPerSecond`。
**逐字段回退**，只需覆盖关心的那一项。

**`0` 是合法的免费定价**，不会被当成"未配置"。

参考档位（以图片 10 积分 ≈ ¥0.4 上游成本标定，1 积分 ≈ ¥0.04）：

| 模型档 | 积分单价 | 说明 |
| --- | --- | --- |
| 文本 | 1 / 次 | qwen-plus 等 |
| 图片 | 10 / 张 | wan2.7-image / wan2.6-image / wanx2.1 |
| 图片 Pro | 30 / 张 | wan2.7-image-pro（4K） |
| 视频 | 75 / 秒 | wan*-t2v* / wan*-i2v* |

> 注意：用户自有 Key（`creditKeyScope = user_key`）默认不扣积分。

### 3.3 凭据与模型（25）

| 方法 | 路径 |
| --- | --- |
| `GET` | `/api/api-keys` |
| `POST` | `/api/api-keys` |
| `PATCH` | `/api/api-keys/:apiKeyId` |
| `DELETE` | `/api/api-keys/:apiKeyId` |
| `POST` | `/api/api-keys/:apiKeyId/test` |
| `GET` | `/api/api-keys/:apiKeyId/models` |
| `PATCH` | `/api/api-keys/:apiKeyId/models/:apiKeyModelId` |
| `POST` | `/api/api-keys/:apiKeyId/models/discover` |
| `POST` | `/api/models` |
| `GET` | `/api/model-catalog` |
| `GET` | `/api/providers` |
| `GET` | `/api/model-capabilities` |
| `POST` | `/api/model-capabilities` |
| `GET` | `/api/model-capabilities/resolve` |
| `GET` | `/api/model-capability-presets` |
| `GET` | `/api/platform-models` |
| `GET` | `/api/admin/platform-models` |
| `POST` | `/api/admin/platform-models` |
| `PATCH` | `/api/admin/platform-models/:platformModelId` |
| `DELETE` | `/api/admin/platform-models/:platformModelId` |
| `POST` | `/api/admin/platform-models/:platformModelId/routes` |
| `PATCH` | `/api/admin/platform-models/:platformModelId/routes/:routeId` |
| `DELETE` | `/api/admin/platform-models/:platformModelId/routes/:routeId` |
| `POST` | `/api/admin/platform-models/bulk-from-key` |
| `POST` | `/api/proxy` |

> `POST /api/models` 是**模型列表探测**（语义上像 GET，但需要请求体传凭据）。`POST /api/proxy` 是通用代理，server 模式下默认关闭且受白名单约束。

### 3.4 生成（10）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/images` | 入队，返回 `202` + `taskId` |
| `POST` | `/api/images/sync` | **仅 local 模式注册** |
| `POST` | `/api/videos` | 入队，返回 `202` + `taskId` |
| `GET` | `/api/videos/:taskId` | 查询视频任务，成功后落盘并返回资产 |
| `POST` | `/api/videos/sync` | **仅 local 模式注册** |
| `POST` | `/api/chat` | 入队 |
| `POST` | `/api/chat/sync` | **仅 local 模式注册** |
| `POST` | `/api/claude` | 入队 |
| `POST` | `/api/claude/sync` | **仅 local 模式注册** |
| `GET` | `/api/images/:imageId` | **旧接口兼容**，新实现应改用 `/api/assets/:assetId` |

### 3.5 任务（4）

| 方法 | 路径 |
| --- | --- |
| `GET` | `/api/tasks` |
| `GET` | `/api/tasks/:taskId` |
| `POST` | `/api/tasks/:taskId/cancel` |
| `POST` | `/api/tasks/:taskId/retry` |

`GET /api/tasks` 默认只返回任务摘要与关联资产；展开详情需请求 `GET /api/tasks/:taskId` 拿完整日志。

### 3.6 资产与素材集合（14）

| 方法 | 路径 |
| --- | --- |
| `GET` | `/api/assets` |
| `GET` | `/api/assets/:assetId` |
| `POST` | `/api/assets/upload` |
| `POST` | `/api/assets/:assetId/open-location` |
| `GET` | `/api/asset-collections` |
| `POST` | `/api/asset-collections` |
| `PATCH` | `/api/asset-collections/:collectionId` |
| `DELETE` | `/api/asset-collections/:collectionId` |
| `POST` | `/api/asset-collections/:collectionId/assets` |
| `DELETE` | `/api/asset-collections/:collectionId/assets/:assetId` |
| `POST` | `/api/asset-collections/:collectionId/assets/batch` |
| `POST` | `/api/asset-collections/:collectionId/assets/batch-remove` |
| `POST` | `/api/asset-collections/:collectionId/assets/reorder` |
| `GET` | `/api/asset-collection-templates` |

> `POST /api/assets/:assetId/open-location` 是**本地专属功能**，仅在 `WORKBENCH_DEPLOYMENT_MODE=local` 时注册。远程部署下不存在，前端不应为它保留界面。

### 3.7 工作流（10）

| 方法 | 路径 |
| --- | --- |
| `GET` | `/api/workflows` |
| `POST` | `/api/workflows` |
| `GET` | `/api/workflows/:workflowId` |
| `PUT` | `/api/workflows/:workflowId` |
| `DELETE` | `/api/workflows/:workflowId` |
| `POST` | `/api/workflows/:workflowId/duplicate` |
| `GET` | `/api/workflows/:workflowId/versions` |
| `GET` | `/api/workflows/:workflowId/versions/:versionId` |
| `POST` | `/api/workflows/:workflowId/versions/:versionId/duplicate` |
| `POST` | `/api/workflows/:workflowId/versions/:versionId/restore` |

工作流以**整图**存储：`nodes` 与 `edges` 是 JSON 数组，不做服务端拆分。节点与连线内部结构见[工作流执行语义](workflow-execution-semantics.md)。

### 3.8 服务端工作流运行（6）

**需要 `WORKBENCH_SERVER_SIDE_RUNS=true` 才启用**（默认关闭，老部署行为不变）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/workflow-runs` | 列出运行 `{runs, count}` |
| `POST` | `/api/workflow-runs` | 提交运行，返回 **201** + `{run, nodes}` |
| `GET` | `/api/workflow-runs/:runId` | 查询运行与各节点状态 `{run, nodes}` |
| `GET` | `/api/workflow-runs/:runId/plan` | 查看推进计划（哪些节点就绪/被阻塞） |
| `POST` | `/api/workflow-runs/:runId/cancel` | 取消运行（软取消） |
| `POST` | `/api/workflow-runs/:runId/retry` | 重跑失败节点（不消耗 `attempt`） |

提交运行：

```json
POST /api/workflow-runs
{ "workflowId": "<id>", "idempotencyKey": "<可选，幂等键>" }
```

**为什么需要它**：视频生成实测要 **11~19 分钟**（随机波动），远超浏览器会话的耐心。
由服务端 worker 推进后，**用户关掉页面流水线照样跑完**，再次打开时通过
`GET /api/workflow-runs/:runId` 取回全部状态与产物。

> 前端若走此路径，就**不需要**自己轮询 `GET /api/tasks/:id`——运行状态由服务端维护。
> 若仍走逐任务轮询，注意视频的超时至少要给到 **30 分钟**。

### 3.8 健康检查（2）

| 方法 | 路径 | 暴露范围 |
| --- | --- | --- |
| `GET` | `/api/health` | 公开，最小字段（`status`/`time`/`deploymentMode`/`serveStatic`），不暴露路径 |
| `GET` | `/api/admin/health` | 管理员，含主机、路径、计数与队列健康快照 |

---

## 四、已验证发现的两处契约细节

自动化检查在建立过程中确认了以下两点（都容易被误写）：

| 端点 | 易错点 |
| --- | --- |
| `GET /api/platform-models` | 顶层字段是 **`models`**，不是 `platformModels`。后者是 `GET /api/model-catalog` 的字段 |
| `GET /api/credits/transactions` | 返回 `{transactions, total}`，**没有 `count`**。与 `/api/tasks` 等用 `count` 的端点不一致 |

另外补了一处真实的类型缺口：`src/lib/apiProxy.ts` 原先只声明了 `ProxyProviderTemplate`（元素类型），而 `GET /api/providers` 返回 `{providers, count}`，缺少列表包装类型。已补 `ProxyProviderListResponse`。

---

## 五、已知的契约不一致（有意保留）

| 项 | 现状 | 建议 |
| --- | --- | --- |
| 无版本号 | 全部 `/api/*`，无 `/api/v1` | 破坏性变更时靠新增端点而非改语义；如需版本化，宜在重写前端时一并规划 |
| 集合响应字段不齐 | 多数用 `count`，`/api/credits/transactions` 用 `total`，部分两者都有 | 新实现按端点实际字段取值，勿假设统一 |
| 无 OpenAPI 定义 | 本文档 + `apiContract.test.cjs` 是目前唯一的机器可读契约来源 | 可考虑从两者生成 OpenAPI，用于自动产出前端类型 |
| 写端点未纳入自动检查 | 检查只覆盖读端点 | 逐步补齐，优先补工作流与资产的写路径 |
