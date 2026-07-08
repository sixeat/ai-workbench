# AI Workbench 服务器部署说明

结论：正式服务器采用“前端静态托管 + 后端只提供 API”的方式。后端不再托管 `dist` 页面，前端单独放到 Nginx、Vercel、OSS 或 CDN。

## 5 分钟版

如果你还没决定用哪种方式部署，先看 [部署模式清单](./deployment-modes.md)。默认先用单机服务器模式，等任务量上来后再考虑 API/Worker 分进程。

先把后端作为 API 服务跑起来：

```bash
cd /home/admin/apps/ai-workbench
npm install
cp .env.example .env
npm run start:server
```

如果你用 PM2 常驻运行：

```bash
cd /home/admin/apps/ai-workbench
pm2 start server/index.cjs --name ai-workbench --cwd /home/admin/apps/ai-workbench
pm2 save
```

健康检查地址：

```text
http://服务器IP:3000/api/health
```

## 推荐配置

后端 API 服务可以先这样配：

```bash
PROXY_HOST=0.0.0.0
PROXY_PORT=3000
VITE_PROXY_URL=https://后端API域名

WORKBENCH_DEPLOYMENT_MODE=server
WORKBENCH_SERVE_STATIC=false
WORKBENCH_CORS_ORIGIN=https://前端域名
WORKBENCH_PUBLIC_BASE_URL=https://后端API域名

WORKBENCH_COOKIE_SAMESITE=None
WORKBENCH_COOKIE_SECURE=true
WORKBENCH_COOKIE_DOMAIN=.你的主域名

WORKBENCH_REQUIRE_LOGIN=true
WORKBENCH_ALLOW_PUBLIC_REGISTRATION=false
WORKBENCH_REQUIRE_INVITATION_CODE=false

WORKBENCH_TEXT_QUEUE_CONCURRENCY=2
WORKBENCH_GENERATION_QUEUE_CONCURRENCY=2
WORKBENCH_GENERATION_FETCH_TIMEOUT_MS=0

WORKBENCH_ADMIN_TOKEN=换成一段管理员专用随机字符串
WORKBENCH_KEY_SECRET=换成一段足够长的随机字符串

WORKBENCH_DATA_DIR=/home/admin/apps/ai-workbench-data/data
WORKBENCH_DB_PATH=/home/admin/apps/ai-workbench-data/data/ai-workbench.sqlite
IMAGE_OUTPUT_DIR=/home/admin/apps/ai-workbench-data/outputs
```

生成 `WORKBENCH_KEY_SECRET`：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

启动前先跑部署检查：

```bash
npm run check:deploy
```

如果输出 `Result: FAILED`，先按错误提示修 `.env`，再启动服务。

如果部署检查提示没有管理员入口，先确认二选一：

| 方式 | 适合场景 |
| --- | --- |
| 配置 `WORKBENCH_ADMIN_EMAIL` 和 `WORKBENCH_ADMIN_PASSWORD` | 第一次启动服务器，自动创建管理员账号 |
| 配置 `WORKBENCH_ADMIN_TOKEN` | 临时保留管理员 API 入口，便于修复后台权限 |

如果数据库里已经有启用状态的管理员账号，可以忽略这个提醒。

## 前后端分离部署

分离部署时，后端只跑 API。前端可以放到 Nginx、Vercel、OSS CDN 或其他静态托管服务。

完整静态托管配置见 [前端静态托管说明](./frontend-static-hosting.md)。

先分清这三个地址。它们不是同一个东西：

| 变量 | 应该填写 | 示例 | 填错后的现象 |
| --- | --- | --- | --- |
| `VITE_PROXY_URL` | 后端 API 公开地址 | `https://api.example.com` | 前端请求发错地方 |
| `WORKBENCH_CORS_ORIGIN` | 前端页面公开地址 | `https://workbench.example.com` | 浏览器拦截登录和 API 请求 |
| `WORKBENCH_PUBLIC_BASE_URL` | 后端 API 公开地址 | `https://api.example.com` | 第三方模型访问不到本地素材 |

这三项都写域名 origin。不要写 `/api`、路径、query 或 hash。
`WORKBENCH_CORS_ORIGIN` 也不要带尾部 `/`，否则浏览器发来的 Origin 不会匹配。

