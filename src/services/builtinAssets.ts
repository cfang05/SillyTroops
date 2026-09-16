// src/services/builtinAssets.ts
// 项目自带**角色卡**加载器（不自动导入 Store，用户在新建对话时主动选择）
// 文件来源：st_card 文件夹（编译时复制到 public/assets/）
//
// 注：内置**预设**与内置**正侧**的自加载已按 D7 / P4.7 移除，打包资源（public/assets/presets、
// public/assets/regex）也已删除。它们原来在启动时被自动写进本地存储（约 1.35MB），
// 且内置正则因 markdownOnly/promptOnly 标志缺失而不生效。现在默认改走：
//   · 预设 → 代码内置的「系统预设」（D19）
//   · 正侧 → 代码内置的「系统正侧」（D15）
// 需要原来的打包预设/正则时，仍可在「导入」页手动导入（st_preset / st_regex 源文件保留）。

import { importFromPng, type ImportResult } from '../adapters/character/CharacterImporter'

// ══════════════════════════════════════════════════════════════
// 内置资源清单（手动维护，与 public/assets/ 下的文件保持同步）
// ══════════════════════════════════════════════════════════════

const BUILTIN_CHARACTERS = [
  { name: 'beth', file: '/assets/characters/beth.png' },
  { name: 'DM_v2', file: '/assets/characters/DM_v2.png' }
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

// ══════════════════════════════════════════════════════════════
// 获取内置资源清单（用于 UI 展示选择列表）
// ══════════════════════════════════════════════════════════════

export function getBuiltinCharacterList() {
  return BUILTIN_CHARACTERS.map(c => ({ name: c.name, file: c.file }))
}