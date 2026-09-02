<template>
  <view class="persona-container">
    <NavBar title="我的角色（Persona）" />
    <view class="header" :style="{ paddingTop: (navBarHeight + 16) + 'px' }">
      <text class="header-sub">对应酒馆 Personas，绑定对话中的 {{ userMacroLabel }} 身份</text>
      <view class="add-btn" @tap="onCreateTap">
        <text class="add-btn-text">+ 新建 Persona</text>
      </view>
    </view>

    <scroll-view class="list-scroll" scroll-y>
      <view v-if="personaStore.personas.length === 0" class="empty-state">
        <text class="empty-text">还没有 Persona，点击上方按钮创建你的第一个身份</text>
      </view>
      <view
        v-for="p in personaStore.personas"
        :key="p.id"
        class="persona-card"
        :class="{ active: p.id === personaStore.activePersonaId }"
        @tap="onEdit(p)"
      >
        <view class="persona-avatar">
          <image v-if="p.avatar" class="persona-avatar-img" :src="p.avatar" mode="aspectFill" />
          <text v-else class="persona-avatar-text">{{ (p.name || '?').charAt(0) }}</text>
        </view>
        <view class="persona-info">
          <text class="persona-name">{{ p.name || '未命名' }}</text>
          <text class="persona-desc">{{ p.description || '暂无描述' }}</text>
        </view>
        <view class="persona-actions">
          <text v-if="p.id === personaStore.activePersonaId" class="persona-active-badge">出场中</text>
          <text v-else class="persona-set-active" @tap.stop="setActive(p.id)">设为出场</text>
          <text class="persona-delete" @tap.stop="onDelete(p.id)">删除</text>
        </view>
      </view>
    </scroll-view>

    <!-- 编辑弹层 -->
    <view class="edit-mask" v-if="editing" @tap="closeEdit">
      <view class="edit-panel" @tap.stop>
        <text class="edit-title">{{ editingId ? '编辑 Persona' : '新建 Persona' }}</text>
        <view class="form-item">
          <text class="label">名字（对应 {{ userMacroLabel }} 宏）</text>
          <input class="input" type="text" placeholder="例如：旅人" v-model="form.name" />
        </view>
        <view class="form-item">
          <text class="label">头像</text>
          <view class="avatar-row">
            <image v-if="form.avatar" class="avatar-preview" :src="form.avatar" mode="aspectFill" />
            <view class="avatar-placeholder" v-else><text class="avatar-placeholder-text">{{ (form.name || '?').charAt(0) }}</text></view>
            <view class="avatar-pick-btn" @tap="onPickAvatar"><text class="avatar-pick-text">选择图片</text></view>
          </view>
        </view>
        <view class="form-item">
          <text class="label">描述（会随 {{ personaMacroLabel }} 类宏注入上下文）</text>
          <textarea class="textarea" placeholder="这个身份的背景/性格描述" v-model="form.description" />
        </view>
        <view class="edit-footer">
          <button class="btn-secondary" @tap="closeEdit">取消</button>
          <button class="btn-primary" @tap="onSaveForm">保存</button>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { usePersonaStore } from '../../stores/personaStore'
import { getNavBarHeight } from '../../utils/navbar.js'
import NavBar from '../../components/common/NavBar.vue'

const personaStore = usePersonaStore()
const navBarHeight = ref(0)

const editing = ref(false)
const editingId = ref<string | null>(null)
const form = reactive({ name: '', avatar: '', description: '' })
// 模板内直接写 {{user}} 会被 Vue 编译器误判为插值表达式，故用变量间接输出字面量
const userMacroLabel = '{{user}}'
const personaMacroLabel = '{{persona}}'

onMounted(() => {
  personaStore.load()
  navBarHeight.value = getNavBarHeight().navBarHeight
})


function onCreateTap() {
  editingId.value = null
  form.name = ''
  form.avatar = ''
  form.description = ''
  editing.value = true
}

function onEdit(p: any) {
  editingId.value = p.id
  form.name = p.name || ''
  form.avatar = p.avatar || ''
  form.description = p.description || ''
  editing.value = true
}

function closeEdit() {
  editing.value = false
}

function onSaveForm() {
  const name = form.name.trim()
  if (!name) {
    uni.showToast({ title: '请输入名字', icon: 'none' })
    return
  }
  if (editingId.value) {
    personaStore.update(editingId.value, { name, avatar: form.avatar, description: form.description })
  } else {
    personaStore.create({ name, avatar: form.avatar, description: form.description })
  }
  editing.value = false
  uni.showToast({ title: '已保存', icon: 'success' })
}

function setActive(id: string) {
  personaStore.setActive(id)
  uni.showToast({ title: '已设为出场角色', icon: 'none' })
}

function onDelete(id: string) {
  uni.showModal({
    title: '删除 Persona',
    content: '确定要删除这个身份吗？',
    success: (res: any) => {
      if (res.confirm) {
        personaStore.remove(id)
        uni.showToast({ title: '已删除', icon: 'none' })
      }
    }
  })
}

function onPickAvatar() {
  // #ifdef H5
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.style.display = 'none'
  input.addEventListener('change', () => {
    const file = input.files && input.files[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = () => { form.avatar = reader.result as string }
      reader.readAsDataURL(file)
    }
    document.body.removeChild(input)
  })
  document.body.appendChild(input)
  input.click()
  // #endif
  // #ifndef H5
  uni.chooseImage({
    count: 1,
    success: (res: any) => {
      const path = res.tempFilePaths && res.tempFilePaths[0]
      if (path) form.avatar = path
    }
  })
  // #endif
}
</script>

