// server.js - Express 后端服务器
// 职责：
// 1. 账号体系（Neon Postgres）：注册/登录/改昵称/认领老账号/管理员开关测试权限
// 2. 使用统计（Neon Postgres）：登录次数、活跃时长、token 用量（含按天维度）
// 3. 内置测试 API：Key 只保存服务端，模型名/目标地址/协议参数全部由服务端决定
// 4. 用户自配 Key 的 OpenAI 兼容转发代理（/api/chat/completions）
// 5. 托管 uni-app 打包后的静态文件

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');
const fs = require('fs');

const db = require('./db');
const auth = require('./auth');
const accounts = require('./accounts');
const stats = require('./stats');
const { runMigrations } = require('./migrate');

const app = express();
const PORT = process.env.PORT || 3000;

// 历史统计文件（迁移前使用；现在只在启动时做一次性导入，之后不再读写）
const STATS_FILE = path.join(__dirname, 'data', 'stats.json');

// ========== JSON 解析：只对本服务自己实现的接口生效 ==========
// ⚠️ 关键：/api/* 里"转发代理"的路径绝不能在这里用 express.json() 解析——它会消费并结束
// 请求流，导致 http-proxy 转发给上游 LLM 的 body 为空、且上游请求流永不收尾；上游会一直等
// body 直到超时后重置连接（日志表现为 [HPM] ECONNRESET，前端表现为 loading 卡住）。
// 因此这里用白名单：只有下列前缀（本服务的接口）才解析 JSON，其余 /api/* 一律交给代理。
const LOCAL_API_PREFIXES = ['/api/stats', '/api/auth', '/api/admin', '/api/test-api', '/api/chat/test'];

function isLocalApiPath(p) {
  return LOCAL_API_PREFIXES.some(function (prefix) {
    return p === prefix || p.indexOf(prefix + '/') === 0;
  });
}

app.use((req, res, next) => {
  if (req.path.startsWith('/api') && !isLocalApiPath(req.path)) return next();
  express.json({ limit: '8mb' })(req, res, next);
});

// ========== 账号体系（Neon Postgres） ==========
// 迁移背景：账号原先存在浏览器 localStorage（明文密码），出厂密码还硬编码在前端，
// 任何人 F12 就能拿到 admin。现在统一由服务端持有：
//   - 密码用 scrypt + 每账号 salt 哈希入库，明文永不落库
//   - 权限（is_admin / is_test）以数据库为准，客户端无法自授
//   - 前端只保存服务端签发的 token 与脱敏后的用户信息

const DB_UNAVAILABLE_MSG = '账号服务未配置（服务端缺少 DATABASE_URL）';

function _ensureDbOr503(res) {
  if (!db.isConfigured()) {
    res.status(503).json({ error: DB_UNAVAILABLE_MSG });
    return false;
  }
  return true;
}

/**
 * 校验 Bearer token（签名 + 有效期 + token_version），成功则把账号挂到 req.account
 */
async function requireAuth(req, res, next) {
  if (!_ensureDbOr503(res)) return;
  const token = auth.extractBearer(req);
  const payload = token ? auth.verifyToken(token) : null;
  if (!payload) return res.status(401).json({ error: '登录状态无效或已过期，请重新登录' });

  try {
    const row = await accounts.findById(db.getPool(), payload.sub);
    if (!row) return res.status(401).json({ error: '账号不存在或已注销' });
    // token_version 不一致 => 密码被管理员重置过，旧 token 一律作废
    if ((Number(row.token_version) || 0) !== (Number(payload.ver) || 0)) {
      return res.status(401).json({ error: '登录状态已失效，请重新登录' });
    }
    req.account = row;
    req.accountPublic = accounts.toPublicUser(row);
    next();
  } catch (e) {
    console.error('[Auth] 校验登录态失败:', e && e.message);
    res.status(500).json({ error: '服务端错误' });
  }
}

/** 需要管理员权限（必须在 requireAuth 之后） */
function requireAdmin(req, res, next) {
  if (!req.account || !req.account.is_admin) return res.status(403).json({ error: '需要管理员权限' });
  next();
}

