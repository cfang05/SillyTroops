// src/stores/moduleStore.ts
// 功能模块开关 —— 合并后数据源 = 当前角色卡的 extensions.trpg.modules（默认全关）
// 不再是全局持久化配置；toggle / applyPreset 写回 characterCardStore.update（深合并）。
//
// 字段（与 types/character.ts 的 TrpgModules 对齐）：
//   intentDetection / combat / inventory / characterStatus / dicePanel / stats / adventure

import { defineStore } from 'pinia'
import { useCharacterCardStore } from './characterCardStore'
import { DEFAULT_TRPG_MODULES, type TrpgModules } from '../types/character'

export type ModuleKey = keyof TrpgModules

export const useModuleStore = defineStore('module', {
  state: () => ({}),

  getters: {
    /** 当前角色卡的 TRPG 模块开关（默认全关）；无卡时返回默认全关 */
    modules(): TrpgModules {
      const cardStore = useCharacterCardStore()
      const card = cardStore.activeCard
      return (card?.extensions?.trpg?.modules) || DEFAULT_TRPG_MODULES
    }
  },

  actions: {
    /** 数据源已是卡片，保留空实现以兼容旧调用方 */
    load() {},

    toggle(key: ModuleKey) {
      const cardStore = useCharacterCardStore()
      const card = cardStore.activeCard
      if (!card) return
      const modules: TrpgModules = { ...(card.extensions?.trpg?.modules || DEFAULT_TRPG_MODULES) }
      modules[key] = !modules[key]
      try {
        cardStore.update(card.id, { extensions: { trpg: { modules } } })
      } catch (e: any) {
        uni.showToast({ title: e?.message || '模块设置保存失败', icon: 'none' })
      }
    },

    applyPreset(profile: 'trpg' | 'chat') {
      const cardStore = useCharacterCardStore()
      const card = cardStore.activeCard
      if (!card) return
      const modules: TrpgModules = profile === 'trpg'
        ? { intentDetection: true, combat: true, inventory: true, characterStatus: true, dicePanel: true, stats: true, adventure: true }
        : { ...DEFAULT_TRPG_MODULES }
      try {
        cardStore.update(card.id, { extensions: { trpg: { modules } } })
      } catch (e: any) {
        uni.showToast({ title: e?.message || '模块设置保存失败', icon: 'none' })
      }
    }
  }
})
