<template>
  <view class="edit-container">
    <NavBar title="编辑预设" :subtitle="form.name || '未命名预设'" />
    <scroll-view class="edit-scroll" scroll-y :style="{ paddingTop: (navBarHeight + 16) + 'px' }">
      <view class="section">
        <text class="section-title">基础信息</text>
        <view class="form-item">
          <text class="label">预设名称</text>
          <!-- 需求：从对话页面设置进入时（fromChat=1），预设名称只展示不可编辑，
               避免在对话中随手改了预设名字，导致预设列表里认不出这是哪个预设。 -->
          <input v-if="!readonlyName" class="input" :value="form.name" @input="onNameInput" />
          <view v-else class="input readonly-input"><text>{{ form.name || '(未命名预设)' }}</text></view>
        </view>
      </view>

      <!-- 渲染开关 / 功能模块开关：仅在从对话页面设置进入时显示（fromChat=1），
           独立编辑预设时（从"酒馆导入"页进入）不需要这些和预设无关的全局显示开关。 -->
      <view class="section" v-if="fromChat">
        <text class="section-title">渲染开关</text>
        <text class="section-hint">控制 AI 回复中特殊标签是否渲染为交互组件</text>
        <view class="switch-item" v-for="item in rendererSwitches" :key="item.key">
          <text class="switch-label">{{ item.label }}</text>
          <switch :checked="pluginRenderers[item.key]" @change="onToggleRenderer(item.key)" color="#cfa54d" :disabled="item.key === 'html' && isMpWeixin" />
        </view>
      </view>

      <view class="section" v-if="fromChat">
        <text class="section-title">功能模块</text>
        <text class="section-hint">开启后在对话页显示对应的 TRPG 游戏机制面板</text>
        <view class="switch-item" v-for="item in moduleSwitches" :key="item.key">
          <text class="switch-label">{{ item.label }}</text>
          <switch :checked="moduleFlags[item.key]" @change="onToggleModule(item.key)" color="#cfa54d" />
        </view>
      </view>

      <view class="section">
        <text class="section-title">生成参数</text>
        <view class="form-item">
          <text class="label">Temperature（温度）: {{ form.generationParams.temperature }}</text>
          <slider :value="form.generationParams.temperature * 100" min="0" max="200" @change="onTempChange" activeColor="#cfa54d" />
        </view>
        <view class="form-item">
          <text class="label">Top P: {{ form.generationParams.topP }}</text>
          <slider :value="form.generationParams.topP * 100" min="0" max="100" @change="onTopPChange" activeColor="#cfa54d" />
        </view>
        <view class="form-item">
          <text class="label">Top K（0 表示不限制）: {{ form.generationParams.topK }}</text>
          <slider :value="form.generationParams.topK" min="0" max="200" @change="onTopKChange" activeColor="#cfa54d" />
        </view>
        <view class="form-item">
          <text class="label">Presence Penalty（存在惩罚）: {{ form.generationParams.presencePenalty }}</text>
          <slider :value="(form.generationParams.presencePenalty + 2) * 25" min="0" max="100" @change="onPresencePenaltyChange" activeColor="#cfa54d" />
        </view>
        <view class="form-item">
          <text class="label">Frequency Penalty（频率惩罚）: {{ form.generationParams.frequencyPenalty }}</text>
          <slider :value="(form.generationParams.frequencyPenalty + 2) * 25" min="0" max="100" @change="onFrequencyPenaltyChange" activeColor="#cfa54d" />
        </view>
        <view class="form-item">
          <text class="label">上下文长度（Token，Prompt+回复总上限）</text>
          <input class="input" type="number" :value="String(form.generationParams.maxContext)" @input="(e:any) => onMaxContextInput(e.detail.value)" />
        </view>
        <view class="form-item">
          <text class="label">最大回复长度（Token）</text>
          <input class="input" type="number" :value="String(form.generationParams.maxTokens)" @input="(e:any) => onMaxTokensInput(e.detail.value)" />
        </view>
        <view class="form-item">
          <text class="label">每次生成多个备选回复（n）</text>
          <input class="input" type="number" :value="String(form.generationParams.n)" @input="(e:any) => onNInput(e.detail.value)" />
        </view>
        <view class="form-item form-item-row">
          <text class="label">流式传输</text>
          <switch :checked="!!form.generationParams.stream" @change="(e:any) => form.generationParams.stream = e.detail.value" color="#cfa54d" style="transform: scale(0.8)" />
        </view>
        <view class="form-item">
          <text class="label">种子（Seed，-1 表示不固定结果）</text>
          <input class="input" type="number" :value="String(form.generationParams.seed)" @input="(e:any) => onSeedInput(e.detail.value)" />
        </view>
        <view class="form-item form-item-row">
          <text class="label">合并连续 system 消息</text>
          <switch :checked="!!form.generationParams.squashSystemMessages" @change="(e:any) => form.generationParams.squashSystemMessages = e.detail.value" color="#cfa54d" style="transform: scale(0.8)" />
        </view>
        <view class="form-item form-item-row">
          <text class="label">续写时复用上一条消息作前缀</text>
          <switch :checked="!!form.generationParams.continuePrefill" @change="(e:any) => form.generationParams.continuePrefill = e.detail.value" color="#cfa54d" style="transform: scale(0.8)" />
        </view>
        <view class="form-item">
          <text class="label">角色名称行为</text>
          <picker :range="namesBehaviorOptions" range-key="label" :value="namesBehaviorIndex" @change="onNamesBehaviorChange">
            <view class="select-value">{{ namesBehaviorOptions[namesBehaviorIndex]?.label }}</view>
          </picker>
        </view>
      </view>

      <view class="section">
        <text class="section-title">全局变量</text>
        <view v-for="(val, key) in form.globalVariables" :key="key" class="var-row">
          <text class="var-key">{{ key }}</text>
          <input class="var-input" :value="val" @input="(e: any) => onVarInput(String(key), e.detail.value)" />
          <text class="var-delete" @tap="onVarDelete(String(key))">✕</text>
        </view>
        <view class="add-var-btn" @tap="onAddVar">
          <text class="add-var-text">+ 添加变量</text>
        </view>
      </view>

      <!-- 全局正则（正侧）：对齐酒馆 GLOBAL 类型来源，跨角色/跨预设一直生效。管理入口在首页"设置"，这里只读展示 -->
      <view class="section">
        <text class="section-title">全局正则（{{ globalRegexScripts.length }} 条，只读）</text>
        <text class="section-hint">跨角色/跨预设一直生效，去首页"设置"里勾选正侧文件的"全局"开关来管理</text>
        <view v-if="globalRegexScripts.length === 0" class="empty-hint">
          <text>暂无已启用的全局正则</text>
        </view>
        <view v-for="script in globalRegexScripts" :key="script.id" class="regex-item">
          <text class="regex-name">{{ script.scriptName }}</text>
          <text class="regex-status" :class="script.disabled ? 'regex-disabled' : 'regex-enabled'">{{ script.disabled ? '已禁用' : '已启用' }}</text>
        </view>
      </view>

      <!-- 角色卡自带正则（SCOPED）：仅从对话页面设置进入时才有"当前角色"上下文 -->
      <view class="section" v-if="fromChat && scopedRegexScripts.length > 0">
        <view class="field-header-row">
          <text class="section-title">角色卡自带正则（{{ scopedRegexScripts.length }} 条）</text>
          <switch :checked="allowScopedRegex" color="#cfa54d" @change="onToggleScopedRegex" />
        </view>
        <text class="section-hint">来自当前角色卡，仅当上方开关开启时才会生效并合并到实际请求里</text>
        <view v-for="script in scopedRegexScripts" :key="script.id" class="regex-item">
          <text class="regex-name">{{ script.scriptName }}</text>
          <text class="regex-status" :class="script.disabled ? 'regex-disabled' : 'regex-enabled'">{{ script.disabled ? '已禁用' : '已启用' }}</text>
        </view>
      </view>

      <view class="section">
        <text class="section-title">预设自带正则（{{ form.regexScripts.length }} 条，只读）</text>
        <text class="section-hint">跟着这个预设走，换预设就换一套；要改内容请到"酒馆导入"页重新导入正侧 JSON</text>
        <view v-if="form.regexScripts.length === 0" class="empty-hint">
          <text>暂无正则脚本</text>
        </view>
        <view v-for="script in form.regexScripts" :key="script.id" class="regex-item">
          <text class="regex-name">{{ script.scriptName }}</text>
          <text class="regex-status" :class="script.disabled ? 'regex-disabled' : 'regex-enabled'">{{ script.disabled ? '已禁用' : '已启用' }}</text>
        </view>
      </view>

      <!-- Prompt 列表放最后：条目一多列表很长，放在最下面。
           这一整块本身默认折叠（listExpanded=false），只显示标题栏，点标题栏才展开显示搜索框和条目列表；
           展开后单条 Prompt 仍然是各自独立收起（expandedId 控制），点条目才展开详情，两层折叠避免列表铺满全屏。 -->
      <view class="section">
        <view class="section-header" @tap="listExpanded = !listExpanded">
          <text class="section-title">Prompt 列表（{{ filteredPrompts.length }}/{{ form.prompts.length }} 条）</text>
          <text class="collapse-arrow">{{ listExpanded ? '▲ 收起' : '▼ 展开' }}</text>
        </view>
        <view v-if="listExpanded">
          <view class="prompt-filter-row">
            <input class="prompt-search" :value="searchText" @input="(e:any)=>searchText=e.detail.value" placeholder="搜索名称/内容" />
            <view class="filter-toggle" :class="{ active: onlyEnabled }" @tap="onlyEnabled = !onlyEnabled">
              <text class="filter-toggle-text">仅显示启用</text>
            </view>
            <view class="add-btn" @tap="onAddPrompt">
              <text class="add-btn-text">+ 新增</text>
            </view>
          </view>
          <view
            v-for="item in filteredPrompts"
            :key="item.identifier"
            class="prompt-item"
          >
            <view class="prompt-item-header" @tap="toggleExpandById(item.identifier)">
              <switch :checked="item.enabled" @change="(e: any) => onToggleEnabledById(item.identifier, e.detail.value)" @tap.stop="() => {}" color="#cfa54d" style="transform: scale(0.75)" />
              <text class="prompt-name">{{ item.name || '(未命名)' }}</text>
              <text v-if="isMarkerPrompt(item.identifier)" class="system-badge">系统</text>
              <text class="prompt-role-badge" :class="'role-' + item.role">{{ roleLabel(item.role) }}</text>
              <view class="order-btns">
                <text class="order-btn" @tap.stop="onMoveUpById(item.identifier)">↑</text>
                <text class="order-btn" @tap.stop="onMoveDownById(item.identifier)">↓</text>
                <text class="order-btn delete-btn" :class="{ 'delete-disabled': isMarkerPrompt(item.identifier) }" @tap.stop="onDeletePromptById(item.identifier)">✕</text>
              </view>
            </view>
            <view v-if="expandedId === item.identifier" class="prompt-item-body" @tap.stop="() => {}">
              <!-- marker 提示词说明 -->
              <view v-if="isMarkerPrompt(item.identifier)" class="marker-hint">
                <text class="marker-hint-text">⚠️ 系统必需 Prompt：内容由角色卡/世界书/对话历史等运行时自动填充，无法编辑。可调整注入位置和顺序。</text>
              </view>
              <view class="mini-field">
                <text class="mini-label">名称</text>
                <input class="mini-input" :value="item.name" @input="(e: any) => onNameFieldInputById(item.identifier, e.detail.value)" />
              </view>
              <view class="mini-field">
                <text class="mini-label">角色（role）</text>
                <picker :range="roleOptions" range-key="label" :value="roleIndex(item.role)" @change="(e: any) => onRoleChangeById(item.identifier, e.detail.value)">
                  <view class="mini-picker-value">{{ roleLabel(item.role) }}</view>
                </picker>
              </view>
              <textarea
                class="prompt-content"
                :class="{ 'content-disabled': isMarkerPrompt(item.identifier) }"
                :value="item.content"
                @input="(e: any) => onContentInputById(item.identifier, e.detail.value)"
                :disabled="isMarkerPrompt(item.identifier)"
                :placeholder="isMarkerPrompt(item.identifier) ? '此 Prompt 内容由系统运行时自动填充' : 'Prompt 内容，支持 {{变量}} 模板，如 {{char}} {{description}} {{personality}} {{scenario}}'"
              />
              <view class="prompt-meta-row">
                <text class="meta-label">注入模式</text>
                <picker :range="['相对深度（跟随历史插入）', '绝对顺序（固定位置）']" :value="item.injectionPosition" @change="(e: any) => onPositionChangeById(item.identifier, e.detail.value)">
                  <text class="meta-value">{{ item.injectionPosition === 1 ? '绝对顺序' : '相对深度' }}</text>
                </picker>
              </view>
              <view class="prompt-meta-row" v-if="item.injectionPosition === 0">
                <text class="meta-label">插入深度（从历史末尾往前数）</text>
                <input class="meta-input" type="number" :value="String(item.injectionDepth)" @input="(e: any) => onDepthInputById(item.identifier, e.detail.value)" />
              </view>
              <view class="prompt-meta-row" v-else>
                <text class="meta-label">排序权重（越小越靠前）</text>
                <input class="meta-input" type="number" :value="String(item.injectionOrder)" @input="(e: any) => onOrderInputById(item.identifier, e.detail.value)" />
              </view>
            </view>
          </view>
          <view v-if="form.prompts.length === 0" class="empty-hint">
            <text>暂无 Prompt 条目，点击"新增"添加，或导入酒馆预设 JSON</text>
          </view>
        </view>
      </view>
    </scroll-view>

    <view class="footer">
      <view class="save-btn" @tap="onSave">
        <text class="save-text">保存</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { usePresetStore } from '../../stores/presetStore'
