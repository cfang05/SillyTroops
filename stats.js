// stats.js - 使用统计（登录次数 / 活跃时长 / token 用量）数据访问层
//
// 迁移背景：原先统计存在 data/stats.json（Railway 临时文件系统，重启即清空）且
// 身份字段由客户端上报（可伪造）。现在统一入库：
//   - 身份来自签名 token（服务端解析），不接受请求体里的 userId/isAdmin/isTest
//   - 累计值写 usage_stats；按天维度写 usage_daily（day = Asia/Shanghai 的日历日）
//
// 时长口径：
//   legacy_total_usage_ms 老口径（页面开着就算）的历史值，原样保留
//   active_ms             新口径「活跃时长」（前端上报增量，服务端夹取上限）
//   展示总时长 = 两者相加

'use strict';

const fs = require('fs');

/** 单次上报的活跃时长上限（前端每 30s 结算一次，这里给足余量但仍设上限，防伪造刷时长） */
const MAX_ACTIVE_DELTA_MS = 120 * 1000;

/** 单次上报的 token 上限（防止一次请求把统计刷爆） */
const MAX_TOKENS_PER_REPORT = 2 * 1000 * 1000;

/**
 * 计算某时刻对应的 Asia/Shanghai 日历日（YYYY-MM-DD）。
 * 用固定 +8 偏移，不依赖服务器本地时区（Railway 容器通常是 UTC）。
 */
