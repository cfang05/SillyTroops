# SillyTavern 世界书（World Info / Lorebook）引擎源码分析笔记

> 分析对象：`referencecode/world-info.js`（6289 行；`referencecode/public/scripts/world-info.js` 为同内容副本，行级 diff 为 0 差异，仅字节级换行/编码不同）。核心逻辑集中在：`WorldInfoBuffer`（L199-474）、`WorldInfoTimedEffects`（L479-793）、`getWorldInfoPrompt`（L892-915）、`getSortedEntries`（L4478-4532）、`checkWorldInfo`（L4597-5163）。

---

## 1. 数据结构与常量

### 1.1 核心枚举（原样引用）

```js
export const world_info_logic = { AND_ANY: 0, NOT_ALL: 1, NOT_ANY: 2, AND_ALL: 3 };
export const scan_state = { NONE: 0, INITIAL: 1, RECURSION: 2, MIN_ACTIVATIONS: 3 };
export const world_info_position = { before: 0, after: 1, ANTop: 2, ANBottom: 3, atDepth: 4, EMTop: 5, EMBottom: 6, outlet: 7 };
export const wi_anchor_position = { before: 0, after: 1 };
export const world_info_insertion_strategy = { evenly: 0, character_first: 1, global_first: 2 };
```

| 枚举 | 含义 |
|---|---|
| `world_info_logic.AND_ANY(0)` | 次关键词满足**任意一个**即激活（计分 = 主+次命中数） |
| `world_info_logic.NOT_ALL(1)` | 次关键词**任一个不匹配**即激活 |
| `world_info_logic.NOT_ANY(2)` | 次关键词**全部不匹配**才激活 |
| `world_info_logic.AND_ALL(3)` | 次关键词**全部匹配**才激活（计分 = 全部命中才加次分） |
| `scan_state.NONE(0)` | 终止扫描 |
| `scan_state.INITIAL(1)` | 初始扫描 |
| `scan_state.RECURSION(2)` | 递归扫描 |
| `scan_state.MIN_ACTIVATIONS(3)` | 最小激活数推进的深度偏斜扫描 |
| `world_info_position.before(0)` | 角色卡前 |
| `world_info_position.after(1)` | 角色卡后 |
| `world_info_position.ANTop(2)` / `ANBottom(3)` | Author's Note 上 / 下 |
| `world_info_position.atDepth(4)` | 指定深度注入（需 `role`） |
| `world_info_position.EMTop(5)` / `EMBottom(6)` | 示例消息（Example Messages）上 / 下 |
| `world_info_position.outlet(7)` | 自定义出口点（需 `outletName`） |

### 1.2 全局设置变量与默认值（L69-82）

| 变量 | 默认 | 说明 |
|---|---|---|
| `world_info_depth` | 2 | 基础扫描深度（最近 N 条消息） |
| `world_info_min_activations` | 0 | >0 时启用"最小激活数"机制 |
| `world_info_min_activations_depth_max` | 0 | 最小激活数的深度上限 |
| `world_info_budget` | 25 | 预算百分比（占 `maxContext`） |
| `world_info_include_names` | true | 扫描文本是否带发言者名 |
| `world_info_recursive` | false | 是否启用递归扫描 |
| `world_info_overflow_alert` | false | 预算溢出时是否弹 toast |
| `world_info_case_sensitive` | false | 全局大小写敏感 |
| `world_info_match_whole_words` | false | 全局整词匹配 |
| `world_info_use_group_scoring` | false | 全局组计分 |
| `world_info_character_strategy` | `character_first(1)` | 角色卡/全局书插入顺序策略 |
| `world_info_budget_cap` | 0 | 预算 token 绝对上限（0=关闭） |
| `world_info_max_recursion_steps` | 0 | 最大递归步数（与 min_activations 互斥，UI 上二者会互相清零） |

### 1.3 其他常量

- `DEFAULT_DEPTH = 4`（atDepth 条目的默认深度）、`DEFAULT_WEIGHT = 100`（组权重默认值）、`MAX_SCAN_DEPTH = 1000`、`MAX_COMMENT_LENGTH = 100`。
- `KNOWN_DECORATORS = ['@@activate', '@@dont_activate']`（内容开头的装饰器行）。
- `METADATA_KEY = 'world_info'`（chat_metadata 中绑定聊天书的名字）。
- `sortFn = (a, b) => b.order - a.order`（`insertion_order` 降序）。
- `worldInfoCache = new StructuredCloneMap({ cloneOnGet: true, cloneOnSet: false })`（后端书籍缓存）。

