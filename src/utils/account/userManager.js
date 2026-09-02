// src/utils/account/userManager.js
// 本地账号系统：注册/登录/用户设置，所有数据以 uni.setStorageSync 存储（遵循跨端约束）
// 每个用户的业务数据通过 userScope 的 scopedKey() 按 userId 前缀隔离
//
// 存储结构：
//   sillytroops_users            -> [{ id, username, password, nickname, avatar, isAdmin, isTest, createdAt }]
//   sillytroops_current_user_id  -> 当前登录用户 id
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
 * 确保内置 admin 账户存在（账户 admin / 密码 123，测试账号，可使用内置测试模型）
 * 应用启动时调用一次。原账号密码保持不变。
 */
function ensureAdminSeed() {
  var users = _getUsers();
  var admin = users.find(function (u) { return u.username === 'admin'; });
  if (!admin) {
    users.push({
      id: 'user_admin',
      username: 'admin',
      password: '123',
      nickname: '管理员',
      avatar: '',
      isAdmin: true,
      isTest: true,
      createdAt: Date.now()
    });
    _saveUsers(users);
    console.log('[UserManager] 已创建内置 admin 账户');
  } else if (!admin.isTest) {
    // 兼容旧数据：已存在的 admin 若缺少 isTest 标记，补上（不修改其密码）
    admin.isTest = true;
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
  try {
    uni.setStorageSync(CURRENT_USER_KEY, user.id);
  } catch (e) { /* ignore */ }
  return { success: true, user: _sanitize(user) };
}

function logout() {
  try {
    uni.removeStorageSync(CURRENT_USER_KEY);
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
  isTestAccount: isTestAccount
};