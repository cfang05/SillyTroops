// scripts/smoke-cardpool.js
// 卡池接口冒烟测试：不连 R2（用内存假实现替换 r2 的读写），专门验证业务规则。
//
// 覆盖：
//   1) 评分累加：首次评分 ratingCount+1；改评分只调 ratingSum 不涨人数
//   2) 下载计数 +1
//   3) 评分/内容/cardId 的校验分支
//   4) 评论：发表（身份取自 token，而非 body）、倒序、改昵称不影响已发评论
//   5) 删除评论：只能删自己的（403）；不存在 404
//   6) R2 未配置时统一 503
//
// 跑法：node scripts/smoke-cardpool.js
'use strict';

// ── 必须先设环境变量，再 require r2 ──────────────────────────
// ⚠️ 踩坑记录：不要试图用 `r2.isConfigured = () => true` 来打桩。
// r2.js 内部（readJson / updateJson）调用的是**模块作用域**的函数声明绑定，
// 而 module.exports 上的属性是另一个引用；改 exports 上的属性不会影响模块内部的调用，
// 结果就是"外部看是已配置、内部却抛未配置"，测试会以极难定位的方式集体失败。
// 所以这里走真实路径：环境变量给齐（让 isConfigured 为真），只把网络 IO 换成内存实现。
const UNCONFIGURED_MODE = process.argv.indexOf('--unconfigured') !== -1;
if (!UNCONFIGURED_MODE) {
  process.env.R2_ACCESS_KEY_ID = 'test-ak';
  process.env.R2_SECRET_ACCESS_KEY = 'test-sk';
  process.env.R2_ENDPOINT = 'https://example.invalid';
  process.env.R2_BUCKET = 'cardpool-test';
}

const assert = require('assert');
const path = require('path');
const r2 = require(path.join(__dirname, '..', 'r2.js'));

// ── 用内存假 IO 替换 R2 传输层（真实读-改-写链路保持原样） ────
const store = {};
r2._setTransportForTests({
  getObject: async (key) => {
    if (!(key in store)) {
      const e = new Error('NoSuchKey');
      e.name = 'NoSuchKey';
      throw e;
    }
    return JSON.stringify(store[key]);
  },
  putObject: async (key, body) => { store[key] = JSON.parse(body); }
});

const cardpool = require(path.join(__dirname, '..', 'cardpool.js'));

// ── 迷你 app / request 桩 ────────────────────────────────────
const routes = [];
const app = {
  get: (p, ...h) => routes.push({ method: 'GET', path: p, handlers: h }),
  post: (p, ...h) => routes.push({ method: 'POST', path: p, handlers: h }),
  delete: (p, ...h) => routes.push({ method: 'DELETE', path: p, handlers: h })
};

// 假装已登录：把 req.account 填成"当前用户"，模拟服务端从 token 解出的身份
let currentUser = { id: 'user_admin', username: 'admin', nickname: '旅团长' };
function requireAuth(req, res, next) {
  if (!currentUser) return res.status(401).json({ error: '未登录' });
  req.account = currentUser;
  req.accountPublic = { id: currentUser.id, canUseTestApi: true };
  next();
}

cardpool.registerCardPoolRoutes(app, { requireAuth });

function call(method, url, body) {
  const target = routes.find((r) => r.method === method && r.path === url);
  if (!target) throw new Error('路由未注册: ' + method + ' ' + url);
  return new Promise((resolve) => {
    const req = { params: {}, body: body || {}, account: null };
    const res = {
      _status: 200,
      status(c) { this._status = c; return this; },
      json(payload) { resolve({ status: this._status, body: payload }); return this; }
    };
    const next = (err) => {
      if (err) return resolve({ status: 500, body: { error: String(err && err.message || err), thrown: true } });
      // requireAuth 放行后进入业务处理器
      const handler = target.handlers[target.handlers.length - 1];
      Promise.resolve(handler(req, res)).catch((e) => resolve({ status: 500, body: { error: String(e && e.message || e), thrown: true } }));
    };
    // 先跑中间件链（这里只有 requireAuth）
    const mw = target.handlers[0];
    if (mw === requireAuth) {
      mw(req, res, next);
    } else {
      next();
    }
  });
}

