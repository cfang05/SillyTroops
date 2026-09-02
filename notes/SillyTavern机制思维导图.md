# SillyTavern 核心机制思维导图

> 基于 referencecode（SillyTavern 前端源码）逐文件研读整理，配合 `openai.js`/`PromptManager.js`/`world-info.js` 亲自核对。
> 主线：**用户输入 → 宏/正则清洗 → 世界书扫描 → Prompt 组装 → LLM 请求 → 流式渲染 → 存档**。

---

## 一、全局总览（主干数据流）

```
用户点发送
  │
  ├─ 输入侧正则 getRegexedString(text, USER_INPUT=1)
  ├─ 斜杠命令解析/执行（若输入以 / 开头）
  │
  ▼
Generate(type, options, dryRun)          ← 唯一主入口 (script.js)
  type ∈ normal / continue / swipe / regenerate / impersonate / quiet
  │
  ├─ 宏替换 substituteParams() 若干调用点
  ├─ 世界书扫描 getWorldInfoPrompt() → worldInfoBefore / worldInfoAfter / atDepth / outlet / EM 示例
  ├─ 作者注 setFloatingPrompt() → extension_prompts['2_floating_prompt']
  ├─ 扩展注入 extension_prompts / vectors / summary / smart context
  │
  ├─[main_api == 'openai']──► Chat Completion 路径
  │      prepareOpenAIMessages()
  │        ├ preparePromptsForChatCompletion()   ← marker 提示词填充
  │        └ populateChatCompletion()            ← 消息数组按序组装 + token 预算
  │        → sendOpenAIRequest() → POST /api/backends/chat-completions/generate (SSE 流式)
  │
  └─[其它 API]──► Text Completion 路径
         storyString + 示例 + chatString 纯字符串拼接（instruct 模板）
         → 对应后端 API
  │
  ▼
流式接收 (sse-stream.js → StreamingProcessor → updateMessageBlock)
  │
  ├─ 输出侧正则 getRegexedString(text, AI_OUTPUT=2)
  ├─ Markdown 渲染 messageFormatting() (Showdown + DOMPurify)
  └─ 写入 chat JSONL 存档（消息 + swipes + chat_metadata）
```

---

## 二、角色卡系统（Character Card）

### 2.1 运行时结构（characters[]，v1 结构）
- 基础字段：`name` / `description` / `personality` / `scenario` / `first_mes` / `mes_example` / `creatorcomment` / `tags[]` / `talkativeness` / `fav` / `create_date`
- ST 附加字段：`chat`(当前聊天文件名) / `avatar`(头像文件名，**唯一标识**) / `json_data` / `shallow`(懒加载) / `data`(v2 卡)

### 2.2 V2 卡 data 层（char-data.js 权威定义）
- `name` / `description` / `character_version` / `personality` / `scenario` / `first_mes` / `mes_example` / `creator_notes` / `tags[]` / `system_prompt` / `post_history_instructions` / `creator` / `alternate_greetings[]` / `character_book` / `extensions`

### 2.3 V2 卡 extensions 层
- `talkativeness` / `fav` / `world` / `depth_prompt{prompt,depth,role}` / `regex_scripts[]`
- 外部来源：`pygmalion_id` / `chub{full_path}` / `risuai{source[]}` / `github_repo` / `source_url` / `sd_character_prompt`

### 2.4 character_book（内嵌世界书）
- `{name, entries[]}`；条目：`keys[]` / `secondary_keys[]` / `content` / `constant` / `selective` / `insertion_order` / `enabled` / `position` / `extensions` / `id`
- 导入时 `convertCharacterBook()` 映射为 ST 世界书条目

### 2.5 PNG 导入导出数据流
- 魔数校验 `0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A` → 逐 chunk 解析 → 找 `tEXt` 块且 key 以 `chara` 开头 → 跳过 NUL 分隔符 → `atob` base64 → `JSON.parse`
- 前端只上传/下载，实际由服务端 `/api/characters/import`、`/api/characters/export` 完成
- `extractDataFromPng(data, identifier='chara')` 也被 Naid 世界书（`naidata`）复用

