// src/types/message.ts
// 聊天消息类型定义，兼容现有 game.vue 消息结构并扩展 Swipe 支持

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
  /** 消息创建时间戳 */
  timestamp?: number
}