<template>
  <!-- 卡片详情弹窗（对齐 notes/wuxian-lvtuan-card-market.html 的 PHONE_02 / .det） -->
  <view class="overlay center" :class="{ show: card }">
    <view v-if="card" class="det" role="dialog" aria-modal="true">
      <!-- 顶部：卡片名称 + 关闭 -->
      <view class="det-head">
        <text class="det-title">{{ card.name || card.id }}</text>
        <button class="det-close" aria-label="关闭" @tap="$emit('close')">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9" /></svg>
        </button>
      </view>

      <scroll-view class="det-body" scroll-y>
        <!-- 主体：封面 + 作者 / 评分 / 下载量 / tags -->
        <view class="det-hero">
          <view class="cover-art det-cover">
            <image v-if="thumbUrl && !coverFailed" :src="thumbUrl" mode="aspectFill" @error="coverFailed = true"></image>
            <view v-else class="cover-fallback"></view>
          </view>
          <view class="det-meta">
            <text class="det-line">作者：<text class="det-strong">{{ card.creator || '未知' }}</text></text>
            <view class="det-line">
              <svg class="star-ic" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2.6l2.3 4.7 5.2.8-3.8 3.7.9 5.2L10 14.5l-4.6 2.5.9-5.2L2.5 8.1l5.2-.8L10 2.6z" /></svg>
              <text class="det-em">{{ ratingLabel }}</text>
              <text v-if="hasRating" class="det-sub-em">（{{ stats.ratingCount }} 人评分）</text>
            </view>
            <view class="det-line">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3v9m0 0L6.5 8.5M10 12l3.5-3.5M4.5 16h11" /></svg>
              <text class="det-em">{{ downloadLabel }}</text>
              <text class="det-sub-em"> 次下载</text>
            </view>
            <view class="det-chips">
              <text v-for="t in topTags" :key="t" class="chip">{{ t }}</text>
            </view>
          </view>
        </view>

        <!-- 按钮：导入卡片（主） + 下载原卡（次） -->
        <view class="det-actions">
          <button class="act-btn is-primary" @tap="onImport">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3.6" width="14" height="12.8" rx="2.2" /><path d="M10 7.2v5.2M7.8 10.2L10 12.4l2.2-2.2" /></svg>
            <text>导入卡片</text>
          </button>
          <button class="act-btn" :disabled="downloading" @tap="onDownload">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.4v7.2M7.1 7.7L10 10.6l2.9-2.9" /><path d="M4.2 12.4v2.2a1.6 1.6 0 0 0 1.6 1.6h8.4a1.6 1.6 0 0 0 1.6-1.6v-2.2" /></svg>
            <text>{{ downloading ? '下载中...' : '下载原卡' }}</text>
          </button>
        </view>

        <!-- 下载提醒 -->
        <view class="tip-note">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="10" cy="10" r="7" /><path d="M10 9.2v4.2M10 6.6h.01" /></svg>
          <text class="tip-text"><text class="tip-strong">下载提醒：</text>部分卡片来自于互联网，使用时请尊重原创作者。</text>
        </view>

        <!-- 角色简介 -->
        <view class="det-sec">
          <text class="sec-title">角色简介</text>
          <text class="det-panel">{{ card.description || '暂无简介' }}</text>
        </view>

        <view class="det-hr"></view>

        <!-- 我的评分 -->
        <view class="det-sec">
          <text class="sec-title">我的评分</text>
          <view class="rate-row">
            <button
              v-for="n in 5"
              :key="n"
              :class="['star', n <= myRating ? 'on' : '']"
              :aria-label="n + ' 星'"
              :disabled="rating"
              @tap="onRate(n)"
            >
              <svg viewBox="0 0 20 20" fill="currentColor"><path d="M10 2.6l2.3 4.7 5.2.8-3.8 3.7.9 5.2L10 14.5l-4.6 2.5.9-5.2L2.5 8.1l5.2-.8L10 2.6z" /></svg>
            </button>
            <text class="rate-value">{{ myRating ? myRating.toFixed(1) : '--' }}</text>
            <text class="rate-hint">{{ rateHint }}</text>
          </view>
        </view>

        <view class="det-hr"></view>

        <!-- 评论区 -->
        <view class="det-sec">
          <text class="sec-title">评论（{{ comments.length }}）</text>

          <!-- 评论身份：让用户明确知道会以哪个身份发布（含等级） -->
          <text v-if="isLoggedIn" class="identity-note">以「{{ myNickname }}」{{ myLevelBadge ? '（' + myLevelBadge + '）' : '' }}的身份发表评论</text>

          <view v-if="commentsLoading" class="cmt-state">评论加载中...</view>
          <view v-else-if="commentsError" class="cmt-state cmt-error" @tap="loadComments">
            评论加载失败，点击重试
          </view>
          <view v-else-if="!comments.length" class="cmt-state">还没有评论</view>

          <view v-else class="cmt-list">
            <view v-for="c in comments" :key="c.id" class="cmt-item">
              <view class="cmt-avatar">
                <text>{{ initialOf(c.authorName) }}</text>
              </view>
              <view class="cmt-main">
                <view class="cmt-top">
                  <text class="cmt-name">{{ c.authorName || '匿名' }}</text>
                  <!-- 评论者等级：读取时由服务端用**当前**等级覆盖快照，所以这里是实时的 -->
                  <text v-if="levelBadgeOf(c)" class="cmt-level">{{ levelBadgeOf(c) }}</text>
                  <text class="cmt-time">{{ relativeTime(c.createdAt) }}</text>
                  <button v-if="c.authorId === myUserId" class="cmt-del" @tap="onDelete(c)">删除</button>
                </view>
                <text class="cmt-content">{{ c.content }}</text>
              </view>
            </view>
          </view>

          <!-- 输入框 + 发送 -->
          <view class="comment-row">
            <input
              class="comment-input"
              type="text"
              :disabled="!isLoggedIn"
              :placeholder="isLoggedIn ? '写下你的评论...' : '请先登录后再评论'"
              :value="commentDraft"
              @input="onCommentInput"
              @tap="onInputTap"
            />
            <button class="comment-send" :disabled="sending" @tap="onSend">{{ sending ? '...' : '发送' }}</button>
          </view>
        </view>
      </scroll-view>
    </view>
  </view>
