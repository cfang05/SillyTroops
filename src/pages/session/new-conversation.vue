<template>
  <view class="new-conv">
    <!-- 顶部导航：左返回 / 中标题 / 右空占位（沉浸式流程页，无底部导航栏） -->
    <NavBar title="开始冒险" />

    <scroll-view class="body" scroll-y :style="{ paddingTop: (navBarHeight + 16) + 'px' }">
      <!-- ① 故事卡：整卡可点 → 选卡弹窗 -->
      <view class="hero" @tap="openDialog('card')">
        <view class="hero-top">
          <view class="hero-icon">
            <image v-if="heroAvatar" class="hero-icon-img" :src="heroAvatar" mode="aspectFill" />
            <svg v-else viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6" /><path d="M13.5 3.5l4 4-2 2-4-4 2-2z" /><path d="M15.5 5.5l2.5-2.5" /><path d="M8.5 11.5l3 3-4.5 1.5 1.5-4.5z" /></svg>
          </view>
          <view class="hero-titles">
            <text class="hero-name">{{ heroName }}</text>
            <text class="hero-sub">{{ heroSub }}</text>
          </view>
          <text class="hero-switch">更换 ›</text>
        </view>
        <text class="hero-desc">{{ heroDesc }}</text>
      </view>

      <!-- ② 三个功能配置框（横排三列） -->
      <view class="chips">
        <view class="chip" style="--tc: var(--t-emerald)" @tap="goApiSettings">
          <view class="chip-icon">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2.5L5 11h4l-1 6.5L15 9h-4l1-6.5z" /></svg>
          </view>
          <text class="chip-title">API 检查</text>
          <text class="chip-sub">{{ apiLabel }}</text>
        </view>

        <view class="chip" style="--tc: var(--t-gold)" @tap="openDialog('preset')">
          <view class="chip-icon">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2.8h5l3.2 3.2v11.2H6z" /><path d="M11 2.8V6h3.2" /></svg>
          </view>
          <text class="chip-title">预设配置</text>
          <text class="chip-sub">{{ selectedPresetLabel }}</text>
        </view>

        <view class="chip" style="--tc: var(--t-violet)" @tap="openDialog('regex')">
          <view class="chip-icon">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5h12M4 10h12M4 14.5h8" /></svg>
          </view>
          <text class="chip-title">正侧配置</text>
          <text class="chip-sub">{{ selectedRegexLabel }}</text>
        </view>
      </view>
      <!-- D15：一旦选了别的正侧文件，系统正侧是**被替换**（不叠加），这里明确提示 -->
      <text v-if="regexReplacedHint" class="chips-hint">已改用你自己的正侧文件：系统正侧（台词识别等）将不再生效。</text>

      <!-- ③ 出发清单 -->
      <view class="list-title">
        <text class="list-title-text">出发清单</text>
        <text class="list-title-progress">{{ checklistDone }} / {{ checklist.length }} 完成</text>
      </view>

      <view
        v-for="(item, index) in checklist"
        :key="item.key"
        :class="['step', item.done ? 'done' : 'pending']"
        @tap="onChecklistTap(item)"
      >
        <view class="step-idx">
          <text class="step-num">{{ index + 1 }}</text>
          <svg class="step-chk" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5l5 5 10-11" /></svg>
        </view>
        <view class="step-txt">
          <text class="step-name">{{ item.title }}</text>
          <text class="step-desc">{{ item.desc }}</text>
        </view>
        <view class="step-icon" :style="{ '--tc': item.tone }">
          <svg v-if="item.icon === 'persona'" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="7" r="3" /><path d="M4 17c0-3 2.7-5 6-5s6 2 6 5" /></svg>
          <svg v-else-if="item.icon === 'partner'" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.6" cy="7.8" r="2.6" /><path d="M2.6 16.6c0-2.6 2.2-4.4 5-4.4s5 1.8 5 4.4" /><path d="M13.6 5.6a2.5 2.5 0 0 1 1 4.7" /><path d="M14.2 12.4c2 .3 3.2 1.8 3.2 3.8" /></svg>
          <svg v-else-if="item.icon === 'item'" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.6 7.4h10.8l-1 9H5.6l-1-9z" /><path d="M7.6 7.4V5.8a2.4 2.4 0 0 1 4.8 0v1.6" /></svg>
          <svg v-else viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.2l1.9 3.9 4.3.6-3.1 3 .7 4.3L10 12.9 6.2 15l.7-4.3-3.1-3 4.3-.6L10 3.2z" /></svg>
        </view>
      </view>
    </scroll-view>

    <!-- ④ 固定底部主按钮：金色渐变，悬浮在内容之上 -->
    <view class="cta-wrap">
      <view class="cta" :class="{ 'is-disabled': !canStart }" @tap="onStartTap">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6" /><path d="M13.5 3.5l4 4-2 2-4-4 2-2z" /><path d="M15.5 5.5l2.5-2.5" /><path d="M8.5 11.5l3 3-4.5 1.5 1.5-4.5z" /></svg>
        <text class="cta-text">开始冒险</text>
      </view>
    </view>

    <!-- 弹窗一：选择角色卡（沿用原"选择角色卡"页的卡片网格展示） -->
    <DialogShell :visible="dialog === 'card'" title="选择角色卡" @close="closeDialog">
      <view v-if="cardStore.cards.length === 0" class="dlg-empty">
        <text class="dlg-empty-text">还没有角色卡</text>
        <view class="dlg-empty-btn" @tap="goImport"><text class="dlg-empty-btn-text">去导入</text></view>
      </view>
      <view v-else class="card-grid">
        <view
          v-for="card in cardStore.cards"
          :key="card.id"
          :class="['card-item', selectedCardId === card.id ? 'selected' : '']"
          @tap="pickCard(card.id)"
        >
          <view class="card-avatar">
            <image v-if="card.avatar" class="card-avatar-img" :src="card.avatar" mode="aspectFill" />
            <text v-else class="card-avatar-text">{{ (card.name || '?').charAt(0) }}</text>
          </view>
          <text class="card-name">{{ card.name }}</text>
          <!-- 从卡池导入的卡片，24 小时内标「新导入」（与角色卡库同一套判定） -->
          <text v-if="cardStore.isNewImport(card)" class="card-new-badge">新导入</text>
          <text class="card-desc">{{ card.description || card.personality || '暂无描述' }}</text>
          <view v-if="selectedCardId === card.id" class="card-check">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 10.5l3.5 3.5 7.5-8" /></svg>
          </view>
        </view>
      </view>
    </DialogShell>

    <!-- 弹窗二：预设配置 -->
    <DialogShell :visible="dialog === 'preset'" title="选择预设" @close="closeDialog">
      <view
        v-for="opt in presetOptions"
        :key="opt.id || 'none'"
        :class="['opt-item', selectedPresetId === opt.id ? 'active' : '']"
        @tap="pickPreset(opt.id)"
      >
        <view class="opt-main">
          <text class="opt-name">{{ opt.label }}</text>
          <text class="opt-sub">{{ opt.sub }}</text>
        </view>
        <view class="opt-check">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 10.5l3.5 3.5 7.5-8" /></svg>
        </view>
      </view>
    </DialogShell>

    <!-- 弹窗三：正侧配置 -->
    <DialogShell :visible="dialog === 'regex'" title="选择正侧" @close="closeDialog">
      <view
        v-for="opt in regexOptions"
        :key="opt.id || 'none'"
        :class="['opt-item', selectedRegexPresetId === opt.id ? 'active' : '']"
        @tap="pickRegex(opt.id)"
      >
        <view class="opt-main">
          <text class="opt-name">{{ opt.label }}</text>
          <text class="opt-sub">{{ opt.sub }}</text>
        </view>
        <view class="opt-check">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 10.5l3.5 3.5 7.5-8" /></svg>
        </view>
      </view>
    </DialogShell>
  </view>
