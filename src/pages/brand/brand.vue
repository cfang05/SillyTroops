<template>
  <view class="brand-container" @tap="handleTap">
    <!-- 首帧海报层（约 12KB webp）：视频就绪前顶住背景，避免出现大块纯黑空窗。
         放在视频下方，视频开始出画面后自然被盖住，不需要额外的淡出逻辑。

         ⚠️ 这里刻意用 <image> 而不是 CSS 的 background-image: url('/static/...')。
         原因：Vite 在构建期解析 CSS 里的 url() 时，把以 / 开头的地址当作「public 目录
         内的文件」去找，而 uni-app 的 publicDir 是 src/static（PUBLIC_DIR='static'），
         也就是说 Vite 认为 /images/x.webp 才对应 src/static/images/x.webp，
         但运行时实际served 路径是 /static/images/x.webp。两边对不上，Vite 就会报
         「didn't resolve at build time, it will remain unchanged」并**原样保留**该地址。
         危险之处在于：一旦文件名写错或文件被改名，构建期不会有任何报错，
         只会在运行时静默 404（本会话就真的发生过一次）。
         模板里的 <image src="/static/..."> 不经过 Vite 的 CSS 资源解析，既没有这个警告，
         也和本页 dragon-logo 的写法保持一致。 -->
    <image class="brand-bg-poster" src="/static/images/background_1_poster.webp" mode="aspectFill"></image>

    <!-- 背景视频：初始不设 src，等浏览器真正绘制完首帧、进入空闲时段后再挂载。
         这样 894KB 的视频不会和首屏的 JS/CSS 抢带宽，也不会拖慢首次绘制。
         注意不要给它设 poster 属性（海报已经由上面的图层承担），避免重复请求。 -->
    <video
      v-if="videoSrc"
      class="brand-bg-video"
      :class="{ 'is-ready': videoReady }"
      :src="videoSrc"
      :autoplay="true"
      :loop="true"
      :muted="true"
      :controls="false"
      :show-center-play-btn="false"
      :show-fullscreen-btn="false"
      :show-play-btn="false"
      :enable-progress-gesture="false"
      object-fit="cover"
      :page-gesture="false"
      @timeupdate="onVideoReady"
    ></video>

    <view class="brand-bg-overlay"></view>
    <canvas canvas-id="particleCanvas" id="particleCanvas" class="particle-canvas"></canvas>

    <view class="cover">
      <view class="cover-eyebrow">INFINITE TROUPE · 无限旅团</view>
      
      <view class="cover-crest shimmer-wrapper">
        <image src="/static/images/dragon-logo.webp" mode="aspectFill" class="crest-image"></image>
        <view class="shimmer shimmer-crest"></view>
      </view>
      
      <view class="cover-headline">
        <view class="shimmer-text-wrapper">
          <text class="headline-text">与传奇角色，开启<text class="highlight">无限</text>冒险</text>
          <view class="shimmer shimmer-text-only"></view>
        </view>
      </view>
      
      <text class="cover-body">AI 跑团搭档：导入酒馆角色卡，掷骰判定命运，收集传奇物品——在属于你的奇幻世界里，每一段对话都是一场冒险。</text>
      
      <text class="cover-tip">TAP QUEST TO BEGIN · <text class="tip-bold">点击任务卡</text>进入详情\n工具栏可切换主题与布局</text>
    </view>
    
    <view class="teaser">
      <view class="teaser-head">
        <text class="teaser-label">今日冒险 · 预览</text>
        <view class="teaser-more">
          <text>查看全部</text>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 5l7 7-7 7"/>
          </svg>
        </view>
      </view>
      
      <view class="teaser-viewport">
        <view class="teaser-track">
          <view v-for="(item, index) in displayItems" :key="'item-' + index" class="teaser-chip">
            <text>{{ item.title }}</text>
            <text class="chip-xp">{{ item.xp }}</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { getNavBarHeight } from '../../utils/navbar.js'
import userManager from '../../utils/account/userManager.js'

const BG_VIDEO_SRC = '/static/videos/background_1.mp4'

