<template>
  <text :class="speech ? 'rich-text rich-speech' : 'rich-text'">
    <text
      v-for="(seg, i) in segments"
      :key="i"
      :class="{
        'rich-bold': seg.bold,
        'rich-italic': seg.italic,
        'rich-strike': seg.strike,
        'rich-code': seg.code
      }"
    >{{ seg.text }}</text>
  </text>
</template>

<script setup lang="ts">
import type { InlineSegment } from '../../types/render'

defineProps<{
  segments: InlineSegment[]
  /** 台词模式：黄色斜体（与 block-speech 一致） */
  speech?: boolean
}>()
</script>

<style scoped>
.rich-text {
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--fg-soft);
  line-height: 1.6;
}
.rich-speech {
  color: var(--t-gold);
  font-style: italic;
}
.rich-bold {
  font-weight: 700;
}
.rich-italic {
  font-style: italic;
}
.rich-strike {
  text-decoration: line-through;
  color: var(--faint);
}
.rich-code {
  font-family: var(--font-mono);
  color: var(--success);
}
</style>
