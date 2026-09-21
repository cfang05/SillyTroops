// src/engine/BlockParser.ts
// 扫描 AI 回复文本，识别特殊标签块并生成 RenderNode AST
// 扩展支持酒馆风格标签：<branches> / <meow_FM> / <time_format> / ```html```

import type { RenderNode } from '../types/render'
import { parseInline, hasInlineMarkdown, detectBlockMarkdown, hasImageMarkdown, splitInlineImages } from './MarkdownParser'

const OPEN_QUOTES = ['\u201c', '\u2018', '"']
const CLOSE_QUOTES = ['\u201d', '\u2019', '"']

// ─────────────────────────────────────────────────────────────
// 正则脚本产出的 HTML 片段（P4.2 / D2）
//
// 为什么需要：样式出口走「自定义 CSS + class」（D2），也就是正则把台词包成
// `<span class="say">…</span>`，由 CSS 决定外观。渲染层必须认得这种片段，
// 否则它只会以字面文本显示出来。
//
// 只认这几个能安全内联的标签（H5 端最终仍会经 utils/security.ts 的 DOMPurify 白名单再洗一遍，
// font / mark 不在该白名单内，会被剥成纯文字；其余超集标签同理），
// 且只支持**不嵌套**的同名标签配对；嵌套时外层匹配不上 → 退化成普通文字，不会误吞内容。
// ─────────────────────────────────────────────────────────────
const HTML_FRAGMENT_RE = /<(span|div|font|b|i|u|s|em|strong|mark)\b[^>]*>[\s\S]*?<\/\1>/gi

export interface HtmlFragmentSplit {
  html?: string
  text?: string
}

/** 该行是否含可识别的 HTML 片段 */
export function hasHtmlFragment(text: string): boolean {
  if (!text || text.indexOf('<') === -1) return false
  HTML_FRAGMENT_RE.lastIndex = 0
  return HTML_FRAGMENT_RE.test(text)
}

/** 去掉标签取纯文本（供非 H5 端与净化失效时的降级显示） */
function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim()
}

/** 把一行里混排的 HTML 片段拆成"文字段 / HTML 段"的顺序列表 */
export function splitHtmlFragments(line: string): HtmlFragmentSplit[] {
  if (!hasHtmlFragment(line)) return [{ text: line }]
  const parts: HtmlFragmentSplit[] = []
  let lastIndex = 0
  HTML_FRAGMENT_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = HTML_FRAGMENT_RE.exec(line)) !== null) {
    if (m.index > lastIndex) parts.push({ text: line.slice(lastIndex, m.index) })
    parts.push({ html: m[0], text: stripTags(m[0]) })
    lastIndex = HTML_FRAGMENT_RE.lastIndex
  }
  if (lastIndex < line.length) parts.push({ text: line.slice(lastIndex) })
  return parts.filter(p => (p.html ? true : !!(p.text && p.text.trim())))
}

/**
 * 提取并移除文本中的特殊标签块，返回 { cleanedText, blocks }
 * 特殊标签统一在narrative解析之前提取，避免干扰引号扫描
 */
function extractSpecialBlocks(text: string): { cleanedText: string; blocks: RenderNode[] } {
  const blocks: RenderNode[] = []
  let cleaned = text

  // <branches>A. xxx\nB. xxx</branches>
  cleaned = cleaned.replace(/<branches>([\s\S]*?)<\/branches>/gi, (_match, inner: string) => {
    const options = inner
      .split('\n')
      .map(l => l.trim())
      .filter(l => /^[A-Za-z][.、)]/.test(l))
      .map(l => l.replace(/^[A-Za-z][.、)]\s*/, '').trim())
      .filter(Boolean)
    if (options.length > 0) {
      blocks.push({ type: 'branch', options })
    }
    return ''
  })

  // <meow_FM>内容</meow_FM>
  cleaned = cleaned.replace(/<meow_FM>([\s\S]*?)<\/meow_FM>/gi, (_match, inner: string) => {
    const content = inner.trim()
    if (content) blocks.push({ type: 'summary', content })
    return ''
  })

  // <time_format date="xxx" time="xxx" scene="xxx"/> 或 <time_format date="xxx" time="xxx" scene="xxx"></time_format>
  cleaned = cleaned.replace(/<time_format\s+([^>]*?)\/?>(?:<\/time_format>)?/gi, (_match, attrsStr: string) => {
    const attrs: Record<string, string> = {}
    const attrRe = /(\w+)\s*=\s*"([^"]*)"/g
    let m: RegExpExecArray | null
    while ((m = attrRe.exec(attrsStr)) !== null) {
      attrs[m[1]] = m[2]
    }
    blocks.push({
      type: 'time',
      date: attrs.date || '',
      time: attrs.time || '',
      scene: attrs.scene || ''
    })
    return ''
  })

  // ```html ... ```
  cleaned = cleaned.replace(/```html\n([\s\S]*?)```/gi, (_match, inner: string) => {
    const content = inner.trim()
    if (content) blocks.push({ type: 'html', content })
    return ''
  })

  // 普通代码块 ``` ... ```（无语言标记，酒馆预设常用于渲染状态栏/属性面板等结构化信息，
  // 保留原始文本格式渲染为等宽字体块，而不是被叙事解析拆散成散乱的短行）
  cleaned = cleaned.replace(/```(?:\w*)\n?([\s\S]*?)```/g, (_match, inner: string) => {
    const content = inner.trim()
    if (content) blocks.push({ type: 'code', content })
    return ''
  })

  return { cleanedText: cleaned, blocks }
}

