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
          <!-- 齿轮（原图标是"圆心+放射线"，看起来像太阳，用户要求换成齿轮） -->
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
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
          :placeholder="autoMode ? '自动输入中' : '输入消息...'"
          confirm-type="send"
          @confirm="handleSend"
          :disabled="runtimeStore.isLoading"
          maxlength="1000"
        />
        <!-- 自动回复期间盖一层透明遮罩：点击即退出。
             用遮罩而不是给 input 绑 tap —— isLoading 时 input 是 disabled 的，
             浏览器对 disabled 表单控件不派发点击事件，绑在它上面收不到。 -->
        <view v-if="autoMode" class="auto-overlay" @tap="exitAutoMode"></view>

        <!-- 自动回复中：发送键闪烁、文字变"自动"（点一下也能退出） -->
        <view v-if="autoMode" class="send-button auto-button" @tap="exitAutoMode">
          <text class="send-text">自动</text>
        </view>
        <!-- 生成中：停止 -->
        <view v-else-if="runtimeStore.isLoading" class="send-button stop-button" @tap="handleStop">
          <text class="send-text">停止</text>
        </view>
        <!-- 空闲：没有输入内容时是黑色的；长按 3 秒进入自动回复（需先在「对话设置」打开自动输入） -->
        <view
          v-else
          :class="['send-button', canSend ? '' : 'send-button-disabled']"
          @tap="handleSend"
          @touchstart="onSendPressStart"
          @touchend="onSendPressEnd"
          @touchcancel="onSendPressEnd"
        >
          <text class="send-text">发送</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted, onMounted, nextTick } from 'vue'
import { onLoad, onShow, onPageScroll } from '@dcloudio/uni-app'
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
import { splitReasoning, combineReasoning, loadReasoningConfig, type ReasoningSplitConfig } from '../../engine/ReasoningHandler'
import { nextShownLength, loadPacingConfig, type StreamPacingConfig } from '../../utils/streamPacing'
import { DEFAULT_AUTO_REPLY_TEXT, normalizeAutoReply } from '../../types/preset'

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
  // 存档改为防抖后（D12），直接关闭标签页/刷新可能落在防抖窗口内。
  // ⚠️ 别再指望"beforeunload 里同步写一次本地存储"——P5.2 之后存档介质是**异步 IndexedDB**，
  // 刷新时那次写入会被浏览器直接丢弃。现在这里做两件事：
  //   ① 同步写一份 sessionStorage 草稿（见 _writeDraftSync，唯一来得及的写法）；
  //   ② 顺手发起一次正式的异步落盘（能完成就完成，完不成也有草稿兜底）。
  // pagehide 是移动端（iOS Safari 等）在"刷新/关闭/被回收"时更可靠的最后一个事件。
  try { window.addEventListener('beforeunload', _flushPersist) } catch (e) { /* ignore */ }
  try { window.addEventListener('pagehide', _flushPersist) } catch (e) { /* ignore */ }
  // #endif
})

/**
 * 页面重新可见时刷新"能在别处改"的配置
 *
 * chat 页的右上角设置键现在打开的是「对话设置」（同一个页面栈里的 navigateTo），
 * 返回时 **onLoad 不会再跑**：流式显示速度、思考解析开关都是那页能改的，
 * 不在这里重读的话，用户改完回来会发现"改了没用"。
 */
onShow(() => {
  _pacing.value = loadPacingConfig()
  _reasoningCfg.value = loadReasoningConfig()
  // 从「对话设置」等页面返回时补一次置底，并恢复"贴底跟随"（原因见下面置底那一节的说明）。
  // 首次进入时 onShow 早于 _bootConversation 完成（那时连消息都还没有），
  // 置底交给 _bootConversation 自己负责，避免滚了个空页面。
  if (_bootCompleted) _pinToBottom([0, 120])
})

// ── 视口滚动：进入/返回时置底（生成期间不跟随）──────────────────────
//
// 历史教训（不要退回这些写法）：
//   ① 老版本用"位置驱动跟随 + 手势锁"**无条件**把视口钉在底部 → 生成期间用户完全没法往上翻，
//      于是整套跟随被删掉；
//   ② 后来加了"有条件跟随"（贴底才跟、上滑就停），但用户实测生成期间视口被**反复拉到最上面** ——
//      根因不在跟随逻辑本身，而在 `uni.pageScrollTo` 当时是坏的（详见 _doScrollBottom 的注释）：
//      「滚到底部」实际是「滚到顶部」，而且 onPageScroll 恒为 0 导致"上滑就停"永远触发不了。
//      → 现已把根因（App.vue 里 html 上的 overflow-x）修掉，并且**按用户要求不再恢复生成期间的跟随**。
//
// 现在的行为：
//   · 进入 / 继续对话 → 置底（看到最新消息）
//   · 从「对话设置」等页面返回 → 置底（H5 切页时滚动偏移会被重置为 0）
//   · 用户主动发送 / 自动回复开新一轮 / 编辑后重新生成 → 置底一次
//   · **生成期间零视口操作**（见 _doScrollBottom 的 isLoading 闸门）
//   · 用户往上翻历史 → 完全不受打扰（没有任何自动跟随）
/** 置底的补偿时间点（毫秒）：消息是富文本（卡片/代码块/图片）渲染的，高度异步撑开，只滚一次会差一点到底 */
const SCROLL_BOTTOM_RETRIES = [0, 150, 420]
/** 距底部多少像素以内算"贴着底部"。留余量：亚像素取整、滚动条宽度差都不该被判成"用户滑走了" */
const BOTTOM_STICK_THRESHOLD = 60
/** 我们自己发起的滚动：忽略紧随其后的那次 scroll 事件（消费一次即失效） */
const SELF_SCROLL_GUARD_MS = 80

let _scrollTimers: Array<ReturnType<typeof setTimeout>> = []
/** 会话是否已经装载完成（区分"首次进入"与"从别的页面返回"） */
let _bootCompleted = false

/**
 * 是否跟随流式输出（true = 视口保持贴底）
 *
 * 初值 true：刚进页面时本来就该在底部。
 * 由 onPageScroll 维护：离开底部 → false；滑回底部 → true。
 */
