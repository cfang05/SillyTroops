<template>
  <view class="import-container">
    <NavBar title="酒馆导入" subtitle="角色卡 / 正侧（正则脚本） / 预设，统一在此导入" />

    <view class="tabs" :style="{ paddingTop: (navBarHeight + 16) + 'px' }">
      <view v-for="tab in tabs" :key="tab.key" :class="['tab-item', activeTab === tab.key ? 'active' : '']" @tap="activeTab = tab.key">
        <text class="tab-text">{{ tab.label }}</text>
      </view>
    </view>

    <scroll-view class="content-scroll" scroll-y>
      <!-- 角色卡导入 -->
      <view v-if="activeTab === 'character'" class="tab-panel">
        <text class="panel-desc">支持 JSON / PNG（H5）角色卡，世界书随角色卡一起导入</text>
        <view class="import-actions">
          <view class="import-btn" @tap="onImportCharacterPng">
            <text class="import-btn-text">导入 PNG 角色卡</text>
          </view>
          <view class="import-btn import-btn-secondary" @tap="onImportCharacterJson">
            <text class="import-btn-text">导入 JSON</text>
          </view>
        </view>
        <view class="result-list">
          <text class="result-title">已导入角色卡（{{ cardStore.cards.length }}）</text>
          <view v-for="card in cardStore.cards" :key="card.id" class="result-item">
            <text class="result-name">{{ card.name }}</text>
            <text class="result-meta">{{ (cardStore.getLorebook(card.id) || []).length }} 条世界书</text>
          </view>
        </view>
      </view>

      <!-- 正侧导入 -->
      <view v-if="activeTab === 'regex'" class="tab-panel">
        <text class="panel-desc">导入酒馆正则脚本 JSON（regex_scripts 数组）作为一个"正侧文件"</text>
        <text class="panel-hint">
          正则脚本按酒馆逻辑分三路来源，全部合并生效、互不覆盖：① 下方勾选"全局"的正侧文件（跨角色/跨预设一直生效）
          ② 角色卡编辑页勾选"允许使用角色卡自带正则"后，该卡自带的脚本 ③ 预设自带的正则脚本（预设编辑页维护）。
          新建对话时额外选的正侧文件也会一并合并，不会覆盖以上三路。
        </text>
        <view class="import-actions">
          <view class="import-btn" @tap="onImportRegexJson">
            <text class="import-btn-text">导入正侧 JSON</text>
          </view>
        </view>
        <view class="result-list">
          <text class="result-title">已导入正侧（{{ regexPresetStore.presets.length }}）</text>
          <view v-for="rp in regexPresetStore.presets" :key="rp.id" class="result-item">
            <view class="result-info">
              <text class="result-name">{{ (rp as any).fileName || rp.name }}</text>
              <text class="result-meta">{{ rp.scripts.length }} 条脚本</text>
            </view>
            <view class="result-global-toggle" @tap.stop="onToggleGlobalRegex(rp.id, !rp.enabledGlobal)">
              <text :class="['global-badge', rp.enabledGlobal ? 'global-badge-on' : '']">{{ rp.enabledGlobal ? '✓ 全局' : '全局' }}</text>
            </view>
            <text class="result-edit" @tap.stop="onEditRegex(rp.id)">编辑</text>
            <text class="result-delete" @tap.stop="onDeleteRegex(rp.id)">删除</text>
          </view>
        </view>
      </view>

      <!-- 预设导入 -->
      <view v-if="activeTab === 'preset'" class="tab-panel">
        <text class="panel-desc">导入酒馆预设 JSON（prompts / prompt_order 结构）</text>
        <view class="import-actions">
          <view class="import-btn" @tap="onImportPresetJson">
            <text class="import-btn-text">导入预设 JSON</text>
          </view>
        </view>
        <view class="result-list">
          <text class="result-title">已导入预设（{{ presetStore.presets.length }}）</text>
          <text class="panel-hint">默认预设会在"新建对话"未手动选择预设时自动生效</text>
          <view v-for="p in presetStore.presets" :key="p.id" class="result-item">
            <view class="result-info">
              <text class="result-name">{{ p.fileName || p.name }}</text>
              <text class="result-meta">{{ p.prompts.length }} 条 Prompt · {{ p.regexScripts.length }} 条内嵌脚本</text>
            </view>
            <text v-if="p.id === presetStore.activePresetId" class="result-active-badge">默认</text>
            <text v-else class="result-setactive" @tap.stop="onSetActivePreset(p.id)">设为默认</text>
            <text class="result-edit" @tap.stop="onEditPreset(p.id)">编辑</text>
            <text class="result-delete" @tap.stop="onDeletePreset(p.id)">删除</text>
          </view>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useCharacterCardStore } from '../../stores/characterCardStore'
import { usePresetStore } from '../../stores/presetStore'
import { useRegexPresetStore } from '../../stores/regexPresetStore'
import * as CharacterImporter from '../../adapters/character/CharacterImporter'
import * as PresetImporter from '../../adapters/preset/PresetImporter'
import { getNavBarHeight } from '../../utils/navbar.js'
import NavBar from '../../components/common/NavBar.vue'

