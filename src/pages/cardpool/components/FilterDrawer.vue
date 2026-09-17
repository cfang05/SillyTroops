<template>
  <!-- 搜索与筛选 · 底部抽屉（对齐 notes/wuxian-lvtuan-card-market.html 的 PHONE_03 / .sheet） -->
  <view class="overlay bottom" :class="{ show: visible }">
    <view class="sheet" role="dialog" aria-modal="true" aria-label="搜索与筛选">
      <view class="sheet-top">
        <view class="sheet-top-text">
          <text class="eyebrow">Card Pool · Filter</text>
          <text class="sheet-title">搜索与筛选</text>
        </view>
        <button class="det-close" aria-label="关闭" @tap="$emit('close')">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9" /></svg>
        </button>
      </view>

      <!-- 搜索：输入即生效（emit input），不需要点「应用」 -->
      <label class="f-row">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="9" cy="9" r="5.2" /><path d="M13 13l3.4 3.4" /></svg>
        <input
          class="f-input"
          type="text"
          confirm-type="search"
          placeholder="搜索角色卡..."
          :value="search"
          @input="onSearchInput"
        />
      </label>

      <!-- 三个选择行：选项数据尚未接入，点击 Toast 提示 -->
      <button class="f-row" @tap="onSelectTap('卡片分类')">
        <text class="f-key">卡片分类</text>
        <text class="f-val">{{ categoryLabel }}</text>
        <view class="chev"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 8l4.5 4.5L14.5 8" /></svg></view>
      </button>

      <button class="f-row" @tap="onSelectTap('卡片标签')">
        <text class="f-key">卡片标签</text>
        <text class="f-val">{{ tagLabel }}</text>
        <view class="chev"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 8l4.5 4.5L14.5 8" /></svg></view>
      </button>

      <button class="f-row" @tap="onSelectTap('排序方式')">
        <text class="f-key">排序方式</text>
        <text class="f-val">{{ sortLabel }}</text>
        <view class="chev"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 8l4.5 4.5L14.5 8" /></svg></view>
      </button>

      <!-- 本地真实生效的开关：按 tags 里的 nsfw 过滤。默认开启（保持当前清单不变） -->
      <!-- ⚠️ 两个实现细节（都实测踩过）：
           1) 用 uni 的 <checkbox> 而不是 <input type="checkbox"> —— 编译器会把 input 一律
              转成 uni-input（type 只支持 text/number/idcard/digit/tel），勾选语义会丢。
           2) 开关状态挂在**整行**的 @tap 上，而不是挂在 checkbox 上：在 H5 上
              checkbox 会被包进 uni-label，真实点击命中的是 label，挂在 checkbox 上的
              @tap 收不到（表现为"这一行点了没反应"）。挂整行同时也符合"点哪都能开关"的预期。 -->
      <label class="f-check" @tap="onNsfwToggle">
        <checkbox class="nsfw-box" :checked="nsfw" color="#e9c877" />
        <view class="shield"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M10 2.8l6 2.3v5c0 3.6-2.5 6.3-6 7.4-3.5-1.1-6-3.8-6-7.4v-5l6-2.3z" /></svg></view>
        <text class="f-check-txt">NSFW</text>
        <text class="f-check-hint">{{ nsfw ? '显示 NSFW 卡片' : '隐藏 NSFW 卡片' }}</text>
      </label>

      <view class="sheet-actions">
        <button class="btn-ghost" @tap="onReset">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10a6 6 0 1 0 1.8-4.3" /><path d="M4 3.6v3h3" /></svg>
          <text>重置</text>
        </button>
        <button class="btn-primary" @tap="onApply">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="9" cy="9" r="5.2" /><path d="M13 13l3.4 3.4" /></svg>
          <text>应用</text>
        </button>
      </view>
    </view>
  </view>
</template>

<script>
import { lockPageScroll, unlockPageScroll } from '../utils/scroll-lock.js'

