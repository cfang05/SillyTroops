<script>
import accountManager from './utils/account/account-manager.js'
import userManager from './utils/account/userManager.js'

export default {
  // uni-app 用 globalData 挂载到 getApp() 上
  globalData: {
    userInfo: null,
    openid: null
  },

  onLaunch() {
    console.log('🎮 无限旅团启动 v0.1')
    userManager.ensureAdminSeed()
    this.loadOpenid()
    this.checkUserLogin()
    this._startHeartbeatTimer()
    // #ifdef H5
    // H5 端 uni-app 的 onHide 依赖页面可见性事件，用户直接关标签页/刷新时可能不触发，
    // 使用时长会丢在"最后一次心跳之后、页面关闭之前"这段。补浏览器原生事件做兜底：
    // 页面隐藏或关闭时立刻把已累计的会话时长结算进 totalUsageTime 并上报服务器。
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => { try { userManager.heartbeat() } catch (e) { /* ignore */ } })
      window.addEventListener('beforeunload', () => { try { userManager.heartbeat() } catch (e) { /* ignore */ } })
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          try { userManager.heartbeat() } catch (e) { /* ignore */ }
        }
      })
    }
    // #endif
  },

  onShow() {
    this.checkLoginStatus()
    // 重新开始会话计时（从后台返回）
    const userId = userManager.getCurrentUserId()
    if (userId) {
      try {
        // 已有会话进行中（会话开始时间在有效期内）就不要重置，避免把已累计的
        // 前台使用时段归零；只有尚未开始计时（冷启动/刚登录后首次展示）才初始化
        const start = uni.getStorageSync('sillytroops_session_start')
        if (!start || (Date.now() - start) > 24 * 60 * 60 * 1000) {
          uni.setStorageSync('sillytroops_session_start', Date.now())
        }
      } catch (e) { /* ignore */ }
    }
  },

  onHide() {
    // 切到后台时把已经过去的使用时长计入统计（并上报服务器）
    userManager.heartbeat()
  },

  /**
   * 周期性心跳：只依赖 onHide（切后台）无法覆盖"用户长时间挂在前台不切走"的场景，
   * 使用时长会一直停在 0 直到真正切后台/登出才结算一次。这里额外用一个前台定时器
   * 每 60 秒调用一次 heartbeat()，让使用时长即使不切后台也能持续、及时地累加与上报。
   */
  _startHeartbeatTimer() {
    if (this._heartbeatTimer) return
    this._heartbeatTimer = setInterval(() => {
      try { userManager.heartbeat() } catch (e) { /* ignore */ }
    }, 60000)
  },

  // 检查本地账号系统的登录态；未登录则跳转登录页（首次启动/退出登录后）
  checkUserLogin() {
    try {
      const uid = userManager.getCurrentUserId()
      if (!uid) {
        uni.reLaunch({ url: '/pages/login/login' })
      }
    } catch (e) { console.error('检查用户登录态失败:', e) }
  },

  // 加载本地 openid
  loadOpenid() {
    try {
      const openid = uni.getStorageSync('openid')
      if (openid) this.globalData.openid = openid
    } catch (e) { console.error('加载 openid 失败:', e) }
  },

  // 检查登录状态
  checkLoginStatus() {
    return !!this.globalData.openid
  },

  // 登录（微信云开发环境下用 wx.cloud；H5/其他平台使用本地存储模拟）
  async login() {
    // #ifdef MP-WEIXIN
    return new Promise((resolve, reject) => {
      uni.cloud && uni.cloud.callFunction({
        name: 'login',
        success: res => {
          if (res.result && res.result.openid) {
            const openid = res.result.openid
            this.globalData.openid = openid
            try { uni.setStorageSync('openid', openid) } catch (e) {}
            this.initAccount(openid)
            resolve(openid)
          } else {
            reject(new Error('登录返回数据异常'))
          }
        },
        fail: err => reject(err)
      })
    })
    // #endif
    // #ifndef MP-WEIXIN
    // H5 环境用本地存储模拟登录
    const mockOpenid = 'mock_openid_' + Date.now()
    this.globalData.openid = mockOpenid
    try { uni.setStorageSync('openid', mockOpenid) } catch (e) {}
    return Promise.resolve(mockOpenid)
    // #endif
  },

  // 初始化账号数据
  async initAccount(openid) {
    try {
      await accountManager.initAccount(openid)
    } catch (e) { console.error('账号初始化失败:', e) }
  },

  // 退出登录
  logout() {
    this.globalData.openid = null
    try { uni.removeStorageSync('openid') } catch (e) {}
    uni.showToast({ title: '已退出登录', icon: 'success', duration: 2000 })
  }
}
</script>

