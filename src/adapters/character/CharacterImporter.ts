// src/adapters/character/CharacterImporter.ts
// 外部角色卡格式（V1/V2 JSON、PNG）→ 内部 CharacterV2 标准模型
// 复用现有 utils/lore/charCardParser.js 的解析能力，不重复实现关键词/世界书解析逻辑

import type { CharacterV2, LorebookEntry } from '../../types/character'
// @ts-ignore - charCardParser.js 无类型声明，函数签名见文件内 JSDoc
import charCardParser from '../../utils/lore/charCardParser.js'
import { importRegexScripts } from '../preset/PresetImporter'

export interface ImportResult {
  character: CharacterV2
  /** 角色卡内嵌的世界书条目（已标准化，可直接传给 lorebookManager.matchFull 的 extraEntries） */
  lorebookEntries: LorebookEntry[]
}

/**
 * 从 JSON 字符串或对象导入角色卡（兼容 V1/V2 格式）
 */
export function importFromJson(input: string | Record<string, any>): ImportResult {
  const parsed = charCardParser.parseCharCard(input)
  if (!parsed) {
    throw new Error('角色卡解析失败：JSON 格式不正确或缺少必要字段')
  }
  if (!parsed.name || !parsed.name.trim()) {
    throw new Error('角色卡缺少必填字段：name')
  }

  // parseCharCard 只做了基础字段的标准化，原始 data 中可能还有 talkativeness/alternate_greetings/
  // extensions.depth_prompt/creator/character_version 等字段未被 charCardParser 处理，
  // 从 parsed.raw 中兜底提取，避免信息丢失（V3 沿用 V2 的 { spec, data:{...} } 外壳）
  const rawSpec = parsed.raw && parsed.raw.spec
  const rawData = (parsed.raw && (rawSpec === 'chara_card_v2' || rawSpec === 'chara_card_v3') && parsed.raw.data)
    ? parsed.raw.data
    : (parsed.raw || {})

  const rawExtensions = (rawData.extensions && typeof rawData.extensions === 'object') ? { ...rawData.extensions } : {}
  // 角色卡自带正则（酒馆 SCOPED 类型来源）：placement 编号是酒馆原始编号，必须转换成内部编号，
  // 否则 RegexScriptEngine 用内部编号匹配时会永远不生效（对齐 PresetImporter.importRegexScripts）。
  // 默认不允许生效（allowScopedRegex 默认 false/未设置），需要用户在编辑页显式勾选启用。
  if (Array.isArray(rawExtensions.regex_scripts) && rawExtensions.regex_scripts.length > 0) {
    rawExtensions.regex_scripts = importRegexScripts(rawExtensions.regex_scripts)
  }

  const character: CharacterV2 = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: parsed.name,
      description: parsed.description || '',
      personality: parsed.personality || '',
      scenario: parsed.scenario || '',
      first_mes: parsed.firstMessage || '',
      mes_example: parsed.exampleDialogue || '',
      system_prompt: parsed.systemPrompt || '',
      post_history_instructions: parsed.postHistoryInstructions || '',
      creator_notes: parsed.creatorNotes || '',
      creator: rawData.creator || '',
      character_version: rawData.character_version || '',
      tags: parsed.tags || [],
      alternate_greetings: Array.isArray(rawData.alternate_greetings) ? rawData.alternate_greetings : [],
      talkativeness: typeof rawData.talkativeness === 'number' ? rawData.talkativeness
        : (typeof rawData.talkativeness === 'string' && rawData.talkativeness !== '' ? Number(rawData.talkativeness) : 0.5),
      extensions: rawExtensions
    }
  }

  // 完整透传 charCardParser.normalizeEntry 已标准化的所有字段（含 selective/secondary_keys/scanDepth/
  // caseSensitive/matchWholeWords/6 个 match_* /probability/group/depth/role/sticky/cooldown/delay 等），
  // 避免重新映射时丢失字段，导致世界书的递归/概率/分组/限时/全局扫描源等功能静默失效。
  const lorebookEntries: LorebookEntry[] = (parsed.lorebook || []).map((e: any) => ({
    ...e,
    id: String(e.id),
    keys: e.keys || [],
    secondaryKeys: Array.isArray(e.secondaryKeys) ? e.secondaryKeys
      : (Array.isArray(e.secondary_keys) ? e.secondary_keys : []),
    content: e.content || '',
    position: e.position || 'before_context',
    enabled: e.enabled !== false,
    extensions: (e.extensions && typeof e.extensions === 'object') ? e.extensions : {}
  }))

  return { character, lorebookEntries }
}

/**
 * 从 PNG 文件导入角色卡（仅 H5 端支持，读取 PNG tEXt 元数据块中的 base64 角色卡数据）
 * 小程序端无 File/ArrayBuffer 文件读取能力，请使用 importFromJson 配合文本粘贴导入
 */
