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
  /**
   * 酒馆的 `system_prompt` 标志（预设里 main/nsfw/jailbreak 等为 true）。
   *
   * 参考 `openai.js:1234`：酒馆只把 `system_prompt === false` 的条目视为"用户可排序提示词"
   * （`userRelativePrompts`），`true` 的条目走 `systemPrompts` 预置列表。
   * 本项目目前的组装顺序等价于后者，因此该字段暂不参与组装，只做保真存储，
   * 以免后续要按酒馆的两桶分流时缺少数据。
   */
  systemPrompt?: boolean
  /** 生成类型触发器（酒馆 injection_trigger），留空 = 所有生成类型都注入 */
  injectionTrigger?: string[]
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
  /**
   * 世界书关键词扫描深度（看最近几条消息），对应酒馆 world_info_depth。
   * 0 = 扫描全部历史（本项目改造前的旧行为）；酒馆默认值是 2，导入时按酒馆默认值补。
   */
  worldInfoDepth?: number
  /** 世界书递归扫描开关，对应酒馆 world_info_recursive（酒馆默认关闭） */
  worldInfoRecursive?: boolean
  /** 世界书最大递归步数，对应酒馆 world_info_max_recursion_steps（0 = 不额外限制，交给预算兜底） */
  worldInfoMaxRecursionSteps?: number
  /**
   * 世界书内容的外层包装模板，对应酒馆 `wi_format`（默认 `"{0}"`）。
   * 酒馆在 `formatWorldInfo()` 里用 `stringFormat(wi_format, value)` 包一层，
   * 预设作者常用它给世界书加 `[World Info]` 之类的标题。
   */
  worldInfoFormat?: string
  /**
   * 自定义停止串，对应酒馆「自定义停止序列」（`custom_stopping_strings`，一个 JSON 字符串数组）。
   * 酒馆对 OpenAI 兼容源最多发 4 条（`openai_max_stop_strings = 4`），空白/超长的不发。
   */
  customStopStrings?: string[]
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
  /** 自动回复（长按发送键 3 秒进入）配置，跟随本预设 */
  autoReply?: AutoReplyConfig
  /** 导入时的原始文件名（不含扩展名），用于在选择器里让用户认出自己导入的文件 */
  fileName?: string
}

/**
 * 自动回复配置（对话设置页里配置，跟随本预设）
 *
 * 语义：玩家没有输入内容时长按发送键 3 秒进入自动回复，系统自动把 `customText`
 * 当作用户消息反复发给大模型；这条用户消息在前端**不显示**（ChatMessage.hidden）。
 */
export interface AutoReplyConfig {
  /** 总开关：关掉时长按发送键不进入自动回复 */
  enabled: boolean
  /** 是否使用自定义文本；关闭时固定用 DEFAULT_AUTO_REPLY_TEXT */
  useCustomText: boolean
  /** 自定义自动输入文本 */
  customText: string
}

/** 自动回复默认文本（用户要求的默认值） */
export const DEFAULT_AUTO_REPLY_TEXT = '继续'

/**
 * 自动回复配置的归一化 + 默认值（唯一来源，避免各处默认值漂移）
 *
 * ⚠️ 用户要求：**几个开关默认全部打开** —— 也就是说刚装好/刚导入的预设就已经能用自动回复，
 * 不必先跑一趟「对话设置」把开关拨开。因此这里判定的是 `!== false`（缺字段 = 开），
 * 而不是 `=== true`（缺字段 = 关）。
 */
export function normalizeAutoReply(raw: any): AutoReplyConfig {
  const ar = (raw && typeof raw === 'object') ? raw : {}
  return {
    enabled: ar.enabled !== false,
    useCustomText: ar.useCustomText !== false,
    // 空字符串原样保留（用户可能正在清空重填）；真正发送前由调用方回落到默认文本
    customText: typeof ar.customText === 'string' ? ar.customText : DEFAULT_AUTO_REPLY_TEXT
  }
}
