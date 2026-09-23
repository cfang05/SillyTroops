# 酒馆对齐修复记录（Prompt 链路）

> 对照对象：`referencecode/public/scripts/PromptManager.js`、`referencecode/public/script.js`、
> `referencecode/public/scripts/openai.js`、`referencecode/public/scripts/world-info.js`、
> `referencecode/public/scripts/extensions/regex/engine.js`。
> 验证脚本：`scripts/smoke-wi-and-regex-runtime.mjs`（`npm run smoke:prompt-parity`）。

---

## 2026-09-21 第一批：三条最高影响差异

背景：在「同一角色卡 + 同一正则 + 同一预设（`st_preset/DSmamav1.8.json`）」下逐项对照，
以下三条会让发给 LLM 的 prompt 与酒馆明显不同，且都属于"改一行就能对齐"的类型。

### 1. 当前用户消息被 prompt 态正则应用两次（`<user_input>` 双层包裹）

- **表现**：预设里那条 `^([\s\S]*)$ → "<user_input>\n$1\n</user_input>"`（placement=USER_INPUT、
  promptOnly、maxDepth=1）在最终 prompt 里套出**两层**标签。
- **成因**：`MessageProcessor.send()` 第 1 步已经对用户输入跑过一次 placement=1 正则
  （`MessageProcessor.ts`），随后 `PromptBuilder` 又对 `tailUser` 跑了一次
  （改造前的 `PromptBuilder.ts`）。酒馆只跑一次（`script.js:4442-4447` + `:5816`）。
- **修复**：新增 `BuildContext.userMessagePreProcessed`；`MessageProcessor` 置 `true`，
  `PromptBuilder` 据此跳过二次应用。直接调用 `buildMessages` 的路径（重新生成 / 切 swipe）
  不声明该字段，仍由 `PromptBuilder` 兜底执行一次，行为不变。
- **注意**：`RegexScriptEngine.applyRegexScripts()` 目前**没有实现 `isEdit` 分支的调用点**
  （`runOnEdit: false` 的脚本在编辑器里不会失效）。这是已知遗留项，本次未动。

### 2. 世界书扫描深度默认"扫全部历史"（酒馆默认只扫最近 2 条）

- **表现**：长对话里本项目的关键词命中会累积，激活远比酒馆多的条目。
- **成因**：`PromptBuilder` 从不传 `defaultScanDepth`，`WorldInfoEngine.scan()` 默认 `?? 0`
  = 取全部历史；酒馆 `world_info_depth` 默认 **2**（`world-info.js:69`）。
- **修复**：
  - `types/preset.ts` 新增 `GenerationParams.worldInfoDepth / worldInfoRecursive /
    worldInfoMaxRecursionSteps`；
  - `PresetImporter` 从 `world_info_depth` / `world_info_recursive` /
    `world_info_max_recursion_steps` 读入，缺失时补酒馆默认值（2 / false / 0）；
  - `PromptBuilder` 把三值透传给 `scan()`；
  - `WorldInfoEngine.scan()` 的 `defaultScanDepth` 默认值改为 **2**；
  - 预设编辑页新增「世界书扫描」分组（深度 / 递归开关 / 最大递归步数）。
- **副作用（有意为之）**：老用户已导入的预设没有这三个字段，会走"酒馆默认值"，
  也就是**扫描范围从全部历史收窄到最近 2 条**——这正是对齐酒馆所要求的。
  想恢复旧行为，把预设的「扫描深度」设为 0 即可。

### 3. 递归扫描默认开启（酒馆默认关闭）

- **成因**：`WorldInfoEngine.scan()` 原来是 `input.recursive !== false`（默认开）+ `maxSteps ?? 5`；
  酒馆 `world_info_recursive` 默认 **false**（`world-info.js:75`）。
- **修复**：`recursive` 改为 `input.recursive === true`；`maxRecursionSteps` 为 0/未传时用
  安全上限 `MAX_SAFE_RECURSION_STEPS = 100` 兜底（酒馆的 0 语义是"不额外限制、靠预算收敛"，
  但本项目是同步循环，必须有硬上限防死循环）。

---

## 验证

```
node scripts/smoke-wi-and-regex-runtime.mjs
```

用 esbuild 现场打包真实源码（不是复刻逻辑），覆盖 T4~T10 共 47 条断言：