import { usePluginStore } from '../../stores/pluginStore'
import { useModuleStore } from '../../stores/moduleStore'
import { useRegexPresetStore } from '../../stores/regexPresetStore'
import { useCharacterCardStore } from '../../stores/characterCardStore'
import { getNavBarHeight } from '../../utils/navbar.js'
import NavBar from '../../components/common/NavBar.vue'
import type { Preset, PromptItem } from '../../types/preset'

const presetStore = usePresetStore()
const pluginStore = usePluginStore()
const moduleStore = useModuleStore()
const regexPresetStore = useRegexPresetStore()
const characterCardStore = useCharacterCardStore()
const navBarHeight = ref(0)
const expandedId = ref<string>('')
const searchText = ref('')
const onlyEnabled = ref(false)
// Prompt 列表整块的展开状态：默认收起（false），列表可能很长，先只显示标题栏
const listExpanded = ref(false)

// 是否从对话页面的设置键进入（chat.vue 跳转时会带上 fromChat=1）。
// 这种入口下：预设名称只读展示 + 额外显示渲染开关/功能模块开关这两块全局显示配置。
const fromChat = ref(false)
const readonlyName = computed(() => fromChat.value)

const isMpWeixin = ref(false)
const pluginRenderers = ref({ branch: true, summary: true, time: true, html: false, music: false })
const rendererSwitches = [
  { key: 'branch', label: '选项按钮（branches）' },
  { key: 'summary', label: '摘要卡片（meow_FM）' },
  { key: 'time', label: '时间卡片（time_format）' },
  { key: 'html', label: '自定义 HTML（仅 H5）' },
  { key: 'music', label: '音乐播放器' }
] as const
const moduleFlags = computed(() => ({ ...moduleStore.modules }))
const moduleSwitches = [
  { key: 'intentDetection', label: '意图识别' },
  { key: 'combat', label: '战斗面板' },
  { key: 'inventory', label: '背包系统' },
  { key: 'characterStatus', label: '角色属性面板' },
  { key: 'dicePanel', label: '骰子快捷栏' },
  { key: 'stats', label: '数值系统' },
  { key: 'adventure', label: '任务/剧情' }
] as const