function shanghaiDay(date) {
  const d = date ? new Date(date) : new Date();
  const shifted = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

/** 确保 usage_stats 里存在该用户的行 */
async function ensureRow(pool, userId) {
  await pool.query(
    'INSERT INTO usage_stats (user_id, updated_at) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING',
    [userId, new Date()]
  );
}

/** 记录一次登录 */
async function recordLogin(pool, userId) {
  const now = new Date();
  await ensureRow(pool, userId);
  await pool.query(
    `UPDATE usage_stats
        SET login_count = login_count + 1, last_login_at = $2, updated_at = $2
      WHERE user_id = $1`,
    [userId, now]
  );
  await _bumpDaily(pool, userId, { loginCount: 1 }, now);
}

/**
 * 记录一段活跃时长
 * @param {number} deltaMs 本次新增的活跃毫秒（会被夹取到 [0, MAX_ACTIVE_DELTA_MS]）
 * @returns {Promise<number>} 实际记录的毫秒数
 */
async function recordActive(pool, userId, deltaMs) {
  const raw = Number(deltaMs);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  const delta = Math.min(Math.round(raw), MAX_ACTIVE_DELTA_MS);
  const now = new Date();
  await ensureRow(pool, userId);
  await pool.query(
    `UPDATE usage_stats
        SET active_ms = active_ms + $2, last_active_at = $3, updated_at = $3
      WHERE user_id = $1`,
    [userId, delta, now]
  );
  await _bumpDaily(pool, userId, { activeMs: delta }, now);
  return delta;
}

/** 记录一次对话的 token 估算用量 */
async function recordTokens(pool, userId, promptTokens, completionTokens) {
  const p = Math.min(Math.max(0, Math.round(Number(promptTokens) || 0)), MAX_TOKENS_PER_REPORT);
  const c = Math.min(Math.max(0, Math.round(Number(completionTokens) || 0)), MAX_TOKENS_PER_REPORT);
  if (!p && !c) return;
  const now = new Date();
  await ensureRow(pool, userId);
  await pool.query(
    `UPDATE usage_stats
        SET prompt_tokens = prompt_tokens + $2, completion_tokens = completion_tokens + $3, updated_at = $4
      WHERE user_id = $1`,
    [userId, p, c, now]
  );
  await _bumpDaily(pool, userId, { promptTokens: p, completionTokens: c }, now);
}

/**
 * 导入老本地账号的历史用量（迁移前账号存在浏览器里，统计也只在本地）。
 *
 * 一律用 GREATEST 取值：重复导入不会翻倍，只增不减，因此可以安全地多次调用。
 * 只作用于传入的 userId（服务端从 token 取），客户端无法给他人导入。
 *
 * @param {{legacyTotalUsageMs?:number, prompt?:number, completion?:number, loginCount?:number}} data
 * @returns {Promise<boolean>} 是否写入了数据
 */
async function importLegacyStats(pool, userId, data) {
  const d = data || {};
  const legacyMs = Math.max(0, Math.round(Number(d.legacyTotalUsageMs) || 0));
  const prompt = Math.min(Math.max(0, Math.round(Number(d.prompt) || 0)), MAX_TOKENS_PER_REPORT);
  const completion = Math.min(Math.max(0, Math.round(Number(d.completion) || 0)), MAX_TOKENS_PER_REPORT);
  const logins = Math.max(0, Math.round(Number(d.loginCount) || 0));
  if (!legacyMs && !prompt && !completion && !logins) return false;

  await ensureRow(pool, userId);
  await pool.query(
    `UPDATE usage_stats
        SET legacy_total_usage_ms = GREATEST(legacy_total_usage_ms, $2),
            prompt_tokens         = GREATEST(prompt_tokens, $3),
            completion_tokens     = GREATEST(completion_tokens, $4),
            login_count           = GREATEST(login_count, $5),
            updated_at            = $6
      WHERE user_id = $1`,
    [userId, legacyMs, prompt, completion, logins, new Date()]
  );
  return true;
}

/** usage_daily 累加（按 Asia/Shanghai 的日期） */
async function _bumpDaily(pool, userId, delta, when) {
  const day = shanghaiDay(when);
  await pool.query(
    `INSERT INTO usage_daily (user_id, day, active_ms, prompt_tokens, completion_tokens, login_count)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, day) DO UPDATE SET
       active_ms         = usage_daily.active_ms + EXCLUDED.active_ms,
       prompt_tokens     = usage_daily.prompt_tokens + EXCLUDED.prompt_tokens,
       completion_tokens = usage_daily.completion_tokens + EXCLUDED.completion_tokens,
       login_count       = usage_daily.login_count + EXCLUDED.login_count`,
    [
      userId,
      day,
      Math.max(0, Math.round(delta.activeMs || 0)),
      Math.max(0, Math.round(delta.promptTokens || 0)),
      Math.max(0, Math.round(delta.completionTokens || 0)),
      Math.max(0, Math.round(delta.loginCount || 0))
    ]
  );
}

/**
 * 记录一条登录/登出事件（监控页"最近活动"数据源）
 * @param {'login'|'logout'} action
 */
async function recordEvent(pool, userId, username, action) {
  await pool.query(
    'INSERT INTO login_events (user_id, username, action, created_at) VALUES ($1, $2, $3, $4)',
    [userId, String(username || ''), String(action || ''), new Date()]
  );
}

/** 最近事件（倒序） */
async function getRecentEvents(pool, limit) {
  const n = Math.min(Math.max(1, Number(limit) || 200), 500);
  const res = await pool.query(
    `SELECT user_id, username, action, created_at
       FROM login_events
      ORDER BY created_at DESC
      LIMIT ${n}`
  );
  return res.rows.map((r) => ({
    userId: r.user_id,
    username: r.username,
    action: r.action,
    timestamp: r.created_at ? new Date(r.created_at).getTime() : null
  }));
}

/**
 * 账号 + 累计统计的合并列表（监控页数据源）
 * 总时长 = legacy_total_usage_ms + active_ms
 */
async function getSummary(pool) {
  const res = await pool.query(
    `SELECT a.id, a.username, a.nickname, a.is_admin, a.is_test, a.created_at,
            COALESCE(s.legacy_total_usage_ms, 0) AS legacy_total_usage_ms,
            COALESCE(s.active_ms, 0)             AS active_ms,
            COALESCE(s.prompt_tokens, 0)         AS prompt_tokens,
            COALESCE(s.completion_tokens, 0)     AS completion_tokens,
            COALESCE(s.login_count, 0)           AS login_count,
            s.last_login_at, s.last_active_at
       FROM accounts a
       LEFT JOIN usage_stats s ON s.user_id = a.id
      ORDER BY a.created_at ASC`
  );
  return res.rows.map((r) => ({
    userId: r.id,
    username: r.username,
    nickname: r.nickname || '',
    isAdmin: !!r.is_admin,
    isTest: !!r.is_test,
    canUseTestApi: !!(r.is_admin || r.is_test),
    createdAt: r.created_at ? new Date(r.created_at).getTime() : null,
    legacyTotalUsageMs: Number(r.legacy_total_usage_ms) || 0,
    activeMs: Number(r.active_ms) || 0,
    totalUsageTime: (Number(r.legacy_total_usage_ms) || 0) + (Number(r.active_ms) || 0),
    tokenUsage: {
      prompt: Number(r.prompt_tokens) || 0,
      completion: Number(r.completion_tokens) || 0,
      total: (Number(r.prompt_tokens) || 0) + (Number(r.completion_tokens) || 0)
    },
    loginCount: Number(r.login_count) || 0,
    lastLoginAt: r.last_login_at ? new Date(r.last_login_at).getTime() : null,
    lastActiveAt: r.last_active_at ? new Date(r.last_active_at).getTime() : null
  }));
}

/**
 * 按天查询（后续按天筛选用）
 * @param {{ userId?: string, from?: string, to?: string, limit?: number }} options
 */
async function getDaily(pool, options) {
  const opts = options || {};
  const params = [];
  const where = [];
  if (opts.userId) { params.push(opts.userId); where.push(`user_id = $${params.length}`); }
  if (opts.from) { params.push(opts.from); where.push(`day >= $${params.length}`); }
  if (opts.to) { params.push(opts.to); where.push(`day <= $${params.length}`); }
  const limit = Math.min(Math.max(1, Number(opts.limit) || 90), 366);
  const sql = `SELECT user_id, day, active_ms, prompt_tokens, completion_tokens, login_count
                 FROM usage_daily
                ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                ORDER BY day DESC, user_id ASC
                LIMIT ${limit}`;
  const res = await pool.query(sql, params);
  return res.rows.map((r) => ({
    userId: r.user_id,
    day: typeof r.day === 'string' ? r.day : shanghaiDay(r.day),
    activeMs: Number(r.active_ms) || 0,
    promptTokens: Number(r.prompt_tokens) || 0,
    completionTokens: Number(r.completion_tokens) || 0,
    loginCount: Number(r.login_count) || 0
  }));
}

/**
 * 一次性把历史 data/stats.json 的累计用量导入数据库（best-effort）。
 * 只对「数据库中已存在同 id 账号」的记录生效；已有的 legacy 值不会被覆盖成更小的值。
 * @param {string} filePath
 * @returns {Promise<{imported:number, skipped:number}>}
 */
async function importLegacyStatsFile(pool, filePath) {
  let raw;
  try {
    if (!fs.existsSync(filePath)) return { imported: 0, skipped: 0 };
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.warn('[Stats] 读取历史 stats.json 失败（忽略）:', e && e.message);
    return { imported: 0, skipped: 0 };
  }
  const users = (raw && raw.users) || {};
  let imported = 0;
  let skipped = 0;
  for (const userId of Object.keys(users)) {
    const u = users[userId] || {};
    const legacyMs = Number(u.totalUsageTime) || 0;
    const prompt = Number(u.tokenUsage && u.tokenUsage.prompt) || 0;
    const completion = Number(u.tokenUsage && u.tokenUsage.completion) || 0;
    const logins = Number(u.loginCount) || 0;
    try {
      const res = await pool.query('SELECT id FROM accounts WHERE id = $1', [userId]);
      if (!res.rows.length) { skipped++; continue; }
      await ensureRow(pool, userId);
      await pool.query(
        `UPDATE usage_stats
            SET legacy_total_usage_ms = GREATEST(legacy_total_usage_ms, $2),
                prompt_tokens         = GREATEST(prompt_tokens, $3),
                completion_tokens     = GREATEST(completion_tokens, $4),
                login_count           = GREATEST(login_count, $5),
                updated_at            = $6
          WHERE user_id = $1`,
        [userId, legacyMs, prompt, completion, logins, new Date()]
      );
      imported++;
    } catch (e) {
      skipped++;
    }
  }
  if (imported || skipped) {
    console.log(`[Stats] 历史 stats.json 导入完成：成功 ${imported}，跳过 ${skipped}`);
  }
  return { imported: imported, skipped: skipped };
}

module.exports = {
  MAX_ACTIVE_DELTA_MS: MAX_ACTIVE_DELTA_MS,
  shanghaiDay: shanghaiDay,
  ensureRow: ensureRow,
  recordLogin: recordLogin,
  recordActive: recordActive,
  recordTokens: recordTokens,
  recordEvent: recordEvent,
  getRecentEvents: getRecentEvents,
  importLegacyStats: importLegacyStats,
  getSummary: getSummary,
  getDaily: getDaily,
  importLegacyStatsFile: importLegacyStatsFile
};
