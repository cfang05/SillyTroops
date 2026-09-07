<template>
  <view class="brand-container" @tap="handleTap">
    <canvas canvas-id="particleCanvas" id="particleCanvas" class="particle-canvas"></canvas>
    
    <view class="cover">
      <view class="cover-eyebrow">INFINITE TROUPE · 无限旅团</view>
      
      <view class="cover-crest shimmer-wrapper">
        <image src="/static/images/dragon-logo.png" mode="aspectFill" class="crest-image"></image>
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
        <view class="teaser-track" :style="trackStyle">
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

export default {
  data() {
    return {
      statusBarHeight: 0,
      carouselOffset: 0,
      carouselTimer: null,
      carouselItems: [
        { title: '开始冒险', xp: '+120 XP' },
        { title: '角色卡库', xp: '+40 XP' },
        { title: '传奇收藏', xp: '+30 XP' },
        { title: '酒馆导入', xp: '+25 XP' }
      ],
      particleCtx: null,
      particles: [],
      animationFrame: null,
      canvasWidth: 0,
      canvasHeight: 0
    }
  },
  computed: {
    displayItems() {
      return [...this.carouselItems, ...this.carouselItems, ...this.carouselItems]
    },
    trackStyle() {
      return `transform: translateX(${this.carouselOffset}px); transition: transform 0.05s linear;`
    }
  },
  onLoad() {
    this.statusBarHeight = getNavBarHeight()
    // #ifdef H5
    this.statusBarHeight = 0
    // #endif
  },
  onReady() {
    this.$nextTick(() => {
      this.startCarousel()
      this.initParticles()
    })
  },
  onUnload() {
    if (this.carouselTimer) {
      clearInterval(this.carouselTimer)
    }
    if (this.animationFrame) {
      // #ifdef H5
      window.cancelAnimationFrame(this.animationFrame)
      // #endif
      // #ifndef H5
      cancelAnimationFrame(this.animationFrame)
      // #endif
    }
  },
  methods: {
    handleTap() {
      uni.navigateTo({ url: '/pages/login/login' })
    },
    
    startCarousel() {
      this.carouselTimer = setInterval(() => {
        this.carouselOffset -= 1
        
        const itemWidth = 160
        const totalWidth = this.carouselItems.length * itemWidth
        
        if (Math.abs(this.carouselOffset) >= totalWidth) {
          this.carouselOffset = 0
        }
      }, 30)
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
          
          const ctx = canvas.getContext('2d')
          const dpr = uni.getSystemInfoSync().pixelRatio || 2
          
          canvas.width = width * dpr
          canvas.height = height * dpr
          ctx.scale(dpr, dpr)
          
          this.particleCtx = ctx
          this.canvasWidth = width
          this.canvasHeight = height
          
          console.log('Canvas 初始化成功:', { width, height, dpr })
          
          if (this.canvasWidth > 0 && this.canvasHeight > 0) {
            this.createParticles()
            this.animateParticles()
          } else {
            console.error('Canvas 尺寸为 0:', { width: this.canvasWidth, height: this.canvasHeight })
          }
        })
    },
    
    createParticles() {
      this.particles = []
      const particleCount = 50
      
      for (let i = 0; i < particleCount; i++) {
        this.particles.push({
          x: Math.random() * this.canvasWidth,
          y: this.canvasHeight + Math.random() * 300,
          size: Math.random() * 4 + 1.5,
          speed: Math.random() * 2 + 0.8,
          opacity: Math.random() * 0.7 + 0.3,
          wobble: (Math.random() - 0.5) * 0.8
        })
      }
      console.log('粒子创建完成:', this.particles.length)
    },
    
    animateParticles() {
      if (!this.particleCtx || this.canvasWidth <= 0 || this.canvasHeight <= 0) {
        console.warn('Canvas 未初始化或尺寸为 0，停止动画')
        return
      }
      
      const ctx = this.particleCtx
      ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight)
      
      this.particles.forEach(particle => {
        particle.y -= particle.speed
        particle.x += Math.sin(particle.y * 0.01) * particle.wobble
        
        if (particle.y < -20) {
          particle.y = this.canvasHeight + 20
          particle.x = Math.random() * this.canvasWidth
        }
        
        // 使用更亮的金色粒子 oklch(85% 0.15 85 / opacity)
        const r = 234
        const g = 207
        const b = 140
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${particle.opacity})`
        ctx.beginPath()
        ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2)
        ctx.fill()
      })
      
      // #ifdef H5
      this.animationFrame = window.requestAnimationFrame(() => this.animateParticles())
      // #endif
      
      // #ifndef H5
      this.animationFrame = requestAnimationFrame(() => this.animateParticles())
      // #endif
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
  max-width: 750rpx;
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

.teaser-track {
  display: flex;
  width: max-content;
  padding: 24rpx 0;
  will-change: transform;
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
</style>
