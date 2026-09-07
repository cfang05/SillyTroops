<!-- 测试页面：验证等级系统 -->
<template>
  <view class="test-container">
    <view class="test-header">
      <text class="test-title">等级系统测试面板</text>
    </view>

    <view class="test-section">
      <text class="section-title">当前状态</text>
      <view class="info-row">
        <text class="label">用户：</text>
        <text class="value">{{ userStore?.currentUser?.username || '未登录' }}</text>
      </view>
      <view class="info-row">
        <text class="label">等级：</text>
        <text class="value">Lv {{ userStore.level }}</text>
      </view>
      <view class="info-row">
        <text class="label">称号：</text>
        <text class="value">{{ userStore.levelName }}</text>
      </view>
      <view class="info-row">
        <text class="label">经验值：</text>
        <text class="value">{{ userStore.xp }} / {{ userStore.xpToNextLevel }}</text>
      </view>
      <view class="info-row">
        <text class="label">进度：</text>
        <text class="value">{{ userStore.progressPercent }}%</text>
      </view>
    </view>

    <view class="test-section">
      <text class="section-title">操作</text>
      <button class="test-btn" @tap="addXp(10)">+10 XP</button>
      <button class="test-btn" @tap="addXp(50)">+50 XP</button>
      <button class="test-btn" @tap="addXp(100)">+100 XP</button>
      <button class="test-btn" @tap="addXp(500)">+500 XP</button>
      <button class="test-btn danger" @tap="resetLevel">重置等级</button>
    </view>

    <view class="test-section">
      <text class="section-title">升级记录</text>
      <view v-for="(log, idx) in logs" :key="idx" class="log-item">
        <text>{{ log }}</text>
      </view>
    </view>
  </view>
</template>

<script>
import { useUserStore } from '../../stores/userStore'

export default {
  data() {
    return {
      userStore: null,
      logs: []
    }
  },

  onLoad() {
    this.userStore = useUserStore()
    this.userStore.syncCurrentUser()
    
    if (!this.userStore.currentUser) {
      uni.showModal({
        title: '提示',
        content: '请先登录',
        success: (res) => {
          if (res.confirm) {
            uni.reLaunch({ url: '/pages/login/login' })
          }
        }
      })
    }
  },

  methods: {
    addXp(amount) {
      const oldLevel = this.userStore.level
      const levelUps = this.userStore.addXp(amount)
      
      if (levelUps > 0) {
        this.logs.unshift(`🎉 升级！从 Lv ${oldLevel} → Lv ${this.userStore.level} (${this.userStore.levelName})`)
        
        uni.showToast({
          title: `恭喜升级至 Lv ${this.userStore.level}！`,
          icon: 'success',
          duration: 2000
        })
      } else {
        this.logs.unshift(`+${amount} XP，当前进度 ${this.userStore.progressPercent}%`)
      }
    },

    resetLevel() {
      uni.showModal({
        title: '确认重置',
        content: '确定要重置等级为 Lv 1 吗？',
        success: (res) => {
          if (res.confirm) {
            this.userStore.level = 1
            this.userStore.xp = 0
            this.userStore.saveLevelData()
            this.logs.unshift('✨ 等级已重置为 Lv 1')
            uni.showToast({ title: '已重置', icon: 'success' })
          }
        }
      })
    }
  }
}
</script>

<style scoped>
.test-container {
  min-height: 100vh;
  background: var(--bg-deep);
  padding: 32rpx;
}

.test-header {
  margin-bottom: 32rpx;
  padding-bottom: 24rpx;
  border-bottom: 2rpx solid var(--border);
}

.test-title {
  font-size: 40rpx;
  font-weight: 700;
  color: var(--fg);
}

.test-section {
  background: var(--surface);
  border-radius: 24rpx;
  padding: 24rpx;
  margin-bottom: 24rpx;
  border: 1rpx solid var(--border);
}

.section-title {
  font-size: 28rpx;
  font-weight: 700;
  color: var(--accent);
  margin-bottom: 16rpx;
  display: block;
}

.info-row {
  display: flex;
  padding: 12rpx 0;
  border-bottom: 1rpx solid var(--border);
}

.info-row:last-child {
  border-bottom: none;
}

.label {
  font-size: 24rpx;
  color: var(--muted);
  width: 160rpx;
  flex: none;
}

.value {
  font-size: 24rpx;
  font-weight: 600;
  color: var(--fg);
  flex: 1;
}

.test-btn {
  width: 100%;
  height: 80rpx;
  background: var(--accent);
  color: #171104;
  border: none;
  border-radius: 16rpx;
  font-size: 28rpx;
  font-weight: 700;
  margin-bottom: 12rpx;
}

.test-btn.danger {
  background: var(--danger);
  color: white;
}

.log-item {
  padding: 12rpx;
  background: var(--bg-deep);
  border-radius: 12rpx;
  margin-bottom: 8rpx;
  font-size: 22rpx;
  color: var(--fg-soft);
  font-family: var(--font-mono);
}
</style>
