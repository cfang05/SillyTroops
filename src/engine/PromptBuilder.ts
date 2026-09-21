// src/engine/PromptBuilder.ts
// 按 Preset 的 promptOrder 构建最终发送给 LLM 的 messages 数组
//
// 对齐酒馆 PromptManager.js + openai.js 的核心语义（合并方案 / 兼容清单 P0-1、P0-2）：
//   1. marker 提示词：charDescription/charPersonality/scenario/dialogueExamples/personaDescription/
//      worldInfoBefore/worldInfoAfter/trpgStatus 这类 identifier 由本文件在运行时用角色卡/Persona/
//      世界书/TRPG 状态填充内容（不再被当作空 prompt 丢弃）。
//   2. injection_position 语义（与酒馆一致）：
//        RELATIVE=0 → 系统块内按 promptOrder 顺序注入
//        ABSOLUTE=1 → 按 injectionDepth 注入对话历史深处
//   3. system_prompt / post_history_instructions 分别覆盖 main / jailbreak。
//
// 世界书注入：由 WorldInfoEngine.scan() 完成匹配/递归/概率/分组/预算/限时，产出 before/after/atDepth
// 桶，再由本文件按 worldInfoBefore/worldInfoAfter marker 位置与 atDepth 深度注入。

import type { Preset, PromptItem } from '../types/preset'
import type { CharacterV2, LorebookEntry } from '../types/character'
import type { AuthorsNoteConfig } from '../types/note'
import { substituteVariables, setTrpgContext } from './VariableEngine'
import { DEBUG_ENABLED } from './DebugLogger'
import { scan as scanWorldInfo, createEmptySessionState, type WorldInfoSessionState, type WorldInfoBucket } from './WorldInfoEngine'
import { applyRegexScripts } from './RegexScriptEngine'
import { estimateTokenCount } from './tokenizer'

export interface ChatHistoryItem {
  role: 'user' | 'assistant'
  content: string
}

export interface BuildContext {
  character: CharacterV2 | null
  preset: Preset
  chatHistory: ChatHistoryItem[]
  userMessage: string
  /** 额外变量（角色名、场景名等），优先级高于 VariableEngine 中存储的变量 */
  variables?: Record<string, string>
  /** 角色卡内嵌的世界书条目 */
  lorebookEntries?: LorebookEntry[]
  /** 世界书限时效果状态（随会话持久化） */
  worldInfoSessionState?: WorldInfoSessionState
  /** 当前 Persona 描述（personaDescription marker） */
  personaDescription?: string
  /** 当前 TRPG 会话状态（trpgStatus marker + {{hp}}/{{scene}} 等宏来源） */
  trpgState?: Record<string, any>
  /** 作者注（Author's Note）配置 */
  authorsNote?: AuthorsNoteConfig
}

export interface BuiltMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** 上下文构成里的一个"段"（P3.3：供分项面板展示） */
export interface PromptSection {
  /** 段名（面板上一行一项） */
  name: string
  /** 该段的估算 token 数（启发式估算，见 tokenizer.ts） */
  tokens: number
  /** 该段包含的消息条数（非消息类段落为 0，例如"回复预留"） */
  messages: number
  /**
   * main  = 参与分区求和（各段之和 ≈ 本次 prompt 用量 + 预留）
   * detail = 「其中」类子项，只说明占比来源，**不参与求和**（否则重复计数）
   */
  kind?: 'main' | 'detail'
}

/**
 * 本次请求的上下文构成快照（P3.3 / D14 分项面板的数据源）
 *
 * 注意：token 数是**本地启发式估算**，而统计口径（监控页）用的是上游返回的真实 usage
 * —— 两者定位不同：这里用于"发送前的预算与裁剪"以及给用户看构成占比（D13）。
 */
