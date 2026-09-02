// utils/account/account-manager.js
// 账号管理器 - 统一提供账号级物品/特性的存取

import collectLegendItems from '../collect/collect-legend_items.js';
import collectTrait from '../collect/collect-trait.js';

/**
 * 初始化账号数据
 * @param {string} openid - 用户openid
 * @returns {Promise<Object>} 账号数据
 */
async function initAccount(openid) {
  if (!openid) {
    console.warn('[AccountManager] initAccount: openid 为空');
    return { success: false, message: 'openid 为空' };
  }
  
  try {
    // 确保存储初始化（读取一次即可触发初始化）
    const items = collectLegendItems.getCollectedItems(openid);
    const traits = collectTrait.getCollectedTraits(openid);
    
    console.log(`[AccountManager] 账号初始化成功: ${openid}`);
    console.log(`[AccountManager] - 传奇物品数: ${items.length}`);
    console.log(`[AccountManager] - 特性数: ${traits.length}`);
    
    return {
      success: true,
      openid,
      legendaryItems: items,
      traits: traits
    };
  } catch (error) {
    console.error('[AccountManager] 初始化账号失败:', error);
    return { success: false, message: error.message || '初始化失败' };
  }
}

/**
 * 获取传奇物品列表
 * @param {string} openid - 用户openid
 * @returns {Array<string>} 传奇物品ID数组
 */
function getLegendaryItems(openid) {
  if (!openid) {
    console.warn('[AccountManager] getLegendaryItems: openid 为空');
    return [];
  }
  
  return collectLegendItems.getCollectedItems(openid);
}

/**
 * 添加传奇物品
 * @param {string} openid - 用户openid
 * @param {string} itemId - 物品ID
 * @returns {boolean} 是否成功添加
 */
function addLegendaryItem(openid, itemId) {
  if (!openid) {
    console.warn('[AccountManager] addLegendaryItem: openid 为空');
    return false;
  }
  
  const success = collectLegendItems.addCollectedItem(openid, itemId);
  
  if (success) {
    console.log(`[AccountManager] 添加传奇物品成功: ${itemId}`);
  }
  
  return success;
}

/**
 * 移除传奇物品
 * @param {string} openid - 用户openid
 * @param {string} itemId - 物品ID
 */
function removeLegendaryItem(openid, itemId) {
  if (!openid) {
    console.warn('[AccountManager] removeLegendaryItem: openid 为空');
    return;
  }
  
  collectLegendItems.removeCollectedItem(openid, itemId);
  console.log(`[AccountManager] 移除传奇物品: ${itemId}`);
}

/**
 * 获取特性列表
 * @param {string} openid - 用户openid
 * @returns {Array<string>} 特性ID数组
 */
function getTraits(openid) {
  if (!openid) {
    console.warn('[AccountManager] getTraits: openid 为空');
    return [];
  }
  
  return collectTrait.getCollectedTraits(openid);
}

/**
 * 添加特性
 * @param {string} openid - 用户openid
 * @param {string} traitId - 特性ID
 * @returns {boolean} 是否成功添加
 */
function addTrait(openid, traitId) {
  if (!openid) {
    console.warn('[AccountManager] addTrait: openid 为空');
    return false;
  }
  
  const success = collectTrait.addCollectedTrait(openid, traitId);
  
  if (success) {
    console.log(`[AccountManager] 添加特性成功: ${traitId}`);
  }
  
  return success;
}

/**
 * 移除特性
 * @param {string} openid - 用户openid
 * @param {string} traitId - 特性ID
 */
function removeTrait(openid, traitId) {
  if (!openid) {
    console.warn('[AccountManager] removeTrait: openid 为空');
    return;
  }
  
  collectTrait.removeCollectedTrait(openid, traitId);
  console.log(`[AccountManager] 移除特性: ${traitId}`);
}

/**
 * 获取账号完整数据
 * @param {string} openid - 用户openid
 * @returns {Object} 账号数据
 */
function getAccountData(openid) {
  if (!openid) {
    console.warn('[AccountManager] getAccountData: openid 为空');
    return {
      openid: null,
      legendaryItems: [],
      traits: []
    };
  }
  
  return {
    openid,
    legendaryItems: getLegendaryItems(openid),
    traits: getTraits(openid)
  };
}

export default {
  initAccount,
  getLegendaryItems,
  addLegendaryItem,
  removeLegendaryItem,
  getTraits,
  addTrait,
  removeTrait,
  getAccountData
};
