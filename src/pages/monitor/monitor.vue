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
        <text class="section-title">账号测试权限</text>
        <text class="section-sub">开关控制各账号能否使用内置测试 API；admin 恒有权限，不可关闭</text>
        <view class="user-list">
          <view v-for="user in userStats" :key="user.userId" class="user-card">
            <view class="user-header">
              <view class="user-info">
                <text class="user-name">{{ user.username }}</text>
                <text class="user-nickname">{{ user.nickname }}</text>
              </view>
              <view class="user-header-right">
                <view :class="['status-dot', isOnline(user) ? 'online' : 'offline']"></view>
                <view class="perm-toggle">
                  <text class="perm-label">{{ user.isAdmin ? '管理员' : '测试权限' }}</text>
                  <switch
                    :checked="!!user.isTest"
                    :disabled="!!user.isAdmin"
                    color="#e9cf8c"
                    class="perm-switch"
                    @change="onToggleTest"
                    :data-id="user.userId"
                  />
                </view>
              </view>
            </view>
            <view class="user-stats-grid">
              <view class="stat-item">
                <text class="stat-label-sm">登录次数</text>
                <text class="stat-value-sm">{{ user.loginCount || 0 }}</text>
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
                <text class="stat-value-sm">{{ formatTokens((user.tokenUsage && user.tokenUsage.total) || 0) }}</text>
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
              <text :class="['log-action', log.action]">{{ logActionText(log.action) }}</text>
            </view>
            <text class="log-time">{{ formatDateTime(log.timestamp) }}</text>
          </view>
        </view>
      </view>
      <!-- 按天活跃（Asia/Shanghai 日历日；数据来自数据库 usage_daily） -->
      <view class="section">
        <text class="section-title">最近 7 天活跃</text>
        <view v-if="dailyStats.length === 0" class="empty-hint">暂无按天数据</view>
        <view v-else class="log-list">
          <view v-for="d in dailyStats" :key="d.userId + '_' + d.day" class="log-item">
            <view class="log-header">
              <text class="log-username">{{ d.day }} · {{ usernameOf(d.userId) }}</text>
              <text class="log-action">活跃 {{ formatTime(d.activeMs) }}</text>
            </view>
            <text class="log-time">Token {{ formatTokens(d.promptTokens + d.completionTokens) }} · 登录 {{ d.loginCount }} 次</text>
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
      dailyStats: [],
      stats: {
        totalUsers: 0,
        activeToday: 0,
        totalUsageTime: 0
      }
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

    // 打开监控页前先把当前账号累计到现在的会话时长结算掉，让页面看到最新的使用时长
    try { userManager.heartbeat() } catch (e) { /* ignore */ }

    this.loadData()
  },
  methods: {
    async loadData() {
      try {
        // 加载用户统计（本机 + 服务器跨设备汇总：服务器数据来自所有设备上报的
        // 登录/登出/心跳/Token 事件，因此能看到其他账号在其他设备上的登录情况与次数）
        this.userStats = (await userManager.getUserStatsMerged()) || []
      } catch (e) {
        this.userStats = userManager.getUserStats() || []
      }

      // 加载登录日志（同样合并服务器汇总）；"登录日志"栏目只展示登录/登出动作，
      // 心跳/注册/Token 上报动作只参与账号卡片里的统计展示，不刷屏日志列表
      try {
        this.recentLogs = (await userManager.getLoginLogsMerged({ limit: 100 })) || []
      } catch (e) {
        this.recentLogs = userManager.getLoginLogs({ limit: 100 }) || []
      }
      this.recentLogs = this.recentLogs.filter(l => l.action === 'login' || l.action === 'logout').slice(0, 50)

      // 按天活跃（数据库 usage_daily；day 由服务端按 Asia/Shanghai 计算）
      try {
        this.dailyStats = (await userManager.getDailyStats({ limit: 7 })) || []
      } catch (e) {
        this.dailyStats = []
      }

      // 计算统计数据
      this.calculateStats()

      uni.showToast({ title: '数据已刷新', icon: 'success', duration: 1000 })
    },
    
    calculateStats() {
      const todayStart = new Date().setHours(0, 0, 0, 0)
      
      this.stats.totalUsers = this.userStats.length
      // 今日活跃 = 今天（凌晨起）有活动的账号数（活跃 = 登录或活跃时长上报；服务端按 Asia/Shanghai 记 day）
      this.stats.activeToday = this.userStats.filter(u => {
        const lastTs = u.lastActiveAt || u.lastLoginAt
        return !!lastTs && lastTs >= todayStart
      }).length
      this.stats.totalUsageTime = this.userStats.reduce((sum, u) => sum + (u.totalUsageTime || 0), 0)
    },
    
    async setTimeFilter(filter) {
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
        const merged = await userManager.getLoginLogsMerged({ startTime, limit: 200 }) || []
        this.recentLogs = merged.filter(l => l.action === 'login' || l.action === 'logout').slice(0, 50)
      } else {
        const merged = await userManager.getLoginLogsMerged({ limit: 200 }) || []
        this.recentLogs = merged.filter(l => l.action === 'login' || l.action === 'logout').slice(0, 50)
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

    /** Token 数字的展示格式化：1.2万 / 345万 等，便于阅读 */
    formatTokens(n) {
      n = Number(n) || 0
      if (n <= 0) return '0'
      if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿'
      if (n >= 10000) return (n / 10000).toFixed(1) + '万'
      return String(Math.round(n))
    },

    /** 在线状态：最近 15 分钟内有登录或活跃时长上报视为在线 */
    isOnline(user) {
      const lastTs = user.lastActiveAt || user.lastLoginAt
      if (!lastTs) return false
      return (Date.now() - lastTs) < 15 * 60 * 1000
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

    logActionText(action) {
      switch (action) {
        case 'login': return '登录'
        case 'logout': return '登出'
        case 'heartbeat': return '在线'
        case 'register': return '注册'
        case 'token': return '用量'
        default: return action || ''
      }
    },

    /** admin 切换某个账号的测试权限（写数据库；服务端权威，下一次该账号请求即生效） */
    async onToggleTest(e) {
      const id = e.currentTarget.dataset.id
      const value = e.detail.value
      const u = this.userStats.find(x => x.userId === id)
      if (!u) return
      if (u.isAdmin) {
        uni.showToast({ title: '管理员恒有测试权限，不可关闭', icon: 'none' })
        return
      }
      const prev = u.isTest
      // 立即更新本地列表，让开关状态即时反馈
      u.isTest = value
      const res = await userManager.setTestPermission(id, value)
      if (!res || !res.success) {
        u.isTest = prev // 失败回滚，避免界面与数据库不一致
        uni.showToast({ title: (res && res.message) || '权限调整失败', icon: 'none' })
        return
      }
      uni.showToast({
        title: (value ? '已开启 ' : '已关闭 ') + u.username + ' 的测试权限',
        icon: 'none'
      })
    },

    /** 按天统计里把 userId 显示成用户名 */
    usernameOf(userId) {
      const u = this.userStats.find(x => x.userId === userId)
      return (u && (u.username || u.nickname)) || userId
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
  margin-bottom: 8rpx;
}

.section-sub {
  display: block;
  font-size: 20rpx;
  color: var(--faint);
  margin-bottom: 16rpx;
  line-height: 1.5;
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

.user-header-right {
  display: flex;
  align-items: center;
  gap: 16rpx;
  flex: none;
}

.perm-toggle {
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.perm-label {
  font-size: 20rpx;
  color: var(--faint);
}

.perm-switch {
  transform: scale(0.75);
  transform-origin: right center;
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

