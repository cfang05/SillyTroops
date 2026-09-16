// src/services/promptInfoStore.ts
// 「上下文构成快照」的存取（P3.3 / P3.4 / D14）
//
// 为什么要持久化：快照是在**聊天页**产生、却要在**设置页**的弹窗里查看（D14 定的入口形态），
// 两者是不同页面，只放内存会丢。
//
// 存储位置：IndexedDB（H5）。对齐酒馆把"提示词分项"存 localforage(SillyTavern_Prompts) 的做法
// （referencecode/public/scripts/itemized-prompts.js:15）。
// 小程序端没有 IndexedDB → 自动退化为内存（当次会话可见，够用）。

import { IndexedDbAdapter } from '../utils/storage/adapter'
import type { PromptInfo } from '../engine/PromptBuilder'

/** 每个对话保留最近多少次快照（避免无限增长） */
const MAX_SNAPSHOTS = 20
const KEY_PREFIX = 'promptinfo:'

export interface StoredPromptInfo extends PromptInfo {
  chatId: string
}

let _adapter: IndexedDbAdapter | null = null
let _adapterReady = false

/** 内存兜底（小程序端，或 IndexedDB 不可用/打开失败时） */
const _memory = new Map<string, StoredPromptInfo[]>()

function _getAdapter(): IndexedDbAdapter | null {
  if (_adapterReady) return _adapter
  _adapterReady = true
  try {
    if (IndexedDbAdapter.isSupported()) {
      _adapter = new IndexedDbAdapter('sillytroops_prompts')
    }
  } catch (e) {
    console.warn('[promptInfoStore] IndexedDB 不可用，退化为内存存储:', e)
    _adapter = null
  }
  return _adapter
}

function _key(chatId: string) {
  return KEY_PREFIX + (chatId || 'unknown')
}

/** 保存一次快照（最新的排在最前） */
export async function savePromptInfo(chatId: string, info: PromptInfo): Promise<void> {
  const id = chatId || 'unknown'
  const snapshot: StoredPromptInfo = { ...info, chatId: id }
  const adapter = _getAdapter()
  if (!adapter) {
    const list = _memory.get(id) || []
    _memory.set(id, [snapshot, ...list].slice(0, MAX_SNAPSHOTS))
    return
  }
  try {
    const list = (await adapter.get<StoredPromptInfo[]>(_key(id))) || []
    const next = [snapshot, ...list].slice(0, MAX_SNAPSHOTS)
    await adapter.set(_key(id), next)
  } catch (e) {
    console.warn('[promptInfoStore] 写入失败，退化为内存:', e)
    const list = _memory.get(id) || []
    _memory.set(id, [snapshot, ...list].slice(0, MAX_SNAPSHOTS))
  }
}

/** 读取某个对话的快照列表（最新在前） */
export async function listPromptInfo(chatId: string): Promise<StoredPromptInfo[]> {
  const id = chatId || 'unknown'
  const adapter = _getAdapter()
  if (adapter) {
    try {
      const list = await adapter.get<StoredPromptInfo[]>(_key(id))
      if (Array.isArray(list) && list.length) return list
    } catch (e) {
      console.warn('[promptInfoStore] 读取失败，回退内存:', e)
    }
  }
  return _memory.get(id) || []
}

/** 清空某个对话的快照 */
export async function clearPromptInfo(chatId: string): Promise<void> {
  const id = chatId || 'unknown'
  _memory.delete(id)
  const adapter = _getAdapter()
  if (adapter) {
    try { await adapter.remove(_key(id)) } catch (e) { /* ignore */ }
  }
}

/**
 * 读取**所有对话**的最近快照（按时间倒序）
 *
 * 用途：设置页的「上下文详情」入口不一定知道当前对话是哪一个（也可能刚换过角色卡），
 * 直接看"最近几次请求"更实用。
 */
export async function listRecentPromptInfo(limit = 20): Promise<StoredPromptInfo[]> {
  const adapter = _getAdapter()
  const all: StoredPromptInfo[] = []

  if (adapter) {
    try {
      const keys = await adapter.keys()
      for (const k of keys) {
        if (!k.startsWith(KEY_PREFIX)) continue
        const list = await adapter.get<StoredPromptInfo[]>(k)
        if (Array.isArray(list)) all.push(...list)
      }
    } catch (e) {
      console.warn('[promptInfoStore] 汇总读取失败，回退内存:', e)
    }
  }

  if (!all.length) {
    _memory.forEach(list => all.push(...list))
  }

  return all
    .filter(s => s && typeof s.createdAt === 'number')
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
}

export default { savePromptInfo, listPromptInfo, listRecentPromptInfo, clearPromptInfo }