export interface PromptInfo {
  /** 模型上下文窗口上限（预设 maxContext） */
  maxContext: number
  /** 为回复预留的 token（预设 maxTokens） */
  reservedResponse: number
  /** 安全余量（估算误差兜底） */
  safetyMargin: number
  /** 可用于 prompt 的预算 = maxContext − reservedResponse − safetyMargin */
  budget: number
  /** 裁剪后的实际估算用量（不含回复预留） */
  used: number
  /** 各段构成 */
  sections: PromptSection[]
  /** 进入上下文的历史条数 */
  historyKept: number
  /** 历史总条数 */
  historyTotal: number
  /** 被省略（最旧）的条数 */
  historyDropped: number
  /** 连强制项（系统提示 + 本次用户消息）都放不下：需要用户调小预设或换更大的上下文 */
  overflowMandatory: boolean
  /** 本次实际发送的完整内容（供"查看原始 prompt"与相邻两次 diff） */
  rawPrompt: string
  /** 生成时间戳 */
  createdAt: number
}

export interface BuildMessagesResult {
  messages: BuiltMessage[]
  worldInfoState: WorldInfoSessionState
  /** 上下文构成快照（P3.3） */
  promptInfo: PromptInfo
}

/** 运行时由系统填充的 marker 提示词 identifier */
const MARKER_IDS = [
  'charDescription',
  'charPersonality',
  'scenario',
  'dialogueExamples',
  'personaDescription',
  'worldInfoBefore',
  'worldInfoAfter',
  'trpgStatus'
] as const

/**
 * prompt 态正则（P4.1 / D5 三态分离）
 *
 * 对每条历史消息按 placement（用户输入=1 / AI 输出=0）配 `isPrompt: true` 跑一遍脚本，
 * 返回**新对象数组**（副本）→ 只影响本次请求，**不改存档**。
 * depth 对齐酒馆语义：距末尾的层数（最后一条为 0）。
 */
function _applyPromptRegex(history: BuiltMessage[], preset: Preset, vars: Record<string, string>): BuiltMessage[] {
  const scripts = preset.regexScripts || []
  if (!scripts.length || !history.length) return history
  const total = history.length
  return history.map((m, i) => {
    const placement = (m.role === 'user' ? 1 : 0) as any
    const content = applyRegexScripts(m.content, scripts, placement, {
      vars,
      isPrompt: true,
      depth: total - i - 1
    })
    return content === m.content ? m : { ...m, content }
  })
}

/**
 * 构建最终发送给 LLM 的 messages 数组
 */
