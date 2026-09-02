<template>
  <view class="session-container">
    <NavBar title="开始冒险" subtitle="选择继续已有对话，或开始一段新的对话" />

    <view class="body-content" :style="{ paddingTop: (navBarHeight + 16) + 'px' }">
    <view class="new-btn" @tap="onNewConversation">
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3v5M10 12v5M3 10h5M12 10h5"/></svg>
      <text class="new-btn-text">新建对话</text>
    </view>

    <view class="overview">
      <view class="overview-item"><text class="overview-num">{{ cardCount }}</text><text class="overview-label">角色卡</text></view>
      <view class="overview-item"><text class="overview-num">{{ presetCount }}</text><text class="overview-label">预设</text></view>
      <view class="overview-item"><text class="overview-num">{{ regexCount }}</text><text class="overview-label">正侧</text></view>
      <view class="overview-item"><text class="overview-num">{{ personaCount }}</text><text class="overview-label">Persona</text></view>
    </view>

    <text class="section-title">历史对话</text>
    <scroll-view class="list-scroll" scroll-y>
      <view v-if="conversations.length === 0" class="empty-state">
        <text class="empty-text">还没有历史对话，点击上方"新建对话"开始</text>
      </view>
      <view v-for="conv in conversations" :key="conv.cardId" class="conv-card" @tap="onContinue(conv)">
        <view class="conv-avatar">
          <image v-if="getCardAvatar(conv.cardId)" class="conv-avatar-img" :src="getCardAvatar(conv.cardId)" mode="aspectFill" />
          <text v-else class="conv-avatar-text">{{ (conv.cardName || '?').charAt(0) }}</text>
        </view>
        <view class="conv-info">
          <text class="conv-name">{{ conv.cardName || '未知角色' }}</text>
          <text class="conv-preview">{{ conv.lastMessagePreview || '暂无消息' }}</text>
        </view>
        <view class="conv-meta">
          <text class="conv-time">{{ formatTime(conv.updatedAt) }}</text>
          <text class="conv-count">{{ conv.messageCount }} 条</text>
          <text class="conv-delete" @tap.stop="onDeleteConversation(conv.cardId)">删除</text>
        </view>
      </view>
    </scroll-view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
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
const conversations = ref<any[]>([])
const cardCount = ref(0)
const presetCount = ref(0)
const regexCount = ref(0)
const personaCount = ref(0)

onMounted(() => {
  navBarHeight.value = getNavBarHeight().navBarHeight
  _refresh()
})


function _refresh() {
  cardStore.loadAll()
  presetStore.load()
  regexPresetStore.load()
  personaStore.load()
  conversations.value = conversationManager.getList()
  cardCount.value = cardStore.cards.length
  presetCount.value = presetStore.presets.length
  regexCount.value = regexPresetStore.presets.length
  personaCount.value = personaStore.personas.length
}

function getCardAvatar(cardId: string): string {
  const card: any = cardStore.getById(cardId)
  return card && card.avatar ? card.avatar : ''
}

function formatTime(ts: number): string {
  if (!ts) return ''
  const date = new Date(ts)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000))
  if (diffDays === 1) return '昨天'
  if (diffDays < 7) return diffDays + '天前'
  return date.toLocaleDateString('zh-CN')
}

function onNewConversation() {
  if (cardStore.cards.length === 0) {
    uni.showModal({
      title: '还没有角色卡',
      content: '请先前往"酒馆导入"页面导入一个角色卡',
      confirmText: '去导入',
      success: (res: any) => {
        if (res.confirm) uni.navigateTo({ url: '/pages/import/import' })
      }
    })
    return
  }
  uni.navigateTo({ url: '/pages/session/new-conversation' })
}

function onContinue(conv: any) {
  uni.navigateTo({ url: '/pages/chat/chat?cardId=' + conv.cardId + '&mode=continue' })
}

function onDeleteConversation(cardId: string) {
  uni.showModal({
    title: '删除历史对话',
    content: '仅删除对话记录，不影响角色卡本身，是否继续？',
    success: (res: any) => {
      if (res.confirm) {
        conversationManager.remove(cardId)
        _refresh()
        uni.showToast({ title: '已删除', icon: 'none' })
      }
    }
  })
}
</script>

<style scoped>
.session-container { display: flex; flex-direction: column; height: 100vh; background: var(--bg-deep); box-sizing: border-box; }
.body-content { display: flex; flex-direction: column; flex: 1; min-height: 0; padding: 28rpx 30rpx; box-sizing: border-box; }

.new-btn {
  display: flex; align-items: center; justify-content: center; gap: 10rpx; height: 88rpx; flex: none;
  background: linear-gradient(160deg, var(--accent), var(--accent-strong)); border-radius: 44rpx; margin-bottom: 24rpx;
  box-shadow: 0 24rpx 52rpx -20rpx oklch(75% 0.14 80 / 0.65), inset 0 2rpx 0 oklch(100% 0 0 / 0.4);

}
.new-btn svg { width: 26rpx; height: 26rpx; color: #171104; }
.new-btn-text { font-size: 26rpx; color: #171104; font-weight: 900; }

.overview { display: flex; gap: 10rpx; margin-bottom: 26rpx; flex: none; }
.overview-item { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4rpx; padding: 18rpx 6rpx; background: var(--surface); border: 1rpx solid var(--border); border-radius: 18rpx; }
.overview-num { font-family: var(--font-mono); font-size: 28rpx; font-weight: 700; color: var(--accent); }
.overview-label { font-size: 18rpx; color: var(--faint); letter-spacing: .02em; }

.section-title { display: block; font-size: 24rpx; color: var(--fg); font-weight: 700; margin-bottom: 16rpx; flex: none; }
.list-scroll { flex: 1; min-height: 0; }
.empty-state { padding: 80rpx 40rpx; text-align: center; }
.empty-text { font-size: 23rpx; color: var(--faint); }

.conv-card { display: flex; align-items: center; gap: 16rpx; padding: 20rpx; background: var(--surface); border: 1rpx solid var(--border); border-radius: 20rpx; margin-bottom: 14rpx; transition: border-color 0.2s ease; }
.conv-avatar {
  width: 76rpx; height: 76rpx; border-radius: 20rpx; flex-shrink: 0; overflow: hidden;
  background: linear-gradient(160deg, oklch(68% 0.16 40), oklch(46% 0.12 20));
  border: 1rpx solid oklch(80% 0.1 45 / 0.5);
  display: flex; align-items: center; justify-content: center;
}
.conv-avatar-img { width: 100%; height: 100%; }
.conv-avatar-text { font-family: var(--font-serif); font-size: 28rpx; color: #1b0b05; font-weight: 900; }
.conv-info { flex: 1; min-width: 0; }
.conv-name { display: block; font-size: 25rpx; color: var(--fg); font-weight: 700; margin-bottom: 6rpx; }
.conv-preview { display: block; font-size: 20rpx; color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.conv-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 6rpx; flex-shrink: 0; }
.conv-time { font-family: var(--font-mono); font-size: 18rpx; color: var(--faint); }
.conv-count { font-family: var(--font-mono); font-size: 18rpx; color: var(--faint); }
.conv-delete { font-size: 18rpx; color: var(--danger); }
</style>
