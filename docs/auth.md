# Authentication

<http://localhost:5173/?access=密码>

MuVisual 使用前端登录页和后端 Session API。前端静态文件可以公开加载，认证只保护业务 API 和媒体资源。

## 前端流程

React 应用负责以下行为：

1. 启动时请求 `GET /api/auth/session` 检查当前 Cookie。
2. 未认证时保存原访问地址，将浏览器地址切换到 `/login` 并显示 React 登录页。
3. 登录页通过 `POST /auth/login` 提交密码；成功后恢复原访问地址。
4. URL 带有 `?access=AUTH_PASSWORD` 时，前端立即从地址栏删除 `access`，再自动调用登录 API。
5. 登录失败或会话失效时显示登录页，不渲染曲库和工作室页面。

开发环境中，Vite 将 `/api`、`/auth` 和 `/media` 代理到 `http://localhost:8787`。因此需要同时运行：

```bash
npm run backend
npm run dev
```

浏览器访问 `http://localhost:5173`。生产环境由 Node 服务在 `8787` 端口同时提供构建后的前端文件和后端接口。

## 后端接口

### `GET /api/auth/session`

公开接口。返回当前 Session 状态：

```json
{ "authenticated": true }
```

### `POST /auth/login`

公开接口。请求体为 JSON：

```json
{ "password": "共享密码" }
```

密码正确时设置签名 Session Cookie，并返回：

```json
{ "authenticated": true }
```

密码错误时返回 `401`。

### `POST /auth/logout`

清除 Session Cookie，并返回：

```json
{ "authenticated": false }
```

## 受保护资源

后端只对以下路径验证 Session Cookie：

- `/api/*`，但公开的 `/api/auth/session` 除外
- `/media/*`

HTML、JavaScript、CSS、字体和 `public` 目录中的静态资源不需要认证。前端路由守卫负责阻止未认证用户进入应用页面，但这不属于全站静态资源保护。

## Session

Cookie 中不保存原始密码。会话值为：

```text
过期时间戳.HMAC-SHA256(过期时间戳, AUTH_PASSWORD)
```

会话默认有效期为 7 天。修改 `AUTH_PASSWORD` 后，已有 Cookie 会自动失效。

生产环境 Cookie 使用 `__Host-muvisual_auth`，并设置 `HttpOnly`、`Secure`、`SameSite=Lax` 和 `Path=/`。本地 HTTP 开发使用不带 `Secure` 的 `muvisual_auth`。

登录请求体限制为 4 KB，密码通过 `crypto.timingSafeEqual` 比较。认证响应使用 `Cache-Control: no-store` 和 `Referrer-Policy: no-referrer`。

## 配置

开发环境在项目根目录 `.env` 中设置：

```dotenv
AUTH_PASSWORD=your-password
```

Docker 环境在 `compose.yaml` 中设置：

```yaml
services:
  muvisual:
    environment:
      NODE_ENV: production
      PORT: 8787
      AUTH_PASSWORD: "your-password"
```

共享链接格式：

```text
https://your-domain.example/?access=your-password
```

密码仍可能进入浏览器历史、代理日志或分析平台。前端会尽快清理地址栏，但无法消除请求到达服务器之前产生的日志记录。