</template>

<script setup lang="ts">
/**
 * 新建对话（单页整合版）
 *
 * 改造前：step1 选卡网格 → step2「确认对话设置」（两个原生 picker）→ 出发。
 * 改造后：一屏完成「选卡（弹窗）→ 检查 API → 选预设（弹窗）→ 选正侧（弹窗）→ 出发」，
 * 视觉对齐 notes/wuxian-lvtuan-core-pages.html 的 PHONE_06（暗金奇幻风）。
 *
 * 关键保留项（不要动）：
 *   · 登录守卫；四个 store 的加载；「系统预设」/「系统正侧」默认选中；
 *   · D15 提示（选了别的正侧 → 系统正侧被替换而非叠加）；
 *   · 出发逻辑：init → has() → 二次确认清空 → clear() 完成后 redirectTo（参数拼装同改造前）；
 *   · 本页选择的预设/正侧**只作用于本次对话**（不写 presetStore.setActive）。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useCharacterCardStore } from '../../stores/characterCardStore'
import { usePresetStore } from '../../stores/presetStore'
import { useRegexPresetStore } from '../../stores/regexPresetStore'
import { usePersonaStore } from '../../stores/personaStore'
import { getNavBarHeight } from '../../utils/navbar.js'
import NavBar from '../../components/common/NavBar.vue'
import DialogShell from '../../components/common/DialogShell.vue'
import { SYSTEM_PRESET_ID } from '../../adapters/preset/defaultPreset'
import { SYSTEM_REGEX_PRESET_ID } from '../../engine/systemRegex'
// @ts-ignore
import storage from '../../utils/storage.js'
// @ts-ignore
import { scopedKey } from '../../utils/account/userScope.js'
// @ts-ignore
import userManager from '../../utils/account/userManager.js'
// @ts-ignore
import conversationManager from '../../utils/account/conversationManager.js'

const cardStore = useCharacterCardStore()
const presetStore = usePresetStore()
const regexPresetStore = useRegexPresetStore()
const personaStore = usePersonaStore()

const navBarHeight = ref(0)
/** 当前打开的弹窗：'' | 'card' | 'preset' | 'regex' */
const dialog = ref<'' | 'card' | 'preset' | 'regex'>('')
const selectedCardId = ref('')
const selectedPresetId = ref('')
const selectedRegexPresetId = ref('')
const convMeta = ref<{ has: boolean; updatedAt: number }>({ has: false, updatedAt: 0 })
const apiLabel = ref('未配置')
/** 页面初始化完成（onShow 里的刷新要在它之后才有意义） */
let _ready = false

