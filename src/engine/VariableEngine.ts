// src/engine/VariableEngine.ts
// 变量系统 + 宏系统（最小可用版，合并方案决策 3 / 兼容清单 P0-4）
//
// 支持宏形式：{{name}} / {{name:arg}} / {{name::a::b}}
// 解析优先级：vars 静态映射（char/user/description 等由 PromptBuilder 注入）
//           > 注册宏（变量宏/工具宏/TRPG 宏，含副作用）
//           > 局部变量（随对话） > 全局变量（跨对话）
// 未命中的宏保留原样（与酒馆行为一致）。
//
// 变量分层（对齐酒馆）：
//   - 局部变量：runtimeStore.localVariables（随对话存档）
//   - 全局变量：storage[u_{userId}_global_variables]（按用户隔离，跨对话持久化）
//     注：迁移前是不带前缀的 global_variables（所有人共用一份），按既定决策作废重置。

import { useRuntimeStore } from '../stores/runtimeStore'
import storage from '../utils/storage.js'
import { scopedKey } from '../utils/account/userScope.js'
// @ts-ignore - dice-helper.js 无类型声明
import diceHelper from '../utils/dice-helper.js'

/** 全局变量存储键（按当前用户隔离） */
function globalVarStorageKey(): string {
  return scopedKey('global_variables')
}

export type VariableScope = 'local' | 'global'

// ─────────────────────────────────────────────────────────────
// 变量 API
// ─────────────────────────────────────────────────────────────

/**
 * 设置变量
 * @param name 变量名
 * @param value 变量值（统一以字符串存储）
 * @param scope local=当前对话；global=跨对话持久化
 */
export function setVar(name: string, value: string, scope: VariableScope = 'local'): void {
  if (!name) return
  if (scope === 'global') {
    const vars = _loadGlobalVars()
    vars[name] = value
    storage.set(globalVarStorageKey(), vars)
  } else {
    const runtimeStore = useRuntimeStore()
    runtimeStore.setLocalVariable(name, value)
  }
}

/**
 * 读取变量，local 优先于 global（未命中时返回空字符串）
 */
export function getVar(name: string, scope: VariableScope = 'local'): string {
  if (!name) return ''
  if (scope === 'global') {
    const vars = _loadGlobalVars()
    return vars[name] ?? ''
  }
  const runtimeStore = useRuntimeStore()
  return runtimeStore.getLocalVariable(name)
}

function hasVar(name: string, scope: VariableScope = 'local'): boolean {
  if (!name) return false
  if (scope === 'global') {
    const vars = _loadGlobalVars()
    return Object.prototype.hasOwnProperty.call(vars, name)
  }
  const runtimeStore = useRuntimeStore()
  return Object.prototype.hasOwnProperty.call(runtimeStore.localVariables, name)
}

function delVar(name: string, scope: VariableScope = 'local'): void {
  if (!name) return
  if (scope === 'global') {
    const vars = _loadGlobalVars()
    delete vars[name]
    storage.set(globalVarStorageKey(), vars)
  } else {
    const runtimeStore = useRuntimeStore()
    delete runtimeStore.localVariables[name]
  }
}

/**
 * 简单四则运算求值（+ - * /），不使用 eval（小程序限制）
 */
export function evalMath(expr: string): number {
  if (!expr || typeof expr !== 'string') return NaN
  try {
    const tokens = _tokenize(expr.replace(/\s+/g, ''))
    const rpn = _toRPN(tokens)
    return _evalRPN(rpn)
  } catch (e) {
    console.warn('[VariableEngine] evalMath 解析失败:', expr, e)
    return NaN
  }
}

// ─────────────────────────────────────────────────────────────
// 宏注册表
// ─────────────────────────────────────────────────────────────

export type MacroHandler = (args: string[], vars: Record<string, string>) => string | null | undefined

const macroRegistry: Record<string, MacroHandler> = {}

/** 注册宏（handler 返回字符串；返回 null/undefined 视为替换失败，保留原文） */
export function registerMacro(name: string, handler: MacroHandler): void {
  if (!name || typeof handler !== 'function') return
  macroRegistry[name.toLowerCase()] = handler
}

export function unregisterMacro(name: string): void {
  delete macroRegistry[name.toLowerCase()]
}

// ─────────────────────────────────────────────────────────────
// TRPG 运行时上下文（由 PromptBuilder 在替换前注入）
// ─────────────────────────────────────────────────────────────

let trpgContext: Record<string, any> = {}

export function setTrpgContext(ctx: Record<string, any> | null): void {
  trpgContext = ctx || {}
}

export function getTrpgContext(): Record<string, any> {
  return trpgContext
}

// ─────────────────────────────────────────────────────────────
// 内置宏
// ─────────────────────────────────────────────────────────────

function parseArgs(argStr: string | undefined): string[] {
  if (!argStr) return []
  return argStr.split('::').map(s => s.trim())
}

