# 与酒馆的 LLM 输入 / 输出差异 —— 当前代码状态评估

> 生成时间：2026-09-21（第 3 轮，**已包含第一、二、三批全部改动**）
> 对照源码：`referencecode/public/scripts/{PromptManager,openai,world-info,tokenizers,power-user,reasoning,presets}.js`、
> `referencecode/public/script.js`、`referencecode/src/endpoints/tokenizers.js`、
> `referencecode/public/scripts/extensions/regex/engine.js`
> 回归脚本：`scripts/smoke-wi-and-regex-runtime.mjs`（68 条断言，`npm run smoke:prompt-parity`）

口径：**同一张角色卡 + 同一份正则 + 同一份预设**（以 `st_preset/DSmamav1.8.json` 为例）。
"影响"列里的 高/中/低 是**对最终送给 LLM 的 prompt 实际形态**的影响，不是代码改动量。

---

## 一、仍然存在差异的项

### A. 输入侧 —— prompt 组装

| # | 差异 | 本项目行为 | 酒馆行为 | 影响 | 改动量 |
|---|---|---|---|---|---|
| A1 | **世界书扫描文本不含角色名** | `WorldInfoEngine.buildScanTextForEntry` 只拼 `content` | `script.js:4624`：`world_info_include_names` **默认 true** → 扫描文本是 `` `${x.name}: ${x.mes}` `` | **中**。条目如果拿角色名当关键词（如 key=`Beth`），酒馆会命中、本项目不会。反之也可能反向命中 | 小（1 个选项 + 调用点） |
| A2 | **酒馆"零碎系统消息"未实现** | 不发 | `new_chat_prompt`(默认 `[Start a new Chat]`)、`new_example_chat_prompt`(`[Example Chat]`)、`continue_nudge_prompt`、`impersonation_prompt`、`quietPrompt`、`groupNudge` | **低**。两套示例预设都显式设成 `""`（`openai.js:5057` 只覆盖预设里写了的字段），所以用它们时**零影响** | 中 |
| A3 | **预设 `injection_trigger` 不过滤** | 字段已保真存储，但不参与筛选 | `PromptManager.shouldTrigger`：条目的 `injection_trigger` 不含当前生成类型时**不注入** | **低**。两套预设所有条目都是 `[]`（= 全类型生效） | 小 |
| A4 | **历史 reasoning 的格式** | 直接用 `reasoning` 原文（含 `<think>…</think>`） | `prefix + reasoning + suffix + separator`（默认 `<think>` / `</think>` / `\n`） | **低**。本项目不会产出酒馆那种"prefix + 内容 + 空 suffix"的半截标签 | 小 |
| A5 | **`world_info_min_activations` 未实现** | 无 | 默认 0 = 关闭 | **无**（默认关） | 中 |
| A6 | **条目级 `scanDepth` / `ignoreBudget` / `groupWeight` / `preventRecursion` / `delayUntilRecursion` 无 UI** | 字段在 `LorebookEntry` 里有、引擎也认，但角色卡编辑页没有入口 | 酒馆条目编辑弹窗里都有 | **低**。导入时若卡里带了这些字段仍生效；只是用户改不了 | 小（补 UI） |

### B. 输出侧

| # | 差异 | 本项目行为 | 酒馆行为 | 影响 | 改动量 |
|---|---|---|---|---|---|
| B1 | **开场白落档时不过正则** | `chat.vue:_startFresh` 只做 `substituteVariables`，正则只在**显示时**补 | `script.js:7719` `getFirstMessage()`：`mes = getRegexedString(firstMes, AI_OUTPUT)` —— **落档前就过一遍非 markdown/prompt 正则**（`script.js:7724` 的 alternate_greetings 同样） | **中**。用 DSmama 那套正侧时，**显示出来的开场白会带 `<user_input>…</user_input>`**（因为显示态会把它算成「用户输入」并套 promptOnly 脚本），而且**同一个文件在"实时新开对话"和"刷新重载后"渲染不一样** | 小（加一行输出侧正则） |
| B2 | **`isEdit` 分支永不触发** | `applyRegexScripts` 支持 `isEdit`，但**所有调用点都不传** | 编辑消息后重渲染时传 `isEdit: true` | **低**。效果是「编辑后不重跑」这个勾选框（`runOnEdit`）在编辑器里不起作用 | 小 |

### C. 请求参数

