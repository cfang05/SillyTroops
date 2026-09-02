// src/utils/account/userScope.js
// 用户数据隔离工具：把任意存储键名转换为带当前用户前缀的键，实现按用户 ID 隔离存储
// 用法：storage.set(scopedKey('llm_presets'), data) —— 实际写入 u_{userId}_llm_presets
//
// 未登录时前缀为 u_guest_，保证游客态也能正常读写而不污染已登录用户数据。

'use strict';

import userManager from './userManager.js';

/**
 * 生成按当前用户隔离的存储键
 * @param {string} baseKey 原始键名
 * @returns {string} 带用户前缀的键名
 */
export function scopedKey(baseKey) {
  var uid = userManager.getCurrentUserId() || 'guest';
  return 'u_' + uid + '_' + baseKey;
}

/**
 * 生成指定用户的隔离存储键（用于跨用户读取，如管理场景）
 */
export function scopedKeyFor(userId, baseKey) {
  return 'u_' + (userId || 'guest') + '_' + baseKey;
}