// ── 故事卡 ────────────────────────────────────────────────
const selectedCard = computed(() => (selectedCardId.value ? cardStore.getById(selectedCardId.value) : null))
const heroAvatar = computed(() => (selectedCard.value as any)?.avatar || '')
const heroName = computed(() => selectedCard.value?.name || '还没有角色卡')
const heroSub = computed(() => {
  if (!selectedCard.value) return '请先导入一张角色卡'
  return convMeta.value.has ? '继续对话 · 上次更新 ' + formatTime(convMeta.value.updatedAt) : '新对话 · 准备好出发'
})
const heroDesc = computed(() => {
  const card: any = selectedCard.value
  if (!card) return '前往「角色卡库 - 酒馆导入」导入一张角色卡，就能开始你的第一段冒险。'
  const raw = String(card.description || '').trim() || String(card.first_mes || '').trim()
  return _plainText(raw) || '这张角色卡还没有写简介。'
})

// ── 配置框 ────────────────────────────────────────────────
// 文件导入名（fileName）优先于内部 name 展示，让用户认得自己导入的是哪个文件
const presetOptions = computed(() => [
  { id: '', label: '（不使用预设）', sub: '本次对话不加载任何预设提示词' },
  ...presetStore.presets.map((p: any) => ({ id: p.id, label: p.fileName || p.name, sub: _presetSub(p) }))
])
const regexOptions = computed(() => [
  { id: '', label: '（不使用正侧）', sub: '本次对话不加载正侧正则（台词识别等）' },
  ...regexPresetStore.presets.map((p: any) => ({ id: p.id, label: p.fileName || p.name, sub: _regexSub(p) }))
])
const selectedPresetLabel = computed(() => presetOptions.value.find(o => o.id === selectedPresetId.value)?.label || '系统预设')
const selectedRegexLabel = computed(() => regexOptions.value.find(o => o.id === selectedRegexPresetId.value)?.label || '系统正侧')

/** 当前选中的不是系统正侧时给出提示（D15：系统正侧会被替换而非叠加） */
const regexReplacedHint = computed(() => {
  const id = selectedRegexPresetId.value || ''
  return !!id && id !== SYSTEM_REGEX_PRESET_ID
})

