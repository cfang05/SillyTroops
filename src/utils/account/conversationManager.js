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

import { scopedKey, scopedKeyFor } from './userScope.js';
import userManager from './userManager.js';
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

/** 上一次 init/hydrate 时的 uid：账号切换后必须重建，否则会把上一个账号的列表给下一个账号看 */
let _hydratedUid = '';

/**
 * 增量写入用的元信息：记录"上次写盘时前 N 条消息的引用"。
 * 只要前 N 条还是同一批对象引用，就只需要重写尾部的页。
 */
const _writeMeta = new Map(); // cardId -> { count: number, refs: any[], pageCount: number }

/** 当前账号 id（与 scopedKey 内部口径一致：未登录 = guest） */
function _uid() {
  try { return userManager.getCurrentUserId() || 'guest'; } catch (e) { return 'guest'; }
}

/**
 * 账号切换检测：uid 变了就丢掉当前账号的内存态（列表 + 增量写入元信息）。
 *
 * 为什么必须做：`scopedKey('conv_...')` 每次都是按"当前 uid"算的，所以存档本身不会串；
 * 但 `_listCache` 和 `_writeMeta` 是**进程内**的内存态 —— 上一个账号登录期间 put 进去的条目，
 * 如果不作废，换账号后就可能被当作本账号的列表渲染出去（跨账号可见），
 * `_writeMeta` 的失效引用判断还会让增量写入误判"前 N 条没变"而漏写分页（坏档）。
 * @returns {boolean} 发生了切换（调用方应重新 init）
 */
function _ensureFreshUid() {
  const uid = _uid();
  if (_hydratedUid && uid !== _hydratedUid) {
    console.log('[ConversationManager] 检测到账号切换，重建列表缓存与写入元信息');
    _listCache = [];
    _writeMeta.clear();
    _initPromise = null;
    _hydratedUid = uid;
    return true;
  }
  return false;
}

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

// ── 显式 uid 版本：只用于"其他账号遗留数据的迁移"（D20）──
// 键里本来就刻着 uid，因此迁移别人的存档时不能用 scopedKey（那会写到当前账号名下）。
function _headerKeyOf(uid, cardId) { return scopedKeyFor(uid, 'conv_' + cardId); }
function _pageKeyOf(uid, cardId, page) { return scopedKeyFor(uid, 'conv_' + cardId + '_p' + page); }
function _listKeyOf(uid) { return scopedKeyFor(uid, 'conv_list'); }

/** v1 老档的键（同样按显式 uid 拼，迁移其他账号时用） */
function _legacyDataKeyOf(uid, cardId) { return scopedKeyFor(uid, LEGACY_DATA_PREFIX + cardId); }
function _legacyListKeyOf(uid) { return scopedKeyFor(uid, LEGACY_LIST_KEY); }

/**
 * 从 v1 数据键里解析出 uid 与 cardId。
 * 用**贪婪**前缀：uid 本身含下划线（user_admin），必须在**最后**一个 `_conversation_`
 * 处切分；cardId 也可能是 `card_xxx` 或测试里的 `c1`，所以不能靠 card_ 前缀锚定。
 */
const LEGACY_DATA_RE = /^u_(.+)_conversation_(.+)$/;
const LEGACY_LIST_RE = /^u_(.+)_conversation_list$/;

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
 * 扫出"每个账号残留的 v1 数据键"：uid -> [cardId, ...]
 *
 * 与改造前的关键差别（D20）：**不再依赖 conversation_list**。
 * 改前是"读列表拿到 cardId，再按 cardId 找存档"，所以只要列表键丢了/为空，
 * 那批存档就永远不会被迁移、也不会被删 —— 数据还在本地存储里，但新界面读不到，
 * 表现为"历史莫名其妙空白"（假性丢失）。改成直接扫前缀后，名单丢了也能救回来。
 */
function _scanLegacyKeys() {
  const byUid = new Map();
  for (const k of _allStorageKeys()) {
    if (LEGACY_LIST_RE.test(k)) continue; // conversation_list 是名单键，不是数据键
    const m = k.match(LEGACY_DATA_RE);
    if (!m) continue;
    if (!byUid.has(m[1])) byUid.set(m[1], []);
    byUid.get(m[1]).push(m[2]);
  }
  return byUid;
}

/** 本地存储全部键名（读不到就当空） */
function _allStorageKeys() {
  try {
    const info = uni.getStorageInfoSync();
    return Array.isArray(info && info.keys) ? info.keys : [];
  } catch (e) {
    return [];
  }
}

/** 该账号是否还有没搬走的 v1 数据键（有 → 旧列表键先留着，下次还能重试） */
function _hasLegacyDataLeft(uid) {
  const prefix = scopedKeyFor(uid, LEGACY_DATA_PREFIX);
  for (const k of _allStorageKeys()) {
    if (k.indexOf(prefix) === 0 && !LEGACY_LIST_RE.test(k)) return true;
  }
  return false;
}