<style>
/* ============================================================
   无限旅团 · 全局设计令牌（来自 brand-spec.md v2.0）
   H5 编译目标下 CSS 自定义属性可全局生效，各页面 <style scoped>
   直接使用 var(--xxx) 即可，不需要重复声明。
   ============================================================ */
@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700;800&family=JetBrains+Mono:wght@400;500;700&family=Noto+Sans+SC:wght@400;500;700;900&family=Noto+Serif+SC:wght@600;700;900&display=swap');

/* 全局盒模型重置：所有元素统一用 border-box（width/height 包含 padding+border）。
   项目内大量页面给 width:100% 的输入框/容器额外加了 padding，若采用浏览器默认的
   content-box，padding 会撑出声明宽度之外，是本项目页面元素溢出金色画布边框的
   根本原因之一（很多页面各自在局部类上补 box-sizing:border-box 治标，这里统一
   在根部收口，不需要每个页面重复声明）。 */
*, *::before, *::after {
  box-sizing: border-box;
}

/* 全局居中容器：确保页面在视口内左右对称居中 */
body, #app {
  margin: 0;
  padding: 0;
}

uni-app {
  display: block;
  max-width: 480px;
  width: 100%;
  margin-left: auto !important;
  margin-right: auto !important;
}

:root {
  --bg: oklch(17% 0.012 70);
  --bg-deep: oklch(13.5% 0.011 70);
  --surface: oklch(22% 0.014 70);
  --surface-2: oklch(26.5% 0.016 70);
  --raised: oklch(31% 0.018 70);
  --fg: oklch(95% 0.008 70);
  --fg-soft: oklch(88% 0.01 70);
  --muted: oklch(67% 0.012 70);
  --faint: oklch(56% 0.012 70);
  --border: oklch(31% 0.015 70);
  --border-strong: oklch(42% 0.02 70);
  --accent: oklch(81% 0.13 84);
  --accent-strong: oklch(71% 0.15 74);
  --accent-soft: oklch(81% 0.13 84 / 0.14);
  --danger: oklch(64% 0.19 26);
  --success: oklch(74% 0.14 152);
  --info: oklch(72% 0.11 235);
  --t-amber: oklch(78% 0.13 80);
  --t-violet: oklch(72% 0.12 295);
  --t-gold: oklch(82% 0.13 95);
  --t-teal: oklch(74% 0.10 195);
  --t-emerald: oklch(74% 0.13 158);
  --t-rose: oklch(72% 0.12 15);

  --font-display: 'Cinzel', 'Noto Serif SC', 'Songti SC', serif;
  --font-serif: 'Noto Serif SC', 'Songti SC', 'SimSun', serif;
  --font-body: 'Noto Sans SC', -apple-system, 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
}

/* 全局样式 */
page {
  background-color: var(--bg-deep);
  color: var(--fg);
  font-family: var(--font-body);
  -webkit-font-smoothing: antialiased;
}