let _stickToBottom = true
/** onPageScroll 给的最近一次 scrollTop（非 H5 端读不到同步值时也靠它） */
let _lastScrollTop = 0
/** 最近一次测得的最大可滚动位置（非 H5 端读不到同步值，用这个缓存） */
let _cachedMaxScrollTop = 0
/** 我们自己发起滚动的时刻（用于识别随之而来的那次 scroll 事件） */
let _selfScrollAt = 0
/** 非 H5 端最近一次异步测量 scrollHeight 的时刻 */
let _lastMeasureAt = 0

function _clearScrollTimers() {
  _scrollTimers.forEach(t => clearTimeout(t))
  _scrollTimers = []
}

/**
 * 读取"最大可滚动位置"
 *
 * 坐标系与 uni-app 的 onPageScroll 保持一致（它回调的是 window.pageYOffset），
 * 底部判定也照抄 uni 自己的算法（documentElement.scrollHeight - window.innerHeight）。
 * H5 能同步读到；其它端返回缓存值，由 _measurePageMax() 定期刷新。
 *
 * ⚠️ 这里**不要**顺手更新 _lastScrollTop —— 那个值必须只由滚动回调维护，
 * 否则"用户是不是在往上滑"的判断会拿当前值和自己比，永远判不出来。
 */
function _readPageMetrics(): number {
  // #ifdef H5
  try {
    const docEl = document.documentElement
    _cachedMaxScrollTop = Math.max(0, (docEl.scrollHeight || 0) - (window.innerHeight || 0))
  } catch (e) { /* 落到缓存值 */ }
  // #endif
  return _cachedMaxScrollTop
}

/**
 * 非 H5 端：异步量一次"最大可滚动位置"（内部按 300ms 节流）
 *
 * H5 走 _readPageMetrics 的同步分支，这里被条件编译成空函数。
 */
function _measurePageMax() {
  // #ifndef H5
  const now = Date.now()
  if (now - _lastMeasureAt < 300) return
  _lastMeasureAt = now
  try {
    uni.createSelectorQuery().selectViewport().scrollOffset().exec((res: any[]) => {
      const info = res && res[0]
      if (!info) return
      const win: any = uni.getSystemInfoSync ? uni.getSystemInfoSync() : {}
      _cachedMaxScrollTop = Math.max(0, (Number(info.scrollHeight) || 0) - (win.windowHeight || 0))
    })
  } catch (e) { /* 量不到就维持原缓存：最坏结果是判定偏保守 */ }
  // #endif
}

/**
 * 真正执行一次"滚到最底部"
 *
 * 用 uni.pageScrollTo 而不是手写 window.scrollTo：uni-app H5 的实现（uni-shared 的 scrollTo()）
 * 会先按 documentElement 的 scrollHeight/clientHeight 钳制，再同时写 documentElement.scrollTop
 * 与 body.scrollTop —— 正好覆盖"个别浏览器要用 body 控制滚动"的情况。
 *
 * ⚠️ 它有一个**前提**：视口必须是滚动容器。
 * 曾经的故障（2026-09，查了两轮）：`src/App.vue` 把 `overflow-x: hidden` 同时加在了 html 和 body 上，
 * 导致 body 变成滚动容器、html 永不溢出 → `scrollHeight - clientHeight = 0` → 超大 scrollTop
 * 被钳成 0 再写给 body → **「滚到底部」变成「滚到最顶部」**。
 * 已在 App.vue 里把 html 上的 overflow-x 去掉根治。若将来又出现"置底反而跳到顶部"，
 * 第一个要查的就是：html 上是否又被加了非 visible 的 overflow（自检命令见 App.vue 那段注释）。
 *
 * `runtimeStore.isLoading` 期间一律不执行：见 SCROLL 那一节顶部说明（生成期间不碰视口）。
 * 只有用户自己的动作（进入 / 返回 / 主动发送 / 自动回复开新一轮）带 allowDuringLoading 放行。
 */
function _doScrollBottom(opts: { allowDuringLoading?: boolean } = {}) {
  if (runtimeStore.isLoading && !opts.allowDuringLoading) return
  _selfScrollAt = Date.now()
  uni.pageScrollTo({ scrollTop: 9999999, duration: 0 })
}

/**
 * 滚到页面最底部（= 最新一条消息）
 *
 * 每一步都会重新确认 `_stickToBottom`：置底后用户如果在补偿窗口内往上滑了，
 * 后面几次补偿就不再执行，不会把他拽回来。
 *
 * @param opts.delays 补偿滚动的执行时间点（毫秒）。默认用于"刚载入会话"——
 *   那时富文本还在陆续撑开高度，一次滚不到底；而"用户主动发送那一下"只需要滚一次。
 * @param opts.allowDuringLoading 是否允许在"正在生成"时执行（只给用户主动发起的置底用）
 */
function _scrollToBottom(opts: { delays?: number[]; allowDuringLoading?: boolean } = {}) {
  _clearScrollTimers()
  const delays = (opts.delays && opts.delays.length) ? opts.delays : SCROLL_BOTTOM_RETRIES
  delays.forEach((delay, i) => {
    const timer = setTimeout(() => {
      _scrollTimers = _scrollTimers.filter(t => t !== timer)
      const run = () => {
        if (!_stickToBottom) return
        _doScrollBottom({ allowDuringLoading: !!opts.allowDuringLoading })
      }
      if (i === 0) nextTick(run)
      else run()
    }, delay)
    _scrollTimers.push(timer)
  })
}

/** 强制"贴底 + 滚到底"（进入页面 / 从别的页面返回时用，带补偿）—— 用户主动动作，生成期间也放行 */
function _pinToBottom(delays?: number[]) {
  _stickToBottom = true
  _scrollToBottom({ delays: delays && delays.length ? delays : undefined, allowDuringLoading: true })
}

/** 强制"贴底 + 滚到底"，只滚一次（发送 / 自动回复每一轮 / 编辑后重新生成）—— 用户主动动作 */
function _pinToBottomOnce() {
  _stickToBottom = true
  _scrollToBottom({ delays: [0], allowDuringLoading: true })
}

// 🚨 原先这里有一个 _followStreaming()：生成期间每 ~100ms 把视口拉到底部。
// 用户实测它表现为"视口被反复拉到页面最上面"，已整段删除（连同 _lastFollowAt / FOLLOW_THROTTLE_MS
// 这两个只为它存在的变量）。删除而不是注释掉，是为了避免以后有人手滑再启用同一个坏路径。
// 根因查清之前不要恢复。