// ── 出发清单（只有「登场角色」是真实功能，其余三项为后续扩展占位）──
const checklist = computed(() => {
  const persona: any = personaStore.activePersona
  return [
    {
      key: 'persona',
      icon: 'persona',
      tone: 'var(--t-emerald)',
      title: '登场角色',
      desc: persona ? persona.name + ' · Persona' : '点击选择本次出场的身份',
      done: !!persona,
      action: 'persona'
    },
    { key: 'partner', icon: 'partner', tone: 'var(--t-gold)', title: '冒险伙伴', desc: '选择一起冒险的旅团伙伴', done: true, action: 'todo' },
    { key: 'item', icon: 'item', tone: 'var(--t-violet)', title: '携带物品', desc: '整理本次冒险随身携带的行囊', done: true, action: 'todo' },
    { key: 'trait', icon: 'trait', tone: 'var(--t-teal)', title: '人物特性', desc: '配置本次冒险生效的人物特性', done: true, action: 'todo' }
  ]
})
const checklistDone = computed(() => checklist.value.filter(i => i.done).length)

const canStart = computed(() => !!selectedCard.value && !!personaStore.activePersonaId)

// ── 生命周期 ──────────────────────────────────────────────
onMounted(async () => {
  // 需要登录：未登录会被 reLaunch 到登录页（守卫实现在 App.vue 的 checkUserLogin）。
  // 本页初始化写在 onMounted 里，守卫放这里第一行，保证未登录时不会白跑下面的 store 加载。
  if (!getApp().checkUserLogin()) return
  navBarHeight.value = getNavBarHeight().navBarHeight

  cardStore.loadAll()
  presetStore.load()
  regexPresetStore.load()
  personaStore.load()
  _loadApiState()

  // D19 / D15：「系统预设」「系统正侧」默认选中（必须在 load() 之后判断）
  if (presetOptions.value.some(o => o.id === SYSTEM_PRESET_ID)) selectedPresetId.value = SYSTEM_PRESET_ID
  if (regexOptions.value.some(o => o.id === SYSTEM_REGEX_PRESET_ID)) selectedRegexPresetId.value = SYSTEM_REGEX_PRESET_ID

  _pickDefaultCard()

  // 刷新页面时第一帧 IndexedDB 还没 hydrate 完，此刻 cards 可能还是空的：
  // 等就绪后再选一次默认卡，否则首屏会显示"还没有角色卡"。
  await cardStore.ensureLoaded()
  _pickDefaultCard()
  await _refreshConvMeta()

  _ready = true
})

onShow(() => {
  if (!_ready) return
  // 从 persona 管理页 / 设置页 / 导入页返回时刷新：清单状态、API 文案、卡片列表
  try {
    personaStore.load()
    _loadApiState()
    cardStore.loadAll()
    _pickDefaultCard()
    _refreshConvMeta()
  } catch (e) { /* 刷新失败不影响页面 */ }
})

onUnmounted(() => closeDialog())

// ── 数据加载 ──────────────────────────────────────────────
/** 默认选中：优先"当前激活角色卡"，其次第一张；已选中的卡若还存在则保持不变 */
function _pickDefaultCard() {
  const ids = cardStore.cards.map(c => c.id)
  if (selectedCardId.value && ids.indexOf(selectedCardId.value) !== -1) return
  const active = cardStore.activeCardId || ''
  selectedCardId.value = (active && ids.indexOf(active) !== -1) ? active : (ids[0] || '')
}

/** 该卡是否有历史对话（决定故事卡副标题是"继续对话"还是"新对话"） */
async function _refreshConvMeta() {
  const id = selectedCardId.value
  if (!id) {
    convMeta.value = { has: false, updatedAt: 0 }
    return
  }
  try {
    await conversationManager.init()
    const item = conversationManager.getList().find((i: any) => i && i.cardId === id)
    convMeta.value = item ? { has: true, updatedAt: Number(item.updatedAt) || 0 } : { has: false, updatedAt: 0 }
  } catch (e) {
    convMeta.value = { has: false, updatedAt: 0 }
  }
}

/**
 * API 状态文案（与设置页同一份配置：scopedKey('ai_model_settings')）
 *   · test   → 内置测试接口，需要账号有测试权限；
 *   · default→ 小程序内置模型，无需 Key；
 *   · 其余   → 必须填了 API Key 才算配置完成。
 */
