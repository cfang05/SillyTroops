// server.js - Express 后端代理服务器
// 用途：
// 1. 解决浏览器 CORS 跨域问题
// 2. 隐藏 API Key，避免暴露在前端代码中
// 3. 支持用户自定义 API 地址和 Key（通过请求头传递）
// 4. 托管 uni-app 打包后的静态文件

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// 解析 JSON 请求体（仅用于非代理路由）。
// ⚠️ 关键：/api/* 走代理，绝不能在这里用 express.json() 解析——它会消费并结束请求流，
// 导致 http-proxy 转发给上游 LLM 的 body 为空、且上游请求流永不收尾；上游会一直等 body
// 直到超时后重置连接（日志表现为 [HPM] ECONNRESET，前端表现为 loading 卡住）。
// /api/stats/* 是本地新增的统计上报接口（不走代理，需要正常解析 JSON body），
// 所以显式排除在"跳过解析"的判断之外。
app.use((req, res, next) => {
  if (req.path.startsWith('/api') && !req.path.startsWith('/api/stats')) return next();
  express.json()(req, res, next);
});

// ========== 账号统计（登录次数/使用时长/Token 用量）跨设备汇总 ==========
// 背景：账号系统主存储是浏览器 localStorage，天然按设备/浏览器隔离——管理员在自己的
// 设备上打开监控页永远看不到其他账号在其他设备上产生的登录/使用数据。这里落一份
// 服务器端共享的 JSON 文件，各设备通过 /api/stats/event 上报事件，管理员通过
// /api/stats/summary 拉取全量汇总。数据是"设备各自上报的最佳努力估算"，Railway 等
// 平台的临时文件系统重启后会清空，属已知限制，但足以解决"完全看不到"的问题。
const STATS_FILE = path.join(__dirname, 'data', 'stats.json');