/** 注册（注册即测试账号：is_test 由数据库默认值 TRUE 决定，不接受客户端传值） */
app.post('/api/auth/register', async (req, res) => {
  if (!_ensureDbOr503(res)) return;
  try {
    const body = req.body || {};
    const v = auth.validateCredentials(body.username, body.password);
    if (!v.ok) return res.status(400).json({ error: v.message });

    const pool = db.getPool();
    if (await accounts.usernameExists(pool, v.username)) {
      return res.status(409).json({ error: '该用户名已被注册' });
    }
    const row = await accounts.createAccount(pool, {
      username: v.username,
      password: v.password,
      nickname: typeof body.nickname === 'string' ? body.nickname.slice(0, 40) : ''
    });
    console.log('[Auth] 新账号注册:', row.username);
    res.json({ token: auth.signToken(row), user: accounts.toPublicUser(row) });
  } catch (e) {
    if (e && e.code === '23505') return res.status(409).json({ error: '该用户名已被注册' });
    console.error('[Auth] 注册失败:', e && e.message);
    res.status(500).json({ error: '注册失败，请稍后重试' });
  }
});

/** 登录 */
app.post('/api/auth/login', async (req, res) => {
  if (!_ensureDbOr503(res)) return;
  try {
    const body = req.body || {};
    const username = String(body.username == null ? '' : body.username).trim();
    const password = String(body.password == null ? '' : body.password);
    if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });

    const pool = db.getPool();
    const row = await accounts.findByUsername(pool, username);
    // 统一提示，不区分"账号不存在"与"密码错误"，避免账号枚举
    if (!row) return res.status(401).json({ error: '用户名或密码错误' });

    const ok = await auth.verifyPassword(password, row);
    if (!ok) return res.status(401).json({ error: '用户名或密码错误' });

    try {
      await stats.recordLogin(pool, row.id);
      await stats.recordEvent(pool, row.id, row.username, 'login');
    } catch (e) {
      console.warn('[Stats] 记录登录失败（不影响登录）:', e && e.message);
    }

    res.json({ token: auth.signToken(row), user: accounts.toPublicUser(row) });
  } catch (e) {
    console.error('[Auth] 登录失败:', e && e.message);
    res.status(500).json({ error: '登录失败，请稍后重试' });
  }
});

/** 当前登录用户（前端核对测试权限改调它，取代原来的 /api/stats/test-permission） */
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.accountPublic });
});

/** 修改自己的昵称（跨设备同步） */
app.patch('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    if (typeof body.nickname !== 'string') return res.status(400).json({ error: '缺少 nickname' });
    const row = await accounts.updateNickname(db.getPool(), req.account.id, body.nickname.trim());
    if (!row) return res.status(404).json({ error: '账号不存在' });
    res.json({ user: accounts.toPublicUser(row) });
  } catch (e) {
    console.error('[Auth] 更新昵称失败:', e && e.message);
    res.status(500).json({ error: '更新失败' });
  }
});

/**
 * 认领老本地账号：账号体系迁移前，账号（含明文密码）存在浏览器 localStorage。
 * 用户在本地用旧密码校验通过后调用这里，把账号"认领"到服务端。
 * 只在用户名尚未被占用时创建；legacy_local_id 记录来源，便于排查。
 */
app.post('/api/auth/claim', async (req, res) => {
  if (!_ensureDbOr503(res)) return;
  try {
    const body = req.body || {};
    const v = auth.validateCredentials(body.username, body.password);
    if (!v.ok) return res.status(400).json({ error: v.message });

    const pool = db.getPool();
    if (await accounts.usernameExists(pool, v.username)) {
      return res.status(409).json({ error: '该用户名已被占用，请换一个用户名' });
    }
    const legacyLocalId = typeof body.legacyLocalId === 'string' ? body.legacyLocalId : null;

    // 老账号沿用原有 id（业务数据按 u_{userId}_* 存储，保 id 才能读到历史数据）
    const reusableId = (legacyLocalId && /^user_[A-Za-z0-9_]+$/.test(legacyLocalId)) ? legacyLocalId : undefined;
    const row = await accounts.createAccount(pool, {
      id: reusableId,
      username: v.username,
      password: v.password,
      nickname: typeof body.nickname === 'string' ? body.nickname.slice(0, 40) : '',
      legacyLocalId: legacyLocalId,
      // 老账号的权限沿用本地记录（admin 会带入管理员权限）
      isAdmin: !!body.isAdmin,
      isTest: body.isTest === undefined ? true : !!body.isTest
    });
    console.log('[Auth] 老本地账号已认领:', row.username, '(legacy=' + (legacyLocalId || '-') + ')');
    res.json({ token: auth.signToken(row), user: accounts.toPublicUser(row) });
  } catch (e) {
    if (e && e.code === '23505') return res.status(409).json({ error: '该用户名已被占用，请换一个用户名' });
    console.error('[Auth] 认领失败:', e && e.message);
    res.status(500).json({ error: '认领失败，请稍后重试' });
  }
});

