// src/adapters/preset/defaultPreset.ts
// 内置默认预设，对齐酒馆 PromptManager.js 的 chatCompletionDefaultPrompts + promptManagerDefaultPromptOrder。
// 用途：用户未导入任何酒馆预设时，保证角色描述/性格/场景/世界书/示例消息仍能进入上下文，
//       与酒馆"开箱即用"行为一致。
//
// 注意：本项目不支持群聊，故 main 里的 {{charIfNotGroup}} 直接写成 {{char}}；marker 提示词
//       （dialogueExamples/chatHistory/worldInfoAfter/worldInfoBefore/charDescription/charPersonality/
//        scenario/personaDescription）content 留空，由 PromptBuilder 运行时填充（见 MARKER_IDS）。

import type { Preset, PromptItem, PromptOrderItem } from '../../types/preset'
import { normalizeAutoReply } from '../../types/preset'

const DEFAULT_PROMPTS: PromptItem[] = [
  {
    identifier: 'main',
    name: 'Main Prompt',
    enabled: true,
    role: 'system',
    content: 'Write {{char}}\'s next reply in a fictional chat between {{char}} and {{user}}.',
    injectionPosition: 0,
    injectionDepth: 4,
    injectionOrder: 100
  },
  {
    identifier: 'nsfw',
    name: 'Auxiliary Prompt',
    enabled: true,
    role: 'system',
    content: '',
    injectionPosition: 0,
    injectionDepth: 4,
    injectionOrder: 100
  },
  {
    identifier: 'dialogueExamples',
    name: 'Chat Examples',
    enabled: true,
    role: 'system',
    content: '',
    injectionPosition: 0,
    injectionDepth: 4,
    injectionOrder: 100
  },
  {
    identifier: 'jailbreak',
    name: 'Post-History Instructions',
    enabled: true,
    role: 'system',
    content: '',
    injectionPosition: 0,
    injectionDepth: 4,
    injectionOrder: 100
  },
  {
    identifier: 'chatHistory',
    name: 'Chat History',
    enabled: true,
    role: 'system',
    content: '',
    injectionPosition: 0,
    injectionDepth: 4,
    injectionOrder: 100
  },
  {
    identifier: 'worldInfoAfter',
    name: 'World Info (after)',
    enabled: true,
    role: 'system',
    content: '',
    injectionPosition: 0,
    injectionDepth: 4,
    injectionOrder: 100
  },
  {
    identifier: 'worldInfoBefore',
    name: 'World Info (before)',
    enabled: true,
    role: 'system',
    content: '',
    injectionPosition: 0,
    injectionDepth: 4,
    injectionOrder: 100
  },
  {
    identifier: 'enhanceDefinitions',
    name: 'Enhance Definitions',
    enabled: false,
    role: 'system',
    content: 'If you have more knowledge of {{char}}, add to the character\'s lore and personality to enhance them but keep the Character Sheet\'s definitions absolute.',
    injectionPosition: 0,
    injectionDepth: 4,
    injectionOrder: 100
  },
  {
    identifier: 'charDescription',
    name: 'Char Description',
    enabled: true,
    role: 'system',
    content: '',
    injectionPosition: 0,
    injectionDepth: 4,
    injectionOrder: 100
  },
  {
    identifier: 'charPersonality',
    name: 'Char Personality',
    enabled: true,
    role: 'system',
    content: '',
    injectionPosition: 0,
    injectionDepth: 4,
    injectionOrder: 100
  },
  {
    identifier: 'scenario',
    name: 'Scenario',
    enabled: true,
    role: 'system',
    content: '',
    injectionPosition: 0,
    injectionDepth: 4,
    injectionOrder: 100
  },
  {
    identifier: 'personaDescription',
    name: 'Persona Description',
    enabled: true,
    role: 'system',
    content: '',
    injectionPosition: 0,
    injectionDepth: 4,
    injectionOrder: 100
  }
]