/** v1 数据键都搬走了 → 删掉该账号的旧列表键（下次不用再扫它） */
function _cleanupLegacyList(uid) {
  if (_hasLegacyDataLeft(uid)) return;
  try { uni.removeStorageSync(_legacyListKeyOf(uid)); } catch (e) { /* ignore */ }
}

/**
 * 迁移**当前账号**自己遗留的 v1 存档到 v2 + IndexedDB。
 *
 * 走正常写入路径（_writeRecord + _upsertListItem），因为当前账号的列表缓存要同步更新，
 * 否则过渡页看不到刚迁过来的对话。
 */
async function _migrateCurrentUserLegacy() {
  const uid = _uid();
  const cardIds = _scanLegacyKeys().get(uid) || [];
  let migrated = 0;

  for (const cardId of cardIds) {
    try {
      const legacy = uni.getStorageSync(_legacyDataKeyOf(uid, cardId));
      if (!legacy || !Array.isArray(legacy.messages)) continue; // 坏档：留着不动
      const existing = await _getAdapter().get(_headerKey(cardId));
      if (existing !== null && existing !== undefined) {
        // 两边都有：可能是"旧版本在迁移之后又写了一份"的更新数据，分不清 → 保守不删
        console.warn('[ConversationManager] ' + cardId + ' 已有 v2 存档，但本地仍有 v1 旧档：保守起见不删旧档');
        continue;
      }
      const v2 = _toV2Record(cardId, legacy);
      const ok = await _writeRecord(cardId, v2, { force: true });
      if (!ok) continue; // 写失败：保留旧档，下次重试
      // 迁移过来的对话必须同时进入列表缓存，否则过渡页看不到它（_writeRecord 只落盘）
      _upsertListItem(cardId, v2);
      try { uni.removeStorageSync(_legacyDataKeyOf(uid, cardId)); } catch (e) { /* ignore */ }
      migrated++;
    } catch (e) {
      console.warn('[ConversationManager] 迁移第 ' + cardId + ' 条存档失败（保留旧档）:', e);
    }
  }

  _cleanupLegacyList(uid);
  if (migrated) {
    console.log('[ConversationManager] 已迁移 ' + migrated + ' 条本账号 v1 存档到 IndexedDB');
  }
}

/**
 * 迁移**其他账号**遗留在本地存储里的 v1 存档（D20）。
 *
 * 为什么：同一台设备上，其他账号的老档只有本地存储这一份 —— 没有 IndexedDB 副本、
 * 没有服务端副本，而本地存储又小又会被浏览器清理，是整台设备上最脆弱的数据。
 * 任意一个账号登录（甚至游客态启动）时顺手把它们也搬进 IndexedDB，写入成功才删旧键。
 *
 * 与 _migrateCurrentUserLegacy 的差别（账号隔离，非常重要）：
 *   · 键名用"键里刻着的 uid"（scopedKeyFor），不经过 scopedKey → 不会写到当前账号名下；
 *   · **绝不碰 _listCache / _writeMeta**：那是当前账号的内存态，写进去就是串账号。
 *
 * @returns {{migrated:number, kept:number, failed:number}}
 */
async function migrateForeignLegacy() {
  const result = { migrated: 0, kept: 0, failed: 0 };
  // 没有 IndexedDB 的端（小程序）：本地存储就是最终介质，搬走没有意义（D3 保持现状）
  if (!IndexedDbAdapter.isSupported()) return result;

  const adapter = _getAdapter();
  const currentUid = _uid();

  for (const [uid, cardIds] of _scanLegacyKeys()) {
    if (uid === currentUid) continue; // 当前账号交给 _migrateCurrentUserLegacy（要维护内存列表）
    for (const cardId of cardIds) {
      try {
        const legacy = uni.getStorageSync(_legacyDataKeyOf(uid, cardId));
        if (!legacy || !Array.isArray(legacy.messages)) continue; // 坏档：留着不动
        const existing = await adapter.get(_headerKeyOf(uid, cardId));
        if (existing !== null && existing !== undefined) {
          console.warn('[ConversationManager] ' + uid + ' 的 ' + cardId + ' 已有 v2 存档，但本地仍有 v1 旧档：保守起见不删旧档');
          result.kept++;
          continue;
        }
        const v2 = _toV2Record(cardId, legacy);
        await _writeForeignRecord(uid, cardId, v2);
        await _mergeForeignListItem(uid, cardId, v2);
        try { uni.removeStorageSync(_legacyDataKeyOf(uid, cardId)); } catch (e) { /* ignore */ }
        result.migrated++;
      } catch (e) {
        result.failed++;
        console.warn('[ConversationManager] 迁移其他账号(' + uid + ')的 ' + cardId + ' 旧档失败（保留旧档）:', e);
      }
    }
    _cleanupLegacyList(uid);
  }

  if (result.migrated || result.kept || result.failed) {
    console.log('[ConversationManager] 跨账号迁移：搬走 ' + result.migrated + ' 条，保留 '
      + result.kept + '，失败 ' + result.failed);
  }
  return result;
}

