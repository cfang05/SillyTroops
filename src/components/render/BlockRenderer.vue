<template>
  <view class="block-renderer">
    <template v-for="(node, idx) in nodes" :key="idx">
      <BranchSelector
        v-if="node.type === 'branch' && pluginStore.renderers.branch"
        :options="node.options"
        @select="onBranchSelect"
      />
      <FallbackText
        v-else-if="node.type === 'branch'"
        :content="'[选项: ' + node.options.join(' / ') + ']'"
      />

      <SummaryCard
        v-else-if="node.type === 'summary' && pluginStore.renderers.summary"
        :content="node.content"
      />
      <FallbackText
        v-else-if="node.type === 'summary'"
        :content="node.content"
      />

      <TimeCard
        v-else-if="node.type === 'time' && pluginStore.renderers.time"
        :date="node.date"
        :time="node.time"
        :scene="node.scene"
      />
      <FallbackText
        v-else-if="node.type === 'time'"
        :content="[node.date, node.time, node.scene].filter(Boolean).join(' ')"
      />

      <!-- #ifdef H5 -->
      <HtmlIframe
        v-else-if="node.type === 'html' && pluginStore.renderers.html"
        :content="node.content"
      />
      <!-- #endif -->
      <FallbackText
        v-else-if="node.type === 'html'"
        content="[自定义 HTML 内容，请使用 Web 端查看]"
      />

      <!-- 正则脚本产出的 HTML 片段（P4.2 / D2）：
           样式出口是「自定义 CSS + class」，正则只负责产出 `<span class="say">…</span>`，
           这里负责把它真正渲染出来。H5 用净化后的 v-html（class 与全局 CSS 都生效）；
           其它端降级为纯文本，保证不会显示裸标签。 -->
      <view v-else-if="node.type === 'html-inline'" class="block-html-inline">
        <!-- #ifdef H5 -->
        <view class="block-html-inner" v-html="safeHtml(node.html)"></view>
        <!-- #endif -->
        <!-- #ifndef H5 -->
        <text class="block-html-text">{{ node.text }}</text>
        <!-- #endif -->
      </view>

      <view v-else-if="node.type === 'code'" class="block-code">
        <text class="block-code-text">{{ node.content }}</text>
      </view>

      <view v-else-if="node.type === 'speech'" class="block-speech-wrap">
        <text class="block-speech-quote">"</text>
        <RichText v-if="node.segments && node.segments.length" :segments="node.segments" speech />
        <text v-else class="block-speech">{{ node.text }}</text>
        <text class="block-speech-quote">"</text>
      </view>

      <text v-else-if="node.type === 'damage'" class="block-damage">{{ node.text }}</text>

      <RichText v-else-if="node.type === 'narrative' && node.segments && node.segments.length" :segments="node.segments" />
      <text v-else-if="node.type === 'narrative'" class="block-narrative">{{ node.text }}</text>

      <!-- Markdown 块级节点 -->
      <view v-else-if="node.type === 'rich' && node.block === 'heading'" :class="['md-heading', 'md-h' + (node.level || 1)]">
        <RichText :segments="node.segments" />
      </view>
      <view v-else-if="node.type === 'rich' && node.block === 'list-item'" class="md-list-item">
        <text class="md-bullet">•</text>
        <RichText :segments="node.segments" />
      </view>
      <view v-else-if="node.type === 'rich' && node.block === 'quote'" class="md-quote">
        <RichText :segments="node.segments" />
      </view>
      <view v-else-if="node.type === 'rich' && node.block === 'hr'" class="md-hr" />

      <!-- 开场白/正文里的 Markdown 插图 ![alt](src)。酒馆用 showdown 转成 <img>，直接支持任意
           http(s)/data: 图片地址；本地相对路径（如酒馆自身 characters/ 目录下的资源）在没有
           对应文件服务的情况下无法解析，会走 @error 回退成文字提示，行为上与"资源缺失"一致。 -->
      <view v-else-if="node.type === 'image'" class="block-image-wrap">
        <image
          v-if="!brokenImages[node.src]"
          class="block-image"
          :src="node.src"
          mode="widthFix"
          @error="onImageError(node.src)"
        />
        <text v-else class="block-image-fallback">[图片加载失败: {{ node.alt || node.src }}]</text>
      </view>
    </template>
  </view>
