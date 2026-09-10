# 部署到 Railway 指南

## 📦 部署前准备

本项目已完成 Railway 部署改造，解决了以下核心问题：
1. ✅ **CORS 跨域问题**：通过后端代理转发所有 API 请求
2. ✅ **API Key 安全**：Key 不再暴露在前端代码中，由后端统一管理
3. ✅ **用户自定义配置**：支持用户在网页上输入自己的 API 地址和 Key

## 🚀 部署步骤

### 1. 构建前端代码

在项目根目录运行：

```bash
npm run build
```

这会生成 `dist/build/h5` 目录，包含编译后的静态文件。

### 2. 提交代码到 Git 仓库

```bash
git add .
git commit -m "feat: 支持 Railway 部署"
git push origin main
```

### 3. 在 Railway 上创建项目

1. 访问 [Railway.app](https://railway.app/)
2. 点击 **New Project** → **Deploy from GitHub repo**
3. 选择你的仓库（授权 Railway 访问 GitHub）
4. Railway 会自动检测 `package.json` 并开始部署

### 4. 配置环境变量（可选）

在 Railway 项目的 **Variables** 页面添加以下环境变量：

| 变量名 | 说明 | 示例值 | 是否必填 |
|--------|------|--------|----------|
| `DATABASE_URL` | Neon **池化**连接串（含 `-pooler`），应用运行时用 | `postgresql://user:pw@ep-xxx-pooler.us-west-2.aws.neon.tech/neondb?sslmode=require` | **是**（账号与统计必需） |
| `DATABASE_URL_DIRECT` | Neon **直连**串（去掉 `-pooler`），迁移/建表用 | 同上，去掉 `-pooler` | 否（缺省回退到 `DATABASE_URL`） |
| `AUTH_SECRET` | 登录 token 的 HMAC 签名密钥（随机长串） | `openssl rand -hex 32` 的输出 | **是**（生产环境缺失会拒绝启动；**上线后不要再改**，改了所有人被登出） |
| `ADMIN_INITIAL_PASSWORD` | admin 账号密码：**变量值就是密码值**，改变量=改密码 | 自己设定 | 是（未设置则 admin 无法登录） |
| `NODE_ENV` | 运行环境 | `production` | 是 |
| `TEST_API_KEY` | **内置测试 API 的 Key**（只保存在服务端） | `sk-xxxxxxxxxxxx` | 否（不配则测试通道返回 503） |
| `TEST_API_TARGET` | 内置测试 API 的目标地址 | `https://api.deepseek.com` | 否（默认即此值） |
| `TEST_API_MODEL` | 内置测试 API 的**模型名**（官方改名只改这里，前端无需改代码） | `deepseek-v4-flash` | 否（默认即此值） |
| `TEST_API_LABEL` | 设置页展示名 | `DeepSeek V4 Flash` | 否（缺省显示模型名） |
| `TEST_API_ENABLED` | 内置测试通道开关 | `true` | 否（默认开启） |
| `TOKEN_TTL_DAYS` | 登录有效天数 | `7` | 否（默认 7 天） |
| `API_TARGET` | 用户自配 Key 通道的默认目标地址 | `https://api.deepseek.com` | 否 |
| `API_KEY` | 用户自配 Key 通道的兜底 Key | — | **建议永远不配**（不给未带 Key 的请求兜底） |
| `PORT` | 服务器端口 | `3000` | 否（Railway 自动注入） |

**注意**：
- 账号、密码哈希、权限（is_admin/is_test）、使用统计都在 Neon Postgres，不再依赖 Railway 的临时文件系统
- 数据库表结构由服务启动时自动迁移（`migrate.js`），**不需要手动建表**
- Neon 与 Railway 建议同区域（如 Neon `us-west-2` + Railway `US West (SFO)`），否则登录会明显变慢

### 4.1 账号体系（Neon Postgres）

- 密码用 `scrypt` + 每账号独立 salt 哈希存储，**明文永不落库、永不返回前端**；前端只保存签名 token 与脱敏后的用户信息
- 权限以数据库为准：`is_admin || is_test` 决定能否使用内置测试 API；管理员可在监控页随时开关任意账号的测试权限，**下一次请求即生效**
- `admin` 账号长期存在；`ADMIN_INITIAL_PASSWORD` 就是它的密码：
  - 改变量 → 重新部署 → 服务启动时幂等对齐密码，并让**所有旧登录态立刻失效**
  - 变量缺失 → 账号仍存在，只是无法登录（不会覆盖已有密码）
- 迁移前存在于浏览器本地的老账号（含明文密码）：首次登录时用本地旧密码校验通过后自动「认领」到服务端，并删除本地明文记录
- 新注册账号默认 `is_test = true`（注册即测试账号）

### 4.2 内置测试 API（Key / 模型名都只放在服务端）

内置测试 Key 与模型名**都不在前端**。前端只调用服务端接口：

- `GET /api/test-api/config` —— 返回 `{ enabled, label, model }`（**无密钥**，仅用于设置页显示）
- `POST /api/chat/test` —— 带登录 token，服务端校验 `is_admin || is_test` 后注入 Key、**强制使用 `TEST_API_MODEL`**、注入 `thinking` 等协议参数；**采样参数（temperature/top_p/max_tokens…）由前端预设决定并原样透传**
- 响应为 SSE 流式透传（`X-Accel-Buffering: no`，边收边写，不缓冲）

本地开发：Key 可放 `data/secrets.json`（`data/` 已在 `.gitignore` 中，不会入库）：

```json
{ "TEST_API_KEY": "sk-你的Key", "AUTH_SECRET": "本地开发用的随机串" }
```

> ⚠️ 小程序端没有 `/api` 代理，因此**不支持内置测试 API**，必须自配 Key。

### 4.3 使用统计

- 记录在数据库 `usage_stats`（累计）与 `usage_daily`（按天，`day` 按 **Asia/Shanghai** 切分）
- 使用时长口径为**活跃时长**：只在用户真正有交互（点击/按键/触摸/滚动）时累计，空闲超过 5 分钟不计；页面切到后台也不计
- 监控页「总时长」= 迁移前的老口径历史值（`legacy_total_usage_ms`）+ 新的活跃时长（`active_ms`）
- 统计事件的身份由 token 解析，客户端无法伪造他人用量或自行获取测试权限

### 5. 等待部署完成

Railway 会自动：
1. 安装 Node.js 依赖
2. 执行 `npm run build`（构建前端）
3. 执行 `npm start`（启动后端服务器）

部署成功后，Railway 会提供一个公网访问地址，例如：
```
https://your-app-name.up.railway.app
```

## 🎮 用户使用说明

部署成功后，用户访问网页时需要完成以下配置：

### 方式一：使用默认配置（如果部署时设置了环境变量）

直接使用即可，无需额外配置。

### 方式二：使用自己的 API Key

1. 点击网页右上角的「设置」按钮
2. 在「模型设置」页面选择模型类型（腾讯混元 / OpenAI GPT / Claude / 自定义 API）
3. 填写你的 API Key 和 API 地址（例如 `https://api.openai.com/v1`）
4. 点击保存

前端会自动通过 `X-API-Base` 和 `X-API-Key` 请求头将配置传递给后端代理。

## 🔧 技术实现细节

### 改动文件列表

| 文件 | 改动内容 |
|------|----------|
| `server.js` | ✨ 新建 Express 后端代理服务器 |
| `package.json` | ➕ 添加 `express` 和 `http-proxy-middleware` 依赖，新增 `build` 和 `start` 脚本 |
| `railway.json` | ✨ 新建 Railway 部署配置文件 |
| `src/utils/llm/client.js` | 🔧 修改 `_callCustomAPI` 和 `_streamWithFetch` 方法，H5 环境下将请求路径改为 `/api/chat/completions`，并通过请求头传递用户配置 |

### 请求流程

```
用户浏览器
  ↓ fetch('/api/chat/completions', { headers: { 'X-API-Base': '...', 'X-API-Key': '...' } })
Express 后端代理（server.js）
  ↓ 读取请求头，转发到真实 API
真实 API（OpenAI / DeepSeek / Claude 等）
  ↓ 返回响应
Express 后端代理
  ↓ 支持 SSE 流式传输
用户浏览器（打字机效果）
```

## 📝 注意事项

1. **构建顺序**：Railway 会先执行 `npm run build` 构建前端，再执行 `npm start` 启动服务器
2. **静态文件路径**：确保 `dist/build/h5` 目录存在，否则静态文件托管会失败
3. **环境变量**：`PORT` 由 Railway 自动注入，无需手动配置
4. **API Key 安全**：
   - ✅ 用户在网页上输入的 Key 仅通过 HTTPS 请求头传递给后端
   - ✅ 后端不会记录或存储用户的 Key
   - ✅ Key 不会暴露在前端代码或浏览器控制台中
5. **小程序兼容**：小程序环境不受影响，仍然直接调用真实 API（因为小程序不存在 CORS 问题）

## 🐛 故障排查

### 问题 1：Railway 部署失败

**检查步骤**：
1. 确认 `package.json` 中有 `"start": "node server.js"` 脚本
2. 确认 `express` 和 `http-proxy-middleware` 已安装
3. 查看 Railway 部署日志，确认构建和启动命令是否正确执行

### 问题 2：前端请求 404

**检查步骤**：
1. 确认 `dist/build/h5` 目录存在且包含 `index.html`
2. 确认 `server.js` 中的静态文件路径正确
3. 查看浏览器控制台，确认请求路径是否正确（应为 `/api/chat/completions`）

### 问题 3：API 调用失败

**检查步骤**：
1. 确认用户在设置页填写的 API 地址和 Key 正确
2. 查看 Railway 日志，确认后端代理是否正确转发请求
3. 确认目标 API 服务可用（例如 OpenAI API 是否正常）

## 📚 相关资源

- [Railway 官方文档](https://docs.railway.app/)
- [Express.js 官方文档](https://expressjs.com/)
- [http-proxy-middleware 文档](https://github.com/chimurai/http-proxy-middleware)
