<template>
  <view class="stage">
    <!-- 顶部导航：与其它子页面（角色卡库等）完全一致，直接复用通用 NavBar 组件。
        它自带状态栏留白 + 毛玻璃 + 68rpx 返回键 + 居中标题/副标题，不再自己画一套。 -->
    <NavBar title="冒险卡池" subtitle="Card Pool" />

    <!-- 主内容：弹窗/抽屉打开时禁止它接收点击，让背后的卡片/按钮不会被误触。
         ⚠️ 这里**不能**用 inert：uni.showModal / showToast / showLoading 都是把 DOM 渲染在
         当前页面容器里的，也就是说它们会落进这个被禁用的子树 —— inert 会让它们
         **从命中测试里消失**（视觉上正常显示、但真实点击穿透到背后的元素上，按钮变成死键）。
         实测踩过两次：悬浮层被 inert 吞掉、以及「导入成功」的确认键点不动。
         pointer-events 只挡指针、不影响视觉，也不会波及这些框架弹窗。 -->
    <view class="market">
      <view class="mkt-stage" :class="{ 'is-masked': layerOpen }">
        <!-- 分类 Tab：角色卡 / 冒险卡 / 预设·正则（预设与正则合并为一个入口，未实现 Toast） -->
        <view class="mkt-tabs" role="group" aria-label="卡池分类">
          <button
            v-for="t in categories"
            :key="t.id"
            :class="['mkt-tab', activeCategory === t.id ? 'active' : '']"
            @tap="onCategoryTap(t)"
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <template v-if="t.id === 'character'">
                <rect x="3" y="3.5" width="14" height="13" rx="2" /><circle cx="10" cy="8.4" r="2.1" /><path d="M6.3 14.6c.55-1.7 2-2.7 3.7-2.7s3.15 1 3.7 2.7" />
              </template>
              <template v-else-if="t.id === 'adventure'">
                <path d="M3.6 4.8l4.3-1.5 4.2 1.5 4.3-1.5v10.9l-4.3 1.5-4.2-1.5-4.3 1.5V4.8z" /><path d="M7.9 3.3v10.9M12.1 4.8v10.9" />
              </template>
              <template v-else>
                <path d="M3.5 7h5.6M14.1 7h2.4M3.5 13h2.5M11.1 13h5.4" /><circle cx="11.2" cy="7" r="1.9" /><circle cx="8.2" cy="13" r="1.9" />
              </template>
            </svg>
            <text>{{ t.label }}</text>
          </button>
        </view>

        <!-- 搜索与筛选入口 -->
        <button class="mkt-filter" @tap="openFilter">
          <view class="funnel">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h14l-5.4 6.2V16l-3.2-1.8V11.2L3 5z" /></svg>
          </view>
          <view class="filter-text">
            <text class="ft">搜索与筛选</text>
            <text class="fs">{{ filterSummary }}</text>
          </view>
          <view class="chev"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 8l4.5 4.5L14.5 8" /></svg></view>
        </button>

        <scroll-view class="card-grid" scroll-y>
          <!-- 加载中：3 个灰色骨架卡片 -->
          <view v-if="loading" class="grid">
            <view v-for="n in 3" :key="'skeleton-' + n" class="card skeleton">
              <view class="cover-art card-cover sk-cover"></view>
              <view class="card-body">
                <view class="sk-line sk-title"></view>
                <view class="sk-line sk-src"></view>
                <view class="sk-line sk-stats"></view>
              </view>
            </view>
          </view>

          <!-- 加载失败：错误提示 + 重试 -->
          <view v-else-if="loadError" class="grid-state">
            <text class="state-text">{{ loadError }}</text>
            <button class="state-btn" @tap="loadManifest">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10a6 6 0 1 0 1.8-4.3" /><path d="M4 3.6v3h3" /></svg>
              <text>重试</text>
            </button>
          </view>

          <!-- 空池 -->
          <view v-else-if="!visibleCards.length" class="grid-state">
            <text class="state-text">暂无卡片，请等待管理员上传</text>
          </view>

          <!-- 卡片网格（2 列） -->
          <view v-else class="grid">
            <view
              v-for="card in visibleCards"
              :key="card.id"
              class="card"
              role="button"
              @tap="openDetail(card)"
            >
              <view class="cover-art card-cover">
                <image v-if="!failedCover[card.id]" :src="thumbUrl(card)" mode="aspectFill" lazy-load @error="onCoverError(card.id)"></image>
                <view v-else class="cover-fallback"></view>
                <view v-if="cardTags(card).length" class="tags">
                  <text v-for="t in cardTags(card)" :key="t" class="tag">{{ t }}</text>
                </view>
              </view>
              <view class="card-body">
                <text class="card-name">{{ card.name || card.id }}</text>
                <text class="card-src">{{ card.creator || '未知' }}</text>
                <view class="card-stats">
                  <view class="stat">
                    <svg class="star-ic" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2.6l2.3 4.7 5.2.8-3.8 3.7.9 5.2L10 14.5l-4.6 2.5.9-5.2L2.5 8.1l5.2-.8L10 2.6z" /></svg>
                    <text>{{ ratingText(card.id) }}</text>
                    <text v-if="hasRating(card.id)" class="stat-count">({{ cardStats(card.id).ratingCount }})</text>
                  </view>
                  <view class="stat">
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3v9m0 0L6.5 8.5M10 12l3.5-3.5M4.5 16h11" /></svg>
                    <text>{{ downloadText(card.id) }}</text>
                  </view>
                </view>
              </view>
            </view>
          </view>
        </scroll-view>
      </view>

      <!-- 详情弹窗（:stats 必须先判空：selectedCard 为 null 时取 .id 会抛错） -->
      <CardDetail
        :card="selectedCard"
        :stats="selectedCard ? (statsMap[selectedCard.id] || null) : null"
        @close="closeDetail"
        @rated="onRated"
        @downloaded="onDownloaded"
        @commented="onCommented"
      />

      <!-- 搜索与筛选抽屉（关闭必须走 closeFilter，否则滚动锁不会释放） -->
      <FilterDrawer
        :visible="filterVisible"
        :search="search"
        :category="activeCategory"
        :tag="activeTag"
        :sort="sortBy"
        :nsfw="showNsfw"
        @close="closeFilter"
        @reset="onFilterReset"
        @apply="onFilterApply"
        @search-input="onSearchInput"
      />
    </view>
  </view>