</template>

<script setup lang="ts">
import { reactive } from 'vue'
import { usePluginStore } from '../../stores/pluginStore'
import type { RenderNode } from '../../types/render'
import BranchSelector from './BranchSelector.vue'
import SummaryCard from './SummaryCard.vue'
import TimeCard from './TimeCard.vue'
import FallbackText from './FallbackText.vue'
import RichText from './RichText.vue'
// #ifdef H5
import HtmlIframe from './HtmlIframe.vue'
import { sanitizeHtml } from '../../utils/security'
// #endif

defineProps<{
  nodes: RenderNode[]
}>()

const emit = defineEmits<{
  select: [option: string]
}>()

const pluginStore = usePluginStore()

// 记录加载失败的图片 src，失败后展示文字兜底而不是一直显示破图图标
const brokenImages = reactive<Record<string, boolean>>({})
function onImageError(src: string) {
  brokenImages[src] = true
}

function onBranchSelect(option: string) {
  emit('select', option)
}

/**
 * 正则脚本产出的 HTML 片段 → 净化后的 HTML（P4.2）
 *
 * 加一层缓存：流式输出时同一段 HTML 会被反复渲染（每帧一次），
 * 没必要每次都跑一遍 DOMPurify。
 */
const _htmlCache = new Map<string, string>()
function safeHtml(html: string): string {
  // #ifdef H5
  const cached = _htmlCache.get(html)
  if (cached !== undefined) return cached
  let clean = ''
  try {
    clean = sanitizeHtml(html)
  } catch (e) {
    console.warn('[BlockRenderer] HTML 片段净化失败，已降级为空:', e)
    clean = ''
  }
  if (_htmlCache.size > 300) _htmlCache.clear()
  _htmlCache.set(html, clean)
  return clean
  // #endif
  // #ifndef H5
  return ''
  // #endif
}
</script>

<style scoped>
.block-renderer {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
/* 正则脚本产出的 HTML 片段（P4.2）：本身不带外观，样式由 class + 自定义 CSS 决定 */
.block-html-inline { display: block; }
.block-html-text { font-family: var(--font-body); font-size: 13px; color: var(--fg-soft); line-height: 1.6; }
.block-speech {
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--t-gold);
  font-style: italic;
  line-height: 1.6;
}
.block-damage {
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--danger);
  font-weight: 700;
  line-height: 1.6;
}
.block-narrative {
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--fg-soft);
  line-height: 1.6;
}
.block-code {
  margin: 4px 0;
  background: var(--bg-deep);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 8px 10px;
}
.block-code-text {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--success);
  line-height: 1.8;
  white-space: pre-wrap;
  word-break: break-all;
}
.block-speech-wrap {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  flex-wrap: wrap;
}
.block-speech-quote {
  font-size: 13px;
  color: var(--t-gold);
  font-style: italic;
}
.md-heading {
  margin: 6px 0 3px;
}
.md-h1 { font-family: var(--font-serif); font-size: 20px; font-weight: 900; }
.md-h2 { font-family: var(--font-serif); font-size: 18px; font-weight: 900; }
.md-h3 { font-size: 16px; font-weight: 700; }
.md-h4 { font-size: 15px; font-weight: 700; }
.md-h5 { font-size: 14px; font-weight: 700; }
.md-h6 { font-size: 13px; font-weight: 700; }
.md-list-item {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 4px;
  padding-left: 4px;
}
.md-bullet {
  font-size: 13px;
  color: var(--accent);
  line-height: 1.6;
}
.md-quote {
  border-left: 3px solid color-mix(in oklch, var(--accent) 45%, transparent);
  padding-left: 8px;
  margin: 4px 0;
  opacity: 0.9;
}
.md-hr {
  height: 1px;
  background: var(--border);
  margin: 8px 0;
}
.block-image-wrap {
  margin: 4px 0;
}
.block-image {
  max-width: 100%;
  width: 100%;
  border-radius: 10px;
}
.block-image-fallback {
  font-size: 12px;
  color: var(--faint);
  font-style: italic;
}
</style>
