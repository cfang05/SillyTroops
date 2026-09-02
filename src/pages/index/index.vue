<template>
  <view class="index-container" :style="{ paddingTop: statusBarHeight + 'px' }">

    <!-- 打招呼行 -->
    <view class="greet-row">
      <view class="greet">
        <view class="home-crest"><image src="/static/images/dragon-logo.png" mode="aspectFill"></image></view>
        <view class="greet-text">
          <text class="greet-title">早上好，旅团长</text>
          <text class="greet-mono">INFINITE TROUPE · 无限旅团</text>
        </view>
      </view>
      <view class="login-btn" @tap="handleLogin">
        <text class="login-mark">{{ isLoggedIn ? '✓' : '···' }}</text>
      </view>
    </view>

    <!-- 功能宫格 -->
    <view class="quest-grid">
      <view
        v-for="item in menuItems"
        :key="item.id"
        class="quest-tile"
        :style="{ '--tint': item.tint }"
        @tap="onMenuItemTap"
        :data-id="item.id">
        <view class="glyph">
          <!-- 开始对话 -->
          <svg v-if="item.id === 'session'" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 15V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H8l-3.5 3v-3H5a2 2 0 0 1-2-2z"/></svg>
          <!-- 酒馆导入 -->
          <svg v-else-if="item.id === 'import'" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3v10M6 9l4 4 4-4"/><path d="M4 15v1.5A1.5 1.5 0 0 0 5.5 18h9a1.5 1.5 0 0 0 1.5-1.5V15"/></svg>
          <!-- 角色卡库 -->
          <svg v-else-if="item.id === 'characters'" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="2.5" y="5" width="11" height="10" rx="2"/><path d="M6.5 3.3h9a1.7 1.7 0 0 1 1.7 1.7v7.5"/></svg>
          <!-- 我的角色 / Persona -->
          <svg v-else-if="item.id === 'persona'" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="10" cy="7" r="3.4"/><path d="M4 17c0-3.2 2.7-5 6-5s6 1.8 6 5"/></svg>
          <!-- 传奇收藏 -->
          <svg v-else-if="item.id === 'collect'" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M7 3h6l3 4-6 9-6-9 3-4z"/><path d="M3 7h14"/></svg>
          <!-- 设置 -->
          <svg v-else-if="item.id === 'settings'" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="3.4"/><path d="M10 2.3v1.7M10 16v1.7M2.3 10h1.7M16 10h1.7M4.6 4.6l1.2 1.2M14.2 14.2l1.2 1.2M15.4 4.6l-1.2 1.2M5.8 14.2l-1.2 1.2"/></svg>
          <!-- 游戏规则 -->
          <svg v-else-if="item.id === 'rules'" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3.5h9a1.5 1.5 0 0 1 1.5 1.5v11a1.5 1.5 0 0 0-1.5-1.5H4z"/><path d="M4 3.5A1.5 1.5 0 0 0 2.5 5v11A1.5 1.5 0 0 1 4 14.5"/></svg>
        </view>
        <text class="qt-title">{{ item.title }}</text>
        <text class="qt-desc">{{ item.desc }}</text>
      </view>
    </view>

    <view class="footer">
      <text class="version-text">v0.1</text>
    </view>
  </view>
</template>

<script>
import userManager from '../../utils/account/userManager.js'
import { getNavBarHeight } from '../../utils/navbar.js'