---

## 三、Persona（用户角色）系统

- 数据：`power_user.personas{avatarId: 名字}` + `persona_descriptions{avatarId: {description, position, depth, role, lorebook, title}}`
- 当前选中 = `user_avatar` + `persona_description`
- 支持：锁定（chat/character/default 三级，`PersonaLockType`）、连接（character/group，`persona_connections`）、默认 persona（`default_persona`）
- `persona_description_position` 枚举：`IN_PROMPT(0)` / `AFTER_CHAR(1, 弃用)` / `TOP_AN(2)` / `BOTTOM_AN(3)` / `AT_DEPTH(4)` / `NONE(9)`；`persona_description_role`(0=system/1=user/2=assistant)、`persona_description_depth`(默认 2)
- 注入：`persona_description_position === IN_PROMPT` 时作为 `personaDescription` marker 注入
- 用户消息 `force_avatar` 指向 persona 头像；`syncUserNameToPersona()` 可批量改名；`convertCharacterToPersona()` 角色卡↔persona 转换

---

## 四、群聊系统（Group Chat）

- **激活策略**：NATURAL（提词 + 话痨度掷骰）/ LIST / MANUAL / POOLED
- **生成模式**：SWAP（单卡轮换）/ APPEND（合并全员卡 + join_prefix/suffix 前缀）/ APPEND_DISABLED（同 APPEND 但禁用成员仍计入卡、不发言）
- 消息带 `original_avatar` + `force_avatar` + `extra.gen_id` 定位发言人；`group_generation_id = Date.now()` 为批次号
- talkativeness（话痨度 0-1，默认 0.5）控制 NATURAL 模式下谁插话；`bannedUser`(上一条发言者) 默认禁止连发，除非 `allow_self_responses`

---

## 五、会话 / 聊天系统（Chat）

- **存储格式**：JSONL，首行为 header（`chat_metadata`），之后每行一条消息 JSON
- **消息字段**：`name` / `is_user` / `is_system` / `mes` / `send_date` / `force_avatar` / `original_avatar` / `swipes[]` / `swipe_id` / `swipe_info[]` / `extra`
- **Branch（分支）**：快照另存新聊天并跳转（记入 `extra.branches`）
- **Checkpoint（检查点）**：快照另存不跳转（记入 `extra.bookmark_link`，`main_chat` 记录主聊天）
- **Swipe（滑动）**：同一条用户消息对应多个 AI 候选回复，存于 `swipes[]`，可左右切换

### chat_metadata 关键字段
- `integrity` / `tainted` / `scenario` / `system_prompt`
- `variables`（局部变量）/ `timedWorldInfo`（限时世界书）/ `chat_id_hash` / `main_chat` / `pick_reroll_seed`
- `attachments` / `lastInContextMessageId` / `note_*`（作者注）

---

## 六、标签系统（Tags）

- 全局 `tags[]`（Tag 定义）+ `tag_map{entityKey: tagId[]}`（entityKey = 角色 avatar 或群 id）
- 卡片 `data.tags[]` 按 `tag_import_setting` 导入：ASK / NONE / ALL / ONLY_EXISTING
- `folder_type`（OPEN/CLOSED/NONE）实现伪文件夹

---

## 七、预设系统（Preset）

- 每类 API 一个 `PresetManager`（presetManagers[apiId]）：kobold / novel / textgenerationwebui / openai + 高级格式化 context/instruct/sysprompt/reasoning + srw
- **预设 JSON 结构**：该 API 设置快照（采样参数等）+ 可选 `extensions` 字段（如 `extensions.regex_scripts`）
- 服务端接口 `/api/presets/save | delete | restore`
- 扩展字段：`readPresetExtensionField({name,path})` / `writePresetExtensionField({name,path,value})`（lodash 点路径）
- 导入按 `isPossiblyXxxData` 嗅探类型；"Master Import/Export" 聚合多 section
- `CHAT_CHANGED` 时按角色/群名 `autoSelectPreset` 自动选预设

