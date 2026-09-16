// src/stores/regexPresetStore.ts
// 正侧（正则脚本文件）作为独立可导入资源管理，按用户隔离
// 每个"正侧文件"是一组正则脚本（RegexScript[]），可在新建对话时选用

import { defineStore } from 'pinia'
// @ts-ignore
import { scopedKey } from '../utils/account/userScope.js'
import { createCachedStore } from '../utils/storage/cachedStore'
import type { RegexScript } from '../types/script'
import { createSystemRegexScripts, SYSTEM_REGEX_PRESET_ID } from '../engine/systemRegex'

export interface RegexPreset {
  id: string
  name: string
  scripts: RegexScript[]
  createdAt: number
  updatedAt: number
  /**
   * 是否作为"全局正则"启用——对齐酒馆 GLOBAL 类型脚本（extension_settings.regex）：
   * 一旦启用，不管当前对话选没选正侧文件，都会跟角色卡自带（SCOPED）、
   * 预设自带（PRESET）的脚本一起合并生效，互不覆盖。默认关闭，需要用户显式启用。
   */
  enabledGlobal?: boolean
}

function STORAGE_KEY() { return scopedKey('regex_presets') }

/** P5.3：正侧文件改存 IndexedDB（同步 API 不变） */
const _store = createCachedStore({
  name: 'regexPreset',
  match: (k: string) => k === STORAGE_KEY()
})

export const useRegexPresetStore = defineStore('regexPreset', {
  state: () => ({
    presets: [] as RegexPreset[]
  }),

  getters: {
    /** 当前启用为"全局正则"的所有正侧文件脚本合并列表（对齐酒馆 GLOBAL 类型来源） */
    globalScripts: (state): RegexScript[] =>
      state.presets.filter(p => p.enabledGlobal).flatMap(p => p.scripts || [])
  },

  actions: {
    load() {
      try {
        this.presets = _store.get(STORAGE_KEY()) || []
      } catch (e) {
        this.presets = []
      }

      // 「系统正侧」（D15）：代码内置、默认选中、用户另选则替换、**不落盘**。
      // 与「系统预设」一样：每次启动重新植入，并先清掉历史上可能被持久化的同名项。
      this.presets = this.presets.filter(p => p && p.id !== SYSTEM_REGEX_PRESET_ID)
      this.presets.unshift({
        id: SYSTEM_REGEX_PRESET_ID,
        name: '系统正侧',
        scripts: createSystemRegexScripts(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        enabledGlobal: false
      })
    },

    get(id: string): RegexPreset | null {
      return this.presets.find(p => p.id === id) || null
    },

    save(preset: RegexPreset) {
      const idx = this.presets.findIndex(p => p.id === preset.id)
      if (idx >= 0) this.presets[idx] = preset
      else this.presets.push(preset)
      this._persist()
    },

    /** 导入一组正则脚本为一个新的正侧文件 */
    importScripts(name: string, scripts: RegexScript[]): string {
      const id = 'regex_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
      this.save({ id, name: name || '导入的正侧', scripts, createdAt: Date.now(), updatedAt: Date.now() })
      return id
    },

    /** 切换某个正侧文件的"全局正则"启用状态 */
    toggleGlobal(id: string, enabled: boolean) {
      const preset = this.presets.find(p => p.id === id)
      if (!preset) return
      preset.enabledGlobal = enabled
      preset.updatedAt = Date.now()
      this._persist()
    },

    remove(id: string) {
      // 系统正侧不可删除（D15）
      if (id === SYSTEM_REGEX_PRESET_ID) return
      this.presets = this.presets.filter(p => p.id !== id)
      this._persist()
    },

    _persist() {
      try {
        // 系统正侧不落盘（D15）
        _store.set(STORAGE_KEY(), this.presets.filter(p => p && p.id !== SYSTEM_REGEX_PRESET_ID))
      } catch (e) {
        console.warn('[regexPresetStore] 持久化失败:', e)
      }
    }
  }
})