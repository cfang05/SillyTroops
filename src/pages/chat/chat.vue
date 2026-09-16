<template>
  <view class="chat-container" :class="{ 'is-streaming': runtimeStore.isLoading }">
    <!-- 自定义导航栏：暗色毛玻璃，返回键+居中标题+设置按钮，三段等宽对齐 -->
    <view class="custom-navbar" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="navbar-row">
        <view class="navbar-back" @tap="goBack">
          <svg viewBox="0 0 20 20" fill="none"><path d="M12.5 4.5L7 10l5.5 5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </view>
        <text class="navbar-title">{{ characterName || '对话' }}</text>
        <view class="navbar-settings-btn" @tap="goSettings">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="3.4"/><path d="M10 2.3v1.7M10 16v1.7M2.3 10h1.7M16 10h1.7M4.6 4.6l1.2 1.2M14.2 14.2l1.2 1.2M15.4 4.6l-1.2 1.2M5.8 14.2l-1.2 1.2"/></svg>
        </view>
      </view>
    </view>

    <!-- 消息流：不再用嵌套的 scroll-view（那是"第二条滚动条"的来源），改成普通 view 让整个页面
         用系统自带的滚动（也就是要保留的那一条）。不做任何程序化滚动/钉底：视口任何时候都可以
         自由上下滑动，LLM 输出期间也不会被脚本拉走或锁定。 -->
    <view class="messages-container" :style="{ paddingTop: navbarHeight + 'px' }">
      <view class="messages-wrapper">
        <!-- 渲染窗口（P2.6 / C2）：历史很长时只渲染最近 N 条，避免首屏与滚动被拖垮。
             数据仍是全量在内存/存档里，这里只是"少渲染"；点顶部按钮逐批往前加载。 -->
        <view class="show-more-row" v-if="hiddenMessageCount > 0" @tap="loadMoreMessages">
          <text class="show-more-text">显示更早的 {{ Math.min(MESSAGE_PAGE_SIZE, hiddenMessageCount) }} 条（共 {{ hiddenMessageCount }} 条未显示）</text>
        </view>

        <MessageItem
          v-for="(item, index) in visibleMessages"
          :key="visibleStartIndex + index"
          :message="item"
          :index="visibleStartIndex + index"
          :character-avatar="characterAvatar"
          :persona-avatar="personaAvatar"
          :persona-first-name="personaFirstName"
          @longpress="onMessageLongPress"
          @branch-select="onBranchSelect"
          @swipe-prev="onSwipePrev"
          @swipe-next="onSwipeNext"
        />

        <view class="loading-indicator" v-if="runtimeStore.isLoading">
          <view class="loading-dots">
            <view class="dot"></view><view class="dot"></view><view class="dot"></view>
          </view>
        </view>
        <view id="chat-bottom-anchor" class="chat-bottom"></view>
      </view>
    </view>

    <!-- 功能模块（受 moduleStore 开关控制） -->
    <CharacterStatus
      v-if="activeModules.characterStatus"
      :visible="showStatus"
      :char-status="charStatus"
      @close="showStatus = false"
    />
    <InventoryPanel
      v-if="activeModules.inventory"
      :visible="showInventory"
      :legendary-items="legendaryItems"
      :inventory-items="inventoryItems"
      @close="showInventory = false"
    />
    <DiceRoller
      v-if="activeModules.dicePanel"
      :fate-roll-visible="fateRollVisible"
      :dice-anim-visible="diceAnimVisible"
      :dice-result="diceResult"
      @fate-dice="onFateDice"
    />

    <!-- 输入栏 -->
    <view class="input-container">
      <view class="side-btns">
        <view v-if="activeModules.inventory" class="side-btn" @tap="showInventory = true">
          <text class="side-btn-text">背包</text>
        </view>
        <view v-if="activeModules.characterStatus" class="side-btn" @tap="showStatus = true">
          <text class="side-btn-text">状态</text>
        </view>
      </view>
      <view class="input-wrapper">
        <input
          class="chat-input"
          :value="inputValue"
          @input="onInput"
          placeholder="输入消息..."
          confirm-type="send"
          @confirm="handleSend"
          :disabled="runtimeStore.isLoading"
          maxlength="1000"
        />
        <view v-if="!runtimeStore.isLoading" :class="['send-button', canSend ? '' : 'send-button-disabled']" @tap="handleSend">
          <text class="send-text">发送</text>
        </view>
        <view v-else class="send-button stop-button" @tap="handleStop">
          <text class="send-text">停止</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted, onMounted, nextTick } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useRuntimeStore } from '../../stores/runtimeStore'
import { useCharacterCardStore } from '../../stores/characterCardStore'
import { usePresetStore } from '../../stores/presetStore'
import { useRegexPresetStore } from '../../stores/regexPresetStore'
import { usePersonaStore } from '../../stores/personaStore'
import { useModuleStore } from '../../stores/moduleStore'
import { usePluginStore } from '../../stores/pluginStore'
import { useNoteStore } from '../../stores/noteStore'
import { MessageProcessor, toChatHistory } from '../../engine/MessageProcessor'
import { substituteVariables } from '../../engine/VariableEngine'
import { parseBlocks } from '../../engine/BlockParser'
import { applyRegexScripts } from '../../engine/RegexScriptEngine'
import { SYSTEM_REGEX_PRESET_ID } from '../../engine/systemRegex'
import type { RenderNode } from '../../types/render'
import BlockRenderer from '../../components/render/BlockRenderer.vue'
import CharacterStatus from '../../components/modules/CharacterStatus.vue'
import InventoryPanel from '../../components/modules/InventoryPanel.vue'
import DiceRoller from '../../components/modules/DiceRoller.vue'
import { initTrpgState, trpgStateToCharStatus } from '../../utils/persona/trpgProfile.js'
import { DEFAULT_TRPG_MODULES } from '../../types/character'
import { createSystemPreset, SYSTEM_PRESET_ID } from '../../adapters/preset/defaultPreset'
import type { ChatMessage } from '../../types/message'
import type { Preset } from '../../types/preset'
import type { RegexScript } from '../../types/script'
// @ts-ignore
import conversationManager from '../../utils/account/conversationManager.js'
// @ts-ignore
import itemManager from '../../utils/items/item-manager.js'
// @ts-ignore
import intentParser from '../../utils/llm/intentParser.js'
import { notifyStorageFailure, notifyError } from '../../utils/notify'
import MessageItem from '../../components/render/MessageItem.vue'
import { balanceIncompleteMarkdown } from '../../engine/BlockParser'
import type { PromptInfo } from '../../engine/PromptBuilder'
import { savePromptInfo } from '../../services/promptInfoStore'
import { initCustomCss } from '../../utils/customCss'
import { splitReasoning, loadReasoningConfig, type ReasoningSplitConfig } from '../../engine/ReasoningHandler'

