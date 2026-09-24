# 部署到 Railway 指南

## 📦 部署前准备

本项目已完成 Railway 部署改造，解决了以下核心问题：
1. ✅ **CORS 跨域问题**：通过后端代理转发所有 API 请求
2. ✅ **API Key 安全**：Key 不再暴露在前端代码中，由后端统一管理
3. ✅ **用户自定义配置**：支持用户在网页上输入自己的 API 地址和 Key

## 🚀 部署步骤

### 1. 构建前端代码（**必须在本地做**）

在项目根目录运行：

```bash
npm run build
```

这会生成/更新 `dist/build/h5` 目录，包含编译后的静态文件。

> ⚠️ **部署时不会在 Railway 上重新构建前端**：Railway 变量里 `NODE_ENV=production` 会让
> Nixpacks 跳过 devDependencies，而构建命令 `uni` 由 devDependency `@dcloudio/vite-plugin-uni`
> 提供，线上执行 `npm run build` 会报 `sh: 1: uni: not found`（exit 127）导致部署失败。
> 因此本项目约定：**前端在本地构建，`dist/` 随仓库提交**（`nixpacks.toml` 里已显式跳过线上构建）。
> 改了 `src/` 下任何前端代码，都必须重新 `npm run build` 并把 `dist/` 一起提交，否则线上前端仍是旧版本。

### 2. 提交代码到 Git 仓库

```bash
git add .
git commit -m "feat: 支持 Railway 部署"
git push origin master
```

### 3. 在 Railway 上创建项目