---

## 八、Prompt 构建 & 生成链路（核心主干）

### 8.1 主入口与两条路径
- `Generate(type, options, dryRun)`；`dryRun=true` 只组装+计 token 不发请求（Prompt Manager 预览用）
- **Chat Completion**（openai）：messages 数组
- **Text Completion**（其它）：storyString + 示例 + chatString 纯字符串拼接

### 8.2 PromptManager 与 Prompt 类
- Prompt 字段：`identifier` / `role` / `content` / `name` / `system_prompt` / `position` / `injection_depth` / `injection_position` / `forbid_overrides` / `extension` / `injection_order` / `injection_trigger` / `marker`
- `INJECTION_POSITION`：`RELATIVE=0`（按 injection_depth 从末尾倒数插入）、`ABSOLUTE=1`（按 injection_order 绝对顺序）
- 全局 prompt_order 挂在 dummy 角色 `id=100001`

### 8.3 marker 提示词（运行时填充的占位符）
| identifier | 填充内容 |
|---|---|
| `main` | 主 system prompt |
| `nsfw` | 辅助 prompt |
| `jailbreak` | Post-History Instructions |
| `dialogueExamples` | 对话示例（mes_example） |
| `chatHistory` | 聊天历史 |
| `worldInfoBefore` / `worldInfoAfter` | 世界书前/后 |
| `enhanceDefinitions` | 增强定义指令 |
| `charDescription` | 角色描述 |
| `charPersonality` | 角色性格 |
| `scenario` | 角色情景 |
| `personaDescription` | Persona 描述 |

### 8.4 消息组装顺序（populateChatCompletion，Chat Completion 路径）
1. `reserveBudget(3)`（回复首标记）
2. `worldInfoBefore` → `main` → `worldInfoAfter` → `charDescription` → `charPersonality` → `scenario` → `personaDescription`
3. controlPrompts（`impersonate` / `quietPrompt`，恒最后）
4. `nsfw` / `jailbreak`
5. 用户相对提示词（非 system_prompt 且非 ABSOLUTE）
6. `enhanceDefinitions`
7. `bias`
8. 扩展注入（summary / authorsNote / vectorsMemory / vectorsDataBank / smartContext，相对 main）
9. continue prefill（续写时）
10. `populationInjectionPrompts`（ABSOLUTE 提示词 → in-chat 注入）
11. 对话示例 + 聊天历史（`pin_examples` 决定先后）
12. controlPrompts 追加

### 8.5 token 预算
- `setTokenBudget(openai_max_context, openai_max_tokens)` → `tokenBudget = context − response`
- 每个 Message 创建即计 token（`countTokensOpenAIAsync`，POST /api/tokenizers/openai/count，逐条缓存）
- `reserveBudget / freeBudget / canAfford / insertAtStart / insertAtEnd`

### 8.6 宏替换调用点
- `promptManager.preparePrompt`（每个 prompt 注入时）
- `substituteParams`：sendMessageAsUser / quiet prompt / chat[0].mes / getExtensionPrompt / renderStoryString / instruct 序列等
- 新引擎 `MacroEngine` / `MacroEnvBuilder`（开关 `power_user.experimental_macro_engine`）

---

## 九、世界书引擎（World Info）

### 9.1 枚举
- `world_info_logic`：`AND_ANY=0` / `NOT_ALL=1` / `NOT_ANY=2` / `AND_ALL=3`
- `world_info_position`：`before=0` / `after=1` / `ANTop=2` / `ANBottom=3` / `atDepth=4` / `EMTop=5` / `EMBottom=6` / `outlet=7`
- `scan_state`：`NONE=0` / `INITIAL=1` / `RECURSION=2` / `MIN_ACTIVATIONS=3`

