# AI Workbench 部署模式清单

结论：现在推荐三种运行方式。开发时用本地开发模式；小规模给朋友用时用单机服务器模式；正式扩展时用 API 和 Worker 分进程模式。

## 5 分钟版

| 模式 | 前端 | 后端 API | Worker | 适合场景 |
| --- | --- | --- | --- | --- |
| 本地开发 | Vite dev server | Node 本地进程 | 同进程 | 开发、调试、临时验证 |
| 单机服务器 | Nginx/OSS/CDN 静态托管 | Node 同进程 | 同进程 | 小团队、朋友共用、低并发 |
| 分进程服务器 | Nginx/OSS/CDN 静态托管 | `start:api` | `start:worker` | 生成任务多、需要更稳的响应 |

正式服务器不要让 Node 后端托管前端页面。后端只提供 `/api/*`，前端单独托管 `dist`。

## 模式一：本地开发

为什么用它：启动最快，适合改代码和看效果。

```bash
npm install
npm run dev
```

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
```

本地开发时，Vite 会把浏览器里的 `/api/*` 代理到本地 Node 后端。`VITE_PROXY_URL` 留空即可。

> [!WARNING]
> 本地开发配置不能直接放到公网。`WORKBENCH_EMAIL_DEV_CODE_VISIBLE=true` 会把验证码返回给前端，只适合开发。

## 模式二：单机服务器

为什么用它：部署简单。API 和 Worker 在同一个 Node 进程里，前端仍然单独静态托管。

启动方式：

```bash
npm install
npm run check:deploy
npm run start:all
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

前端构建：

```bash
VITE_PROXY_URL=https://api.example.com
npm run build
```

然后把 `dist` 交给 Nginx、OSS、Vercel 或 CDN。

## 模式三：API 和 Worker 分进程

为什么用它：生成任务慢也不会拖住前端请求。API 只入队，Worker 只消费任务。

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

| 配置项 | 本地开发 | 单机服务器 | 分进程服务器 |
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
npm run dev
```

服务器部署重点验证：

```bash
npm run check:deploy
curl http://127.0.0.1:3000/api/health
```

代码回归重点验证：

```bash
npm run check:mojibake
npm test
npx tsc -b --pretty false
npm run lint
npm run build
```

## 常见误区

| 误区 | 后果 | 正确做法 |
| --- | --- | --- |
| 把 `WORKBENCH_CORS_ORIGIN` 写成 API 域名 | 浏览器登录请求被 CORS 拦截 | 写前端页面域名 |
| `VITE_PROXY_URL` 留空后构建生产前端 | 前端请求会打到错误地址 | 写后端 API 域名 |
| 服务器上开启 `WORKBENCH_SERVE_STATIC=true` | 后端又变回页面托管入口 | 保持 `false` |
| API 和 Worker 分进程但数据库不同 | 任务永远停在 `queued` | 两个进程共享同一个 `WORKBENCH_DB_PATH` |
| 改掉 `WORKBENCH_KEY_SECRET` | 已保存 Key 可能无法解密 | 首次部署后长期保留 |
