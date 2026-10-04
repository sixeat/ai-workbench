# AI Workbench 部署模式清单

结论：默认采用单进程 SaaS 模式。开发时用本地开发模式；上线先用单机服务器模式；API 和 Worker 分进程只作为高级扩展，不作为第一版默认部署方式。

## 5 分钟版

| 模式 | 前端 | 后端 API | Worker | 定位 |
| --- | --- | --- | --- | --- |
| 本地开发 | Vite dev server | Node 本地进程 | 同进程 | 开发、调试、临时验证 |
| 单机服务器 | Nginx/OSS/CDN 静态托管 | `start:server` | 同进程 | 第一版上线默认方案 |
| 分进程服务器 | Nginx/OSS/CDN 静态托管 | `start:api` | `start:worker` | 高级扩展方案 |

正式服务器不要让 Node 后端托管前端页面。后端只提供 `/api/*`，前端单独托管 `dist`。

## 模式一：本地开发

为什么用它：启动最快，适合改代码和看效果。

```bash
npm install
npm start
```

> ⚠️ 旧的 `npm run dev` 已不存在：它原是 `concurrently` 同时起后端和 Vite，
> 随内嵌的旧前端一起移除了。现在后端只起自己，前端在 `../frontend` 单独起。

本地 `.env` 可以这样写：

```bash
WORKBENCH_DEPLOYMENT_MODE=local
PROXY_HOST=127.0.0.1
PROXY_PORT=3000

VITE_PROXY_URL=
WORKBENCH_SERVE_STATIC=
WORKBENCH_CORS_ORIGIN=

WORKBENCH_REQUIRE_LOGIN=true
WORKBENCH_EMAIL_DEV_MODE=true
WORKBENCH_EMAIL_DEV_CODE_VISIBLE=true

WORKBENCH_DATA_DIR=./data
WORKBENCH_DB_PATH=./data/ai-workbench.sqlite
IMAGE_OUTPUT_DIR=./outputs

# 前端联调要跑「正式工作流运行」时必须打开。
# 默认关闭，而路由是无条件注册的：关着时 POST /api/workflow-runs 返回 201，
# 运行却永远停在 queued 且不报错。启动横幅会打印实际状态。
WORKBENCH_SERVER_SIDE_RUNS=true
```

本地开发时，Vite 会把浏览器里的 `/api/*` 代理到本地 Node 后端。`VITE_PROXY_URL` 留空即可。

> [!WARNING]
> 本地开发配置不能直接放到公网。`WORKBENCH_EMAIL_DEV_CODE_VISIBLE=true` 会把验证码返回给前端，只适合开发。

### 前端联调清单

前端是独立仓库（`../frontend`），联调时两个终端各起一个：

```bash
# 终端 1：后端
npm start                      # http://127.0.0.1:3000

# 终端 2：前端
cd ../frontend && npm run dev  # Vite，默认 http://127.0.0.1:5173
```

| 项 | 值 | 说明 |
| --- | --- | --- |
| 后端地址 | `http://127.0.0.1:3000` | local 模式默认绑 `127.0.0.1` |
| 前端地址 | `http://127.0.0.1:5173` | Vite 默认端口，实际以 `../frontend` 为准 |
| 接口前缀 | `/api/*` | 前端 dev server 代理到后端，因此**同源，不需要配 CORS** |
| `VITE_PROXY_URL` | 留空 | 留空走 dev server 代理；只有分离部署才填后端 origin |
| 工作流运行 | `WORKBENCH_SERVER_SIDE_RUNS=true` | **默认关闭**，必须显式打开 |

联调前自检三条，每条都能挡住一类静默失败：

1. `curl http://127.0.0.1:3000/api/health` → **200**，且 `deploymentMode` 为 `local`。
2. 后端启动横幅里 `Server-side workflow runs:` 必须是 **enabled**。若是 `disabled`，
   提交运行会返回 **201** 却永远停在 `queued`——没有报错，最难查。
3. 登录能用：local 模式与服务器模式一样要求登录；没配 SMTP 时用
   `WORKBENCH_EMAIL_DEV_MODE=true` + `WORKBENCH_EMAIL_DEV_CODE_VISIBLE=true` 拿验证码。

> 视频节点在服务端运行下会长时间停在 `queued`（实测 11~19 分钟），这是正常的，
> 不要按前端超时判失败。接口字段、状态机、幂等与断线恢复见
> [服务端工作流运行 API 契约](workflow-run-api.md)。

## 模式二：单机服务器

为什么用它：部署简单。它是当前 SaaS 版本的默认上线方式。API 和 Worker 在同一个 Node 进程里，前端仍然单独静态托管。

启动方式：

```bash
npm install
npm run check:deploy
npm run start:server
```

PM2 常驻：

```bash
pm2 start server/index.cjs --name ai-workbench --cwd /home/admin/apps/ai-workbench
pm2 save
```

后端 `.env`：

