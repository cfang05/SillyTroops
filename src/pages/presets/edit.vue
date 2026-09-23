<template>
  <view class="edit-container">
    <NavBar title="对话设置" :subtitle="form.name || '当前对话'" />
    <scroll-view class="edit-scroll" scroll-y :style="{ paddingTop: (navBarHeight + 16) + 'px' }">
      <!-- 基础信息（用户要求：显示目前使用的预设与正侧，不可编辑）
           预设名与正侧都是"新建对话时选定"的，在对话里随手改名字会让预设列表认不出是谁，
           所以这里只做只读展示。 -->
      <view class="section">
        <text class="section-title">基础信息</text>
        <view class="info-row">
          <text class="info-label">预设</text>
          <text class="info-value">{{ form.name || '(未命名预设)' }}</text>
        </view>
        <view class="info-row">
          <text class="info-label">正侧</text>
          <text class="info-value">{{ regexPresetName }}</text>
        </view>
        <text class="section-hint">这两项在「新建对话」时选定，此处只做展示，不可修改</text>
        <!-- 兼容旧入口（从"预设列表"独立编辑预设）：那种场景下没有会话上下文，
             名称仍需可改，否则无法给预设改名。 -->
        <view v-if="!fromChat" class="form-item" style="margin-top: 14rpx;">
          <text class="label">预设名称</text>
          <input class="input" :value="form.name" @input="onNameInput" />
        </view>
      </view>

      <!-- 流式输出（用户要求：紧跟在"基础信息"下面）——
           10~100 的显示速度滑条，最右 100 = 全速（等价于关闭平滑输出）。每次只能调整 5。
           与首页「设置」共用同一份配置，改动立即生效、不需要保存。 -->
      <view class="section">
        <text class="section-title">流式输出</text>
        <text class="section-hint">控制文字"逐字释放"的速度。滑到最右侧 100 为全速：不限制显示速度，完全跟上游速度</text>
        <view class="form-item">
          <view class="pacing-head">
            <text class="label">显示速度</text>
            <text class="pacing-value">{{ pacingLabel }}</text>
          </view>
          <slider
            class="pacing-slider"
            :value="pacingCfg.charsPerSec"
            :min="PACING_MIN"
            :max="PACING_FULL_SPEED"
            :step="PACING_STEP"
            :show-value="false"
            activeColor="#cfa54d"
            backgroundColor="#3a332a"
            block-size="20"
            @change="onPacingRateChange"
          />
          <view class="pacing-scale">
            <text class="pacing-scale-text">慢 {{ PACING_MIN }}</text>
            <text class="pacing-scale-text">全速 {{ PACING_FULL_SPEED }}</text>
          </view>
        </view>
        <text class="section-hint">这一项与首页「设置」里的流式输出是同一个开关，改哪边都生效（立即保存，无需点底部"保存"）</text>
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

      <!-- 作者注（Author's Note）：用户要求放在"生成参数"下面。
           它是**账号级全局**配置（noteStore），不属于单个预设；改动立即保存，不需要点底部"保存"。 -->
      <view class="section">
        <text class="section-title">作者注</text>
        <text class="section-subtitle">定时注入的全局提示，用于强调设定 / 风格 / 状态（对齐酒馆 Author's Note）。改动立即生效，无需点底部"保存"</text>
        <view class="form-item">
          <text class="label">作者注内容</text>
          <textarea class="input textarea" placeholder="例如：{{char}} 正保持谨慎，注意周围环境…" :value="noteConfig.promptText" @input="onNotePromptInput" maxlength="2000" />
        </view>
        <view class="form-item">
          <text class="label">注入频率（每 N 条用户消息）</text>
          <input class="input" type="number" :value="noteConfig.interval" @input="onNoteIntervalInput" />
        </view>
        <view class="form-item">
          <text class="label">注入深度（IN_CHAT 时，倒数第 N 条之前）</text>
          <input class="input" type="number" :value="noteConfig.depth" @input="onNoteDepthInput" />
        </view>
        <view class="form-item">
          <text class="label">注入位置</text>
          <view class="chip-row">
            <view v-for="p in notePositions" :key="p.value" :class="['chip', noteConfig.position === p.value ? 'active' : '']" @tap="onNotePosition(p.value)">{{ p.label }}</view>
          </view>
        </view>
        <view class="form-item">
          <text class="label">注入角色（IN_CHAT）</text>
          <view class="chip-row">
            <view v-for="r in noteRoles" :key="r.value" :class="['chip', noteConfig.role === r.value ? 'active' : '']" @tap="onNoteRole(r.value)">{{ r.label }}</view>
          </view>
        </view>
      </view>

      <!-- 世界书扫描：对齐酒馆 world-info.js 的三个全局设置。
           默认值必须与酒馆一致（深度 2、不递归），否则同一个预设会激活不同数量的条目。 -->
      <view class="section">
        <text class="section-title">世界书扫描</text>
        <view class="form-item">
          <text class="label">扫描深度（看最近几条消息，0 = 全部历史；酒馆默认 2）</text>
          <input class="input" type="number" :value="String(form.generationParams.worldInfoDepth ?? 2)" @input="(e:any) => onWorldInfoDepthInput(e.detail.value)" />
        </view>
        <view class="form-item form-item-row">
          <text class="label">递归扫描（对齐酒馆「递归扫描」，默认关闭）</text>
          <switch :checked="!!form.generationParams.worldInfoRecursive" @change="(e:any) => form.generationParams.worldInfoRecursive = e.detail.value" color="#cfa54d" style="transform: scale(0.8)" />
        </view>
        <view class="form-item">
          <text class="label">最大递归步数（0 = 不额外限制，交给预算兜底）</text>
          <input class="input" type="number" :value="String(form.generationParams.worldInfoMaxRecursionSteps ?? 0)" @input="(e:any) => onWorldInfoMaxStepsInput(e.detail.value)" />
        </view>
        <view class="form-item">
          <text class="label">世界书外层包装（wi_format，{0} 为正文占位；默认 {0} = 不包装）</text>
          <input class="input" :value="String(form.generationParams.worldInfoFormat ?? '{0}')" @input="(e:any) => form.generationParams.worldInfoFormat = e.detail.value" />
        </view>
      </view>

      <!-- 自定义停止串：对齐酒馆「自定义停止序列」。一行一条，最多发 4 条（酒馆同款限制）。 -->
      <view class="section">
        <text class="section-title">自定义停止串（最多 4 条，每行一条）</text>
        <text class="section-subtitle">命中即停止生成。留空 = 不发送 stop 字段</text>
        <textarea
          class="input textarea"
          :value="stopStringsText"
          @input="onStopStringsInput"
          placeholder="例如：&#10;User:&#10;&lt;/content&gt;"
          maxlength="400"
        />
      </view>

      <!-- 自动回复（新增）：玩家不输入内容时长按发送键 3 秒进入。
           几个开关默认就是打开的，改动立即保存，不需要点底部"保存"就能用。 -->
      <view class="section">
        <text class="section-title">自动回复</text>
        <text class="section-hint">玩家没有输入内容时长按发送键 3 秒即可进入自动回复：系统会把下面的文本当作你的发言反复发给大模型，而这条发言不会显示在对话里 —— 你只会看到大模型一轮一轮地输出。中途点击输入框即可退出，本次生成结束后就停下等你自己输入。</text>
        <text class="section-hint">下面几项默认已打开，改动立即生效（无需点底部"保存"）</text>
        <view class="switch-item">
          <text class="switch-label">打开自动输入</text>
          <switch :checked="autoReply.enabled" @change="onToggleAutoReply" color="#cfa54d" />
        </view>
        <view class="switch-item">
          <text class="switch-label">自定义自动输入文本</text>
          <switch :checked="autoReply.useCustomText" @change="onToggleAutoReplyCustom" color="#cfa54d" />
        </view>
        <view class="form-item" style="margin-top: 16rpx;">
          <text class="label">自动输入文本</text>
          <input
            class="input"
            :class="{ 'input-disabled': !autoReplyInputEnabled }"
            :disabled="!autoReplyInputEnabled"
            :value="autoReply.customText"
            @input="onAutoReplyTextInput"
            :placeholder="DEFAULT_AUTO_REPLY_TEXT"
          />
          <text class="section-hint" style="margin-top: 10rpx; margin-bottom: 0;">未打开"自定义自动输入文本"时，固定使用默认文本「{{ DEFAULT_AUTO_REPLY_TEXT }}」；留空时同样回落到它</text>
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

      <!-- 预设提示词条目（原"Prompt 列表"）放最后：条目一多列表很长，放在最下面。
           这一整块本身默认折叠（listExpanded=false），只显示标题栏，点标题栏才展开显示搜索框和条目列表；
           展开后单条 Prompt 仍然是各自独立收起（expandedId 控制），点条目才展开详情，两层折叠避免列表铺满全屏。 -->
      <view class="section">
        <view class="section-header" @tap="listExpanded = !listExpanded">
          <text class="section-title">预设提示词条目（{{ filteredPrompts.length }}/{{ form.prompts.length }} 条）</text>
          <text class="collapse-arrow">{{ listExpanded ? '▲ 收起' : '▼ 展开' }}</text>
        </view>
        <text class="section-hint">以下是当前会话所选预设自带的提示词条目</text>
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
import { useRegexPresetStore } from '../../stores/regexPresetStore'
import { useCharacterCardStore } from '../../stores/characterCardStore'
import { useNoteStore } from '../../stores/noteStore'
import { getNavBarHeight } from '../../utils/navbar.js'
import NavBar from '../../components/common/NavBar.vue'
import { SYSTEM_REGEX_PRESET_ID } from '../../engine/systemRegex'
import { loadPacingConfig, savePacingConfig, PACING_MIN, PACING_FULL_SPEED, PACING_STEP, type StreamPacingConfig } from '../../utils/streamPacing'
import type { Preset, PromptItem } from '../../types/preset'
import { DEFAULT_AUTO_REPLY_TEXT, normalizeAutoReply } from '../../types/preset'

