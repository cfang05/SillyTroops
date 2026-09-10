// accounts.js - 账号数据访问层（Neon Postgres）
//
// 只负责「表操作」，不涉及 HTTP；server.js 里的路由调用这里，
// 本地测试可以用 pg-mem 的 pool 直接驱动（依赖注入）。
//
// 关键约定：
// - id 保持字符串格式（user_xxx），与前端 scopedKey() 拼接的历史存储键保持一致，
//   迁移后用户已有的 API Key / 角色卡 / 会话等本地数据不会失联。
// - 数据库只保存 salt + password_hash；明文密码永不落库、永不返回给前端。
// - is_test 是数据库里的原始标记；「能不能用内置测试 API」= is_admin || is_test，
//   接口里以 canUseTestApi 单独返回，避免前端再次混用两个概念。

'use strict';

const crypto = require('crypto');
const auth = require('./auth');

/** 账号公开字段（永远不要 SELECT 出 password_hash 给接口层用） */
const PUBLIC_COLUMNS = 'id, username, nickname, is_admin, is_test, token_version, legacy_local_id, created_at';

/** 生成与历史格式一致的字符串 id：user_<base36 时间戳><6位随机> */
function generateUserId() {
  return 'user_' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
}

/**
 * 数据库行 -> 接口返回的用户对象（脱敏 + 语义清晰）
 * @param {object} row
 */
function toPublicUser(row) {
  if (!row) return null;
  const isAdmin = !!row.is_admin;
  const isTest = !!row.is_test;
  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname || '',
    isAdmin: isAdmin,
    isTest: isTest,                  // 数据库里的原始标记（监控页开关用）
    canUseTestApi: isAdmin || isTest // 「能用内置测试 API」的最终判定
  };
}

async function findByUsername(pool, username) {
  const res = await pool.query('SELECT * FROM accounts WHERE username = $1', [String(username || '').trim()]);
  return res.rows[0] || null;
}

async function findById(pool, id) {
  if (!id) return null;
  const res = await pool.query('SELECT * FROM accounts WHERE id = $1', [id]);
  return res.rows[0] || null;
}

async function findByLegacyLocalId(pool, legacyLocalId) {
  if (!legacyLocalId) return null;
  const res = await pool.query('SELECT * FROM accounts WHERE legacy_local_id = $1', [legacyLocalId]);
  return res.rows[0] || null;
}

/**
 * 创建账号
 * @param {object} pool
 * @param {{username:string, password:string, nickname?:string, isAdmin?:boolean, isTest?:boolean, legacyLocalId?:string, id?:string}} data
 */
async function createAccount(pool, data) {
  const hashed = await auth.hashPassword(data.password);
  const id = data.id || generateUserId();
  const now = new Date();
  const res = await pool.query(
    `INSERT INTO accounts
       (id, username, nickname, password_hash, salt, hash_algo, hash_n, hash_r, hash_p,
        is_admin, is_test, token_version, legacy_local_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,$12,$13,$14)
     RETURNING *`,
    [
      id,
      String(data.username || '').trim(),
      data.nickname || '',
      hashed.hash,
      hashed.salt,
      hashed.algo,
      hashed.n,
      hashed.r,
      hashed.p,
      !!data.isAdmin,
      // 决策：注册即测试账号（默认 TRUE）。要关闭只改这一个默认值。
      data.isTest === undefined ? true : !!data.isTest,
      data.legacyLocalId || null,
      now,
      now
    ]
  );
  return res.rows[0];
}

/** 更新昵称（跨设备同步用） */
async function updateNickname(pool, id, nickname) {
  const res = await pool.query(
    'UPDATE accounts SET nickname = $2, updated_at = $3 WHERE id = $1 RETURNING *',
    [id, String(nickname == null ? '' : nickname).slice(0, 40), new Date()]
  );
  return res.rows[0] || null;
}

/** 管理员开关某个账号的测试权限 */
async function setTestFlag(pool, id, isTest) {
  const res = await pool.query(
    'UPDATE accounts SET is_test = $2, updated_at = $3 WHERE id = $1 RETURNING *',
    [id, !!isTest, new Date()]
  );
  return res.rows[0] || null;
}

