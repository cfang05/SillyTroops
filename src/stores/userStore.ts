// src/stores/userStore.ts
// 登录用户状态包装，包装 utils/account/userManager.js

import { defineStore } from 'pinia'
// @ts-ignore
import userManager from '../utils/account/userManager.js'

export interface UserInfo {
  id: string
  username: string
  nickname: string
  avatar: string
  isAdmin: boolean
  isTest: boolean
  createdAt: number
}

export const useUserStore = defineStore('user', {
  state: () => ({
    currentUser: null as UserInfo | null
  }),

  getters: {
    isLoggedIn: (state) => !!state.currentUser,
    isAdmin: (state) => !!(state.currentUser && state.currentUser.isAdmin),
    isTestAccount: (state) => !!(state.currentUser && state.currentUser.isTest)
  },

  actions: {
    /** 应用启动 / 页面 onShow 时调用，同步当前登录态 */
    syncCurrentUser() {
      this.currentUser = userManager.getCurrentUser()
    },

    login(username: string, password: string): { success: boolean; message?: string } {
      const res = userManager.login(username, password)
      if (res.success) this.currentUser = res.user
      return res
    },

    register(username: string, password: string, nickname?: string): { success: boolean; message?: string } {
      return userManager.register(username, password, nickname)
    },

    logout() {
      userManager.logout()
      this.currentUser = null
    },

    updateProfile(updates: { nickname?: string; avatar?: string }) {
      if (!this.currentUser) return
      userManager.updateProfile(this.currentUser.id, updates)
      this.syncCurrentUser()
    }
  }
})