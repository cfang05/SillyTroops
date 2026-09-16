// src/utils/storage/cachedStore.ts
// 「内存缓存 + IndexedDB 持久化」的同步键值存储（P5.3）
//
// 为什么需要它：角色卡 / 世界书 / 预设 / Persona 这几类数据的现有 API 全是**同步**的，
// 调用点有 20 多处；直接改成异步会牵动所有页面，风险和收益不成比例。
// 这里换一个思路 —— **保持同步 API，只把持久化介质换成 IndexedDB**：
//
//   · 读：先看内存缓存（hydrate 之后就是全量数据）；**没 hydrate 完则同步回落到本地存储**
//        → 因此不存在"异步还没读完就读到 null"的竞态，行为与改造前一致；
//   · 写：改内存 + **异步落盘 IndexedDB**（不阻塞界面）。未 hydrate 完成时**同时**写一份本地存储，
//        这样即使 hydrate 的迁移扫描晚于这次写入，也不会丢数据（扫描会把这份新数据一并迁走并清理）；
//   · 迁移：hydrate 时把本地存储里的同前缀键搬到 IndexedDB，搬完**删除本地存储副本**，
//        从 5MB 配额里彻底腾出来。
//
// 账号切换安全：scopedKey 依赖当前登录用户，缓存会记录 hydrate 时的 uid；uid 变了就丢弃缓存重建。

import { IndexedDbAdapter, localAdapter, type StorageAdapter } from './adapter'
import { scopedKey } from '../account/userScope.js'
// @ts-ignore
import userManager from '../account/userManager.js'
import { notifyStorageFailure } from '../notify'

export interface CachedStoreOptions {
  /** 名字（日志/备份分区用） */
  name: string
  /** 共用同一个 IndexedDB 库即可（键本身已按用户隔离） */
  dbName?: string
  /** 哪些键属于本 store（hydrate 与迁移都按它筛选） */
  match: (key: string) => boolean
}

export interface CachedStore {
  readonly name: string
  readonly match: (key: string) => boolean
  /** 等待 hydrate 完成（备份/导入这类需要全量数据的场景用） */
  ensureReady(): Promise<void>
  get<T = any>(key: string): T | null
  set(key: string, value: any): void
  remove(key: string): void
  keys(): string[]
  /** 全量键值（需先 ensureReady） */
  entries(): Record<string, any>
  /** 丢弃缓存并重建（导入备份后调用） */
  reset(): void
}

const _registry: CachedStore[] = []
/** 所有已注册的缓存存储（备份服务据此收集数据） */
export function listCachedStores(): CachedStore[] {
  return _registry
}

const _adapters = new Map<string, StorageAdapter>()
function _adapterFor(dbName: string): StorageAdapter {
  let ad = _adapters.get(dbName)
  if (!ad) {
    ad = IndexedDbAdapter.isSupported() ? new IndexedDbAdapter(dbName) : localAdapter
    _adapters.set(dbName, ad)
  }
  return ad
}

function _uid(): string {
  try {
    return userManager.getCurrentUserId() || 'guest'
  } catch (e) {
    return 'guest'
  }
}

/** 读取本地存储里符合条件、且有值的键值 */
function _readLocalStorageKeys(match: (k: string) => boolean): Array<[string, any]> {
  const out: Array<[string, any]> = []
  try {
    const info: any = uni.getStorageInfoSync()
    const keys: string[] = Array.isArray(info?.keys) ? info.keys : []
    for (const k of keys) {
      if (!match(k)) continue
      try {
        const v = uni.getStorageSync(k)
        if (v !== '' && v !== undefined && v !== null) out.push([k, v])
      } catch (e) { /* 单个键失败不影响整体 */ }
    }
  } catch (e) { /* 某些端没有 getStorageInfoSync，忽略 */ }
  return out
}

