// src/services/backupService.ts
// 数据备份与恢复（P5.4 / D8 的兜底）
//
// 为什么必须有：P5 把对话存档从 localStorage 迁到了 IndexedDB，并升级了存档格式（v1→v2）。
// 本地存储/IndexedDB 都可能被浏览器在磁盘紧张时清理（Safari 尤其），所以"一键导出/导入"
// 是本地优先方案里唯一的可靠兜底 —— 酒馆也是靠导出 .jsonl / 角色卡 PNG 兜底的。
//
// 导出内容分两路收集：
//   ① kv：对话存档（走对话存储适配器：H5 是 IndexedDB，小程序端是本地存储）
//   ② ls：uni 本地存储（角色卡、世界书、预设、正侧、Persona、AI 设置、等级等）
//
// 实现只覆盖 H5 的下载/选文件（D3：小程序端保持现状）；非 H5 端降级为"复制到剪贴板"。

import conversationManager from '../utils/account/conversationManager.js'
import { listCachedStores, type CachedStore } from '../utils/storage/cachedStore'
// @ts-ignore
import { scopedKey } from '../utils/account/userScope.js'
import { notifyError } from '../utils/notify'

const BACKUP_APP = 'sillytroops-uni'
/** 2 = 引入 cachedStore（角色卡/预设/Persona 等）之后；仍兼容读取 1 */
const BACKUP_SCHEMA = 2

export interface BackupFile {
  app: string
  schemaVersion: number
  exportedAt: number
  /** 非本地存储的键值（对话库 + cachedStore） */
  kv: Record<string, any>
  /** 其余本地存储键值 */
  ls: Record<string, any>
}

/** 对话库使用的键前缀（conv_ 系列都在这里） */
function _chatKeyPrefix(): string {
  return scopedKey('conv_')
}

/** 该键由哪个 cachedStore 管理（没有则 null） */
function _matchStore(key: string): CachedStore | null {
  const stores = listCachedStores()
  for (const s of stores) {
    if (s.match(key)) return s
  }
  return null
}

/** 收集所有本地存储键值（业务数据 + 偏好设置），**排除**已迁到 IndexedDB 的部分 */
function _collectLocalStorage(): Record<string, any> {
  const out: Record<string, any> = {}
  const kvPrefix = _chatKeyPrefix()
  try {
    const info: any = uni.getStorageInfoSync()
    const keys: string[] = Array.isArray(info?.keys) ? info.keys : []
    for (const k of keys) {
      // 已迁到 IndexedDB 的键不放在 ls 里，避免导出重复/导入路由混乱
      if (k.indexOf(kvPrefix) === 0) continue
      if (_matchStore(k)) continue
      try {
        const v = uni.getStorageSync(k)
        if (v !== '' && v !== undefined && v !== null) out[k] = v
      } catch (e) { /* 单个键读失败不影响整体导出 */ }
    }
  } catch (e) {
    console.warn('[backup] 读取本地存储失败:', e)
  }
  return out
}

/** 收集非本地存储的数据：cachedStore（角色卡/预设/Persona/正侧）+ 对话库 */
async function _collectKv(): Promise<Record<string, any>> {
  const out: Record<string, any> = {}

  for (const s of listCachedStores()) {
    try {
      await s.ensureReady()
      Object.assign(out, s.entries())
    } catch (e) {
      console.warn(`[backup] 收集 ${s.name} 失败:`, e)
    }
  }

  try {
    const adapter: any = conversationManager.getStorageAdapter()
    const keys: string[] = await adapter.keys()
    for (const k of keys) {
      try {
        const v = await adapter.get(k)
        if (v !== null && v !== undefined) out[k] = v
      } catch (e) { /* 单个键读失败不影响整体导出 */ }
    }
  } catch (e) {
    console.warn('[backup] 读取对话存储失败:', e)
  }

  return out
}

/** 生成备份 JSON 文本 */
export async function buildBackup(): Promise<string> {
  const data: BackupFile = {
    app: BACKUP_APP,
    schemaVersion: BACKUP_SCHEMA,
    exportedAt: Date.now(),
    kv: await _collectKv(),
    ls: _collectLocalStorage()
  }
  return JSON.stringify(data, null, 2)
}

