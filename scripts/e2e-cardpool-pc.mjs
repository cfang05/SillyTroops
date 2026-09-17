// scripts/e2e-cardpool-pc.mjs
// PC 桌面视口下的端到端测试：专治两类"只有真机/真实点击才会暴露"的问题。
//
// 为什么单独有这一套：
//   e2e-cardpool.mjs 用的是**合成事件**（dispatchEvent）。合成事件不经过浏览器的命中测试，
//   所以在元素被 inert / 被遮挡 / pointer-events:none 的情况下它照样"点得动"，
//   测试是绿的、真机上却完全点不动 —— 这个差异真实坑过一次（`inert` 加错层）。
//   本文件改用 CDP 的 Input.dispatchMouseEvent 发**真实鼠标事件**，并用
//   document.elementFromPoint 做命中测试，只有真正能点到才算通过。
//
// 同时覆盖 PC 布局：pages.json 的 globalStyle.maxWidth:480 只约束页面容器，
// 管不到 position:fixed 的悬浮层，所以这里断言弹窗/抽屉宽度不超过 480。
//
// 跑法：npm run build:h5 && node scripts/e2e-cardpool-pc.mjs
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
const APP_PORT = 39581;
const CDP_PORT = 39582;
const BASE = 'http://127.0.0.1:' + APP_PORT;

// 刻意用宽视口：PC 上悬浮层超宽的问题只在宽视口暴露
const VIEW_W = 1440;
const VIEW_H = 900;
// 与 pages.json 的 globalStyle.maxWidth 保持一致
const MAX_WIDTH = 480;

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

process.env.AUTH_SECRET = 'e2e-pc-secret-0123456789abcdef0123456789ab';
process.env.ADMIN_INITIAL_PASSWORD = 'Admin#12345';
process.env.NODE_ENV = 'test';
process.env.PORT = String(APP_PORT);
process.env.R2_ACCESS_KEY_ID = 'e2e-ak';
process.env.R2_SECRET_ACCESS_KEY = 'e2e-sk';
process.env.R2_ENDPOINT = 'https://example.invalid';
process.env.R2_BUCKET = 'e2e-bucket';

// ── 内存库 + 内存 R2 + 真实 server ──────────────────────────
const { newDb } = require('pg-mem');
const mem = newDb();
const pgAdapter = mem.adapters.createPg();
const pool = new pgAdapter.Pool();
const db = require(path.join(ROOT, 'db.js'));
db.setPoolForTesting(pool);

