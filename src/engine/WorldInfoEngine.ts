// src/engine/WorldInfoEngine.ts
// 世界书扫描引擎 —— 仅服务于 chat 模式，条目来源固定为角色卡内嵌 character_book。
// 对齐酒馆 world-info.js 的 checkWorldInfo 状态机模型（递归扫描/概率/分组/限时效果/位置分发），
// 但只有一种条目来源（角色卡），不涉及全局/聊天/persona 世界书文件。
//
// 分阶段实现说明：
//   P0：位置分发（before/after/atDepth/AN/EM/outlet 桶）+ 匹配增强（正则/整词/大小写）
//   P1：递归扫描 + 概率触发 + 互斥分组 + 预算改为百分比+cap
//   P2：限时效果（sticky/cooldown/delay）+ 状态持久化（newSessionState 由调用方回写）
//
// 不修改 utils/lore/lorebookManager.js，TRPG 路径完全不受影响。

import type { LorebookEntry } from '../types/character'
import { isEntryActivated } from './worldInfoMatcher'
import { countTokens } from './tokenizer'

// ─────────────────────────────────────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────────────────────────────────────

export interface WorldInfoSessionState {
  /** entryId -> 剩余 sticky 生效轮数 */
  sticky: Record<string, number>
  /** entryId -> 剩余冷却轮数 */
  cooldown: Record<string, number>
  /** 当前对话轮数计数器（用于 delay 判定） */
  round: number
}

export function createEmptySessionState(): WorldInfoSessionState {
  return { sticky: {}, cooldown: {}, round: 0 }
}

export interface WorldInfoBudgetConfig {
  /** 当前上下文总长度上限（近似 token 数） */
  maxContext: number
  /** 预算占上下文的百分比，0-100 */
  percent: number
  /** 硬上限（token 数），0 表示不设上限 */
  cap: number
}

export interface WorldInfoGlobalScanData {
  personaDescription?: string
  characterDescription?: string
  characterPersonality?: string
  characterDepthPrompt?: string
  scenario?: string
  creatorNotes?: string
}

export interface WorldInfoScanInput {
  /** 角色卡内嵌世界书条目（唯一来源） */
  entries: LorebookEntry[]
  /** 对话历史（正序） */
  chatHistory: { role: string; content: string }[]
  userMessage: string
  sessionState?: WorldInfoSessionState
  budget?: Partial<WorldInfoBudgetConfig>
  /** 全局递归开关，默认开启 */
  recursive?: boolean
  /** 最大递归步数，防止死循环 */
  maxRecursionSteps?: number
  /** 默认扫描深度（消息条数），0 = 不限制（取全部历史） */
  defaultScanDepth?: number
  /** 全局大小写敏感开关，条目可覆盖 */
  caseSensitive?: boolean
  /** 全局整词匹配开关，条目可覆盖 */
  matchWholeWords?: boolean
  /** 全局扫描源（对齐酒馆 globalScanData 六源，配合条目 match_* 开关） */
  globalScanData?: WorldInfoGlobalScanData
}

export interface WorldInfoBucket {
  before: string[]
  after: string[]
  atDepth: { depth: number; role: string; content: string }[]
  anTop: string[]
  anBottom: string[]
  emTop: string[]
  emBottom: string[]
  outlet: { name: string; content: string }[]
}

export interface WorldInfoScanResult {
  buckets: WorldInfoBucket
  activatedIds: string[]
  newSessionState: WorldInfoSessionState
}

// ─────────────────────────────────────────────────────────────────────────────
// 内部工具
// ─────────────────────────────────────────────────────────────────────────────

