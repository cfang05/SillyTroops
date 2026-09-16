<template>
  <!-- 上下文详情弹窗（P3.4 / D14 完整版）
       入口藏在「设置」页里，不占用聊天主界面；只读展示，不提供编辑。 -->
  <view v-if="visible" class="ci-mask" @tap="emit('close')">
    <view class="ci-panel" @tap.stop>
      <view class="ci-header">
        <text class="ci-title">上下文详情</text>
        <text class="ci-close" @tap="emit('close')">关闭</text>
      </view>

      <scroll-view scroll-y class="ci-body">
        <view v-if="!snapshots.length" class="ci-empty">
          <text class="ci-empty-text">还没有记录。去聊一句，这里就会显示"这次到底发了什么"。</text>
        </view>

        <template v-else>
          <!-- 最近几次快照（默认最新） -->
          <view class="ci-chips" v-if="snapshots.length > 1">
            <text
              v-for="(s, i) in snapshots"
              :key="i"
              class="ci-chip"
              :class="{ 'ci-chip-active': i === selected }"
              @tap="selected = i"
            >{{ i === 0 ? '最新' : relativeTime(i) }}</text>
          </view>

          <!-- 告警条：发生裁剪 / 强制项超预算 -->
          <view v-if="current.overflowMandatory" class="ci-alert ci-alert-danger">
            <text class="ci-alert-text">⚠️ 系统提示词 + 本次消息已超出预算（{{ current.used }} / {{ current.budget }}），历史已被全部省略。请调大预设的「上下文长度」或减小「最大回复长度」。</text>
          </view>
          <view v-else-if="current.historyDropped > 0" class="ci-alert">
            <text class="ci-alert-text">本次已省略最早的 {{ current.historyDropped }} 条历史（共 {{ current.historyTotal }} 条，进入上下文 {{ current.historyKept }} 条）。存档与页面显示不受影响。</text>
          </view>
          <view v-else-if="budgetTooSmall" class="ci-alert">
            <text class="ci-alert-text">预算偏小（{{ current.budget }} tokens）：「最大回复长度」占窗口比例偏高，长对话很快就会被裁。建议调大预设的「上下文长度」或减小「最大回复长度」。</text>
          </view>

          <!-- 总览 -->
          <view class="ci-card">
            <view class="ci-metrics">
              <view class="ci-metric">
                <text class="ci-metric-num">{{ current.maxContext }}</text>
                <text class="ci-metric-label">模型窗口</text>
              </view>
              <view class="ci-metric">
                <text class="ci-metric-num">{{ current.budget }}</text>
                <text class="ci-metric-label">可用预算</text>
              </view>
              <view class="ci-metric">
                <text class="ci-metric-num ci-metric-strong">{{ current.used }}</text>
                <text class="ci-metric-label">实际用量</text>
              </view>
              <view class="ci-metric">
                <text class="ci-metric-num">{{ usagePercent }}%</text>
                <text class="ci-metric-label">窗口占用</text>
              </view>
            </view>
            <text class="ci-hint">预算 = 窗口 − 回复预留({{ current.reservedResponse }}) − 安全余量({{ current.safetyMargin }})。token 为本地估算，仅用于预算与占比；监控页的用量来自上游真实值。</text>
          </view>

          <!-- 占比（移动端用横向条形列表，替代酒馆的堆叠柱状图） -->
          <text class="ci-section-title">构成占比</text>
          <view class="ci-card">
            <view v-for="(row, i) in mainRows" :key="row.name" class="ci-bar-row">
              <view class="ci-dot" :style="{ background: colorOf(i) }"></view>
              <text class="ci-bar-name">{{ row.name }}</text>
              <view class="ci-bar-track">
                <view class="ci-bar-fill" :style="{ width: barWidth(row.tokens), background: colorOf(i) }"></view>
              </view>
              <text class="ci-bar-value">{{ row.tokens }}</text>
              <text class="ci-bar-percent">{{ percentOf(row.tokens) }}%</text>
            </view>
          </view>

          <!-- 逐项明细（detail 为「其中」子项，不参与求和） -->
          <text class="ci-section-title">逐项明细</text>
          <view class="ci-card">
            <view v-for="row in current.sections" :key="row.name" class="ci-row" :class="{ 'ci-row-detail': row.kind === 'detail' }">
              <text class="ci-row-name">{{ row.name }}</text>
              <text class="ci-row-msg" v-if="row.messages > 0">{{ row.messages }} 条</text>
              <text class="ci-row-tokens">{{ row.tokens }}</text>
            </view>
          </view>

          <!-- 与上一次对比 -->
          <view v-if="selected + 1 < snapshots.length" class="ci-card">
            <view class="ci-toggle" @tap="showDiff = !showDiff">
              <text class="ci-toggle-text">{{ showDiff ? '收起差异' : '与上一次对比（' + relativeTime(selected + 1) + '）' }}</text>
            </view>
            <view v-if="showDiff" class="ci-diff">
              <view v-for="(line, i) in diffLines" :key="i" class="ci-diff-line">
                <text class="ci-diff-sign" :class="'ci-diff-' + line.type">{{ line.type === 'added' ? '+' : (line.type === 'removed' ? '-' : ' ') }}</text>
                <text class="ci-diff-text" :class="'ci-diff-' + line.type">{{ line.text }}</text>
              </view>
              <text v-if="!diffLines.length" class="ci-hint">两次内容完全一致。</text>
            </view>
          </view>

          <!-- 原始 prompt -->
          <view class="ci-card">
            <view class="ci-toggle" @tap="showRaw = !showRaw">
              <text class="ci-toggle-text">{{ showRaw ? '收起原始内容' : '查看原始内容（' + current.rawPrompt.length + ' 字符）' }}</text>
            </view>
            <view v-if="showRaw">
              <text class="ci-raw">{{ current.rawPrompt }}</text>
              <view class="ci-copy" @tap="copyRaw"><text class="ci-copy-text">复制全部</text></view>
            </view>
          </view>
        </template>
      </scroll-view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { listPromptInfo, listRecentPromptInfo, type StoredPromptInfo } from '../../services/promptInfoStore'