</template>

<script>
import statsApi, { r2Url, ratingText, downloadText, relativeTime, getMyRating, setMyRating, displayTags } from '../utils/cardpool_stats.js'
import { levelBadge } from '../utils/level-names.js'
import { lockPageScroll, unlockPageScroll } from '../utils/scroll-lock.js'
// 直接复用现有登录系统：Pinia 包装（store）优先，userManager（本地缓存）兜底。
// 不新建任何用户体系，昵称口径与全站一致：nickname → username。
import { useUserStore } from '../../../stores/userStore'
import userManager from '../../../utils/account/userManager.js'

export default {
  name: 'CardDetail',
  props: {
    card: { type: Object, default: null },
    /** 该卡片的服务端统计；null 表示 API 失败（显示 --） */
    stats: { type: Object, default: null }
  },
  emits: ['close', 'rated', 'downloaded', 'commented'],
  data() {
    return {
      myRating: 0,
      rating: false,          // 评分请求进行中
      downloading: false,
      coverFailed: false,
      comments: [],
      commentsLoading: false,
      commentsError: false,
      commentDraft: '',
      sending: false,
      // 登录态快照：打开弹窗时取一次，避免组件内反复读存储
      isLoggedIn: false,
      myUserId: '',
      myNickname: '',
      myLevel: null,
      // 滚动锁持有标记（非响应式用途，仅用于保证 lock/unlock 成对）
      _scrollLocked: false
    }
  },
  computed: {
    thumbUrl() {
      return this.card ? r2Url(this.card.thumb) : ''
    },
    fileUrl() {
      return this.card ? r2Url(this.card.file) : ''
    },
    topTags() {
      // 与卡池网格同一套口径：优先中文 tag（tagsZh），缺字段时回退英文 tags
      return displayTags(this.card).slice(0, 6)
    },
    /** 评分展示：没有统计对象 → '--'；有统计但无人评分 → '暂无评分' */
    ratingLabel() {
      if (!this.stats) return '--'
      return ratingText(this.stats)
    },
    hasRating() {
      return !!(this.stats && Number(this.stats.ratingCount) > 0)
    },
    downloadLabel() {
      return this.stats ? downloadText(this.stats) : '--'
    },
    rateHint() {
      if (!this.isLoggedIn) return '请先登录后再评分'
      if (this.rating) return '提交中...'
      if (this.myRating) return '点击星星可修改评分'
      return '点击星星打分'
    },
    /** 我自己身份的等级徽标（'Lv.15 旅团长'）；取不到等级时返回空串，模板据此不渲染 */
    myLevelBadge() {
      return levelBadge(this.myLevel)
    }
  },
  watch: {
    // 打开（card 从 null 变成对象）时初始化：回填我的评分 + 拉取评论 + 锁滚动
    card: {
      immediate: true,
      handler(next) {
        if (!next || !next.id) {
          // 关闭：释放滚动锁（与下面的 lockPageScroll 成对）
          if (this._scrollLocked) {
            this._scrollLocked = false
            unlockPageScroll()
          }
          return
        }
        this.coverFailed = false
        this.commentDraft = ''
        this.comments = []
        this.commentsError = false
        this.syncLoginState()
        this.myRating = getMyRating(next.id)
        this.loadComments()
        // 弹窗打开期间禁止主页面滚动（可重入计数，详见 scroll-lock.js）
        if (!this._scrollLocked) {
          this._scrollLocked = true
          lockPageScroll()
        }
      }
    }
  },
  beforeUnmount() {
    // 关页面/切走时兜底释放，避免锁残留
    if (this._scrollLocked) {
      this._scrollLocked = false
      unlockPageScroll()
    }
  },
  methods: {
    relativeTime,
    /** 某条评论的等级徽标（'Lv.15 旅团长'）；等级缺失返回空串 */
    levelBadgeOf(comment) {
      return levelBadge(comment && comment.authorLevel)
    },
    initialOf(name) {
      const s = String(name || '').trim()
      if (!s) return '?'
      // 用 codePointAt 取首个完整字符，避免 emoji / 代理对只取到半个字符
      const cp = s.codePointAt(0)
      return String.fromCodePoint(cp)
    },

    // ── 登录态 ───────────────────────────────────────────────
    syncLoginState() {
      const user = this.currentUser()
      this.isLoggedIn = !!user
      this.myUserId = user ? String(user.id || '') : ''
      // 昵称优先级与全站一致：昵称 → 用户名
      this.myNickname = user ? String(user.nickname || user.username || '') : ''
      // 等级：服务端返回时用它；老服务端不返回时读 store（store 内部会读本地缓存/推服务端）
      if (user && user.level !== undefined && user.level !== null) {
        this.myLevel = Number(user.level)
      } else {
        this.myLevel = this.storeLevel()
      }
    },
    /** 从 pinia store 取当前等级（排行榜/经验条与评论身份共用同一份口径） */
    storeLevel() {
      try {
        const store = useUserStore()
        const n = Number(store && store.level)
        return Number.isFinite(n) ? n : null
      } catch (e) {
        return null
      }
    },
    /** 从现有登录系统读当前用户（store 优先，userManager 兜底） */
    currentUser() {
      try {
        const store = useUserStore()
        if (store && store.currentUser) return store.currentUser
      } catch (e) { /* Pinia 未就绪时走 userManager */ }
      try {
        return userManager.getCurrentUser()
      } catch (e) {
        return null
      }
    },
    /** 未登录：复用 App 层现有的登录跳转（navigateTo 压栈，登录后 navigateBack 回本页） */
    gotoLogin() {
      try {
        const app = getApp()
        if (app && typeof app.handleSessionExpired === 'function') {
          app.handleSessionExpired('login-required', 'back')
          return
        }
      } catch (e) { /* 落到下面的兜底 */ }
      uni.navigateTo({ url: '/pages/login/login?reason=login-required&back=1' })
    },

    // ── 评分 ─────────────────────────────────────────────────
    onRate(n) {
      if (this.rating) return
      if (!this.isLoggedIn) {
        uni.showToast({ title: '请先登录后再评分', icon: 'none' })
        this.gotoLogin()
        return
      }
      if (!this.card) return

      const previous = this.myRating          // 0 表示本设备还没评过
      this.rating = true
      statsApi.rateCard(this.card.id, n, previous || null).then((res) => {
        this.myRating = n
        setMyRating(this.card.id, n)
        if (res && res.stats) this.$emit('rated', this.card.id, res.stats)
        uni.showToast({ title: previous ? '评分已更新' : '感谢评分', icon: 'none' })
      }).catch((e) => {
        // 降级：不崩溃，只提示；列表上的平均分保持服务端原值
        console.warn('[CardDetail] 评分失败:', e && e.message)
        uni.showToast({ title: this.describeApiError(e, '评分'), icon: 'none' })
      }).then(() => {
        this.rating = false
      })
    },

    /**
     * 把接口错误翻译成用户能理解的一句话。
     * 503 是"服务端没配好"（R2 凭证 / DATABASE_URL 缺失），跟"网络不好"完全是两回事，
     * 给一句明确的提示，用户才知道该找谁，而不是反复重试。
     */
    describeApiError(e, action) {
      const status = e && e.status
      if (status === 503) return '卡池数据服务未配置，请联系管理员'
      if (status === 401) return '登录状态已过期，请重新登录'
      if (e && e.networkError) return '网络异常，请检查网络后重试'
      return action + '失败，请稍后重试'
    },

    // ── 下载原卡 ─────────────────────────────────────────────
    onDownload() {
      if (!this.card || this.downloading) return
      const url = this.fileUrl
      if (!url) {
        uni.showToast({ title: '该卡片没有可下载的原卡', icon: 'none' })
        return
      }
      this.downloading = true

      // 先计数（失败也照常下载：统计不该挡住用户取文件）
      statsApi.recordDownload(this.card.id).then((res) => {
        if (res && res.stats) this.$emit('downloaded', this.card.id, res.stats)
      }).catch((e) => {
        console.warn('[CardDetail] 下载计数失败（不影响下载）:', e && e.message)
      })

      this.triggerDownload(url)

      // 下载成功的小奖励（与全站经验值系统一致；失败不影响下载）
      try {
        const store = useUserStore()
        if (store && typeof store.addXp === 'function') store.addXp(5)
      } catch (e) { /* 经验值只影响趣味性，失败忽略 */ }

      setTimeout(() => { this.downloading = false }, 1200)
    },
    /**
     * 触发浏览器下载。
     * ⚠️ R2 的公开域名与站点跨域，`download` 属性会被浏览器忽略（变为"打开新标签页"），
     * 要真正下载需要在 R2 侧对该域名设置 CORS 允许本站，并返回 Content-Disposition: attachment。
     * 这里先做能力最全的尝试，失败再退化为新窗口打开，保证用户始终能拿到文件。
     */
    triggerDownload(url) {
      // #ifdef H5
      try {
        const a = document.createElement('a')
        a.href = url
        a.rel = 'noopener'
        a.setAttribute('download', '')
        a.style.display = 'none'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        uni.showToast({ title: '已开始下载原卡', icon: 'none' })
        return
      } catch (e) {
        console.warn('[CardDetail] 触发下载失败，退回新窗口打开:', e && e.message)
        try {
          window.open(url, '_blank', 'noopener')
          uni.showToast({ title: '已在新窗口打开原卡', icon: 'none' })
          return
        } catch (e2) { /* 落到下面的通用兜底 */ }
      }
      // #endif
      // 小程序端没有 a 标签：保存到本地相册/文件由调用方后续接入
      uni.setClipboardData({
        data: url,
        success: () => { uni.showToast({ title: '下载链接已复制', icon: 'none' }) },
        fail: () => { uni.showToast({ title: '下载失败', icon: 'none' }) }
      })
    },

    // ── 导入卡片 ─────────────────────────────────────────────
    onImport() {
      // 卡池 → 本地卡库的导入链路尚未接通（需要把 R2 上的 PNG 拉下来解析 chara_card 数据）。
      // 这里如实提示，不假装成功。
      uni.showToast({ title: '功能开发中', icon: 'none', duration: 1500 })
    },

    // ── 评论 ─────────────────────────────────────────────────
    loadComments() {
      if (!this.card || !this.card.id) return
      this.commentsLoading = true
      this.commentsError = false
      statsApi.fetchComments(this.card.id).then((res) => {
        this.comments = (res && Array.isArray(res.comments)) ? res.comments : []
      }).catch((e) => {
        console.warn('[CardDetail] 评论加载失败:', e && e.message)
        this.commentsError = true
        this.comments = []
      }).then(() => {
        this.commentsLoading = false
      })
    },
    onCommentInput(e) {
      this.commentDraft = (e && e.detail && e.detail.value !== undefined) ? e.detail.value : ''
    },
    onInputTap() {
      if (!this.isLoggedIn) {
        uni.showToast({ title: '请先登录后再评论', icon: 'none' })
        this.gotoLogin()
      }
    },
    onSend() {
      if (this.sending) return
      if (!this.isLoggedIn) {
        uni.showToast({ title: '请先登录后再评论', icon: 'none' })
        this.gotoLogin()
        return
      }
      const content = String(this.commentDraft || '').trim()
      if (!content) {
        uni.showToast({ title: '评论内容不能为空', icon: 'none' })
        return
      }
      if (content.length > 500) {
        uni.showToast({ title: '评论最多 500 个字符', icon: 'none' })
        return
      }

      this.sending = true
      statsApi.postComment(this.card.id, {
        authorId: this.myUserId,
        authorName: this.myNickname,
        content: content,
        // 已经打过分的，顺手把评分一起带上（服务端的 rating 字段是可选语义）
        rating: this.myRating || null
      }).then((res) => {
        const c = res && res.comment ? res.comment : null
        if (c) this.comments = [c].concat(this.comments)   // 乐观更新：插入列表顶部
        this.commentDraft = ''
        this.$emit('commented', this.card.id)
        uni.showToast({ title: '评论已发布', icon: 'none' })
      }).catch((e) => {
        console.warn('[CardDetail] 评论发送失败:', e && e.message)
        uni.showToast({ title: this.describeApiError(e, '评论发送'), icon: 'none' })
      }).then(() => {
        this.sending = false
      })
    },
    onDelete(comment) {
      if (!comment || !comment.id) return
      uni.showModal({
        title: '删除评论',
        content: '确定要删除这条评论吗？',
        success: (res) => {
          if (!res.confirm) return
          statsApi.deleteComment(this.card.id, comment.id).then(() => {
            this.comments = this.comments.filter((c) => c.id !== comment.id)
            this.$emit('commented', this.card.id)
            uni.showToast({ title: '已删除', icon: 'none' })
          }).catch((e) => {
            console.warn('[CardDetail] 删除评论失败:', e && e.message)
            uni.showToast({ title: e && e.message ? e.message : '删除失败', icon: 'none' })
          })
        }
      })
    }
  }
}
</script>

