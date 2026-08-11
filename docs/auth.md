# auth

1. 应用层中间件（Node/Express/Next 等）
如果想自己控制登录页外观，或者只保护部分路由：

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

优点：可定制登录页、可做多用户/会话。 缺点：需要改代码、自己处理安全（CSRF、cookie 安全等）。

把密码嵌入在 url 里面访问后自动获取 cookie，立刻跳转到干净的网址
而不带密码的 url 需要手动输入 密码