/** 管理员开关任意账号的测试权限（监控页使用；admin 可随时关闭） */
app.post('/api/admin/set-test', requireAuth, requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const targetId = String(body.userId || '').trim();
    if (!targetId) return res.status(400).json({ error: '缺少 userId' });
    const pool = db.getPool();
    const target = await accounts.findById(pool, targetId);
    if (!target) return res.status(404).json({ error: '账号不存在' });
    if (target.is_admin) {
      return res.status(400).json({ error: '管理员账号恒有测试权限，无需调整' });
    }
    const row = await accounts.setTestFlag(pool, targetId, !!body.isTest);
    console.log(`[Auth] ${req.account.username} 将 ${row.username} 的测试权限设为 ${row.is_test}`);
    res.json({ user: accounts.toPublicUser(row) });
  } catch (e) {
    console.error('[Auth] 调整测试权限失败:', e && e.message);
    res.status(500).json({ error: '调整失败' });
  }
});

// ========== 使用统计（Neon Postgres） ==========
// 事件上报的身份一律取自 token，不再采信请求体里的 userId/username/isAdmin/isTest，
// 因此无法伪造他人用量或自行获取测试权限。

app.post('/api/stats/event', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const action = String(body.action || '');
    const pool = db.getPool();
    const userId = req.account.id;

    if (action === 'login') {
      await stats.recordLogin(pool, userId);
      await stats.recordEvent(pool, userId, req.account.username, 'login');
    } else if (action === 'logout') {
      await stats.recordEvent(pool, userId, req.account.username, 'logout');
    } else if (action === 'heartbeat') {
      // 新前端上报 activeMs（活跃毫秒增量）；兼容旧字段 sessionMs
      const ms = Number(body.activeMs != null ? body.activeMs : body.sessionMs) || 0;
      await stats.recordActive(pool, userId, ms);
    } else if (action === 'token') {
      const t = body.tokenUsage || {};
      await stats.recordTokens(pool, userId, t.prompt, t.completion);
    } else if (action === 'register' || action === 'set-test') {
      // 兼容旧前端的事件名：注册与权限调整现在由 /api/auth/register、/api/admin/set-test 负责
    } else {
      return res.status(400).json({ error: '未知的 action' });
    }

    res.json({ ok: true, isTest: req.accountPublic.canUseTestApi });
  } catch (e) {
    console.error('[Stats] /api/stats/event 处理失败:', e && e.message);
    res.status(500).json({ error: '统计上报失败' });
  }
});

/** 全量汇总（监控页；仅管理员，含最近登录事件） */
app.get('/api/stats/summary', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = db.getPool();
    const users = await stats.getSummary(pool);
    const logs = await stats.getRecentEvents(pool, 200);
    res.json({ users: users, logs: logs });
  } catch (e) {
    console.error('[Stats] /api/stats/summary 处理失败:', e && e.message);
    res.status(500).json({ error: '统计读取失败' });
  }
});

/** 按天统计（Asia/Shanghai 日历日；仅管理员） */
app.get('/api/stats/daily', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = db.getPool();
    const days = await stats.getDaily(pool, {
      userId: req.query.userId ? String(req.query.userId) : undefined,
      from: req.query.from ? String(req.query.from) : undefined,
      to: req.query.to ? String(req.query.to) : undefined,
      limit: req.query.limit
    });
    res.json({ days: days });
  } catch (e) {
    console.error('[Stats] /api/stats/daily 处理失败:', e && e.message);
    res.status(500).json({ error: '按天统计读取失败' });
  }
});

// ========== 内置测试 API（Key / 模型 / 目标地址 全部只保存在服务端） ==========
// 背景：内置测试 Key 以前硬编码在前端（会随 dist 分发），模型名也写死在前端。
// 现在前端只表达"我要用测试通道"，其余全部由服务端决定：
//   TEST_API_KEY     内置 Key（唯一秘密）
//   TEST_API_TARGET  目标地址（默认 DeepSeek）
//   TEST_API_MODEL   模型名（官方改名只改这个变量，前端无需改代码/重新发版）
//   TEST_API_LABEL   前端展示名（可选）
//   TEST_API_ENABLED 一键开关（false 时测试通道不可用）
const SECRETS_FILE = path.join(__dirname, 'data', 'secrets.json');

let _testApiKeyCache = null;
function _readTestApiKey() {
  if (_testApiKeyCache !== null) return _testApiKeyCache;
  let value = process.env.TEST_API_KEY ? String(process.env.TEST_API_KEY).trim() : '';
  if (!value) {
    try {
      if (fs.existsSync(SECRETS_FILE)) {
        const raw = JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8'));
        if (raw && raw.TEST_API_KEY) value = String(raw.TEST_API_KEY).trim();
      }
    } catch (e) {
      console.warn('[TestAPI] 读取 data/secrets.json 失败:', e.message);
    }
  }
  _testApiKeyCache = value;
  return value;
}