<style scoped>
.overlay {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 1150;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24rpx;
  background: oklch(7% 0.012 70 / 0.74);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 180ms ease, visibility 180ms;
  box-sizing: border-box;
}
.overlay.show {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
}

.det {
  width: 100%;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 30rpx;
  border: 1rpx solid oklch(62% 0.10 78 / 0.55);
  background: linear-gradient(180deg, oklch(20.5% 0.013 70), oklch(16% 0.012 70));
  box-shadow: 0 68rpx 140rpx -56rpx oklch(4% 0.02 70 / 0.95);
  transform: translateY(10rpx) scale(0.99);
  transition: transform 200ms ease;
}
.overlay.show .det {
  transform: translateY(0) scale(1);
}

.det-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 22rpx 26rpx;
  border-bottom: 1rpx solid var(--border);
}
.det-title {
  flex: 1;
  min-width: 0;
  font-family: var(--font-serif);
  font-size: 29rpx;
  font-weight: 700;
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.det-close {
  flex: none;
  width: 56rpx;
  height: 56rpx;
  margin: 0;
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

.det-body {
  flex: 1;
  min-height: 0;
  padding: 22rpx;
  box-sizing: border-box;
}

/* 封面 + 元信息 */
.det-hero {
  display: flex;
  gap: 24rpx;
}
.cover-art {
  position: relative;
  overflow: hidden;
  background: var(--raised);
}
.det-cover {
  flex: none;
  width: 196rpx;
  aspect-ratio: 15 / 16;
  border-radius: 20rpx;
  border: 1rpx solid var(--border);
}
.det-cover image {
  display: block;
  width: 100%;
  height: 100%;
}
.cover-fallback {
  width: 100%;
  height: 100%;
  background: var(--raised);
}
.det-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 14rpx;
}
.det-line {
  display: flex;
  align-items: center;
  gap: 10rpx;
  font-size: 22rpx;
  color: var(--muted);
  line-height: 1.3;
}
.det-line > svg {
  width: 24rpx;
  height: 24rpx;
  flex: none;
}
.det-line .star-ic { color: var(--accent); }
.det-strong { color: var(--fg-soft); font-weight: 600; }
.det-em {
  font-family: var(--font-mono);
  font-size: 24rpx;
  color: var(--fg-soft);
}
.det-sub-em {
  font-family: var(--font-mono);
  font-size: 20rpx;
  color: var(--muted);
}
.det-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
  margin-top: 2rpx;
}
.chip {
  padding: 6rpx 14rpx;
  border-radius: 12rpx;
  border: 1rpx solid var(--border);
  background: var(--bg-deep);
  font-size: 19rpx;
  color: var(--fg-soft);
}

