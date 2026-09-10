<template>
  <view class="login-container" :style="{ paddingTop: (statusBarHeight + 60) + 'px' }">

    <view class="auth-head">
      <view class="auth-crest"><image src="/static/images/dragon-logo.png" mode="aspectFill"></image></view>
      <text class="app-title">无限旅团</text>
      <text class="app-sub">{{ isRegisterMode ? '创建新账号，开启专属冒险' : '登录你的账号，继续冒险' }}</text>
    </view>

    <view class="auth-tabs">
      <button :class="['auth-tab', !isRegisterMode ? 'active' : '']" @tap="isRegisterMode = false">登录</button>
      <button :class="['auth-tab', isRegisterMode ? 'active' : '']" @tap="isRegisterMode = true">注册</button>
    </view>

    <view class="form">
      <view class="field">
        <text class="label">用户名</text>
        <input class="input" type="text" placeholder="请输入用户名" v-model="username" />
      </view>
      <view class="field">
        <text class="label">密码</text>
        <input class="input" type="text" :password="true" placeholder="请输入密码" v-model="password" />
      </view>
      <view class="field" v-if="isRegisterMode">
        <text class="label">昵称（可选）</text>
        <input class="input" type="text" placeholder="展示用昵称" v-model="nickname" />
      </view>

      <button class="btn-primary" :loading="submitting" :disabled="submitting" @tap="onSubmit">{{ isRegisterMode ? '注册并登录' : '登录' }}</button>

      <view class="hint-box" v-if="!isRegisterMode">
        <text class="hint-text"><text class="hint-b">提示：</text>账号保存在服务器（密码加密存储）。新注册的账号默认为测试账号，可直接使用内置测试 API，也可以在设置页填写自己的 API Key。</text>
      </view>

      <view class="switch-mode" @tap="toggleMode">
        <text class="switch-text">{{ isRegisterMode ? '已有账号？去登录' : '没有账号？去注册' }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useUserStore } from '../../stores/userStore'
import { getNavBarHeight } from '../../utils/navbar.js'

const userStore = useUserStore()

// 登录页由 reLaunch 进入，没有可返回的页面栈，不需要导航栏返回键，
// 但仍需给顶部状态栏留出安全间距（navigationStyle:"custom" 后系统不再自动预留）
const statusBarHeight = ref(0)
onMounted(() => {
  statusBarHeight.value = getNavBarHeight().statusBarHeight
})

const isRegisterMode = ref(false)
const submitting = ref(false)
const username = ref('')
const password = ref('')
const nickname = ref('')

function toggleMode() {
  isRegisterMode.value = !isRegisterMode.value
}

async function onSubmit() {
  const u = username.value.trim()
  const p = password.value.trim()
  if (!u || !p) {
    uni.showToast({ title: '请输入用户名和密码', icon: 'none' })
    return
  }
  if (submitting.value) return
  submitting.value = true

  try {
    if (isRegisterMode.value) {
      const res = await userStore.register(u, p, nickname.value.trim())
      if (!res.success) {
        uni.showToast({ title: res.message || '注册失败', icon: 'none' })
        return
      }
      // 注册成功后自动登录（服务端已签发 token，这里直接用注册结果登录）
      const loginRes = await userStore.login(u, p)
      if (loginRes.success) {
        _afterLoginSuccess()
      } else {
        uni.showToast({ title: '注册成功，请登录', icon: 'none' })
        isRegisterMode.value = false
      }
    } else {
      const res = await userStore.login(u, p)
      if (!res.success) {
        uni.showToast({ title: res.message || '登录失败', icon: 'none' })
        return
      }
      _afterLoginSuccess()
    }
  } finally {
    submitting.value = false
  }
}

function _afterLoginSuccess() {
  uni.showToast({ title: '登录成功', icon: 'success' })
  setTimeout(() => {
    uni.reLaunch({ url: '/pages/index/index' })
  }, 800)
}
</script>

<style scoped>
.login-container { min-height: 100vh; background: var(--bg-deep); display: flex; flex-direction: column; padding: 88rpx 48rpx; }

.auth-head { display: flex; flex-direction: column; align-items: center; text-align: center; margin-bottom: 40rpx; }
.auth-crest {
  width: 92rpx; height: 92rpx; border-radius: 30rpx; margin-bottom: 24rpx; overflow: hidden;
  background: linear-gradient(160deg, oklch(29% 0.05 80), oklch(20% 0.03 80));
  border: 1rpx solid oklch(80% 0.13 84 / 0.45);
  box-shadow: 0 0 48rpx -14rpx oklch(75% 0.13 80 / 0.5);
}
.auth-crest image { width: 100%; height: 100%; }
.app-title { font-family: var(--font-serif); font-size: 36rpx; font-weight: 900; color: var(--fg); margin-bottom: 8rpx; letter-spacing: .01em; }
.app-sub { font-size: 22rpx; color: var(--muted); }

.auth-tabs { display: flex; gap: 10rpx; padding: 6rpx; border-radius: 24rpx; background: var(--surface); border: 1rpx solid var(--border); margin-bottom: 36rpx; }
.auth-tab { flex: 1; height: 64rpx; line-height: 64rpx; border-radius: 18rpx; border: none; background: none; font-size: 23rpx; font-weight: 600; color: var(--faint); padding: 0; }
.auth-tab.active { background: var(--raised); color: var(--fg); box-shadow: inset 0 0 0 1rpx var(--border-strong); }

.form { flex: 1; }
.field { margin-bottom: 28rpx; }
.label { display: block; font-size: 23rpx; color: var(--fg-soft); margin-bottom: 14rpx; letter-spacing: .01em; }
.input {
  width: 100%;
  background: var(--surface);
  border: 1rpx solid var(--border);
  border-radius: 24rpx;
  padding: 22rpx 26rpx;
  font-size: 26rpx;
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

.btn-primary {
  width: 100%; height: 88rpx; line-height: 88rpx; border-radius: 44rpx; border: none; margin-top: 12rpx;
  background: linear-gradient(135deg, var(--accent), var(--accent-strong)); color: #171104;
  font-size: 27rpx; font-weight: 700; letter-spacing: .02em;
  box-shadow: 0 24rpx 52rpx -20rpx oklch(75% 0.14 80 / 0.6), inset 0 2rpx 0 oklch(100% 0 0 / 0.4);
}

.hint-box { margin-top: 28rpx; padding: 22rpx 24rpx; border-radius: 24rpx; background: color-mix(in oklch, var(--t-gold) 10%, transparent); border: 1rpx solid color-mix(in oklch, var(--t-gold) 30%, transparent); }
.hint-text { font-size: 20rpx; line-height: 1.55; color: color-mix(in oklch, var(--t-gold) 78%, var(--fg-soft)); }
.hint-b { font-weight: 700; }

.switch-mode { text-align: center; margin-top: 28rpx; }
.switch-text { font-size: 23rpx; color: var(--accent); font-weight: 600; }
</style>
