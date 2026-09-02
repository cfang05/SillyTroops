<template>
  <view class="container">
    <NavBar title="游戏规则" />
    <view class="content" :style="{ paddingTop: (navBarHeight + 16) + 'px' }">
      <text>pages/rules/index.wxml</text>
    </view>
  </view>
</template>

<script>
import { getNavBarHeight } from '../../utils/navbar.js'
import NavBar from '../../components/common/NavBar.vue'

export default {
  components: { NavBar },
  data() {
    return { navBarHeight: 0 }
  },
  onLoad(options) {
    this.navBarHeight = getNavBarHeight().navBarHeight
  },
  onReady() {},
  onShow() {},
  onHide() {},
  onUnload() {},
  onPullDownRefresh() {},
  onReachBottom() {},
  onShareAppMessage() {},
  methods: {}
}
</script>

<style scoped>
.container { min-height: 100vh; background: var(--bg-deep); }
.content { padding: 28rpx 30rpx; box-sizing: border-box; }
</style>