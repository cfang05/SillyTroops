<script>
import accountManager from './utils/account/account-manager.js'
import userManager from './utils/account/userManager.js'
import conversationManager from './utils/account/conversationManager.js'
import { migrateForeignUserKeys } from './utils/storage/cachedStore'

export default {
  // uni-app 用 globalData 挂载到 getApp() 上
  globalData: {
    userInfo: null,
    openid: null
  },

  onLaunch() {
    console.log('🎮 无限旅团启动 v0.1')
    // ⚠️ 下面调用的 loadOpenid / checkLoginStatus 等**必须声明在 methods 里**，
    // 不能写成根级自定义选项。Vue 3 只会把 data / props / computed / methods /
    // setup 代理到 this 上，根级自定义选项取不到。这几个函数以前都写在根级，
    // 导致这里第一行 this.loadOpenid() 就抛
    //   TypeError: this.loadOpenid is not a function
    // 而 onLaunch 是直线代码，异常把后面的 checkUserLogin()、
    // startActivityTracking()、以及 H5 的三个兜底 heartbeat 监听器全部静默截断
    // —— 活跃时长统计因此一直是坏的（已实测确认）。
    userManager.ensureAdminSeed()
    this.loadOpenid()
    // ── 全账号旧档一次性迁移（D20）──
    // 本地存储是**全 origin 共享**的，键名里刻着账号（u_{uid}_…），而 cachedStore/对话的
    // 常规 hydrate 只扫"当前登录账号"的键 → 同一台设备上其他账号的角色卡/世界书/预设/对话
    // 会一直躺在 5MB 的本地存储里（既没迁走、也没被导出排除），是这台设备上最脆弱的一份数据。
    // 这里在启动时（不论谁登录、哪怕是游客态）把它们一并搬进 IndexedDB：写入成功才删本地副本。
    // 刻意**不 await、也不调 conversationManager.init()** —— 后者会绑定"当前账号"的列表缓存，
    // 而此刻可能还没登录；迁移本身幂等，失败下次启动会重试，不影响首屏。
    //
    // 注意：角色卡/预设那几个 store 是**页面加载时才注册**的（createCachedStore 在模块求值时
    // 执行），所以启动这一刻 _registry 往往是空的、这次调用可能空转 —— 真正兜住的是
    // cachedStore 里"每次 hydrate 结束后再扫一次"的钩子（见 _doHydrate 的 ③）。这里保留调用，
    // 是为了覆盖"启动前已经注册过"的场景（例如小程序端/热重载）。
    try {
      migrateForeignUserKeys().catch(e => console.warn('[App] 跨账号迁移（角色卡/预设/Persona）失败:', e))
      Promise.resolve(conversationManager.migrateForeignLegacy())
        .catch(e => console.warn('[App] 跨账号迁移（对话存档）失败:', e))
    } catch (e) {
      console.warn('[App] 跨账号迁移启动失败:', e)
    }
    // ⚠️ 这里刻意**不调用** this.checkUserLogin()。
    // 入口页 pages/brand/brand 是面向未登录访客的品牌落地页（点击才去登录），
    // 在 onLaunch 里无条件跳转会让落地页根本看不到（brand-spec §7）。
    // 需要登录的页面请在自己的生命周期里调用 getApp().checkUserLogin()。
    // （uni-app 的 H5 构建会自动为 getApp 注入 import，见
    //   @dcloudio/uni-h5-vite/dist/plugins/inject.js 的 getApp 映射；
    //   它不是 window 上的全局函数，所以在浏览器控制台里直接敲 getApp 是 undefined。）
    //
    // 注册会话失效的统一出口：页面守卫、按天核验、以及任意业务接口的 401
    // 最后都汇聚到 handleSessionExpired()，行为完全一致。
    this._sessionExpiredHandling = false
    userManager.onSessionExpired(() => { this.handleSessionExpired('expired', 'back') })
    // 按天核验（内部 3 天节流）。**不 await**：不阻塞首屏，结果回来再决定要不要打扰用户。
    this.verifySessionInBackground()
    // 活跃时长统计：只在用户真正有交互（点击/按键/触摸/滚动）时计时，
    // 挂机超过 5 分钟不计；由 userManager 内部每 30 秒结算并上报一次。
    userManager.startActivityTracking()
    // #ifdef H5
    // H5 端 uni-app 的 onHide 依赖页面可见性事件，用户直接关标签页/刷新时可能不触发，
    // 活跃时长会丢在"最后一次结算之后、页面关闭之前"这段。补浏览器原生事件做兜底：
    // 页面隐藏或关闭时立刻结算并上报。
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => { try { userManager.heartbeat() } catch (e) { /* ignore */ } })
      window.addEventListener('beforeunload', () => { try { userManager.heartbeat() } catch (e) { /* ignore */ } })
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          try { userManager.heartbeat() } catch (e) { /* ignore */ }
        } else {
          try { userManager.markActivity() } catch (e) { /* ignore */ }
        }
      })
    }
    // #endif
  },

  onShow() {
    this.checkLoginStatus()
    // 回到前台先做**本地**检查（0 请求）：覆盖"标签页挂了很久、期间没有任何页面跳转"
    // 的情况 —— 这种场景页面守卫不会触发，只能靠这里。
    // 只在「本地有 token 但已过期」时才主动跳登录页；压根没有 token 的未登录访客
    // 不做打断（他可能只是在看品牌落地页，等点进需要登录的页面时守卫自然会处理）。
    if (userManager.hasExpiredSession()) {
      this.handleSessionExpired('expired', 'back')
    } else {
      // 再做按天权威核验（内部 3 天节流，与 onLaunch 那次并发去重）
      this.verifySessionInBackground()
    }
    // 回到前台视为重新活跃（后台期间不计入活跃时长）
    try { userManager.markActivity() } catch (e) { /* ignore */ }
  },

  onHide() {
    // 切到后台时把已经累计的活跃时长结算并上报
    userManager.heartbeat()
  },

  // ⚠️ 下面这些是「实例方法」，必须放在 methods 里。
  // 写在根级（和 onLaunch 平级）的话，Vue 3 不会把它们代理到 this 上，
  // this.xxx() 会直接抛 "is not a function" —— 这正是之前活跃时长统计
  // 完全不工作的原因。onLaunch / onShow / onHide 是 uni-app 的 App 级
  // 生命周期钩子，必须留在根级，不要一起挪进来。
  methods: {
    /**
     * 页面守卫：需要登录的页面在自己的生命周期里（`onLoad` / `onMounted`）第一行调用。
     *
     * 判定是**纯本地**的（token 存在 + 读 token 里的 exp 判断未过期），
     * 0 网络请求、0 延迟，所以每次进页面调用都不心疼。
     * 服务端侧的失效（管理员改密码、账号被删）由 verifySession() 按天核验兜住。
     *
     * ⚠️ 只用于「需要登录的页面」，不要放进 App 的 onLaunch：
     * 入口页 pages/brand/brand 是面向未登录访客的品牌落地页（brand-spec §7）。
     * 登录页也不做这个检查（它正是跳转目的地，检查会造成互相跳转）。
     *
     * 页面里的用法：`if (!getApp().checkUserLogin()) return`
     * （H5 构建会自动注入 getApp 的 import，它不是 window 全局函数）
     *
     * @returns {boolean} 有有效登录态返回 true；否则发起「去登录」并返回 false
     */
    checkUserLogin() {
      try {
        if (userManager.hasValidSession()) return true
        // 「有 token 但过期了」= 登录状态过期；「压根没 token」= 尚未登录。
        // 两者文案不同，别对从没登录过的人说"已过期"。
        const reason = userManager.hasExpiredSession() ? 'expired' : 'login-required'
        // mode='replace'：守卫跑在页面的 onLoad 里，而 onLoad 已经提前 return，
        // 该页面不会被完整初始化，所以登录后要整页**重建**（reLaunch 到 redirect），
        // 不能用 navigateBack 返回 —— 那样会得到一个"框架在、数据没加载"的半残页面。
        this.handleSessionExpired(reason, 'replace', this.currentRoutePath())
        return false
      } catch (e) {
        console.error('检查用户登录态失败:', e)
        return false
      }
    },

    /**
     * 会话失效的唯一出口。页面守卫、按天核验、业务接口 401 都汇聚到这里。
     *
     * @param {'expired'|'login-required'} reason 决定登录页显示的提示文案
     * @param {'replace'|'back'} mode
     *        - 'replace'：调用方是页面的 onLoad 守卫（用户正在*进入*一个新页面，
     *          该页 onLoad 已提前 return 未完成初始化）→ 登录后 reLaunch 到 redirect 重建该页
     *        - 'back'   ：调用方是 App 层检查或 401 处理（用户*已经在*某个页面上，
     *          可能有没提交的输入）→ 用 navigateTo 压栈 + 登录后 navigateBack 返回，
     *          页面实例还在，输入框内容天然保留
     * @param {string} [redirect] mode='replace' 时的目标页面（含 query）
     */
    handleSessionExpired(reason, mode, redirect) {
      try {
        // 已经有人在处理了（并发 401 会来一串），或用户已经在登录页 —— 都不重复跳
        if (this._sessionExpiredHandling) return
        if (this.isOnLoginPage()) return
        // 公开页面不主动打断：用户可能只是在看品牌落地页，
        // 等他点进任何需要登录的页面时，页面守卫自然会处理
        if (mode !== 'replace' && this.isOnPublicPage()) return

        this._sessionExpiredHandling = true
        userManager.clearSession()

        // mode='replace' 时**必须**带 redirect：否则登录页会走 navigateBack 分支，
        // 而那条路径回的是"onLoad 已提前 return、没初始化完"的半残页面。
        // 所以取不到当前路由时退化成回首页，宁可去首页也不能回半残页面。
        //
        // ⚠️ 这里只做"是不是本站页面路径"的一致性检查，**不在这一层解码**：
        // H5 的 navigateTo 会把它收到的 query 值再编码一层，所以 address bar 上最终是
        // redirect=%252Fpages%252F…（两层）。"要解几层"这个知识只放在登录页一处
        // （login.vue 的 onLoad 里反复解码到稳定），否则两边各解一次会互相抵消或重复解。
        let target = ''
        if (mode === 'replace') {
          target = (redirect && redirect.indexOf('/pages/') === 0) ? redirect : '/pages/index/index'
        }

        let url = '/pages/login/login?reason=' + encodeURIComponent(reason || 'expired')
        if (target) url += '&redirect=' + encodeURIComponent(target)
        // back=1 显式告诉登录页"登录成功后 navigateBack 回原页面（输入保留）"。
        // 不用"reason 是否为空"来判断：品牌页点击也会带 reason=expired，
        // 但那个场景登录后该去首页，不是回品牌页。
        if (mode === 'back') url += '&back=1'

        const done = () => {
          // 延迟复位去重标志：complete 会紧接着 success 触发，此时登录页可能还没
          // 真正成为栈顶（isOnLoginPage() 还返回 false），并发来的第二个 401
          // 会再压一个登录页。等 2 秒后登录页必然已经就位，后续调用由
          // isOnLoginPage() 拦住。
          setTimeout(() => { this._sessionExpiredHandling = false }, 2000)
        }
        uni.navigateTo({
          url,
          // navigateTo 失败（页面栈满 / 路由尚未就绪）时兜底：整页重置到登录页。
          // 这条路径上原始页面栈会丢，所以带上 redirect 让登录后还能回到目标页。
          fail: () => {
            uni.reLaunch({ url, complete: done })
          },
          complete: done
        })
      } catch (e) {
        this._sessionExpiredHandling = false
        console.error('处理登录态失效失败:', e)
      }
    },

    /** 按天核验登录态（不阻塞首屏；节流与并发去重都在 userManager 里） */
    verifySessionInBackground() {
      userManager.verifySession().then((state) => {
        if (state === 'invalid') {
          // 'unknown'（断网 / 503 / 500）什么都不做：不能因为服务端暂时不可用就把人登出
          this.handleSessionExpired('expired', 'back')
        }
      }).catch(() => { /* verifySession 内部已兜底，这里不会抛 */ })
    },

    /**
     * 当前页面路径（含 query），供 mode='replace' 时登录后重建该页。
     *
     * onLoad 阶段取是安全的：uni-app H5 的 initPage() 先把页面注册进
     * currentPagesMap、setup() 里先赋 vm.route / vm.options，之后才调 onLoad。
     * 取不到时返回空串，调用方会退化成登录后去首页（绝不会回半残页面）。
     *
     * 用 `typeof getCurrentPages` 而不是直接调用：uni-app 的 H5 构建会把
     * getCurrentPages 自动注入成 import（见 @dcloudio/uni-h5-vite 的 inject 配置），
     * 万一某个构建路径没注入，`typeof 未声明标识符` 是安全的（返回 'undefined' 而不抛错），
     * 直接调用则会 ReferenceError 把整个守卫打挂。
     */
    currentRoutePath() {
      try {
        if (typeof getCurrentPages !== 'function') return ''
        const pages = getCurrentPages()
        if (!pages || !pages.length) return ''
        const cur = pages[pages.length - 1]
        const route = '/' + String((cur && cur.route) || '').replace(/^\//, '')
        if (route === '/') return ''
        const opts = (cur && cur.options) || {}
        const parts = []
        Object.keys(opts).forEach((k) => {
          const v = opts[k]
          if (v === undefined || v === null) return
          parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v))
        })
        return parts.length ? route + '?' + parts.join('&') : route
      } catch (e) {
        return ''
      }
    },

    /** 当前栈顶是不是登录页 */
    isOnLoginPage() {
      return this._currentRouteName().indexOf('pages/login/login') !== -1
    },

    /** 当前栈顶是不是公开页面（未登录访客可以看的页面） */
    isOnPublicPage() {
      const route = this._currentRouteName()
      return route === 'pages/brand/brand'
    },

    _currentRouteName() {
      try {
        if (typeof getCurrentPages !== 'function') return ''
        const pages = getCurrentPages()
        if (!pages || !pages.length) return ''
        const cur = pages[pages.length - 1]
        return String((cur && cur.route) || '')
      } catch (e) {
        return ''
      }
    },

    loadOpenid() {
      try {
        const openid = uni.getStorageSync('openid')
        if (openid) this.globalData.openid = openid
      } catch (e) { console.error('加载 openid 失败:', e) }
    },

    checkLoginStatus() {
      return !!this.globalData.openid
    },

    // 登录（微信云开发环境下用 wx.cloud；H5/其他平台使用本地存储模拟）
    // ⚠️ 目前全项目没有调用点：实际的登录走 stores/userStore.ts → userManager.login。
    // 保留在这里是为了 App 级 API 完整，如需使用请从页面里取 App 实例调用。
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

    // 初始化账号数据（同样目前没有调用点）
    async initAccount(openid) {
      try {
        await accountManager.initAccount(openid)
      } catch (e) { console.error('账号初始化失败:', e) }
    },

    // 退出登录（同样目前没有调用点：退出走 stores/userStore.ts → userManager.logout）
    logout() {
      this.globalData.openid = null
      try { uni.removeStorageSync('openid') } catch (e) {}
      uni.showToast({ title: '已退出登录', icon: 'success', duration: 2000 })
    }
  }
}
</script>