function _loadApiState() {
  try {
    const s: any = storage.get(scopedKey('ai_model_settings'))
    let isTest = false
    try { isTest = !!userManager.isTestAccount() } catch (e) { isTest = false }
    const model = String((s && s.model) || (isTest ? 'test' : 'hunyuan'))
    let ok = false
    if (model === 'test') ok = isTest
    else if (model === 'default') ok = true
    else ok = !!(s && s.apiKey)
    apiLabel.value = ok ? '模型连接正常' : '未配置'
  } catch (e) {
    apiLabel.value = '未配置'
  }
}

// ── 弹窗 ──────────────────────────────────────────────────
let _closeTimer: ReturnType<typeof setTimeout> | null = null

function openDialog(which: 'card' | 'preset' | 'regex') {
  if (_closeTimer) { clearTimeout(_closeTimer); _closeTimer = null }
  dialog.value = which
}

function closeDialog() {
  if (_closeTimer) { clearTimeout(_closeTimer); _closeTimer = null }
  dialog.value = ''
}

/** 选中后先高亮 180ms 再自动关闭，让用户看清自己选了什么 */
function _pickThenClose(pick: () => void) {
  pick()
  if (_closeTimer) clearTimeout(_closeTimer)
  _closeTimer = setTimeout(() => { dialog.value = ''; _closeTimer = null }, 180)
}

function pickCard(id: string) {
  _pickThenClose(() => {
    selectedCardId.value = id
    _refreshConvMeta()
  })
}

function pickPreset(id: string) {
  // 只作用于本次对话（不写 presetStore.setActive）
  _pickThenClose(() => { selectedPresetId.value = id })
}

function pickRegex(id: string) {
  _pickThenClose(() => { selectedRegexPresetId.value = id })
}

// ── 跳转 ──────────────────────────────────────────────────
function goApiSettings() {
  uni.navigateTo({ url: '/pages/settings/settings' })
}

function goImport() {
  uni.navigateTo({ url: '/pages/import/import' })
}

function onChecklistTap(item: { action: string }) {
  if (item.action === 'persona') {
    // 去 persona 管理页改变出场身份（本页不提供 persona 编辑，避免两处入口）
    uni.navigateTo({ url: '/pages/persona/index' })
    return
  }
  // 其余三项为占位（功能开发中），点击只给提示
  uni.showToast({ title: '功能开发中', icon: 'none' })
}

function onStartTap() {
  if (!selectedCard.value) {
    uni.showToast({ title: '还没有角色卡，请先导入', icon: 'none' })
    return
  }
  if (!canStart.value) {
    uni.showToast({ title: '请做好冒险前的准备', icon: 'none' })
    return
  }
  onStartChat()
}

// ── 出发（逻辑与改造前一致，只换了取值的来源）──────────────
async function onStartChat() {
  const cardId = selectedCardId.value
  const presetId = selectedPresetId.value || ''
  const regexPresetId = selectedRegexPresetId.value || ''
  // Persona 不在本页选择，统一使用当前出场角色（personaStore.activePersonaId）
  const personaId = personaStore.activePersonaId || ''

  // P5.2：对话存档已迁到 IndexedDB（异步）。先 init 一次，has()/clear() 才准确。
  await conversationManager.init()
  const hasExisting = conversationManager.has(cardId)
  if (hasExisting) {
    uni.showModal({
      title: '该角色已有对话记录',
      content: '开始新对话将清空原有记录，是否继续？',
      success: (res: any) => {
        if (res.confirm) {
          // 清空是异步的：**等清空完成再进聊天页**，否则聊天页可能读到还没删掉的旧档
          Promise.resolve(conversationManager.clear(cardId)).then(() => {
            _navigateToChat(cardId, presetId, regexPresetId, personaId)
          })
        }
      }
    })
  } else {
    _navigateToChat(cardId, presetId, regexPresetId, personaId)
  }
}

function _navigateToChat(cardId: string, presetId: string, regexPresetId: string, personaId: string) {
  // 点「开始冒险」= 明确要开一段新对话：把该卡的**同步草稿**也清掉。
  // 否则一旦存档已被删除而草稿还在（比如刚在会话页删过这个对话），
  // chat 页会把草稿当成"已有内容"恢复出来，看起来像清空没生效。
  conversationManager.clearDraft(cardId)
  const params = [
    'cardId=' + cardId,
    'mode=new',
    presetId ? 'presetId=' + presetId : '',
    regexPresetId ? 'regexPresetId=' + regexPresetId : '',
    personaId ? 'personaId=' + personaId : ''
  ].filter(Boolean).join('&')
  uni.redirectTo({ url: '/pages/chat/chat?' + params })
}

