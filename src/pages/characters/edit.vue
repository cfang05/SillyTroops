<template>
  <view class="edit-container">
    <NavBar title="编辑角色卡" :subtitle="form.name || '未命名'" />
    <scroll-view class="edit-scroll" scroll-y :style="{ paddingTop: (navBarHeight + 16) + 'px' }">
      <!-- 对应酒馆 character_name_pole -->
      <view class="field-block">
        <text class="field-label">Name</text>
        <input class="field-input" :value="form.name" @input="(e:any)=>form.name=e.detail.value" placeholder="Name this character" />
      </view>

      <!-- 对应酒馆 tagInput / tagList -->
      <view class="field-block">
        <text class="field-label">Tags</text>
        <input class="field-input" :value="tagsText" @input="onTagsInput" placeholder="逗号分隔，如：奇幻,冒险" />
      </view>

      <!-- 对应酒馆 creator_notes_spoiler（Creator's Notes，显示在角色列表中） -->
      <view class="field-block">
        <view class="field-header" @tap="toggle('creatorNotes')">
          <text class="field-label">Creator's Notes</text>
          <text class="field-toggle">{{ expanded.creatorNotes ? '−' : '+' }}</text>
        </view>
        <textarea v-if="expanded.creatorNotes" class="field-textarea" :value="form.creator_notes" @input="(e:any)=>form.creator_notes=e.detail.value" placeholder="(Describe the bot, give use tips, or list the chat models it has been tested on. This will be displayed in the character list.)" />
      </view>

      <!-- 对应酒馆 description_textarea -->
      <view class="field-block">
        <view class="field-header" @tap="toggle('description')">
          <text class="field-label">Description</text>
          <text class="field-toggle">{{ expanded.description ? '−' : '+' }}</text>
        </view>
        <textarea v-if="expanded.description" class="field-textarea" :value="form.description" @input="(e:any)=>form.description=e.detail.value" placeholder="Describe your character's physical and mental traits here." />
      </view>

      <!-- 对应酒馆 firstmessage_textarea + Alt. Greetings -->
      <view class="field-block">
        <view class="field-header" @tap="toggle('first_mes')">
          <text class="field-label">First message</text>
          <text class="field-toggle">{{ expanded.first_mes ? '−' : '+' }}</text>
        </view>
        <textarea v-if="expanded.first_mes" class="field-textarea" :value="form.first_mes" @input="(e:any)=>form.first_mes=e.detail.value" placeholder="This will be the first message from the character that starts every chat." />
      </view>

      <view class="field-block">
        <view class="field-header" @tap="toggle('altGreetings')">
          <text class="field-label">Alt. Greetings（{{ altGreetings.length }}）</text>
          <text class="field-toggle">{{ expanded.altGreetings ? '−' : '+' }}</text>
        </view>
        <view v-if="expanded.altGreetings">
          <view v-for="(g, gi) in altGreetings" :key="gi" class="alt-greeting-item">
            <textarea class="field-textarea alt-greeting-textarea" :value="g" @input="(e:any)=>onAltGreetingInput(gi, e.detail.value)" />
            <text class="alt-greeting-delete" @tap="onDeleteAltGreeting(gi)">✕ 删除</text>
          </view>
          <view class="add-mini-btn" @tap="onAddAltGreeting">
            <text class="add-mini-text">+ Add</text>
          </view>
        </view>
      </view>

      <!-- ===== Advanced Definitions ===== -->
      <view class="section-divider"><text>Advanced Definitions</text></view>

      <!-- Prompt Overrides -->
      <view class="field-block">
        <view class="field-header" @tap="toggle('promptOverrides')">
          <text class="field-label">Prompt Overrides</text>
          <text class="field-toggle">{{ expanded.promptOverrides ? '−' : '+' }}</text>
        </view>
        <view v-if="expanded.promptOverrides">
          <text class="mini-label">Main Prompt</text>
          <textarea class="field-textarea" :value="form.system_prompt" @input="(e:any)=>form.system_prompt=e.detail.value" placeholder="Any contents here will replace the default Main Prompt used for this character. (v2 spec: system_prompt)" />
          <text class="mini-label">Post-History Instructions</text>
          <textarea class="field-textarea" :value="form.post_history_instructions" @input="(e:any)=>form.post_history_instructions=e.detail.value" placeholder="Any contents here will replace the default Post-History Instructions used for this character." />
        </view>
      </view>

      <!-- Creator's Metadata -->
      <view class="field-block">
        <view class="field-header" @tap="toggle('metadata')">
          <text class="field-label">Creator's Metadata</text>
          <text class="field-toggle">{{ expanded.metadata ? '−' : '+' }}</text>
        </view>
        <view v-if="expanded.metadata">
          <view class="mini-field">
            <text class="mini-label">Created by</text>
            <input class="mini-input" :value="form.creator" @input="(e:any)=>form.creator=e.detail.value" placeholder="(Botmaker's name / Contact info)" />
          </view>
          <view class="mini-field">
            <text class="mini-label">Character Version</text>
            <input class="mini-input" :value="form.character_version" @input="(e:any)=>form.character_version=e.detail.value" placeholder="(If you want to track character versions)" />
          </view>
        </view>
      </view>

      <!-- Personality summary -->
      <view class="field-block">
        <view class="field-header" @tap="toggle('personality')">
          <text class="field-label">Personality summary</text>
          <text class="field-toggle">{{ expanded.personality ? '−' : '+' }}</text>
        </view>
        <textarea v-if="expanded.personality" class="field-textarea" :value="form.personality" @input="(e:any)=>form.personality=e.detail.value" placeholder="(A brief description of the personality)" />
      </view>

      <!-- Scenario -->
      <view class="field-block">
        <view class="field-header" @tap="toggle('scenario')">
          <text class="field-label">Scenario</text>
          <text class="field-toggle">{{ expanded.scenario ? '−' : '+' }}</text>
        </view>
        <textarea v-if="expanded.scenario" class="field-textarea" :value="form.scenario" @input="(e:any)=>form.scenario=e.detail.value" placeholder="(Circumstances and context of the interaction)" />
      </view>

      <!-- Character's Note -->
      <view class="field-block">
        <view class="field-header" @tap="toggle('depthPrompt')">
          <text class="field-label">Character's Note</text>
          <text class="field-toggle">{{ expanded.depthPrompt ? '−' : '+' }}</text>
        </view>
        <view v-if="expanded.depthPrompt">
          <textarea class="field-textarea" :value="depthPrompt.prompt" @input="(e:any)=>depthPrompt.prompt=e.detail.value" placeholder="(Text to be inserted in-chat @ designated depth and role)" />
          <view class="mini-field">
            <text class="mini-label">@ Depth</text>
            <input class="mini-input" type="number" :value="String(depthPrompt.depth)" @input="(e:any)=>depthPrompt.depth=Number(e.detail.value)||0" />
          </view>
          <view class="mini-field">
            <text class="mini-label">Role</text>
            <picker :range="['System','User','Assistant']" :value="depthRoleIndex" @change="onDepthRoleChange">
              <view class="mini-picker-value">{{ ['System','User','Assistant'][depthRoleIndex] }}</view>
            </picker>
          </view>
        </view>
      </view>

      <!-- Talkativeness -->
      <view class="field-block">
        <text class="field-label">Talkativeness：{{ form.talkativeness }}</text>
        <slider :value="(form.talkativeness ?? 0.5) * 100" min="0" max="100" @change="onTalkChange" activeColor="#cfa54d" />
      </view>

      <!-- 角色卡自带正则脚本（酒馆 SCOPED 类型来源）：默认不生效，需要用户确认信任来源后手动开启 -->
      <view v-if="scopedRegexCount > 0" class="field-block">
        <view class="field-header" @tap="toggle('scopedRegex')">
          <text class="field-label">角色卡自带正则（{{ scopedRegexCount }} 条）</text>
          <text class="field-toggle">{{ expanded.scopedRegex ? '−' : '+' }}</text>
        </view>
        <view v-if="expanded.scopedRegex">
          <text class="mini-hint">这些正则脚本随角色卡导入，用于清洗/改写 AI 输出等。来自第三方卡片，请确认信任来源后再启用。</text>
          <view class="mini-field mini-field-row">
            <text class="mini-label">允许使用角色卡自带正则</text>
            <switch :checked="allowScopedRegex" color="#cfa54d" @change="(e:any)=>allowScopedRegex=!!e.detail.value" />
          </view>
        </view>
      </view>

      <!-- Examples of dialogue -->
      <view class="field-block">
        <view class="field-header" @tap="toggle('mes_example')">
          <text class="field-label">Examples of dialogue</text>
          <text class="field-toggle">{{ expanded.mes_example ? '−' : '+' }}</text>
        </view>
        <textarea v-if="expanded.mes_example" class="field-textarea" :value="form.mes_example" @input="(e:any)=>form.mes_example=e.detail.value" placeholder="(Examples of chat dialog. Begin each example with <START> on a new line.)" />
      </view>

      <!-- ===== World Info（内嵌 character_book，酒馆里通过角色卡关联世界书文件，此处以内嵌条目形式管理） ===== -->
      <!-- 收缩行布局参照酒馆世界书条目卡片：展开箭头在最左侧，触发策略/插入位置/顺序/深度/触发概率可直接编辑，
           无需展开即可调整；因本项目世界书与角色卡强绑定，右侧只保留删除按钮（酒馆的移动/复制条目按钮省略）。 -->
      <view class="section-divider"><text>World Info</text></view>
      <view class="field-block">
        <view class="field-header" @tap="toggle('lorebook')">
          <text class="field-label">Entries（{{ lorebookEntries.length }}）</text>
          <text class="field-toggle">{{ expanded.lorebook ? '−' : '+' }}</text>
        </view>
        <view v-if="expanded.lorebook">
          <view v-if="lorebookEntries.length === 0" class="lore-empty">
            <text>无世界书条目</text>
          </view>
          <view v-else class="lore-list">
            <view v-for="(entry, li) in lorebookEntries" :key="entry.id" class="lore-item">
              <!-- 收缩状态：展开箭头（最左）+ 常量/关键字状态点 + 标题（可编辑）+ 启用开关 + 删除按钮 -->
              <view class="lore-row-top">
                <text class="lore-expand-arrow" @tap="toggleLoreExpand(li)">{{ loreExpandedIndex === li ? '▾' : '▸' }}</text>
                <text class="lore-dot" :title="entry.constant ? '常量（始终触发）' : '关键字触发'" @tap="onToggleConstant(li)">{{ entry.constant ? '🔵' : '🟢' }}</text>
                <input class="lore-title-input" :value="entry.comment" @input="(e:any)=>onLoreFieldInput(li,'comment',e.detail.value)" placeholder="(未命名条目)" />
                <switch class="lore-enable-switch" :checked="entry.enabled !== false" @change="(e:any)=>onLoreFieldInput(li,'enabled',e.detail.value)" color="#cfa54d" style="transform: scale(0.7)" />
                <text class="lore-delete-btn" @tap="onDeleteLoreEntry(li)">🗑</text>
              </view>
              <!-- 收缩状态：可直接编辑的核心参数行 -->
              <view class="lore-row-fields">
                <view class="lore-field-mini">
                  <text class="lore-field-mini-label">插入位置</text>
                  <picker class="lore-field-mini-picker" :range="positionLabels" :value="lorePositionIndex(entry.position)" @change="(e:any)=>onLorePositionChange(li,e.detail.value)">
                    <view class="lore-field-mini-value">{{ positionLabels[lorePositionIndex(entry.position)] }}</view>
                  </picker>
                </view>
                <view class="lore-field-mini" v-if="entry.position === 'at_depth'">
                  <text class="lore-field-mini-label">深度</text>
                  <input class="lore-field-mini-input" type="number" :value="String(entry.depth ?? 4)" @input="(e:any)=>onLoreFieldInput(li,'depth',Number(e.detail.value)||0)" />
                </view>
                <view class="lore-field-mini">
                  <text class="lore-field-mini-label">顺序</text>
                  <input class="lore-field-mini-input" type="number" :value="String(entry.insertionOrder)" @input="(e:any)=>onLoreFieldInput(li,'insertionOrder',Number(e.detail.value)||0)" />
                </view>
                <view class="lore-field-mini">
                  <text class="lore-field-mini-label">触发概率%</text>
                  <input class="lore-field-mini-input" type="number" :value="String(entry.probability ?? 100)" @input="(e:any)=>onProbabilityInput(li,e.detail.value)" />
                </view>
              </view>
              <text class="lore-keys">Key(s): {{ entry.keys.join(', ') || '(无)' }}</text>
              <!-- 展开状态：Key(s)/Secondary Key(s)/Content 编辑区（占空间较大，保留展开触发） -->
              <view v-if="loreExpandedIndex === li" class="lore-item-body">
                <view class="mini-field">
                  <text class="mini-label">Key(s)</text>
                  <input class="mini-input" :value="entry.keys.join(',')" @input="(e:any)=>onLoreKeysInput(li,e.detail.value)" placeholder="逗号分隔" />
                </view>
                <view class="mini-field">
                  <text class="mini-label">Secondary Key(s)</text>
                  <input class="mini-input" :value="(entry.secondaryKeys||[]).join(',')" @input="(e:any)=>onLoreSecondaryKeysInput(li,e.detail.value)" placeholder="逗号分隔" />
                </view>
                <text class="mini-label">Content</text>
                <textarea class="field-textarea lore-content-textarea" :value="entry.content" @input="(e:any)=>onLoreFieldInput(li,'content',e.detail.value)" />
              </view>
            </view>
          </view>
          <view class="add-mini-btn" @tap="onAddLoreEntry">
            <text class="add-mini-text">+ New Entry</text>
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
import { useCharacterCardStore } from '../../stores/characterCardStore'
import { getNavBarHeight } from '../../utils/navbar.js'
import NavBar from '../../components/common/NavBar.vue'
import type { LorebookEntry } from '../../types/character'

