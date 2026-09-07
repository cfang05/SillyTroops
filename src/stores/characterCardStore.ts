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

// 模块级单例锁：无论 loadAll() 被多少个页面并发调用多少次，
// 内置角色卡的自动导入逻辑只会真正执行一次（Promise 复用而非重复触发），
// 避免多个页面同时 fetch+createCard 导致 characterCardManager 底层
// 列表存储（uni.setStorageSync）出现并发写竞态，互相覆盖导致丢卡。
let _builtinCardsLoadPromise: Promise<void> | null = null

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

      // 自动加载内置角色卡（如果尚未导入），全局单例保证不会并发重复导入
      this._loadBuiltinCards()
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
    },

    /** 自动加载内置角色卡（仅H5端；用全局单例 Promise 确保多页面并发调用时只真正执行一次）
     *  按"缺哪张就补哪张"的逐项比对，而不是"有任意一张内置卡就整体跳过"——
     *  避免此前并发覆盖 bug 导致的部分导入残留状态，让后续启动时把剩余缺失的内置卡补齐。
     *  判重用 extensions.builtinKey（稳定的文件标识符，如 'beth'/'DM_v2'/'xia'），
     *  而不是比较角色卡里解析出来的显示名字（显示名字来自 PNG 元数据，与文件名完全不同，
     *  之前用"[内置] + manifest.name"去匹配"[内置] + 角色卡里的真实name"永远匹配不上，
     *  导致每次启动都判定为全部缺失、重复导入）。 */
    _loadBuiltinCards(): Promise<void> {
      if (_builtinCardsLoadPromise) return _builtinCardsLoadPromise

      _builtinCardsLoadPromise = (async () => {
        // #ifdef H5
        try {
          const { getBuiltinCharacterList, loadBuiltinCharacters } = await import('../services/builtinAssets')
          const manifest = getBuiltinCharacterList()

          // 逐项比对：哪些内置卡（按 extensions.builtinKey 精确匹配）已经存在，只补缺失的部分
          const existingKeys = new Set(
            this.cards
              .map(c => c.extensions && (c.extensions as any).builtinKey)
              .filter(Boolean)
          )
          const missing = manifest.filter(m => !existingKeys.has(m.name))
          if (missing.length === 0) {
            console.log('[characterCardStore] 内置角色卡已全部存在，无需补充')
            return
          }
          console.log(`[characterCardStore] 检测到 ${missing.length}/${manifest.length} 张内置角色卡缺失，开始补充:`, missing.map(m => m.name))

          const results = await loadBuiltinCharacters()

          let loadedCount = 0
          for (const item of results) {
            // 只导入本轮判定为缺失的项，避免重复导入已存在的卡
            if (!missing.some(m => m.name === item.name)) continue

            if (!item.result || item.error) {
              console.warn(`[characterCardStore] 内置角色卡 ${item.name} 加载失败:`, item.error)
              continue
            }

            const cardData = {
              ...item.result.character.data,
              name: '[内置] ' + item.result.character.data.name,
              extensions: {
                ...(item.result.character.data.extensions || {}),
                builtinKey: item.name // 稳定标记，供下次判重使用
              }
            }

            try {
              characterCardManager.createCard(cardData, item.result.lorebookEntries || [])
              loadedCount++
              console.log(`[characterCardStore] 内置角色卡 ${item.name} 导入成功`)
            } catch (e) {
              console.error(`[characterCardStore] 内置卡 ${item.name} 导入失败（可能是存储配额不足）:`, e)
            }
          }

          if (loadedCount > 0) {
            this.cards = characterCardManager.getAllCards() as CharacterCardRecord[]
            console.log(`[characterCardStore] 本轮已补充 ${loadedCount} 张内置角色卡，当前共 ${this.cards.length} 张卡`)
          }
        } catch (e) {
          console.warn('[characterCardStore] 内置角色卡加载失败:', e)
        }
        // #endif
      })()

      return _builtinCardsLoadPromise
    }
  }
})