const presetStore = usePresetStore()
const regexPresetStore = useRegexPresetStore()
const characterCardStore = useCharacterCardStore()
const noteStore = useNoteStore()
const navBarHeight = ref(0)
const expandedId = ref<string>('')
const searchText = ref('')
const onlyEnabled = ref(false)
// Prompt 列表整块的展开状态：默认收起（false），列表可能很长，先只显示标题栏
const listExpanded = ref(false)

// 是否从对话页面的设置键进入（chat.vue 跳转时会带上 fromChat=1）。
// 这种入口下：基础信息只读展示（预设 + 正侧）；独立编辑预设时仍允许改名字。
const fromChat = ref(false)
// 本次会话选中的正侧文件 id（chat.vue 通过路由参数带进来）
const sessionRegexPresetId = ref('')

/** 正侧展示名：没选中任何文件时就是默认的「系统正侧」 */
const regexPresetName = computed(() => {
  const id = sessionRegexPresetId.value || SYSTEM_REGEX_PRESET_ID
  const p = regexPresetStore.get(id) as any
  return p ? (p.fileName || p.name || id) : '系统正侧'
})

// ── 流式输出速度（与首页"设置"共用同一份配置）──────────────────────
const pacingCfg = ref<StreamPacingConfig>({ enabled: true, charsPerSec: 80 })
const pacingLabel = computed(() => {
  const r = pacingCfg.value.charsPerSec
  return r >= PACING_FULL_SPEED ? '全速（不限速）' : `${r} 字/秒`
})
function onPacingRateChange(e: any) {
  const v = Number(e && e.detail && e.detail.value)
  pacingCfg.value = { enabled: v < PACING_FULL_SPEED, charsPerSec: v }
  savePacingConfig(pacingCfg.value)
}