const cardStore = useCharacterCardStore()
const navBarHeight = ref(0)

const form = reactive({
  name: '',
  description: '',
  personality: '',
  scenario: '',
  first_mes: '',
  mes_example: '',
  system_prompt: '',
  post_history_instructions: '',
  creator: '',
  character_version: '',
  creator_notes: '',
  talkativeness: 0.5 as number,
  tags: [] as string[]
})

const tagsText = ref('')
const altGreetings = ref<string[]>([])
const depthPrompt = reactive({ prompt: '', depth: 4, role: 'system' as 'system' | 'user' | 'assistant' })
const lorebookEntries = ref<LorebookEntry[]>([])
const loreExpandedIndex = ref<number>(-1)
// 角色卡自带正则（SCOPED 来源）：数量只读展示，allowScopedRegex 是唯一可编辑项
const scopedRegexCount = ref(0)
const allowScopedRegex = ref(false)
let cardId = ''

const expanded = reactive({
  creatorNotes: false,
  description: true,
  first_mes: true,
  altGreetings: false,
  promptOverrides: false,
  metadata: false,
  personality: false,
  scenario: false,
  depthPrompt: false,
  scopedRegex: false,
  mes_example: false,
  lorebook: true
})

function toggle(key: keyof typeof expanded) {
  expanded[key] = !expanded[key]
}

