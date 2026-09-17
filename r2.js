// r2.js - Cloudflare R2（S3 兼容）JSON 文件读写
//
// 背景：卡池的**评分/下载量/评论必须是全局统计**——前端部署在 Railway 且可能多实例，
// 卡片本体存在 R2，所以这份数据只能由服务端持有，落在 R2 上的两个 JSON 文件里：
//   stats.json      { "<cardId>": { ratingSum, ratingCount, downloadCount } }
//   comments.json   { "<cardId>": [ { id, authorId, authorName, content, rating, createdAt } ] }
//
// 为什么用 @aws-sdk/client-s3：R2 的接口与 S3 完全兼容，用官方 SDK 就不必自己实现
// SigV4 签名（canonical request + HMAC-SHA256 派生签名密钥），少一大片易错代码。
//
// ⚠️ 依赖必须放在 package.json 的 dependencies 而不是 devDependencies：
//    nixpacks.toml 部署时 NODE_ENV=production 会跳过 devDependencies，
//    放错了 Railway 上会直接 Cannot find module '@aws-sdk/client-s3'。
//
// 凭证全部来自环境变量（Railway 配置），任何密钥都不出现在代码里：
//   R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_ENDPOINT / R2_BUCKET

'use strict';

const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand
} = require('@aws-sdk/client-s3');

/** 两个数据文件的对象键（放在 bucket 根目录，与卡片图片同级） */
const STATS_KEY = 'stats.json';
const COMMENTS_KEY = 'comments.json';

const MISSING_MSG = '卡池数据服务未配置（服务端缺少 R2 凭证环境变量）';

// ── 客户端（惰性单例） ───────────────────────────────────────
let _client = null;

/** 读取环境变量并去掉首尾空白（Railway 上很容易粘进换行/空格，签名会因此失败） */
function _env(name) {
  const v = process.env[name];
  return v == null ? '' : String(v).trim();
}

/**
 * R2 是否已配置齐全。**每次调用时重新判断**而不是启动时快照：
 * 这样运维在 Railway 上补配环境变量并重启后行为可预期，也方便本地不带凭证跑前端调试。
 */
function isConfigured() {
  return !!(_env('R2_ACCESS_KEY_ID') && _env('R2_SECRET_ACCESS_KEY') && _env('R2_ENDPOINT') && _env('R2_BUCKET'));
}

/** 配置摘要（只暴露是否设置与 bucket 名，绝不输出密钥），供启动日志排查用 */
function describe() {
  return {
    configured: isConfigured(),
    bucket: _env('R2_BUCKET') || null,
    endpoint: _env('R2_ENDPOINT') ? '已设置' : '未设置'
  };
}

function getClient() {
  if (_client) return _client;
  _client = new S3Client({
    // R2 不接受真实 region，官方约定填 auto
    region: 'auto',
    endpoint: _env('R2_ENDPOINT'),
    credentials: {
      accessKeyId: _env('R2_ACCESS_KEY_ID'),
      secretAccessKey: _env('R2_SECRET_ACCESS_KEY')
    },
    // 数据文件都在同一个 bucket，路径风格寻址更直观也更好排查
    forcePathStyle: true
  });
  return _client;
}

// ── 传输层 ───────────────────────────────────────────────────
// readJson/writeJson 统一走这两个入口，好处是测试可以在**不连 R2** 的前提下替换掉
// 整个 IO（见 _setTransportForTests）。⚠️ 注意为什么必须是"注入传输层"而不是在测试里
// 覆盖 r2.readJson：CommonJS 的函数声明是模块作用域绑定，改 exports 上的属性**不影响**
// updateJson 内部对 readJson 的引用，那种打桩会静默失效（这个坑已经踩过一次）。
let _transport = null;

/** 仅供测试注入假 IO；传 null 恢复真实 R2 */
function _setTransportForTests(t) {
  _transport = t || null;
}

async function _getObject(key) {
  if (_transport) return _transport.getObject(key);
  const res = await getClient().send(new GetObjectCommand({ Bucket: _env('R2_BUCKET'), Key: key }));
  let text = '';
  try {
    text = await res.Body.transformToString();
  } catch (e) {
    text = String(res.Body || '');
  }
  return text;
}

async function _putObject(key, body) {
  if (_transport) return _transport.putObject(key, body);
  await getClient().send(new PutObjectCommand({
    Bucket: _env('R2_BUCKET'),
    Key: key,
    Body: body,
    ContentType: 'application/json; charset=utf-8',
    // R2 前面一般挂着 Cloudflare 缓存：显式声明不缓存，避免读到旧统计
    CacheControl: 'no-store'
  }));
}

// ── 只读读取 ─────────────────────────────────────────────────
/**
 * 读取一个 JSON 对象文件。
 *
 * 语义（按需求约定）：**文件不存在时返回 fallback**（读 stats 给 {}、读 comments 给 []），
 * 而不是抛错——首次部署时 R2 上还没有这两个文件是最正常不过的状态。
 *
 * @param {string} key 对象键
 * @param {*} fallback 文件不存在 / 内容为空时返回的值
 * @returns {Promise<*>}
 */
