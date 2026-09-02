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
| `API_TARGET` | 默认 API 地址 | `https://api.deepseek.com` | 否（用户可自行配置） |
| `API_KEY` | 默认 API Key | `sk-xxxxxxxxxxxx` | 否（用户可自行配置） |
| `PORT` | 服务器端口 | `3000` | 否（Railway 自动注入） |

**注意**：
- 如果不配置环境变量，用户必须在网页设置中输入自己的 API 地址和 Key
- 如果配置了环境变量，用户可以使用默认配置，也可以覆盖为自己的配置

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