/** 构建单个条目的扫描文本：最近 scanDepth 条历史 + 当前输入 + 递归缓冲区 + 命中的全局扫描源 */
function buildScanTextForEntry(
  userMessage: string,
  chatHistory: { role: string; content: string }[],
  scanDepth: number,
  recurseBuffer: string,
  entry: LorebookEntry,
  globalScanData?: WorldInfoGlobalScanData
): string {
  const depth = scanDepth > 0 ? Math.min(scanDepth, chatHistory.length) : chatHistory.length
  const recent = chatHistory.slice(chatHistory.length - depth)
  const parts = [userMessage, ...recent.map(m => m.content), recurseBuffer]

  // 对齐酒馆 WorldInfoBuffer#get：按条目的 match_* 开关追加全局扫描源
  if (globalScanData) {
    if (entry.matchPersonaDescription && globalScanData.personaDescription) parts.push(globalScanData.personaDescription)
    if (entry.matchCharacterDescription && globalScanData.characterDescription) parts.push(globalScanData.characterDescription)
    if (entry.matchCharacterPersonality && globalScanData.characterPersonality) parts.push(globalScanData.characterPersonality)
    if (entry.matchCharacterDepthPrompt && globalScanData.characterDepthPrompt) parts.push(globalScanData.characterDepthPrompt)
    if (entry.matchScenario && globalScanData.scenario) parts.push(globalScanData.scenario)
    if (entry.matchCreatorNotes && globalScanData.creatorNotes) parts.push(globalScanData.creatorNotes)
  }

  return parts.filter(Boolean).join('\n')
}

const POSITION_LABEL: Record<string, string> = {
  before_context: '历史前',
  after_context: '用户输入前',
  at_depth: '历史中间',
  an_top: '作者注上方',
  an_bottom: '作者注下方',
  em_top: '示例消息上方',
  em_bottom: '示例消息下方',
  outlet: '自定义出口',
  system: '用户输入前'
}

/** 按条目 position 分发到对应的桶，并打印分发日志 */
function dispatchToBucket(buckets: WorldInfoBucket, entry: LorebookEntry): void {
  console.log(`[WI] 分发: id="${entry.id}" → position="${entry.position}" (${POSITION_LABEL[entry.position] || '未知'})`)

  switch (entry.position) {
    case 'after_context':
    case 'system':
      buckets.after.push(entry.content)
      break
    case 'at_depth':
      buckets.atDepth.push({ depth: entry.depth ?? 4, role: entry.role || 'system', content: entry.content })
      break
    case 'an_top':
      buckets.anTop.push(entry.content)
      break
    case 'an_bottom':
      buckets.anBottom.push(entry.content)
      break
    case 'em_top':
      buckets.emTop.push(entry.content)
      break
    case 'em_bottom':
      buckets.emBottom.push(entry.content)
      break
    case 'outlet':
      buckets.outlet.push({ name: (entry.extensions && entry.extensions.outlet_name) || '', content: entry.content })
      break
    case 'before_context':
    default:
      buckets.before.push(entry.content)
      break
  }
}

interface Candidate {
  entry: LorebookEntry
  wasSticky: boolean
}

/**
 * 扫描后推进限时效果状态：
 *   - 本轮以 sticky 免检激活的条目：sticky 计数 -1，归零后若配置了 cooldown 则转入冷却
 *   - 本轮以关键词新激活且配置了 sticky 的条目：写入 sticky 初始值
 *   - 本轮以关键词新激活且未配置 sticky 但配置了 cooldown 的条目：直接进入冷却
 *   - 未被本轮处理的既有 sticky/cooldown：按轮数正常递减
 */
function advanceSessionState(prevState: WorldInfoSessionState, activated: Candidate[]): WorldInfoSessionState {
  const sticky: Record<string, number> = {}
  const cooldown: Record<string, number> = {}
  const handledIds = new Set(activated.map(a => a.entry.id))

  Object.keys(prevState.cooldown).forEach(id => {
    if (handledIds.has(id)) return
    const remain = prevState.cooldown[id] - 1
    if (remain > 0) cooldown[id] = remain
  })

  Object.keys(prevState.sticky).forEach(id => {
    if (handledIds.has(id)) return
    sticky[id] = prevState.sticky[id]
  })

  activated.forEach(({ entry, wasSticky }) => {
    if (wasSticky) {
      const remain = (prevState.sticky[entry.id] || 0) - 1
      if (remain > 0) {
        sticky[entry.id] = remain
      } else if (entry.cooldown) {
        cooldown[entry.id] = entry.cooldown
      }
    } else if (entry.sticky) {
      sticky[entry.id] = entry.sticky
    } else if (entry.cooldown) {
      cooldown[entry.id] = entry.cooldown
    }
  })

  return { sticky, cooldown, round: prevState.round + 1 }
}