export function buildMessages(ctx: BuildContext): BuildMessagesResult {
  const { preset, chatHistory, character, userMessage, lorebookEntries } = ctx
  const vars = _buildVariableMap(ctx)

  // 让 {{hp}}/{{mp}}/{{scene}}/{{story}}/{{flag}}/{{trust}} 等 TRPG 宏可解析
  setTrpgContext(ctx.trpgState || null)

  // ══════════ 世界书扫描 ══════════
  const sessionState = ctx.worldInfoSessionState || createEmptySessionState()
  const scanResult = scanWorldInfo({
    entries: lorebookEntries || [],
    chatHistory,
    userMessage,
    sessionState,
    budget: {
      maxContext: preset.generationParams?.maxContext || 4000,
      percent: 25,
      cap: 0
    },
    globalScanData: {
      personaDescription: ctx.personaDescription || '',
      characterDescription: character?.data?.description || '',
      characterPersonality: character?.data?.personality || '',
      characterDepthPrompt: (character?.data?.extensions?.depth_prompt && typeof character.data.extensions.depth_prompt.prompt === 'string')
        ? character.data.extensions.depth_prompt.prompt
        : '',
      scenario: character?.data?.scenario || '',
      creatorNotes: character?.data?.creator_notes || ''
    }
  })
  const buckets = scanResult.buckets

  // 世界书内容统一走 WORLD_INFO 正则（内部 placement=2，对齐酒馆 regex_placement.WORLD_INFO）
  // 传入 vars（供 substituteRegex/trimStrings/replaceString 宏替换）
  const wiRegex = (t: string, depth?: number) => applyRegexScripts(
    t,
    preset.regexScripts || [],
    2,
    { vars, isPrompt: true, depth }
  )

  // ══════════ marker 内容映射 ══════════
  const emTop = buckets.emTop.map(t => wiRegex(t.trim())).filter(Boolean)
  const emBottom = buckets.emBottom.map(t => wiRegex(t.trim())).filter(Boolean)
  const dialogueExamples = [
    ...emTop,
    _formatDialogueExamples(character?.data?.mes_example || '', vars),
    ...emBottom
  ].filter(Boolean).join('\n\n')

  const markerContents: Record<string, string> = {
    charDescription: character?.data?.description || '',
    charPersonality: character?.data?.personality || '',
    scenario: character?.data?.scenario || '',
    dialogueExamples,
    personaDescription: ctx.personaDescription || '',
    worldInfoBefore: buckets.before.map(t => wiRegex(t.trim())).filter(Boolean).join('\n\n'),
    worldInfoAfter: buckets.after.map(t => wiRegex(t.trim())).filter(Boolean).join('\n\n'),
    trpgStatus: _buildTrpgStatusText(ctx.trpgState)
  }

  // ══════════ 按 promptOrder 组装 ══════════
  const systemBlock: BuiltMessage[] = []
  const absoluteItems: { role: string; depth: number; content: string }[] = []
  let trpgStatusInjected = false

  const orderedItems = _resolveOrderedPrompts(preset)

  for (const item of orderedItems) {
    if (item.identifier === 'chatHistory') continue // 历史单独处理（在系统块之后）

    // 1. 解析内容：marker → 运行时内容；普通 → prompt.content
    const source = Object.prototype.hasOwnProperty.call(markerContents, item.identifier)
      ? markerContents[item.identifier]
      : (item.content || '')

    // 2. system_prompt / post_history_instructions 覆盖 main / jailbreak
    const { content, overrideVars } = _applyOverrides(item, source, character, vars)

    if (!content || !content.trim()) continue

    const resolved = substituteVariables(content, overrideVars || vars)

    if (item.injectionPosition === 1) {
      // ABSOLUTE=1：按 injectionDepth 注入历史深处
      absoluteItems.push({ role: item.role, depth: item.injectionDepth, content: resolved })
    } else {
      // RELATIVE=0：系统块，按 promptOrder 顺序
      systemBlock.push({ role: item.role, content: resolved })
    }
    if (item.identifier === 'trpgStatus') trpgStatusInjected = true
  }

  // trpgStatus 若不在 promptOrder 里，兜底追加到系统块末尾
  if (markerContents.trpgStatus && !trpgStatusInjected) {
    systemBlock.push({ role: 'system', content: substituteVariables(markerContents.trpgStatus, vars) })
  }

  // ══════════ 兜底注入缺失的 marker 提示词（对齐酒馆行为）══════════
  // 即使用户删除了预设中的 marker 提示词，角色描述/世界书等内容仍能正常注入。
  // 参考：referencecode/openai.js preparePromptsForChatCompletion 的 systemPrompts 合并逻辑。
  const processedIdentifiers = new Set(orderedItems.map(i => i.identifier))
  Object.entries(markerContents).forEach(([identifier, content]) => {
    if (!content || !content.trim()) return
    if (processedIdentifiers.has(identifier)) return  // 已在 promptOrder 中处理，跳过
    
    // 用户预设中没有这个 marker，使用默认配置注入到系统块末尾
    const resolved = substituteVariables(content, vars)
    systemBlock.push({ role: 'system', content: resolved })
    
    if (DEBUG_ENABLED) {
      console.warn(`[PromptBuilder] 兜底注入缺失的 marker: ${identifier}`)
    }
  })

  // depth_prompt（角色注，extensions.depth_prompt）按 depth+role 注入历史深处
  const depthPrompt = character?.data?.extensions?.depth_prompt
  let depthPromptText = ''
  if (depthPrompt && typeof depthPrompt.prompt === 'string' && depthPrompt.prompt.trim()) {
    const resolvedDepthPrompt = substituteVariables(depthPrompt.prompt, vars)
    if (resolvedDepthPrompt.trim()) {
      const role = depthPrompt.role === 'user' || depthPrompt.role === 'assistant' ? depthPrompt.role : 'system'
      absoluteItems.push({ role, depth: typeof depthPrompt.depth === 'number' ? depthPrompt.depth : 4, content: resolvedDepthPrompt })
      depthPromptText = resolvedDepthPrompt // P3.3：分项统计用
    }
  }

  // 作者注（Author's Note）：世界书 ANTop/ANBottom 环绕作者注正文，按 interval 频率注入
  const noteText = _buildAuthorsNoteText(ctx.authorsNote, buckets, vars, wiRegex, chatHistory)
  const noteInChat = !!noteText && !!ctx.authorsNote && ctx.authorsNote.position === 1

  // IN_PROMPT / BEFORE_PROMPT 作者注：注入系统提示块（IN_PROMPT=系统块末尾、BEFORE_PROMPT=系统块最前）
  if (noteText && !noteInChat && ctx.authorsNote) {
    const noteMsg: BuiltMessage = { role: 'system', content: noteText }
    if (ctx.authorsNote.position === 2) {
      systemBlock.unshift(noteMsg)
    } else {
      systemBlock.push(noteMsg)
    }
  }

  // ══════════ 组装最终 messages ══════════
  const result: BuiltMessage[] = [...systemBlock]

  let history = _applyNamesBehavior(chatHistory, character, preset)

  // ══════════ prompt 态正则（P4.1 / D5 三态分离）══════════
  // 对齐酒馆 script.js:4445 —— 历史消息进 prompt 前，逐条按 `{ isPrompt: true }` 跑一遍正则：
  //   · 只有勾了「仅 Prompt」的脚本会在这里生效（第三分支被 isPrompt 挡住）；
  //   · 结果只进本次请求的副本，**不影响存档**（下面 map 出的是新对象）。
  // 改造前这一步完全没有，导致"仅 Prompt"的脚本永远不会执行。
  history = _applyPromptRegex(history, preset, vars)

  history = _insertAbsoluteItems(history, absoluteItems, vars)
  // atDepth 世界书条目内容同样走 WORLD_INFO 正则后，按 depth+role 注入历史深处
  // 传入每个条目自己的 depth（供 minDepth/maxDepth 过滤）
  const atDepthEntries = buckets.atDepth.map(e => ({ ...e, content: wiRegex(e.content, e.depth) }))
  history = _insertAtDepthEntries(history, atDepthEntries)
  // IN_CHAT 作者注：按 depth+role 注入历史深处
  if (noteInChat && noteText && ctx.authorsNote) {
    history = _insertNoteInChat(history, noteText, ctx.authorsNote.depth, ctx.authorsNote.role)
  }

  // ═══════════════════════════════════════════════════════════
  // 上下文裁剪（P3.1 / P3.2 / D10）
  //
  // 预算 = maxContext − 回复预留(maxTokens) − 安全余量
  //   · maxContext 在改造前**只喂给世界书预算**，历史是"有多少发多少"——
  //     长对话必然超窗口，或被上游静默截断（这是本轮修的最关键一处）。
  //   · 安全余量用于吸收本地估算误差（token 计数是启发式估算，见 D13）。
  //
  // 裁剪规则：**从最新一条往旧累加，装不下即停** → 保留一段"连续的最新后缀"。
  //   · 刻意**不保护开场白**（D10，与酒馆一致：反向遍历使 chat[0] 最先被丢）。
  //   · 被丢掉的消息只是"不进这次请求"，存档与页面显示都不受影响。
  // ═══════════════════════════════════════════════════════════
  const genParams: any = preset.generationParams || {}
  const maxContext = (typeof genParams.maxContext === 'number' && genParams.maxContext > 0) ? genParams.maxContext : 4096
  const reservedResponse = (typeof genParams.maxTokens === 'number' && genParams.maxTokens > 0) ? genParams.maxTokens : 2000
  const safetyMargin = Math.min(512, Math.max(96, Math.round(maxContext * 0.02)))
  const budget = Math.max(0, maxContext - reservedResponse - safetyMargin)

  const tokensOf = (msgs: BuiltMessage[]) => msgs.reduce((n, m) => n + estimateTokenCount(m.content || ''), 0)
  const systemTokens = tokensOf(systemBlock)

  const tailUserRaw = (userMessage && (result.length === 0 || result[result.length - 1].content !== userMessage)) ? userMessage : ''
  // 本次用户消息同样走 prompt 态正则（P4.1）：只影响这次请求，存档里仍是用户原文
  const tailUser = tailUserRaw
    ? (_applyPromptRegex([{ role: 'user', content: tailUserRaw }], preset, vars)[0]?.content || tailUserRaw)
    : ''
  const userTokens = tailUser ? estimateTokenCount(tailUser) : 0

  // 强制项：系统提示块（含世界书/作者注等已解析内容）+ 本次用户消息
  const mandatoryTokens = systemTokens + userTokens
  const overflowMandatory = mandatoryTokens > budget
  const historyBudget = Math.max(0, budget - mandatoryTokens)

  let historyKept: BuiltMessage[] = []
  let historyDropped = history.length
  if (!overflowMandatory) {
    let acc = 0
    let startIdx = history.length
    for (let i = history.length - 1; i >= 0; i--) {
      const t = estimateTokenCount(history[i].content || '')
      if (acc + t > historyBudget) break
      acc += t
      startIdx = i
    }
    historyKept = history.slice(startIdx)
    historyDropped = startIdx
  }

  if (DEBUG_ENABLED && (historyDropped > 0 || overflowMandatory)) {
    console.warn(
      `[PromptBuilder] 上下文裁剪: 预算=${budget}(= ${maxContext} − ${reservedResponse} − ${safetyMargin})` +
      `, 强制项=${mandatoryTokens}, 历史保留=${historyKept.length}/${history.length}, 省略=${historyDropped}` +
      (overflowMandatory ? ' ⚠️ 强制项自身已超预算' : '')
    )
  }

  result.push(...historyKept)

  const lastMsg = result[result.length - 1]
  // 续写（D16）：userMessage 为空时**不要**推入空的 user 消息。
  // 空消息会被部分服务端直接拒绝；即使接受，模型也只看到"一句空话"，无从判断该接着写什么。
  // 续写的"接着写"语义改由 MessageProcessor 追加一条 assistant prefill 消息来实现。
  if (tailUser && (!lastMsg || lastMsg.content !== tailUser)) {
    result.push({ role: 'user', content: tailUser })
  }

  // ══════════ 上下文构成快照（P3.3）══════════
  const historyKeptTokens = tokensOf(historyKept)
  const keptTexts = new Set(historyKept.map(m => m.content))
  const sumKeptFrom = (texts: string[]) =>
    texts.filter(t => keptTexts.has(t)).reduce((n, t) => n + estimateTokenCount(t), 0)
  const wiFrontTokens = estimateTokenCount(markerContents.worldInfoBefore) + estimateTokenCount(markerContents.worldInfoAfter)
  const atDepthTokensKept = sumKeptFrom(atDepthEntries.map(e => e.content))
  const depthPromptKept = depthPromptText ? sumKeptFrom([depthPromptText]) : 0
  const noteTokens = noteText ? estimateTokenCount(noteText) : 0
  const noteTokensKept = noteInChat && noteText ? sumKeptFrom([noteText]) : noteTokens

  // 用带显式返回类型的构造器，避免 TS 把 kind 字面量推断成 string（P3.3）
  const mkSection = (name: string, tokens: number, messages: number, kind: 'main' | 'detail' = 'main'): PromptSection =>
    ({ name, tokens, messages, kind })

  const sections: PromptSection[] = [
    mkSection('系统提示词', systemTokens, systemBlock.length),
    mkSection('聊天历史', historyKeptTokens, historyKept.length),
    ...(tailUser ? [mkSection('本次用户消息', userTokens, 1)] : []),
    mkSection('回复预留', reservedResponse, 0),
    mkSection('安全余量', safetyMargin, 0),
    // 「其中」类子项：说明占比来源，**不参与上面的分区求和**
    mkSection('其中·世界书（前/后）', wiFrontTokens, 0, 'detail'),
    mkSection('其中·世界书（深度注入）', atDepthTokensKept, 0, 'detail'),
    mkSection('其中·作者注', noteTokensKept, 0, 'detail'),
    mkSection('其中·角色深度提示', depthPromptKept, 0, 'detail')
  ].filter(s => s.kind === 'main' || s.tokens > 0)

  const promptInfo: PromptInfo = {
    maxContext,
    reservedResponse,
    safetyMargin,
    budget,
    used: systemTokens + historyKeptTokens + userTokens,
    sections,
    historyKept: historyKept.length,
    historyTotal: history.length,
    historyDropped,
    overflowMandatory,
    rawPrompt: result.map(m => `### ${m.role}\n${m.content}`).join('\n\n'),
    createdAt: Date.now()
  }

  if (DEBUG_ENABLED) {
    console.log(`[PromptBuilder] FINAL MESSAGES 摘要 (共 ${result.length} 条):`)
    result.forEach((m, idx) => {
      console.log(`  [${idx}] role=${m.role} | preview="${m.content.slice(0, 40).replace(/\n/g, '\\n')}"`)
    })
  }

  return { messages: result, worldInfoState: scanResult.newSessionState, promptInfo }
}