const props = defineProps<{
  visible: boolean
  /**
   * 只看某个对话的快照（聊天页传入当前角色卡 id）。
   * 不传时展示**所有对话的最近几次请求**（设置页入口用这个，更实用）。
   */
  chatId?: string
}>()

const emit = defineEmits<{ close: [] }>()

const snapshots = ref<StoredPromptInfo[]>([])
const selected = ref(0)
const showRaw = ref(false)
const showDiff = ref(false)

const PALETTE = ['#cfa54d', '#7fb3d5', '#88c9a1', '#d98880', '#b39ddb', '#a1887f', '#90a4ae']

const current = computed<StoredPromptInfo>(() => snapshots.value[selected.value] || ({} as StoredPromptInfo))
const mainRows = computed(() => (current.value.sections || []).filter(s => s.kind !== 'detail'))
const usagePercent = computed(() => {
  const cur = current.value
  if (!cur || !cur.maxContext) return 0
  return Math.round(((cur.used || 0) / cur.maxContext) * 100)
})

function colorOf(i: number) {
  return PALETTE[i % PALETTE.length]
}

/** 预算过小提示：回复预留吃掉窗口 1/3 以上、或预算不足 1K 时给出建议 */
const budgetTooSmall = computed(() => {
  const cur = current.value
  if (!cur || !cur.maxContext) return false
  if (cur.reservedResponse > cur.maxContext / 3) return true
  return (cur.budget || 0) < 1024
})
function percentOf(tokens: number) {
  const cur = current.value
  if (!cur || !cur.maxContext) return 0
  return Math.round((tokens / cur.maxContext) * 100)
}
function barWidth(tokens: number) {
  const cur = current.value
  if (!cur || !cur.maxContext) return '0%'
  return Math.min(100, Math.round((tokens / cur.maxContext) * 100)) + '%'
}

