// scripts/smoke-accounts.js
// 账号体系 + 统计入库 + 测试通道的接口级冒烟测试。
//
// 本机没有 Postgres，所以用 pg-mem（内存版 Postgres）注入连接池，
// 再启动真实的 server.js，用真实 HTTP 请求跑一遍关键路径。
// 上游 LLM 用一个本地假服务器替代，用来验证「模型由服务端决定、采样参数原样透传」。
//
// 运行：node scripts/smoke-accounts.js   （或 npm run smoke:accounts）

'use strict';

const http = require('http');
const { newDb } = require('pg-mem');

// ⚠️ 环境变量必须在 require('../server') 之前设置好
const ADMIN_PASSWORD = 'Admin#12345';
process.env.AUTH_SECRET = 'smoke-secret-0123456789abcdef0123456789abcdef';
process.env.ADMIN_INITIAL_PASSWORD = ADMIN_PASSWORD;
process.env.NODE_ENV = 'test';
process.env.PORT = '3210';
process.env.TEST_API_KEY = 'sk-smoke-dummy-key';
process.env.TEST_API_TARGET = 'http://127.0.0.1:3211';
process.env.TEST_API_MODEL = 'deepseek-v4-flash';
process.env.TEST_API_LABEL = '冒烟测试模型';

const BASE = 'http://127.0.0.1:' + process.env.PORT;
const UPSTREAM_PORT = 3211;
const CHUNK1 = 'data: {"choices":[{"delta":{"content":"SMOKE-1 "}}]}\n\n';
const CHUNK2 = 'data: {"choices":[{"delta":{"content":"SMOKE-2"}}]}\n\n';

let lastUpstreamBody = null;

// ── 假上游 LLM ───────────────────────────────────────────────
const upstreamServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    try {
      lastUpstreamBody = JSON.parse(body);
    } catch (e) {
      lastUpstreamBody = { __parseError: e.message, raw: body.slice(0, 200) };
    }
    if (!lastUpstreamBody || lastUpstreamBody.stream === false) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'NONSTREAM-OK' } }] }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(CHUNK1);
    setTimeout(() => {
      res.write(CHUNK2);
      res.write('data: [DONE]\n\n');
      res.end();
    }, 300);
  });
});

// ── 断言工具 ─────────────────────────────────────────────────
let passed = 0;
let failed = 0;
function expect(name, cond, extra) {
  if (cond) {
    passed++;
    console.log('  ✅ ' + name);
  } else {
    failed++;
    console.log('  ❌ ' + name + (extra ? '  → ' + JSON.stringify(extra) : ''));
  }
}

async function req(path, options) {
  const opts = options || {};
  const res = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers: Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {}),
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* 可能是 SSE */ }
  return { status: res.status, headers: res.headers, text: text, json: json };
}

