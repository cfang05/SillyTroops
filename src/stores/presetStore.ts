// src/stores/presetStore.ts
// 预设库状态管理（新建，无现有对应实现）
// Sprint 1.7

import { defineStore } from 'pinia'
// @ts-ignore
import { scopedKey } from '../utils/account/userScope.js'
import { createCachedStore } from '../utils/storage/cachedStore'
import type { Preset } from '../types/preset'
import { createSystemPreset, SYSTEM_PRESET_ID } from '../adapters/preset/defaultPreset'

function STORAGE_KEY() { return scopedKey('llm_presets') }
function ACTIVE_KEY() { return scopedKey('llm_active_preset_id') }

/**
 * P5.3：预设（用户导入的可能很大，含 1MB+ 的酒馆预设）改存 **IndexedDB**。
 * 对外仍是同步 API，调用点不变；迁移完成前读操作自动回落本地存储。
 */
const _store = createCachedStore({
  name: 'preset',
  match: (k: string) => k === STORAGE_KEY() || k === ACTIVE_KEY(),
  // D20 跨账号迁移：其他账号遗留的预设也要能认领（键名里本来就刻着 uid）
  uidOf: (k: string) => {
    const m = k.match(/^u_(.+)_llm_(?:presets|active_preset_id)$/)
    return m ? m[1] : null
  }
})

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
        this.presets = _store.get(STORAGE_KEY()) || []
      } catch (e) {
        console.warn('[presetStore] load 失败:', e)
        this.presets = []
      }
      // 「系统预设」（D19）：与「系统正侧」对称 —— 代码内置、默认选中、用户另选则替换、**不落盘**。
      // 1) 先清掉历史上可能被持久化的同名项（保证它永远是"干净的内置版本"，不会被改坏后无法恢复）；
      // 2) 每次启动都重新植入并排在最前，因此不需要持久化也能被 activePresetId 正确引用（id 固定）。
      this.presets = this.presets.filter(p => p && p.id !== SYSTEM_PRESET_ID)
      this.presets.unshift(createSystemPreset())

      // 注：内置预设的自动加载已按 D7/P4.7 移除（打包资源一并删除）。
      // 现在默认走代码内置的「系统预设」（见上方植入逻辑）。

      try {
        // activePresetId 之前只存在内存里，刷新页面/重开小程序后就丢失，导致默认预设形同虚设。
        // 现在持久化到 storage，并在加载时校验对应预设是否还存在（可能已被删除）。
        const savedActiveId = _store.get(ACTIVE_KEY())
        this.activePresetId = (savedActiveId && this.presets.some(p => p.id === savedActiveId)) ? savedActiveId : SYSTEM_PRESET_ID
      } catch (e) {
        console.warn('[presetStore] 加载默认预设 id 失败:', e)
        this.activePresetId = SYSTEM_PRESET_ID
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
      // 系统预设不可删除（D19）：它是默认项，删掉下次启动也会重新植入，
      // 不如直接拦住，避免用户以为"删掉了"。
      if (id === SYSTEM_PRESET_ID) return
      this.presets = this.presets.filter(p => p.id !== id)
      if (this.activePresetId === id) this.activePresetId = SYSTEM_PRESET_ID
      this._persist()
    },

    setActive(id: string) {
      this.activePresetId = id
      try {
        _store.set(ACTIVE_KEY(), id)
      } catch (e) {
        console.warn('[presetStore] 持久化默认预设 id 失败:', e)
      }
    },

    _persist() {
      try {
        // 「系统预设」不落盘（D19，与「系统正侧」一致）：它是代码内置的，
        // 每次启动都会重新植入，没必要占用本地存储。
        const persistable = this.presets.filter(p => p && p.id !== SYSTEM_PRESET_ID)
        _store.set(STORAGE_KEY(), persistable)
      } catch (e) {
        console.warn('[presetStore] 持久化失败:', e)
      }
    }
  }
})