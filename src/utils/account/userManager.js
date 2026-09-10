// src/utils/account/userManager.js
// 账号体系（服务端 Neon Postgres）+ 本地会话缓存
//
// 迁移说明（重要）：
//   旧实现把账号（含**明文密码**）存在浏览器 localStorage，并在每个浏览器本地播种
//   admin/admin123 与 test01~test05 的固定密码——任何人 F12 就能拿到，等于人人可当管理员。
//   现在账号、密码哈希、权限（is_admin/is_test）全部由服务端持有：
//     - 密码只在服务端以 scrypt + 每账号 salt 存储，前端从不保存密码
//     - 登录成功只保存签名 token 与脱敏后的用户信息
//     - 「能不能用内置测试 API」由服务端按数据库判定，前端只是显示
//
// 本地仍然保存的东西（业务数据，按 u_{userId}_ 前缀隔离，不随本次迁移改变）：
//   角色卡、会话、预设、正则、人格、作者注、等级、用户自配的 API Key 等。
//   因此必须继续保留 sillytroops_current_user_id，scopedKey() 依赖它。
//
// 兼容性：对外导出的函数名与调用约定保持不变（login/register 变为 async）。

'use strict';

import { scopedKey } from './userScope.js';

// ── 存储键 ───────────────────────────────────────────────────
var CURRENT_USER_KEY = 'sillytroops_current_user_id';   // 保留：scopedKey() 依赖
var AUTH_TOKEN_KEY = 'sillytroops_auth_token';          // 服务端签发的 token
var PROFILE_KEY = 'sillytroops_current_user';           // 脱敏后的用户信息（无密码）
var LOGIN_LOGS_KEY = 'sillytroops_login_logs';          // 本地登录日志（离线兜底）
var LOCAL_STATS_KEY = 'sillytroops_local_usage';        // 本地用量缓存（离线兜底）
var LEGACY_USERS_KEY = 'sillytroops_users';             // 旧账号表（仅用于一次性认领，认领后删除）

// 活跃时长追踪（替代旧的"开页即计时"）
var ACT_LAST_ACTIVITY = 'sillytroops_active_last_activity';
var ACT_LAST_FLUSH = 'sillytroops_active_last_flush';
var ACT_PENDING = 'sillytroops_active_pending';

var IDLE_MS = 5 * 60 * 1000;    // 超过 5 分钟无操作即视为空闲，不再累计
var FLUSH_MS = 30 * 1000;       // 每 30 秒结算并上报一次
var MAX_PENDING_MS = 10 * 60 * 1000;

// 已取消的测试账号（老本地数据里可能还有，统一清理，不再重建）
var REMOVED_TEST_USERNAMES = ['test01', 'test02', 'test03', 'test04', 'test05'];

// 小程序端没有相对路径可依托：需要显式配置后端地址（并在微信后台加入 request 合法域名）。
// 未配置时账号相关操作会返回清晰提示，而不是静默失败。
var MINI_PROGRAM_API_BASE = '';

var _activityTimer = null;

// ── 基础存储读写 ─────────────────────────────────────────────
function _get(key, fallback) {
  try {
    var v = uni.getStorageSync(key);
    return (v === '' || v === undefined || v === null) ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function _set(key, value) {
  try { uni.setStorageSync(key, value); return true; } catch (e) { return false; }
}

function _remove(key) {
  try { uni.removeStorageSync(key); return true; } catch (e) { return false; }
}

function _apiBase() {
  // #ifdef H5
  return ''; // 与后端同源，走相对路径
  // #endif
  // #ifndef H5
  return MINI_PROGRAM_API_BASE;
  // #endif
}

function _getToken() {
  return _get(AUTH_TOKEN_KEY, '') || '';
}

/**
 * 统一请求封装（H5 相对路径 / 小程序用配置的后端地址）
 * @returns {Promise<any>} 成功返回响应体；失败抛出带 status 的 Error
 */
function _request(path, options) {
  var opts = options || {};
  var base = _apiBase();
  if (!base && typeof window === 'undefined') {
    // 小程序且未配置后端地址
    return Promise.reject(new Error('当前平台未配置账号服务地址，无法登录/注册'));
  }
  var url = base + path;
  var header = { 'Content-Type': 'application/json' };
  var token = _getToken();
  if (token) header.Authorization = 'Bearer ' + token;

  return new Promise(function (resolve, reject) {
    uni.request({
      url: url,
      method: opts.method || 'GET',
      header: header,
      data: opts.body || undefined,
      success: function (res) {
        var data = res.data;
        if (typeof data === 'string') {
          try { data = JSON.parse(data); } catch (e) { data = null; }
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data || {});
        } else {
          var err = new Error((data && (data.error || data.detail)) || ('HTTP ' + res.statusCode));
          err.status = res.statusCode;
          reject(err);
        }
      },
      fail: function (err) {
        var e = new Error('网络请求失败: ' + (err && err.errMsg ? err.errMsg : '未知错误'));
        e.networkError = true;
        reject(e);
      }
    });
  });
}

// ── 本地会话缓存 ─────────────────────────────────────────────
function _saveSession(token, user) {
  _set(AUTH_TOKEN_KEY, token || '');
  _set(PROFILE_KEY, user || null);
  if (user && user.id) _set(CURRENT_USER_KEY, user.id);
}

function _clearSession() {
  _remove(AUTH_TOKEN_KEY);
  _remove(PROFILE_KEY);
  _remove(CURRENT_USER_KEY);
}

function _sanitize(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname || '',
    avatar: user.avatar || '',
    isAdmin: !!user.isAdmin,
    isTest: !!(user.isAdmin || user.isTest),
    canUseTestApi: !!(user.canUseTestApi || user.isAdmin || user.isTest)
  };
}