function toggleLoreExpand(idx: number) {
  loreExpandedIndex.value = loreExpandedIndex.value === idx ? -1 : idx
}

function onTagsInput(e: any) {
  tagsText.value = e.detail.value
}

function onAltGreetingInput(idx: number, value: string) {
  altGreetings.value[idx] = value
}
function onAddAltGreeting() {
  altGreetings.value.push('')
}
function onDeleteAltGreeting(idx: number) {
  altGreetings.value.splice(idx, 1)
}

const depthRoleIndex = ref(0)
function onDepthRoleChange(e: any) {
  const roles = ['system', 'user', 'assistant'] as const
  const idx = Number(e.detail.value)
  depthRoleIndex.value = idx
  depthPrompt.role = roles[idx]
}

function onTalkChange(e: any) {
  form.talkativeness = Math.round(e.detail.value) / 100
}

// 插入位置选项，对齐 WorldInfoEngine 的分发桶（旧数据的 'system' 归并到"角色定义后"档位显示）
const positionValues = ['before_context', 'after_context', 'at_depth'] as const
const positionLabels = ['角色定义前', '角色定义后', '指定深度']
function lorePositionIndex(pos: string) {
  const idx = positionValues.indexOf(pos as any)
  if (idx >= 0) return idx
  if (pos === 'system') return positionValues.indexOf('after_context')
  return 0
}
function onLorePositionChange(idx: number, valueIndex: string) {
  lorebookEntries.value[idx].position = positionValues[Number(valueIndex)]
}
function onLoreFieldInput(idx: number, field: string, value: any) {
  ;(lorebookEntries.value[idx] as any)[field] = value
}
function onLoreKeysInput(idx: number, value: string) {
  lorebookEntries.value[idx].keys = value.split(',').map(s => s.trim()).filter(Boolean)
}
function onLoreSecondaryKeysInput(idx: number, value: string) {
  lorebookEntries.value[idx].secondaryKeys = value.split(',').map(s => s.trim()).filter(Boolean)
}
/** 触发概率输入：0-100 范围裁剪，编辑即视为启用概率判定（对齐 WorldInfoEngine 的 useProbability 门控） */
function onProbabilityInput(idx: number, value: string) {
  let n = Number(value)
  if (isNaN(n)) n = 100
  n = Math.max(0, Math.min(100, n))
  lorebookEntries.value[idx].probability = n
  lorebookEntries.value[idx].useProbability = true
}
/** 点击标题行的状态点，在"常量常驻"与"关键字触发"之间切换 */
function onToggleConstant(idx: number) {
  lorebookEntries.value[idx].constant = !lorebookEntries.value[idx].constant
}
/** 删除条目：本项目世界书与角色卡强绑定，不提供移动/复制到其他世界书 */
function onDeleteLoreEntry(idx: number) {
  uni.showModal({
    title: '删除条目',
    content: `确定删除条目「${lorebookEntries.value[idx].comment || '(未命名条目)'}」吗？`,
    success: (res: any) => {
      if (!res.confirm) return
      lorebookEntries.value.splice(idx, 1)
      if (loreExpandedIndex.value === idx) loreExpandedIndex.value = -1
      else if (loreExpandedIndex.value > idx) loreExpandedIndex.value -= 1
    }
  })
}
function onAddLoreEntry() {
  const id = 'lore_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  lorebookEntries.value.push({
    id,
    keys: [],
    secondaryKeys: [],
    regex: null,
    content: '',
    priority: 100,
    insertionOrder: 100,
    position: 'before_context',
    enabled: true,
    constant: false,
    selective: false,
    comment: '新条目',
    extensions: {}
  })
  loreExpandedIndex.value = lorebookEntries.value.length - 1
}

