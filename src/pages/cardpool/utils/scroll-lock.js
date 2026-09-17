// src/pages/cardpool/utils/scroll-lock.js
// 弹窗 / 抽屉打开时禁止主页面滚动，关闭时恢复。
//
// 为什么要计数器而不是布尔开关：
//   详情弹窗与筛选抽屉可能先后/同时打开（例如从抽屉里点开卡片），
//   谁先关谁后关是不确定的；用布尔值会在第一个关闭时就把滚动解锁，
//   导致另一个还开着的浮层背后页面能滚。
//
// H5：直接锁 documentElement/body 的 overflow（uni-app H5 的页面滚动就在这两个元素上）。
// 小程序/App：没有等价的全局 API，页面级滚动由页面自身控制，这里做成无害的 no-op。
'use strict';

let _count = 0;
let _savedHtmlOverflow = '';
let _savedBodyOverflow = '';

/** 锁住页面滚动（可重入） */
export function lockPageScroll() {
  _count += 1;
  if (_count > 1) return;
  // #ifdef H5
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  const body = document.body;
  if (!html || !body) return;
  _savedHtmlOverflow = html.style.overflow || '';
  _savedBodyOverflow = body.style.overflow || '';
  html.style.overflow = 'hidden';
  body.style.overflow = 'hidden';
  // #endif
}

/** 解锁（可重入，必须与 lockPageScroll 成对调用） */
export function unlockPageScroll() {
  _count = Math.max(0, _count - 1);
  if (_count > 0) return;
  // #ifdef H5
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  const body = document.body;
  if (!html || !body) return;
  html.style.overflow = _savedHtmlOverflow;
  body.style.overflow = _savedBodyOverflow;
  // #endif
}

/** 当前是否处于锁定状态（调试/测试用） */
export function isPageScrollLocked() {
  return _count > 0;
}

/**
 * 强制复位（页面卸载时兜底用）。
 *
 * ⚠️ 与 unlockPageScroll 的区别：unlock 是"我这一份用完了"（计数 -1），
 * reset 是"这个页面没了，锁一律作废"。页面退出时如果还有别的浮层持有锁，
 * 计数不会归零，下一层页面就会莫名其妙滚不动 —— 所以这里必须强清。
 */
export function resetPageScrollLock() {
  _count = 0;
  // #ifdef H5
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  const body = document.body;
  if (!html || !body) return;
  html.style.overflow = _savedHtmlOverflow;
  body.style.overflow = _savedBodyOverflow;
  // #endif
}

export default { lockPageScroll, unlockPageScroll, isPageScrollLocked, resetPageScrollLock };