> ⚠️ 关于 `WI_ENTRY_BUDGET`：本版本源码中**不存在**该常量（全仓库 grep 无结果）。当前预算机制是全局的 `world_info_budget`（百分比）+ `world_info_budget_cap`（token 上限），没有按条目的独立预算常量。若你在旧资料中见过 `WI_ENTRY_BUDGET`（预算百分比/上限），它属于历史版本，本笔记按现状描述。

### 1.4 条目字段定义 `newWorldInfoEntryDefinition`（L4002-4045）与磁盘键名 `originalWIDataKeyMap`（L2607-2644）

模板默认值（`newWorldInfoEntryTemplate` 由定义过滤 `excludeFromTemplate` 后生成，L4047-4049）：

| 前端字段 | 类型 | 默认值 | 磁盘键名（character book JSON） |
|---|---|---|---|
| `key` | array | `[]` | `keys` |
| `keysecondary` | array | `[]` | `secondary_keys` |
| `comment` | string | `''` | `comment` |
| `content` | string | `''` | `content` |
| `constant` | boolean | `false` | `constant` |
| `vectorized` | boolean | `false` | `extensions.vectorized` |
| `selective` | boolean | `true` | `selective` |
| `selectiveLogic` | enum | `AND_ANY(0)` | `selectiveLogic` |
| `addMemo` | boolean | `false` | （UI 用） |
| `order` | number | `100` | `insertion_order` |
| `position` | number | `0` | `extensions.position` |
| `disable` | boolean | `false` | `enabled`（取反） |
| `ignoreBudget` | boolean | `false` | `extensions.ignore_budget` |
| `excludeRecursion` | boolean | `false` | `extensions.exclude_recursion` |
| `preventRecursion` | boolean | `false` | `extensions.prevent_recursion` |
| `delayUntilRecursion` | number/boolean | `0` | `extensions.delay_until_recursion`（true=第 1 层） |
| `probability` | number | `100` | `extensions.probability` |
| `useProbability` | boolean | `true` | `extensions.useProbability` |
| `depth` | number | `4` | `extensions.depth` |
| `outletName` | string | `''` | `extensions.outlet_name` |
| `group` | string | `''` | `extensions.group`（逗号分隔可多个） |
| `groupOverride` | boolean | `false` | `extensions.group_override` |
| `groupWeight` | number | `100` | `extensions.group_weight` |
| `scanDepth` | number? | `null` | `extensions.scan_depth` |
| `caseSensitive` | boolean? | `null` | `extensions.case_sensitive` |
| `matchWholeWords` | boolean? | `null` | `extensions.match_whole_words` |
| `useGroupScoring` | boolean? | `null` | `extensions.use_group_scoring` |
| `automationId` | string | `''` | `extensions.automation_id` |
| `role` | enum | `0`(=SYSTEM) | `extensions.role` |
| `sticky` | number? | `null` | `extensions.sticky` |
| `cooldown` | number? | `null` | `extensions.cooldown` |
| `delay` | number? | `null` | `extensions.delay` |
| `triggers` | array | `[]` | `extensions.triggers`（生成类型过滤，值取自 `GENERATION_TYPE_TRIGGERS`） |
| `matchPersonaDescription` … `matchCreatorNotes` | boolean | `false` | `extensions.match_persona_description` 等 6 项 |

运行期附加字段（`getSortedEntries` 注入）：`world`（所属书名）、`uid`、`decorators`（解析后的装饰器数组）、`hash`（`getStringHash(JSON.stringify(entry))`，供限时效果跨扫描识别）。`characterFilter = { isExclude, names, tags }` 在 `convertCharacterBook`/`addMissingWorldInfoFields` 中补齐。

### 1.5 关键 Typedef

- `WIGlobalScanData`：`{ personaDescription, characterDescription, characterPersonality, characterDepthPrompt, scenario, creatorNotes, trigger }`（trigger 取值如 `'normal'`/`'continue'` 等）。
- `WIScanEntry`：扫描期条目视图，含 `scanDepth/caseSensitive/matchWholeWords/useGroupScoring/match*` 六个布尔、`uid/world/key/keysecondary/selectiveLogic/sticky/cooldown/delay/decorators/hash`。
- `WITimedEffect`：`{ hash, start, end, protected }`（start/end 为聊天消息序号区间）。
- `WIPromptResult`：`{ worldInfoString, worldInfoBefore, worldInfoAfter, worldInfoExamples, worldInfoDepth, anBefore, anAfter, outletEntries }`。
- `WIActivated`：`{ worldInfoBefore, worldInfoAfter, EMEntries, WIDepthEntries, ANBeforeEntries, ANAfterEntries, outletEntries, allActivatedEntries }`。