export async function importFromPng(file: File): Promise<ImportResult> {
  // #ifdef H5
  const buffer = await file.arrayBuffer()
  const text = _extractPngTextChunk(buffer, 'chara')
  if (!text) {
    throw new Error('PNG 文件中未找到角色卡数据（缺少 chara 元数据块）')
  }
  const jsonStr = _base64Decode(text)
  const result = importFromJson(jsonStr)
  // PNG 角色卡本身即为头像图。原图常有数 MB（本身还带着 tEXt 元数据），直接整图转 base64
  // 存入 localStorage 很容易撞到浏览器单 origin 的存储配额（通常 5~10MB），导致
  // setStorageSync 抛错——之前这里的错误被 characterCardManager 悄悄吞掉，表现为
  // "提示导入成功，但列表里看不到"。这里改为先压缩缩略图再存，从源头避免超配额；
  // 压缩失败（极少数浏览器兼容性问题）时才回退到原图，交给下游存储层的报错兜底。
  try {
    result.character.data.avatar = await _downscaleImageToDataUrl(buffer, 512, 0.85)
  } catch (e) {
    console.error('[CharacterImporter] 头像缩略图生成失败，回退为原图:', e)
    result.character.data.avatar = _bufferToDataUrl(buffer, 'image/png')
  }
  return result
  // #endif
  // #ifndef H5
  throw new Error('小程序端不支持 PNG 角色卡导入，请使用 JSON 格式导入')
  // #endif
}

// ─────────────────────────────────────────────────────────────
// H5 专属：PNG tEXt 元数据解析
// ─────────────────────────────────────────────────────────────

// #ifdef H5
function _extractPngTextChunk(buffer: ArrayBuffer, keyword: string): string | null {
  const bytes = new Uint8Array(buffer)
  // PNG 签名 8 字节后开始是 chunk 序列
  let offset = 8
  const decoder = new TextDecoder('latin1')

  while (offset < bytes.length) {
    const length = _readUint32(bytes, offset)
    const typeBytes = bytes.slice(offset + 4, offset + 8)
    const type = decoder.decode(typeBytes)

    if (type === 'tEXt' || type === 'iTXt') {
      const chunkData = bytes.slice(offset + 8, offset + 8 + length)
      const nullIndex = chunkData.indexOf(0)
      if (nullIndex >= 0) {
        const key = decoder.decode(chunkData.slice(0, nullIndex))
        if (key === keyword) {
          const valueBytes = chunkData.slice(nullIndex + 1)
          return decoder.decode(valueBytes)
        }
      }
    }

    if (type === 'IEND') break
    offset += 12 + length // length(4) + type(4) + data(length) + crc(4)
  }

  return null
}

function _readUint32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]
}

function _base64Decode(str: string): string {
  try {
    return decodeURIComponent(escape(atob(str)))
  } catch (e) {
    return atob(str)
  }
}

function _bufferToDataUrl(buffer: ArrayBuffer, mimeType: string): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  // 分块转换，避免超长数组一次性传给 String.fromCharCode 导致调用栈溢出
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)) as number[])
  }
  return 'data:' + mimeType + ';base64,' + btoa(binary)
}

/**
 * 用 canvas 把原图缩小到最长边 <= maxSize 并按 quality 重新编码为 JPEG dataURL。
 * 角色卡 PNG 常见几百 KB ~ 数 MB，直接整图存 localStorage 很容易撞配额；缩略图仅用于
 * 列表/头像展示，不需要保留原图分辨率。
 */
function _downscaleImageToDataUrl(buffer: ArrayBuffer, maxSize: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const blob = new Blob([buffer], { type: 'image/png' })
      const url = URL.createObjectURL(blob)
      const img = new Image()
      img.onload = () => {
        try {
          const { width, height } = img
          const scale = Math.min(1, maxSize / Math.max(width, height))
          const w = Math.max(1, Math.round(width * scale))
          const h = Math.max(1, Math.round(height * scale))
          const canvas = document.createElement('canvas')
          canvas.width = w
          canvas.height = h
          const ctx = canvas.getContext('2d')
          if (!ctx) throw new Error('canvas 2d context 不可用')
          ctx.drawImage(img, 0, 0, w, h)
          const dataUrl = canvas.toDataURL('image/jpeg', quality)
          URL.revokeObjectURL(url)
          resolve(dataUrl)
        } catch (err) {
          URL.revokeObjectURL(url)
          reject(err)
        }
      }
      img.onerror = (err) => {
        URL.revokeObjectURL(url)
        reject(err)
      }
      img.src = url
    } catch (err) {
      reject(err)
    }
  })
}
// #endif