function _loadCard(id: string) {
  cardId = id
  const existing: any = cardStore.getById(id)
  if (existing) {
    form.name = existing.name || ''
    form.description = existing.description || ''
    form.personality = existing.personality || ''
    form.scenario = existing.scenario || ''
    form.first_mes = existing.first_mes || ''
    form.mes_example = existing.mes_example || ''
    form.system_prompt = existing.system_prompt || ''
    form.post_history_instructions = existing.post_history_instructions || ''
    form.creator = existing.creator || ''
    form.character_version = existing.character_version || ''
    form.creator_notes = existing.creator_notes || ''
    form.talkativeness = typeof existing.talkativeness === 'number' ? existing.talkativeness : 0.5
    form.tags = existing.tags || []
    tagsText.value = form.tags.join(',')
    altGreetings.value = Array.isArray(existing.alternate_greetings) ? [...existing.alternate_greetings] : []
    if (existing.extensions && existing.extensions.depth_prompt) {
      depthPrompt.prompt = existing.extensions.depth_prompt.prompt || ''
      depthPrompt.depth = existing.extensions.depth_prompt.depth ?? 4
      depthPrompt.role = existing.extensions.depth_prompt.role || 'system'
      depthRoleIndex.value = ['system', 'user', 'assistant'].indexOf(depthPrompt.role)
    }
    scopedRegexCount.value = Array.isArray(existing.extensions?.regex_scripts) ? existing.extensions.regex_scripts.length : 0
    allowScopedRegex.value = !!existing.extensions?.allowScopedRegex
  }
  lorebookEntries.value = cardStore.getLorebook(id)
}

