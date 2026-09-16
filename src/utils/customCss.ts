// src/utils/customCss.ts
// 自定义 CSS（P4.3 / D2）：样式出口的另一半。
//
// D2 定的方案是「正则产出 class + 自定义 CSS 决定外观」：
// 正侧负责产出 `<span class="say">…</span>`（P4.4 系统正侧），这里负责把这套 class 的
// 实际外观注入进页面。
//
// 它还顺带承担一个必要职责：**注入系统正侧用到的默认样式**（`.say`）。
// 否则在用户没写过任何自定义 CSS 时，台词会失去"金色斜体"外观 —— 相对改造前属于回退。
// 默认样式放在前面、用户样式放在后面，因此用户可以用同名选择器覆盖默认值。

import storage from './storage.js'
import { scopedKey } from './account/userScope.js'

function KEY() { return scopedKey('custom_css') }

/** 系统正侧台词样式的默认外观（与改造前 `.block-speech` 的观感保持一致） */
export const DEFAULT_SYSTEM_CSS = [
  '/* 系统默认：台词（由「系统正侧」产出的 .say class 使用） */',
  '.say {',
  '  display: block;',
  '  font-family: var(--font-body);',
  '  font-size: 13px;',
  '  line-height: 1.6;',
  '  color: var(--t-gold);',
  '  font-style: italic;',
  '}'
].join('\n')

const STYLE_ID = 'sillytroops-custom-css'

export function loadCustomCss(): string {
  try {
    const v = storage.get(KEY())
    return typeof v === 'string' ? v : ''
  } catch (e) {
    return ''
  }
}

export function saveCustomCss(css: string): boolean {
  try {
    storage.set(KEY(), css || '')
    applyCustomCss(css)
    return true
  } catch (e) {
    console.warn('[customCss] 保存失败:', e)
    return false
  }
}

/** 防止用户 CSS 里出现 `</style>` 提前闭合样式表、破坏页面结构 */
function _guard(css: string): string {
  return String(css || '').replace(/<\/style/gi, '<\\/style')
}

/** 注入 / 更新样式表（仅 H5；其它端什么都不做，保持现状 D3） */
export function applyCustomCss(css?: string): void {
  // #ifdef H5
  try {
    const text = css === undefined ? loadCustomCss() : css
    let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null
    if (!el) {
      el = document.createElement('style')
      el.id = STYLE_ID
      document.head.appendChild(el)
    }
    el.innerHTML = DEFAULT_SYSTEM_CSS + '\n\n/* ── 用户自定义 CSS ── */\n' + _guard(text)
  } catch (e) {
    console.warn('[customCss] 注入失败:', e)
  }
  // #endif
}

/** 启动时调用（幂等）：确保默认样式与用户样式都已就位 */
export function initCustomCss(): void {
  applyCustomCss()
}

export default { DEFAULT_SYSTEM_CSS, loadCustomCss, saveCustomCss, applyCustomCss, initCustomCss }
