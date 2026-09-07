<template>
  <view class="monitor-container" :style="{ paddingTop: statusBarHeight + 'px' }">
    <view class="nav-bar">
      <view class="back-btn" @tap="goBack">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M12 5l-5 5 5 5"/>
        </svg>
      </view>
      <text class="nav-title">测试监控</text>
      <view class="refresh-btn" @tap="loadData">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <path d="M4 10a6 6 0 0 1 10.2-4.2M16 10a6 6 0 0 1-10.2 4.2"/>
          <path d="M14.2 5.8V10h-4.2M5.8 14.2V10h4.2"/>
        </svg>
      </view>
    </view>

    <view class="content">
      <!-- 时间筛选 -->
      <view class="filter-row">
        <button :class="['filter-btn', timeFilter === 'all' ? 'active' : '']" @tap="setTimeFilter('all')">全部</button>
        <button :class="['filter-btn', timeFilter === 'today' ? 'active' : '']" @tap="setTimeFilter('today')">今天</button>
        <button :class="['filter-btn', timeFilter === 'week' ? 'active' : '']" @tap="setTimeFilter('week')">本周</button>
      </view>

      <!-- 统计总览 -->
      <view class="stats-overview">
        <view class="stat-card">
          <text class="stat-value">{{ stats.totalUsers }}</text>
          <text class="stat-label">总用户数</text>
        </view>
        <view class="stat-card">
          <text class="stat-value">{{ stats.activeToday }}</text>
          <text class="stat-label">今日活跃</text>
        </view>
        <view class="stat-card">
          <text class="stat-value">{{ formatTime(stats.totalUsageTime) }}</text>
          <text class="stat-label">总时长</text>
        </view>
      </view>

      <!-- 用户列表 -->
      <view class="section">
        <text class="section-title">测试账号详情</text>
        <view class="user-list">
          <view v-for="user in testUsers" :key="user.userId" class="user-card">
            <view class="user-header">
              <view class="user-info">
                <text class="user-name">{{ user.username }}</text>
                <text class="user-nickname">{{ user.nickname }}</text>
              </view>
              <view :class="['status-dot', user.lastAction === 'login' ? 'online' : 'offline']"></view>
            </view>
            <view class="user-stats-grid">
              <view class="stat-item">
                <text class="stat-label-sm">登录次数</text>
                <text class="stat-value-sm">{{ user.loginCount }}</text>
              </view>
              <view class="stat-item">
                <text class="stat-label-sm">使用时长</text>
                <text class="stat-value-sm">{{ formatTime(user.totalUsageTime) }}</text>
              </view>
              <view class="stat-item">
                <text class="stat-label-sm">最后登录</text>
                <text class="stat-value-sm">{{ formatDate(user.lastLoginAt) }}</text>
              </view>
              <view class="stat-item">
                <text class="stat-label-sm">Token用量</text>
                <text class="stat-value-sm token-placeholder">待统计</text>
              </view>
            </view>
          </view>
        </view>
      </view>

      <!-- 登录日志 -->
      <view class="section">
        <text class="section-title">登录日志（最新50条）</text>
        <view v-if="recentLogs.length === 0" class="empty-hint">暂无日志</view>
        <view v-else class="log-list">
          <view v-for="(log, index) in recentLogs" :key="index" class="log-item">
            <view class="log-header">
              <text class="log-username">{{ log.username }}</text>
              <text :class="['log-action', log.action]">{{ log.action === 'login' ? '登录' : '登出' }}</text>
            </view>
            <text class="log-time">{{ formatDateTime(log.timestamp) }}</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>




<script>
import { getNavBarHeight } from '../../utils/navbar.js'
import userManager from '../../utils/account/userManager.js'