// ─────────────────────────────────────────────────────────────
// 内部工具
// ─────────────────────────────────────────────────────────────

/** 按 promptOrder 顺序返回启用且存在的 PromptItem */
function _resolveOrderedPrompts(preset: Preset): PromptItem[] {
  const out: PromptItem[] = []
  ;(preset.promptOrder || []).forEach(oe => {
    if (!oe.enabled) return
    const item = preset.prompts.find(p => p.identifier === oe.identifier)
    if (item && item.enabled !== false) out.push(item)
  })
  return out
}

/**
 * system_prompt → main；post_history_instructions → jailbreak。
 * 覆盖时注入 {{original}}（原内容）供宏引用。
 */
function _applyOverrides(
  item: PromptItem,
  content: string,
  character: CharacterV2 | null,
  vars: Record<string, string>
): { content: string; overrideVars?: Record<string, string> } {
  const d = character?.data
  if (!d) return { content }

  if (item.identifier === 'main' && d.system_prompt && d.system_prompt.trim()) {
    return { content: d.system_prompt, overrideVars: { ...vars, original: content } }
  }
  if (item.identifier === 'jailbreak' && d.post_history_instructions && d.post_history_instructions.trim()) {
    return { content: d.post_history_instructions, overrideVars: { ...vars, original: content } }
  }
  return { content }
}