function _addLocalVar(name: string, delta: number): string {
  const cur = getVar(name, 'local')
  const isNum = cur !== '' && !isNaN(Number(cur))
  const next = isNum ? String(Number(cur) + delta) : String(delta)
  setVar(name, next, 'local')
  return next
}

function _addGlobalVar(name: string, delta: number): string {
  const cur = getVar(name, 'global')
  const isNum = cur !== '' && !isNaN(Number(cur))
  const next = isNum ? String(Number(cur) + delta) : String(delta)
  setVar(name, next, 'global')
  return next
}

function registerBuiltins(): void {
  // ── 变量宏（局部） ──────────────────────────────────────────
  registerMacro('setvar', (args) => { if (args[0]) setVar(args[0], args[1] ?? '', 'local'); return '' })
  registerMacro('getvar', (args) => (args[0] ? getVar(args[0], 'local') : ''))
  registerMacro('hasvar', (args) => (args[0] && hasVar(args[0], 'local') ? 'true' : 'false'))
  registerMacro('incvar', (args) => (args[0] ? _addLocalVar(args[0], 1) : ''))
  registerMacro('decvar', (args) => (args[0] ? _addLocalVar(args[0], -1) : ''))
  registerMacro('addvar', (args) => {
    const name = args[0]; const val = args[1] ?? ''
    if (!name) return ''
    const cur = getVar(name, 'local')
    const isNum = cur !== '' && val !== '' && !isNaN(Number(cur)) && !isNaN(Number(val))
    const next = isNum ? String(Number(cur) + Number(val)) : (cur + String(val))
    setVar(name, next, 'local')
    return ''
  })
  registerMacro('deletevar', (args) => { if (args[0]) delVar(args[0], 'local'); return '' })
  // 别名
  registerMacro('varexists', macroRegistry['hasvar'])
  registerMacro('flushvar', macroRegistry['deletevar'])

  // ── 变量宏（全局） ──────────────────────────────────────────
  registerMacro('setglobalvar', (args) => { if (args[0]) setVar(args[0], args[1] ?? '', 'global'); return '' })
  registerMacro('getglobalvar', (args) => (args[0] ? getVar(args[0], 'global') : ''))
  registerMacro('hasglobalvar', (args) => (args[0] && hasVar(args[0], 'global') ? 'true' : 'false'))
  registerMacro('incglobalvar', (args) => (args[0] ? _addGlobalVar(args[0], 1) : ''))
  registerMacro('decglobalvar', (args) => (args[0] ? _addGlobalVar(args[0], -1) : ''))
  registerMacro('addglobalvar', (args) => {
    const name = args[0]; const val = args[1] ?? ''
    if (!name) return ''
    const cur = getVar(name, 'global')
    const isNum = cur !== '' && val !== '' && !isNaN(Number(cur)) && !isNaN(Number(val))
    const next = isNum ? String(Number(cur) + Number(val)) : (cur + String(val))
    setVar(name, next, 'global')
    return ''
  })
  registerMacro('deleteglobalvar', (args) => { if (args[0]) delVar(args[0], 'global'); return '' })

  // ── 工具宏 ──────────────────────────────────────────────────
  registerMacro('random', (args) => {
    let list = args
    if (list.length === 1 && list[0].indexOf(',') !== -1) list = list[0].split(',').map(s => s.trim())
    list = list.filter(Boolean)
    if (!list.length) return ''
    return list[Math.floor(Math.random() * list.length)]
  })
  registerMacro('pick', macroRegistry['random']) // 简化版：确定性 pick 暂以 random 近似
  registerMacro('roll', (args) => {
    const formula = args[0] || ''
    if (!formula) return ''
    const r = diceHelper.parseDiceCommand(formula)
    return r && r.success !== false ? String(r.total) : ''
  })
  registerMacro('time', () => {
    const d = new Date()
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
  })
  registerMacro('date', () => {
    const d = new Date()
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  })
  registerMacro('space', (args) => ' '.repeat(Number(args[0]) || 1))
  registerMacro('newline', (args) => '\n'.repeat(Number(args[0]) || 1))

  // ── TRPG 宏（读 trpgContext，由 PromptBuilder 注入会话状态） ──
  registerMacro('hp', () => _fmtNum(trpgContext.hp))
  registerMacro('maxhp', () => _fmtNum(trpgContext.maxHp))
  registerMacro('mp', () => _fmtNum(trpgContext.mp))
  registerMacro('maxmp', () => _fmtNum(trpgContext.maxMp))
  registerMacro('san', () => _fmtNum(trpgContext.san))
  registerMacro('maxsan', () => _fmtNum(trpgContext.maxSan))
  registerMacro('scene', () => String(trpgContext.scene ?? ''))
  registerMacro('story', () => String(trpgContext.story ?? trpgContext.storyTitle ?? ''))
  registerMacro('flag', (args) => {
    const flags = trpgContext.flags || {}
    return args[0] ? String(flags[args[0]] ?? '') : ''
  })
  registerMacro('trust', (args) => {
    const trust = trpgContext.trust || {}
    return args[0] ? String(trust[args[0]] ?? '') : ''
  })

  // ── 对话历史宏（P1需求，从runtimeStore读取最近消息）──
  registerMacro('lastMessage', () => {
    const store = useRuntimeStore()
    if (!store.messages || !store.messages.length) return ''
    return store.messages[store.messages.length - 1].content || ''
  })
  registerMacro('lastUserMessage', () => {
    const store = useRuntimeStore()
    if (!store.messages) return ''
    for (let i = store.messages.length - 1; i >= 0; i--) {
      if (store.messages[i].role === 'user') return store.messages[i].content || ''
    }
    return ''
  })
  registerMacro('lastCharMessage', () => {
    const store = useRuntimeStore()
    if (!store.messages) return ''
    for (let i = store.messages.length - 1; i >= 0; i--) {
      if (store.messages[i].role === 'assistant') return store.messages[i].content || ''
    }
    return ''
  })
  registerMacro('firstMessage', () => {
    const store = useRuntimeStore()
    if (!store.messages || !store.messages.length) return ''
    return store.messages[0].content || ''
  })
}

