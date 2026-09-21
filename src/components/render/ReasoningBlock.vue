<template>
  <!-- 思考内容折叠块（P6.3 / D17）
       只在有思考时出现；没有思考的消息完全不渲染它。
       默认展开，**正文一开始出现就自动折叠一次**（用户手动点过之后不再自动折叠）。 -->
  <view class="reason-box" :class="{ 'reason-box-streaming': streaming }">
    <view class="reason-head" @tap="toggle">
      <text class="reason-caret">{{ collapsed ? '▸' : '▾' }}</text>
      <text class="reason-title">{{ title }}</text>
    </view>
    <view class="reason-body" v-if="!collapsed">
      <text class="reason-text">{{ text }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'

const props = defineProps<{
  /** 思考文本（显示态：已应用 REASONING 正则） */
  text: string
  /** 是否仍在思考（流式中、正文还没开始） */
  streaming?: boolean
  /** 思考耗时（毫秒） */
  durationMs?: number
  /** 正文是否已经开始 */
  hasContent?: boolean
}>()

const collapsed = ref(false)
/** 用户手动切换过之后就不再自动折叠（尊重用户意图） */
const touched = ref(false)

const title = computed(() => {
  if (props.streaming) return '正在思考…'
  const seconds = props.durationMs ? Math.max(1, Math.round(props.durationMs / 1000)) : 0
  return seconds ? `已思考 ${seconds} 秒` : '思考过程'
})

function toggle() {
  touched.value = true
  collapsed.value = !collapsed.value
}

// 正文出现时自动折叠一次（不动用户的手动选择）
watch(() => props.hasContent, (now, before) => {
  if (now && !before && !touched.value) collapsed.value = true
})
</script>

<style scoped>
.reason-box {
  border: 1px solid var(--border);
  border-left: 3px solid color-mix(in oklch, var(--t-violet) 55%, transparent);
  border-radius: 10px;
  background: color-mix(in oklch, var(--t-violet) 7%, var(--surface));
  padding: 8px 10px;
  margin-bottom: 6px;
}
.reason-box-streaming { opacity: .92; }
.reason-head { display: flex; align-items: center; gap: 6px; }
.reason-caret { font-family: var(--font-mono); font-size: 11px; color: var(--t-violet); }
.reason-title { font-family: var(--font-body); font-size: 11.5px; color: var(--t-violet); font-weight: 600; }
.reason-body { margin-top: 6px; }
.reason-text {
  display: block;
  font-family: var(--font-body);
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--muted);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