// ── 三路正则脚本只读展示（GLOBAL / SCOPED / PRESET，对齐酒馆合并语义） ──
/** GLOBAL：所有勾选了"全局"的正侧文件合并后的脚本列表，管理入口在首页"设置" */
const globalRegexScripts = computed(() => regexPresetStore.globalScripts as any[])
/** SCOPED：当前角色卡自带的正则脚本（读全局 activeCard，和 moduleFlags 用的是同一个来源） */
const scopedRegexScripts = computed(() => {
  const card = characterCardStore.activeCard as any
  return Array.isArray(card?.extensions?.regex_scripts) ? card.extensions.regex_scripts : []
})
const allowScopedRegex = computed(() => !!(characterCardStore.activeCard as any)?.extensions?.allowScopedRegex)

/** 切换"是否允许使用角色卡自带正则"，直接写回角色卡的 extensions（对齐 characters/edit.vue 的同名开关） */
function onToggleScopedRegex(e: any) {
  const card = characterCardStore.activeCard as any
  if (!card) return
  const enabled = !!e.detail.value
  try {
    characterCardStore.update(card.id, {
      extensions: { ...card.extensions, allowScopedRegex: enabled }
    } as any)
    uni.showToast({ title: enabled ? '已允许角色卡自带正则' : '已关闭角色卡自带正则', icon: 'none' })
  } catch (err: any) {
    uni.showModal({ title: '设置失败', content: err?.message || '未知错误', showCancel: false })
  }
}


