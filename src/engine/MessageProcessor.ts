// src/engine/MessageProcessor.ts
// 封装消息发送的完整流程：构建 Prompt → 输入侧正则 → 调用 LLM → 输出侧正则 → BlockParser 生成 segments
// 与 UI 完全解耦，供 pages/chat/chat.vue 等页面调用
//
// 注：当前 utils/llm/client.js 未提供真正的 token 级流式接口（生成完成后一次性返回全文），
// 现有 game.vue 使用"打字机模拟"（simulateStreamOutput）营造流式效果。
// MessageProcessor 保持同样的策略：generateWithMessages 拿到全文后，通过 onChunk 回调模拟逐字输出。

import type { Preset } from '../types/preset'
import type { CharacterV2, LorebookEntry } from '../types/character'
import type { ChatMessage } from '../types/message'
import type { AuthorsNoteConfig } from '../types/note'
import { buildMessages, type BuildContext } from './PromptBuilder'
import type { WorldInfoSessionState } from './WorldInfoEngine'
import { applyRegexScripts } from './RegexScriptEngine'
import { parseBlocks } from './BlockParser'
import { DEBUG_ENABLED, debugGroup, debugTable, truncate } from './DebugLogger'
import { countTokens } from './tokenizer'
import LLMClient from '../utils/llm/client.js'
// @ts-ignore
import userManager from '../utils/account/userManager.js'

export interface SendOptions {
  character: CharacterV2 | null
  preset: Preset
  chatHistory: { role: 'user' | 'assistant'; content: string }[]
  userMessage: string
  variables?: Record<string, string>
  /** 角色卡内嵌的世界书条目，用于 Lorebook 匹配注入 */
  lorebookEntries?: LorebookEntry[]
  /** 世界书限时效果（sticky/cooldown）状态，需要随会话持久化并在下一轮传回 */
  worldInfoSessionState?: WorldInfoSessionState
  /** 当前 Persona 描述（personaDescription marker） */
  personaDescription?: string
  /** 当前 TRPG 会话状态（trpgStatus marker + {{hp}}/{{scene}} 等宏来源） */
  trpgState?: Record<string, any>
  /** 作者注（Author's Note）配置 */
  authorsNote?: AuthorsNoteConfig
  /** 意图识别（intentDetection 开启时由调用方注入，仅在此钩子运行） */
  detectIntent?: (input: string) => any
  /** 意图识别结果回调（供调用方触发战斗等） */
  onIntent?: (intent: any) => void
  /** Continue续写：将此前缀追加到原AI消息后继续生成（对齐酒馆 type='continue'） */
  continuePrefix?: string
  /** 每次模拟输出新增字符时回调，用于 UI 实时更新 */
  onChunk?: (partialText: string) => void
  /** 全部完成时回调，传入最终文本、解析后的 segments、以及扫描后需要持久化的世界书状态 */
  onComplete?: (finalText: string, segments: ReturnType<typeof parseBlocks>, worldInfoState: WorldInfoSessionState) => void
  /** 出错时回调 */
  onError?: (error: Error) => void
}

export class MessageProcessor {
  private aborted = false
  private timeoutId: ReturnType<typeof setTimeout> | null = null
  private client: LLMClient | null = null