| 用例 | 断言 |
|---|---|
| T4a | 深度=2 时，倒数第 2 条命中的条目激活 |
| T4b | 深度=2 时，只出现在第 0 条的条目**不**激活（改造前会激活） |
| T4c | 深度=0（显式全历史）时两条都激活 |
| T4d | 当前输入永远参与扫描（不受深度限制） |
| T5a | `recursive=false` 时不做递归 |
| T5b | `recursive=true` 时才递归激活链式条目 |
| T5c | `maxRecursionSteps=1` 仍能走到第 1 步 |
| T6a | 真实引擎复现：连续两次应用 → 两层 `<user_input>`（改前的 bug） |
| T6b/T6c | 只应用一次 → 一层，内容与预期逐字一致 |
| T6d | 显示态（`isMarkdown`）不套 promptOnly 脚本 |
| T7a/T7b | `role` 透传：预设写 `user` 的 marker 以 user 身份发出 |
| T7c~T7f | 对话示例展开为多条带 `name` 的 system 消息、剥掉名字前缀、真实名字前缀也认、不再有 `[Example messages]` 头 |
| T7g/T7g2 | 相邻 system 消息被合并；T7h2 被 user 消息隔开的**不**合并（酒馆同款语义） |
| T7h | squash 不吞带 `name` 的示例消息 |
| T7j/T7k | `wi_format` 默认不包装 / 自定义生效 |
| T7l/T7m | atDepth 条目按 (depth, role) 合并 |
| T7n | 本次用户消息里的宏被替换 |
| T8a~T8f | 停止串整理：空/非数组/超长 → 不下发；trim；上限 4 条 |
| T9a~T9h | 预设导入保真：`role` / `system_prompt` / `injection_trigger` / `world_info_*` 默认值 / `wi_format` / 停止串 |
| T10a~T10c | 作者注旧字段 `prompt` → `promptText` 迁移 |
| T11a~T11k | 逐条消息 token 计数：常量与酒馆服务端一致（3 / 1 / 3）、遍历所有字段、padding 每请求一次、空消息计 0 |
| T12a~T12e | `names_behavior` 四种取值：`0` 不加、`1` 走独立 `name` 字段且不改正文、`2` 拼进正文 |
| T13a~T13g | 思考链只回灌**最近一轮有思考**的消息；跳过错位消息不消耗配额；无思考时行为不变；user 消息的 reasoning 不注入 |

> 脚本实现说明：`PromptBuilder` 经 `VariableEngine` 依赖 pinia store 与本地存储，
> 因此脚本会把 `src/` 平铺复制一份，把 `../stores/runtimeStore`、`../utils/storage.js`、
> `../account/userScope.js`、`../utils/dice-helper.js` 这几处 import 改写成本目录下的桩件再打包。
> 之所以不用 esbuild 的 alias/插件：CLI 的 `--alias` 只接受包名，JS API 的插件模式需要
> 常驻子进程走管道通信，在受限沙箱里是 `spawn EPERM`。

---

## 2026-09-21 第二批：其余差异（同一轮补齐）

### 4. 预设条目的 `role` 被强制成 system

- **表现**：酒馆预设里 `worldInfoBefore` / `charDescription` / `scenario` /
  `personaDescription` 常写 `role: "user"`，本项目全部以 `system` 发出。
- **修复**：`PromptBuilder` 组装系统块时改用 `item.role`（原本就是 `item.role`，
  真正的问题在别处 —— 见下条）；`PresetImporter._normalizePromptItem` 现在保真
  `system_prompt` 与 `injection_trigger`，`types/preset.ts` 增加 `PromptItem.systemPrompt`。
  缺 `role` 的条目（如 `charPersonality`）按酒馆 `Message` 构造器的默认值走 `system`。
- **验证**：T7a / T7b / T9a / T9c / T9d。

### 5. `dialogueExamples` 形态与酒馆完全不同

- **表现**：改造前把整块拼成**一条**字符串，带自造的 `[Example messages]` 头、
  `<START>` 分隔、`{{user}}:` / `{{char}}:` 前缀；酒馆是**多条** `role:'system'` +
  `name:'example_user'|'example_assistant'` 的消息，正文里**不带**名字前缀。
  另外 `_buildVariableMap` 没注入 `user`，示例里写真实用户名的行识别不到。
- **修复**：新增 `_dialogueExampleMessages()`，逐块按行识别说话人（`{{user}}`/`{{char}}`/
  真实用户名/真实角色名，后两者从 `ctx.variables` 取），剥掉行首前缀、跳过每块第 1 行引导语，
  输出多条消息；组装循环里的 `dialogueExamples` 分支把它们**逐条**推进系统块，
  世界书 EM 桶（`emTop`/`emBottom`）保持插在示例序列两侧。
- **验证**：T7c / T7d / T7e / T7e2 / T7f。

### 6. `squash_system_messages` 未实现