/* ============================================================
   PC 宽屏适配：所有页面只面向 H5 手机浏览器场景设计（brand-spec §1），
   在桌面宽屏浏览器直接打开时必须保持手机视口比例，不能被横向拉伸变形；
   缩小视口时页面元素也不能超出这个「画布」右边缘，必须和左边缘保持
   同样的距离（对称）。方案：
   1. uni-app H5 原生支持 pages.json globalStyle.maxWidth（已设为 480），
      框架在视口 > 480px 时自动给 <uni-app> 根节点加 max-width:480px +
      margin:0 auto 做限宽居中（非 transform:scale 缩放，字号/元素实际
      像素不失真）；视口 <= 480px 时不加这条内联样式，<uni-app> 退回
      100% 宽度，正好贴合窄视口，天然保证左右对称——这部分覆盖了页面
      普通文档流内容的宽度约束。
   2. 但页面里另有一批 `position:fixed;left:0;right:0` 的元素（自定义
      导航栏、聊天输入栏、全屏弹层遮罩），它们默认相对浏览器视口定位，
      不受 uni-app 限宽居中影响，宽屏下会撑满整个浏览器窗口、和画布
      边缘不对齐。这里逐一列出这些选择器，用 max-width:480px+margin:0
      auto 把它们的可视宽度也收窄到画布宽度并居中，同时保留 fixed
      定位本身（不随内容滚动移动的行为不变）。
   3. 暗金描边用独立的 viewport 固定覆盖层实现，宽度同样限定为 480px
      并居中，任何视口宽度下都与画布左右边缘重合，亮金色。
   对应 brand-spec.md §4b。
   ============================================================ */
html, body {
  background: oklch(9% 0.006 70);
  overflow-x: hidden;
  scrollbar-width: none;      /* Firefox：隐藏滚动条，避免其占用右侧宽度 */
  -ms-overflow-style: none;   /* 旧版 Edge / IE */
}

/* 隐藏页面滚动条（Chromium：Chrome / Edge / Safari）。
   背景：画布 <uni-app> 按 body 内容宽水平居中（max-width:480px + margin:0 auto），
   而 #app::before 暗金描边按整个视口居中（position:fixed; left:50%; translateX(-50%)）。
   桌面端页面级滚动条会占用右侧约 15px 宽度，使 body 内容宽缩水，导致画布整体相对
   描边左移约 滚动条宽/2 —— 表现为「左侧头像贴边过近、右侧头像离描边过远」，左右
   不再镜像。隐藏滚动条后 body 内容宽 = 视口宽，画布与描边完全重合，消息左右头像
   严格对称。滚动功能本身不受影响（仍可用滚轮/触摸）。 */
::-webkit-scrollbar {
  width: 0;
  height: 0;
}

uni-app {
  background-color: var(--bg-deep);
  min-height: 100vh;
}

/* 暗金 1px 描边：viewport 固定定位覆盖层，宽度限定为画布宽度（480px）并
   水平居中，与限宽后的 <uni-app> 画布左右边缘始终重合——宽屏时贴着
   480px 画布边缘，视口本身 <=480px 时 max-width:100% 让描边退回贴合
   真实视口边缘，任何视口宽度下描边都不会与内容错位。用 fixed 而不是
   跟着 uni-app 走，是因为要保持页面内所有 position:fixed 元素
   （导航栏/输入栏/弹层遮罩）原有的"不随滚动移动"行为不被改变，
   下方改为逐个约束这些 fixed 元素的宽度，而不是改变它们的定位包含块。
   pointer-events:none 保证不拦截点击，z-index 拉满保证盖在页面自身
   所有元素（含全屏弹层遮罩）之上，亮金色。对应 brand-spec.md §4b。 */
#app::before {
  content: '';
  position: fixed;
  top: 0;
  left: 50%;
  width: 480px;
  max-width: 100%;
  height: 100%;
  transform: translateX(-50%);
  box-shadow: inset 1px 0 0 oklch(84% 0.15 88), inset -1px 0 0 oklch(84% 0.15 88);
  pointer-events: none;
  z-index: 99999;
}

/* 页面内所有 position:fixed;left:0;right:0 的元素（自定义导航栏、聊天
   输入栏、全屏弹层遮罩等）默认会撑满整个浏览器视口宽度；宽屏下必须
   跟画布保持同样的左右对称留白，而不是撑到浏览器边缘。用 max-width +
   margin:0 auto 在保留 fixed 定位（不随滚动移动）的前提下，把这些元素
   的可视宽度收窄到画布宽度并居中，天然与画布左右边缘对齐。 */
.nav-bar-fixed,
.custom-navbar,
.input-container,
.inventory-modal,
.status-modal,
.fate-panel,
.dice-animation,
.edit-mask,
.modal,
.teaser {
  max-width: 480px;
  margin: 0 auto;
}
</style>
