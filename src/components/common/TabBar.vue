<template>
  <!-- 全局底部导航栏
       视觉完全对齐 notes/wuxian-lvtuan-core-pages.html 的 .tabbar：
       高度 55 / 内边距 13px 8px 0 / 半透明底 + 18px 毛玻璃 / 上边框 / 五个等分位，
       图标 17px、标签 9.5px、未激活 --faint、激活 --accent，中间保留 + FAB（36px，上浮 20px）。
       1px = 2rpx（基准屏 750rpx = 375px）。 -->
  <view class="tabbar">
    <button
      v-for="item in tabs"
      :key="item.id"
      :class="['tab', active === item.id ? 'active' : '']"
      :aria-label="item.label"
      :aria-pressed="active === item.id ? 'true' : 'false'"
      @tap="onTab(item)"
    >
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <!-- 今日任务 -->
        <template v-if="item.id === 'today'">
          <circle cx="10" cy="10" r="7.5" />
          <path d="M10 5.5v4.5l3 2" />
        </template>
        <!-- 冒险卡池 -->
        <template v-else-if="item.id === 'cardpool'">
          <rect x="2.5" y="5" width="11" height="10" rx="2" />
          <path d="M6.5 3.3h9a1.7 1.7 0 0 1 1.7 1.7v7.5" />
        </template>
        <!-- 传奇收藏 -->
        <template v-else-if="item.id === 'collect'">
          <path d="M7 3h6l3 4-6 9-6-9 3-4z" />
          <path d="M3 7h14" />
        </template>
        <!-- 账号管理 -->
        <template v-else-if="item.id === 'account'">
          <circle cx="10" cy="7" r="3.4" />
          <path d="M4 17c0-3.2 2.7-5 6-5s6 1.8 6 5" />
        </template>
      </svg>
      <text>{{ item.label }}</text>
    </button>

    <view class="tab-center">
      <button class="fab" aria-label="开始对话" @tap="onFab">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M10 5v10M5 10h10" /></svg>
      </button>
    </view>
  </view>
</template>

<script>
// 未实现的 Tab 一律 Toast「功能开发中」，不做跳转 —— 避免把用户带到空白页。
export default {
  name: 'TabBar',
  props: {
    // 当前激活的 tab id：today | cardpool | collect | account
    active: { type: String, default: '' }
  },
  emits: ['tab', 'fab'],
  data() {
    return {
      tabs: [
        { id: 'today', label: '今日任务' },
        { id: 'cardpool', label: '冒险卡池' },
        { id: 'collect', label: '传奇收藏' },
        { id: 'account', label: '账号管理' }
      ]
    }
  },
  methods: {
    onTab(item) {
      // 先抛给页面：页面自己就是某个 tab 时（例如首页=今日任务）只需保持高亮，不重复跳转
      this.$emit('tab', item.id)

      if (item.id === 'cardpool') {
        uni.navigateTo({ url: '/pages/cardpool/cardpool' })
        return
      }
      // today / collect / account 尚未实现
      uni.showToast({ title: '功能开发中', icon: 'none', duration: 1500 })
    },
    onFab() {
      this.$emit('fab')
      uni.navigateTo({ url: '/pages/session/session' })
    }
  }
}
</script>

<style scoped>
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
  padding: 2rpx 0 0;
  margin: 0;
  background: none;
  border: 0;
  line-height: 1;
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
  line-height: 1.15;
  white-space: nowrap;
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
  margin: -40rpx 0 0;
  padding: 0;
  border: 0;
  background: linear-gradient(160deg, var(--accent), var(--accent-strong));
  color: #171104;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 24rpx 52rpx -20rpx oklch(75% 0.14 80 / 0.6), inset 0 2rpx 0 oklch(100% 0 0 / 0.4);
  transition: transform 160ms ease, filter 160ms ease;
}

.fab svg {
  width: 30rpx;
  height: 30rpx;
}

.fab:active {
  transform: translateY(0) scale(0.94);
}
</style>