- **修复**：新增 `_squashSystemMessages()`，对齐 `openai.js:3827-3859`：只合并
  **连续**且**无 name** 的 `system` 消息（`\n` 连接），顺带丢掉空 system 消息；
  在裁剪完成之后、返回之前执行（与酒馆 `finally` 里的时机一致）。
- **验证**：T7g / T7g2 / T7h / T7h2。

### 7. 请求体缺 `stop`

- **修复**：新增纯函数模块 `src/utils/llm/stopStrings.ts`（`collectStopStrings`），
  对齐酒馆 `getCustomStoppingStrings(4)`：trim、去 `\r`、丢掉空串与长度 > 16 的项、
  最多 4 条；**一条都没有时不下发** `stop`（空数组会被部分上游判 400）。
  `client.js` 的流式 / 非流式 / 内置测试通道三条路径都接上；
  `server.js` 的 `PASSTHROUGH_PARAMS` 放行 `stop`（它是数组，不能按标量处理）。
  预设侧新增 `GenerationParams.customStopStrings`，`PresetImporter` 同时认
  数组与 JSON 字符串两种形态，预设编辑页用"一行一条"的文本框维护。
- **验证**：T8a~T8f / T9g / T9g2。

### 8. 用户消息与历史消息不过宏

- **修复**：`PromptBuilder` 对**本次用户消息**与**历史消息**做 `substituteVariables`，
  对齐酒馆 `sendMessageAsUser` 的 `substituteParams(messageText)`（`script.js:5823`）
  与 `preparePrompt`。**存档仍是原文**：宏替换只发生在进 prompt 的副本上。
- **验证**：T7n。

### 9. 世界书 `wi_format` 未应用

- **修复**：新增 `_formatWorldInfo(value, fmt)`（`stringFormat` 的等价实现），
  `wi_format` 由 `PresetImporter` 读入、`presetStore.normalizePreset` 补默认 `{0}`。
- **验证**：T7j / T7k / T9f。

### 10. atDepth 条目未按 (depth, role) 合并

- **表现**：同一深度同角色的多条世界书，酒馆合成**一条**（`world-info.js:5117-5121` +
  `script.js:4610-4612`），本改造前逐条注入。
- **修复**：`_insertAtDepthEntries` 先按 `(depth, role)` 分组、以 `\n` 连接，再按原顺序插入。
- **验证**：T7l / T7m。

### 11. 顺带修掉的两个既有 bug

- `chat.vue` 续写路径传的是 `noteStore.active`（Pinia store 上并不存在该属性），
  导致**续写时作者注永远不注入**；改为 `noteStore.config`。
- `AuthorsNoteConfig.prompt` 与"要拼进正文的世界书 ANTop/ANBottom"同名易混，
  改名为 `promptText`，并在 `types/note.ts` 增加 `normalizeAuthorsNote()` 做旧数据迁移
  （`noteStore.load()` 现在走它）。设置页同步改名。
- **验证**：T10a~T10c。

---

## 2026-09-21 第三批：tokenizer、`names_behavior=1`，以及思考链的结论

### 12. 真实 tokenizer + 逐条消息计数

- **问题**：`engine/tokenizer.ts` 原来是**纯启发式估算**，且 `PromptBuilder` 只累加
  `content`、不算每条消息的框架与 role 开销。酒馆是把**整条消息对象**交给服务端
  `/api/tokenizers/openai/count`（`scripts/tokenizers.js:797`）计数，服务端按真实 chat 格式编码。
- **实测偏差**（js-tiktoken cl100k_base vs 启发式，本仓库实测）：

  | 文本 | 真实 | 启发式 | 比值 |
  |---|---|---|---|
  | `她抬起头，看着窗外的雨。` | 17 | 12 | 0.71 |
  | `Hello, how are you today?` | 7 | 8 | 1.14 |
  | 一段 132 字的角色描述 | 156 | 115 | 0.74 |

  → 启发式对中文**系统性少算约 26%**，方向正好是"裁剪点偏晚"，长对话会被上游静默截断。
- **修复**：
  - `countMessageTokens({role, content, name})` = `TOKENS_PER_MESSAGE(4)` + encode(role)
    + encode(content) +（有 name 时）`TOKENS_PER_NAME(1)` + encode(name)；
    空消息计 0（与酒馆 `getChat()` 跳过空消息一致）。
  - 新增 `TOKENS_PER_REPLY_PRIMER(2)`（对齐酒馆 `reserveBudget(3)` 的起手符），
    计入强制项与 `promptInfo.used`，分项面板新增「消息框架开销」一行。
  - `enableRealTokenizer()` 改为在 `App.vue` 的 `onLaunch` 里 **H5 端后台加载**
    （不 await、不阻塞首屏；失败自动保留启发式）。加载完成后计数自动切换，裁剪逻辑无需 await。
  - 历史裁剪、系统块、当前用户消息三处全部改用逐条计数。