const runtimeStore = useRuntimeStore()
const characterCardStore = useCharacterCardStore()
const presetStore = usePresetStore()
const regexPresetStore = useRegexPresetStore()
const personaStore = usePersonaStore()
const moduleStore = useModuleStore()
const pluginStore = usePluginStore()
const noteStore = useNoteStore()

const inputValue = ref('')
const showInventory = ref(false)
const showStatus = ref(false)

// 自定义导航栏尺寸：不再用系统导航栏（navigationStyle:"custom"），
// 需要自己算状态栏高度 + 导航栏内容高度，一来给导航栏本身撑高度，二来给下面的消息区加 paddingTop 避免被盖住
const statusBarHeight = ref(0)
const navbarHeight = ref(0)
onMounted(() => {
  try {
    const info = uni.getSystemInfoSync()
    statusBarHeight.value = info.statusBarHeight || 0
    // 44px 是导航栏内容自身的标准高度（不含状态栏），H5/小程序通用近似值
    navbarHeight.value = statusBarHeight.value + 44
  } catch (e) { /* 忽略，取默认值 0 */ }

  // #ifdef H5
  // 存档改为防抖后（D12），直接关闭标签页可能落在防抖窗口内；
  // beforeunload 里同步写一次本地存储是来得及的（uni.setStorageSync 是同步的）
  try { window.addEventListener('beforeunload', _flushPersist) } catch (e) { /* ignore */ }
  // #endif
})

// ── 视口滚动：不再做任何程序化操作 ──────────────────
// 之前版本用"位置驱动跟随 + 手势锁"等机制试图在流式输出时自动把视口钉在底部，
// 但无论如何调整，只要 LLM 开始输出就会在某个时机把视口拉/锁到某个位置，
// 用户完全无法在生成过程中自由滚动。现在彻底移除这一整套自动滚动逻辑：
// 页面滚动完全交给系统原生行为，任何时候都可以自由上下滑动，代码不再调用
// uni.pageScrollTo，也不再监听 onPageScroll/手势事件来"纠正"视口位置。

const processor = new MessageProcessor()

// ── 消息渲染窗口（P2.6 / C2）─────────────────────────────────
// 历史很长时不再全量渲染：只渲染最近 MESSAGE_PAGE_SIZE 条，顶部按钮逐批往前加载。
// 对齐酒馆的 chat_truncation（默认 100，见 referencecode/public/scripts/power-user.js:133）。
const MESSAGE_PAGE_SIZE = 100
const visibleCount = ref(MESSAGE_PAGE_SIZE)

const visibleStartIndex = computed(() => Math.max(0, runtimeStore.messages.length - visibleCount.value))
const visibleMessages = computed(() => runtimeStore.messages.slice(visibleStartIndex.value))
const hiddenMessageCount = computed(() => visibleStartIndex.value)

/**
 * 往前多加载一批。
 *
 * 注意要把滚动位置补回来：内容是在**上方**插入的，浏览器保持 scrollTop 不变时
 * 用户看到的内容会整体下移（视觉上"跳一下"）。这里用"锚点消息相对视口的位置差"补偿。
 * 只在用户主动点击时执行一次，不涉及流式期间的自动跟随（那套逻辑是被刻意移除的）。
 */
function loadMoreMessages() {
  const anchorIndex = visibleStartIndex.value
  if (anchorIndex <= 0) return
  const query = uni.createSelectorQuery()
  query.select('#msg-' + anchorIndex).boundingClientRect()
  query.selectViewport().scrollOffset()
  query.exec((res: any[]) => {
    const before = res && res[0]
    const scroll = res && res[1]
    visibleCount.value += MESSAGE_PAGE_SIZE
    nextTick(() => {
      if (!before || !scroll) return
      const q2 = uni.createSelectorQuery()
      q2.select('#msg-' + anchorIndex).boundingClientRect()
      q2.exec((res2: any[]) => {
        const after = res2 && res2[0]
        if (!after) return
        const delta = after.top - before.top
        if (Math.abs(delta) > 1) {
          uni.pageScrollTo({ scrollTop: Math.max(0, (scroll.scrollTop || 0) + delta), duration: 0 })
        }
      })
    })
  })
}

// ── 流式更新的帧率节流（P2.1 / B1）────────────────────────────
// 改造前：**每个 chunk** 都替换整个 messages 数组 + 重跑 parseBlocks(全文)——
// 长回复是 O(n²) 的重复解析，而且父组件整张消息表都会重渲染。
// 现在：增量攒进缓冲区，约 30fps 写一次（对齐酒馆 Stopwatch(1000/streaming_fps) 的节流）。
const STREAM_FLUSH_MS = 33
/** 正文与思考可以分别到达，所以缓冲区里两个字段各自可选 */
let _pendingStream: { index: number; content?: string; reasoning?: string } | null = null
let _streamTimer: ReturnType<typeof setTimeout> | null = null

function _ensurePending(index: number) {
  if (!_pendingStream || _pendingStream.index !== index) _pendingStream = { index }
  _pendingStream.index = index
  if (!_streamTimer) _streamTimer = setTimeout(_flushStreamContent, STREAM_FLUSH_MS)
}

/** 排入正文增量（调用方负责算出"这条消息此刻应该显示成什么"） */
function _queueStreamContent(index: number, content: string) {
  _ensurePending(index)
  _pendingStream!.content = content
}

/** 排入思考增量（D17 / P6.1：与正文完全独立的通道） */
function _queueStreamReasoning(index: number, reasoning: string) {
  if (!_reasoningStart.has(index)) _reasoningStart.set(index, Date.now())
  _ensurePending(index)
  _pendingStream!.reasoning = reasoning
}

/**
 * 把"原始正文"落到消息上（P6.4）
 * 切分文本思考 → 显示态正则 → segments；流式与最终收尾共用，保证两条路径一致。
 */
function _applyMessageText(index: number, rawText: string, opts: { streaming?: boolean } = {}) {
  const m = runtimeStore.messages[index]
  if (!m || m.role !== 'assistant') return
  const split = splitReasoning(rawText, _reasoningCfg.value)
  m.content = split.content
  // 流式期间补齐未闭合的成对 Markdown（P2.3 / B6），并走显示态正则（P4.6 / C1）
  m.segments = _segmentsFor(split.content, index, { streaming: !!opts.streaming })
  // 文本思考只在"上游没有给原生思考"时才用来填充，避免覆盖更权威的 reasoning_content
  if (split.reasoning && !m.reasoning) m.reasoning = split.reasoning
  if (m.reasoning) m.reasoningDisplay = _reasoningFor(m.reasoning, index)
}

/** 真正写进 store：就地修改消息对象，父组件不会因为每个 chunk 而整体重渲染 */
function _flushStreamContent() {
  if (_streamTimer) { clearTimeout(_streamTimer); _streamTimer = null }
  const pending = _pendingStream
  _pendingStream = null
  if (!pending) return
  const m = runtimeStore.messages[pending.index]
  if (!m || m.role !== 'assistant') return

  if (typeof pending.content === 'string') {
    _applyMessageText(pending.index, pending.content, { streaming: true })
    if (Array.isArray(m.swipes)) m.swipes[m.swipe_id || 0] = m.content
  }
  if (typeof pending.reasoning === 'string') {
    // 上游原生思考（reasoning_content）优先
    m.reasoning = pending.reasoning
    m.reasoningDisplay = _reasoningFor(pending.reasoning, pending.index)
  }
  m.isStreaming = true
}