function onToggleRenderer(key: keyof typeof pluginRenderers.value) {
  pluginStore.toggle(key)
  pluginRenderers.value = { ...pluginStore.renderers }
}

function onToggleModule(key: any) {
  moduleStore.toggle(key)
}

const filteredPrompts = computed(() => {
  let list = form.prompts
  if (onlyEnabled.value) list = list.filter(p => p.enabled)
  const q = searchText.value.trim().toLowerCase()
  if (q) {
    list = list.filter(p =>
      (p.name || '').toLowerCase().includes(q) || (p.content || '').toLowerCase().includes(q)
    )
  }
  return list
})

function _findPrompt(identifier: string) {
  return form.prompts.find(p => p.identifier === identifier)
}
function _findPromptIndex(identifier: string) {
  return form.prompts.findIndex(p => p.identifier === identifier)
}

const roleOptions = [
  { value: 'system', label: '系统（system）' },
  { value: 'user', label: '用户（user）' },
  { value: 'assistant', label: 'AI（assistant）' }
]

function roleLabel(role: string) {
  const found = roleOptions.find(r => r.value === role)
  return found ? found.label.split('（')[0] : role
}
function roleIndex(role: string) {
  const idx = roleOptions.findIndex(r => r.value === role)
  return idx >= 0 ? idx : 0
}