function _ensureStatsDir() {
  const dir = path.dirname(STATS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function _loadStats() {
  try {
    _ensureStatsDir();
    if (!fs.existsSync(STATS_FILE)) return { users: {}, logs: [] };
    const raw = fs.readFileSync(STATS_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (!data.users || typeof data.users !== 'object') data.users = {};
    if (!Array.isArray(data.logs)) data.logs = [];
    return data;
  } catch (e) {
    console.warn('[Stats] 读取统计文件失败，使用空数据:', e.message);
    return { users: {}, logs: [] };
  }
}

// 简单串行写入队列：避免并发上报同时写文件导致后一次写覆盖前一次的丢数据问题
let _statsWriteQueue = Promise.resolve();
function _saveStats(data) {
  _statsWriteQueue = _statsWriteQueue.then(() => {
    try {
      _ensureStatsDir();
      fs.writeFileSync(STATS_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      console.warn('[Stats] 写入统计文件失败:', e.message);
    }
  });
  return _statsWriteQueue;
}

// 上报一次统计事件：login / logout / heartbeat（累加使用时长）/ token（累加估算用量）
// / set-test（admin 调整某账号测试权限）/ register（建档）
app.post('/api/stats/event', async (req, res) => {
  try {
    const body = req.body || {};
    const { userId, username, nickname, isAdmin, isTest, action, sessionMs, tokenUsage } = body;
    if (!userId || !username || !action) {
      return res.status(400).json({ error: '缺少必需字段 userId/username/action' });
    }

    const data = _loadStats();
    if (!data.users[userId]) {
      data.users[userId] = {
        userId,
        username,
        nickname: nickname || '',
        isAdmin: !!isAdmin,
        // 新账号建档：register（注册默认有测试权限）或首次 login（账号本地 isTest）决定初始值
        isTest: !!isTest,
        loginCount: 0,
        totalUsageTime: 0,
        tokenUsage: { prompt: 0, completion: 0, total: 0 },
        createdAt: Date.now(),
        lastLoginAt: null,
        lastAction: null,
        lastActionTime: null
      };
    }
    const u = data.users[userId];
    u.username = username;
    if (typeof nickname === 'string') u.nickname = nickname;
    u.isAdmin = !!isAdmin;
    // ⚠️ 测试权限以服务器为权威：仅在 admin 显式 set-test、或账号 register 建档时更新。
    // 普通 login/heartbeat/token/logout 事件不再用本地的 isTest 覆盖服务器值——否则
    // admin 在别处关闭了某账号权限后，该账号自己登录又回传本地旧的 true 把权限重新打开。
    if (action === 'set-test') {
      u.isTest = !!isTest;
    } else if (action === 'register') {
      u.isTest = !!isTest;
    }
    if (!u.tokenUsage) u.tokenUsage = { prompt: 0, completion: 0, total: 0 };

    const now = Date.now();
    if (action === 'login') {
      u.loginCount = (u.loginCount || 0) + 1;
      u.lastLoginAt = now;
      data.logs.push({ userId, username, timestamp: now, action: 'login' });
    } else if (action === 'logout') {
      data.logs.push({ userId, username, timestamp: now, action: 'logout' });
    } else if (action === 'register') {
      // 注册事件只负责把账号建档（upsert 已在上面统一处理），不额外计数
      u.createdAt = u.createdAt || now;
    } else if (action === 'set-test') {
      // 权限调整不写入登录日志
    } else if (action === 'heartbeat') {
      const ms = Number(sessionMs) || 0;
      if (ms > 0) u.totalUsageTime = (u.totalUsageTime || 0) + ms;
    } else if (action === 'token') {
      const p = Number(tokenUsage && tokenUsage.prompt) || 0;
      const c = Number(tokenUsage && tokenUsage.completion) || 0;
      u.tokenUsage.prompt += p;
      u.tokenUsage.completion += c;
      u.tokenUsage.total += (p + c);
    }
    u.lastAction = action;
    u.lastActionTime = now;

    // 日志上限，避免文件无限增长
    if (data.logs.length > 2000) data.logs = data.logs.slice(-2000);

    await _saveStats(data);
    res.json({ ok: true, isTest: u.isTest });
  } catch (e) {
    console.error('[Stats] /api/stats/event 处理失败:', e);
    res.status(500).json({ error: e.message });
  }
});

// 查询单个账号在服务器上的测试权限（权威值，供账号登录/发请求前核对）
app.get('/api/stats/test-permission', (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: '缺少 userId' });
    const data = _loadStats();
    const u = data.users[userId];
    res.json({ userId, isTest: u ? !!u.isTest : null, exists: !!u });
  } catch (e) {
    console.error('[Stats] /api/stats/test-permission 处理失败:', e);
    res.status(500).json({ error: e.message });
  }
});

// 拉取全量汇总（管理员监控页使用）
app.get('/api/stats/summary', (req, res) => {
  try {
    const data = _loadStats();
    res.json({
      users: Object.values(data.users),
      logs: data.logs.slice(-200).reverse()
    });
  } catch (e) {
    console.error('[Stats] /api/stats/summary 处理失败:', e);
    res.status(500).json({ error: e.message });
  }
});

// ========== 动态代理中间件：/api/* 请求转发到真实 API ==========
app.use('/api', (req, res, next) => {
  // 1. 读取用户自定义配置（优先级最高）
  const userApiBase = req.headers['x-api-base'];
  const userApiKey = req.headers['x-api-key'];

  // 2. 回退到环境变量（Railway 部署时配置）
  const defaultApiBase = process.env.API_TARGET || 'https://api.deepseek.com';
  const defaultApiKey = process.env.API_KEY || '';

  // 3. 确定最终使用的目标 API
  let targetBase = userApiBase || defaultApiBase;
  const targetKey = userApiKey || defaultApiKey;

  // 4. 自动补全 OpenAI 兼容路径
  if (targetBase && !targetBase.endsWith('/completions') && !targetBase.endsWith('/chat/completions')) {
    targetBase = targetBase.replace(/\/$/, '');
  }

  console.log('[Proxy] 请求路径:', req.path);
  console.log('[Proxy] 目标 API:', targetBase);
  console.log('[Proxy] 使用自定义 Key:', !!userApiKey);

  // 5. 动态创建代理中间件
  const proxy = createProxyMiddleware({
    target: targetBase,
    changeOrigin: true,
    pathRewrite: {
      '^/api': '', // 移除 /api 前缀，转发到真实 API 路径
    },
    onProxyReq: (proxyReq, req, res) => {
      // 注入 Authorization 头（携带 API Key）
      if (targetKey) {
        proxyReq.setHeader('Authorization', `Bearer ${targetKey}`);
      }
      // 移除前端传来的自定义头（避免泄露给第三方 API）
      proxyReq.removeHeader('x-api-base');
      proxyReq.removeHeader('x-api-key');

      console.log('[Proxy] 最终请求头:', {
        host: proxyReq.getHeader('host'),
        authorization: proxyReq.getHeader('authorization') ? '***已设置***' : '未设置',
        contentType: proxyReq.getHeader('content-type')
      });

      // 记录请求体大小（调试用）。
      // 注意：/api/* 已跳过 express.json()，req.body 不存在，这里改用
      // 原始请求的 Content-Length 头来判断请求体是否被正确转发（非 0/未定义即正常）。
      console.log('[Proxy Request] Content-Length:', req.headers['content-length'] ?? '未设置');
    },
    onProxyRes: (proxyRes, req, res) => {
      console.log(`[Proxy Response] Status: ${proxyRes.statusCode} for ${req.url}`);
      // 记录响应头（可选，调试用）
      // console.log('[Proxy Response] Headers:', proxyRes.headers);

      // 支持流式传输（SSE）
      if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
        console.log('[Proxy] 检测到 SSE 流式响应');
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
      }
    },
    onError: (err, req, res) => {
      console.error(`[Proxy Error] ${err.message} for ${req.url}`);
      console.error('[Proxy Error] Stack:', err.stack);
      // 返回给前端一个明确的错误信息
      res.status(500).json({
        error: '代理请求失败',
        message: err.message,
        details: err.message
      });
    },
    // 支持 WebSocket（如果未来需要）
    ws: true,
    // 日志级别
    logLevel: 'warn'
  });

  proxy(req, res, next);
});