/* 操作按钮 */
.det-actions {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  margin-top: 24rpx;
}
.act-btn {
  height: 84rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14rpx;
  margin: 0;
  padding: 0;
  border-radius: 22rpx;
  border: 1rpx solid var(--border);
  background: var(--surface);
  color: var(--fg-soft);
  font-size: 24rpx;
  font-weight: 600;
  line-height: 1;
}
.act-btn svg { width: 28rpx; height: 28rpx; flex: none; }
.act-btn.is-primary {
  border-color: oklch(64% 0.10 80 / 0.62);
  background: linear-gradient(150deg, oklch(81% 0.13 84 / 0.16), oklch(81% 0.13 84 / 0.04));
  color: var(--accent);
}

/* 下载提醒 */
.tip-note {
  display: flex;
  align-items: flex-start;
  gap: 14rpx;
  margin-top: 20rpx;
  padding: 18rpx 20rpx;
  border: 1rpx solid var(--border);
  border-radius: 20rpx;
  background: oklch(19.5% 0.012 70);
}
.tip-note svg {
  width: 24rpx;
  height: 24rpx;
  flex: none;
  margin-top: 4rpx;
  color: var(--faint);
}
.tip-text {
  flex: 1;
  font-size: 21rpx;
  line-height: 1.65;
  color: var(--muted);
}
.tip-strong { color: var(--fg-soft); font-weight: 600; }