/** 改密码（目前只用于 admin 按 ADMIN_INITIAL_PASSWORD 对齐；会同时让旧 token 全部失效） */
async function setPassword(pool, id, password) {
  const hashed = await auth.hashPassword(password);
  const res = await pool.query(
    `UPDATE accounts
        SET password_hash = $2, salt = $3, hash_algo = $4, hash_n = $5, hash_r = $6, hash_p = $7,
            token_version = token_version + 1, updated_at = $8
      WHERE id = $1
      RETURNING *`,
    [id, hashed.hash, hashed.salt, hashed.algo, hashed.n, hashed.r, hashed.p, new Date()]
  );
  return res.rows[0] || null;
}

/** 账号是否已存在（用户名唯一性检查） */
async function usernameExists(pool, username) {
  const res = await pool.query('SELECT 1 FROM accounts WHERE username = $1', [String(username || '').trim()]);
  return res.rows.length > 0;
}

async function listAccounts(pool) {
  const res = await pool.query(`SELECT ${PUBLIC_COLUMNS} FROM accounts ORDER BY created_at ASC`);
  return res.rows;
}

async function countAccounts(pool) {
  const res = await pool.query('SELECT COUNT(*)::int AS n FROM accounts');
  return res.rows[0] ? res.rows[0].n : 0;
}

/**
 * 确保 admin 账号存在，并按 ADMIN_INITIAL_PASSWORD 幂等对齐密码。
 *
 * 规则（已与需求方确认）：
 *  1. 库里没有 admin + 变量已设置      -> 创建，密码 = 变量值
 *  2. 库里没有 admin + 变量未设置      -> 仍然创建（账号必须长期存在），
 *                                        密码写随机不可用值，仅"无法登录"
 *  3. 库里已有 admin + 变量已设置      -> 幂等对齐：变量值就是密码值，
 *                                        不一致则重写哈希并 token_version+1（旧 token 立即失效）
 *  4. 库里已有 admin + 变量未设置      -> 保留原哈希不动（避免配置事故把管理员锁死）
 *
 * @returns {Promise<{created:boolean, aligned:boolean, canLogin:boolean}>}
 */
async function ensureAdminAccount(pool, initialPassword) {
  const password = initialPassword == null ? '' : String(initialPassword);
  const hasPasswordSource = password.trim().length > 0;
  const existing = await findByUsername(pool, 'admin');

  if (!existing) {
    const effectivePassword = hasPasswordSource ? password : crypto.randomBytes(32).toString('hex');
    await createAccount(pool, {
      username: 'admin',
      password: effectivePassword,
      nickname: '管理员',
      isAdmin: true,
      isTest: true
    });
    if (hasPasswordSource) {
      console.log('[Auth] 已创建 admin 账号（密码取自 ADMIN_INITIAL_PASSWORD）');
      return { created: true, aligned: false, canLogin: true };
    }
    console.warn('[Auth] 未配置 ADMIN_INITIAL_PASSWORD：admin 账号已创建但密码为随机不可用值，当前无法登录');
    return { created: true, aligned: false, canLogin: false };
  }

  if (!hasPasswordSource) {
    console.warn('[Auth] 未配置 ADMIN_INITIAL_PASSWORD：保留 admin 现有密码不变');
    return { created: false, aligned: false, canLogin: true };
  }

  const matches = await auth.verifyPassword(password, existing);
  if (matches) {
    return { created: false, aligned: false, canLogin: true };
  }

  await setPassword(pool, existing.id, password);
  console.log('[Auth] admin 密码已按 ADMIN_INITIAL_PASSWORD 对齐，旧登录态（token）已全部失效');
  return { created: false, aligned: true, canLogin: true };
}

module.exports = {
  PUBLIC_COLUMNS: PUBLIC_COLUMNS,
  generateUserId: generateUserId,
  toPublicUser: toPublicUser,
  findByUsername: findByUsername,
  findById: findById,
  findByLegacyLocalId: findByLegacyLocalId,
  createAccount: createAccount,
  updateNickname: updateNickname,
  setTestFlag: setTestFlag,
  setPassword: setPassword,
  usernameExists: usernameExists,
  listAccounts: listAccounts,
  countAccounts: countAccounts,
  ensureAdminAccount: ensureAdminAccount
};
