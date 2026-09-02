<template>
  <text class="fallback-text">{{ content }}</text>
</template>

<script setup lang="ts">
defineProps<{
  content: string
}>()
</script>

<style scoped>
.fallback-text {
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--fg-soft);
  line-height: 1.6;
}
</style>