const namesBehaviorOptions = [
  { value: -1, label: '不注入名字（NONE）' },
  { value: 0, label: '默认（仅群聊/旁白场景添加前缀）' },
  { value: 1, label: '随消息 name 字段发送（COMPLETION）' },
  { value: 2, label: '拼进正文内容（CONTENT）' }
]
const namesBehaviorIndex = computed(() => {
  const idx = namesBehaviorOptions.findIndex(o => o.value === form.generationParams.namesBehavior)
  return idx >= 0 ? idx : 1
})
function onNamesBehaviorChange(e: any) {
  form.generationParams.namesBehavior = namesBehaviorOptions[Number(e.detail.value)].value as any
}

const form = reactive<Preset>({
  id: '',
  name: '',
  prompts: [],
  promptOrder: [],
  globalVariables: {},
  regexScripts: [],
  generationParams: {
    temperature: 0.8,
    topP: 0.9,
    maxTokens: 2000,
    presencePenalty: 0,
    frequencyPenalty: 0,
    topK: 0,
    maxContext: 4096,
    stream: false,
    seed: -1,
    n: 1,
    namesBehavior: 0,
    squashSystemMessages: false,
    continuePrefill: false
  }
})

// onLoad 是 uni-app 官方组合式 API，跨 H5/小程序统一从页面路由参数中取值，
// 比手动解析 window.location.search 更可靠（H5 端可能是 hash 路由，search 里拿不到参数）
onLoad((options: any) => {
  navBarHeight.value = getNavBarHeight().navBarHeight
  presetStore.load()
  fromChat.value = options?.fromChat === '1'
  if (fromChat.value) {
    pluginStore.load()
    pluginRenderers.value = { ...pluginStore.renderers }
    moduleStore.load()
    // #ifdef MP-WEIXIN
    isMpWeixin.value = true
    // #endif
  }
  const id = options?.id
  if (id) {
    const existing = presetStore.get(id)
    if (existing) {
      Object.assign(form, JSON.parse(JSON.stringify(existing)))
    }
  }
  if (!form.id) {
    form.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  }
  // 保证 promptOrder 与 prompts 同步（缺失的补上，便于编辑页直接按 prompts 顺序展示）
  _syncPromptOrder()
})

function _syncPromptOrder() {
  const orderIds = new Set(form.promptOrder.map(o => o.identifier))
  form.prompts.forEach(p => {
    if (!orderIds.has(p.identifier)) {
      form.promptOrder.push({ identifier: p.identifier, enabled: p.enabled })
    }
  })
}

function toggleExpandById(identifier: string) {
  expandedId.value = expandedId.value === identifier ? '' : identifier
}

function onNameInput(e: any) {
  form.name = e.detail.value
}

function onToggleEnabledById(identifier: string, value: boolean) {
  const item = _findPrompt(identifier)
  if (!item) return
  item.enabled = value
  const orderItem = form.promptOrder.find(o => o.identifier === identifier)
  if (orderItem) orderItem.enabled = value
}

function onNameFieldInputById(identifier: string, value: string) {
  const item = _findPrompt(identifier)
  if (item) item.name = value
}

function onRoleChangeById(identifier: string, valueIndex: string) {
  const item = _findPrompt(identifier)
  if (item) item.role = roleOptions[Number(valueIndex)].value as 'system' | 'user' | 'assistant'
}