/**
 * 用户滚动 → 维护"是否贴底跟随"
 *
 * 关键点：我们自己程序化滚到底也会触发这个回调，如果不加区分，
 * 就会出现"用户刚往上滑、我们立刻又把他拽回底部"的死循环（老版本的病根）。
 * 所以两重保护：
 *   ① 我们自己滚动的 80ms 内忽略滚动事件；
 *   ② 只要 scrollTop 是**变小**的（用户往上滑），无条件停止跟随，不等滑出阈值 ——
 *      否则惯性滚动刚开始的那几帧还在阈值内，会被我们往回拽一下。
 */
onPageScroll((e: any) => {
  const scrollTop = Number(e && e.scrollTop) || 0
  const now = Date.now()
  const movedUp = scrollTop < _lastScrollTop - 1
  // 非 H5 端先排一次异步测量（H5 里这个函数被条件编译成空实现）
  _measurePageMax()
  const max = _readPageMetrics()
  const atBottom = (max - scrollTop) <= BOTTOM_STICK_THRESHOLD

  // 区分"我们自己滚的"与"用户滚的"（老版本就是死在这里：不区分的话，
  // 用户刚往上滑、我们随后落地的滚动又会把他粘回底部，变成翻不动）。
  //   ① 只有"没往上滑 + 已经在底部"的事件才可能是我们滚出来的 —— 用户往上滑的事件永不忽略；
  //   ② 消费一次即失效（_selfScrollAt 清零），否则会顺手吃掉用户"滑回底部"的正常操作；
  //   ③ 还有 80ms 时间窗，避免把很久之后的滚动误判成我们自己的。
  const selfScroll = atBottom && !movedUp && (now - _selfScrollAt) < SELF_SCROLL_GUARD_MS
  _lastScrollTop = scrollTop
  if (selfScroll) {
    _selfScrollAt = 0
    return
  }

  if (movedUp) {
    // 用户往上滑：立刻停止跟随，并取消还没落地的补偿滚动
    _stickToBottom = false
    _clearScrollTimers()
  } else {
    // 滑回底部 → 恢复跟随；停在中间 → 不跟随
    _stickToBottom = atBottom
  }
})

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
// 反例（不要退回这种写法）：**每个 chunk** 都替换整个 messages 数组 + 重跑 parseBlocks(全文)——
// 长回复是 O(n²) 的重复解析，而且父组件整张消息表都会重渲染。
// 现在：增量攒进缓冲区，约 30fps 写一次（对齐酒馆 Stopwatch(1000/streaming_fps) 的节流）。
const STREAM_FLUSH_MS = 33
/** 正文与思考可以分别到达，所以缓冲区里两个字段各自可选 */
let _pendingStream: { index: number; content?: string; reasoning?: string } | null = null
let _streamTimer: ReturnType<typeof setTimeout> | null = null

// ── 平滑输出（用户实测反馈：真流式下"疯狂涌出、速度不可控"）────────────────
// 仍然是真流式（首字延迟不变、不用等全文），但 UI 按设定速率**逐字释放**已到的文本。
// 关掉 = 完全跟上游速度。实现见 utils/streamPacing.ts（对齐酒馆 smooth_streaming）。
const _pacing = ref<StreamPacingConfig>({ enabled: true, charsPerSec: 80 })
/** 每条消息"已经释放到第几个字符"（平滑模式下用来限速） */
const _streamShown = new Map<number, number>()
/** 每条消息"上游已到达的最新完整文本"（停止生成时用，避免丢掉还没显示的部分） */
const _streamTarget = new Map<number, string>()
/** 待收尾：平滑模式下要等文本释放完再落定，避免最后一帧"啪"地补全 */
let _pendingFinalize: { index: number; text: string; after?: () => void } | null = null

// ── 自动回复（长按发送键 3 秒进入）──────────────────────────────
/** 长按阈值：用户要求 3 秒 */
const AUTO_REPLY_HOLD_MS = 3000
/** 两轮自动回复之间的小间隔（给用户一点"看清楚了"的时间，也避免请求过于密集） */
const AUTO_REPLY_INTERVAL_MS = 600
/** 是否处于自动回复状态（发送键闪烁 + 文字变"自动"） */
const autoMode = ref(false)
/** 自动回复的轮次定时器 */
let _autoTimer: ReturnType<typeof setTimeout> | null = null
/** 发送键长按计时器 */
let _holdTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 自动回复配置：**跟随本次会话选中的预设**（在「对话设置」页里配置）。
 *
 * ⚠️ 几个开关的默认值是**打开**（用户要求开箱即用，不必先去保存一次设置）：
 * 缺字段一律按"开"处理，判定口径与 normalizeAutoReply 保持一致。
 * 文本为空时回落到默认文本，避免把空消息发给模型。
 */
const autoReplyCfg = computed(() => {
  const cfg = normalizeAutoReply((_resolvePreset() as any)?.autoReply)
  const custom = cfg.customText.trim() || DEFAULT_AUTO_REPLY_TEXT
  return {
    enabled: cfg.enabled,
    useCustomText: cfg.useCustomText,
    text: cfg.useCustomText ? custom : DEFAULT_AUTO_REPLY_TEXT
  }
})

function _ensurePending(index: number) {
  if (!_pendingStream || _pendingStream.index !== index) _pendingStream = { index }
  _pendingStream.index = index
  if (!_streamTimer) _streamTimer = setTimeout(_flushStreamContent, STREAM_FLUSH_MS)
}

