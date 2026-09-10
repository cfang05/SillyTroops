// db.js - PostgreSQL（Neon）连接池
//
// 用途：账号体系与统计数据从「本地 localStorage / 临时 JSON 文件」迁移到 Neon Postgres 后，
// 所有数据库访问统一走这里的连接池。
//
// 连接串来源：
//   DATABASE_URL        —— 应用运行时使用（Neon 的 -pooler 池化端点，PgBouncer 复用连接）
//   DATABASE_URL_DIRECT —— 迁移/建表使用（去掉 -pooler 的直连端点，避免 PgBouncer
//                          transaction 模式对会话级操作的限制）
//
// 未配置 DATABASE_URL 时（例如本地只调试测试通道），服务照常启动，
// 只是账号相关接口返回 503，不阻塞其他功能。

'use strict';

const { Pool } = require('pg');

/**
 * 规范化连接串：
 * 1) 去掉 channel_binding 参数 —— node-postgres 对 channel binding 支持不佳，
 *    带上它可能出现握手报错（sslmode=require 已足以保证加密）。
 * 2) 非本地地址未显式声明 sslmode 时补 sslmode=require（Neon 必须走 SSL）。
 */
function normalizeConnectionString(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    u.searchParams.delete('channel_binding');
    const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(u.hostname);
    if (!isLocal && !u.searchParams.has('sslmode')) u.searchParams.set('sslmode', 'require');
    return u.toString();
  } catch (e) {
    // 不是标准 URL（例如 key=value 形式），原样返回交给 pg 解析
    return s;
  }
}

const RUNTIME_URL = normalizeConnectionString(process.env.DATABASE_URL);
const DIRECT_URL = normalizeConnectionString(process.env.DATABASE_URL_DIRECT) || RUNTIME_URL;

/** 是否配置了数据库（未配置时账号/统计接口返回 503，其余功能不受影响） */
function isConfigured() {
  return !!pool;
}

function createPool(connectionString, options) {
  const pool = new Pool(Object.assign({
    connectionString: connectionString,
    // Neon 免费版连接数有限：池子开小一点，避免超限
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  }, options || {}));
  pool.on('error', (err) => {
    // 空闲连接被数据库/网络切断时的兜底，避免进程因未捕获异常退出
    console.error('[DB] 空闲连接出错:', err && err.message);
  });
  return pool;
}

let pool = null;
if (RUNTIME_URL) {
  pool = createPool(RUNTIME_URL);
} else {
  console.warn('[DB] 未配置 DATABASE_URL：账号与统计功能不可用（其余功能正常）');
}

/**
 * 执行一条 SQL
 * @param {string} text SQL 文本（使用 $1/$2 占位符）
 * @param {Array} [params] 参数数组
 */
function query(text, params) {
  if (!pool) return Promise.reject(new Error('数据库未配置（缺少 DATABASE_URL）'));
  return pool.query(text, params);
}

/**
 * 启动预热：Neon 免费版会自动休眠，第一条查询可能需要 1~3 秒。
 * 这里在启动阶段先打一次 SELECT 1，把冷启动代价挪到部署阶段，而不是用户第一次登录时。
 */
async function warmup() {
  if (!pool) return false;
  const started = Date.now();
  try {
    await pool.query('SELECT 1');
    console.log(`[DB] 连接正常（预热耗时 ${Date.now() - started}ms）`);
    return true;
  } catch (e) {
    console.error('[DB] 预热失败:', e && e.message);
    return false;
  }
}

async function close() {
  if (pool) await pool.end();
}

/**
 * 测试钩子：注入一个自建连接池（例如 pg-mem 的内存实现），
 * 用于在没有真实 Postgres 的环境下跑接口级冒烟测试。生产代码不要调用。
 */
function setPoolForTesting(testPool) {
  pool = testPool;
}

module.exports = {
  normalizeConnectionString: normalizeConnectionString,
  createPool: createPool,
  isConfigured: isConfigured,
  query: query,
  warmup: warmup,
  close: close,
  setPoolForTesting: setPoolForTesting,
  directConnectionString: DIRECT_URL,
  getPool: function () { return pool; }
};
