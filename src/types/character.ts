// src/types/character.ts
// 角色卡类型定义，与 SillyTavern Character Card V2 规范对齐
// 参考：referencecode/char-data.js 中的 v2CharData JSDoc 定义
// 内嵌 lorebook 条目格式与 utils/lore/charCardParser.js 的 normalizeEntry() 输出对齐

export interface LorebookEntry {
  id: string
  keys: string[]
  /** 次要关键词（选择性触发时的 AND/OR 匹配组） */
  secondaryKeys?: string[]
  regex?: string | null
  content: string
  priority: number
  insertionOrder: number
  /**
   * 注入位置，对齐酒馆 world_info_position：
   *   before_context / after_context —— 历史前 / 用户输入前
   *   at_depth                       —— 插入历史消息中间指定深度
   *   an_top / an_bottom             —— 作者注上方/下方（预留，P2+ 后续功能）
   *   em_top / em_bottom             —— 示例消息上方/下方（预留，P2+ 后续功能）
   *   outlet                         —— 自定义出口点（预留）
   *   system                         —— 兼容旧数据，等价 after_context
   */
  position: 'before_context' | 'after_context' | 'at_depth' | 'an_top' | 'an_bottom' | 'em_top' | 'em_bottom' | 'outlet' | 'system'
  enabled: boolean
  constant: boolean
  /** 是否为选择性触发（需要 secondaryKeys 配合） */
  selective?: boolean
  /** 次级关键词逻辑，对齐酒馆 world_info_logic：0=AND_ANY 1=NOT_ALL 2=NOT_ANY 3=AND_ALL */
  selectiveLogic?: number
  comment?: string
  /** 原始 extensions 字段（depth/probability 等），编辑时保留、导出时回填，避免信息丢失 */
  extensions?: Record<string, any>

  // ── P0：匹配增强 ──────────────────────────────────────────
  /** 该条目的扫描深度（消息条数），覆盖全局默认值 */
  scanDepth?: number | null
  /** 大小写敏感开关，覆盖全局设置 */
  caseSensitive?: boolean | null
  /** 整词匹配开关，覆盖全局设置 */
  matchWholeWords?: boolean | null

  // ── 全局扫描源（对齐酒馆 globalScanData 的 6 个 match_* 开关） ──
  /** 匹配 persona 描述文本 */
  matchPersonaDescription?: boolean
  /** 匹配角色描述文本 */
  matchCharacterDescription?: boolean
  /** 匹配角色性格文本 */
  matchCharacterPersonality?: boolean
  /** 匹配角色深度提示词（depth_prompt）文本 */
  matchCharacterDepthPrompt?: boolean
  /** 匹配场景（scenario）文本 */
  matchScenario?: boolean
  /** 匹配创作者备注（creator_notes）文本 */
  matchCreatorNotes?: boolean

  // ── P1：递归 / 概率 / 分组 / 预算 ──────────────────────────
  /** 分组打分开关（P1 预留，当前分组胜者仅用权重/优先级，不做打分） */
  useGroupScoring?: boolean | null
  /** 激活概率 0-100，默认 100（必激活） */
  probability?: number
  /** 是否启用概率判定，false 时忽略 probability，始终视为通过 */
  useProbability?: boolean
  /** 互斥分组名（逗号分隔可属于多个组） */
  group?: string
  /** 组内优先级胜出（存在则跳过权重随机） */
  groupOverride?: boolean
  /** 组内加权随机的权重，默认 100 */
  groupWeight?: number
  /** at_depth 使用的深度，默认 4 */
  depth?: number
  /** at_depth 注入时使用的角色 */
  role?: 'system' | 'user' | 'assistant'
  /** 预算溢出后仍强制注入 */
  ignoreBudget?: boolean
  /** 递归轮次中排除该条目参与扫描 */
  excludeRecursion?: boolean
  /** 该条目激活后其内容不参与递归扫描（但条目本身正常注入） */
  preventRecursion?: boolean
  /** 延迟到递归轮次才可激活；true=1级，数字=具体级别 */
  delayUntilRecursion?: boolean | number

  // ── P2：限时效果 ──────────────────────────────────────────
  /** 激活后保持生效的轮数（sticky），null/0 表示不启用 */
  sticky?: number | null
  /** sticky 结束后进入冷却的轮数，null/0 表示不启用 */
  cooldown?: number | null
  /** 延迟生效：低于该轮数不允许激活，null/0 表示不启用 */
  delay?: number | null
}

export interface CharacterBook {
  name?: string
  entries: LorebookEntry[]
}

// ─────────────────────────────────────────────────────────────
// TRPG 扩展（挂在 extensions.trpg）：TRPG 能力作为独立开关，默认全关
// 酒馆导入的卡无 trpg 字段，行为与纯聊天卡完全一致
// ─────────────────────────────────────────────────────────────