export interface RestoreResult {
  ok: boolean
  kvCount: number
  lsCount: number
  message?: string
}

/**
 * 从备份 JSON 恢复
 * 注意：**覆盖式写入**（同名键被替换），导入前请确认已备份当前数据。
 */
export async function restoreBackup(text: string): Promise<RestoreResult> {
  let data: BackupFile
  try {
    data = JSON.parse(text)
  } catch (e) {
    return { ok: false, kvCount: 0, lsCount: 0, message: '文件不是合法的 JSON' }
  }
  if (!data || data.app !== BACKUP_APP) {
    return { ok: false, kvCount: 0, lsCount: 0, message: '不是本应用的备份文件' }
  }
  if (typeof data.schemaVersion === 'number' && data.schemaVersion > BACKUP_SCHEMA) {
    return { ok: false, kvCount: 0, lsCount: 0, message: '备份来自更新的版本，请先升级应用' }
  }

  let kvCount = 0
  let lsCount = 0
  const kvPrefix = _chatKeyPrefix()

  // ① 非本地存储部分：按路由写回（cachedStore / 对话库 / 兜底本地存储）
  try {
    const adapter: any = conversationManager.getStorageAdapter()
    const kv = data.kv || {}
    for (const k of Object.keys(kv)) {
      try {
        const store = _matchStore(k)
        if (store) {
          store.set(k, kv[k])
        } else if (k.indexOf(kvPrefix) === 0) {
          await adapter.set(k, kv[k])
        } else {
          // 兼容 v1 备份（当年没有区分介质）
          uni.setStorageSync(k, kv[k])
          lsCount++
          continue
        }
        kvCount++
      } catch (e) { /* 单个失败继续 */ }
    }
  } catch (e) {
    console.warn('[backup] 写入对话存储失败:', e)
  }

  // ② 本地存储部分
  try {
    const ls = data.ls || {}
    for (const k of Object.keys(ls)) {
      try {
        const store = _matchStore(k)
        if (store) { store.set(k, ls[k]); kvCount++ } else { uni.setStorageSync(k, ls[k]); lsCount++ }
      } catch (e) { /* 单个失败继续 */ }
    }
  } catch (e) {
    console.warn('[backup] 写入本地存储失败:', e)
  }

  // ③ 让内存缓存与对话管理器重新读取（否则页面上还是导入前的旧数据）
  try {
    for (const s of listCachedStores()) {
      s.reset()
    }
    for (const s of listCachedStores()) {
      await s.ensureReady()
    }
    await conversationManager.reload()
  } catch (e) { /* ignore */ }

  return { ok: true, kvCount, lsCount }
}

/** 备份文件名 */
function _fileName(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `sillytroops-backup-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`
}

/** 导出：H5 直接下载；其它端复制到剪贴板 */
export async function exportBackup(): Promise<boolean> {
  const text = await buildBackup()
  // #ifdef H5
  try {
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = _fileName()
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 2000)
    return true
  } catch (e) {
    console.warn('[backup] 下载失败，改为复制到剪贴板:', e)
  }
  // #endif
  try {
    uni.setClipboardData({ data: text })
    return true
  } catch (e) {
    notifyError('导出备份失败', String(e))
    return false
  }
}

/** 选择备份文件并读取其文本（H5） */
export function pickBackupFile(): Promise<string | null> {
  // #ifdef H5
  return new Promise(resolve => {
    try {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json,application/json'
      input.onchange = () => {
        const file = input.files && input.files[0]
        if (!file) { resolve(null); return }
        const reader = new FileReader()
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
        reader.onerror = () => resolve(null)
        reader.readAsText(file)
      }
      input.click()
    } catch (e) {
      console.warn('[backup] 选择文件失败:', e)
      resolve(null)
    }
  })
  // #endif
  // #ifndef H5
  return Promise.resolve(null)
  // #endif
}

export default { buildBackup, restoreBackup, exportBackup, pickBackupFile }
