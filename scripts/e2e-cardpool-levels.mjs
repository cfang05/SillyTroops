// scripts/e2e-cardpool-levels.mjs
// 等级功能的端到端测试：**真数据库（pg-mem）+ 真登录 + 真接口 + 真 Chrome**。
//
// 与 e2e-cardpool.mjs 的分工：
//   · e2e-cardpool.mjs  —— 页面行为（渲染/弹窗/抽屉/评分/评论 CRUD）
//   · 本文件（levels）  —— 等级链路：账号表存取 → 登录返回等级 → 评论记录等级
//                          → 读评论时用数据库里的**当前**等级覆盖快照
//   这里刻意不注入任何假身份：token 全部来自真实 POST /api/auth/login。
//   因为"等级存在数据库里、评论要显示别人的等级"这条链路，用注入的假数据是测不出来的。
//
// 跑法：npm run build:h5 && node scripts/e2e-cardpool-levels.mjs
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'build', 'h5');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP_PORT = 39571;
const CDP_PORT = 39572;
const BASE = 'http://127.0.0.1:' + APP_PORT;

const ADMIN_PASSWORD = 'Admin#12345';
const USER_PASSWORD = 'UserPass#123';

const results = [];
let failures = 0;
const ok = (n, d) => results.push('  ✅ ' + n + (d ? '  → ' + d : ''));
const bad = (n, d) => { failures++; results.push('  ❌ ' + n + (d ? '  → ' + d : '')); };
const check = (n, c, d) => (c ? ok(n, d) : bad(n, d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('未找到 dist/build/h5/index.html，请先执行 npm run build:h5');
  process.exit(1);
}

// ══════════════════════════════════════════════════════════════
// 1. 环境变量（必须在 require server 之前）
// ══════════════════════════════════════════════════════════════
process.env.AUTH_SECRET = 'e2e-levels-secret-0123456789abcdef0123456789';
process.env.ADMIN_INITIAL_PASSWORD = ADMIN_PASSWORD;
process.env.NODE_ENV = 'test';
process.env.PORT = String(APP_PORT);
process.env.R2_ACCESS_KEY_ID = 'e2e-ak';
process.env.R2_SECRET_ACCESS_KEY = 'e2e-sk';
process.env.R2_ENDPOINT = 'https://example.invalid';
process.env.R2_BUCKET = 'e2e-bucket';

// ══════════════════════════════════════════════════════════════
// 2. 内存数据库 + 内存 R2 + 假 R2 资源（不碰真实 dist 目录）
// ══════════════════════════════════════════════════════════════
const express = require('express');
const { newDb } = require('pg-mem');
const mem = newDb();
const pgAdapter = mem.adapters.createPg();
const pool = new pgAdapter.Pool();

const db = require(path.join(ROOT, 'db.js'));
db.setPoolForTesting(pool);

// 页面的 JS 由真实 server.js 从 dist/build/h5 直接托管（**没有**改过域名），
// 所以它请求的还是真实 R2 域名 https://cardpool.sillytroops.com —— 测试环境访问不到，
// 也不该去真的打它。于是用 CDP 的 Fetch 拦截，把这一类请求就地满足：
//   · manifest.json → 本地假清单
//   · 图片          → 一张同尺寸的 SVG 占位
// 其余请求（页面本体 / /api/*）全部放行。
const REAL_R2 = 'https://cardpool.sillytroops.com';
const MANIFEST = {
  version: 1,
  cards: [
    { id: 'dungeon-master', name: '地下城主 · 地牢冒险', file: 'dm.png', thumb: 'dm-thumb.webp', creator: 'emmelie3000', tags: ['adventure', 'rpg'], tagsZh: ['冒险', '角色扮演'], spec: 'chara_card_v3', description: '地牢冒险卡。' }
  ]
};
const store = {
  'stats.json': { 'dungeon-master': { ratingSum: 23, ratingCount: 5, downloadCount: 135 } },
  'comments.json': {}
};
const r2 = require(path.join(ROOT, 'r2.js'));
r2._setTransportForTests({
  getObject: async (key) => {
    if (!(key in store)) { const e = new Error('NoSuchKey'); e.name = 'NoSuchKey'; throw e; }
    return JSON.stringify(store[key]);
  },
  putObject: async (key, body) => { store[key] = JSON.parse(body); }
});

let chrome = null;
let profile = null;
let ws = null;
function cleanup() {
  try { if (ws) ws.close(); } catch (e) { /* ignore */ }
  try { if (chrome) chrome.kill(); } catch (e) { /* ignore */ }
  try { if (profile) fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}
process.on('exit', cleanup);

const req = async (p, opts = {}) => {
  const res = await fetch(BASE + p, {
    method: opts.method || 'GET',
    headers: Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {}),
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* 可能不是 JSON */ }
  return { status: res.status, json, text };
};
const bearer = (t) => ({ Authorization: 'Bearer ' + t });

try {
  require(path.join(ROOT, 'server.js'));

  // 等真实 server 起来（内部会自动跑迁移 + 建 admin）
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(BASE + '/api/test-api/config');
      if (r.status === 200) { ready = true; break; }
    } catch (e) { /* 还没起来 */ }
    await sleep(200);
  }
  if (!ready) throw new Error('server 在 20s 内未就绪');
  console.log('[e2e] 真实服务已就绪: ' + BASE);

  // ════════════════════════════════════════════════════════════
  // 3. 接口层：账号等级存取
  // ════════════════════════════════════════════════════════════
  const adminLogin = await req('/api/auth/login', { method: 'POST', body: { username: 'admin', password: ADMIN_PASSWORD } });
  check('admin 登录成功（真密码 + 真数据库）', adminLogin.status === 200 && !!adminLogin.json.token, adminLogin.text.slice(0, 120));
  check('管理员建号即 15 级（沿用历史行为）', adminLogin.json.user.level === 15, 'level=' + adminLogin.json.user.level);
  check('登录响应带上经验字段', adminLogin.json.user.xp === 0, 'xp=' + adminLogin.json.user.xp);
  const adminToken = adminLogin.json.token;

  const reg = await req('/api/auth/register', { method: 'POST', body: { username: 'level_user', password: USER_PASSWORD, nickname: '等级测试员' } });
  check('注册普通账号成功', reg.status === 200 && !!reg.json.token, reg.text.slice(0, 120));
  check('普通账号起始 1 级', reg.json.user.level === 1, 'level=' + reg.json.user.level);
  const userToken = reg.json.token;
  const userId = reg.json.user.id;

  const push = await req('/api/auth/me', { method: 'PATCH', headers: bearer(userToken), body: { level: 7, xp: 40 } });
  check('PATCH /api/auth/me 可同步等级与经验', push.status === 200 && push.json.user.level === 7 && push.json.user.xp === 40,
    JSON.stringify(push.json.user));

  const me = await req('/api/auth/me', { headers: bearer(userToken) });
  check('再次读取（等价于换台设备）等级已持久化', me.json.user.level === 7, 'level=' + me.json.user.level);

  const nickOnly = await req('/api/auth/me', { method: 'PATCH', headers: bearer(userToken), body: { nickname: '改个昵称' } });
  check('只改昵称不会把等级打回默认值', nickOnly.status === 200 && nickOnly.json.user.level === 7 && nickOnly.json.user.nickname === '改个昵称',
    JSON.stringify(nickOnly.json.user));

  const clampHigh = await req('/api/auth/me', { method: 'PATCH', headers: bearer(userToken), body: { level: 99999 } });
  check('越界等级被服务端夹取（99999 → 999）', clampHigh.json.user.level === 999, 'level=' + clampHigh.json.user.level);
  const clampLow = await req('/api/auth/me', { method: 'PATCH', headers: bearer(userToken), body: { level: -5, xp: -100 } });
  check('负数等级/经验被夹取为 0', clampLow.json.user.level === 0 && clampLow.json.user.xp === 0,
    JSON.stringify({ level: clampLow.json.user.level, xp: clampLow.json.user.xp }));

  const noField = await req('/api/auth/me', { method: 'PATCH', headers: bearer(userToken), body: {} });
  check('没有任何可更新字段时返回 400', noField.status === 400, noField.text.slice(0, 120));

  const anon = await req('/api/auth/me', { method: 'PATCH', body: { level: 20 } });
  check('未登录不能同步等级（401）', anon.status === 401);

  const rank = await req('/api/levels/rank', { headers: bearer(userToken) });
  check('等级榜可读', rank.status === 200 && Array.isArray(rank.json.users) && rank.json.users.length >= 2, rank.text.slice(0, 160));
  check('等级榜按等级倒序（admin 15 在 level_user 之前）',
    rank.json.users.findIndex((u) => u.username === 'admin') < rank.json.users.findIndex((u) => u.username === 'level_user'),
    rank.json.users.map((u) => u.username + ':' + u.level).join(', '));

  // ════════════════════════════════════════════════════════════
  // 4. 评论记录等级 + 读取时用当前等级覆盖
  // ════════════════════════════════════════════════════════════
  await req('/api/auth/me', { method: 'PATCH', headers: bearer(adminToken), body: { level: 15, xp: 0 } });
  await req('/api/auth/me', { method: 'PATCH', headers: bearer(userToken), body: { level: 7, xp: 40 } });

  const c1 = await req('/api/card-comments/dungeon-master', {
    method: 'POST', headers: bearer(userToken),
    body: { authorId: 'hacker', authorName: '伪造名', content: '普通账号的评论', rating: 4 }
  });
  check('发表评论成功', c1.status === 200, c1.text.slice(0, 160));
  check('评论里的昵称取自账号（不是客户端自报）', c1.json.comment.authorName === '改个昵称', c1.json.comment.authorName);
  check('评论记录了作者等级（7 级）', c1.json.comment.authorLevel === 7, 'authorLevel=' + c1.json.comment.authorLevel);
  check('评论身份不接受客户端伪造', c1.json.comment.authorId === userId, 'authorId=' + c1.json.comment.authorId);

  const c2 = await req('/api/card-comments/dungeon-master', { method: 'POST', headers: bearer(adminToken), body: { content: '管理员的评论' } });
  check('管理员评论记录 15 级', c2.status === 200 && c2.json.comment.authorLevel === 15, 'authorLevel=' + (c2.json.comment && c2.json.comment.authorLevel));

  const list1 = await req('/api/card-comments/dungeon-master');
  check('评论列表返回两条', list1.json.total === 2, 'total=' + list1.json.total);
  const listedUser = (list1.json.comments || []).find((c) => c.authorId === userId);
  const listedAdmin = (list1.json.comments || []).find((c) => c.authorId === 'user_admin');
  check('列表里普通账号等级 7', listedUser && listedUser.authorLevel === 7, JSON.stringify(listedUser && listedUser.authorLevel));
  check('列表里管理员等级 15', listedAdmin && listedAdmin.authorLevel === 15);
  check('等级被标记为实时来源（authorLevelCurrent=true）', listedUser && listedUser.authorLevelCurrent === true);

  // 关键：用户升级后，**旧评论上显示的等级要跟着变**（这正是"实时"的含义）
  await req('/api/auth/me', { method: 'PATCH', headers: bearer(userToken), body: { level: 12, xp: 0 } });
  const list2 = await req('/api/card-comments/dungeon-master');
  const afterUpgrade = (list2.json.comments || []).find((c) => c.authorId === userId);
  check('用户升级后，旧评论显示的是**当前**等级（7 → 12）',
    afterUpgrade && afterUpgrade.authorLevel === 12, 'authorLevel=' + (afterUpgrade && afterUpgrade.authorLevel));
  const rawUser = (store['comments.json']['dungeon-master'] || []).find((c) => c.authorId === userId);
  check('R2 里保存的仍是发表时的快照（7）', rawUser && rawUser.authorLevel === 7, 'snapshot=' + (rawUser && rawUser.authorLevel));

  // ════════════════════════════════════════════════════════════
  // 5. 浏览器端：真 token 进入卡池，检查评论上的等级渲染
  // ════════════════════════════════════════════════════════════
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'levels-chrome-'));
  chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + profile, '--window-size=390,844', 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let wsUrl = '';
  chrome.stderr.on('data', (b) => { const m = /ws:\/\/[^\s]+/.exec(b.toString()); if (m && !wsUrl) wsUrl = m[0]; });
  for (let i = 0; i < 100 && !wsUrl; i++) await sleep(100);
  if (!wsUrl) throw new Error('无法连接 Chrome CDP');

  ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let msgId = 0;
  const pending = new Map();
  const paused = [];
  const consoleErrors = [];
  // ⚠️ 所有 CDP 消息统一在这里分发。
  // 不要再额外用 ws.addEventListener('message', …) 抢同一批消息：那样注册的处理器
  // 会在 onmessage 之外跑，里面调 send() 拿到的响应没人认领，Promise 永不 settle
  // ——表现为"请求既不成功也不失败"，页面一直卡在加载中（这个坑踩过一次）。
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
      return;
    }
    if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '(未知异常)');
      return;
    }
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
      consoleErrors.push(m.params.type + ': ' + (m.params.args || []).map((a) => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' '));
      return;
    }
    if (m.method === 'Fetch.requestPaused') {
      handlePaused(m.params, m.sessionId);
    }
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
  });

  // 拦截真实 R2 域名的资源请求，就地满足（见上面注释）
  function handlePaused(params, sid) {
    const { requestId, request } = params;
    const url = request.url;
    if (url.indexOf(REAL_R2) !== 0) {
      send('Fetch.continueRequest', { requestId }, sid).catch(() => {});
      return;
    }
    let body;
    let contentType;
    if (/manifest\.json$/.test(url)) {
      body = Buffer.from(JSON.stringify(MANIFEST)).toString('base64');
      contentType = 'application/json; charset=utf-8';
    } else {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="350">' +
        '<rect width="300" height="350" fill="hsl(' + ((url.length * 53) % 360) + ',45%,28%)"/></svg>';
      body = Buffer.from(svg).toString('base64');
      contentType = 'image/svg+xml; charset=utf-8';
    }
    send('Fetch.fulfillRequest', {
      requestId,
      responseCode: 200,
      // ⚠️ responseHeaders 必须是 [{name, value}] 数组形式。
      // 传对象字面量时 CDP 报 "Failed to deserialize params … array start expected"，
      // 请求既不放行也不满足，页面就一直卡在加载态（踩过一次）。
      responseHeaders: [
        { name: 'Content-Type', value: contentType },
        { name: 'Access-Control-Allow-Origin', value: '*' },
        { name: 'Cache-Control', value: 'no-store' }
      ],
      body
    }, sid).then(
      () => paused.push('OK ' + url.replace(REAL_R2, '')),
      (e) => paused.push('FAIL ' + (e && e.message))
    );
  }

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, sessionId);

  const evaluate = async (expression, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  async function waitFor(expr, timeoutMs = 9000, label = expr) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try { if (await evaluate(expr)) return true; } catch (e) { /* 导航中 */ }
      await sleep(120);
    }
    bad('等待超时: ' + label);
    return false;
  }

  // 真 token 写进 localStorage（非字符串要包 type/data —— H5 的 uni.setStorageSync 就是这格式）
  const profileObj = { id: userId, username: 'level_user', nickname: '改个昵称', avatar: '', isAdmin: false, isTest: true, level: 12, xp: 0 };
  await send('Page.navigate', { url: BASE + '/' }, sessionId);
  await sleep(1500);
  await evaluate(`
    localStorage.setItem('sillytroops_auth_token', ${JSON.stringify(userToken)});
    localStorage.setItem('sillytroops_current_user', JSON.stringify({ type: 'object', data: ${JSON.stringify(profileObj)} }));
    localStorage.setItem('sillytroops_current_user_id', ${JSON.stringify(userId)});
    localStorage.setItem('user_level_' + ${JSON.stringify(userId)}, JSON.stringify({ type: 'object', data: { level: 12, xp: 0 } }));
    'ok'
  `);
  // 整页重载：hash 路由下对同一 URL 再 navigate 不会重新加载，组件 onLoad 不会跑
  await send('Page.navigate', { url: 'about:blank' }, sessionId);
  await sleep(150);
  await send('Page.navigate', { url: BASE + '/#/pages/cardpool/cardpool' }, sessionId);

  const rendered = await waitFor("document.querySelectorAll('.card').length >= 1", 12000, '卡片渲染（用真 token）');
  check('用真实登录 token 能进卡池页（真 requireAuth 通过）', rendered);
  if (rendered) {
    await evaluate("document.querySelector('.card').dispatchEvent(new MouseEvent('click', { bubbles: true }))");
    // 弹窗内容用 v-if="card" 渲染，所以等的是 .det-body（弹窗真的挂上了内容）
    const opened = await waitFor("!!document.querySelector('.det-body')", 6000, '详情弹窗');
    check('点击卡片能打开详情弹窗', opened);
    if (!opened) {
      // 失败时留一份最小现场，便于定位（正常情况下不输出）
      console.log('[DIAG] 骨架卡数 =', await evaluate("document.querySelectorAll('.card.skeleton').length"));
      console.log('[DIAG] 被拦截的 R2 请求 =', JSON.stringify(paused));
      console.log('[DIAG] 页面错误 =', JSON.stringify(consoleErrors.slice(-5)));
    }
    await sleep(700);
    const detText = await evaluate("document.querySelector('.det-body').textContent");
    const flat = detText.replace(/\s+/g, ' ');
    check('评论列表渲染出等级徽标', /Lv\.15/.test(detText) || /Lv\.12/.test(detText), flat.slice(0, 200));
    check('等级徽标带称号（15 级 = 旅团长）', /旅团长/.test(detText), '');
    check('评论身份提示里也带等级', /以「改个昵称」/.test(detText) && /Lv\.12/.test(detText), '');

    const levels = await evaluate("Array.from(document.querySelectorAll('.cmt-level')).map(function(e){return e.textContent})");
    check('两条评论各有一个等级徽标', levels.length === 2, JSON.stringify(levels));
    check('普通账号的评论显示实时等级 Lv.12（不是发表时的 7）',
      levels.some((t) => /Lv\.12/.test(t)), JSON.stringify(levels));
  }
} catch (e) {
  bad('测试执行中断', e && e.message);
} finally {
  cleanup();
}

console.log('\n等级功能端到端测试（真数据库 + 真登录 + 真 Chrome）\n');
console.log(results.join('\n'));
console.log('\n' + (failures ? '存在失败用例: ' + failures : '全部通过 ✅'));
process.exit(failures ? 1 : 0);