</template>

<script>
import CardDetail from './components/CardDetail.vue'
import FilterDrawer from './components/FilterDrawer.vue'
import NavBar from '../../components/common/NavBar.vue'
import statsApi, { r2Url, ratingText, downloadText, displayTags, configureCardPoolStats } from './utils/cardpool_stats.js'
import { resetPageScrollLock } from './utils/scroll-lock.js'
import userManager from '../../utils/account/userManager.js'
import { useUserStore } from '../../stores/userStore'

export default {
  components: { CardDetail, FilterDrawer, NavBar },
  data() {
    return {
      // 分类：仅「角色卡」已实现；预设与正则合并成一个入口
      categories: [
        { id: 'character', label: '角色卡' },
        { id: 'adventure', label: '冒险卡' },
        { id: 'preset', label: '预设 / 正则' }
      ],
      activeCategory: 'character',

      cards: [],
      statsMap: {},
      statsFailed: false,        // stats API 失败 → 一律显示 --
      loading: true,
      loadError: '',

      selectedCard: null,
      filterVisible: false,

      search: '',
      activeTag: 'all',
      sortBy: 'hot',
      showNsfw: true,

      failedCover: {}            // cardId → true 表示缩略图加载失败
    }
  },
  computed: {
    layerOpen() {
      return !!this.selectedCard || this.filterVisible
    },
    filterSummary() {
      const cat = this.activeCategory === 'character' ? '角色卡' : this.activeCategory
      const tag = this.activeTag === 'all' ? '全部标签' : '#' + this.activeTag
      const sortMap = { hot: '最热', rating: '评分', newest: '最新' }
      return cat + ' / ' + tag + ' · ' + (sortMap[this.sortBy] || '最热')
    },
    visibleCards() {
      const kw = String(this.search || '').trim().toLowerCase()
      let list = this.cards.slice()

      if (kw) {
        list = list.filter((c) => {
          // 中英 tag 都纳入搜索范围：卡片上显示的是中文 tag（tagsZh），
          // 但用户也可能按英文原名找（tags 里存的是原始值）
          const zh = Array.isArray(c.tagsZh) ? c.tagsZh.join(' ') : ''
          const en = Array.isArray(c.tags) ? c.tags.join(' ') : ''
          const hay = ((c.name || '') + ' ' + (c.creator || '') + ' ' + zh + ' ' + en).toLowerCase()
          return hay.indexOf(kw) !== -1
        })
      }
      if (this.activeTag !== 'all') {
        list = list.filter((c) => Array.isArray(c.tags) && c.tags.indexOf(this.activeTag) !== -1)
      }
      if (!this.showNsfw) {
        // manifest 没有单独的 nsfw 字段，按 tags 里的 nsfw 标记判断
        list = list.filter((c) => !(Array.isArray(c.tags) && c.tags.some((t) => String(t).toLowerCase() === 'nsfw')))
      }
      if (this.sortBy === 'newest') {
        list.sort((a, b) => (Date.parse(b.uploadedAt) || 0) - (Date.parse(a.uploadedAt) || 0))
      } else if (this.sortBy === 'rating') {
        list.sort((a, b) => this.avgOf(b.id) - this.avgOf(a.id))
      } else {
        list.sort((a, b) => this.downloadsOf(b.id) - this.downloadsOf(a.id))
      }
      return list
    }
  },
  onLoad() {
    // 未登录用户不允许进入卡池页：守卫会 reLaunch 到登录页，
    // 登录成功后凭 redirect 参数自动重建本页（实现在 App.vue 的 checkUserLogin）。
    if (!getApp().checkUserLogin()) return

    // 把"取登录 token"的能力注入统计工具层（评论接口需要 Bearer）
    configureCardPoolStats(() => userManager.getAuthToken())

    // 同步一次当前用户，保证评论身份是最新的昵称/等级
    try { useUserStore().syncCurrentUser() } catch (e) { /* 忽略 */ }

    this.loadManifest()
    this.loadStats()
  },
  onShow() {
    // 从登录页返回（评论/评分前跳的登录）时，重新同步登录态并刷新评论身份
    try { useUserStore().syncCurrentUser() } catch (e) { /* 忽略 */ }
  },
  onUnload() {
    // 离开页面时强制复位滚动锁（浮层持有计数可能不为 0，必须强清而不是 unlock）
    resetPageScrollLock()
  },
  methods: {
    // ── 数据加载 ─────────────────────────────────────────────
    /** 拉取 R2 上的 manifest.json（结构与文本段描述一致：{ version, updatedAt, cards: [...] }） */
    loadManifest() {
      this.loading = true
      this.loadError = ''
      uni.request({
        url: r2Url('manifest.json'),
        method: 'GET',
        dataType: 'json',
        success: (res) => {
          const data = res && res.data
          let list = []
          if (data && Array.isArray(data.cards)) list = data.cards
          else if (Array.isArray(data)) list = data      // 容错：万一上传脚本改成裸数组
          this.cards = list.filter((c) => c && c.id)
          this.loading = false
          // 给"本功能上线前从卡池导入过、但没打来源标记"的历史卡片补标记（幂等）。
          // 不补的话，用户打开这些卡的详情时「导入卡片」仍是可点的，会重复导入同一张卡。
          try {
            useCharacterCardStore().reconcilePoolImports(this.cards)
          } catch (e) {
            console.warn('[CardPool] 补历史卡池导入标记失败（忽略）:', e && e.message)
          }
        },
        fail: (err) => {
          console.warn('[CardPool] manifest 加载失败:', err && err.errMsg)
          this.loadError = '卡片加载失败，请检查网络后重试'
          this.loading = false
        }
      })
    },
    /** 全量统计（评分 + 下载量）。失败时保持 statsFailed → 显示 --，不影响卡片列表 */
    loadStats() {
      statsApi.fetchCardStats().then((data) => {
        this.statsMap = (data && typeof data === 'object') ? data : {}
        this.statsFailed = false
      }).catch((e) => {
        console.warn('[CardPool] 统计加载失败（显示 --）:', e && e.message)
        this.statsMap = {}
        this.statsFailed = true
      })
    },

    // ── 统计读取（统一口径，避免模板里散落判空） ───────────────
    cardStats(cardId) {
      if (this.statsFailed) return null
      return this.statsMap[cardId] || null
    },
    ratingText(cardId) {
      const s = this.cardStats(cardId)
      if (!s) return this.statsFailed ? '--' : '暂无评分'
      return ratingText(s)
    },
    hasRating(cardId) {
      const s = this.cardStats(cardId)
      return !!(s && Number(s.ratingCount) > 0)
    },
    downloadText(cardId) {
      const s = this.cardStats(cardId)
      if (!s) return '--'
      return downloadText(s)
    },
    avgOf(cardId) {
      const s = this.statsMap[cardId]
      if (!s || !Number(s.ratingCount)) return 0
      return (Number(s.ratingSum) || 0) / Number(s.ratingCount)
    },
    downloadsOf(cardId) {
      const s = this.statsMap[cardId]
      return s ? (Number(s.downloadCount) || 0) : 0
    },

    // ── 卡片展示 ─────────────────────────────────────────────
    thumbUrl(card) {
      return r2Url(card && card.thumb)
    },
    cardTags(card) {
      return displayTags(card).slice(0, 3)   // 封面顶部最多 3 个 tag
    },
    onCoverError(cardId) {
      // 缩略图失败 → 灰色占位方块
      this.failedCover = Object.assign({}, this.failedCover, { [cardId]: true })
    },

    // ── 交互 ─────────────────────────────────────────────────
    onCategoryTap(t) {
      if (t.id === 'character') {
        this.activeCategory = 'character'
        return
      }
      uni.showToast({ title: '功能开发中', icon: 'none', duration: 1500 })
    },
    // 滚动锁由各浮层组件自己加/解（CardDetail 按 card 是否打开、FilterDrawer 按 visible），
    // 页面只负责在离开时兜底释放，避免中途异常导致整页永久锁死。
    openFilter() {
      this.filterVisible = true
    },
    closeFilter() {
      this.filterVisible = false
    },
    onSearchInput(value) {
      this.search = String(value == null ? '' : value)
    },
    onFilterApply(payload) {
      if (payload) {
        this.sortBy = payload.sort || this.sortBy
        this.showNsfw = payload.nsfw !== false
      }
      this.closeFilter()
    },
    onFilterReset() {
      this.search = ''
      this.activeTag = 'all'
      this.sortBy = 'hot'
      this.showNsfw = true
    },
    openDetail(card) {
      this.selectedCard = card
    },
    closeDetail() {
      this.selectedCard = null
    },

    // ── 详情弹窗回调：服务端返回的统计直接覆盖本地，保证"立刻看到变化" ──
    onRated(cardId, stats) {
      if (!stats) return
      this.statsMap = Object.assign({}, this.statsMap, { [cardId]: stats })
      this.statsFailed = false
    },
    onDownloaded(cardId, stats) {
      if (!stats) return
      this.statsMap = Object.assign({}, this.statsMap, { [cardId]: stats })
      this.statsFailed = false
    },
    onCommented() {
      // 评论由弹窗内部维护自己的列表；这里保留钩子，便于后续更新评论数徽标
    }
  }
}
</script>

