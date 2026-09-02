// src/utils/account/conversationManager.js
// 对话存档管理器：按用户隔离，每个角色卡仅一个状态存档（存档规则见需求 6）
//
// 存储结构（按用户隔离）：
//   u_{userId}_conversation_list         -> [{ cardId, cardName, updatedAt, messageCount, lastMessagePreview }]
//   u_{userId}_conversation_{cardId}     -> { cardId, presetId, regexPresetId, personaId, messages, localVariables, updatedAt }
//
// 说明：以 cardId 作为存档唯一键，"一个角色卡一个存档"。新建对话若已存在存档，由调用方（新建流程）
//       先确认并调用 clear() 清空，再写入。

'use strict';

import { scopedKey } from './userScope.js';

function _listKey() { return scopedKey('conversation_list'); }
function _dataKey(cardId) { return scopedKey('conversation_' + cardId); }

/** 对话历史列表（用于过渡页展示），按 updatedAt 倒序 */
function getList() {
  try {
    var list = uni.getStorageSync(_listKey());
    if (!Array.isArray(list)) return [];
    return list.slice().sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
  } catch (e) {
    return [];
  }
}

function _saveList(list) {
  try {
    uni.setStorageSync(_listKey(), list);
    return true;
  } catch (e) {
    console.error('[ConversationManager] 保存列表失败:', e);
    return false;
  }
}

/** 读取某角色卡的完整对话存档（不存在返回 null） */
function get(cardId) {
  if (!cardId) return null;
  try {
    return uni.getStorageSync(_dataKey(cardId)) || null;
  } catch (e) {
    return null;
  }
}

function has(cardId) {
  return !!get(cardId);
}

/**
 * 保存/更新某角色卡的对话存档，并同步列表项
 * @param {Object} data { cardId, cardName, presetId, regexPresetId, personaId, messages, localVariables, worldInfoState }
 */
function save(data) {
  if (!data || !data.cardId) return false;
  var worldInfoState = data.worldInfoState || { sticky: {}, cooldown: {}, round: 0 };
  var record = {
    cardId: data.cardId,
    cardName: data.cardName || '',
    presetId: data.presetId || '',
    regexPresetId: data.regexPresetId || '',
    personaId: data.personaId || '',
    messages: Array.isArray(data.messages) ? data.messages : [],
    localVariables: data.localVariables || {},
    worldInfoState: worldInfoState,
    trpgState: data.trpgState || null,
    updatedAt: Date.now()
  };
  console.log('[ConversationManager] 写入 worldInfoState: sticky=' + Object.keys(worldInfoState.sticky || {}).length + '条, cooldown=' + Object.keys(worldInfoState.cooldown || {}).length + '条');
  try {
    uni.setStorageSync(_dataKey(data.cardId), record);
  } catch (e) {
    console.error('[ConversationManager] 保存存档失败:', e);
    return false;
  }
  _upsertListItem(record);
  return true;
}

function _upsertListItem(record) {
  var list = getList();
  var msgs = record.messages || [];
  var lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
  var preview = lastMsg && lastMsg.content ? String(lastMsg.content).slice(0, 40) : '';
  var item = {
    cardId: record.cardId,
    cardName: record.cardName,
    updatedAt: record.updatedAt,
    messageCount: msgs.length,
    lastMessagePreview: preview
  };
  var idx = list.findIndex(function (i) { return i.cardId === record.cardId; });
  if (idx >= 0) list[idx] = item;
  else list.unshift(item);
  _saveList(list);
}

/** 清空某角色卡的对话存档（新建对话覆盖旧存档时使用） */
function clear(cardId) {
  if (!cardId) return false;
  try {
    uni.removeStorageSync(_dataKey(cardId));
  } catch (e) { /* ignore */ }
  var list = getList().filter(function (i) { return i.cardId !== cardId; });
  _saveList(list);
  return true;
}

/** 删除历史对话（仅删除对话记录，不影响角色卡本身），语义同 clear */
function remove(cardId) {
  return clear(cardId);
}

export default {
  getList: getList,
  get: get,
  has: has,
  save: save,
  clear: clear,
  remove: remove
};