// ── 文案工具 ──────────────────────────────────────────────
/** 去掉宏与 HTML 标签，把简介压成一行纯文本（避免把 {{char}} 直接显示给用户） */
function _plainText(raw: string): string {
  return String(raw || '')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function _presetSub(p: any): string {
  if (!p) return ''
  if (p.id === SYSTEM_PRESET_ID) return '内置 · 默认选中，开箱即用'
  const n = Array.isArray(p.prompts) ? p.prompts.length : 0
  const r = Array.isArray(p.regexScripts) ? p.regexScripts.length : 0
  return n + ' 条提示词' + (r ? ' · ' + r + ' 条正则' : '')
}

function _regexSub(p: any): string {
  if (!p) return ''
  if (p.id === SYSTEM_REGEX_PRESET_ID) return '内置 · 台词识别等默认规则'
  const n = Array.isArray(p.scripts) ? p.scripts.length : 0
  return n + ' 条规则' + (p.enabledGlobal ? ' · 全局启用' : '')
}

function formatTime(ts: number): string {
  if (!ts) return ''
  const date = new Date(ts)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000))
  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (diffDays < 7) return diffDays + ' 天前'
  return date.toLocaleDateString('zh-CN')
}
</script>

<style scoped>
.new-conv { display: flex; flex-direction: column; height: 100vh; background: var(--bg-deep); box-sizing: border-box; }
/* 滚动区：paddingTop 由模板按导航栏高度动态给（这里不写 top，避免被覆盖后失效） */
.body { flex: 1; min-height: 0; padding: 0 30rpx 24rpx; box-sizing: border-box; }