/** 排入正文增量（调用方负责算出"这条消息此刻应该显示成什么"） */
function _queueStreamContent(index: number, content: string) {
  _streamTarget.set(index, content)
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
 * 按平滑配置计算"这一帧应该显示到哪里"，并写进消息
 * @returns 是否还有未释放的文本（需要继续下一帧）
 */
function _applyPacedText(index: number, fullText: string): boolean {
  const p = _pacing.value
  if (!p.enabled || !(p.charsPerSec > 0)) {
    _streamShown.set(index, fullText.length)
    _applyMessageText(index, fullText, { streaming: true })
    return false
  }
  const shown = _streamShown.get(index) || 0
  const next = nextShownLength(shown, fullText.length, p.charsPerSec, STREAM_FLUSH_MS)
  _streamShown.set(index, next)
  _applyMessageText(index, fullText.slice(0, next), { streaming: true })
  return next < fullText.length
}

/**
 * 把"原始正文"落到消息上（P6.4 / D21）
 * 自动识别定界符切出思考 → 显示态正则 → segments；流式与最终收尾共用，保证两条路径一致。
 */
function _applyMessageText(index: number, rawText: string, opts: { streaming?: boolean } = {}) {
  const m = runtimeStore.messages[index]
  if (!m || m.role !== 'assistant') return
  const split = splitReasoning(rawText, _reasoningCfg.value)
  m.content = split.content
  // 流式期间补齐未闭合的成对 Markdown（P2.3 / B6），并走显示态正则（P4.6 / C1）
  m.segments = _segmentsFor(split.content, index, { streaming: !!opts.streaming })
  // 正文定界符切出来的思考（开关关着时为空）。它与上游 reasoning 并列保留，
  // 折叠块里显示两者的并集（D21）—— 见 _refreshReasoningDisplay。
  m.reasoningFromText = split.reasoning || undefined
  _refreshReasoningDisplay(m, index)
}

/**
 * 刷新思考的"显示态"（P6.5 / D17 + D21）
 *
 * 折叠块里要显示的思考有**两份来源**：上游原生 `reasoning_content` + 正文定界符切出的部分。
 * 两者合并后统一走 placement=REASONING 的显示态正则（用户可以单独控制思考怎么显示）。
 */
function _refreshReasoningDisplay(m: any, index: number) {
  const combined = combineReasoning(m.reasoning, m.reasoningFromText)
  m.reasoningDisplay = combined ? _reasoningFor(combined, index) : undefined
}

/** 真正写进 store：就地修改消息对象，父组件不会因为每个 chunk 而整体重渲染 */
function _flushStreamContent() {
  if (_streamTimer) { clearTimeout(_streamTimer); _streamTimer = null }
  const pending = _pendingStream
  _pendingStream = null
  let needMore = false

  if (pending) {
    const m = runtimeStore.messages[pending.index]
    if (m && m.role === 'assistant') {
      if (typeof pending.content === 'string') {
        // 平滑模式下这里只释放一部分，剩下的留到后续帧（速度可控）
        needMore = _applyPacedText(pending.index, pending.content) || needMore
        if (Array.isArray(m.swipes)) m.swipes[m.swipe_id || 0] = m.content
      }
      if (typeof pending.reasoning === 'string') {
        // 上游原生思考（reasoning_content）：与正文定界符切出的部分**并列保留**（D21），
        // 折叠块显示两者的并集；思考不参与正文限速，避免拖慢正文
        m.reasoning = pending.reasoning
        _refreshReasoningDisplay(m, pending.index)
      }
      m.isStreaming = true
    }
  }

  // 收尾也要等"未释放的文本"播完，否则最后一帧会突然补全一大段
  if (_pendingFinalize) {
    const p = _pendingFinalize
    const m = runtimeStore.messages[p.index]
    if (!m || !_applyPacedText(p.index, p.text)) {
      _pendingFinalize = null
      _streamShown.delete(p.index)
      _streamTarget.delete(p.index)
      _finalizeMessage(p.index, p.text)
      if (p.after) p.after()
    } else {
      m.isStreaming = true
      needMore = true
    }
  }

  // 流式期间也要落盘（修复：刷新丢掉正在输出的内容）。
  // 走 500ms 防抖（_persistConversation），最多丢半秒文本；真正"一秒都不能等"的那半秒
  // 由 _flushPersist 里的 sessionStorage 同步草稿兜底。
  if (pending) _persistConversation()

  // 🚨 这里原先有"流式跟随"（每 ~100ms 把视口拉到底部）。
  // 用户实测：LLM 一开始输出，视口就被反复拉到页面最上面 —— 已按要求整段移除。
  // 生成期间不再有任何由输出驱动的视口操作（另见 _doScrollBottom 里的硬开关）。
  // 不要在没有查清根因之前把它加回来。

  if (needMore && !_streamTimer) {
    _streamTimer = setTimeout(_flushStreamContent, STREAM_FLUSH_MS)
  }
}

/**
 * 安排收尾（P6.2 + 平滑输出）
 * 未开启平滑时立刻收尾（行为与之前一致）；开启时等剩余文本按节奏释放完再收尾。
 */
function _scheduleFinalize(index: number, finalText: string, after?: () => void) {
  _pendingStream = null
  const p = _pacing.value
  const shown = _streamShown.get(index) || 0
  if (!p.enabled || !(p.charsPerSec > 0) || shown >= finalText.length) {
    _streamShown.delete(index)
    _streamTarget.delete(index)
    _finalizeMessage(index, finalText)
    if (after) after()
    return
  }
  _pendingFinalize = { index, text: finalText, after }
  if (!_streamTimer) _streamTimer = setTimeout(_flushStreamContent, STREAM_FLUSH_MS)
}

/**
 * 显示态管线（P4.1 / P4.6 / D5 三态分离）
 *
 * 渲染管线顺序：**原文 → markdownOnly 正则（显示态）→ BlockParser → 渲染节点**。
 *
 * 必须逐帧处理的原因：若输出侧正则只在"生成结束后"跑一次，且**不传 isMarkdown**，
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
const _reasoningCfg = ref<ReasoningSplitConfig>({ enabled: false })
/** 思考开始时间（按消息下标记录，用于"已思考 N 秒"；不持久化） */
const _reasoningStart = new Map<number, number>()

/**
 * 收尾一条 AI 消息（P6.2 / P6.4）
 * 统一处理：文本思考切分 → 显示态正则 → segments → swipes → 思考结束标记与耗时。
 * 流式结束、停止生成、续写收尾都走这里，避免三条路径行为不一致。
 */
function _finalizeMessage(index: number, finalText: string) {
  // 清掉平滑输出的过程状态（已落定，不再需要）
  _streamShown.delete(index)
  _streamTarget.delete(index)
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
    reasoningFromText: m.reasoningFromText,
    reasoningDisplay: m.reasoningDisplay,
    reasoningDone: !!(m.reasoning || m.reasoningFromText),
    reasoningDurationMs: startedAt ? Date.now() - startedAt : undefined,
    swipes
  }
  runtimeStore.setMessages(next)
  _reasoningStart.delete(index)
  // 🚨 这里原先还有一次"收尾后补一次跟随"。同上，已按要求移除：
  // 生成相关的任何视口操作都会表现为"视口被拽走"，先全部停掉，等根因查清再说。
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
  _pendingFinalize = null
  _streamShown.clear()
  _streamTarget.clear()
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

// 世界书限时效果（sticky/cooldown）状态，随会话持久化
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
// TRPG 模块开关：读当前角色卡的 extensions.trpg.modules（默认全关）
const activeModules = computed(() => (activeCard.value?.extensions?.trpg?.modules) || DEFAULT_TRPG_MODULES)

// 需求 2：导航栏标题显示角色卡名称，而不是固定文案"对话"（见模板 .navbar-title，绑定 characterName）。
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

  // 平滑输出节奏（本轮新增）：设置页可能刚改过
  _pacing.value = loadPacingConfig()

  sessionCardId.value = options?.cardId || characterCardStore.activeCardId || ''
  sessionPresetId.value = options?.presetId || ''
  sessionRegexPresetId.value = options?.regexPresetId || ''
  sessionPersonaId.value = options?.personaId || ''

  if (sessionCardId.value) {
    characterCardStore.setActive(sessionCardId.value)
    // 注意：此刻 store 可能还没 hydrate 完（刷新首帧会读到 null），
    // 依赖卡片数据的初始化（itemManager.init）统一放到 _bootConversation 里等就绪后再做。
  }

  const mode = options?.mode || 'continue'
  _bootConversation(mode)
})