function _fmtNum(v: any): string {
  return (v === undefined || v === null) ? '' : String(v)
}

registerBuiltins()

// ─────────────────────────────────────────────────────────────
// 核心替换函数
// ─────────────────────────────────────────────────────────────

/**
 * 将文本中的 {{宏}} 替换为实际值。
 * 支持 {{name}} / {{name:arg}} / {{name::a::b}} 形式。
 * @param text 模板文本
 * @param vars 静态变量映射表（优先级最高，char/user/description 等由 PromptBuilder 注入）
 */
export function substituteVariables(text: string, vars: Record<string, string> = {}): string {
  if (!text) return text
  return text.replace(/\{\{([\w-]+)(?:\s*:+\s*([^{}]*))?\}\}/g, (match, name: string, argStr: string | undefined) => {
    // 1. 静态映射（最高优先级）
    if (Object.prototype.hasOwnProperty.call(vars, name)) return String(vars[name])
    // 2. 注册宏（变量宏/工具宏/TRPG 宏，含副作用）
    const handler = macroRegistry[name.toLowerCase()]
    if (handler) {
      try {
        const result = handler(parseArgs(argStr), vars)
        return (result === null || result === undefined) ? match : String(result)
      } catch (e) {
        console.warn('[VariableEngine] 宏执行失败:', name, e)
        return match
      }
    }
    // 3. 局部变量
    const localVal = getVar(name, 'local')
    if (localVal) return localVal
    // 4. 全局变量
    const globalVal = getVar(name, 'global')
    if (globalVal) return globalVal
    return match // 未命中保留原样
  })
}

// ─────────────────────────────────────────────────────────────
// 内部工具
// ─────────────────────────────────────────────────────────────

function _loadGlobalVars(): Record<string, string> {
  try {
    return storage.get(globalVarStorageKey()) || {}
  } catch (e) {
    return {}
  }
}

function _tokenize(expr: string): string[] {
  const tokens: string[] = []
  let numBuf = ''
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i]
    if (/[0-9.]/.test(ch)) {
      numBuf += ch
    } else if ('+-*/()'.includes(ch)) {
      if (numBuf) { tokens.push(numBuf); numBuf = '' }
      tokens.push(ch)
    } else {
      throw new Error('非法字符: ' + ch)
    }
  }
  if (numBuf) tokens.push(numBuf)
  return tokens
}

const PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 }

function _toRPN(tokens: string[]): string[] {
  const output: string[] = []
  const opStack: string[] = []
  tokens.forEach(tok => {
    if (!isNaN(Number(tok))) {
      output.push(tok)
    } else if (tok === '(') {
      opStack.push(tok)
    } else if (tok === ')') {
      while (opStack.length && opStack[opStack.length - 1] !== '(') {
        output.push(opStack.pop() as string)
      }
      opStack.pop()
    } else {
      while (
        opStack.length &&
        PRECEDENCE[opStack[opStack.length - 1]] >= PRECEDENCE[tok]
      ) {
        output.push(opStack.pop() as string)
      }
      opStack.push(tok)
    }
  })
  while (opStack.length) output.push(opStack.pop() as string)
  return output
}

function _evalRPN(rpn: string[]): number {
  const stack: number[] = []
  rpn.forEach(tok => {
    if (!isNaN(Number(tok))) {
      stack.push(Number(tok))
    } else {
      const b = stack.pop() as number
      const a = stack.pop() as number
      switch (tok) {
        case '+': stack.push(a + b); break
        case '-': stack.push(a - b); break
        case '*': stack.push(a * b); break
        case '/': stack.push(a / b); break
        default: throw new Error('未知运算符: ' + tok)
      }
    }
  })
  return stack[0]
}