/**
 * 为**其他账号**写入 v2 存档（header + 分页）。失败会抛出，调用方据此保留旧档。
 * 刻意不复用 _writeRecord：后者带"增量写入元信息"和"当前账号"的键名语义。
 */
async function _writeForeignRecord(uid, cardId, record) {
  const adapter = _getAdapter();
  const messages = Array.isArray(record.messages) ? record.messages : [];
  const pageCount = Math.max(1, Math.ceil(messages.length / PAGE_SIZE));
  for (let p = 0; p < pageCount; p++) {
    const page = messages.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE).map(_leanMessage);
    await adapter.set(_pageKeyOf(uid, cardId, p), page);
  }
  // header 放在最后写：它相当于"这次存档已完整落盘"的标记，
  // 中途失败时不会留下"有 header 但没有完整分页"的半吊子存档。
  await adapter.set(_headerKeyOf(uid, cardId), Object.assign({}, record.header, {
    messageCount: messages.length,
    pageCount: pageCount,
    pageSize: PAGE_SIZE
  }));
}

/** 把一条存档补进"其他账号"的对话列表（读改写；不碰当前账号的 _listCache） */
async function _mergeForeignListItem(uid, cardId, record) {
  const adapter = _getAdapter();
  const key = _listKeyOf(uid);
  let list = [];
  try {
    const cur = await adapter.get(key);
    if (Array.isArray(cur)) list = cur;
  } catch (e) { /* 读不到就当空列表 */ }
  if (!list.some(i => i && i.cardId === cardId)) list.unshift(_buildListItem(cardId, record));
  await adapter.set(key, list);
}

// ─────────────────────────────────────────────────────────────
// 读写
// ─────────────────────────────────────────────────────────────

/** 读一条存档：header + 全部分页 → 组装成 { ...header, messages } */
async function load(cardId) {
  if (!cardId) return null;
  _ensureFreshUid();
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
  _ensureFreshUid();
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

/** 构造一条列表项（纯函数，不含任何内存态 —— 跨账号迁移也要用它） */
function _buildListItem(cardId, record) {
  const msgs = record.messages || [];
  const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
  return {
    cardId: cardId,
    cardName: record.header.cardName || '',
    updatedAt: record.header.updatedAt,
    messageCount: msgs.length,
    lastMessagePreview: lastMsg && lastMsg.content ? String(lastMsg.content).slice(0, 40) : ''
  };
}

/** 更新列表项（同步缓存 + 异步落盘） */
function _upsertListItem(cardId, record) {
  const item = _buildListItem(cardId, record);
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
  _ensureFreshUid();
  return _listCache.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function has(cardId) {
  _ensureFreshUid();
  return !!cardId && _listCache.some(i => i.cardId === cardId);
}

/**
 * 初始化：读取列表缓存 + 迁移 v1 旧档。
 * 页面在读取列表/存档之前**必须** await 它（幂等，可重复调用）。
 */
function init() {
  _ensureFreshUid();
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    const adapter = _getAdapter();
    // ⚠️ 顺序很重要：**先**把已有列表读进内存，**再**做迁移。
    // 迁移里的 _upsertListItem 会把条目写回列表键；如果此时 _listCache 还是空的，
    // 就会用"只有迁移项"的列表覆盖掉已有列表 —— 其它对话会从过渡页消失（数据还在，
    // 但用户看不到）。这个顺序 bug 是加跨账号迁移时顺带发现的。
    try {
      const list = await adapter.get(_listKey());
      _listCache = Array.isArray(list) ? list : [];
    } catch (e) {
      console.error('[ConversationManager] 读取列表失败:', e);
      _listCache = [];
    }
    try {
      await _migrateCurrentUserLegacy();
    } catch (e) {
      console.error('[ConversationManager] 迁移 v1 旧档失败:', e);
    }
    _hydratedUid = _uid();
  })();
  return _initPromise;
}

/** 清空某角色卡的存档（新建对话覆盖旧存档时使用） */
async function clear(cardId) {
  if (!cardId) return false;
  _ensureFreshUid();
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

/** 重置内存缓存并重新初始化（导入备份后需要，确保读到新数据；账号切换也走它） */
function reload() {
  _initPromise = null;
  _listCache = [];
  _writeMeta.clear();
  _hydratedUid = _uid();
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
  remove: remove,
  /** D20：把其他账号遗留在本地存储里的 v1 存档也搬进 IndexedDB（启动时调用一次即可） */
  migrateForeignLegacy: migrateForeignLegacy
};
