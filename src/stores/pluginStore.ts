// src/stores/pluginStore.ts
// 渲染开关状态：控制 AI 回复中特殊标签是否渲染为交互组件
// Sprint 1.5

import { defineStore } from 'pinia'
import storage from '../utils/storage.js'
import { scopedKey } from '../utils/account/userScope.js'

// 渲染开关按用户隔离（原先是全局键 plugin_settings，A 用户改开关会影响 B 用户）。
// 迁移前的旧全局数据按既定决策作废/重置，各账号从默认值开始。
function storageKey() {
  return scopedKey('plugin_settings')
}

export interface RendererState {
  branch: boolean
  summary: boolean
  time: boolean
  /** 自定义 HTML 渲染，H5 默认关闭需用户手动开启；小程序端强制 false */
  html: boolean
  music: boolean
}

export const usePluginStore = defineStore('plugin', {
  state: () => ({
    renderers: {
      branch: true,
      summary: true,
      time: true,
      html: false,
      music: false
    } as RendererState
  }),

  actions: {
    load() {
      try {
        const saved = storage.get(storageKey())
        if (saved && saved.renderers) {
          Object.assign(this.renderers, saved.renderers)
        }
      } catch (e) {
        console.warn('[pluginStore] load 失败:', e)
      }
      // 小程序端强制禁用自定义 HTML 渲染（无 iframe/innerHTML 能力）
      // #ifdef MP-WEIXIN
      this.renderers.html = false
      // #endif
    },

    save() {
      try {
        storage.set(storageKey(), { renderers: this.renderers })
      } catch (e) {
        console.warn('[pluginStore] save 失败:', e)
      }
    },

    toggle(key: keyof RendererState) {
      // #ifdef MP-WEIXIN
      if (key === 'html') return
      // #endif
      this.renderers[key] = !this.renderers[key]
      this.save()
    }
  }
})