/**
 * 将角色卡 mes_example 格式化为 few-shot 示例块。
 * 对齐酒馆 parseMesExamples + parseExampleIntoIndividual：
 *   1. 按 <START> 切块；
 *   2. 每块内按行解析说话人前缀（{{user}}/{{char}} 或实际用户名/角色名），把连续发言归为同一轮；
 *   3. 输出统一使用 {{user}}: / {{char}}: 前缀（后续由 substituteVariables 替换为真实名字）。
 */
function _formatDialogueExamples(mesExample: string, vars: Record<string, string>): string {
  if (!mesExample || !mesExample.trim()) return ''
  const userName = vars.user || ''
  const charName = vars.char || ''

  const blocks = mesExample.split(/<START>/gi).map(b => b.trim()).filter(Boolean)
  if (!blocks.length) return ''

  const output: string[] = []
  for (const block of blocks) {
    const turns: string[] = []
    let current: 'user' | 'char' | null = null
    let buf: string[] = []

    const flush = () => {
      if (current && buf.length) {
        const text = buf.join('\n').trim()
        if (text) turns.push(current === 'user' ? '{{user}}: ' + text : '{{char}}: ' + text)
      }
      buf = []
    }

    for (const line of block.split('\n')) {
      const userPrefix = _matchNamePrefix(line, '{{user}}', userName)
      const charPrefix = _matchNamePrefix(line, '{{char}}', charName)
      if (userPrefix || charPrefix) {
        flush()
        current = userPrefix ? 'user' : 'char'
        const prefix = userPrefix || charPrefix
        buf.push(line.slice(prefix.length + 1).trim())
      } else if (current) {
        buf.push(line)
      }
      // 未进入任何说话人前的叙述行（如酒馆的 "This is how {{char}} should talk" 引导语）忽略
    }
    flush()

    if (turns.length) output.push('<START>\n' + turns.join('\n'))
  }

  if (!output.length) return ''
  return '[Example messages]\n' + output.join('\n\n')
}

