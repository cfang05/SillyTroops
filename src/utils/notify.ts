// src/utils/notify.ts
// 统一的"用户可见错误提示"小工具（P0.2 / 支撑 D12 的"失败可见"）
//
// 背景：项目里大量 catch 只做了 console.error，用户侧毫无感知——最典型的是
// conversationManager.save() 在本地存储写满时静默失败（见 D12）。这里提供一个
// 极薄的提示出口：打日志 + toast，并做短时间去重（避免同一错误每帧弹一次）。

/** 同一提示在多少毫秒内只弹一次 */
const DEDUPE_MS = 4000

const _recent = new Map<string, number>()

export interface NotifyOptions {
  /** 去重键；默认用 title。用于"同一类错误短时间内只提示一次" */
  dedupeKey?: string
  /** 仅打日志、不弹 toast（用于后台/静默场景） */
  silent?: boolean
  /** toast 显示时长（毫秒） */
  duration?: number
}

/**
 * 向用户提示一个错误（同时写入 console.error，便于排查）
 * @returns 是否真的弹出了提示（被去重时返回 false）
 */
export function notifyError(title: string, detail?: string, opts: NotifyOptions = {}): boolean {
  const key = opts.dedupeKey || title
  const now = Date.now()
  const last = _recent.get(key) || 0
  if (now - last < DEDUPE_MS) return false
  _recent.set(key, now)

  console.error('[notify]', title, detail || '')

  if (opts.silent) return false

  try {
    uni.showToast({
      title: detail ? `${title}\n${detail}` : title,
      icon: 'none',
      duration: opts.duration || 3000
    })
  } catch (e) {
    // 非 uni 环境（例如单元测试）忽略
  }
  return true
}

/**
 * 存储写入失败的统一提示
 *
 * 分类给出可操作的原因（实测中出现过把 IndexedDB 的 DataCloneError 说成"本地存储写入失败"
 * 的情况，会把人引到错误的方向去清理数据）：
 *   · 配额类 → 本地存储空间可能已满
 *   · 数据库类（IndexedDB 事务/克隆失败）→ 数据库写入被拒绝
 *   · 其它 → 存储写入失败
 *
 * @param op 操作描述，例如 '保存对话'
 */
export function notifyStorageFailure(op: string, error?: any): void {
  const reason = (error && (error.errMsg || error.message || error.name)) || String(error || '未知原因')
  let hint = '存储写入失败'
  let advice = '如果反复出现，请到「设置」导出备份后清理数据'
  if (/quota|exceed|空间|full|Storage full/i.test(reason)) {
    hint = '本地存储空间可能已满'
    advice = '请到「设置」清理数据或先导出备份'
  } else if (/clone|cloned|IDBObjectStore|IndexedDB|transaction|DataClone/i.test(reason)) {
    hint = '数据库写入被拒绝'
    advice = '数据已保存在内存中，请重试；若持续失败请导出备份后重启应用'
  }
  notifyError(`${op}失败：${hint}`, advice, { dedupeKey: 'storage-failure', duration: 5000 })
}

/** 清空去重记录（测试用） */
export function resetNotifyDedupe(): void {
  _recent.clear()
}

export default { notifyError, notifyStorageFailure, resetNotifyDedupe }
