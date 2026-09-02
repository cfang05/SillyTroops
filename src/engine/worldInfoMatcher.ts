// src/engine/worldInfoMatcher.ts
// 世界书关键词匹配的纯函数集合，对齐酒馆 world-info.js 的 WorldInfoBuffer#matchKeys / isEntryActivated 逻辑。
// 仅服务于 chat 模式的新版 WorldInfoEngine，不影响 TRPG 路径的 lorebookManager.js。

import type { LorebookEntry } from '../types/character'

/** 次级关键词逻辑，数值对齐酒馆 world_info_logic */
export const SELECTIVE_LOGIC = {
  AND_ANY: 0,
  NOT_ALL: 1,
  NOT_ANY: 2,
  AND_ALL: 3
} as const

export interface MatchOptions {
  /** 全局大小写敏感开关，条目可用自身 caseSensitive 覆盖 */
  caseSensitive?: boolean
  /** 全局整词匹配开关，条目可用自身 matchWholeWords 覆盖 */
  matchWholeWords?: boolean
}

/**
 * 尝试把字符串解析为 /pattern/flags 形式的正则表达式
 * 对齐酒馆 parseRegexFromString
 */
export function parseRegexFromString(input: string): RegExp | null {
  const match = input.match(/^\/([\w\W]+?)\/([gimsuy]*)$/)
  if (!match) return null
  let [, pattern, flags] = match
  // 保证内部未转义的 / 不会被当作分隔符
  if (pattern.match(/(^|[^\\])\//)) return null
  pattern = pattern.replace('\\/', '/')
  try {
    return new RegExp(pattern, flags)
  } catch (e) {
    return null
  }
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 核心关键词匹配：haystack 中是否命中 needle
 * 支持：needle 本身写成正则 / 整词匹配 / 大小写敏感
 *
 * @param haystack 扫描文本（原始大小写，不预先 toLowerCase）
 * @param needle   关键词（可能是 /pattern/flags 正则形式）
 * @param entry    条目（用于读取条目级覆盖设置）
 * @param globalOpts 全局设置
 * @returns { matched: boolean, mode: 'regex'|'wholeWord'|'includes' }
 */
export function matchKeys(
  haystack: string,
  needle: string,
  entry: Pick<LorebookEntry, 'caseSensitive' | 'matchWholeWords'>,
  globalOpts: MatchOptions = {}
): { matched: boolean; mode: 'regex' | 'wholeWord' | 'includes' } {
  const regex = parseRegexFromString(needle)
  if (regex) {
    return { matched: regex.test(haystack), mode: 'regex' }
  }

  const caseSensitive = entry.caseSensitive !== null && entry.caseSensitive !== undefined
    ? entry.caseSensitive
    : !!globalOpts.caseSensitive
  const wholeWords = entry.matchWholeWords !== null && entry.matchWholeWords !== undefined
    ? entry.matchWholeWords
    : !!globalOpts.matchWholeWords

  let text = haystack
  let key = needle
  if (!caseSensitive) {
    text = text.toLowerCase()
    key = key.toLowerCase()
  }

  if (wholeWords) {
    // 词边界正则；中文没有天然词边界，用非字母数字/非中文字符环绕来模拟
    const escaped = escapeRegExp(key)
    const wordBoundaryRe = new RegExp('(?:^|[^\\p{L}\\p{N}_])' + escaped + '(?:$|[^\\p{L}\\p{N}_])', 'u')
    return { matched: wordBoundaryRe.test(' ' + text + ' '), mode: 'wholeWord' }
  }

  return { matched: text.indexOf(key) !== -1, mode: 'includes' }
}

export interface ActivationOptions extends MatchOptions {
  /** 是否处于 sticky 免检状态（激活轮数未耗尽） */
  isSticky?: boolean
}

export interface ActivationResult {
  activated: boolean
  matchedKey?: string
  matchedMode?: 'regex' | 'wholeWord' | 'includes' | 'constant' | 'sticky'
}

/**
 * 判断单个条目是否被扫描文本激活（不含概率/分组/预算，那些在 WorldInfoEngine 里处理）
 */
export function isEntryActivated(
  entry: LorebookEntry,
  scanText: string,
  opts: ActivationOptions = {}
): ActivationResult {
  if (entry.enabled === false) return { activated: false }

  // sticky 免检：只要处于 sticky 生效轮数内，直接激活，不需要重新匹配关键词
  if (opts.isSticky) {
    return { activated: true, matchedMode: 'sticky' }
  }

  if (entry.constant) {
    return { activated: true, matchedMode: 'constant' }
  }

  const keys = entry.keys || []
  let primaryHit = false
  let matchedKey = ''
  let matchedMode: ActivationResult['matchedMode']

  for (const key of keys) {
    if (!key) continue
    const { matched, mode } = matchKeys(scanText, key, entry, opts)
    if (matched) {
      primaryHit = true
      matchedKey = key
      matchedMode = mode
      break
    }
  }

  if (!primaryHit) return { activated: false }

  const secKeys = entry.secondaryKeys || []
  if (secKeys.length === 0 || entry.selective === false) {
    return { activated: true, matchedKey, matchedMode }
  }

  let logicMode = entry.selectiveLogic
  if (typeof logicMode !== 'number') logicMode = SELECTIVE_LOGIC.AND_ANY

  let secHitCount = 0
  for (const sk of secKeys) {
    if (!sk) continue
    const { matched } = matchKeys(scanText, sk, entry, opts)
    if (matched) secHitCount++
  }

  let secondaryPass: boolean
  switch (logicMode) {
    case SELECTIVE_LOGIC.AND_ALL:
      secondaryPass = secHitCount === secKeys.length
      break
    case SELECTIVE_LOGIC.NOT_ALL:
      secondaryPass = secHitCount < secKeys.length
      break
    case SELECTIVE_LOGIC.NOT_ANY:
      secondaryPass = secHitCount === 0
      break
    case SELECTIVE_LOGIC.AND_ANY:
    default:
      secondaryPass = secHitCount > 0
      break
  }

  return secondaryPass ? { activated: true, matchedKey, matchedMode } : { activated: false }
}