// ========== 静态文件托管：dist/build/h5 ==========
const staticPath = path.join(__dirname, 'dist', 'build', 'h5');
app.use(express.static(staticPath));

// 内置资源（角色卡 PNG / 预设 JSON / 正侧 JSON）位于 public/assets/…，
// uni-app H5 构建并不总是把它们拷入 dist/build/h5，因此额外把 public/ 也作为静态根，
// 保证线上（Railway）与本地 node server.js 预览都能命中 /assets/presets|regex|characters/…
const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

// ========== Vue 路由回退：防止刷新 404 ==========
app.get('*', (req, res) => {
  // 如果是 API 请求，不回退到 index.html
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API 路径不存在' });
  }
  // 所有其他路径返回 index.html（交给前端路由处理）
  res.sendFile(path.join(staticPath, 'index.html'));
});

// ========== 启动服务器 ==========
app.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log('🎮 无限旅团后端服务器已启动');
  console.log('='.repeat(50));
  console.log(`📡 监听端口: ${PORT}`);
  console.log(`📂 静态文件目录: ${staticPath}`);
  console.log(`🔑 默认 API 目标: ${process.env.API_TARGET || 'https://api.deepseek.com'}`);
  console.log(`🔐 环境变量 API_KEY: ${process.env.API_KEY ? '已设置' : '未设置（用户需自行配置）'}`);
  console.log('='.repeat(50));
  console.log('💡 用户可通过请求头 X-API-Base 和 X-API-Key 自定义 API');
  console.log('='.repeat(50));
});
