// src/engine/systemRegex.ts
// 「系统正侧」（D15）：**代码内置**的默认正则脚本集合。
//
// 与「系统预设」（D19）对称：
//   · 默认选中；
//   · 用户选择其他正侧文件时**被替换**（不叠加）；
//   · 不落盘、不可删除（每次启动由 store 重新植入）。
//
// 它承担的职责是把原先**硬编码在 BlockParser 里的"台词识别"**改成正则实现（D1）：
// 把引号内的台词包成 `<span class="say">…</span>`，外观交给 CSS（D2：自定义 CSS + class）。
//
// ⚠️ 两个关键设计（都来自 D5 三态分离）：
//   1. 全部标记 `markdownOnly: true` —— **只影响显示**，产物绝不写进存档、也绝不进上下文；
//   2. 每条"成对"规则后面跟一条"未闭合兜底"规则（匹配到文末），这样流式输出时
//      引号一出现就是台词样式，闭引号到达时**外观不变**（消除我们讨论过的"整句跳一下"）。
//
// 兼容性说明：BlockParser 里那套引号状态机**保留**作为降级路径（P4.5 允许的方案）。
// 系统正侧生效时，引号已被替换成 HTML，状态机自然扫不到引号 → 不会重复套用；
// 用户用别的正侧文件替换掉系统正侧后，状态机仍然负责 `“”‘’"` 的台词识别，行为与改造前一致。

import type { RegexScript } from '../types/script'

/** 系统正侧的固定 id（与 SYSTEM_PRESET_ID 对称） */
export const SYSTEM_REGEX_PRESET_ID = 'system'

/** 台词样式使用的 class；默认外观由 utils/customCss.ts 注入的 `.say` 规则提供，可被用户覆盖 */
export const DIALOGUE_CLASS = 'say'

/** 本项目的内部 placement：0 = AI 输出（见 types/script.ts 顶部注释） */
const AI_OUTPUT = 0 as const

/**
 * 台词判定的"有意义"门槛（忠实翻译自改造前的硬编码状态机）：
 * 长度 ≥ 6 个字，或包含句读标点 —— 太短的引用（如“好”）不当台词，避免满屏高亮。
 *
 * ⚠️ 必须把**闭合引号**一起传进来组成字符类：形如 `[^”]{6,}`。
 * 早期版本写成 `{6,}`（漏了字符类）会被 JS 当作字面量 `{6,}`，规则永远匹配不到 ——
 * 这是 scripts/tmp-p4-check.js 的运行时断言抓出来的。
 */
function meaningful(closeQuote: string): string {
  const notClose = `[^${closeQuote}]`
  return `${notClose}{6,}|${notClose}*[。！？…，、：；]${notClose}*`
}

/**
 * 「未闭合兜底」规则：匹配"开引号到文末"的内容，**不加意义门槛**。
 *
 * 为什么必须无门槛：流式输出时尾部内容是一点点长出来的。如果这里也要求 ≥6 字，
 * 那么引号出现后的前几个字会是普通文本，等第 6 个字到达才变台词样式 —— 正是我们
 * 要消除的"跳一下"。无门槛后，引号一出现就立刻是台词样式，闭引号到达时外观不变。
 *
 * 短引用（如 `“好”`）仍然不会被误伤：它带闭引号，本规则要求"到文末都不出现闭引号"。
 */
function openRulePattern(openQuote: string, closeQuote: string): string {
  return `${openQuote}([^${closeQuote}]+)$`
}

function sayRule(id: string, name: string, findRegex: string): RegexScript {
  return {
    id,
    scriptName: name,
    findRegex,
    replaceString: `<span class="${DIALOGUE_CLASS}">$1</span>`,
    trimStrings: [],
    placement: [AI_OUTPUT],
    disabled: false,
    // 只影响显示：不进存档、不进上下文（D5）
    markdownOnly: true,
    promptOnly: false,
    runOnEdit: true,
    substituteRegex: 0
  }
}

/**
 * 生成系统正侧的脚本列表（返回新数组/新对象，避免调用方改动污染常量）
 *
 * 顺序有意义：**成对规则必须排在未闭合兜底规则之前**，
 * 否则兜底规则会把"已经配好对的引号 + 后面所有文字"整段吞掉。
 */
export function createSystemRegexScripts(): RegexScript[] {
  return [
    sayRule(
      'sys_dialogue_cn',
      '台词识别（中文双引号，成对）',
      `“(${meaningful('”')})”`
    ),
    sayRule(
      'sys_dialogue_cn_open',
      '台词识别（中文双引号，未闭合兜底）',
      openRulePattern('“', '”')
    ),
    sayRule(
      'sys_dialogue_corner',
      '台词识别（直角引号，成对）',
      `「(${meaningful('」')})」`
    ),
    sayRule(
      'sys_dialogue_corner_open',
      '台词识别（直角引号，未闭合兜底）',
      openRulePattern('「', '」')
    )
  ]
}

export default { SYSTEM_REGEX_PRESET_ID, DIALOGUE_CLASS, createSystemRegexScripts }
