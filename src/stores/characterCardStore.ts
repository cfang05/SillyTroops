// src/stores/characterCardStore.ts
// AI 角色卡（Character Card）状态管理，与 TRPG 数值档案（utils/persona/trpgProfile.js）完全独立
// 包装 utils/character_card/characterCardManager.js

import { defineStore } from 'pinia'
import characterCardManager from '../utils/character_card/characterCardManager.js'
// @ts-ignore
import poolImport from '../utils/character_card/poolImport.js'
// @ts-ignore
import { scopedKey } from '../utils/account/userScope.js'
import type { CharacterV2Data, LorebookEntry } from '../types/character'

export interface CharacterCardRecord extends CharacterV2Data {
  id: string
  createdAt: number
  updatedAt: number
  /** 来自卡池时记录来源卡池卡片的 id（"是否已导入卡库"的判定依据） */
  sourceCardId?: string
  /** 来自卡池时的导入时间戳（「新导入」标识保持 24 小时） */
  importedFromPoolAt?: number
}

// 模块级单例锁：无论 loadAll() 被多少个页面并发调用多少次，
// 内置角色卡的自动导入逻辑只会真正执行一次（Promise 复用而非重复触发），
// 避免多个页面同时 fetch+createCard 导致 characterCardManager 底层
// 列表存储（uni.setStorageSync）出现并发写竞态，互相覆盖导致丢卡。
let _builtinCardsLoadPromise: Promise<void> | null = null

/**
 * 「内置角色卡已导入」的持久化标记键（按账号隔离）。
 *
 * 修复的 Bug：刷新页面时内置角色卡（beth / DM_v2）被反复导入，卡池里越刷越多。
 * 标记里带**版本号**：只有版本与 builtinAssets.BUILTIN_ASSETS_VERSION 一致、
 * 且清单里的卡都在时，才跳过导入检查；清单更新时版本 +1 即自动失效重查。
 */
function _builtinMarkerKey(): string { return scopedKey('builtin_cards_imported') }

/** 读标记；读不到/格式不对都当"没有标记"处理（下次老实检查一遍） */
function _readBuiltinMarker(): { version: number; keys: string[] } | null {
  try {
    const raw = uni.getStorageSync(_builtinMarkerKey())
    if (!raw || typeof raw !== 'object') return null
    const keys = Array.isArray((raw as any).keys) ? (raw as any).keys.map((k: any) => String(k)) : []
    return { version: Number((raw as any).version) || 0, keys }
  } catch (e) {
    return null
  }
}