不要把 `WORKBENCH_CORS_ORIGIN` 填成后端 API 域名。它必须是浏览器地址栏里打开的前端页面域名。

后端 `.env`：

```bash
WORKBENCH_DEPLOYMENT_MODE=server
WORKBENCH_SERVE_STATIC=false
WORKBENCH_CORS_ORIGIN=https://前端域名
WORKBENCH_PUBLIC_BASE_URL=https://后端API域名
```

前端构建时设置：

```bash
VITE_PROXY_URL=https://后端API域名
npm run build
```

后端启动前检查：

```bash
npm run check:deploy
```

分离部署后，浏览器所有 `/api/...` 请求都会走 `VITE_PROXY_URL`。后端不再假设前端和 API 同源。

生产前端构建必须显式设置 `VITE_PROXY_URL`。如果你确实要让前端和后端同源部署，请写 `VITE_PROXY_URL=/`，不要留空。

`WORKBENCH_PUBLIC_BASE_URL` 用于把本地资产 URL 转成第三方模型可访问的公网 URL。分离部署时它通常应该指向后端 API 域名，而不是前端静态页面域名。

代码里有一组分离部署运行时测试：`server/appSplitDeployment.test.cjs`。它会验证三件事：

| 验证项 | 通过标准 |
| --- | --- |
| API-only 模式 | `WORKBENCH_SERVE_STATIC=false` 时，`/` 和 `/index.html` 返回 `404` |
| CORS 凭证 | 只有 `WORKBENCH_CORS_ORIGIN` 配置的前端域名能拿到 credential 响应头 |
| 跨域登录 Cookie | 登录 Cookie 带 `HttpOnly`、`SameSite=None`、`Secure` 和 `Domain` |

改动前后端分离配置后，建议至少跑一次：

```bash
node --test server/appSplitDeployment.test.cjs
```

## Cookie 和登录

同域部署可以使用默认配置：

```bash
WORKBENCH_COOKIE_SAMESITE=Lax
WORKBENCH_COOKIE_SECURE=
WORKBENCH_COOKIE_DOMAIN=
```

如果前端域名和 API 域名不同，并且都使用 HTTPS，建议这样配：

```bash
WORKBENCH_CORS_ORIGIN=https://前端域名
WORKBENCH_COOKIE_SAMESITE=None
WORKBENCH_COOKIE_SECURE=true
WORKBENCH_COOKIE_DOMAIN=.你的主域名
```

注意：`SameSite=None` 必须配合 `Secure=true`。否则浏览器会拒收登录 Cookie。

## 注册策略

默认策略更安全：关闭公开注册，也先关闭邀请码注册。这样没有 SMTP 时，管理员仍然可以在后台手动创建用户。

```bash
WORKBENCH_ALLOW_PUBLIC_REGISTRATION=false
WORKBENCH_REQUIRE_INVITATION_CODE=false
```

如果你想用邀请码注册，先配置 SMTP，再打开邀请码注册：

```bash
WORKBENCH_SMTP_HOST=smtp.example.com
WORKBENCH_SMTP_PORT=587
WORKBENCH_SMTP_SECURE=false
WORKBENCH_SMTP_USER=你的邮箱账号
WORKBENCH_SMTP_PASS=你的邮箱授权码
WORKBENCH_SMTP_FROM="AI Workbench <no-reply@example.com>"

WORKBENCH_ALLOW_PUBLIC_REGISTRATION=false
WORKBENCH_REQUIRE_INVITATION_CODE=true
```

如果你想让任何人用邮箱验证码注册，也必须先配置 SMTP：

```bash
WORKBENCH_SMTP_HOST=smtp.example.com
WORKBENCH_ALLOW_PUBLIC_REGISTRATION=true
WORKBENCH_REQUIRE_INVITATION_CODE=false
```

验证码请求会同时按邮箱和 IP 限流。