/** 用服务端返回的用户对象刷新本地缓存（保留 token） */
function _refreshProfile(user) {
  var sanitized = _sanitize(user);
  if (sanitized) {
    _set(PROFILE_KEY, sanitized);
    _set(CURRENT_USER_KEY, sanitized.id);
  }
  return sanitized;
}

// ── 本地用量缓存（离线兜底 + 监控页合并显示） ─────────────────
function _localStats() {
  var data = _get(LOCAL_STATS_KEY, null);
  return (data && typeof data === 'object') ? data : {};
}

function _saveLocalStats(all) {
  _set(LOCAL_STATS_KEY, all);
}

function _localStatsFor(userId) {
  var all = _localStats();
  if (!all[userId]) {
    all[userId] = {
      userId: userId,
      loginCount: 0,
      activeMs: 0,
      legacyTotalUsageMs: 0,
      tokenUsage: { prompt: 0, completion: 0, total: 0 },
      lastLoginAt: null
    };
  }
  return all[userId];
}

function _bumpLocalStats(userId, patch) {
  if (!userId) return;
  var all = _localStats();
  var s = _localStatsFor(userId);
  if (patch.activeMs) s.activeMs += patch.activeMs;
  if (patch.legacyTotalUsageMs) s.legacyTotalUsageMs += patch.legacyTotalUsageMs;
  if (patch.loginCount) s.loginCount += patch.loginCount;
  if (patch.tokens) {
    s.tokenUsage.prompt += patch.tokens.prompt || 0;
    s.tokenUsage.completion += patch.tokens.completion || 0;
    s.tokenUsage.total = s.tokenUsage.prompt + s.tokenUsage.completion;
  }
  if (patch.lastLoginAt) s.lastLoginAt = patch.lastLoginAt;
  all[userId] = s;
  _saveLocalStats(all);
}

// ── 本地登录日志（离线兜底） ─────────────────────────────────
function _logAction(userId, username, action) {
  try {
    var logs = _get(LOGIN_LOGS_KEY, []) || [];
    if (!Array.isArray(logs)) logs = [];
    logs.push({ userId: userId, username: username, timestamp: Date.now(), action: action });
    if (logs.length > 1000) logs = logs.slice(-1000);
    _set(LOGIN_LOGS_KEY, logs);
  } catch (e) { /* ignore */ }
}

// ── 旧本地账号表（仅用于一次性认领） ─────────────────────────
function _legacyUsers() {
  var list = _get(LEGACY_USERS_KEY, []);
  return Array.isArray(list) ? list : [];
}

function _saveLegacyUsers(list) {
  _set(LEGACY_USERS_KEY, list);
}

/** 清理已取消的测试账号等历史本地记录 */
function _purgeLegacyRecords() {
  var list = _legacyUsers();
  if (!list.length) return;
  var kept = list.filter(function (u) {
    return u && REMOVED_TEST_USERNAMES.indexOf(u.username) === -1;
  });
  if (kept.length !== list.length) {
    console.log('[UserManager] 已清理 ' + (list.length - kept.length) + ' 个已取消的测试账号本地记录');
  }
  if (!kept.length) {
    _remove(LEGACY_USERS_KEY);
  } else {
    _saveLegacyUsers(kept);
  }
}

