// src/utils/account/userManager.js
// 本地账号系统：注册/登录/用户设置，所有数据以 uni.setStorageSync 存储（遵循跨端约束）
// 每个用户的业务数据通过 userScope 的 scopedKey() 按 userId 前缀隔离
//
// 存储结构：
//   sillytroops_users            -> [{ id, username, password, nickname, avatar, isAdmin, isTest, createdAt, lastLoginAt, totalUsageTime }]
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
        createdAt: Date.now()
      });
      changed = true;
      console.log('[UserManager] 已创建测试账号: ' + acc.username);
    }
  });
  
  if (changed) {
    _saveUsers(users);
  }
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
    createdAt: Date.now()
  };
  users.push(user);
  _saveUsers(users);
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
  
  // 更新用户最后登录时间
  user.lastLoginAt = Date.now();
  if (!user.totalUsageTime) user.totalUsageTime = 0;
  _saveUsers(users);
  
  // 记录登录日志
  _logAction(user.id, user.username, 'login');
  
  // 开始新会话计时
  try {
    uni.setStorageSync(SESSION_START_KEY, Date.now());
    uni.setStorageSync(CURRENT_USER_KEY, user.id);
  } catch (e) { /* ignore */ }
  
  return { success: true, user: _sanitize(user) };
}

function logout() {
  var userId = getCurrentUserId();
  if (userId) {
    // 累加本次会话使用时长
    _updateSessionTime(userId);
    
    // 记录登出日志
    var user = getCurrentUser();
    if (user) {
      _logAction(userId, user.username, 'logout');
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

/** 当前用户是否为测试账号（含 admin；可无 Key 使用内置测试 API） */
function isTestAccount() {
  var user = getCurrentUser();
  return !!(user && (user.isTest || user.isAdmin));
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
    if (!sessionStart) return;
    
    var sessionDuration = Date.now() - sessionStart;
    var users = _getUsers();
    var user = users.find(function (u) { return u.id === userId; });
    if (user) {
      user.totalUsageTime = (user.totalUsageTime || 0) + sessionDuration;
      _saveUsers(users);
    }
  } catch (e) {
    console.warn('[UserManager] 更新使用时长失败:', e);
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
 * 获取用户统计信息（管理员功能）
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
      
      var userLogs = logs.filter(function (log) { return log.userId === userId; });
      var loginCount = userLogs.filter(function (log) { return log.action === 'login'; }).length;
      var lastLog = userLogs[userLogs.length - 1];
      
      return {
        userId: user.id,
        username: user.username,
        nickname: user.nickname,
        isTest: user.isTest || user.isAdmin,
        isAdmin: user.isAdmin,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt || null,
        loginCount: loginCount,
        totalUsageTime: user.totalUsageTime || 0,
        lastAction: lastLog ? lastLog.action : null,
        lastActionTime: lastLog ? lastLog.timestamp : null
      };
    } else {
      // 返回所有用户统计
      return users.map(function (user) {
        var userLogs = logs.filter(function (log) { return log.userId === user.id; });
        var loginCount = userLogs.filter(function (log) { return log.action === 'login'; }).length;
        var lastLog = userLogs[userLogs.length - 1];
        
        return {
          userId: user.id,
          username: user.username,
          nickname: user.nickname,
          isTest: user.isTest || user.isAdmin,
          isAdmin: user.isAdmin,
          createdAt: user.createdAt,
          lastLoginAt: user.lastLoginAt || null,
          loginCount: loginCount,
          totalUsageTime: user.totalUsageTime || 0,
          lastAction: lastLog ? lastLog.action : null,
          lastActionTime: lastLog ? lastLog.timestamp : null
        };
      });
    }
  } catch (e) {
    console.warn('[UserManager] 获取用户统计失败:', e);
    return userId ? null : [];
  }
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
  getCurrentUserId: getCurrentUserId,
  getCurrentUser: getCurrentUser,
  getUserById: getUserById,
  updateProfile: updateProfile,
  isAdmin: isAdmin,
  isTestAccount: isTestAccount,
  getLoginLogs: getLoginLogs,
  getUserStats: getUserStats
};