/**
 * 显示态管线（P4.1 / P4.6 / D5 三态分离）
 *
 * 渲染管线顺序：**原文 → markdownOnly 正则（显示态）→ BlockParser → 渲染节点**。
 *
 * 改造前的问题：输出侧正则只在"生成结束后"跑一次，而且**从不传 isMarkdown**，
 * 于是勾了「仅 Markdown」的脚本 100% 不生效，流式期间显示的也是未过正则的原文
 * （结束时整段跳变）。对齐酒馆后，显示态正则在**每一帧**都对累积文本跑一遍
 * （referencecode/public/script.js:1809-1813 + :3656），所以流式期间看到的就是最终样式。
 *
 * @param text 原始文本（消息 content）
 * @param index 该消息在完整数组中的下标（用于判断角色与 depth）
 * @param opts.streaming 是否流式中间帧：会先补齐未闭合的成对 Markdown
 */
const STREAM_REGEX_MAX_CHARS = 20000

function _segmentsFor(
  text: string,
  index: number,
  opts: { streaming?: boolean; role?: string; total?: number } = {}
): RenderNode[] {
  const raw = opts.streaming ? balanceIncompleteMarkdown(text || '') : (text || '')
  try {
    const preset = _resolvePreset()
    const scripts = ((preset?.regexScripts as RegexScript[]) || [])
    if (scripts.length) {
      const role = opts.role || runtimeStore.messages[index]?.role
      const placement = (role === 'user' ? 1 : 0) as any
      const total = typeof opts.total === 'number' ? opts.total : runtimeStore.messages.length
      // 流式期间对超长文本跳过正则：个别脚本可能有灾难性回溯，
      // 每 33ms 跑一次会把主线程卡死（P4.6 的限流措施之一）。
      if (!(opts.streaming && raw.length > STREAM_REGEX_MAX_CHARS)) {
        const display = applyRegexScripts(raw, scripts, placement, { isMarkdown: true, depth: Math.max(0, total - 1 - index) })
        return parseBlocks(display)
      }
    }
  } catch (e) {
    console.warn('[chat] 显示态正则执行失败，回退为原文渲染:', e)
  }
  return parseBlocks(raw)
}

/** 文本思考解析配置（P6.4）：onLoad 时从本地读取，设置页改完回来重新读 */
const _reasoningCfg = ref<ReasoningSplitConfig>({ enabled: false, prefix: ' thinking', suffix: '' })
/** 思考开始时间（按消息下标记录，用于"已思考 N 秒"；不持久化） */
const _reasoningStart = new Map<number, number>()

/**
 * 收尾一条 AI 消息（P6.2 / P6.4）
 * 统一处理：文本思考切分 → 显示态正则 → segments → swipes → 思考结束标记与耗时。
 * 流式结束、停止生成、续写收尾都走这里，避免三条路径行为不一致。
 */
function _finalizeMessage(index: number, finalText: string) {
  _applyMessageText(index, finalText)
  const m = runtimeStore.messages[index]
  if (!m) return
  const swipes = [...((m.swipes as string[]) || [''])]
  swipes[m.swipe_id || 0] = m.content
  const startedAt = _reasoningStart.get(index)
  const next = [...runtimeStore.messages]
  next[index] = {
    ...m,
    content: m.content,
    segments: m.segments,
    isStreaming: false,
    reasoning: m.reasoning,
    reasoningDisplay: m.reasoningDisplay,
    reasoningDone: !!m.reasoning,
    reasoningDurationMs: startedAt ? Date.now() - startedAt : undefined,
    swipes
  }
  runtimeStore.setMessages(next)
  _reasoningStart.delete(index)
}

/**
 * 思考内容的"显示态"（P6.5 / D17）
 * 与正文同理：把切出来的思考也交给 **placement=REASONING（内部编号 3）** 的正则处理，
 * 这样用户可以单独控制思考的显示（例如隐藏、替换标记）。
 */
function _reasoningFor(text: string, index: number): string {
  try {
    const preset = _resolvePreset()
    const scripts = ((preset?.regexScripts as RegexScript[]) || [])
    if (!scripts.length || !text) return text
    const depth = Math.max(0, runtimeStore.messages.length - 1 - index)
    return applyRegexScripts(text, scripts, 3 as any, { isMarkdown: true, depth })
  } catch (e) {
    console.warn('[chat] 思考内容正则执行失败，回退原文:', e)
    return text
  }
}

/** 丢弃未冲刷的缓冲区（结束/停止/出错时调用，避免过期增量覆盖最终文本） */
function _cancelStreamContent() {
  if (_streamTimer) { clearTimeout(_streamTimer); _streamTimer = null }
  _pendingStream = null
}

/**
 * 上下文构成快照的处理（P3.3 / P3.4）
 * · 存一份供「设置 → 上下文详情」查看（IndexedDB，最近 20 次）
 * · 强制项自己就超预算时给出明确提示（否则用户只会看到"模型失忆"）
 */
function _handlePromptInfo(info: PromptInfo) {
  const chatId = sessionCardId.value || activeCard.value?.id || 'unknown'
  savePromptInfo(chatId, info)
  if (info.overflowMandatory) {
    notifyError(
      '上下文超预算：历史已被省略',
      '请调大预设的「上下文长度」或减小「最大回复长度」',
      { dedupeKey: 'prompt-overflow', duration: 4500 }
    )
  }
}

// 本次会话绑定的资源 id（来自过渡页 new-conversation.vue 传入的路由参数）
const sessionCardId = ref('')
const sessionPresetId = ref('')
const sessionRegexPresetId = ref('')
const sessionPersonaId = ref('')

// 世界书限时效果（sticky/cooldown）状态，随会话持久化，P2 阶段新增
const worldInfoState = ref<{ sticky: Record<string, number>; cooldown: Record<string, number>; round: number }>({ sticky: {}, cooldown: {}, round: 0 })

// TRPG 会话状态（决策 6：随会话持久化），trpgStatus marker + {{hp}}/{{scene}} 等宏的数据源
const trpgState = ref<Record<string, any> | null>(null)

// legendaryItems 待接账号级传奇物品；inventoryItems 由 trpgState.items + itemManager 派生；charStatus 由 trpgState 派生
const legendaryItems = ref<any[]>([])
const inventoryItems = computed(() => {
  const items = trpgState.value?.items || []
  return items.map((it: any) => {
    const def = itemManager.getItemDef(it.id) || {}
    return { ...def, id: it.id, quantity: it.quantity || 1 }
  })
})
const charStatus = computed(() => trpgStateToCharStatus(trpgState.value || {}))