export default {
  data() {
    return {
      statusBarHeight: 0,
      timeFilter: 'all',
      userStats: [],
      recentLogs: [],
      stats: {
        totalUsers: 0,
        activeToday: 0,
        totalUsageTime: 0
      }
    }
  },
  computed: {
    testUsers() {
      // 只显示测试账号（test01~05 + admin）
      return this.userStats.filter(u => u.isTest || u.isAdmin)
    }
  },
  onLoad() {
    this.statusBarHeight = getNavBarHeight()
    // #ifdef H5
    this.statusBarHeight = 0
    // #endif

    // 检查管理员权限
    if (!userManager.isAdmin()) {
      uni.showToast({ title: '需要管理员权限', icon: 'none' })
      setTimeout(() => uni.navigateBack(), 1500)
      return
    }

    this.loadData()
  },
  methods: {
    loadData() {
      // 加载用户统计
      this.userStats = userManager.getUserStats() || []
      
      // 加载登录日志
      this.recentLogs = userManager.getLoginLogs({ limit: 50 }) || []
      
      // 计算统计数据
      this.calculateStats()
      
      uni.showToast({ title: '数据已刷新', icon: 'success', duration: 1000 })
    },
    
    calculateStats() {
      const todayStart = new Date().setHours(0, 0, 0, 0)
      
      this.stats.totalUsers = this.userStats.length
      this.stats.activeToday = this.userStats.filter(u => u.lastLoginAt >= todayStart).length
      this.stats.totalUsageTime = this.userStats.reduce((sum, u) => sum + (u.totalUsageTime || 0), 0)
    },
    
    setTimeFilter(filter) {
      this.timeFilter = filter
      let startTime = null
      
      if (filter === 'today') {
        startTime = new Date().setHours(0, 0, 0, 0)
      } else if (filter === 'week') {
        const weekAgo = new Date()
        weekAgo.setDate(weekAgo.getDate() - 7)
        startTime = weekAgo.getTime()
      }
      
      if (startTime) {
        this.recentLogs = userManager.getLoginLogs({ startTime, limit: 50 }) || []
      } else {
        this.recentLogs = userManager.getLoginLogs({ limit: 50 }) || []
      }
    },
    
    formatTime(ms) {
      if (!ms) return '0分钟'
      const minutes = Math.floor(ms / 60000)
      const hours = Math.floor(minutes / 60)
      if (hours > 0) {
        return `${hours}小时${minutes % 60}分钟`
      }
      return `${minutes}分钟`
    },
    
    formatDate(timestamp) {
      if (!timestamp) return '从未'
      const date = new Date(timestamp)
      const now = new Date()
      const diff = now - date
      
      if (diff < 60000) return '刚刚'
      if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
      if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
      if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`
      
      return `${date.getMonth() + 1}/${date.getDate()}`
    },
    
    formatDateTime(timestamp) {
      const date = new Date(timestamp)
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      const hour = String(date.getHours()).padStart(2, '0')
      const minute = String(date.getMinutes()).padStart(2, '0')
      return `${month}-${day} ${hour}:${minute}`
    },
    
    goBack() {
      uni.navigateBack()
    }
  }
}
</script>


<style scoped>
.monitor-container {
  min-height: 100vh;
  background: var(--bg-deep);
  padding-bottom: 40rpx;
}

.nav-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 88rpx;
  padding: 0 32rpx;
  background: var(--surface);
  border-bottom: 1rpx solid var(--border);
}

.back-btn, .refresh-btn {
  width: 64rpx;
  height: 64rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  transition: color 150ms ease;
}

.back-btn:active, .refresh-btn:active {
  color: var(--fg-soft);
}

.back-btn svg, .refresh-btn svg {
  width: 32rpx;
  height: 32rpx;
}

.nav-title {
  font-size: 32rpx;
  font-weight: 700;
  color: var(--fg);
}

.content {
  padding: 32rpx;
}

.filter-row {
  display: flex;
  gap: 16rpx;
  margin-bottom: 32rpx;
}

.filter-btn {
  flex: 1;
  height: 64rpx;
  line-height: 64rpx;
  background: var(--surface);
  border: 1rpx solid var(--border);
  border-radius: 12rpx;
  color: var(--muted);
  font-size: 26rpx;
  transition: all 150ms ease;
}

.filter-btn.active {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}

.stats-overview {
  display: flex;
  gap: 16rpx;
  margin-bottom: 32rpx;
}

.stat-card {
  flex: 1;
  background: var(--surface);
  border: 1rpx solid var(--border);
  border-radius: 16rpx;
  padding: 24rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8rpx;
}

.stat-value {
  font-size: 40rpx;
  font-weight: 700;
  color: var(--accent);
}

.stat-label {
  font-size: 22rpx;
  color: var(--muted);
}

.section {
  margin-bottom: 32rpx;
}

.section-title {
  display: block;
  font-size: 28rpx;
  font-weight: 700;
  color: var(--fg);
  margin-bottom: 16rpx;
}

.user-list {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.user-card {
  background: var(--surface);
  border: 1rpx solid var(--border);
  border-radius: 16rpx;
  padding: 24rpx;
}

.user-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16rpx;
}

.user-info {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.user-name {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--fg);
}

.user-nickname {
  font-size: 22rpx;
  color: var(--muted);
}

.status-dot {
  width: 16rpx;
  height: 16rpx;
  border-radius: 50%;
  flex: none;
}

.status-dot.online {
  background: var(--success);
  box-shadow: 0 0 12rpx var(--success);
}

.status-dot.offline {
  background: var(--muted);
}

.user-stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16rpx;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.stat-label-sm {
  font-size: 20rpx;
  color: var(--faint);
}

.stat-value-sm {
  font-size: 24rpx;
  font-weight: 600;
  color: var(--fg-soft);
}

.token-placeholder {
  color: var(--muted);
  font-style: italic;
}

.empty-hint {
  text-align: center;
  padding: 60rpx 0;
  color: var(--faint);
  font-size: 24rpx;
}

.log-list {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.log-item {
  background: var(--surface);
  border: 1rpx solid var(--border);
  border-radius: 12rpx;
  padding: 20rpx;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.log-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.log-username {
  font-size: 26rpx;
  font-weight: 600;
  color: var(--fg);
}

.log-action {
  font-size: 22rpx;
  padding: 4rpx 12rpx;
  border-radius: 8rpx;
  font-weight: 500;
}

.log-action.login {
  background: color-mix(in oklch, var(--success) 15%, transparent);
  color: var(--success);
}

.log-action.logout {
  background: color-mix(in oklch, var(--muted) 15%, transparent);
  color: var(--muted);
}

.log-time {
  font-size: 22rpx;
  color: var(--faint);
}
</style>

