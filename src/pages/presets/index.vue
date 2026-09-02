<template>
  <view class="presets-container">
    <NavBar title="预设管理" />
    <view class="header" :style="{ paddingTop: (navBarHeight + 16) + 'px' }">
      <text class="header-sub">预设导入统一在"酒馆导入"页面完成，这里仅管理已导入的预设</text>
    </view>

    <scroll-view class="list-scroll" scroll-y>
      <view v-if="presetStore.presets.length === 0" class="empty-state">
        <text class="empty-text">还没有预设，前往"酒馆导入"页面导入</text>
        <view class="goto-import-btn" @tap="goImport"><text class="goto-import-text">去导入</text></view>
      </view>
      <view
        v-for="preset in presetStore.presets"
        :key="preset.id"
        class="preset-card"
        @tap="onEdit(preset.id)"
      >
        <view class="preset-info">
          <text class="preset-name">{{ preset.name }}</text>
          <text class="preset-meta">{{ preset.prompts.length }} 条 Prompt · temperature {{ preset.generationParams.temperature }}</text>
        </view>
        <view class="preset-actions">
          <text class="preset-edit" @tap.stop="onEdit(preset.id)">编辑</text>
          <text class="preset-delete" @tap.stop="onDelete(preset.id)">删除</text>
        </view>
      </view>
    </scroll-view>

  </view>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { usePresetStore } from '../../stores/presetStore'
import { getNavBarHeight } from '../../utils/navbar.js'
import NavBar from '../../components/common/NavBar.vue'

const presetStore = usePresetStore()
const navBarHeight = ref(0)

onMounted(() => {
  navBarHeight.value = getNavBarHeight().navBarHeight
  presetStore.load()
})

function onEdit(id: string) {
  uni.navigateTo({ url: '/pages/presets/edit?id=' + id })
}

function onDelete(id: string) {
  uni.showModal({
    title: '删除预设',
    content: '确定要删除这个预设吗？',
    success: (res: any) => {
      if (res.confirm) {
        presetStore.remove(id)
        uni.showToast({ title: '已删除', icon: 'none' })
      }
    }
  })
}

function goImport() {
  uni.navigateTo({ url: '/pages/import/import' })
}
</script>

<style scoped>
.presets-container { display: flex; flex-direction: column; height: 100vh; background: var(--bg-deep); }
.header { padding: 24rpx 30rpx; border-bottom: 1rpx solid var(--border); flex: none; }
.header-sub { display: block; font-size: 21rpx; color: var(--faint); line-height: 1.5; }
.list-scroll { flex: 1; padding: 20rpx; min-height: 0; }
.empty-state { padding: 100rpx 40rpx; text-align: center; }
.empty-text { display: block; font-size: 23rpx; color: var(--faint); margin-bottom: 20rpx; line-height: 1.6; }
.goto-import-btn { display: inline-block; padding: 16rpx 30rpx; background: var(--accent-soft); border: 1rpx solid var(--accent); border-radius: 30rpx; }
.goto-import-text { font-size: 23rpx; color: var(--accent); font-weight: 700; }
.preset-card { display: flex; align-items: center; padding: 22rpx; background: var(--surface); border: 1rpx solid var(--border); border-radius: 18rpx; margin-bottom: 14rpx; transition: border-color 0.2s ease; }
.preset-info { flex: 1; min-width: 0; }
.preset-name { display: block; font-size: 25rpx; color: var(--fg); font-weight: 700; margin-bottom: 6rpx; }
.preset-meta { font-family: var(--font-mono); font-size: 19rpx; color: var(--faint); }
.preset-actions { display: flex; gap: 18rpx; flex-shrink: 0; }
.preset-edit { font-size: 21rpx; color: var(--t-gold); font-weight: 600; }
.preset-delete { font-size: 21rpx; color: var(--danger); font-weight: 600; }
</style>