// src/utils/account/conversationManager.js
// 对话存档管理器（P5.1 / P5.2 / D8 / D11）
//
// 与改造前的差别（这三条是本阶段的核心）：
//   1. **存档格式升级为 header + 消息分离（D11）**：
//        旧：{ cardId, cardName, ..., messages: [...], localVariables, worldInfoState, trpgState }
//        新：header = { schemaVersion, chatId, revision, cardId, ..., worldInfoState, localVariables, trpgState,
//                       messageCount, pageCount, pageSize }
//            messages 按页存放
//      旧档在 init() 时**一次性迁移**（迁移成功后才删除旧键）。
//   2. **介质从 localStorage 换到 IndexedDB（D8）**：
//        localStorage 是"一个键一整坨 + 同步写"，既有 5MB 配额也有主线程阻塞；
//        IndexedDB 容量大、异步、可按页读写。小程序端没有 IndexedDB → 自动退回本地存储（D3 保持现状）。
//   3. **写入按页增量**：只在"附录/尾部改动"时重写尾部若干页，而不是每次整份重写。
//
// 存储键（全部经 scopedKey 做用户隔离，沿用改造前的隔离语义）：
//   u_{uid}_conv_list                     → [{ cardId, cardName, updatedAt, messageCount, lastMessagePreview }]
//   u_{uid}_conv_{cardId}                 → header
//   u_{uid}_conv_{cardId}_p{n}            → 第 n 页消息数组
//
// 注：用户隔离键保持不变，因此**不同用户在同一台设备上不会互相覆盖**。

'use strict';

import { scopedKey } from './userScope.js';
import { IndexedDbAdapter, localAdapter } from '../storage/adapter';

/** 存档结构版本（D11）：将来改格式时据此迁移 */
export const CONVERSATION_SCHEMA_VERSION = 2;

/** 每页消息条数：越小写入越增量、读取越碎；100 与渲染窗口（MESSAGE_PAGE_SIZE）一致 */
const PAGE_SIZE = 100;

/** 旧版（v1）在 localStorage 里的键名，迁移时使用 */
const LEGACY_DATA_PREFIX = 'conversation_';
const LEGACY_LIST_KEY = 'conversation_list';

const DB_NAME = 'sillytroops_chats';

let _adapter = null;
let _initPromise = null;

/** 对话列表的内存缓存（getList/has 是同步 API，供页面同步渲染） */
let _listCache = [];

/**
 * 增量写入用的元信息：记录"上次写盘时前 N 条消息的引用"。
 * 只要前 N 条还是同一批对象引用，就只需要重写尾部的页。
 */
const _writeMeta = new Map(); // cardId -> { count: number, refs: any[], pageCount: number }

function _getAdapter() {
  if (_adapter) return _adapter;
  try {
    if (IndexedDbAdapter.isSupported()) {
      _adapter = new IndexedDbAdapter(DB_NAME);
    } else {
      // 小程序端等：退回本地存储，行为与改造前一致（D3）
      _adapter = localAdapter;
    }
  } catch (e) {
    console.warn('[ConversationManager] IndexedDB 不可用，退回本地存储:', e);
    _adapter = localAdapter;
  }
  return _adapter;
}

function _headerKey(cardId) { return scopedKey('conv_' + cardId); }
function _pageKey(cardId, page) { return scopedKey('conv_' + cardId + '_p' + page); }
function _listKey() { return scopedKey('conv_list'); }

// ─────────────────────────────────────────────────────────────
// v1 → v2 迁移（P5.1）
// ─────────────────────────────────────────────────────────────

/** 把 v1 的扁平记录包装成 v2 的 header（消息单独存） */
function _toV2Record(cardId, legacy) {
  return {
    header: {
      schemaVersion: CONVERSATION_SCHEMA_VERSION,
      chatId: 'chat_' + cardId,
      revision: 1,
      cardId: cardId,
      cardName: legacy.cardName || '',
      presetId: legacy.presetId || '',
      regexPresetId: legacy.regexPresetId || '',
      personaId: legacy.personaId || '',
      worldInfoState: legacy.worldInfoState || { sticky: {}, cooldown: {}, round: 0 },
      localVariables: legacy.localVariables || {},
      trpgState: legacy.trpgState || null,
      updatedAt: legacy.updatedAt || Date.now()
    },
    messages: Array.isArray(legacy.messages) ? legacy.messages : []
  };
}

/**
 * 扫描旧版 localStorage 存档并迁移到新介质。
 * 只有**写入成功**后才删除旧键，避免迁移过程中丢档。
 */