// ── 自动回复（长按发送键 3 秒）────────────────────────────────────
// ⚠️ 用户要求：几个开关**默认全部打开**，而且改了立即生效（不需要先点底部"保存"），
//    否则"长按发送键没反应"会被当成功能坏了。默认值口径统一在 normalizeAutoReply 里。
const autoReply = reactive(normalizeAutoReply(null))
/** 文本输入框可编辑条件：勾了"自定义自动输入文本"（用户定义的规则） */
const autoReplyInputEnabled = computed(() => autoReply.useCustomText)
function onToggleAutoReply(e: any) {
  autoReply.enabled = !!e.detail.value
  _persistAutoReply()
}
function onToggleAutoReplyCustom(e: any) {
  autoReply.useCustomText = !!e.detail.value
  _persistAutoReply()
}
function onAutoReplyTextInput(e: any) {
  autoReply.customText = e.detail.value
  // 文本是逐字输入的：用防抖落盘，避免每敲一个字就把整份预设重新写一遍（预设可能 1MB+）
  _debouncedPersistAutoReply()
}

/** 文本输入的防抖落盘（开关类仍然立即保存，只有连续输入才需要防抖） */
let _autoReplyTimer: ReturnType<typeof setTimeout> | null = null
function _debouncedPersistAutoReply() {
  if (_autoReplyTimer) clearTimeout(_autoReplyTimer)
  _autoReplyTimer = setTimeout(() => {
    _autoReplyTimer = null
    _persistAutoReply()
  }, 400)
}