1. 访问 [Railway.app](https://railway.app/)
2. 点击 **New Project** → **Deploy from GitHub repo**
3. 选择你的仓库（授权 Railway 访问 GitHub）
4. Railway 会自动检测 `package.json` 并开始部署
5. 部署后会读取仓库根目录的 `nixpacks.toml`：只安装生产依赖（`npm ci --omit=dev`）、
   跳过前端构建、以 `npm start` 启动

### 4. 配置环境变量（可选）

在 Railway 项目的 **Variables** 页面添加以下环境变量：

| 变量名 | 说明 | 示例值 | 是否必填 |
|--------|------|--------|----------|
| `DATABASE_URL` | Neon **池化**连接串（含 `-pooler`），应用运行时用 | `postgresql://user:pw@ep-xxx-pooler.us-west-2.aws.neon.tech/neondb?sslmode=require` | **是**（账号与统计必需） |
| `DATABASE_URL_DIRECT` | Neon **直连**串（去掉 `-pooler`），迁移/建表用 | 同上，去掉 `-pooler` | 否（缺省回退到 `DATABASE_URL`） |
| `AUTH_SECRET` | 登录 token 的 HMAC 签名密钥（随机长串） | `openssl rand -hex 32` 的输出 | **是**（生产环境缺失会拒绝启动；**上线后不要再改**，改了所有人被登出） |
| `ADMIN_INITIAL_PASSWORD` | admin 账号密码：**变量值就是密码值**，改变量=改密码 | 自己设定 | 是（未设置则 admin 无法登录） |
| `NODE_ENV` | 运行环境 | `production` | 是 |
| `TEST_API_KEY` | **测试通道 api1 的 Key**（只保存在服务端） | `sk-xxxxxxxxxxxx` | 否（不配则该通道不可选） |
| `TEST_API_TARGET` | 测试通道 api1 的目标地址 | `https://api.deepseek.com` | 否（默认即此值） |
| `TEST_API_MODEL` | 测试通道 api1 **发给上游的真实模型名**（官方改名只改这里，前端无需改代码） | `DeepSeek-V4.1-Flash` | 否（默认即此值） |
| `TEST_API_DISPLAY_MODEL` | 测试通道 api1 **界面上显示的模型名**（不配则与 `TEST_API_MODEL` 相同） | `DeepSeek-V4.1-Flash` | 否（默认回退到真实模型名） |
| `TEST_API_PROVIDER` | 测试通道 api1 的**提供商展示名**（设置页与切换提示里显示） | `DeepSeek` | 否（默认即此值） |
| `TEST_API_LABEL` | 测试通道 api1 的展示名（设置页那一行的标题） | `DeepSeek原生` | 否（默认即此值） |
| `TEST_API_ENABLED` | 测试通道 api1 的开关 | `true` | 否（默认开启） |
| `TEST_API_2_KEY` / `_2_TARGET` / `_2_MODEL` / `_2_DISPLAY_MODEL` / `_2_PROVIDER` / `_2_LABEL` / `_2_ENABLED` | **测试通道 api2**（火山代理 DeepSeek），含义同上。注意这条**展示模型名与真实模型名不同** | `TEST_API_2_TARGET=https://ark.cn-beijing.volces.com/api/v3`、`TEST_API_2_MODEL=deepseek-v4-flash-ga-260731`、`TEST_API_2_DISPLAY_MODEL=DeepSeek-V4-Flash`、`TEST_API_2_PROVIDER=火山方舟` | 否（不配 `_2_KEY` 则该通道显示"未配置"、不可选） |
| `TEST_API_3_KEY` / `_3_TARGET` / `_3_MODEL` / `_3_DISPLAY_MODEL` / `_3_PROVIDER` / `_3_LABEL` / `_3_ENABLED` | **测试通道 api3**（原生智谱），含义同上 | `TEST_API_3_TARGET=https://open.bigmodel.cn/api/paas/v4`、`TEST_API_3_MODEL=GLM-5.3-Flash`、`TEST_API_3_PROVIDER=智谱 AI` | 否（同上） |
| `TEST_API_4_KEY` / `_4_TARGET` / `_4_MODEL` / `_4_DISPLAY_MODEL` / `_4_PROVIDER` / `_4_LABEL` / `_4_ENABLED` | **测试通道 api4**（GG 公益站 CLI 反代 / Gemini），含义同上 | `TEST_API_4_TARGET=https://gcli.ggchan.dev`、`TEST_API_4_MODEL=gemini-2.5-flash-lite`、`TEST_API_4_PROVIDER=GG公益站`、`TEST_API_4_LABEL=公益站CLI反代` | 否（同上） |
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
- `admin` 的 **id 固定为 `user_admin`**（与迁移前本地账号一致）：这样各设备上历史遗留的
  `u_user_admin_*` 业务数据（角色卡/会话/预设/API Key）仍能被读到。
  早期版本若已用随机 id 建过 admin，服务启动时会自动把它迁移为 `user_admin`，并把统计行一并搬过去（幂等、事务内完成）
- 迁移前只存在于浏览器里的历史用量（登录次数/旧口径使用时长/token）：老账号**首次登录时**
  自动一次性导入服务端统计（`GREATEST` 语义，重复导入不会翻倍；只能给自己导入）
- 迁移前存在于浏览器本地的老账号（含明文密码）：首次登录时用本地旧密码校验通过后自动「认领」到服务端，并删除本地明文记录
- **注册规则（站点公开后调整）**：
  - 昵称**必填**，且**不能与他人重复**（大小写不敏感；改昵称走同一套校验）
  - 新注册账号默认 `is_test = false`：**注册不再自带测试权限**，必须由 admin 在监控页的「测试管理」里打开开关；请求体里伪造 `isAdmin/isTest` 一律被忽略
  - 认领老账号（`POST /api/auth/claim`）同样**不带来任何权限**（`isAdmin/isTest` 一律为 false）——该接口是公开的，采信客户端声明等于让人自封管理员
  - 存量账号的 `is_test` **不变**（迁移只改列默认值），要收回权限由 admin 在监控页逐个关闭

### 4.2 内置测试 API（多通道：Key / 目标地址 / 模型名都只放在服务端）

内置测试通道的 Key、目标地址与模型名**都不在前端**。服务端可以提供**多条通道**（默认四条，
设置页里依次显示为 `DeepSeek原生` / `火山代理 DeepSeek` / `智谱原生` / `公益站CLI反代`），
测试账号在设置页「选择模型 → 测试 API 通道」里挑一条，**点选即生效**（不需要点保存）。

前端只调用服务端接口：

- `GET /api/test-api/config` —— 返回
  `{ enabled, label, model, defaultId, apis: [{ id, label, provider, model, enabled }] }`
  （**无密钥、无目标地址、无上游真实模型名**，仅用于设置页显示；
  这里的 `model` 是 `*_DISPLAY_MODEL`，即"给用户看的模型名"）
- `POST /api/chat/test` —— 带登录 token，body 里用 `channel: "api1" | "api2" | "api3" | "api4"` 指定通道；
  服务端校验 `is_admin || is_test` 后注入**该通道**的 Key、**强制使用该通道的真实模型名**、
  注入 `thinking` 等协议参数；**采样参数（temperature/top_p/max_tokens…）由前端预设决定并原样透传**
- 响应为 SSE 流式透传（`X-Accel-Buffering: no`，边收边写，不缓冲）

通道 → 环境变量对照（第 1 条沿用原变量名以兼容历史配置，新增的用 `_2` / `_3` / `_4` 后缀区分）：

| 通道 id | 默认提供商 | 界面显示模型名 | **发给上游的真实模型名** | 环境变量前缀 |
|---------|-----------|---------------|------------------------|--------------|
| `api1` | DeepSeek | `DeepSeek-V4.1-Flash` | `DeepSeek-V4.1-Flash` | `TEST_API_` |
| `api2` | 火山方舟（DeepSeek 代理） | `DeepSeek-V4-Flash` | `deepseek-v4-flash-ga-260731` | `TEST_API_2_` |
| `api3` | 智谱 AI | `GLM-5.3-Flash` | `GLM-5.3-Flash` | `TEST_API_3_` |
| `api4` | GG公益站 | `gemini-2.5-flash-lite` | `gemini-2.5-flash-lite` | `TEST_API_4_` |

设置页里每行显示的是「`*_LABEL` 作为标题 + 提供商：`*_PROVIDER` + 模型：`*_DISPLAY_MODEL`」，
默认值依次为 `DeepSeek原生` / `火山代理 DeepSeek` / `智谱原生` / `公益站CLI反代`。

`*_DISPLAY_MODEL` 用于"上游模型名是内部代号/带型号后缀、不想让用户看到"的渠道 ——
api2 就是这种情况：界面显示 `DeepSeek-V4-Flash`，但请求体里发的是火山方舟的真实型号
`deepseek-v4-flash-ga-260731`。不配 `*_DISPLAY_MODEL` 时展示名就等于 `*_MODEL`。

每条通道都可用 `*_TARGET` / `*_MODEL` / `*_DISPLAY_MODEL` / `*_PROVIDER` / `*_LABEL` / `*_ENABLED` 覆盖默认值。
`*_DISPLAY_MODEL` 用于"上游模型名是内部代号、不想让用户看到"的渠道（api4 就是这种）：
不配它时展示名就等于真实模型名。
**只配了 `*_KEY` 的通道才可选**；没配 Key 的通道在设置页会显示「未配置」且点不动。

> ⚠️ 通道默认地址只是合理猜测（DeepSeek 官方 / 火山方舟 / 智谱开放平台 / GG 公益站）。
> 请求路径固定是 `目标地址 + /chat/completions`；如果你的服务需要 `/v1` 前缀或别的路径，
> 把 `*_TARGET` 设成带前缀的地址即可（例如 `https://gcli.ggchan.dev/v1`）。

本地开发：Key 可放 `data/secrets.json`（`data/` 已在 `.gitignore` 中，不会入库），键名与环境变量同名：

```json
{
  "TEST_API_KEY": "sk-你的DeepSeek Key",
  "TEST_API_2_KEY": "你的火山方舟 Key",
  "TEST_API_3_KEY": "你的智谱 Key",
  "TEST_API_4_KEY": "你的 GG 公益站 Key",
  "AUTH_SECRET": "本地开发用的随机串"
}
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