### 1.6 条目来源与合并 `getSortedEntries`（L4478-4532）

1. 并行加载四类书：`getGlobalLore()`（`selected_world_info` 全局书）、`getCharacterLore()`（角色主书 `character.data.extensions.world` + `world_info.charLore` 附加书）、`getChatLore()`（`chat_metadata.world_info`）、`getPersonaLore()`（`power_user.persona_description_lorebook`）。
2. 去重：同一书名已在全局激活则跳过角色/聊天/人设书；聊天书与人设书相同则跳过人设书。
3. 每条目 `{ uid, world, ...rest }`，去掉原 `uid` 冲突。
4. 排序：先 `chatLore`、再 `personaLore`、然后按 `world_info_character_strategy` 合并全局/角色书（`evenly` 混排、`character_first` 角色在前、`global_first` 全局在前），各组内部 `sortFn`（order 降序）。
5. `parseDecorators(entry.content)` 拆出 `@@` 装饰器行；`getStringHash(JSON.stringify(entry))` 计算 hash；最后 `structuredClone` 返回（防止污染缓存）。
6. 触发 `WORLDINFO_ENTRIES_LOADED` 事件。

`parseDecorators`（L4540-4586）细节：内容以 `@@` 开头的行才是装饰器候选；`@@@xxx` 三重 @ 表示"优先当装饰器，若未知则回退为正文"；已知装饰器只收 `@@activate`/`@@dont_activate`；遇到未知装饰器行后 `fallbacked=true`，后续 `@@` 行按正文处理。

---

## 2. WorldInfoBuffer 类（L199-474）

### 2.1 内部状态

- `static externalActivations = new Map()`：外部强制激活（`WORLDINFO_FORCE_ACTIVATE` 事件写入，键 `${world}.${uid}`）。
- `#depthBuffer: string[]`：按深度升序排列的聊天消息（已 `trim()`）。
- `#recurseBuffer: string[]`：递归扫描产生的文本。
- `#injectBuffer: string[]`：本次扫描有效的外部注入（`context.extensionPrompts[key].scan === true` 的扩展 prompt，经 `getExtensionPromptByName` 取回）。
- `#globalScanData: WIGlobalScanData`；`#skew`（min activations 深度偏斜）；`#startDepth`（起始深度，恒为 0 的预留位）。

### 2.2 关键方法

- `constructor(messages, globalScanData)`：`#initDepthBuffer(messages)` + 存全局扫描数据。`#initDepthBuffer` 从 depth=0 开始，逐条 `trim()` 存入 `#depthBuffer[depth]`，最多 `MAX_SCAN_DEPTH`。
- `#transformString(str, entry)`：`entry.caseSensitive ?? world_info_case_sensitive` 为真则原样，否则 `toLowerCase()`。
- `get(entry, scanState)`（L279-328）——扫描文本拼接：
  1. `depth = entry.scanDepth ?? this.getDepth()`；`depth <= startDepth` 返回 `''`；负数报错返回空；超过 `MAX_SCAN_DEPTH` 截断。
  2. 用 `MATCHER = '\x01'`、`JOINER = '\n' + MATCHER` 构造 `MATCHER + depthBuffer.slice(startDepth, depth).join(JOINER)`（`\x01` 分隔使整词/正则能跨消息边界匹配）。
  3. 按条目的 6 个 `match_*` 开关依次追加全局扫描数据：`personaDescription`、`characterDescription`、`characterPersonality`、`characterDepthPrompt`、`scenario`、`creatorNotes`（各以 `JOINER` 拼接）。
  4. 追加 `#injectBuffer`（若非空）。
  5. 追加 `#recurseBuffer`——**仅当 `scanState !== scan_state.MIN_ACTIVATIONS`**（min activations 扫描不算递归文本，避免递归内容重复触发匹配）。
- `matchKeys(haystack, needle, entry)`（L337-366）：
  1. 先用 `parseRegexFromString(needle)`（L2821-2846，解析 `/pattern/flags` 形式）——**是正则则直接 `regex.test(haystack)`，覆盖其他所有选项**。
  2. 否则按条目/全局设置：两边 `#transformString`；`matchWholeWords ?? world_info_match_whole_words`：
     - 多词 key（`split(/\s+/)` 后 >1）：退化为 `haystack.includes(transformedString)`；
     - 单词 key：用 `(?:^|\W)(word)(?:$|\W)` 正则保证词边界（含标点）。
     - 非整词模式：直接 `includes`。