function onContentInputById(identifier: string, value: string) {
  const item = _findPrompt(identifier)
  if (item) item.content = value
}

function onPositionChangeById(identifier: string, value: string) {
  const item = _findPrompt(identifier)
  if (item) item.injectionPosition = Number(value) as 0 | 1
}

function onDepthInputById(identifier: string, value: string) {
  const item = _findPrompt(identifier)
  if (item) item.injectionDepth = Number(value) || 0
}

function onOrderInputById(identifier: string, value: string) {
  const item = _findPrompt(identifier)
  if (item) item.injectionOrder = Number(value) || 100
}

function onAddPrompt() {
  const id = 'prompt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const newItem: PromptItem = {
    identifier: id,
    name: '新 Prompt',
    enabled: true,
    role: 'system',
    content: '',
    injectionPosition: 1,
    injectionDepth: 4,
    injectionOrder: 100
  }
  form.prompts.push(newItem)
  form.promptOrder.push({ identifier: id, enabled: true })
  expandedId.value = id
}

function onDeletePromptById(identifier: string) {
  // 保护机制：禁止删除 marker 提示词（对齐酒馆的 system_prompt 保护）
  if (isMarkerPrompt(identifier)) {
    uni.showModal({
      title: '无法删除',
      content: '这是系统必需的 Prompt（角色描述/世界书/对话历史等运行时填充），无法删除。如需临时禁用，请关闭启用开关。',
      showCancel: false
    })
    return
  }
  
  uni.showModal({
    title: '删除 Prompt',
    content: '确定要删除这条 Prompt 吗？',
    success: (res: any) => {
      if (res.confirm) {
        const idx = _findPromptIndex(identifier)
        if (idx >= 0) form.prompts.splice(idx, 1)
        form.promptOrder = form.promptOrder.filter(o => o.identifier !== identifier)
        if (expandedId.value === identifier) expandedId.value = ''
      }
    }
  })
}

function onMoveUpById(identifier: string) {
  const idx = _findPromptIndex(identifier)
  if (idx <= 0) return
  const arr = form.prompts
  ;[arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]]
  _resyncOrderFromPrompts()
}

function onMoveDownById(identifier: string) {
  const idx = _findPromptIndex(identifier)
  if (idx < 0 || idx >= form.prompts.length - 1) return
  const arr = form.prompts
  ;[arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]]
  _resyncOrderFromPrompts()
}

function _resyncOrderFromPrompts() {
  form.promptOrder = form.prompts.map(p => ({
    identifier: p.identifier,
    enabled: p.enabled
  }))
}

// 判断是否为 marker 提示词（对齐 PromptBuilder.ts 的 MARKER_IDS）
function isMarkerPrompt(identifier: string): boolean {
  const markerIds = [
    'charDescription',
    'charPersonality',
    'scenario',
    'dialogueExamples',
    'personaDescription',
    'worldInfoBefore',
    'worldInfoAfter',
    'trpgStatus',
    'chatHistory'
  ]
  return markerIds.includes(identifier)
}

function onTempChange(e: any) {
  form.generationParams.temperature = Math.round(e.detail.value) / 100
}

function onTopPChange(e: any) {
  form.generationParams.topP = Math.round(e.detail.value) / 100
}

function onTopKChange(e: any) {
  form.generationParams.topK = Math.round(e.detail.value)
}

function onMaxContextInput(value: string) {
  form.generationParams.maxContext = Number(value) || 4096
}

function onMaxTokensInput(value: string) {
  form.generationParams.maxTokens = Number(value) || 2000
}

function onNInput(value: string) {
  form.generationParams.n = Math.max(1, Number(value) || 1)
}

function onSeedInput(value: string) {
  form.generationParams.seed = Number(value)
  if (Number.isNaN(form.generationParams.seed)) form.generationParams.seed = -1
}

function onPresencePenaltyChange(e: any) {
  form.generationParams.presencePenalty = Math.round(e.detail.value / 25 * 100) / 100 - 2
}

function onFrequencyPenaltyChange(e: any) {
  form.generationParams.frequencyPenalty = Math.round(e.detail.value / 25 * 100) / 100 - 2
}

function onVarInput(key: string, value: string) {
  form.globalVariables[key] = value
}

function onVarDelete(key: string) {
  delete form.globalVariables[key]
}

