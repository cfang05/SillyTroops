// src/utils/account/userManager.js
// 本地账号系统：注册/登录/用户设置，所有数据以 uni.setStorageSync 存储（遵循跨端约束）
// 每个用户的业务数据通过 userScope 的 scopedKey() 按 userId 前缀隔离
//
// 存储结构：
//   sillytroops_users            -> [{ id, username, password, nickname, avatar, isAdmin, isTest, createdAt, lastLoginAt, loginCount, totalUsageTime, tokenUsage:{prompt,completion,total} }]
//   sillytroops_current_user_id  -> 当前登录用户 id
//   sillytroops_login_logs       -> [{ userId, username, timestamp, action: 'login'|'logout' }]
//   sillytroops_session_start    -> 当前会话开始时间戳（用于计算使用时长）
//   u_{userId}_user_settings     -> { model, apiKey, apiUrl, modelName, temperature, topP, maxTokens, ... }
//
// isTest：测试账号标记。测试账号（含 admin）可使用内置测试 API（见 utils/llm/client.js 的 TEST_API_CONFIG）
//         直接测试游戏玩法，无需在设置页配置自己的 API Key。
//
// 注意：本地账号密码为明文存储（本项目为本地单机场景，无服务端）。
//       如需更高安全性，可在此处接入哈希，但小程序端无 crypto，故保持明文并在 UI 提示。

'use strict';

import statsSync from './statsSync.js';

var USERS_KEY = 'sillytroops_users';
var CURRENT_USER_KEY = 'sillytroops_current_user_id';
var LOGIN_LOGS_KEY = 'sillytroops_login_logs';
var SESSION_START_KEY = 'sillytroops_session_start';