export default {
  data() {
    return {
      statusBarHeight: 0,
      carouselItems: [
        { title: '开始冒险', xp: '+120 XP' },
        { title: '角色卡库', xp: '+40 XP' },
        { title: '传奇收藏', xp: '+30 XP' },
        { title: '酒馆导入', xp: '+25 XP' }
      ],
      // 背景视频的 src 初始为空：为空时整个 <video> 不渲染，因此不会有任何请求。
      videoSrc: '',
      videoReady: false,
      videoIdleHandle: null,
      videoTimer: null,
      reduceMotion: false
    }
  },
  computed: {
    displayItems() {
      // 跑马灯需要 3 份拷贝：CSS 动画平移自身宽度的 1/3，正好等于一份的宽度，
      // 循环点因此是无缝的（详见 .teaser-track）。用 2 份会算不整，用 3 份最稳。
      return [...this.carouselItems, ...this.carouselItems, ...this.carouselItems]
    }
  },
  created() {
    // 下面这些是纯命令式的动画状态，模板从不读取，刻意**不放进 data**：
    // 一旦进了 data，每帧对 50 个粒子对象的坐标写入都会走一遍 Vue 响应式，
    // 即 60fps × 50 = 3000 次/秒无意义的依赖追踪，白白占用主线程。
    this.particleCtx = null
    this.particles = []
    this.animationFrame = null
    this.canvasWidth = 0
    this.canvasHeight = 0
  },
  onLoad() {
    this.statusBarHeight = getNavBarHeight()
    // #ifdef H5
    this.statusBarHeight = 0
    // #endif
  },
  onReady() {
    this.reduceMotion = this.detectReduceMotion()
    this.$nextTick(() => {
      this.initParticles()
      this.scheduleBackgroundVideo()
    })
  },
  onUnload() {
    this.stopParticles()
    this.cancelScheduledVideo()
  },
  methods: {
    handleTap() {
      // 已经登录的用户点落地页，应该直接进 App，而不是给他看登录表单。
      // ⚠️ 这个判断刻意放在**品牌页**而不是登录页：登录页必须完全不含登录态判断，
      // 否则一旦本地登录态清理不干净（storage 异常等），登录页会把自己弹走，
      // 用户就永远登不进来了 —— 那是比"多点一次"严重得多的故障。
      if (userManager.hasValidSession()) {
        uni.reLaunch({ url: '/pages/index/index' })
        return
      }
      // 有 token 但已过期：告诉他为什么又要登录（没有 token 则说明是首次访问，不用解释）
      const url = userManager.hasExpiredSession()
        ? '/pages/login/login?reason=expired'
        : '/pages/login/login'
      uni.navigateTo({ url })
    },

    /* ============================================================
       背景视频：推迟到首屏绘制之后
       ============================================================ */
    scheduleBackgroundVideo() {
      const start = () => { this.videoSrc = BG_VIDEO_SRC }

      // #ifdef H5
      // 双 rAF：确保浏览器已经把第一帧真正提交给屏幕（此时首屏内容已经可见），
      // 再用 requestIdleCallback 把视频下载排到空闲时段；timeout:2000 兜底，
      // 保证即便页面一直不空闲，最迟 2s 后也开始加载。
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
          if (typeof window.requestIdleCallback === 'function') {
            this.videoIdleHandle = window.requestIdleCallback(start, { timeout: 2000 })
          } else {
            this.videoTimer = setTimeout(start, 300)
          }
        }))
        return
      }
      // #endif

      // #ifndef H5
      start()
      // #endif
    },

    cancelScheduledVideo() {
      // #ifdef H5
      if (this.videoIdleHandle != null && typeof window !== 'undefined' && window.cancelIdleCallback) {
        window.cancelIdleCallback(this.videoIdleHandle)
      }
      // #endif
      if (this.videoTimer) {
        clearTimeout(this.videoTimer)
      }
      this.videoIdleHandle = null
      this.videoTimer = null
    },

    onVideoReady() {
      // 第一次 timeupdate 说明画面确实在推进、首帧已经渲染，此时淡入不会有黑闪。
      if (!this.videoReady) this.videoReady = true
    },

    /* ============================================================
       粒子效果
       ============================================================ */
    detectReduceMotion() {
      // #ifdef H5
      if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches
      }
      // #endif
      return false
    },

    initParticles() {
      const query = uni.createSelectorQuery().in(this)
      query.select('.particle-canvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res || !res[0]) {
            console.error('Canvas 节点获取失败')
            return
          }

          const { node: canvas, width, height } = res[0]

          if (!canvas) {
            console.error('Canvas node 为空')
            return
          }

          // ⚠️ 不要在这里做 canvas.width = width * dpr + ctx.scale(dpr, dpr)。
          // uni-app H5 的 <canvas> 组件默认开启 hidpi：它已经把 canvas.width/height
          // 设成 CSS 尺寸 × devicePixelRatio，并且在 CanvasRenderingContext2D 原型上
          // 把 arc/clearRect/fillRect/... 的入参统一乘上该倍率。
          // 原实现又手动乘了一次 dpr，等于倍率叠加两次：粒子实际按 4× 坐标绘制，
          // 一半以上直接落在画布之外，半径也偏大 —— 看起来「粒子又稀又飘、动得还特别快」。
          // 这里一律使用 CSS 像素坐标，DPR 交给组件处理。
          this.particleCtx = canvas.getContext('2d')
          this.canvasWidth = width
          this.canvasHeight = height

          if (this.canvasWidth > 0 && this.canvasHeight > 0) {
            this.createParticles()
            this.animateParticles()
          } else {
            console.error('Canvas 尺寸为 0:', { width: this.canvasWidth, height: this.canvasHeight })
          }
        })
    },

    createParticles() {
      const particleCount = 50
      const particles = []

      for (let i = 0; i < particleCount; i++) {
        particles.push({
          x: Math.random() * this.canvasWidth,
          y: this.canvasHeight + Math.random() * 300,
          size: Math.random() * 4 + 1.5,
          speed: Math.random() * 2 + 0.8,
          opacity: Math.random() * 0.7 + 0.3,
          wobble: (Math.random() - 0.5) * 0.8
        })
      }

      this.particles = particles
    },

    stepParticles() {
      const particles = this.particles
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]
        p.y -= p.speed
        p.x += Math.sin(p.y * 0.01) * p.wobble

        if (p.y < -20) {
          p.y = this.canvasHeight + 20
          p.x = Math.random() * this.canvasWidth
        }
      }
    },

    drawParticles() {
      const ctx = this.particleCtx
      if (!ctx) return

      ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight)

      // 金色 oklch(85% 0.15 85)。fillStyle 在循环外设一次，
      // 每个粒子只改 globalAlpha —— 避免每帧为 50 个粒子拼 50 条 rgba 字符串。
      ctx.fillStyle = 'rgb(234, 207, 140)'

      const particles = this.particles
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]
        ctx.globalAlpha = p.opacity
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.globalAlpha = 1
    },

    animateParticles() {
      if (!this.particleCtx || this.canvasWidth <= 0 || this.canvasHeight <= 0) {
        return
      }

      // 系统开了「减弱动态效果」时只画一帧静态粒子，不做循环位移（brand-spec §3.5）。
      if (this.reduceMotion) {
        this.drawParticles()
        return
      }

      this.stepParticles()
      this.drawParticles()
      this.animationFrame = this.requestFrame(() => this.animateParticles())
    },

    requestFrame(cb) {
      // #ifdef H5
      return window.requestAnimationFrame(cb)
      // #endif
      // #ifndef H5
      return requestAnimationFrame(cb)
      // #endif
    },

    stopParticles() {
      if (this.animationFrame == null) return
      // #ifdef H5
      window.cancelAnimationFrame(this.animationFrame)
      // #endif
      // #ifndef H5
      cancelAnimationFrame(this.animationFrame)
      // #endif
      this.animationFrame = null
    }
  }
}
</script>

