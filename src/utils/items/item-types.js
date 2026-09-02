// utils/items/item-types.js
// 物品系统：类型常量与数据结构规范
//
// 注意：EFFECT_TYPE / EFFECT_TRIGGER / EFFECT_DURATION 已迁移至
//       utils/effects/effect-types.js，此处 re-export 保持向后兼容。

import {
  EFFECT_TYPE,
  EFFECT_TRIGGER,
  EFFECT_DURATION
} from '../effects/effect-types.js';

/**
 * 物品来源类型
 */
const ITEM_SOURCE = {
  COMMON: 'common',       // 通用物品（全局预设，所有故事可用）
  STORY: 'story',         // 故事专属物品（绑定到特定故事脚本）
  DYNAMIC: 'dynamic'      // 动态生成物品（LLM实时创建）
};

/**
 * 物品功能类型
 */
const ITEM_TYPE = {
  CONSUMABLE: 'consumable',   // 消耗品（使用后减少数量）
  EQUIPMENT: 'equipment',     // 装备（携带即生效）
  QUEST: 'quest',             // 任务物品（不可使用/丢弃）
  LEGENDARY: 'legendary',     // 传奇物品（账号级，跨局持久）
  MISC: 'misc'                // 杂项
};

/**
 * 物品稀有度
 * common   普通  白色
 * uncommon 优秀  绿色
 * rare     精良  蓝色
 * epic     史诗  紫色
 * legendary传说  橙色
 */
const ITEM_RARITY = {
  COMMON:    'common',    // 普通  白色
  UNCOMMON:  'uncommon',  // 优秀  绿色
  RARE:      'rare',      // 精良  蓝色
  EPIC:      'epic',      // 史诗  紫色
  LEGENDARY: 'legendary'  // 传说  橙色
};

/**
 * 根据 rarity 字符串返回对应的 CSS class 名
 * @param {string} rarity
 * @returns {string}
 */
function rarityClass(rarity) {
  const map = {
    common:    'rarity-common',
    uncommon:  'rarity-uncommon',
    rare:      'rarity-rare',
    epic:      'rarity-epic',
    legendary: 'rarity-legendary'
  };
  return map[(rarity || '').toLowerCase()] || 'rarity-common';
}

/**
 * 标准物品数据结构定义（参考/文档用途）
 *
 * @typedef {Object} ItemDef
 * @property {string}   id              - 唯一标识符（英文下划线命名）
 * @property {string}   name            - 显示名称
 * @property {string}   description     - 物品描述
 * @property {string}   icon            - emoji图标
 * @property {string}   [image]         - 图片路径（可选）
 * @property {string}   source          - 来源类型：ITEM_SOURCE 之一
 * @property {string}   type            - 功能类型：ITEM_TYPE 之一
 * @property {string}   rarity          - 稀有度：ITEM_RARITY 之一
 * @property {boolean}  usable          - 是否可在背包中主动使用
 * @property {boolean}  consumable      - 使用后是否消耗（减少数量）
 * @property {boolean}  stackable       - 是否可叠加数量
 * @property {number}   maxStack        - 最大堆叠数量
 * @property {string}   [storyId]       - 绑定的故事ID（source=STORY时必填）
 * @property {Effect[]} effects         - 使用效果列表
 * @property {Effect[]} [passiveEffects]- 携带时被动效果列表
 *
 * @typedef {Object} Effect
 * @property {string}   type            - 效果类型：EFFECT_TYPE 之一
 * @property {number}   [value]         - 数值
 * @property {string}   [target]        - 目标
 * @property {string}   [duration]      - 持续时间：EFFECT_DURATION 之一或数字（轮数）
 * @property {string}   [description]   - 效果描述
 */

/**
 * 创建物品定义的工厂函数（带默认值）
 * @param {Partial<ItemDef>} options
 * @returns {ItemDef}
 */
function createItemDef(options) {
  return {
    id: options.id,
    name: options.name || '未知物品',
    description: options.description || '',
    icon: options.icon || '📦',
    image: options.image || '',
    source: options.source || ITEM_SOURCE.COMMON,
    type: options.type || ITEM_TYPE.MISC,
    rarity: options.rarity || ITEM_RARITY.COMMON,
    usable: options.usable !== undefined ? options.usable : true,
    consumable: options.consumable !== undefined ? options.consumable : true,
    stackable: options.stackable !== undefined ? options.stackable : true,
    maxStack: options.maxStack || 99,
    storyId: options.storyId || null,
    effects: options.effects || [],
    passiveEffects: options.passiveEffects || []
  };
}

/**
 * 创建动态物品（LLM实时生成）
 * @param {string} generatedId
 * @param {Object} llmData
 * @returns {ItemDef}
 */
function createDynamicItem(generatedId, llmData) {
  return createItemDef({
    id: generatedId,
    name: llmData.name || '神秘物品',
    description: llmData.description || '',
    icon: llmData.icon || '✨',
    source: ITEM_SOURCE.DYNAMIC,
    type: ITEM_TYPE.MISC,
    rarity: llmData.rarity || ITEM_RARITY.COMMON,
    usable: llmData.usable !== undefined ? llmData.usable : true,
    consumable: llmData.consumable !== undefined ? llmData.consumable : true,
    effects: llmData.effects || [{
      type: EFFECT_TYPE.CUSTOM,
      description: llmData.effectDescription || '产生特殊效果'
    }]
  });
}

export { ITEM_SOURCE, ITEM_TYPE, EFFECT_TYPE, EFFECT_TRIGGER, EFFECT_DURATION, ITEM_RARITY, createItemDef, createDynamicItem, rarityClass };

export default {
  ITEM_SOURCE,
  ITEM_TYPE,
  EFFECT_TYPE,
  EFFECT_TRIGGER,
  EFFECT_DURATION,
  ITEM_RARITY,
  createItemDef,
  createDynamicItem,
  rarityClass
};
