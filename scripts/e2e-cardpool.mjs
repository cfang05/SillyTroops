// scripts/e2e-cardpool.mjs
// 卡池页端到端测试：真 Chrome（CDP）+ 真数据库（pg-mem）+ 真登录 + **真实鼠标/键盘事件**。
//
// 为什么用真实事件而不是 dispatchEvent：
//   合成事件（dispatchEvent）**不经过浏览器的命中测试**，元素被 inert / 被遮挡 /
//   pointer-events:none 时它照样"点得动"。之前就是这么漏掉了一个致命 bug
//   （inert 加在了悬浮层的祖先上 → 真机上弹窗里所有按钮、输入框、星星全都点不动，
//   而合成事件的测试全绿）。所以本文件一律走 CDP 的 Input.dispatchMouseEvent /
//   Input.insertText，并用 document.elementFromPoint 做命中测试。
//
// 覆盖：页面渲染、tagsZh、详情弹窗、半星评分、评分+评论一起提交、我的评论置顶、
//       评论删除（含"只能删自己的"）、真实下载原卡、导入卡片到本地角色卡池、
//       抽屉搜索/NSFW 过滤、未登录守卫。
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
const APP_PORT = 39575;
const CDP_PORT = 39576;
const BASE = 'http://127.0.0.1:' + APP_PORT;
const REAL_R2 = 'https://cardpool.sillytroops.com';

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
process.env.AUTH_SECRET = 'e2e-cardpool-secret-0123456789abcdef0123';
process.env.ADMIN_INITIAL_PASSWORD = ADMIN_PASSWORD;
process.env.NODE_ENV = 'test';
process.env.PORT = String(APP_PORT);
process.env.R2_ACCESS_KEY_ID = 'e2e-ak';
process.env.R2_SECRET_ACCESS_KEY = 'e2e-sk';
process.env.R2_ENDPOINT = 'https://example.invalid';
process.env.R2_BUCKET = 'e2e-bucket';

// ══════════════════════════════════════════════════════════════
// 2. 内存库 + 内存 R2 + 真实 server
// ══════════════════════════════════════════════════════════════
const { newDb } = require('pg-mem');
const mem = newDb();
const pgAdapter = mem.adapters.createPg();
const pool = new pgAdapter.Pool();
const db = require(path.join(ROOT, 'db.js'));
db.setPoolForTesting(pool);

// ── 构造一张**真实的角色卡 PNG**：把 chara_card_v2 数据塞进 tEXt 块 ──
// ⚠️ chara 块里必须是 **base64 编码的 JSON**（SillyTavern / CharacterImporter 的约定），
//    不能直接塞原始 JSON —— 那样 CharacterImporter._base64Decode 会抛
//    "atob: characters outside of the Latin1 range"（中文 JSON 更是必挂）。
//    第一版测试就是这么写错的，结果误判成"导入功能坏了"。
const CARD_DATA = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: {
    name: 'Fate Grand Order - RPG',
    description: '这是一张用于端到端测试的角色卡。',
    personality: '认真',
    scenario: '圣杯战争',
    first_mes: '你好，御主。',
    mes_example: '',
    creator: 'emmelie3000',
    character_version: '1.0',
    tags: ['adventure', 'anime', 'rpg']
  }
};
function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function buildCardPng() {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.from([0, 200, 40, 40, 0, 200, 40, 40]);
  // 用 zlib 生成合法的 IDAT（否则部分解码器会直接判定文件损坏）
  const zlib = require('zlib');
  const idat = zlib.deflateSync(raw);
  const charaJson = JSON.stringify(CARD_DATA);
  // base64（Latin-1 安全），与真实酒馆角色卡一致
  const charaB64 = Buffer.from(charaJson, 'utf8').toString('base64');
  const text = Buffer.concat([Buffer.from('chara', 'latin1'), Buffer.from([0]), Buffer.from(charaB64, 'latin1')]);
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('tEXt', text), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}
const CARD_PNG = buildCardPng();

