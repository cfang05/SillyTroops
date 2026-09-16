// src/engine/ReasoningHandler.ts
// 文本编码思考（COT）的切分 + 思考相关设置的读写（P6.4 / D17）
//
// 背景（见决策记录 9.8）：思考有**两种来源**
//   ① API 原生字段：上游在 `delta.reasoning_content` 里单独返回 —— 由 client 的独立通道处理（P6.1）；
//   ② 文本编码：模型/角色卡把思考**写在正文里**，用定界符包起来（` thinking…<｜end▁of▁thinking｜>`、
//      `<analysis>…</analysis>`、`[思考]…[/思考]` …）。从 API 角度看它就是正文，
//      只能靠前后缀事后切分。
//
// 酒馆的 `auto_parse` 本质也是这样（它内部就是"前缀+后缀拼一个正则"，referencecode/public/scripts/reasoning.js:1430），
// 但这里额外处理**流式未闭合**：只有前缀、后缀还没到时，也要把后半段当成思考并从正文里摘掉 ——
// 否则流式期间会先露出思考原文、等后缀到达才跳变。

import storage from '../utils/storage.js'
// @ts-ignore
import { scopedKey } from '../utils/account/userScope.js'

export interface ReasoningSplitConfig {
  /** 是否解析正文里用定界符包裹的思考（默认关闭，与酒馆一致） */
  enabled: boolean
  /** 思考块的前缀 */
  prefix: string
  /** 思考块的后缀 */
  suffix: string
}

export interface ReasoningSplitResult {
  /** 切分出来的思考内容（没有则为空串） */
  reasoning: string
  /** 去掉思考块之后的正文 */
  content: string
  /** 是否是"只有前缀、后缀还没到"的流式中间态 */
  incomplete: boolean
}

/** 默认配置：关闭；前后缀给一组常见模板，用户可改 */
export function defaultReasoningConfig(): ReasoningSplitConfig {
  return { enabled: false, prefix: ' thinking', suffix: '' }
}

const STORAGE_KEY = () => scopedKey('reasoning_split')

export function loadReasoningConfig(): ReasoningSplitConfig {
  try {
    const saved = storage.get(STORAGE_KEY())
    if (saved && typeof saved === 'object') {
      return {
        enabled: !!saved.enabled,
        prefix: typeof saved.prefix === 'string' ? saved.prefix : defaultReasoningConfig().prefix,
        suffix: typeof saved.suffix === 'string' ? saved.suffix : defaultReasoningConfig().suffix
      }
    }
  } catch (e) {
    console.warn('[ReasoningHandler] 读取思考解析配置失败:', e)
  }
  return defaultReasoningConfig()
}

export function saveReasoningConfig(cfg: ReasoningSplitConfig): boolean {
  try {
    storage.set(STORAGE_KEY(), {
      enabled: !!cfg.enabled,
      prefix: String(cfg.prefix || ''),
      suffix: String(cfg.suffix || '')
    })
    return true
  } catch (e) {
    console.warn('[ReasoningHandler] 保存思考解析配置失败:', e)
    return false
  }
}

/**
 * 把正文里第一段被前后缀包裹的内容切出来当思考。
 *
 * 只处理**第一段**（多段思考属于罕见用法，剩余部分留在正文里，不做二次切分）。
 * 前/后缀任一为空、或未启用时，原样返回（`content = text`）。
 */
export function splitReasoning(text: string, cfg: ReasoningSplitConfig): ReasoningSplitResult {
  const raw = text || ''
  if (!cfg || !cfg.enabled || !cfg.prefix || !cfg.suffix) {
    return { reasoning: '', content: raw, incomplete: false }
  }

  const start = raw.indexOf(cfg.prefix)
  if (start < 0) {
    return { reasoning: '', content: raw, incomplete: false }
  }

  const bodyStart = start + cfg.prefix.length
  const end = raw.indexOf(cfg.suffix, bodyStart)

  if (end < 0) {
    // 流式中间态：后缀还没到 → 后半段全部当思考，正文只保留前缀之前的部分
    return {
      reasoning: raw.slice(bodyStart).trim(),
      content: raw.slice(0, start),
      incomplete: true
    }
  }

  const reasoning = raw.slice(bodyStart, end).trim()
  const content = raw.slice(0, start) + raw.slice(end + cfg.suffix.length)
  return { reasoning, content, incomplete: false }
}

export default {
  defaultReasoningConfig,
  loadReasoningConfig,
  saveReasoningConfig,
  splitReasoning
}