- **说明**：`TOKENS_PER_MESSAGE` 等常量是按 OpenAI 公开 chat 格式的**等价实现**，
  不是逐字复刻酒馆服务端（那份源码不在本仓库）。它修正的是"系统性少算"这个方向性错误。
- **验证**：T11a~T11h；另用一次性脚本确认 `js-tiktoken/lite` + `ranks/cl100k_base`
  在该 Node 版本下可加载且 `encode` 同步可用。

### 13. `names_behavior = 1`（COMPLETION）

- **修复**：`_applyNamesBehavior` 支持 `1` —— assistant 消息带**独立的 `name` 字段**、
  正文不改写；`2`（CONTENT，拼进正文）行为不变；`0/-1` 不加。
- **注意**：`name` 是 OpenAI Chat Completions 的**可选**字段，各兼容端点支持度差别很大
  （官方已 deprecated、多数新模型忽略；部分自建端点会用；也有端点直接 400）。
  酒馆同样把它单列成开关且默认不用。端点不认就把预设这一项切回 `DEFAULT(0)`。
- **验证**：T12a~T12e。

### 14. 「思考链带入上下文」——查证结论：酒馆默认**不带**，打开后也只带最近 1 轮

`scripts/reasoning.js` + `power-user.js`：

- `power_user.reasoning.add_to_prompts` 默认 **false**、`max_additions` 默认 **1**
  （`power-user.js:277/283`）→ 默认**完全不带**思考链进 prompt。
- `isLimitReached()` 返回 `counter >= max_additions`；`addToMessage()` 里
  **"没有思考就原样返回、不计入 counter"** → `max_additions=1` 的真实语义是
  "**最近 1 条有思考的消息**"，不是"最近 1 条消息"。
- `script.js:4473-4498` 的循环**从最新往旧**遍历，注入一条后 `if (isLimitReached()) break;`
  立即停止。

→ 不存在"每轮思考都带"的情况。**用户担心的形态在酒馆里不会发生**。

**2026-09-21 已按此语义实现**（不加开关，对齐酒馆默认）：

- `PromptBuilder._injectPromptReasoning()`：从最新往旧找，**只注入最近一条**有思考的
  assistant 消息，注入即停；没有思考的消息**跳过、不消耗配额**（所以是"最近 1 条
  **有思考**的消息"）；思考拼在正文之前。
- `MessageProcessor.toChatHistory()` 把 `reasoning`（上游原生优先，其次
  `reasoningFromText`）带到历史项上；`_applyNamesBehavior` 整体 spread，不丢字段。
- **格式**：直接用 `reasoning` 原文（项目切分时保留了定界符，如 `<think>…</think>`），
  因此不会产出酒馆那种"prefix + 内容 + 空 suffix"的半截标签。酒馆完整格式是
  `prefix + reasoning + suffix + separator`（默认 `<think>` / `</think>` / `\n`）。
- **为什么可以不加开关**：`reasoning` 只在"上游真的返回了思考"或"用户自己开了正文定界符
  切分"时才有值；当前默认配置是 DeepSeek `thinking: disabled` + `reasoning_split` 关闭，
  因此**默认没有任何消息带 reasoning，行为完全不变**。
- **验证**：T13a~T13g。

### 15. 卡名会被当成角色名（LLM 老写全名的根因，非代码 bug）

`st_card/beth.png` 里 `data.name` 实际是 **`"Beth, homeless on her birthday "`（末尾带空格）**。
`{{char}}` 在卡里出现 **13 次**（description×6 / mes_example×6 / first_mes×1），
全部会被替换成这个完整串：

- description 里的 `{{char}}` → 系统提示词里 6 次；
- `first_mes` 里的 `{{char}}` → 开场白落档时替换，写进**永久存档**（每轮历史都带着）；
- `mes_example` 里的 `{{char}}` → 对话示例 6 次。

→ 模型只是**忠实照做**：卡明确告诉它角色叫 "Beth, homeless on her birthday"。
酒馆的行为完全一致（`script.js:7685` `name2 = characters[this_chid].name`）。
**这是卡的数据问题，代码侧没有可修的地方**；要改只能改卡的 `name` 字段（或加一条
把全名替换成短名的正则脚本）。

---

## ⚠️ 用户需要知道的「行为变化清单」

这批改动里有几项会**改变现有对话的观感**。按"最容易让人以为出 bug"排序：

