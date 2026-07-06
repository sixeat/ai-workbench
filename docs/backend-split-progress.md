# 后端拆分进度清单

结论：后端已经从“单体 Express 服务”推进到“模块化单体 + API/Worker 分进程 + 可选 Gateway 转发 + 五个内部服务骨架”。当前还不应该宣称最终完成，但主干边界已经成型。

更新时间：2026-07-06

## 5 分钟版

| 阶段 | 目标 | 当前状态 | 判断 |
| --- | --- | --- | --- |
| 阶段 1 | 模块化单体 | `routes / services / repositories / adapters` 已基本拆清 | 接近完成 |
| 阶段 2 | API 和 Worker 分进程 | 已有 `start:api`、`start:worker`、`start:all`，并有双进程测试 | 已完成基础版 |
| 阶段 3 | 前后端分离 | 支持 `VITE_PROXY_URL`、API-only、CORS、跨域 Cookie、健康检查拆分 | 已完成基础版 |
| 阶段 4 | Gateway | 已有内部 Gateway，支持 CORS、Session、限流、日志、转发、统一错误 | 已完成基础版 |
| 阶段 5 | 按压力拆服务 | 已有 `worker / asset / model / auth / workflow` 五个内部服务入口和 PM2 六进程配置 | 已完成骨架 |

## 阶段 1：模块化单体

| 要求 | 当前证据 | 状态 |
| --- | --- | --- |
| 拆清 `routes / services / repositories / adapters` | `server/routes/*`、`server/services/*`、`server/repositories/*`、`text/image/videoProviderAdapters.cjs` | 基本完成 |
| 路由不直接访问数据库 | `server/backendModuleBoundary.test.cjs` 覆盖 routes 不直连 repositories/db | 已验证 |
| 数据库访问集中到 repository 或 db service | `taskRepository`、`assetRepository`、`apiKeyRepository`、`workflowRepository`、`modelCapabilityRepository`、`authRepository` | 已验证 |
| 统一错误格式 | 主要路由使用 `sendSafeError`，Gateway 也有统一错误处理 | 基础完成 |
| 统一权限校验 | API 鉴权、Session、中间服务身份校验已服务化 | 基础完成 |
| 统一审计日志 | `auth / apiKeys / modelCapabilities / workflows / assets` 已写入 `audit_logs`，tasks 使用 `task_logs` | 本轮补强 |
| 稳定 auth/users/apiKeys/tasks/assets/workflows/modelCapabilities/generation | 对应 service、repository、路由和测试均存在 | 基础完成 |

本轮新增：

| 模块 | 改动 |
| --- | --- |
| assets | 上传图片写入 `asset.upload` 审计日志 |
| asset collections | 创建、更新、删除、添加、批量添加、移除、排序写入 `asset_collection.*` 审计日志 |
| workflow | 创建、更新、删除、复制、版本恢复、版本复制写入 `workflow.*` 审计日志 |
| tests | 增加 service 层和 route 层审计测试，确认不会把 dataUrl、prompt、note、metadata 大内容写入审计 |

## 阶段 2：API 和 Worker 分进程

| 要求 | 当前证据 | 状态 |
| --- | --- | --- |
| API 只处理 HTTP 请求 | `server/api.cjs` 设置 `WORKBENCH_START_WORKERS=false` | 已完成 |
| Worker 只消费 queued 任务 | `server/worker.cjs`、`server/workerRuntime.cjs` | 已完成 |
| API 和 Worker 共用数据库 | `server/splitProcessRuntime.test.cjs` 真实启动两个进程验证 | 已验证 |
| API 创建任务后返回 taskId | `/api/chat`、`/api/images`、`/api/videos` 队列测试覆盖 | 已验证 |
| Worker 执行文本、图片、视频任务 | `textWorker`、`generationWorker`、`taskQueueService` | 已验证 |
| Worker 支持重启恢复 running/queued | `taskQueueService.test.cjs` 覆盖 running 恢复和冷启动 queued 扫描 | 已验证 |
| 启动命令 | `npm run start:api`、`npm run start:worker`、`npm run start:all` | 已完成 |

## 阶段 3：前后端彻底分离

