// src/types/render.ts
// BlockParser 输出的 AST 节点类型定义（含 Markdown 内联片段支持）

/** Markdown 内联片段（粗体/斜体/删除线/行内代码） */
export interface InlineSegment {
  text: string
  bold?: boolean
  italic?: boolean
  strike?: boolean
  code?: boolean
}

/** Markdown 块级样式 */
export type MarkdownBlockStyle = 'paragraph' | 'heading' | 'list-item' | 'quote' | 'hr'

export type RenderNode =
  | { type: 'branch'; options: string[] }
  | { type: 'summary'; content: string }
  | { type: 'time'; date: string; time: string; scene: string }
  | { type: 'html'; content: string }
  /**
   * 正则脚本产出的 HTML 片段（P4.2）：与上面的 'html'（```html``` 块 → 沙箱 iframe）不同，
   * 这里是**行内/小片段**，H5 端用 `v-html` 渲染（净化后），其它端降级为 `text` 纯文本。
   */
  | { type: 'html-inline'; html: string; text: string }
  | { type: 'code'; content: string }
  | { type: 'speech'; text: string; segments?: InlineSegment[] }
  | { type: 'damage'; text: string }
  | { type: 'narrative'; text: string; segments?: InlineSegment[] }
  | { type: 'rich'; segments: InlineSegment[]; block: MarkdownBlockStyle; level?: number }
  | { type: 'image'; alt: string; src: string }
  | { type: 'blank' }
