 
<template>
  <view class="index-container" :style="{ paddingTop: statusBarHeight + 'px' }">
    <view class="greet-row">
      <view class="greet">
        <view class="home-crest"><image src="/static/images/dragon-logo.png" mode="aspectFill"></image></view>
        <view class="greet-text">
          <text class="greet-title">早上好，{{ userName }}</text>
          <text class="greet-mono">无限旅团 · 你的专属奇幻世界</text>
        </view>
      </view>
      <view class="header-actions">
        <view class="logout-btn" @tap="handleLogout">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4H5.5A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/><path d="M13 14l3.5-4L13 6"/><path d="M16.2 10H8"/></svg>
        </view>
        <view class="bell-btn" @tap="handleNotification">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10 5.5a3.5 3.5 0 0 1 3.5 3.5v2.5c0 .8.4 1.5 1 2l.5.5H5l.5-.5c.6-.5 1-1.2 1-2V9A3.5 3.5 0 0 1 10 5.5z"/>
            <path d="M8.5 14.5a1.5 1.5 0 0 0 3 0"/>
          </svg>
          <view class="dot"></view>
        </view>
      </view>
    </view>
    <view class="ribbon">
      <view class="ribbon-lv">
        <text class="lv-num">{{ userStore.level }}</text>
        <text class="lv-label">LV</text>
      </view>
      <view class="ribbon-mid">
        <view class="ribbon-title">
          <text class="title-text">第 {{ userStore.level }} 级 · {{ userStore.levelName }}</text>
          <text class="title-lv">LV {{ userStore.level }}</text>
        </view>
        <view class="progress">
          <view class="progress-bar" :style="{ width: userStore.progressPercent + '%' }"></view>
        </view>
        <text class="ribbon-xp">{{ userStore.xp }} / {{ userStore.xpToNextLevel }} XP</text>
      </view>
    </view>
    <view class="sub-line">
      <text><text class="count">{{ menuItems.length }}</text> 项功能</text>
      <text class="hint">继续冒险赚 <text class="xp-highlight">+120 XP</text></text>
    </view>
    <view class="quest-grid">
      <view v-for="item in menuItems" :key="item.id" class="quest-tile" :style="{ '--tint': item.tint }" @tap="onMenuItemTap" :data-id="item.id">
        <view class="glyph">
          <svg v-if="item.id === 'session'" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 15V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H8l-3.5 3v-3H5a2 2 0 0 1-2-2z"/></svg>
          <svg v-else-if="item.id === 'characters'" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="2.5" y="5" width="11" height="10" rx="2"/><path d="M6.5 3.3h9a1.7 1.7 0 0 1 1.7 1.7v7.5"/></svg>
          <svg v-else-if="item.id === 'collect'" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M7 3h6l3 4-6 9-6-9 3-4z"/><path d="M3 7h14"/></svg>
          <svg v-else-if="item.id === 'import'" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3v10M6 9l4 4 4-4"/><path d="M4 15v1.5A1.5 1.5 0 0 0 5.5 18h9a1.5 1.5 0 0 0 1.5-1.5V15"/></svg>
          <svg v-else-if="item.id === 'persona'" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="10" cy="7" r="3.4"/><path d="M4 17c0-3.2 2.7-5 6-5s6 1.8 6 5"/></svg>
          <svg v-else-if="item.id === 'monitor'" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="14" height="10" rx="2"/><path d="M7 9h6M7 12h4"/></svg>
          <svg v-else-if="item.id === 'settings'" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="3.4"/><path d="M10 2.3v1.7M10 16v1.7M2.3 10h1.7M16 10h1.7M4.6 4.6l1.2 1.2M14.2 14.2l1.2 1.2M15.4 4.6l-1.2 1.2M5.8 14.2l-1.2 1.2"/></svg>
        </view>
        <text class="qt-title">{{ item.title }}</text>
        <text class="qt-desc">{{ item.desc }}</text>
        <view class="xp-badge" :style="{ '--badge-color': item.tint }">{{ item.xpReward }}</view>
      </view>
    </view>
    <view class="tabbar">
      <view class="tab active" @tap="handleTabTap" data-id="today">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7.5"/><path d="M10 5.5v4.5l3 2"/></svg>
        <text>今日</text>
      </view>
      <view class="tab" @tap="handleTabTap" data-id="characters">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="2.5" y="5" width="11" height="10" rx="2"/><path d="M6.5 3.3h9a1.7 1.7 0 0 1 1.7 1.7v7.5"/></svg>
        <text>角色</text>
      </view>
      <view class="tab-center">
        <view class="fab" @tap="handleFabTap">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M10 5v10M5 10h10"/></svg>
        </view>
      </view>
      <view class="tab" @tap="handleTabTap" data-id="collect">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M7 3h6l3 4-6 9-6-9 3-4z"/><path d="M3 7h14"/></svg>
        <text>收藏</text>
      </view>
      <view class="tab" @tap="handleTabTap" data-id="profile">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="10" cy="7" r="3.4"/><path d="M4 17c0-3.2 2.7-5 6-5s6 1.8 6 5"/></svg>
        <text>我的</text>
      </view>
    </view>
  </view>

  <!-- 通知窗口：背景透明，右上角关闭键 -->
  <view :class="['notif-modal', showNotifModal ? 'show' : '']" @tap="closeNotifModal">
    <view class="notif-content" @tap.stop="stopPropagation">
      <view class="notif-close" @tap="closeNotifModal">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 5l10 10M15 5L5 15"/></svg>
      </view>
    </view>
  </view>
