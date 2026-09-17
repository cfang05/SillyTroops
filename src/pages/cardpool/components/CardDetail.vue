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

        <!-- 我的评分：点击即选择（与评论一起提交，见下方「提交」）
             整行只绑一个原生 click，靠坐标算"第几颗星的左/右半"（见 onRateRowClick 的注释） -->
        <view class="det-sec">
          <text class="sec-title">我的评分</text>
          <view class="rate-row" @click="onRateRowClick" @touchstart="onRateRowClick" @mouseleave="onStarLeave" @mousemove="onRateRowHover">
            <view v-for="n in 5" :key="n" class="star" :aria-label="n + ' 星'">
              <!-- 底层：空心星（灰色描边），永远整颗显示 -->
              <svg class="star-base" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M10 2.6l2.3 4.7 5.2.8-3.8 3.7.9 5.2L10 14.5l-4.6 2.5.9-5.2L2.5 8.1l5.2-.8L10 2.6z" /></svg>
              <!-- 上层：金色实心星，按 0 / 50% / 100% 宽度裁切，做出半星 -->
              <view class="star-fill" :style="{ width: starFillWidth(n) }">
                <svg viewBox="0 0 20 20" fill="currentColor"><path d="M10 2.6l2.3 4.7 5.2.8-3.8 3.7.9 5.2L10 14.5l-4.6 2.5.9-5.2L2.5 8.1l5.2-.8L10 2.6z" /></svg>
              </view>
            </view>
            <text class="rate-value">{{ myRatingText }}</text>
            <text class="rate-hint">{{ rateHint }}</text>
          </view>
        </view>

        <view class="det-hr"></view>

        <!-- 评论区 -->
        <view class="det-sec">
          <text class="sec-title">评论（{{ comments.length }}）</text>

          <!-- 我的评论：置顶显示，明确标注「我的评论」 -->
          <view v-if="myComment" class="cmt-mine">
            <view class="cmt-mine-head">
              <text class="cmt-mine-badge">我的评论</text>
              <text v-if="myComment.rating" class="cmt-mine-rating">评分 {{ Number(myComment.rating).toFixed(1) }}</text>
              <text class="cmt-time">{{ relativeTime(myComment.createdAt) }}</text>
              <button class="cmt-del" @tap="onDelete(myComment)">删除</button>
            </view>
            <text class="cmt-content">{{ myComment.content || '（只打了分）' }}</text>
          </view>

          <view v-if="commentsLoading" class="cmt-state">评论加载中...</view>
          <view v-else-if="commentsError" class="cmt-state cmt-error" @tap="loadComments">
            评论加载失败，点击重试
          </view>
          <view v-else-if="!comments.length" class="cmt-state">还没有评论</view>

          <template v-else>
            <!-- 其他评论（含我自己更早的评论）：在我的评论下面 -->
            <view v-if="otherComments.length" class="cmt-list">
              <view v-for="c in otherComments" :key="c.id" class="cmt-item">
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
          </template>

          <!-- 评论身份：让用户明确知道会以哪个身份发布（含等级） -->
          <text v-if="isLoggedIn" class="identity-note">以「{{ myNickname }}」{{ myLevelBadge ? '（' + myLevelBadge + '）' : '' }}的身份发表评论与评分</text>

          <!-- 输入框 + 提交（评分与评论一起提交） -->
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
            <button class="comment-send" :disabled="sending" @tap="onSubmit">
              <text class="comment-send-text">{{ sending ? '...' : '提交' }}</text>
            </button>
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
import { useCharacterCardStore } from '../../../stores/characterCardStore'
import * as CharacterImporter from '../../../adapters/character/CharacterImporter'
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
      hoverRating: 0,        // PC 上滑过星星时的预览分值（0 = 无预览）
      rating: false,          // 评分请求进行中
      downloading: false,
      importing: false,
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
      if (this.sending) return '提交中...'
      if (this.myRating) return '点击星星可改分（左半 = 半星）'
      return '点击星星打分（左半 = 半星）'
    },
    /** 我自己身份的等级徽标（'Lv.15 旅团长'）；取不到等级时返回空串，模板据此不渲染 */
    myLevelBadge() {
      return levelBadge(this.myLevel)
    },
    /**
     * 我的评论（列表里**最新**的一条自己的评论）：单独置顶显示，并标记「我的评论」。
     * 同一个人写过多次时只置顶最新那条，更早的仍留在下方"其他评论"里，不会凭空消失。
     */
    myComment() {
      if (!this.myUserId) return null
      return this.comments.find((c) => c && String(c.authorId) === this.myUserId) || null
    },
    /** 其他人的评论（含我自己更早的评论），按时间倒序 */
    otherComments() {
      const mine = this.myComment
      return this.comments.filter((c) => !mine || c.id !== mine.id)
    },
    /** 我的评分展示：0.5 步进，未评分显示 -- */
    myRatingText() {
      return this.myRating ? Number(this.myRating).toFixed(1) : '--'
    },
    /** 当前用于渲染的分数：hover 预览优先（PC 上滑过星星时预览"点这里打几分"），否则是我的选择 */
    ratingForDisplay() {
      return this.hoverRating || this.myRating || 0
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

    // ── 评分选择（不立即提交，与评论一起提交） ────────────────
    /**
     * 点星星选分：每颗星分左右两半 —— **左半 = 半星（x.5）、右半 = 整星（x.0）**。
     *
     * 实现方式：整行绑一个原生 click，用点击横坐标反推"第几颗星 + 左/右半"。
     *
     * ⚠️ 为什么不用「每颗星各绑一个事件、再从事件里找那颗星」：
     * uni 在 H5 上派发给处理器的**不是原生事件**，而是一个归一化对象 ——
     * 实测其中 target / currentTarget 都是 undefined（连 `ev.target.tagName` 都会抛错），
     * 且 `$el` 在这类渲染下也不可靠。所以"从事件里反查元素"这条路走不通。
     * 改用行级委托后只需要 clientX + 行内五颗星的矩形，全部是可测量的事实。
     */
    onRateRowClick(e) {
      if (!this.isLoggedIn) {
        uni.showToast({ title: '请先登录后再评分', icon: 'none' })
        this.gotoLogin()
        return
      }
      if (!this.card) return

      const picked = this.pickRatingFromEvent(e)
      if (picked) this.myRating = picked
    },
    /**
     * 由指针横坐标算出分值：每颗星宽 w，落点在第 i 颗（0-based）时
     * 相对该星的比例 < 0.5 → i+0.5 分（半星），否则 i+1 分（整星）。
     * @returns {number|null} 0.5 步进的分值；取不到坐标/矩形时返回 null
     */
    pickRatingFromEvent(e) {
      try {
        const src = e || {}
        const touch = (src.touches && src.touches[0]) || (src.changedTouches && src.changedTouches[0]) || src
        const clientX = touch.clientX !== undefined ? touch.clientX
          : (touch.pageX !== undefined ? touch.pageX : null)
        if (clientX == null || typeof document === 'undefined') return null

        const stars = document.querySelectorAll('.rate-row .star')
        if (!stars || stars.length < 1) return null
        for (let i = 0; i < stars.length; i++) {
          const rect = stars[i].getBoundingClientRect()
          if (!rect || rect.width <= 0) continue
          if (clientX < rect.left || clientX > rect.right) continue
          const isLeftHalf = (clientX - rect.left) < rect.width / 2
          return isLeftHalf ? (i + 0.5) : (i + 1)
        }
        // 落在星星之外的左右留白：按"更靠近哪一端"取边界值，避免点了没反应
        const first = stars[0].getBoundingClientRect()
        const last = stars[stars.length - 1].getBoundingClientRect()
        if (clientX < first.left) return 0.5
        if (clientX > last.right) return stars.length
        return null
      } catch (err) {
        return null
      }
    },
    /** 每颗星在"当前显示分"下应该亮到哪一半：'empty' | 'half' | 'full' */
    starFill(starIndex) {
      // ⚠️ ratingForDisplay 是 computed，不是方法：这里不能写成 ratingForDisplay()
      const r = Number(this.ratingForDisplay) || 0
      if (r >= starIndex) return 'full'
      if (r >= starIndex - 0.5) return 'half'
      return 'empty'
    },
    /** 金色实心层的宽度：空 0% / 半星 50% / 整星 100% */
    starFillWidth(starIndex) {
      const f = this.starFill(starIndex)
      if (f === 'full') return '100%'
      if (f === 'half') return '50%'
      return '0%'
    },
    /**
     * 星星的 hover 预览（PC）：鼠标划过时临时显示"点这里会打几分"，
     * 离开后回到已选分值。移动端没有 hover，不影响。
     */
    onRateRowHover(e) {
      if (!this.isLoggedIn) return
      const picked = this.pickRatingFromEvent(e)
      if (picked) this.hoverRating = picked
    },
    onStarLeave() {
      this.hoverRating = 0
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
    /**
     * 下载原卡：把原 PNG 存到用户设备。
     * **同时计入该卡片的下载次数**（与"导入卡片"一样，两者都算一次下载）。
     */
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

      Promise.resolve(this.triggerDownload(url, this.card.file)).then(() => {
        // 下载成功的小奖励（与全站经验值系统一致；失败不影响下载）
        try {
          const store = useUserStore()
          if (store && typeof store.addXp === 'function') store.addXp(5)
        } catch (e) { /* 经验值只影响趣味性，失败忽略 */ }
        this.downloading = false
      })
    },
    /**
     * 触发"下载到设备"。
     *
     * ⚠️ 为什么不直接用 `<a href="跨域URL" download>`：
     * 实测（本地双端口 + 真 Chrome）—— 跨域链接上的 download 属性会被浏览器**直接忽略**，
     * 退化成"打开这个 URL"，于是**整个页面被导航走**（表现为整页空白、用户以为崩了）。
     * 只有服务端返回 Content-Disposition: attachment 时浏览器才会真的下载。
     *
     * 所以这里的策略（按可靠性排序，实测均通过）：
     *   1) 同源（含 blob:）：a[download] 一定生效，直接下载。
     *   2) 跨域：先 fetch 成 Blob（R2 已配 CORS，所以读得到字节），
     *      再用**同源 blob: URL** + a[download] 下载 —— 与域名、与服务器响应头都无关，
     *      前端自己就能保证成功。
     *   3) 上面都不行（CORS 没配好 / 网络异常）才退化成新窗口打开，并给出明确提示。
     *
     * @param {string} url 资源地址
     * @param {string} filename 期望的文件名（下载后显示的名字）
     */
    triggerDownload(url, filename) {
      // #ifdef H5
      const name = String(filename || '').split('/').pop() || 'card.png'
      const sameOrigin = (() => {
        try {
          return new URL(url, location.href).origin === location.origin
        } catch (e) {
          return false
        }
      })()

      const anchorDownload = (href, isBlob) => {
        const a = document.createElement('a')
        a.href = href
        a.rel = 'noopener'
        a.setAttribute('download', name)
        a.style.display = 'none'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        if (isBlob) {
          // 给浏览器留出读取时间再释放，避免刚点完就 revoke 导致下载中断
          setTimeout(() => { try { URL.revokeObjectURL(href) } catch (e) { /* ignore */ } }, 10000)
        }
      }

      if (sameOrigin) {
        try {
          anchorDownload(url, false)
          uni.showToast({ title: '已开始下载原卡', icon: 'none' })
          return Promise.resolve(true)
        } catch (e) {
          console.warn('[CardDetail] 同源下载失败，尝试 blob 方案:', e && e.message)
        }
      }

      // 跨域：fetch → blob → 同源 blob URL 下载
      uni.showLoading({ title: '正在取得原卡...' })
      return fetch(url, { mode: 'cors', credentials: 'omit' })
        .then((res) => {
          if (!res.ok) throw new Error('HTTP ' + res.status)
          return res.blob()
        })
        .then((blob) => {
          if (!blob || !blob.size) throw new Error('原卡内容为空')
          const blobUrl = URL.createObjectURL(blob)
          anchorDownload(blobUrl, true)
          uni.showToast({ title: '已开始下载原卡', icon: 'none' })
          return true
        })
        .catch((e) => {
          console.warn('[CardDetail] blob 下载失败，退化为打开新窗口:', e && e.message)
          try {
            window.open(url, '_blank', 'noopener')
            uni.showToast({ title: '已在新窗口打开原卡', icon: 'none' })
          } catch (e2) {
            uni.showToast({ title: '下载失败，请检查网络或 R2 的 CORS 配置', icon: 'none' })
          }
          return false
        })
        .then((ok) => {
          uni.hideLoading()
          return ok
        })
      // #endif
      // #ifndef H5
      // 小程序端没有 a 标签/blob 下载：复制链接交给系统能力
      uni.setClipboardData({
        data: url,
        success: () => { uni.showToast({ title: '下载链接已复制', icon: 'none' }) },
        fail: () => { uni.showToast({ title: '下载失败', icon: 'none' }) }
      })
      return Promise.resolve(false)
      // #endif
    },

    // ── 导入卡片（写入玩家本地的角色卡池） ───────────────────
    /**
     * 把这张卡导入玩家本地角色卡池：
     *   1) 从 R2 取原 PNG
     *   2) 用现有的 CharacterImporter.importFromPng 解析 PNG 里的 chara 元数据
     *      （与"酒馆导入 → 导入 PNG 角色卡"完全同一条链路，会顺带压头像、解析世界书）
     *   3) 落进 characterCardStore（IndexedDB，按账号隔离）
     *
     * **同时计入该卡片的下载次数**（与"下载原卡"一样，两者都算一次下载）。
     */
    onImport() {
      if (!this.card || this.importing) return
      if (!this.isLoggedIn) {
        uni.showToast({ title: '请先登录后再导入', icon: 'none' })
        this.gotoLogin()
        return
      }
      const url = this.fileUrl
      if (!url) {
        uni.showToast({ title: '该卡片没有可导入的原卡文件', icon: 'none' })
        return
      }

      this.importing = true
      // 导入也算一次下载（需求明确要求两处都计入下载次数）
      statsApi.recordDownload(this.card.id).then((res) => {
        if (res && res.stats) this.$emit('downloaded', this.card.id, res.stats)
      }).catch((e) => {
        console.warn('[CardDetail] 导入计数失败（不影响导入）:', e && e.message)
      })

      this.fetchCardFile(url).then((file) => {
        // 复用现有导入链路：解析 PNG 内嵌 chara 数据 + 生成头像缩略图 + 世界书条目
        return CharacterImporter.importFromPng(file).then((result) => {
          // ⚠️ store 上的动作叫 importCard（不是 createCard —— createCard 是它内部调用的
          //    characterCardManager 的方法）。用错名字会得到 "createCard is not a function"。
          const store = useCharacterCardStore()
          const id = store.importCard(result.character, result.lorebookEntries)
          return { id: id, result: result }
        })
      }).then((out) => {
        const name = (out.result && out.result.character && out.result.character.data && out.result.character.data.name) || this.card.name
        uni.showToast({ title: '已导入到角色卡库：' + name, icon: 'none', duration: 2200 })
        console.log('[CardDetail] 已导入角色卡', out.id, name)
      }).catch((e) => {
        console.warn('[CardDetail] 导入卡片失败:', e && e.message)
        uni.showToast({ title: (e && e.message) || '导入失败', icon: 'none', duration: 2500 })
      }).then(() => {
        this.importing = false
      })
    },

    /**
     * 从 R2 取原卡文件并包装成 File（CharacterImporter.importFromPng 需要 File）。
     *
     * 用 XHR 而不是 fetch：需要拿到 ArrayBuffer + 文件名，且 XHR 的 onerror/status 更好判错；
     * 小程序端没有 File/ArrayBuffer 文件读取能力，直接给出清晰提示（与导入页一致）。
     */
    fetchCardFile(url) {
      return new Promise((resolve, reject) => {
        // #ifdef H5
        try {
          const xhr = new XMLHttpRequest()
          xhr.open('GET', url, true)
          xhr.responseType = 'arraybuffer'
          xhr.onload = () => {
            if (xhr.status < 200 || xhr.status >= 300) {
              reject(new Error('取原卡失败（HTTP ' + xhr.status + '）'))
              return
            }
            const buf = xhr.response
            if (!buf || !buf.byteLength) {
              reject(new Error('取到的原卡文件是空的'))
              return
            }
            const fileName = String((this.card && this.card.file) || 'card.png').split('/').pop()
            try {
              resolve(new File([buf], fileName, { type: 'image/png' }))
            } catch (e) {
              // 老浏览器没有 File 构造器时，退化成 Blob（importFromPng 只用到 arrayBuffer()）
              resolve(new Blob([buf], { type: 'image/png' }))
            }
          }
          xhr.onerror = () => {
            // 跨域被拦（R2 未放行本站）或网络不通都走这里
            reject(new Error('取原卡失败：可能是跨域被拦截，请管理员为 R2 配置 CORS 允许本站'))
          }
          xhr.send()
          return
        } catch (e) {
          reject(e)
          return
        }
        // #endif
        // #ifndef H5
        reject(new Error('小程序端不支持导入 PNG 角色卡，请用「下载原卡」再前往酒馆导入'))
        // #endif
      })
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
    /**
     * 「提交」= 评分 + 评论**一起**提交（需求约定）。
     *
     * 一次 POST /api/card-comments/:cardId 同时带上 content 与 rating：
     * 服务端会用 applyRating 记账评分（与 /rate 同一套语义），并把最新 stats 一起回传，
     * 所以这里一次请求就能同时刷新星级人数与评论列表 —— 不会出现"评论成功但分没记上"。
     *
     * 至少要有一项：只打分不写评论、或只评论不打分都允许（需求里"评论需要可以输入"，
     * 但没说要强制两者都填；强制会让人打不了分）。
     */
    onSubmit() {
      if (this.sending || this.rating) return
      if (!this.isLoggedIn) {
        uni.showToast({ title: '请先登录后再操作', icon: 'none' })
        this.gotoLogin()
        return
      }
      if (!this.card) return

      const content = String(this.commentDraft || '').trim()
      const rating = Number(this.myRating) || 0
      if (!content && !rating) {
        uni.showToast({ title: '请先打分或写下评论', icon: 'none' })
        return
      }
      if (content.length > 500) {
        uni.showToast({ title: '评论最多 500 个字符', icon: 'none' })
        return
      }

      this.sending = true
      // previousRating 传本地记下的旧分：0 表示首次评分（服务端把它当"未评过"，增加人数）
      const previous = rating ? getMyRating(this.card.id) : 0

      statsApi.submitRatingAndComment(this.card.id, {
        authorId: this.myUserId,
        authorName: this.myNickname,
        content: content,
        rating: rating || null,
        previousRating: previous
      }).then((res) => {
        // 服务端回传的最新统计 + 评论：直接采用，保证"提交后立刻看到变化"
        if (res && res.stats) this.$emit('rated', this.card.id, res.stats)
        if (rating) setMyRating(this.card.id, rating)
        const c = res && res.comment ? res.comment : null
        if (c) this.comments = [c].concat(this.comments)
        this.commentDraft = ''
        this.$emit('commented', this.card.id)
        uni.showToast({ title: rating ? '已提交评分和评论' : '已提交评论', icon: 'none' })
      }).catch((e) => {
        console.warn('[CardDetail] 评分/评论提交失败:', e && e.message)
        uni.showToast({ title: this.describeApiError(e, '提交'), icon: 'none' })
      }).then(() => {
        this.sending = false
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
/* 遮罩铺满视口，但内容限制在页面同一条 maxWidth:480 的中轴列里 ——
   pages.json 的 globalStyle.maxWidth:480 只约束页面容器，管不到 position:fixed 的悬浮层；
   PC 上不限制的话弹窗会横跨整个窗口，远超金色边框（实测 1440 宽窗口下弹窗宽 1390px）。 */
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
  /* maxWidth 与内边距都要算进 480 之内：420 + 左右各 24 = 468 < 480 */
  width: 100%;
  max-width: 420px;
  max-height: calc(100vh - 48px);
  margin: 0 24px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 30rpx;
  border: 1rpx solid oklch(62% 0.10 78 / 0.55);
  background: linear-gradient(180deg, oklch(20.5% 0.013 70), oklch(16% 0.012 70));
  box-shadow: 0 68rpx 140rpx -56rpx oklch(4% 0.02 70 / 0.95);
  transform: translateY(10rpx) scale(0.99);
  transition: transform 200ms ease;
  box-sizing: border-box;
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
/* 星星：底层空心 + 上层金色实心按宽度裁切（0 / 50% / 100%），做出半星。
   星星本身用 view 而不是 button：需要拿到点击坐标来区分左右半颗，
   而且 button 的默认样式会把内部 svg 撑得不好控制。

   ⚠️ 星形必须**铺满** .star 这个盒子（width/height 100%）。
   之前写死 38rpx 且靠 flex 居左，图形实际只占盒子宽度的 79%，
   于是"点右半"落在图形的右半 → 被判成左半 → 第 5 颗星点右半却只给 4.5 分（实测踩过）。
   铺满之后，坐标比例与视觉比例才一致，半星判断才成立。 */
.star {
  position: relative;
  width: 48rpx;
  height: 48rpx;
  flex: none;
  color: oklch(34% 0.014 70);
}
.star svg {
  display: block;
  width: 100%;
  height: 100%;
}
.star-base {
  color: oklch(40% 0.014 70);
}
.star-fill {
  position: absolute;
  top: 0;
  left: 0;
  width: 0;
  height: 100%;
  overflow: hidden;
  color: var(--accent);
  /* 宽度由内联 style 控制；不加过渡，点半星时要即时变化 */
}
.star-fill svg {
  /* 关键：实心层里的 svg 也要铺满**外层盒子**（而不是被 50% 宽的父层压扁），
     这样左半才正好是半颗星 */
  width: 48rpx;
  height: 48rpx;
  flex: none;
}
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
  /* 居中要同时管住 button 自身与内部文字节点：
     uni 的 button 默认带 padding + line-height，"提交"两个字很容易偏上/偏左（实测偏了一些）。 */
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  white-space: nowrap;
}
.comment-send-text {
  display: block;
  line-height: 1;
  font-size: 24rpx;
  font-weight: 700;
  color: #171104;
}

/* 我的评论：置顶 + 金边强调 */
.cmt-mine {
  margin-top: 18rpx;
  padding: 18rpx 20rpx;
  border-radius: 20rpx;
  border: 1rpx solid oklch(74% 0.11 84 / 0.45);
  background: linear-gradient(150deg, oklch(81% 0.13 84 / 0.13), oklch(81% 0.13 84 / 0.03));
}
.cmt-mine-head {
  display: flex;
  align-items: center;
  gap: 12rpx;
}
.cmt-mine-badge {
  flex: none;
  padding: 3rpx 12rpx;
  border-radius: 10rpx;
  background: linear-gradient(135deg, var(--accent), var(--accent-strong));
  color: #171104;
  font-size: 18rpx;
  font-weight: 700;
}
.cmt-mine-rating {
  font-family: var(--font-mono);
  font-size: 19rpx;
  color: var(--accent);
}
.cmt-mine .cmt-content {
  margin-top: 10rpx;
}
</style>