// 骰子面板状态（dicePanel 开关）
const fateRollVisible = ref(false)
const diceAnimVisible = ref(false)
const diceResult = ref<number | string | null>(null)

const activeCard = computed(() => {
  if (sessionCardId.value) return characterCardStore.getById(sessionCardId.value)
  return characterCardStore.activeCard
})
const characterName = computed(() => activeCard.value?.name || '')
const characterAvatar = computed(() => (activeCard.value as any)?.avatar || '')
// TRPG 模块开关：读当前角色卡的 extensions.trpg.modules（默认全关），替代旧的全局 moduleStore
const activeModules = computed(() => (activeCard.value?.extensions?.trpg?.modules) || DEFAULT_TRPG_MODULES)

// 需求 2：系统导航栏标题显示角色卡名称，而不是固定文案"对话"。
// pages.json 里的 navigationBarTitleText 只是静态默认值，运行时用 uni.setNavigationBarTitle 覆盖。

const activePersona = computed(() => {
  if (sessionPersonaId.value) return personaStore.personas.find(p => p.id === sessionPersonaId.value) || null
  return personaStore.activePersona
})
const personaAvatar = computed(() => activePersona.value?.avatar || '')
const personaFirstName = computed(() => (activePersona.value?.name || '').charAt(0))

const canSend = computed(() => !runtimeStore.isLoading && inputValue.value.trim().length > 0)

// onLoad 是 uni-app 官方组合式 API，跨 H5/小程序统一从页面路由参数中取值
onLoad((options: any) => {
  // 需要登录：未登录会被 reLaunch 到登录页（守卫实现在 App.vue 的 checkUserLogin）
  if (!getApp().checkUserLogin()) return
  characterCardStore.loadAll()
  presetStore.load()
  regexPresetStore.load()
  personaStore.load()
  moduleStore.load()
  pluginStore.load()
  noteStore.load()

  // 自定义 CSS（P4.3 / D2）：注入系统默认样式（台词 .say 等）与用户样式。
  // 必须在这里调用 —— 否则正则产出的 class 没有外观，台词会失去金色斜体。
  initCustomCss()

  // 文本思考解析配置（P6.4）：设置页可能刚改过，每次进聊天页重读
  _reasoningCfg.value = loadReasoningConfig()

  sessionCardId.value = options?.cardId || characterCardStore.activeCardId || ''
  sessionPresetId.value = options?.presetId || ''
  sessionRegexPresetId.value = options?.regexPresetId || ''
  sessionPersonaId.value = options?.personaId || ''

  if (sessionCardId.value) {
    characterCardStore.setActive(sessionCardId.value)
    const card = characterCardStore.getById(sessionCardId.value)
    if (card) itemManager.init((card as any).extensions?.trpg, card.name)
  }

  const mode = options?.mode || 'continue'
  if (mode === 'continue' && sessionCardId.value) {
    _loadConversation(sessionCardId.value)
  } else {
    _startFresh()
  }
})

/**
 * 读档时重建派生数据（P1.4 / A4 的配套）
 * 存档里不再保存 segments，只存 content；这里按 content 现算一次，
 * 保证富文本（台词/卡片/代码块）渲染不丢。
 *
 * 注意走的是 `_segmentsFor`（显示态管线），因此 P4.1 之后：
 * markdownOnly 正则同样会在读档时生效。role/total 由调用方显式传入 ——
 * 此刻消息还没进 store，读不到 runtimeStore.messages。
 */
function _rehydrateMessage(m: any, index: number, total: number): any {
  if (!m || typeof m !== 'object') return m
  if (m.role !== 'assistant') return m
  const out = { ...m }
  if (!Array.isArray(out.segments) || out.segments.length === 0) {
    out.segments = _segmentsFor(out.content || '', index, { role: out.role, total })
  }
  // 思考的"显示态"是派生数据，不入档；读档时按原文重算（P6.5）
  if (out.reasoning) out.reasoningDisplay = _reasoningFor(out.reasoning, index)
  return out
}

function _rehydrateMessages(msgs: any[]): any[] {
  if (!Array.isArray(msgs)) return []
  const total = msgs.length
  return msgs.map((m, i) => _rehydrateMessage(m, i, total))
}

async function _loadConversation(cardId: string) {
  // P5.2：存档已迁到 IndexedDB（异步）。必须先 await init()：
  // 它负责读取列表缓存并执行 v1→v2 老档迁移。
  await conversationManager.init()
  const record = await conversationManager.load(cardId)
  if (record && Array.isArray(record.messages) && record.messages.length > 0) {
    // 先恢复会话资源绑定，再重建消息：_segmentsFor 依赖 sessionPresetId/sessionRegexPresetId
    // 选出的正侧脚本（否则会用错预设的正则去渲染历史消息）。
    if (record.presetId) sessionPresetId.value = record.presetId
    if (record.regexPresetId) sessionRegexPresetId.value = record.regexPresetId
    if (record.personaId) sessionPersonaId.value = record.personaId
    runtimeStore.setMessages(_rehydrateMessages(record.messages))
    runtimeStore.localVariables = record.localVariables || {}
    if (record.worldInfoState) worldInfoState.value = record.worldInfoState
    if (record.trpgState) trpgState.value = record.trpgState
  } else {
    _startFresh()
  }
}

function _startFresh() {
  runtimeStore.resetSession()
  const card = activeCard.value
  // 初始化 TRPG 会话状态（仅当卡片开启了 stats 等模块时才有意义；initTrpgState 对纯聊天卡也返回安全默认值）
  trpgState.value = initTrpgState(card as any, activePersona.value?.trpgProfile || null)
  const rawFirstMes = card?.first_mes
  if (rawFirstMes) {
    // 宏替换（{{char}}/{{user}}/{{description}}/{{personality}}/{{scenario}} 等）+ 结构化块解析，
    // 与用户发送消息后 AI 回复的处理链路保持一致，否则开场白里的宏和状态栏标签不会被渲染
    const vars = _buildBaseVars()
    // 酒馆 Alt. Greetings：first_mes 是第 0 个 swipe，alternate_greetings 依次追加为可切换的其他开场白
    const rawGreetings = [rawFirstMes, ...((card as any)?.alternate_greetings || [])]
    const processedGreetings = rawGreetings.map(g => substituteVariables(g, vars))
    const processedFirstMes = processedGreetings[0]
    // 开场白同样走显示态管线（P4.1）：台词等 markdownOnly 样式在开场白上也应生效
    const segments = _segmentsFor(processedFirstMes, 0, { role: 'assistant', total: 1 })
    runtimeStore.appendMessage({
      role: 'assistant',
      content: processedFirstMes,
      segments,
      swipes: processedGreetings,
      swipe_id: 0
    })
  }
  _persistConversation()
}

function _buildBaseVars(): Record<string, string> {
  const card = activeCard.value
  const persona = activePersona.value
  return {
    char: card?.name || '',
    user: persona?.name || '玩家',
    description: card?.description || '',
    personality: card?.personality || '',
    scenario: card?.scenario || '',
    persona: persona?.description || ''
  }
}

