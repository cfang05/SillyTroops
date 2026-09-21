// src/utils/storage/adapter.ts
// 统一存储适配接口（D9）
//
// 目的：把"业务代码直接调 uni.setStorageSync"收敛到一个可替换的接口后面，
// 为 D6/D8 铺路：
//   - 现在：LocalStorageAdapter（同步兜底，行为与现状完全一致）
//   - P5  ：IndexedDbAdapter（容量大、异步、可按条读取，用于对话/角色卡/预设/Persona）
//   - 之后：RemoteAdapter（跨设备同步，D6 后置）
//
// 设计约束（很重要）：
//   1. 接口全部是 **async**（IndexedDB 与远端必然是异步的）；
//   2. 但**不强制现有调用方立刻改**——现有的 `utils/storage.js` 同步 API 原样保留，
//      由 LocalStorageAdapter 在内部复用同一套底层调用，因此本文件的引入是"零行为变化"；
//   3. 适配器**只负责存取**，不负责 key 的作用域（用户隔离仍由 userScope.scopedKey 负责）。

/** 存储适配器接口 */
export interface StorageAdapter {
  /** 适配器名（日志/调试用） */
  readonly name: string
  /** 读取；不存在返回 null */
  get<T = any>(key: string): Promise<T | null>
  /** 写入；失败应抛错（调用方据此做"失败可见"提示） */
  set(key: string, value: any): Promise<void>
  /** 删除；不存在不报错 */
  remove(key: string): Promise<void>
  /** 列出全部 key */
  keys(): Promise<string[]>
  /** 用量估算（可选，H5 可用 navigator.storage.estimate） */
  estimate?(): Promise<{ usage: number; quota: number } | null>
  /** 申请持久化存储（可选，H5 的 navigator.storage.persist，D8 配套） */
  persist?(): Promise<boolean>
}

// ─────────────────────────────────────────────────────────────
// LocalStorageAdapter：包一层 uni 的本地存储（H5 = localStorage，小程序 = 各端实现）
// ─────────────────────────────────────────────────────────────
export class LocalStorageAdapter implements StorageAdapter {
  readonly name = 'local'

  async get<T = any>(key: string): Promise<T | null> {
    try {
      const v = uni.getStorageSync(key)
      return (v === '' || v === undefined) ? null : (v as T)
    } catch (e) {
      console.error('[LocalStorageAdapter] get 失败:', key, e)
      return null
    }
  }

  async set(key: string, value: any): Promise<void> {
    // 刻意不 catch：写失败（配额超限）必须向上抛，交给调用方提示用户（D12）
    uni.setStorageSync(key, value)
  }

  async remove(key: string): Promise<void> {
    try {
      uni.removeStorageSync(key)
    } catch (e) {
      console.error('[LocalStorageAdapter] remove 失败:', key, e)
    }
  }

  async keys(): Promise<string[]> {
    try {
      const info: any = uni.getStorageInfoSync()
      return Array.isArray(info?.keys) ? info.keys : []
    } catch (e) {
      return []
    }
  }

  async estimate(): Promise<{ usage: number; quota: number } | null> {
    // 仅 H5 有标准 API；其它端返回 null（由上层决定如何展示）
    try {
      if (typeof navigator !== 'undefined' && (navigator as any).storage?.estimate) {
        const est = await (navigator as any).storage.estimate()
        if (typeof est?.usage === 'number' && typeof est?.quota === 'number') {
          return { usage: est.usage, quota: est.quota }
        }
      }
    } catch (e) { /* ignore */ }
    return null
  }

  async persist(): Promise<boolean> {
    try {
      if (typeof navigator !== 'undefined' && (navigator as any).storage?.persist) {
        return !!(await (navigator as any).storage.persist())
      }
    } catch (e) { /* ignore */ }
    return false
  }
}

// ─────────────────────────────────────────────────────────────
// IndexedDbAdapter：单对象仓库的 KV 实现（对话/角色卡/预设/Persona 等业务数据的落盘介质）
// ─────────────────────────────────────────────────────────────
const IDB_STORE = 'kv'

