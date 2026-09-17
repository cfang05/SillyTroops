// src/engine/ReasoningHandler.ts
// 文本编码思考（COT）的自动识别 + 思考相关设置的读写（P6.4 / D17 / D21）
//
// 背景（见决策记录 9.8）：思考有**两种来源**
//   ① API 原生字段：上游在 `delta.reasoning_content` 里单独返回 —— 由 client 的独立通道处理（P6.1）；
//   ② 文本编码：模型/角色卡把思考**写在正文里**，用定界符包起来（`<think>…</think>`、
//      `<analysis>…</analysis>`、`[思考]…[/思考]` …）。从 API 角度看它就是正文，
//      只能靠定界符事后切分。
//
// D21（用户决定，替代原"用户手填前后缀"的方案）：
//   · **不要用户配置**：开关打开就自动识别，定界符**硬编码**在下面这张表里逐个试；
//   · 折叠块里显示的是**两份思考的并集**：上游 `reasoning_content` + 正文定界符切出的部分。
//
// 流式未闭合也在这里处理：只有开标记、闭标记还没到时，后半段整段当思考、正文只保留开标记之前 ——
// 否则流式期间会先露出思考原文、等闭标记到达才跳变。

import storage from '../utils/storage.js'
// @ts-ignore
import { scopedKey } from '../utils/account/userScope.js'

export interface ReasoningSplitConfig {
  /** 是否解析正文里用定界符包裹的思考（默认关闭，与酒馆的 auto_parse 默认一致） */
  enabled: boolean
}

export interface ReasoningSplitResult {
  /** 切分出来的思考内容（没有则为空串） */
  reasoning: string
  /** 去掉思考块之后的正文 */
  content: string
  /** 是否是"只有开标记、闭标记还没到"的流式中间态 */
  incomplete: boolean
  /** 命中的定界符（未命中为 null）—— 调试用 */
  delimiter: [string, string] | null
}

/**
 * 硬编码的思考定界符（开标记, 闭标记）。
 *
 * 顺序不影响结果（实际取"开标记在正文里出现最早"的那一组），这里只是按常见程度排列。
 * 只收**带括号**的形式：裸词（例如单独一个 thinking）会和正常正文撞车，宁可漏识别也不能误吞。
 */
export const REASONING_DELIMITERS: Array<[string, string]> = [
  ['<think>', '</think>'],
  ['<thinking>', '</thinking>'],
  ['<analysis>', '</analysis>'],
  ['<reasoning>', '</reasoning>'],
  ['<thought>', '</thought>'],
  ['<reflection>', '</reflection>'],
  ['<思考>', '</思考>'],
  ['<思考过程>', '</思考过程>'],
  ['[think]', '[/think]'],
  ['[thinking]', '[/thinking]'],
  ['[reasoning]', '[/reasoning]'],
  ['[思考]', '[/思考]'],
  ['[思考过程]', '[/思考过程]']
]

/** 默认配置：关闭（关掉时行为与改造前完全一致） */
export function defaultReasoningConfig(): ReasoningSplitConfig {
  return { enabled: false }
}

const STORAGE_KEY = () => scopedKey('reasoning_split')

/**
 * 读取配置。只认 `enabled`：
 * 旧版本存过 `{ enabled, prefix, suffix }`，这里**只取 enabled**，
 * 于是"以前存了坏前后缀（后缀为空 → 开关等于没开）"的用户升级后自动变为可用。
 */
export function loadReasoningConfig(): ReasoningSplitConfig {
  try {
    const saved = storage.get(STORAGE_KEY())
    if (saved && typeof saved === 'object') {
      return { enabled: !!saved.enabled }
    }
  } catch (e) {
    console.warn('[ReasoningHandler] 读取思考解析配置失败:', e)
  }
  return defaultReasoningConfig()
}

export function saveReasoningConfig(cfg: ReasoningSplitConfig): boolean {
  try {
    storage.set(STORAGE_KEY(), { enabled: !!(cfg && cfg.enabled) })
    return true
  } catch (e) {
    console.warn('[ReasoningHandler] 保存思考解析配置失败:', e)
    return false
  }
}

/**
 * 把正文里第一段被定界符包裹的内容切出来当思考。
 *
 * 只处理**第一段**（多段思考属于罕见用法，剩余部分留在正文里，不做二次切分）。
 * 未启用、或没有任何定界符命中时，原样返回（`content = text`）。
 */
export function splitReasoning(text: string, cfg: ReasoningSplitConfig): ReasoningSplitResult {
  const raw = text || ''
  if (!cfg || !cfg.enabled) {
    return { reasoning: '', content: raw, incomplete: false, delimiter: null }
  }

  // 多组定界符同时出现时，取"开标记出现位置最靠前"的那一组
  let hit: [string, string] | null = null
  let hitAt = -1
  for (const pair of REASONING_DELIMITERS) {
    const at = raw.indexOf(pair[0])
    if (at < 0) continue
    if (hitAt < 0 || at < hitAt) {
      hit = pair
      hitAt = at
    }
  }
  if (!hit) {
    return { reasoning: '', content: raw, incomplete: false, delimiter: null }
  }

  const bodyStart = hitAt + hit[0].length
  const end = raw.indexOf(hit[1], bodyStart)

  if (end < 0) {
    // 流式中间态：闭标记还没到 → 后半段全部当思考，正文只保留开标记之前的部分
    return {
      reasoning: raw.slice(bodyStart).trim(),
      content: raw.slice(0, hitAt),
      incomplete: true,
      delimiter: hit
    }
  }

  return {
    // 闭标记之后的正文要接回去（思考块可能出现在正文中段）
    reasoning: raw.slice(bodyStart, end).trim(),
    content: raw.slice(0, hitAt) + raw.slice(end + hit[1].length),
    incomplete: false,
    delimiter: hit
  }
}

/**
 * 合并"上游原生思考"与"正文定界符切出的思考"（D21）—— 两者一起放进同一个折叠块。
 *
 * 为什么要防重复：两种来源在个别模型上可能是同一段内容（例如上游既给 reasoning_content、
 * 正文里又带了一份 `<think>`）。这时只保留更长的那一份，避免用户看到两遍。
 */
export function combineReasoning(native?: string, fromText?: string): string {
  const a = String(native || '').trim()
  const b = String(fromText || '').trim()
  if (!a) return b
  if (!b) return a
  if (a === b || a.indexOf(b) >= 0) return a
  if (b.indexOf(a) >= 0) return b
  // 原生在前、正文切出的在后
  return a + '\n\n' + b
}

export default {
  REASONING_DELIMITERS,
  defaultReasoningConfig,
  loadReasoningConfig,
  saveReasoningConfig,
  splitReasoning,
  combineReasoning
}
