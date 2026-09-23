// src/engine/MessageProcessor.ts
// 封装消息发送的完整流程：构建 Prompt → 输入侧正则 → 调用 LLM → 输出侧正则 → BlockParser 生成 segments
// 与 UI 完全解耦，供 pages/chat/chat.vue 等页面调用
//
// 注：未开启流式、或运行端上游不支持流式（如小程序端一次性返回全文）时，
// MessageProcessor 采用"打字机模拟"：拿到全文后通过 onChunk 回调模拟逐字输出（见 _simulateStream）。

import type { Preset } from '../types/preset'
import type { CharacterV2, LorebookEntry } from '../types/character'
import type { ChatMessage } from '../types/message'
import type { AuthorsNoteConfig } from '../types/note'
import { buildMessages, type BuildContext, type PromptInfo } from './PromptBuilder'
import type { WorldInfoSessionState } from './WorldInfoEngine'
import { applyRegexScripts } from './RegexScriptEngine'
import { parseBlocks } from './BlockParser'
import { DEBUG_ENABLED, debugGroup, debugTable, truncate } from './DebugLogger'
import { estimateTokenCount } from './tokenizer'
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
  /**
   * 上下文构成快照回调（P3.3：分项面板 / 超预算提示的数据源）
   * 在**调用 LLM 之前**触发，因此生成失败也能看到本次实际发送的内容。
   */
  onPromptInfo?: (info: PromptInfo) => void
  /**
   * 思考内容回调（D17 / P6.1）：与正文 onChunk 严格分离。
   * 流式期间逐段回调累积思考文本；非流式路径在拿到响应后补发一次。
   */
  onReasoning?: (reasoningText: string) => void
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
      //    注意顺序对齐酒馆 `sendMessageAsUser`（script.js:5816-5823）：
      //    先 getRegexedString，**再** substituteParams。这里只做正则，
      //    宏替换由 PromptBuilder 在拼 prompt 时执行（存档里仍是用户原文）。
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
        authorsNote: options.authorsNote,
        // 上面第 1 步已经跑过 placement=1 的输入侧正则：告诉 PromptBuilder 不要再跑一次，
        // 否则 promptOnly 的输入侧脚本（如 `<user_input>` 包裹）会被套两层。
        userMessagePreProcessed: true
      }
      const { messages, worldInfoState, promptInfo } = buildMessages(buildCtx)

      // 上下文构成快照（P3.3）：先交给调用方（分项面板/超预算提示），
      // 放在 LLM 调用之前，这样即便本次生成失败也能看到"刚才发了什么"。
      if (options.onPromptInfo) {
        try {
          options.onPromptInfo(promptInfo)
        } catch (e) {
          console.warn('[MessageProcessor] onPromptInfo 回调失败:', e)
        }
      }
      if (promptInfo.overflowMandatory) {
        console.warn(
          `[MessageProcessor] ⚠️ 强制项已超出上下文预算：预算=${promptInfo.budget}，` +
          `系统提示+本次用户消息已占 ${promptInfo.used}。请调大预设的"上下文长度"或减小"最大回复长度"。`
        )
      }

      // 续写（D16）：把被续写的 AI 文本作为**最后一条 assistant 消息**送进去（prefill 方式），
      // 而不是依赖一条空的 user 消息 —— 部分服务端会直接拒绝空消息，即使接受，模型也从
      // "一句空话"里无从判断该接着什么写。PromptBuilder 已改为不再推入空 user 消息。
      if (continuePrefix) {
        messages.push({ role: 'assistant' as const, content: continuePrefix })
      }

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
      const { onReasoning } = options
      let rawReply: string
      if (streamEnabled) {
        rawReply = await this.client.generateWithMessagesStream(
          messages,
          preset.generationParams,
          onChunk ? (partial: string) => { if (!this.aborted) onChunk(partial) } : undefined,
          // 思考走**独立通道**（P6.1 / D17）：绝不混进 onChunk 的正文流
          onReasoning ? (text: string) => { if (!this.aborted) onReasoning(text) } : undefined
        )
      } else {
        rawReply = await this.client.generateWithMessages(messages, preset.generationParams)
        // 非流式（含小程序端）：思考在响应里一次性给出，这里补发一次独立回调
        if (onReasoning && !this.aborted) {
          const clientAny: any = this.client
          const r = clientAny && typeof clientAny.getLastReasoning === 'function' ? clientAny.getLastReasoning() : ''
          if (r) onReasoning(r)
        }
      }

      // D19 / P2.8：**是否走打字机**取决于"这次是否真的拿到了增量流式"，而不是预设开关。
      // 小程序端上游不支持流式（一次返回全文），若按开关判定就会跳过打字机 → 整段一次性蹦出。
      const clientRef: any = this.client
      const realStream = typeof clientRef.wasRealStream === 'function' ? !!clientRef.wasRealStream() : streamEnabled

      if (this.aborted) return

      // 4. 输出侧正则脚本（placement=0；vars 供 substituteRegex 宏替换使用）
      const processedReply = applyRegexScripts(rawReply, preset.regexScripts, 0, { vars: variables })

      // Continue模式：将原AI消息作为前缀拼接在新生成内容前面
      const finalReply = continuePrefix ? (continuePrefix + processedReply) : processedReply

      // ═══════════════════════════════════════════════════════════
      // Token 用量统计（D13）
      // 优先用上游返回的**真实 usage**（由请求里的 stream_options.include_usage 带出）；
      // 拿不到时退回本地启发式估算。**不再用 tiktoken 重算整段 prompt** —— 那会在
      // "生成刚结束"这个最敏感的时刻同步阻塞主线程，也是末帧手感发滞的原因。
      // 注意：上游 usage 只在响应结束时返回，因此它只能用于统计，
      //       不能用于"发送前裁剪历史"（那必须用本地估算，见 P3）。
      // ═══════════════════════════════════════════════════════════
      try {
        const clientAny: any = this.client
        const usage = clientAny && typeof clientAny.getLastUsage === 'function' ? clientAny.getLastUsage() : null
        let promptTokens = 0
        let completionTokens = 0
        let fromUpstream = false
        if (usage && (usage.prompt_tokens || usage.completion_tokens)) {
          promptTokens = Number(usage.prompt_tokens) || 0
          completionTokens = Number(usage.completion_tokens) || 0
          fromUpstream = true
        } else {
          promptTokens = estimateTokenCount(messages.map(m => m.content || '').join('\n'))
          completionTokens = estimateTokenCount(finalReply)
        }
        if (promptTokens > 0 || completionTokens > 0) {
          userManager.recordTokenUsage(promptTokens, completionTokens)
          if (DEBUG_ENABLED) {
            debugGroup('[TokenUsage] 本次用量', () => {
              console.log('来源:', fromUpstream ? '上游 usage（真实值）' : '本地启发式估算')
              console.log('prompt tokens:', promptTokens)
              console.log('completion tokens:', completionTokens)
            })
          }
        }
      } catch (e) {
        console.warn('[TokenUsage] 统计失败（不影响对话）:', e)
      }

      if (realStream) {
        // 真流式：内容已在 onChunk 里实时输出，无需再打字机模拟
        const segments = parseBlocks(finalReply)
        if (onComplete) onComplete(finalReply, segments, worldInfoState)
      } else {
        // 5. 打字机模拟输出
        //    适用范围（D19）：① 用户关掉了流式；② 小程序端（上游不支持流式）。
        //
        // 传的是 **processedReply（本次新生成的部分）**，不是 finalReply：
        // onChunk 的语义已统一为"本次新生成内容的累积文本"（不含 continuePrefix），
        // 否则续写时调用方会把自己已有的前缀再接一遍 → 文字滚雪球式重复膨胀。
        await this._simulateStream(processedReply, onChunk)
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

  /**
   * 打字机模拟输出（P2.2 / B3；适用范围见 D19：流式关闭时 + 小程序端）
   *
   * 改造前是"每字一个 setTimeout、间隔 60~300ms"，实际只有约 10~12 字/秒，
   * 一条 300 字的回复要二十多秒才显示完，且延迟随长度线性增长。
   *
   * 现在改为**按帧批量推进**（约 30fps，每帧按目标速率吐若干字）；
   * 标点仍保留短暂停顿，但以"多等几帧"折算，不再叠加长延时。
   */
  private _simulateStream(fullText: string, onChunk?: (partial: string) => void): Promise<void> {
    return new Promise(resolve => {
      if (!onChunk) { resolve(); return }
      const FRAME_MS = 33              // ≈30fps，与流式侧的节流一致
      const CHARS_PER_SEC = 60         // 目标速率（标点停顿后实测约 45~55 字/秒）
      const perFrame = Math.max(1, Math.round((CHARS_PER_SEC * FRAME_MS) / 1000))
      let emitted = 0
      const self = this

      const step = () => {
        if (self.aborted || emitted >= fullText.length) {
          resolve()
          return
        }
        emitted = Math.min(fullText.length, emitted + perFrame)
        onChunk(fullText.slice(0, emitted))

        const last = fullText.charAt(emitted - 1)
        let extraFrames = 0
        if (/[。.！!？?]/.test(last)) extraFrames = 3
        else if (last === '\n') extraFrames = 3
        else if (/[，,；;]/.test(last)) extraFrames = 1

        self.timeoutId = setTimeout(step, FRAME_MS * (1 + extraFrames))
      }
      step()
    })
  }
}

/**
 * 将内部 ChatMessage[] 转换为 PromptBuilder 需要的历史格式（过滤掉 system 消息）。
 *
 * `reasoning` 一并带出：PromptBuilder 会按酒馆 `PromptReasoning` 的语义，
 * 只把**最近一轮**有思考的 assistant 消息的思考拼回 prompt（见 `_injectPromptReasoning`）。
 * 这里只是搬运数据，不参与存档写入。
 */
export function toChatHistory(messages: ChatMessage[]): { role: 'user' | 'assistant'; content: string; reasoning?: string }[] {
  return messages
    .filter(m => (m.role === 'user' || m.role === 'assistant') && m.content && m.content.trim())
    .map(m => {
      const item: { role: 'user' | 'assistant'; content: string; reasoning?: string } = {
        role: m.role as 'user' | 'assistant',
        content: m.content
      }
      // 上游原生思考优先；没有时用正文定界符切出来的那份（开关打开时才有）
      const reasoning = (m.reasoning && m.reasoning.trim()) ? m.reasoning : m.reasoningFromText
      if (reasoning && reasoning.trim()) item.reasoning = reasoning
      return item
    })
}