| # | 差异 | 说明 | 影响 |
|---|---|---|---|
| C1 | **`top_a` / `min_p` / `repetition_penalty` 不发** | 酒馆只在部分源（OpenRouter / Mistral 等）发。DSmama 里三者是中性值 `0 / 0 / 1`，DSthinker 也没设 | **无**（当前预设） |
| C2 | **`reasoning_effort` / `include_reasoning` 不发** | 酒馆 `openai.js:2820-2821` 恒发。DSmama `reasoning_effort: "medium"`、`show_thoughts: true` | **低**。DSmama 在酒馆里其实**也没开思考**（prompt 让它把思考写进正文）；本项目在此基础上走测试通道时由服务端再注入 `thinking: disabled`，语义更强 |
| C3 | **`logit_bias` 不发** | 需用户在酒馆里配 bias 预设才有值 | **无**（未配置时酒馆也 `undefined`） |
| C4 | **`top_k` 发送条件略宽** | 本项目 `topK > 0` 就发；酒馆只在支持 `top_k` 的源发 | **低**（多数兼容端点忽略未知字段） |
| C5 | 真实 tokenizer 用 `cl100k_base` | 酒馆按模型换（`src/endpoints/tokenizers.js`：claude / llama3 / qwen2 / **deepseek** 各有自己的） | **低**。cl100k 对 DeepSeek 偏高 → 更保守，不会超窗 |

---

## 二、已经改齐的项（本轮之前有差异）

### 输入侧

| 项 | 状态 |
|---|---|
| 当前用户消息被 prompt 态正则重复应用 → `<user_input>` 双层 | ✅ 已修（`userMessagePreProcessed`） |
| 世界书扫描深度 | ✅ 已修（默认 2，对齐 `world_info_depth`） |
| 世界书递归扫描默认值 | ✅ 已修（默认关，对齐 `world_info_recursive`） |
| 预设条目的 `role` / `system_prompt` / `injection_trigger` 保真 | ✅ 已修 |
| `dialogueExamples` 形态（多条带 `name` 的 system 消息） | ✅ 已修 |
| `squash_system_messages` | ✅ 已实现 |
| 用户消息 / 历史消息的宏替换 | ✅ 已实现 |
| `wi_format` | ✅ 已实现 |
| atDepth 条目按 (depth, role) 合并 | ✅ 已修 |
| 请求体 `stop` | ✅ 已实现 |
| 逐条消息 token 计数（3 / 1 / 3） | ✅ 已实现（逐字对齐服务端源码） |
| 真实 tokenizer 后台加载 | ✅ 已实现（H5） |
| `names_behavior = 1`（`name` 字段） | ✅ 已实现 |
| 思考链只回灌**最近一轮** | ✅ 已实现（对齐 `max_additions=1`） |
| 作者注 / depth_prompt 注入 | ✅ 原本就有，顺序与酒馆一致 |
| 世界书 position 分桶（含 `system` 归并到 after） | ✅ 一致 |
| `{{original}}` 覆盖宏 | ✅ 可用（与酒馆仅差"一次性"语义） |
| `enableDefinitions` / `bias` / `quietPrompt` 之外的扩展提示词顺序 | ✅ 等效 |
| 开场白 `{{char}}`/`{{user}}` 宏替换 | ✅ 一致 |

### 输出侧

| 项 | 状态 |
|---|---|
| 三态正则（存档 / 显示 / prompt）分离 | ✅ 一致 |
| 落档只跑"两个 only 都没勾"的脚本 | ✅ 一致 |
| 显示态传 `isMarkdown` + depth、prompt 态传 `isPrompt` + depth | ✅ 一致 |
| 思考与正文分流 | ✅ 一致（酒馆走 `reasoning_content`，本项目走独立通道） |
| 正则引擎语义（`{{match}}` / `$n` / `$<name>` / trimStrings / substituteRegex / minDepth / maxDepth） | ✅ 逐行对齐 |
| naming / BlockParser | 本项目有自研显示管线（酒馆用 showdown + `<q>`），**显示层不同、但不影响 LLM** |

---

## 三、明确决定「不做」的项

| 项 | 决定 | 理由 |
|---|---|---|
| `new_chat_prompt` 一族系统消息 | **不做** | 两套在用的预设都显式设成 `""`，酒馆也不发 → 收益 0。要做得碰 `GenerationParams` / `PresetImporter` / `PromptBuilder` 三处 |
| `{{original}}` 一次性语义 | **不做** | 只在卡作者**重复写两遍** `{{original}}` 时才有差异；本项目重复展开反而更符合作者本意。改它要动宏替换核心路径，风险不划算 |