function onAddVar() {
  uni.showModal({
    title: '添加变量',
    editable: true,
    placeholderText: '变量名',
    success: (res: any) => {
      if (res.confirm && res.content) {
        form.globalVariables[res.content] = ''
      }
    }
  })
}

function onSave() {
  if (!form.name.trim()) {
    uni.showToast({ title: '请输入预设名称', icon: 'none' })
    return
  }
  _resyncOrderFromPrompts()
  presetStore.save(JSON.parse(JSON.stringify(form)))
  uni.showToast({ title: '已保存', icon: 'success' })
  setTimeout(() => uni.navigateBack(), 800)
}
</script>

<style scoped>
.edit-container { display: flex; flex-direction: column; height: 100vh; background: var(--bg-deep); }
.edit-scroll { flex: 1; padding: 20rpx; min-height: 0; box-sizing: border-box; }
.section { margin-bottom: 30rpx; background: var(--surface); border: 1rpx solid var(--border); border-radius: 20rpx; padding: 24rpx; overflow: hidden; box-sizing: border-box; }
.section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12rpx; }
.section-title { font-family: var(--font-body); font-size: 24rpx; font-weight: 700; color: var(--fg); margin-bottom: 12rpx; }
.add-btn { padding: 10rpx 18rpx; background: color-mix(in oklch, var(--success) 14%, transparent); border: 1rpx solid var(--success); border-radius: 14rpx; flex-shrink: 0; }
.add-btn-text { font-size: 21rpx; color: var(--success); font-weight: 600; }
.collapse-arrow { font-size: 21rpx; color: var(--faint); flex-shrink: 0; }
.prompt-filter-row { display: flex; gap: 12rpx; margin-bottom: 16rpx; }
.prompt-search { flex: 1; height: 64rpx; background: var(--surface-2); border: 1rpx solid var(--border); border-radius: 14rpx; padding: 0 16rpx; font-size: 22rpx; color: var(--fg); box-sizing: border-box; }
.filter-toggle { padding: 0 18rpx; height: 64rpx; display: flex; align-items: center; background: var(--surface-2); border: 1rpx solid var(--border); border-radius: 14rpx; flex-shrink: 0; }
.filter-toggle.active { background: var(--accent-soft); border-color: var(--accent); }
.filter-toggle-text { font-size: 20rpx; color: var(--faint); }
.filter-toggle.active .filter-toggle-text { color: var(--accent); font-weight: 600; }
.form-item { margin-bottom: 18rpx; }
.form-item-row { display: flex; justify-content: space-between; align-items: center; }
.label { display: block; font-size: 22rpx; color: var(--fg-soft); margin-bottom: 10rpx; }
.input { height: 76rpx; background: var(--surface-2); border: 1rpx solid var(--border); border-radius: 16rpx; padding: 0 20rpx; font-size: 24rpx; color: var(--fg); box-sizing: border-box; width: 100%; }
.readonly-input { display: flex; align-items: center; color: var(--faint); background: var(--raised); }
.select-value { padding: 20rpx; background: var(--surface-2); border: 1rpx solid var(--border); border-radius: 16rpx; font-size: 24rpx; color: var(--accent); font-weight: 600; }
.section-hint { display: block; font-size: 19rpx; color: var(--faint); margin-bottom: 16rpx; margin-top: -4rpx; line-height: 1.5; }
.field-header-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6rpx; }
.switch-item { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10rpx; padding: 14rpx 0; border-bottom: 1rpx solid var(--border); }
.switch-item:last-of-type { border-bottom: none; }
.switch-label { font-size: 22rpx; color: var(--fg-soft); }
.prompt-item { background: var(--surface-2); border: 1rpx solid var(--border); border-radius: 16rpx; margin-bottom: 12rpx; padding: 16rpx 20rpx; }
.prompt-item-header { display: flex; align-items: center; gap: 10rpx; }
.prompt-name { flex: 1; min-width: 0; font-size: 23rpx; color: var(--fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.system-badge { font-size: 16rpx; padding: 3rpx 8rpx; border-radius: 8rpx; flex-shrink: 0; font-weight: 600; background: color-mix(in oklch, var(--accent) 14%, transparent); color: var(--accent); border: 1rpx solid color-mix(in oklch, var(--accent) 30%, transparent); }
.prompt-role-badge { font-size: 17rpx; padding: 3rpx 9rpx; border-radius: 8rpx; flex-shrink: 0; font-weight: 600; }
.role-system { background: var(--accent-soft); color: var(--accent); }
.role-user { background: color-mix(in oklch, var(--success) 18%, transparent); color: var(--success); }
.role-assistant { background: color-mix(in oklch, var(--t-gold) 20%, transparent); color: var(--t-gold); }
.order-btns { display: flex; gap: 10rpx; flex-shrink: 0; }
.order-btn { font-size: 22rpx; color: var(--faint); padding: 0 6rpx; }
.delete-btn { color: var(--danger); }
.delete-disabled { color: var(--faint); opacity: 0.4; }
.prompt-item-body { margin-top: 16rpx; }
.marker-hint { padding: 12rpx 16rpx; background: color-mix(in oklch, var(--accent) 8%, transparent); border: 1rpx solid color-mix(in oklch, var(--accent) 20%, transparent); border-radius: 12rpx; margin-bottom: 16rpx; }
.marker-hint-text { font-size: 20rpx; color: var(--accent); line-height: 1.55; }
.mini-field { display: flex; align-items: center; gap: 12rpx; margin-bottom: 12rpx; }
.mini-label { font-size: 20rpx; color: var(--faint); width: 140rpx; flex-shrink: 0; }
.mini-input { flex: 1; height: 56rpx; background: var(--surface); border: 1rpx solid var(--border); border-radius: 10rpx; padding: 0 14rpx; font-size: 22rpx; color: var(--fg); box-sizing: border-box; }
.mini-picker-value { flex: 1; height: 56rpx; line-height: 56rpx; background: var(--surface); border: 1rpx solid var(--border); border-radius: 10rpx; padding: 0 14rpx; font-size: 22rpx; color: var(--accent); }
.prompt-content { width: 100%; min-height: 160rpx; background: var(--surface); border: 1rpx solid var(--border); border-radius: 14rpx; padding: 16rpx; font-size: 22rpx; color: var(--fg); box-sizing: border-box; margin-bottom: 12rpx; line-height: 1.5; }
.content-disabled { background: var(--raised); color: var(--faint); opacity: 0.6; }
.prompt-meta-row { display: flex; justify-content: space-between; align-items: center; margin-top: 12rpx; }
.meta-label { font-size: 20rpx; color: var(--faint); }
.meta-value { font-size: 22rpx; color: var(--accent); font-weight: 600; }
.meta-input { width: 140rpx; height: 50rpx; background: var(--surface); border: 1rpx solid var(--border); border-radius: 8rpx; text-align: center; color: var(--fg); font-size: 22rpx; }
.empty-hint { padding: 30rpx; text-align: center; color: var(--faint); font-size: 22rpx; }
.var-row { display: flex; align-items: center; gap: 12rpx; margin-bottom: 12rpx; }
.var-key { width: 160rpx; font-size: 22rpx; color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.var-input { flex: 1; height: 60rpx; background: var(--surface-2); border: 1rpx solid var(--border); border-radius: 12rpx; padding: 0 16rpx; font-size: 22rpx; color: var(--fg); box-sizing: border-box; }
.var-delete { font-size: 22rpx; color: var(--danger); padding: 0 8rpx; }
.add-var-btn { padding: 14rpx; text-align: center; background: var(--accent-soft); border: 1rpx solid var(--accent); border-radius: 14rpx; }
.add-var-text { font-size: 22rpx; color: var(--accent); font-weight: 600; }
.regex-item { display: flex; justify-content: space-between; align-items: center; padding: 14rpx 16rpx; background: var(--surface-2); border: 1rpx solid var(--border); border-radius: 12rpx; margin-bottom: 8rpx; gap: 12rpx; }
.regex-name { flex: 1; min-width: 0; font-size: 22rpx; color: var(--fg-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.regex-status { font-size: 18rpx; padding: 2rpx 10rpx; border-radius: 8rpx; flex-shrink: 0; }
.regex-enabled { background: color-mix(in oklch, var(--success) 16%, transparent); color: var(--success); }
.regex-disabled { background: var(--raised); color: var(--faint); }
.footer { padding: 20rpx 30rpx; padding-bottom: calc(20rpx + env(safe-area-inset-bottom)); background: oklch(18% 0.013 70 / 0.92); border-top: 1rpx solid var(--border); flex: none; }
.save-btn { height: 84rpx; background: linear-gradient(135deg, var(--accent), var(--accent-strong)); border-radius: 42rpx; display: flex; align-items: center; justify-content: center; box-shadow: 0 20rpx 44rpx -18rpx oklch(75% 0.14 80 / 0.6); }
.save-text { font-size: 25rpx; color: #171104; font-weight: 700; }
</style>