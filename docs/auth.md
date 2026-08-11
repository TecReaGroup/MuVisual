# auth

1. 应用层中间件（Node/Express/Next 等）
保护该项目服务全站：

* Express 中间件：password-protected、staging-express 等（cookie + JWT）。

* Next.js：staging-next 或自己写 middleware。

* 自己写一个简单的 session 中间件（密码存在环境变量，验证后 set cookie）。

示例思路（Express）：

```JavaScript
app.use(cookieParser());
app.use((req, res, next) => {
  if (req.cookies.auth === 'ok' || req.path === '/login') return next();
  // 校验密码后设置 cookie
});
```

<https://你的域名.com/?access=你的SHARE_TOKEN>

把密码嵌入在 url 里面访问后自动获取 cookie，立刻跳转到干净的网址
而不带密码的 url 需要手动输入 密码，需要编写一个简单的登录页，POST /auth/login 校验密码，成功后设置 cookie 并跳转

## 方案

推荐直接在现有 Node HTTP 服务中实现轻量 Session 网关，不引入 Express、JWT 或额外依赖。

当前项目由 [backend/server.mjs](E:/Github/MuVisual/backend/server.mjs:142) 同时提供 API、媒体和生产环境前端文件，因此认证应放在解析 URL 后、所有路由处理之前。这样 `/api`、`/media`、HTML、JS 和音频资源都会被保护。

建议流程：

1. 环境变量保存 `SHARE_TOKEN`，服务启动时缺失则直接报错退出。
2. 请求带 `?access=SHARE_TOKEN`：
   * 使用恒定时间比较校验。
   * 设置签名 Session Cookie，不要把原始密码写进 Cookie。
   * 删除 URL 中的 `access` 参数。
   * 返回 `303 Location: /原路径?其他参数`，立即跳转到干净地址。
3. 请求已有有效 Cookie：正常进入现有路由。
4. 未认证请求：
   * `GET` 返回一个内嵌 CSS 的简单密码页面。
   * `POST /auth/login` 校验密码，成功后设置 Cookie并跳转。
   * API 请求也可以统一返回登录页；若需要明确区分，则对 `/api/*` 返回 `401 JSON`。
5. 可选增加 `POST /auth/logout` 清除 Cookie。

Cookie 推荐：

```http
Set-Cookie: __Host-muvisual_auth=<签名会话>;
Path=/;
Max-Age=604800;
HttpOnly;
Secure;
SameSite=Lax
```

会话值可以保持简单：

```text
过期时间戳.HMAC-SHA256(过期时间戳, SHARE_TOKEN)
```

这样服务端无须数据库或内存 Session，修改 `SHARE_TOKEN` 后旧 Cookie 自动失效。生产环境使用 `Secure`；本地纯 HTTP 开发时可按环境关闭。

关键注意事项：

* URL 中的共享密码可能进入浏览器历史、代理/CDN 访问日志和分析平台。立即重定向只能缩短暴露时间，不能消除日志风险。
* 认证响应和登录页设置 `Cache-Control: no-store`、`Referrer-Policy: no-referrer`。
* 登录 POST 请求体限制在约 4 KB，避免无限读取。
* `?access=` 只接受 `GET`，重定向时只删除 `access`，保留其他查询参数。
* 密码比较前先检查 Buffer 长度，再用 Node `crypto.timingSafeEqual`。
* 如果部署平台依赖 `/api/health` 做健康检查，可单独放行；否则也纳入保护。
* Vite 开发服务器本身不会被这个后端网关保护。生产环境由当前 Node 服务提供 `dist` 时才能实现真正的全站保护。

这个项目体量下，没有必要使用 JWT 或引入认证框架。一个签名 Cookie、一个登录 POST 路由和一个位于所有现有路由之前的认证判断就足够。此次仅完成分析，没有修改文件。

develop 时: 密码放到 .env 里面的 AUTH_PASSWORD = ... 里面
docker 时: 密码放到 compose.yaml 里面，例如：

```yaml
services:
  muvisual:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: muvisual
    restart: unless-stopped
    ports:
      - "8787:8787"
    volumes:
      - ./backend/data/visual:/app/backend/data/visual:ro
    environment:
      NODE_ENV: production
      PORT: 8787
      AUTH_PASSWORD: "Church123456"
```
