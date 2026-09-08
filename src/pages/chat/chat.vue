<template>
  <view class="chat-container">
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
        <view v-for="(item, index) in runtimeStore.messages" :key="index" class="message-wrapper" :id="'msg-' + index">
          <!-- 系统消息 -->
          <view class="message-system" v-if="item.role === 'system'">
            <view class="system-content"><text>{{ item.content }}</text></view>
          </view>

          <!-- AI 消息 -->
          <view class="message-ai" v-else-if="item.role === 'assistant'">
            <view class="avatar">
              <image v-if="characterAvatar" class="avatar-img" :src="characterAvatar" mode="aspectFill" />
              <text v-else class="avatar-text">AI</text>
            </view>
            <view class="ai-bubble-col">
              <view class="bubble" @longpress="onMessageLongPress(index)">
                <BlockRenderer
                  v-if="item.segments && item.segments.length > 0"
                  :nodes="item.segments"
                  @select="onBranchSelect"
                />
                <text v-else class="message-text">{{ item.content }}<text v-if="item.isStreaming" class="stream-cursor">▋</text></text>
              </view>
              <view class="swipe-row" v-if="item.swipes && item.swipes.length > 1 && !item.isStreaming">
                <text class="swipe-arrow" :class="(item.swipe_id || 0) <= 0 ? 'swipe-arrow-disabled' : ''" @tap="onSwipePrev(index)">‹</text>
                <text class="swipe-count">{{ (item.swipe_id || 0) + 1 }}/{{ item.swipes.length }}</text>
                <text class="swipe-arrow" @tap="onSwipeNext(index)">›</text>
              </view>
            </view>
          </view>

          <!-- 用户消息 -->
          <view class="message-user" v-else-if="item.role === 'user'">
            <view class="bubble" @longpress="onMessageLongPress(index)">
              <text class="message-text">{{ item.content }}</text>
            </view>
            <view class="avatar">
              <image v-if="personaAvatar" class="avatar-img" :src="personaAvatar" mode="aspectFill" />
              <text v-else class="avatar-text">{{ personaFirstName || '我' }}</text>
            </view>
          </view>
        </view>

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
import { ref, computed, onUnmounted, onMounted } from 'vue'
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
import BlockRenderer from '../../components/render/BlockRenderer.vue'
import CharacterStatus from '../../components/modules/CharacterStatus.vue'
import InventoryPanel from '../../components/modules/InventoryPanel.vue'
import DiceRoller from '../../components/modules/DiceRoller.vue'
import { initTrpgState, trpgStateToCharStatus } from '../../utils/persona/trpgProfile.js'
import { DEFAULT_TRPG_MODULES } from '../../types/character'
import { createDefaultPreset } from '../../adapters/preset/defaultPreset'
import type { ChatMessage } from '../../types/message'
import type { Preset } from '../../types/preset'
import type { RegexScript } from '../../types/script'
// @ts-ignore
import conversationManager from '../../utils/account/conversationManager.js'
// @ts-ignore
import itemManager from '../../utils/items/item-manager.js'
// @ts-ignore
import intentParser from '../../utils/llm/intentParser.js'

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
})

// ── 视口滚动：不再做任何程序化操作 ──────────────────
// 之前版本用"位置驱动跟随 + 手势锁"等机制试图在流式输出时自动把视口钉在底部，
// 但无论如何调整，只要 LLM 开始输出就会在某个时机把视口拉/锁到某个位置，
// 用户完全无法在生成过程中自由滚动。现在彻底移除这一整套自动滚动逻辑：
// 页面滚动完全交给系统原生行为，任何时候都可以自由上下滑动，代码不再调用
// uni.pageScrollTo，也不再监听 onPageScroll/手势事件来"纠正"视口位置。

const processor = new MessageProcessor()

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
  characterCardStore.loadAll()
  presetStore.load()
  regexPresetStore.load()
  personaStore.load()
  moduleStore.load()
  pluginStore.load()
  noteStore.load()

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

