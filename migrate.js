// migrate.js - 数据库结构迁移（幂等）
//
// 用法：
//   node migrate.js                # 手动执行（使用 DATABASE_URL_DIRECT 直连串）
//   require('./migrate').runMigrations(pool)   # 服务启动时调用
//
// 说明：服务启动时会自动调用一次（server.js），所以部署时不需要额外跑脚本。
// 迁移刻意使用直连串（去掉 -pooler）：PgBouncer 的 transaction 模式对会话级操作有限制，
// 建表走直连更稳。

'use strict';

const STATEMENTS = [
  // ── 账号 ───────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS accounts (
     id              TEXT PRIMARY KEY,
     username        TEXT UNIQUE NOT NULL,
     nickname        TEXT NOT NULL DEFAULT '',
     password_hash   TEXT NOT NULL,
     salt            TEXT NOT NULL,
     hash_algo       TEXT NOT NULL DEFAULT 'scrypt',
     hash_n          INTEGER NOT NULL DEFAULT 16384,
     hash_r          INTEGER NOT NULL DEFAULT 8,
     hash_p          INTEGER NOT NULL DEFAULT 1,
     is_admin        BOOLEAN NOT NULL DEFAULT FALSE,
     is_test         BOOLEAN NOT NULL DEFAULT TRUE,
     token_version   INTEGER NOT NULL DEFAULT 0,
     legacy_local_id TEXT,
     created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,

  // ── 累计统计（监控页总计） ──────────────────────────────────
  // legacy_total_usage_ms：接入活跃时长之前的老口径「开页时长」历史值，原样保留
  // active_ms：新口径「活跃时长」累计（从 0 开始）
  // 展示总时长时两者相加
  `CREATE TABLE IF NOT EXISTS usage_stats (
     user_id               TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
     legacy_total_usage_ms BIGINT NOT NULL DEFAULT 0,
     active_ms             BIGINT NOT NULL DEFAULT 0,
     prompt_tokens         BIGINT NOT NULL DEFAULT 0,
     completion_tokens     BIGINT NOT NULL DEFAULT 0,
     login_count           INTEGER NOT NULL DEFAULT 0,
     last_login_at         TIMESTAMPTZ,
     last_active_at        TIMESTAMPTZ,
     updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,

  // ── 按天统计（day 由服务端按 Asia/Shanghai 计算） ───────────
  `CREATE TABLE IF NOT EXISTS usage_daily (
     user_id           TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
     day               DATE NOT NULL,
     active_ms         BIGINT NOT NULL DEFAULT 0,
     prompt_tokens     BIGINT NOT NULL DEFAULT 0,
     completion_tokens BIGINT NOT NULL DEFAULT 0,
     login_count       INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (user_id, day)
   )`,

  `CREATE INDEX IF NOT EXISTS usage_daily_day_idx ON usage_daily (day)`,

  // ── 登录/登出事件（监控页"最近活动"用；替代原先落地在临时 JSON 文件里的 logs） ──
  `CREATE TABLE IF NOT EXISTS login_events (
     id         SERIAL PRIMARY KEY,
     user_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
     username   TEXT NOT NULL,
     action     TEXT NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,

  `CREATE INDEX IF NOT EXISTS login_events_created_idx ON login_events (created_at)`,

  // ── 等级 / 经验（跨设备同步 + 评论里显示他人等级） ──────────
  // 背景：等级原先只存在**浏览器本地**（localStorage 的 user_level_{userId}），
  // 于是"评论里显示评论者等级"这件事根本做不到 —— 别人的等级在你的浏览器里不存在。
  // 现在把等级同步到服务端，成为账号属性（与 nickname 同级）。
  //
  // 为什么用 ALTER 而不是写进上面的 CREATE TABLE：
  // 线上库已经建好了 accounts 表，CREATE TABLE IF NOT EXISTS 不会再加列，
  // 所以必须用 ADD COLUMN IF NOT EXISTS 做增量迁移（幂等，可重复执行）。
  //
  // 注：默认 1 级是"普通账号"的起点；管理员沿用历史行为（15 级）由
  // accounts.ensureAdminAccount 在创建时显式写入，不靠默认值。
  //
  // ⚠️ 这里刻意不加 CHECK 约束：加约束需要 PL/pgSQL 的 DO 块，而本地冒烟测试用的
  // pg-mem 不支持匿名块。越界由接口层夹取（server.js 里把 level 限制在 0~999），
  // 属于"可信输入 + 服务端兜底"，不依赖数据库约束。
  `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS level INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS xp INTEGER NOT NULL DEFAULT 0`
];

/**
 * 执行迁移
 * @param {{ query: Function }} pool 任意兼容 pg 的连接池（便于用 pg-mem 做本地测试）
 */
async function runMigrations(pool) {
  if (!pool) throw new Error('[Migrate] 缺少数据库连接池');
  for (const sql of STATEMENTS) {
    await pool.query(sql);
  }
}

module.exports = { runMigrations: runMigrations, STATEMENTS: STATEMENTS };

// ── 作为脚本直接执行：node migrate.js ─────────────────────────
if (require.main === module) {
  const db = require('./db');
  const conn = db.directConnectionString;
  if (!conn) {
    console.error('[Migrate] 未配置 DATABASE_URL / DATABASE_URL_DIRECT，无法迁移');
    process.exit(1);
  }
  const pool = db.createPool(conn);
  runMigrations(pool)
    .then(() => {
      console.log('[Migrate] 迁移完成');
      return pool.end();
    })
    .catch((err) => {
      console.error('[Migrate] 迁移失败:', err && err.message);
      pool.end().finally(() => process.exit(1));
    });
}
