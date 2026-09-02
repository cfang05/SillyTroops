// src/types/preset.ts
// 预设类型定义，兼容酒馆 PromptManager 的 prompts/prompt_order 结构
// 参考：referencecode/PromptManager.js 的 INJECTION_POSITION 枚举

/**
 * 0 = RELATIVE：按 injectionDepth 从对话历史末尾往前插入
 * 1 = ABSOLUTE：按 promptOrder 列表的绝对顺序插入
 */
export type InjectionPosition = 0 | 1

export interface PromptItem {
  identifier: string
  name: string
  enabled: boolean
  role: 'system' | 'user' | 'assistant'
  /** 支持 {{变量}} 模板 */
  content: string
  injectionPosition: InjectionPosition
  /** RELATIVE 模式下：从对话历史末尾往前数第几条插入 */
  injectionDepth: number
  /** ABSOLUTE 模式下：在 promptOrder 中的排序权重 */
  injectionOrder: number
}

export interface PromptOrderItem {
  identifier: string
  enabled: boolean
}

/**
 * 角色名称注入行为，对齐酒馆 character_names_behavior（referencecode/openai.js）
 * -1 = NONE：不注入任何名字
 *  0 = DEFAULT：群聊/旁白等场景才添加名字前缀
 *  1 = COMPLETION：以 name 字段形式随消息一起发给 API（仅部分供应商支持）
 *  2 = CONTENT：把名字拼进消息正文内容里
 */
export type NamesBehavior = -1 | 0 | 1 | 2

export interface GenerationParams {
  temperature: number
  topP: number
  /** 单次回复最大 token 数，对应酒馆 openai_max_tokens（回复长度） */
  maxTokens: number
  presencePenalty: number
  frequencyPenalty: number
  /** 采样范围限制，多数 OpenAI 兼容接口支持，0 表示不限制 */
  topK?: number
  /** 上下文总长度上限（prompt+回复），对应酒馆 openai_max_context（上下文长度） */
  maxContext?: number
  /** 是否使用流式传输（SSE），对应酒馆 stream_openai */
  stream?: boolean
  /** 随机数种子，-1 表示不固定 */
  seed?: number
  /** 单次请求生成几个候选回复，对应酒馆 n（每次生成多个备选回复） */
  n?: number
  /** 角色名称注入行为 */
  namesBehavior?: NamesBehavior
  /** 是否合并连续的 system 消息，对应酒馆 squash_system_messages */
  squashSystemMessages?: boolean
  /** continue（续写）时是否复用上一条 assistant 消息作为前缀而不是新开一条 */
  continuePrefill?: boolean
}

export interface Preset {
  id: string
  name: string
  prompts: PromptItem[]
  promptOrder: PromptOrderItem[]
  /** 跨对话持久化的全局变量 */
  globalVariables: Record<string, string>
  regexScripts: import('./script').RegexScript[]
  generationParams: GenerationParams
  /** 导入时的原始文件名（不含扩展名），用于在选择器里让用户认出自己导入的文件 */
  fileName?: string
}