/**
 * 立刻把自动回复配置写进预设（不经过底部"保存"按钮）
 *
 * 只补写 autoReply 这一个字段：编辑页里的生成参数等其它改动仍然遵循
 * "点保存才生效"的原有约定，不会被这里顺手提交掉。
 */
function _persistAutoReply() {
  try {
    const existing = presetStore.get(form.id) as any
    if (!existing) return // 新预设还没落库：交给底部"保存"处理
    const payload = JSON.parse(JSON.stringify(existing))
    payload.autoReply = { enabled: autoReply.enabled, useCustomText: autoReply.useCustomText, customText: autoReply.customText }
    presetStore.save(payload)
  } catch (err) {
    console.warn('[对话设置] 自动回复即时保存失败:', err)
  }
}

// ── 作者注（Author's Note，账号级全局配置）─────────────────────────
// 数据源是 noteStore（不是本预设），因此这里的改动**立即持久化**，
// 且不会因为用户没点底部"保存"而丢失。
const noteConfig = reactive({ promptText: '', interval: 1, depth: 4, position: 1, role: 'system' })
const notePositions = [
  { value: 0, label: '场景后(IN_PROMPT)' },
  { value: 1, label: '历史深处(IN_CHAT)' },
  { value: 2, label: '提示词前(BEFORE)' }
]
const noteRoles = [
  { value: 'system', label: 'system' },
  { value: 'user', label: 'user' },
  { value: 'assistant', label: 'assistant' }
]
function _flushNote() {
  try {
    if (noteStore) noteStore.update({ ...noteConfig } as any)
  } catch (err) {
    console.warn('[对话设置] 作者注保存失败:', err)
  }
}
/** 作者注文本的防抖落盘（连续输入时不必每个字符都写一次本地存储） */
let _noteTimer: ReturnType<typeof setTimeout> | null = null
function _debouncedFlushNote() {
  if (_noteTimer) clearTimeout(_noteTimer)
  _noteTimer = setTimeout(() => {
    _noteTimer = null
    _flushNote()
  }, 400)
}
function onNotePromptInput(e: any) {
  noteConfig.promptText = e.detail.value
  _debouncedFlushNote()
}
function onNoteIntervalInput(e: any) {
  const n = parseInt(e.detail.value, 10)
  noteConfig.interval = isNaN(n) || n < 1 ? 1 : n
  _flushNote()
}
function onNoteDepthInput(e: any) {
  const n = parseInt(e.detail.value, 10)
  noteConfig.depth = isNaN(n) || n < 0 ? 0 : n
  _flushNote()
}
function onNotePosition(v: number) {
  noteConfig.position = v as 0 | 1 | 2
  _flushNote()
}
function onNoteRole(v: string) {
  noteConfig.role = v as 'system' | 'user' | 'assistant'
  _flushNote()
}