export default {
  name: 'FilterDrawer',
  props: {
    visible: { type: Boolean, default: false },
    /** 当前生效的筛选条件（打开抽屉时同步一份到本地草稿） */
    search: { type: String, default: '' },
    category: { type: String, default: 'all' },
    tag: { type: String, default: 'all' },
    sort: { type: String, default: 'hot' },
    nsfw: { type: Boolean, default: true }
  },
  emits: ['close', 'apply', 'reset', 'search-input'],
  data() {
    return {
      // 本地草稿：排序等改动点「应用」才生效；搜索是输入即生效（见 onSearchInput）
      draftSort: this.sort,
      draftNsfw: this.nsfw,
      // 滚动锁持有标记（保证 lock/unlock 成对）
      _scrollLocked: false
    }
  },
  computed: {
    categoryLabel() {
      return this.category === 'all' ? '全部' : this.category
    },
    tagLabel() {
      return this.tag === 'all' ? '全部标签' : '#' + this.tag
    },
    sortLabel() {
      const map = { hot: '最热', rating: '评分最高', newest: '最新上传' }
      return map[this.draftSort] || '最热'
    },
    nsfw() {
      return this.draftNsfw
    }
  },
  watch: {
    // 抽屉打开/关闭时同步草稿与滚动锁
    visible(v) {
      if (v) {
        // 每次打开都从 props 重新取一份草稿，避免上次改了没应用的值残留
        this.draftSort = this.sort
        this.draftNsfw = this.nsfw
        if (!this._scrollLocked) {
          this._scrollLocked = true
          lockPageScroll()
        }
      } else if (this._scrollLocked) {
        this._scrollLocked = false
        unlockPageScroll()
      }
    },
    sort(v) { this.draftSort = v },
    nsfw(v) { this.draftNsfw = v }
  },
  beforeUnmount() {
    // 兜底：抽屉还开着时页面被销毁，别把滚动锁留下
    if (this._scrollLocked) {
      this._scrollLocked = false
      unlockPageScroll()
    }
  },
  methods: {
    onSearchInput(e) {
      const value = (e && e.detail && e.detail.value !== undefined) ? e.detail.value : ''
      this.$emit('search-input', value)
    },
    onSelectTap() {
      // 三个选择行的选项数据（分类/标签/排序候选值）尚未接入，点击先提示
      uni.showToast({ title: '功能开发中', icon: 'none', duration: 1500 })
    },
    onNsfwToggle() {
      this.draftNsfw = !this.draftNsfw
    },
    onReset() {
      this.draftSort = 'hot'
      this.draftNsfw = true
      this.$emit('reset')
    },
    onApply() {
      this.$emit('apply', { sort: this.draftSort, nsfw: this.draftNsfw })
    }
  }
}
</script>

<style scoped>
/* 遮罩铺满视口，但抽屉限制在页面同一条 maxWidth:480 的中轴列里 ——
   pages.json 的 globalStyle.maxWidth:480 管不到 position:fixed 的悬浮层，
   PC 上不限制的话抽屉会横跨整个窗口（实测 1440 宽窗口下抽屉宽 1414px）。 */
/* ⚠️ z-index 同样要**低于** uni 框架弹窗的 999（原因见 CardDetail 的注释）：
   抽屉在详情弹窗之上（950 > 900），但都在框架弹窗之下。 */
.overlay {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 950;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: oklch(7% 0.012 70 / 0.74);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 180ms ease, visibility 180ms;
}
.overlay.show {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
}

/* 从底部升起，圆角顶部 */
.sheet {
  width: 100%;
  max-width: 480px;
  display: flex;
  flex-direction: column;
  gap: 18rpx;
  padding: 30rpx 30rpx 36rpx;
  border-radius: 34rpx 34rpx 0 0;
  border-top: 1rpx solid oklch(64% 0.10 78 / 0.6);
  background: linear-gradient(180deg, oklch(21% 0.013 70), oklch(16% 0.012 70));
  box-shadow: 0 -60rpx 120rpx -56rpx oklch(4% 0.02 70 / 0.9);
  transform: translateY(14rpx);
  transition: transform 200ms ease;
  box-sizing: border-box;
}
.overlay.show .sheet {
  transform: translateY(0);
}

