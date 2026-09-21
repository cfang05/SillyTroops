<template>
  <view v-if="visible" class="dlg-mask" @tap="onMaskTap">
    <view class="dlg-panel" @tap.stop>
      <view class="dlg-head">
        <text class="dlg-title">{{ title }}</text>
        <view class="dlg-close" @tap="emit('close')">
          <svg viewBox="0 0 20 20" fill="none"><path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
        </view>
      </view>
      <text v-if="hint" class="dlg-hint">{{ hint }}</text>
      <view class="dlg-body">
        <slot />
      </view>
      <view v-if="$slots.footer" class="dlg-foot">
        <slot name="footer" />
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
/**
 * 居中弹窗外壳（暗金奇幻风，对齐 notes/wuxian-lvtuan-core-pages.html 的视觉语言）。
 *
 * 由页面提供内容（默认插槽）：新建对话页用它承载
 * 「选择角色卡（两列卡片网格）」「选择预设（列表）」「选择正侧（列表）」三种内容，
 * 保证三者的遮罩、面板、标题、右上角关闭键完全一致（一套交互，三种内容）。
 *
 * 交互约定：
 *   · 点击遮罩关闭（maskClosable=false 可关掉）；
 *   · 面板自身 @tap.stop，避免点内容时误关；
 *   · 右上角关闭键固定；
 *   · 内容过高时**只有 body 滚动**，标题与关闭键始终可见。
 */
import { withDefaults } from 'vue'

const props = withDefaults(defineProps<{
  visible?: boolean
  title?: string
  /** 标题下方的补充说明（可选） */
  hint?: string
  /** 点击遮罩是否关闭 */
  maskClosable?: boolean
}>(), {
  visible: false,
  title: '',
  hint: '',
  maskClosable: true
})

const emit = defineEmits<{ close: [] }>()

function onMaskTap() {
  if (props.maskClosable) emit('close')
}
</script>

<style scoped>
.dlg-mask {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  z-index: 999;
  background: oklch(8% 0.01 70 / 0.72);
  -webkit-backdrop-filter: blur(3px);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40rpx 44rpx;
  box-sizing: border-box;
}
.dlg-panel {
  width: 100%;
  max-width: 620rpx;
  max-height: 78vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 30rpx;
  border: 1rpx solid var(--border-strong);
  background: linear-gradient(180deg, oklch(25% 0.016 74), oklch(19% 0.013 70));
  box-shadow: 0 40rpx 90rpx -30rpx oklch(0% 0 0 / 0.9);
}
.dlg-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 26rpx 26rpx 20rpx;
  border-bottom: 1rpx solid var(--border);
}
.dlg-title {
  flex: 1;
  min-width: 0;
  font-family: var(--font-serif);
  font-size: 30rpx;
  font-weight: 900;
  color: var(--accent);
  letter-spacing: .02em;
}
.dlg-close {
  width: 56rpx; height: 56rpx; flex: none;
  border-radius: 16rpx;
  background: var(--surface);
  border: 1rpx solid var(--border);
  display: flex; align-items: center; justify-content: center;
  color: var(--fg-soft);
}
.dlg-close:active { background: var(--surface-2); border-color: var(--border-strong); }
.dlg-close svg { width: 26rpx; height: 26rpx; }
.dlg-hint {
  flex: none;
  display: block;
  padding: 16rpx 26rpx 0;
  font-size: 20rpx;
  color: var(--faint);
  line-height: 1.5;
}
.dlg-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 20rpx 22rpx 24rpx;
}
.dlg-foot { flex: none; padding: 0 22rpx 22rpx; }
</style>