/** 认领成功后删除对应的本地明文记录 */
function _removeLegacyRecord(username) {
  var list = _legacyUsers();
  var kept = list.filter(function (u) { return !u || u.username !== username; });
  if (!kept.length) _remove(LEGACY_USERS_KEY); else _saveLegacyUsers(kept);
}

/**
 * 兼容旧调用：原先在这里播种 admin / test01~test05（含明文密码）。
 * 现在账号在服务端，这里只做本地历史数据清理。
 */
function ensureAdminSeed() {
  _purgeLegacyRecords();
}

// ── 注册 / 登录 / 登出 ───────────────────────────────────────
/**
 * 注册（注册即测试账号由服务端数据库默认值决定，客户端不能指定）
 * @returns {Promise<{success:boolean, message?:string, user?:object}>}
 */
async function register(username, password, nickname) {
  var u = (username || '').trim();
  var p = (password || '').trim();
  if (!u || !p) return { success: false, message: '用户名和密码不能为空' };
  try {
    var data = await _request('/api/auth/register', {
      method: 'POST',
      body: { username: u, password: p, nickname: (nickname || '').trim() }
    });
    var user = _refreshProfile(data.user);
    _saveSession(data.token, user);
    return { success: true, user: user };
  } catch (e) {
    return { success: false, message: e && e.message ? e.message : '注册失败' };
  }
}

/**
 * 登录（服务端校验密码哈希；若是迁移前的老本地账号，自动认领）
 * @returns {Promise<{success:boolean, message?:string, user?:object}>}
 */
async function login(username, password) {
  var u = (username || '').trim();
  var p = (password || '').trim();
  if (!u || !p) return { success: false, message: '用户名和密码不能为空' };

  try {
    var data = await _request('/api/auth/login', { method: 'POST', body: { username: u, password: p } });
    var user = _refreshProfile(data.user);
    _saveSession(data.token, user);
    _afterLogin(user);
    return { success: true, user: user };
  } catch (e) {
    if (e && e.status === 401) {
      // 可能是迁移前只存在于本地浏览器里的老账号：本地校验通过后自动认领到服务端
      var claimed = await _tryClaimLegacyAccount(u, p);
      if (claimed) return claimed;
    }
    return { success: false, message: (e && e.message) ? e.message : '登录失败' };
  }
}

/** 老账号认领：本地明文校验 -> /api/auth/claim -> 删除本地明文记录 */
async function _tryClaimLegacyAccount(username, password) {
  var list = _legacyUsers();
  var legacy = null;
  for (var i = 0; i < list.length; i++) {
    if (list[i] && list[i].username === username) { legacy = list[i]; break; }
  }
  if (!legacy) return null;
  if (legacy.password !== password) return null; // 本地校验不通过，按密码错误处理

  try {
    var data = await _request('/api/auth/claim', {
      method: 'POST',
      body: {
        username: username,
        password: password,
        nickname: legacy.nickname || '',
        legacyLocalId: legacy.id || null,
        // 老账号的权限沿用本地记录（admin 会带入管理员权限）
        isAdmin: !!legacy.isAdmin,
        isTest: !!(legacy.isTest || legacy.isAdmin)
      }
    });
    var user = _refreshProfile(data.user);
    _saveSession(data.token, user);
    _removeLegacyRecord(username);
    // 老账号的历史本地用量并入本地缓存（服务端会在启动/后续流程中累计）
    _bumpLocalStats(user.id, {
      legacyTotalUsageMs: legacy.totalUsageTime || 0,
      tokens: legacy.tokenUsage ? { prompt: legacy.tokenUsage.prompt || 0, completion: legacy.tokenUsage.completion || 0 } : null,
      loginCount: legacy.loginCount || 0
    });
    uni.showToast({ title: '老账号已迁移到服务器', icon: 'none' });
    _afterLogin(user);
    return { success: true, user: user, claimed: true };
  } catch (e) {
    return { success: false, message: (e && e.message) ? e.message : '老账号迁移失败' };
  }
}

function _afterLogin(user) {
  if (!user || !user.id) return;
  _logAction(user.id, user.username, 'login');
  _bumpLocalStats(user.id, { loginCount: 1, lastLoginAt: Date.now() });
  _resetActivityBaseline();
  // 上报登录事件（服务端以 token 判定身份）
  _report({ action: 'login' });
}