</template>

<script>
import { getNavBarHeight } from '../../utils/navbar.js'
import { useUserStore } from '../../stores/userStore'
import userManager from '../../utils/account/userManager.js'

export default {
  data() {
    return {
      statusBarHeight: 0,
      userStore: null,
      isAdmin: false,
      menuItems: [],
      showNotifModal: false
    }
  },
  computed: {
    userName() {
      return this.userStore?.currentUser?.nickname || this.userStore?.currentUser?.username || '旅团长'
    }
  },
  onLoad() {
    this.statusBarHeight = getNavBarHeight()
    // #ifdef H5
    this.statusBarHeight = 0
    // #endif
    this.userStore = useUserStore()
    this.userStore.syncCurrentUser()
    this.isAdmin = userManager.isAdmin()
    this.updateMenuItems()
  },
  onShow() {
    if (this.userStore) {
      this.userStore.syncCurrentUser()
      this.isAdmin = userManager.isAdmin()
      this.updateMenuItems()
    }
  },
  methods: {
    updateMenuItems() {
      const baseItems = [
        { id: 'session', title: '开始对话', desc: '继续历史对话或选卡新建', xpReward: '+120 XP', tint: 'var(--t-amber)' },
        { id: 'characters', title: '角色卡库', desc: 'AI 扮演角色管理', xpReward: '+40 XP', tint: 'var(--t-violet)' },
        { id: 'collect', title: '传奇收藏', desc: '查看收集的特性物品', xpReward: '+30 XP', tint: 'var(--t-gold)' },
        { id: 'import', title: '酒馆导入', desc: '角色卡 / 正侧 / 预设', xpReward: '+25 XP', tint: 'var(--t-teal)' },
        { id: 'persona', title: '我的角色', desc: '管理 Persona 身份', xpReward: '+15 XP', tint: 'var(--t-emerald)' },
        { id: 'settings', title: '设置', desc: '账号 / 模型参数', xpReward: '+5 XP', tint: 'var(--muted)' }
      ]
      
      // 管理员增加"测试监控"入口
      if (this.isAdmin) {
        baseItems.splice(5, 0, { 
          id: 'monitor', 
          title: '测试监控', 
          desc: '测试账号使用情况统计', 
          xpReward: '🔒', 
          tint: 'var(--danger)' 
        })
      }
      
      this.menuItems = baseItems
    },
    handleNotification() {
      this.showNotifModal = true
    },
    closeNotifModal() {
      this.showNotifModal = false
    },
    stopPropagation() {},
    handleLogout() {
      uni.showModal({
        title: '退出登录',
        content: '确定要退出登录吗？',
        success: (res) => {
          if (res.confirm) {
            this.userStore.logout()
            uni.reLaunch({ url: '/pages/login/login' })
          }
        }
      })
    },
    handleFabTap() {
      uni.navigateTo({ url: '/pages/session/session' })
    },
    handleTabTap(e) {
      const id = e.currentTarget.dataset.id
      switch (id) {
        case 'today': break
        case 'characters': uni.navigateTo({ url: '/pages/characters/index' }); break
        case 'collect': uni.navigateTo({ url: '/pages/collect/collect' }); break
        case 'profile': uni.showToast({ title: '功能开发中', icon: 'none', duration: 1500 }); break
      }
    },
    onMenuItemTap(e) {
      const id = e.currentTarget.dataset.id
      switch (id) {
        case 'session': uni.navigateTo({ url: '/pages/session/session' }); break
        case 'import': uni.navigateTo({ url: '/pages/import/import' }); break
        case 'persona': uni.navigateTo({ url: '/pages/persona/index' }); break
        case 'characters': uni.navigateTo({ url: '/pages/characters/index' }); break
        case 'collect': uni.navigateTo({ url: '/pages/collect/collect' }); break
        case 'monitor': uni.navigateTo({ url: '/pages/monitor/monitor' }); break
        case 'settings': uni.navigateTo({ url: '/pages/settings/settings' }); break
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
  padding-bottom: 0;
}

.greet-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx 32rpx 24rpx;
  flex: none;
  margin-top: 40rpx; /* 问候语上方留白 */
}

.greet {
  display: flex;
  align-items: center;
  gap: 18rpx;
}

.home-crest {
  width: 64rpx;
  height: 64rpx;
  border-radius: 20rpx;
  flex: none;
  overflow: hidden;
  background: linear-gradient(160deg, oklch(29% 0.05 80), oklch(20% 0.03 80));
  border: 1rpx solid oklch(80% 0.13 84 / 0.45);
  box-shadow: 0 0 28rpx -6rpx oklch(75% 0.13 80 / 0.5);
}

.home-crest image {
  width: 100%;
  height: 100%;
}

.greet-text {
  display: flex;
  flex-direction: column;
}

.greet-title {
  font-size: 34rpx;
  font-weight: 700;
  color: var(--fg);
  letter-spacing: 0.01em;
  line-height: 1.15;
}

.greet-mono {
  font-family: var(--font-mono);
  font-size: 17rpx;
  color: var(--faint);
  margin-top: 6rpx;
  letter-spacing: 0.12em;
}

.bell-btn {
  width: 68rpx;
  height: 68rpx;
  flex: none;
  border-radius: 22rpx;
  background: var(--surface);
  border: 1rpx solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  position: relative;
  transition: border-color 150ms ease, color 150ms ease;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 16rpx;
  flex: none;
}

.logout-btn {
  width: 68rpx;
  height: 68rpx;
  flex: none;
  border-radius: 22rpx;
  background: var(--surface);
  border: 1rpx solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  transition: border-color 150ms ease, color 150ms ease;
}

.logout-btn:active {
  border-color: var(--border-strong);
  color: var(--fg-soft);
}

.logout-btn svg {
  width: 32rpx;
  height: 32rpx;
}

.bell-btn:active {
  border-color: var(--border-strong);
  color: var(--fg-soft);
}

.bell-btn svg {
  width: 32rpx;
  height: 32rpx;
}

.bell-btn .dot {
  position: absolute;
  top: 12rpx;
  right: 14rpx;
  width: 12rpx;
  height: 12rpx;
  border-radius: 50%;
  background: var(--danger);
  box-shadow: 0 0 0 4rpx var(--bg-deep);
}

.ribbon {
  display: flex;
  align-items: center;
  gap: 24rpx;
  padding: 22rpx 26rpx;
  border-radius: 32rpx;
  flex: none;
  margin: 0 32rpx 16rpx;
  background: oklch(24% 0.02 70 / 0.68);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1rpx solid oklch(80% 0.13 84 / 0.30);
  box-shadow: inset 0 2rpx 0 oklch(100% 0 0 / 0.06);
}

.ribbon-lv {
  width: 92rpx;
  height: 92rpx;
  flex: none;
  border-radius: 26rpx;
  background: linear-gradient(160deg, oklch(32% 0.06 80), oklch(24% 0.04 80));
  border: 1rpx solid oklch(80% 0.13 84 / 0.4);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.lv-num {
  font-family: var(--font-mono);
  font-size: 28rpx;
  color: var(--accent);
  line-height: 1;
  font-weight: 700;
}

.lv-label {
  font-size: 14rpx;
  color: var(--muted);
  letter-spacing: 0.14em;
  margin-top: 4rpx;
}

.ribbon-mid {
  flex: 1;
  min-width: 0;
}

.ribbon-title {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 12rpx;
}

.title-text {
  font-size: 24rpx;
  font-weight: 700;
  color: var(--fg);
}

.title-lv {
  font-family: var(--font-mono);
  font-size: 16rpx;
  color: var(--accent);
  letter-spacing: 0.07em;
}

.progress {
  height: 12rpx;
  border-radius: 6rpx;
  background: oklch(100% 0 0 / 0.09);
  overflow: hidden;
}

.progress-bar {
  display: block;
  height: 100%;
  border-radius: 6rpx;
  background: linear-gradient(90deg, var(--accent), oklch(70% 0.14 60));
  box-shadow: 0 0 20rpx oklch(78% 0.13 82 / 0.55);
  transition: width 300ms ease;
}

.ribbon-xp {
  font-family: var(--font-mono);
  font-size: 16rpx;
  color: var(--muted);
  letter-spacing: 0.07em;
  margin-top: 12rpx;
  display: block;
}

.sub-line {
  font-family: var(--font-mono);
  font-size: 19rpx;
  color: var(--muted);
  letter-spacing: 0.09em;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  flex: none;
  padding: 0 32rpx 16rpx;
}

.sub-line .count {
  color: var(--accent);
  font-weight: 700;
}

.sub-line .hint {
  color: var(--faint);
}

.sub-line .xp-highlight {
  color: var(--accent);
  font-weight: 700;
}

.quest-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16rpx;
  overflow-y: auto;
  padding: 8rpx 32rpx 16rpx;
  flex: 1;
  min-height: 0;
  align-content: start;
}

.quest-tile {
  position: relative;
  border-radius: 28rpx;
  padding: 18rpx;
  aspect-ratio: 1 / 1.2;
  background: var(--surface);
  border: 1rpx solid var(--border);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transition: transform 170ms ease, border-color 170ms ease, box-shadow 170ms ease;
}

.quest-tile::before {
  content: "";
  position: absolute;
  inset: 0;
  opacity: 0.17;
  background: radial-gradient(220rpx 140rpx at 50% -20rpx, var(--tint), transparent 72%);
  pointer-events: none;
}

.quest-tile:active {
  transform: scale(0.96);
  border-color: var(--border-strong);
}

.quest-tile .glyph {
  width: 48rpx;
  height: 48rpx;
  border-radius: 16rpx;
  margin-bottom: 14rpx;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in oklch, var(--tint) 16%, transparent);
  color: var(--tint);
  position: relative;
  z-index: 1;
}

.quest-tile .glyph svg {
  width: 26rpx;
  height: 26rpx;
}

.qt-title {
  font-size: 24rpx;
  font-weight: 700;
  color: var(--fg);
  margin-bottom: 6rpx;
  line-height: 1.2;
  position: relative;
  z-index: 1;
}

.qt-desc {
  font-size: 19rpx;
  color: var(--faint);
  line-height: 1.3;
  flex: 1;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  position: relative;
  z-index: 1;
}

.xp-badge {
  position: absolute;
  bottom: 12rpx;
  right: 12rpx;
  font-family: var(--font-mono);
  font-size: 15rpx;
  font-weight: 700;
  color: var(--badge-color, var(--accent));
  letter-spacing: 0.05em;
  padding: 6rpx 10rpx;
  border-radius: 10rpx;
  background: color-mix(in oklch, var(--badge-color, var(--accent)) 12%, transparent);
  z-index: 1;
}

.tabbar {
  margin-top: auto;
  height: 110rpx;
  flex: none;
  display: flex;
  align-items: flex-start;
  justify-content: space-around;
  padding: 26rpx 16rpx 0;
  background: oklch(15% 0.012 70 / 0.85);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border-top: 1rpx solid var(--border);
  position: relative;
  z-index: 30;
}

.tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6rpx;
  width: 104rpx;
  padding-top: 2rpx;
  color: var(--faint);
  border-radius: 18rpx;
  transition: color 150ms ease;
}

