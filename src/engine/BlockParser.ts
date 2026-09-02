// src/engine/BlockParser.ts
// 扫描 AI 回复文本，识别特殊标签块并生成 RenderNode AST
// 基础解析逻辑迁移自 src/pages/game/game.vue 的 parseReplySegments()
// 扩展支持酒馆风格标签：<branches> / <meow_FM> / <time_format> / ```html```

import type { RenderNode } from '../types/render'
import { parseInline, hasInlineMarkdown, detectBlockMarkdown, hasImageMarkdown, splitInlineImages } from './MarkdownParser'

const OPEN_QUOTES = ['\u201c', '\u2018', '"']
const CLOSE_QUOTES = ['\u201d', '\u2019', '"']

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
 * 解析普通叙事文本（speech/damage/narrative），逻辑迁移自 game.vue parseReplySegments
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