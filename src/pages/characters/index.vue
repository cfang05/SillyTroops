<template>
  <view class="characters-container">
    <NavBar title="角色卡库" />
    <view class="header" :style="{ paddingTop: (navBarHeight + 16) + 'px' }">
      <text class="header-sub">AI 扮演的角色（酒馆角色卡），与 TRPG 玩家角色分开管理。导入统一在"酒馆导入"页面完成</text>
      <view class="import-actions">
        <view class="import-btn" @tap="goImport">
          <text class="import-btn-text">前往酒馆导入</text>
        </view>
      </view>
    </view>

    <scroll-view class="list-scroll" scroll-y>
      <view v-if="cardStore.cards.length === 0" class="empty-state">
        <text class="empty-text">还没有角色卡，点击上方按钮导入酒馆角色卡（推荐 PNG 格式）</text>
      </view>
      <view
        v-for="card in cardStore.cards"
        :key="card.id"
        class="char-card"
        :class="{ active: card.id === cardStore.activeCardId }"
        @tap="onCardTap(card)"
      >
        <view class="char-avatar">
          <image v-if="card.avatar" class="char-avatar-img" :src="card.avatar" mode="aspectFill" />
          <text v-else class="char-avatar-text">{{ (card.name || '?').charAt(0) }}</text>
        </view>
        <view class="char-info">
          <text class="char-name">{{ card.name }}</text>
          <text class="char-desc">{{ card.description || card.personality || '暂无描述' }}</text>
          <view class="char-tags" v-if="card.tags && card.tags.length > 0">
            <text v-for="tag in card.tags" :key="tag" class="char-tag">{{ tag }}</text>
          </view>
        </view>
        <view class="char-actions">
          <text class="char-edit" @tap.stop="onEdit(card.id)">编辑</text>
          <text class="char-delete" @tap.stop="onDelete(card.id)">删除</text>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useCharacterCardStore } from '../../stores/characterCardStore'
import * as CharacterImporter from '../../adapters/character/CharacterImporter'
import { getNavBarHeight } from '../../utils/navbar.js'
import NavBar from '../../components/common/NavBar.vue'

const cardStore = useCharacterCardStore()
const navBarHeight = ref(0)

onMounted(() => {
  navBarHeight.value = getNavBarHeight().navBarHeight
  cardStore.loadAll()
})

function onCardTap(card: any) {
  onEdit(card.id)
}

function goImport() {
  uni.navigateTo({ url: '/pages/import/import' })
}

function onEdit(id: string) {
  uni.navigateTo({ url: '/pages/characters/edit?id=' + id })
}

function onDelete(id: string) {
  uni.showModal({
    title: '删除角色卡',
    content: '确定要删除这个角色卡吗？此操作不可恢复。',
    success: (res: any) => {
      if (res.confirm) {
        cardStore.remove(id)
        uni.showToast({ title: '已删除', icon: 'none' })
      }
    }
  })
}
</script>

<style scoped>
.characters-container { display: flex; flex-direction: column; height: 100vh; background: var(--bg-deep); }
.header { padding: 24rpx 30rpx; border-bottom: 1rpx solid var(--border); flex: none; }
.header-sub { display: block; font-size: 21rpx; color: var(--faint); margin-bottom: 20rpx; line-height: 1.5; }
.import-actions { display: flex; gap: 12rpx; }
.import-btn { flex: 1; height: 68rpx; display: flex; align-items: center; justify-content: center; background: var(--accent-soft); border: 1rpx solid var(--accent); border-radius: 18rpx; text-align: center; }
.import-btn-text { font-size: 23rpx; color: var(--accent); font-weight: 700; }
.list-scroll { flex: 1; padding: 20rpx; min-height: 0; }
.empty-state { padding: 100rpx 40rpx; text-align: center; }
.empty-text { font-size: 23rpx; color: var(--faint); line-height: 1.6; }
.char-card { display: flex; align-items: flex-start; gap: 16rpx; padding: 20rpx; background: var(--surface); border: 1rpx solid var(--border); border-radius: 20rpx; margin-bottom: 16rpx; height: 168rpx; box-sizing: border-box; overflow: hidden; transition: border-color 0.2s ease, background 0.2s ease; }
.char-card.active { border-color: var(--accent); background: var(--accent-soft); }
.char-avatar {
  width: 80rpx; height: 80rpx; border-radius: 20rpx; flex-shrink: 0; overflow: hidden;
  background: linear-gradient(160deg, oklch(68% 0.16 40), oklch(46% 0.12 20));
  border: 1rpx solid oklch(80% 0.1 45 / 0.5);
  display: flex; align-items: center; justify-content: center;
}
.char-avatar-img { width: 100%; height: 100%; }
.char-avatar-text { font-family: var(--font-serif); font-size: 30rpx; color: #1b0b05; font-weight: 900; }
.char-info { flex: 1; min-width: 0; overflow: hidden; }
.char-name { display: block; font-size: 25rpx; color: var(--fg); font-weight: 700; margin-bottom: 6rpx; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.char-desc {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  font-size: 20rpx;
  color: var(--faint);
  margin-bottom: 8rpx;
  line-height: 1.5;
  max-height: 60rpx;
}
.char-tags { display: flex; flex-wrap: nowrap; gap: 8rpx; overflow: hidden; }
.char-tag { font-size: 18rpx; color: var(--accent); background: var(--accent-soft); padding: 4rpx 10rpx; border-radius: 8rpx; }
.char-actions { display: flex; flex-direction: column; align-items: flex-end; gap: 10rpx; flex-shrink: 0; }
.char-active-badge { font-size: 19rpx; color: var(--success); }
.char-set-active { font-size: 19rpx; color: var(--accent); }
.char-edit { font-size: 19rpx; color: var(--t-gold); font-weight: 600; }
.char-delete { font-size: 19rpx; color: var(--danger); font-weight: 600; }
</style>