function logout() {
  var user = getCurrentUser();
  // 结算未上报的活跃时长
  try { heartbeat(); } catch (e) { /* ignore */ }
  if (user && user.id) {
    _logAction(user.id, user.username, 'logout');
    _report({ action: 'logout' });
  }
  _stopActivityTracking();
  _clearSession();
}

// ── 当前用户信息（同步读本地缓存） ───────────────────────────
function getCurrentUserId() {
  var id = _get(CURRENT_USER_KEY, null);
  return id || null;
}

function getCurrentUser() {
  var profile = _get(PROFILE_KEY, null);
  if (profile && profile.id) return _sanitize(profile);
  return null;
}

function getUserById(userId) {
  var current = getCurrentUser();
  if (current && current.id === userId) return current;
  return null;
}

function isAdmin() {
  var user = getCurrentUser();
  return !!(user && user.isAdmin);
}

/** 本地缓存的测试权限（仅用于 UI 显隐；真正的判定在服务端） */
function isTestAccount() {
  var user = getCurrentUser();
  return !!(user && user.canUseTestApi);
}

/**
 * 向服务端核对当前账号的最新权限（发请求前调用）。
 * 服务端不可用时回退本地缓存值，避免离线直接不可用。
 * @returns {Promise<boolean>}
 */
async function isTestAccountChecked() {
  var cached = isTestAccount();
  var token = _getToken();
  if (!token) return cached;
  try {
    var data = await _request('/api/auth/me');
    var user = _refreshProfile(data.user);
    return !!(user && user.canUseTestApi);
  } catch (e) {
    if (e && (e.status === 401)) {
      // token 失效（例如管理员重置了密码）：清掉本地登录态
      _clearSession();
      return false;
    }
    return cached;
  }
}

/** 更新资料（昵称跨设备同步；头像暂不同步） */
async function updateProfile(userId, updates) {
  var payload = updates || {};
  if (typeof payload.nickname === 'string') {
    try {
      var data = await _request('/api/auth/me', { method: 'PATCH', body: { nickname: payload.nickname } });
      _refreshProfile(data.user);
      return true;
    } catch (e) {
      console.warn('[UserManager] 昵称同步失败:', e && e.message);
      return false;
    }
  }
  // 头像等暂只在本地生效
  var current = getCurrentUser();
  if (current && typeof payload.avatar === 'string') {
    current.avatar = payload.avatar;
    _set(PROFILE_KEY, current);
    return true;
  }
  return false;
}

// ── 活跃时长统计 ─────────────────────────────────────────────
function _resetActivityBaseline() {
  var now = Date.now();
  _set(ACT_LAST_ACTIVITY, now);
  _set(ACT_LAST_FLUSH, now);
  _set(ACT_PENDING, 0);
}

function _isHidden() {
  // #ifdef H5
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return true;
  // #endif
  return false;
}

/**
 * 记录一次用户活动（由 App.vue 的交互事件监听调用）
 */
function markActivity() {
  if (!_getToken()) return;
  var now = Date.now();
  var last = Number(_get(ACT_LAST_ACTIVITY, 0)) || 0;
  // 节流：最多每秒写一次存储
  if (now - last < 1000) return;
  _set(ACT_LAST_ACTIVITY, now);
  // 从空闲状态恢复时，重置结算基线（空闲期间不计时）
  var lastFlush = Number(_get(ACT_LAST_FLUSH, 0)) || 0;
  if (lastFlush && (now - lastFlush) > IDLE_MS) {
    _set(ACT_LAST_FLUSH, now);
  }
}

/**
 * 结算并上报活跃时长。保留旧函数名 heartbeat()，调用点无需改动。
 * @returns {number} 本次结算的活跃毫秒
 */
