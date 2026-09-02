// src/adapters/character/CharacterExporter.ts
// 内部 CharacterV2 模型 → 标准 v2 JSON 字符串（用于导出角色卡）

import type { CharacterV2 } from '../../types/character'

/**
 * 将内部角色模型序列化为标准酒馆 v2 角色卡 JSON 字符串
 */
export function exportToJson(character: CharacterV2): string {
  return JSON.stringify(character, null, 2)
}