/* ── ① 故事卡（对齐 notes 稿 .sess-hero）────────────────── */
.hero {
  position: relative;
  overflow: hidden;
  padding: 28rpx 30rpx 26rpx;
  margin-bottom: 24rpx;
  border-radius: 36rpx;
  border: 1rpx solid oklch(80% 0.13 84 / 0.38);
  background: linear-gradient(165deg, oklch(30% 0.07 80), oklch(20% 0.045 80) 58%, oklch(16% 0.03 70));
}
.hero::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: radial-gradient(440rpx 300rpx at 88% -44rpx, oklch(75% 0.14 82 / 0.3), transparent 70%);
  pointer-events: none;
}
.hero-top { position: relative; display: flex; align-items: center; gap: 22rpx; margin-bottom: 18rpx; }
.hero-icon {
  width: 84rpx; height: 84rpx; flex: none; border-radius: 26rpx; overflow: hidden;
  background: linear-gradient(160deg, oklch(78% 0.13 82), oklch(64% 0.13 70));
  border: 1rpx solid oklch(85% 0.1 84 / 0.5);
  box-shadow: 0 0 40rpx -12rpx oklch(75% 0.14 80 / 0.6);
  display: flex; align-items: center; justify-content: center;
}
.hero-icon svg { width: 40rpx; height: 40rpx; color: #1b1204; }
.hero-icon-img { width: 100%; height: 100%; }
.hero-titles { flex: 1; min-width: 0; }
.hero-name {
  display: block;
  font-family: var(--font-serif); font-size: 36rpx; font-weight: 900; color: var(--fg);
  line-height: 1.2; margin-bottom: 6rpx;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.hero-sub { display: block; font-size: 20rpx; color: oklch(88% 0.04 80 / 0.85); }
.hero-switch { flex: none; font-size: 20rpx; color: var(--accent); font-weight: 700; }
.hero-desc {
  position: relative;
  font-size: 21rpx; color: oklch(90% 0.02 80 / 0.9); line-height: 1.55;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden;
}

/* ── ② 三个配置框（对齐 notes 稿 .equip-row / .equip-chip）── */
.chips { display: flex; gap: 16rpx; margin-bottom: 12rpx; }
.chip {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column; align-items: center; gap: 12rpx;
  padding: 20rpx 12rpx;
  border-radius: 28rpx;
  background: var(--surface);
  border: 1rpx solid var(--border);
  text-align: center;
  transition: border-color 0.2s ease;
}
.chip:active { border-color: color-mix(in oklch, var(--tc) 50%, var(--border)); }
.chip-icon {
  width: 52rpx; height: 52rpx; flex: none; border-radius: 18rpx;
  display: flex; align-items: center; justify-content: center;
  background: color-mix(in oklch, var(--tc) 16%, transparent);
  color: var(--tc);
}
.chip-icon svg { width: 28rpx; height: 28rpx; }
.chip-title { font-size: 21rpx; color: var(--fg); font-weight: 700; }
.chip-sub {
  font-family: var(--font-mono); font-size: 17rpx; color: var(--faint);
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.chips-hint { display: block; margin: 0 0 10rpx; font-size: 19rpx; color: var(--t-gold); line-height: 1.5; }

/* ── ③ 出发清单（对齐 notes 稿 .steps-title / .step）────── */
.list-title { display: flex; justify-content: space-between; align-items: baseline; margin: 14rpx 0 18rpx; }
.list-title-text { font-size: 26rpx; font-weight: 700; color: var(--fg); }
.list-title-progress { font-family: var(--font-mono); font-size: 18rpx; color: var(--faint); letter-spacing: .06em; }

.step {
  display: flex; align-items: center; gap: 20rpx;
  padding: 20rpx 24rpx;
  margin-bottom: 16rpx;
  border-radius: 28rpx;
  background: var(--surface);
  border: 1rpx solid var(--border);
  transition: border-color 0.2s ease;
}
.step:active { border-color: var(--border-strong); }
.step-idx {
  width: 50rpx; height: 50rpx; flex: none; border-radius: 18rpx;
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-mono); font-size: 22rpx; font-weight: 700;
}
.step-idx svg { width: 26rpx; height: 26rpx; }
.step-chk { display: none; }
.step-txt { flex: 1; min-width: 0; }
.step-name { display: block; font-size: 24rpx; font-weight: 700; color: var(--fg); }
.step-desc { display: block; font-size: 19rpx; color: var(--faint); margin-top: 4rpx; }
.step-icon {
  width: 52rpx; height: 52rpx; flex: none; border-radius: 18rpx;
  display: flex; align-items: center; justify-content: center;
  background: color-mix(in oklch, var(--tc) 14%, transparent);
  color: var(--tc);
}
.step-icon svg { width: 28rpx; height: 28rpx; }

/* 已完成：绿边 + 绿勾 */
.step.done { border-color: oklch(74% 0.14 152 / 0.38); }
.step.done .step-idx { background: color-mix(in oklch, var(--success) 17%, transparent); color: var(--success); }
.step.done .step-num { display: none; }
.step.done .step-chk { display: block; }
.step.done .step-desc { color: color-mix(in oklch, var(--success) 82%, var(--muted)); }
/* 待完成：虚线金框 + 序号 */
.step.pending .step-idx { background: var(--surface-2); color: var(--accent); border: 1rpx dashed oklch(80% 0.13 84 / 0.5); }

/* ── ④ 固定底部主按钮 ───────────────────────────────────── */
.cta-wrap {
  flex: none;
  padding: 18rpx 30rpx;
  padding-bottom: calc(18rpx + env(safe-area-inset-bottom));
  background: linear-gradient(180deg, oklch(18% 0.013 70 / 0.55), oklch(18% 0.013 70 / 0.96) 40%);
  border-top: 1rpx solid var(--border);
}
.cta {
  height: 96rpx;
  display: flex; align-items: center; justify-content: center; gap: 14rpx;
  border-radius: 48rpx;
  background: linear-gradient(160deg, var(--accent), var(--accent-strong));
  box-shadow: 0 26rpx 56rpx -22rpx oklch(75% 0.14 80 / 0.7), inset 0 2rpx 0 oklch(100% 0 0 / 0.35);
  transition: transform 0.15s ease, filter 0.15s ease;
}
.cta:active { transform: scale(0.985); filter: brightness(1.06); }
.cta svg { width: 30rpx; height: 30rpx; color: #171104; }
.cta-text { font-size: 28rpx; font-weight: 900; color: #171104; letter-spacing: .04em; }
/* 未选出场身份：灰化禁用（点击仍由外层处理，弹"请做好冒险前的准备"） */
.cta.is-disabled {
  background: var(--raised);
  box-shadow: none;
  opacity: .55;
}
.cta.is-disabled .cta-text, .cta.is-disabled svg { color: var(--faint); }

/* ── 弹窗内容：角色卡网格 ───────────────────────────────── */
.dlg-empty { padding: 60rpx 20rpx; text-align: center; }
.dlg-empty-text { display: block; font-size: 23rpx; color: var(--faint); margin-bottom: 24rpx; }
.dlg-empty-btn {
  display: inline-block; padding: 14rpx 34rpx;
  background: var(--accent-soft); border: 1rpx solid var(--accent); border-radius: 999rpx;
}
.dlg-empty-btn-text { font-size: 22rpx; color: var(--accent); font-weight: 700; }

.card-grid { display: flex; flex-wrap: wrap; gap: 16rpx; }
.card-item {
  position: relative; width: calc(50% - 8rpx); height: 280rpx; padding: 20rpx;
  background: var(--surface); border-radius: 22rpx; border: 1rpx solid var(--border);
  display: flex; flex-direction: column; align-items: center; text-align: center;
  box-sizing: border-box; overflow: hidden;
  transition: border-color 0.2s ease, background 0.2s ease;
}
.card-item.selected { border-color: var(--accent); background: var(--accent-soft); }
.card-avatar {
  width: 96rpx; height: 96rpx; border-radius: 24rpx; flex-shrink: 0; margin-bottom: 12rpx; overflow: hidden;
  background: linear-gradient(160deg, oklch(68% 0.16 40), oklch(46% 0.12 20));
  border: 1rpx solid oklch(80% 0.1 45 / 0.5);
  display: flex; align-items: center; justify-content: center;
}
.card-avatar-img { width: 100%; height: 100%; }
.card-avatar-text { font-family: var(--font-serif); font-size: 34rpx; color: #1b0b05; font-weight: 900; }
.card-name {
  font-size: 24rpx; color: var(--fg); font-weight: 700; margin-bottom: 6rpx; width: 100%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0;
}
/* 「新导入」标识：与角色卡库同一套判定（utils/character_card/poolImport.js），24 小时后消失 */
.card-new-badge {
  align-self: flex-start; flex-shrink: 0; margin-bottom: 6rpx;
  font-size: 17rpx; font-weight: 700; color: var(--success);
  background: color-mix(in oklch, var(--success) 16%, transparent);
  border: 1rpx solid color-mix(in oklch, var(--success) 40%, transparent);
  padding: 2rpx 10rpx; border-radius: 8rpx;
}
.card-desc {
  font-size: 19rpx; color: var(--faint); width: 100%; flex: 1;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden;
  line-height: 1.45;
}
.card-check {
  position: absolute; top: 10rpx; right: 10rpx; width: 34rpx; height: 34rpx; border-radius: 50%;
  background: var(--accent); color: #171104; display: flex; align-items: center; justify-content: center;
}
.card-check svg { width: 18rpx; height: 18rpx; }

/* ── 弹窗内容：预设 / 正侧列表 ─────────────────────────── */
.opt-item {
  display: flex; align-items: center; gap: 18rpx;
  padding: 20rpx 22rpx; margin-bottom: 14rpx;
  border-radius: 22rpx;
  background: var(--surface);
  border: 1rpx solid var(--border);
  transition: border-color 0.15s ease, background 0.15s ease;
}
.opt-item.active { border-color: var(--accent); background: var(--accent-soft); }
.opt-main { flex: 1; min-width: 0; }
.opt-name {
  display: block; font-size: 24rpx; font-weight: 700; color: var(--fg);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.opt-sub {
  display: block; font-size: 18rpx; color: var(--faint); margin-top: 5rpx;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* 高亮项：金色文字（与金色边框一起构成"已选中"的视觉） */
.opt-item.active .opt-name { color: var(--accent); }
.opt-item.active .opt-sub { color: color-mix(in oklch, var(--accent) 70%, var(--muted)); }
.opt-check { width: 34rpx; height: 34rpx; flex: none; color: var(--accent); opacity: 0; }
.opt-check svg { width: 30rpx; height: 30rpx; }
.opt-item.active .opt-check { opacity: 1; }
</style>