| 变量 | 默认值 | 作用 |
| --- | ---: | --- |
| `WORKBENCH_EMAIL_CODE_WINDOW_MS` | `3600000` | 限流窗口，默认 1 小时 |
| `WORKBENCH_EMAIL_CODE_EMAIL_LIMIT` | `3` | 同一邮箱在窗口内最多请求次数 |
| `WORKBENCH_EMAIL_CODE_IP_LIMIT` | `20` | 同一 IP 在窗口内最多请求次数 |
| `WORKBENCH_EMAIL_CODE_MAX_VERIFY_ATTEMPTS` | `5` | 同一验证码最多允许输错次数，超过后必须重新获取 |

## 任务队列并发

后端有两条本地 worker 队列：

| 队列 | 负责内容 | 默认并发 |
| --- | --- | ---: |
| 文本队列 | 聊天、剧本、分镜、提示词优化等文本任务 | `2` |
| 生成队列 | 图片生成、视频生成等高成本任务 | `2` |

配置方式：

```bash
WORKBENCH_TEXT_QUEUE_CONCURRENCY=2
WORKBENCH_GENERATION_QUEUE_CONCURRENCY=2
WORKBENCH_TASK_QUEUE_POLL_INTERVAL_MS=1000
WORKBENCH_GENERATION_FETCH_TIMEOUT_MS=0
```

文本、图片和视频生成经常超过 60 秒。`WORKBENCH_GENERATION_FETCH_TIMEOUT_MS=0` 表示生成请求已经到达上游后，本地不再倒计时截断。普通接口仍使用较短的 `WORKBENCH_FETCH_TIMEOUT_MS`。只有你明确想给生成请求设置本地截止时间时，才把它改成正数毫秒。

长视频不要让一个 HTTP 请求挂一天。后端会先把视频任务提交到上游，保存上游任务 ID，然后在任务历史里继续查询状态。视频跨小时或跨天时，用户可以稍后回到任务历史里刷新结果。

启动方式：

| 命令 | 作用 | 适合场景 |
| --- | --- | --- |
| `npm run start:server` | 部署检查通过后，启动 HTTP API 和本地 worker | 默认上线方式 |
| `npm start` | 直接启动 HTTP API 和本地 worker | 已确认配置正确后的常驻进程 |
| `npm run start:api` | 只启动 HTTP API，不消费生成任务 | 高级分进程部署 |
| `npm run start:worker` | 不启动 HTTP，只消费 `queued` 任务 | 高级分进程部署 |
| `npm run start:all` | 兼容旧命令，等同于单进程启动 | 本地调试或旧脚本兼容 |

默认不需要分进程。分进程部署时，API 和 worker 必须连接同一个 SQLite 数据库和同一个 `outputs` 目录。API 创建任务后立即返回 `taskId`，worker 会按 `WORKBENCH_TASK_QUEUE_POLL_INTERVAL_MS` 扫描数据库，发现 `queued` 任务后继续执行。

代码边界上，`server/api.cjs` 只负责关闭本进程 worker 并启动 HTTP API。`server/worker.cjs` 不加载 Express app，也不依赖 routes。这个规则由 `server/processBoundary.test.cjs` 检查。

运行边界上，`server/splitProcessRuntime.test.cjs` 会真实启动 API 进程和 Worker 进程。测试覆盖 Worker 先启动，API 后创建文本、图片、视频任务，Worker 再从数据库消费任务的场景。

先保持默认值。只有当服务器 CPU、内存、上游 API 额度都稳定时，再逐步调大。

不要把生成队列并发一次调太高。图片和视频任务会更快消耗额度，也更容易触发厂商限流。

## API Key 和模型能力

服务器版推荐在后台管理里保存 Key。前端不会持久保存明文 Key。

| Key 类型 | 用途 |
| --- | --- |
| `server_key` | 管理员托管，适合给朋友共用 |
| `user_key` | 预留给每个用户自带 Key |

普通用户默认最多保存 20 个自己的 Key：

```bash
WORKBENCH_MAX_USER_API_KEYS=20
WORKBENCH_ALLOW_DIRECT_API_KEYS=false
```

服务器模式不要开启 `WORKBENCH_ALLOW_DIRECT_API_KEYS`。用户自定义 API 也应该先保存到后端，再通过 `apiKeyId` 调用模型。

模型能力也在后台维护。你可以为不同厂商和模型记录限制，例如参考图数量、视频时长、是否支持 seed、是否支持负面词。