function heartbeat() {
  var token = _getToken();
  if (!token) return 0;

  var now = Date.now();
  var lastActivity = Number(_get(ACT_LAST_ACTIVITY, 0)) || 0;
  var lastFlush = Number(_get(ACT_LAST_FLUSH, 0)) || 0;

  if (!lastActivity || !lastFlush) {
    _resetActivityBaseline();
    return 0;
  }

  // 页面不可见时不计时，仅把基线推到当前时间
  if (_isHidden()) {
    _set(ACT_LAST_FLUSH, now);
    return 0;
  }

  // 只累计 [lastFlush, min(now, lastActivity + IDLE_MS)]：空闲超时后的时间不计
  var countUntil = Math.min(now, lastActivity + IDLE_MS);
  var delta = countUntil - lastFlush;
  if (!(delta > 0)) {
    _set(ACT_LAST_FLUSH, now);
    return 0;
  }
  _set(ACT_LAST_FLUSH, now);

  var pending = (Number(_get(ACT_PENDING, 0)) || 0) + delta;
  if (pending > MAX_PENDING_MS) pending = MAX_PENDING_MS;

  var user = getCurrentUser();
  if (user && user.id) _bumpLocalStats(user.id, { activeMs: delta });

  // 上报（失败则累加到 pending，下次一起报）
  _report({ action: 'heartbeat', activeMs: pending }).then(function (ok) {
    if (ok) _set(ACT_PENDING, 0);
    else _set(ACT_PENDING, pending);
  });

  return delta;
}

/** 记录一次对话的 token 估算用量 */
function recordTokenUsage(promptTokens, completionTokens) {
  var p = Math.max(0, Math.round(Number(promptTokens) || 0));
  var c = Math.max(0, Math.round(Number(completionTokens) || 0));
  if (!p && !c) return;
  var user = getCurrentUser();
  if (user && user.id) _bumpLocalStats(user.id, { tokens: { prompt: p, completion: c } });
  _report({ action: 'token', tokenUsage: { prompt: p, completion: c } });
}

/** 上报事件（服务端按 token 判定身份，客户端不再声明 userId/权限） */
function _report(payload) {
  var token = _getToken();
  if (!token) return Promise.resolve(false);
  return _request('/api/stats/event', { method: 'POST', body: payload })
    .then(function () { return true; })
    .catch(function (e) {
      console.warn('[UserManager] 统计上报失败（忽略）:', e && e.message);
      return false;
    });
}

/** 启动活跃时长追踪（App.vue 启动时调用一次） */
function startActivityTracking() {
  // #ifdef H5
  if (typeof window === 'undefined' || _activityTimer) return;
  var onActivity = function () { try { markActivity(); } catch (e) { /* ignore */ } };
  ['pointerdown', 'keydown', 'touchstart', 'wheel', 'mousemove'].forEach(function (evt) {
    window.addEventListener(evt, onActivity, { passive: true });
  });
  _activityTimer = setInterval(function () { try { heartbeat(); } catch (e) { /* ignore */ } }, FLUSH_MS);
  // #endif
  // #ifndef H5
  if (_activityTimer) return;
  _activityTimer = setInterval(function () { try { heartbeat(); } catch (e) { /* ignore */ } }, FLUSH_MS);
  // #endif
}

function _stopActivityTracking() {
  if (_activityTimer) {
    clearInterval(_activityTimer);
    _activityTimer = null;
  }
}

// ── 统计查询（监控页） ───────────────────────────────────────
/** 本地统计（离线兜底） */
function getUserStats() {
  var all = _localStats();
  var list = Object.keys(all).map(function (userId) {
    var s = all[userId] || {};
    var tokens = s.tokenUsage || { prompt: 0, completion: 0, total: 0 };
    return {
      userId: userId,
      username: userId,
      nickname: '',
      isAdmin: false,
      isTest: false,
      loginCount: s.loginCount || 0,
      legacyTotalUsageMs: s.legacyTotalUsageMs || 0,
      activeMs: s.activeMs || 0,
      totalUsageTime: (s.legacyTotalUsageMs || 0) + (s.activeMs || 0),
      tokenUsage: { prompt: tokens.prompt || 0, completion: tokens.completion || 0, total: tokens.total || 0 },
      lastLoginAt: s.lastLoginAt || null
    };
  });
  list.sort(function (a, b) { return (b.totalUsageTime || 0) - (a.totalUsageTime || 0); });
  return list;
}

/** 账号 + 统计汇总（服务端为准，失败回退本地） */
async function getUserStatsMerged() {
  try {
    var data = await _request('/api/stats/summary');
    if (data && Array.isArray(data.users)) {
      // 顺手刷新自己的权限缓存（管理员可能在别处改过）
      var me = null;
      var uid = getCurrentUserId();
      for (var i = 0; i < data.users.length; i++) {
        if (data.users[i].userId === uid) { me = data.users[i]; break; }
      }
      if (me) _refreshProfile({ id: me.userId, username: me.username, nickname: me.nickname, isAdmin: me.isAdmin, isTest: me.isTest, canUseTestApi: me.canUseTestApi });
      return data.users;
    }
  } catch (e) {
    console.warn('[UserManager] 读取服务端统计失败，回退本地数据:', e && e.message);
  }
  return getUserStats();
}