const TEST_API_TARGET = (process.env.TEST_API_TARGET || 'https://api.deepseek.com').replace(/\/$/, '');
const TEST_API_MODEL = (process.env.TEST_API_MODEL || 'deepseek-v4-flash').trim();
const TEST_API_LABEL = (process.env.TEST_API_LABEL || '').trim();
const TEST_API_ENABLED = String(process.env.TEST_API_ENABLED || 'true').toLowerCase() !== 'false';

/** 前端展示名：未显式配置时退回模型名 */
function _testApiLabel() {
  return TEST_API_LABEL || TEST_API_MODEL;
}

/** 是否是 DeepSeek 系目标（决定要不要注入 thinking 这类协议参数） */
function _isDeepSeekLike(target, model) {
  const host = String(target || '').toLowerCase();
  const m = String(model || '').toLowerCase();
  return host.indexOf('deepseek') !== -1 || m.indexOf('deepseek') === 0;
}

/**
 * 由服务端注入的"协议参数"（不是采样参数）：
 * DeepSeek V4 的 thinking 默认 enabled，思考内容会进 reasoning_content 而 content 可能为空，
 * 所以显式关闭。前端已经不知道模型是谁，这类判断只能由服务端做。
 */
function _providerParams() {
  return _isDeepSeekLike(TEST_API_TARGET, TEST_API_MODEL) ? { thinking: { type: 'disabled' } } : {};
}

/** 允许从客户端透传的采样字段：值原样转发，服务端不看、不改、不夹取（由前端预设决定） */
const PASSTHROUGH_PARAMS = [
  'temperature', 'max_tokens', 'top_p', 'top_k',
  'presence_penalty', 'frequency_penalty', 'seed', 'n'
];

/** 测试通道的公开配置（无密钥，前端只用来显示与判断可用性） */
app.get('/api/test-api/config', (req, res) => {
  res.json({
    enabled: TEST_API_ENABLED && !!_readTestApiKey(),
    label: _testApiLabel(),
    model: TEST_API_MODEL
  });
});

/**
 * 内置测试通道：服务端决定模型与 Key，采样参数透传。
 * 权限：必须登录，且 is_admin || is_test 为真（以数据库为准）。
 */
app.post('/api/chat/test', requireAuth, async (req, res) => {
  if (!TEST_API_ENABLED) return res.status(503).json({ error: '内置测试 API 已关闭' });
  if (!req.accountPublic.canUseTestApi) {
    return res.status(403).json({ error: '内置测试 API 仅测试账号可用，请在设置中选择其他模型或填写自己的 Key' });
  }
  const apiKey = _readTestApiKey();
  if (!apiKey) return res.status(503).json({ error: '内置测试 API 未配置：服务端缺少 TEST_API_KEY' });

  const body = req.body || {};
  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages || !messages.length) return res.status(400).json({ error: 'messages 不能为空' });

  const wantStream = body.stream !== false;
  const upstreamBody = {
    messages: messages,
    model: TEST_API_MODEL,   // 模型只认服务端配置：客户端传什么都会被覆盖
    stream: wantStream
  };
  for (const key of PASSTHROUGH_PARAMS) {
    if (body[key] !== undefined && body[key] !== null) upstreamBody[key] = body[key];
  }
  Object.assign(upstreamBody, _providerParams());

  const controller = new AbortController();
  let upstream;
  try {
    upstream = await fetch(TEST_API_TARGET + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify(upstreamBody),
      signal: controller.signal
    });
  } catch (e) {
    console.error('[TestAPI] 上游请求失败:', e && e.message);
    return res.status(502).json({ error: '内置测试通道请求上游失败', detail: e && e.message });
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(function () { return ''; });
    console.error('[TestAPI] 上游返回非 2xx:', upstream.status, text.slice(0, 300));
    return res.status(upstream.status).json({
      error: '上游返回 HTTP ' + upstream.status,
      detail: text.slice(0, 500)
    });
  }

  // 非流式：直接回传上游 JSON
  if (!wantStream) {
    try {
      const data = await upstream.json();
      return res.json(data);
    } catch (e) {
      return res.status(502).json({ error: '上游响应无法解析为 JSON' });
    }
  }

  // 流式：SSE 边收边写透传（不做任何缓冲，保证打字机效果的首字延迟）
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // 防止反向代理/边缘节点缓冲 SSE
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  // 客户端断开（用户点"停止生成"/关闭页面）时立刻中断上游，避免继续计费
  const onClose = function () {
    try { controller.abort(); } catch (e) { /* ignore */ }
  };
  req.on('close', onClose);

  try {
    for await (const chunk of upstream.body) {
      if (!res.write(chunk)) {
        await new Promise(function (resolve) { res.once('drain', resolve); });
      }
    }
  } catch (e) {
    if (!controller.signal.aborted) {
      console.warn('[TestAPI] 读取上游流失败:', e && e.message);
    }
  } finally {
    req.off('close', onClose);
    res.end();
  }
});