<style scoped>
.brand-container {
  position: relative;
  width: 100vw;
  max-width: 100%;
  height: 100vh;
  background: var(--bg-deep);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  margin: 0 auto;
}

/* 首帧海报：与视频同一套 cover 裁切规则，保证视频接上时画面不跳。
   约 12KB 的 webp，几乎是瞬时可见，用来顶住视频加载期间的背景。
   mode="aspectFill" 对应 cover（等比铺满 + 居中裁切）。
   注意 width/height 必须显式给满：uni-image 默认是 320x240 的 inline-block。 */
.brand-bg-poster {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: block;
  pointer-events: none;
  z-index: 0;
}

.brand-bg-video {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
  z-index: 0;
  /* 首帧尚未出画前保持透明，露出下方海报；出画后淡入，避免出现黑闪。 */
  opacity: 0;
  transition: opacity 0.7s ease;
}

.brand-bg-video.is-ready {
  opacity: 1;
}

.brand-bg-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: oklch(13.5% 0.011 70 / 0.55);
  pointer-events: none;
  z-index: 0;
}

.particle-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 1;
}

.cover {
  position: relative;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  text-align: center;
  padding: 76rpx 52rpx 180rpx;
  z-index: 2;
  width: 100%;
  max-width: 750rpx;
  margin: 0 auto;
}

.cover::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: radial-gradient(760rpx 640rpx at 50% -80rpx, oklch(70% 0.13 80 / 0.17), transparent 70%);
  pointer-events: none;
}

.cover-eyebrow {
  font-family: var(--font-mono);
  font-size: 19rpx;
  color: var(--accent);
  letter-spacing: 0.26em;
  margin-bottom: 40rpx;
  position: relative;
}

.shimmer-wrapper {
  position: relative;
  overflow: hidden;
}