- `getScore(entry, scanState)`（L428-473）：统计主/次 key 命中数（`matchKeys` 于 `get()` 结果上）。无主 key 返回 0；只有**正逻辑**影响分数：`AND_ANY` 返回 `primaryScore + secondaryScore`；`AND_ALL` 仅当次 key 全中才加次分，否则只返回主分；`NOT_ALL`/`NOT_ANY` 不额外计分。供组计分（`filterGroupsByScoring`）使用。
- `addRecurse(message)` / `addInject(message)` / `hasRecurse()`：维护对应缓冲。
- `advanceScan()`：`#skew++`；`getDepth()`：`world_info_depth + #skew`。
- `getExternallyActivated(entry)`：查 `externalActivations.get(`${entry.world}.${entry.uid}`)`；`resetExternalEffects()`：清空该 Map。

---

## 3. WorldInfoTimedEffects 类（L479-793）

### 3.1 存储结构

持久化在 `chat_metadata.timedWorldInfo`：`{ sticky: { [key]: WITimedEffect }, cooldown: {...} }`；**delay 不持久化**（纯按当前聊天长度计算）。key = `${entry.world}.${entry.uid}`，value = `{ hash, start, end, protected }`，其中 `start = chat.length`、`end = chat.length + Number(entry[type])`（消息条数计数）。构造时 `#ensureChatMetadata` 会清理非法结构。

### 3.2 判定与推进

- `checkTimedEffects()`：非 dry-run 时执行 `#checkTimedEffectOfType('sticky'/'cooldown', ...)`；`#checkDelayEffect` 任何情况都执行。
- `#checkTimedEffectOfType(type, buffer, onEnded)`（L619-660）逐条元数据：
  1. `chat.length <= start && !protected` → 删除（聊天未推进，如 swipe/重新生成时回滚）。
  2. 按 hash 在 `#entries` 中找不到条目（例如来自其他角色的书）：`chat.length >= end` 才删除，否则保留并 `continue`。
  3. 条目存在但 `!entry[type]`（效果配置被移除）→ 删除。
  4. `chat.length >= end` → 删除并调用 `onEnded(entry)`。
  5. 其余 → `buffer.push(entry)`（本扫描视为激活）。
- `#checkDelayEffect(buffer)`（L666-677）：对每个 `entry.delay`，若 `chat.length < delay` → 推入 delay 缓冲（即"第 N 条消息前不得激活"）。
- `#onEnded.sticky`（L518-529）：sticky 到期时，若条目有 `cooldown`，立即以 `protected: true` 写入 `chat_metadata.timedWorldInfo.cooldown[key]` 并同步推入本次 cooldown 缓冲——**sticky 结束即接 cooldown**。
- `setTimedEffects(activatedEntries)`（L730-736）：为每个激活条目调 `#setTimedEffectOfType('sticky'/'cooldown')`；仅在元数据不存在时写入（不刷新时长）。dry-run 直接 return。
- `setTimedEffect(type, entry, newState)`（L744-760）：斜杠命令手动开关（先删后建），`type === 'delay'` 在 dry-run 也允许。
- `isEffectActive(type, entry)`：`#buffer[type]` 中按 `entry.hash` 存在性判断（仅本次扫描有效，扫描结束 `cleanUp()` 清空）。
- 判定汇总（在 `checkWorldInfo` 单条目链中）：`isDelay` → 跳过；`isCooldown && !isSticky` → 跳过；sticky 生效期间条目视为"已激活"，无需再匹配关键词、无需再掷概率（见 4.1）。

---

## 4. checkWorldInfo 主流程（L4597-5163，完整状态机）

签名：`checkWorldInfo(chat, maxContext, isDryRun, globalScanData = defaultGlobalScanData)`，返回 `WIActivated`。`chat` 为**倒序**（最新消息在前），由调用方（script.js）按 `world_info_include_names` 决定是否带 `${name}: ` 前缀。

### 4.0 准备阶段

1. `new WorldInfoBuffer(chat, globalScanData)`；遍历 `context.extensionPrompts`，把 `scan === true` 的扩展 prompt 经 `getExtensionPromptByName` 取回后 `buffer.addInject(...)`。
2. `scanState = scan_state.INITIAL`；`token_budget_overflowed = false`；`count = 0`；`allActivatedEntries = new Map()`（键 `${world}.${uid}`）；`failedProbabilityChecks = new Set()`；`allActivatedText = ''`。
3. `budget = Math.round(world_info_budget * maxContext / 100) || 1`；若 `world_info_budget_cap > 0 && budget > cap` 则取 cap。
4. `sortedEntries = await getSortedEntries()`；`timedEffects = new WorldInfoTimedEffects(chat, sortedEntries, isDryRun)`；`timedEffects.checkTimedEffects()`（先处理历史限时效果）。
5. 无条目 → 直接返回空 `WIActivated`。
6. 预计算 `availableRecursionDelayLevels`（所有 `delayUntilRecursion` 的层级去重升序；`true` 视为 1），`currentRecursionDelayLevel = 第一层 ?? 0`。

