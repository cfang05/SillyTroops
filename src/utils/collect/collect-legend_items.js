// utils/collect/collect-legend_items.js
// 传奇物品管理（账号级，按 openid 存储）
// 所有传奇物品的定义、图标、描述、效果均在此文件统一管理

const STORAGE_KEY_PREFIX = 'collected_legend_items';

/**
 * 生成存储键名
 */
function getStorageKey(openid) {
  if (!openid) {
    console.warn('[CollectLegendItems] openid 为空');
    return null;
  }
  return `${STORAGE_KEY_PREFIX}_${openid}`;
}

/**
 * 所有可收集的传奇物品定义
 * - id: 唯一标识
 * - name: 物品名称
 * - icon: 显示图标（emoji）
 * - image: 图片路径（可选，优先于icon显示）
 * - description: 物品描述
 * - effect: 游戏效果
 * - rarity: 稀有度
 * - usable: 是否可在背包中主动使用
 * - defaultUnlocked: 是否默认解锁（所有新账号默认拥有）
 */
const LEGEND_ITEMS = [
  {
    id: 'starter_dagger',
    name: '初始的匕首',
    icon: '🗡️',
    image: '',
    description: '方便携带的短刃武器，每位旅者都会携带。',
    effect: '攻击判定时造成的伤害+5',
    rarity: 'common',
    usable: true,        // 可通过背包交互（装备）
    equipable: true,     // 可装备（装备槽位类型）
    equipSlot: 'mainWeapon', // 默认装入主武器槽
    defaultUnlocked: true
  },
  {
    id: 'reins_dagger',
    name: '老雷恩的匕首',
    icon: '🗡️',
    image: '',
    description: '刻有王都骑士团徽记的精铁匕首，刀刃经过无数次磨砺依然锋利。这是老雷恩隐退时深埋的见证，如今由你传承。',
    effect: '攻击判定+8，持有者散发出令人敬畏的气场',
    rarity: 'legendary',
    usable: true,
    equipable: true,
    equipSlot: 'mainWeapon',
    defaultUnlocked: false,
    fromStory: 'tavern-mystery',     // 来源故事
    unlockCondition: '在「酒馆之谜」中赢得老雷恩完全信任，帮助他解开过去的秘密'
  }
];

/**
 * 根据ID获取物品定义（静态数据，不需要openid）
 * @param {string} itemId
 * @returns {Object|null}
 */
function getItemDef(itemId) {
  return LEGEND_ITEMS.find(i => i.id === itemId) || null;
}

/**
 * 获取所有物品定义列表
 * @returns {Array}
 */
function getAllItemDefs() {
  return LEGEND_ITEMS;
}

/**
 * 获取用户已获得的物品ID列表（从本地存储）
 * @param {string} openid
 * @returns {Array<string>}
 */
function getCollectedItems(openid) {
  const key = getStorageKey(openid);
  if (!key) return [];

  try {
    const stored = uni.getStorageSync(key);
    return stored || [];
  } catch (error) {
    console.error('[CollectLegendItems] 获取收集物品失败:', error);
    return [];
  }
}

/**
 * 保存收集的物品ID列表
 * @param {string} openid
 * @param {Array<string>} items
 */
function saveCollectedItems(openid, items) {
  const key = getStorageKey(openid);
  if (!key) return;

  try {
    uni.setStorageSync(key, items);
  } catch (error) {
    console.error('[CollectLegendItems] 保存收集物品失败:', error);
  }
}

/**
 * 获取用户所有已解锁的物品（含defaultUnlocked）
 * @param {string} openid
 * @returns {Array} 已解锁的物品完整信息数组
 */
function getUnlockedItems(openid) {
  const collectedIds = getCollectedItems(openid);
  return LEGEND_ITEMS.filter(item => {
    return item.defaultUnlocked || collectedIds.includes(item.id);
  });
}

/**
 * 添加收集的物品
 * @param {string} openid
 * @param {string} itemId
 * @returns {boolean} 是否成功添加（已存在则返回false）
 */
function addCollectedItem(openid, itemId) {
  const collectedIds = getCollectedItems(openid);
  if (!collectedIds.includes(itemId)) {
    collectedIds.push(itemId);
    saveCollectedItems(openid, collectedIds);
    console.log(`[CollectLegendItems] 添加物品: ${itemId}`);
    return true;
  }
  return false;
}

/**
 * 移除收集的物品（不可移除defaultUnlocked的物品）
 * @param {string} openid
 * @param {string} itemId
 */
function removeCollectedItem(openid, itemId) {
  const item = getItemDef(itemId);
  if (item && item.defaultUnlocked) {
    console.warn('[CollectLegendItems] 无法移除默认解锁物品:', itemId);
    return;
  }
  const collectedIds = getCollectedItems(openid);
  const filtered = collectedIds.filter(id => id !== itemId);
  if (filtered.length !== collectedIds.length) {
    saveCollectedItems(openid, filtered);
    console.log(`[CollectLegendItems] 移除物品: ${itemId}`);
  }
}

/**
 * 解锁物品
 * @param {string} openid
 * @param {string} itemId
 * @returns {boolean}
 */
function unlockItem(openid, itemId) {
  return addCollectedItem(openid, itemId);
}

/**
 * 检查物品是否已解锁
 * @param {string} openid
 * @param {string} itemId
 * @returns {boolean}
 */
function isItemUnlocked(openid, itemId) {
  const item = getItemDef(itemId);
  if (!item) return false;
  if (item.defaultUnlocked) return true;
  const collectedIds = getCollectedItems(openid);
  return collectedIds.includes(itemId);
}

/**
 * 获取物品完整信息（含解锁状态）
 * @param {string} openid - 可传null，则不计算解锁状态
 * @param {string} itemId
 * @returns {Object|null}
 */
function getItemById(openid, itemId) {
  const item = getItemDef(itemId);
  if (!item) return null;
  return {
    ...item,
    unlocked: openid ? isItemUnlocked(openid, itemId) : item.defaultUnlocked
  };
}

export default {
  LEGEND_ITEMS,
  getItemDef,
  getAllItemDefs,
  getCollectedItems,
  getUnlockedItems,
  addCollectedItem,
  removeCollectedItem,
  unlockItem,
  isItemUnlocked,
  getItemById
};