---

## 四、按优先级排的待办

| 优先级 | 项 | 理由 |
|---|---|---|
| ~~1~~ | ~~B1 开场白过输出侧正则~~ | ✅ **已修**（`chat.vue:_startFresh` 落档前跑一次输出侧正则） |
| ~~2~~ | ~~A1 世界书扫描带角色名~~ | ✅ **已修**（`WorldInfoEngine.includeNames` 默认 true，可用预设/调用方关闭） |
| 3 | B2 `isEdit` 接线 | 小改动，修好「编辑后不重跑」这个开关 |
| 4 | A6 条目级字段补 UI | 数据都在，只是改不了 |
| 5 | A2 / A3 / A4 / C1~C5 | 影响低或当前预设下无影响，可长期搁置 |

---

## 五、2026-09-21 追加修复：台词「名字出现在发言内容后一行」

用户截图报的错位 bug。**根因不在正则本身，而在"正则产出的 HTML 片段"与 BlockParser 的交互**：

- 系统正侧把台词包成 `<span class="say">…</span>`（`markdownOnly`，只影响显示）；
- `BlockParser.splitProseAndBlocks` 把每个 HTML 片段渲染成**独立块**，片段之间的文字走叙事解析；
- 于是 `“台词” 饭田:` 这种"名字跟在引号后面"的写法被拆成 `[台词块] → [叙事: 饭田:]`
  —— 名字就落到台词**下面一行**了。

实测七种形态（`scripts/smoke-system-regex.mjs` 全覆盖）：

| 输入 | 修复前 | 修复后 |
|---|---|---|
| `“台词” 饭田:` | 台词 → 饭田: ❌ | 饭田: → 台词 ✅ |
| `饭田: “台词”` | 台词 → 饭田: ❌ | 饭田: → 台词 ✅ |
| `“台词”` + 换行 + `饭田:` | 台词 → 饭田: ❌ | 饭田: → 台词 ✅ |
| `饭田:` + 换行 + `“台词”` | 饭田: → 台词 ✅ | 饭田: → 台词 ✅ |
| `「台词」 Aizawa:` | 台词 → Aizawa: ❌ | Aizawa: → 台词 ✅ |
| `“台词”` + 换行 + 旁白句 | 台词 → 旁白 ✅ | 不变 ✅（旁白不是名字，不搬） |
| 多行连续对话（3 组） | 第 2 行起顺序反转 ❌ | 三组全部正确 ✅ |

**改法**（`src/engine/systemRegex.ts`）：新增 4 条带名字的规则（中文/直角引号 × 名字在前/在后），
把名字**消费掉**并归一成「名字单独一行 → 台词」；所有台词规则加**后行断言**
`(?<!<span class="say">)`，因为同一次生成里这段文本会被应用**两遍**（存档态 + 显示态），
不加断言就会把 span 套两层。

**过程中暴露并修掉的 4 个隐藏缺陷**：
1. `meaningful()` 的 `[^”]` **会跨行匹配** → 多行连续对话时从上一行闭引号一路吞、撕碎已包好的标签（补 `\r\n`）；
2. `meaningful()` 的 `|` 交替**没有分组** → 嵌进 `(?<!…)` 后第二条分支逃出断言，标签被截断（补 `(?:…)`）；
3. 说话人字符类**允许冒号/换行** → 上一行行尾的 `饭田:` 被当成本行台词的说话人而跨行匹配（收紧为 `[^“”「」\r\n：:]`）；
4. 「名字在前」规则**没有行首锚点** → 会把"上一行闭引号 + 本行台词"当整体重新包一遍，顺序反转（补 `(^|\n)`）。

---

## 六、一句话总结

经过四轮改动，**在「同一角色卡 + 同一正则 + 同一预设」下，本项目发给 LLM 的 messages 骨架已经与酒馆一致**：
同样的消息条数、同样的 role 序列、同样的对话示例形态、同样的世界书注入位置、同样的思考回灌规则、同样的 token 计费口径。

**剩下的差异**：
1. `isEdit` 未接线（影响「编辑后不重跑」这个开关）；
2. 世界书条目级高级字段没有 UI（数据在、引擎认，只是改不了）；
3. 酒馆的「零碎系统消息 / 各源特有采样参数 / 按模型换 tokenizer」——在**当前两套预设下几乎零影响**，
   属于"追求逐字一致"才需要补的，已明确决定不做。