### 4.1 主循环 `while (scanState)`（L4654-5068）

**终止条件**：`scanState` 变为 `NONE`；或 `world_info_max_recursion_steps > 0 && count >= max_recursion_steps` 提前 break。

每轮循环：

1. **重置**：`nextScanState = NONE`、`activatedNow = new Set()`。
2. **遍历所有 `sortedEntries`**（L4673-4877），按序执行跳过/激活判定：
   - `failedProbabilityChecks.has(entry)` 或已在 `allActivatedEntries` → 跳过（记忆性）。
   - `entry.disable` → 跳过。
   - `entry.triggers` 非空且不含 `globalScanData.trigger` → 跳过（生成类型过滤）。
   - `characterFilter.names`：当前角色 `getCharaFilename()` 不在名单且非 exclude → 跳过；exclude 模式下在名单 → 跳过。
   - `characterFilter.tags`：`context.tagMap` 与 `characterFilter.tags` 无交集（非 exclude）→ 跳过；exclude 有交集 → 跳过。
   - 限时效果：`isDelay` → 跳过；`isCooldown && !isSticky` → 跳过。
   - `delayUntilRecursion`：非 RECURSION 扫描且非 sticky → 跳过；RECURSION 扫描且 `delayUntilRecursion > currentRecursionDelayLevel` 且非 sticky → 跳过。
   - RECURSION 扫描且 `world_info_recursive` 且 `excludeRecursion` 且非 sticky → 跳过。
   - 装饰器：`'@@activate'` → 直接激活；`'@@dont_activate'` → 直接跳过。
   - `buffer.getExternallyActivated(entry)` → 用外部版本激活。
   - `entry.constant` → 激活。
   - `isSticky` → 激活（免匹配、免概率）。
   - 无主 key（空数组）→ 跳过。
   - **主关键词**：`textToScan = buffer.get(entry, scanState)`（一次缓存）；`entry.key.find(key => substituteParams(key) 非空 && buffer.matchKeys(textToScan, key替换后.trim(), entry))`；找不到 → 跳过。
   - **次关键词**：`selective && keysecondary.length` 时执行 `matchSecondaryKeys()`（L4831-4866）：
     - `AND_ANY`：任一命中 → 激活（短路返回 true）；
     - `NOT_ALL`：任一不命中 → 激活；
     - `NOT_ANY`：全部不命中 → 激活；
     - `AND_ALL`：全部命中 → 激活；
     - 否则跳过。
3. **排序**：`newEntries = [...activatedNow].sort(...)`——sticky 优先，其次按 `sortedEntries` 原序（L4882-4887）。
4. **分组过滤** `filterByInclusionGroups(newEntries, allActivatedEntries, buffer, scanState, timedEffects)`（L5269-5356）：
   - 按 `entry.group`（逗号分隔可多个）聚组 `grouped`。
   - `filterGroupsByTimedEffects`（L5218-5259）：组内有 sticky → 只留 sticky，移除其余；组内 cooldown/delay 条目移除。
   - `filterGroupsByScoring`（L5173-5209）：`world_info_use_group_scoring || 条目 useGroupScoring` 时，用 `buffer.getScore` 计分，**只保留最高分**（同分都保留）。
   - 逐组决策（L5302-5355）：组已在 `allActivatedEntries`（含旧激活）→ 移除组内其他；组内 `groupOverride` 条目按 `sortFn` 取第一个为赢家；否则**按 `groupWeight` 加权随机**选一个赢家；`removeAllBut(group, winner)` 移除组内其余。