<style scoped>
.stage {
  position: relative;
  min-height: 100vh;
  background: var(--bg-deep);
  display: flex;
  flex-direction: column;
  /* 顶部导航栏是 position:fixed（NavBar 组件），所以内容要自己让出高度：
     状态栏（H5 为 0）+ 导航栏 108rpx，再留一点间距 */
  padding-top: calc(108rpx + 16rpx);
}

.market {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.mkt-stage {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* 悬浮层打开时：背后的内容不接收指针事件（避免误触到卡片/按钮）。
   用 pointer-events 而不是 inert —— 原因见模板里的注释。 */
.mkt-stage.is-masked {
  pointer-events: none;
}

/* 顶部导航改用公共 NavBar 组件后，这里不再保留 .mkt-head/.mkt-exit 的局部副本，
   避免与 NavBar 的返回键样式各自漂移（返回键统一由 components/common/NavBar.vue 提供）。 */

/* 分类 Tab */
.mkt-tabs {
  flex: none;
  display: flex;
  gap: 6rpx;
  margin: 0 28rpx;
  padding: 6rpx;
  border: 1rpx solid var(--border);
  border-radius: 22rpx;
  background: oklch(19% 0.012 70);
}
.mkt-tab {
  flex: 1;
  min-width: 0;
  height: 60rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10rpx;
  margin: 0;
  padding: 0;
  border: 1rpx solid transparent;
  border-radius: 16rpx;
  background: none;
  color: var(--muted);
  font-size: 21rpx;
  font-weight: 600;
  line-height: 1;
}
.mkt-tab text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mkt-tab svg { width: 24rpx; height: 24rpx; flex: none; }
.mkt-tab.active {
  color: var(--accent);
  border-color: oklch(66% 0.10 80 / 0.45);
  background: linear-gradient(150deg, oklch(81% 0.13 84 / 0.14), oklch(81% 0.13 84 / 0.035));
}

/* 搜索与筛选入口 */
.mkt-filter {
  flex: none;
  display: flex;
  align-items: center;
  gap: 18rpx;
  margin: 14rpx 28rpx 0;
  padding: 12rpx 20rpx;
  border: 1rpx solid var(--border);
  border-radius: 22rpx;
  background: var(--surface);
  text-align: left;
  line-height: 1;
}
.mkt-filter .funnel {
  width: 52rpx;
  height: 52rpx;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16rpx;
  background: var(--accent-soft);
  color: var(--accent);
}
.mkt-filter .funnel svg { width: 26rpx; height: 26rpx; }
.filter-text {
  flex: 1;
  min-width: 0;
}
.mkt-filter .ft {
  display: block;
  font-size: 23rpx;
  font-weight: 600;
  line-height: 1.25;
  color: var(--fg);
}
.mkt-filter .fs {
  display: block;
  margin-top: 4rpx;
  font-size: 19rpx;
  line-height: 1.2;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mkt-filter .chev { margin-left: auto; flex: none; color: var(--faint); display: flex; }
.mkt-filter .chev svg { display: block; width: 28rpx; height: 28rpx; }

/* 卡片网格：scroll-view 只负责滚动，网格交给内层 .grid（2 列） */
.card-grid {
  flex: 1;
  min-height: 0;
  padding: 16rpx 28rpx 24rpx;
  box-sizing: border-box;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16rpx;
  align-content: start;
}

.card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border: 1rpx solid var(--border);
  border-radius: 24rpx;
  overflow: hidden;
  background: var(--surface);
  box-sizing: border-box;
}

.cover-art {
  position: relative;
  overflow: hidden;
  background: var(--raised);
}
.cover-art image {
  display: block;
  width: 100%;
  height: 100%;
}
.card-cover {
  flex: none;
  aspect-ratio: 6 / 7;
}
.cover-fallback {
  width: 100%;
  height: 100%;
  background: var(--raised);
}

/* 封面顶部最多 3 个 tag */
.tags {
  position: absolute;
  z-index: 2;
  top: 14rpx;
  left: 14rpx;
  right: 14rpx;
  display: flex;
  flex-wrap: nowrap;
  gap: 4rpx;
}
.tag {
  flex: 0 1 auto;
  min-width: 0;
  padding: 6rpx 10rpx;
  border-radius: 12rpx;
  border: 1rpx solid oklch(100% 0 0 / 0.2);
  background: oklch(11% 0.02 70 / 0.7);
  font-size: 16rpx;
  font-weight: 500;
  line-height: 1.2;
  color: oklch(97% 0.015 82);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-body {
  display: flex;
  flex-direction: column;
  gap: 2rpx;
  padding: 12rpx 18rpx 14rpx;
}
.card-name {
  font-size: 25rpx;
  font-weight: 600;
  line-height: 1.25;
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-src {
  font-size: 19rpx;
  line-height: 1.2;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-stats {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  margin-top: 10rpx;
  padding-top: 10rpx;
  border-top: 1rpx solid var(--border);
}
.card-stats .stat {
  display: flex;
  align-items: center;
  gap: 6rpx;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 19rpx;
  line-height: 1.2;
  color: var(--fg-soft);
}
.card-stats .stat svg { width: 20rpx; height: 20rpx; flex: none; }
.card-stats .star-ic { color: var(--accent); }
.card-stats .stat-count { font-size: 17rpx; color: var(--muted); }

/* 骨架屏 */
.skeleton { pointer-events: none; }
.sk-cover { aspect-ratio: 6 / 7; background: var(--raised); }
.sk-line {
  display: block;
  height: 20rpx;
  border-radius: 10rpx;
  background: var(--raised);
  margin-top: 10rpx;
}
.sk-title { height: 24rpx; width: 70%; margin-top: 0; }
.sk-src { width: 45%; }
.sk-stats { width: 90%; }

/* 错误 / 空态 */
.grid-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24rpx;
  padding: 120rpx 40rpx;
  width: 100%;
  box-sizing: border-box;
}
.state-text {
  font-size: 23rpx;
  color: var(--muted);
  text-align: center;
  line-height: 1.6;
}
.state-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
  height: 76rpx;
  padding: 0 40rpx;
  margin: 0;
  border-radius: 38rpx;
  border: 1rpx solid var(--border);
  background: var(--surface);
  color: var(--fg-soft);
  font-size: 24rpx;
  font-weight: 600;
  line-height: 1;
}
.state-btn svg { width: 28rpx; height: 28rpx; }
</style>
