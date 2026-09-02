// src/engine/DebugLogger.ts
// 调试日志工具：用于在关键后台环节完整打印可访问的所有数据，而非预设的"重要字段"
// 所有输出受 DEBUG_ENABLED 控制，默认开启

export const DEBUG_ENABLED = true

/** 长字符串截断显示：前 N 字符 + 总长度提示 */
export function truncate(text: any, maxLen = 200): string {
  if (text === null || text === undefined) return '(空/缺失)'
  const str = typeof text === 'string' ? text : String(text)
  if (str.length === 0) return '(空字符串)'
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen) + '...(总长度: ' + str.length + ' 字符)'
}

/** 用 console.group 包裹一段日志逻辑，模块名统一前缀便于过滤 */
export function debugGroup(label: string, fn: () => void): void {
  if (!DEBUG_ENABLED) return
  // #ifdef H5
  console.group(label)
  try {
    fn()
  } finally {
    console.groupEnd()
  }
  // #endif
  // #ifndef H5
  // 小程序端 console 无 group/groupEnd，降级为普通日志包裹
  console.log('▼ ' + label)
  try {
    fn()
  } finally {
    console.log('▲ ' + label + ' 结束')
  }
  // #endif
}

/** 打印可交互展开的对象（H5 用 console.dir，小程序降级为 console.log） */
export function debugDump(label: string, obj: any): void {
  if (!DEBUG_ENABLED) return
  console.log(label)
  // #ifdef H5
  console.dir(obj, { depth: null })
  // #endif
  // #ifndef H5
  console.log(obj)
  // #endif
}

/** 打印数组为表格形式，便于快速浏览；空数组明确标注 */
export function debugTable(label: string, data: any[] | null | undefined): void {
  if (!DEBUG_ENABLED) return
  console.log(label + (data ? ' (共 ' + data.length + ' 项)' : ' (无数据)'))
  if (!data || data.length === 0) {
    console.log('  (空 - 无任何数据)')
    return
  }
  // #ifdef H5
  console.table(data)
  // #endif
  // #ifndef H5
  data.forEach((item, i) => console.log('  [' + i + ']:', item))
  // #endif
}

/**
 * 深度遍历打印任意对象/数组的所有字段，不预设字段名，用于"完整遍历"类埋点
 * 明确标注每个字段是否为空/缺失，嵌套对象递归展开到 maxDepth 层
 */
export function debugDeepDump(label: string, value: any, maxDepth = 8): void {
  if (!DEBUG_ENABLED) return
  console.log(label)
  _walk(value, 0, maxDepth, new Set())
}

function _walk(value: any, depth: number, maxDepth: number, seen: Set<any>): void {
  const indent = '  '.repeat(depth + 1)

  if (value === null || value === undefined) {
    console.log(indent + '(空/缺失)')
    return
  }

  if (depth >= maxDepth) {
    console.log(indent + '... (已达最大遍历深度 ' + maxDepth + '，未继续展开)')
    return
  }

  if (typeof value !== 'object') {
    if (typeof value === 'string') {
      console.log(indent + (value === '' ? '(空字符串)' : '"' + truncate(value, 200) + '"'))
    } else {
      console.log(indent + String(value))
    }
    return
  }

  if (seen.has(value)) {
    console.log(indent + '(循环引用，跳过)')
    return
  }
  seen.add(value)

  if (Array.isArray(value)) {
    console.log(indent + '(Array，长度=' + value.length + ')')
    if (value.length === 0) {
      console.log(indent + '  (空数组)')
      return
    }
    value.forEach((item, i) => {
      console.log(indent + '[' + i + ']:')
      _walk(item, depth + 1, maxDepth, seen)
    })
    return
  }

  const keys = Object.keys(value)
  if (keys.length === 0) {
    console.log(indent + '(空对象 {})')
    return
  }
  keys.forEach(key => {
    const v = value[key]
    const typeLabel = v === null || v === undefined
      ? '(空/缺失)'
      : Array.isArray(v)
        ? '(Array[' + v.length + '])'
        : typeof v === 'object'
          ? '(Object)'
          : typeof v === 'string'
            ? (v === '' ? '(空字符串)' : 'string')
            : typeof v

    if (v !== null && v !== undefined && typeof v === 'object') {
      console.log(indent + '├── ' + key + ': ' + typeLabel)
      _walk(v, depth + 1, maxDepth, seen)
    } else if (typeof v === 'string' && v !== '') {
      console.log(indent + '├── ' + key + ': "' + truncate(v, 200) + '"')
    } else {
      console.log(indent + '├── ' + key + ': ' + typeLabel)
    }
  })
}

/** 打印"变化前 / 变化后"对比，用于正则脚本执行、Prompt 注入等有状态变化的环节 */
export function debugDiff(label: string, before: any, after: any): void {
  if (!DEBUG_ENABLED) return
  console.log(label)
  console.log('  变化前:')
  debugDeepDump('  ', before)
  console.log('  变化后:')
  debugDeepDump('  ', after)
  const changed = JSON.stringify(before) !== JSON.stringify(after)
  console.log('  是否发生变化: ' + (changed ? '是' : '否'))
}