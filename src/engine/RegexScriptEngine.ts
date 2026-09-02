// src/engine/RegexScriptEngine.ts
// 执行正则脚本：对文本按 placement 过滤后依次应用纯正则替换。
// 对齐酒馆 extensions/regex/engine.js 的 getRegexedString + runRegexScript 语义：
//   - 支持 {{match}} / $0 / $1..$n / $<name> 具名组替换（函数替换，非 eval）；
//   - 捕获值会先经 trimStrings 过滤，且 trimStrings 本身与最终替换文本均支持 {{宏}} 替换
//     （对齐酒馆 runRegexScript 里 filterString 对 trimString 调 substituteParams、
//     以及最外层对 replaceWithGroups 调 substituteParams 的行为）；
//   - findRegex 支持 substituteRegex（NONE=0 / RAW=1 / ESCAPED=2）宏替换；
//   - 支持 markdownOnly / promptOnly / runOnEdit / minDepth / maxDepth 过滤；
//   - 编译结果做 LRU 缓存（对齐酒馆 RegexProvider），避免同一脚本反复编译正则。

import type { RegexScript, RegexPlacement } from '../types/script'
import { DEBUG_ENABLED, debugGroup, truncate } from './DebugLogger'
import { parseRegexFromString } from './worldInfoMatcher'
import { substituteVariables } from './VariableEngine'

const PLACEMENT_LABEL: Record<number, string> = {
  0: 'AI 输出（输出侧净化）',
  1: '用户输入（输入侧净化）',
  2: '世界信息内容',
  3: '推理内容'
}

export interface RegexApplyOptions {
  /** 是否为 Markdown 展示文本（脚本 markdownOnly 时生效） */
  isMarkdown?: boolean
  /** 是否为 prompt 构建文本（脚本 promptOnly 时生效） */
  isPrompt?: boolean
  /** 是否为编辑后重跑（脚本 runOnEdit=false 时跳过） */
  isEdit?: boolean
  /** 当前深度（世界书 atDepth 等，用于 minDepth/maxDepth 过滤） */
  depth?: number
  /** 变量映射（用于 substituteRegex RAW/ESCAPED 的宏替换，以及 replaceString/trimStrings 的宏替换） */
  vars?: Record<string, string>
}

// ─────────────────────────────────────────────────────────────
// 正则编译缓存（对齐酒馆 RegexProvider：LRU，超过上限淘汰最早写入的一条）
// ─────────────────────────────────────────────────────────────
const REGEX_CACHE_MAX = 1000
const regexCache = new Map<string, RegExp | null>()

function getCachedRegex(regexString: string): RegExp | null {
  if (regexCache.has(regexString)) {
    const cached = regexCache.get(regexString)!
    // LRU：命中后移到末尾
    regexCache.delete(regexString)
    regexCache.set(regexString, cached)
    return cached
  }
  const compiled = _compileRegexRaw(regexString)
  if (regexCache.size >= REGEX_CACHE_MAX) {
    const oldestKey = regexCache.keys().next().value
    if (oldestKey !== undefined) regexCache.delete(oldestKey)
  }
  regexCache.set(regexString, compiled)
  return compiled
}

/** 编译 findRegex（支持 /pattern/flags 与裸 pattern 两种写法），统一追加 g 标志做全局替换 */
function _compileRegexRaw(findRegex: string): RegExp | null {
  if (!findRegex) return null
  try {
    const parsed = parseRegexFromString(findRegex)
    if (parsed) {
      const flags = parsed.flags.includes('g') ? parsed.flags : parsed.flags + 'g'
      return new RegExp(parsed.source, flags)
    }
    return new RegExp(findRegex, 'g')
  } catch (e) {
    console.warn('[RegexScriptEngine] 正则编译失败:', findRegex, e)
    return null
  }
}