/** 当前生效的预设：优先用会话选中的 presetId，否则用全局 activePreset，否则空预设 */
function _resolvePreset(): Preset {
  if (sessionPresetId.value) {
    const p = presetStore.get(sessionPresetId.value)
    if (p) return _mergeRegexScripts(p)
  }
  return _mergeRegexScripts(presetStore.activePreset || _emptyPreset())
}

/**
 * 三路正则脚本来源合并生效（对齐酒馆 getRegexScripts()，GLOBAL→SCOPED→PRESET 顺序合并，不互相覆盖）：
 *   - GLOBAL：regexPresetStore 里勾选了"全局正则"的正侧文件（跨角色/跨预设一直生效）
 *   - 会话正侧：本次对话在"新建对话"里额外选的正侧文件（本项目独有，酒馆没有这一层，
 *     语义上更接近"临时全局"，所以排在 GLOBAL 之后、SCOPED 之前）
 *   - SCOPED：角色卡自带的 regex_scripts，仅当该角色卡勾选了"允许使用自带正则"才生效
 *   - PRESET：预设自带的 regexScripts（原有逻辑，未选正侧文件时的默认来源）
 */
function _mergeRegexScripts(preset: Preset): Preset {
  const globalScripts = regexPresetStore.globalScripts as RegexScript[]

  let sessionScripts: RegexScript[] = []
  // D15：用户没有选择其他正侧文件时，**默认使用「系统正侧」**（代码内置的台词识别等）；
  // 一旦用户选了别的文件，就用那份文件**替换**系统正侧（不叠加）。
  const sessionRegexId = sessionRegexPresetId.value || SYSTEM_REGEX_PRESET_ID
  const regexPreset = regexPresetStore.get(sessionRegexId)
  if (regexPreset) sessionScripts = regexPreset.scripts as RegexScript[]

  const card = activeCard.value as any
  const scopedScripts: RegexScript[] = (card?.extensions?.allowScopedRegex && Array.isArray(card?.extensions?.regex_scripts))
    ? card.extensions.regex_scripts
    : []

  const presetScripts: RegexScript[] = preset.regexScripts || []

  const merged = [...globalScripts, ...sessionScripts, ...scopedScripts, ...presetScripts]
  if (merged.length === (preset.regexScripts || []).length && merged.every((s, i) => s === presetScripts[i])) {
    return preset // 没有额外来源时原样返回，避免不必要的对象拷贝
  }
  return { ...preset, regexScripts: merged }
}

const PERSIST_DEBOUNCE_MS = 500
let _persistTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 存档（D12）
 *
 * 两点与改造前不同：
 *  1. **防抖**：以前每次消息变更都同步序列化整份存档，流式/快速滑动时高频写盘；
 *     现在默认延迟 500ms 合并，离开页面时用 _flushPersist() 兜底立即写入。
 *  2. **失败可见**：save() 返回 false（最常见原因是本地存储配额超限）时必须提示用户，
 *     以前它被静默吞掉 —— 表现为"聊了半天，重进发现内容没保存"。
 */
function _persistConversation(opts: { immediate?: boolean } = {}) {
  const card = activeCard.value
  if (!card) return
  const doSave = () => {
    _persistTimer = null
    // P5.2：save 现在写 IndexedDB，是异步的（不再阻塞主线程）。
    // 失败（配额/权限/关库）必须让用户看见 —— D12。
    Promise.resolve(conversationManager.save({
      cardId: card.id,
      cardName: card.name,
      presetId: sessionPresetId.value,
      regexPresetId: sessionRegexPresetId.value,
      personaId: sessionPersonaId.value,
      messages: runtimeStore.messages,
      localVariables: runtimeStore.localVariables,
      worldInfoState: worldInfoState.value,
      trpgState: trpgState.value
    })).then((ok: any) => {
      if (ok === false) notifyStorageFailure('保存对话')
    }).catch((e: any) => {
      console.error('[chat.vue] 保存对话异常:', e)
      notifyStorageFailure('保存对话', e)
    })
  }
  if (_persistTimer) { clearTimeout(_persistTimer); _persistTimer = null }
  if (opts.immediate) doSave()
  else _persistTimer = setTimeout(doSave, PERSIST_DEBOUNCE_MS)
}

/** 立即落盘：离开页面 / 页面卸载 / 关键操作后调用，避免防抖窗口内丢写 */
function _flushPersist() {
  if (_persistTimer) { clearTimeout(_persistTimer); _persistTimer = null }
  _persistConversation({ immediate: true })
}

onUnmounted(() => {
  processor.abort()
  _cancelStreamContent()
  _flushPersist()
  // #ifdef H5
  try { window.removeEventListener('beforeunload', _flushPersist) } catch (e) { /* ignore */ }
  // #endif
})

function onInput(e: any) {
  inputValue.value = e.detail.value
}

/**
 * 对话页面设置键：不再打开模型/API 配置（那些统一放在首页"设置"里配置），
 * 而是直接打开预设编辑页，编辑对象是"本次对话选中的预设"本身——
 * 保证所有生成参数只有一个来源（当前会话预设），不会再有别的东西（旧的全局高级设置滑块等）
 * 悄悄影响到实际生成参数。
 */
function goSettings() {
  const id = _ensureSessionPresetId()
  uni.navigateTo({ url: '/pages/presets/edit?id=' + id + '&fromChat=1' })
}

/** 自定义导航栏的返回按钮：navigationStyle:"custom" 后系统不再提供返回箭头，需要自己实现 */
function goBack() {
  uni.navigateBack()
}

/**
 * 把「系统预设」另存为一份用户预设（D19）
 *
 * 系统预设是**代码内置、不落盘**的：直接编辑它等于"改了但下次启动就恢复原样"，
 * 用户会以为改动丢失。所以一旦要编辑（点设置键），先复制一份带新 id 的用户预设，
 * 之后所有编辑都落在这份副本上。
 */
function _forkSystemPreset(): string | null {
  const src = presetStore.get(SYSTEM_PRESET_ID)
  if (!src) return null
  const id = 'preset_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const copy: Preset = {
    ...src,
    id,
    name: (src.name || '系统预设') + ' 副本'
  }
  presetStore.save(copy)
  sessionPresetId.value = id
  _persistConversation({ immediate: true })
  return id
}

/** 确保 sessionPresetId 指向一个真实存在于 presetStore 里的预设，没有就创建一个并持久化 */
function _ensureSessionPresetId(): string {
  if (sessionPresetId.value && presetStore.get(sessionPresetId.value)) {
    // 系统预设不可直接编辑 → 先另存为副本（见 _forkSystemPreset）
    if (sessionPresetId.value === SYSTEM_PRESET_ID) {
      const forked = _forkSystemPreset()
      if (forked) return forked
    }
    return sessionPresetId.value
  }
  if (presetStore.activePreset) {
    sessionPresetId.value = presetStore.activePreset.id
    if (sessionPresetId.value === SYSTEM_PRESET_ID) {
      const forked = _forkSystemPreset()
      if (forked) return forked
    }
    _persistConversation()
    return sessionPresetId.value
  }
  const fresh = _emptyPreset()
  fresh.id = 'preset_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  fresh.name = (characterName.value || '当前对话') + ' 的预设'
  presetStore.save(fresh)
  sessionPresetId.value = fresh.id
  _persistConversation()
  return fresh.id
}