后台提供内置能力模板。你可以先套用厂商模板，再按文档微调 JSON。接口是：

```bash
curl http://127.0.0.1:3000/api/model-capability-presets
```

## 上传和素材容量

上传接口会限制单文件大小、用户素材总容量、每日上传量。

| 变量 | 默认值 | 作用 |
| --- | ---: | --- |
| `WORKBENCH_MAX_UPLOAD_FILE_MB` | `20` | 单个上传文件最大体积 |
| `WORKBENCH_MAX_USER_ASSET_STORAGE_MB` | `2048` | 每个用户所有素材总容量 |
| `WORKBENCH_MAX_DAILY_UPLOAD_MB` | `200` | 每个用户每日上传容量 |

用户素材总容量会统计上传和生成产物。每日上传量只统计 `/api/assets/upload` 上传的素材。

## 健康检查

负载均衡或探活使用简单健康检查：

```bash
curl http://127.0.0.1:3000/api/health
```

管理员查看详细状态：

```bash
curl http://127.0.0.1:3000/api/admin/health \
  -H "x-workbench-admin-token: 你的管理员令牌"
```

`/api/health` 只适合判断服务是否可用。数据库路径、输出目录等敏感信息只放在 `/api/admin/health`。

## 网关请求日志

后端内部已经有轻量 Gateway 层。它集中处理 CORS、Cookie/Session 鉴权、限流、请求日志、API 404 和统一错误响应。

默认不打印每个请求，避免日志太吵。需要排查线上问题时可以临时打开：

```bash
WORKBENCH_GATEWAY_REQUEST_LOGS=true
```

日志会记录请求方法、路径、状态码、耗时、请求 ID、命中的未来服务边界。它不会记录 query、Cookie、Authorization 或 API Key。

## 网关路由转发

默认保持单体运行，不需要配置上游地址：

```bash
WORKBENCH_GATEWAY_AUTH_URL=
WORKBENCH_GATEWAY_WORKER_URL=
WORKBENCH_GATEWAY_ASSET_URL=
WORKBENCH_GATEWAY_MODEL_URL=
WORKBENCH_GATEWAY_WORKFLOW_URL=
```

以后拆出内部服务时，再逐项配置。值必须是 origin，不要带 `/api`、路径、query 或 hash。

| 配置项 | 转发路由 | 目标服务 |
| --- | --- | --- |
| `WORKBENCH_GATEWAY_AUTH_URL` | `/api/auth/*` | `auth-service` |
| `WORKBENCH_GATEWAY_WORKER_URL` | `/api/tasks/*`、`/api/images/*`、`/api/videos/*` | `worker-service` |
| `WORKBENCH_GATEWAY_ASSET_URL` | `/api/assets/*` | `asset-service` |
| `WORKBENCH_GATEWAY_MODEL_URL` | `/api/models/*`、`/api/api-keys/*`、`/api/chat`、`/api/claude` | `model-service` |
| `WORKBENCH_GATEWAY_WORKFLOW_URL` | `/api/workflows/*` | `workflow-service` |

示例：

```bash
WORKBENCH_GATEWAY_WORKER_URL=http://127.0.0.1:4102
```

> [!WARNING]
> 这些上游服务应该只监听内网、VPC 或 `127.0.0.1`，不要直接暴露公网。公网统一入口仍然是 Gateway。

## 数据目录

先创建持久化目录：

```bash
mkdir -p /home/admin/apps/ai-workbench-data/data
mkdir -p /home/admin/apps/ai-workbench-data/outputs
```

重点备份这两个位置：

```text
/home/admin/apps/ai-workbench-data/data/ai-workbench.sqlite
/home/admin/apps/ai-workbench-data/outputs
```

打包备份：

```bash
tar -czf ai-workbench-backup-$(date +%Y%m%d).tar.gz /home/admin/apps/ai-workbench-data
```

## PM2 常用命令

```bash
pm2 status
pm2 logs ai-workbench --lines 80
pm2 restart ai-workbench
pm2 stop ai-workbench
```

## 拆分服务启动示例

