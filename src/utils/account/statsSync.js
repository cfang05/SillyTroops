// src/utils/account/statsSync.js
// 账号统计跨设备同步：把本机（本浏览器）产生的登录/使用时长/Token 用量事件上报到
// 后端服务器（server.js 的 /api/stats/* 接口，JSON 文件持久化），并支持从服务器拉取
// 全部设备汇总后的统计数据。
//
// 背景：本项目账号系统的主存储是 uni.setStorageSync（H5 端即浏览器 localStorage），
// 天然按浏览器/设备隔离——管理员在自己的设备上打开监控页，永远看不到其他账号在
// 其他设备上产生的登录/时长数据，这正是「其他账号的登录情况在 admin 账号看不到」
// 的根因。这里通过服务器端一份共享的 JSON 存储把各设备的事件汇总起来，监控页
// 拉取时与本机数据合并展示，从而让管理员能看到跨设备的真实统计。
//
// 所有请求均为 best-effort：网络失败/未跑 server.js 的本地开发环境下静默忽略，
// 不能影响任何调用方的主流程（登录/登出/对话）。

'use strict';

/**
 * 上报一次统计事件（不等待也不关心结果）
 * @param {Object} payload
 * @param {string} payload.userId
 * @param {string} payload.username
 * @param {string} [payload.nickname]
 * @param {boolean} [payload.isAdmin]
 * @param {boolean} [payload.isTest]
 * @param {'login'|'logout'|'heartbeat'|'token'|'register'|'set-test'} payload.action
 * @param {number} [payload.sessionMs] - 本次新增的使用时长（毫秒）
 * @param {{prompt:number, completion:number}} [payload.tokenUsage] - 本次新增的 token 估算用量
 */
function reportEvent(payload) {
  // 未登录/缺少身份信息的事件没有统计意义（例如 App 启动 ensureAdminSeed 时还没登录），直接跳过
  if (!payload || !payload.userId || !payload.username || !payload.action) return
  // #ifdef H5
  try {
    fetch('/api/stats/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(function (e) {
      console.warn('[StatsSync] 上报统计事件失败（忽略，不影响主流程）:', e && e.message)
    })
  } catch (e) { /* ignore */ }
  // #endif
  // #ifndef H5
  // 小程序端暂无统一后端代理可用，跳过跨设备同步，只保留本地统计
  // #endif
}

/**
 * 拉取服务器汇总的统计数据（所有已上报过的设备/账号）
 * @returns {Promise<{users: Array, logs: Array}|null>} 失败时返回 null（调用方应回退本地数据）
 */
function fetchSummary() {
  // #ifdef H5
  return fetch('/api/stats/summary')
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .catch(function (e) {
      console.warn('[StatsSync] 拉取服务器汇总统计失败（回退本地数据）:', e && e.message);
      return null;
    });
  // #endif
  // #ifndef H5
  return Promise.resolve(null);
  // #endif
}

/**
 * 查询单个账号在服务器上的测试权限（权威值）。
 * 返回 boolean 表示服务器已明确记录该账号权限；返回 null 表示服务器无记录（未上报过）或请求失败。
 * @param {string} userId
 * @returns {Promise<boolean|null>}
 */
function fetchTestPermission(userId) {
  if (!userId) return Promise.resolve(null);
  // #ifdef H5
  return fetch('/api/stats/test-permission?userId=' + encodeURIComponent(userId))
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function (data) {
      return (data && typeof data.isTest === 'boolean') ? data.isTest : null;
    })
    .catch(function (e) {
      console.warn('[StatsSync] 拉取测试权限失败（回退本地值）:', e && e.message);
      return null;
    });
  // #endif
  // #ifndef H5
  return Promise.resolve(null);
  // #endif
}

export default {
  reportEvent: reportEvent,
  fetchSummary: fetchSummary,
  fetchTestPermission: fetchTestPermission
};