function _loadConversation(cardId: string) {
  const record = conversationManager.get(cardId)
  if (record && Array.isArray(record.messages) && record.messages.length > 0) {
    runtimeStore.setMessages(record.messages)
    runtimeStore.localVariables = record.localVariables || {}
    if (record.presetId) sessionPresetId.value = record.presetId
    if (record.regexPresetId) sessionRegexPresetId.value = record.regexPresetId
    if (record.personaId) sessionPersonaId.value = record.personaId
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
    const segments = parseBlocks(processedFirstMes)
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
  if (sessionRegexPresetId.value) {
    const regexPreset = regexPresetStore.get(sessionRegexPresetId.value)
    if (regexPreset) sessionScripts = regexPreset.scripts as RegexScript[]
  }

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

function _persistConversation() {
  const card = activeCard.value
  if (!card) return
  conversationManager.save({
    cardId: card.id,
    cardName: card.name,
    presetId: sessionPresetId.value,
    regexPresetId: sessionRegexPresetId.value,
    personaId: sessionPersonaId.value,
    messages: runtimeStore.messages,
    localVariables: runtimeStore.localVariables,
    worldInfoState: worldInfoState.value,
    trpgState: trpgState.value
  })
}

onUnmounted(() => {
  processor.abort()
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

/** 确保 sessionPresetId 指向一个真实存在于 presetStore 里的预设，没有就创建一个空预设并持久化 */
function _ensureSessionPresetId(): string {
  if (sessionPresetId.value && presetStore.get(sessionPresetId.value)) {
    return sessionPresetId.value
  }
  if (presetStore.activePreset) {
    sessionPresetId.value = presetStore.activePreset.id
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

function handleStop() {
  processor.abort()
  runtimeStore.setLoading(false)
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
    onChunk: (chunk: string) => {
      const m = runtimeStore.messages[aiIndex]
      if (!m || m.role !== 'assistant') return
      m.content = (m.content || '') + chunk
      m.swipes[m.swipe_id || 0] = m.content
      _persistConversation()
    }
  })

  const m = runtimeStore.messages[aiIndex]
  if (m && m.role === 'assistant') {
    m.isStreaming = false
    m.segments = parseBlock(m.content)
    runtimeStore.forceUpdate()
  }

  runtimeStore.setLoading(false)
  _persistConversation()
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
    onChunk: (partial) => {
      const msgs = [...runtimeStore.messages]
      // 样式即时固化：每个 chunk 都重新解析为 RenderNode，而不是等流式结束再统一渲染，
      // 避免先显示纯文本、结束后再跳变为富文本渲染造成的布局抖动
      msgs[aiIndex] = { ...msgs[aiIndex], content: partial, isStreaming: true, segments: parseBlocks(partial) }
      runtimeStore.setMessages(msgs)
    },
    onComplete: (finalText, segments, wiState) => {
      const msgs = [...runtimeStore.messages]
      const prev = msgs[aiIndex]
      const swipes = [...(prev.swipes || [''])]
      swipes[prev.swipe_id || 0] = finalText
      msgs[aiIndex] = { ...prev, content: finalText, isStreaming: false, segments, swipes }
      runtimeStore.setMessages(msgs)
      runtimeStore.setLoading(false)
      worldInfoState.value = wiState
      _persistConversation()
    },
    onError: (err) => {
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
  msgs[idx] = { ...msg, swipe_id: newId, content: newContent, segments: parseBlocks(newContent) }
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
    msgs[idx] = { ...msg, swipe_id: newId, content: newContent, segments: parseBlocks(newContent) }
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
    onChunk: (partial) => {
      const m2 = [...runtimeStore.messages]
      m2[messageIndex] = { ...m2[messageIndex], content: partial, isStreaming: true, segments: parseBlocks(partial) }
      runtimeStore.setMessages(m2)
    },
    onComplete: (finalText, segments, wiState) => {
      const m2 = [...runtimeStore.messages]
      const prev = m2[messageIndex]
      const swipes = [...(prev.swipes || [''])]
      swipes[prev.swipe_id || 0] = finalText
      m2[messageIndex] = { ...prev, content: finalText, isStreaming: false, segments, swipes }
      runtimeStore.setMessages(m2)
      runtimeStore.setLoading(false)
      worldInfoState.value = wiState
      _persistConversation()
    },
    onError: (err) => {
      console.error('[chat.vue] regenerateSwipe 发送失败 - Name:', err?.name)
      console.error('[chat.vue] regenerateSwipe 发送失败 - Message:', err?.message)
      console.error('[chat.vue] regenerateSwipe 发送失败 - Stack:', err?.stack)
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
  // 兜底返回内置默认预设（对齐酒馆 chatCompletionDefaultPrompts），而非空预设
  return createDefaultPreset()
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
.message-wrapper { }
.message-system { display: flex; justify-content: center; }
.system-content { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 6px 12px; max-width: 260px; }
.system-content text { font-family: var(--font-mono); font-size: 9.5px; color: var(--faint); letter-spacing: .06em; line-height: 1.5; }

.message-ai { display: flex; align-items: flex-start; gap: 9px; }
.message-ai .avatar {
  width: 32px; height: 32px; border-radius: 10px; flex: none; overflow: hidden;
  background: linear-gradient(160deg, oklch(68% 0.16 40), oklch(46% 0.12 20));
  border: 1px solid oklch(80% 0.1 45 / 0.5);
  display: flex; align-items: center; justify-content: center;
}
.avatar-img { width: 100%; height: 100%; }
.avatar-text { font-family: var(--font-serif); font-size: 12px; font-weight: 900; color: #1b0b05; }
/* AI 消息：头像左置；ai-bubble-col 占满剩余宽度，泡泡本身按内容宽度收缩 */
.ai-bubble-col { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0; }
/* 泡泡宽度跟随文字内容（不再占满整行）；远端留白交给下方两侧各自的上限控制 */
.bubble { width: fit-content; background: var(--surface); border: 1px solid var(--border); border-radius: 15px; border-top-left-radius: 5px; padding: 11px 13px; }
/* 两端镜像、远端各留16px：
   - AI 泡泡在 ai-bubble-col 内，列右缘即消息行右缘，上限 calc(100% - 16px)
     → 最宽时右端距行右缘正好 16px（= 消息宽 - 头像32 - 间距9 - 16）
   - 用户泡泡所在行右端含头像32px+间距9px，上限 calc(100% - 57px)（57=16+9+32）
     → 最宽时左端距行左缘也正好 16px；两侧最大像素宽度相同（消息宽-57px），完全镜像 */
.message-ai .bubble { max-width: calc(100% - 16px); }
.message-user .bubble { max-width: calc(100% - 57px); }
.swipe-row { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 2px; }
.swipe-arrow { font-family: var(--font-mono); font-size: 15px; color: var(--accent); font-weight: 700; padding: 0 4px; }
.swipe-arrow-disabled { color: var(--faint); opacity: .4; }
.swipe-count { font-family: var(--font-mono); font-size: 9.5px; color: var(--faint); letter-spacing: .04em; }

/* 用户消息：普通 row + justify-content:flex-end，avatar 作为行内最后一个子元素，
   右边缘始终贴行右缘（= 屏幕右缘 14px），与左侧 AI 头像（14px）镜像对称 */
.message-user { display: flex; align-items: flex-start; justify-content: flex-end; flex-direction: row; gap: 9px; }
.message-user .bubble {
  background: linear-gradient(135deg, oklch(78% 0.12 84 / 0.9), oklch(66% 0.14 74 / 0.9));
  color: #1c1204; font-weight: 500;
  border-radius: 15px; border-top-right-radius: 5px; border: none;
}
.message-user .avatar {
  width: 32px; height: 32px; border-radius: 10px; flex: none; overflow: hidden;
  background: var(--raised); border: 1px solid var(--border-strong);
  display: flex; align-items: center; justify-content: center;
}
.message-user .avatar-text { font-family: var(--font-serif); font-size: 12px; font-weight: 900; color: var(--fg-soft); }
.message-text { font-family: var(--font-body); font-size: 13px; color: inherit; line-height: 1.65; }
.stream-cursor { display: inline-block; color: var(--accent); animation: blink 900ms step-end infinite; }
@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }

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