| # | 你可能会看到 | 原因 | 怎么恢复 |
|---|---|---|---|
| 1 | 长对话里世界书条目**触发变少**，以前会跳出来的条目不见了 | 扫描范围从"全部历史"收窄到"最近 2 条"（对齐酒馆 `world_info_depth` 默认 2，`PromptBuilder` 之前不传这个参数） | 预设编辑 →「世界书扫描 → 扫描深度」改成 0（= 全部历史） |
| 2 | 历史被裁得更早，感觉"模型记性变差" | token 计数从"只算 content 的启发式"改成"整条消息的真实计数 + 框架开销"（修正了中文少算约 26% 的问题）。**这是把超窗风险换成更早裁剪** | 调大预设的「上下文长度」，或调小「最大回复长度」 |
| 3 | 对话示例在 prompt 里从 1 条变成 5~10 条 | 示例改为酒馆形态（每条带 `name` 的独立 system 消息）。**但**若预设开了 `squash_system_messages`，相邻的 system 消息会被合并，所以净增通常不大 | — |
| 4 | 角色卡描述/场景/Persona/世界书在 prompt 里的 **role 从 system 变成 user** | 预设里这些 marker 本来就写着 `role: "user"`，之前被强制成 system | 预设编辑里把对应条目的角色改回 system |
| 5 | 预设自带的递归世界书不再触发 | `world_info_recursive` 默认关闭（对齐酒馆） | 预设编辑 →「世界书扫描 → 递归扫描」打开 |
| 6 | 历史消息里的 `{{...}}` 被真实值替换了 | 现在按酒馆语义对历史做宏替换 | 预期行为，无需恢复 |
| 7 | 用户打的 `{{char}}` 不再原样出现在 prompt 里 | 同上（对齐酒馆 `sendMessageAsUser`） | 预期行为 |
| 8 | 世界书前后会多出 `<world_info>` 之类的包装 | `wi_format` 现在生效 | 把「世界书外层包装」改回 `{0}` |
| 9 | 端点如果认 `stop`，回复会在自定义停止串处被截断 | 新增下发 `stop`（此前完全没发） | 预设编辑 →「自定义停止串」清空 |
| 10 | 续写时**多出了**作者注 | 之前 `chat.vue` 传的是 `noteStore.active`（根本不存在的属性）→ 续写路径作者注**从来没注入过**；这是修 bug，不是新行为 | 把作者注内容清空 |

另外两个"只在特定配置下才会发生"的点：

- `names_behavior = 1` 会下发 `name` 字段 —— 端点若不认可能报错，切回 `DEFAULT(0)` 即可。
- 思考链回灌**默认不生效**（当前 DeepSeek 走 `thinking: disabled`、正文定界符切分默认关，
  没有消息带 reasoning）；一旦上游真的返回思考，**只有最近一轮**会被带回 prompt。

---

## 明确决定「不做」

| 项 | 决定 | 理由 |
|---|---|---|
| `new_chat_prompt` / `new_example_chat_prompt` 等系统消息 | **不做** | 两套在用的预设都显式设成 `""`（`openai.js:5057` 只覆盖预设里写了的字段），酒馆也不发 → 收益 0；要做得碰 `GenerationParams` / `PresetImporter` / `PromptBuilder` 三处 |
| `{{original}}` 一次性语义 | **不做** | 只在卡作者**重复写两遍** `{{original}}` 时才有差异；本项目重复展开反而更符合作者本意。改它要动宏替换核心路径，风险不划算 |

---

## 仍未对齐（按影响排序，待办）

> ⚠️ 本表是**第二批**结束时（第三批之前）的快照，已部分过期。
> 最新的完整差异评估见 **`notes/parity-assessment-2026-09-21.md`**（含开场白过正则、世界书扫描不带角色名等新发现项）。

| # | 差异 | 位置 | 状态 |
|---|---|---|---|
| 1 | `new_chat_prompt` / `new_example_chat_prompt` / `continue_nudge_prompt` / `impersonate` / `quietPrompt` 等系统消息未实现 | `PromptBuilder` | **决定不做**（见上） |
| 2 | `{{original}}` 覆盖宏 | — | **已确认可用**；"一次性"语义**决定不做**（见上） |
| 3 | 真实 tokenizer 用的是 `cl100k_base`，而酒馆会按模型换 tokenizer（`src/endpoints/tokenizers.js`：claude / llama3 / qwen2 / deepseek 各有自己的） | `engine/tokenizer.ts` | 已知偏差。对 DeepSeek 类模型 cl100k 会偏高（更保守，不会超窗）；`safetyMargin`（2%，上限 512）保留作兜底。要做到完全一致得把对应词表打进前端，收益不抵成本 |
