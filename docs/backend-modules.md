# 后端模块拆分规划

结论：后端正在从单文件 `server/index.cjs` 拆成按业务划分的模块。目标不是重写功能，而是稳定 API 边界。这样你后面可以先做前端设计稿，再按稳定接口重做前端。

## 5 分钟版

| 原则 | 说明 |
| --- | --- |
| 前端只调用 `/api/*` | 前端不直接访问磁盘、第三方模型或明文 Key |
| 后端负责权限 | 用户、管理员、Session、访问 Token 都在后端判断 |
| 路由保持轻量 | 路由做参数校验和响应，业务逻辑下沉到 service |
| 数据层集中 | 新模块优先通过 `server/repositories/*` 访问 SQLite，旧路径继续从 `server/db.cjs` 逐步迁移 |
| 部署可分离 | 后端可只做 API，前端可部署到 Nginx、Vercel 或 OSS CDN |

## 当前模块

| 模块 | 状态 | 职责 |
| --- | --- | --- |
| `server/index.cjs` | 已瘦身 | 加载环境变量、启动 HTTP 监听、处理进程退出 |
| `server/app.cjs` | 已拆分 | 创建 Express app、注册中间件、挂载路由、组装服务依赖 |
| `server/worker.cjs` | 已拆分 | 启动无 HTTP 的后台 worker 进程 |
| `server/workerRuntime.cjs` | 已拆分 | 组装文本、图片、视频任务队列 |
| `server/routes/authRoutes.cjs` | 已拆分 | 登录、注册、邮箱验证、忘记密码、用户管理、邀请码 |
| `server/routes/apiKeyRoutes.cjs` | 已拆分 | 用户 Key 和服务器 Key 的增删改查 |
| `server/routes/taskRoutes.cjs` | 已拆分 | 任务列表、任务详情、取消、重试 |
| `server/routes/assetRoutes.cjs` | 已拆分 | 资产列表、上传、集合、读取、旧图片接口兼容 |
| `server/routes/modelProxyRoutes.cjs` | 已拆分 | 模型列表、文本聊天、Claude、通用代理、模型能力表 |
| `server/routes/generationRoutes.cjs` | 已拆分 | 图片生成、视频生成、视频任务查询、产物落盘 |
| `server/routes/healthRoutes.cjs` | 已拆分 | 公开健康检查和管理员详细健康检查 |
| `server/dataPaths.cjs` | 已拆分 | 集中解析数据目录、SQLite 路径和资产输出目录，不触发数据库初始化 |
| `server/db.cjs` | 保留 | SQLite 表结构和数据访问 |
| `server/repositories/taskRepository.cjs` | 已拆分 | 任务、任务日志、队列 claim、任务资产关联的数据访问接口 |
| `server/repositories/assetRepository.cjs` | 已拆分 | 资产、素材集合、容量统计的数据访问接口 |
| `server/repositories/apiKeyRepository.cjs` | 已拆分 | API Key、Key 配额和 Key 审计日志的数据访问接口 |
| `server/repositories/workflowRepository.cjs` | 已拆分 | 工作流、工作流版本、恢复和复制的数据访问接口 |
| `server/repositories/modelCapabilityRepository.cjs` | 已拆分 | 模型能力、能力分页和模型能力审计日志的数据访问接口 |
| `server/repositories/authRepository.cjs` | 已拆分 | 用户、Session、邮箱验证码、邀请码和审计日志的数据访问接口 |
| `server/security.cjs` | 保留 | 安全策略、CORS、Token、代理白名单 |
| `server/mailer.cjs` | 保留 | SMTP 邮件和开发验证码 |
| `server/assetStorage.cjs` | 保留 | 本地资产存储抽象 |
| `server/modelCapabilities.cjs` | 保留 | 模型能力过滤和参数适配 |

## 当前 service