### 9.2 条目字段（40+，extensions 承载大部分）
- 基础：`keys[]` / `secondary_keys[]` / `content` / `constant` / `selective` / `insertion_order` / `enabled` / `position` / `comment` / `id`
- 匹配增强：`scan_depth` / `case_sensitive` / `match_whole_words` / `automation_id`
- 递归/概率/分组/预算：`exclude_recursion` / `prevent_recursion` / `delay_until_recursion` / `probability` / `useProbability` / `group` / `group_override` / `group_weight` / `use_group_scoring` / `depth` / `role` / `ignore_budget` / `vectorized` / `display_index`
- 限时：`sticky` / `cooldown` / `delay`
- globalScanData 开关：`match_persona_description` / `match_character_description` / `match_character_personality` / `match_character_depth_prompt` / `match_scenario` / `match_creator_notes`

### 9.3 WorldInfoBuffer（扫描缓冲区）
- `depthBuffer`（历史消息，`'\x01'` 分隔跨消息边界）/ `recurseBuffer`（递归命中内容）/ `injectBuffer` / `globalScanData` / `skew` / `startDepth`
- `get(entry, scanState)`：历史切片 + 6 个 match_* 来源 + injectBuffer + recurseBuffer（MIN_ACTIVATIONS 排除 recurseBuffer）
- `matchKeys`：`/regex/flags` 形式优先；否则整词（`(?:^|\W)` 边界）或 includes；大小写由条目 `caseSensitive ??` 全局
- `getScore`：按 selectiveLogic 计分（AND_ANY 加分 / AND_ALL 全中才加分）
- `advanceScan/getDepth`：min activations 的 skew 机制（每轮深度 +1）

### 9.4 checkWorldInfo 状态机（主循环）
- 预算 = round(budget% × maxContext) || 1
- `getSortedEntries`（全局/角色/聊天/人设四源并行加载、去重、插入策略排序、parseDecorators、getStringHash）
- `timedEffects.checkTimedEffects()`（清理过期限时效果）
- **while(scanState) 循环**，每轮：
  1. 跳过链：disable / triggers / characterFilter / 延迟 / 冷却 / 递归开关 / 装饰器 / 外部激活 / constant / sticky / 无 key
  2. 主 key（substituteParams 后 matchKeys）
  3. 次 key 按 selectiveLogic 判定
  4. 排序（sticky 优先）
  5. `filterByInclusionGroups`（sticky 获胜 / 组计分 / groupOverride / groupWeight 加权随机）
  6. `verifyProbability`（Math.random×100）
  7. 预算检查（溢出即停收新条目，非截断；并禁止递归与 min-activations 续扫）
  8. 决定下一状态：递归优先 → MIN_ACTIVATIONS → 延迟递归层
  9. 每轮发 `WORLDINFO_SCAN_DONE`（监听者可改写 state.next 等）
- 收敛后按 position 分桶（unshift，outlet 用 push）
- `getRegexedString(placement=WORLD_INFO=5, isPrompt:true)`
- AN 回写 → setTimedEffects

### 9.5 WorldInfoTimedEffects（限时效果）
- 持久化于 `chat_metadata.timedWorldInfo{sticky:{}, cooldown:{}}`
- key = `${world}.${uid}`，value = `{hash, start, end, protected}`
- `end = chat.length + N`；delay 不持久化
- swipe 回滚保护（聊天未推进且非 protected 则删除）
- sticky 到期若配 cooldown 则自动接 protected cooldown

### 9.6 outlet 与 atDepth
- outlet：position=7 + outletName → `WIOutletEntries[name][]` → `CUSTOM_WI_OUTLET(name)` 分发
- atDepth：按 (depth, role) 聚合为 `WIDepthEntries` → `CUSTOM_WI_DEPTH_ROLE(depth, role)` IN_CHAT 注入

---

## 十、宏系统（Macro System）

### 10.1 引擎流水线
```
MacroEngine.evaluate
  → pre-processors（旧语法兼容改写）
  → MacroParser（chevrotain Lexer 模式状态机 + CstParser 生成 CST）
  → MacroCstWalker（CST 解释执行，构造 MacroCall、scoped 配对、变量简写求值）
  → MacroRegistry.executeMacro（arity/类型校验 → handler → normalize）
  → post-processors
```
- `MacroEnvBuilder` 构建环境 `env`：content / contentHash / names{user,char,group,groupNotMuted,notChar} / character 懒加载字段 / system.model / functions.original 一次性 / postProcess / dynamicMacros / extra

