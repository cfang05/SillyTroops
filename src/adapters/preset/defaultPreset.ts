// src/adapters/preset/defaultPreset.ts
// 内置默认预设，对齐酒馆 PromptManager.js 的 chatCompletionDefaultPrompts + promptManagerDefaultPromptOrder。
// 用途：用户未导入任何酒馆预设时，保证角色描述/性格/场景/世界书/示例消息仍能进入上下文，
//       与酒馆"开箱即用"行为一致。
//
// 注意：本项目不支持群聊，故 main 里的 {{charIfNotGroup}} 直接写成 {{char}}；marker 提示词
//       （dialogueExamples/chatHistory/worldInfoAfter/worldInfoBefore/charDescription/charPersonality/
//        scenario/personaDescription）content 留空，由 PromptBuilder 运行时填充（见 MARKER_IDS）。

import type { Preset, PromptItem, PromptOrderItem } from '../../types/preset'

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
      continuePrefill: false
    }
  }
}
