# AI Workbench 后端架构审计清单

结论：当前后端已经满足“模块化单体 → API/Worker 分进程 → 前后端分离 → Gateway → 内部服务骨架”的主线目标。剩余风险主要是生产环境演练，而不是代码结构缺口。

更新时间：2026-07-06

## 5 分钟版

| 阶段 | 目标 | 当前状态 | 证据 |
| --- | --- | --- | --- |
| 阶段 1 | 模块化单体 | 已完成主边界 | `server/backendModuleBoundary.test.cjs` |
| 阶段 2 | API 和 Worker 分进程 | 已完成 | `server/processBoundary.test.cjs`、`server/splitProcessRuntime.test.cjs` |
| 阶段 3 | 前后端分离 | 已完成代码能力 | `server/appSplitDeployment.test.cjs`、`src/lib/apiProxy.test.ts` |
| 阶段 4 | Gateway | 已完成内置网关层 | `server/gatewayService.test.cjs` |
| 阶段 5 | 按压力拆服务 | 已完成五个内部服务骨架 | `server/*ServiceApp.test.cjs`、`ecosystem.config.cjs` |

## 阶段 1：模块化单体

为什么先做这一步：后续拆进程和拆服务都依赖清晰边界。如果 route 里直接写复杂业务，后面拆服务会变成复制粘贴。

| 要求 | 当前证据 | 状态 |
| --- | --- | --- |
| 拆清 `routes / services / repositories / adapters` | `server/routes`、`server/services`、`server/repositories`、`text/image/videoProviderAdapters.cjs` | 已完成 |
| 模块暴露明确接口 | 各 service 使用 `createXService`，各 repository 使用 `createXRepository` | 已完成 |
| 稳定 `auth / users / apiKeys / tasks / assets / workflows / modelCapabilities / generation` | 对应 route、service、repository 和测试均存在 | 已完成 |
| route 不直接访问 DB | `server/backendModuleBoundary.test.cjs` 禁止 route import db/repository | 已完成 |
| service 不直接访问 DB | `server/backendModuleBoundary.test.cjs` 禁止 service import db | 已完成 |
| App 组装层不直接访问 DB | `server/backendModuleBoundary.test.cjs` 禁止 app 组装模块 import db | 已完成 |
| DB 访问集中到 repository | 生产代码中只有 `server/repositories/*` import `db.cjs` | 已完成 |
| 统一错误格式 | `sendSafeError`、`safeTaskError`、Gateway error handler 有测试覆盖 | 已完成 |
| 审计日志 | auth、apiKeys、assets、workflows、modelCapabilities 关键变更写 audit log | 已完成 |
| 权限校验 | session、admin、gateway identity、user isolation 测试覆盖 | 已完成 |

## 阶段 2：API 和 Worker 分进程

为什么做这一步：图片、视频任务耗时很长。API 进程不应该被生成任务拖住。

| 要求 | 当前证据 | 状态 |
| --- | --- | --- |
| `api-server` 只处理 HTTP | `server/api.cjs` 设置 `WORKBENCH_START_WORKERS=false` | 已完成 |
| `worker` 只消费 queued 任务 | `server/worker.cjs` 不依赖 Express 或 routes | 已完成 |
| API 和 Worker 共用数据库 | `server/splitProcessRuntime.test.cjs` 启动双进程验证 | 已完成 |
| API 创建任务后返回 `taskId` | `textTaskRequestService`、`generationTaskRequestService` 测试覆盖 | 已完成 |
| Worker 执行文本、图片、视频 | `server/workerRuntime.test.cjs` 覆盖三类任务 | 已完成 |
| Worker 支持重启恢复 | `server/taskQueueService.test.cjs` 覆盖 running 恢复和 queued 冷启动扫描 | 已完成 |
| 启动命令 | `package.json` 包含 `start:api`、`start:worker`、`start:all` | 已完成 |

## 阶段 3：前后端彻底分离

为什么做这一步：SaaS 化后，前端会独立托管。后端只需要稳定 API。

| 要求 | 当前证据 | 状态 |
| --- | --- | --- |
| 前端走 `VITE_PROXY_URL` | `src/lib/apiProxy.ts` 和 `src/lib/apiProxy.test.ts` | 已完成 |
| 后端可关闭静态托管 | `WORKBENCH_SERVE_STATIC=false` 由部署检查和运行时测试覆盖 | 已完成 |
| CORS 只允许前端域名 | `deploymentCheck` 和 `appSplitDeployment` 覆盖 | 已完成 |
| Cookie 支持跨域 | SameSite、Secure、Domain 测试覆盖 | 已完成 |
| `/api/health` 给负载均衡 | public health 最小化，不暴露路径 | 已完成 |
| `/api/admin/health` 给管理员 | admin health 需要管理员权限 | 已完成 |

## 阶段 4：Gateway

为什么做这一步：Gateway 是未来拆服务的统一入口。它让内部服务不用直接暴露公网。

| 要求 | 当前证据 | 状态 |
| --- | --- | --- |
| CORS | `createApiGateway` 集中配置 CORS | 已完成 |
| Cookie/session 鉴权 | Gateway 挂载 session middleware 和 API auth middleware | 已完成 |
| 限流 | 生成、上传、代理入口集中限流 | 已完成 |
| 请求日志 | `WORKBENCH_GATEWAY_REQUEST_LOGS` 控制请求日志 | 已完成 |
| 路由转发 | `GATEWAY_ROUTE_TABLE` 覆盖 auth、tasks、assets、workflows、models | 已完成 |
| 统一错误响应 | Gateway 404 和异常响应测试覆盖 | 已完成 |
| 内部服务不直接暴露公网 | PM2 默认 `127.0.0.1`，部署检查和运行时守卫禁止危险监听 | 已完成 |
| 内部服务转发鉴权 | Gateway 注入 `x-workbench-user-id` 和可选 `WORKBENCH_INTERNAL_SERVICE_TOKEN` | 已完成 |

## 阶段 5：按压力拆服务

为什么这样拆：先把耗时和资源压力最大的部分独立。后续可以逐个服务迁到不同机器或容器。

| 服务 | 当前入口 | 当前边界 | 状态 |
| --- | --- | --- | --- |
| `worker-service` | `server/workerService.cjs` | tasks、images、videos、队列 worker | 已完成骨架 |
| `asset-service` | `server/assetService.cjs` | assets、images 读取、asset collections | 已完成骨架 |
| `model-service` | `server/modelService.cjs` | models、apiKeys、capabilities、providers、chat、proxy | 已完成骨架 |
| `auth-service` | `server/authService.cjs` | login、register、password reset、admin users、audit logs | 已完成骨架 |
| `workflow-service` | `server/workflowService.cjs` | workflows、versions、restore、duplicate、delete | 已完成骨架 |

## 生产前仍要做

这些不是代码结构阻塞，但上线前必须演练。

| 项目 | 为什么 |
| --- | --- |
| 用真实 `.env` 跑 `npm run check:deploy` | 防止域名、Cookie、SMTP、内部服务地址配置错误 |
| 用 PM2 启动六进程 | 验证 `ecosystem.config.cjs` 和真实服务器端口 |
| 配反向代理和 HTTPS | 跨域 Cookie 需要 HTTPS 和正确域名 |
| 跑一次注册、登录、上传、生成、任务历史 | 验证真实 SMTP、模型 API、文件存储都可用 |
| 备份 SQLite 和 outputs | 当前生产形态仍是 SQLite + 本地 outputs |

## 验证命令

```bash
npm run check:deploy
npm test
npx tsc -b --pretty false
npm run lint
npm run check:mojibake
npm run build
```
