# 关键差异项详细解释（1/3）

## 1. 示例消息 few-shot 解析

### 问题描述
角色卡中的 `mes_example` 字段包含示例对话，用于教 LLM 如何扮演角色。

### 酒馆的实现

**输入格式**（角色卡中的 mes_example）：
```
<START>
{Example Dialogue:}
Alice: 你好，我是 Alice。
Bob: 嗨 Alice！很高兴见到你。
Alice: 今天天气真不错。
<START>
Alice: 你喜欢编程吗？
Bob: 当然！我最喜欢 TypeScript。
```

**处理流程**：
1. **按 `<START>` 切块**（`parseMesExamples`）
2. **每块内按行解析**（`parseExampleIntoIndividual`）
   - 逐行检查是否以 `name1:` 或 `name2:` 开头
   - 识别说话人并切换状态（in_user / in_bot）
   - 连续的同一说话人的行合并为一条消息

3. **输出为 few-shot 消息数组**：
```javascript
[
  { role: 'system', content: '你好，我是 Alice。', name: 'example_user' },
  { role: 'system', content: '嗨 Alice！很高兴见到你。', name: 'example_assistant' },
  { role: 'system', content: '今天天气真不错。', name: 'example_user' }
]
```

### 本项目的当前问题

```typescript
// src/engine/PromptBuilder.ts:283
const blocks = mesExample.split(/<START>/gi).map(b => b.trim()).filter(Boolean)
// 只切块，没有解析 name1:/name2:
```

**结果**：整块文本作为字符串，没有角色区分，LLM 无法识别 user/assistant 交替对话。

### 为什么重要

**影响**：
- ❌ **学习效果差**：LLM 无法理解示例对话的结构
- ❌ **角色一致性**：无法学习角色的说话风格、语气、习惯用语
- ❌ **对话格式**：无法学习对话的节奏和互动模式

**使用场景**：复杂角色卡、特殊语气/方言、角色扮演质量要求高的场景

**修复优先级**：⭐⭐⭐ P0（必须修复）

---

## 2. depth_prompt 注入

### 问题描述
`depth_prompt` 允许在历史对话的特定深度注入额外的提示词。

### 酒馆的实现

**数据结构**（角色卡 V2）：
```json
{
  "data": {
    "extensions": {
      "depth_prompt": {
        "prompt": "重要提醒：{{char}} 是一个谨慎的人。",
        "depth": 4,
        "role": 0
      }
    }
  }
}
```

**字段含义**：
- `prompt`: 要注入的内容（支持宏变量）
- `depth`: 注入深度（4 = 倒数第 4 条消息之前）
- `role`: 角色类型（0=system, 1=user, 2=assistant）

**注入位置示例**（depth=4）：
```
system: [main prompt]
system: [角色描述]
------- 对话历史 -------
user: 历史消息 1
assistant: 历史消息 2
user: 历史消息 3
assistant: 历史消息 4
system: [depth_prompt 在这里！]  ← depth=4
user: 历史消息 5
assistant: 历史消息 6
user: 当前用户输入
```

### 本项目的当前问题

```typescript
// PromptBuilder.ts 导入了但未注入
// character.extensions?.depth_prompt 完全不生效
```

### 为什么重要

**影响**：
- ❌ **长对话质量**：对话越长，角色越容易偏离设定
- ❌ **复杂人设**：有细微性格特征的角色难以保持一致
- ❌ **专业角色卡**：很多精心制作的角色卡依赖 depth_prompt

**使用场景**：超过 20 轮的长对话、性格复杂的角色、需要强调"不能做某事"的限制

**修复优先级**：⭐⭐⭐ P0（必须修复）

---

## 4. Swipe（多候选回复）

### 问题描述
一次生成多个候选回复，用户可以左右滑动选择最满意的。

### 酒馆的实现

**数据结构**：
```javascript
{
  role: 'assistant',
  content: '你好！很高兴见到你。',
  swipes: [
    '你好！很高兴见到你。',      // swipe 0
    '嗨！我是 Alice。',          // swipe 1
    '你好，今天过得怎么样？'     // swipe 2
  ],
  swipe_id: 0  // 当前显示的索引
}
```

**工作流程**：
1. 用户发送消息
2. AI 生成第一个回复（swipe 0）
3. 用户不满意，点击"重新生成"
4. AI 生成第二个回复（swipe 1），添加到 swipes 数组
5. 用户可以左右滑动对比选择

### 本项目的当前问题

- 消息结构没有 `swipes` / `swipe_id` 字段
- 重新生成会覆盖上一条回复
- 无法对比不同的生成结果

### 为什么重要

**影响**：
- ❌ **调试体验**：无法对比不同参数下的生成效果
- ❌ **选择自由度**：第一次生成不满意就只能覆盖
- ❌ **测试效率**：无法快速生成多个候选对比

**使用场景**：调整预设参数时对比效果、角色回复不理想时快速重试、创作时需要多个灵感

**修复优先级**：⭐⭐ P1（重要）

---

## 5. Continue（续写）

### 问题描述
让 AI 继续写上一条未完成的回复（而不是从头生成新回复）。

### 酒馆的实现

**工作原理**：
```javascript
// Generate 函数，type='continue'
if (type === 'continue') {
  const lastMessage = chat[chat.length - 1]
  cyclePrompt = lastMessage.content  // 作为 prefill
  // LLM 从这个前缀继续写
}
```

**示例**：

**原始回复**（被截断）：
> 人工智能这个概念最早出现在 1950 年代，当时图灵提出了著名的...

**点击 Continue 后**：
> 人工智能这个概念最早出现在 1950 年代，当时图灵提出了著名的图灵测试。这个测试的核心思想是...（继续）

### 本项目的当前问题

- 没有 `type='continue'` 分支
- 无法续写上一条消息

### 为什么重要

**影响**：
- ❌ **长回复场景**：叙事、教学、详细解释等受限
- ❌ **token 管理**：无法分段生成长内容
- ❌ **用户体验**：被截断后需要手动提示"继续"

**使用场景**：故事叙述、详细教程、max_tokens 限制较低时

**修复优先级**：⭐⭐ P1（重要）
