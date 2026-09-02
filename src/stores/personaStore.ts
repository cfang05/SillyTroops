// src/stores/personaStore.ts
// Persona（用户角色，对应酒馆 Personas）状态包装，包装 utils/account/personaManager.js

import { defineStore } from 'pinia'
// @ts-ignore
import personaManager from '../utils/account/personaManager.js'
import type { TrpgProfile } from '../types/character'

export interface Persona {
  id: string
  name: string
  avatar: string
  description: string
  /** TRPG 数值档案（仅当某卡开启 stats 时才需要填） */
  trpgProfile?: TrpgProfile | null
  createdAt: number
  updatedAt: number
}

export const usePersonaStore = defineStore('persona', {
  state: () => ({
    personas: [] as Persona[],
    activePersonaId: null as string | null
  }),

  getters: {
    activePersona: (state) =>
      state.personas.find(p => p.id === state.activePersonaId) || null
  },

  actions: {
    load() {
      this.personas = personaManager.getAll()
      this.activePersonaId = personaManager.getActiveId()
    },

    create(data: { name: string; avatar?: string; description?: string; trpgProfile?: TrpgProfile }): string {
      const id = personaManager.create(data)
      this.load()
      return id
    },

    update(id: string, updates: Partial<Persona>) {
      personaManager.update(id, updates)
      this.load()
    },

    remove(id: string) {
      personaManager.remove(id)
      this.load()
    },

    setActive(id: string) {
      personaManager.setActive(id)
      this.activePersonaId = id
    }
  }
})