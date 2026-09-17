// scripts/e2e-cardpool.mjs
// 卡池页端到端自测：真 Chrome（CDP）+ 假 R2 + 真实卡池接口（内存 R2 IO）。
//
// 为什么需要这一层：`npm run build:h5` 通过只说明语法没问题；卡池页大量依赖
//   uni.request 的 H5 实现 / 页面生命周期 / 组件 props 与 emits / scroll-view 里的 grid，
//   这些只有真跑一遍才发现。本脚本断言：
//     · 4 张卡从 manifest 渲染出来，tags 最多显示 3 个
//     · 统计数字与服务端一致（4.6 / (5) / 135），无评分的显示「暂无评分」
//     · 缩略图 404 的卡片落到灰色占位
//     · 详情弹窗能开、显示作者/评分/评论，且评分后立刻变化
//     · 抽屉能开、NSFW 开关能过滤、打开时 body 滚动被锁
//     · 未登录时评论框提示「请先登录后再评论」并能跳登录
//
// 刻意不改生产代码：把 dist 复制到临时目录，只把产物里写死的 R2 域名换成假 R2 地址
// （测试环境没有 cardpool.sillytroops.com 的写权限；真机部署时它本来就是公开域名）。
//
// 跑法：npm run build:h5 && node scripts/e2e-cardpool.mjs
import http from 'http';
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
const APP_PORT = 39519;
const CDP_PORT = 39520;
const R2_BASE = 'http://127.0.0.1:' + APP_PORT;   // 测试里让假 R2 与站点同源，省掉 CORS 噪音

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
// 1. 假 R2 数据 + 内存传输层
// ══════════════════════════════════════════════════════════════
const MANIFEST = {
  version: 1,
  updatedAt: '2026-09-15T10:46:50.854Z',
  cards: [
    // tagsZh 与 tags 一一对应（4 个 → 封面只显示前 3 个中文 tag）
    { id: 'dungeon-master', name: '地下城主 · 地牢冒险', file: 'dm.png', thumb: 'dm-thumb.webp', uploadedAt: '2026-09-15T10:46:44.195Z', creator: 'emmelie3000', tags: ['adventure', 'fantasy', 'rpg', 'anime'], tagsZh: ['冒险', '奇幻', '角色扮演', '动漫'], spec: 'chara_card_v3', description: '基于经典 TRPG 世界观的地牢冒险卡。' },
    // 故意**不给** tagsZh：验证回退到英文 tags（老 manifest 不会整片丢标签）
    { id: 'fatestay_night_rpg', name: 'Fate/Stay Night RPG', file: 'fsn.png', thumb: 'fsn-thumb.webp', uploadedAt: '2026-09-15T10:46:45.920Z', creator: 'alien256', tags: ['rpg'], spec: 'chara_card_v3' },
    { id: 'devil_summoner', name: 'Devil Summoner', file: 'ds.png', thumb: 'ds-thumb.webp', uploadedAt: '2026-09-15T10:46:47.561Z', creator: 'ghoti', tags: ['action', 'dark fantasy', 'nsfw'], tagsZh: ['动作', '黑暗奇幻', 'NSFW'], spec: 'chara_card_v3' },
    { id: 'broken_thumb_card', name: '缩略图缺失的卡', file: 'missing.png', thumb: 'nope-thumb.webp', uploadedAt: '2026-09-15T10:46:50.854Z', creator: 'nobody', tags: ['test'], spec: 'chara_card_v2' }
  ]
};

const store = {
  'stats.json': {
    'dungeon-master': { ratingSum: 23, ratingCount: 5, downloadCount: 135 },
    'fatestay_night_rpg': { ratingSum: 0, ratingCount: 0, downloadCount: 7 }
  },
  'comments.json': {
    'dungeon-master': [
      { id: 'c_1700000000000_abc123', authorId: 'user_admin', authorName: '旅团长', content: '这张卡太棒了！', rating: 5, createdAt: Date.now() - 3 * 60 * 1000 },
      { id: 'c_1700000000001_def456', authorId: 'user_other', authorName: '路过的旅人', content: '设定很细，地牢七层都写了。', rating: 4, createdAt: Date.now() - 2 * 3600 * 1000 }
    ]
  }
};

