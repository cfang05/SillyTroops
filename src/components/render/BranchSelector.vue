<template>
  <view class="branch-selector">
    <view
      v-for="(option, idx) in options"
      :key="idx"
      class="branch-option"
      @tap="handleSelect(option)"
    >
      <text class="branch-option-text">{{ option }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
defineProps<{
  options: string[]
}>()

const emit = defineEmits<{
  select: [option: string]
}>()

function handleSelect(option: string) {
  emit('select', option)
}
</script>

<style scoped>
.branch-selector {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}
.branch-option {
  padding: 10px 14px;
  background: var(--accent-soft);
  border: 1px solid var(--accent);
  border-radius: 12px;
  transition: background 0.2s ease;
}
.branch-option:active {
  background: color-mix(in oklch, var(--accent) 22%, transparent);
}
.branch-option-text {
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--accent);
  font-weight: 600;
}
</style>