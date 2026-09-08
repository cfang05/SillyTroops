// src/services/builtinAssets.ts
// 项目自带角色卡/预设/正侧加载器（不自动导入Store，用户在新建对话时主动选择）
// 文件来源：st_card / st_preset / st_regex 文件夹（编译时复制到 public/assets/）

import { importFromPng, type ImportResult } from '../adapters/character/CharacterImporter'
import { importFromSillyTavern, importRegexScripts } from '../adapters/preset/PresetImporter'
import type { Preset } from '../types/preset'
import type { RegexScript } from '../types/script'

// ══════════════════════════════════════════════════════════════
// 内置资源清单（手动维护，与 public/assets/ 下的文件保持同步）
// ══════════════════════════════════════════════════════════════

const BUILTIN_CHARACTERS = [
  { name: 'beth', file: '/assets/characters/beth.png' },
  { name: 'DM_v2', file: '/assets/characters/DM_v2.png' }
]

const BUILTIN_PRESETS = [
  { name: 'DSthinkerV4-0902', file: '/assets/presets/DSthinkerV4-0902.json' },
  { name: 'DSmamav1.8', file: '/assets/presets/DSmamav1.8.json' }
]

const BUILTIN_REGEX = [
  { name: 'regex-DSmama', file: '/assets/regex/regex-DSmama.json' }
]

// ══════════════════════════════════════════════════════════════
// 加载函数
// ══════════════════════════════════════════════════════════════

/**
 * 加载所有内置角色卡（不导入 Store，返回解析后的角色数据）
 */
export async function loadBuiltinCharacters(): Promise<Array<{ name: string; result: ImportResult | null; error?: string }>> {
  const results: Array<{ name: string; result: ImportResult | null; error?: string }> = []
  for (const item of BUILTIN_CHARACTERS) {
    try {
      // #ifdef H5
      const res = await fetch(item.file)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const file = new File([blob], item.name + '.png', { type: 'image/png' })
      const importResult: ImportResult = await importFromPng(file)
      results.push({ name: item.name, result: importResult })
      // #endif

      // #ifndef H5
      results.push({ name: item.name, result: null, error: '小程序端需手动导入' })
      // #endif
    } catch (e: any) {
      results.push({ name: item.name, result: null, error: e.message || String(e) })
    }
  }
  return results
}

/**
 * 加载所有内置预设（不导入 Store，返回解析后的预设数据）
 */
export async function loadBuiltinPresets(): Promise<Array<{ name: string; preset: Preset | null; error?: string }>> {
  const results: Array<{ name: string; preset: Preset | null; error?: string }> = []
  for (const item of BUILTIN_PRESETS) {
    try {
      // #ifdef H5
      const res = await fetch(item.file)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      const preset = importFromSillyTavern(json, item.name)
      results.push({ name: item.name, preset })
      // #endif

      // #ifndef H5
      results.push({ name: item.name, preset: null, error: '小程序端需手动导入' })
      // #endif
    } catch (e: any) {
      results.push({ name: item.name, preset: null, error: e.message || String(e) })
    }
  }
  return results
}

/**
 * 加载所有内置正侧（不导入 Store，返回解析后的正则脚本数组）
 * 注：单个正侧文件可能是酒馆导出的单个脚本对象，也可能是数组或 { regex_scripts: [...] } 结构，
 * 统一归一化为数组后再交给 importRegexScripts 转换 placement 编号。
 */
export async function loadBuiltinRegexPresets(): Promise<Array<{ name: string; scripts: RegexScript[] | null; error?: string }>> {
  const results: Array<{ name: string; scripts: RegexScript[] | null; error?: string }> = []
  for (const item of BUILTIN_REGEX) {
    try {
      // #ifdef H5
      const res = await fetch(item.file)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      const arr = Array.isArray(json)
        ? json
        : (Array.isArray(json?.regex_scripts) ? json.regex_scripts : [json])
      const scripts = importRegexScripts(arr)
      results.push({ name: item.name, scripts })
      // #endif

      // #ifndef H5
      results.push({ name: item.name, scripts: null, error: '小程序端需手动导入' })
      // #endif
    } catch (e: any) {
      results.push({ name: item.name, scripts: null, error: e.message || String(e) })
    }
  }
  return results
}

// ══════════════════════════════════════════════════════════════
// 获取内置资源清单（用于 UI 展示选择列表）
// ══════════════════════════════════════════════════════════════

export function getBuiltinCharacterList() {
  return BUILTIN_CHARACTERS.map(c => ({ name: c.name, file: c.file }))
}

export function getBuiltinPresetList() {
  return BUILTIN_PRESETS.map(p => ({ name: p.name, file: p.file }))
}

export function getBuiltinRegexList() {
  return BUILTIN_REGEX.map(r => ({ name: r.name, file: r.file }))
}