/**
 * 进入会话的统一入口（异步：所有"读数据"的前置条件都收在这里）
 *
 * ⚠️ mode=new 也要判重：chat 页一直是过渡页用 `mode=new` 进来的，这个参数会留在地址栏里，
 * 用户按 F5 刷新时 onLoad 拿到的仍是 mode=new。旧代码据此无条件 _startFresh()：清空消息、
 * 只留开场白，并在 500ms 后把这份"只有 1 条"的列表**覆盖写回存档** —— 几十轮对话是真的
 * 被删掉，不只是显示丢失。现在改为：已有存档或同步草稿就恢复，确认是全新会话才重开。
 *
 * ⚠️ 必须等角色卡 store hydrate 就绪：刷新后的第一帧同步读会拿到 null，
 * 那样 _startFresh() 连开场白（first_mes）都取不到，页面就是全白。
 */
async function _bootConversation(mode: string) {
  await characterCardStore.ensureLoaded()
  if (sessionCardId.value) {
    const card = characterCardStore.getById(sessionCardId.value)
    // TRPG 道具表依赖卡片 extensions，必须在拿到卡之后再初始化
    if (card) itemManager.init((card as any).extensions?.trpg, card.name)
  }

  if (!sessionCardId.value) {
    _startFresh()
    _bootCompleted = true
    _pinToBottom()
    return
  }

  if (mode === 'new') {
    await conversationManager.init()
    if (conversationManager.has(sessionCardId.value) || conversationManager.hasDraft(sessionCardId.value)) {
      await _loadConversation(sessionCardId.value)
      _bootCompleted = true
      _pinToBottom()
      return
    }
    _startFresh()
    _bootCompleted = true
    _pinToBottom()
    return
  }

  await _loadConversation(sessionCardId.value)
  // 会话载入完成后置底：进入历史对话时应该停在**最新一条**，而不是渲染窗口的第一条。
  // 同时把"贴底跟随"恢复成 true —— 刚进页面本来就该跟着最新内容走。
  _bootCompleted = true
  _pinToBottom()
}

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
  // 思考的"显示态"是派生数据，不入档；读档时按两份来源合并后重算（P6.5 / D21）
  if (out.reasoning || out.reasoningFromText) {
    out.reasoningDisplay = _reasoningFor(combineReasoning(out.reasoning, out.reasoningFromText), index)
  }
  return out
}

function _rehydrateMessages(msgs: any[]): any[] {
  if (!Array.isArray(msgs)) return []
  const total = msgs.length
  return msgs.map((m, i) => _rehydrateMessage(m, i, total))
}

/**
 * 读档/读草稿后的清洗（刷新恢复的正确性保证）
 *
 *  1. `isStreaming` 必须落定：刷新时那条消息的流式请求已经不存在了，
 *     留着 true 会让光标 ▋ 永远闪、swipe 切换箭头也被挡住；
 *  2. 丢弃**尾部**的空 AI 占位消息：它只是"正在等首字"的容器（发送瞬间就落盘了），
 *     刷新后没有任何内容可显示，留着就是一个永久空白气泡。
 */
function _sanitizeLoadedMessages(msgs: any[]): any[] {
  const out = (Array.isArray(msgs) ? msgs : []).map(m => (m && typeof m === 'object' ? { ...m, isStreaming: false } : m))
  while (out.length > 0) {
    const last: any = out[out.length - 1]
    const hasText = !!(last && String(last.content || '').trim())
    const hasSwipe = !!(last && Array.isArray(last.swipes) && last.swipes.some((s: any) => String(s || '').trim()))
    if (last && last.role === 'assistant' && !hasText && !hasSwipe) out.pop()
    else break
  }
  return out
}

/** 把一份存档/草稿装进运行时状态（含会话资源绑定与派生数据重建） */
function _applyRecord(record: any) {
  // 先恢复会话资源绑定，再重建消息：_segmentsFor 依赖 sessionPresetId/sessionRegexPresetId
  // 选出的正侧脚本（否则会用错预设的正则去渲染历史消息）。
  if (record.presetId) sessionPresetId.value = record.presetId
  if (record.regexPresetId) sessionRegexPresetId.value = record.regexPresetId
  if (record.personaId) sessionPersonaId.value = record.personaId
  runtimeStore.setMessages(_rehydrateMessages(_sanitizeLoadedMessages(record.messages)))
  runtimeStore.localVariables = record.localVariables || {}
  if (record.worldInfoState) worldInfoState.value = record.worldInfoState
  if (record.trpgState) trpgState.value = record.trpgState
  runtimeStore.setLoading(false)
}

