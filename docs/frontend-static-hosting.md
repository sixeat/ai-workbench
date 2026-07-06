# 前端静态托管说明

结论：服务器版推荐把前端和后端分开部署。前端只托管 `dist` 静态文件，后端只提供 `/api/*`。

## 5 分钟版

你需要准备两个域名：

| 用途 | 示例 | 配置项 |
| --- | --- | --- |
| 前端页面 | `https://workbench.example.com` | `WORKBENCH_CORS_ORIGIN` |
| 后端 API | `https://api.example.com` | `VITE_PROXY_URL`、`WORKBENCH_PUBLIC_BASE_URL` |

三项 URL 不要配反：

| 变量 | 填什么 |
| --- | --- |
| `VITE_PROXY_URL` | 后端 API 域名，例如 `https://api.example.com` |
| `WORKBENCH_CORS_ORIGIN` | 前端页面域名，例如 `https://workbench.example.com` |
| `WORKBENCH_PUBLIC_BASE_URL` | 后端 API 域名，例如 `https://api.example.com` |

这三项都写域名 origin。不要写 `/api`、路径、query 或 hash。
`WORKBENCH_CORS_ORIGIN` 也不要带尾部 `/`，否则浏览器发来的 Origin 不会匹配。

如果 `WORKBENCH_CORS_ORIGIN` 写成了后端 API 域名，浏览器会把真正前端域名发来的登录和 API 请求拦掉。

后端 `.env`：

```bash
WORKBENCH_DEPLOYMENT_MODE=server
WORKBENCH_SERVE_STATIC=false
WORKBENCH_CORS_ORIGIN=https://workbench.example.com
WORKBENCH_PUBLIC_BASE_URL=https://api.example.com

WORKBENCH_COOKIE_SAMESITE=None
WORKBENCH_COOKIE_SECURE=true
WORKBENCH_COOKIE_DOMAIN=.example.com
```

后端启动前先检查配置：

```bash
npm run check:deploy
```

前端构建：

```bash
VITE_PROXY_URL=https://api.example.com
npm run build
```

然后把 `dist` 目录上传到 Nginx、Vercel、OSS/CDN 或其他静态托管服务。

> [!WARNING]
> 不要把后端的 `outputs`、`data`、`.env`、`server` 目录上传到前端静态托管。前端只需要 `dist`。

## 为什么这样做

前端静态托管后，Node 服务只处理可信 API：

- 登录和 Cookie。
- API Key 加密保存。
- 模型调用。
- 任务队列。
- 资产读取和上传。

这样以后迁移到多用户服务器、对象存储、独立队列会更顺。

## Nginx 静态托管

假设前端文件放在：

```text
/var/www/ai-workbench/dist
```

前端站点配置：

```nginx
server {
  listen 80;
  server_name workbench.example.com;

  root /var/www/ai-workbench/dist;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }

  location ~* \.(js|css|png|jpg|jpeg|webp|gif|svg|ico|woff2?)$ {
    try_files $uri =404;
    expires 30d;
    add_header Cache-Control "public, immutable";
  }

  location = /index.html {
    add_header Cache-Control "no-cache";
  }
}
```

如果你的 Node API 也在同一台机器，可以给 API 单独配一个域名：

```nginx
server {
  listen 80;
  server_name api.example.com;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

上线 HTTPS 后，把 `listen 80` 换成你的证书配置，或用宝塔、Nginx Proxy Manager、云厂商证书功能生成配置。

## Vercel 托管

前端项目根目录放一个 `vercel.json`：

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ],
  "headers": [
    {
      "source": "/assets/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=31536000, immutable"
        }
      ]
    },
    {
      "source": "/index.html",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "no-cache"
        }
      ]
    }
  ]
}
```

在 Vercel 项目环境变量里设置：

```text
VITE_PROXY_URL=https://api.example.com
```

> [!NOTE]
> Vercel 只托管前端。Node 后端仍然要部署在你的服务器上，并保持 `WORKBENCH_SERVE_STATIC=false`。

## OSS / CDN 托管

通用步骤：

1. 本地构建前端。
2. 上传 `dist` 目录里的所有文件。
3. 设置默认首页为 `index.html`。
4. 设置 404 或 SPA 回源页面为 `index.html`。
5. 给 `assets/*` 设置长缓存。
6. 给 `index.html` 设置短缓存或不缓存。

构建命令：

```bash
VITE_PROXY_URL=https://api.example.com
npm run build
```

需要上传的是 `dist` 内容，不是 `dist` 文件夹本身：

```text
dist/index.html
dist/assets/...
```

## 常见配置组合

| 部署方式 | `VITE_PROXY_URL` | `WORKBENCH_SERVE_STATIC` | `WORKBENCH_CORS_ORIGIN` |
| --- | --- | --- | --- |
| 前端 Nginx，后端 API 域名 | `https://api.example.com` | `false` | `https://workbench.example.com` |
| 前端 Vercel，后端 API 域名 | `https://api.example.com` | `false` | `https://你的-vercel-域名` |
| 前端 OSS/CDN，后端 API 域名 | `https://api.example.com` | `false` | `https://前端 CDN 域名` |

## 检查清单

- 前端构建时设置了 `VITE_PROXY_URL`。
- 后端启动前 `npm run check:deploy` 通过。
- 后端设置了 `WORKBENCH_SERVE_STATIC=false`。
- 后端设置了 `WORKBENCH_CORS_ORIGIN=https://前端域名`。
- 如果前端和 API 跨站，Cookie 设置了 `SameSite=None` 和 `Secure=true`。
- `WORKBENCH_PUBLIC_BASE_URL` 指向可公网访问的后端 API 域名。
- 浏览器访问前端域名时，Network 面板里的 `/api/*` 请求都发往后端 API 域名。
- `curl https://api.example.com/api/health` 返回 `{"status":"ok"}`。
