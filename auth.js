// auth.js - 密码哈希 与 登录 token 签发/校验
//
// 设计要点：
// 1) 密码用 scrypt（故意慢，抗暴力破解）+ 每账号独立随机 salt，数据库里只存
//    salt 与 hash，永不存明文；校验用 timingSafeEqual，避免时序侧信道。
// 2) scrypt 走**异步** API：同步版会阻塞事件循环几十毫秒，正好卡住正在流式输出的对话。
// 3) token 是 HMAC-SHA256 签名的无状态凭据，payload 含 sub(账号id)/iat/exp/ver：
//    - exp：有效期（默认 7 天，TOKEN_TTL_DAYS 可配）
//    - ver：与 accounts.token_version 比对，管理员改密码时 +1 即可让所有旧 token 立刻失效
// 4) AUTH_SECRET 只在服务端保存：优先环境变量，本地开发兜底 data/secrets.json。
//    生产环境缺失时直接拒绝启动（否则会用临时密钥签出重启即失效的 token）。

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ── scrypt 参数 ──────────────────────────────────────────────
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

// ── 密码规则 ─────────────────────────────────────────────────
const PASSWORD_MIN_LENGTH = 6;
const PASSWORD_MAX_LENGTH = 128;
const USERNAME_MIN_LENGTH = 2;
const USERNAME_MAX_LENGTH = 24;

// ── token 有效期 ─────────────────────────────────────────────
const DEFAULT_TOKEN_TTL_DAYS = 7;

const SECRETS_FILE = path.join(__dirname, 'data', 'secrets.json');

let _authSecret = null;
let _secretIsEphemeral = false;

function _readSecretsFile() {
  try {
    if (!fs.existsSync(SECRETS_FILE)) return {};
    const raw = JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8'));
    return (raw && typeof raw === 'object') ? raw : {};
  } catch (e) {
    console.warn('[Auth] 读取 data/secrets.json 失败:', e && e.message);
    return {};
  }
}

/**
 * 初始化 AUTH_SECRET。必须在服务启动时调用一次。
 * @returns {{ ok: boolean, ephemeral: boolean, reason?: string }}
 */
function initAuthSecret() {
  if (_authSecret) return { ok: true, ephemeral: _secretIsEphemeral };

  const fromEnv = process.env.AUTH_SECRET ? String(process.env.AUTH_SECRET).trim() : '';
  if (fromEnv) {
    _authSecret = fromEnv;
    _secretIsEphemeral = false;
    return { ok: true, ephemeral: false };
  }

  const fromFile = _readSecretsFile().AUTH_SECRET;
  if (fromFile) {
    _authSecret = String(fromFile).trim();
    _secretIsEphemeral = false;
    return { ok: true, ephemeral: false };
  }

  if (process.env.NODE_ENV === 'production') {
    return { ok: false, ephemeral: false, reason: '生产环境必须配置 AUTH_SECRET（否则登录态无法在多实例/重启后保持有效）' };
  }

  // 开发/未配置生产环境标识：生成临时密钥，保证能跑起来，但重启后旧 token 全部失效
  _authSecret = crypto.randomBytes(32).toString('hex');
  _secretIsEphemeral = true;
  return { ok: true, ephemeral: true, reason: '未配置 AUTH_SECRET，已生成临时密钥（服务重启后所有登录态失效）' };
}

function _secret() {
  if (!_authSecret) initAuthSecret();
  if (!_authSecret) throw new Error('AUTH_SECRET 未配置');
  return _authSecret;
}

// ── 密码哈希 ─────────────────────────────────────────────────

function _scryptAsync(password, salt, N, r, p, keylen) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, { N: N, r: r, p: p, maxmem: SCRYPT_MAXMEM }, (err, derivedKey) => {
      if (err) reject(err); else resolve(derivedKey);
    });
  });
}

/**
 * 生成新密码的哈希材料（不返回明文）
 * @param {string} password
 * @returns {Promise<{salt:string, hash:string, algo:string, n:number, r:number, p:number}>}
 */
async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const dk = await _scryptAsync(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P, SCRYPT_KEYLEN);
  return {
    salt: salt,
    hash: dk.toString('hex'),
    algo: 'scrypt',
    n: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P
  };
}

/**
 * 校验密码是否匹配数据库中的哈希记录
 * @param {string} password 明文密码
 * @param {{salt:string, password_hash:string, hash_n?:number, hash_r?:number, hash_p?:number}} accountRow
 * @returns {Promise<boolean>}
 */
