<template>
  <view class="summary-card" @tap="toggleExpand">
    <view class="summary-header">
      <text class="summary-icon">📋</text>
      <text class="summary-title">摘要</text>
      <text class="summary-toggle">{{ expanded ? '收起' : '展开' }}</text>
    </view>
    <view v-if="expanded" class="summary-body">
      <text class="summary-content">{{ content }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  content: string
}>()

const expanded = ref(false)

function toggleExpand() {
  expanded.value = !expanded.value
}
</script>

<style scoped>
.summary-card {
  margin-top: 8px;
  background: color-mix(in oklch, var(--t-gold) 9%, transparent);
  border: 1px solid color-mix(in oklch, var(--t-gold) 30%, transparent);
  border-radius: 12px;
  padding: 10px 12px;
}
.summary-header {
  display: flex;
  align-items: center;
  gap: 6px;
}
.summary-icon {
  font-size: 13px;
}
.summary-title {
  flex: 1;
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 700;
  color: var(--t-gold);
}
.summary-toggle {
  font-size: 11px;
  color: var(--faint);
}
.summary-body {
  margin-top: 8px;
}
.summary-content {
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--fg-soft);
  line-height: 1.6;
}
</style>