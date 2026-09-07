// src/stores/userStore.ts
// 登录用户状态包装，包装 utils/account/userManager.js

import { defineStore } from 'pinia'
// @ts-ignore
import userManager from '../utils/account/userManager.js'
// @ts-ignore
import storage from '../utils/storage.js'

export interface UserInfo {
  id: string
  username: string
  nickname: string
  avatar: string
  isAdmin: boolean
  isTest: boolean
  createdAt: number
}

// 等级称号映射表（1-20级）
const LEVEL_NAMES: Record<number, string> = {
  1: '新手旅人',
  2: '逐光者',
  3: '窥秘人',
  4: '守夜人',
  5: '追索者',
  6: '秘术学徒',
  7: '命运之眼',
  8: '序列守望者',
  9: '星象师',
  10: '诡秘侍者',
  11: '牧羊人',
  12: '断罪者',
  13: '窃梦者',
  14: '命运之蛇',
  15: '旅团长',
  16: '时之虫',
  17: '奇迹师',
  18: '诡秘之主',
  19: '命运编织者',
  20: '旧日支配者'
}

// 计算升级所需经验值
function getXpToNextLevel(level: number): number {
  return Math.floor(100 * (1 + level * 0.15))
}

// 根据等级返回称号
function getLevelName(level: number): string {
  if (level < 1) return '未启程者'
  if (level > 20) return '不可名状者'
  return LEVEL_NAMES[level] || '旅人'
}

export const useUserStore = defineStore('user', {
  state: () => ({
    currentUser: null as UserInfo | null,
    level: 1,
    xp: 0
  }),

  getters: {
    isLoggedIn: (state) => !!state.currentUser,
    isAdmin: (state) => !!(state.currentUser && state.currentUser.isAdmin),
    isTestAccount: (state) => !!(state.currentUser && state.currentUser.isTest),
    
    // 经验值系统 getters
    xpToNextLevel: (state) => getXpToNextLevel(state.level),
    levelName: (state) => getLevelName(state.level),
    progressPercent: (state) => {
      const needed = getXpToNextLevel(state.level)
      return Math.min(100, Math.floor((state.xp / needed) * 100))
    }
  },

  actions: {
    /** 应用启动 / 页面 onShow 时调用，同步当前登录态 */
    syncCurrentUser() {
      this.currentUser = userManager.getCurrentUser()
      this.loadLevelData()
    },

    login(username: string, password: string): { success: boolean; message?: string } {
      const res = userManager.login(username, password)
      if (res.success) {
        this.currentUser = res.user
        this.loadLevelData()
      }
      return res
    },

    register(username: string, password: string, nickname?: string): { success: boolean; message?: string } {
      return userManager.register(username, password, nickname)
    },

    logout() {
      userManager.logout()
      this.currentUser = null
      this.level = 1
      this.xp = 0
    },

    updateProfile(updates: { nickname?: string; avatar?: string }) {
      if (!this.currentUser) return
      userManager.updateProfile(this.currentUser.id, updates)
      this.syncCurrentUser()
    },

    // ========== 等级/经验值系统 ==========
    
    /** 从 localStorage 加载等级数据 */
    loadLevelData() {
      try {
        const userId = this.currentUser?.id
        if (!userId) return
        
        const key = `user_level_${userId}`
        const data = storage.get(key)
        
        if (data) {
          this.level = data.level || 1
          this.xp = data.xp || 0
        } else {
          // 首次加载，初始化为 1 级 0 经验
          this.level = 1
          this.xp = 0
          this.saveLevelData()
        }
      } catch (error) {
        console.error('[UserStore] 加载等级数据失败:', error)
        this.level = 1
        this.xp = 0
      }
    },

    /** 保存等级数据到 localStorage */
    saveLevelData() {
      try {
        const userId = this.currentUser?.id
        if (!userId) return
        
        const key = `user_level_${userId}`
        storage.set(key, {
          level: this.level,
          xp: this.xp,
          updatedAt: Date.now()
        })
      } catch (error) {
        console.error('[UserStore] 保存等级数据失败:', error)
      }
    },

    /** 增加经验值，自动处理升级逻辑 */
    addXp(amount: number) {
      if (!this.currentUser) {
        console.warn('[UserStore] 未登录，无法增加经验值')
        return
      }

      this.xp += amount
      console.log(`[UserStore] +${amount} XP，当前经验: ${this.xp}`)

      // 循环判断是否升级
      let levelUps = 0
      while (this.xp >= getXpToNextLevel(this.level)) {
        const needed = getXpToNextLevel(this.level)
        this.xp -= needed
        this.level += 1
        levelUps++
        
        console.log(`🎉 升级！当前等级: ${this.level}，称号: ${getLevelName(this.level)}`)
      }

      // 保存到 localStorage
      this.saveLevelData()

      return levelUps
    }
  }
})

// 调试入口：暴露到 window 对象
if (typeof window !== 'undefined') {
  (window as any).__debug_addXp = (amount: number) => {
    const store = useUserStore()
    return store.addXp(amount)
  }
}