当你想把登录鉴权、生成任务、素材服务、模型服务和工作流服务从主 API 中拆出来时，可以先用六进程部署：

```bash
npm run start:api
npm run start:auth-service
npm run start:worker-service
npm run start:asset-service
npm run start:model-service
npm run start:workflow-service
```

主 API/Gateway 进程配置：

```bash
WORKBENCH_GATEWAY_AUTH_URL=http://127.0.0.1:3004
WORKBENCH_GATEWAY_WORKER_URL=http://127.0.0.1:3001
WORKBENCH_GATEWAY_ASSET_URL=http://127.0.0.1:3002
WORKBENCH_GATEWAY_MODEL_URL=http://127.0.0.1:3003
WORKBENCH_GATEWAY_WORKFLOW_URL=http://127.0.0.1:3005
```

内部服务配置：

```bash
WORKBENCH_AUTH_SERVICE_HOST=127.0.0.1
WORKBENCH_AUTH_SERVICE_PORT=3004
WORKBENCH_WORKER_SERVICE_HOST=127.0.0.1
WORKBENCH_WORKER_SERVICE_PORT=3001
WORKBENCH_ASSET_SERVICE_HOST=127.0.0.1
WORKBENCH_ASSET_SERVICE_PORT=3002
WORKBENCH_MODEL_SERVICE_HOST=127.0.0.1
WORKBENCH_MODEL_SERVICE_PORT=3003
WORKBENCH_MODEL_SERVICE_START_QUEUE=false
WORKBENCH_WORKFLOW_SERVICE_HOST=127.0.0.1
WORKBENCH_WORKFLOW_SERVICE_PORT=3005
```

如果内部服务跨机器部署，再给 Gateway 和内部服务配置同一个内部 token：

```bash
WORKBENCH_INTERNAL_SERVICE_TOKEN=换成一段随机长字符串
```

> [!WARNING]
> `auth-service`、`worker-service`、`asset-service`、`model-service` 和 `workflow-service` 不应该直接暴露公网。它们只应该让 Gateway、内网或本机访问。

## 使用 PM2 ecosystem 配置

仓库已经提供 `ecosystem.config.cjs`。它会启动 6 个进程：

| 进程名 | 脚本 | 作用 |
| --- | --- | --- |
| `ai-workbench-api` | `server/api.cjs` | 公网 API / Gateway 入口 |
| `ai-workbench-auth-service` | `server/authService.cjs` | 登录、注册、Session、用户管理 |
| `ai-workbench-worker-service` | `server/workerService.cjs` | 任务、图片、视频和队列消费 |
| `ai-workbench-asset-service` | `server/assetService.cjs` | 素材、上传、图片读取、素材集合 |
| `ai-workbench-model-service` | `server/modelService.cjs` | 模型、API Key、模型能力、文本任务 |
| `ai-workbench-workflow-service` | `server/workflowService.cjs` | 工作流保存、版本、恢复和复制 |

启动前先配置 `.env`。真实 Key、SMTP 密码、`WORKBENCH_KEY_SECRET` 和 `WORKBENCH_INTERNAL_SERVICE_TOKEN` 都放在 `.env`，不要写进 `ecosystem.config.cjs`。

```bash
cd /home/admin/apps/ai-workbench
npm install
npm run build
npm run check:deploy
pm2 start ecosystem.config.cjs
pm2 save
```

查看状态：

```bash
pm2 status
pm2 logs ai-workbench-api --lines 80
pm2 logs ai-workbench-worker-service --lines 80
```

更新代码后重启：

```bash
cd /home/admin/apps/ai-workbench
npm install
npm run build
npm run check:deploy
pm2 reload ecosystem.config.cjs
pm2 save
```

设置开机自启：

```bash
pm2 startup
```

它会输出一整行 `sudo env PATH=...` 命令。复制那一整行再执行即可。

## 安全提醒

不要在公网服务器关闭登录。

```bash
WORKBENCH_REQUIRE_LOGIN=true
WORKBENCH_ALLOW_PUBLIC_SERVER=false
WORKBENCH_ENABLE_GENERIC_PROXY=false
```

如果你关闭登录，付费模型、任务队列和素材接口都更容易被滥用。除非你明确知道后果，否则不要这样做。
