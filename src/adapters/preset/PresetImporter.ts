// src/adapters/preset/PresetImporter.ts
// 酒馆预设 JSON → 内部 Preset 标准模型
// 参考 referencecode/PromptManager.js 的 prompts/prompt_order 结构

import type { Preset, PromptItem, PromptOrderItem, GenerationParams } from '../../types/preset'

/**
 * 从酒馆预设 JSON 导入为内部 Preset
 * 酒馆的 prompt_order 是数组套数组结构，格式：
 *   prompt_order: [ { character_id: 100001, order: [{identifier, enabled}, ...] }, ... ]
 * 100001 是全局默认绑定，本函数默认取该条（或数组第一条）
 */
export function importFromSillyTavern(json: any, fileName?: string): Preset {
  if (!json || typeof json !== 'object') {
    throw new Error('预设导入失败：JSON 格式不正确')
  }

  const prompts: PromptItem[] = Array.isArray(json.prompts)
    ? json.prompts.map((p: any) => _normalizePromptItem(p))
    : []

  const promptOrder: PromptOrderItem[] = _extractPromptOrder(json.prompt_order)

  const generationParams: GenerationParams = {
    temperature: typeof json.temperature === 'number' ? json.temperature : 0.8,
    topP: typeof json.top_p === 'number' ? json.top_p : 0.9,
    maxTokens: typeof json.max_length === 'number' ? json.max_length
      : (typeof json.openai_max_tokens === 'number' ? json.openai_max_tokens : 2000),
    presencePenalty: typeof json.presence_penalty === 'number' ? json.presence_penalty : 0,
    frequencyPenalty: typeof json.frequency_penalty === 'number' ? json.frequency_penalty : 0,
    topK: typeof json.top_k === 'number' ? json.top_k : 0,
    maxContext: typeof json.openai_max_context === 'number' ? json.openai_max_context : 4096,
    stream: typeof json.stream_openai === 'boolean' ? json.stream_openai : false,
    seed: typeof json.seed === 'number' ? json.seed : -1,
    n: typeof json.n === 'number' ? json.n : 1,
    namesBehavior: [-1, 0, 1, 2].includes(json.names_behavior) ? json.names_behavior : 0,
    squashSystemMessages: typeof json.squash_system_messages === 'boolean' ? json.squash_system_messages : false,
    continuePrefill: typeof json.continue_prefill === 'boolean' ? json.continue_prefill : false
  }

  // 酒馆预设 JSON 常把正则脚本内嵌在 extensions.regex_scripts 里（而不是单独的正侧文件），
  // 之前这里硬编码成 []，导致预设自带的脚本在导入时就被整体丢弃，永远不会进入 LLM 上下文。
  const embeddedRegexScripts = Array.isArray(json?.extensions?.regex_scripts)
    ? importRegexScripts(json.extensions.regex_scripts)
    : []

  return {
    id: _generateId(),
    name: json.name || '导入的预设',
    prompts,
    promptOrder,
    globalVariables: {},
    regexScripts: embeddedRegexScripts,
    generationParams,
    fileName: fileName || undefined
  }
}

/**
 * 酒馆原始 regex_placement 编号 → 本项目内部编号（见 types/script.ts 顶部注释）
 * 酒馆：MD_DISPLAY=0, USER_INPUT=1, AI_OUTPUT=2, SLASH_COMMAND=3, WORLD_INFO=5, REASONING=6
 * 内部：AI输出=0,       用户输入=1,   世界信息=2,                              推理=3
 * MD_DISPLAY(0) 和 SLASH_COMMAND(3) 在本项目里没有对应场景（没有单独的"仅前端展示"或"斜杠命令"
 * 处理阶段），暂时丢弃这两类占位（不映射到任何内部编号），避免误挂到 AI 输出上导致污染。
 */
const ST_TO_INTERNAL_PLACEMENT: Record<number, number | undefined> = {
  1: 1, // USER_INPUT -> 用户输入
  2: 0, // AI_OUTPUT -> AI 输出
  5: 2, // WORLD_INFO -> 世界信息
  6: 3  // REASONING -> 推理
}

/**
 * 导入独立的正则脚本数组（酒馆 regex_scripts 格式）并附加到已有 Preset
 * 关键：必须把酒馆原始 placement 编号转换成本项目内部编号，否则脚本会因为编号不匹配而永远不生效
 */
export function importRegexScripts(json: any[]): Preset['regexScripts'] {
  if (!Array.isArray(json)) return []
  return json.map((s: any) => {
    const rawPlacement: number[] = Array.isArray(s.placement) ? s.placement : [2] // 默认按 AI_OUTPUT 处理
    const mapped = rawPlacement
      .map((p: number) => ST_TO_INTERNAL_PLACEMENT[p])
      .filter((p: number | undefined): p is number => p !== undefined)
    return {
      id: s.id || _generateId(),
      scriptName: s.scriptName || s.script_name || '未命名脚本',
      findRegex: s.findRegex || s.find_regex || '',
      replaceString: s.replaceString || s.replace_string || '',
      trimStrings: Array.isArray(s.trimStrings) ? s.trimStrings : (Array.isArray(s.trim_strings) ? s.trim_strings : []),
      placement: (mapped.length > 0 ? mapped : [0]) as any,
      disabled: !!s.disabled,
      markdownOnly: !!s.markdownOnly,
      promptOnly: !!s.promptOnly,
      runOnEdit: !!s.runOnEdit,
      minDepth: typeof s.minDepth === 'number' ? s.minDepth : undefined,
      maxDepth: typeof s.maxDepth === 'number' ? s.maxDepth : undefined,
      substituteRegex: typeof s.substituteRegex === 'number' ? s.substituteRegex : 0
    }
  })
}

// ─────────────────────────────────────────────────────────────
// 内部工具
// ─────────────────────────────────────────────────────────────

function _normalizePromptItem(p: any): PromptItem {
  return {
    identifier: p.identifier || _generateId(),
    name: p.name || p.identifier || '未命名',
    enabled: p.enabled !== false,
    role: p.role === 'user' || p.role === 'assistant' ? p.role : 'system',
    content: p.content || '',
    injectionPosition: p.injection_position === 1 ? 1 : 0,
    injectionDepth: typeof p.injection_depth === 'number' ? p.injection_depth : 4,
    injectionOrder: typeof p.injection_order === 'number' ? p.injection_order : 100
  }
}

function _extractPromptOrder(promptOrder: any): PromptOrderItem[] {
  if (!Array.isArray(promptOrder) || promptOrder.length === 0) return []

  // 优先取 character_id === 100001（酒馆全局默认绑定）
  const defaultEntry = promptOrder.find((e: any) => e.character_id === 100001) || promptOrder[0]
  const order = defaultEntry && Array.isArray(defaultEntry.order) ? defaultEntry.order : []

  return order.map((o: any) => ({
    identifier: o.identifier,
    enabled: o.enabled !== false
  }))
}

function _generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}