function _genId() {
  return 'user_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function _getUsers() {
  try {
    var list = uni.getStorageSync(USERS_KEY);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function _saveUsers(list) {
  try {
    uni.setStorageSync(USERS_KEY, list);
    return true;
  } catch (e) {
    console.error('[UserManager] 保存用户列表失败:', e);
    return false;
  }
}

/**
 * 确保内置账户存在：admin（管理员，15级）+ test01~test05（测试账号）
 * 应用启动时调用一次。原账号密码保持不变。
 */
function ensureAdminSeed() {
  var users = _getUsers();
  var changed = false;
  
  // 1. 确保 admin 账户存在
  var admin = users.find(function (u) { return u.username === 'admin'; });
  if (!admin) {
    users.push({
      id: 'user_admin',
      username: 'admin',
      password: 'admin123',  // 默认密码（用户可自行修改）
      nickname: '管理员',
      avatar: '',
      isAdmin: true,
      isTest: true,
      level: 15,  // 管理员15级
      xp: 0,
      loginCount: 0,
      totalUsageTime: 0,
      tokenUsage: { prompt: 0, completion: 0, total: 0 },
      createdAt: Date.now()
    });
    changed = true;
    console.log('[UserManager] 已创建内置 admin 账户（15级，默认密码 admin123）');
  } else {
    // 兼容旧数据：补全标记和等级
    var needUpdate = false;
    if (!admin.isTest) { admin.isTest = true; needUpdate = true; }
    if (!admin.level || admin.level < 15) { admin.level = 15; needUpdate = true; }
    if (needUpdate) {
      changed = true;
      console.log('[UserManager] 已更新 admin 账户为15级');
    }
  }

  // 2.5 兼容旧数据：为所有已存在但缺少统计字段的账号补全默认值
  // （loginCount/totalUsageTime/tokenUsage 是本次修复新增字段，早期创建的账号记录里没有，
  //  缺失时监控页会显示 undefined/NaN，这里统一兜底为 0）
  users.forEach(function (u) {
    if (typeof u.loginCount !== 'number') { u.loginCount = 0; changed = true; }
    if (typeof u.totalUsageTime !== 'number') { u.totalUsageTime = 0; changed = true; }
    if (!u.tokenUsage || typeof u.tokenUsage !== 'object') {
      u.tokenUsage = { prompt: 0, completion: 0, total: 0 };
      changed = true;
    }
  });
  
  // 2. 确保 test01~test05 测试账号存在
  var testAccounts = [
    { username: 'test01', password: '1234', nickname: '测试用户01' },
    { username: 'test02', password: '2345', nickname: '测试用户02' },
    { username: 'test03', password: '3456', nickname: '测试用户03' },
    { username: 'test04', password: '4567', nickname: '测试用户04' },
    { username: 'test05', password: '5678', nickname: '测试用户05' }
  ];
  
  testAccounts.forEach(function (acc) {
    var existing = users.find(function (u) { return u.username === acc.username; });
    if (!existing) {
      users.push({
        id: 'user_' + acc.username,
        username: acc.username,
        password: acc.password,
        nickname: acc.nickname,
        avatar: '',
        isAdmin: false,
        isTest: true,
        level: 1,
        xp: 0,
        loginCount: 0,
        totalUsageTime: 0,
        tokenUsage: { prompt: 0, completion: 0, total: 0 },
        createdAt: Date.now()
      });
      changed = true;
      console.log('[UserManager] 已创建测试账号: ' + acc.username);
    }
  });
  
  if (changed) {
    _saveUsers(users);
  }

  // 每次启动都把本地已知账号（admin + test01~05 + 历史注册账号）同步上报到服务器
  // 建档（register 事件只 upsert 账号信息、不产生登录计数）。这样即使某账号从未在
  // 管理员所在设备登录过，服务器的账号清单里也有它，监控页 getUserStatsMerged() 才能
  // 把它列出来并展示它在其他设备上的登录次数/时长/token 用量。
  users.forEach(function (u) {
    statsSync.reportEvent({
      userId: u.id,
      username: u.username,
      nickname: u.nickname || '',
      isAdmin: !!u.isAdmin,
      isTest: !!(u.isTest || u.isAdmin),
      action: 'register'
    });
  });
}

/**
 * 注册新账户
 * @returns {{ success: boolean, message?: string, user?: Object }}
 */
function register(username, password, nickname) {
  username = (username || '').trim();
  password = (password || '').trim();
  if (!username || !password) {
    return { success: false, message: '用户名和密码不能为空' };
  }
  var users = _getUsers();
  if (users.some(function (u) { return u.username === username; })) {
    return { success: false, message: '该用户名已被注册' };
  }
  var user = {
    id: _genId(),
    username: username,
    password: password,
    nickname: nickname || '',
    avatar: '',
    isAdmin: false,
    isTest: true,
    loginCount: 0,
    totalUsageTime: 0,
    tokenUsage: { prompt: 0, completion: 0, total: 0 },
    createdAt: Date.now()
  };
  users.push(user);
  _saveUsers(users);

  // 上报账号创建事件到服务器：账号列表本身也是按设备存储的本地数据，
  // 新注册的账号只存在于当前设备的 localStorage 里，其他设备上的管理员完全不知道
  // 这个账号存在。这里把账号基本信息也同步一份到服务器，让 getUserStatsMerged()
  // 能把"只在别的设备上注册过"的账号也补充进管理员看到的列表。
  statsSync.reportEvent({
    userId: user.id,
    username: user.username,
    nickname: user.nickname || '',
    isAdmin: false,
    isTest: true,
    action: 'register'
  });

  return { success: true, user: _sanitize(user) };
}

/**
 * 登录
 * @returns {{ success: boolean, message?: string, user?: Object }}
 */
function login(username, password) {
  username = (username || '').trim();
  password = (password || '').trim();
  var users = _getUsers();
  var user = users.find(function (u) { return u.username === username; });
  if (!user) return { success: false, message: '用户不存在' };
  if (user.password !== password) return { success: false, message: '密码错误' };
  
  // 更新用户最后登录时间 + 登录次数（登录次数直接落在用户记录上，不再单纯依赖
  // sillytroops_login_logs——该日志表全局共享、超过1000条会被裁剪旧记录，测试期间
  // 账号一多容易把不活跃账号的登录记录挤出日志，导致其登录次数显示为 0）
  user.lastLoginAt = Date.now();
  if (!user.totalUsageTime) user.totalUsageTime = 0;
  if (!user.tokenUsage) user.tokenUsage = { prompt: 0, completion: 0, total: 0 };
  user.loginCount = (user.loginCount || 0) + 1;
  _saveUsers(users);
  
  // 记录登录日志
  _logAction(user.id, user.username, 'login');
  
  // 开始新会话计时
  try {
    uni.setStorageSync(SESSION_START_KEY, Date.now());
    uni.setStorageSync(CURRENT_USER_KEY, user.id);
  } catch (e) { /* ignore */ }
  
  // 上报到服务器（跨设备汇总；best-effort，失败不影响登录本身）
  statsSync.reportEvent({
    userId: user.id,
    username: user.username,
    nickname: user.nickname || '',
    isAdmin: !!user.isAdmin,
    isTest: !!(user.isTest || user.isAdmin),
    action: 'login'
  });
  
  // 登录后异步核对服务器上的测试权限（admin 可能已在别的设备关闭/开启过），回写本地缓存
  isTestAccountChecked().catch(function () { /* ignore */ });
  
  return { success: true, user: _sanitize(user) };
}

function logout() {
  var userId = getCurrentUserId();
  if (userId) {
    // 累加本次会话使用时长（复用 heartbeat 逻辑，同时上报服务器）
    heartbeat();
    
    // 记录登出日志
    var user = getCurrentUser();
    if (user) {
      _logAction(userId, user.username, 'logout');
      statsSync.reportEvent({
        userId: userId,
        username: user.username,
        nickname: user.nickname || '',
        isAdmin: !!user.isAdmin,
        isTest: !!(user.isTest || user.isAdmin),
        action: 'logout'
      });
    }
  }
  
  try {
    uni.removeStorageSync(CURRENT_USER_KEY);
    uni.removeStorageSync(SESSION_START_KEY);
  } catch (e) { /* ignore */ }
}

/** 当前登录用户 id（未登录返回 null） */
function getCurrentUserId() {
  try {
    return uni.getStorageSync(CURRENT_USER_KEY) || null;
  } catch (e) {
    return null;
  }
}

/** 当前登录用户对象（未登录返回 null，已脱敏去除密码） */
function getCurrentUser() {
  var id = getCurrentUserId();
  if (!id) return null;
  var users = _getUsers();
  var user = users.find(function (u) { return u.id === id; });
  return user ? _sanitize(user) : null;
}

function getUserById(id) {
  var users = _getUsers();
  var user = users.find(function (u) { return u.id === id; });
  return user ? _sanitize(user) : null;
}

/**
 * 更新用户资料（昵称/头像）
 */
function updateProfile(userId, updates) {
  var users = _getUsers();
  var idx = users.findIndex(function (u) { return u.id === userId; });
  if (idx < 0) return false;
  if (typeof updates.nickname === 'string') users[idx].nickname = updates.nickname;
  if (typeof updates.avatar === 'string') users[idx].avatar = updates.avatar;
  _saveUsers(users);
  return true;
}

/** 当前用户是否为 admin */
function isAdmin() {
  var user = getCurrentUser();
  return !!(user && user.isAdmin);
}

/** 当前用户是否为测试账号（含 admin；可无 Key 使用内置测试 API，读本地缓存） */
function isTestAccount() {
  var user = getCurrentUser();
  return !!(user && (user.isTest || user.isAdmin));
}

/**
 * admin 调整某账号的测试权限（本地更新 + 上报服务器权威值）。
 * @param {string} userId 目标账号 id
 * @param {boolean} isTest 新的测试权限
 * @param {Object} [meta] 目标账号的补充信息（本地无该账号记录时用于服务器端建档）
 * @param {string} [meta.username]
 * @param {string} [meta.nickname]
 * @param {boolean} [meta.isAdmin]
 */
function setTestPermission(userId, isTest, meta) {
  if (!userId) return false;
  var flag = !!isTest;
  var users = _getUsers();
  var user = users.find(function (u) { return u.id === userId; });
  if (user) {
    user.isTest = flag;
    _saveUsers(users);
  }
  var username = (meta && meta.username) || (user && user.username) || userId;
  var nickname = (meta && meta.nickname) || (user && user.nickname) || '';
  var isAdminFlag = (meta && typeof meta.isAdmin === 'boolean') ? meta.isAdmin : !!(user && user.isAdmin);

  statsSync.reportEvent({
    userId: userId,
    username: username,
    nickname: nickname,
    isAdmin: isAdminFlag,
    isTest: flag,
    action: 'set-test'
  });
  return true;
}

/**
 * 核对当前账号的测试权限（发 LLM 请求前调用，保证 admin 关闭权限后"随时"生效）：
 * admin 恒有权限；否则向服务器拉取该账号权威 isTest，回写本地缓存后返回。
 * 服务器不可用/无记录时回退本地缓存值。
 * @returns {Promise<boolean>}
 */
async function isTestAccountChecked() {
  var user = getCurrentUser();
  if (!user) return false;
  if (user.isAdmin) return true; // admin 恒有测试权限，不受开关影响

  var remote = null;
  try {
    remote = await statsSync.fetchTestPermission(user.id);
  } catch (e) {
    remote = null;
  }
  if (typeof remote === 'boolean') {
    // 回写本地缓存，保证后续同步 isTestAccount() 也一致
    var users = _getUsers();
    var u = users.find(function (x) { return x.id === user.id; });
    if (u) {
      u.isTest = remote;
      _saveUsers(users);
    }
    return remote;
  }
  return !!user.isTest;
}

/** 记录登录/登出操作 */
function _logAction(userId, username, action) {
  try {
    var logs = uni.getStorageSync(LOGIN_LOGS_KEY) || [];
    logs.push({
      userId: userId,
      username: username,
      timestamp: Date.now(),
      action: action
    });
    // 保留最近1000条日志，避免无限增长
    if (logs.length > 1000) {
      logs = logs.slice(-1000);
    }
    uni.setStorageSync(LOGIN_LOGS_KEY, logs);
  } catch (e) {
    console.warn('[UserManager] 记录日志失败:', e);
  }
}

/** 更新当前会话使用时长 */
function _updateSessionTime(userId) {
  try {
    var sessionStart = uni.getStorageSync(SESSION_START_KEY);
    if (!sessionStart) return 0;
    
    var sessionDuration = Date.now() - sessionStart;
    var users = _getUsers();
    var user = users.find(function (u) { return u.id === userId; });
    if (user) {
      user.totalUsageTime = (user.totalUsageTime || 0) + sessionDuration;
      _saveUsers(users);
    }
    return sessionDuration;
  } catch (e) {
    console.warn('[UserManager] 更新使用时长失败:', e);
    return 0;
  }
}

/**
 * 心跳：把「距离上次心跳/登录以来」新增的使用时长累加进 totalUsageTime，
 * 并重置会话起点，供 App.vue onHide/定时器周期性调用（而不是只在 onHide 触发一次），
 * 避免用户长时间挂着页面不切后台导致 onHide 一直不触发、使用时长永远停在 0。
 * 同时把本次新增时长上报到服务器，供跨设备汇总。
 * @returns {number} 本次新增的毫秒数
 */
function heartbeat() {
  var userId = getCurrentUserId();
  if (!userId) return 0;
  // 会话起点兜底：冷启动直接进入（无 SESSION_START_KEY）时以当前时间为起点，
  // 否则这段时间永远不会被结算进使用时长
  try {
    var start = uni.getStorageSync(SESSION_START_KEY);
    if (!start) uni.setStorageSync(SESSION_START_KEY, Date.now());
  } catch (e) { /* ignore */ }

  var sessionDuration = _updateSessionTime(userId);
  try {
    uni.setStorageSync(SESSION_START_KEY, Date.now());
  } catch (e) { /* ignore */ }

  if (sessionDuration > 0) {
    var user = getCurrentUser();
    if (user) {
      statsSync.reportEvent({
        userId: userId,
        username: user.username,
        nickname: user.nickname || '',
        isAdmin: !!user.isAdmin,
        isTest: !!(user.isTest || user.isAdmin),
        action: 'heartbeat',
        sessionMs: sessionDuration
      });
    }
  }
  return sessionDuration;
}

/**
 * 记录一次 LLM 调用的 Token 用量（估算值，见 engine/tokenizer.ts 的启发式/tiktoken 计数），
 * 累加进当前登录用户的 tokenUsage，并上报服务器做跨设备汇总。
 * @param {number} promptTokens
 * @param {number} completionTokens
 */
function recordTokenUsage(promptTokens, completionTokens) {
  var userId = getCurrentUserId();
  if (!userId) return;
  var p = Number(promptTokens) || 0;
  var c = Number(completionTokens) || 0;
  if (p <= 0 && c <= 0) return;

  try {
    var users = _getUsers();
    var user = users.find(function (u) { return u.id === userId; });
    if (user) {
      if (!user.tokenUsage || typeof user.tokenUsage !== 'object') {
        user.tokenUsage = { prompt: 0, completion: 0, total: 0 };
      }
      user.tokenUsage.prompt = (user.tokenUsage.prompt || 0) + p;
      user.tokenUsage.completion = (user.tokenUsage.completion || 0) + c;
      user.tokenUsage.total = (user.tokenUsage.total || 0) + p + c;
      _saveUsers(users);

      statsSync.reportEvent({
        userId: userId,
        username: user.username,
        nickname: user.nickname || '',
        isAdmin: !!user.isAdmin,
        isTest: !!(user.isTest || user.isAdmin),
        action: 'token',
        tokenUsage: { prompt: p, completion: c }
      });
    }
  } catch (e) {
    console.warn('[UserManager] 记录 Token 用量失败:', e);
  }
}

/**
 * 获取所有登录日志（管理员功能）
 * @param {Object} options - 筛选条件 { userId?, startTime?, endTime?, action?, limit? }
 * @returns {Array} 日志列表
 */
function getLoginLogs(options) {
  try {
    var logs = uni.getStorageSync(LOGIN_LOGS_KEY) || [];
    
    // 筛选
    if (options) {
      if (options.userId) {
        logs = logs.filter(function (log) { return log.userId === options.userId; });
      }
      if (options.startTime) {
        logs = logs.filter(function (log) { return log.timestamp >= options.startTime; });
      }
      if (options.endTime) {
        logs = logs.filter(function (log) { return log.timestamp <= options.endTime; });
      }
      if (options.action) {
        logs = logs.filter(function (log) { return log.action === options.action; });
      }
    }
    
    // 限制返回数量
    var limit = (options && options.limit) || 100;
    return logs.slice(-limit).reverse(); // 最新的在前
  } catch (e) {
    console.warn('[UserManager] 获取日志失败:', e);
    return [];
  }
}

/**
 * 获取用户统计信息（管理员功能，仅本机数据）
 * @param {string} userId - 可选，不传则返回所有用户统计
 * @returns {Object|Array} 单个用户统计或所有用户统计列表
 */
function getUserStats(userId) {
  try {
    var users = _getUsers();
    var logs = uni.getStorageSync(LOGIN_LOGS_KEY) || [];
    
    if (userId) {
      // 返回单个用户统计
      var user = users.find(function (u) { return u.id === userId; });
      if (!user) return null;
      return _buildStatEntry(user, logs);
    } else {
      // 返回所有用户统计
      return users.map(function (user) {
        return _buildStatEntry(user, logs);
      });
    }
  } catch (e) {
    console.warn('[UserManager] 获取用户统计失败:', e);
    return userId ? null : [];
  }
}

/** 组装单个用户的统计条目（本机数据） */
function _buildStatEntry(user, logs) {
  var userLogs = logs.filter(function (log) { return log.userId === user.id; });
  // 登录次数优先取用户记录上直接累加的 loginCount（本次修复新增字段，login() 每次登录都会
  // ++1，不受日志表裁剪影响）；仅当该字段缺失时（未触发过 ensureAdminSeed 迁移的极旧数据）
  // 才回退到从登录日志里统计，保证任何情况下都不会显示 0
  var loginCount = typeof user.loginCount === 'number'
    ? user.loginCount
    : userLogs.filter(function (log) { return log.action === 'login'; }).length;
  var lastLog = userLogs[userLogs.length - 1];
  var tokenUsage = (user.tokenUsage && typeof user.tokenUsage === 'object')
    ? user.tokenUsage
    : { prompt: 0, completion: 0, total: 0 };

  return {
    userId: user.id,
    username: user.username,
    nickname: user.nickname,
    isTest: !!(user.isTest || user.isAdmin),
    isAdmin: !!user.isAdmin,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null,
    loginCount: loginCount,
    totalUsageTime: user.totalUsageTime || 0,
    tokenUsage: tokenUsage,
    lastAction: lastLog ? lastLog.action : null,
    lastActionTime: lastLog ? lastLog.timestamp : null
  };
}

/**
 * 获取用户统计信息（管理员功能，跨设备汇总版）：
 * 把本机的账号列表/日志与服务器端 /api/stats/summary 汇总的数据合并——
 * 服务器数据补全"其他设备上产生的登录次数/使用时长/Token 用量"，本机数据
 * 补全"服务器还没见过、但本机 localStorage 里已存在的账号"（如从未上报成功过的历史账号）。
 * 合并策略：同一 userId 取两边数值的较大值——登录次数/使用时长/Token 用量在服务器侧
 * 都是多设备持续累加后的累计值（通常 >= 本机单机数据），本机数据只用于兜底服务器
 * 里缺失的旧记录，因此取 max 而不是相加，避免本机数据已经上报过又被重复计入。
 * @returns {Promise<Array>}
 */
async function getUserStatsMerged() {
  var local = getUserStats();

  var remote = null;
  try {
    remote = await statsSync.fetchSummary();
  } catch (e) {
    remote = null;
  }

  if (!remote || !Array.isArray(remote.users)) {
    // 服务器不可用（例如本地开发未启动 server.js），退回本机数据
    return local;
  }

  var merged = {};
  local.forEach(function (u) { merged[u.userId] = Object.assign({}, u); });

  remote.users.forEach(function (ru) {
    var existing = merged[ru.userId];
    var remoteToken = (ru.tokenUsage && typeof ru.tokenUsage === 'object')
      ? ru.tokenUsage
      : { prompt: 0, completion: 0, total: 0 };

    if (!existing) {
      // 服务器上有、本机完全没有的账号（其他设备注册/登录过）
      merged[ru.userId] = {
        userId: ru.userId,
        username: ru.username,
        nickname: ru.nickname || '',
        isTest: !!ru.isTest,
        isAdmin: !!ru.isAdmin,
        createdAt: ru.createdAt || null,
        lastLoginAt: ru.lastLoginAt || null,
        loginCount: ru.loginCount || 0,
        totalUsageTime: ru.totalUsageTime || 0,
        tokenUsage: remoteToken,
        lastAction: ru.lastAction || null,
        lastActionTime: ru.lastActionTime || null
      };
    } else {
      // 同一账号：登录次数/使用时长/Token 取两边较大值（服务器侧是多设备累加后的
      // 累计值，通常更完整；取 max 而不是相加是为了避免本机数据已经上报过一次又被重复计入）
      existing.loginCount = Math.max(existing.loginCount || 0, ru.loginCount || 0);
      existing.totalUsageTime = Math.max(existing.totalUsageTime || 0, ru.totalUsageTime || 0);
      existing.tokenUsage = {
        prompt: Math.max((existing.tokenUsage && existing.tokenUsage.prompt) || 0, remoteToken.prompt || 0),
        completion: Math.max((existing.tokenUsage && existing.tokenUsage.completion) || 0, remoteToken.completion || 0),
        total: Math.max((existing.tokenUsage && existing.tokenUsage.total) || 0, remoteToken.total || 0)
      };
      // 测试权限以服务器为权威：admin 在别的设备切换开关后，这里必须用服务器值覆盖本地，
      // 否则监控页会一直显示本地旧值，开关状态与实际权限不一致
      existing.isTest = !!(ru.isTest || ru.isAdmin);
      existing.isAdmin = !!ru.isAdmin;
      if (!existing.lastLoginAt || (ru.lastLoginAt && ru.lastLoginAt > existing.lastLoginAt)) {
        existing.lastLoginAt = ru.lastLoginAt;
      }
      if (!existing.lastActionTime || (ru.lastActionTime && ru.lastActionTime > existing.lastActionTime)) {
        existing.lastActionTime = ru.lastActionTime;
        existing.lastAction = ru.lastAction;
      }
    }
  });

  return Object.values(merged);
}

/**
 * 获取合并后的登录日志（本机 + 服务器汇总，按时间倒序，去重简单按 userId+timestamp+action）
 * @param {Object} options - 同 getLoginLogs
 * @returns {Promise<Array>}
 */
async function getLoginLogsMerged(options) {
  var local = getLoginLogs(Object.assign({}, options, { limit: (options && options.limit) || 200 }));

  var remote = null;
  try {
    remote = await statsSync.fetchSummary();
  } catch (e) {
    remote = null;
  }
  if (!remote || !Array.isArray(remote.logs)) return local;

  var seen = {};
  var all = [];
  local.concat(remote.logs).forEach(function (log) {
    var key = log.userId + '|' + log.timestamp + '|' + log.action;
    if (seen[key]) return;
    seen[key] = true;
    all.push(log);
  });

  all.sort(function (a, b) { return b.timestamp - a.timestamp; });

  if (options) {
    if (options.userId) all = all.filter(function (l) { return l.userId === options.userId; });
    if (options.startTime) all = all.filter(function (l) { return l.timestamp >= options.startTime; });
    if (options.endTime) all = all.filter(function (l) { return l.timestamp <= options.endTime; });
    if (options.action) all = all.filter(function (l) { return l.action === options.action; });
  }
  var limit = (options && options.limit) || 100;
  return all.slice(0, limit);
}

/** 去除敏感字段（密码）后的用户副本 */
function _sanitize(user) {
  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname || '',
    avatar: user.avatar || '',
    isAdmin: !!user.isAdmin,
    isTest: !!(user.isTest || user.isAdmin),
    createdAt: user.createdAt
  };
}

export default {
  ensureAdminSeed: ensureAdminSeed,
  register: register,
  login: login,
  logout: logout,
  heartbeat: heartbeat,
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
  getUserStatsMerged: getUserStatsMerged
};