// onLoad 是 uni-app 官方组合式 API，跨 H5/小程序统一从页面路由参数中取值
onLoad((options: any) => {
  navBarHeight.value = getNavBarHeight().navBarHeight
  cardStore.loadAll()
  const id = options?.id
  if (id) {
    _loadCard(id)
  }
})

function onSave() {
  if (!form.name.trim()) {
    uni.showToast({ title: '请输入角色名称', icon: 'none' })
    return
  }
  form.tags = tagsText.value.split(',').map(t => t.trim()).filter(Boolean)
  if (cardId) {
    try {
      cardStore.update(cardId, {
        ...form,
        alternate_greetings: altGreetings.value.filter(g => g.trim()),
        extensions: {
          depth_prompt: depthPrompt.prompt.trim() ? { ...depthPrompt } : undefined,
          allowScopedRegex: allowScopedRegex.value
        }
      } as any)
      cardStore.setLorebook(cardId, lorebookEntries.value)
    } catch (e: any) {
      uni.showModal({ title: '保存失败', content: e?.message || '角色卡保存失败，请检查头像图片是否过大', showCancel: false })
      return
    }
  }
  uni.showToast({ title: '已保存', icon: 'success' })
  setTimeout(() => uni.navigateBack(), 800)
}
</script>

<style scoped>
.edit-container { display: flex; flex-direction: column; height: 100vh; background: var(--bg-deep); }
.edit-scroll { flex: 1; padding: 20rpx; min-height: 0; box-sizing: border-box; }
.section-divider { display: flex; align-items: center; margin: 28rpx 0 18rpx; padding-bottom: 10rpx; border-bottom: 1rpx solid var(--border); }
.section-divider text { font-size: 22rpx; color: var(--t-gold); font-weight: 700; letter-spacing: .04em; }
.field-block { margin-bottom: 18rpx; background: var(--surface); border: 1rpx solid var(--border); border-radius: 18rpx; padding: 20rpx; }
.field-header { display: flex; justify-content: space-between; align-items: center; }
.field-label { font-family: var(--font-body); font-size: 23rpx; color: var(--fg); font-weight: 700; }
.field-toggle { font-size: 22rpx; color: var(--faint); width: 32rpx; text-align: center; }
.field-input { height: 68rpx; background: var(--surface-2); border: 1rpx solid var(--border); border-radius: 14rpx; padding: 0 18rpx; font-size: 24rpx; color: var(--fg); margin-top: 10rpx; box-sizing: border-box; width: 100%; }
.field-textarea { width: 100%; min-height: 160rpx; background: var(--surface-2); border: 1rpx solid var(--border); border-radius: 14rpx; padding: 16rpx; font-size: 22rpx; color: var(--fg); box-sizing: border-box; margin-top: 10rpx; margin-bottom: 10rpx; line-height: 1.5; }
.mini-field { display: flex; align-items: center; gap: 12rpx; margin-bottom: 12rpx; }
.mini-field-row { justify-content: space-between; }
.mini-label { display: block; font-size: 20rpx; color: var(--faint); width: 180rpx; flex-shrink: 0; margin-top: 8rpx; }
.mini-hint { display: block; font-size: 19rpx; color: var(--t-gold); margin-bottom: 14rpx; line-height: 1.5; }
.mini-input { flex: 1; height: 56rpx; background: var(--surface-2); border: 1rpx solid var(--border); border-radius: 10rpx; padding: 0 14rpx; font-size: 22rpx; color: var(--fg); box-sizing: border-box; }
.mini-picker-value { flex: 1; height: 56rpx; line-height: 56rpx; background: var(--surface-2); border: 1rpx solid var(--border); border-radius: 10rpx; padding: 0 14rpx; font-size: 22rpx; color: var(--accent); }
.alt-greeting-item { margin-bottom: 12rpx; padding: 14rpx; background: var(--surface-2); border: 1rpx solid var(--border); border-radius: 14rpx; }
.alt-greeting-textarea { min-height: 120rpx; }
.alt-greeting-delete { font-size: 19rpx; color: var(--danger); }
.add-mini-btn { padding: 14rpx; text-align: center; background: var(--accent-soft); border: 1rpx solid var(--accent); border-radius: 14rpx; margin-top: 10rpx; }
.add-mini-text { font-size: 21rpx; color: var(--accent); font-weight: 600; }
.lore-empty { padding: 20rpx; text-align: center; color: var(--faint); font-size: 21rpx; }
.lore-list { display: flex; flex-direction: column; gap: 10rpx; margin-top: 10rpx; }
.lore-item { padding: 14rpx; background: var(--surface-2); border: 1rpx solid var(--border); border-radius: 14rpx; }
/* 顶部行：展开箭头（最左，对齐酒馆 inline-drawer-toggle 位置）+ 状态点 + 标题输入 + 启用开关 + 删除 */
.lore-row-top { display: flex; align-items: center; gap: 10rpx; }
.lore-expand-arrow { font-size: 22rpx; color: var(--faint); width: 32rpx; text-align: center; flex-shrink: 0; }
.lore-dot { font-size: 20rpx; flex-shrink: 0; }
.lore-title-input { flex: 1; height: 56rpx; background: var(--surface); border: 1rpx solid var(--border); border-radius: 10rpx; padding: 0 14rpx; font-size: 22rpx; color: var(--fg); min-width: 0; box-sizing: border-box; }
.lore-enable-switch { flex-shrink: 0; }
.lore-delete-btn { font-size: 24rpx; flex-shrink: 0; padding: 4rpx 8rpx; color: var(--danger); }
/* 核心参数行：插入位置/深度/顺序/触发概率，收缩状态下即可直接编辑，无需展开 */
.lore-row-fields { display: flex; flex-wrap: wrap; gap: 12rpx; margin-top: 12rpx; padding-left: 42rpx; }
.lore-field-mini { display: flex; align-items: center; gap: 8rpx; }
.lore-field-mini-label { font-size: 18rpx; color: var(--faint); white-space: nowrap; }
.lore-field-mini-input { width: 92rpx; height: 48rpx; background: var(--surface); border: 1rpx solid var(--border); border-radius: 8rpx; padding: 0 8rpx; font-size: 21rpx; color: var(--fg); text-align: center; box-sizing: border-box; }
.lore-field-mini-picker { flex-shrink: 0; }
.lore-field-mini-value { height: 48rpx; line-height: 48rpx; background: var(--surface); border: 1rpx solid var(--border); border-radius: 8rpx; padding: 0 14rpx; font-size: 21rpx; color: var(--accent); }
.lore-keys { display: block; font-size: 19rpx; color: var(--faint); margin-top: 10rpx; padding-left: 42rpx; }
.lore-item-body { margin-top: 14rpx; padding-left: 42rpx; }
.lore-content-textarea { min-height: 120rpx; }
.footer { padding: 20rpx 30rpx; padding-bottom: calc(20rpx + env(safe-area-inset-bottom)); background: oklch(18% 0.013 70 / 0.92); border-top: 1rpx solid var(--border); flex: none; }
.save-btn { height: 84rpx; background: linear-gradient(135deg, var(--accent), var(--accent-strong)); border-radius: 42rpx; display: flex; align-items: center; justify-content: center; box-shadow: 0 20rpx 44rpx -18rpx oklch(75% 0.14 80 / 0.6); }
.save-text { font-size: 25rpx; color: #171104; font-weight: 700; }
</style>