// ─────────────────────────────────────────────────────────────────────────────
// 核心扫描函数
// ─────────────────────────────────────────────────────────────────────────────

export function scan(input: WorldInfoScanInput): WorldInfoScanResult {
  const entries = input.entries || []
  const chatHistory = input.chatHistory || []
  const userMessage = input.userMessage || ''
  const sessionState = input.sessionState || createEmptySessionState()
  const recursive = input.recursive !== false
  const maxSteps = input.maxRecursionSteps ?? 5
  const defaultScanDepth = input.defaultScanDepth ?? 0
  const globalScanData = input.globalScanData

  const maxContext = input.budget?.maxContext ?? 4000
  const percent = input.budget?.percent ?? 25
  const cap = input.budget?.cap ?? 0
  let maxAllowed = Math.round((percent / 100) * maxContext)
  if (cap > 0) maxAllowed = Math.min(maxAllowed, cap)

  console.log(`[WI] ====== SCAN START ======`)
  console.log(`[WI] 输入: entries=${entries.length}条, history=${chatHistory.length}条, userMsg="${userMessage.slice(0, 50)}"`)
  console.log(`[WI] 预算: maxContext=${maxContext}, percent=${percent}%, cap=${cap}`)
  console.log(`[WI] STATE BEFORE: sticky=[${Object.keys(sessionState.sticky).join(',')}], cooldown=[${Object.keys(sessionState.cooldown).join(',')}]`)

  if (entries.length === 0) {
    console.log(`[WI] 无条目，跳过扫描`)
    console.log(`[WI] ====== SCAN END: 共激活 0 条 ======`)
    return {
      buckets: { before: [], after: [], atDepth: [], anTop: [], anBottom: [], emTop: [], emBottom: [], outlet: [] },
      activatedIds: [],
      newSessionState: { ...sessionState, round: sessionState.round + 1 }
    }
  }

  const buckets: WorldInfoBucket = { before: [], after: [], atDepth: [], anTop: [], anBottom: [], emTop: [], emBottom: [], outlet: [] }
  const activatedIds: string[] = []
  const activatedForState: Candidate[] = []
  const injectedIds = new Set<string>()

  let currentUsed = 0
  let recurseBuffer = ''
  let step = 0

  while (step <= maxSteps) {
    const candidates: Candidate[] = []

    for (const entry of entries) {
      if (injectedIds.has(entry.id)) continue
      if (entry.enabled === false) continue
      if (step > 0 && entry.excludeRecursion) continue

      const stickyRemain = sessionState.sticky[entry.id] || 0
      const cooldownRemain = sessionState.cooldown[entry.id] || 0
      const isSticky = stickyRemain > 0

      if (!isSticky && cooldownRemain > 0) continue
      if (!isSticky && entry.delay && sessionState.round < entry.delay) continue
      if (!isSticky && entry.delayUntilRecursion) {
        const requiredStep = entry.delayUntilRecursion === true ? 1 : Number(entry.delayUntilRecursion)
        if (step < requiredStep) continue
      }

      const scanDepth = (typeof entry.scanDepth === 'number' && entry.scanDepth > 0) ? entry.scanDepth : defaultScanDepth
      const scanText = buildScanTextForEntry(userMessage, chatHistory, scanDepth, recurseBuffer, entry, globalScanData)

      const result = isEntryActivated(entry, scanText, {
        isSticky,
        caseSensitive: input.caseSensitive,
        matchWholeWords: input.matchWholeWords
      })

      if (!result.activated) continue

      console.log(`[WI] MATCH: id="${entry.id}", key="${(result.matchedKey || '').slice(0, 20)}", text="${scanText.slice(0, 20)}", mode=${result.matchedMode}, caseSensitive=${!!(entry.caseSensitive ?? input.caseSensitive)}, result=true`)

      if (!isSticky && entry.useProbability && typeof entry.probability === 'number' && entry.probability < 100) {
        const roll = Math.random() * 100
        const pass = roll <= entry.probability
        console.log(`[WI] PROB: id="${entry.id}", prob=${entry.probability}%, roll=${roll.toFixed(1)}, ${pass ? '✅激活' : '⏭️跳过'}`)
        if (!pass) continue
      }

      candidates.push({ entry, wasSticky: isSticky })
    }

    // 互斥分组：同组只留一个胜者
    const grouped: Record<string, Candidate[]> = {}
    const ungrouped: Candidate[] = []
    candidates.forEach(c => {
      const g = c.entry.group
      if (g) {
        if (!grouped[g]) grouped[g] = []
        grouped[g].push(c)
      } else {
        ungrouped.push(c)
      }
    })

    const winners: Candidate[] = [...ungrouped]
    Object.keys(grouped).forEach(groupName => {
      const groupCandidates = grouped[groupName]
      const candidateIds = groupCandidates.map(c => c.entry.id)
      let winner = groupCandidates[0]
      const overrideCandidates = groupCandidates.filter(c => c.entry.groupOverride)
      if (overrideCandidates.length > 0) {
        winner = overrideCandidates[0]
      } else if (groupCandidates.length > 1) {
        const totalWeight = groupCandidates.reduce((sum, c) => sum + (c.entry.groupWeight || 100), 0)
        let roll = Math.random() * totalWeight
        for (const c of groupCandidates) {
          roll -= (c.entry.groupWeight || 100)
          if (roll <= 0) { winner = c; break }
        }
      }
      console.log(`[WI] GROUP: group="${groupName}", candidates=[${candidateIds.join(',')}], 胜者="${winner.entry.id}" (weight=${winner.entry.groupWeight || 100}, override=${!!winner.entry.groupOverride})`)
      winners.push(winner)
    })

    const newlyActivatedIds: string[] = []
    for (const cand of winners) {
      const { entry, wasSticky } = cand
      const needTokens = countTokens(entry.content)
      const willFit = !!entry.ignoreBudget || (currentUsed + needTokens <= maxAllowed)
      console.log(`[WI] BUDGET: 当前已用=${currentUsed} tokens, 条目="${entry.id}" 需要=${needTokens}, 结果=${willFit ? '✅注入' : '⏭️溢出跳过'}`)
      if (!willFit) continue

      currentUsed += needTokens
      injectedIds.add(entry.id)
      activatedIds.push(entry.id)
      newlyActivatedIds.push(entry.id)
      activatedForState.push(cand)

      dispatchToBucket(buckets, entry)

      if (!entry.preventRecursion) {
        recurseBuffer += '\n' + entry.content
      }
    }

    console.log(`[WI] RECURSION step=${step}/${maxSteps}, 新命中条目=[${newlyActivatedIds.join(',')}]`)

    if (!recursive || newlyActivatedIds.length === 0) break
    step++
    if (step > maxSteps) {
      console.log(`[WI] WARN: 递归步数已达上限，强制终止`)
      break
    }
  }

  const newSessionState = advanceSessionState(sessionState, activatedForState)
  console.log(`[WI] STATE AFTER: sticky=[${Object.keys(newSessionState.sticky).join(',')}], cooldown=[${Object.keys(newSessionState.cooldown).join(',')}]`)
  console.log(`[WI] ====== SCAN END: 共激活 ${activatedIds.length} 条 ======`)

  return { buckets, activatedIds, newSessionState }
}