async function verifyPassword(password, accountRow) {
  if (!password || !accountRow || !accountRow.salt || !accountRow.password_hash) return false;
  const storedHex = String(accountRow.password_hash);
  let stored;
  try {
    stored = Buffer.from(storedHex, 'hex');
  } catch (e) {
    return false;
  }
  if (!stored.length) return false;

  const N = Number(accountRow.hash_n) || SCRYPT_N;
  const r = Number(accountRow.hash_r) || SCRYPT_R;
  const p = Number(accountRow.hash_p) || SCRYPT_P;

  let derived;
  try {
    derived = await _scryptAsync(password, String(accountRow.salt), N, r, p, stored.length);
  } catch (e) {
    console.error('[Auth] scrypt 校验失败:', e && e.message);
    return false;
  }
  // timingSafeEqual 要求等长，长度不等直接判失败
  if (derived.length !== stored.length) return false;
  return crypto.timingSafeEqual(derived, stored);
}

// ── 用户名/密码格式校验 ───────────────────────────────────────

/**
 * @returns {{ ok: boolean, message?: string, username?: string, password?: string }}
 */
function validateCredentials(username, password) {
  const u = String(username == null ? '' : username).trim();
  const p = String(password == null ? '' : password);
  if (!u || !p) return { ok: false, message: '用户名和密码不能为空' };
  if (u.length < USERNAME_MIN_LENGTH || u.length > USERNAME_MAX_LENGTH) {
    return { ok: false, message: `用户名长度需在 ${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH} 个字符之间` };
  }
  if (!/^[\w\u4e00-\u9fa5.-]+$/.test(u)) {
    return { ok: false, message: '用户名只能包含中英文、数字、下划线、点或短横线' };
  }
  if (p.length < PASSWORD_MIN_LENGTH || p.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, message: `密码长度需在 ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} 个字符之间` };
  }
  return { ok: true, username: u, password: p };
}

// ── token 签发 / 校验 ────────────────────────────────────────

function tokenTtlMs() {
  const days = Number(process.env.TOKEN_TTL_DAYS);
  const d = (Number.isFinite(days) && days >= 0) ? days : DEFAULT_TOKEN_TTL_DAYS;
  return d * 24 * 60 * 60 * 1000;
}

/**
 * 签发 token
 * @param {{ id: string, username: string, token_version?: number }} account
 */
function signToken(account) {
  const now = Date.now();
  const payload = {
    sub: account.id,
    username: account.username,
    ver: Number(account.token_version) || 0,
    iat: now,
    exp: now + tokenTtlMs()
  };
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', _secret()).update(data).digest('base64url');
  return data + '.' + sig;
}

/**
 * 校验 token 的签名与有效期（不查库）
 * @returns {object|null} payload，失败返回 null
 */
function verifyToken(token) {
  if (typeof token !== 'string' || !token) return null;
  const idx = token.lastIndexOf('.');
  if (idx <= 0) return null;
  const data = token.slice(0, idx);
  const sig = token.slice(idx + 1);

  let expected;
  try {
    expected = crypto.createHmac('sha256', _secret()).update(data).digest('base64url');
  } catch (e) {
    return null;
  }

  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  } catch (e) {
    return null;
  }
  if (!payload || typeof payload.sub !== 'string') return null;
  if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
  return payload;
}

/**
 * 从请求里取出 Bearer token
 */
function extractBearer(req) {
  const raw = (req && req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  const m = /^Bearer\s+(.+)$/i.exec(String(raw).trim());
  return m ? m[1].trim() : '';
}

module.exports = {
  initAuthSecret: initAuthSecret,
  hashPassword: hashPassword,
  verifyPassword: verifyPassword,
  validateCredentials: validateCredentials,
  signToken: signToken,
  verifyToken: verifyToken,
  extractBearer: extractBearer,
  tokenTtlMs: tokenTtlMs,
  constants: {
    PASSWORD_MIN_LENGTH: PASSWORD_MIN_LENGTH,
    PASSWORD_MAX_LENGTH: PASSWORD_MAX_LENGTH,
    USERNAME_MIN_LENGTH: USERNAME_MIN_LENGTH,
    USERNAME_MAX_LENGTH: USERNAME_MAX_LENGTH,
    SCRYPT_N: SCRYPT_N,
    SCRYPT_R: SCRYPT_R,
    SCRYPT_P: SCRYPT_P
  }
};
