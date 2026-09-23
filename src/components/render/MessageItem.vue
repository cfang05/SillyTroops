<template>
  <!-- 单条消息（P2.4 / B4）
       从 chat.vue 抽出来的目的：流式更新时只让"正在变化的那一条"重新渲染。
       配合 onChunk 的帧率节流（P2.1）与"就地修改消息对象"，父组件的 v-for
       不再读取 item.content，因此父级不会因为每个 chunk 而整体重渲染。 -->
  <view v-if="!message.hidden" class="message-wrapper" :id="'msg-' + index">
    <!-- 系统消息 -->
    <view class="message-system" v-if="message.role === 'system'">
      <view class="system-content"><text>{{ message.content }}</text></view>
    </view>

    <!-- AI 消息 -->
    <view class="message-ai" v-else-if="message.role === 'assistant'">
      <view class="avatar">
        <image v-if="characterAvatar" class="avatar-img" :src="characterAvatar" mode="aspectFill" />
        <text v-else class="avatar-text">AI</text>
      </view>
      <view class="ai-bubble-col">
        <!-- 思考折叠块（P6.3）：没有思考时不渲染 -->
        <ReasoningBlock
          v-if="reasoningText"
          :text="reasoningText"
          :streaming="!!message.isStreaming && !message.reasoningDone && !message.content"
          :duration-ms="message.reasoningDurationMs"
          :has-content="!!message.content"
        />
        <view class="bubble" @longpress="emit('longpress', index)">
          <BlockRenderer
            v-if="message.segments && message.segments.length > 0"
            :nodes="message.segments"
            @select="(opt: string) => emit('branch-select', opt)"
          />
          <text v-else class="message-text">{{ message.content }}<text v-if="message.isStreaming" class="stream-cursor">▋</text></text>
        </view>
        <view class="swipe-row" v-if="message.swipes && message.swipes.length > 1 && !message.isStreaming">
          <text class="swipe-arrow" :class="(message.swipe_id || 0) <= 0 ? 'swipe-arrow-disabled' : ''" @tap="emit('swipe-prev', index)">‹</text>
          <text class="swipe-count">{{ (message.swipe_id || 0) + 1 }}/{{ message.swipes.length }}</text>
          <text class="swipe-arrow" @tap="emit('swipe-next', index)">›</text>
        </view>
      </view>
    </view>

    <!-- 用户消息 -->
    <view class="message-user" v-else-if="message.role === 'user'">
      <view class="bubble" @longpress="emit('longpress', index)">
        <text class="message-text">{{ message.content }}</text>
      </view>
      <view class="avatar">
        <image v-if="personaAvatar" class="avatar-img" :src="personaAvatar" mode="aspectFill" />
        <text v-else class="avatar-text">{{ personaFirstName || '我' }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import BlockRenderer from './BlockRenderer.vue'
import ReasoningBlock from './ReasoningBlock.vue'
import { computed } from 'vue'
import type { ChatMessage } from '../../types/message'

const props = defineProps<{
  message: ChatMessage
  /** 该消息在完整消息数组中的真实下标（窗口渲染时不能直接用 v-for 的下标） */
  index: number
  characterAvatar?: string
  personaAvatar?: string
  personaFirstName?: string
}>()

/** 思考文本：优先用"显示态"（应用过 REASONING 正则），没有则用原文 */
const reasoningText = computed(() => props.message.reasoningDisplay || props.message.reasoning || '')

const emit = defineEmits<{
  longpress: [index: number]
  'branch-select': [option: string]
  'swipe-prev': [index: number]
  'swipe-next': [index: number]
}>()
</script>

<style scoped>
.message-wrapper { }
.message-system { display: flex; justify-content: center; }
.system-content { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 6px 12px; max-width: 260px; }
.system-content text { font-family: var(--font-mono); font-size: 9.5px; color: var(--faint); letter-spacing: .06em; line-height: 1.5; }

.message-ai { display: flex; align-items: flex-start; gap: 9px; }
.message-ai .avatar {
  width: 32px; height: 32px; border-radius: 10px; flex: none; overflow: hidden;
  background: linear-gradient(160deg, oklch(68% 0.16 40), oklch(46% 0.12 20));
  border: 1px solid oklch(80% 0.1 45 / 0.5);
  display: flex; align-items: center; justify-content: center;
}
.avatar-img { width: 100%; height: 100%; }
.avatar-text { font-family: var(--font-serif); font-size: 12px; font-weight: 900; color: #1b0b05; }
/* AI 消息：头像左置；ai-bubble-col 占满剩余宽度，泡泡本身按内容宽度收缩 */
.ai-bubble-col { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0; }
/* 泡泡宽度跟随文字内容（不再占满整行）；远端留白交给下方两侧各自的上限控制 */
.bubble { width: fit-content; background: var(--surface); border: 1px solid var(--border); border-radius: 15px; border-top-left-radius: 5px; padding: 11px 13px; }
/* 两端镜像、远端各留16px：
   - AI 泡泡在 ai-bubble-col 内，列右缘即消息行右缘，上限 calc(100% - 16px)
     → 最宽时右端距行右缘正好 16px（= 消息宽 - 头像32 - 间距9 - 16）
   - 用户泡泡所在行右端含头像32px+间距9px，上限 calc(100% - 57px)（57=16+9+32）
     → 最宽时左端距行左缘也正好 16px；两侧最大像素宽度相同（消息宽-57px），完全镜像 */
.message-ai .bubble { max-width: calc(100% - 16px); }
.message-user .bubble { max-width: calc(100% - 57px); }
.swipe-row { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 2px; }
.swipe-arrow { font-family: var(--font-mono); font-size: 15px; color: var(--accent); font-weight: 700; padding: 0 4px; }
.swipe-arrow-disabled { color: var(--faint); opacity: .4; }
.swipe-count { font-family: var(--font-mono); font-size: 9.5px; color: var(--faint); letter-spacing: .04em; }

/* 用户消息：普通 row + justify-content:flex-end，avatar 作为行内最后一个子元素，
   右边缘始终贴行右缘（= 屏幕右缘 14px），与左侧 AI 头像（14px）镜像对称 */
.message-user { display: flex; align-items: flex-start; justify-content: flex-end; flex-direction: row; gap: 9px; }
.message-user .bubble {
  background: linear-gradient(135deg, oklch(78% 0.12 84 / 0.9), oklch(66% 0.14 74 / 0.9));
  color: #1c1204; font-weight: 500;
  border-radius: 15px; border-top-right-radius: 5px; border: none;
}
.message-user .avatar {
  width: 32px; height: 32px; border-radius: 10px; flex: none; overflow: hidden;
  background: var(--raised); border: 1px solid var(--border-strong);
  display: flex; align-items: center; justify-content: center;
}
.message-user .avatar-text { font-family: var(--font-serif); font-size: 12px; font-weight: 900; color: var(--fg-soft); }
.message-text { font-family: var(--font-body); font-size: 13px; color: inherit; line-height: 1.65; }
.stream-cursor { display: inline-block; color: var(--accent); animation: blink 900ms step-end infinite; }
@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
</style>