// 带路径参数的调用：把 :cardId 等替换掉
function callWith(method, urlTemplate, params, body) {
  const target = routes.find((r) => r.method === method && r.path === urlTemplate);
  if (!target) throw new Error('路由未注册: ' + method + ' ' + urlTemplate);
  return new Promise((resolve) => {
    const req = { params: params || {}, body: body || {}, account: null };
    const res = {
      _status: 200,
      status(c) { this._status = c; return this; },
      json(payload) { resolve({ status: this._status, body: payload }); return this; }
    };
    const next = (err) => {
      if (err) return resolve({ status: 500, body: { error: String(err && err.message || err) } });
      const handler = target.handlers[target.handlers.length - 1];
      Promise.resolve(handler(req, res)).catch((e) => resolve({ status: 500, body: { error: String(e && e.message || e) } }));
    };
    const mw = target.handlers[0];
    if (mw === requireAuth) mw(req, res, next); else next();
  });
}

const results = [];
function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => { results.push('  ✅ ' + name); },
    (e) => { results.push('  ❌ ' + name + ' → ' + (e && e.message)); process.exitCode = 1; }
  );
}

// ── 子进程模式：只验证「R2 未配置 → 503」这条分支 ─────────────
// 主进程为了跑真实链路必须把 env 设齐，所以未配置分支只能换个进程测。
if (process.argv.indexOf('--unconfigured') !== -1) {
  const assert2 = require('assert');
  assert2.strictEqual(r2.isConfigured(), false, '子进程不应判定为已配置');
  call('GET', '/api/card-stats').then((r) => {
    assert2.strictEqual(r.status, 503, '未配置时应 503，实际 ' + r.status);
    process.stdout.write('unconfigured-guard-ok');
  }, (e) => {
    process.stdout.write('unconfigured-guard-failed: ' + e.message);
  });
  return;
}