async function _migrateLegacy() {
  const adapter = _getAdapter();
  let legacyList = [];
  try {
    legacyList = uni.getStorageSync(scopedKey(LEGACY_LIST_KEY)) || [];
  } catch (e) {
    legacyList = [];
  }

  const cardIds = Array.isArray(legacyList)
    ? legacyList.map(i => (i && i.cardId) || '').filter(Boolean)
    : [];

  if (!cardIds.length) return;

  let migrated = 0;
  for (const cardId of cardIds) {
    try {
      const legacy = uni.getStorageSync(scopedKey(LEGACY_DATA_PREFIX + cardId));
      if (!legacy || !Array.isArray(legacy.messages)) continue;
      const v2 = _toV2Record(cardId, legacy);
      const ok = await _writeRecord(cardId, v2, { force: true });
      if (ok) {
        // 迁移过来的对话必须同时进入列表缓存，否则过渡页看不到它
        // （_writeRecord 只负责落盘，不维护列表）。
        _upsertListItem(cardId, v2);
        // 写入成功后才清理旧键
        try { uni.removeStorageSync(scopedKey(LEGACY_DATA_PREFIX + cardId)); } catch (e) { /* ignore */ }
        migrated++;
      }
    } catch (e) {
      console.warn('[ConversationManager] 迁移第 ' + cardId + ' 条存档失败（保留旧档）:', e);
    }
  }

  // 旧列表键在全部迁移完成后删除（还有失败项时保留，便于下次重试）
  if (migrated === cardIds.length) {
    try { uni.removeStorageSync(scopedKey(LEGACY_LIST_KEY)); } catch (e) { /* ignore */ }
  }
  if (migrated) {
    console.log('[ConversationManager] 已迁移 ' + migrated + '/' + cardIds.length + ' 条 v1 存档到 IndexedDB');
  }
}

// ─────────────────────────────────────────────────────────────
// 读写
// ─────────────────────────────────────────────────────────────

/** 读一条存档：header + 全部分页 → 组装成 { ...header, messages } */
async function load(cardId) {
  if (!cardId) return null;
  const adapter = _getAdapter();
  try {
    const header = await adapter.get(_headerKey(cardId));
    if (!header) return null;

    const pageCount = Number(header.pageCount) || 0;
    const pages = await Promise.all(
      Array.from({ length: pageCount }, (_, i) => adapter.get(_pageKey(cardId, i)))
    );
    const messages = [];
    pages.forEach(p => { if (Array.isArray(p)) messages.push(...p); });

    // 记录引用与版本，供后续增量写入判断（revision 必须一并记录，否则每次都会从 0 重新计数）
    _writeMeta.set(cardId, {
      count: messages.length,
      refs: messages.slice(),
      pageCount,
      revision: Number(header.revision) || 0
    });

    // v1 迁移残留（极少见）：header 存在但没有任何页
    if (messages.length === 0 && header.messageCount) {
      console.warn('[ConversationManager] header 声明有消息但分页为空:', cardId);
    }
    return Object.assign({}, header, { messages });
  } catch (e) {
    console.error('[ConversationManager] 读取存档失败:', e);
    return null;
  }
}

/**
 * 写一条存档
 * @param {{cardId:string, cardName?:string, presetId?:string, regexPresetId?:string, personaId?:string,
 *          messages:any[], localVariables?:object, worldInfoState?:object, trpgState?:any}} data
 * @returns {Promise<boolean>}
 */
async function save(data) {
  if (!data || !data.cardId) return false;
  const record = {
    header: {
      schemaVersion: CONVERSATION_SCHEMA_VERSION,
      chatId: 'chat_' + data.cardId,
      revision: 0,
      cardId: data.cardId,
      cardName: data.cardName || '',
      presetId: data.presetId || '',
      regexPresetId: data.regexPresetId || '',
      personaId: data.personaId || '',
      worldInfoState: data.worldInfoState || { sticky: {}, cooldown: {}, round: 0 },
      localVariables: data.localVariables || {},
      trpgState: data.trpgState || null,
      updatedAt: Date.now()
    },
    messages: Array.isArray(data.messages) ? data.messages : []
  };
  const ok = await _writeRecord(data.cardId, record);
  if (ok) _upsertListItem(data.cardId, record);
  return ok;
}

/**
 * 真正落盘：header + 需要重写的分页
 * @param {object} opts.force 迁移或强制全量重写
 */
async function _writeRecord(cardId, record, opts = {}) {
  const adapter = _getAdapter();
  const messages = record.messages || [];
  const pageCount = Math.max(1, Math.ceil(messages.length / PAGE_SIZE));
  const prev = _writeMeta.get(cardId);

  // 增量判断：前 prev.count 条是否还是同一批对象引用 → 只重写尾部页
  let firstDirtyPage = 0;
  if (!opts.force && prev && messages.length >= prev.count) {
    let same = true;
    for (let i = 0; i < prev.count; i++) {
      if (messages[i] !== prev.refs[i]) { same = false; break; }
    }
    if (same) firstDirtyPage = Math.floor(prev.count / PAGE_SIZE);
  }

  // 页数变少时，删掉多余页（避免读到陈旧数据）
  if (prev && prev.pageCount > pageCount) {
    for (let p = pageCount; p < prev.pageCount; p++) {
      try { await adapter.remove(_pageKey(cardId, p)); } catch (e) { /* ignore */ }
    }
  }

  // 注意：header/revision 必须在 try 之外声明 —— 早期版本把它们写在 try 里，
  // 出了 try 就引用不到（ReferenceError），导致"每次保存都报错、但错误被 catch 吞掉"，
  // 表现是迁移永远失败、存量老档一条都迁不过去。这是运行时断言抓出来的。
  let revision = 0;
  try {
    for (let p = firstDirtyPage; p < pageCount; p++) {
      const page = messages.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE).map(_leanMessage);
      await adapter.set(_pageKey(cardId, p), page);
    }
    revision = ((prev && prev.revision) || (record.header.revision || 0)) + 1;
    const header = Object.assign({}, record.header, {
      messageCount: messages.length,
      pageCount: pageCount,
      pageSize: PAGE_SIZE,
      revision: revision
    });
    await adapter.set(_headerKey(cardId), header);
  } catch (e) {
    console.error('[ConversationManager] 保存存档失败:', e);
    return false;
  }

  _writeMeta.set(cardId, { count: messages.length, refs: messages.slice(), pageCount, revision });
  return true;
}

