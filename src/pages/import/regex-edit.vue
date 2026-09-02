<template>
  <view class="edit-container">
    <NavBar title="编辑正侧" :subtitle="form.name || '未命名正侧'" />
    <scroll-view class="edit-scroll" scroll-y :style="{ paddingTop: (navBarHeight + 16) + 'px' }">
      <view class="section">
        <text class="section-title">基础信息</text>
        <view class="form-item">
          <text class="label">正侧名称</text>
          <input class="input" v-model="form.name" />
        </view>
      </view>

      <view class="section">
        <view class="section-header">
          <text class="section-title">脚本列表（{{ form.scripts.length }} 条）</text>
          <view class="add-btn" @tap="onAddScript">
            <text class="add-btn-text">+ 新增</text>
          </view>
        </view>
        <view v-if="form.scripts.length === 0" class="empty-hint">
          <text>暂无正则脚本，点击"新增"添加</text>
        </view>
        <view v-for="(script, idx) in form.scripts" :key="script.id" class="script-item">
          <view class="script-item-header" @tap="toggleExpand(idx)">
            <switch :checked="!script.disabled" @change="(e:any) => onToggleEnabled(idx, e.detail.value)" @tap.stop="() => {}" color="#cfa54d" style="transform: scale(0.75)" />
            <text class="script-name">{{ script.scriptName || '(未命名)' }}</text>
            <text class="script-delete" @tap.stop="onDeleteScript(idx)">✕</text>
          </view>
          <view v-if="expandedIdx === idx" class="script-item-body" @tap.stop="() => {}">
            <view class="mini-field">
              <text class="mini-label">脚本名称</text>
              <input class="mini-input" v-model="script.scriptName" />
            </view>
            <view class="mini-field">
              <text class="mini-label">查找正则</text>
              <input class="mini-input" v-model="script.findRegex" placeholder="如 \\[(.*?)\\]" />
            </view>
            <view class="mini-field">
              <text class="mini-label">替换为</text>
              <input class="mini-input" v-model="script.replaceString" placeholder="支持 $1 反向引用" />
            </view>
            <view class="mini-field">
              <text class="mini-label">作用位置</text>
              <view class="placement-row">
                <text
                  v-for="p in placementOptions"
                  :key="p.value"
                  :class="['placement-tag', script.placement.includes(p.value) ? 'active' : '']"
                  @tap="onTogglePlacement(idx, p.value)"
                >{{ p.label }}</text>
              </view>
            </view>
          </view>
        </view>
      </view>
    </scroll-view>

    <view class="footer">
      <view class="save-btn" @tap="onSave">
        <text class="save-text">保存</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useRegexPresetStore, type RegexPreset } from '../../stores/regexPresetStore'
import { getNavBarHeight } from '../../utils/navbar.js'
import NavBar from '../../components/common/NavBar.vue'
import type { RegexScript, RegexPlacement } from '../../types/script'

const regexPresetStore = useRegexPresetStore()
const navBarHeight = ref(0)
const expandedIdx = ref(-1)

const placementOptions: { value: RegexPlacement; label: string }[] = [
  { value: 1, label: '用户输入' },
  { value: 0, label: 'AI 输出' },
  { value: 2, label: '世界信息' },
  { value: 3, label: '推理内容' }
]

const form = reactive<RegexPreset>({
  id: '',
  name: '',
  scripts: [],
  createdAt: 0,
  updatedAt: 0
})

onLoad((options: any) => {
  navBarHeight.value = getNavBarHeight().navBarHeight
  regexPresetStore.load()
  const id = options?.id
  if (id) {
    const existing = regexPresetStore.get(id)
    if (existing) {
      Object.assign(form, JSON.parse(JSON.stringify(existing)))
    }
  }
  if (!form.id) {
    form.id = 'regex_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    form.createdAt = Date.now()
  }
})

function toggleExpand(idx: number) {
  expandedIdx.value = expandedIdx.value === idx ? -1 : idx
}

function onToggleEnabled(idx: number, checked: boolean) {
  form.scripts[idx].disabled = !checked
}

function onTogglePlacement(idx: number, value: number) {
  const script = form.scripts[idx]
  const pos = script.placement.indexOf(value as any)
  if (pos >= 0) script.placement.splice(pos, 1)
  else script.placement.push(value as any)
}