/* 分区 */
.det-sec { margin-top: 26rpx; }
.sec-title {
  display: block;
  font-size: 23rpx;
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--fg);
}
.det-panel {
  display: block;
  margin-top: 16rpx;
  padding: 20rpx 22rpx;
  border: 1rpx solid var(--border);
  border-radius: 20rpx;
  background: oklch(19.5% 0.012 70);
  font-size: 22rpx;
  line-height: 1.75;
  color: var(--muted);
}
.det-hr {
  height: 1rpx;
  margin: 26rpx 0 0;
  background: var(--border);
}

/* 我的评分 */
.rate-row {
  display: flex;
  align-items: center;
  gap: 8rpx;
  margin-top: 18rpx;
}
.star {
  width: 48rpx;
  height: 48rpx;
  margin: 0;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: none;
  color: oklch(34% 0.014 70);
  line-height: 1;
}
.star svg { width: 38rpx; height: 38rpx; }
.star.on { color: var(--accent); }
/* 提交中禁用点击，但保留配色（不加这条会被 uni 的默认禁用样式压成灰色） */
.star[disabled] { opacity: 0.6; }
.rate-value {
  margin-left: 8rpx;
  font-family: var(--font-mono);
  font-size: 23rpx;
  color: var(--accent);
}
.rate-hint {
  margin-left: auto;
  font-size: 20rpx;
  color: var(--muted);
}

