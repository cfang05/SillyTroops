// src/engine/tokenizer.ts
// 统一 token 计数入口。
//
// 两条路径：
//   ① 真实 tokenizer（js-tiktoken 的 cl100k_base）—— H5 端启动后**后台加载**，加载完成即自动生效；
//   ② 启发式估算 —— 加载中 / 小程序端 / 加载失败的兜底，永远可用且同步。
//
// 两者共用同一个同步 API（countTokens / estimateTokenCount），因此调用方不需要知道用的是哪条路径。
// 这一点很重要：PromptBuilder 的裁剪必须是同步的，不能等一个 await。

export type TokenCounter = (text: string) => number

/**
 * 当前生效的文本计数器。
 * 真实 tokenizer 加载完成前指向启发式估算；加载完成后被 `enableRealTokenizer()` 替换。
 */
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

/** 注入自定义 token 计数器（未注入时保持启发式估算） */
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

// ══════════════════════════════════════════════════════════════
// 每条消息的「框架开销」
//
// 酒馆把 token 计数交给服务端 `/api/tokenizers/openai/count`（`scripts/tokenizers.js:797`），
// 服务端按真实 chat 格式编码**整条消息对象**（role + content + name），不是只算 content。
// 本项目改造前只累加 `content`，于是同一条历史在本项目"看起来"比上游实际消耗少 ——
// 裁剪点因此偏晚，长对话里会被上游静默截断。
//
// 下面是**逐字对齐酒馆服务端**的实现（`referencecode/src/endpoints/tokenizers.js:998-1017`）：
//
//   const tokensPerName    = is0301 ? -1 : 1
//   const tokensPerMessage = is0301 ? 4 : 3
//   const tokensPadding    = 3
//   for (const msg of messages) {
//       n += tokensPerMessage
//       for (const [key, value] of Object.entries(msg)) {   // 遍历消息对象的**所有**字段
//           n += encode(value).length
//           if (key === 'name') n += tokensPerName
//       }
//   }
//   n += tokensPadding
//
// 客户端侧（`scripts/tokenizers.js:797-837`）是"逐条消息单独请求服务端再累加"，
// 初始 -1、末尾 `if (!full) token_count -= 2`；两者叠加后与上面的整段结果一致。
// ══════════════════════════════════════════════════════════════

/** 每条消息的固定框架开销（酒馆服务端 tokensPerMessage；gpt-3.5-turbo-0301 才用 4） */
export const TOKENS_PER_MESSAGE = 3

/** 带 name 字段的消息额外开销（酒馆服务端 tokensPerName） */
export const TOKENS_PER_NAME = 1

/** 整个请求的固定 padding（酒馆服务端 tokensPadding） */
export const TOKENS_PER_REQUEST_PADDING = 3

/**
 * 按"整条消息"计 token，与酒馆服务端同口径：
 *   `TOKENS_PER_MESSAGE` + Σ encode(消息对象每个字段的值) +（有 name 时）`TOKENS_PER_NAME`
 *
 * 注意这里遍历**所有字段**（与酒馆 `Object.entries(msg)` 一致），而不只是 role/content/name；
 * 本项目目前只产出 role/content/name，所以实际等价。
 *
 * 空消息返回 0 —— 与酒馆 `ChatCompletion.getChat()` 跳过空消息一致
 * （否则会在裁剪时凭空多算一条消息的框架开销）。
 *
 * @param msg 形如 `{ role, content, name? }`
 */
export function countMessageTokens(msg: { role?: string; content?: string; name?: string }): number {
  if (!msg) return 0
  const content = typeof msg.content === 'string' ? msg.content : ''
  const name = typeof msg.name === 'string' ? msg.name : ''
  // 空消息返回 0 —— 严格对齐酒馆 `ChatCompletion.getChat()`
  // （`openai.js:4030`：只有 `item.content || item.tool_calls` 才输出，空 content 直接被跳过），
  // 否则会在裁剪时凭空多算一条消息的框架开销。
  if (!content && !name) return 0
  // 遍历消息对象的**所有**字段（与酒馆 `Object.entries(msg)` 一致）；空串字段上游也不会编码出 token
  const entries = Object.entries(msg).filter(([, v]) => typeof v === 'string' && v !== '')
  let n = TOKENS_PER_MESSAGE
  for (const [key, value] of entries) {
    n += countTokens(value as string)
    if (key === 'name') n += TOKENS_PER_NAME
  }
  return n
}

/** 一组消息的**逐条**合计（不含请求级 padding，便于分项统计） */
export function sumMessageTokens(msgs: { role?: string; content?: string; name?: string }[]): number {
  if (!Array.isArray(msgs) || !msgs.length) return 0
  return msgs.reduce((n, m) => n + countMessageTokens(m), 0)
}

/**
 * 一组消息的合计 token，**含请求级 padding**。
 * ⚠️ padding 是**每请求一次**，所以只能对"整份 messages"调用一次；
 * 分项求和请用 `sumMessageTokens()`，否则会把 padding 重复计进去。
 */
export function countMessagesTokens(msgs: { role?: string; content?: string; name?: string }[]): number {
  if (!Array.isArray(msgs) || !msgs.length) return 0
  return sumMessageTokens(msgs) + TOKENS_PER_REQUEST_PADDING
}

// ══════════════════════════════════════════════════════════════
// 真实 tokenizer（js-tiktoken cl100k_base）—— 默认**不加载**（D13）
//
// 改造前这里是模块初始化时就自动 `await import('js-tiktoken/...')`，即每次打开页面
// 都会下载并初始化一套体积很大的 BPE 词表 —— 而它的唯一用途是"生成结束后把整段 prompt
// 重算一遍"，这既是末帧卡顿的来源，也让首屏白白多下载一个大包。
//
// D13 定下的口径是：**统计用上游 usage（真值）；需要估算的地方用启发式估算（极快）**。
// 因此这里改为按需启用：确实需要"本地真实计数"时（例如将来的调试面板）再调用
// enableRealTokenizer()，默认不调用。
// ══════════════════════════════════════════════════════════════
let _realTokenizerLoading: Promise<boolean> | null = null

/**
 * 按需接入真实 tiktoken（cl100k_base）。默认不会被调用。
 * @returns 是否启用成功（失败时静默保留启发式估算）
 */
export function enableRealTokenizer(): Promise<boolean> {
  if (_realTokenizerLoading) return _realTokenizerLoading
  // #ifdef H5
  _realTokenizerLoading = (async () => {
    try {
      const { Tiktoken } = await import('js-tiktoken/lite')
      const cl100k_base = await import('js-tiktoken/ranks/cl100k_base')
      const encoder = new Tiktoken(cl100k_base.default as any)
      setTokenCounter((text: string): number => {
        if (!text) return 0
        try {
          return encoder.encode(text).length
        } catch (e) {
          console.warn('[tokenizer] tiktoken 编码失败，回退到启发式估算:', e)
          return estimateTokenCount(text)
        }
      })
      console.log('[tokenizer] 已按需接入真实 tiktoken (cl100k_base)')
      return true
    } catch (e) {
      console.warn('[tokenizer] tiktoken 加载失败，保留启发式估算:', e)
      return false
    }
  })()
  // #endif
  // #ifndef H5
  _realTokenizerLoading = Promise.resolve(false)
  // #endif
  return _realTokenizerLoading
}