// ========== 动态代理中间件：/api/* 请求转发到真实 API（用户自配 Key 通道） ==========
app.use('/api', (req, res, next) => {
  // 1. 读取用户自定义配置（优先级最高）
  const userApiBase = req.headers['x-api-base'];
  const userApiKey = req.headers['x-api-key'];

  // 2. 回退到环境变量（Railway 部署时配置）
  //    注意：内置测试 Key 不走这条通道（见 /api/chat/test），这里只服务"用户自配 Key"。
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
      // 注意：代理路径已跳过 express.json()，req.body 不存在，这里改用
      // 原始请求的 Content-Length 头来判断请求体是否被正确转发（非 0/未定义即正常）。
      console.log('[Proxy Request] Content-Length:', req.headers['content-length'] ?? '未设置');
    },
    onProxyRes: (proxyRes, req, res) => {
      console.log(`[Proxy Response] Status: ${proxyRes.statusCode} for ${req.url}`);

      // 支持流式传输（SSE）
      if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
        console.log('[Proxy] 检测到 SSE 流式响应');
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
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

// ========== 启动 ==========
async function startServer() {
  console.log('='.repeat(50));
  console.log('🎮 无限旅团后端服务器启动中');

  // 1. 登录 token 的签名密钥（生产环境必须显式配置）
  const secret = auth.initAuthSecret();
  if (!secret.ok) {
    console.error('[Auth] 启动中止：' + secret.reason);
    process.exit(1);
  }
  if (secret.ephemeral) console.warn('[Auth] ' + secret.reason);

  // 2. 数据库：预热 -> 结构迁移 -> 确保 admin 存在 -> 导入历史统计
  if (db.isConfigured()) {
    await db.warmup();
    try {
      await runMigrations(db.getPool());
      console.log('[DB] 结构迁移完成（accounts / usage_stats / usage_daily / login_events）');
    } catch (e) {
      console.error('[DB] 结构迁移失败:', e && e.message);
    }
    try {
      await accounts.ensureAdminAccount(db.getPool(), process.env.ADMIN_INITIAL_PASSWORD);
    } catch (e) {
      console.error('[Auth] 确保 admin 账号失败:', e && e.message);
    }
    try {
      await stats.importLegacyStatsFile(db.getPool(), STATS_FILE);
    } catch (e) {
      console.warn('[Stats] 历史统计导入失败（忽略）:', e && e.message);
    }
  } else {
    console.warn('[DB] 未配置 DATABASE_URL：账号与统计接口将返回 503');
  }

  // 3. 监听
  app.listen(PORT, () => {
    console.log('='.repeat(50));
    console.log(`📡 监听端口: ${PORT}`);
    console.log(`📂 静态文件目录: ${staticPath}`);
    console.log(`🗄️  数据库: ${db.isConfigured() ? '已配置（Neon Postgres）' : '未配置'}`);
    console.log(`🔑 默认 API 目标(用户自配 Key 通道): ${process.env.API_TARGET || 'https://api.deepseek.com'}`);
    console.log(`🔐 环境变量 API_KEY: ${process.env.API_KEY ? '已设置' : '未设置（建议保持未设置）'}`);
    console.log(`🧪 内置测试 Key(TEST_API_KEY): ${_readTestApiKey() ? '已设置' : '未设置（测试通道不可用）'}`);
    console.log(`🧪 内置测试模型(TEST_API_MODEL): ${TEST_API_MODEL} @ ${TEST_API_TARGET}`);
    console.log(`🧪 内置测试通道开关: ${TEST_API_ENABLED ? '启用' : '关闭'}`);
    console.log('='.repeat(50));
    console.log('💡 用户可通过请求头 X-API-Base 和 X-API-Key 使用自配 Key');
    console.log('💡 未携带 X-API-Key 的 /api/chat/completions 请求将得不到 Key（不会被兜底）');
    console.log('='.repeat(50));
  });
}

startServer().catch((e) => {
  console.error('[Server] 启动失败:', e);
  process.exit(1);
});