/** 相对时间（第 i 条快照，0 为最新） */
function relativeTime(i: number) {
  const cur = snapshots.value[i]
  const prev = snapshots.value[i - 1]
  if (!cur) return ''
  const d = new Date(cur.createdAt)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  // 同一天的靠时间区分，跨天的带上日期
  const sameDay = prev && new Date(prev.createdAt).toDateString() === d.toDateString()
  return sameDay ? `${hh}:${mm}:${ss}` : `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`
}

/**
 * 与上一条快照的差异：按行做"出现次数"对比。
 * 不做 LCS —— 对"这轮多发了什么/少发了什么"这个用途足够，且实现简单、无性能风险。
 */
const diffLines = computed(() => {
  const next = snapshots.value[selected.value + 1]
  if (!next) return []
  const before = (next.rawPrompt || '').split('\n')
  const after = (current.value.rawPrompt || '').split('\n')
  const count = (arr: string[]) => {
    const m = new Map<string, number>()
    arr.forEach(l => m.set(l, (m.get(l) || 0) + 1))
    return m
  }
  const bc = count(before)
  const out: { type: 'same' | 'added' | 'removed'; text: string }[] = []
  const used = new Map<string, number>()
  after.forEach(l => {
    const remaining = (bc.get(l) || 0) - (used.get(l) || 0)
    if (remaining > 0) {
      used.set(l, (used.get(l) || 0) + 1)
      out.push({ type: 'same', text: l })
    } else {
      out.push({ type: 'added', text: l })
    }
  })
  const ac = count(after)
  const used2 = new Map<string, number>()
  before.forEach(l => {
    const remaining = (ac.get(l) || 0) - (used2.get(l) || 0)
    if (remaining > 0) {
      used2.set(l, (used2.get(l) || 0) + 1)
    } else {
      out.push({ type: 'removed', text: l })
    }
  })
  // 只展示变化行，避免刷屏
  const changed = out.filter(l => l.type !== 'same')
  return changed.slice(0, 200)
})

function copyRaw() {
  const text = current.value.rawPrompt || ''
  try {
    uni.setClipboardData({ data: text })
  } catch (e) {
    console.warn('[ContextInspector] 复制失败:', e)
  }
}

async function load() {
  selected.value = 0
  showRaw.value = false
  showDiff.value = false
  if (props.chatId) {
    snapshots.value = await listPromptInfo(props.chatId)
  } else {
    // 设置页入口：不知道当前对话是谁，直接给"最近几次请求"
    snapshots.value = await listRecentPromptInfo(20)
  }
}

watch(() => props.visible, (v) => { if (v) load() })
watch(() => props.chatId, () => { if (props.visible) load() })
</script>

<style scoped>
.ci-mask {
  position: fixed; left: 0; right: 0; top: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.55); z-index: 900;
  display: flex; flex-direction: column;
}
.ci-panel {
  margin: 40px 10px 10px 10px; flex: 1; min-height: 0;
  background: var(--bg); border: 1px solid var(--border-strong); border-radius: 14px;
  display: flex; flex-direction: column; overflow: hidden;
}
.ci-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px; border-bottom: 1px solid var(--border);
}
.ci-title { font-family: var(--font-body); font-size: 14px; font-weight: 700; color: var(--fg); }
.ci-close { font-size: 12px; color: var(--accent); padding: 4px 8px; }
.ci-body { flex: 1; min-height: 0; padding: 12px 12px 24px; box-sizing: border-box; }
.ci-empty { padding: 40px 16px; }
.ci-empty-text { font-size: 12px; color: var(--faint); line-height: 1.7; }

