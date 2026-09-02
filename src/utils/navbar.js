// src/utils/navbar.js
// 自定义导航栏（pages.json 里 navigationStyle:"custom"）通用高度计算。
// 一旦某页面用了 navigationStyle:"custom"，系统就不再自动预留「状态栏 + 原生导航栏」的空间，
// 页面必须自己：① 把状态栏高度算出来，垂直方向撑起自定义导航栏本身；② 给下面的内容区加同样高度的
// paddingTop，避免内容被固定定位的导航栏盖住。
//
// 54px 是 NavBar.vue 组件的标准内容高度（不含状态栏，对应 notes/brand-spec.md §4 通用导航栏规格
// 「容器高度 54px」，模板里用 108rpx，按 750rpx=375px 基准换算等价）。
//
// 用法：页面 onMounted/onLoad 里调用一次，把 navBarHeight 绑定到内容容器的 paddingTop（单位 px）。
export function getNavBarHeight() {
  let statusBarHeight = 0
  try {
    const info = uni.getSystemInfoSync()
    statusBarHeight = info.statusBarHeight || 0
  } catch (e) { /* 忽略，取默认值 0 */ }
  return {
    statusBarHeight,
    navBarHeight: statusBarHeight + 54
  }
}