<style scoped>
.persona-container { display: flex; flex-direction: column; height: 100vh; background: var(--bg-deep); }
.header { padding: 24rpx 30rpx; border-bottom: 1rpx solid var(--border); flex: none; }
.header-sub { display: block; font-size: 21rpx; color: var(--faint); margin-bottom: 20rpx; line-height: 1.5; }
.add-btn { padding: 16rpx 24rpx; background: var(--accent-soft); border: 1rpx solid var(--accent); border-radius: 18rpx; display: inline-block; }
.add-btn-text { font-size: 23rpx; color: var(--accent); font-weight: 700; }
.list-scroll { flex: 1; padding: 20rpx; min-height: 0; }
.empty-state { padding: 100rpx 40rpx; text-align: center; }
.empty-text { font-size: 23rpx; color: var(--faint); line-height: 1.6; }
.persona-card { display: flex; align-items: center; gap: 16rpx; padding: 20rpx; background: var(--surface); border: 1rpx solid var(--border); border-radius: 20rpx; margin-bottom: 16rpx; transition: border-color 0.2s ease, background 0.2s ease; }
.persona-card.active { border-color: var(--accent); background: var(--accent-soft); }
.persona-avatar {
  width: 80rpx; height: 80rpx; border-radius: 50%; flex-shrink: 0; overflow: hidden;
  background: linear-gradient(160deg, var(--t-emerald), oklch(46% 0.1 158));
  border: 1rpx solid oklch(74% 0.13 158 / 0.5);
  display: flex; align-items: center; justify-content: center;
}
.persona-avatar-img { width: 100%; height: 100%; }
.persona-avatar-text { font-family: var(--font-serif); font-size: 30rpx; color: #05170f; font-weight: 900; }
.persona-info { flex: 1; min-width: 0; }
.persona-name { display: block; font-size: 25rpx; color: var(--fg); font-weight: 700; margin-bottom: 6rpx; }
.persona-desc { display: block; font-size: 20rpx; color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.persona-actions { display: flex; flex-direction: column; align-items: flex-end; gap: 10rpx; flex-shrink: 0; }
.persona-active-badge { font-size: 19rpx; color: var(--success); font-weight: 600; }
.persona-set-active { font-size: 19rpx; color: var(--accent); font-weight: 600; }
.persona-delete { font-size: 19rpx; color: var(--danger); font-weight: 600; }

.edit-mask { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: oklch(10% 0.01 70 / 0.65); display: flex; align-items: center; justify-content: center; z-index: 999; }
.edit-panel { width: 86%; max-height: 80vh; background: var(--bg-deep); border: 1rpx solid var(--border); border-radius: 24rpx; padding: 32rpx; overflow-y: auto; }
.edit-title { display: block; font-family: var(--font-serif); font-size: 27rpx; font-weight: 900; color: var(--fg); margin-bottom: 24rpx; }
.form-item { margin-bottom: 24rpx; }
.label { display: block; font-size: 22rpx; color: var(--fg-soft); margin-bottom: 10rpx; }
.input {
  width: 100%;
  background: var(--surface);
  border: 1rpx solid var(--border);
  border-radius: 16rpx;
  padding: 20rpx;
  font-size: 25rpx;
  color: var(--fg);
  box-sizing: border-box;
  /* 修复 H5 端 uni-input 无法点击聚焦的问题：框架全局 user-select:none 会被继承到内部真实 input，
     且 uni-input 默认行高较小导致点击热区不足 */
  -webkit-user-select: text !important;
  user-select: text !important;
  cursor: text !important;
  height: auto !important;
  min-height: 44px;
}
.input :deep(.uni-input-input) {
  -webkit-user-select: text !important;
  user-select: text !important;
  cursor: text !important;
}
.input:focus { border-color: var(--accent); }
.textarea { width: 100%; min-height: 160rpx; background: var(--surface); border: 1rpx solid var(--border); border-radius: 16rpx; padding: 20rpx; font-size: 24rpx; color: var(--fg); box-sizing: border-box; line-height: 1.5; }
.avatar-row { display: flex; align-items: center; gap: 20rpx; }
.avatar-preview { width: 90rpx; height: 90rpx; border-radius: 50%; }
.avatar-placeholder { width: 90rpx; height: 90rpx; border-radius: 50%; background: linear-gradient(160deg, var(--t-emerald), oklch(46% 0.1 158)); display: flex; align-items: center; justify-content: center; }
.avatar-placeholder-text { font-family: var(--font-serif); font-size: 30rpx; color: #05170f; font-weight: 900; }
.avatar-pick-btn { padding: 12rpx 22rpx; background: var(--accent-soft); border-radius: 16rpx; }
.avatar-pick-text { font-size: 21rpx; color: var(--accent); font-weight: 600; }
.edit-footer { display: flex; gap: 18rpx; margin-top: 24rpx; }
.btn-secondary, .btn-primary { flex: 1; height: 80rpx; line-height: 80rpx; border-radius: 40rpx; font-size: 25rpx; font-weight: 700; border: none; }
.btn-secondary { background: var(--surface); border: 1rpx solid var(--border); color: var(--fg-soft); }
.btn-primary { background: linear-gradient(135deg, var(--accent), var(--accent-strong)); color: #171104; box-shadow: 0 20rpx 44rpx -18rpx oklch(75% 0.14 80 / 0.6); }
</style>