const MANIFEST = {
  version: 1,
  cards: [
    { id: 'fate_grand_order__rpg', name: 'Fate Grand Order - RPG', file: 'f.png', thumb: 'f-thumb.webp', creator: 'emmelie3000', tags: ['adventure', 'anime', 'rpg'], tagsZh: ['冒险', '二次元', '角色扮演'], spec: 'chara_card_v3', description: '角色简介。' },
    { id: 'fatestay_night_rpg', name: 'Fate/Stay Night RPG', file: 'g.png', thumb: 'g-thumb.webp', creator: 'alien256', tags: ['rpg'], spec: 'chara_card_v3' }
  ]
};
const store = { 'stats.json': {}, 'comments.json': {} };
const r2 = require(path.join(ROOT, 'r2.js'));
r2._setTransportForTests({
  getObject: async (k) => { if (!(k in store)) { const e = new Error('NoSuchKey'); e.name = 'NoSuchKey'; throw e; } return JSON.stringify(store[k]); },
  putObject: async (k, b) => { store[k] = JSON.parse(b); }
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

try {
  require(path.join(ROOT, 'server.js'));
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(BASE + '/api/test-api/config'); if (r.status === 200) { ready = true; break; } } catch (e) { /* 还没起来 */ }
    await sleep(200);
  }
  if (!ready) throw new Error('server 在 20s 内未就绪');

  const admin = await (await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Admin#12345' })
  })).json();

  // ── Chrome（宽视口） ────────────────────────────────────────
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-pc-chrome-'));
  chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + profile,
    '--window-size=' + VIEW_W + ',' + VIEW_H, 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let wsUrl = '';
  chrome.stderr.on('data', (b) => { const m = /ws:\/\/[^\s]+/.exec(b.toString()); if (m && !wsUrl) wsUrl = m[0]; });
  for (let i = 0; i < 100 && !wsUrl; i++) await sleep(100);
  if (!wsUrl) throw new Error('无法连接 Chrome CDP');

  ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let msgId = 0;
  const pending = new Map();
  const consoleErrors = [];
  const r2Hits = [];
  let send;
  // ⚠️ 真实 R2 域名在测试环境访问不到，用 CDP Fetch 就地满足。
  //    responseHeaders 必须是 [{name,value}] 数组（传对象会报 deserialize 失败，
  //    请求既不放行也不满足，页面永远卡在骨架屏）。
  function handlePaused(params, sid) {
    const { requestId, request } = params;
    if (request.url.indexOf('https://cardpool.sillytroops.com') !== 0) {
      return send('Fetch.continueRequest', { requestId }, sid).catch(() => {});
    }
    const isManifest = /manifest\.json$/.test(request.url);
    const origin = (request.headers && request.headers.Origin) || '*';
    r2Hits.push(request.url.replace('https://cardpool.sillytroops.com', ''));
    send('Fetch.fulfillRequest', {
      requestId,
      responseCode: 200,
      responseHeaders: [
        { name: 'Content-Type', value: isManifest ? 'application/json; charset=utf-8' : 'image/svg+xml; charset=utf-8' },
        { name: 'Access-Control-Allow-Origin', value: origin }
      ],
      body: Buffer.from(isManifest
        ? JSON.stringify(MANIFEST)
        : '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="350"><rect width="300" height="350" fill="#345"/></svg>').toString('base64')
    }, sid).catch(() => {});
  }
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
      return;
    }
    if (m.method === 'Runtime.exceptionThrown') { consoleErrors.push('EXC: ' + (m.params.exceptionDetails?.exception?.description || '').slice(0, 160)); return; }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push('error: ' + (m.params.args || []).map((a) => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' ').slice(0, 160));
      return;
    }
    if (m.method === 'Fetch.requestPaused') handlePaused(m.params, m.sessionId);
  };
  send = (method, params = {}, sid) => new Promise((res, rej) => {
    const id = ++msgId; pending.set(id, { resolve: res, reject: rej });
    ws.send(JSON.stringify(sid ? { id, method, params, sessionId: sid } : { id, method, params }));
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, sessionId);
  const ev = async (expr, ap = false) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: ap }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  async function waitFor(expr, timeoutMs = 9000, label = expr) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try { if (await ev(expr)) return true; } catch (e) { /* 导航中 */ }
      await sleep(120);
    }
    bad('等待超时: ' + label);
    return false;
  }
  async function hardGoto(hashUrl) {
    await send('Page.navigate', { url: 'about:blank' }, sessionId);
    await sleep(150);
    await send('Page.navigate', { url: hashUrl }, sessionId);
    await sleep(400);
  }

  /**
   * 真实鼠标点击：先算元素中心，再问"这个坐标上最顶层是谁"（命中测试），
   * 最后发真实的 mousePressed/mouseReleased。返回命中元素，供断言用。
   */
  async function realClick(selector, index = 0) {
    const info = await ev(`
      (function(){
        var els = document.querySelectorAll(${JSON.stringify(selector)});
        var el = els[${index}];
        if (!el) return null;
        el.scrollIntoView({ block: 'center' });
        var r = el.getBoundingClientRect();
        var x = r.left + r.width / 2, y = r.top + r.height / 2;
        var top = document.elementFromPoint(x, y);
        return JSON.stringify({ x: x, y: y, top: top ? (top.tagName + '.' + String(top.className)) : 'null' });
      })()
    `);
    if (!info) return { missing: selector + '[' + index + ']' };
    const { x, y, top } = JSON.parse(info);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, sessionId);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, sessionId);
    await sleep(320);
    return { x, y, top };
  }

  /** 真实鼠标点击元素内的相对横向位置（ratio 0=左边缘 1=右边缘）：用于点星星的左右半颗 */
  async function realClickAt(selector, ratio, index = 0) {
    const info = await ev(`
      (function(){
        var el = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
        if (!el) return null;
        el.scrollIntoView({ block: 'center' });
        var r = el.getBoundingClientRect();
        var x = r.left + r.width * ${ratio}, y = r.top + r.height / 2;
        var top = document.elementFromPoint(x, y);
        return JSON.stringify({ x: x, y: y, top: top ? (top.tagName + '.' + String(top.className)) : 'null' });
      })()
    `);
    if (!info) return { missing: selector + '[' + index + ']' };
    const { x, y, top } = JSON.parse(info);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, sessionId);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, sessionId);
    await sleep(320);
    return { x, y, top };
  }

  /** 真实键盘输入：点进输入框再 insertText */
  async function realType(selector, text) {
    const info = await ev(`
      (function(){
        var host = document.querySelector(${JSON.stringify(selector)});
        if (!host) return null;
        var el = host.tagName === 'INPUT' ? host : host.querySelector('input');
        if (!el) return null;
        el.scrollIntoView({ block: 'center' });
        var r = el.getBoundingClientRect();
        var x = r.left + r.width / 2, y = r.top + r.height / 2;
        var top = document.elementFromPoint(x, y);
        return JSON.stringify({ x: x, y: y, top: top ? (top.tagName + '.' + String(top.className)) : 'null' });
      })()
    `);
    if (!info) return { missing: selector };
    const { x, y, top } = JSON.parse(info);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, sessionId);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, sessionId);
    await sleep(200);
    await send('Input.insertText', { text }, sessionId);
    await sleep(450);
    const value = await ev(`
      (function(){var h=document.querySelector(${JSON.stringify(selector)});var e=h.tagName==='INPUT'?h:h.querySelector('input');return e?e.value:null})()
    `);
    return { x, y, top, value };
  }

  const rectOf = (selector) => ev(`
    (function(){
      var el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      var r = el.getBoundingClientRect();
      return JSON.stringify({ w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), cx: Math.round(r.left + r.width/2), vw: innerWidth, viewportCx: Math.round(innerWidth/2) });
    })()
  `).then((s) => (s ? JSON.parse(s) : null));

  // ════════════════════════════════════════════════════════════
  // 1. index 页：中间 + 按钮必须真正居中
  // ════════════════════════════════════════════════════════════
  await send('Page.navigate', { url: BASE + '/' }, sessionId);
  await sleep(1500);
  await ev(`
    localStorage.setItem('sillytroops_auth_token', ${JSON.stringify(admin.token)});
    localStorage.setItem('sillytroops_current_user', JSON.stringify({ type: 'object', data: ${JSON.stringify(admin.user)} }));
    localStorage.setItem('sillytroops_current_user_id', ${JSON.stringify(admin.user.id)});
    'ok'
  `);
  await hardGoto(BASE + '/#/pages/index/index');
  await waitFor("!!document.querySelector('.tabbar')", 10000, 'index 页 tabbar');

  const fab = await rectOf('.fab');
  const tabbar = await rectOf('.tabbar');
  check('index 页底部导航渲染出 4 个 Tab + 中间 FAB',
    (await ev("document.querySelectorAll('.tabbar .tab').length")) === 4);
  check('FAB 的中心与底部导航中心对齐（真正居中）',
    fab && tabbar && Math.abs(fab.cx - (tabbar.left + tabbar.w / 2)) <= 2,
    JSON.stringify({ fabCx: fab && fab.cx, barCx: tabbar && Math.round(tabbar.left + tabbar.w / 2) }));
  check('FAB 不在最右侧', fab && tabbar && fab.cx < tabbar.left + tabbar.w - 60, 'fabCx=' + (fab && fab.cx));
  const tabCenters = await ev(`
    (function(){
      var bar = document.querySelector('.tabbar').getBoundingClientRect();
      return JSON.stringify(Array.from(document.querySelectorAll('.tabbar .tab')).map(function(el){
        var b = el.getBoundingClientRect();
        return Math.round(b.left + b.width/2 - bar.left);
      }));
    })()
  `);
  check('四个 Tab 依次分布在 FAB 两侧',
    JSON.parse(tabCenters).every((c) => c >= 0) && new Set(JSON.parse(tabCenters)).size === 4, tabCenters);

  // ════════════════════════════════════════════════════════════
  // 2. 卡池页：真实点击打开详情弹窗
  // ════════════════════════════════════════════════════════════
  await hardGoto(BASE + '/#/pages/cardpool/cardpool');
  const cardShown = await waitFor("document.querySelectorAll('.card:not(.skeleton)').length >= 2", 12000, '卡片渲染');
  check('卡池页渲染出真实卡片（非骨架）', cardShown);

  check('顶部返回键沿用公共 NavBar（与角色卡库一致）', await ev("!!document.querySelector('.nav-bar-fixed .nav-back-btn')"));
  check('NavBar 标题/副标题正确',
    (await ev("(document.querySelector('.nav-title')||{}).textContent")) === '冒险卡池' &&
    (await ev("(document.querySelector('.nav-subtitle')||{}).textContent")) === 'Card Pool');
  check('分类 Tab 合并为 3 个（含「预设 / 正则」）',
    (await ev("JSON.stringify(Array.from(document.querySelectorAll('.mkt-tab')).map(function(e){return e.textContent}))"))
      === JSON.stringify(['角色卡', '冒险卡', '预设 / 正则']),
    await ev("JSON.stringify(Array.from(document.querySelectorAll('.mkt-tab')).map(function(e){return e.textContent}))"));

  const opened = await realClick('.card', 0);
  await waitFor("!!document.querySelector('.det-body')", 6000, '详情弹窗');
  check('真实鼠标点击卡片能打开详情弹窗', await ev("!!document.querySelector('.det-body')"), '命中=' + opened.top);

  // ════════════════════════════════════════════════════════════
  // 3. PC 宽度：弹窗不得超出金色边框（maxWidth 480）
  // ════════════════════════════════════════════════════════════
  const detRect = await rectOf('.det');
  check('详情弹窗宽度不超过页面最大宽度 ' + MAX_WIDTH + 'px',
    detRect && detRect.w <= MAX_WIDTH, JSON.stringify(detRect));
  // 注意：视口宽度要用页面里的 innerWidth（有滚动条时会小于 --window-size），不能用常量
  check('详情弹窗在页面中轴线上',
    detRect && Math.abs(detRect.cx - detRect.viewportCx) <= 2, JSON.stringify(detRect));
  const pageRect = await rectOf('.stage');
  check('弹窗没有超出页面容器（金色边框）',
    detRect && pageRect && detRect.left >= pageRect.left && (detRect.left + detRect.w) <= (pageRect.left + pageRect.w),
    JSON.stringify({ det: detRect, page: pageRect }));

  // ════════════════════════════════════════════════════════════
  // 4. 弹窗内交互：真实鼠标点星星（含半星）/ 真实键盘输入评论 / 点提交
  //    注：评分与评论是「一起提交」的，所以这里先选分+写内容，再点提交。
  // ════════════════════════════════════════════════════════════
  // 点第 5 颗星的**右半** → 5.0
  const starClick = await realClickAt('.star', 0.8, 4);
  await sleep(400);
  const starValue = await ev("(document.querySelector('.rate-value')||{}).textContent");
  check('真实点击星星右半得整星（5.0）', starValue === '5.0', 'rate-value=' + starValue);
  check('星星点击命中的是星星本身（未被 inert/遮挡吞掉）',
    /SVG|PATH|UNI-VIEW/.test(starClick.top || ''), '命中=' + starClick.top);

  const typed = await realType('.comment-input', '真实键盘输入');
  check('评论输入框能用真实键盘输入', typed.value === '真实键盘输入', JSON.stringify(typed));

  const before = (store['comments.json']['fate_grand_order__rpg'] || []).length;
  const sendClick = await realClick('.comment-send', 0);
  await sleep(1000);
  const after = (store['comments.json']['fate_grand_order__rpg'] || []).length;
  check('点「提交」能真的把评分+评论提交到服务端', after === before + 1, '评论数 ' + before + ' → ' + after);
  check('「提交」按钮命中正确', /UNI-BUTTON/.test(sendClick.top || ''), '命中=' + sendClick.top);
  const stats = store['stats.json']['fate_grand_order__rpg'];
  check('评分也一并记账（5.0 分、1 人）', stats && stats.ratingSum === 5 && stats.ratingCount === 1, JSON.stringify(stats));
  check('提交后出现「我的评论」置顶块', !!(await ev("!!document.querySelector('.cmt-mine')")));

  // 关闭弹窗：真实点击
  const closeClick = await realClick('.det-close', 0);
  await sleep(600);
  check('真实点击关闭按钮能关掉弹窗', !(await ev("!!document.querySelector('.det-body')")), '命中=' + closeClick.top);

  // ════════════════════════════════════════════════════════════
  // 5. 抽屉：宽度 + 真实搜索 / NSFW / 应用
  // ════════════════════════════════════════════════════════════
  const filterClick = await realClick('.mkt-filter', 0);
  await waitFor("getComputedStyle(document.querySelector('.overlay.bottom')).visibility === 'visible'", 5000, '抽屉打开');
  check('真实点击「搜索与筛选」能打开抽屉',
    (await ev("getComputedStyle(document.querySelector('.overlay.bottom')).visibility")) === 'visible', '命中=' + filterClick.top);

  const sheetRect = await rectOf('.sheet');
  check('抽屉宽度不超过页面最大宽度 ' + MAX_WIDTH + 'px', sheetRect && sheetRect.w <= MAX_WIDTH, JSON.stringify(sheetRect));
  check('抽屉在页面中轴线上', sheetRect && Math.abs(sheetRect.cx - sheetRect.viewportCx) <= 2, JSON.stringify(sheetRect));

  const searchTyped = await realType('.f-input', 'Stay');
  check('抽屉搜索框能用真实键盘输入', searchTyped.value === 'Stay', JSON.stringify(searchTyped));
  const filtered = await ev("Array.from(document.querySelectorAll('.card-name')).map(function(e){return e.textContent})");
  check('真实输入触发实时过滤（Stay → 只剩 Fate/Stay Night）',
    filtered.length === 1 && /Fate\/Stay Night/.test(filtered[0]), JSON.stringify(filtered));

  // 清空搜索（真实按键删除），再点 NSFW 与「应用」
  await realClick('.f-input', 0);
  for (let i = 0; i < 8; i++) await send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 8, key: 'Backspace' }, sessionId);
  await sleep(400);
  const afterClear = await ev("document.querySelectorAll('.card-name').length");
  check('清空搜索后卡片全部回来', afterClear === 2, '卡片数=' + afterClear);
  // 点整行（label）—— 需求就是"点这一行就能开关"
  const nsfwClick = await realClick('.f-check', 0);
  await sleep(300);
  const hint = await ev("(document.querySelector('.f-check-hint')||{}).textContent");
  check('真实点击 NSFW 开关行能切换状态', /隐藏 NSFW/.test(hint || ''), '提示=' + hint + ' 命中=' + nsfwClick.top);
  const applyClick = await realClick('.btn-primary', 0);
  await sleep(600);
  check('真实点击「应用」能关闭抽屉并恢复滚动',
    (await ev("getComputedStyle(document.querySelector('.overlay.bottom')).visibility")) === 'hidden' &&
    (await ev('document.body.style.overflow')) === '',
    '命中=' + applyClick.top);

  check('真实 R2 资源请求被正确满足', r2Hits.some((u) => /manifest\.json/.test(u)), JSON.stringify(r2Hits));
  check('运行期间没有未捕获异常', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' || '));
} catch (e) {
  bad('测试执行中断', e && e.message);
} finally {
  cleanup();
}

console.log('\nPC 视口端到端测试（真实鼠标事件 + 命中测试 + 1440×900）\n');
console.log(results.join('\n'));
console.log('\n' + (failures ? '存在失败用例: ' + failures : '全部通过 ✅'));
process.exit(failures ? 1 : 0);