/** 检测行首是否为说话人前缀（{{user}}/{{char}} 或实际名字），命中则返回前缀字符串，否则 null */
function _matchNamePrefix(line: string, ...candidates: string[]): string | null {
  for (const c of candidates) {
    if (c && line.startsWith(c + ':')) return c
  }
  return null
}

/** 由 TRPG 会话状态构建状态块（最小版，Phase 3 接入真实战斗/任务摘要） */
function _buildTrpgStatusText(trpgState: Record<string, any> | undefined): string {
  if (!trpgState || typeof trpgState !== 'object') return ''
  const c = (trpgState.character && typeof trpgState.character === 'object') ? trpgState.character : trpgState
  const lines: string[] = []

  const hp = c.hp, maxHp = c.maxHp
  if (hp !== undefined && hp !== null) lines.push('HP：' + hp + '/' + maxHp)
  const mp = c.mp, maxMp = c.maxMp
  if (mp !== undefined && mp !== null) lines.push('MP：' + mp + '/' + maxMp)
  const san = c.san, maxSan = c.maxSan
  if (san !== undefined && san !== null) lines.push('SAN：' + san + '/' + maxSan)

  const attrPairs: [string, any][] = [
    ['力量', c.effectiveStr ?? c.baseStr ?? c.str],
    ['敏捷', c.effectiveDex ?? c.baseDex ?? c.dex],
    ['体质', c.effectiveCon ?? c.baseCon ?? c.con],
    ['智力', c.effectiveInt ?? c.baseInt ?? c.int],
    ['感知', c.effectiveWis ?? c.baseWis ?? c.wis],
    ['魅力', c.effectiveCha ?? c.baseCha ?? c.cha]
  ]
  const attrs = attrPairs.filter(([, v]) => v !== undefined && v !== null)
  if (attrs.length) lines.push('属性：' + attrs.map(([n, v]) => n + v).join(' '))

  if (trpgState.scene) lines.push('场景：' + trpgState.scene)

  if (!lines.length) return ''
  return '【TRPG 状态】\n' + lines.join('\n')
}

