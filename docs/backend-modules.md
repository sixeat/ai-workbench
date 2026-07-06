# 后端模块拆分规划

结论：后端正在从单文件 `server/index.cjs` 拆成按业务划分的模块。目标不是重写功能，而是稳定 API 边界。这样你后面可以先做前端设计稿，再按稳定接口重做前端。

## 5 分钟版

| 原则 | 说明 |
| --- | --- |
| 前端只调用 `/api/*` | 前端不直接访问磁盘、第三方模型或明文 Key |
| 后端负责权限 | 用户、管理员、Session、访问 Token 都在后端判断 |
| 路由保持轻量 | 路由做参数校验和响应，业务逻辑下沉到 service |
| 数据层集中 | SQLite 访问集中在 `server/db.cjs` |
| 部署可分离 | 后端可只做 API，前端可部署到 Nginx、Vercel 或 OSS CDN |

## 当前模块

| 模块 | 状态 | 职责 |
| --- | --- | --- |
| `server/index.cjs` | 拆分中 | 服务启动、全局中间件、CORS、静态托管入口 |
| `server/routes/authRoutes.cjs` | 已拆分 | 登录、注册、邮箱验证、忘记密码、用户管理、邀请码 |
| `server/routes/apiKeyRoutes.cjs` | 已拆分 | 用户 Key 和服务器 Key 的增删改查 |
| `server/routes/taskRoutes.cjs` | 已拆分 | 任务列表、任务详情、取消、重试 |
| `server/routes/assetRoutes.cjs` | 已拆分 | 资产列表、上传、集合、读取、旧图片接口兼容 |
| `server/routes/modelProxyRoutes.cjs` | 已拆分 | 模型列表、文本聊天、Claude、通用代理、模型能力表 |
| `server/routes/generationRoutes.cjs` | 已拆分 | 图片生成、视频生成、视频任务查询、产物落盘 |
| `server/routes/healthRoutes.cjs` | 已拆分 | 公开健康检查和管理员详细健康检查 |
| `server/db.cjs` | 保留 | SQLite 表结构和数据访问 |
| `server/security.cjs` | 保留 | 安全策略、CORS、Token、代理白名单 |
| `server/mailer.cjs` | 保留 | SMTP 邮件和开发验证码 |
| `server/assetStorage.cjs` | 保留 | 本地资产存储抽象 |
| `server/modelCapabilities.cjs` | 保留 | 模型能力过滤和参数适配 |

## 当前 service

| Service | 职责 |
| --- | --- |
| `server/services/credentialService.cjs` | Key 加密、Key 权限判断、调用凭据解析 |
| `server/services/proxyService.cjs` | URL 拼接和第三方 HTTP 请求代理 |
| `server/services/secretService.cjs` | 读取本地 secrets 和服务器环境变量托管 Key |
| `server/services/apiKeyTestService.cjs` | 已保存 Key 的模型列表探测和能力测试 |
| `server/services/mediaUrlService.cjs` | 本地资产 URL 转公网可访问 URL |
| `server/services/imageGenerationService.cjs` | 图片生成、能力过滤、图片落盘、任务状态更新 |
| `server/services/videoGenerationService.cjs` | 视频生成、视频模型适配、任务查询、任务状态更新 |
| `server/services/taskService.cjs` | 任务公开结构、任务列表、取消、重试 |
| `server/services/rateLimitService.cjs` | 通用限流、代理头信任开关和限流测试 |
| `server/services/bootstrapService.cjs` | 启动管理员初始化和配置校验 |
| `server/services/securityHeadersService.cjs` | CSP 和浏览器安全响应头 |
| `server/services/sessionMiddlewareService.cjs` | 登录 Cookie 解析、Session 挂载、失效 Cookie 清理 |
| `server/services/apiAuthMiddlewareService.cjs` | API 总入口鉴权、公开路由放行、访问 Token 校验 |
| `server/services/requestConfigService.cjs` | 上传、限流、Cookie、注册和登录开关配置解析 |
| `server/services/requestIdentityService.cjs` | 管理员校验、请求用户 ID 解析和客户端 user id 信任边界 |

## 下一步拆分顺序

| 优先级 | 任务 | 目标 |
| --- | --- | --- |
| 1 | 补服务端路由测试 | 覆盖登录、API Key、资产上传、生成参数校验 |
| 2 | 拆路由注册服务 | 把 `index.cjs` 里的路由挂载集中到 `routeRegistrationService.cjs` |
| 3 | 继续 service 化文本生成 | 让 `/api/chat` 只负责收参和返回 |
| 4 | 收紧部署配置 | 明确 Cookie、CORS、静态托管和健康检查策略 |

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
```

新增路由模块时，还要执行：

```bash
node --check server/routes/<module>.cjs
```