async function _loadConversation(cardId: string) {
  // P5.2：存档已迁到 IndexedDB（异步）。必须先 await init()：
  // 它负责读取列表缓存并执行 v1→v2 老档迁移。
  await conversationManager.init()

  // ① 同步草稿优先：它是"刷新前最后一次内存态"（sessionStorage 同步写入），
  //    比异步落盘的存档新 —— 最多能补回刷新前 500ms 内的文字。
  const draft = conversationManager.takeDraft(cardId)
  if (draft && Array.isArray(draft.messages) && draft.messages.length > 0) {
    _applyRecord(draft)
    // 把草稿并回正式存档（异步落盘，失败会走 notifyStorageFailure 提示）
    _persistConversation({ immediate: true })
    return
  }

  const record = await conversationManager.load(cardId)
  if (record && Array.isArray(record.messages) && record.messages.length > 0) {
    _applyRecord(record)
    // 打开历史对话即视为"最近在用"：立刻落一次盘，把 updatedAt 刷新成现在。
    // 否则列表按 updatedAt 倒序排，"点进来接着聊"的这段对话仍停在几天前的位置，
    // 用户会觉得"我刚打开过，怎么没排到最前面"。
    _persistConversation({ immediate: true })
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
    // 宏替换（{{char}}/{{user}}/{{description}}/{{personality}}/{{scenario}} 等）
    const vars = _buildBaseVars()
    // 酒馆 Alt. Greetings：first_mes 是第 0 个 swipe，alternate_greetings 依次追加为可切换的其他开场白
    const rawGreetings = [rawFirstMes, ...((card as any)?.alternate_greetings || [])]
    // ⚠️ 对齐酒馆 `getFirstMessage()`（script.js:7710-7740）：开场白与所有 alternate_greetings
    // 落档**之前**要先过一遍「输出侧正则」（placement=0、不带 isMarkdown/isPrompt），
    // 之后再走显示态管线。改造前只做宏替换就落档，于是：
    //   · 存档里是原始文本，而显示态管线又会把它当"用户输入/台词"再处理一次 → 渲染不一致；
    //   · 用 DSmama 那套正侧时开场白会被显示态套上 `<user_input>…</user_input>` 并**显示出来**；
    //   · 同一个文件"实时新开对话"与"刷新重载后"的渲染结果不同。
    const outputScripts = ((_resolvePreset()?.regexScripts as RegexScript[]) || [])
    const applyOutputRegex = (t: string) => (outputScripts.length ? applyRegexScripts(t, outputScripts, 0, { vars }) : t)
    const processedGreetings = rawGreetings.map(g => applyOutputRegex(substituteVariables(g, vars)))
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
 * 两点行为约束（都是踩过坑后加的，不要去掉）：
 *  1. **防抖**：若每次消息变更都同步序列化整份存档，流式/快速滑动时会高频写盘；
 *     因此默认延迟 500ms 合并，离开页面时用 _flushPersist() 兜底立即写入。
 *  2. **失败可见**：save() 返回 false（最常见原因是本地存储配额超限）时必须提示用户，
 *     不能静默吞掉 —— 否则表现为"聊了半天，重进发现内容没保存"。
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

/**
 * 同步落一份草稿（修复：刷新丢内容）
 *
 * H5 的 sessionStorage 语义恰好合适：**刷新保留、关标签页丢弃**，而且 API 是同步的 ——
 * 这是 beforeunload / pagehide 里唯一来得及完成的写法（IndexedDB 的写入会被浏览器丢弃）。
 * 失败（隐私模式、配额）静默：草稿只是兜底，正式存档仍在走 IndexedDB。
 */
function _writeDraftSync() {
  const card = activeCard.value
  if (!card) return
  try {
    conversationManager.saveDraft({
      cardId: card.id,
      presetId: sessionPresetId.value,
      regexPresetId: sessionRegexPresetId.value,
      personaId: sessionPersonaId.value,
      messages: runtimeStore.messages,
      localVariables: runtimeStore.localVariables,
      worldInfoState: worldInfoState.value,
      trpgState: trpgState.value
    })
  } catch (e) { /* 草稿失败不影响正式存档 */ }
}

/** 立即落盘：离开页面 / 页面卸载 / 关键操作后调用，避免防抖窗口内丢写 */
function _flushPersist() {
  if (_persistTimer) { clearTimeout(_persistTimer); _persistTimer = null }
  _writeDraftSync()
  _persistConversation({ immediate: true })
}

onUnmounted(() => {
  processor.abort()
  _cancelStreamContent()
  // 自动回复：离开页面时必须停掉长按计时与轮次定时器，否则会在已卸载的组件上继续跑
  autoMode.value = false
  _clearHoldTimer()
  _clearAutoTimer()
  _clearScrollTimers()
  _flushPersist()
  // #ifdef H5
  try { window.removeEventListener('beforeunload', _flushPersist) } catch (e) { /* ignore */ }
  try { window.removeEventListener('pagehide', _flushPersist) } catch (e) { /* ignore */ }
  // #endif
})

function onInput(e: any) {
  // 自动回复期间输入框只作为"自动输入中"的提示，不接受编辑
  if (autoMode.value) return
  inputValue.value = e.detail.value
}

// ── 自动回复（长按发送键 3 秒）────────────────────────────────
//
// 玩法（用户定义）：
//   玩家没有输入内容时，发送键是黑色的；长按 3 秒进入自动回复 →
//   发送键闪烁、文字变"自动"，输入框显示"自动输入中"，点击输入框即可退出。
//   期间系统把配置里的文本（默认"继续"）当作玩家发言反复发给大模型，
//   但这条发言在前端**不显示**（消息带 hidden 标记），所以看起来就是
//   "大模型一轮一轮地自己输出"。中途退出后，本次生成结束就停下等玩家手动输入。

function _clearHoldTimer() {
  if (_holdTimer) { clearTimeout(_holdTimer); _holdTimer = null }
}

function _clearAutoTimer() {
  if (_autoTimer) { clearTimeout(_autoTimer); _autoTimer = null }
}

/** 发送键按下：只有在"没有输入内容 + 自动回复已打开"时才开始 3 秒计时 */
function onSendPressStart() {
  if (runtimeStore.isLoading || autoMode.value) return
  if (inputValue.value.trim()) return
  if (!autoReplyCfg.value.enabled) return
  _clearHoldTimer()
  _holdTimer = setTimeout(() => {
    _holdTimer = null
    enterAutoMode()
  }, AUTO_REPLY_HOLD_MS)
}

/** 抬手/滑动取消：没按满 3 秒就什么也不做 */
function onSendPressEnd() {
  _clearHoldTimer()
}

function enterAutoMode() {
  if (autoMode.value) return
  if (!autoReplyCfg.value.enabled) {
    uni.showToast({ title: '请先在「对话设置」里打开自动输入', icon: 'none', duration: 2500 })
    return
  }
  autoMode.value = true
  uni.showToast({ title: '已进入自动回复，点击输入框可退出', icon: 'none', duration: 2200 })
  // 正在生成时不要插队：等这一轮结束后 _requestReply 的 settle 会自动接上下一轮
  if (!runtimeStore.isLoading) _autoStep()
}

/** 退出自动回复：立刻恢复输入框与发送键；正在生成的那一轮会自然跑完，之后不再排下一轮 */
function exitAutoMode() {
  if (!autoMode.value) return
  autoMode.value = false
  _clearAutoTimer()
  uni.showToast({ title: '已退出自动回复', icon: 'none' })
}

/**
 * 自动回复的一轮
 *
 * hidden:true 的那条用户消息是"替身发言"：它进请求上下文、也会入档，
 * 但 MessageItem 不渲染它 —— 这就是"前端只能看到大模型在输出"的实现方式。
 */
async function _autoStep() {
  if (!autoMode.value || runtimeStore.isLoading) return

  const text = autoReplyCfg.value.text
  runtimeStore.appendMessage({ role: 'user', content: text, hidden: true } as ChatMessage)
  runtimeStore.appendMessage({ role: 'assistant', content: '', isStreaming: true, segments: [], swipes: [''], swipe_id: 0 } as ChatMessage)
  const aiIndex = runtimeStore.messages.length - 1
  // 自动回复的每一轮同样置底一次，否则新输出会落在折叠线以下、看着像"没反应"
  _pinToBottomOnce()

  const ok = await new Promise<boolean>((resolve) => {
    _requestReply(aiIndex, text, resolve)
  })

  if (!ok) {
    // 上游失败（已重试 3 次仍失败）：退出自动回复，把控制权还给玩家，
    // 否则会变成"一直报错、一直重试"的死循环。
    exitAutoMode()
    return
  }
  // 用户中途退出了 → 本次生成结束即停，不再排下一轮
  if (!autoMode.value) return

  _clearAutoTimer()
  _autoTimer = setTimeout(() => {
    _autoTimer = null
    _autoStep()
  }, AUTO_REPLY_INTERVAL_MS)
}

/**
 * 对话页面设置键：不再打开模型/API 配置（那些统一放在首页"设置"里配置），
 * 而是直接打开预设编辑页，编辑对象是"本次对话选中的预设"本身——
 * 保证所有生成参数只有一个来源（当前会话预设），不会再有别的东西（旧的全局高级设置滑块等）
 * 悄悄影响到实际生成参数。
 */
function goSettings() {
  const id = _ensureSessionPresetId()
  // 把本次会话选中的正侧 id 也带上：「对话设置」页要在"基础信息"里只读展示当前正侧是哪一个。
  // 没选过时用 SYSTEM_REGEX_PRESET_ID（系统正侧），与实际生效的正侧保持一致。
  const regexId = sessionRegexPresetId.value || SYSTEM_REGEX_PRESET_ID
  uni.navigateTo({
    url: '/pages/presets/edit?id=' + id + '&fromChat=1&regexPresetId=' + encodeURIComponent(regexId)
  })
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
  // 手动停止时同时退出自动回复（正常路径下自动回复中按钮是"自动"，走不到这里，
  // 这是兜底：保证任何情况下"停止"都意味着真的停下来）
  if (autoMode.value) { autoMode.value = false; _clearAutoTimer() }
  // 先把最后一帧增量写进去（停止时不该丢掉最后 ~33ms 的文字），再收尾
  _flushStreamContent()

  const msgs = runtimeStore.messages
  const idx = msgs.length - 1
  const last = msgs[idx]
  if (!last || last.role !== 'assistant' || !last.isStreaming) return

  // 停止时用"上游已到达的完整文本"收尾，避免丢掉还没逐字显示出来的部分（平滑模式）
  const full = _streamTarget.get(idx) || (last.content as string) || ''
  _cancelStreamContent()
  _finalizeMessage(idx, full)
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
    authorsNote: noteStore.config,
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

  // 收尾前先丢弃未冲刷的缓冲，避免过期增量覆盖最终文本；
  // 但**用上游已到达的完整文本**收尾（平滑模式下显示是限速的，不能用显示中的截断文本）
  const m = runtimeStore.messages[aiIndex]
  if (m && m.role === 'assistant') {
    const full = _streamTarget.get(aiIndex) || (m.content as string) || ''
    _cancelStreamContent()
    _finalizeMessage(aiIndex, full)
  } else {
    _cancelStreamContent()
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

/**
 * 把"本轮用户消息 + 空的 AI 占位消息"送进模型，并把流式结果写到 aiIndex 上。
 *
 * 抽成单独函数的原因：手动发送、编辑最近一条用户消息后重新生成、自动回复
 * 这三条路径的参数、错误处理、落盘时机必须完全一致 —— 以前只有 sendUserMessage 一份，
 * 复制出第二份就一定会漂移。
 *
 * @param aiIndex 空 AI 占位消息在 messages 里的下标（它之前的全部消息构成上下文）
 * @param userMessage 本轮要发给模型的用户文本
 * @param onSettled 本轮真正结束（含平滑输出把尾巴播完）后回调；true = 成功，false = 失败/被中断
 */
async function _requestReply(aiIndex: number, userMessage: string, onSettled?: (ok: boolean) => void) {
  let completed = false
  let settled = false
  const settle = (ok: boolean) => {
    if (settled) return
    settled = true
    if (onSettled) onSettled(ok)
  }

  runtimeStore.setLoading(true)
  // 立刻落盘：用户这条消息必须在第一时间进存档（"发完就刷新"不该丢）。
  // 此刻 AI 占位消息是空的，读档时会被 _sanitizeLoadedMessages 丢弃，不会留下空白气泡。
  _persistConversation({ immediate: true })

  const activePresetResolved = _resolvePreset()
  const character = activeCard.value

  await processor.send({
    character: _characterForProcessor(),
    preset: activePresetResolved,
    chatHistory: toChatHistory(runtimeStore.messages.slice(0, aiIndex)),
    userMessage,
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
      completed = true
      // 平滑模式下等剩余文本按节奏释放完再收尾（否则最后一帧会突然补全一大段）
      _scheduleFinalize(aiIndex, finalText, () => {
        runtimeStore.setLoading(false)
        worldInfoState.value = wiState
        _persistConversation()
        settle(true)
      })
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
        // 用户自己那条消息留着（登录回来直接重发），所以这里也要落盘
        _persistConversation({ immediate: true })
        settle(false)
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
      // 错误文案也要进存档，避免"刷新后连报错都没了"
      _persistConversation({ immediate: true })
      settle(false)
    }
  })

  // 走完 processor.send 却既没 onComplete 也没 onError：只可能是被 abort
  // （用户点了停止 / 离开页面）。不兜底的话自动回复的循环会永远挂在等待里。
  if (!completed) settle(false)
}

async function sendUserMessage(text: string) {
  runtimeStore.appendMessage({ role: 'user', content: text })

  const aiMsg: ChatMessage = { role: 'assistant', content: '', isStreaming: true, segments: [], swipes: [''], swipe_id: 0 }
  runtimeStore.appendMessage(aiMsg)
  const aiIndex = runtimeStore.messages.length - 1

  // 发送后置底一次：消息是加在**末尾**的，视口不跟着动的话，用户刚发的那条和
  // 接下来说话的位置都会落在折叠线以下。只在用户主动发送这一下滚一次，
  // 生成期间依然不跟随（那是被刻意移除的机制）。
  _pinToBottomOnce()

  await _requestReply(aiIndex, text)
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
  // 立刻落盘（同 sendUserMessage）：重新生成时旧内容已被清空，必须马上把新状态写进存档
  _persistConversation({ immediate: true })

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
      // 同上：平滑模式下等文本释放完再收尾
      _scheduleFinalize(messageIndex, finalText, () => {
        runtimeStore.setLoading(false)
        worldInfoState.value = wiState
        _persistConversation()
      })
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
      // 失败/中断后同样落盘：否则刷新后会看到一个半截的流式状态
      _persistConversation({ immediate: true })
    }
  })
}

