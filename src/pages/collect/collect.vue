<template>
  <view class="container">
    <NavBar title="传奇收藏" />

    <!-- 标签页 -->
    <view class="tabs" :style="{ paddingTop: (navBarHeight + 16) + 'px' }">
      <view
        :class="['tab', currentTab === 0 ? 'active' : '']"
        @tap="switchTab"
        data-tab="0">
        <text class="tab-text">人物特性</text>
      </view>
      <view
        :class="['tab', currentTab === 1 ? 'active' : '']"
        @tap="switchTab"
        data-tab="1">
        <text class="tab-text">传奇物品</text>
      </view>
    </view>

    <!-- 人物特性列表 -->
    <scroll-view class="content" scroll-y="true" v-if="currentTab === 0">
      <view class="collection-grid">
        <view
          v-for="item in traits"
          :key="item.id"
          :class="['collection-item', item.unlocked ? 'unlocked' : 'locked']"
          @tap="onTraitTap"
          :data-item="item">
          <view class="item-content">
            <text class="item-name">{{ item.unlocked ? item.name : '???' }}</text>
            <text class="item-desc">{{ item.unlocked ? item.description : '未解锁' }}</text>
          </view>
          <view v-if="!item.unlocked" class="lock-icon">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="9" width="11" height="8" rx="1.8"/><path d="M6.5 9V6.2a3.5 3.5 0 0 1 7 0V9"/></svg>
          </view>
        </view>
      </view>

      <view class="stats">
        <text class="stats-text">已收集: {{ unlockedTraitCount }} / {{ totalTraitCount }}</text>
      </view>
    </scroll-view>

    <!-- 传奇物品列表 -->
    <scroll-view class="content" scroll-y="true" v-if="currentTab === 1">
      <view class="item-grid">
        <view
          v-for="item in items"
          :key="item.id"
          :class="['item-card', item.unlocked ? 'unlocked' : 'locked']"
          @tap="onItemTap"
          :data-item="item">
          <view class="item-icon-wrapper">
            <text class="item-icon">{{ item.unlocked ? item.icon : '🔒' }}</text>
            <view v-if="item.unlocked && item.rarity" :class="['rarity-badge', 'rarity-' + item.rarity]">
              <text>{{ item.rarity }}</text>
            </view>
          </view>
          <text class="item-name">{{ item.unlocked ? item.name : '???' }}</text>
          <text class="item-effect">{{ item.unlocked ? item.effect : '未解锁' }}</text>
        </view>
      </view>

      <view class="stats">
        <text class="stats-text">已收集: {{ unlockedItemCount }} / {{ totalItemCount }}</text>
      </view>
    </scroll-view>

    <!-- 返回按钮 -->
    <view class="footer">
      <button class="btn-back" @tap="onBack">返回</button>
    </view>
  </view>

  <!-- 详情弹窗 -->
  <view :class="['modal', showDetailModal ? 'show' : '']" @tap="closeDetailModal">
    <view class="modal-content" @tap.stop="stopPropagation">
      <view class="modal-header">
        <text class="modal-title">{{ selectedItem.name }}</text>
        <text class="modal-close" @tap="closeDetailModal">×</text>
      </view>
      <view class="modal-body">
        <view v-if="selectedItem.icon" class="detail-icon">{{ selectedItem.icon }}</view>
        <view class="detail-info">
          <text class="detail-label">描述</text>
          <text class="detail-text">{{ selectedItem.description }}</text>
        </view>
        <view v-if="selectedItem.effect" class="detail-info">
          <text class="detail-label">效果</text>
          <text class="detail-effect">{{ selectedItem.effect }}</text>
        </view>
        <view v-if="selectedItem.rarity" class="detail-info">
          <text class="detail-label">稀有度</text>
          <text :class="['detail-rarity', 'rarity-' + selectedItem.rarity]">{{ selectedItem.rarity }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import collectItem from '../../utils/collect/collect-legend_items.js'
import collectTrait from '../../utils/collect/collect-trait.js'
import { getNavBarHeight } from '../../utils/navbar.js'
import NavBar from '../../components/common/NavBar.vue'

export default {
  components: { NavBar },
  data() {
    return {
      navBarHeight: 0,
      currentTab: 0,
      traits: [],
      items: [],
      unlockedTraitCount: 0,
      totalTraitCount: 0,
      unlockedItemCount: 0,
      totalItemCount: 0,
      showDetailModal: false,
      selectedItem: {}
    }
  },

  onLoad(options) {
    this.navBarHeight = getNavBarHeight().navBarHeight
    this.loadCollections()
  },

  onShow() {
    this.loadCollections()
  },

  methods: {
    _getOpenid() {
      try {
        return uni.getStorageSync('openid') || null
      } catch (e) {
        return null
      }
    },

    loadCollections() {
      const openid = this._getOpenid()

      const allTraitDefs = collectTrait.getAllTraitDefs()
      const traits = allTraitDefs.map(t => ({
        ...t,
        unlocked: openid ? collectTrait.isTraitUnlocked(openid, t.id) : t.defaultUnlocked
      }))

      const allItemDefs = collectItem.getAllItemDefs()
      const items = allItemDefs.map(i => ({
        ...i,
        unlocked: openid ? collectItem.isItemUnlocked(openid, i.id) : i.defaultUnlocked
      }))

      const unlockedTraits = traits.filter(t => t.unlocked)
      const unlockedItems = items.filter(i => i.unlocked)

      this.traits = traits
      this.items = items
      this.unlockedTraitCount = unlockedTraits.length
      this.totalTraitCount = traits.length
      this.unlockedItemCount = unlockedItems.length
      this.totalItemCount = items.length
    },

    switchTab(e) {
      const tab = parseInt(e.currentTarget.dataset.tab)
      this.currentTab = tab
    },

    onTraitTap(e) {
      const item = e.currentTarget.dataset.item
      if (item.unlocked) {
        this.selectedItem = item
        this.showDetailModal = true
      } else {
        uni.showToast({ title: '该特性尚未解锁', icon: 'none' })
      }
    },

    onItemTap(e) {
      const item = e.currentTarget.dataset.item
      if (item.unlocked) {
        this.selectedItem = item
        this.showDetailModal = true
      } else {
        uni.showToast({ title: '该物品尚未解锁', icon: 'none' })
      }
    },

    closeDetailModal() {
      this.showDetailModal = false
    },

    stopPropagation() {},

    onBack() {
      uni.navigateBack()
    },

    onShareAppMessage() {
      return {
        title: '无限旅团 - 我的传奇收藏',
        path: '/pages/index/index'
      }
    }
  }
}
</script>

<style scoped>
.container {
  min-height: 100vh;
  background: var(--bg-deep);
  display: flex;
  flex-direction: column;
}

.tabs {
  display: flex;
  padding: 0 32rpx;
  margin-bottom: 24rpx;
  gap: 14rpx;
  flex: none;
}

.tab {
  flex: 1;
  height: 72rpx;
  background: var(--surface);
  border: 1rpx solid var(--border);
  border-radius: 18rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.2s ease, background 0.2s ease;
}

.tab.active {
  background: var(--accent-soft);
  border-color: var(--accent);
}

.tab-text {
  font-family: var(--font-body);
  font-size: 23rpx;
  color: var(--fg-soft);
  font-weight: 600;
}

.tab.active .tab-text { color: var(--accent); font-weight: 700; }

.content {
  flex: 1;
  padding: 0 32rpx 30rpx;
  min-height: 0;
}

.collection-grid {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.collection-item {
  background: var(--surface);
  border: 1rpx solid var(--border);
  border-radius: 18rpx;
  padding: 26rpx;
  display: flex;
  justify-content: space-between;
  align-items: center;
  transition: border-color 0.2s ease, background 0.2s ease;
}

.collection-item.unlocked {
  background: color-mix(in oklch, var(--t-violet) 12%, var(--surface));
  border-color: color-mix(in oklch, var(--t-violet) 45%, transparent);
}

.collection-item.locked {
  opacity: 0.55;
}

.item-content {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.item-name {
  font-size: 25rpx;
  font-weight: 700;
  color: var(--fg);
  margin-bottom: 8rpx;
}

.item-desc {
  font-size: 21rpx;
  color: var(--t-violet);
  line-height: 1.5;
}

.lock-icon {
  width: 44rpx; height: 44rpx; flex-shrink: 0; margin-left: 20rpx;
  display: flex; align-items: center; justify-content: center;
  color: var(--faint);
}
.lock-icon svg { width: 30rpx; height: 30rpx; }

.item-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 18rpx;
}

.item-card {
  aspect-ratio: 1;
  background: var(--surface);
  border: 1rpx solid var(--border);
  border-radius: 22rpx;
  padding: 24rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  transition: border-color 0.2s ease, background 0.2s ease;
  position: relative;
}

.item-card.unlocked {
  background: color-mix(in oklch, var(--t-gold) 12%, var(--surface));
  border-color: var(--t-gold);
}

.item-card.locked {
  opacity: 0.55;
}

.item-icon-wrapper {
  position: relative;
  margin-bottom: 16rpx;
}

.item-icon {
  font-size: 76rpx;
}

.rarity-badge {
  position: absolute;
  top: -10rpx;
  right: -22rpx;
  padding: 4rpx 12rpx;
  border-radius: 12rpx;
  font-size: 17rpx;
  font-weight: 700;
}

.rarity-common { background: var(--surface-2); color: var(--faint); }
.rarity-rare { background: color-mix(in oklch, var(--info) 80%, transparent); color: #071018; }
.rarity-epic { background: color-mix(in oklch, var(--t-violet) 80%, transparent); color: #150a1c; }
.rarity-legendary { background: color-mix(in oklch, var(--t-gold) 85%, transparent); color: #221802; }

.item-effect {
  font-size: 20rpx;
  color: var(--accent);
  margin-top: 8rpx;
}

.stats {
  margin-top: 28rpx;
  padding: 22rpx;
  background: var(--surface);
  border: 1rpx solid var(--border);
  border-radius: 18rpx;
  text-align: center;
}

.stats-text {
  font-family: var(--font-mono);
  font-size: 23rpx;
  color: var(--accent);
  font-weight: 700;
}

.footer {
  padding: 20rpx 32rpx;
  padding-bottom: calc(20rpx + env(safe-area-inset-bottom));
  background: oklch(18% 0.013 70 / 0.92);
  border-top: 1rpx solid var(--border);
  flex: none;
}

.btn-back {
  width: 100%;
  height: 84rpx;
  line-height: 84rpx;
  background: var(--surface);
  border: 1rpx solid var(--border);
  color: var(--fg-soft);
  border-radius: 42rpx;
  font-size: 25rpx;
  font-weight: 700;
}

.modal {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: oklch(10% 0.01 70 / 0.7);
  display: none;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal.show { display: flex; }

.modal-content {
  width: 600rpx;
  background: var(--bg-deep);
  border: 1rpx solid var(--border);
  border-radius: 24rpx;
  overflow: hidden;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 28rpx 32rpx;
  background: var(--surface);
  border-bottom: 1rpx solid var(--border);
}

.modal-title {
  font-family: var(--font-serif);
  font-size: 27rpx;
  font-weight: 900;
  color: var(--fg);
}

.modal-close {
  font-size: 48rpx;
  color: var(--faint);
  line-height: 1;
}

.modal-body { padding: 32rpx; }

.detail-icon {
  font-size: 110rpx;
  text-align: center;
  margin-bottom: 24rpx;
}

.detail-info { margin-bottom: 24rpx; }

.detail-label {
  display: block;
  font-size: 21rpx;
  color: var(--faint);
  margin-bottom: 8rpx;
}

.detail-text {
  display: block;
  font-size: 24rpx;
  color: var(--fg-soft);
  line-height: 1.6;
}

.detail-effect {
  display: block;
  font-size: 24rpx;
  color: var(--accent);
  font-weight: 700;
}

.detail-rarity {
  display: inline-block;
  padding: 8rpx 20rpx;
  border-radius: 16rpx;
  font-size: 22rpx;
  font-weight: 700;
}
</style>