  /**
   * 发送消息并处理完整流程
   */
  async send(options: SendOptions): Promise<void> {
    this.aborted = false
    const { character, preset, chatHistory, userMessage, variables, onChunk, onComplete, onError, continuePrefix } = options

    try {
      // 1. 输入侧正则脚本（placement=1；vars 供 substituteRegex 宏替换使用）
      const processedInput = applyRegexScripts(userMessage, preset.regexScripts, 1, { vars: variables })

      // 1.5 意图识别钩子（intentDetection 开启时由调用方注入 detectIntent；世界书扫描之前）
      if (options.detectIntent) {
        const intent = options.detectIntent(processedInput)
        if (intent && options.onIntent) options.onIntent(intent)
      }

      // 2. 构建 Prompt（内部完成 marker 填充 / 世界书扫描 / TRPG 状态注入）
      const buildCtx: BuildContext = {
        character,
        preset,
        chatHistory,
        userMessage: processedInput,
        variables,
        lorebookEntries: options.lorebookEntries,
        worldInfoSessionState: options.worldInfoSessionState,
        personaDescription: options.personaDescription,
        trpgState: options.trpgState,
        authorsNote: options.authorsNote
      }
      const { messages, worldInfoState } = buildMessages(buildCtx)

      // ═══════════════════════════════════════════════════════════
      // 埋点 6：完整叙事请求 —— 调用 LLM 之前，打印完整 messages 数组
      // ═══════════════════════════════════════════════════════════
      if (DEBUG_ENABLED) {
        debugGroup('📨 [完整叙事请求] 发送给 LLM 前的 messages 完整状态', () => {
          console.log('messages 总条数:', messages.length)
          const roleCount: Record<string, number> = {}
          messages.forEach(m => { roleCount[m.role] = (roleCount[m.role] || 0) + 1 })
          console.log('按 role 分组统计:', JSON.stringify(roleCount))
          debugTable('messages 概览(role+内容预览):', messages.map((m, i) => ({
            index: i,
            role: m.role,
            contentPreview: truncate(m.content, 100),
            contentLength: m.content.length
          })))
          console.log('── 每条消息完整内容 ──')
          messages.forEach((m, i) => {
            debugGroup('消息 [' + i + '] role=' + m.role, () => {
              console.log('完整内容:', truncate(m.content, 500))
              console.log('总长度:', m.content.length, '字符')
            })
          })
          console.log('生成参数(generationParams):', JSON.stringify(preset.generationParams, null, 2))
        })
      }

      // 3. 调用 LLM（stream 开启走 SSE 真流式，H5 端实时回调；否则一次性返回全文）
      this.client = new LLMClient(undefined)
      const streamEnabled = !!preset.generationParams?.stream
      let rawReply: string
      if (streamEnabled) {
        rawReply = await this.client.generateWithMessagesStream(
          messages,
          preset.generationParams,
          onChunk ? (partial: string) => { if (!this.aborted) onChunk(partial) } : undefined
        )
      } else {
        rawReply = await this.client.generateWithMessages(messages, preset.generationParams)
      }
      if (this.aborted) return

      // 4. 输出侧正则脚本（placement=0；vars 供 substituteRegex 宏替换使用）
      const processedReply = applyRegexScripts(rawReply, preset.regexScripts, 0, { vars: variables })

      // Continue模式：将原AI消息作为前缀拼接在新生成内容前面
      const finalReply = continuePrefix ? (continuePrefix + processedReply) : processedReply

      // ═══════════════════════════════════════════════════════════
      // Token 用量统计（估算值）：把本次请求的输入（messages）+ 输出（最终回复）
      // 的估算 token 数累加到当前登录用户头上，供测试监控页展示。
      // 估算口径见 engine/tokenizer.ts：H5 端优先用真实 tiktoken(cl100k_base)，
      // 未就绪或非 H5 端用启发式估算（中日韩≈1token/字、英文≈1.3token/词）。
      // 计的是"单次往返全量上下文"，不含多轮回复的历史重放，属于合理近似。
      // ═══════════════════════════════════════════════════════════
      try {
        let promptChars = 0
        for (const m of messages) {
          if (m && m.content) promptChars += m.content.length
        }
        const promptTokens = countTokens(messages.map(m => m.content || '').join('\n'))
        const completionTokens = countTokens(finalReply)
        if (promptTokens > 0 || completionTokens > 0) {
          userManager.recordTokenUsage(promptTokens, completionTokens)
          if (DEBUG_ENABLED) {
            debugGroup('[TokenUsage] 本次估算用量', () => {
              console.log('输入字符数(近似):', promptChars)
              console.log('prompt 估算 tokens:', promptTokens)
              console.log('completion 估算 tokens:', completionTokens)
            })
          }
        }
      } catch (e) {
        console.warn('[TokenUsage] 统计失败（不影响对话）:', e)
      }

      if (streamEnabled) {
        // 流式路径已在上面实时回调 onChunk，无需再打字机模拟
        const segments = parseBlocks(finalReply)
        if (onComplete) onComplete(finalReply, segments, worldInfoState)
      } else {
        // 5. 打字机模拟输出
        await this._simulateStream(finalReply, onChunk)
        if (this.aborted) return

        // 6. 生成渲染节点
        const segments = parseBlocks(finalReply)
        if (onComplete) onComplete(finalReply, segments, worldInfoState)
      }
    } catch (e) {
      if (!this.aborted && onError) onError(e as Error)
    }
  }

  /**
   * 中断当前发送流程（停止 SSE 请求 + 模拟流式定时器）
   */
  abort(): void {
    this.aborted = true
    if (this.client) {
      try { this.client.abortStream() } catch (e) { /* ignore */ }
    }
    if (this.timeoutId) {
      clearTimeout(this.timeoutId)
      this.timeoutId = null
    }
  }

  private _simulateStream(fullText: string, onChunk?: (partial: string) => void): Promise<void> {
    return new Promise(resolve => {
      if (!onChunk) { resolve(); return }
      let charIndex = 0
      let current = ''
      const self = this
      const typeNext = () => {
        if (self.aborted || charIndex >= fullText.length) {
          resolve()
          return
        }
        const char = fullText.charAt(charIndex)
        current += char
        charIndex++
        onChunk(current)

        let delay = 60
        if (/[。.！!？?]/.test(char)) delay = 200
        else if (char === '\n') delay = 300
        else if (/[，,；;]/.test(char)) delay = 120
        else if (char === ' ') delay = 30
        delay += Math.random() * 40 - 20
        delay = Math.max(40, Math.min(delay, 250))

        self.timeoutId = setTimeout(typeNext, delay)
      }
      typeNext()
    })
  }
}

/** 将内部 ChatMessage[] 转换为 PromptBuilder 需要的历史格式（过滤掉 system 消息） */
export function toChatHistory(messages: ChatMessage[]): { role: 'user' | 'assistant'; content: string }[] {
  return messages
    .filter(m => (m.role === 'user' || m.role === 'assistant') && m.content && m.content.trim())
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
}