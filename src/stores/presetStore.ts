// src/stores/presetStore.ts
// 预设库状态管理（新建，无现有对应实现）
// Sprint 1.7

import { defineStore } from 'pinia'
import storage from '../utils/storage.js'
// @ts-ignore
import { scopedKey } from '../utils/account/userScope.js'
import type { Preset } from '../types/preset'
import { createDefaultPreset, DEFAULT_PRESET_ID } from '../adapters/preset/defaultPreset'

function STORAGE_KEY() { return scopedKey('llm_presets') }
function ACTIVE_KEY() { return scopedKey('llm_active_preset_id') }

export const usePresetStore = defineStore('preset', {
  state: () => ({
    presets: [] as Preset[],
    activePresetId: null as string | null
  }),

  getters: {
    activePreset: (state) =>
      state.presets.find(p => p.id === state.activePresetId) || null
  },

  actions: {
    load() {
      try {
        this.presets = storage.get(STORAGE_KEY()) || []
      } catch (e) {
        console.warn('[presetStore] load 失败:', e)
        this.presets = []
      }
      // 首次启动（无任何预设）时植入内置默认预设，保证角色描述/世界书等 marker 提示词开箱即可进入上下文
      if (this.presets.length === 0) {
        this.presets = [createDefaultPreset()]
        this._persist()
      }
      try {
        // activePresetId 之前只存在内存里，刷新页面/重开小程序后就丢失，导致默认预设形同虚设。
        // 现在持久化到 storage，并在加载时校验对应预设是否还存在（可能已被删除）。
        const savedActiveId = storage.get(ACTIVE_KEY())
        this.activePresetId = (savedActiveId && this.presets.some(p => p.id === savedActiveId)) ? savedActiveId : DEFAULT_PRESET_ID
      } catch (e) {
        console.warn('[presetStore] 加载默认预设 id 失败:', e)
        this.activePresetId = DEFAULT_PRESET_ID
      }
    },

    get(id: string): Preset | null {
      return this.presets.find(p => p.id === id) || null
    },

    save(preset: Preset) {
      const idx = this.presets.findIndex(p => p.id === preset.id)
      if (idx >= 0) {
        this.presets[idx] = preset
      } else {
        this.presets.push(preset)
      }
      this._persist()
    },

    remove(id: string) {
      this.presets = this.presets.filter(p => p.id !== id)
      if (this.activePresetId === id) this.activePresetId = null
      this._persist()
    },

    setActive(id: string) {
      this.activePresetId = id
      try {
        storage.set(ACTIVE_KEY(), id)
      } catch (e) {
        console.warn('[presetStore] 持久化默认预设 id 失败:', e)
      }
    },

    _persist() {
      try {
        storage.set(STORAGE_KEY(), this.presets)
      } catch (e) {
        console.warn('[presetStore] 持久化失败:', e)
      }
    }
  }
})