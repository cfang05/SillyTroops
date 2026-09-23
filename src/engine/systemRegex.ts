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
 * 早期版本写成 `{6,}`（漏了字符类）会被 JS 当作字面量 `{6,}`，规则永远匹配不到。
 *
 * ⚠️ 字符类里**必须排除换行**（`\n`）：`[^”]` 默认会跨行匹配，导致
 * 第二条分支 `[^”]*[。！？…，、：；][^”]*` 从**上一行的闭引号**一路吞过来 ——
 * 多行连续对话时会把已经包好的 `<span class="say">` 撕碎（实测：
 * `“A” 甲:\n“B” 乙:` 的第二条匹配 `match[1]` 会以 `\n“B”` 开头）。
 * 台词本来就应以行为单位，排除换行既修了这个 bug，也更符合原意。
 *
 * ⚠️ 返回值用 `(?:…)` **整体包住**：里面是一个 `|` 交替，调用方常把它嵌进更大的模式
 * （例如 `(?<!…)(名字：)?(模式)`）。不包住的话，交替的**第二条分支会跑到外层断言之外**，
 * 断言就只保护了一半匹配 —— 实测表现为标签被截断成 `…！</span>` 加一个落单的闭引号。
 */
function meaningful(closeQuote: string): string {
  // 必须同时排除 `\r` 和 `\n`：源文本常见 `\r\n`，只排 `\n` 的话 `\r` 仍能匹配，照样跨行
  const notClose = `[^${closeQuote}\\r\\n]`
  return `(?:${notClose}{6,}|${notClose}*[。！？…，、：；]${notClose}*)`
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
  return `${openQuote}([^${closeQuote}\\r\\n]+)$`
}

/**
 * 构造一条"包台词"规则。
 *
 * `guarded` 为 true 时加后行断言，使规则**幂等**（同一次生成里存档态、显示态各跑一遍，
 * 没有这道断言就会把 `<span class="say">` 套成两层）。
 * 引擎不支持后行断言时退回不带断言（与原行为一致）。
 */