### 10.2 语法
- 调用形式：`{{name}}` / `{{name arg}}` / `{{name:arg}}` / `{{name::a::b}}` / list 宏任意数量 / 参数内可嵌套
- scoped：`{{name}}…{{/name}}`，内容作最后无名参数，默认 trim+去缩进，`#` flag 保留空白
- flags：`!` `?` `~` 未实现；`>` 仅解析；`/`（关闭块）、`#`（保留空白）已实现
- 命名参数（`=`、`"`）已词法捕获但 `namedArgs` 恒 null（预留）
- 变量简写 `{{.var}}` / `{{$var}}` + 17 种运算符（`++ -- = += -= || ?? ||= ??= == != > >= < <=`）
- 宏名大小写不敏感；标识符 `/^[a-zA-Z][\w-_]*$/`；`//` 为注释宏；未注册宏保留原文；`\{ \}` 转义

### 10.3 内置宏（按 MacroCategory）
- **utility**：space / newline / noop / trim / if / else / input / reverse / comment(//) / banned / outlet
- **random**：random（每次随机）/ pick（确定性种子 = chatIdHash-contentHash-globalOffset-rerollSeed）/ roll（droll 骰子）
- **names**：user / char / group / groupNotMuted / notChar / charIfNotGroup（隐藏别名）
- **character**：charPrompt / charVersion / persona / mesExamples / greeting / original（一次性）
- **chat**：lastMessage 系列 / swipe / allChatRange
- **time**：time / date / weekday / isotime / isodate / datetimeformat / idleDuration / timeDiff
- **variable**：setvar / getvar / addvar / incvar / decvar / hasvar / deletevar + 全部 global 版及别名（varexists/flushvar）
- **prompts**：instruct* 模板 / systemPrompt / exampleSeparator / chatStart
- **state**：lastGenerationType / hasExtension / model / isMobile / maxPrompt / maxContext / maxResponse
- `{{if}}` 用 delayArgResolution 只求值命中分支；`{{else}}` 返回 ELSE_MARKER 由 if 拆分

### 10.4 legacy macros.js
- 三批正则替换（preEnv→env→postEnv）；`MacrosParser` 已 @deprecated 并桥接到新注册表
- 旧写法（`<USER>`、`{{time_UTC-10}}`、`{{trim}}`、`{{random:a,b}}`、`{{roll 1d6}}`）由新引擎 pre/post-processors 与兼容 handler 承接

---

## 十一、变量系统（Variables）

- 局部变量：`chat_metadata.variables`（随聊天，saveMetadataDebounced）
- 全局变量：`extension_settings.variables.global`（随用户，saveSettingsDebounced）
- API 双轨：函数级（get/set/add/inc/dec/exists/delete）+ 上下文级 `ctx.variables.local/global{get,set,del,add,inc,dec,has}`
- 数值 vs 字符串：get 可解析即转 Number；add 数组 push > 数值相加 > 字符串拼接；inc/dec = add(±1)

---

## 十二、正则脚本（Regex Scripts）

### 12.1 三类型（执行优先级）
- `GLOBAL=0`（extension_settings.regex，settings.json）
- `SCOPED=1`（角色卡 data.extensions.regex_scripts）
- `PRESET=2`（预设文件 extensions.regex_scripts）
- 白名单：SCOPED 需 character_allowed_regex 含角色 avatar；PRESET 需 preset_allowed_regex[apiId] 含预设名（防陌生人注入）

### 12.2 placement 枚举
- `MD_DISPLAY=0`（废弃）/ `USER_INPUT=1` / `AI_OUTPUT=2` / `SLASH_COMMAND=3` / `4`(sendAs 遗留) / `WORLD_INFO=5` / `REASONING=6`

### 12.3 字段
- `id` / `scriptName` / `findRegex` / `replaceString` / `trimStrings[]` / `placement[]` / `disabled` / `markdownOnly` / `promptOnly` / `runOnEdit` / `substituteRegex`(NONE=0/RAW=1/ESCAPED=2) / `minDepth` / `maxDepth`

### 12.4 执行流程
- `getRegexedString(text, placement, {isMarkdown, isPrompt, isEdit, depth})`：逐个过滤 + 串行链式替换
- 过滤：markdownOnly∧isMarkdown ∨ promptOnly∧isPrompt ∨（两者假且非 md/prompt 场景）；runOnEdit；深度 [minDepth,maxDepth]；placement 包含
- `RegexProvider` 以正则字符串为 key 做 LRU(1000) 编译缓存；`regexFromString` 支持 `/pattern/flags`
- **函数替换**：`{{match}}`→`$0`；`/\$(\d+)|\$<([^>]+)>/g` 取编号/具名捕获组；捕获值先 filterString（trimStrings 删除）再整体 substituteParams

---

## 十三、作者注（Author's Note）

- 数据：chat_metadata `note_prompt / note_interval / note_depth / note_position / note_role`
- 角色注：`extension_settings.note.chara[] = {name, prompt, useChara, position}`
- 位置枚举（extension_prompt_types）：`0=IN_PROMPT`（场景后）/ `1=IN_CHAT`（按深度嵌历史）/ `2=BEFORE_PROMPT`（场景前）
- 角色注自身 position：`replace=0 / before=1 / after=2`
- 触发频率：统计用户消息数 N，`interval==1` 强制；否则 `N % interval == 0` 时插入
- 注入：`setFloatingPrompt()` → `context.setExtensionPrompt('2_floating_prompt', ...)` → 生成时 `getExtensionPrompt(position, depth, role)` → PromptManager 注入
- 宏：`{{authorsNote}}` / `{{charAuthorsNote}}` / `{{defaultAuthorsNote}}`

---

## 十四、斜杠命令（Slash Commands）

- 全局表 `SlashCommandParser.commands = {name: SlashCommand}`；`initDefaultSlashCommands()` 注册约 200 个
- 注册：`SlashCommand.fromProps({name, callback, helpString, aliases, returns, namedArgumentList, unnamedArgumentList, splitUnnamedArgument, rawQuotes})`
- **解析器**：手写字符流，单遍扫描产出闭包树；语法元素 `/name`、`key=value`、闭包 `{:...:}`、管道 `|`、`||`、注释 `/##`、块注释 `/* *|`、`/parser-flag`、`/:`、`/breakpoint`、`/break`、宏 `{{...}}`
- **作用域 SlashCommandScope**：父子链；`letVariable`（本层）/ `setVariable`（向上找）/ `getVariable`（支持索引）；闭包执行前深拷贝可重复运行
- 参数类型：string / number / range / bool / varname / closure / subcommand / list / dictionary
- 典型命令：/send / /sendas / /sys / /gen / /genraw / /impersonate / /swipe / /continue / /char-* / /member-* / /let / /setvar / /getvar / /run / /echo / /regex* / /note*

---

## 十五、扩展系统（Extensions）

### 15.1 manifest 与生命周期
- 目录 `scripts/extensions/<name>/`；`discoverExtensions()` → `getManifests()` → `activateExtensions()`
- manifest 字段：`display_name / loading_order / requires / dependencies / optional / js / css / author / version / homePage / auto_update / minimum_client_version / hooks{install/update/delete/clean/enable/disable/activate}`
- 激活条件：最低客户端版本、requires ⊆ 已连模块、dependencies 存在且未禁用、不在 disabledExtensions
- 数据三处：全局 `extension_settings` / 角色卡 `data.extensions.*` / 预设 `extensions.*`
- API 面 `getContext()`（st-context.js）

### 15.2 事件系统（events.js）
- `event_types`：100+ 常量（APP_INITIALIZED/APP_READY、GENERATION_STARTED/STOPPED/ENDED、MESSAGE_SENT/RECEIVED/EDITED/SWIPED、CHAT_CHANGED、SETTINGS_LOADED/UPDATED、CHARACTER_*、PRESET_*、STREAM_TOKEN_RECEIVED、WORLDINFO_SCAN_DONE 等）
- `eventSource`：on/once/removeListener/makeFirst/makeLast/emit/emitAndWait
- **autoFireAfterEmit**：APP_READY 等事件记住最近参数，后注册监听器立即重放（不漏初始化前注册的扩展）
- emit 顺序 await，单监听器异常隔离

---

## 十六、消息渲染（Rendering）

### 16.1 Markdown 管线（messageFormatting）
1. 首条消息 substituteParams 宏替换
2. 非系统消息按角色取 placement（REASONING / USER_INPUT / SLASH_COMMAND(narrator) / AI_OUTPUT）→ getRegexedString(isMarkdown:true, depth)
3. `auto_fix_generated_markdown` → fixMarkdown 补全未闭合标记
4. encode_tags 转义 `<` `>`
5. 引号增强：`"" «» 「」 『』` → `<q>`
6. Showdown `converter.makeHtml`（emoji / tables / underline / strikethrough / 自定义扩展 markdownUnderscoreExt、markdownExclusionExt）
7. code 块换行 / &amp; 修复
8. encodeStyleTags → DOMPurify.sanitize → decodeStyleTags（`<custom-style>`↔`<style>`）

### 16.2 流式显示
- `sse-stream.js`：EventSourceStream（SSE 解析）+ SmoothEventSourceStream（按 smooth_streaming_speed 字符级延迟，标点更慢）
- script.js：StreamingProcessor 边收边渲染，每 token emit(STREAM_TOKEN_RECEIVED)，updateMessageBlock 增量刷新
- `streaming-display.js`：浮动面板（LED 状态灯 / 最小化 / Stop 按钮），复用 messageFormatting

### 16.3 系统消息
- `system_message_types`：help / welcome / empty / generic / narrator / comment / slash_commands / formatting / hotkeys / macros / welcome_prompt / assistant_note / assistant_message
- slash_commands / macros 类型渲染成可搜索的浏览器组件

---

## 十七、后端 / 连接（Backends & Streaming）

- 支持 API：Kobold / Novel / textgenerationwebui / OpenAI 兼容（含 Claude / Gemini / OpenRouter / DeepSeek 等）
- Chat Completion 请求：POST `/api/backends/chat-completions/generate`（stream 分支 yield {text, swipes, logprobs, toolCalls, state}）
- tokenizer：POST `/api/tokenizers/openai/count`（逐条缓存）
- 最终消息格式：`getChat()` → `[{role, content, name?, tool_calls?, tool_call_id?, signature?, reasoning?}]`

---

## 十八、其它

- **data-maid.js（数据清理）**：POST `/api/data-maid/report` 扫描 → 9 类孤儿文件/缩略图/备份 → `/api/data-maid/finalize` 删除
- **chat-backups.js（备份）**：`.jsonl` 逐行 JSON；viewBackup / restoreBackup / deleteBackup；服务端自动定时备份

---

## 附：关键联动关系（画图要点）

1. **regex_placement** 贯穿渲染（messageFormatting）与 prompt 组装两条链路
2. **正则三类型**与「settings / 角色卡 / 预设」三处存储一一对应
3. **作者注**本质是 `extension_prompts` 的一个注入项（position/depth/role 三轴定位）
4. **斜杠命令**是内置与扩展共用的注册入口（全局命令表 + 帮助 + 自动补全）
5. **扩展生命周期**由 `eventSource`（autoFireAfterEmit 重放）串联；预设 `extensions.*` 是扩展跨预设持久化桥梁
6. **世界书**四源（全局/角色/聊天/人设）并行加载，结果经 marker（worldInfoBefore/After）+ 深度注入（atDepth）+ 出口（outlet）三路进入 prompt
7. **宏替换**贯穿：角色卡字段 → marker 填充 → 世界书 key/content → 作者注 → 正则 replaceString → 消息渲染，是全局最底层的字符串基础设施