/* 评论 */
.identity-note {
  display: block;
  margin-top: 14rpx;
  font-size: 20rpx;
  color: var(--accent);
}
.cmt-state {
  margin-top: 16rpx;
  font-size: 22rpx;
  color: var(--muted);
}
.cmt-error { color: var(--accent); }
.cmt-list {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
  margin-top: 18rpx;
}
.cmt-item {
  display: flex;
  gap: 16rpx;
}
.cmt-avatar {
  flex: none;
  width: 56rpx;
  height: 56rpx;
  border-radius: 16rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--raised);
  border: 1rpx solid var(--border-strong);
}
.cmt-avatar text {
  font-family: var(--font-serif);
  font-size: 24rpx;
  font-weight: 900;
  color: var(--fg-soft);
}
.cmt-main {
  flex: 1;
  min-width: 0;
}
.cmt-top {
  display: flex;
  align-items: baseline;
  gap: 12rpx;
}
.cmt-name {
  font-size: 22rpx;
  font-weight: 700;
  color: var(--fg);
}
/* 评论者等级徽标：金色描边小胶囊，与暗金风格一致 */
.cmt-level {
  flex: none;
  padding: 2rpx 10rpx;
  border-radius: 10rpx;
  border: 1rpx solid oklch(74% 0.11 84 / 0.42);
  background: oklch(81% 0.13 84 / 0.12);
  font-family: var(--font-mono);
  font-size: 17rpx;
  line-height: 1.5;
  color: var(--accent);
}
.cmt-time {
  font-size: 19rpx;
  color: var(--faint);
}
.cmt-del {
  margin-left: auto;
  margin-top: 0;
  margin-bottom: 0;
  margin-right: 0;
  padding: 4rpx 10rpx;
  height: auto;
  line-height: 1.2;
  border: 0;
  background: none;
  font-size: 19rpx;
  color: var(--faint);
}
.cmt-content {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  line-height: 1.65;
  color: var(--fg-soft);
  word-break: break-word;
}

/* 输入行 */
.comment-row {
  display: flex;
  gap: 16rpx;
  margin-top: 22rpx;
}
.comment-input {
  flex: 1;
  min-width: 0;
  height: 80rpx;
  padding: 0 22rpx;
  border: 1rpx solid var(--border);
  border-radius: 20rpx;
  background: var(--surface);
  font-size: 23rpx;
  color: var(--fg);
  box-sizing: border-box;
  -webkit-user-select: text !important;
  user-select: text !important;
}
.comment-send {
  flex: none;
  width: 128rpx;
  height: 80rpx;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 20rpx;
  background: linear-gradient(135deg, var(--accent), var(--accent-strong));
  color: #171104;
  font-size: 24rpx;
  font-weight: 700;
  line-height: 1;
}
</style>
