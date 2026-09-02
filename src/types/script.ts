// src/types/script.ts
// 正则脚本类型定义，参考 referencecode/char-data.js 中的 RegexScriptData JSDoc

/**
 * placement 枚举含义 —— 注意：这是本项目内部精简后的编号，与酒馆原始 regex_placement 编号不同！
 * 酒馆原始编号（referencecode/public/scripts/extensions/regex/engine.js）：
 *   MD_DISPLAY=0, USER_INPUT=1, AI_OUTPUT=2, SLASH_COMMAND=3, WORLD_INFO=5, REASONING=6
 * 本项目内部编号（RegexScriptEngine 只在两处调用：清洗用户输入 / 清洗 AI 回复）：
 * 0 = AI 输出（对应酒馆 AI_OUTPUT=2）
 * 1 = 用户输入（对应酒馆 USER_INPUT=1）
 * 2 = 世界信息内容（对应酒馆 WORLD_INFO=5）
 * 3 = 推理内容 reasoning（对应酒馆 REASONING=6）
 *
 * 从酒馆预设 JSON 导入正则脚本时，必须先用 PresetImporter.ts 里的 ST_TO_INTERNAL_PLACEMENT
 * 做一次编号转换，否则脚本的 placement 数组里存的是酒馆原始编号，会导致
 * RegexScriptEngine.applyRegexScripts() 用内部编号去匹配时永远匹配不上（脚本形同摆设）。
 */
export type RegexPlacement = 0 | 1 | 2 | 3

export interface RegexScript {
  id: string
  scriptName: string
  findRegex: string
  /** 仅支持静态字符串替换或 $1/$2 反向引用，不支持函数替换（小程序无 eval） */
  replaceString: string
  trimStrings?: string[]
  placement: RegexPlacement[]
  disabled: boolean
  markdownOnly?: boolean
  promptOnly?: boolean
  runOnEdit?: boolean
  minDepth?: number
  maxDepth?: number
  /** findRegex 的宏替换策略：0=NONE 1=RAW 2=ESCAPED（对齐酒馆 substitute_find_regex） */
  substituteRegex?: number
}