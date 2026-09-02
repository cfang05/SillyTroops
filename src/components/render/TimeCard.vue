<template>
  <view class="time-card">
    <text class="time-icon">🕐</text>
    <view class="time-info">
      <text v-if="date" class="time-date">{{ date }}</text>
      <text v-if="time" class="time-time">{{ time }}</text>
      <text v-if="scene" class="time-scene">{{ scene }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
defineProps<{
  date: string
  time: string
  scene: string
}>()
</script>

<style scoped>
.time-card {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: color-mix(in oklch, var(--t-violet) 9%, transparent);
  border: 1px solid color-mix(in oklch, var(--t-violet) 32%, transparent);
  border-radius: 12px;
}
.time-icon {
  font-size: 13px;
}
.time-info {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.time-date,
.time-time,
.time-scene {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--t-violet);
  letter-spacing: .02em;
}
</style>