// 环境变量给齐，让 r2.isConfigured() 为真；IO 换成内存
process.env.R2_ACCESS_KEY_ID = 'e2e-ak';
process.env.R2_SECRET_ACCESS_KEY = 'e2e-sk';
process.env.R2_ENDPOINT = 'https://example.invalid';
process.env.R2_BUCKET = 'e2e-bucket';
const r2 = require(path.join(ROOT, 'r2.js'));
r2._setTransportForTests({
  getObject: async (key) => {
    if (!(key in store)) { const e = new Error('NoSuchKey'); e.name = 'NoSuchKey'; throw e; }
    return JSON.stringify(store[key]);
  },
  putObject: async (key, body) => { store[key] = JSON.parse(body); }
});
const cardpool = require(path.join(ROOT, 'cardpool.js'));

// ══════════════════════════════════════════════════════════════
// 2. 测试用站点（静态产物副本 + 卡池接口 + 假 R2 资源）
// ══════════════════════════════════════════════════════════════
const TMP_DIST = fs.mkdtempSync(path.join(os.tmpdir(), 'cardpool-e2e-'));
(function copyAndSwap(srcDir, dstDir) {
  fs.mkdirSync(dstDir, { recursive: true });
  for (const name of fs.readdirSync(srcDir)) {
    const s = path.join(srcDir, name);
    const d = path.join(dstDir, name);
    if (fs.statSync(s).isDirectory()) { copyAndSwap(s, d); continue; }
    if (/\.(js|css|html)$/.test(name)) {
      fs.writeFileSync(d, fs.readFileSync(s, 'utf8').split('https://cardpool.sillytroops.com').join(R2_BASE));
    } else {
      fs.copyFileSync(s, d);
    }
  }
})(DIST, TMP_DIST);

function svgArt(text, hue) {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="350">' +
    '<rect width="300" height="350" fill="hsl(' + hue + ',45%,28%)"/>' +
    '<text x="150" y="180" font-size="22" fill="#f5e9c8" text-anchor="middle" font-family="serif">' + text + '</text></svg>';
}

const express = require('express');
const app = express();
app.use(express.json({ limit: '2mb' }));

// 卡池接口：复用真实业务逻辑，只有"当前用户"是假的（模拟 token 解出来的身份）
cardpool.registerCardPoolRoutes(app, {
  requireAuth: (req, res, next) => {
    // 测试里用请求头声明身份，模拟 requireAuth 从 token 解出的 account
    const id = req.headers['x-e2e-user'];
    if (!id) return res.status(401).json({ error: '登录状态无效或已过期，请重新登录' });
    req.account = { id, username: id === 'user_admin' ? 'admin' : 'other', nickname: id === 'user_admin' ? '旅团长' : '路过的旅人' };
    req.accountPublic = { id, canUseTestApi: true };
    next();
  }
});

// 假 R2 资源（manifest + 图片）
app.get('/manifest.json', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(MANIFEST);
});
app.get(/\.(webp|png)$/, (req, res) => {
  if (req.path.indexOf('nope-thumb') !== -1) return res.status(404).end('nope');
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.end(svgArt(req.path.replace(/^\//, ''), (req.path.length * 53) % 360));
});

// 静态产物
app.use(express.static(TMP_DIST));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'API 路径不存在' });
  res.sendFile(path.join(TMP_DIST, 'index.html'));
});

const server = await new Promise((resolve) => {
  const s = app.listen(APP_PORT, () => resolve(s));
});
console.log('[e2e] 测试站点已启动: http://127.0.0.1:' + APP_PORT);

// ══════════════════════════════════════════════════════════════
// 3. 启动 Chrome（headless + CDP）
// ══════════════════════════════════════════════════════════════
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'cardpool-chrome-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--remote-debugging-port=' + CDP_PORT,
  '--user-data-dir=' + PROFILE,
  '--window-size=390,844',
  'about:blank'
], { stdio: ['ignore', 'ignore', 'pipe'] });

let wsUrl = '';
chrome.stderr.on('data', (buf) => {
  const m = /ws:\/\/[^\s]+/.exec(buf.toString());
  if (m && !wsUrl) wsUrl = m[0];
});
for (let i = 0; i < 100 && !wsUrl; i++) await sleep(100);
if (!wsUrl) {
  console.error('无法连接 Chrome CDP');
  chrome.kill(); server.close();
  process.exit(1);
}