/** namesBehavior=2（CONTENT）时把角色名拼进 assistant 消息正文开头 */
function _applyNamesBehavior(
  history: ChatHistoryItem[],
  character: CharacterV2 | null,
  preset: Preset
): BuiltMessage[] {
  const namesBehavior = preset.generationParams?.namesBehavior
  const charName = character?.data?.name
  if (namesBehavior !== 2 || !charName) {
    return history.map(h => ({ role: h.role as BuiltMessage['role'], content: h.content }))
  }
  return history.map(h => {
    if (h.role === 'assistant' && !h.content.startsWith(charName + ':')) {
      return { role: h.role as BuiltMessage['role'], content: charName + ': ' + h.content }
    }
    return { role: h.role as BuiltMessage['role'], content: h.content }
  })
}

/** ABSOLUTE 提示词：按 injectionDepth 插入到"倒数第 N 条之前" */
function _insertAbsoluteItems(
  history: BuiltMessage[],
  items: { role: string; depth: number; content: string }[],
  vars: Record<string, string>
): BuiltMessage[] {
  if (!items.length) return history
  const result = [...history]
  // depth 大的先插入（离末尾更远），避免互相影响位置
  items.sort((a, b) => b.depth - a.depth).forEach(item => {
    const content = item.content.trim()
    if (!content) return
    const depth = Math.max(0, item.depth)
    const insertIndex = Math.max(0, result.length - depth)
    result.splice(insertIndex, 0, { role: item.role as BuiltMessage['role'], content })
  })
  return result
}