function sayRule(
  id: string,
  name: string,
  findRegex: string,
  replaceString: string,
  guarded = true
): RegexScript {
  return {
    id,
    scriptName: name,
    findRegex: guarded && LOOKBEHIND_SUPPORTED ? wrapGuard() + findRegex : findRegex,
    replaceString,
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

/** 已经包好的台词不再重复命中（保证规则幂等） */
function wrapGuard(): string {
  return `(?<!<span class="${DIALOGUE_CLASS}">)`
}

/**
 * 后行断言支持检测。
 *
 * 为什么需要：这几条规则在**一次生成里会被应用两次**（存档态 `MessageProcessor` 跑一次，
 * 显示态 `chat.vue._segmentsFor` 再跑一次），所以必须幂等 —— 靠 `wrapGuard()` 挡住
 * 已经包过的台词。后行断言需要 Chrome 62+ / Firefox 78+ / Safari 16.4+；
 * 不支持时**宁可不生成**这几条规则（退回改造前的行为），也不要生成一条会被反复命中的规则。
 */
const LOOKBEHIND_SUPPORTED = (() => {
  try {
    // eslint-disable-next-line no-new
    new RegExp(wrapGuard() + 'x')
    return true
  } catch (e) {
    return false
  }
})()

/** 成对引号：**保留引号本身**包进 span（引号也一起变金色，见用户反馈） */
function pairReplace(open: string, close: string): string {
  return `<span class="${DIALOGUE_CLASS}">$0</span>`
}

/** 未闭合兜底：只保留已经出现的那一侧引号 */
function openReplace(open: string): string {
  return `<span class="${DIALOGUE_CLASS}">$0</span>`
}

/**
 * 「说话人名字写在引号**之前**」的形态：`饭田: “台词”` / `饭田:` 换行 `“台词”`。
 *
 * 为什么要单独一条：名字在引号之前时，包台词的那一步会在名字**之后**插入
 * `<span class="say">`，于是渲染节点变成「台词 → 名字」（同样是错位，只是方向相反）。
 * 这条规则不改顺序，只是把名字**一起纳入匹配**，让替换结果保持「名字在前、台词在后」：
 *     `饭田: “台词”`  →  `饭田:` + 换行 + `<span class="say">“台词”</span>`
 */
function pairRuleWithLeadingName(
  id: string,
  name: string,
  open: string,
  close: string
): RegexScript {
  // 名字里**不能**出现引号、换行、冒号：
  //   · 引号会吞掉台词本身；
  //   · 换行会让"上一行行尾的 `饭田:`"被当成本行台词的说话人而跨行匹配（实测会把两行压成一行）；
  //   · 冒号会让贪婪匹配把 `甲: 乙:` 整个吃进去。
  const speaker = `[^“”「」\\r\\n：:]{1,24}:`
  return {
    id,
    scriptName: name,
    // 用 `(?:^|\n)` 锚定**行首**：
    //   不加锚点时，`名字:` 可以从任意位置开始匹配，于是"上一行行尾的闭引号 + 本行台词"
    //   会被当成一个整体被重新包一遍，顺序就被打乱（实测多行连续对话时第 2 行起顺序反转）。
    //   锚点要求名字必须是某一行的开头，多行场景才不会互相串。
    //   注意 `meaningful()` **不含**闭引号，闭引号要显式补一次。
    findRegex: `${wrapGuard()}(^|\\n)[ \\t]*(${speaker})[ \\t]*(?:\\r?\\n)?[ \\t]*(${open}${meaningful(close)}${close})`,
    replaceString: `$1$2\n<span class="${DIALOGUE_CLASS}">$3</span>`,
    trimStrings: [],
    placement: [AI_OUTPUT],
    disabled: false,
    markdownOnly: true,
    promptOnly: false,
    runOnEdit: true,
    substituteRegex: 0
  }
}

/**
 * 「说话人名字写在引号之后」的形态：`“台词” 饭田:` / `“台词”\n饭田:`。
 *
 * 为什么必须处理（实测复现的错位 bug，见 `scripts/tmp-repro-misorder.mjs`）：
 *   系统正侧把台词包成独立的 HTML 片段后，`BlockParser.splitProseAndBlocks` 会把它渲染成
 *   **一个独立的块**：
 *     `“台词” 饭田:`  → 节点 [0] html-inline(台词) → 节点 [1] narrative(饭田:)   ← 名字跑到后面
 *   即：跟在引号之后的说话人名字会被落到台词块**之后**，看起来就是
 *   「发言人的名字出现在发言内容的后一行」。
 *
 * 修法：把名字**消费掉并提到片段之前、单独占一行** ——
 *     `“台词” 饭田:`  →  `饭田:` + 换行 + `<span class="say">“台词”</span>`
 * 这样渲染顺序是「名字 → 台词」，也正是我们希望模型从历史里学到的形态。
 *
 * 三个必须注意的实现细节（都踩过）：
 *   1. 名字用**捕获组真正消费**，不用前瞻。前瞻写法会让被匹配到的引号留在原地，
 *      于是这条规则第二次应用时**还能再次命中**（存档态跑一次、显示态又跑一次），
 *      结果把 span 套两层、名字复制成 `饭田: 饭田:`。
 *   2. 整段台词用 `$1` 捕获后**原样回填**（不用 `$0`，因为 `$0` 不含后面的名字）。
 *   3. 加后行断言 `wrapGuard()` 保证幂等；老引擎不支持时由调用方跳过这条规则。
 */
function pairRuleWithTrailingName(
  id: string,
  name: string,
  open: string,
  close: string
): RegexScript {
  // 名字里不允许出现引号/换行，避免把后面的台词或后续行吞进来
  // 名字里**不能**出现引号、换行、冒号：
  //   · 引号会吞掉台词本身；
  //   · 换行会让"上一行行尾的 `饭田:`"被当成本行台词的说话人而跨行匹配（实测会把两行压成一行）；
  //   · 冒号会让贪婪匹配把 `甲: 乙:` 整个吃进去。
  const speaker = `[^“”「」\\r\\n：:]{1,24}:`
  return {
    id,
    scriptName: name,
    // 名字前后的空白与换行都吃掉，替换时统一用一个换行分隔
    findRegex: `${wrapGuard()}(${open}${meaningful(close)}${close})[ \\t]*(?:\\r?\\n)?[ \\t]*(${speaker})`,
    replaceString: `$2\n<span class="${DIALOGUE_CLASS}">$1</span>`,
    trimStrings: [],
    placement: [AI_OUTPUT],
    disabled: false,
    markdownOnly: true,
    promptOnly: false,
    runOnEdit: true,
    substituteRegex: 0
  }
}

/**
 * 生成系统正侧的脚本列表（返回新数组/新对象，避免调用方改动污染常量）
 *
 * 顺序有意义：
 *   1. **成对规则必须排在未闭合兜底规则之前**，否则兜底规则会把"已经配好对的引号 +
 *      后面所有文字"整段吞掉；
 *   2. **「名字 + 台词」这两条带名字的规则排在最前**：它们命中时会把名字一起消费掉并
 *      归一成「名字在前、台词在后」，后面的普通成对规则就不会再重复包同一段。
 *      「名字在前」那条还要排在「名字在后」之前（否则后者会先吃掉引号）。
 *   3. 引擎不支持后行断言时（老 Safari），这几条带守卫的规则**直接不生成** ——
 *      宁可退回改造前的行为，也不要生成一条会被反复命中的规则（那会把 span 套多层）。
 */
export function createSystemRegexScripts(): RegexScript[] {
  // 不支持后行断言时，这四条带守卫的规则直接不生成（退回改造前的行为，见函数注释第 3 点）
  const nameRules: RegexScript[] = LOOKBEHIND_SUPPORTED
    ? [
      pairRuleWithLeadingName('sys_dialogue_cn_name_first', '台词识别（中文双引号，名字在引号前 → 保持在前）', '“', '”'),
      pairRuleWithTrailingName('sys_dialogue_cn_name_last', '台词识别（中文双引号，名字在引号后 → 提到前面）', '“', '”')
    ]
    : []
  const cornerNameRules: RegexScript[] = LOOKBEHIND_SUPPORTED
    ? [
      pairRuleWithLeadingName('sys_dialogue_corner_name_first', '台词识别（直角引号，名字在引号前 → 保持在前）', '「', '」'),
      pairRuleWithTrailingName('sys_dialogue_corner_name_last', '台词识别（直角引号，名字在引号后 → 提到前面）', '「', '」')
    ]
    : []

  return [
    ...nameRules,
    sayRule(
      'sys_dialogue_cn',
      '台词识别（中文双引号，成对）',
      `“(${meaningful('”')})”`,
      pairReplace('“', '”')
    ),
    sayRule(
      'sys_dialogue_cn_open',
      '台词识别（中文双引号，未闭合兜底）',
      openRulePattern('“', '”'),
      openReplace('“')
    ),
    ...cornerNameRules,
    sayRule(
      'sys_dialogue_corner',
      '台词识别（直角引号，成对）',
      `「(${meaningful('」')})」`,
      pairReplace('「', '」')
    ),
    sayRule(
      'sys_dialogue_corner_open',
      '台词识别（直角引号，未闭合兜底）',
      openRulePattern('「', '」'),
      openReplace('「')
    )
  ]
}

export default { SYSTEM_REGEX_PRESET_ID, DIALOGUE_CLASS, createSystemRegexScripts }
