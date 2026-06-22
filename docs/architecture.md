# 架构说明

## 整体架构

```
┌─────────────────────────────────────────────────────────┐
│  Browser (http://127.0.0.1:3000)                        │
│  ┌────────────────────────────────────────────────────┐ │
│  │ index.html + app.js + style.css                    │ │
│  │  - 渲染卡片、处理点击复制、搜索过滤                │ │
│  └────────────────────────────────────────────────────┘ │
└──────────────────────┬──────────────────────────────────┘
                       │ fetch /api/*
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Express Server (server.js, 127.0.0.1:3000)             │
│  ┌────────────────────────────────────────────────────┐ │
│  │ /api/config  → 读 config.json，脱敏后返回          │ │
│  │ /api/token   → 返回完整 token (仅本地访问)         │ │
│  │ /api/user    → 代理 GET /user + /user/emails       │ │
│  │ /api/repos   → 代理 GET /user/repos                │ │
│  └────────────────────────────────────────────────────┘ │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTPS + Bearer token
                       ▼
              ┌─────────────────────┐
              │  api.github.com     │
              └─────────────────────┘
```

## 设计决策

### 为何需要后端代理而不是前端直连 GitHub API
- 避免 token 暴露到浏览器扩展、DevTools Network 截屏、history
- 统一处理 GitHub API 错误与字段裁剪，减少前端逻辑
- 后续可在此层添加缓存（如 5 分钟缓存 repos 减少配额）

### 为何 token 默认脱敏
- 首屏不渲染明文，防止录屏、肩窥泄漏
- 复制按钮按需请求 `/api/token`，剪贴板写入后 token 不在 DOM

### 为何绑定 127.0.0.1
- 仅本机使用场景，杜绝同局域网他人访问
- 不需要 TLS / 认证

## 数据流：复制 Token

1. 用户点击「复制完整」
2. `app.js` 调用 `fetch('/api/token')`
3. `server.js` 从 `config.json` 读取 token，JSON 返回
4. `app.js` 调用 `navigator.clipboard.writeText(token)`
5. 按钮变色 + toast 提示

## 扩展点

- **GitHub Packages 镜像自动拉取**：增加 `/api/packages`，代理 `GET /user/packages?package_type=container`，可替代手动维护 `containerImages`
- **PR / Issue 看板**：增加 `/api/pulls`、`/api/issues`，仿照 repos 渲染
- **多账户切换**：把 `config.json` 改为 `accounts[]`，前端加切换器
- **系统密钥串存储**：用 `keytar` 替代明文 token 字段
