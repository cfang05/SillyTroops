// src/utils/llm/stopStrings.ts
// 自定义停止串的整理逻辑。
//
// 单独抽出成模块的原因：`client.js` 是 uni-app 的入口（依赖 uni.request / storage / userManager），
// 无法在 Node 里直接跑；把纯函数放在这里后，既能让 client 复用，也能被回归脚本直接验证。

/** 酒馆对 OpenAI 兼容源最多发 4 条自定义停止串（referencecode/public/scripts/openai.js:142） */
export const MAX_STOP_STRINGS = 4

/** 单条停止串的长度上限（酒馆对部分源会按 1..16 过滤，见 openai.js:2843） */
export const MAX_STOP_STRING_LENGTH = 16

/**
 * 整理自定义停止串，对齐酒馆 `getCustomStoppingStrings(4)`（power-user.js:3072）：
 *   · 去掉 `\r`、两端 trim；
 *   · 丢掉空串与长度不在 [1, 16] 的项；
 *   · 最多保留 4 条。
 *
 * 返回 `null` 表示"一条有效的都没有"——调用方据此**不下发** `stop` 字段
 * （空数组会被部分上游直接判为 400 参数错误）。
 *
 * @param raw 预设里的 customStopStrings（可能是任意脏数据）
 */
export function collectStopStrings(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const cleaned = raw
    .filter((s): s is string => typeof s === 'string')
    .map(s => s.replace(/\r/g, '').trim())
    .filter(s => s.length >= 1 && s.length <= MAX_STOP_STRING_LENGTH)
  if (cleaned.length === 0) return null
  return cleaned.slice(0, MAX_STOP_STRINGS)
}
