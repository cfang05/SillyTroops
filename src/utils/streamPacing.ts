// src/utils/streamPacing.ts
// 「平滑输出」节奏控制（用户实测反馈：真流式下文字"疯狂涌出、速度不可控"）
//
// 背景：D19 定的是"流式默认打开、打字机只在流式关闭/小程序端生效"。
// 真流式打开后，显示速度就等于上游速度 —— 遇上 deepseek-v4-flash 这类高速模型，
// 一屏字会在几百毫秒内灌完，读不过来。
//
// 这里提供一个**可调节**的节奏控制：仍然是真流式（首字延迟不受影响、无需等全文），
// 但 UI 按设定速率「逐字释放」已经到达的文本 —— 也就是酒馆的 smooth_streaming
// （referencecode/public/scripts/sse-stream.js 的 SmoothEventSourceStream 做的是同一件事）。
//
// ⚠️ 2026-09-22 改版（用户要求）：不再有独立的"平滑输出"开关，只保留一个 10~100 的滑条：
//   · 最左侧 = 10 字/秒（最慢）
//   · 最右侧 = 100 = **全速**，等价于"关闭平滑输出"（完全跟上游速度）
//   · 步进固定 5
// 因此 enabled 不再是用户手填的字段，而是由速率派生：charsPerSec < 100 即为启用。
// 旧版存下来的 { enabled:false, charsPerSec: 80 } 之类配置会在读取时被归一化（→ 100 全速）。

import storage from './storage.js'
// @ts-ignore
import { scopedKey } from './account/userScope.js'

/** 滑条最小值（最慢） */
export const PACING_MIN = 10
/** 滑条最大值 = 全速（等价于关闭平滑输出） */
export const PACING_FULL_SPEED = 100
/** 滑条步进：每次只能调整 5 */
export const PACING_STEP = 5

export interface StreamPacingConfig {
  /** 是否启用平滑输出（charsPerSec >= 100 时为 false = 全速） */
  enabled: boolean
  /** 目标速率：字符/秒（10 ~ 100） */
  charsPerSec: number
}

const STORAGE_KEY = () => scopedKey('stream_pacing')

/** 默认 80 字/秒：比大多数人的阅读速度快，但能明显看出"在逐字写"，不会一屏灌完 */
export function defaultPacingConfig(): StreamPacingConfig {
  return { enabled: true, charsPerSec: 80 }
}

/**
 * 归一化任意来源的配置（本地旧值 / 滑条输入）：
 *   · 速率贴到 10~100 并吸附到 5 的倍数
 *   · enabled 由速率派生（100 即全速 = 关闭平滑）
 *   · 旧配置里 enabled=false（用户当时手动关掉了平滑）等价于全速 → 直接落成 100
 */
export function normalizePacingConfig(raw: any): StreamPacingConfig {
  if (raw && raw.enabled === false) {
    return { enabled: false, charsPerSec: PACING_FULL_SPEED }
  }
  const rate = Number(raw && raw.charsPerSec)
  if (!Number.isFinite(rate) || rate <= 0) return defaultPacingConfig()
  const snapped = Math.round(rate / PACING_STEP) * PACING_STEP
  const clamped = Math.min(PACING_FULL_SPEED, Math.max(PACING_MIN, snapped))
  return { enabled: clamped < PACING_FULL_SPEED, charsPerSec: clamped }
}

export function loadPacingConfig(): StreamPacingConfig {
  try {
    const saved = storage.get(STORAGE_KEY())
    if (saved && typeof saved === 'object') return normalizePacingConfig(saved)
  } catch (e) {
    console.warn('[streamPacing] 读取配置失败:', e)
  }
  return defaultPacingConfig()
}

export function savePacingConfig(cfg: StreamPacingConfig): boolean {
  try {
    storage.set(STORAGE_KEY(), normalizePacingConfig(cfg))
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
  PACING_MIN,
  PACING_FULL_SPEED,
  PACING_STEP,
  defaultPacingConfig,
  normalizePacingConfig,
  loadPacingConfig,
  savePacingConfig,
  charsPerFrame,
  nextShownLength
}