| Service | 职责 |
| --- | --- |
| `server/services/credentialService.cjs` | Key 加密、Key 权限判断、调用凭据解析 |
| `server/services/apiKeyManagementService.cjs` | API Key 列表、配额、保存、删除、测试和审计 |
| `server/services/proxyService.cjs` | URL 拼接和第三方 HTTP 请求代理 |
| `server/services/secretService.cjs` | 读取本地 secrets 和服务器环境变量托管 Key |
| `server/services/apiKeyTestService.cjs` | 已保存 Key 的模型列表探测和能力测试 |
| `server/services/modelListService.cjs` | `/api/models` 模型列表探测、凭据解析和返回清洗 |
| `server/services/modelCapabilityService.cjs` | 模型能力分页、保存校验、基础能力合并和审计日志 |
| `server/services/genericProxyService.cjs` | 通用代理开关、白名单校验和代理请求转发 |
| `server/services/textTaskRequestService.cjs` | 文本任务入队、同步文本入口和失败文本任务重试 |
| `server/services/mediaUrlService.cjs` | 本地资产 URL 转公网可访问 URL |
| `server/services/assetService.cjs` | 资产列表、上传、读取、公开格式和本地打开位置 |
| `server/services/assetCollectionService.cjs` | 素材集合分页、校验、批量加入/移除、排序和封面刷新 |
| `server/services/imageGenerationService.cjs` | 图片生成、能力过滤、图片落盘、任务状态更新 |
| `server/services/videoGenerationService.cjs` | 视频生成、视频模型适配、任务查询、任务状态更新 |
| `server/services/generationTaskRequestService.cjs` | 图片/视频任务入队、同步生成入口、视频任务查询和失败生成任务重试 |
| `server/services/taskService.cjs` | 任务公开结构、任务列表、取消、重试 |
| `server/services/workflowService.cjs` | 工作流列表、保存、复制、删除、版本列表、版本恢复和版本复制 |
| `server/services/rateLimitService.cjs` | 通用限流、代理头信任开关和限流测试 |
| `server/services/bootstrapService.cjs` | 启动管理员初始化和配置校验 |
| `server/services/securityHeadersService.cjs` | CSP 和浏览器安全响应头 |
| `server/services/sessionMiddlewareService.cjs` | 登录 Cookie 解析、Session 挂载、失效 Cookie 清理 |
| `server/services/gatewayService.cjs` | 统一注册 CORS、请求体限制、安全头、Session、API 鉴权、限流、请求日志、API 404 和网关错误响应 |
| `server/services/authSessionService.cjs` | 登录校验、Session 创建、登出、会话列表和 Session 审计 |
| `server/services/authEmailFlowService.cjs` | 邮箱验证码、注册确认、密码找回和验证码错误锁定 |
| `server/services/authAdminUserService.cjs` | 管理员用户列表、创建、改密、启停和用户审计日志 |
| `server/services/authInvitationService.cjs` | 邀请码列表、创建、禁用、公开格式和邀请码审计 |
| `server/services/apiAuthMiddlewareService.cjs` | API 总入口鉴权、公开路由放行、访问 Token 校验 |
| `server/services/requestConfigService.cjs` | 上传、限流、Cookie、注册和登录开关配置解析 |
| `server/services/requestIdentityService.cjs` | 管理员校验、请求用户 ID 解析和客户端 user id 信任边界 |

## 当前 worker

| Worker | 职责 |
| --- | --- |
| `server/workers/textWorker.cjs` | 文本任务队列、文本生成 service 和重启恢复 |
| `server/workers/generationWorker.cjs` | 图片、视频任务队列、生成 service 和重启恢复 |

## 当前 repository

| Repository | 职责 | 已接入 |
| --- | --- | --- |
| `server/repositories/taskRepository.cjs` | 封装任务查询、任务更新、任务日志、排队 claim 和任务资产关联 | `taskService`、`taskQueueService`、文本/图片/视频生成 service、任务重试日志 |
| `server/repositories/assetRepository.cjs` | 封装资产查询、资产写入、素材集合、容量统计 | `assetService`、`assetCollectionService`、`assetQuotaService`、图片/视频生成 service、健康检查资产计数 |
| `server/repositories/apiKeyRepository.cjs` | 封装 API Key 查询、写入、删除、配额统计和 Key 审计日志 | `apiKeyManagementService`、`credentialService` |
| `server/repositories/workflowRepository.cjs` | 封装工作流查询、保存、删除、版本列表、版本恢复和复制所需数据访问 | `workflowService` |
| `server/repositories/modelCapabilityRepository.cjs` | 封装模型能力列表、统计、保存和审计日志 | `modelCapabilityService`、`modelCapabilities` |
| `server/repositories/authRepository.cjs` | 封装用户、Session、邮箱验证码、邀请码、审计日志和启动管理员写入 | Auth services、`sessionMiddlewareService`、`app` |

## 当前 Gateway 边界

| 路由前缀 | 当前处理 | 可选上游配置 | 未来拆分方向 |
| --- | --- | --- | --- |
| `/api/auth/*` | `authRoutes` + Auth services | `WORKBENCH_GATEWAY_AUTH_URL` | `auth-service` |
| `/api/tasks/*` | `taskRoutes` + task/queue services | `WORKBENCH_GATEWAY_WORKER_URL` | `worker-service` 或 `task-service` |
| `/api/assets/*` | `assetRoutes` + asset services | `WORKBENCH_GATEWAY_ASSET_URL` | `asset-service` |
| `/api/workflows/*` | `workflowRoutes` + workflow service | `WORKBENCH_GATEWAY_WORKFLOW_URL` | `workflow-service` |
| `/api/models/*` | `modelProxyRoutes` + model services | `WORKBENCH_GATEWAY_MODEL_URL` | `model-service` |
| `/api/images/*`、`/api/videos/*` | generation routes + worker queues | `WORKBENCH_GATEWAY_WORKER_URL` | `worker-service` |