.sheet-top {
  display: flex;
  align-items: flex-start;
  gap: 20rpx;
  margin-bottom: 4rpx;
}
.sheet-top-text {
  flex: 1;
  min-width: 0;
}
.eyebrow {
  display: block;
  font-family: var(--font-mono);
  font-size: 18rpx;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--accent);
}
.sheet-title {
  display: block;
  margin-top: 10rpx;
  font-family: var(--font-serif);
  font-size: 36rpx;
  font-weight: 700;
  color: var(--fg);
}
.det-close {
  flex: none;
  width: 56rpx;
  height: 56rpx;
  margin: 6rpx 0 0;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16rpx;
  border: 1rpx solid var(--border);
  background: var(--surface);
  color: var(--muted);
}
.det-close svg { width: 26rpx; height: 26rpx; }

/* 选择行 / 搜索行 */
.f-row {
  display: flex;
  align-items: center;
  gap: 18rpx;
  height: 88rpx;
  padding: 0 22rpx;
  margin: 0;
  border: 1rpx solid var(--border);
  border-radius: 20rpx;
  background: var(--surface);
  box-sizing: border-box;
  text-align: left;
  line-height: 1;
}
.f-row > svg {
  width: 28rpx;
  height: 28rpx;
  flex: none;
  color: var(--faint);
}
.f-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: 0;
  background: none;
  outline: none;
  font-size: 24rpx;
  color: var(--fg);
  -webkit-user-select: text !important;
  user-select: text !important;
}
.f-key {
  flex: none;
  width: 116rpx;
  font-size: 22rpx;
  color: var(--muted);
}
.f-val {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 24rpx;
  color: var(--accent);
  font-weight: 600;
}
.chev {
  flex: none;
  color: var(--faint);
  display: flex;
}
.chev svg { width: 30rpx; height: 30rpx; }

/* NSFW 开关 */
.f-check {
  display: flex;
  align-items: center;
  gap: 18rpx;
  height: 88rpx;
  padding: 0 22rpx;
  border: 1rpx solid var(--border);
  border-radius: 20rpx;
  background: var(--surface);
  cursor: pointer;
}
/* 原生 checkbox 只留勾选框本体（uni 默认会带一段文字占位） */
.f-check .nsfw-box {
  flex: none;
  transform: scale(0.92);
}
.f-check .shield { flex: none; color: var(--muted); display: flex; }
.f-check .shield svg { width: 30rpx; height: 30rpx; }
.f-check-txt { font-size: 24rpx; color: var(--fg-soft); }
.f-check-hint { margin-left: auto; font-size: 20rpx; color: var(--faint); }

/* 底部按钮：重置 45% + 应用 fill */
.sheet-actions {
  display: flex;
  gap: 18rpx;
  margin-top: 8rpx;
}
.btn-ghost,
.btn-primary {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
  height: 88rpx;
  border: 0;
  border-radius: 44rpx;
  margin: 0;
  padding: 0;
  line-height: 1;
  font-size: 27rpx;
}
.btn-ghost {
  flex: 0 0 45%;
  background: var(--surface);
  border: 1rpx solid var(--border);
  color: var(--fg-soft);
  font-weight: 600;
}
.btn-ghost svg,
.btn-primary svg { width: 30rpx; height: 30rpx; }
.btn-primary {
  flex: 1;
  background: linear-gradient(135deg, var(--accent), var(--accent-strong));
  color: #171104;
  font-weight: 700;
  box-shadow: 0 24rpx 52rpx -20rpx oklch(75% 0.14 80 / 0.6), inset 0 2rpx 0 oklch(100% 0 0 / 0.4);
}
</style>