/**
 * 停止生成（P1.3 / A3）
 *
 * MessageProcessor 被 abort 后会在 `if (this.aborted) return` 处直接返回，
 * 于是 onComplete **永远不会触发** —— 正在流式的那条消息就会一直停留在
 * `isStreaming: true`：光标 ▋ 一直闪、swipe 切换箭头被 `!item.isStreaming` 挡住。
 * 所以这里要主动给这条消息"收尾"（对齐酒馆 stopGeneration 后仍走完 finalize）。
 */
function handleStop() {
  processor.abort()
  runtimeStore.setLoading(false)
  // 先把最后一帧增量写进去（停止时不该丢掉最后 ~33ms 的文字），再收尾
  _flushStreamContent()

  const msgs = runtimeStore.messages
  const idx = msgs.length - 1
  const last = msgs[idx]
  if (!last || last.role !== 'assistant' || !last.isStreaming) return

  // 统一收尾（P6.2 / P6.4）：即使中途停止，也要把已流出的思考标记为"已结束"并算耗时
  _finalizeMessage(idx, (last.content as string) || '')
  _persistConversation({ immediate: true })
}

/** Continue续写：将最后一条AI消息作为前缀继续生成（对齐酒馆 type='continue'） */
async function handleContinue() {
  const msgs = runtimeStore.messages
  if (!msgs.length || msgs[msgs.length - 1].role !== 'assistant') {
    return uni.showToast({ title: '最后一条不是AI消息', icon: 'none' })
  }
  if (runtimeStore.isLoading) {
    return uni.showToast({ title: '正在生成中...', icon: 'none' })
  }

  const lastAiMsg = msgs[msgs.length - 1]
  const aiMsg: ChatMessage = { role: 'assistant', content: lastAiMsg.content || '', isStreaming: true, segments: [], swipes: [''], swipe_id: 0 }
  const aiIndex = msgs.length - 1
  
  // 替换（而非新增）最后一条AI消息
  const newMsgs = [...msgs]
  newMsgs[aiIndex] = aiMsg
  runtimeStore.setMessages(newMsgs)

  runtimeStore.setLoading(true)

  const activePresetResolved = _resolvePreset()
  
  await processor.send({
    character: _characterForProcessor(),
    preset: activePresetResolved,
    chatHistory: toChatHistory(runtimeStore.messages.slice(0, aiIndex)),
    userMessage: '', // Continue不传新用户消息
    variables: _buildBaseVars(),
    personaDescription: activePersona.value?.description || '',
    lorebookEntries: _collectLorebookEntries(),
    worldInfoSessionState: worldInfoState.value,
    authorsNote: noteStore.active,
    trpgState: trpgState.value,
    detectIntent: activeModules.value.intentDetection ? _handleIntent : undefined,
    continuePrefix: lastAiMsg.content || '', // Continue特有：原AI消息作为前缀
    onPromptInfo: _handlePromptInfo,
    onChunk: (chunk: string) => {
      // onChunk 语义 = "本次新生成内容的累积文本"（不含 continuePrefix），
      // 所以这里算出完整内容 = 前缀 + 新生成部分；具体写入由 30fps 节流统一完成（P2.1）。
      // 流式期间**不写盘**（P1.2 / A2）：结束时统一落盘一次。
      _queueStreamContent(aiIndex, (lastAiMsg.content || '') + chunk)
    },
    // 思考走独立通道（P6.1）：不混进正文，也不进存档/上下文
    onReasoning: (r: string) => _queueStreamReasoning(aiIndex, r)
  })

  // 收尾前先丢弃未冲刷的缓冲，避免过期增量覆盖最终文本
  _cancelStreamContent()

  const m = runtimeStore.messages[aiIndex]
  if (m && m.role === 'assistant') {
    // 修：原来这里调用的是不存在的 parseBlock()，紧接着又调用不存在的
    // runtimeStore.forceUpdate() —— 连续两次抛错，导致后面的 setLoading(false)
    // 与落盘都不执行（续写结束后按钮卡在"停止"、内容不保存）。P1.1 / A1
    _finalizeMessage(aiIndex, (m.content as string) || '')
  }

  runtimeStore.setLoading(false)
  _persistConversation({ immediate: true })
}

async function handleSend() {
  if (!canSend.value) return
  const text = inputValue.value.trim()
  inputValue.value = ''
  await sendUserMessage(text)
}

function _characterForProcessor() {
  const card = activeCard.value
  if (!card) return null
  // 透传整卡数据（含 system_prompt/post_history_instructions/creator_notes/extensions.depth_prompt/trpg），
  // 仅剥离卡片存储层自带的 id/createdAt/updatedAt
  const { id, createdAt, updatedAt, ...data } = card
  return { spec: 'chara_card_v2' as const, data }
}

/** 意图识别结果处理（intentDetection 开关；MOVE/ATTACK 的完整效果待 Phase 4 接入 combat/adventure） */
function _handleIntent(intent: any) {
  if (!intent || !activeModules.value.intentDetection) return
  console.log('[chat] 意图识别:', intent.action, '| 输入:', (intent.raw || '').slice(0, 30))
}

/** 命运骰（死亡豁免，dicePanel 开关；完整死亡流程待 Phase 4） */
function onFateDice() {
  fateRollVisible.value = false
  uni.showToast({ title: '命运骰（待接入战斗死亡流程）', icon: 'none' })
}

