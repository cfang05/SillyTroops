// src/stores/runtimeStore.ts
// 当前对话运行时状态（响应式）。
// 统一说明：场景/数值等 TRPG 运行时状态已由会话 conversation.trpgState 承担（chat.vue 的 trpgState ref），
// 本 store 不再桥接旧 stateManager（已删除），只保留对话流本身的响应式状态。

import { defineStore } from 'pinia'
import type { ChatMessage } from '../types/message'

export const useRuntimeStore = defineStore('runtime', {
  state: () => ({
    currentStoryId: '' as string,
    currentCharacterId: '' as string,
    currentPresetId: '' as string,
    messages: [] as ChatMessage[],
    isLoading: false as boolean,
    isStreaming: false as boolean,
    /** 当前对话局部变量（随对话存档，不跨对话持久化） */
    localVariables: {} as Record<string, string>
  }),

  actions: {
    setMessages(messages: ChatMessage[]) {
      this.messages = messages
    },

    appendMessage(message: ChatMessage) {
      this.messages.push(message)
    },

    setLoading(value: boolean) {
      this.isLoading = value
    },

    setLocalVariable(name: string, value: string) {
      this.localVariables[name] = value
    },

    getLocalVariable(name: string): string {
      return this.localVariables[name] ?? ''
    },

    resetSession() {
      this.messages = []
      this.localVariables = {}
      this.isLoading = false
      this.isStreaming = false
    }
  }
})
