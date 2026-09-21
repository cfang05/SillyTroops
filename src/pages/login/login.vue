<template>
  <view class="login-container" :style="{ paddingTop: (statusBarHeight + 60) + 'px' }">

    <!-- 常驻提示条：登录态过期 / 需要登录时告诉用户「为什么会被带到这里」。
         用常驻提示而不是 toast —— toast 两秒就消失，用户很可能正在看别处、
         回头发现自己在登录页却不知道为什么，这正是要避免的。 -->
    <view class="login-notice" v-if="notice">
      <text class="login-notice-text">{{ notice }}</text>
    </view>

    <view class="auth-head">
      <view class="auth-crest"><image src="/static/images/dragon-logo.webp" mode="aspectFill"></image></view>
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
        <text class="label">昵称<text class="required">*</text></text>
        <input class="input" type="text" placeholder="请输入昵称（全站唯一，不可与他人重复）" v-model="nickname" maxlength="40" />
      </view>

      <button class="btn-primary" :loading="submitting" :disabled="submitting" @tap="onSubmit">{{ isRegisterMode ? '注册并登录' : '登录' }}</button>

      <view class="switch-mode" @tap="toggleMode">
        <text class="switch-text">{{ isRegisterMode ? '已有账号？去登录' : '没有账号？去注册' }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useUserStore } from '../../stores/userStore'
import { getNavBarHeight } from '../../utils/navbar.js'

const userStore = useUserStore()

// 登录页不再只由 reLaunch 进入：登录态过期时是 navigateTo 压栈进来的，
// 登录后要 navigateBack 回到用户原来的页面，所以这里不能省返回处理。
// 顶部仍要给状态栏留安全间距（navigationStyle:"custom" 后系统不再自动预留）
const statusBarHeight = ref(0)
onMounted(() => {
  statusBarHeight.value = getNavBarHeight().statusBarHeight
})

const isRegisterMode = ref(false)
const submitting = ref(false)
const username = ref('')
const password = ref('')
const nickname = ref('')

// ── 来源与去向 ────────────────────────────────────────────────
// ⚠️ 登录页**刻意不做任何登录态检查**：既不做"未登录就跳走"的守卫，也不做
// "已登录就跳首页"的自动跳转。它是所有跳转的目的地，自身一旦含登录态判断，
// 只要本地登录态清理不干净（storage 异常、清理漏项……），登录页就会把自己弹走，
// 导致**用户永远登不进来** —— 这比"已登录用户多点一次"严重得多。
// "已登录的用户不该看到登录表单"放在品牌页的点击处处理（见 brand.vue 的 handleTap）。
//
// 登录成功后的去向由两个参数决定，显式且互斥：
//   redirect 有值 → 守卫在页面 onLoad 里触发的 → reLaunch(redirect) 重建目标页
//   back=1        → App 层检查 / 业务接口 401 触发的 → navigateBack 回原页面（输入保留）
//   两者都没有     → 用户自己点进来的（品牌页 / 直接输 URL）→ 去首页
const reason = ref('')
const redirect = ref('')
const back = ref('')
const notice = ref('')

onLoad((options: any) => {
  reason.value = String(options?.reason || '')
  back.value = String(options?.back || '')

  const rawRedirect = String(options?.redirect || '')
  // redirect 是本站页面路径（守卫从 currentRoutePath() 取的），登录后要用 reLaunch 重建它。
  //
  // ⚠️ 为什么这里要**反复解码**而不是解一次：
  // H5 的 uni.navigateTo 会把 query 值再编码一层（守卫传进来的值本身已经被
  // encodeURIComponent 过一次），所以 address bar 上是 redirect=%252Fpages%252F…
  // —— 实测只解一次拿到的是 "%2Fpages%2F…"，indexOf('/pages/') 判不过，
  // 于是登录后会被退化成回首页，用户永远回不到他本来要进的页面。
  // 这里循环解到稳定（最多 3 次，防手改 URL 造成的无限嵌套），并全程兜住 URIError。
  let decoded = rawRedirect
  for (let i = 0; i < 3; i++) {
    const before = decoded
    try {
      decoded = decodeURIComponent(decoded)
    } catch (e) {
      break // 非法转义（例如孤立的 %）就停在上一层，交给下面的格式检查兜住
    }
    if (decoded === before) break
  }
  redirect.value = decoded

  if (reason.value === 'expired') notice.value = '登录状态过期，请重新登录'
  else if (reason.value === 'login-required') notice.value = '请先登录后继续'
})

function toggleMode() {
  isRegisterMode.value = !isRegisterMode.value
}

async function onSubmit() {
  const u = username.value.trim()
  const p = password.value.trim()
  const n = nickname.value.trim()
  if (!u || !p) {
    uni.showToast({ title: '请输入用户名和密码', icon: 'none' })
    return
  }
  // 注册昵称必填（服务端也会校验，这里先挡一道，避免白跑一次请求才报错）。
  // 长度上限与 auth.js 的 NICKNAME_MAX_LENGTH 一致（40）。
  if (isRegisterMode.value) {
    if (!n) {
      uni.showToast({ title: '请填写昵称', icon: 'none' })
      return
    }
    if (n.length > 40) {
      uni.showToast({ title: '昵称不能超过 40 个字符', icon: 'none' })
      return
    }
  }
  if (submitting.value) return
  submitting.value = true

  try {
    if (isRegisterMode.value) {
      const res = await userStore.register(u, p, n)
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
    // 分三种去向，判据是 redirect 而不是 reason：
    //
    // 1) 带 redirect = 页面守卫在 onLoad 里触发的（用户正在*进入*一个新页面，
    //    而该页 onLoad 已经提前 return、没完成初始化）。必须整页**重建**目标页，
    //    用 navigateBack 会返回一个"框架在、数据没加载"的半残页面。
    if (redirect.value && redirect.value.indexOf('/pages/') === 0) {
      uni.reLaunch({ url: redirect.value })
      return
    }
    // 2) back=1 = App 层检查或业务接口 401 触发的（用户*已经在*某个页面上，
    //    可能有没提交的输入）。用 navigateBack 回到原页面 —— 页面实例还在栈里、
    //    onLoad 不会重跑，所以聊天框里打了一半的消息之类会原封不动保留。
    if (back.value === '1') {
      uni.navigateBack({
        fail: () => { uni.reLaunch({ url: '/pages/index/index' }) }
      })
      return
    }
    // 3) 用户自己点进来的（品牌页点击 / 直接输 URL）
    uni.reLaunch({ url: '/pages/index/index' })
  }, 800)
}
</script>

<style scoped>
.login-container { min-height: 100vh; background: var(--bg-deep); display: flex; flex-direction: column; padding: 88rpx 48rpx; }

/* 提示条：金色（--accent-soft）而非红色 —— 登录过期是"需要重新确认身份"，
   不是错误，用红色会让用户以为系统出问题了 */
.login-notice {
  padding: 22rpx 28rpx;
  margin-bottom: 32rpx;
  border-radius: 24rpx;
  background: var(--accent-soft);
  border: 1rpx solid oklch(81% 0.13 84 / 0.45);
  text-align: center;
}
.login-notice-text { font-size: 24rpx; line-height: 1.6; color: var(--accent); font-weight: 600; }

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
/* 必填星号：昵称是注册必填项，和"可选"时期相比必须有可辨识的视觉差 */
.required { color: var(--accent); font-size: 23rpx; margin-left: 6rpx; }
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

.switch-mode { text-align: center; margin-top: 28rpx; }
.switch-text { font-size: 23rpx; color: var(--accent); font-weight: 600; }
</style>