/** 转义正则特殊字符（对齐酒馆 sanitizeRegexMacro 的精简版） */
function escapeRegexChars(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 按 substituteRegex 策略处理 findRegex 中的宏 */
function resolveFindRegex(findRegex: string, substituteRegex: number | undefined, vars?: Record<string, string>): string {
  const mode = Number(substituteRegex || 0)
  if (!vars || mode === 0) return findRegex
  if (mode === 1) {
    // RAW：宏值原样替换
    return substituteVars(findRegex, vars, false)
  }
  // ESCAPED：宏值替换后转义特殊字符（其余 pattern 保持正则语义）
  return substituteVars(findRegex, vars, true)
}

function substituteVars(text: string, vars: Record<string, string>, escape: boolean): string {
  return text.replace(/\{\{([\w-]+)(?:\s*:+\s*([^{}]*))?\}\}/g, (match, name: string, _arg: string | undefined) => {
    let value = ''
    if (Object.prototype.hasOwnProperty.call(vars, name)) value = String(vars[name])
    else value = match
    return escape ? escapeRegexChars(value) : value
  })
}

/**
 * 移除捕获值中的 trimStrings，且每个 trimString 先做 {{宏}} 替换
 * （对齐酒馆 filterString：trimString 先 substituteParams 再 replaceAll）。
 */
function filterTrimStrings(s: string, trimStrings: string[] | undefined, vars: Record<string, string> | undefined): string {
  if (!Array.isArray(trimStrings) || !trimStrings.length) return s
  let out = s
  for (const t of trimStrings) {
    if (!t) continue
    const resolved = vars ? substituteVariables(t, vars) : t
    if (resolved) out = out.split(resolved).join('')
  }
  return out
}

/**
 * 执行单条脚本的替换（函数替换版，支持 {{match}} / $n / $<name>）。
 * 小程序无 eval，但 String.replace 传函数是标准 JS，无 eval 依赖。
 */
function runRegexScript(script: RegexScript, text: string, vars?: Record<string, string>): string {
  const regexString = resolveFindRegex(script.findRegex, script.substituteRegex, vars)
  const findRegex = getCachedRegex(regexString)
  if (!findRegex) return text
  // 全局正则需要重置 lastIndex，否则复用缓存实例时可能从上次匹配的位置继续，漏掉本次开头的匹配
  if (findRegex.global || findRegex.sticky) findRegex.lastIndex = 0

  return text.replace(findRegex, (...args: any[]) => {
    const namedGroups = args[args.length - 1]
    // {{match}} -> $0
    let replaceString = (script.replaceString ?? '').replace(/{{match}}/gi, '$0')
    // 手动展开 $0/$n/$<name>（函数替换下 JS 不会自动展开）
    const expanded = replaceString.replace(/\$(\d+)|\$<([^>]+)>/g, (_m: string, num?: string, name?: string) => {
      let value: string | undefined
      if (num !== undefined) value = args[Number(num)]
      else if (name && namedGroups && typeof namedGroups === 'object') value = namedGroups[name]
      if (value === undefined) return ''
      return filterTrimStrings(value, script.trimStrings, vars)
    })
    // 对齐酒馆：展开完 $0/$n/$<name> 之后，最终替换文本再整体过一遍宏替换——
    // 这样作者手写在 replaceString 里的装饰性宏（如 {{user}}/{{char}}，不经过捕获组）也能被解析
    return vars ? substituteVariables(expanded, vars) : expanded
  })
}

/** 脚本是否适用于当前场景（对齐酒馆 getRegexedString 的 markdownOnly/promptOnly 判定） */
function shouldApply(script: RegexScript, opts: RegexApplyOptions): boolean {
  const isMarkdown = !!opts.isMarkdown
  const isPrompt = !!opts.isPrompt
  return (
    (script.markdownOnly && isMarkdown) ||
    (script.promptOnly && isPrompt) ||
    (!script.markdownOnly && !script.promptOnly && !isMarkdown && !isPrompt)
  )
}

/**
 * 对给定文本依次应用匹配 placement 的启用脚本
 * @param text 原始文本
 * @param scripts 脚本列表
 * @param placement 当前应用场景（0=AI输出 1=用户输入 2=世界信息 3=推理内容）
 * @param opts 可选过滤参数（isMarkdown/isPrompt/isEdit/depth/vars）
 * @returns 处理后的文本
 */
export function applyRegexScripts(
  text: string,
  scripts: RegexScript[],
  placement: RegexPlacement,
  opts: RegexApplyOptions = {}
): string {
  const label = '🧹 [正则脚本引擎] placement=' + placement + '（' + (PLACEMENT_LABEL[placement] || '未知') + '）'

  if (!text || !Array.isArray(scripts) || scripts.length === 0) {
    if (DEBUG_ENABLED) {
      debugGroup(label, () => {
        console.log('原始文本:', truncate(text, 200))
        console.log('脚本列表: (无脚本或文本为空，跳过处理)')
      })
    }
    return text
  }

  const matchedScripts = scripts.filter(s => {
    if (s.disabled) return false
    if (!Array.isArray(s.placement) || !s.placement.includes(placement)) return false
    if (!shouldApply(s, opts)) return false
    if (opts.isEdit && !s.runOnEdit) return false
    // 深度过滤（对齐酒馆：minDepth >= -1 才过滤，maxDepth >= 0 才过滤）
    if (typeof opts.depth === 'number') {
      if (typeof s.minDepth === 'number' && !isNaN(s.minDepth) && s.minDepth >= -1 && opts.depth < s.minDepth) return false
      if (typeof s.maxDepth === 'number' && !isNaN(s.maxDepth) && s.maxDepth >= 0 && opts.depth > s.maxDepth) return false
    }
    return true
  })

  const originalText = text
  const executionLog: Array<{ script: RegexScript; before: string; after: string; changed: boolean; error?: string }> = []

  const finalText = matchedScripts.reduce((acc, script) => {
    try {
      if (!script.findRegex) {
        executionLog.push({ script, before: acc, after: acc, changed: false, error: '(findRegex 为空，跳过)' })
        return acc
      }
      const result = runRegexScript(script, acc, opts.vars)
      executionLog.push({ script, before: acc, after: result, changed: acc !== result })
      return result
    } catch (e) {
      console.warn('[RegexScriptEngine] 脚本执行失败:', script.scriptName || script.id, e)
      executionLog.push({ script, before: acc, after: acc, changed: false, error: (e as Error).message })
      return acc
    }
  }, text)

  if (DEBUG_ENABLED) {
    debugGroup(label, () => {
      console.log('原始输入文本:', truncate(originalText, 200))
      console.log('全部脚本总数:', scripts.length, '| 匹配当前 placement 且启用的脚本数:', matchedScripts.length)
      if (matchedScripts.length === 0) {
        console.log('(没有任何脚本命中此 placement，文本原样通过)')
      } else {
        executionLog.forEach((entry, idx) => {
          debugGroup('脚本 [' + idx + '] ' + (entry.script.scriptName || entry.script.id), () => {
            console.log('执行前文本:', truncate(entry.before, 200))
            console.log('执行后文本:', truncate(entry.after, 200))
            console.log('是否发生变化:', entry.changed ? '是' : '否')
            if (entry.error) console.log('执行异常/跳过原因:', entry.error)
          })
        })
      }
      console.log('最终输出文本:', truncate(finalText, 200))
    })
  }

  return finalText
}

/**
 * 校验脚本的 findRegex 是否为合法正则（用于预设编辑页做输入校验）
 */
export function isValidRegex(pattern: string): boolean {
  try {
    // eslint-disable-next-line no-new
    new RegExp(pattern)
    return true
  } catch (e) {
    return false
  }
}

/** 清空正则编译缓存（供测试或"清除缓存"入口使用） */
export function clearRegexCache(): void {
  regexCache.clear()
}
