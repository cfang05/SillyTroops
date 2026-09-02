// src/utils/security.ts
// HTML 内容清洗（仅 H5 端使用，用于 HtmlIframe 沙箱渲染前的净化）
// 小程序端无 DOM/innerHTML 能力，不涉及此文件

// #ifdef H5
import DOMPurify from 'dompurify'

/**
 * 清洗用户/AI 生成的 HTML 内容，移除脚本、事件属性等风险内容
 * 仅允许基础排版标签，禁止 script/iframe/object/embed 及 on* 事件属性
 */
export function sanitizeHtml(html: string): string {
  if (!html) return ''
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'div', 'span', 'p', 'br', 'b', 'i', 'em', 'strong', 'u', 's',
      'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'table', 'thead', 'tbody', 'tr', 'td', 'th', 'img', 'a', 'blockquote', 'code', 'pre', 'hr'
    ],
    ALLOWED_ATTR: ['style', 'class', 'src', 'alt', 'href', 'title'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
    FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover']
  })
}
// #endif