export default {
  data() {
    return {
      // 首页不用系统导航栏（pages.json 已设 navigationStyle:"custom"），打招呼行本身
      // 就是页面视觉上的“头部”，但仍需给顶部状态栏留出安全间距，避免被小程序状态栏遮挡
      statusBarHeight: 0,
      menuItems: [
        { id: 'session', title: '开始对话', desc: '继续历史对话，或选角色卡开始新对话', tint: 'var(--t-amber)' },
        { id: 'import', title: '酒馆导入', desc: '导入角色卡 / 正侧 / 预设', tint: 'var(--t-teal)' },
        { id: 'characters', title: '角色卡库', desc: 'AI 扮演的角色（酒馆角色卡管理）', tint: 'var(--t-violet)' },
        { id: 'persona', title: '我的角色', desc: '管理 Persona（对应 {{user}} 身份）', tint: 'var(--t-emerald)' },
        { id: 'collect', title: '传奇收藏', desc: '查看收集的特性和物品', tint: 'var(--t-gold)' },
        { id: 'settings', title: '设置', desc: '账号资料 / 模型参数配置', tint: 'var(--t-rose)' },
        { id: 'rules', title: '游戏规则', desc: '了解如何游玩', tint: 'var(--t-teal)' }
      ],
      isLoggedIn: false,
      loginText: '登录'
    }
  },

  onLoad() {
    this.checkLoginStatus()
    this.statusBarHeight = getNavBarHeight().statusBarHeight
  },

  onShow() {
    this.checkLoginStatus()
    try {
      const redirectUrl = uni.getStorageSync('redirectUrl')
      if (redirectUrl) {
        uni.removeStorageSync('redirectUrl')
        uni.redirectTo({ url: redirectUrl })
      }
    } catch (e) {}
  },

  methods: {
    checkLoginStatus() {
      // 本地账号系统（userManager）才是当前登录态的唯一来源，
      // App.vue 里的 openid 是旧版微信云开发登录，仅用于云函数调用，与账号系统无关
      const user = userManager.getCurrentUser()
      this.isLoggedIn = !!user
      this.loginText = user ? (user.nickname || user.username) : '登录'
    },

    handleLogin() {
      if (this.isLoggedIn) {
        uni.showModal({
          title: '已登录', content: '是否退出登录？', confirmText: '退出', cancelText: '取消',
          success: res => {
            if (res.confirm) {
              userManager.logout()
              this.checkLoginStatus()
              uni.reLaunch({ url: '/pages/login/login' })
            }
          }
        })
        return
      }
      uni.navigateTo({ url: '/pages/login/login' })
    },

    onMenuItemTap(e) {
      const id = e.currentTarget.dataset.id
      switch (id) {
        case 'session':
          uni.navigateTo({ url: '/pages/session/session' })
          break
        case 'import':
          uni.navigateTo({ url: '/pages/import/import' })
          break
        case 'persona':
          uni.navigateTo({ url: '/pages/persona/index' })
          break
        case 'characters':
          uni.navigateTo({ url: '/pages/characters/index' })
          break
        case 'collect':
          uni.navigateTo({ url: '/pages/collect/collect' })
          break
        case 'settings':
          uni.navigateTo({ url: '/pages/settings/settings' })
          break
        case 'rules':
          uni.navigateTo({ url: '/pages/rules/index' })
          break
      }
    },

    onShareAppMessage() {
      return { title: '无限旅团 - 你的奇幻世界', path: '/pages/index/index' }
    }
  }
}
</script>

<style scoped>
.index-container {
  min-height: 100vh;
  background: var(--bg-deep);
  display: flex;
  flex-direction: column;
  padding: 0 32rpx;
  padding-bottom: 40rpx;
}

/* 打招呼行 */
.greet-row { display: flex; align-items: center; justify-content: space-between; padding: 28rpx 0 24rpx; flex: none; }
.greet { display: flex; align-items: center; gap: 18rpx; }
.home-crest {
  width: 64rpx; height: 64rpx; border-radius: 20rpx; flex: none; overflow: hidden;
  background: linear-gradient(160deg, oklch(29% 0.05 80), oklch(20% 0.03 80));
  border: 1rpx solid oklch(80% 0.13 84 / 0.45);
  box-shadow: 0 0 28rpx -6rpx oklch(75% 0.13 80 / 0.5);
}
.home-crest image { width: 100%; height: 100%; }
.greet-text { display: flex; flex-direction: column; }
.greet-title { font-size: 34rpx; font-weight: 700; color: var(--fg); letter-spacing: .01em; line-height: 1.15; }
.greet-mono { font-family: var(--font-mono); font-size: 17rpx; color: var(--faint); margin-top: 6rpx; letter-spacing: .12em; }
.login-btn {
  width: 68rpx; height: 68rpx; flex: none; border-radius: 22rpx; background: var(--surface); border: 1rpx solid var(--border);
  display: flex; align-items: center; justify-content: center; color: var(--muted);
}
.login-mark { font-family: var(--font-mono); font-size: 22rpx; color: var(--accent); }

/* 功能宫格 */
.quest-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16rpx; flex: 1; align-content: start; padding: 8rpx 0 12rpx; }
.quest-tile {
  position: relative; border-radius: 28rpx; padding: 18rpx; aspect-ratio: 1 / 1.2;
  background: var(--surface); border: 1rpx solid var(--border); overflow: hidden;
  display: flex; flex-direction: column;
}
.quest-tile .glyph {
  width: 48rpx; height: 48rpx; border-radius: 16rpx; margin-bottom: 14rpx; flex: none;
  display: flex; align-items: center; justify-content: center;
  background: color-mix(in oklch, var(--tint) 16%, transparent); color: var(--tint);
}
.quest-tile .glyph svg { width: 26rpx; height: 26rpx; }
.qt-title { font-size: 24rpx; font-weight: 700; color: var(--fg); margin-bottom: 6rpx; line-height: 1.2; }
.qt-desc {
  font-size: 19rpx; color: var(--faint); line-height: 1.3; flex: 1;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}

/* 页脚 */
.footer { padding-top: 24rpx; text-align: center; flex: none; }
.version-text { font-family: var(--font-mono); font-size: 20rpx; color: var(--faint); letter-spacing: .08em; }
</style>
