<template>
  <view class="new-conv-container">
    <!-- 步骤 1：选择角色卡 -->
    <view v-if="step === 1" class="step-panel">
      <NavBar title="选择角色卡" subtitle="选择要与谁开始对话" />
      <scroll-view class="grid-scroll" scroll-y :style="{ paddingTop: (navBarHeight + 16) + 'px' }">
        <view class="card-grid">
          <view
            v-for="card in cardStore.cards"
            :key="card.id"
            :class="['card-item', selectedCardId === card.id ? 'selected' : '']"
            @tap="selectedCardId = card.id"
          >
            <view class="card-avatar">
              <image v-if="card.avatar" class="card-avatar-img" :src="card.avatar" mode="aspectFill" />
              <text v-else class="card-avatar-text">{{ (card.name || '?').charAt(0) }}</text>
            </view>
            <text class="card-name">{{ card.name }}</text>
            <text class="card-desc">{{ card.description || card.personality || '暂无描述' }}</text>
            <view v-if="selectedCardId === card.id" class="card-check">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 10.5l3.5 3.5 7.5-8"/></svg>
            </view>
          </view>
        </view>
      </scroll-view>
      <view class="footer">
        <button class="btn-primary" :disabled="!selectedCardId" @tap="goStep2">下一步</button>
      </view>
    </view>

    <!-- 步骤 2：确认窗口（仅选预设/正侧，Persona 使用当前出场角色，不在此展示） -->
    <view v-if="step === 2" class="step-panel">
      <NavBar title="确认对话设置" subtitle="选择要使用的预设 / 正侧" custom-back @back="step = 1" />
      <scroll-view class="confirm-scroll" scroll-y :style="{ paddingTop: (navBarHeight + 16) + 'px' }">
        <view class="select-block">
          <text class="select-label">预设</text>
          <picker :range="presetOptions" range-key="label" @change="onPresetChange">
            <view class="select-value">{{ presetOptions[presetIndex]?.label || '未选择' }}</view>
          </picker>
        </view>

        <view class="select-block">
          <text class="select-label">正侧（正则脚本）</text>
          <picker :range="regexOptions" range-key="label" @change="onRegexChange">
            <view class="select-value">{{ regexOptions[regexIndex]?.label || '未选择' }}</view>
          </picker>
        </view>
      </scroll-view>
      <view class="footer footer-row">
        <button class="btn-secondary" @tap="step = 1">返回修改</button>
        <button class="btn-primary" @tap="onStartChat">开始对话</button>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useCharacterCardStore } from '../../stores/characterCardStore'
import { usePresetStore } from '../../stores/presetStore'
import { useRegexPresetStore } from '../../stores/regexPresetStore'
import { usePersonaStore } from '../../stores/personaStore'
import { getNavBarHeight } from '../../utils/navbar.js'
import NavBar from '../../components/common/NavBar.vue'
// @ts-ignore
import conversationManager from '../../utils/account/conversationManager.js'

const cardStore = useCharacterCardStore()
const presetStore = usePresetStore()
const regexPresetStore = useRegexPresetStore()
const personaStore = usePersonaStore()

const navBarHeight = ref(0)
const step = ref(1)
const selectedCardId = ref('')

const presetIndex = ref(0)
const regexIndex = ref(0)

const selectedCard = computed(() => selectedCardId.value ? cardStore.getById(selectedCardId.value) : null)

// 文件导入名（fileName）优先于内部 name 展示，让用户认得自己导入的是哪个文件
const presetOptions = computed(() => [
  { id: '', label: '（不使用预设）' },
  ...presetStore.presets.map(p => ({ id: p.id, label: (p as any).fileName || p.name }))
])
const regexOptions = computed(() => [
  { id: '', label: '（不使用正侧）' },
  ...regexPresetStore.presets.map(p => ({ id: p.id, label: (p as any).fileName || p.name }))
])

onMounted(() => {
  navBarHeight.value = getNavBarHeight().navBarHeight
  cardStore.loadAll()
  presetStore.load()
  regexPresetStore.load()
  personaStore.load()
})

function onPresetChange(e: any) { presetIndex.value = Number(e.detail.value) }
function onRegexChange(e: any) { regexIndex.value = Number(e.detail.value) }

function goStep2() {
  if (!selectedCardId.value) return
  step.value = 2
}