const cardStore = useCharacterCardStore()
const presetStore = usePresetStore()
const regexPresetStore = useRegexPresetStore()
const navBarHeight = ref(0)

const tabs = [
  { key: 'character', label: '角色卡' },
  { key: 'regex', label: '正侧' },
  { key: 'preset', label: '预设' }
]
const activeTab = ref('character')

onMounted(() => {
  cardStore.loadAll()
  presetStore.load()
  regexPresetStore.load()
  navBarHeight.value = getNavBarHeight().navBarHeight
})

// ── 角色卡导入 ──────────────────────────────────────────────
function onImportCharacterPng() {
  // #ifdef H5
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.png,image/png'
  input.style.display = 'none'
  input.addEventListener('change', () => {
    const file = input.files && input.files[0]
    if (file) {
      CharacterImporter.importFromPng(file)
        .then(({ character, lorebookEntries }) => {
          cardStore.importCard(character, lorebookEntries)
          uni.showToast({ title: '导入成功', icon: 'success' })
        })
        .catch((e: any) => {
          uni.showModal({ title: '导入失败', content: e.message || 'PNG 角色卡解析失败', showCancel: false })
        })
    }
    document.body.removeChild(input)
  })
  document.body.appendChild(input)
  input.click()
  // #endif
  // #ifndef H5
  uni.showModal({ title: '暂不支持', content: '小程序端不支持 PNG 角色卡导入，请使用 JSON 格式导入', showCancel: false })
  // #endif
}

function onImportCharacterJson() {
  // #ifdef H5
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json,application/json'
  input.style.display = 'none'
  input.addEventListener('change', () => {
    const file = input.files && input.files[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = () => { _doImportCharacterJson(reader.result as string) }
      reader.readAsText(file)
    }
    document.body.removeChild(input)
  })
  document.body.appendChild(input)
  input.click()
  // #endif
  // #ifndef H5
  uni.showModal({
    title: '导入角色卡 JSON',
    content: '',
    editable: true,
    placeholderText: '粘贴角色卡 JSON 文本',
    success: (res: any) => {
      if (res.confirm && res.content) _doImportCharacterJson(res.content)
    }
  })
  // #endif
}

function _doImportCharacterJson(jsonText: string) {
  try {
    const { character, lorebookEntries } = CharacterImporter.importFromJson(jsonText)
    cardStore.importCard(character, lorebookEntries)
    uni.showToast({ title: '导入成功', icon: 'success' })
  } catch (e: any) {
    uni.showModal({ title: '导入失败', content: e.message || '角色卡格式不正确', showCancel: false })
  }
}

// ── 正侧（正则脚本）导入 ──────────────────────────────────────
function onImportRegexJson() {
  // #ifdef H5
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json,application/json'
  input.style.display = 'none'
  input.addEventListener('change', () => {
    const file = input.files && input.files[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = () => { _doImportRegexJson(reader.result as string, file.name) }
      reader.readAsText(file)
    }
    document.body.removeChild(input)
  })
  document.body.appendChild(input)
  input.click()
  // #endif
  // #ifndef H5
  uni.showModal({
    title: '导入正侧 JSON',
    content: '',
    editable: true,
    placeholderText: '粘贴正则脚本 JSON 数组文本',
    success: (res: any) => {
      if (res.confirm && res.content) _doImportRegexJson(res.content, '导入的正侧')
    }
  })
  // #endif
}

function _doImportRegexJson(jsonText: string, fileName: string) {
  try {
    const json = JSON.parse(jsonText)
    const arr = Array.isArray(json) ? json : (Array.isArray(json.regex_scripts) ? json.regex_scripts : null)
    if (!arr) throw new Error('未找到正则脚本数组（需为数组，或含 regex_scripts 字段）')
    const scripts = PresetImporter.importRegexScripts(arr)
    const name = fileName.replace(/\.json$/i, '') || '导入的正侧'
    regexPresetStore.importScripts(name, scripts)
    uni.showToast({ title: '导入成功', icon: 'success' })
  } catch (e: any) {
    uni.showModal({ title: '导入失败', content: e.message || '正侧文件格式不正确', showCancel: false })
  }
}

function onEditRegex(id: string) {
  uni.navigateTo({ url: '/pages/import/regex-edit?id=' + id })
}

/** 切换正侧文件的"全局正则"启用状态（对齐酒馆 GLOBAL 类型来源，跨角色/跨预设一直生效） */
function onToggleGlobalRegex(id: string, enabled: boolean) {
  regexPresetStore.toggleGlobal(id, enabled)
  uni.showToast({ title: enabled ? '已设为全局正则' : '已取消全局正则', icon: 'none' })
}

function onDeleteRegex(id: string) {
  uni.showModal({
    title: '删除正侧',
    content: '确定要删除这个正侧文件吗？',
    success: (res: any) => {
      if (res.confirm) {
        regexPresetStore.remove(id)
        uni.showToast({ title: '已删除', icon: 'none' })
      }
    }
  })
}