async function sendUserMessage(text: string) {
  runtimeStore.appendMessage({ role: 'user', content: text })

  const aiMsg: ChatMessage = { role: 'assistant', content: '', isStreaming: true, segments: [], swipes: [''], swipe_id: 0 }
  runtimeStore.appendMessage(aiMsg)
  const aiIndex = runtimeStore.messages.length - 1

  runtimeStore.setLoading(true)

  const activePresetResolved = _resolvePreset()
  const character = activeCard.value

  await processor.send({
    character: _characterForProcessor(),
    preset: activePresetResolved,
    chatHistory: toChatHistory(runtimeStore.messages.slice(0, aiIndex)),
    userMessage: text,
    variables: _buildBaseVars(),
    personaDescription: activePersona.value?.description || '',
    trpgState: trpgState.value || undefined,
    authorsNote: noteStore.config,
    detectIntent: activeModules.value.intentDetection ? intentParser.detectIntent : undefined,
    onIntent: _handleIntent,
    lorebookEntries: character ? characterCardStore.getLorebook(character.id) : [],
    worldInfoSessionState: worldInfoState.value,
    onPromptInfo: _handlePromptInfo,
    onChunk: (partial) => {
      // 节流到约 30fps（P2.1 / B1）：真正的写入在 _flushStreamContent 里完成
      _queueStreamContent(aiIndex, partial)
    },
    // 思考走独立通道（P6.1 / D17）
    onReasoning: (r: string) => _queueStreamReasoning(aiIndex, r),
    onComplete: (finalText, segments, wiState) => {
      _cancelStreamContent()
      // 统一收尾：文本思考切分 + 显示态正则 + swipes + 思考耗时（P6.2 / P6.4）
      _finalizeMessage(aiIndex, finalText)
      runtimeStore.setLoading(false)
      worldInfoState.value = wiState
      _persistConversation()
    },
    onError: (err) => {
      _cancelStreamContent()
      // 登录态失效：App 层已经在把登录页推上来了，这里**不要**再往对话里写错误文案 ——
      // 否则用户重新登录回来会看到一条 "[调试信息] HTTP 401: ..." 的 AI 消息，
      // 正是"用户以为系统出问题"的场景。
      // 用户自己那条消息保留，只把这个空的 AI 占位消息去掉；登录回来直接重发即可。
      if (err && err.sessionExpired) {
        const list = [...runtimeStore.messages]
        list.splice(aiIndex, 1)
        runtimeStore.setMessages(list)
        runtimeStore.setLoading(false)
        return
      }
      // 把真实错误名称/消息打全，避免只留一句"抱歉，发生了错误，请重试。"看不出根因
      console.error('[chat.vue] 发送失败 - Name:', err?.name)
      console.error('[chat.vue] 发送失败 - Message:', err?.message)
      console.error('[chat.vue] 发送失败 - Stack:', err?.stack)
      const msgs = [...runtimeStore.messages]
      msgs[aiIndex] = {
        ...msgs[aiIndex],
        content: `抱歉，发生了错误，请重试。\n[调试信息] ${err?.message || err}`,
        isStreaming: false
      }
      runtimeStore.setMessages(msgs)
      runtimeStore.setLoading(false)
    }
  })
}

function onBranchSelect(option: string) {
  inputValue.value = option
  handleSend()
}

function onSwipePrev(idx: number) {
  const msgs = [...runtimeStore.messages]
  const msg = msgs[idx]
  if (!msg.swipes || (msg.swipe_id || 0) <= 0) return
  const newId = (msg.swipe_id || 0) - 1
  const newContent = msg.swipes[newId]
  msgs[idx] = { ...msg, swipe_id: newId, content: newContent, segments: _segmentsFor(newContent, idx) }
  runtimeStore.setMessages(msgs)
  _persistConversation()
}

function onSwipeNext(idx: number) {
  const msgs = [...runtimeStore.messages]
  const msg = msgs[idx]
  if (!msg.swipes) return
  if ((msg.swipe_id || 0) < msg.swipes.length - 1) {
    const newId = (msg.swipe_id || 0) + 1
    const newContent = msg.swipes[newId]
    msgs[idx] = { ...msg, swipe_id: newId, content: newContent, segments: _segmentsFor(newContent, idx) }
    runtimeStore.setMessages(msgs)
    _persistConversation()
  } else {
    regenerateSwipe(idx)
  }
}

async function regenerateSwipe(messageIndex: number) {
  if (runtimeStore.isLoading) return

  const msgs = [...runtimeStore.messages]
  const msg = msgs[messageIndex]
  let userInput = ''
  for (let i = messageIndex - 1; i >= 0; i--) {
    if (msgs[i].role === 'user') { userInput = msgs[i].content; break }
  }
  const newSwipes = [...(msg.swipes || [msg.content]), '']
  const newSwipeId = newSwipes.length - 1
  msgs[messageIndex] = { ...msg, swipes: newSwipes, swipe_id: newSwipeId, content: '', isStreaming: true }
  runtimeStore.setMessages(msgs)
  runtimeStore.setLoading(true)

  const activePresetResolved = _resolvePreset()
  const character = activeCard.value

  await processor.send({
    character: _characterForProcessor(),
    preset: activePresetResolved,
    chatHistory: toChatHistory(msgs.slice(0, messageIndex)),
    userMessage: userInput,
    variables: _buildBaseVars(),
    personaDescription: activePersona.value?.description || '',
    trpgState: trpgState.value || undefined,
    authorsNote: noteStore.config,
    detectIntent: activeModules.value.intentDetection ? intentParser.detectIntent : undefined,
    onIntent: _handleIntent,
    lorebookEntries: character ? characterCardStore.getLorebook(character.id) : [],
    worldInfoSessionState: worldInfoState.value,
    onPromptInfo: _handlePromptInfo,
    onChunk: (partial) => {
      // 节流到约 30fps（P2.1 / B1）
      _queueStreamContent(messageIndex, partial)
    },
    // 思考走独立通道（P6.1 / D17）
    onReasoning: (r: string) => _queueStreamReasoning(messageIndex, r),
    onComplete: (finalText, segments, wiState) => {
      _cancelStreamContent()
      // 统一收尾（P6.2 / P6.4）：与发送路径同一套逻辑
      _finalizeMessage(messageIndex, finalText)
      runtimeStore.setLoading(false)
      worldInfoState.value = wiState
      _persistConversation()
    },
    onError: (err) => {
      _cancelStreamContent()
      console.error('[chat.vue] regenerateSwipe 发送失败 - Name:', err?.name)
      console.error('[chat.vue] regenerateSwipe 发送失败 - Message:', err?.message)
      console.error('[chat.vue] regenerateSwipe 发送失败 - Stack:', err?.stack)
      // 登录态失效：把这条消息恢复到"重新生成之前"的状态（去掉刚压入的空 swipe、
      // 还原 content 与 swipe_id），避免用户登录回来看到一个卡住的空白气泡
      if (err && err.sessionExpired) {
        const list = [...runtimeStore.messages]
        if (list[messageIndex]) list[messageIndex] = { ...msg, isStreaming: false }
        runtimeStore.setMessages(list)
      }
      runtimeStore.setLoading(false)
    }
  })
}

function onMessageLongPress(idx: number) {
  const msg = runtimeStore.messages[idx]
  if (!msg) return
  const isAI = msg.role === 'assistant'
  // 续写：仅当长按的最后一条消息是 AI 消息时才提供（与原先独立“续写”按钮条件一致），
  // 表示从这条消息继续生成；其它 AI 消息仍保留“从此处重新生成”。
  const isLastAI = isAI && idx === runtimeStore.messages.length - 1
  const items = ['编辑', '删除']
  if (isLastAI) items.push('续写')
  if (isAI) items.push('从此处重新生成')
  uni.showActionSheet({
    itemList: items,
    success(res: any) {
      if (res.tapIndex === 0) editMessage(idx)
      else if (res.tapIndex === 1) deleteMessage(idx)
      else if (isLastAI && res.tapIndex === 2) handleContinue()
      else if (isAI && res.tapIndex === (isLastAI ? 3 : 2)) regenerateSwipe(idx)
    }
  })
}