5. **概率与预算循环**（L4900-4958）：
   - `ignoresBudget` 计数 = 本批 ignoreBudget 条目数；`token_budget_overflowed && !entry.ignoreBudget` 时：若仍有 ignoreBudget 待处理 → `continue`（跳过非豁免条目），否则 `break`。
   - `verifyProbability()`（L4909-4930）：`!useProbability || probability === 100` → 通过；sticky → 通过（不重掷）；否则 `Math.random() * 100 <= probability`，失败则 `failedProbabilityChecks.add(entry)` 并 `continue`。
   - 通过后 `entry.content = substituteParams(entry.content)`（**宏替换发生点**），`newContent += content + '\n'`。
   - **预算检查**（L4942-4954）：`!entry.ignoreBudget && (textToScanTokens + await getTokenCountAsync(newContent)) >= budget` → 首次置 `token_budget_overflowed = true`（若 `world_info_overflow_alert` 则 toastr 警告），`continue`（该条目不计入）。
   - 否则 `allActivatedEntries.set(`${entry.world}.${entry.uid}`, entry)`。
   - `textToScanTokens = await getTokenCountAsync(allActivatedText)` 在**每轮循环开头**算一次（L4891），`newContent` 仅累计**本轮**新增条目内容。
6. **计算下一状态**（优先级从高到低，L4977-5014）：
   - a) `world_info_recursive && !overflow && successfulNewEntriesForRecursion.length` → `RECURSION`（`successfulNewEntriesForRecursion` = 通过概率的条目中 `!preventRecursion` 者）。
   - b) `world_info_recursive && !overflow && scanState === MIN_ACTIVATIONS && buffer.hasRecurse()` → `RECURSION`（min activations 推进后总要先跑一轮递归）。
   - c) **MIN ACTIVATIONS**：`!nextScanState && !overflow && world_info_min_activations > 0 && allActivatedEntries.size < world_info_min_activations` 时：若 `over_max = (min_activations_depth_max > 0 && getDepth() > max) || getDepth() > chat.length` → 停止；否则 `nextScanState = MIN_ACTIVATIONS` 且 `buffer.advanceScan()`（**skew+1 → 扫描深度 +1**，多看到一条更旧消息）。
   - d) **延迟递归层**：`nextScanState === NONE && availableRecursionDelayLevels.length` → `RECURSION` 且 `currentRecursionDelayLevel = shift()`（进入下一层 delayUntilRecursion）。
7. **递归缓冲写入**：若要继续扫描，`buffer.addRecurse(successfulNewEntriesForRecursion 的 content 用 '\n' 连接)`，`allActivatedText = text + '\n' + allActivatedText`；否则结束。
8. **事件钩子** `WORLDINFO_SCAN_DONE`（L5030-5056）：传出 `{ state:{current,next,loopCount}, new:{all,successful}, activated:{entries,text}, sortedEntries, recursionDelay:{availableLevels,currentLevel}, budget:{current,overflowed}, timedEffects }`；监听者允许修改 `args.state.next`、`args.activated.text`、`args.recursionDelay.currentLevel`、`args.budget.current`、`args.budget.overflowed`，随后同步回主流程。

### 4.2 结果分桶（L5070-5153，BUILDING PROMPT）

`[...allActivatedEntries.values()].sort(sortFn)`（order 降序）逐条处理：

1. `regexDepth = position === atDepth ? (entry.depth ?? DEFAULT_DEPTH) : null`。
2. `content = getRegexedString(entry.content, regex_placement.WORLD_INFO, { depth: regexDepth, isMarkdown: false, isPrompt: true })`；空内容跳过。
3. 按 `entry.position` 分桶（全部用 `unshift`，即 order 高的排在桶前面）：
   - `before(0)` → `WIBeforeEntries`
   - `after(1)` → `WIAfterEntries`
   - `EMTop(5)` → `EMEntries.unshift({ position: wi_anchor_position.before, content })`
   - `EMBottom(6)` → `EMEntries.unshift({ position: wi_anchor_position.after, content })`
   - `ANTop(2)`/`ANBottom(3)` → `ANTopEntries`/`ANBottomEntries`
   - `atDepth(4)` → 合并进 `WIDepthEntries`：同 `depth + role` 的条目合并为 `{ depth, role, entries[] }`（`unshift` 内容）
   - `outlet(7)` → `WIOutletEntries[entry.outletName].push(content)`（**注意 outlet 用 push，非 unshift**；无 `outletName` 则警告跳过）
4. `worldInfoBefore = WIBeforeEntries.join('\n')`、`worldInfoAfter = WIAfterEntries.join('\n')`。
5. **AN 注入**：`shouldWIAddPrompt` 为真时，`context.setExtensionPrompt(NOTE_MODULE_NAME, ANTop + 原文AN + ANBottom 去首尾换行, ...)`。
6. `timedEffects.setTimedEffects(allActivatedEntries 值)`（写 sticky/cooldown 元数据）→ `buffer.resetExternalEffects()` → `timedEffects.cleanUp()`。
7. 返回 `WIActivated`（`allActivatedEntries` 转 Set）。

