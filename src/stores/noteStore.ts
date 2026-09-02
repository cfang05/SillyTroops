// src/stores/noteStore.ts
// 作者注（Author's Note）全局默认配置，按用户隔离持久化。
// 对齐酒馆 authors-note.js 的 extension_settings.note.default 语义（per-chat 覆盖后续可加）。

import { defineStore } from 'pinia'
import storage from '../utils/storage.js'
// @ts-ignore
import { scopedKey } from '../utils/account/userScope.js'
import { createDefaultAuthorsNote, type AuthorsNoteConfig } from '../types/note'

function NOTE_KEY() { return scopedKey('authors_note') }

export const useNoteStore = defineStore('note', {
  state: () => ({
    config: createDefaultAuthorsNote() as AuthorsNoteConfig
  }),

  actions: {
    load() {
      try {
        const saved = storage.get(NOTE_KEY())
        if (saved && typeof saved === 'object') {
          this.config = { ...createDefaultAuthorsNote(), ...saved }
        }
      } catch (e) {
        console.warn('[noteStore] load 失败:', e)
      }
    },

    update(config: AuthorsNoteConfig) {
      this.config = config
      this._persist()
    },

    _persist() {
      try {
        storage.set(NOTE_KEY(), this.config)
      } catch (e) {
        console.warn('[noteStore] 持久化失败:', e)
      }
    }
  }
})
