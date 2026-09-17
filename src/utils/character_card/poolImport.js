// src/utils/character_card/poolImport.js
// 「卡池导入」相关的共同约定：卡片来自卡池时的标记字段，以及"新导入"标识的判定。
//
// 为什么要有这个模块：
//   卡池导入的卡片要在**两个**页面显示「新导入」标识（角色卡库、选择角色卡），
//   如果两边各写一套"是否新导入"的逻辑，迟早出现一边显示一边不显示。
//   判定规则（保持一天）只在这里定义一次。

'use strict';

/** 「新导入」标识保持的时长：24 小时 */
export const NEW_IMPORT_BADGE_MS = 24 * 60 * 60 * 1000;

/** 卡片来自卡池时，记录来源卡池卡片的 id（用于"是否已导入"判定） */
export const SOURCE_CARD_ID_FIELD = 'sourceCardId';

/** 卡片来自卡池时，记录导入时间戳（用于「新导入」标识） */
export const IMPORTED_AT_FIELD = 'importedFromPoolAt';

/**
 * 是否显示「新导入」标识：来自卡池、且导入时间在 24 小时以内。
 *
 * 除了"来自卡池"之外不需要别的条件 —— 只有从卡池导入的卡片才有导入时间戳，
 * 用户自己导入的酒馆卡不会被标成"新导入"（那不是这次功能要表达的语义）。
 *
 * @param {object} card 角色卡记录
 * @param {number} [now] 当前时间（便于测试注入）
 * @returns {boolean}
 */
export function isNewImport(card, now) {
  if (!card) return false;
  const ts = Number(card[IMPORTED_AT_FIELD]);
  if (!Number.isFinite(ts) || ts <= 0) return false;
  const t = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const diff = t - ts;
  // 未来时间戳（设备时钟被调过）也按"新"处理，避免刚导入就不显示
  return diff < NEW_IMPORT_BADGE_MS;
}

/**
 * 在本地角色卡里找出"某张卡池卡片"对应的记录。
 * 只认 sourceCardId —— 用名字匹配会误判（不同卡池卡片可能重名）。
 *
 * @param {Array<object>} cards 本地角色卡列表
 * @param {string} poolCardId 卡池卡片 id
 * @returns {object|null}
 */
export function findImportedCard(cards, poolCardId) {
  const id = String(poolCardId || '');
  if (!id || !Array.isArray(cards)) return null;
  return cards.find((c) => c && String(c[SOURCE_CARD_ID_FIELD] || '') === id) || null;
}

export default { NEW_IMPORT_BADGE_MS, isNewImport, findImportedCard, SOURCE_CARD_ID_FIELD, IMPORTED_AT_FIELD };
