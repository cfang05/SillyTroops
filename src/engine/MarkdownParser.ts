// src/engine/MarkdownParser.ts
// 轻量 Markdown 解析（纯函数，双端可用，不依赖 DOM）。
// 覆盖：行内（粗体/斜体/删除线/行内代码）+ 块级（标题/无序/有序列表/引用/分隔线）。
// 仅服务聊天消息渲染；角色卡对话里最常见的 *动作* / **强调** / 列表 / 引用在此处理。

import type { InlineSegment, MarkdownBlockStyle } from '../types/render'

const INLINE_RE = /(\*\*\*|___)([\s\S]+?)\1|(\*\*|__)([\s\S]+?)\3|(\*|_)([\s\S]+?)\5|(`)([^`\n]+)\7|(~~)([\s\S]+?)\9/g

/** 解析行内 Markdown 为片段列表 */
export function parseInline(text: string): InlineSegment[] {
  if (!text) return []
  const segments: InlineSegment[] = []
  let lastIndex = 0
  INLINE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, m.index) })
    }
    if (m[1] !== undefined) {
      segments.push({ text: m[2], bold: true, italic: true })
    } else if (m[3] !== undefined) {
      segments.push({ text: m[4], bold: true })
    } else if (m[5] !== undefined) {
      segments.push({ text: m[6], italic: true })
    } else if (m[7] !== undefined) {
      segments.push({ text: m[8], code: true })
    } else if (m[9] !== undefined) {
      segments.push({ text: m[10], strike: true })
    }
    lastIndex = INLINE_RE.lastIndex
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex) })
  }
  return segments.filter(s => s.text !== '')
}

/** 文本是否含行内 Markdown 标记 */
export function hasInlineMarkdown(text: string): boolean {
  return /(\*\*|__|\*|_|~~|`)/.test(text)
}

export interface BlockMatch {
  style: MarkdownBlockStyle | 'image'
  level?: number
  content: string
  /** style === 'image' 时：图片 alt 文本，content 复用为图片 src */
  alt?: string
}

/** 单独一行的图片语法：![alt](src)，允许行首/行尾空白（酒馆用 showdown 渲染，![]()→<img>） */
const IMAGE_LINE_RE = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/
/** 行内（与其他文字混排）的图片语法，全局匹配用于拆分 */
const IMAGE_INLINE_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

/** 文本是否含图片语法（独占一行或与文字混排均可命中） */
export function hasImageMarkdown(text: string): boolean {
  return /!\[[^\]]*\]\([^)\s]+(?:\s+"[^"]*")?\)/.test(text)
}

export interface ImageLineSplit {
  text?: string
  image?: { alt: string; src: string }
}

/**
 * 把一行里混排的 ![alt](src) 图片语法拆成"文字段/图片段"顺序列表。
 * uni-app 的 <text> 组件不支持嵌套 <image>，所以图片始终作为独立块渲染；
 * 一行里图片前后若还有文字，文字部分仍按普通叙事文本处理。
 */
export function splitInlineImages(line: string): ImageLineSplit[] {
  if (!hasImageMarkdown(line)) return [{ text: line }]
  const parts: ImageLineSplit[] = []
  let lastIndex = 0
  IMAGE_INLINE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = IMAGE_INLINE_RE.exec(line)) !== null) {
    if (m.index > lastIndex) parts.push({ text: line.slice(lastIndex, m.index) })
    parts.push({ image: { alt: m[1] || '', src: m[2] } })
    lastIndex = IMAGE_INLINE_RE.lastIndex
  }
  if (lastIndex < line.length) parts.push({ text: line.slice(lastIndex) })
  return parts
}

/** 检测单行是否为块级 Markdown（图片/标题/分隔线/引用/列表），否则返回 null */
export function detectBlockMarkdown(line: string): BlockMatch | null {
  const trimmed = line.trim()
  // 独占一行的图片：![alt](src)（先于标题等判断，避免被其他规则误吞）
  const imgMatch = trimmed.match(IMAGE_LINE_RE)
  if (imgMatch) return { style: 'image', alt: imgMatch[1] || '', content: imgMatch[2] }
  const trimmedEnd = line.trimEnd()
  // 标题
  let m = trimmedEnd.match(/^(#{1,6})\s+(.*)$/)
  if (m) return { style: 'heading', level: m[1].length, content: m[2] }
  // 分隔线
  if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(trimmedEnd)) return { style: 'hr', content: '' }
  // 引用
  m = trimmedEnd.match(/^>\s?(.*)$/)
  if (m) return { style: 'quote', content: m[1] }
  // 无序列表
  m = trimmedEnd.match(/^\s*[-*+]\s+(.*)$/)
  if (m) return { style: 'list-item', content: m[1] }
  // 有序列表
  m = trimmedEnd.match(/^\s*\d+[.)]\s+(.*)$/)
  if (m) return { style: 'list-item', content: m[1] }
  return null
}
