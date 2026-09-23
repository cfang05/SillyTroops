// src/types/note.ts
// 作者注（Author's Note）类型，对齐酒馆 authors-note.js 的 chat_metadata 字段语义
//
// v2（2026-09-21 对齐改造）：酒馆的作者注是**两个字段** —— `note_prompt`（正文）与
// `note_interval`（间隔）。本项目原来是 `prompt` + `interval`，容易和"要拼进正文的
// 世界书 ANTop/ANBottom"混淆，故统一改名为 promptText / interval，并在 noteStore 里
// 做一次旧字段迁移（见 stores/noteStore.ts 的 normalizeAuthorsNote）。

/** 注入位置，对齐酒馆 extension_prompt_types：0=IN_PROMPT(场景后) 1=IN_CHAT(历史深处) 2=BEFORE_PROMPT(提示词前) */
export type AuthorsNotePosition = 0 | 1 | 2

export interface AuthorsNoteConfig {
  /** 作者注正文（酒馆的 note_prompt） */
  promptText: string
  /** 每 N 条用户消息注入一次，默认 1=每条都注入（酒馆的 note_interval） */
  interval: number
  /** IN_CHAT 时的注入深度（倒数第 N 条之前），默认 4 */
  depth: number
  /** 注入位置，默认 1=IN_CHAT */
  position: AuthorsNotePosition
  /** IN_CHAT 注入时使用的角色，默认 system */
  role: 'system' | 'user' | 'assistant'
}

export function createDefaultAuthorsNote(): AuthorsNoteConfig {
  return { promptText: '', interval: 1, depth: 4, position: 1, role: 'system' }
}

/**
 * 兼容旧数据：把历史上的 `prompt` 字段读成 `promptText`。
 * @param raw 任意来源的作者注对象（本地存储 / 旧存档 / 酒馆字段）
 */
export function normalizeAuthorsNote(raw: any): AuthorsNoteConfig {
  const base = createDefaultAuthorsNote()
  if (!raw || typeof raw !== 'object') return base
  const promptText = typeof raw.promptText === 'string'
    ? raw.promptText
    : (typeof raw.prompt === 'string' ? raw.prompt : base.promptText)
  const interval = Number(raw.interval)
  const depth = Number(raw.depth)
  const position = (raw.position === 0 || raw.position === 1 || raw.position === 2) ? raw.position : base.position
  const role = (raw.role === 'user' || raw.role === 'assistant' || raw.role === 'system') ? raw.role : base.role
  return {
    promptText,
    interval: Number.isFinite(interval) && interval > 0 ? Math.floor(interval) : base.interval,
    depth: Number.isFinite(depth) ? Math.floor(depth) : base.depth,
    position,
    role
  }
}

/** 是否为 IN_CHAT 注入的合法角色 */
export function isAuthorsNoteRole(role: string): role is AuthorsNoteConfig['role'] {
  return role === 'system' || role === 'user' || role === 'assistant'
}