/** TRPG 模块开关（挂在 extensions.trpg.modules） */
export interface TrpgModules {
  intentDetection: boolean
  combat: boolean
  inventory: boolean
  characterStatus: boolean
  dicePanel: boolean
  stats: boolean
  adventure: boolean
}

export const DEFAULT_TRPG_MODULES: TrpgModules = {
  intentDetection: false,
  combat: false,
  inventory: false,
  characterStatus: false,
  dicePanel: false,
  stats: false,
  adventure: false
}

/** TRPG 配置块（原 story.initialState/scenes/items/quests 等故事数据的迁移归宿） */
export interface TrpgConfig {
  modules: TrpgModules
  /** 原 story.initialState.scene */
  initialScene?: string
  /** 原 story.initialState.flags */
  initialFlags?: Record<string, any>
  startingItems?: { id: string; quantity: number }[]
  /** 初始快捷操作（原 story.initialQuickActions，供聊天页建议行动 UI） */
  initialQuickActions?: string[]
  /** 故事专属物品定义（供 itemManager 使用） */
  items?: Record<string, any>
  availableQuests?: any[]
  clues?: any[]
  endings?: any[]
  secrets?: any[]
  /** human-despair 特有的访客辨伪玩法数据 */
  visitors?: { friendly: any[]; impostors: any[] }
  /** 故事的 NPC 非战斗数据（trustThresholds/sampleDialogues/secret，供 adventure 模块；战斗数值在世界书 [combat] 行） */
  npcs?: Record<string, any>
  collectibles?: { items?: string[]; traits?: string[]; endings?: string[] }
}

/** Persona 的 TRPG 数值档案（仅当某卡开启 stats 时才需要填） */
export interface TrpgProfile {
  race?: string
  class?: string
  level?: number
  background?: string
  appearance?: string
  personality?: string
  hp?: number
  maxHp?: number
  mp?: number
  maxMp?: number
  san?: number
  maxSan?: number
  attributes?: { str: number; dex: number; con: number; int: number; wis: number; cha: number }
  ac?: number
  initiative?: number
  speed?: number
  proficiencies?: Record<string, boolean>
  traits?: any[]
  equipment?: Record<string, string>
  statusEffects?: any[]
  specialties?: string[]
  roleplayHints?: string
}

export interface CharacterV2Data {
  name: string
  /** 角色头像（base64 data URL 或远程 URL）。PNG 角色卡导入时使用原图作为头像 */
  avatar?: string
  description: string
  personality: string
  scenario: string
  first_mes: string
  mes_example: string
  character_version?: string
  system_prompt?: string
  post_history_instructions?: string
  creator_notes?: string
  creator?: string
  tags?: string[]
  alternate_greetings?: string[]
  character_book?: CharacterBook
  /** 群聊话痨度 0-1，对应酒馆 talkativeness_slider */
  talkativeness?: number
  extensions?: {
    /** 角色笔记（Character's Note）内容，插入到对话中指定深度和角色 */
    depth_prompt?: {
      prompt: string
      depth: number
      role: 'system' | 'user' | 'assistant'
    }
    /** TRPG 玩法扩展（默认无 → 纯聊天卡行为） */
    trpg?: TrpgConfig
    /** 角色卡自带正则脚本（酒馆 SCOPED 类型来源），是否生效由 allowScopedRegex 控制 */
    regex_scripts?: import('./script').RegexScript[]
    /**
     * 是否允许使用该角色卡自带的 regex_scripts（对齐酒馆 character_allowed_regex 白名单机制）。
     * 默认关闭：角色卡来自第三方下载，其自带正则/替换规则未经用户确认前不应静默生效。
     */
    allowScopedRegex?: boolean
    [key: string]: any
  }
}

export interface CharacterV2 {
  spec: 'chara_card_v2'
  spec_version?: string
  data: CharacterV2Data
}

/**
 * 内部使用的角色运行时数据（对齐现有 character-manager.js 的存储结构）
 * 用于 characterStore，兼容现有的扁平字段（六维属性等）
 */
export interface CharacterRuntime {
  id: string
  name: string
  surname?: string
  race?: string
  gender?: string
  bio?: string
  portrait?: string
  hp?: number
  maxHp?: number
  mp?: number
  maxMp?: number
  san?: number
  maxSan?: number
  attributes?: {
    str: number
    dex: number
    con: number
    int: number
    wis: number
    cha: number
  }
  traits?: any[]
  // v2 角色卡兼容字段
  description?: string
  personality?: string
  scenario?: string
  first_mes?: string
  mes_example?: string
  system_prompt?: string
  tags?: string[]
}