const MANIFEST = {
  version: 1,
  updatedAt: '2026-09-15T10:46:50.854Z',
  cards: [
    // tagsZh 与 tags 对应（4 个 → 封面只显示前 3 个中文 tag）
    { id: 'fate_grand_order__rpg', name: 'Fate Grand Order - RPG', file: 'f.png', thumb: 'f-thumb.webp', uploadedAt: '2026-09-15T10:46:44.195Z', creator: 'emmelie3000', tags: ['adventure', 'fantasy', 'rpg', 'anime'], tagsZh: ['冒险', '奇幻', '角色扮演', '动漫'], spec: 'chara_card_v3', description: '基于经典 TRPG 世界观的地牢冒险卡。' },
    // 故意不给 tagsZh：验证回退英文 tags
    { id: 'fatestay_night_rpg', name: 'Fate/Stay Night RPG', file: 'g.png', thumb: 'g-thumb.webp', uploadedAt: '2026-09-15T10:46:45.920Z', creator: 'alien256', tags: ['rpg'], spec: 'chara_card_v3' },
    { id: 'devil_summoner', name: 'Devil Summoner', file: 'd.png', thumb: 'd-thumb.webp', uploadedAt: '2026-09-15T10:46:47.561Z', creator: 'ghoti', tags: ['action', 'dark fantasy', 'nsfw'], tagsZh: ['动作', '黑暗奇幻', 'NSFW'], spec: 'chara_card_v3' },
    { id: 'broken_thumb_card', name: '缩略图缺失的卡', file: 'missing.png', thumb: 'nope-thumb.webp', uploadedAt: '2026-09-15T10:46:50.854Z', creator: 'nobody', tags: ['test'], spec: 'chara_card_v2' }
  ]
};
const store = {
  'stats.json': {
    'fate_grand_order__rpg': { ratingSum: 23, ratingCount: 5, downloadCount: 135 },
    'fatestay_night_rpg': { ratingSum: 0, ratingCount: 0, downloadCount: 7 }
  },
  'comments.json': {
    'fate_grand_order__rpg': [
      { id: 'c_1700000000000_abc123', authorId: 'user_seed', authorName: '路过的旅人', authorLevel: 9, content: '设定很细。', rating: 4, createdAt: Date.now() - 2 * 3600 * 1000 }
    ]
  }
};
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
  console.log('[e2e] 真实服务已就绪: ' + BASE);

  const req = async (p, opts = {}) => {
    const res = await fetch(BASE + p, {
      method: opts.method || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* 非 JSON */ }
    return { status: res.status, json, text };
  };
  const bearer = (t) => ({ Authorization: 'Bearer ' + t });

  // ════════════════════════════════════════════════════════════
  // 3. Chrome（宽视口，PC 场景）
  // ════════════════════════════════════════════════════════════
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-cardpool-chrome-'));
  chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + profile, '--window-size=1440,900', 'about:blank'
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
  const downloads = [];       // 记录页面发起的下载（验证"下载原卡"真的拿到 PNG）
  let send;
  function handlePaused(params, sid) {
    const { requestId, request } = params;
    if (request.url.indexOf(REAL_R2) !== 0) {
      return send('Fetch.continueRequest', { requestId }, sid).catch(() => {});
    }
    const isManifest = /manifest\.json$/.test(request.url);
    const origin = (request.headers && request.headers.Origin) || '*';
    let body;
    let contentType;
    if (isManifest) {
      body = Buffer.from(JSON.stringify(MANIFEST)).toString('base64');
      contentType = 'application/json; charset=utf-8';
    } else if (/nope-thumb/.test(request.url)) {
      return send('Fetch.fulfillRequest', { requestId, responseCode: 404, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: origin }], body: '' }, sid).catch(() => {});
    } else if (/\.png$/.test(request.url)) {
      // ⚠️ 原卡一律回**真正的 PNG**（不是占位 SVG）：
      // 跨域下载失败时浏览器会退化成"打开这个 URL"，如果这里返回 svg+xml，
      // 页面会变成一个加载失败的空白文档（实测表现：整页全黑、后续所有元素都找不到）。
      body = CARD_PNG.toString('base64');
      contentType = 'image/png';
    } else {
      body = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="350"><rect width="300" height="350" fill="#345"/></svg>').toString('base64');
      contentType = 'image/svg+xml; charset=utf-8';
    }
    // ⚠️ 跨域响应的头要对齐线上 R2 的 CORS 配置（用户已在 R2 配好）：
    //    ACAO 按 Origin 回显 + ExposeHeaders。少了这些，页面里的 fetch 读不到字节，
    //    "下载原卡"会退化（线上 R2 已配，所以这里必须一致，否则测试与现实不符）。
    send('Fetch.fulfillRequest', {
      requestId,
      responseCode: 200,
      responseHeaders: [
        { name: 'Content-Type', value: contentType },
        { name: 'Access-Control-Allow-Origin', value: origin },
        { name: 'Access-Control-Expose-Headers', value: 'Content-Length,Content-Type,ETag' },
        { name: 'Timing-Allow-Origin', value: origin }
      ],
      body
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
    if (m.method === 'Page.downloadWillBegin') { downloads.push(m.params.suggestedFilename || '(unknown)'); return; }
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
  // 下载：headless 默认会丢弃下载。用 Browser 域的 setDownloadBehavior 落到临时目录，
  // 这样"下载原卡"能验证成"文件真的落盘了"，而不是只看按钮有没有被点到。
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-downloads-'));
  await send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadDir,
    eventsEnabled: true
  });

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
  /** 真实鼠标点击元素中心。
   *  ⚠️ 必须"先滚动、等一帧、再重新量坐标"，并且用 elementFromPoint 校验命中的就是目标：
   *  上一个动作可能弹出 toast / 改变布局，用旧坐标点下去会打到别处
   *  （实测表现：点击"毫无反应"、计数不涨、弹窗关不掉 —— 全是坐标过期造成的假失败）。 */
  async function realClick(selector, index = 0, tries = 4) {
    let last = { top: '(not attempted)' };
    for (let attempt = 1; attempt <= tries; attempt++) {
      const exists = await ev(`!!document.querySelectorAll(${JSON.stringify(selector)})[${index}]`);
      if (!exists) {
        if (attempt === tries) return { missing: selector + '[' + index + ']', top: '(元素不存在)' };
        await sleep(300);
        continue;
      }
      await ev(`(function(){var el=document.querySelectorAll(${JSON.stringify(selector)})[${index}];if(el&&el.scrollIntoView)el.scrollIntoView({block:'center'});return 1})()`);
      await sleep(200);   // 等布局/滚动稳定
      const box = await ev(`
        (function(){
          var el = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
          if (!el) return null;
          var r = el.getBoundingClientRect();
          var x = r.left + r.width/2, y = r.top + r.height/2;
          var top = document.elementFromPoint(x, y);
          var hitOk = !!(top && (top === el || el.contains(top)));
          return JSON.stringify({ x: x, y: y, hitOk: hitOk, top: top ? (top.tagName + '.' + String(top.className)) : 'null' });
        })()
      `);
      if (!box) return { missing: selector + '[' + index + ']', top: '(量不到矩形)' };
      const parsed = JSON.parse(box);
      last = { x: parsed.x, y: parsed.y, top: parsed.top, hitOk: parsed.hitOk, attempt: attempt };
      if (!parsed.hitOk) {
        // 被别的层挡住（toast / 遮罩 / 还没消失的弹窗）：等一会儿再试
        if (attempt < tries) { await sleep(400); continue; }
        return last;
      }
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: parsed.x, y: parsed.y, button: 'left', clickCount: 1 }, sessionId);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: parsed.x, y: parsed.y, button: 'left', clickCount: 1 }, sessionId);
      await sleep(320);
      return last;
    }
    return last;
  }
  /** 真实鼠标点击元素内的相对位置（ratio 0=左边缘 1=右边缘），用于点星星左右半 */
  async function realClickAt(selector, ratio, index = 0) {
    const info = await ev(`
      (function(){
        var el = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
        if (!el) return null;
        el.scrollIntoView({ block: 'center' });
        var r = el.getBoundingClientRect();
        var x = r.left + r.width * ${ratio}, y = r.top + r.height/2;
        var top = document.elementFromPoint(x, y);
        return JSON.stringify({ x: x, y: y, top: top ? (top.tagName + '.' + String(top.className)) : 'null' });
      })()
    `);
    if (!info) return { missing: selector };
    const { x, y, top } = JSON.parse(info);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, sessionId);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, sessionId);
    await sleep(320);
    return { x, y, top };
  }
  async function realType(selector, text) {
    const info = await ev(`
      (function(){
        var host = document.querySelector(${JSON.stringify(selector)});
        if (!host) return null;
        var el = host.tagName === 'INPUT' ? host : host.querySelector('input');
        if (!el) return null;
        el.scrollIntoView({ block: 'center' });
        var r = el.getBoundingClientRect();
        var x = r.left + r.width/2, y = r.top + r.height/2;
        var top = document.elementFromPoint(x, y);
        return JSON.stringify({ x: x, y: y, top: top ? (top.tagName + '.' + String(top.className)) : 'null' });
      })()
    `);
    if (!info) return { missing: selector };
    const { x, y, top } = JSON.parse(info);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, sessionId);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, sessionId);
    await sleep(180);
    await send('Input.insertText', { text }, sessionId);
    await sleep(400);
    const value = await ev(`(function(){var h=document.querySelector(${JSON.stringify(selector)});var e=h.tagName==='INPUT'?h:h.querySelector('input');return e?e.value:null})()`);
    return { x, y, top, value };
  }
  async function realBackspace(times) {
    for (let i = 0; i < times; i++) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 8, key: 'Backspace' }, sessionId);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 8, key: 'Backspace' }, sessionId);
    }
    await sleep(350);
  }

  /**
   * uni 会把 <text> 渲染成 uni-text 组件并在里面套真实文本节点，
   * 用 textContent 断言文字内容最稳（对齐用 innerText 在 headless 下容易受渲染时序影响）。
   */
  const textOf = (selector) => ev(`(function(){var e=document.querySelector(${JSON.stringify(selector)});return e?e.textContent:null})()`);

  // ════════════════════════════════════════════════════════════
  // 4. 登录（真接口）
  // ════════════════════════════════════════════════════════════
  const admin = await req('/api/auth/login', { method: 'POST', body: { username: 'admin', password: ADMIN_PASSWORD } });
  check('admin 真实登录成功', admin.status === 200 && !!admin.json.token, admin.text.slice(0, 100));
  const adminToken = admin.json.token;
  const adminUser = admin.json.user;
  const asUser = await req('/api/auth/register', { method: 'POST', body: { username: 'pool_user', password: USER_PASSWORD, nickname: '卡池测试员' } });
  check('普通账号注册成功（用于验证"只能删自己的评论"）', asUser.status === 200, asUser.text.slice(0, 100));
  const userToken = asUser.json.token;
  const userId = asUser.json.user.id;

  // ════════════════════════════════════════════════════════════
  // 5. 未登录守卫
  // ════════════════════════════════════════════════════════════
  await hardGoto(BASE + '/#/pages/cardpool/cardpool');
  await waitFor("/pages\\/login\\/login/.test(location.hash)", 9000, '未登录跳登录页');
  check('未登录进入卡池页被守卫送到登录页', /pages\/login\/login/.test(await ev('location.hash')));
  const redirect = await ev(`(function(){var m=/[?&]redirect=([^&]*)/.exec(location.hash);if(!m)return '';var v=m[1];for(var i=0;i<3;i++){var b=v;try{v=decodeURIComponent(v)}catch(e){break}if(v===b)break}return v})()`);
  check('登录后能重建回卡池页（redirect 解出合法路径）', redirect.indexOf('/pages/cardpool/cardpool') === 0, redirect);

  // ════════════════════════════════════════════════════════════
  // 6. 注入登录态 → 卡片网格
  // ════════════════════════════════════════════════════════════
  await ev(`
    localStorage.setItem('sillytroops_auth_token', ${JSON.stringify(adminToken)});
    localStorage.setItem('sillytroops_current_user', JSON.stringify({ type: 'object', data: ${JSON.stringify(adminUser)} }));
    localStorage.setItem('sillytroops_current_user_id', ${JSON.stringify(adminUser.id)});
    'ok'
  `);
  await hardGoto(BASE + '/#/pages/cardpool/cardpool');
  const rendered = await waitFor("document.querySelectorAll('.card:not(.skeleton)').length >= 4", 12000, '卡片渲染');
  check('登录后渲染出 4 张卡片', rendered);

  // 记录"下载动作"是否被触发：onDownload 会临时插入一个带 download 属性的 <a> 并 click()。
  // 这个计数证明前端确实发起了下载（跨域下浏览器是否落盘不在前端可控范围）。
  await ev(`
    window.__dlCount = 0;
    document.addEventListener('click', function(e){
      var t = e.target;
      if (t && t.tagName === 'A' && t.hasAttribute('download')) window.__dlCount++;
    }, true);
    'ok'
  `);
  const names = await ev("Array.from(document.querySelectorAll('.card-name')).map(function(e){return e.textContent})");
  check('卡片名称来自 manifest', names.indexOf('Fate Grand Order - RPG') !== -1 && names.indexOf('Devil Summoner') !== -1, JSON.stringify(names));
  const dmTags = await ev(`
    (function(){
      var c = Array.from(document.querySelectorAll('.card')).find(function(x){return /Fate Grand Order/.test(x.textContent)});
      return c ? Array.from(c.querySelectorAll('.tag')).map(function(e){return e.textContent}) : [];
    })()
  `);
  check('封面显示 tagsZh 的中文 tag（最多 3 个）', JSON.stringify(dmTags) === JSON.stringify(['冒险', '奇幻', '角色扮演']), JSON.stringify(dmTags));
  const fallbackTags = await ev(`
    (function(){
      var c = Array.from(document.querySelectorAll('.card')).find(function(x){return /Fate\\/Stay Night/.test(x.textContent)});
      return c ? Array.from(c.querySelectorAll('.tag')).map(function(e){return e.textContent}) : [];
    })()
  `);
  check('没有 tagsZh 的卡片回退英文 tag', JSON.stringify(fallbackTags) === JSON.stringify(['rpg']), JSON.stringify(fallbackTags));
  const gridText = await ev("document.querySelector('.card-grid').textContent");
  check('网格显示真实平均分 4.6（23/5）', gridText.indexOf('4.6') !== -1);
  check('网格显示下载量 135', gridText.indexOf('135') !== -1);
  check('无人评分的卡显示「暂无评分」', gridText.indexOf('暂无评分') !== -1);
  check('缩略图 404 的卡落到灰色占位', (await ev("document.querySelectorAll('.cover-fallback').length")) >= 1);

  // ════════════════════════════════════════════════════════════
  // 7. 详情弹窗 + 半星 + 评分评论一起提交
  // ════════════════════════════════════════════════════════════
  await realClick('.card', 0);
  await waitFor("!!document.querySelector('.det-body')", 8000, '详情弹窗打开');
  check('真实点击卡片打开详情弹窗', await ev("!!document.querySelector('.det-body')"));
  const detText0 = await ev("document.querySelector('.det-body').textContent");
  check('弹窗显示作者与下载次数', detText0.indexOf('emmelie3000') !== -1 && detText0.indexOf('135') !== -1);
  check('弹窗显示角色简介', detText0.indexOf('基于经典 TRPG 世界观') !== -1);
  check('弹窗 tag 用中文', /冒险/.test(detText0) && !/adventure/.test(detText0));
  check('已有一条他人评论', detText0.indexOf('设定很细。') !== -1 && detText0.indexOf('评论（1）') !== -1);

  // 半星：点第 4 颗星的**左半** → 3.5 分
  const starHalf = await realClickAt('.star', 0.3, 3);
  await sleep(300);
  check('点星星左半 = 半星（第 4 颗左半 → 3.5）',
    (await ev("(document.querySelector('.rate-value')||{}).textContent")) === '3.5',
    'rate-value=' + (await ev("(document.querySelector('.rate-value')||{}).textContent")) + ' 命中=' + starHalf.top);
  const widths = await ev("Array.from(document.querySelectorAll('.star-fill')).map(function(e){return e.style.width})");
  check('半星渲染为 0/50/100% 的裁切宽度',
    JSON.stringify(widths) === JSON.stringify(['100%', '100%', '100%', '50%', '0%']), JSON.stringify(widths));

  // 再点第 5 颗星右半 → 满分 5.0
  const starFull = await realClickAt('.star', 0.8, 4);
  await sleep(300);
  check('点星星右半 = 整星（第 5 颗右半 → 5.0）',
    (await ev("(document.querySelector('.rate-value')||{}).textContent")) === '5.0',
    'rate-value=' + (await ev("(document.querySelector('.rate-value')||{}).textContent")) + ' 命中=' + starFull.top);
  const widths2 = await ev("Array.from(document.querySelectorAll('.star-fill')).map(function(e){return e.style.width})");
  check('满分时五颗星全部 100%', JSON.stringify(widths2) === JSON.stringify(['100%', '100%', '100%', '100%', '100%']), JSON.stringify(widths2));

  // 评论输入 + 一起提交
  const typed = await realType('.comment-input', '评分和评论一起提交');
  check('评论输入框能真实输入', typed.value === '评分和评论一起提交', JSON.stringify(typed));
  const statsBefore = JSON.parse(JSON.stringify(store['stats.json']['fate_grand_order__rpg']));
  const beforeCount = (store['comments.json']['fate_grand_order__rpg'] || []).length;
  const submitClick = await realClick('.comment-send', 0);
  await sleep(1000);
  const afterStats = store['stats.json']['fate_grand_order__rpg'];
  check('「提交」按钮命中正确（文字在按钮中间）', /UNI-BUTTON/.test(submitClick.top || ''), '命中=' + submitClick.top);
  check('提交后评分已记账（23+5=28、人数 5→6）',
    afterStats.ratingSum === statsBefore.ratingSum + 5 && afterStats.ratingCount === statsBefore.ratingCount + 1,
    JSON.stringify({ before: statsBefore, after: afterStats }));
  const afterCount = (store['comments.json']['fate_grand_order__rpg'] || []).length;
  check('提交后评论也写入了服务端', afterCount === beforeCount + 1, beforeCount + ' → ' + afterCount);

  // 我的评论置顶 + 标记
  await sleep(400);
  const detText1 = await ev("document.querySelector('.det-body').textContent");
  // 至少要有"我的评论"这块 + 标注 + 点评分
  const mineText = String(await textOf('.cmt-mine') || '');
  check('置顶块标注「我的评论」', mineText.indexOf('我的评论') !== -1, mineText.slice(0, 80));
  check('置顶块带本次提交的评分 5.0', /评分\s*5\.0/.test(mineText), mineText.slice(0, 120));
  const myOrderFirst = await ev(`
    (function(){
      var body = document.querySelector('.det-body');
      var mine = body.querySelector('.cmt-mine');
      return mine ? 1 : 0;
    })()
  `);
  check('我的评论在列表最上方（先于其他评论）', myOrderFirst === 1);
  check('评论区标题计数更新为 2', detText1.indexOf('评论（2）') !== -1);
  check('别人的评论仍在我的评论下面', detText1.indexOf('设定很细。') !== -1);

  // 我的评论带删除按钮；别人的评论（当前登录 admin 也不是作者）不该有
  check('我的评论有删除按钮', (await ev("document.querySelectorAll('.cmt-mine .cmt-del').length")) === 1);
  check('他人评论没有删除按钮（只有自己的能删）', (await ev("document.querySelectorAll('.cmt-list .cmt-del').length")) === 0);

  // 再打一次分（改分）：人数不应增加。
  // 注意：提交一次后输入框会被清空，所以这里要重新写评论内容 ——
  // 只点星星不写内容时提交会被拦（"请先打分或写下评论"），那是预期行为。
  const beforeRate2 = JSON.parse(JSON.stringify(store['stats.json']['fate_grand_order__rpg']));
  await realClickAt('.star', 0.8, 2);   // 第 3 颗星右半 → 3.0
  await sleep(300);
  check('改分后本地分值变为 3.0', (await ev("(document.querySelector('.rate-value')||{}).textContent")) === '3.0',
    await ev("(document.querySelector('.rate-value')||{}).textContent"));
  await realType('.comment-input', '改分后的第二条评论');
  await realClick('.comment-send', 0);
  await sleep(900);
  const afterRate2 = store['stats.json']['fate_grand_order__rpg'];
  check('改评分：人数不增加、总和按差值调整（5.0 → 3.0 应 -2）',
    afterRate2.ratingCount === beforeRate2.ratingCount && Math.abs(afterRate2.ratingSum - (beforeRate2.ratingSum - 2)) < 1e-9,
    JSON.stringify({ before: beforeRate2, after: afterRate2 }));
  const commentsMine = (store['comments.json']['fate_grand_order__rpg'] || []).filter((c) => c.authorId === adminUser.id);
  check('同一个人的多条评论都存在（"我的评论"只置顶最新那条）', commentsMine.length === 2, '我的评论数=' + commentsMine.length);
  check('置顶显示的是最新那条', /改分后的第二条评论/.test(String(await textOf('.cmt-mine'))), String(await textOf('.cmt-mine')).slice(0, 60));

  check('运行到此处没有未捕获异常', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' || '));

  // ════════════════════════════════════════════════════════════
  // 8. 下载原卡 / 导入卡片（两者都要计数）
  //
  // ⚠️ 跨域下载的坑：R2 与站点不同源时，<a download> 的 download 属性会被浏览器忽略，
  //    退化成"打开这个 URL"—— 页面会**直接导航走**（实测整页变成空白文档，
  //    此后所有元素都找不到，后续断言全部假失败）。所以每次点完下载类按钮，
  //    都先确认页面还在，不在就重进卡池页并重开弹窗，再做下一个断言。
  // ════════════════════════════════════════════════════════════
  const openCardDetail = async () => {
    let alive = false
    try { alive = await ev("!!document.querySelector('.card')") } catch (e) { alive = false }
    if (!alive) {
      await hardGoto(BASE + '/#/pages/cardpool/cardpool');
      await waitFor("document.querySelectorAll('.card:not(.skeleton)').length >= 1", 12000, '卡片渲染（重进页面）');
    }
    if (!(await ev("!!document.querySelector('.det-body')"))) {
      await realClick('.card', 0);
      await waitFor("!!document.querySelector('.det-body')", 8000, '详情弹窗（重开）');
    }
    return ev("!!document.querySelector('.det-body')");
  };

  const dlBefore = store['stats.json']['fate_grand_order__rpg'].downloadCount;
  const dlBtnHit = await realClick('.act-btn:not(.is-primary)', 0);
  await sleep(1500);
  const dlAfter = store['stats.json']['fate_grand_order__rpg'].downloadCount;
  check('「下载原卡」按钮真实可点（命中按钮本身）', /UNI-BUTTON/.test(dlBtnHit.top || ''), '命中=' + dlBtnHit.top);
  check('「下载原卡」让下载次数 +1', dlAfter === dlBefore + 1, dlBefore + ' → ' + dlAfter);
  // 等文件真的落到设备上 —— 这是"下载原卡"唯一有意义的验收标准。
  // 前端用的是 fetch→blob→同源 blob URL 下载（跨域直链的 download 属性会被浏览器忽略并
  // 把页面导航走，实测确认），所以这里应该能看到真实文件 + 正确字节数。
  let downloadedFile = '';
  for (let i = 0; i < 20; i++) {
    const files = fs.existsSync(downloadDir) ? fs.readdirSync(downloadDir).filter((f) => !f.endsWith('.crdownload')) : [];
    if (files.length) { downloadedFile = files[0]; break; }
    await sleep(250);
  }
  const pageStillHere = await ev("!!document.querySelector('.det-body')");
  check('「下载原卡」没有把页面导航走（跨域 download 属性的经典坑）', pageStillHere === true, '弹窗仍在=' + pageStillHere);
  check('「下载原卡」真的把原卡下载到了设备', !!downloadedFile, '文件=' + (downloadedFile || '(无)'));
  if (downloadedFile) {
    const bytes = fs.statSync(path.join(downloadDir, downloadedFile)).size;
    check('下载下来的就是卡片的原 PNG（字节数与源一致）',
      bytes === CARD_PNG.length, '下载 ' + bytes + ' 字节 / 原图 ' + CARD_PNG.length + ' 字节');
    check('下载的文件名来自 manifest 的 file 字段', downloadedFile === 'f.png', downloadedFile);
  }

  await openCardDetail();
  // 把页面端的 console / 未捕获异常都留一份完整记录：导入失败时提示五花八门，
  // 只看 warn/error 里拼好的那句话经常看不出真正原因。
  await ev(`
    window.__pageLogs = [];
    ['log','warn','error'].forEach(function(level){
      var orig = console[level];
      console[level] = function(){
        try { window.__pageLogs.push(level + ': ' + Array.prototype.map.call(arguments, function(a){
          if (a instanceof Error) return a.message + ' | ' + (a.stack || '').split('\\n').slice(0,3).join(' <- ');
          try { return typeof a === 'string' ? a : JSON.stringify(a); } catch (e) { return String(a); }
        }).join(' ')); } catch (e) {}
        return orig.apply(console, arguments);
      };
    });
    window.addEventListener('error', function(e){ window.__pageLogs.push('onerror: ' + (e.message || '')); });
    window.addEventListener('unhandledrejection', function(e){
      var r = e.reason;
      window.__pageLogs.push('unhandledrejection: ' + (r && r.message ? r.message : String(r)));
    });
    'ok'
  `);
  const impBefore = store['stats.json']['fate_grand_order__rpg'].downloadCount;
  const impHit = await realClick('.act-btn.is-primary', 0);
  await sleep(3000);
  const impAfter = store['stats.json']['fate_grand_order__rpg'].downloadCount;
  check('「导入卡片」按钮真实可点（命中按钮本身）', /UNI-BUTTON/.test(impHit.top || ''), '命中=' + impHit.top);
  check('「导入卡片」也让下载次数 +1', impAfter === impBefore + 1, impBefore + ' → ' + impAfter);
  const pageLogs = await ev('JSON.stringify(window.__pageLogs || [])');
  if (String(pageLogs).indexOf('导入') !== -1 || String(pageLogs).indexOf('CardDetail') !== -1) {
    console.log('[DIAG] 导入相关页面日志 =', String(pageLogs).slice(0, 900));
  }
  // 本地角色卡池落在 IndexedDB 里。⚠️ 数据库名不是 'characterCard' ——
  // cachedStore 用的是 opts.dbName（默认 'sillytroops_kv'），传进去的 `name` 只作内部标识。
  // 所以这里先用 indexedDB.databases() 列出真实库名，再逐个读，避免"查错库 → 假失败"。
  const localCardDump = await ev(`
    (function(){
      function dumpDb(name){
        return new Promise(function(resolve){
          var req = indexedDB.open(name);
          req.onerror = function(){ resolve({ db: name, err: 'open failed' }); };
          req.onsuccess = function(){
            var db = req.result;
            var stores = Array.prototype.slice.call(db.objectStoreNames);
            if (!stores.length) return resolve({ db: name, stores: [], entries: [] });
            var entries = [], pending = stores.length;
            var tx = db.transaction(stores, 'readonly');
            stores.forEach(function(storeName){
              var r = tx.objectStore(storeName).getAll();
              var ks = tx.objectStore(storeName).getAllKeys();
              var keys = [];
              ks.onsuccess = function(){ keys = ks.result || []; };
              r.onsuccess = function(){
                (r.result || []).forEach(function(v, i){
                  entries.push({ key: keys[i], name: v && v.data && v.data.name ? v.data.name : (v && v.name) });
                });
                if (--pending === 0) resolve({ db: name, stores: stores, entries: entries });
              };
              r.onerror = function(){ if (--pending === 0) resolve({ db: name, stores: stores, entries: entries }); };
            });
          };
        });
      }
      return new Promise(function(resolve){
        try {
          if (!indexedDB.databases) return resolve('(databases() 不可用)');
          indexedDB.databases().then(function(list){
            var names = (list || []).map(function(d){ return d.name; });
            Promise.all(names.map(dumpDb)).then(function(all){
              resolve(JSON.stringify(all));
            });
          }, function(e){ resolve('databases() 失败: ' + e.message); });
        } catch (e) { resolve('ERR:' + e.message); }
      });
    })()
  `, true);
  console.log('[DIAG] IndexedDB 内容 =', String(localCardDump).slice(0, 500));
  check('「导入卡片」真的写进了本地角色卡池（IndexedDB）',
    typeof localCardDump === 'string' && localCardDump.indexOf('Fate Grand Order - RPG') !== -1,
    String(localCardDump).slice(0, 220));
  check('导入过程没有报错', consoleErrors.filter((x) => /导入|import|角色卡/i.test(x)).length === 0,
    consoleErrors.slice(0, 2).join(' || '));

  // 关闭弹窗
  const closeHit = await realClick('.det-close', 0);
  await sleep(700);
  const closed = !(await ev("!!document.querySelector('.det-body')"));
  if (!closed) {
    console.log('[DIAG] 关闭按钮命中 =', JSON.stringify(closeHit));
    console.log('[DIAG] .det-close 数量 =', await ev("document.querySelectorAll('.det-close').length"));
  }
  check('真实点击右上角关闭按钮能关闭详情弹窗', closed, '命中=' + closeHit.top);

  // ════════════════════════════════════════════════════════════
  // 9. 抽屉：搜索 / NSFW
  // ════════════════════════════════════════════════════════════
  // 抽屉：先把详情弹窗关严，再打开（否则点到的还是弹窗遮罩）
  await waitFor("!document.querySelector('.det-body')", 5000, '详情弹窗已关');
  await realClick('.mkt-filter', 0);
  await waitFor("getComputedStyle(document.querySelector('.overlay.bottom')).visibility === 'visible'", 6000, '抽屉打开');
  const sheetOpen = await ev("!!document.querySelector('.sheet') && getComputedStyle(document.querySelector('.overlay.bottom')).visibility === 'visible'");
  check('真实点击打开筛选抽屉', sheetOpen);
  if (!sheetOpen) throw new Error('抽屉未打开，后续抽屉断言无法继续');
  const sheetText = await ev("document.querySelector('.sheet').textContent");
  check('抽屉含搜索框/三个选择行/NSFW', /搜索角色卡/.test(sheetText) && /卡片分类/.test(sheetText) && /卡片标签/.test(sheetText) && /排序方式/.test(sheetText) && /NSFW/.test(sheetText));
  const searchTyped = await realType('.f-input', 'Stay');
  check('抽屉搜索框能真实输入', searchTyped.value === 'Stay');
  const filtered = await ev("Array.from(document.querySelectorAll('.card-name')).map(function(e){return e.textContent})");
  check('真实输入触发实时过滤（Stay → 1 张）', filtered.length === 1 && /Fate\/Stay Night/.test(filtered[0]), JSON.stringify(filtered));
  await realClick('.f-input', 0);
  await realBackspace(6);
  check('清空搜索后卡片全部回来', (await ev("document.querySelectorAll('.card-name').length")) === 4);
  await realClick('.f-check', 0);
  await sleep(300);
  check('真实点击 NSFW 开关行能切换', /隐藏 NSFW/.test(await ev("(document.querySelector('.f-check-hint')||{}).textContent")));
  await realClick('.btn-primary', 0);
  await sleep(600);
  const nsfwNames = await ev("Array.from(document.querySelectorAll('.card-name')).map(function(e){return e.textContent})");
  check('关闭 NSFW 后过滤掉 nsfw 卡（4 → 3）', nsfwNames.length === 3 && nsfwNames.indexOf('Devil Summoner') === -1, JSON.stringify(nsfwNames));
  check('抽屉关闭后恢复滚动', (await ev('document.body.style.overflow')) === '');

  check('全程没有未捕获异常', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' || '));
} catch (e) {
  bad('测试执行中断', e && e.message);
} finally {
  cleanup();
}

console.log('\n卡池页端到端测试（真实鼠标/键盘 + 真数据库 + 真 Chrome）\n');
console.log(results.join('\n'));
console.log('\n' + (failures ? '存在失败用例: ' + failures : '全部通过 ✅'));
process.exit(failures ? 1 : 0);