// ── 角色卡自带正则只读展示（SCOPED） ──
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

/** 自定义停止串：数组 ↔ 一行一条的文本框（textarea 在 uni-app 里没有数组形态） */
const stopStringsText = computed(() => ((form.generationParams.customStopStrings as string[]) || []).join('\n'))
function onStopStringsInput(e: any) {
  form.generationParams.customStopStrings = String(e.detail.value || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0)
    .slice(0, 4)
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
    continuePrefill: false,
    // 世界书扫描（对齐酒馆 world-info.js 默认值：深度 2、不递归）
    worldInfoDepth: 2,
    worldInfoRecursive: false,
    worldInfoMaxRecursionSteps: 0,
    worldInfoFormat: '{0}',
    customStopStrings: []
  },
  autoReply: normalizeAutoReply(null)
})

// onLoad 是 uni-app 官方组合式 API，跨 H5/小程序统一从页面路由参数中取值，
// 比手动解析 window.location.search 更可靠（H5 端可能是 hash 路由，search 里拿不到参数）
onLoad((options: any) => {
  // 需要登录：未登录会被 reLaunch 到登录页（守卫实现在 App.vue 的 checkUserLogin）
  if (!getApp().checkUserLogin()) return
  navBarHeight.value = getNavBarHeight().navBarHeight
  presetStore.load()
  regexPresetStore.load()
  // 作者注是账号级全局配置，进页面时读一次当前值
  noteStore.load()
  Object.assign(noteConfig, { ...noteStore.config })
  fromChat.value = options?.fromChat === '1'
  sessionRegexPresetId.value = options?.regexPresetId || ''
  // 流式输出速度与首页"设置"共用一份配置
  pacingCfg.value = loadPacingConfig()
  const id = options?.id
  if (id) {
    const existing = presetStore.get(id)
    if (existing) {
      const copy = JSON.parse(JSON.stringify(existing))
      Object.assign(form, copy)
      // 自动回复兜底：老预设没有这个字段，缺失时按默认值（开关默认打开）
      Object.assign(autoReply, normalizeAutoReply(copy.autoReply))
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

/** 世界书扫描深度：0 = 全部历史；空/非法值回落到酒馆默认值 2 */
function onWorldInfoDepthInput(value: string) {
  const n = Number(value)
  form.generationParams.worldInfoDepth = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 2
}

/** 最大递归步数：0 = 不额外限制（引擎侧用安全上限兜底防死循环） */
function onWorldInfoMaxStepsInput(value: string) {
  const n = Number(value)
  form.generationParams.worldInfoMaxRecursionSteps = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
}

function onSave() {
  if (!form.name.trim()) {
    uni.showToast({ title: '请输入预设名称', icon: 'none' })
    return
  }
  _resyncOrderFromPrompts()
  // 自动回复是独立响应式对象，保存前写回预设（文本原样保留，空文本由使用侧回落到默认值）
  const payload = JSON.parse(JSON.stringify(form)) as Preset
  payload.autoReply = {
    enabled: !!autoReply.enabled,
    useCustomText: !!autoReply.useCustomText,
    customText: String(autoReply.customText ?? '')
  }
  presetStore.save(payload)
  // 作者注是全局配置，走 noteStore（平时已即时保存，这里再兜一次确保一致）
  _flushNote()
  uni.showToast({ title: '已保存', icon: 'success' })
  setTimeout(() => uni.navigateBack(), 800)
}
</script>

<style scoped>
.edit-container { display: flex; flex-direction: column; height: 100vh; background: var(--bg-deep); }
.edit-scroll { flex: 1; padding: 20rpx; min-height: 0; box-sizing: border-box; }
.section { margin-bottom: 30rpx; background: var(--surface); border: 1rpx solid var(--border); border-radius: 20rpx; padding: 24rpx; overflow: hidden; box-sizing: border-box; }
.section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12rpx; }
.section-title { font-family: var(--font-body); font-size: 24rpx; font-weight: 700; color: var(--fg); margin-bottom: 12rpx; display: block; }
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
.input-disabled { opacity: 0.5; }
.readonly-input { display: flex; align-items: center; color: var(--faint); background: var(--raised); }
.select-value { padding: 20rpx; background: var(--surface-2); border: 1rpx solid var(--border); border-radius: 16rpx; font-size: 24rpx; color: var(--accent); font-weight: 600; }
.section-hint { display: block; font-size: 19rpx; color: var(--faint); margin-bottom: 16rpx; margin-top: -4rpx; line-height: 1.5; }
.section-subtitle { display: block; font-size: 19rpx; color: var(--faint); margin-bottom: 16rpx; margin-top: -4rpx; line-height: 1.5; }
.field-header-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6rpx; }
.switch-item { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10rpx; padding: 14rpx 0; border-bottom: 1rpx solid var(--border); }
.switch-item:last-of-type { border-bottom: none; }
.switch-label { font-size: 22rpx; color: var(--fg-soft); }

/* 基础信息（只读展示） */
.info-row { display: flex; align-items: flex-start; gap: 16rpx; padding: 10rpx 0; }
.info-label { width: 100rpx; flex-shrink: 0; font-size: 22rpx; color: var(--faint); }
.info-value { flex: 1; min-width: 0; font-size: 23rpx; color: var(--fg); font-weight: 600; word-break: break-all; }

/* 作者注的选项胶囊（与首页"设置"同款） */
.chip-row { display: flex; flex-wrap: wrap; gap: 12rpx; }
.chip { padding: 11rpx 20rpx; border-radius: 16rpx; background: var(--surface-2); border: 1rpx solid var(--border); font-size: 20rpx; color: var(--fg-soft); }
.chip.active { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); font-weight: 700; }

/* 流式输出速度滑条（与首页"设置"同款） */
.pacing-head { display: flex; justify-content: space-between; align-items: baseline; }
.pacing-value { font-family: var(--font-mono); font-size: 22rpx; font-weight: 700; color: var(--accent); }
.pacing-slider { margin: 6rpx 0 0; }
.pacing-scale { display: flex; justify-content: space-between; margin-top: -6rpx; }
.pacing-scale-text { font-family: var(--font-mono); font-size: 17rpx; color: var(--faint); letter-spacing: 0.04em; }

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
.textarea { height: 150rpx; padding-top: 18rpx; line-height: 1.5; }
.regex-item { display: flex; justify-content: space-between; align-items: center; padding: 14rpx 16rpx; background: var(--surface-2); border: 1rpx solid var(--border); border-radius: 12rpx; margin-bottom: 8rpx; gap: 12rpx; }
.regex-name { flex: 1; min-width: 0; font-size: 22rpx; color: var(--fg-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.regex-status { font-size: 18rpx; padding: 2rpx 10rpx; border-radius: 8rpx; flex-shrink: 0; }
.regex-enabled { background: color-mix(in oklch, var(--success) 16%, transparent); color: var(--success); }
.regex-disabled { background: var(--raised); color: var(--faint); }
.footer { padding: 20rpx 30rpx; padding-bottom: calc(20rpx + env(safe-area-inset-bottom)); background: oklch(18% 0.013 70 / 0.92); border-top: 1rpx solid var(--border); flex: none; }
.save-btn { height: 84rpx; background: linear-gradient(135deg, var(--accent), var(--accent-strong)); border-radius: 42rpx; display: flex; align-items: center; justify-content: center; box-shadow: 0 20rpx 44rpx -18rpx oklch(75% 0.14 80 / 0.6); }
.save-text { font-size: 25rpx; color: #171104; font-weight: 700; }
</style>