```bash
PROXY_HOST=0.0.0.0
PROXY_PORT=3000

WORKBENCH_DEPLOYMENT_MODE=server
WORKBENCH_SERVE_STATIC=false
WORKBENCH_START_WORKERS=true

VITE_PROXY_URL=https://api.example.com
WORKBENCH_CORS_ORIGIN=https://workbench.example.com
WORKBENCH_PUBLIC_BASE_URL=https://api.example.com

WORKBENCH_COOKIE_SAMESITE=None
WORKBENCH_COOKIE_SECURE=true
WORKBENCH_COOKIE_DOMAIN=.example.com

WORKBENCH_REQUIRE_LOGIN=true
WORKBENCH_ALLOW_PUBLIC_SERVER=false
WORKBENCH_ALLOW_DIRECT_API_KEYS=false
WORKBENCH_ENABLE_GENERIC_PROXY=false

WORKBENCH_ADMIN_EMAIL=admin@example.com
WORKBENCH_ADMIN_PASSWORD=change-this-to-a-strong-password
WORKBENCH_KEY_SECRET=change-this-to-a-long-random-secret

WORKBENCH_DATA_DIR=/home/admin/apps/ai-workbench-data/data
WORKBENCH_DB_PATH=/home/admin/apps/ai-workbench-data/data/ai-workbench.sqlite
IMAGE_OUTPUT_DIR=/home/admin/apps/ai-workbench-data/outputs
```

前端构建（在 `../frontend` 里做，后端本身没有构建步骤）：

```bash
cd ../frontend
VITE_PROXY_URL=https://api.example.com
npm run build
```

然后把前端产出的 `dist` 交给 Nginx、OSS、Vercel 或 CDN。

## 模式三：API 和 Worker 分进程

为什么用它：当生成任务明显拖慢 API 响应时，再把 API 和 Worker 拆开。它不是第一版默认方案。

> [!WARNING]
> **服务端工作流运行在分进程模式下不会推进**，且与 `WORKBENCH_SERVER_SIDE_RUNS` 无关：
> API 进程强制不启动 worker（`server/api.cjs:1`），而独立的 worker 进程没有装配运行
> 推进器（`createWorkflowRunWorker` 只在 `server/app.cjs` 里被调用）。
> 实测：两个进程同时运行，提交的运行仍停在 `queued`、节点停在 `pending`，无任何报错。
> 需要正式工作流运行（`/api/workflow-runs`）时请用模式二单进程。详见
> [服务端工作流运行 API 契约](workflow-run-api.md) 第零节。

API 进程：

```bash
WORKBENCH_START_WORKERS=false npm run start:api
```

Worker 进程：

```bash
npm run start:worker
```

Windows PowerShell 写法：

```powershell
$env:WORKBENCH_START_WORKERS="false"
npm run start:api
```

两边必须共享同一个数据库和产物目录：

```bash
WORKBENCH_DB_PATH=/home/admin/apps/ai-workbench-data/data/ai-workbench.sqlite
IMAGE_OUTPUT_DIR=/home/admin/apps/ai-workbench-data/outputs
```

PM2 示例：

```bash
pm2 start server/api.cjs --name ai-workbench-api --cwd /home/admin/apps/ai-workbench
pm2 start server/worker.cjs --name ai-workbench-worker --cwd /home/admin/apps/ai-workbench
pm2 save
```

## 配置对照

| 配置项 | 本地开发 | 默认单机服务器 | 高级分进程服务器 |
| --- | --- | --- | --- |
| `WORKBENCH_DEPLOYMENT_MODE` | `local` | `server` | `server` |
| `WORKBENCH_SERVE_STATIC` | 可留空 | `false` | `false` |
| `WORKBENCH_START_WORKERS` | 可留空 | `true` | API 为 `false`，Worker 不需要改 |
| `VITE_PROXY_URL` | 留空 | 后端 API 域名 | 后端 API 域名 |
| `WORKBENCH_CORS_ORIGIN` | 留空 | 前端页面域名 | 前端页面域名 |
| `WORKBENCH_COOKIE_SAMESITE` | `Lax` 或留空 | `None` | `None` |
| `WORKBENCH_COOKIE_SECURE` | 留空 | `true` | `true` |
| `WORKBENCH_KEY_SECRET` | 可留空 | 必须设置强随机值 | 必须设置强随机值 |

## 验证命令

本地开发重点验证：

```bash
npm start
curl http://127.0.0.1:3000/api/health     # 期望 200
```

启动横幅里 `Server-side workflow runs:` 要与预期一致——前端联调时需要是 `enabled`。

服务器部署重点验证：

```bash
npm run check:deploy
curl http://127.0.0.1:3000/api/health
```

代码回归重点验证（后端没有构建步骤，前端构建见模式二）：

```bash
npm test
npm run lint
npm run check:types          # tsc -b，只覆盖 src/ 的节点定义源头
npm run check:routes         # 路由清单与 api-contract.md 一致
npm run check:mojibake
```

## 常见误区

| 误区 | 后果 | 正确做法 |
| --- | --- | --- |
| 把 `WORKBENCH_CORS_ORIGIN` 写成 API 域名 | 浏览器登录请求被 CORS 拦截 | 写前端页面域名 |
| `VITE_PROXY_URL` 留空后构建生产前端 | 前端请求会打到错误地址 | 写后端 API 域名 |
| 服务器上开启 `WORKBENCH_SERVE_STATIC=true` | 后端又变回页面托管入口 | 保持 `false` |
| API 和 Worker 分进程但数据库不同 | 任务永远停在 `queued` | 两个进程共享同一个 `WORKBENCH_DB_PATH` |
| 改掉 `WORKBENCH_KEY_SECRET` | 已保存 Key 可能无法解密 | 首次部署后长期保留 |
