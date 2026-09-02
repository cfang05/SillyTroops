<template>
  <view class="nav-bar-fixed" :style="{ paddingTop: statusBarHeight + 'px' }">
    <view class="nav-bar-row">
      <view v-if="showBack" class="nav-back-btn" @tap="onBackTap">
        <svg viewBox="0 0 20 20" fill="none"><path d="M12.5 4.5L7 10l5.5 5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </view>
      <view v-else class="nav-side-placeholder"></view>

      <view class="nav-title-col">
        <text class="nav-title">{{ title }}</text>
        <text v-if="subtitle" class="nav-subtitle">{{ subtitle }}</text>
      </view>

      <view class="nav-right-slot">
        <slot name="right">
          <view class="nav-side-placeholder"></view>
        </slot>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
/**
 * 通用返回导航栏：对齐 notes/brand-spec.md §4「导航栏（返回键 + 居中标题）」。
 * 用于替代系统原生导航栏（pages.json 该页需配 navigationStyle:"custom"），
 * 返回键 / 居中标题 / 右侧占位三段等宽布局，标题真正居中。
 *
 * 与 pages/chat/chat.vue 里的 .custom-navbar 是两套独立实现：chat 页有自己的三段式
 * （返回+标题+设置键）毛玻璃导航，本组件面向其余所有子页面的通用返回导航场景。
 */
import { ref, onMounted } from 'vue'

const props = withDefaults(defineProps<{
  title: string
  subtitle?: string
  showBack?: boolean
  /** 为 true 时点击返回键只 emit('back')，不自动 uni.navigateBack()，由页面自己决定跳转逻辑（如分步表单的“上一步”） */
  customBack?: boolean
}>(), {
  showBack: true,
  customBack: false
})

const emit = defineEmits<{ back: [] }>()

const statusBarHeight = ref(0)
onMounted(() => {
  try {
    const info = uni.getSystemInfoSync()
    statusBarHeight.value = info.statusBarHeight || 0
  } catch (e) { /* 忽略，取默认值 0 */ }
})

/**
 * 默认行为：直接 uni.navigateBack()（覆盖绝大多数页面的返回场景）。
 * customBack=true 时只 emit('back')，交给页面自己处理（如新建对话分步表单的“上一步”按钮
 * 需要先退回 step 1 而不是真正离开页面）。
 */
function onBackTap() {
  if (props.customBack) {
    emit('back')
  } else {
    uni.navigateBack()
  }
}
</script>

<style scoped>
.nav-bar-fixed {
  position: fixed;
  top: 0; left: 0; right: 0;
  z-index: 200;
  background: oklch(18% 0.013 70 / 0.92);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--border);
  box-sizing: border-box;
}
.nav-bar-row {
  height: 108rpx;
  display: flex;
  align-items: center;
  padding: 0 32rpx;
  gap: 20rpx;
}
.nav-back-btn, .nav-side-placeholder {
  width: 68rpx; height: 68rpx; flex: none;
}
.nav-back-btn {
  border-radius: 20rpx;
  background: var(--surface);
  border: 1rpx solid var(--border);
  display: flex; align-items: center; justify-content: center;
  color: var(--fg-soft);
  transition: border-color 0.2s ease, background 0.2s ease;
}
.nav-back-btn:active { border-color: var(--border-strong); background: var(--surface-2); }
.nav-back-btn svg { width: 36rpx; height: 36rpx; }
.nav-title-col {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column; align-items: center;
}
.nav-title {
  font-family: var(--font-body); font-size: 30rpx; font-weight: 900; color: var(--fg);
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.nav-subtitle {
  font-size: 20rpx; color: var(--muted); margin-top: 4rpx;
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.nav-right-slot {
  flex: none; min-width: 68rpx;
  display: flex; align-items: center; justify-content: flex-end;
}
</style>