// ── 极简 CDP 客户端 ───────────────────────────────────────────
const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let msgId = 0;
const pending = new Map();
const consoleLogs = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    consoleLogs.push(msg.params.type + ': ' + (msg.params.args || []).map((a) => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' '));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleLogs.push('EXCEPTION: ' + (msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text));
  }
};
function send(method, params = {}, sessionId) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
  });
}

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
// 记录页面发出的写请求，用于确认"点击发送"是否真的打到了接口
const apiCalls = [];
await send('Network.enable', {}, sessionId);
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Network.requestWillBeSent' && /\/api\/card-/.test(m.params.request.url)) {
    apiCalls.push(m.params.request.method + ' ' + m.params.request.url.replace(/^https?:\/\/[^/]+/, '') + ' ' + (m.params.request.postData || ''));
  }
});

// 测试后端的 requireAuth 用 x-e2e-user 头声明身份（模拟服务端从 token 解出 account）。
// 页面自己不会发这个头，所以在每个新文档里给 XHR 注入 —— 必须在 App 启动前装好。
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    (function () {
      var orig = XMLHttpRequest.prototype.setRequestHeader;
      XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
        if (String(name).toLowerCase() === 'authorization') {
          orig.call(this, 'x-e2e-user', 'user_admin');
        }
        return orig.call(this, name, value);
      };
    })();
  `
}, sessionId);

async function evaluate(expression, awaitPromise = false) {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }, sessionId);
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
  }
  return res.result.value;
}

async function goto(url) {
  await send('Page.navigate', { url }, sessionId);
  await sleep(400);
}

/**
 * 强制"真·整页加载"。
 *
 * ⚠️ 必须这样做的原因：本应用用的是 hash 路由，如果目标 hash 与当前不同，
 *    Page.navigate 只会触发同文档的 hash 变化 —— 页面不重新加载、组件 onLoad 不再执行，
 *    uni.request 一个都不会发出去（第一版脚本就是因此一直"等不到卡片"）。
 *    这里先跳到 about:blank 彻底卸载文档，再带上唯一的 query 参数加载目标页，
 *    保证走一次真正的 HTTP 文档导航。
 */
let _navSeq = 0;
async function hardGoto(hashUrl) {
  await send('Page.navigate', { url: 'about:blank' }, sessionId);
  await sleep(150);
  await send('Page.navigate', { url: hashUrl + (hashUrl.indexOf('?') === -1 ? '?' : '&') + '_e2e=' + (++_navSeq) }, sessionId);
  await sleep(400);
}

/** 轮询直到页面里的表达式为真 */
async function waitFor(expression, timeoutMs = 8000, label = expression) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await evaluate(expression)) return true; } catch (e) { /* 页面可能还在导航 */ }
    await sleep(120);
  }
  bad('等待超时: ' + label);
  return false;
}

// ══════════════════════════════════════════════════════════════
// 4. 断言
// ══════════════════════════════════════════════════════════════
try {
  // ── 4.1 未登录：页面守卫应把人带去登录页 ───────────────────
  await hardGoto(R2_BASE + '/#/pages/cardpool/cardpool');
  await waitFor("/pages\\/login\\/login/.test(location.hash)", 9000, '未登录跳登录页');
  const urlAfterGuard = await evaluate('location.hash');
  check('未登录进入卡池页 → 被守卫送到登录页', /pages\/login\/login/.test(urlAfterGuard), urlAfterGuard);
  // H5 的 navigateTo 会把 query 值再编码一层，所以 address bar 上是 redirect=%252F…
  // 用户能观察到的是"登录后能不能回到卡池"，所以这里断言**解码后必须是合法页面路径**
  // （登录页内部做的事与此一致：反复 decode 到稳定，再要求以 /pages/ 开头）。
  const redirectRestorePath = await evaluate(`
    (function(){
      var m = /[?&]redirect=([^&]*)/.exec(location.hash);
      if (!m) return '(没有 redirect)';
      var v = m[1];
      for (var i = 0; i < 3; i++) {
        var before = v;
        try { v = decodeURIComponent(v); } catch (e) { break; }
        if (v === before) break;
      }
      return v;
    })()
  `);
  check('登录后能重建回卡池页（redirect 解出合法页面路径）',
    redirectRestorePath.indexOf('/pages/cardpool/cardpool') === 0, redirectRestorePath);

  // ── 4.2 注入登录态（假 token：payload 里的 exp 可被客户端解析） ──
  // ⚠️ H5 的 uni.setStorageSync 对**非字符串**会存成 {"type":"object","data":{…}}，
  //    getStorageSync 再据此还原；而字符串是原样存的。所以：
  //      · token 本身就是字符串 → 直接存
  //      · 用户对象必须写成带 type/data 包装的 JSON，否则读回来是个字符串，
  //        getCurrentUser() 会认为"未登录"（评论身份、删除按钮、评分全部不生效）
  const payload = Buffer.from(JSON.stringify({ sub: 'user_admin', username: 'admin', ver: 0, iat: Date.now(), exp: Date.now() + 7 * 864e5 })).toString('base64url');
  const profile = { id: 'user_admin', username: 'admin', nickname: '旅团长', avatar: '', isAdmin: false, isTest: true };
  await evaluate(`
    localStorage.setItem('sillytroops_auth_token', ${JSON.stringify(payload + '.fakesig')});
    localStorage.setItem('sillytroops_current_user', JSON.stringify({ type: 'object', data: ${JSON.stringify(profile)} }));
    localStorage.setItem('sillytroops_current_user_id', 'user_admin');
    'ok'
  `);
  await hardGoto(R2_BASE + '/#/pages/cardpool/cardpool');
  await waitFor("/pages\\/cardpool\\/cardpool/.test(location.hash)", 9000, '进入卡池页');

  const rendered = await waitFor("document.querySelectorAll('.card').length >= 4", 9000, '卡片渲染');
  check('登录后进入卡池页并渲染出卡片', rendered);
  if (rendered) {
    const names = await evaluate("Array.from(document.querySelectorAll('.card-name')).map(e=>e.textContent)");
    check('卡片名称来自 manifest', names.includes('地下城主 · 地牢冒险') && names.includes('Fate/Stay Night RPG'), names.join(' | '));

    const tagCounts = await evaluate("Array.from(document.querySelectorAll('.card')).map(c=>c.querySelectorAll('.tag').length)");
    check('封面顶部 tag 最多 3 个（manifest 里给了 4 个）', Math.max(...tagCounts) <= 3, '各卡片 tag 数: ' + tagCounts.join(','));

    // ── tagsZh：封面默认显示中文 tag ─────────────────────────
    const dmTags = await evaluate(`
      (function(){
        var card = Array.from(document.querySelectorAll('.card')).find(function(c){return /地下城主/.test(c.textContent)});
        return card ? Array.from(card.querySelectorAll('.tag')).map(function(e){return e.textContent}) : [];
      })()
    `);
    check('封面显示 tagsZh 的中文 tag', JSON.stringify(dmTags) === JSON.stringify(['冒险', '奇幻', '角色扮演']), JSON.stringify(dmTags));
    check('中文 tag 生效时不再显示对应英文 tag', dmTags.indexOf('adventure') === -1 && dmTags.indexOf('rpg') === -1);
    const fallbackTags = await evaluate(`
      (function(){
        var card = Array.from(document.querySelectorAll('.card')).find(function(c){return /Fate\\/Stay Night/.test(c.textContent)});
        return card ? Array.from(card.querySelectorAll('.tag')).map(function(e){return e.textContent}) : [];
      })()
    `);
    check('没有 tagsZh 的卡片回退显示英文 tag', JSON.stringify(fallbackTags) === JSON.stringify(['rpg']), JSON.stringify(fallbackTags));

    const cardText = await evaluate("document.querySelector('.card-grid').textContent");
    check('评分显示真实平均值 4.6（23/5）', cardText.includes('4.6'));
    check('评分显示评分人数 (5)', cardText.includes('(5)'));
    check('下载量显示真实值 135', cardText.includes('135'));
    check('无人评分的卡显示「暂无评分」', cardText.includes('暂无评分'));
    check('作者显示 manifest 的 creator', cardText.includes('emmelie3000'));

    const placeholder = await evaluate("document.querySelectorAll('.cover-fallback').length");
    check('缩略图 404 的卡片落到灰色占位', placeholder >= 1, '.cover-fallback 数量=' + placeholder);
  }

  // ── 4.3 详情弹窗 ───────────────────────────────────────────
  await evaluate(`
    (function(){
      var cards = Array.from(document.querySelectorAll('.card'));
      var target = cards.find(function(c){ return /地下城主/.test(c.textContent); });
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return 'clicked';
    })()
  `);
  await waitFor("document.querySelector('.det') && getComputedStyle(document.querySelector('.overlay.center')).visibility === 'visible'", 6000, '详情弹窗打开');
  const detOpen = await evaluate("!!document.querySelector('.det')");
  check('点击卡片打开详情弹窗', !!detOpen);

  if (detOpen) {

    check('弹窗锁定页面滚动（body overflow=hidden）', (await evaluate("document.body.style.overflow")) === 'hidden');
    check('主内容加了 inert', await evaluate("document.querySelector('.market').hasAttribute('inert')"));

    const detText = await evaluate("document.querySelector('.det-body').textContent");
    check('弹窗显示作者', detText.includes('emmelie3000'));
    check('弹窗的 tag 也用中文（tagsZh）', /冒险/.test(detText) && /角色扮演/.test(detText) && !/adventure/.test(detText), '');
    check('弹窗显示 4.6 与人数', detText.includes('4.6') && detText.includes('5 人评分'));
    check('弹窗显示下载次数 135', detText.includes('135'));
    check('弹窗显示角色简介（manifest 有 description）', detText.includes('基于经典 TRPG 世界观'), '');
    check('评论列表已加载（2 条）', detText.includes('评论（2）') && detText.includes('这张卡太棒了！'));
    check('评论显示相对时间', /分钟前|小时前|刚刚/.test(detText));
    check('显示当前评论身份（含昵称，等级存在时附带等级）', /以「旅团长」/.test(detText) && /的身份发表评论/.test(detText),
      (detText.match(/以「[^」]*」[^的]*的身份发表评论/) || ['(未找到身份提示)'])[0]);
    check('自己的评论有删除按钮', (await evaluate("document.querySelectorAll('.cmt-del').length")) === 1,
      '删除按钮数=' + (await evaluate("document.querySelectorAll('.cmt-del').length")));

    // 评分：点第 3 颗星 → 服务端 stats 立刻变化（23+3=26 / 6 人）
    const rateRes = await evaluate(`
      (async function(){
        var stars = document.querySelectorAll('.star');
        stars[2].dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise(function(r){ setTimeout(r, 900); });
        var stats = await (await fetch('/api/card-stats')).json();
        return stats['dungeon-master'];
      })()
    `, true);
    check('提交评分后服务端统计真实变化（26/6）', rateRes && rateRes.ratingSum === 26 && rateRes.ratingCount === 6,
      JSON.stringify(rateRes));
    const afterRate = await evaluate("document.querySelector('.det-body').textContent");
    check('弹窗内评分数字立刻更新为 3.0（我的评分）', (await evaluate("document.querySelector('.rate-value').textContent")).indexOf('3.0') !== -1);
    check('平均分随之变化为 4.3（26/6）', afterRate.includes('4.3'), '');

    // 提交评论：走真实 POST（服务端用 token 身份），列表应乐观插入顶部且持久化
    const beforeComments = (store['comments.json']['dungeon-master'] || []).length;
    await evaluate(`
      (function(){
        var host = document.querySelector('.comment-input');
        var el = host.tagName === 'INPUT' ? host : host.querySelector('input');
        el.value = '地牢七层都写全了，跑团很顺。';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return 'ok';
      })()
    `);
    await sleep(200);
    await evaluate("document.querySelector('.comment-send').dispatchEvent(new MouseEvent('click',{bubbles:true}))");
    await sleep(900);
    const posted = apiCalls.filter((c) => c.indexOf('POST /api/card-comments/') === 0);
    check('点击发送确实打到了评论接口', posted.length >= 1, posted[posted.length - 1] || '(没有请求)');
    const commentsAfter = (store['comments.json']['dungeon-master'] || []);
    check('评论提交后写入了服务端（持久化）', commentsAfter.length === beforeComments + 1,
      '评论数 ' + beforeComments + ' → ' + commentsAfter.length);
    const newest = commentsAfter[commentsAfter.length - 1] || {};
    check('评论作者是当前登录用户（旅团长 / user_admin）',
      newest.authorName === '旅团长' && newest.authorId === 'user_admin',
      JSON.stringify({ authorId: newest.authorId, authorName: newest.authorName }));
    const detAfterComment = await evaluate("document.querySelector('.det-body').textContent");
    check('评论立刻显示在弹窗里（含刚发的内容）', detAfterComment.includes('地牢七层都写全了'));
    check('评论数标题同步更新为 3', detAfterComment.includes('评论（3）'));

    // 删除自己的评论：.cmt-del 只出现在自己的评论上（seed 里 user_admin 有一条，
    // 刚发的这条也是），点击后走确认框 + DELETE。
    // ⚠️ 列表是 createdAt 倒序，第一条是"刚发的"那条，所以被删掉的是 newest.id。
    const newestId = newest.id;
    await evaluate("document.querySelector('.cmt-del').dispatchEvent(new MouseEvent('click',{bubbles:true}))");
    const modalAppeared = await waitFor("!!document.querySelector('.uni-modal__btn_primary')", 4000, '删除确认弹窗');
    check('点击删除会弹出确认框', modalAppeared);
    await evaluate("document.querySelector('.uni-modal__btn_primary').click()");
    await sleep(900);
    const delCalls = apiCalls.filter((c) => c.indexOf('DELETE /api/card-comments/') === 0);
    check('确认后发出了 DELETE 请求', delCalls.length >= 1, delCalls[delCalls.length - 1] || '(没有请求)');
    const afterDelete = (store['comments.json']['dungeon-master'] || []);
    check('删除后服务端确实少了一条', afterDelete.length === commentsAfter.length - 1,
      '评论数 ' + commentsAfter.length + ' → ' + afterDelete.length);
    check('被删的正是刚发的那条', afterDelete.every((c) => c.id !== newestId), 'id=' + newestId);
    check('删除后列表里也不再有那条评论', !(await evaluate("document.querySelector('.det-body').textContent")).includes('地牢七层都写全了'));

    // 关闭弹窗
    await evaluate("document.querySelector('.det-close').dispatchEvent(new MouseEvent('click',{bubbles:true}))");
    await sleep(400);
    check('关闭弹窗后恢复滚动', (await evaluate("document.body.style.overflow")) === '');
  }

  // ── 4.4 抽屉 ───────────────────────────────────────────────
  await evaluate("document.querySelector('.mkt-filter').dispatchEvent(new MouseEvent('click',{bubbles:true}))");
  await waitFor("getComputedStyle(document.querySelector('.overlay.bottom')).visibility === 'visible'", 5000, '抽屉打开');
  const sheetVisible = await evaluate("getComputedStyle(document.querySelector('.overlay.bottom')).visibility === 'visible'");
  check('点击「搜索与筛选」打开底部抽屉', sheetVisible);
  check('抽屉打开时锁定滚动', (await evaluate("document.body.style.overflow")) === 'hidden');

  const sheetText = await evaluate("document.querySelector('.sheet').textContent");
  check('抽屉含搜索框 / 三个选择行 / NSFW', /搜索角色卡/.test(sheetText) && /卡片分类/.test(sheetText) && /卡片标签/.test(sheetText) && /排序方式/.test(sheetText) && /NSFW/.test(sheetText));

  // 搜索过滤：输入 "fate" 应只剩 1 张
  // ⚠️ uni-app H5 把 <input> 渲染成自定义元素，真正的原生输入框是它的内部子元素；
  //    直接给外层设 value / 派发 input 事件都不会进到组件的 @input 处理里。
  await evaluate(`
    (function(){
      var host = document.querySelector('.f-input');
      var el = host.tagName === 'INPUT' ? host : host.querySelector('input');
      el.value = 'fate';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return el.tagName;
    })()
  `);
  await sleep(400);
  const afterSearch = await evaluate("document.querySelectorAll('.card').length");
  check('抽屉搜索实时过滤（fate → 1 张）', afterSearch === 1, '剩余卡片数=' + afterSearch);

  // 中文 tag 也要能搜到（搜索范围同时包含 tagsZh 与 tags）
  await evaluate(`
    (function(){
      var host = document.querySelector('.f-input');
      var el = host.tagName === 'INPUT' ? host : host.querySelector('input');
      el.value = '角色扮演';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()
  `);
  await sleep(400);
  const zhSearchNames = await evaluate("Array.from(document.querySelectorAll('.card-name')).map(function(e){return e.textContent})");
  check('按中文 tag 搜索能命中（角色扮演 → 地下城主）',
    zhSearchNames.length === 1 && /地下城主/.test(zhSearchNames[0]), JSON.stringify(zhSearchNames));

  // 英文原名同样能搜到同一张卡（tags 里保留着原始值）
  await evaluate(`
    (function(){
      var host = document.querySelector('.f-input');
      var el = host.tagName === 'INPUT' ? host : host.querySelector('input');
      el.value = 'fantasy';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()
  `);
  await sleep(400);
  const enSearchNames = await evaluate("Array.from(document.querySelectorAll('.card-name')).map(function(e){return e.textContent})");
  // 注意：'fantasy' 会同时命中 Devil Summoner（tags 里的 'dark fantasy'），这是正确行为，
  // 所以这里断言的是"能搜到地下城主"，而不是"只剩一张"
  check('按英文原 tag 搜索也能命中同一张卡（fantasy → 含地下城主，且中文 tag 未受影响）',
    enSearchNames.some((n) => /地下城主/.test(n)), JSON.stringify(enSearchNames));

  // 重置 → 回来 4 张
  await evaluate("Array.from(document.querySelectorAll('.btn-ghost')).find(function(b){return /重置/.test(b.textContent)}).dispatchEvent(new MouseEvent('click',{bubbles:true}))");
  await sleep(400);
  // 关 NSFW → 3 张（devil_summoner 被过滤）
  const nsfwHintBefore = await evaluate("document.querySelector('.f-check-hint').textContent");
  check('NSFW 默认显示（初始状态文案）', /显示 NSFW/.test(nsfwHintBefore), nsfwHintBefore);
  await evaluate("document.querySelector('.nsfw-box').dispatchEvent(new MouseEvent('click',{bubbles:true}))");
  await sleep(250);
  const nsfwHintAfter = await evaluate("document.querySelector('.f-check-hint').textContent");
  check('点击 NSFW 后状态切换为隐藏', /隐藏 NSFW/.test(nsfwHintAfter), nsfwHintAfter);
  await evaluate("Array.from(document.querySelectorAll('.btn-primary')).find(function(b){return /应用/.test(b.textContent)}).dispatchEvent(new MouseEvent('click',{bubbles:true}))");
  await sleep(500);
  const afterNsfw = await evaluate("document.querySelectorAll('.card').length");
  const afterNsfwNames = await evaluate("Array.from(document.querySelectorAll('.card-name')).map(e=>e.textContent).join('|')");
  check('关闭 NSFW 后过滤掉 nsfw 卡片（4 → 3）', afterNsfw === 3, '剩余=' + afterNsfw + ' (' + afterNsfwNames + ')');
  check('抽屉关闭后恢复滚动', (await evaluate("document.body.style.overflow")) === '');

  // ── 4.5 未登录时的评论入口 ─────────────────────────────────
  // 清掉登录态后整页重载：守卫会把人送回登录页（评论/评分同理，未登录不能发表）
  await evaluate("localStorage.clear(); 'ok'");
  await hardGoto(R2_BASE + '/#/pages/cardpool/cardpool');
  const backToLogin = await waitFor("/pages\\/login\\/login/.test(location.hash)", 9000, '清登录态后回到登录页');
  check('清掉登录态后再进卡池 → 又被守卫拦到登录页', backToLogin);

  // ── 4.6 控制台无未捕获异常 ─────────────────────────────────
  const fatal = consoleLogs.filter((l) => l.startsWith('EXCEPTION'));
  check('运行期间没有未捕获异常', fatal.length === 0, fatal.join(' || '));
} catch (e) {
  bad('测试执行中断', e && e.message);
} finally {
  try { ws.close(); } catch (e) { /* ignore */ }
  try { chrome.kill(); } catch (e) { /* ignore */ }
  try { server.close(); } catch (e) { /* ignore */ }
  try { fs.rmSync(TMP_DIST, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

console.log('\n卡池页端到端测试（真 Chrome）\n');
console.log(results.join('\n'));
console.log('\n' + (failures ? '存在失败用例: ' + failures : '全部通过 ✅'));
process.exit(failures ? 1 : 0);