function onStartChat() {
  const cardId = selectedCardId.value
  const presetId = presetOptions.value[presetIndex.value]?.id || ''
  const regexPresetId = regexOptions.value[regexIndex.value]?.id || ''
  // Persona 不在本页选择，统一使用当前出场角色（personaStore.activePersonaId）
  const personaId = personaStore.activePersonaId || ''

  const hasExisting = conversationManager.has(cardId)
  if (hasExisting) {
    uni.showModal({
      title: '该角色已有对话记录',
      content: '开始新对话将清空原有记录，是否继续？',
      success: (res: any) => {
        if (res.confirm) {
          conversationManager.clear(cardId)
          _navigateToChat(cardId, presetId, regexPresetId, personaId)
        }
      }
    })
  } else {
    _navigateToChat(cardId, presetId, regexPresetId, personaId)
  }
}

function _navigateToChat(cardId: string, presetId: string, regexPresetId: string, personaId: string) {
  const params = [
    'cardId=' + cardId,
    'mode=new',
    presetId ? 'presetId=' + presetId : '',
    regexPresetId ? 'regexPresetId=' + regexPresetId : '',
    personaId ? 'personaId=' + personaId : ''
  ].filter(Boolean).join('&')
  uni.redirectTo({ url: '/pages/chat/chat?' + params })
}
</script>

<style scoped>
.new-conv-container { display: flex; flex-direction: column; height: 100vh; background: var(--bg-deep); }
.step-panel { display: flex; flex-direction: column; height: 100%; }

.grid-scroll { flex: 1; padding: 20rpx; min-height: 0; }
.card-grid { display: flex; flex-wrap: wrap; gap: 16rpx; }
.card-item {
  position: relative; width: calc(50% - 8rpx); height: 280rpx; padding: 20rpx;
  background: var(--surface); border-radius: 22rpx; border: 1rpx solid var(--border);
  display: flex; flex-direction: column; align-items: center; text-align: center; box-sizing: border-box; overflow: hidden;
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
.card-name { font-size: 24rpx; color: var(--fg); font-weight: 700; margin-bottom: 6rpx; width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; }
.card-desc {
  font-size: 19rpx;
  color: var(--faint);
  width: 100%;
  flex: 1;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
  line-height: 1.45;
}
.card-check {
  position: absolute; top: 10rpx; right: 10rpx; width: 34rpx; height: 34rpx; border-radius: 50%;
  background: var(--accent); color: #171104; display: flex; align-items: center; justify-content: center;
}
.card-check svg { width: 18rpx; height: 18rpx; }

.footer { padding: 18rpx 30rpx; padding-bottom: calc(18rpx + env(safe-area-inset-bottom)); background: oklch(18% 0.013 70 / 0.92); border-top: 1rpx solid var(--border); flex: none; }
.footer-row { display: flex; gap: 18rpx; }
.btn-primary, .btn-secondary { flex: 1; height: 84rpx; line-height: 84rpx; border-radius: 42rpx; font-size: 25rpx; font-weight: 700; border: none; }
.btn-primary { background: linear-gradient(135deg, var(--accent), var(--accent-strong)); color: #171104; box-shadow: 0 20rpx 44rpx -18rpx oklch(75% 0.14 80 / 0.6); }
.btn-primary[disabled] { opacity: 0.4; box-shadow: none; }
.btn-secondary { background: var(--surface); border: 1rpx solid var(--border); color: var(--fg-soft); }

.confirm-scroll { flex: 1; padding: 22rpx; min-height: 0; }
.summary-card { display: flex; align-items: center; gap: 16rpx; padding: 20rpx; background: var(--surface); border: 1rpx solid var(--border); border-radius: 20rpx; margin-bottom: 26rpx; }
.summary-avatar { flex-shrink: 0; margin-bottom: 0; }
.summary-info { flex: 1; min-width: 0; }
.summary-name { display: block; font-size: 26rpx; color: var(--fg); font-weight: 700; margin-bottom: 6rpx; }
.summary-desc { display: block; font-size: 21rpx; color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.select-block { margin-bottom: 22rpx; }
.select-label { display: block; font-size: 22rpx; color: var(--fg-soft); margin-bottom: 10rpx; }
.select-value { padding: 20rpx; background: var(--surface); border: 1rpx solid var(--border); border-radius: 16rpx; font-size: 24rpx; color: var(--accent); font-weight: 600; }
</style>