/**
 * 存档前剥离"派生数据"（P1.4 / A4）：segments 可以由 content 现算重建，
 * 没必要跟着存档序列化（体积约为原文的 3~6 倍）。
 */
function _leanMessage(m) {
  if (!m || typeof m !== 'object') return m;
  // segments（正文渲染节点）与 reasoningDisplay（思考显示态）都是**可由原文现算**的派生数据，
  // 不入档；读档时按 content / reasoning 重算（P1.4 / A4 + P6.5）。
  // 注意 reasoning 本身要存 —— 它是内容，不是派生数据。
  if (m.segments === undefined && m.reasoningDisplay === undefined) return m;
  const copy = Object.assign({}, m);
  delete copy.segments;
  delete copy.reasoningDisplay;
  return copy;
}

/** 更新列表项（同步缓存 + 异步落盘） */
function _upsertListItem(cardId, record) {
  const msgs = record.messages || [];
  const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
  const item = {
    cardId: cardId,
    cardName: record.header.cardName || '',
    updatedAt: record.header.updatedAt,
    messageCount: msgs.length,
    lastMessagePreview: lastMsg && lastMsg.content ? String(lastMsg.content).slice(0, 40) : ''
  };
  const idx = _listCache.findIndex(i => i.cardId === cardId);
  if (idx >= 0) _listCache[idx] = item; else _listCache.unshift(item);
  _persistList();
}

async function _persistList() {
  try {
    await _getAdapter().set(_listKey(), _listCache);
  } catch (e) {
    console.error('[ConversationManager] 保存对话列表失败:', e);
  }
}

// ─────────────────────────────────────────────────────────────
// 列表与生命周期（同步 API 基于内存缓存）
// ─────────────────────────────────────────────────────────────

/** 对话历史列表（用于过渡页展示），按 updatedAt 倒序 */
function getList() {
  return _listCache.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function has(cardId) {
  return !!cardId && _listCache.some(i => i.cardId === cardId);
}

/**
 * 初始化：读取列表缓存 + 执行 v1→v2 迁移。
 * 页面在读取列表/存档之前**必须** await 它（幂等，可重复调用）。
 */
function init() {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    const adapter = _getAdapter();
    try {
      await _migrateLegacy();
      const list = await adapter.get(_listKey());
      _listCache = Array.isArray(list) ? list : [];
    } catch (e) {
      console.error('[ConversationManager] init 失败:', e);
      _listCache = [];
    }
  })();
  return _initPromise;
}

/** 清空某角色卡的存档（新建对话覆盖旧存档时使用） */
async function clear(cardId) {
  if (!cardId) return false;
  const adapter = _getAdapter();
  const header = await adapter.get(_headerKey(cardId)).catch(() => null);
  const pages = Number((header && header.pageCount) || 0);
  for (let p = 0; p < pages; p++) {
    try { await adapter.remove(_pageKey(cardId, p)); } catch (e) { /* ignore */ }
  }
  try { await adapter.remove(_headerKey(cardId)); } catch (e) { /* ignore */ }
  _writeMeta.delete(cardId);
  _listCache = _listCache.filter(i => i.cardId !== cardId);
  await _persistList();
  return true;
}

/** 删除历史对话（仅删对话记录，不影响角色卡本身），语义同 clear */
function remove(cardId) {
  return clear(cardId);
}

/** 重置内存缓存并重新初始化（导入备份后需要，确保读到新数据） */
function reload() {
  _initPromise = null;
  _listCache = [];
  _writeMeta.clear();
  return init();
}

/** 供备份服务使用：拿到对话存储所用的适配器（IndexedDB 或本地存储兜底） */
function getStorageAdapter() {
  return _getAdapter();
}

export default {
  CONVERSATION_SCHEMA_VERSION,
  init: init,
  reload: reload,
  getStorageAdapter: getStorageAdapter,
  getList: getList,
  has: has,
  load: load,
  get: load, // 兼容旧调用名
  save: save,
  clear: clear,
  remove: remove
};