async function readJson(key, fallback) {
  if (!isConfigured()) {
    const e = new Error(MISSING_MSG);
    e.code = 'R2_NOT_CONFIGURED';
    e.status = 503;
    throw e;
  }

  let text;
  try {
    text = await _getObject(key);
  } catch (e) {
    // NoSuchKey / NotFound：文件还没建过，属于正常情况
    const name = e && (e.name || e.Code);
    if (name === 'NoSuchKey' || name === 'NotFound' || (e && e.$metadata && e.$metadata.httpStatusCode === 404)) {
      return fallback;
    }
    const err = new Error('读取 R2 ' + key + ' 失败: ' + (e && e.message ? e.message : '未知错误'));
    err.code = 'R2_READ_FAILED';
    err.status = 502;
    throw err;
  }

  const trimmed = (text || '').trim();
  if (!trimmed) return fallback;

  try {
    const parsed = JSON.parse(trimmed);
    return parsed == null ? fallback : parsed;
  } catch (e) {
    // 文件被写坏（人工编辑出错等）：宁可退回空值让功能可用，也不要让整个卡池 500
    console.error('[R2] ' + key + ' 不是合法 JSON，已按空值处理:', e && e.message);
    return fallback;
  }
}

/** 读取 stats.json（缺失 → {}） */
function readStats() {
  return readJson(STATS_KEY, {});
}

/** 读取 comments.json（缺失 → {}） */
function readComments() {
  return readJson(COMMENTS_KEY, {});
}

// ── 写入 ─────────────────────────────────────────────────────
/**
 * 写入一个 JSON 对象文件（整体覆盖）。
 * @param {string} key 对象键
 * @param {*} value 任意可序列化值
 */
async function writeJson(key, value) {
  if (!isConfigured()) {
    const e = new Error(MISSING_MSG);
    e.code = 'R2_NOT_CONFIGURED';
    e.status = 503;
    throw e;
  }
  try {
    await _putObject(key, JSON.stringify(value, null, 2));
  } catch (e) {
    const err = new Error('写入 R2 ' + key + ' 失败: ' + (e && e.message ? e.message : '未知错误'));
    err.code = 'R2_WRITE_FAILED';
    err.status = 502;
    throw err;
  }
}

function writeStats(stats) {
  return writeJson(STATS_KEY, stats);
}

function writeComments(comments) {
  return writeJson(COMMENTS_KEY, comments);
}

/** 连通性自检（启动日志用）：只做一次 HeadObject，失败也不影响启动 */
async function checkConnection() {
  if (!isConfigured()) return { ok: false, reason: MISSING_MSG };
  try {
    await getClient().send(new HeadObjectCommand({ Bucket: _env('R2_BUCKET'), Key: STATS_KEY }));
    return { ok: true, exists: true };
  } catch (e) {
    const name = e && (e.name || e.Code);
    if (name === 'NoSuchKey' || name === 'NotFound' || (e && e.$metadata && e.$metadata.httpStatusCode === 404)) {
      // 连得上，只是文件还没建 —— 这正是首次部署的正常状态
      return { ok: true, exists: false };
    }
    return { ok: false, reason: e && e.message ? e.message : '未知错误' };
  }
}

// ── 并发保护 ─────────────────────────────────────────────────
// 本服务是单进程（Railway 默认单实例），所以"进程内按对象键串行化"就足以避免
// 「读-改-写」互相覆盖：两次并发评分如果交错执行，后写的会把先写的计数吃掉。
// 文件锁/乐观并发控制（ETag + If-Match）在这里是过度设计，留作多实例时的升级路径。
const _chains = new Map();

/**
 * 把针对同一个 key 的异步任务排成一条串行队列。
 * 前一个任务失败不影响后一个（各自 settle），返回值/异常原样透传给调用方。
 *
 * @param {string} key 串行化键（用对象键即可）
 * @param {() => Promise<*>} fn 临界区任务
 */
function withLock(key, fn) {
  const prev = _chains.get(key) || Promise.resolve();
  const run = prev.then(fn, fn);
  // 队列尾只用于排队，必须吞掉异常，否则一次失败会让后续所有任务被带崩
  _chains.set(key, run.then(() => undefined, () => undefined));
  return run;
}

/**
 * 读最新版本 → 交给 mutator 修改 → 写回。整个「读-改-写」在锁内完成。
 *
 * @param {string} key 对象键
 * @param {*} fallback 文件不存在时的初值
 * @param {(current: *) => {data: *, result: *}} mutator 返回 { data: 要写回的值, result: 给调用方的值 }
 */
async function updateJson(key, fallback, mutator) {
  return withLock(key, async () => {
    // 关键：写之前**重新读一次**最新版本再合并，避免用旧快照覆盖别人的写入
    const current = await readJson(key, fallback);
    const outcome = mutator(current) || {};
    if (outcome.data !== undefined) await writeJson(key, outcome.data);
    return outcome.result;
  });
}

module.exports = {
  STATS_KEY,
  COMMENTS_KEY,
  MISSING_MSG,
  isConfigured,
  describe,
  readJson,
  writeJson,
  readStats,
  writeStats,
  readComments,
  writeComments,
  updateJson,
  checkConnection,
  // 仅供测试：注入假 IO（见 scripts/smoke-cardpool.js）
  _setTransportForTests
};