/**
 * 解析普通叙事文本（speech/damage/narrative）
 */
function parseNarrativeText(text: string): RenderNode[] {
  if (!text) return []

  const damageMap: { value: string }[] = []
  let dmgIdx = 0
  const textWithPH = text.replace(/\[damage:([^\]]+)\]/g, (_match, value: string) => {
    const ph = '\x00DMG' + dmgIdx + '\x00'
    damageMap.push({ value })
    dmgIdx++
    return ph
  })

  const segments: RenderNode[] = []
  let inSpeech = false
  let buf = ''
  let closeQuote = ''

  const flushNarrative = (s: string) => {
    s.split(/(\x00DMG\d+\x00)/g).forEach(part => {
      if (!part) return
      const dm = part.match(/^\x00DMG(\d+)\x00$/)
      if (dm) {
        segments.push({ type: 'damage', text: damageMap[parseInt(dm[1], 10)].value })
        return
      }
      part.split('\n').forEach(line => {
        const l = line.trim()
        if (!l) return
        if (l.length > 50) {
          const subs = l.split(/([。！？…；])/g)
          let acc = ''
          subs.forEach(sub => {
            acc += sub
            if (sub.length === 1 && /[。！？…；]/.test(sub) && acc.trim().length >= 20) {
              if (acc.trim()) segments.push({ type: 'narrative', text: acc.trim() })
              acc = ''
            }
          })
          if (acc.trim()) segments.push({ type: 'narrative', text: acc.trim() })
        } else {
          segments.push({ type: 'narrative', text: l })
        }
      })
    })
  }

  for (let i = 0; i < textWithPH.length; i++) {
    const ch = textWithPH[i]
    if (!inSpeech) {
      const qIdx = OPEN_QUOTES.indexOf(ch)
      if (qIdx >= 0) {
        if (buf) { flushNarrative(buf); buf = '' }
        inSpeech = true
        closeQuote = CLOSE_QUOTES[qIdx]
      } else {
        buf += ch
      }
    } else {
      if (ch === closeQuote) {
        const st = buf.replace(/\n/g, '').trim()
        if (st) {
          if (st.length > 5 || /[。！？…，、：；]/.test(st)) {
            segments.push({ type: 'speech', text: st })
          } else {
            flushNarrative('\u201c' + st + '\u201d')
          }
        }
        buf = ''
        inSpeech = false
        closeQuote = ''
      } else {
        buf += ch
      }
    }
  }

  if (buf.trim()) {
    if (inSpeech) {
      segments.push({ type: 'speech', text: buf.replace(/\n/g, '').trim() })
    } else {
      flushNarrative(buf)
    }
  }

  const result: RenderNode[] = []
  let lastBlank = false
  segments.forEach(seg => {
    if (seg.type === 'blank') {
      if (!lastBlank && result.length > 0) { result.push(seg); lastBlank = true }
    } else {
      result.push(_withInlineMarkdown(seg))
      lastBlank = false
    }
  })

  return result
}

/** 为 narrative/speech 节点附加行内 Markdown 片段（无标记则原样返回） */
function _withInlineMarkdown(seg: RenderNode): RenderNode {
  if ((seg.type === 'narrative' || seg.type === 'speech') && hasInlineMarkdown(seg.text)) {
    return { ...seg, segments: parseInline(seg.text) } as RenderNode
  }
  return seg
}

/**
 * 将纯文本按行拆分为"块级 Markdown 节点 + 散文叙事节点"：
 *   - 独占一行的图片 ![alt](src) → image 节点
 *   - 标题/分隔线/引用/列表 → rich 节点（行内片段）
 *   - 与文字混排的图片：先把该行按图片位置切成"文字/图片"顺序片段，图片仍单独成 image 节点，
 *     前后文字各自并入散文缓冲区（uni-app <text> 不支持嵌套 <image>，图片只能独立渲染）
 *   - 其余连续行 → 交给 parseNarrativeText 做 speech/damage/narrative 解析
 */