| 要求 | 当前证据 | 状态 |
| --- | --- | --- |
| 前端走 `VITE_PROXY_URL` | `src/lib/apiProxy.ts` 和对应测试 | 已完成 |
| 后端关闭静态托管 | `WORKBENCH_SERVE_STATIC=false`、`appSplitDeployment.test.cjs` | 已验证 |
| CORS 只允许前端域名 | `WORKBENCH_CORS_ORIGIN`、部署检查和运行时测试 | 已验证 |
| Cookie 跨域配置 | `SameSite=None`、`Secure=true`、`Domain=.example.com` 测试覆盖 | 已验证 |
| `/api/health` 给负载均衡 | public health 不暴露路径细节 | 已验证 |
| `/api/admin/health` 给管理员 | admin health 受管理员权限保护 | 已验证 |

## 阶段 4：Gateway

| 要求 | 当前证据 | 状态 |
| --- | --- | --- |
| 统一 CORS | `gatewayService.cjs` 集中注册 CORS | 已完成 |
| Cookie/session 鉴权 | Gateway 挂载 session middleware 和 API auth middleware | 已完成 |
| 限流 | Gateway 对生成、上传、代理等高风险入口限流 | 已完成 |
| 请求日志 | `WORKBENCH_GATEWAY_REQUEST_LOGS` 或 `WORKBENCH_REQUEST_LOGS` 开启 | 已完成 |
| 路由转发 | `WORKBENCH_GATEWAY_*_URL` 支持按服务边界转发 | 已完成 |
| 统一错误响应 | Gateway API 404 和异常归一化测试覆盖 | 已完成 |
| 内部服务不直接暴露公网 | 服务默认监听 `127.0.0.1`，并支持内部 token 和网关身份头 | 基础完成 |

## 阶段 5：按压力拆服务

| 服务 | 启动命令 | 当前边界 | 状态 |
| --- | --- | --- | --- |
| worker-service | `npm run start:worker-service` | tasks、图片生成、视频生成 | 已有骨架和测试 |
| asset-service | `npm run start:asset-service` | assets、images 读取、asset collections | 已有骨架和测试 |
| model-service | `npm run start:model-service` | models、apiKeys、modelCapabilities、providers、chat、claude | 已有骨架和测试 |
| auth-service | `npm run start:auth-service` | auth、admin users、audit logs、invitations | 已有骨架和测试 |
| workflow-service | `npm run start:workflow-service` | workflows、versions、restore、duplicate、delete | 已有骨架和测试 |

## 当前验证结果

| 命令 | 结果 |
| --- | --- |
| `node --test server\workflowService.test.cjs server\workflowRoutes.test.cjs server\workflowServiceApp.test.cjs server\deploymentCheck.test.cjs` | 通过 |
| `node --test server\assetService.test.cjs server\assetCollectionService.test.cjs server\assetCollectionRoutesIsolation.test.cjs server\assetUploadLimits.test.cjs server\assetServiceApp.test.cjs server\assetRepositoryBoundary.test.cjs` | 通过 |
| `npm.cmd test` | 538 个测试通过 |
| `npx.cmd tsc -b --pretty false` | 通过 |
| `npm.cmd run lint` | 通过 |
| `npm.cmd run build` | 通过 |
| `node --test server\pm2EcosystemConfig.test.cjs server\processBoundary.test.cjs server\deploymentCheck.test.cjs` | 通过 |

## 还没最终收口的点

| 优先级 | 待办 | 原因 |
| --- | --- | --- |
| P0 | 做一次完整安全复查 | 服务拆分后要再查 SSRF、路径、CORS、Cookie、内部 token、代理转发 |
| P0 | 做一次 P1-P5 最终逐项审计 | 只有审计证据覆盖全部要求后，才能说目标完成 |
| P1 | 梳理 `server/db.cjs` 大文件 | Repository 已接管入口，但底层 db 文件仍偏大 |
| P1 | 继续减少 route 层手写错误响应 | 现在已稳定，但还可以进一步统一到 helper |
| P1 | 按真实服务器 `.env` 演练 PM2 六进程启动 | 配置文件已补，仍需要在服务器上验证实际域名、Cookie、SMTP、数据目录 |
| P2 | 后续再考虑真正独立网关进程 | 当前 Gateway 是 Express 内部层，已经支持转发，但还不是独立网关服务 |

## 下一步建议

先做“最终安全复查 + 部署脚本”。如果这一步通过，再把当前代码推一个后端架构版本。之后你可以放心去做前端设计稿，前端只围绕稳定 API 重做界面。