/**
 * 转成可结构化克隆的纯数据（见 `set` 里的说明）
 * JSON 往返对"我们存的所有东西"（消息、角色卡、预设、Persona）都是无损的。
 */
function _toPlainValue(value: any): any {
  if (value === undefined) return null
  if (value === null || typeof value !== 'object') return value
  try {
    return JSON.parse(JSON.stringify(value))
  } catch (e) {
    console.warn('[IndexedDbAdapter] 值无法 JSON 序列化，尝试直接写入:', e)
    return value
  }
}

export class IndexedDbAdapter implements StorageAdapter {
  readonly name: string
  private readonly dbName: string
  private _dbPromise: Promise<IDBDatabase> | null = null

  constructor(dbName = 'sillytroops') {
    this.dbName = dbName
    this.name = `idb:${dbName}`
  }

  static isSupported(): boolean {
    return typeof indexedDB !== 'undefined'
  }

  private _open(): Promise<IDBDatabase> {
    if (this._dbPromise) return this._dbPromise
    this._dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (!IndexedDbAdapter.isSupported()) {
        reject(new Error('当前环境不支持 IndexedDB'))
        return
      }
      const req = indexedDB.open(this.dbName, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error || new Error('IndexedDB 打开失败'))
    })
    return this._dbPromise
  }

  private async _tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
    const db = await this._open()
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, mode)
      const req = fn(tx.objectStore(IDB_STORE))
      tx.oncomplete = () => resolve(req.result as T)
      tx.onerror = () => reject(tx.error || req.error || new Error('IndexedDB 事务失败'))
      tx.onabort = () => reject(tx.error || new Error('IndexedDB 事务中止'))
    })
  }

  async get<T = any>(key: string): Promise<T | null> {
    const v = await this._tx<any>('readonly', s => s.get(key))
    return v === undefined ? null : (v as T)
  }

  async set(key: string, value: any): Promise<void> {
    // ⚠️ 必须先把值转换成"可结构化克隆"的纯数据，否则会直接失败。
    //
    // 真实故障（用户实测）：Pinia/Vue 的响应式对象是 **Proxy**，而 IndexedDB 的 put() 走
    // 结构化克隆算法，Chrome 对 Proxy 会抛 `DataCloneError: #<Object> could not be cloned`。
    // 我们把 `runtimeStore.messages`（响应式数组，元素也是代理对象）直接交给 put()，
    // 于是"每次保存都失败"：读得到旧数据（迁移时写进去的是 JSON 纯对象），却写不进新数据。
    // JSON 往返既能把代理展开成普通对象/数组，也能顺手剥掉不可克隆的值（函数等）。
    await this._tx('readwrite', s => s.put(_toPlainValue(value), key))
  }

  async remove(key: string): Promise<void> {
    await this._tx('readwrite', s => s.delete(key))
  }

  async keys(): Promise<string[]> {
    const all = await this._tx<IDBValidKey[]>('readonly', s => s.getAllKeys())
    return (all || []).map(k => String(k))
  }

  async estimate(): Promise<{ usage: number; quota: number } | null> {
    try {
      if (typeof navigator !== 'undefined' && (navigator as any).storage?.estimate) {
        const est = await (navigator as any).storage.estimate()
        if (typeof est?.usage === 'number' && typeof est?.quota === 'number') {
          return { usage: est.usage, quota: est.quota }
        }
      }
    } catch (e) { /* ignore */ }
    return null
  }

  async persist(): Promise<boolean> {
    try {
      if (typeof navigator !== 'undefined' && (navigator as any).storage?.persist) {
        return !!(await (navigator as any).storage.persist())
      }
    } catch (e) { /* ignore */ }
    return false
  }
}

/** 当前默认适配器：第一阶段仍用本地存储（行为与现状一致） */
export const localAdapter: StorageAdapter = new LocalStorageAdapter()

/** 创建/获取 IndexedDB 适配器（P5 使用） */
export function createIndexedDbAdapter(dbName = 'sillytroops'): StorageAdapter {
  return new IndexedDbAdapter(dbName)
}

export default localAdapter
