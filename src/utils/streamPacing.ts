// src/utils/streamPacing.ts
// 「平滑输出」节奏控制（用户实测反馈：真流式下文字"疯狂涌出、速度不可控"）
//
// 背景：D19 定的是"流式默认打开、打字机只在流式关闭/小程序端生效"。
// 真流式打开后，显示速度就等于上游速度 —— 遇上 deepseek-v4-flash 这类高速模型，
// 一屏字会在几百毫秒内灌完，读不过来。
//
// 这里提供一个**可关闭的节奏控制**：仍然是真流式（首字延迟不受影响、无需等全文），
// 但 UI 按设定速率「逐字释放」已经到达的文本 —— 也就是酒馆的 smooth_streaming
// （referencecode/public/scripts/sse-stream.js 的 SmoothEventSourceStream 做的是同一件事）。
//
// 关掉它 = 完全跟上游速度（最快、最省事，但会"涌出"）。

import storage from './storage.js'
// @ts-ignore
import { scopedKey } from './account/userScope.js'

export interface StreamPacingConfig {
  /** 是否启用平滑输出（按下面速率逐字释放） */
  enabled: boolean
  /** 目标速率：字符/秒 */
  charsPerSec: number
}

const STORAGE_KEY = () => scopedKey('stream_pacing')

/** 默认开启、80 字/秒：比大多数人的阅读速度快，但能明显看出"在逐字写"，不会一屏灌完 */
export function defaultPacingConfig(): StreamPacingConfig {
  return { enabled: true, charsPerSec: 80 }
}

export function loadPacingConfig(): StreamPacingConfig {
  try {
    const saved = storage.get(STORAGE_KEY())
    if (saved && typeof saved === 'object') {
      const rate = Number(saved.charsPerSec)
      return {
        enabled: !!saved.enabled,
        charsPerSec: Number.isFinite(rate) && rate > 0 ? rate : defaultPacingConfig().charsPerSec
      }
    }
  } catch (e) {
    console.warn('[streamPacing] 读取配置失败:', e)
  }
  return defaultPacingConfig()
}

export function savePacingConfig(cfg: StreamPacingConfig): boolean {
  try {
    const rate = Number(cfg && cfg.charsPerSec)
    storage.set(STORAGE_KEY(), {
      enabled: !!(cfg && cfg.enabled),
      charsPerSec: Number.isFinite(rate) && rate > 0 ? rate : defaultPacingConfig().charsPerSec
    })
    return true
  } catch (e) {
    console.warn('[streamPacing] 保存配置失败:', e)
    return false
  }
}

/** 每帧应释放的字符数（四舍五入，至少 1 —— 否则会永远显示不出新字） */
export function charsPerFrame(charsPerSec: number, frameMs: number): number {
  const rate = Number(charsPerSec)
  if (!Number.isFinite(rate) || rate <= 0) return Number.MAX_SAFE_INTEGER // 速率无效 = 不限制
  return Math.max(1, Math.round((rate * frameMs) / 1000))
}

/**
 * 计算这一帧结束时应显示到第几个字符
 * @param shown 已经显示的字符数
 * @param targetLength 当前已到达的文本总长度
 * @param charsPerSec 目标速率
 * @param frameMs 帧间隔（毫秒）
 */
export function nextShownLength(shown: number, targetLength: number, charsPerSec: number, frameMs: number): number {
  const perFrame = charsPerFrame(charsPerSec, frameMs)
  if (perFrame === Number.MAX_SAFE_INTEGER) return targetLength
  return Math.min(targetLength, Math.max(0, shown) + perFrame)
}

export default {
  defaultPacingConfig,
  loadPacingConfig,
  savePacingConfig,
  charsPerFrame,
  nextShownLength
}