function bearer(token) {
  return { Authorization: 'Bearer ' + token };
}

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 15000);
  while (Date.now() < deadline) {
    try {
      const r = await req('/api/test-api/config');
      if (r.status === 200) return true;
    } catch (e) { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

// ── 主流程 ───────────────────────────────────────────────────
async function main() {
  await new Promise((resolve) => upstreamServer.listen(UPSTREAM_PORT, resolve));

  // 内存数据库 + 注入
  const mem = newDb();
  const pgAdapter = mem.adapters.createPg();
  const pool = new pgAdapter.Pool();

  const db = require('../db');
  db.setPoolForTesting(pool);

  require('../server'); // 启动真实服务（内部会自动跑迁移 + 建 admin）

  const ready = await waitForServer(20000);
  if (!ready) throw new Error('服务在 20s 内未就绪');
  console.log('\n=== 1. 启动与结构迁移 ===');

  const accounts = require('../accounts');
  const auth = require('../auth');
  const stats = require('../stats');

  const adminRow = await accounts.findByUsername(pool, 'admin');
  expect('admin 账号已被创建且是管理员', !!adminRow && adminRow.is_admin === true);
  expect('admin 密码在库里是哈希而非明文', !!adminRow && adminRow.password_hash !== ADMIN_PASSWORD && adminRow.password_hash.length > 40);
  expect('admin 有独立随机 salt', !!adminRow && !!adminRow.salt && adminRow.salt.length >= 16);

  const tables = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
  );
  const tableNames = tables.rows.map((r) => r.table_name);
  ['accounts', 'usage_stats', 'usage_daily', 'login_events'].forEach((t) => {
    expect('表已创建：' + t, tableNames.indexOf(t) !== -1, tableNames);
  });

  console.log('\n=== 2. 登录 / token ===');
  const adminLogin = await req('/api/auth/login', { method: 'POST', body: { username: 'admin', password: ADMIN_PASSWORD } });
  expect('admin 用 ADMIN_INITIAL_PASSWORD 登录成功', adminLogin.status === 200 && !!adminLogin.json.token, adminLogin.text.slice(0, 200));
  expect('登录响应里没有密码字段', adminLogin.json && !('password' in adminLogin.json.user) && !('password_hash' in adminLogin.json.user));
  expect('admin 的 canUseTestApi 为 true', adminLogin.json.user.canUseTestApi === true);
  const adminToken = adminLogin.json.token;

  const badLogin = await req('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'wrong-password' } });
  expect('错误密码返回 401', badLogin.status === 401);
  expect('错误提示不区分账号/密码（防枚举）', badLogin.json.error === '用户名或密码错误');

  const noToken = await req('/api/auth/me');
  expect('无 token 调 /api/auth/me 返回 401', noToken.status === 401);

  const me = await req('/api/auth/me', { headers: bearer(adminToken) });
  expect('带 token 调 /api/auth/me 成功', me.status === 200 && me.json.user.username === 'admin');

  const tampered = adminToken.slice(0, -2) + (adminToken.endsWith('aa') ? 'bb' : 'aa');
  const tamperedRes = await req('/api/auth/me', { headers: bearer(tampered) });
  expect('篡改签名的 token 被拒绝', tamperedRes.status === 401);

  process.env.TOKEN_TTL_DAYS = '0';
  const expiredToken = auth.signToken({ id: adminRow.id, username: 'admin', token_version: adminRow.token_version });
  delete process.env.TOKEN_TTL_DAYS;
  const expiredRes = await req('/api/auth/me', { headers: bearer(expiredToken) });
  expect('过期 token 被拒绝', expiredRes.status === 401);

  console.log('\n=== 3. 注册（注册即测试账号） ===');
  const reg = await req('/api/auth/register', { method: 'POST', body: { username: 'smoke_user', password: 'userpass123', nickname: '冒烟用户' } });
  expect('注册成功', reg.status === 200 && !!reg.json.token, reg.text.slice(0, 200));
  expect('新账号 is_test 默认为 true', reg.json.user.isTest === true);
  expect('新账号不是管理员', reg.json.user.isAdmin === false);
  expect('新账号 canUseTestApi 为 true', reg.json.user.canUseTestApi === true);
  const userToken = reg.json.token;

  const dup = await req('/api/auth/register', { method: 'POST', body: { username: 'smoke_user', password: 'userpass123' } });
  expect('重复用户名返回 409', dup.status === 409);

  const weak = await req('/api/auth/register', { method: 'POST', body: { username: 'weak_user', password: '123' } });
  expect('过短密码返回 400', weak.status === 400);

  console.log('\n=== 4. 昵称跨设备同步 ===');
  const patchRes = await req('/api/auth/me', { method: 'PATCH', headers: bearer(userToken), body: { nickname: '改名后的昵称' } });
  expect('修改昵称成功', patchRes.status === 200 && patchRes.json.user.nickname === '改名后的昵称');
  const me2 = await req('/api/auth/me', { headers: bearer(userToken) });
  expect('再次读取昵称已更新（等价于另一台设备登录后可见）', me2.json.user.nickname === '改名后的昵称');

  console.log('\n=== 5. 测试通道（模型由服务端决定 + 采样参数透传） ===');
  const cfg = await req('/api/test-api/config');
  expect('配置接口返回 enabled/label', cfg.status === 200 && cfg.json.enabled === true && cfg.json.label === '冒烟测试模型');
  expect('配置接口不含任何 Key', cfg.text.indexOf('sk-') === -1, cfg.text);

  const testCall = await req('/api/chat/test', {
    method: 'POST',
    headers: bearer(userToken),
    body: {
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
      model: 'deepseek-v4-pro',   // 故意伪造：服务端必须忽略
      max_tokens: 12345,          // 采样参数必须原样透传
      temperature: 0.85,
      top_p: 0.9
    }
  });
  expect('测试通道返回 200', testCall.status === 200, testCall.text.slice(0, 200));
  expect('SSE 内容被完整透传', testCall.text.indexOf('SMOKE-1') !== -1 && testCall.text.indexOf('[DONE]') !== -1);
  expect('响应头禁止代理缓冲（X-Accel-Buffering）', testCall.headers.get('x-accel-buffering') === 'no');
  expect('上游收到的 model 是服务端配置值', lastUpstreamBody && lastUpstreamBody.model === 'deepseek-v4-flash', lastUpstreamBody && lastUpstreamBody.model);
  expect('客户端伪造的 model 未生效', lastUpstreamBody && lastUpstreamBody.model !== 'deepseek-v4-pro');
  expect('采样参数 max_tokens 原样透传（未被夹取）', lastUpstreamBody && lastUpstreamBody.max_tokens === 12345, lastUpstreamBody && lastUpstreamBody.max_tokens);
  expect('采样参数 temperature 原样透传', lastUpstreamBody && lastUpstreamBody.temperature === 0.85);
  expect('协议参数 thinking 由服务端注入', !!(lastUpstreamBody && lastUpstreamBody.thinking && lastUpstreamBody.thinking.type === 'disabled'), lastUpstreamBody && lastUpstreamBody.thinking);

  // 首片延迟：假上游第 1 片立即发、第 2 片 300ms 后发，若被整段缓冲则首片会 ≥300ms
  const streamStart = Date.now();
  const streamRes = await fetch(BASE + '/api/chat/test', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, bearer(userToken)),
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], stream: true })
  });
  const reader = streamRes.body.getReader();
  const first = await reader.read();
  const firstChunkMs = Date.now() - streamStart;
  const firstText = first.value ? Buffer.from(first.value).toString('utf8') : '';
  expect('首片在缓冲时间之前到达（未被整段缓冲）', firstChunkMs < 250 && firstText.indexOf('SMOKE-1') !== -1, { firstChunkMs: firstChunkMs, firstText: firstText.slice(0, 60) });
  while (!(await reader.read()).done) { /* 读完 */ }

  console.log('\n=== 6. 管理员开关测试权限（服务端权威 + 下一次请求即生效） ===');
  const off = await req('/api/admin/set-test', { method: 'POST', headers: bearer(adminToken), body: { userId: reg.json.user.id, isTest: false } });
  expect('管理员关闭某账号测试权限成功', off.status === 200 && off.json.user.isTest === false);

  const meAfterOff = await req('/api/auth/me', { headers: bearer(userToken) });
  expect('该账号 canUseTestApi 立即变为 false', meAfterOff.json.user.canUseTestApi === false);

  const blocked = await req('/api/chat/test', { method: 'POST', headers: bearer(userToken), body: { messages: [{ role: 'user', content: 'hi' }] } });
  expect('被关闭权限后测试通道返回 403', blocked.status === 403, blocked.text.slice(0, 120));

  const nonAdminSummary = await req('/api/stats/summary', { headers: bearer(userToken) });
  expect('非管理员拉全站统计返回 403', nonAdminSummary.status === 403);

  const adminCannotBeToggled = await req('/api/admin/set-test', { method: 'POST', headers: bearer(adminToken), body: { userId: adminRow.id, isTest: false } });
  expect('管理员账号不允许被关闭测试权限', adminCannotBeToggled.status === 400);

  console.log('\n=== 7. 统计入库（累计 + 按天 + 活跃时长夹取） ===');
  const userRelogin = await req('/api/auth/login', { method: 'POST', body: { username: 'smoke_user', password: 'userpass123' } });
  expect('再次登录成功', userRelogin.status === 200);

  const hb = await req('/api/stats/event', { method: 'POST', headers: bearer(userToken), body: { action: 'heartbeat', activeMs: 45000 } });
  expect('心跳上报成功', hb.status === 200, hb.text.slice(0, 120));

  const huge = await req('/api/stats/event', { method: 'POST', headers: bearer(userToken), body: { action: 'heartbeat', activeMs: 99999999 } });
  expect('超大活跃增量被接受但会夹取', huge.status === 200);

  const tok = await req('/api/stats/event', { method: 'POST', headers: bearer(userToken), body: { action: 'token', tokenUsage: { prompt: 1000, completion: 500 } } });
  expect('token 用量上报成功', tok.status === 200);

  const summary = await req('/api/stats/summary', { headers: bearer(adminToken) });
  expect('管理员拉全站统计成功', summary.status === 200 && Array.isArray(summary.json.users), summary.text.slice(0, 200));
  const statUser = summary.json.users.find((u) => u.userId === reg.json.user.id);
  expect('统计里能查到该账号', !!statUser);
  expect('登录次数只记一次（服务端计数，前端不重复上报）', statUser && statUser.loginCount === 1, statUser && statUser.loginCount);
  expect('活跃时长 = 45000 + 夹取上限 120000', statUser && statUser.activeMs === 45000 + stats.MAX_ACTIVE_DELTA_MS, statUser && statUser.activeMs);
  expect('总时长 = 老口径(0) + 新口径活跃时长', statUser && statUser.totalUsageTime === statUser.activeMs);
  expect('token 用量已累计', statUser && statUser.tokenUsage.prompt === 1000 && statUser.tokenUsage.completion === 500);
  expect('统计里没有密码字段', summary.text.indexOf('password_hash') === -1 && summary.text.indexOf('"salt"') === -1);

  const daily = await req('/api/stats/daily', { headers: bearer(adminToken) });
  expect('按天统计可读', daily.status === 200 && Array.isArray(daily.json.days) && daily.json.days.length > 0, daily.text.slice(0, 160));
  expect('按天日期是 Asia/Shanghai 的今天', daily.json.days && daily.json.days[0].day === stats.shanghaiDay(), daily.json.days && daily.json.days[0]);

  const dailyForbidden = await req('/api/stats/daily', { headers: bearer(userToken) });
  expect('非管理员读按天统计返回 403', dailyForbidden.status === 403);

  const unknownAction = await req('/api/stats/event', { method: 'POST', headers: bearer(userToken), body: { action: 'hack-the-planet' } });
  expect('未知 action 返回 400', unknownAction.status === 400);

  const forged = await req('/api/stats/event', { method: 'POST', headers: bearer(userToken), body: { action: 'heartbeat', activeMs: 5000, userId: adminRow.id, isAdmin: true, isTest: true } });
  expect('伪造 userId/isAdmin 的请求被接受但只记在自己名下', forged.status === 200);
  const summary2 = await req('/api/stats/summary', { headers: bearer(adminToken) });
  const adminStat = summary2.json.users.find((u) => u.userId === adminRow.id);
  expect('admin 的活跃时长没有被伪造请求污染', adminStat && (adminStat.activeMs || 0) === 0, adminStat && adminStat.activeMs);

  console.log('\n=== 8. token_version：改密后旧 token 立刻失效 ===');
  await accounts.setPassword(pool, adminRow.id, 'Admin#99999');
  const staleMe = await req('/api/auth/me', { headers: bearer(adminToken) });
  expect('改密后旧 token 返回 401', staleMe.status === 401, staleMe.text.slice(0, 120));
  const relogin = await req('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'Admin#99999' } });
  expect('新密码可登录', relogin.status === 200 && !!relogin.json.token);

  console.log('\n=== 9. 老账号认领 ===');
  const claim = await req('/api/auth/claim', {
    method: 'POST',
    body: { username: 'legacy_user', password: 'legacypass', nickname: '老用户', legacyLocalId: 'user_legacy_abc123', isTest: true }
  });
  expect('认领成功', claim.status === 200 && !!claim.json.token, claim.text.slice(0, 200));
  expect('认领后沿用老 userId（本地业务数据不失联）', claim.json.user && claim.json.user.id === 'user_legacy_abc123', claim.json && claim.json.user);
  const claimedRow = await accounts.findByLegacyLocalId(pool, 'user_legacy_abc123');
  expect('legacy_local_id 已入库', !!claimedRow);

  const claimDup = await req('/api/auth/claim', { method: 'POST', body: { username: 'smoke_user', password: 'whatever123' } });
  expect('认领已存在的用户名返回 409', claimDup.status === 409);

  console.log('\n=== 10. 未配置数据库时的降级 ===');
  expect('isConfigured() 为 true（注入了内存库）', db.isConfigured() === true);

  console.log('\n──────────────────────────────');
  console.log(`通过 ${passed} 项，失败 ${failed} 项`);
  console.log('──────────────────────────────');

  await new Promise((r) => upstreamServer.close(r));
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('冒烟测试异常终止:', e);
  process.exit(1);
});
