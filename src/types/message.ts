// src/types/message.ts
// 聊天消息类型定义，扩展 Swipe 支持

import type { RenderNode } from './render'

export type MessageRole = 'user' | 'assistant' | 'system'

export interface ChatMessage {
  role: MessageRole
  /** 当前显示内容，等于 swipes[swipe_id]（如果存在 swipes） */
  content: string
  /** 是否处于流式输出中 */
  isStreaming?: boolean
  /** BlockParser 解析出的渲染节点（用于富文本渲染） */
  segments?: RenderNode[]
  /** 所有变体版本（重新生成/Swipe 产生的历史结果），仅 assistant 消息使用 */
  swipes?: string[]
  /** 当前显示的是 swipes 中的第几个，默认 0 */
  swipe_id?: number
  /**
   * 思考内容（D17 / P6.1）：来自**上游** `reasoning_content` / `reasoning` 独立字段。
   * 不会被当作正文渲染。
   *
   * ⚠️ 2026-09-21 起：它会参与上下文拼接 —— PromptBuilder 按酒馆 `PromptReasoning` 的语义，
   * 只把**最近一轮**带思考的 assistant 消息的思考拼回 prompt（见 `_injectPromptReasoning`）。
   * 所以它属于内容、要入档（`conversationManager` 里也已标明"reasoning 本身要存"）。
   */
  reasoning?: string
  /**
   * 从**正文**里用定界符切出来的思考（D21 / P6.4）：开关打开时自动识别（硬编码定界符表），
   * 切出的部分已从 `content` 中删除。它与 `reasoning` 是**并列的两份来源**，
   * 折叠块里显示的是两者的并集（见 `combineReasoning`）。属于内容，**要入档**。
   */
  reasoningFromText?: string
  /**
   * 思考的"显示态"文本（应用过 REASONING 正则）= `reasoning` 与 `reasoningFromText` 的并集；
   * 与 segments 一样属于派生数据，不入档，读档时重算。
   */
  reasoningDisplay?: string
  /** 思考是否已结束（用于显示"已思考 N 秒"而不是"正在思考"） */
  reasoningDone?: boolean
  /** 思考耗时（毫秒） */
  reasoningDurationMs?: number
  /**
   * 前端隐藏标记（自动回复用）
   *
   * 自动回复时系统会替玩家发一条文本（默认「继续」）给大模型，但**不在前端显示** ——
   * 玩家只看到大模型一轮一轮地输出。这条消息仍然算真实上下文：会进 toChatHistory
   * 参与请求、也会入档，只是 MessageItem 不渲染它。
   */
  hidden?: boolean
  /** 消息创建时间戳 */
  timestamp?: number
}