export function createCachedStore(opts: CachedStoreOptions): CachedStore {
  const dbName = opts.dbName || 'sillytroops_kv'
  const cache = new Map<string, any>()
  let hydrated = false
  let hydrating: Promise<void> | null = null
  let hydratedUid = ''

  async function _doHydrate(): Promise<void> {
    const uid = _uid()
    cache.clear()
    hydrated = false
    const adapter = _adapterFor(dbName)
    const hasIdb = IndexedDbAdapter.isSupported()

    try {
      // ① IndexedDB → 内存
      // 注意：必须单独记一份"确实存在于 IDB 的键"（idbKeys）。
      // 不能拿 cache 判断 —— hydrate 完成前的同步读回退会把值放进 cache，
      // 若据此认为"已在 IDB"，就会**删掉本地副本却没写进 IDB**，该数据两边都没了（静默丢档）。
      const idbKeys = new Set<string>()
      if (hasIdb) {
        const idbKeyList = (await adapter.keys()).filter(opts.match)
        for (const k of idbKeyList) {
          const v = await adapter.get(k)
          if (v !== null && v !== undefined) {
            cache.set(k, v)
            idbKeys.add(k)
          }
        }
      }

      // ② 本地存储 → IndexedDB（迁移），并清理本地副本
      for (const [k, v] of _readLocalStorageKeys(opts.match)) {
        if (!idbKeys.has(k)) {
          cache.set(k, v)
          if (hasIdb) {
            try {
              await adapter.set(k, v)
              idbKeys.add(k)
            } catch (e) {
              // 写 IDB 失败：**不要**删除本地副本，否则这份数据就没了
              console.warn(`[${opts.name}] 迁移 ${k} 失败，保留本地存储副本:`, e)
              continue
            }
          }
        }
        if (hasIdb) {
          // 已确认在 IndexedDB 里 → 删掉本地存储副本，把 5MB 配额腾出来
          try { uni.removeStorageSync(k) } catch (e) { /* ignore */ }
        }
      }

      hydratedUid = uid
      hydrated = true
    } catch (e) {
      console.error(`[cachedStore:${opts.name}] hydrate 失败（读操作会继续走本地存储）:`, e)
      hydrated = false
    }
  }

  function ensureReady(): Promise<void> {
    if (!hydrating) hydrating = _doHydrate()
    return hydrating
  }

  /** 账号切换检测 + 首次访问时触发 hydrate（读操作在此之前走本地存储回退） */
  function _ensureFresh(): void {
    const uid = _uid()
    if (hydrated && uid !== hydratedUid) {
      console.log(`[cachedStore:${opts.name}] 检测到账号切换，重建缓存`)
      cache.clear()
      hydrated = false
      hydrating = null
      hydratedUid = uid
    }
    ensureReady().catch(() => { /* 已在 _doHydrate 内记录 */ })
  }

  function get<T = any>(key: string): T | null {
    _ensureFresh()
    if (hydrated) {
      return (cache.has(key) ? cache.get(key) : null) as T | null
    }
    // 迁移完成前：同步回落到本地存储（= 改造前的行为）
    try {
      const v = uni.getStorageSync(key)
      if (v === '' || v === undefined || v === null) return null
      cache.set(key, v)
      return v as T
    } catch (e) {
      return null
    }
  }

  function set(key: string, value: any): void {
    _ensureFresh()
    cache.set(key, value)
    // 未 hydrate 完成时同时写本地存储：保证迁移扫描一定能看到这次写入，不丢数据
    if (!hydrated) {
      try { uni.setStorageSync(key, value) } catch (e) { notifyStorageFailure('保存数据', e) }
    }
    Promise.resolve(_adapterFor(dbName).set(key, value)).catch(e => {
      console.error(`[cachedStore:${opts.name}] 异步落盘失败:`, e)
      notifyStorageFailure('保存数据', e)
    })
  }

  function remove(key: string): void {
    _ensureFresh()
    cache.delete(key)
    try { uni.removeStorageSync(key) } catch (e) { /* ignore */ }
    Promise.resolve(_adapterFor(dbName).remove(key)).catch(e => {
      console.warn(`[cachedStore:${opts.name}] 删除失败:`, e)
    })
  }

  function keys(): string[] {
    _ensureFresh()
    if (hydrated) return [...cache.keys()]
    return _readLocalStorageKeys(opts.match).map(([k]) => k)
  }

  function entries(): Record<string, any> {
    const out: Record<string, any> = {}
    if (hydrated) {
      cache.forEach((v, k) => { out[k] = v })
      return out
    }
    _readLocalStorageKeys(opts.match).forEach(([k, v]) => { out[k] = v })
    return out
  }

  function reset(): void {
    cache.clear()
    hydrated = false
    hydrating = null
    hydratedUid = _uid()
  }

  const store: CachedStore = { name: opts.name, match: opts.match, ensureReady, get, set, remove, keys, entries, reset }
  _registry.push(store)
  return store
}

export default { createCachedStore, listCachedStores }
