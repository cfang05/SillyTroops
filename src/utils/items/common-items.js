// utils/items/common-items.js
// 通用物品库：所有魔幻背景故事共享的基础物品定义
// 新增/修改通用物品只需在此文件的 COMMON_ITEMS 数组中操作

import { createItemDef, ITEM_SOURCE, ITEM_TYPE, ITEM_RARITY, EFFECT_TYPE } from './item-types.js';

/**
 * 通用物品定义列表
 * 这些物品在所有故事中均可使用
 */
const COMMON_ITEMS = [
  // ─── 消耗品 ────────────────────────────────────────────────
  createItemDef({
    id: 'healing_potion',
    name: '治疗药剂',
    description: '恢复少量生命的药剂，散发着淡淡的草药香气。',
    icon: '🧪',
    source: ITEM_SOURCE.COMMON,
    type: ITEM_TYPE.CONSUMABLE,
    rarity: ITEM_RARITY.COMMON,
    usable: true,
    consumable: true,
    stackable: true,
    maxStack: 10,
    effects: [
      { type: EFFECT_TYPE.RESTORE_HP, value: 50, description: '恢复50点生命值' }
    ]
  }),

  createItemDef({
    id: 'greater_healing_potion',
    name: '高级治疗药剂',
    description: '效力更强的治疗药剂，淡蓝色的液体在瓶中轻轻晃动。',
    icon: '💙',
    source: ITEM_SOURCE.COMMON,
    type: ITEM_TYPE.CONSUMABLE,
    rarity: ITEM_RARITY.UNCOMMON,
    usable: true,
    consumable: true,
    stackable: true,
    maxStack: 5,
    effects: [
      { type: EFFECT_TYPE.RESTORE_HP, value: 150, description: '恢复150点生命值' }
    ]
  }),

  createItemDef({
    id: 'mana_potion',
    name: '法力药剂',
    description: '蕴含魔法能量的蓝色药水，喝下后能感受到魔力涌动。',
    icon: '🔮',
    source: ITEM_SOURCE.COMMON,
    type: ITEM_TYPE.CONSUMABLE,
    rarity: ITEM_RARITY.COMMON,
    usable: true,
    consumable: true,
    stackable: true,
    maxStack: 10,
    effects: [
      { type: EFFECT_TYPE.RESTORE_MP, value: 50, description: '恢复50点法力值' }
    ]
  }),

  createItemDef({
    id: 'antidote',
    name: '解毒剂',
    description: '苦涩的绿色液体，能解除大多数普通毒素。',
    icon: '💚',
    source: ITEM_SOURCE.COMMON,
    type: ITEM_TYPE.CONSUMABLE,
    rarity: ITEM_RARITY.COMMON,
    usable: true,
    consumable: true,
    stackable: true,
    maxStack: 5,
    effects: [
      { type: EFFECT_TYPE.CUSTOM, description: '解除中毒状态' }
    ]
  }),

  // ─── 工具物品 ───────────────────────────────────────────────
  createItemDef({
    id: 'torch',
    name: '火把',
    description: '用布和木棒制成的火把，能在黑暗中提供光明，持续约1小时。',
    icon: '🔥',
    source: ITEM_SOURCE.COMMON,
    type: ITEM_TYPE.CONSUMABLE,
    rarity: ITEM_RARITY.COMMON,
    usable: true,
    consumable: true,
    stackable: true,
    maxStack: 10,
    effects: [
      { type: EFFECT_TYPE.CUSTOM, description: '照亮黑暗区域，持续1小时' }
    ]
  }),

  createItemDef({
    id: 'rope',
    name: '绳索',
    description: '结实的麻绳，约15米长，用途广泛。',
    icon: '🪢',
    source: ITEM_SOURCE.COMMON,
    type: ITEM_TYPE.MISC,
    rarity: ITEM_RARITY.COMMON,
    usable: true,
    consumable: false,
    stackable: true,
    maxStack: 5,
    effects: [
      { type: EFFECT_TYPE.CUSTOM, description: '用于攀爬、捆绑等场景，通过检定可获得优势' }
    ]
  }),

  createItemDef({
    id: 'lockpick',
    name: '撬锁工具',
    description: '一套精巧的撬锁工具，专业盗贼的必备装备。',
    icon: '🔑',
    source: ITEM_SOURCE.COMMON,
    type: ITEM_TYPE.MISC,
    rarity: ITEM_RARITY.UNCOMMON,
    usable: true,
    consumable: false,
    stackable: true,
    maxStack: 3,
    effects: [
      { type: EFFECT_TYPE.DICE_BONUS, value: 2, description: '开锁检定+2' }
    ]
  }),

  // ─── 基础武器 ───────────────────────────────────────────────
  createItemDef({
    id: 'basic_dagger',
    name: '普通匕首',
    description: '制作粗糙的匕首，但锋利足以防身。',
    icon: '🗡️',
    source: ITEM_SOURCE.COMMON,
    type: ITEM_TYPE.EQUIPMENT,
    rarity: ITEM_RARITY.COMMON,
    usable: true,
    consumable: false,
    stackable: false,
    maxStack: 1,
    effects: [
      { type: EFFECT_TYPE.DAMAGE, value: 5, description: '攻击判定造成的伤害+5' }
    ]
  }),

  // ─── 社交物品 ───────────────────────────────────────────────
  createItemDef({
    id: 'gold_coin',
    name: '金币',
    description: '闪闪发光的金质货币，在整个王国通用。',
    icon: '🪙',
    source: ITEM_SOURCE.COMMON,
    type: ITEM_TYPE.MISC,
    rarity: ITEM_RARITY.COMMON,
    usable: true,
    consumable: true,
    stackable: true,
    maxStack: 999,
    effects: [
      { type: EFFECT_TYPE.TRUST_BOOST, value: 5, description: '赠予NPC时，提升5点信任度' }
    ]
  }),

  createItemDef({
    id: 'wine_bottle',
    name: '一瓶美酒',
    description: '醇厚的红葡萄酒，来自南方产区，适合用于社交。',
    icon: '🍷',
    source: ITEM_SOURCE.COMMON,
    type: ITEM_TYPE.CONSUMABLE,
    rarity: ITEM_RARITY.COMMON,
    usable: true,
    consumable: true,
    stackable: true,
    maxStack: 5,
    effects: [
      { type: EFFECT_TYPE.RESTORE_SAN, value: 10, description: '恢复10点理智值' },
      { type: EFFECT_TYPE.TRUST_BOOST, value: 10, description: '与NPC共饮时，提升10点信任度' }
    ]
  })
];

/**
 * 建立 id → 定义 的查找表（快速访问）
 */
const COMMON_ITEMS_MAP = {};
COMMON_ITEMS.forEach(item => {
  COMMON_ITEMS_MAP[item.id] = item;
});

/**
 * 获取通用物品定义
 * @param {string} itemId
 * @returns {Object|null}
 */
function getCommonItemDef(itemId) {
  return COMMON_ITEMS_MAP[itemId] || null;
}

/**
 * 获取所有通用物品定义
 * @returns {Array}
 */
function getAllCommonItems() {
  return COMMON_ITEMS;
}

export { COMMON_ITEMS, COMMON_ITEMS_MAP, getCommonItemDef, getAllCommonItems };

export default {
  COMMON_ITEMS,
  COMMON_ITEMS_MAP,
  getCommonItemDef,
  getAllCommonItems
};