/** 世界书 atDepth 条目：按 depth 插入历史 */
function _insertAtDepthEntries(
  history: BuiltMessage[],
  atDepthEntries: WorldInfoBucket['atDepth']
): BuiltMessage[] {
  if (!atDepthEntries || !atDepthEntries.length) return history
  const result = [...history]
  atDepthEntries.forEach(entry => {
    const content = entry.content.trim()
    if (!content) return
    const depth = Math.max(0, entry.depth)
    const insertIndex = Math.max(0, result.length - depth)
    const role = (entry.role === 'user' || entry.role === 'assistant' || entry.role === 'system') ? entry.role : 'system'
    result.splice(insertIndex, 0, { role, content })
  })
  return result
}

/** 构建作者注正文（世界书 ANTop/ANBottom 环绕 + 宏替换），并做 interval 频率判定 */
function _buildAuthorsNoteText(
  authorsNote: AuthorsNoteConfig | undefined,
  buckets: WorldInfoBucket,
  vars: Record<string, string>,
  wiRegex: (t: string) => string,
  chatHistory: { role: string; content: string }[]
): string {
  if (!authorsNote) return ''
  const anTop = buckets.anTop.map(t => wiRegex(t.trim())).filter(Boolean)
  const anBottom = buckets.anBottom.map(t => wiRegex(t.trim())).filter(Boolean)
  const notePrompt = authorsNote.prompt ? substituteVariables(authorsNote.prompt, vars) : ''
  const body = [...anTop, notePrompt, ...anBottom].filter(t => t && t.trim()).join('\n').trim()
  if (!body) return ''

  // interval 频率：每 N 条用户消息注入一次（当前消息计入；interval<=0 视为禁用）
  const interval = authorsNote.interval > 0 ? authorsNote.interval : 1
  const userCount = chatHistory.filter(h => h.role === 'user').length + 1
  if (userCount % interval !== 0) return ''

  return body
}

/** IN_CHAT 作者注：按 depth+role 插入历史 */
function _insertNoteInChat(
  history: BuiltMessage[],
  noteText: string,
  depth: number,
  role: string
): BuiltMessage[] {
  const result = [...history]
  const d = Math.max(0, depth)
  const insertIndex = Math.max(0, result.length - d)
  const validRole = (role === 'user' || role === 'assistant') ? role : 'system'
  result.splice(insertIndex, 0, { role: validRole as BuiltMessage['role'], content: noteText })
  return result
}

/** 构建变量映射：角色名/用户名/描述等基础宏 + 显式 variables + persona */
function _buildVariableMap(ctx: BuildContext): Record<string, string> {
  const map: Record<string, string> = {}
  if (ctx.character) {
    map.char = ctx.character.data.name || ''
    map.description = ctx.character.data.description || ''
    map.personality = ctx.character.data.personality || ''
    map.scenario = ctx.character.data.scenario || ''
  }
  if (ctx.personaDescription) map.persona = ctx.personaDescription
  if (ctx.variables) Object.assign(map, ctx.variables)
  return map
}