.cover-crest {
  width: 148rpx;
  height: 148rpx;
  margin-bottom: 48rpx;
  border-radius: 42rpx;
  background: linear-gradient(160deg, oklch(29% 0.05 80), oklch(20% 0.03 80));
  border: 2rpx solid oklch(80% 0.13 84 / 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 72rpx -12rpx oklch(75% 0.13 80 / 0.5), inset 0 0 40rpx oklch(75% 0.12 80 / 0.16);
}

.crest-image {
  width: 100%;
  height: 100%;
  border-radius: 42rpx;
}

.shimmer-text-wrapper {
  position: relative;
  display: inline-block;
}

.cover-headline {
  margin-bottom: 28rpx;
  position: relative;
}

.headline-text {
  font-family: var(--font-serif);
  font-size: 64rpx;
  font-weight: 900;
  line-height: 1.32;
  letter-spacing: 0.015em;
  color: var(--fg);
  position: relative;
  z-index: 1;
}

.highlight {
  color: var(--accent);
  text-shadow: 0 0 56rpx oklch(78% 0.13 82 / 0.45);
}

.shimmer {
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 2;
}

.shimmer-crest {
  background: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.3) 50%, transparent 100%);
  animation: shimmer-sweep 6s ease-in-out infinite;
}

.shimmer-text-only {
  background: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.4) 50%, transparent 100%);
  animation: shimmer-sweep 6s ease-in-out infinite;
  -webkit-background-clip: text;
  background-clip: text;
  mix-blend-mode: screen;
}

@keyframes shimmer-sweep {
  0% {
    left: -100%;
  }
  30% {
    left: 100%;
  }
  100% {
    left: 100%;
  }
}

.cover-body {
  font-family: var(--font-serif);
  font-size: 27rpx;
  line-height: 1.9;
  color: var(--muted);
  max-width: 570rpx;
  margin-bottom: 44rpx;
  position: relative;
}

.cover-tip {
  font-family: var(--font-mono);
  font-size: 18rpx;
  color: var(--faint);
  line-height: 1.8;
  letter-spacing: 0.08em;
  position: relative;
}

.tip-bold {
  color: var(--accent);
  font-weight: 500;
}

.teaser {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 44rpx;
  z-index: 6;
  /* 必须是 480px 而不是 750rpx：rpx 在 H5 下按“浏览器窗口宽度”换算，
     宽屏（>480px）时 750rpx 会算成整个窗口宽，让这个 fixed 元素左右各
     溢出 480px 画布之外（实测窗口 526px 时 .teaser 宽 526px、左右各超
     23px，压过画布金色描边），违反 brand-spec §4b。480px 与画布同宽。 */
  max-width: 480px;
  width: 100%;
  margin: 0 auto;
  padding: 0 28rpx;
  box-sizing: border-box;
}

.teaser-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 18rpx;
}

.teaser-label {
  font-family: var(--font-mono);
  font-size: 18rpx;
  color: var(--muted);
  letter-spacing: 0.16em;
}

.teaser-more {
  display: flex;
  align-items: center;
  gap: 6rpx;
  font-family: var(--font-mono);
  font-size: 18rpx;
  color: var(--accent);
  letter-spacing: 0.1em;
}

.teaser-more svg {
  width: 22rpx;
  height: 22rpx;
}

.teaser-viewport {
  overflow: hidden;
  border: 2rpx solid var(--border);
  border-radius: 32rpx;
  background: oklch(22% 0.016 70 / 0.72);
  backdrop-filter: blur(28rpx);
  -webkit-backdrop-filter: blur(28rpx);
}

/* 无缝跑马灯：displayItems 是 carouselItems 的 3 份拷贝，平移自身宽度的 1/3
   正好等于一份的宽度，所以循环点接得上。
   原实现是 setInterval(30ms) 去改响应式的 carouselOffset，等于每秒触发 33 次
   Vue 组件重渲染，和粒子的 rAF 抢主线程 —— 改成纯 CSS 动画后整段跑在合成器上，
   主线程零成本。 */
.teaser-track {
  display: flex;
  width: max-content;
  padding: 24rpx 0;
  will-change: transform;
  animation: teaser-marquee 18s linear infinite;
}

@keyframes teaser-marquee {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(-33.3333%);
  }
}

.teaser-chip {
  flex: none;
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding: 16rpx 26rpx;
  margin-right: 16rpx;
  border-radius: 20rpx;
  background: var(--surface-2);
  border: 2rpx solid var(--border);
  font-size: 22rpx;
  color: var(--fg-soft);
  white-space: nowrap;
}

.chip-xp {
  color: var(--accent);
  font-weight: 700;
  font-family: var(--font-mono);
  font-size: 20rpx;
  letter-spacing: 0.02em;
}

/* brand-spec §3.5：prefers-reduced-motion 下关闭位移类动画，只保留透明度过渡。 */
@media (prefers-reduced-motion: reduce) {
  .teaser-track {
    animation: none;
  }

  .shimmer-crest,
  .shimmer-text-only {
    animation: none;
    opacity: 0;
  }

  .brand-bg-video {
    transition: none;
  }
}
</style>
