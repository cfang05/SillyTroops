// src/stores/characterCardStore.ts
// AI 角色卡（Character Card）状态管理，与 characterStore（玩家 Role）完全独立
// 包装 utils/character_card/characterCardManager.js

import { defineStore } from 'pinia'
import characterCardManager from '../utils/character_card/characterCardManager.js'
import type { CharacterV2Data, LorebookEntry } from '../types/character'

export interface CharacterCardRecord extends CharacterV2Data {
  id: string
  createdAt: number
  updatedAt: number
}

export const useCharacterCardStore = defineStore('characterCard', {
  state: () => ({
    cards: [] as CharacterCardRecord[],
    activeCardId: null as string | null
  }),

  getters: {
    hasCards: (state) => state.cards.length > 0,
    activeCard: (state) =>
      state.cards.find(c => c.id === state.activeCardId) || null
  },

  actions: {
    loadAll() {
      this.cards = characterCardManager.getAllCards() as CharacterCardRecord[]
      this.activeCardId = characterCardManager.getActiveCard()
    },

    getById(id: string): CharacterCardRecord | null {
      // 优先从响应式缓存取（保证 update→loadAll 后 chat 页的计算属性能立即刷新），
      // 缓存未命中时回退到存储直读（兼容尚未 loadAll 的调用方）
      const fromState = this.cards.find(c => c.id === id)
      if (fromState) return fromState
      return characterCardManager.getCard(id) as CharacterCardRecord | null
    },

    getLorebook(id: string): LorebookEntry[] {
      return characterCardManager.getCardLorebook(id) as LorebookEntry[]
    },

    setLorebook(id: string, entries: LorebookEntry[]) {
      characterCardManager.setCardLorebook(id, entries)
    },

    /** 按键直查世界书条目（战斗 getNPCDef / 场景 / 道具等） */
    getLorebookEntryByKey(id: string, key: string): LorebookEntry | null {
      return characterCardManager.getLorebookEntryByKey(id, key)
    },

    /**
     * 导入角色卡（CharacterV2 + 世界书条目），存入独立的角色卡存储
     */
    importCard(characterV2: { data: CharacterV2Data }, lorebookEntries: LorebookEntry[]): string {
      const id = characterCardManager.createCard(characterV2.data, lorebookEntries)
      this.loadAll()
      return id
    },

    update(id: string, updates: Partial<CharacterV2Data>) {
      characterCardManager.updateCard(id, updates)
      this.loadAll()
    },

    remove(id: string) {
      characterCardManager.deleteCard(id)
      this.loadAll()
    },

    setActive(id: string) {
      characterCardManager.setActiveCard(id)
      this.activeCardId = id
    }
  }
})