/** 最近一条"玩家可见的"用户消息下标（-1 = 没有）。自动回复插入的 hidden 消息不算。 */
const lastUserMessageIndex = computed(() => {
  const msgs = runtimeStore.messages
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'user' && !msgs[i].hidden) return i
  }
  return -1
})

/**
 * 长按菜单（按用户要求改版）
 *
 *   · 玩家输入的文字：**只能编辑最近的一条**（原来的"删除"整个去掉）；
 *     编辑后模型按编辑后的内容**重新生成回复**。
 *   · LLM 输出的文字：只有**最后一段**能"重新生成"（原「从此处重新生成」改名），
 *     同样不再提供"删除"。
 *   · 没有可执行操作的条目不再弹菜单 —— 弹一个点不动的菜单比不弹更让人困惑。
 */
function onMessageLongPress(idx: number) {
  const msgs = runtimeStore.messages
  const msg = msgs[idx]
  if (!msg || msg.hidden) return
  if (runtimeStore.isLoading) return

  if (msg.role === 'assistant') {
    // 只有最后一段输出可重新生成
    if (idx !== msgs.length - 1) return
    uni.showActionSheet({
      itemList: ['重新生成', '续写'],
      success(res: any) {
        if (res.tapIndex === 0) regenerateSwipe(idx)
        else if (res.tapIndex === 1) handleContinue()
      }
    })
    return
  }

  if (msg.role !== 'user') return
  // 用户消息：只允许编辑"最近的一条"
  if (lastUserMessageIndex.value !== idx) return
  uni.showActionSheet({
    itemList: ['编辑'],
    success(res: any) {
      if (res.tapIndex === 0) editLastUserMessage(idx)
    }
  })
}

