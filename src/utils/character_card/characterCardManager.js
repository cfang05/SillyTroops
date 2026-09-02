// src/utils/character_card/characterCardManager.js
// AI 角色卡（Character Card，酒馆语义）存储管理器
// 与 utils/character_info/character-manager.js（玩家扮演的 TRPG 角色/role）完全独立
//
// 概念说明：
//   - Role（玩家角色）  = 玩家在 TRPG 中扮演的角色，六维属性/HP/MP/装备，见 character-manager.js
//   - Character Card    = AI 扮演的 NPC/角色，酒馆语义字段（description/personality/scenario/first_mes等）
// 两者语义完全不同，存储也完全独立，不共享 storage key。
//
// 所有键通过 scopedKey() 按当前用户 ID 隔离（u_{userId}_ 前缀）。

import { scopedKey } from '../account/userScope.js';

function _cardKey(id) { return scopedKey('char_card_' + id); }
function _listKey() { return scopedKey('char_card_list'); }
function _activeKey() { return scopedKey('active_char_card'); }
function _lorebookKey(id) { return scopedKey('char_card_lorebook_' + id); }

function _genId() {
  return 'card_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function _getList() {
  try {
    var list = uni.getStorageSync(_listKey());
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function _saveList(list) {
  try {
    uni.setStorageSync(_listKey(), list);
    return true;
  } catch (e) {
    console.error('[CharacterCardManager] 保存列表失败:', e);
    return false;
  }
}

/**
 * 创建/导入角色卡
 * @param {Object} cardData - CharacterV2.data 结构的完整字段
 * @param {Array} [lorebookEntries] - 已标准化的世界书条目
 * @returns {string} cardId
 * @throws {Error} 存储失败时抛出（常见原因：avatar 内嵌图片过大导致超出本地存储配额），
 *                 调用方必须 catch 并向用户反馈"导入失败"，不能静默吞掉后仍报成功
 */
function createCard(cardData, lorebookEntries) {
  var id = _genId();
  var record = Object.assign({
    id: id,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }, cardData);

  try {
    uni.setStorageSync(_cardKey(id), record);
  } catch (e) {
    console.error('[CharacterCardManager] 创建角色卡失败（写入卡片数据）:', e);
    throw new Error('角色卡保存失败，可能是头像图片过大超出本地存储空间（' + (e && e.message ? e.message : e) + '）');
  }

  try {
    var list = _getList();
    list.unshift(id);
    var listSaved = _saveList(list);
    if (!listSaved) {
      // 列表写入失败：回滚刚写入的卡片数据，避免出现"能读到卡片但列表里没有"的孤儿记录
      uni.removeStorageSync(_cardKey(id));
      throw new Error('角色卡列表保存失败，可能超出本地存储空间');
    }

    if (Array.isArray(lorebookEntries) && lorebookEntries.length > 0) {
      uni.setStorageSync(_lorebookKey(id), lorebookEntries);
    }
  } catch (e) {
    console.error('[CharacterCardManager] 创建角色卡失败:', e);
    // 保证不留下孤儿卡片记录
    try { uni.removeStorageSync(_cardKey(id)); } catch (e2) { /* ignore */ }
    throw e instanceof Error ? e : new Error('角色卡保存失败：' + e);
  }

  return id;
}

function getCard(id) {
  if (!id) return null;
  try {
    var card = uni.getStorageSync(_cardKey(id));
    return card || null;
  } catch (e) {
    return null;
  }
}

function getAllCards() {
  var list = _getList();
  var cards = [];
  list.forEach(function(id) {
    var card = getCard(id);
    if (card) cards.push(card);
  });
  cards.sort(function(a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
  return cards;
}

/**
 * 递归深合并（对象级）：patch 中的嵌套对象与原对象合并，而非整体替换。
 * 数组与 null 直接替换。用于避免切 TRPG 开关时整体覆盖 extensions.trpg.items 等字段。
 */
function _deepMerge(base, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  if (base === null || typeof base !== 'object' || Array.isArray(base)) return patch;
  var out = Object.assign({}, base);
  Object.keys(patch).forEach(function (k) {
    out[k] = (patch[k] !== null && typeof patch[k] === 'object' && !Array.isArray(patch[k]))
      ? _deepMerge(base[k], patch[k])
      : patch[k];
  });
  return out;
}

function updateCard(id, updates) {
  var card = getCard(id);
  if (!card) return false;
  var updated = _deepMerge(card, updates);
  updated.updatedAt = Date.now();
  try {
    uni.setStorageSync(_cardKey(id), updated);
    return true;
  } catch (e) {
    console.error('[CharacterCardManager] 更新角色卡失败:', e);
    throw new Error('角色卡保存失败，可能是头像图片过大超出本地存储空间（' + (e && e.message ? e.message : e) + '）');
  }
}

function deleteCard(id) {
  try {
    uni.removeStorageSync(_cardKey(id));
    uni.removeStorageSync(_lorebookKey(id));
    var list = _getList().filter(function(cid) { return cid !== id; });
    _saveList(list);
    var activeId = getActiveCard();
    if (activeId === id) {
      uni.removeStorageSync(_activeKey());
    }
    return true;
  } catch (e) {
    console.error('[CharacterCardManager] 删除角色卡失败:', e);
    return false;
  }
}

function setActiveCard(id) {
  try {
    uni.setStorageSync(_activeKey(), id);
    return true;
  } catch (e) {
    return false;
  }
}

function getActiveCard() {
  try {
    return uni.getStorageSync(_activeKey()) || null;
  } catch (e) {
    return null;
  }
}

function getCardLorebook(id) {
  if (!id) return [];
  try {
    var entries = uni.getStorageSync(_lorebookKey(id));
    return Array.isArray(entries) ? entries : [];
  } catch (e) {
    return [];
  }
}

function setCardLorebook(id, entries) {
  try {
    uni.setStorageSync(_lorebookKey(id), Array.isArray(entries) ? entries : []);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 按键直查世界书条目（供战斗 getNPCDef / 场景条目 / 道具条目等使用）
 * @param {string} id - 卡片 id
 * @param {string} key - 关键词（条目 keys 数组里精确命中）
 * @returns {Object|null} 命中的条目，未找到返回 null
 */
function getLorebookEntryByKey(id, key) {
  if (!id || !key) return null;
  const entries = getCardLorebook(id);
  return entries.find(e => Array.isArray(e.keys) && e.keys.indexOf(key) !== -1) || null;
}

export default {
  createCard,
  getCard,
  getAllCards,
  updateCard,
  deleteCard,
  setActiveCard,
  getActiveCard,
  getCardLorebook,
  setCardLorebook,
  getLorebookEntryByKey
};