这一层现在还是 Express 内部模块，不是独立进程。它先把 CORS、Cookie/Session 鉴权、限流、请求日志、API 404、统一错误响应和可选内部转发集中起来。没有配置 `WORKBENCH_GATEWAY_*_URL` 时，请求继续进入当前单体 routes；配置后，匹配路由会先转发给内部服务。

转发时，Gateway 会剥离浏览器传来的 `Authorization`、`x-workbench-token` 和 `x-workbench-admin-token`，再补充内部请求 ID 和已认证用户 ID。除 `auth-service` 需要读取登录 Cookie 外，其他内部服务都会继续剥离浏览器 `Cookie`。内部服务后续应该只信任网关传入的内部身份头，不直接暴露公网。

## 下一步拆分顺序

| 优先级 | 任务 | 目标 |
| --- | --- | --- |
| 1 | 继续收薄大型路由 | 检查剩余 routes 是否还有数据库访问、审计或任务组装逻辑 |
| 2 | 继续 service 边界 | 优先扫 `taskRoutes`、`healthRoutes`、`providerRoutes` 和管理类路由的薄度 |
| 3 | 收口内部 Gateway | 继续把请求入口策略、日志、错误格式和路由映射集中到 `gatewayService` |
| 4 | 继续补进程边界测试 | 保证 API-only、worker-only、all-in-one 三种启动方式稳定 |
| 5 | 收紧部署配置 | 明确 Cookie、CORS、静态托管和健康检查策略 |

## 模块边界护栏

| 规则 | 自动化检查 |
| --- | --- |
| routes 不直接访问 repositories 或 db | `server/backendModuleBoundary.test.cjs` |
| services 不直接依赖 routes 或 db | `server/backendModuleBoundary.test.cjs` |
| repositories 不反向依赖 routes、services、workers | `server/backendModuleBoundary.test.cjs` |
| workers 不直接依赖 routes、repositories 或 db | `server/backendModuleBoundary.test.cjs` |
| API 入口不启动 worker，worker 入口不依赖 HTTP 路由 | `server/processBoundary.test.cjs` |
| worker runtime 的 start/stop 可重复调用 | `server/workerRuntime.test.cjs` |
| API 和 Worker 分进程后仍能消费后续任务 | `server/splitProcessRuntime.test.cjs` |
| 分离部署时后端只做 API，CORS 和跨域 Cookie 行为稳定 | `server/appSplitDeployment.test.cjs` |
| Gateway 统一入口行为稳定 | `server/gatewayService.test.cjs` |

## 前后端分离原则

| 原则 | 说明 |
| --- | --- |
| 前端不保存明文 API Key | 服务器模式只保存后端加密后的 Key |
| 前端不决定 `user_id` | 用户身份从 Session 或访问 Token 得到 |
| 前端不直接访问磁盘路径 | 资产统一通过 `/api/assets/:id` 读取 |
| 前端不直接调用第三方模型 | 模型调用统一走后端代理和适配层 |
| 前端测试模型只传 `apiKeyId` | 后端解密后探测能力 |
| 后端返回稳定 JSON | 前端后续可按设计稿自由重做 |

## 验收要求

每拆一个模块，都要通过：

```bash
npx tsc -b --pretty false
npm test
npm run lint
npm run build
node --check server/index.cjs
node --check server/app.cjs
node --check server/worker.cjs
```

新增路由模块时，还要执行：

```bash
node --check server/routes/<module>.cjs
```

## 当前已拆出的服务边界

| 服务边界 | 启动命令 | 当前职责 |
| --- | --- | --- |
| `worker-service` | `npm run start:worker-service` | `/api/tasks/*`、`POST /api/images`、`/api/videos/*` |
| `asset-service` | `npm run start:asset-service` | `/api/assets/*`、`GET /api/images/:id`、`/api/asset-collections/*`、`/api/asset-collection-templates` |
| `model-service` | `npm run start:model-service` | `/api/models`、`/api/api-keys/*`、`/api/model-capabilities/*`、`/api/providers`、`/api/chat`、`/api/claude` |
| `auth-service` | `npm run start:auth-service` | `/api/auth/*`、`/api/admin/users`、`/api/admin/audit-logs`、`/api/admin/invitations` |
| `workflow-service` | `npm run start:workflow-service` | `/api/workflows/*`、工作流版本、恢复、复制、删除 |

这些服务默认都监听 `127.0.0.1`。公网入口仍然应该是 Gateway。
