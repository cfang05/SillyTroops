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
  /**
   * 账号创建时间。
   *
   * ⚠️ 声明为可选：`userManager.getCurrentUser()` 的返回**并不保证带这个字段**
   * （老服务端的 /api/auth/me 不返回它），而它在全项目里也没有任何读取点
   * （仅此一处声明）。之前写成必填，导致 `this.currentUser = userManager.getCurrentUser()`
   * 一直报 TS2741 —— 那是**类型定义过严**，不是运行时 bug。
   */
  createdAt?: number
  // 等级/经验：服务端权威（跨设备同步 + 评论里显示他人等级要用）。
  // 老服务端不返回时为 undefined，此时以本地 user_level_{id} 缓存为准。
  level?: number
  xp?: number
}

// 等级称号映射表（1-20级）
//
// ⚠️ 这张表与 src/pages/cardpool/utils/level-names.js 里的 LEVEL_NAMES **必须一致**：
// 卡池评论列表用那份（纯展示，不依赖 pinia），这里这份供首页/经验条使用。
// 改称号时两处一起改。
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

    login(username: string, password: string): Promise<{ success: boolean; message?: string }> {
      // 账号已迁移到服务端：登录是异步网络请求（含老本地账号自动认领）
      return userManager.login(username, password).then((res: any) => {
        if (res.success) {
          this.currentUser = res.user
          this.loadLevelData()
        }
        return res
      })
    },

    register(username: string, password: string, nickname?: string): Promise<{ success: boolean; message?: string }> {
      return userManager.register(username, password, nickname)
    },

    logout() {
      userManager.logout()
      this.currentUser = null
      this.level = 1
      this.xp = 0
    },

    async updateProfile(updates: { nickname?: string; avatar?: string }) {
      if (!this.currentUser) return
      // 昵称走服务端（跨设备同步），头像暂只存本地
      await userManager.updateProfile(this.currentUser.id, updates)
      this.syncCurrentUser()
    },

    // ========== 等级/经验值系统 ==========
    
    /** 从 localStorage 加载等级数据 */
    loadLevelData() {
      try {
        const userId = this.currentUser?.id
        if (!userId) return

        const key = `user_level_${userId}`
        const local = storage.get(key)
        const localLevel = local && Number.isFinite(Number(local.level)) ? Number(local.level) : null
        const localXp = local && Number.isFinite(Number(local.xp)) ? Number(local.xp) : null

        // 服务端等级是权威（跨设备同步 + 评论里要显示他人等级），本地只是一份缓存。
        // serverLevel 为 null 表示老服务端没返回该字段 —— 这时完全按本地走，
        // 不能把它当成 0 级。
        const serverLevel = this.currentUser && this.currentUser.level !== undefined ? Number(this.currentUser.level) : null
        const serverXp = this.currentUser && this.currentUser.xp !== undefined ? Number(this.currentUser.xp) : null

        if (serverLevel !== null) {
          // 服务端已经知道这个账号的等级：以它为准
          this.level = serverLevel
          this.xp = serverXp === null ? 0 : serverXp
          // 本地缓存跟上，离线时用
          this.saveLevelData()
          return
        }

        if (localLevel !== null) {
          // 老服务端/首次迁移：本地有等级但服务端还不知道 → 采用本地并推上去
          this.level = localLevel
          this.xp = localXp === null ? 0 : localXp
          this.pushProgression()
          return
        }

        // 两边都没有：管理员沿用 15 级，普通账号从 1 级 0 经验开始；建号后立刻同步
        const isAdmin = !!userManager.isAdmin()
        this.level = isAdmin ? 15 : 1
        this.xp = 0
        this.saveLevelData()
        this.pushProgression()
      } catch (error) {
        console.error('[UserStore] 加载等级数据失败:', error)
        this.level = 1
        this.xp = 0
      }
    },

    /**
     * 把当前等级/经验同步到服务端（异步、失败不影响本地）。
     * 由 loadLevelData / addXp / 昵称变更后调用。
     */
    pushProgression() {
      if (!this.currentUser) return
      // 不 await：等级同步是后台动作，不该阻塞页面渲染或升级动画
      userManager.syncProgression({ level: this.level, xp: this.xp })
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

      // 保存到 localStorage（离线缓存）+ 同步到服务端（评论里要显示等级）
      this.saveLevelData()
      this.pushProgression()

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