<style>
/* ============================================================
   无限旅团 · 全局设计令牌（来自 brand-spec.md v2.0）
   H5 编译目标下 CSS 自定义属性可全局生效，各页面 <style scoped>
   直接使用 var(--xxx) 即可，不需要重复声明。
   ============================================================ */

/* ⚠️ 不要在这里加 Google Fonts 的 @import。
   历史问题：这里曾有一行指向 fonts.googleapis.com 的 css2 外部 @import
   （Cinzel / JetBrains Mono / Noto Sans SC / Noto Serif SC）。
   外部 @import 会被 Vite 原样保留在 CSS 产物最顶部，是**渲染阻塞**资源：浏览器必须先把
   它解析完才肯绘制首屏。而 fonts.googleapis.com / fonts.gstatic.com 在部分网络环境
   （实测本机 DNS 直接超时）根本连不通，首帧因此被卡住 9s+，是 brand 页「loading 慢」
   的首要原因。即使能连通，Noto Sans/Serif SC 这类 CJK 网页字体也要按 unicode-range
   拉几十个分片，得不偿失。
   现在统一改用系统字体栈（见下方 --font-*），零额外网络请求。 */

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

  /* 字体栈：**与 brand-spec §2 / §6 完全一致**，只是不再用 @import 去加载 Web 字体
     （那是首屏被卡 9s+ 的根因，见上方注释）。

     ⚠️ 不要把这些"设计字体"往后挪。曾经把它们排到系统字体之后（比如把
     'Noto Sans SC' 放到 'Microsoft YaHei' 后面），结果凡是本机装了 Noto 的用户
     （实测本机就有 NotoSansSC-VF.ttf / NotoSerifSC-VF.ttf）正文会静默变成微软雅黑，
     和设计稿不一致。这些字体**在本机装了就用**，没装自然落到后面的系统字体，
     既不会产生网络请求，也不会有副作用 —— 所以"设计字体在前、系统字体兜底"才是对的顺序。 */
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

/* H5：修复 uni-input / uni-textarea 的**真实输入框点不进去**（表现为"这个框没法输入"）。
   根因：框架注入的全局 `user-select: none` 会被继承到组件内部的真实 <input>/<textarea>，
   部分移动端浏览器因此无法通过点击聚焦；另外 uni-input 默认行高偏小、点击热区不足。
   历史处理：login.vue 与 persona/index.vue 各自打过补丁（本项目实测有效），但**其它页面漏了**
   —— 设置页、角色卡编辑、预设编辑等仍然点不进去。这里做成**全局规则**（框架内部类名稳定：
   `.uni-input-input` / `.uni-textarea-textarea`），一次覆盖全站，不必逐页重复。
   仅 H5 需要（小程序端没有这层内部元素）。 */
/* #ifdef H5 */
.uni-input-input,
.uni-textarea-textarea {
  -webkit-user-select: text !important;
  user-select: text !important;
  cursor: text !important;
}
/* #endif */
</style>