function editMessage(idx: number) {
  const msg = runtimeStore.messages[idx]
  if (!msg) return
  uni.showModal({
    title: '编辑消息',
    editable: true,
    content: msg.content,
    success: (res: any) => {
      if (res.confirm && typeof res.content === 'string') {
        const msgs = [...runtimeStore.messages]
        const newContent = res.content
        const swipes = msgs[idx].swipes ? [...(msgs[idx].swipes as string[])] : undefined
        if (swipes) swipes[msgs[idx].swipe_id || 0] = newContent
        msgs[idx] = { ...msgs[idx], content: newContent, swipes }
        runtimeStore.setMessages(msgs)
        _persistConversation()
      }
    }
  })
}

function deleteMessage(idx: number) {
  uni.showModal({
    title: '删除消息',
    content: '确定要删除这条消息吗？',
    success: (res: any) => {
      if (res.confirm) {
        const msgs = [...runtimeStore.messages]
        msgs.splice(idx, 1)
        runtimeStore.setMessages(msgs)
        _persistConversation()
      }
    }
  })
}

function _emptyPreset(): Preset {
  // 兜底返回**系统预设**（D19：代码内置、默认选中、流式默认开），而非空预设。
  // 对齐酒馆 chatCompletionDefaultPrompts 的语义：没有任何预设可用时也要有一份能用的提示词。
  return createSystemPreset()
}
</script>

<style scoped>
/* 关键改动：不再让 .chat-container 固定 height:100vh + overflow:hidden（那样会把内容裁死在一屏内，
   逼着内部再开一个 scroll-view 去滚，形成"外层系统滚动 + 内层 scroll-view 滚动"两条滚动条同时存在）。
   现在 .chat-container 是 min-height:100vh，内容多高页面就多高，交给系统自己的滚动条（uni-app 页面级滚动）
   去滚整页——也就是要保留的唯一那一条。 */
.chat-container { min-height: 100vh; background: var(--bg-deep); position: relative; }

/* 自定义导航栏：暗色毛玻璃固定在视口顶部，返回键/标题/设置键三段式，标题真正居中 */
.custom-navbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 200;
  background: oklch(18% 0.013 70 / 0.9);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--border);
  box-sizing: border-box;
}
.navbar-row {
  height: 44px;
  display: flex;
  align-items: center;
  padding: 0 14px;
  gap: 10px;
}
.navbar-back, .navbar-settings-btn {
  width: 30px; height: 30px; flex: none; border-radius: 9px;
  display: flex; align-items: center; justify-content: center; color: var(--fg-soft);
}
.navbar-back svg, .navbar-settings-btn svg { width: 18px; height: 18px; }
.navbar-title { flex: 1; text-align: center; font-family: var(--font-body); font-size: 14px; font-weight: 700; color: var(--fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 4px; }

/* 输入区高度 + 底部安全区，用于给消息区留出底部内边距，避免被固定输入栏遮挡最后几条消息；
   paddingTop 由模板里的 :style 动态绑定（导航栏高度），这里不再设 flex/overflow，让内容按实际高度自然撑开页面 */
.messages-container { padding-bottom: calc(96rpx + 32rpx + env(safe-area-inset-bottom)); box-sizing: border-box; }
.messages-wrapper { padding: 14px 14px 10px; min-height: 100%; display: flex; flex-direction: column; gap: 14px; }
/* 消息气泡相关样式已随模板抽到 components/render/MessageItem.vue（P2.4）：
   scoped 样式不跨组件生效，所以它们必须跟模板一起搬走，这里不再保留。 */

/* 渲染窗口的"显示更早消息"入口（P2.6 / C2） */
.show-more-row { display: flex; justify-content: center; padding: 2px 0 6px; }
.show-more-text {
  font-family: var(--font-body); font-size: 11px; color: var(--accent);
  background: var(--accent-soft);
  border: 1px solid color-mix(in oklch, var(--accent) 30%, transparent);
  border-radius: 999px; padding: 5px 14px;
}

/* 生成期间关闭上下两条固定栏的毛玻璃（P2.5 / B5）：
   backdrop-filter 会在"它背后的内容每次变化"时重算整块模糊，流式输出时等于每秒几十次，
   低配设备上很吃性能。生成期间换成接近实色的背景，视觉差异很小但省掉大量合成开销。 */
.is-streaming .custom-navbar,
.is-streaming .input-container {
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  background: oklch(18% 0.013 70 / 0.98);
}

.loading-indicator { display: flex; align-items: center; justify-content: center; padding: 16px; }
.loading-dots { display: flex; gap: 5px; }
.dot { width: 6px; height: 6px; background: var(--accent); border-radius: 50%; animation: dotBounce 1.4s infinite; }
.dot:nth-child(2) { animation-delay: 0.2s; }
.dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes dotBounce { 0%,80%,100%{transform:scale(0)} 40%{transform:scale(1)} }
.chat-bottom { height: 10px; }

/* 需求 6：输入区域必须吸附在视口底部，不随消息列表滚动。
   使用 position: fixed 而不是 flex 布局末尾元素，避免移动端浏览器地址栏收起/展开导致 100vh 计算偏差时输入框被顶飞。
   z-index 保证浮层（背包/状态面板）之下但始终盖在消息内容之上；safe-area-inset-bottom 适配 iPhone 底部手势条。 */
.input-container {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  padding: 10px 14px;
  padding-bottom: calc(10px + env(safe-area-inset-bottom));
  background: oklch(18% 0.013 70 / 0.9);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
  border-top: 1px solid var(--border);
  flex-shrink: 0;
  gap: 8px;
  z-index: 100;
  box-sizing: border-box;
}
.side-btns { display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; }
.side-btn { width: 40px; height: 30px; background: var(--surface); border: 1px solid var(--border); border-radius: 9px; display: flex; align-items: center; justify-content: center; }
.side-btn-text { font-size: 10px; color: var(--fg-soft); font-weight: 500; }
.input-wrapper { flex: 1; display: flex; align-items: center; gap: 8px; }
.chat-input { flex: 1; height: 40px; background: var(--surface); border: 1px solid var(--border); border-radius: 20px; padding: 0 16px; font-size: 13px; color: var(--fg); }
.send-button {
  width: 56px; height: 40px; border-radius: 20px; display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, var(--accent), var(--accent-strong));
  box-shadow: 0 8px 18px -8px oklch(75% 0.14 80 / 0.6);
}
.send-button-disabled { background: var(--raised); box-shadow: none; opacity: .6; }
.stop-button { background: linear-gradient(135deg, oklch(68% 0.17 26), oklch(56% 0.18 24)); box-shadow: none; }
.send-text { font-size: 12px; font-weight: 700; color: #171104; }
.send-button-disabled .send-text { color: var(--faint); }
.stop-button .send-text { color: var(--fg); }
</style>