const DEFAULT_PROMPT_ORDER: PromptOrderItem[] = [
  { identifier: 'main', enabled: true },
  { identifier: 'worldInfoBefore', enabled: true },
  { identifier: 'personaDescription', enabled: true },
  { identifier: 'charDescription', enabled: true },
  { identifier: 'charPersonality', enabled: true },
  { identifier: 'scenario', enabled: true },
  { identifier: 'enhanceDefinitions', enabled: false },
  { identifier: 'nsfw', enabled: true },
  { identifier: 'worldInfoAfter', enabled: true },
  { identifier: 'dialogueExamples', enabled: true },
  { identifier: 'chatHistory', enabled: true },
  { identifier: 'jailbreak', enabled: true }
]

export const DEFAULT_PRESET_ID = 'default'

/**
 * 「系统预设」的固定 id（D19）
 *
 * 与「系统正侧」（D15）对称：**代码内置、默认选中、用户另选其他预设时被替换、不落盘**。
 * id 固定，因此它不需要持久化也能在每次启动后被重新植入并被正确引用。
 */
export const SYSTEM_PRESET_ID = 'system'

/**
 * 生成内置默认预设（深拷贝，避免调用方修改污染工厂常量）
 */
export function createDefaultPreset(): Preset {
  return {
    id: DEFAULT_PRESET_ID,
    name: '默认预设',
    prompts: DEFAULT_PROMPTS.map(p => ({ ...p })),
    promptOrder: DEFAULT_PROMPT_ORDER.map(o => ({ ...o })),
    globalVariables: {},
    regexScripts: [],
    generationParams: {
      temperature: 0.8,
      topP: 0.9,
      maxTokens: 2000,
      presencePenalty: 0,
      frequencyPenalty: 0,
      maxContext: 4096,
      stream: false,
      seed: -1,
      n: 1,
      namesBehavior: 0,
      squashSystemMessages: false,
      continuePrefill: false,
      // 世界书扫描默认值对齐酒馆 world-info.js：深度 2、不递归。
      // 若默认 0（扫全部历史）+ 默认开递归，同一个预设在本项目会激活远比酒馆多的条目。
      worldInfoDepth: 2,
      worldInfoRecursive: false,
      worldInfoMaxRecursionSteps: 0,
      // 酒馆默认 wi_format 是 "{0}"（等于不包装）
      worldInfoFormat: '{0}',
      customStopStrings: []
    },
    // 自动回复：几个开关默认全部打开（用户要求"开箱即用"，不必先保存设置）
    autoReply: normalizeAutoReply(null)
  }
}

/**
 * 生成「系统预设」（D19）：在默认预设基础上 **开启流式**，并把上下文参数调到合理区间。
 *
 * 为什么必须调上下文参数：改造前 `maxContext` **只用于世界书预算**，历史是"有多少发多少"，
 * 所以 4096 这个值一直是"无害的摆设"；P3 让 `maxContext` 真正成为 prompt 预算上限后，
 * 4096 − 2000(回复预留) − 安全余量 ≈ 2000 tokens 的预算只够约 1500 汉字（含角色卡与系统提示），
 * 长一点的对话立刻就会被裁到只剩最近几条，用户会以为"模型失忆"。
 *
 * 因此系统预设给一组现代模型常见的默认值：窗口 32K、回复预留 4K（约 27K 的 prompt 预算）。
 * ⚠️ 这个值应当与实际使用的模型匹配，用户可在「预设编辑 → 上下文长度/最大回复长度」里改。
 */
export const SYSTEM_PRESET_MAX_CONTEXT = 32768
export const SYSTEM_PRESET_MAX_TOKENS = 4096

export function createSystemPreset(): Preset {
  const preset = createDefaultPreset()
  return {
    ...preset,
    id: SYSTEM_PRESET_ID,
    name: '系统预设',
    generationParams: {
      ...preset.generationParams,
      stream: true,
      maxContext: SYSTEM_PRESET_MAX_CONTEXT,
      maxTokens: SYSTEM_PRESET_MAX_TOKENS
    }
  }
}