function onAddScript() {
  const script: RegexScript = {
    id: 'script_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    scriptName: '新脚本',
    findRegex: '',
    replaceString: '',
    trimStrings: [],
    placement: [0],
    disabled: false
  }
  form.scripts.push(script)
  expandedIdx.value = form.scripts.length - 1
}

function onDeleteScript(idx: number) {
  uni.showModal({
    title: '删除脚本',
    content: '确定要删除这条正则脚本吗？',
    success: (res: any) => {
      if (res.confirm) {
        form.scripts.splice(idx, 1)
        if (expandedIdx.value === idx) expandedIdx.value = -1
      }
    }
  })
}

function onSave() {
  if (!form.name.trim()) {
    uni.showToast({ title: '请输入正侧名称', icon: 'none' })
    return
  }
  form.updatedAt = Date.now()
  regexPresetStore.save(JSON.parse(JSON.stringify(form)))
  uni.showToast({ title: '已保存', icon: 'success' })
  setTimeout(() => uni.navigateBack(), 800)
}
</script>

<style scoped>
.edit-container { display: flex; flex-direction: column; height: 100vh; background: var(--bg-deep); }
.edit-scroll { flex: 1; padding: 20rpx; min-height: 0; box-sizing: border-box; }
.section { margin-bottom: 30rpx; background: var(--surface); border: 1rpx solid var(--border); border-radius: 20rpx; padding: 24rpx; overflow: hidden; box-sizing: border-box; }
.section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12rpx; }
.section-title { font-family: var(--font-body); font-size: 24rpx; font-weight: 700; color: var(--fg); margin-bottom: 12rpx; }
.add-btn { padding: 10rpx 18rpx; background: color-mix(in oklch, var(--success) 14%, transparent); border: 1rpx solid var(--success); border-radius: 14rpx; }
.add-btn-text { font-size: 21rpx; color: var(--success); font-weight: 600; }
.form-item { margin-bottom: 18rpx; }
.label { display: block; font-size: 22rpx; color: var(--fg-soft); margin-bottom: 10rpx; }
.input { height: 76rpx; background: var(--surface-2); border: 1rpx solid var(--border); border-radius: 16rpx; padding: 0 20rpx; font-size: 24rpx; color: var(--fg); box-sizing: border-box; width: 100%; }
.script-item { background: var(--surface-2); border: 1rpx solid var(--border); border-radius: 16rpx; margin-bottom: 12rpx; padding: 16rpx 20rpx; }
.script-item-header { display: flex; align-items: center; gap: 10rpx; }
.script-name { flex: 1; min-width: 0; font-size: 23rpx; color: var(--fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.script-delete { font-size: 22rpx; color: var(--danger); padding: 0 6rpx; }
.script-item-body { margin-top: 16rpx; }
.mini-field { margin-bottom: 14rpx; }
.mini-label { display: block; font-size: 20rpx; color: var(--faint); margin-bottom: 8rpx; }
.mini-input { width: 100%; height: 56rpx; background: var(--surface); border: 1rpx solid var(--border); border-radius: 10rpx; padding: 0 14rpx; font-size: 22rpx; color: var(--fg); box-sizing: border-box; }
.placement-row { display: flex; gap: 10rpx; flex-wrap: wrap; }
.placement-tag { font-size: 20rpx; color: var(--faint); padding: 8rpx 18rpx; background: var(--surface); border: 1rpx solid var(--border); border-radius: 20rpx; }
.placement-tag.active { color: var(--accent); background: var(--accent-soft); border-color: var(--accent); font-weight: 600; }
.empty-hint { padding: 30rpx; text-align: center; color: var(--faint); font-size: 22rpx; }
.footer { padding: 20rpx 30rpx; padding-bottom: calc(20rpx + env(safe-area-inset-bottom)); background: oklch(18% 0.013 70 / 0.92); border-top: 1rpx solid var(--border); flex: none; }
.save-btn { height: 84rpx; background: linear-gradient(135deg, var(--accent), var(--accent-strong)); border-radius: 42rpx; display: flex; align-items: center; justify-content: center; box-shadow: 0 20rpx 44rpx -18rpx oklch(75% 0.14 80 / 0.6); }
.save-text { font-size: 25rpx; color: #171104; font-weight: 700; }
</style>