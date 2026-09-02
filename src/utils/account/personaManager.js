// src/utils/account/personaManager.js
// Persona（用户角色）管理器 —— 对齐酒馆 personas.js 的语义：
//   Persona 是"玩家自己"在对话中的身份，绑定 {{user}} 宏（名字）与描述。
//   支持创建多个 Persona，其中一个为"当前出场"，按用户 ID 隔离存储。
//
// 与 TRPG 的 character-manager.js（六维属性角色）不同：Persona 只承载对话身份（名字/头像/描述），
// 保留现有 TRPG 结构不动，这里是在其之上新增的酒馆式身份层。
//
// 存储结构（按用户隔离）：
//   u_{userId}_personas          -> [{ id, name, avatar, description, createdAt, updatedAt }]
//   u_{userId}_active_persona_id -> 当前出场 persona id

'use strict';

import { scopedKey } from './userScope.js';

function _genId() {
  return 'persona_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function _listKey() { return scopedKey('personas'); }
function _activeKey() { return scopedKey('active_persona_id'); }

function getAll() {
  try {
    var list = uni.getStorageSync(_listKey());
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function _saveAll(list) {
  try {
    uni.setStorageSync(_listKey(), list);
    return true;
  } catch (e) {
    console.error('[PersonaManager] 保存失败:', e);
    return false;
  }
}

function getById(id) {
  return getAll().find(function (p) { return p.id === id; }) || null;
}

/**
 * 创建 Persona
 * @param {{name:string, avatar?:string, description?:string}} data
 * @returns {string} personaId
 */
function create(data) {
  var list = getAll();
  var persona = {
    id: _genId(),
    name: (data && data.name) || '',
    avatar: (data && data.avatar) || '',
    description: (data && data.description) || '',
    trpgProfile: (data && data.trpgProfile) || null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  list.unshift(persona);
  _saveAll(list);
  // 若之前没有任何 persona，自动设为出场
  if (!getActiveId()) setActive(persona.id);
  return persona.id;
}

/** 深合并 TRPG 数值档案（attributes/equipment/proficiencies 子对象保留原值） */
function _mergeProfile(base, patch) {
  base = base || {};
  var out = Object.assign({}, base, patch);
  if (patch.attributes) out.attributes = Object.assign({}, base.attributes, patch.attributes);
  if (patch.equipment) out.equipment = Object.assign({}, base.equipment, patch.equipment);
  if (patch.proficiencies) out.proficiencies = Object.assign({}, base.proficiencies, patch.proficiencies);
  return out;
}

function update(id, updates) {
  var list = getAll();
  var idx = list.findIndex(function (p) { return p.id === id; });
  if (idx < 0) return false;
  if (typeof updates.name === 'string') list[idx].name = updates.name;
  if (typeof updates.avatar === 'string') list[idx].avatar = updates.avatar;
  if (typeof updates.description === 'string') list[idx].description = updates.description;
  if (updates.trpgProfile !== undefined) {
    list[idx].trpgProfile = _mergeProfile(list[idx].trpgProfile, updates.trpgProfile);
  }
  list[idx].updatedAt = Date.now();
  _saveAll(list);
  return true;
}

function remove(id) {
  var list = getAll().filter(function (p) { return p.id !== id; });
  _saveAll(list);
  if (getActiveId() === id) {
    // 删除当前出场后，回退到列表第一个（若有）
    try {
      if (list.length > 0) {
        uni.setStorageSync(_activeKey(), list[0].id);
      } else {
        uni.removeStorageSync(_activeKey());
      }
    } catch (e) { /* ignore */ }
  }
  return true;
}

function setActive(id) {
  try {
    uni.setStorageSync(_activeKey(), id);
    return true;
  } catch (e) {
    return false;
  }
}

function getActiveId() {
  try {
    return uni.getStorageSync(_activeKey()) || null;
  } catch (e) {
    return null;
  }
}

function getActive() {
  var id = getActiveId();
  return id ? getById(id) : null;
}

export default {
  getAll: getAll,
  getById: getById,
  create: create,
  update: update,
  remove: remove,
  setActive: setActive,
  getActiveId: getActiveId,
  getActive: getActive
};