/** 写标记。失败不影响本次结果（只是下次多检查一遍），所以静默 */
function _writeBuiltinMarker(version: number, keys: string[]) {
  try {
    uni.setStorageSync(_builtinMarkerKey(), { version, keys, at: Date.now() })
  } catch (e) {
    console.warn('[characterCardStore] 内置卡导入标记写入失败（下次会重新检查）:', e)
  }
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

      // 自动加载内置角色卡（如果尚未导入），全局单例保证不会并发重复导入。
      // ⚠️ 刷新的第一帧 IndexedDB 可能还没 hydrate 完，上面这次同步读会拿到空列表；
      // _loadBuiltinCards 会在 hydrate 完成后把 this.cards 重新读一遍（见该方法内注释）。
      this._loadBuiltinCards()
    },

    /**
     * 等「hydrate + 内置卡检查」全部就绪，然后刷新列表。
     *
     * 页面在**刷新后的第一帧**就要用真实卡列表时（会话页计数、新建对话页默认选中卡）
     * 需要 await 它 —— 否则会先看到 0 张卡，等下一次 loadAll 才补上。
     */
    async ensureLoaded(): Promise<void> {
      await this._loadBuiltinCards()
      this.cards = characterCardManager.getAllCards() as CharacterCardRecord[]
      this.activeCardId = characterCardManager.getActiveCard()
    },

    /**
     * 从卡池导入一张卡（供 CardDetail 调用）。
     *
     * 会同时打上两个来自卡池的标记：
     *   · sourceCardId        → "这张卡池卡片已经导入过"，用来把「导入卡片」变成「已导入卡库」
     *   · importedFromPoolAt  → 导入时间，用来在角色卡库/选择角色卡页显示「新导入」24 小时
     *
     * @param {{data: CharacterV2Data}} characterV2
     * @param {LorebookEntry[]} lorebookEntries
     * @param {string} sourceCardId 卡池卡片 id
     * @returns {string} 本地角色卡 id
     */
    importFromPool(characterV2: { data: CharacterV2Data }, lorebookEntries: LorebookEntry[], sourceCardId: string): string {
      const id = characterCardManager.createCard(
        Object.assign({}, characterV2.data, {
          sourceCardId: String(sourceCardId || ''),
          importedFromPoolAt: Date.now()
        }),
        lorebookEntries
      )
      this.loadAll()
      return id
    },

    /**
     * 某张卡池卡片是否已经导入过本地卡库。
     * 直接扫全量卡片（不是 this.cards）—— this.cards 只在 loadAll 后才是全量，
     * 而详情弹窗可能在卡池页（没调过 loadAll）里打开。
     */
    isImportedFromPool(sourceCardId: string): boolean {
      if (!sourceCardId) return false
      const all = characterCardManager.getAllCards() as CharacterCardRecord[]
      return !!poolImport.findImportedCard(all, sourceCardId)
    },

    /** 某张本地角色卡是否是"24 小时内从卡池导入"的（页面据此显示「新导入」标识） */
    isNewImport(card: CharacterCardRecord): boolean {
      return poolImport.isNewImport(card)
    },

    /**
     * 给"从卡池导入但当时没打标记"的历史卡片补上标记（幂等）。
     *
     * 背景：sourceCardId / importedFromPoolAt 是本功能新增的字段，
     * 用户在这之前从卡池导入过的卡片没有这两个字段 → 打开卡池详情时
     * 「导入卡片」仍然是可点的（会重复导入同一张卡）。
     *
     * 匹配方式：卡池卡片与角色卡的**名字相同**，且该卡池卡片的 id 还没被任何本地卡片占用。
     * 用名字匹配是这里唯一可行的办法（历史数据没存 id），因此：
     *   · 名字取 trim 后精确比较，不做模糊匹配
     *   · 每张卡池卡片只认领一张本地卡（避免重名卡被批量标记）
     *   · 认领时间用卡片自身的 createdAt（近似"当时导入的时间"），
     *     所以老卡片不会被误显示成「新导入」
     *
     * @param {Array<{id:string,name:string}>} poolCards 卡池清单
     */
    reconcilePoolImports(poolCards: Array<{ id: string; name?: string }>): void {
      if (!Array.isArray(poolCards) || !poolCards.length) return
      const all = characterCardManager.getAllCards() as CharacterCardRecord[]
      if (!all.length) return

      const claimed = new Set(all.map((c) => String((c as any).sourceCardId || '')).filter(Boolean))
      let changed = 0
      for (const poolCard of poolCards) {
        const poolId = String(poolCard && poolCard.id || '')
        const poolName = String(poolCard && poolCard.name || '').trim()
        if (!poolId || !poolName || claimed.has(poolId)) continue
        const hit = all.find((c) =>
          !String((c as any).sourceCardId || '') && String(c.name || '').trim() === poolName
        )
        if (!hit) continue
        characterCardManager.updateCard(hit.id, {
          sourceCardId: poolId,
          // 用原 createdAt：既反映"当时导入"，又不会让老卡突然变成「新导入」
          importedFromPoolAt: Number(hit.createdAt) || Date.now()
        } as any)
        claimed.add(poolId)
        changed++
      }
      if (changed) {
        console.log('[characterCardStore] 已为 ' + changed + ' 张历史卡池导入的卡片补上来源标记')
        this.loadAll()
      }
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
     *
     *  为什么"缺哪张就补哪张"：不再用"有任意一张内置卡就整体跳过"，避免此前并发覆盖 bug
     *  导致的部分导入残留状态，让后续启动时把剩余缺失的内置卡补齐。
     *  判重用 extensions.builtinKey（稳定的文件标识符，如 'beth'/'DM_v2'），而不是角色卡里
     *  解析出来的显示名字（显示名字来自 PNG 元数据，与文件名完全不同）。
     *
     *  ⚠️ 修复的 Bug（刷新页面重复导入内置卡）：
     *  判重原本直接依赖 this.cards，而 loadAll() 是同步的 —— 刷新后的第一帧 IndexedDB 还没
     *  hydrate，同步读会回落到本地存储（迁移后已被清空）拿到 **空列表**，于是每次都判定
     *  "两张内置卡都缺失" → 重复导入。现在改为：先 await ensureReady() 再重新读全量卡列表，
     *  外加一个带版本号的持久化标记（见 _builtinMarkerKey），双重保险。
     */
    _loadBuiltinCards(): Promise<void> {
      if (_builtinCardsLoadPromise) return _builtinCardsLoadPromise

      _builtinCardsLoadPromise = (async () => {
        // #ifdef H5
        try {
          const { getBuiltinCharacterList, loadBuiltinCharacters, BUILTIN_ASSETS_VERSION } =
            await import('../services/builtinAssets')
          const manifest = getBuiltinCharacterList()
          const manifestKeys = manifest.map(m => m.name)

          // ① 必须等 hydrate 完成再判重（见方法头注释）。之后重新读一次全量列表，
          //    既让判重拿到真实数据，也顺手把 this.cards 从"刷新首帧的空列表"修正过来。
          await characterCardManager.ensureReady()
          this.cards = characterCardManager.getAllCards() as CharacterCardRecord[]
          this.activeCardId = characterCardManager.getActiveCard()

          // ② 自愈去重：历史上已经被重复导入出来的同 key 卡片，只保留最早的那一张
          this._dedupeBuiltinCards(manifestKeys)

          const existingKeys = new Set(
            this.cards
              .map(c => c.extensions && (c.extensions as any).builtinKey)
              .filter(Boolean)
          )

          // ③ 版本一致 + 清单齐全 → 直接跳过（连 PNG 都不用 fetch，省流量省时间）
          const marker = _readBuiltinMarker()
          const allPresent = manifestKeys.every(k => existingKeys.has(k))
          if (marker && marker.version === BUILTIN_ASSETS_VERSION && allPresent) {
            console.log('[characterCardStore] 内置角色卡已导入且版本一致，跳过检查')
            return
          }

          const missing = manifest.filter(m => !existingKeys.has(m.name))
          if (missing.length === 0) {
            _writeBuiltinMarker(BUILTIN_ASSETS_VERSION, manifestKeys)
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

          // ④ 只有确认清单齐全才写标记：某张卡 fetch/落盘失败时标记不写，
          //    下次进页面还能再试（否则会把"没导成功"永久记成"已导入"）。
          const keysNow = new Set(
            this.cards
              .map(c => c.extensions && (c.extensions as any).builtinKey)
              .filter(Boolean)
          )
          if (manifestKeys.every(k => keysNow.has(k))) {
            _writeBuiltinMarker(BUILTIN_ASSETS_VERSION, manifestKeys)
          }
        } catch (e) {
          console.warn('[characterCardStore] 内置角色卡加载失败:', e)
        }
        // #endif
      })()

      return _builtinCardsLoadPromise
    },

    /**
     * 清理**重复导入**出来的内置卡（同一个 builtinKey 只留最早的一张）。
     *
     * 为什么需要：在修好判重之前，每次刷新都会多出两张 [内置] 卡，这些脏数据不会自己消失。
     * 保留 createdAt 最早的那张（最接近"原始导入"），删除其余重复项；被删掉的若是当前激活卡，
     * 由 characterCardManager.deleteCard 顺带清掉激活标记。
     *
     * @param manifestKeys 内置清单里的 key（只处理这些，用户自己导入的同名卡不动）
     * @returns 删除的重复卡数量
     */
    _dedupeBuiltinCards(manifestKeys: string[]): number {
      const byKey = new Map<string, CharacterCardRecord[]>()
      for (const c of this.cards) {
        const key = c.extensions && (c.extensions as any).builtinKey
        if (!key || manifestKeys.indexOf(String(key)) === -1) continue
        const list = byKey.get(String(key)) || []
        list.push(c)
        byKey.set(String(key), list)
      }

      let removed = 0
      byKey.forEach((list, key) => {
        if (list.length < 2) return
        list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
        for (const dup of list.slice(1)) {
          try {
            characterCardManager.deleteCard(dup.id)
            removed++
          } catch (e) {
            console.warn('[characterCardStore] 删除重复内置卡失败:', dup.id, e)
          }
        }
        console.log(`[characterCardStore] 内置卡 ${key} 有 ${list.length} 张重复，已清理 ${list.length - 1} 张`)
      })

      if (removed > 0) {
        this.cards = characterCardManager.getAllCards() as CharacterCardRecord[]
        this.activeCardId = characterCardManager.getActiveCard()
      }
      return removed
    }
  }
})