---

## 5. getWorldInfoPrompt 与输出结构（L892-915）

```js
export async function getWorldInfoPrompt(chat, maxContext, isDryRun, globalScanData) {
    const activatedWorldInfo = await checkWorldInfo(chat, maxContext, isDryRun, globalScanData);
    worldInfoString = worldInfoBefore + worldInfoAfter;
    if (!isDryRun && allActivatedEntries.size > 0) emit WORLD_INFO_ACTIVATED(entries);
    return { worldInfoString, worldInfoBefore, worldInfoAfter,
             worldInfoExamples: EMEntries, worldInfoDepth: WIDepthEntries,
             anBefore: ANTopEntries, anAfter: ANBottomEntries, outletEntries };
}
```

上游消费（`public/script.js` L4576-4622）：
- `chatForWI = coreChat.map(x => world_info_include_names ? `${x.name}: ${x.mes}` : x.mes).reverse()`。
- `worldInfoBefore`/`worldInfoAfter` 拼入故事串（scenario 锚点前/后）；`worldInfoExamples` 按 `{position: before|after, content}` 拆进示例消息（`parseMesExamples` 后 `unshift`/`push`）。
- `worldInfoDepth`：逐项 `setExtensionPrompt(inject_ids.CUSTOM_WI_DEPTH_ROLE(depth, role), entries.join('\n'), IN_CHAT, depth, false, role)`（即 atDepth 注入，可在深度处插入）。
- `outletEntries`：`setExtensionPrompt(inject_ids.CUSTOM_WI_OUTLET(key), value.join('\n'), NONE, 0)`——任何扩展/插件可通过该扩展 prompt id 读取出口内容，这就是 outlet 机制的全部：**世界书只负责把激活内容按名字收集起来，注入由上游按名字分发**。

---

## 6. 正则处理与宏替换

- **宏替换时机**：
  1. 关键词匹配前：`substituteParams(key)`（L4803）、`substituteParams(keysecondary)`（L4835）。
  2. 条目激活通过概率后：`entry.content = substituteParams(entry.content)`（L4939，此时 content 已被宏展开，且写回 entry 影响后续递归与分桶）。
- **正则处理**：分桶阶段对每个条目内容调 `getRegexedString(content, regex_placement.WORLD_INFO, { depth, isMarkdown: false, isPrompt: true })`（`regex_placement.WORLD_INFO = 5`，见 `referencecode/public/scripts/extensions/regex/engine.js` L281-292）。
  - 引擎遍历所有允许的正则脚本（`getRegexScripts({ allowedOnly: true })`）：`promptOnly` 与 `isPrompt=true` 匹配才应用；`isEdit` 时跳过 `!runOnEdit` 脚本；`atDepth` 条目带 `depth` 参数，会受脚本 `minDepth/maxDepth` 过滤。
  - `runRegexScript`：find 正则支持 `substitute_find_regex`（NONE/RAW/ESCAPED），替换串处理 `{{match}}`、`$1`/`$<name>` 捕获组，`trimStrings` 过滤，最后对替换结果再 `substituteParams`。
- 顺序总结：**先宏替换（匹配期 key、激活期 content），后正则（分桶期）**。

---

## 7. 预算机制细节

- **额度**：`budget = Math.round(world_info_budget * maxContext / 100) || 1`（默认 25%）；`world_info_budget_cap > 0` 且超限时取 cap。至少为 1 token。
- **Token 估算**：`getTokenCountAsync`（异步，可能走后端 tokenizer）；每轮开头算 `allActivatedText`（历史递归文本累计）的 token 数，逐条累加本轮 `newContent`。
- **判定**：`textToScanTokens + tokens(newContent) >= budget` → 该条目**不被加入**，置 `token_budget_overflowed`；后续条目（非豁免）不再接受（有豁免条目待处理时 `continue`，处理完 `break`）。
- **`ignoreBudget`（extensions.ignore_budget）**：豁免条目不参与预算计数，溢出后仍可进入；激活后照常加入 `allActivatedEntries`。
- **截断策略**：不是"截断已激活文本"，而是**停止接受新条目**；同时溢出会**禁止递归继续与 min activations 推进**（两个续扫条件都要求 `!token_budget_overflowed`），因此溢出即整轮扫描收敛。已接受条目不回退。
- **优先级**：条目按 sticky→sortedEntries 顺序进入预算循环；最终提示内排序与预算无关，由 `insertion_order`（order 降序）+ position 分桶决定。

---

## 8. 一次完整世界书扫描（分步数据流）