/**
 * 编辑最近一条用户消息，并**按编辑后的内容重新生成回复**
 *
 * 为什么必须丢掉后面的内容：这条用户消息之后的 AI 回复是基于**旧文案**生成的，
 * 留在上下文里会让模型看到一段"答非所问"的历史，并且它们已经被存档 ——
 * 所以这里直接截断到编辑的这一条，再走一次正常的生成流程。
 */
function editLastUserMessage(idx: number) {
  const msg = runtimeStore.messages[idx]
  if (!msg || msg.role !== 'user') return
  uni.showModal({
    title: '编辑消息',
    editable: true,
    content: msg.content,
    success: (res: any) => {
      if (!res.confirm || typeof res.content !== 'string') return
      const text = res.content.trim()
      if (!text) {
        uni.showToast({ title: '内容不能为空', icon: 'none' })
        return
      }
      if (text === msg.content) return

      const msgs = [...runtimeStore.messages]
      msgs[idx] = { ...msgs[idx], content: text }
      // 截断：这条之后的旧回复全部作废
      msgs.length = idx + 1
      runtimeStore.setMessages(msgs)

      runtimeStore.appendMessage({ role: 'assistant', content: '', isStreaming: true, segments: [], swipes: [''], swipe_id: 0 } as ChatMessage)
      const aiIndex = runtimeStore.messages.length - 1
      // 截断后页面变短、新回复又加在末尾：置底一次让用户看到重新生成的起点
      _pinToBottomOnce()
      _requestReply(aiIndex, text)
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
.input-wrapper { flex: 1; display: flex; align-items: center; gap: 8px; position: relative; }
.chat-input { flex: 1; height: 40px; background: var(--surface); border: 1px solid var(--border); border-radius: 20px; padding: 0 16px; font-size: 13px; color: var(--fg); }
/* 自动回复期间盖在输入框上的透明层：点一下即退出（disabled 的 input 收不到点击事件） */
.auto-overlay {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  right: calc(56px + 8px);
  z-index: 3;
  border-radius: 20px;
}
.send-button {
  width: 56px; height: 40px; border-radius: 20px; display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, var(--accent), var(--accent-strong));
  box-shadow: 0 8px 18px -8px oklch(75% 0.14 80 / 0.6);
}
/* 玩家没有输入内容时发送键是**黑色**的（用户要求）：保留一圈边框以免整块"消失"在深色背景里 */
.send-button-disabled {
  background: #000;
  border: 1px solid var(--border);
  box-shadow: none;
}
.send-button-disabled .send-text { color: var(--faint); }
.stop-button { background: linear-gradient(135deg, oklch(68% 0.17 26), oklch(56% 0.18 24)); box-shadow: none; }
/* 自动回复中：发送键闪烁、文字为"自动" */
.auto-button {
  background: linear-gradient(135deg, oklch(72% 0.13 150), oklch(58% 0.13 160));
  box-shadow: none;
  animation: autoBlink 1s ease-in-out infinite;
}
@keyframes autoBlink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
.send-text { font-size: 12px; font-weight: 700; color: #171104; }
.stop-button .send-text { color: var(--fg); }
</style>