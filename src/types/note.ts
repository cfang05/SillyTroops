// src/types/note.ts
// 作者注（Author's Note）类型，对齐酒馆 authors-note.js 的 chat_metadata 字段语义

/** 注入位置，对齐酒馆 extension_prompt_types：0=IN_PROMPT(场景后) 1=IN_CHAT(历史深处) 2=BEFORE_PROMPT(提示词前) */
export type AuthorsNotePosition = 0 | 1 | 2

export interface AuthorsNoteConfig {
  /** 作者注正文 */
  prompt: string
  /** 每 N 条用户消息注入一次，默认 1=每条都注入 */
  interval: number
  /** IN_CHAT 时的注入深度（倒数第 N 条之前），默认 4 */
  depth: number
  /** 注入位置，默认 1=IN_CHAT */
  position: AuthorsNotePosition
  /** IN_CHAT 注入时使用的角色，默认 system */
  role: 'system' | 'user' | 'assistant'
}

export function createDefaultAuthorsNote(): AuthorsNoteConfig {
  return { prompt: '', interval: 1, depth: 4, position: 1, role: 'system' }
}

/** 是否为 IN_CHAT 注入的合法角色 */
export function isAuthorsNoteRole(role: string): role is AuthorsNoteConfig['role'] {
  return role === 'system' || role === 'user' || role === 'assistant'
}
