// src/engine/tokenizer.ts
// 统一 token 估算入口。当前为启发式估算（无需引入体积较大的真实 tokenizer），
// 并暴露 setTokenCounter 以便 H5 端后续接入真实 tokenizer（如 tiktoken/cl100k_base）时按需替换。

export type TokenCounter = (text: string) => number

let counter: TokenCounter = estimateTokenCount

/**
 * 启发式 token 估算（对齐常见 BPE 经验值）：
 *   - 中日韩全角字符 ≈ 1 token/字
 *   - 英文/数字单词 ≈ 1.3 token/词
 *   - 其余标点符号 ≈ 0.5 token/个
 */
export function estimateTokenCount(text: string): number {
  if (!text) return 0
  const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u3000-\u303f\uff00-\uffef]/g) || []).length
  const rest = text.replace(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u3000-\u303f\uff00-\uffef]/g, ' ')
  const words = (rest.match(/[A-Za-z0-9]+(?:['\-][A-Za-z0-9]+)*/g) || []).length
  const punct = rest.replace(/[A-Za-z0-9\s]/g, '').length
  return Math.max(1, Math.ceil(cjk * 1.0 + words * 1.3 + punct * 0.5))
}

/** 注入自定义 token 计数器（返回 false 表示未接受，用于真实 tokenizer 加载失败的兜底） */
export function setTokenCounter(fn: TokenCounter): void {
  counter = fn
}

/** 计算文本 token 数 */
export function countTokens(text: string): number {
  if (!text) return 0
  try {
    const n = counter(text)
    return Number.isFinite(n) && n > 0 ? Math.ceil(n) : 0
  } catch (e) {
    return estimateTokenCount(text)
  }
}
