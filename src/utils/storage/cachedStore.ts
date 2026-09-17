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
  /** 哪些键属于本 store（hydrate 与迁移都按它筛选，只认"当前账号"的键） */
  match: (key: string) => boolean
  /**
   * 由键名解析出"这个键属于哪个账号"（D20 跨账号迁移用）。
   *
   * 为什么需要单独一个函数：`match` 是"当前账号"的判定（内部走 scopedKey），拿不到 uid；
   * 而**其他账号**遗留的键同样属于本 store，只是要按键名里本来就刻着的 uid 去认领。
   * 返回 null 表示这个键不属于本 store；不声明该函数的 store 不参与跨账号迁移。
   */
  uidOf?: (key: string) => string | null
}

export interface CachedStore {
  readonly name: string
  readonly match: (key: string) => boolean
  /** 见 CachedStoreOptions.uidOf */
  readonly uidOf?: (key: string) => string | null
  /** 本 store 使用的 IndexedDB 库名（跨账号迁移要绕过缓存直接用适配器写入） */
  readonly dbName: string
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

/** 本地存储里的全部键名（读不到就当空） */
function _allLocalStorageKeys(): string[] {
  try {
    const info: any = uni.getStorageInfoSync()
    return Array.isArray(info?.keys) ? info.keys : []
  } catch (e) {
    return []
  }
}

/** 读取本地存储里符合条件、且有值的键值 */
function _readLocalStorageKeys(match: (k: string) => boolean): Array<[string, any]> {
  const out: Array<[string, any]> = []
  for (const k of _allLocalStorageKeys()) {
    if (!match(k)) continue
    try {
      const v = uni.getStorageSync(k)
      if (v !== '' && v !== undefined && v !== null) out.push([k, v])
    } catch (e) { /* 单个键失败不影响整体 */ }
  }
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
      // ③ 顺手把**其他账号**遗留的键也搬走（D20）。
      // 为什么挂在这里而不是只在 App.onLaunch 调一次：store 是**页面加载时才注册**的
      // （`createCachedStore` 在模块求值时执行），启动那一刻 `_registry` 往往是空的 ——
      // 只调一次的迁移会静默空转。挂在 hydrate 之后就自愈了：谁先被用到，就把当时已注册的
      // store 覆盖一遍；账号切换触发的重建 hydrate 也会再扫一次。
      // 幂等、失败不影响本次 hydrate 的结果，因此不 await、错误只记日志。
      migrateForeignUserKeys().catch(e => {
        console.warn('[cachedStore] 跨账号迁移失败（下次再试）:', e)
      })
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

  const store: CachedStore = {
    name: opts.name,
    match: opts.match,
    uidOf: opts.uidOf,
    dbName,
    ensureReady,
    get,
    set,
    remove,
    keys,
    entries,
    reset
  }
  _registry.push(store)
  return store
}

/** 跨账号迁移的结果（启动日志 + 测试断言用） */
export interface ForeignMigrationResult {
  /** 成功搬进 IndexedDB 并清掉本地副本的键数 */
  migrated: number
  /** 两边都有（保守起见**保留**本地副本，不删）的键数 */
  kept: number
  /** 读/写失败的键数（本地副本保留，下次再试） */
  failed: number
}

/**
 * 把**其他账号**遗留在本地存储里的键也搬进 IndexedDB（D20）。
 *
 * 为什么需要：hydrate 只扫描"当前登录账号"的键（match 里带 scopedKey），
 * 于是同一台设备上其他账号的角色卡 / 世界书 / 预设会一直躺在 5MB 的本地存储里 ——
 * 它们既没被迁移，也没被导出排除，是整台设备上**最脆弱的一份数据**。
 * 这里按"键名里本来就刻着的 uid"把它们一次性搬走，**写入成功后才删本地副本**。
 *
 * 两条硬约束（都关于账号隔离，不能破）：
 *   1. **绝不写内存缓存**：这些键不属于当前账号，进了 cache 就是账号之间串数据；
 *   2. **不碰当前账号的键**：交给各自的 hydrate 处理（它要同步写缓存），避免两条路径互相覆盖。
 */
export async function migrateForeignUserKeys(): Promise<ForeignMigrationResult> {
  const result: ForeignMigrationResult = { migrated: 0, kept: 0, failed: 0 }
  // 没有 IndexedDB 的端（小程序）：本地存储就是最终介质，没有"搬走"这回事（D3 保持现状）
  if (!IndexedDbAdapter.isSupported()) return result

  const currentUid = _uid()
  const keys = _allLocalStorageKeys()
  const claimed = new Set<string>()

  for (const store of _registry) {
    if (!store.uidOf) continue
    const adapter = _adapterFor(store.dbName)
    for (const key of keys) {
      if (claimed.has(key)) continue
      let owner: string | null = null
      try { owner = store.uidOf(key) } catch (e) { owner = null }
      if (!owner || owner === currentUid) continue
      claimed.add(key)
      try {
        const existing = await adapter.get(key)
        if (existing !== null && existing !== undefined) {
          // 两边都有：可能是"旧版本在迁移之后又往本地存储写了一份"的**更新**数据，
          // 也可能是上次"写完但删副本失败"的残留。分不清 → 保守保留，不删。
          result.kept++
          continue
        }
        const value = uni.getStorageSync(key)
        if (value === '' || value === undefined || value === null) continue
        await adapter.set(key, value)
        try { uni.removeStorageSync(key) } catch (e) { /* 删副本失败不影响数据安全，下次再来 */ }
        result.migrated++
      } catch (e) {
        result.failed++
        console.warn(`[cachedStore:${store.name}] 迁移其他账号的 ${key} 失败，保留本地副本:`, e)
      }
    }
  }

  if (result.migrated || result.kept || result.failed) {
    console.log(`[cachedStore] 跨账号迁移：搬走 ${result.migrated} 个键，保留 ${result.kept}，失败 ${result.failed}`)
  }
  return result
}

export default { createCachedStore, listCachedStores, migrateForeignUserKeys }