1. `script.js` 组装 `chatForWI`（倒序、可带名字）、`globalScanData`（persona/character 六源 + trigger）后调 `getWorldInfoPrompt(chatForWI, this_max_context, dryRun, globalScanData)`。
2. `checkWorldInfo`：`new WorldInfoBuffer(chat, globalScanData)`；把 `scan=true` 的扩展 prompt 注入 `#injectBuffer`。
3. 计算 `budget`（百分比×maxContext，可被 cap 截断）。
4. `getSortedEntries()`：并行加载全局/角色/聊天/人设书 → 去重 → 按插入策略排序 → 解析装饰器 → 计算 hash。
5. `new WorldInfoTimedEffects(...)` 并 `checkTimedEffects()`：清理/推进 `chat_metadata.timedWorldInfo` 中的 sticky/cooldown，计算 delay 缓冲。
6. 预取 `delayUntilRecursion` 层级列表，`scanState = INITIAL`，进入 `while(scanState)`。
7. **每轮**：遍历全部条目 → 跳过链（禁用/触发器/角色过滤/限时效果/递归开关/装饰器/外部激活/constant/sticky/无 key）→ 主 key 匹配 → 次 key 按 selectiveLogic 匹配 → 收集 `activatedNow`。
8. 排序（sticky 优先）→ `filterByInclusionGroups`（sticky 获胜、cooldown/delay 移除、组计分最高分、groupOverride 优先、groupWeight 加权随机）。
9. 逐条概率掷骰（`Math.random()*100 <= probability`，sticky 免掷）→ `substituteParams(content)` → 预算检查（溢出即停收）→ 写入 `allActivatedEntries`。
10. 决策下一状态：递归优先 → min activations 推进（`advanceScan()` 深度+1）→ 延迟递归层；写递归缓冲；发 `WORLDINFO_SCAN_DONE`（监听者可改状态）。
11. 循环收敛（状态 NONE 或达到 `world_info_max_recursion_steps`）。
12. 分桶：按 position 对激活条目 `getRegexedString`（WORLD_INFO 放置）后 unshift 进各桶（before/after/EM/AN/atDepth/outlet）。
13. `worldInfoBefore`/`worldInfoAfter` 拼接；AN 文本回写 extension prompt；`setTimedEffects` 写 sticky/cooldown；清理缓冲。
14. 返回 `WIActivated` → `getWorldInfoPrompt` 封装为 `WIPromptResult`，非 dry-run 时发 `WORLD_INFO_ACTIVATED`。
15. `script.js`：before/after 入故事串；EM 拆成示例消息；depth 经 `CUSTOM_WI_DEPTH_ROLE` 深度注入；outlet 经 `CUSTOM_WI_OUTLET` 命名注入。

---

## 9. 事件一览

| 事件 | 触发点 | 载荷 |
|---|---|---|
| `WORLDINFO_ENTRIES_LOADED` | `getSortedEntries` | `{globalLore, characterLore, chatLore, personaLore}` |
| `WORLDINFO_SCAN_DONE` | 每轮扫描结束 | 状态机快照（可写回） |
| `WORLD_INFO_ACTIVATED` | `getWorldInfoPrompt`（非 dry-run） | 激活条目数组 |
| `WORLDINFO_FORCE_ACTIVATE` | 外部 | 条目数组 → `WorldInfoBuffer.externalActivations` |
| `WORLDINFO_UPDATED` | 保存书籍 | `{name, data}` |
| `WORLDINFO_SETTINGS_UPDATED` | 设置变更 | — |
| `CHAT_CHANGED` | 切换聊天 | 触发书籍预缓存 |

---

## 10. 备注与易错点

- `MIN_ACTIVATIONS` 扫描中 `get()` 会**排除递归缓冲**，防止递归文本自我触发；但 `MIN_ACTIVATIONS` 之后总会补一轮 `RECURSION`。
- `failedProbabilityChecks` 是 Set 引用比较，概率失败的条目在**整次调用**内不再尝试（含后续递归轮）。
- sticky 是"免检"状态：免关键词匹配、免概率、免分组淘汰；到期后若配置 cooldown 则**自动接 cooldown（protected=true）**。
- `protected` 效果在聊天未推进（`chat.length <= start`）时不会被清除，防止 swipe 回滚误删。
- atDepth 注入按 `(depth, role)` 聚合，由上游 `setExtensionPrompt(..., IN_CHAT, depth, ..., role)` 插入指定深度。
- 本版本没有 `WI_ENTRY_BUDGET` 常量；预算 = 全局百分比 + 可选 cap + 条目级 `ignoreBudget` 豁免。