/** 登录日志（本地） */
function getLoginLogs(options) {
  var logs = _get(LOGIN_LOGS_KEY, []) || [];
  if (!Array.isArray(logs)) logs = [];
  var opts = options || {};
  var filtered = logs;
  if (opts.startTime) filtered = filtered.filter(function (l) { return l.timestamp >= opts.startTime; });
  if (opts.endTime) filtered = filtered.filter(function (l) { return l.timestamp <= opts.endTime; });
  if (opts.action) filtered = filtered.filter(function (l) { return l.action === opts.action; });
  var limit = (opts && opts.limit) || 100;
  return filtered.slice(-limit).reverse();
}

/** 登录日志（服务端 + 本地合并，倒序） */
async function getLoginLogsMerged(options) {
  var opts = options || {};
  var merged = getLoginLogs(opts);
  try {
    var data = await _request('/api/stats/summary');
    var remote = (data && Array.isArray(data.logs)) ? data.logs : [];
    if (opts.action) remote = remote.filter(function (l) { return l.action === opts.action; });
    // 按 userId+timestamp+action 去重合并
    var seen = {};
    merged.forEach(function (l) { seen[l.userId + '|' + l.timestamp + '|' + l.action] = true; });
    remote.forEach(function (l) {
      var k = l.userId + '|' + l.timestamp + '|' + l.action;
      if (!seen[k]) { seen[k] = true; merged.push(l); }
    });
    merged.sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
  } catch (e) {
    console.warn('[UserManager] 读取服务端登录日志失败，仅显示本地:', e && e.message);
  }
  // 服务端返回的是最近 N 条，时间范围统一在合并后过滤，保证两端行为一致
  if (opts.startTime) merged = merged.filter(function (l) { return (l.timestamp || 0) >= opts.startTime; });
  if (opts.endTime) merged = merged.filter(function (l) { return (l.timestamp || 0) <= opts.endTime; });
  return merged.slice(0, opts.limit || 200);
}

/** 按天统计（管理员；Asia/Shanghai 日历日） */
async function getDailyStats(options) {
  var opts = options || {};
  var query = [];
  if (opts.userId) query.push('userId=' + encodeURIComponent(opts.userId));
  if (opts.from) query.push('from=' + encodeURIComponent(opts.from));
  if (opts.to) query.push('to=' + encodeURIComponent(opts.to));
  if (opts.limit) query.push('limit=' + encodeURIComponent(opts.limit));
  var data = await _request('/api/stats/daily' + (query.length ? '?' + query.join('&') : ''));
  return (data && data.days) || [];
}

/**
 * 管理员调整某账号的测试权限（服务端权威；admin 可随时开关）
 * @returns {Promise<{success:boolean, message?:string}>}
 */
async function setTestPermission(userId, isTest) {
  if (!userId) return { success: false, message: '缺少 userId' };
  try {
    var data = await _request('/api/admin/set-test', { method: 'POST', body: { userId: userId, isTest: !!isTest } });
    var target = data && data.user;
    // 若改的是自己，同步本地缓存
    var me = getCurrentUser();
    if (target && me && target.id === me.id) _refreshProfile(target);
    return { success: true, user: target };
  } catch (e) {
    return { success: false, message: (e && e.message) ? e.message : '调整失败' };
  }
}

/** 登录凭证（供 LLM 测试通道等模块使用） */
function getAuthToken() {
  return _getToken();
}

export default {
  ensureAdminSeed: ensureAdminSeed,
  register: register,
  login: login,
  logout: logout,
  heartbeat: heartbeat,
  markActivity: markActivity,
  startActivityTracking: startActivityTracking,
  recordTokenUsage: recordTokenUsage,
  getCurrentUserId: getCurrentUserId,
  getCurrentUser: getCurrentUser,
  getUserById: getUserById,
  updateProfile: updateProfile,
  isAdmin: isAdmin,
  isTestAccount: isTestAccount,
  isTestAccountChecked: isTestAccountChecked,
  setTestPermission: setTestPermission,
  getLoginLogs: getLoginLogs,
  getLoginLogsMerged: getLoginLogsMerged,
  getUserStats: getUserStats,
  getUserStatsMerged: getUserStatsMerged,
  getDailyStats: getDailyStats,
  getAuthToken: getAuthToken
};