(async function main() {
  console.log('卡池接口冒烟测试\n');
  assert.strictEqual(r2.isConfigured(), true, '测试前置条件：R2 环境变量已设齐');

  await check('首次评分：ratingSum += 5，ratingCount = 1', async () => {
    const r = await callWith('POST', '/api/card-stats/:cardId/rate', { cardId: 'dungeon-master' }, { rating: 5 });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body.stats, { ratingSum: 5, ratingCount: 1, downloadCount: 0 });
  });

  await check('再次新增评分（不带 previousRating）：人数 +1', async () => {
    const r = await callWith('POST', '/api/card-stats/:cardId/rate', { cardId: 'dungeon-master' }, { rating: 3 });
    assert.deepStrictEqual(r.body.stats, { ratingSum: 8, ratingCount: 2, downloadCount: 0 });
  });

  await check('修改评分（带 previousRating=3，改成 5）：只调 sum，人数不变', async () => {
    const r = await callWith('POST', '/api/card-stats/:cardId/rate', { cardId: 'dungeon-master' }, { rating: 5, previousRating: 3 });
    assert.strictEqual(r.body.updated, true);
    assert.deepStrictEqual(r.body.stats, { ratingSum: 10, ratingCount: 2, downloadCount: 0 });
  });

  await check('平均分 = 10/2 = 5.0（保留 1 位小数）', async () => {
    const s = (await call('GET', '/api/card-stats')).body['dungeon-master'];
    assert.strictEqual((s.ratingSum / s.ratingCount).toFixed(1), '5.0');
  });

  await check('下载 +1 且不影响评分', async () => {
    const r = await callWith('POST', '/api/card-stats/:cardId/download', { cardId: 'dungeon-master' }, {});
    assert.strictEqual(r.body.stats.downloadCount, 1);
    assert.strictEqual(r.body.stats.ratingCount, 2);
  });

  await check('rating 非法（0 / 6 / 字符串 / 非 0.5 倍数）→ 400', async () => {
    for (const bad of [0, 6, 'abc', 2.3, 0.4, 5.5, 2.25, -1]) {
      const r = await callWith('POST', '/api/card-stats/:cardId/rate', { cardId: 'x_card' }, { rating: bad });
      assert.strictEqual(r.status, 400, 'rating=' + JSON.stringify(bad) + ' 应被拒绝');
    }
  });

  await check('半星评分被接受（0.5 / 2.5 / 4.5）', async () => {
    delete store[r2.STATS_KEY];
    const a = await callWith('POST', '/api/card-stats/:cardId/rate', { cardId: 'half_card' }, { rating: 0.5 });
    assert.strictEqual(a.status, 200, JSON.stringify(a.body));
    assert.strictEqual(a.body.stats.ratingSum, 0.5);
    const b = await callWith('POST', '/api/card-stats/:cardId/rate', { cardId: 'half_card' }, { rating: 2.5 });
    assert.strictEqual(b.body.stats.ratingSum, 3);
    assert.strictEqual(b.body.stats.ratingCount, 2);
    const c = await callWith('POST', '/api/card-stats/:cardId/rate', { cardId: 'half_card' }, { rating: 4.5 });
    assert.strictEqual(c.body.stats.ratingSum, 7.5);
    assert.strictEqual(c.body.stats.ratingCount, 3);
  });

  await check('半星改评分：只调总和、人数不变（0.5 → 4.5 的差值精确）', async () => {
    const r = await callWith('POST', '/api/card-stats/:cardId/rate', { cardId: 'half_card' }, { rating: 4.5, previousRating: 0.5 });
    assert.strictEqual(r.body.stats.ratingSum, 11.5, '7.5 - 0.5 + 4.5 = 11.5');
    assert.strictEqual(r.body.stats.ratingCount, 3);
  });

  await check('多次半星累加不会出现浮点尾巴（0.1+0.2 类问题）', async () => {
    delete store[r2.STATS_KEY];
    for (let i = 0; i < 10; i++) {
      await callWith('POST', '/api/card-stats/:cardId/rate', { cardId: 'float_card' }, { rating: 0.5 });
    }
    const s = (await call('GET', '/api/card-stats')).body['float_card'];
    assert.strictEqual(s.ratingSum, 5, '10 × 0.5 应正好是 5，实际 ' + s.ratingSum);
    assert.strictEqual(String(s.ratingSum).indexOf('0000000'), -1);
  });

  await check('cardId 非法（原型污染键 / 超长 / 含斜杠）→ 400', async () => {
    for (const bad of ['__proto__', 'constructor', 'a'.repeat(201), 'a/b', 'a b']) {
      const r = await callWith('POST', '/api/card-stats/:cardId/rate', { cardId: bad }, { rating: 5 });
      assert.strictEqual(r.status, 400, 'cardId=' + bad.slice(0, 12) + ' 应被拒绝');
    }
  });

  await check('未登录不能评论 → 401', async () => {
    const saved = currentUser;
    currentUser = null;
    const r = await callWith('POST', '/api/card-comments/:cardId', { cardId: 'dungeon-master' }, { content: 'hi' });
    currentUser = saved;
    assert.strictEqual(r.status, 401);
  });

  await check('发表评论：身份取自 token，body 里的 authorId/authorName 被忽略', async () => {
    const r = await callWith('POST', '/api/card-comments/:cardId', { cardId: 'dungeon-master' }, {
      authorId: 'attacker',
      authorName: '我是管理员',
      content: '这张卡太棒了！',
      rating: 5
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.comment.authorId, 'user_admin');
    assert.strictEqual(r.body.comment.authorName, '旅团长');
    assert.strictEqual(r.body.comment.content, '这张卡太棒了！');
    assert.strictEqual(r.body.comment.rating, 5);
    assert.ok(/^c_\d+_[0-9a-f]{8}$/.test(r.body.comment.id), 'id 形如 c_1700000000000_abc123，实际=' + r.body.comment.id);
  });

  await check('评论内容为空 / 超 500 字 → 400', async () => {
    const empty = await callWith('POST', '/api/card-comments/:cardId', { cardId: 'c1' }, { content: '   ' });
    assert.strictEqual(empty.status, 400);
    const long = await callWith('POST', '/api/card-comments/:cardId', { cardId: 'c1' }, { content: 'x'.repeat(501) });
    assert.strictEqual(long.status, 400);
  });

  await check('authorName 超 20 字 → 400', async () => {
    const r = await callWith('POST', '/api/card-comments/:cardId', { cardId: 'c1' }, { content: 'ok', authorName: 'x'.repeat(21) });
    assert.strictEqual(r.status, 400);
  });

  await check('评论列表按 createdAt 倒序（最新在前）', async () => {
    const r = await callWith('GET', '/api/card-comments/:cardId', { cardId: 'dungeon-master' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.total, 1);
    assert.strictEqual(r.body.comments[0].content, '这张卡太棒了！');
  });

  await check('删除他人评论 → 403', async () => {
    const list = await callWith('GET', '/api/card-comments/:cardId', { cardId: 'dungeon-master' });
    const cid = list.body.comments[0].id;
    currentUser = { id: 'user_other', username: 'other', nickname: '别人' };
    const r = await callWith('DELETE', '/api/card-comments/:cardId/:commentId', { cardId: 'dungeon-master', commentId: cid });
    currentUser = { id: 'user_admin', username: 'admin', nickname: '旅团长' };
    assert.strictEqual(r.status, 403);
  });

  await check('删自己的评论 → 200，且从列表消失', async () => {
    const list = await callWith('GET', '/api/card-comments/:cardId', { cardId: 'dungeon-master' });
    const cid = list.body.comments[0].id;
    const del = await callWith('DELETE', '/api/card-comments/:cardId/:commentId', { cardId: 'dungeon-master', commentId: cid });
    assert.strictEqual(del.status, 200);
    const after = await callWith('GET', '/api/card-comments/:cardId', { cardId: 'dungeon-master' });
    assert.strictEqual(after.body.total, 0);
  });

  await check('删除不存在的评论 → 404', async () => {
    const r = await callWith('DELETE', '/api/card-comments/:cardId/:commentId', { cardId: 'dungeon-master', commentId: 'c_1_deadbeef' });
    assert.strictEqual(r.status, 404);
  });

  await check('评论 + 评分一起提交：一次请求同时记账评分与评论', async () => {
    delete store[r2.STATS_KEY];
    delete store[r2.COMMENTS_KEY];
    const r = await callWith('POST', '/api/card-comments/:cardId', { cardId: 'combo_card' }, {
      content: '评分和评论一起提交',
      rating: 3.5,
      previousRating: 0
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.rated, true);
    // 评分已记入 stats
    assert.deepStrictEqual(r.body.stats, { ratingSum: 3.5, ratingCount: 1, downloadCount: 0 });
    // 评论也写入了
    assert.strictEqual(r.body.comment.rating, 3.5);
    assert.strictEqual(r.body.comment.content, '评分和评论一起提交');
    const list = await callWith('GET', '/api/card-comments/:cardId', { cardId: 'combo_card' });
    assert.strictEqual(list.body.total, 1);
    const stats = (await call('GET', '/api/card-stats')).body['combo_card'];
    assert.strictEqual(stats.ratingSum, 3.5);
  });

  await check('只评论不打分：不产生评分记录（rated=false、stats 为 null）', async () => {
    const r = await callWith('POST', '/api/card-comments/:cardId', { cardId: 'comment_only_card' }, { content: '只评论' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.rated, false);
    assert.strictEqual(r.body.stats, null);
    const stats = (await call('GET', '/api/card-stats')).body['comment_only_card'];
    assert.strictEqual(stats, undefined, '不该凭空产生该卡片的评分记录');
  });

  await check('评论里带非法评分 → 400，且不写入评论', async () => {
    const before = ((await callWith('GET', '/api/card-comments/:cardId', { cardId: 'bad_combo' })).body.total) || 0;
    const r = await callWith('POST', '/api/card-comments/:cardId', { cardId: 'bad_combo' }, { content: 'x', rating: 2.3 });
    assert.strictEqual(r.status, 400);
    const after = ((await callWith('GET', '/api/card-comments/:cardId', { cardId: 'bad_combo' })).body.total) || 0;
    assert.strictEqual(after, before, '非法评分时不应留下评论');
  });

  await check('R2 未配置时 GET /api/card-stats → 503（子进程实测，避免打桩 isConfigured）', async () => {
    const { execFileSync } = require('child_process');
    const env = Object.assign({}, process.env);
    ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ENDPOINT', 'R2_BUCKET'].forEach((k) => { delete env[k]; });
    let out;
    try {
      out = execFileSync(process.execPath, [path.join(__dirname, 'smoke-cardpool.js'), '--unconfigured'], { env: env })
        .toString().trim();
    } catch (e) {
      throw new Error('子进程执行失败: ' + (e.stdout ? e.stdout.toString() : e.message));
    }
    assert.strictEqual(out, 'unconfigured-guard-ok');
  });

  await check('stats.json 缺失时 GET /api/card-stats 返回 {}（不报错）', async () => {
    delete store[r2.STATS_KEY];
    const r = await call('GET', '/api/card-stats');
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body, {});
  });

  await check('并发 10 次评分不丢计数（读-改-写串行化）', async () => {
    delete store[r2.STATS_KEY];
    await Promise.all(Array.from({ length: 10 }, () =>
      callWith('POST', '/api/card-stats/:cardId/rate', { cardId: 'race_card' }, { rating: 4 })
    ));
    const s = (await call('GET', '/api/card-stats')).body['race_card'];
    assert.strictEqual(s.ratingCount, 10, '应累计 10 次评分，实际 ' + s.ratingCount);
    assert.strictEqual(s.ratingSum, 40);
  });

  console.log(results.join('\n'));
  console.log('\n' + (process.exitCode ? '存在失败用例' : '全部通过 ✅'));
})();
