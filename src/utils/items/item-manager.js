// utils/items/item-manager.js
// 物品管理器（纯注册表，无 stateManager 依赖）
// 职责：
//   1. 加载通用物品库 + 当前角色卡物品（card.extensions.trpg.items）
//   2. 动态物品注册
//   3. 根据 ID 查找物品完整定义
//
// 统一说明：旧版含 giveItem/useItem/equipItem/unequipItem/buildInventoryDisplay 等
// 直接读写 stateManager（GAME_STATE_*）的方法已移除——它们属于"旧 TRPG 状态并行"的死代码，
// 运行时物品状态现统一由会话 trpgState.items 承担（见 chat.vue 的 inventoryItems 派生），
// 单一事实来源为 conversationManager 的 trpgState 字段。

import { ITEM_SOURCE, ITEM_TYPE, EFFECT_TYPE, createDynamicItem } from './item-types.js';
import { COMMON_ITEMS_MAP, getCommonItemDef } from './common-items.js';

/**
 * 运行时物品注册表
 * 包含：通用物品 + 当前角色卡物品 + 动态生成物品
 * key: itemId, value: ItemDef
 */
let _registry = {};

/**
 * 当前已加载的角色卡名（避免重复加载）
 */
let _currentStoryId = null;

// ═══════════════════════════════════════════════════════════
// 初始化与加载
// ═══════════════════════════════════════════════════════════

/**
 * 初始化物品管理器
 * 数据源为 card.extensions.trpg（items 字段）。
 * @param {Object} trpgConfig - card.extensions.trpg（含 items）
 * @param {string} [cardName] - 卡片名（用作 storyId 标识）
 */
function init(trpgConfig, cardName) {
  // 重置注册表，始终包含通用物品
  _registry = { ...COMMON_ITEMS_MAP };

  // 加载卡片专属物品
  if (trpgConfig && trpgConfig.items && typeof trpgConfig.items === 'object') {
    const storyId = cardName || 'unknown';
    _currentStoryId = storyId;

    Object.entries(trpgConfig.items).forEach(([itemId, itemData]) => {
      // 将卡片物品标准化后注册
      _registry[itemId] = _normalizeStoryItem(itemId, itemData, storyId);
    });

    console.log(`[ItemManager] 已加载卡片物品: ${Object.keys(trpgConfig.items).length} 个（卡片：${storyId}）`);
  }

  console.log(`[ItemManager] 初始化完成，物品总数: ${Object.keys(_registry).length}`);
}

/**
 * 标准化故事物品定义（兼容旧格式，支持装备属性）
 * @param {string} itemId
 * @param {Object} rawData - 卡片脚本中的原始物品数据
 * @param {string} storyId
 * @returns {Object} 标准化后的 ItemDef
 */
function _normalizeStoryItem(itemId, rawData, storyId) {
  return {
    id: itemId,
    name: rawData.name || itemId,
    description: rawData.description || rawData.desc || '',
    lore: rawData.lore || '',
    icon: rawData.icon || '📜',
    image: rawData.image || '',
    source: ITEM_SOURCE.STORY,
    type: rawData.type || ITEM_TYPE.MISC,
    rarity: rawData.rarity || 'common',
    equipable: rawData.equipable === true,
    equipSlot: rawData.equipSlot || null,
    usable: rawData.usable !== undefined ? rawData.usable : true,
    consumable: rawData.consumable !== undefined ? rawData.consumable : false,
    stackable: rawData.stackable !== undefined ? rawData.stackable : false,
    maxStack: rawData.maxStack || 1,
    storyId: storyId,
    effects: rawData.effects ? _normalizeEffects(rawData.effects) : [],
    passiveEffects: rawData.passiveEffects ? _normalizeEffects(rawData.passiveEffects) : [],
    equipEffects: rawData.equipEffects ? _normalizeEffects(rawData.equipEffects) : [],
    howToObtain: rawData.howToObtain || '',
    holdFlags: rawData.holdFlags || [],
    legendaryItemId: rawData.legendaryItemId || null,
    _raw: rawData
  };
}

/**
 * 标准化效果对象（兼容旧格式）
 */
function _normalizeEffects(effects) {
  if (!effects || typeof effects !== 'object') return [];
  if (Array.isArray(effects)) return effects;
  // 旧格式：普通对象 { key: value }，转换为数组
  return [{ type: EFFECT_TYPE.CUSTOM, description: JSON.stringify(effects) }];
}

// ═══════════════════════════════════════════════════════════
// 物品查找
// ═══════════════════════════════════════════════════════════

/**
 * 根据 ID 获取物品完整定义（优先级：注册表 > 通用库）
 * @param {string} itemId
 * @returns {Object|null}
 */
function getItemDef(itemId) {
  return _registry[itemId] || getCommonItemDef(itemId) || null;
}

/**
 * 批量获取物品定义
 * @param {string[]} itemIds
 * @returns {Object[]} 物品定义数组（找不到的跳过）
 */
function getItemDefs(itemIds) {
  return itemIds
    .map(id => getItemDef(id))
    .filter(def => def !== null);
}

/**
 * 获取当前注册表中的所有物品定义
 * @returns {Object[]}
 */
function getAllItemDefs() {
  return Object.values(_registry);
}

// ═══════════════════════════════════════════════════════════
// 动态物品注册
// ═══════════════════════════════════════════════════════════

/**
 * 注册动态生成的物品（LLM 实时创建）
 * @param {Object} llmData - LLM 返回的物品数据
 * @returns {Object} 注册后的物品定义（含生成的 ID）
 */
function registerDynamicItem(llmData) {
  const timestamp = Date.now();
  const generatedId = `dynamic_${timestamp}_${Math.random().toString(36).substr(2, 6)}`;
  const itemDef = createDynamicItem(generatedId, llmData);

  _registry[generatedId] = itemDef;
  console.log(`[ItemManager] 注册动态物品: ${itemDef.name} (${generatedId})`);
  return itemDef;
}

/**
 * 清理运行时状态（切换/结束会话时调用）
 */
function cleanup() {
  _registry = { ...COMMON_ITEMS_MAP };
  _currentStoryId = null;
  console.log('[ItemManager] 已清理运行时状态');
}

export default {
  // 初始化
  init,
  cleanup,
  // 查找
  getItemDef,
  getItemDefs,
  getAllItemDefs,
  // 动态物品
  registerDynamicItem
};