.ci-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.ci-chip {
  font-family: var(--font-mono); font-size: 10px; color: var(--muted);
  background: var(--surface); border: 1px solid var(--border); border-radius: 999px; padding: 4px 10px;
}
.ci-chip-active { color: #1c1204; background: var(--accent); border-color: var(--accent); font-weight: 700; }

.ci-alert { background: var(--accent-soft); border: 1px solid color-mix(in oklch, var(--accent) 35%, transparent); border-radius: 10px; padding: 9px 11px; margin-bottom: 10px; }
.ci-alert-danger { background: color-mix(in oklch, #d98880 18%, transparent); border-color: color-mix(in oklch, #d98880 45%, transparent); }
.ci-alert-text { font-size: 11.5px; color: var(--fg-soft); line-height: 1.65; }

.ci-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 11px; margin-bottom: 10px; }
.ci-metrics { display: flex; flex-wrap: wrap; }
.ci-metric { width: 25%; display: flex; flex-direction: column; align-items: center; padding: 4px 0; box-sizing: border-box; }
.ci-metric-num { font-family: var(--font-mono); font-size: 14px; color: var(--fg); font-weight: 700; }
.ci-metric-strong { color: var(--accent); }
.ci-metric-label { font-size: 10px; color: var(--faint); margin-top: 2px; }
.ci-hint { display: block; font-size: 10.5px; color: var(--faint); line-height: 1.6; margin-top: 8px; }

.ci-section-title { display: block; font-size: 11px; font-weight: 700; color: var(--muted); margin: 12px 2px 6px; letter-spacing: .04em; }

.ci-bar-row { display: flex; align-items: center; gap: 6px; padding: 5px 0; }
.ci-dot { width: 8px; height: 8px; border-radius: 2px; flex: none; }
.ci-bar-name { width: 74px; flex: none; font-size: 11px; color: var(--fg-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ci-bar-track { flex: 1; min-width: 0; height: 8px; background: var(--bg-deep); border-radius: 999px; overflow: hidden; }
.ci-bar-fill { height: 100%; border-radius: 999px; }
.ci-bar-value { width: 42px; flex: none; text-align: right; font-family: var(--font-mono); font-size: 10.5px; color: var(--fg-soft); }
.ci-bar-percent { width: 34px; flex: none; text-align: right; font-family: var(--font-mono); font-size: 10.5px; color: var(--faint); }

.ci-row { display: flex; align-items: center; padding: 5px 0; border-bottom: 1px solid color-mix(in oklch, var(--border) 60%, transparent); }
.ci-row:last-child { border-bottom: none; }
.ci-row-detail { padding-left: 12px; }
.ci-row-detail .ci-row-name { color: var(--faint); font-size: 10.5px; }
.ci-row-name { flex: 1; min-width: 0; font-size: 11.5px; color: var(--fg-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ci-row-msg { flex: none; font-size: 10px; color: var(--faint); margin-right: 8px; }
.ci-row-tokens { flex: none; font-family: var(--font-mono); font-size: 11px; color: var(--fg); }

.ci-toggle { padding: 2px 0; }
.ci-toggle-text { font-size: 11.5px; color: var(--accent); }
.ci-diff { margin-top: 8px; max-height: 260px; }
.ci-diff-line { display: flex; align-items: flex-start; }
.ci-diff-sign { width: 12px; flex: none; font-family: var(--font-mono); font-size: 10.5px; }
.ci-diff-text { flex: 1; min-width: 0; font-family: var(--font-mono); font-size: 10.5px; word-break: break-all; }
.ci-diff-added { color: #88c9a1; }
.ci-diff-removed { color: #d98880; }
.ci-raw { display: block; font-family: var(--font-mono); font-size: 10.5px; color: var(--fg-soft); line-height: 1.6; white-space: pre-wrap; word-break: break-all; margin-top: 8px; max-height: 320px; overflow: hidden; }
.ci-copy { margin-top: 8px; align-self: flex-start; }
.ci-copy-text { font-size: 11.5px; color: var(--accent); }
</style>