function splitProseAndBlocks(text: string): RenderNode[] {
  if (!text) return []
  const nodes: RenderNode[] = []
  let proseBuf: string[] = []

  const flushProse = () => {
    if (proseBuf.length) {
      nodes.push(...parseNarrativeText(proseBuf.join('\n')))
      proseBuf = []
    }
  }

  for (const line of text.split('\n')) {
    // 正则脚本产出的 HTML 片段（P4.2）：优先于块级 Markdown 识别。
    // 每个片段渲染为一个独立的块 —— 与现有"台词独占一行"的表现一致；
    // 片段之间的文字继续走叙事解析。
    if (hasHtmlFragment(line)) {
      flushProse()
      for (const part of splitHtmlFragments(line)) {
        if (part.html) {
          nodes.push({ type: 'html-inline', html: part.html, text: part.text || '' })
        } else if (part.text) {
          proseBuf.push(part.text)
        }
      }
      continue
    }

    const block = detectBlockMarkdown(line)
    if (block) {
      flushProse()
      if (block.style === 'image') {
        nodes.push({ type: 'image', alt: block.alt || '', src: block.content })
      } else if (block.style === 'hr') {
        nodes.push({ type: 'rich', segments: [], block: 'hr' })
      } else {
        const segments = parseInline(block.content)
        nodes.push({
          type: 'rich',
          segments: segments.length ? segments : [{ text: block.content }],
          block: block.style,
          level: block.level
        })
      }
      continue
    }

    if (hasImageMarkdown(line)) {
      // 图片与文字混排在同一行：按图片位置拆开，图片单独成节点，文字段落入散文缓冲区
      for (const part of splitInlineImages(line)) {
        if (part.image) {
          flushProse()
          nodes.push({ type: 'image', alt: part.image.alt, src: part.image.src })
        } else if (part.text !== undefined && part.text !== '') {
          proseBuf.push(part.text)
        }
      }
      continue
    }

    proseBuf.push(line)
  }
  flushProse()
  return nodes
}

/**
 * 主入口：解析 AI 回复文本为 RenderNode AST
 * 顺序：先提取特殊标签块（branch/summary/time/html/code），再对剩余文本做
 *       "块级 Markdown + 叙事解析"（speech/damage/narrative 含行内 Markdown）。
 * 特殊标签块统一置于叙事内容之后（符合"AI 先叙述，末尾给选项"的常见格式）
 */
export function parseBlocks(text: string): RenderNode[] {
  if (!text) return [{ type: 'narrative', text: '' }]

  const { cleanedText, blocks } = extractSpecialBlocks(text)
  const narrativeNodes = splitProseAndBlocks(cleanedText)

  const result = [...narrativeNodes, ...blocks]
  return result.length > 0 ? result : [{ type: 'narrative', text }]
}

/**
 * 补齐流式过程中"未闭合"的成对 Markdown 符号（P2.3 / B6）
 *
 * 背景（对齐酒馆 `script.js:3608-3614` 的 charsToBalance）：
 * `**粗体**`、```` ```代码块``` ```` 这类语法是**成对**的，流到一半必然是奇数个，
 * 渲染器会把后半段整段当成斜体/代码块渲染，下一个 token 到达时又跳回来 ——
 * 这是流式输出里最刺眼的一处抖动。
 *
 * 这里临时补一个闭合符号（代码围栏还会补换行让围栏生效）。
 * **只在流式中间帧使用**：最终渲染必须传原始文本，否则会把多余字符带进
 * 存档、复制与下一轮上下文。
 */
export function balanceIncompleteMarkdown(text: string): string {
  if (!text) return text
  const count = (s: string, token: string) => s.split(token).length - 1
  const isOdd = (n: number) => n % 2 === 1
  const trimEnd = (s: string) => s.replace(/\s+$/, '')
  // 顺序有讲究：代码围栏优先级最高——补上围栏后，内部的 ** / ~~ 都成了代码内容，不必再管
  if (isOdd(count(text, '```'))) return trimEnd(text) + '\n```'
  if (isOdd(count(text, '~~~'))) return trimEnd(text) + '\n~~~'
  if (isOdd(count(text, '**'))) return trimEnd(text) + '**'
  if (isOdd(count(text, '__'))) return trimEnd(text) + '__'
  if (isOdd(count(text, '~~'))) return trimEnd(text) + '~~'
  return text
}