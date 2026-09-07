// src/stores/regexPresetStore.ts
// 正侧（正则脚本文件）作为独立可导入资源管理，按用户隔离
// 每个"正侧文件"是一组正则脚本（RegexScript[]），可在新建对话时选用

import { defineStore } from 'pinia'
import storage from '../utils/storage.js'
// @ts-ignore
import { scopedKey } from '../utils/account/userScope.js'
import type { RegexScript } from '../types/script'

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

let _builtinRegexLoadPromise: Promise<void> | null = null

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
        this.presets = storage.get(STORAGE_KEY()) || []
      } catch (e) {
        this.presets = []
      }
      
      // 自动加载内置正侧（如果尚未导入），全局单例保证不会并发重复导入
      this._loadBuiltinRegex()
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
      this.presets = this.presets.filter(p => p.id !== id)
      this._persist()
    },

    _persist() {
      try {
        storage.set(STORAGE_KEY(), this.presets)
      } catch (e) {
        console.warn('[regexPresetStore] 持久化失败:', e)
      }
    },

    /** 自动加载内置正侧（仅H5端；用全局单例 Promise 确保多页面并发调用时只真正执行一次） */
    _loadBuiltinRegex(): Promise<void> {
      if (_builtinRegexLoadPromise) return _builtinRegexLoadPromise

      _builtinRegexLoadPromise = (async () => {
        const hasBuiltin = this.presets.some(p => p.id && p.id.startsWith('builtin_regex_'))
        if (hasBuiltin) return

        // #ifdef H5
        try {
          const { loadBuiltinRegexPresets } = await import('../services/builtinAssets')
          const results = await loadBuiltinRegexPresets()

          for (const item of results) {
            if (!item.scripts || item.error) {
              console.warn(`[regexPresetStore] 内置正侧 ${item.name} 加载失败:`, item.error)
              continue
            }
            const preset: RegexPreset = {
              id: 'builtin_regex_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
              name: '[内置] ' + item.name,
              scripts: item.scripts,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              enabledGlobal: false
            }
            this.presets.push(preset)
          }

          if (results.some(r => !r.error)) {
            this._persist()
            console.log('[regexPresetStore] 内置正侧已自动加载')
          }
        } catch (e) {
          console.warn('[regexPresetStore] 内置正侧加载失败:', e)
        }
        // #endif
      })()

      return _builtinRegexLoadPromise
    }
  }
})