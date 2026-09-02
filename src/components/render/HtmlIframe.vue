<!-- #ifdef H5 -->
<template>
  <view class="html-iframe-wrap">
    <iframe
      class="html-iframe"
      :srcdoc="sanitizedContent"
      sandbox="allow-same-origin"
      frameborder="0"
    />
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { sanitizeHtml } from '../../utils/security'

const props = defineProps<{
  content: string
}>()

const sanitizedContent = computed(() => sanitizeHtml(props.content))
</script>

<style scoped>
.html-iframe-wrap {
  margin-top: 8px;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--border);
}
.html-iframe {
  width: 100%;
  min-height: 100px;
  border: none;
  background: #fff;
}
</style>
<!-- #endif -->