.tab svg {
  width: 34rpx;
  height: 34rpx;
}

.tab text {
  font-size: 19rpx;
  font-family: var(--font-body);
  font-weight: 500;
  letter-spacing: 0.01em;
}

.tab.active {
  color: var(--accent);
}

.tab-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 104rpx;
}

.fab {
  width: 72rpx;
  height: 72rpx;
  border-radius: 24rpx;
  margin-top: -40rpx;
  background: linear-gradient(160deg, var(--accent), var(--accent-strong));
  color: #171104;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 24rpx 52rpx -20rpx oklch(75% 0.14 80 / 0.6), inset 0 2rpx 0 oklch(100% 0 0 / 0.4);
  transition: transform 160ms ease, filter 160ms ease;
}

.fab:active {
  transform: translateY(0) scale(0.94);
}

.fab svg {
  width: 30rpx;
  height: 30rpx;
}

.notif-modal {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: transparent;
  display: none;
  align-items: flex-start;
  justify-content: flex-end;
  z-index: 1000;
  padding: 32rpx;
  box-sizing: border-box;
}

.notif-modal.show { display: flex; }

.notif-content {
  position: relative;
  width: 560rpx;
  min-height: 320rpx;
  background: transparent;
  border-radius: 24rpx;
}

.notif-close {
  position: absolute;
  top: 0;
  right: 0;
  width: 56rpx;
  height: 56rpx;
  border-radius: 18rpx;
  background: var(--surface);
  border: 1rpx solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-soft);
}

.notif-close svg {
  width: 26rpx;
  height: 26rpx;
}
</style>