// ── 预设导入 ────────────────────────────────────────────────
function onImportPresetJson() {
  // #ifdef H5
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json,application/json'
  input.style.display = 'none'
  input.addEventListener('change', () => {
    const file = input.files && input.files[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = () => { _doImportPresetJson(reader.result as string, file.name) }
      reader.readAsText(file)
    }
    document.body.removeChild(input)
  })
  document.body.appendChild(input)
  input.click()
  // #endif
  // #ifndef H5
  uni.showModal({
    title: '导入预设 JSON',
    content: '',
    editable: true,
    placeholderText: '粘贴酒馆预设 JSON 文本',
    success: (res: any) => {
      if (res.confirm && res.content) _doImportPresetJson(res.content)
    }
  })
  // #endif
}

function _doImportPresetJson(jsonText: string, fileName?: string) {
  try {
    const json = JSON.parse(jsonText)
    const cleanFileName = fileName ? fileName.replace(/\.json$/i, '') : undefined
    const preset = PresetImporter.importFromSillyTavern(json, cleanFileName)
    presetStore.save(preset)
    uni.showToast({ title: '导入成功', icon: 'success' })
  } catch (e: any) {
    uni.showModal({ title: '导入失败', content: e.message || '预设格式不正确', showCancel: false })
  }
}

function onEditPreset(id: string) {
  uni.navigateTo({ url: '/pages/presets/edit?id=' + id })
}

function onSetActivePreset(id: string) {
  presetStore.setActive(id)
  uni.showToast({ title: '已设为默认预设', icon: 'none' })
}

function onDeletePreset(id: string) {
  uni.showModal({
    title: '删除预设',
    content: '确定要删除这个预设吗？',
    success: (res: any) => {
      if (res.confirm) {
        presetStore.remove(id)
        uni.showToast({ title: '已删除', icon: 'none' })
      }
    }
  })
}
</script>

<style scoped>
.import-container { display: flex; flex-direction: column; height: 100vh; background: var(--bg-deep); }
.tabs { display: flex; padding: 16rpx 20rpx; gap: 12rpx; border-bottom: 1rpx solid var(--border); flex: none; }
.tab-item { flex: 1; padding: 16rpx 0; text-align: center; border-radius: 14rpx; background: var(--surface); border: 1rpx solid var(--border); transition: border-color 0.2s ease, background 0.2s ease; }
.tab-item.active { background: var(--accent-soft); border-color: var(--accent); }
.tab-text { font-family: var(--font-body); font-size: 24rpx; color: var(--fg-soft); font-weight: 500; }
.tab-item.active .tab-text { color: var(--accent); font-weight: 700; }
.content-scroll { flex: 1; padding: 24rpx; min-height: 0; }
.tab-panel { display: flex; flex-direction: column; gap: 20rpx; }
.panel-desc { font-size: 21rpx; color: var(--faint); line-height: 1.5; }
.panel-hint { display: block; font-size: 19rpx; color: var(--t-gold); margin-bottom: 12rpx; line-height: 1.55; }
.import-actions { display: flex; gap: 14rpx; }
.import-btn { flex: 1; height: 76rpx; display: flex; align-items: center; justify-content: center; background: var(--accent-soft); border: 1rpx solid var(--accent); border-radius: 20rpx; text-align: center; }
.import-btn-secondary { background: var(--surface); border-color: var(--border); }
.import-btn-text { font-size: 23rpx; color: var(--accent); font-weight: 700; }
.import-btn-secondary .import-btn-text { color: var(--fg-soft); }
.result-list { margin-top: 6rpx; }
.result-title { display: block; font-size: 23rpx; color: var(--fg); font-weight: 700; margin-bottom: 14rpx; }
.result-item { display: flex; align-items: center; gap: 14rpx; padding: 20rpx; background: var(--surface); border: 1rpx solid var(--border); border-radius: 18rpx; margin-bottom: 12rpx; }
.result-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4rpx; }
.result-name { font-size: 24rpx; color: var(--fg); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.result-meta { font-family: var(--font-mono); font-size: 19rpx; color: var(--faint); }
.result-edit { font-size: 21rpx; color: var(--t-gold); flex-shrink: 0; font-weight: 600; }
.result-delete { font-size: 21rpx; color: var(--danger); flex-shrink: 0; font-weight: 600; }
.result-active-badge { font-size: 19rpx; color: var(--success); flex-shrink: 0; font-weight: 600; }
.result-setactive { font-size: 19rpx; color: var(--accent); flex-shrink: 0; font-weight: 600; }
.result-global-toggle { flex-shrink: 0; }
.global-badge { font-size: 19rpx; color: var(--faint); padding: 6rpx 16rpx; border-radius: 20rpx; background: var(--surface-2); border: 1rpx solid var(--border); }
.global-badge-on { color: var(--success); background: color-mix(in oklch, var(--success) 16%, transparent); border-color: color-mix(in oklch, var(--success) 40%, transparent); }
</style>
