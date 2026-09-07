# 关键差异项详细解释（2/3）

## 8. 世界书六源扫描 match_*

### 问题描述
世界书条目的激活条件不仅仅是匹配用户消息和历史，还应该扫描其他 6 个来源。

### 酒馆的实现

**六个扫描源**（`WIGlobalScanData`）：
```javascript
{
  match_user_message: true,         // 用户最新消息
  match_history: true,              // 对话历史
  match_persona_description: false, // Persona 描述
  match_char_description: false,    // 角色描述
  match_char_personality: false,    // 角色性格
  match_creator_notes: false        // 创作者注释
}
```

**每个条目可以独立配置**（`extensions` 字段）。

**扫描逻辑**：
```javascript
let scanText = ''
if (entry.extensions.match_user_message) scanText += userMessage
if (entry.extensions.match_history) scanText += historyText
if (entry.extensions.match_persona_description) scanText += personaDesc
if (entry.extensions.match_char_description) scanText += charDesc
if (entry.extensions.match_char_personality) scanText += charPers
if (entry.extensions.match_creator_notes) scanText += creatorNotes

// 用 keys 匹配 scanText
if (matchKeys(entry.keys, scanText)) {
  activatedEntries.push(entry)
}
```

**典型用例**：

**场景 1**：角色背景故事
```json
{
  "keys": ["童年", "小时候"],
  "content": "{{char}} 童年时期在乡村长大...",
  "extensions": {
    "match_char_description": true,  // 角色描述提到童年就激活
    "match_user_message": true
  }
}
```

**场景 2**：Persona 相关记忆
```json
{
  "keys": ["医生", "医学"],
  "content": "你曾经在医学院学习...",
  "extensions": {
    "match_persona_description": true  // Persona 是医生时激活
  }
}
```

### 本项目的当前问题

```typescript
// WorldInfoEngine.ts 只扫描 3 个源：
// 1. userMessage
// 2. history
// 3. 递归激活的条目内容
// 缺少：persona/charDesc/charPers/creatorNotes
```

### 为什么重要

**影响**：
- ❌ **深度世界观卡**：专业制作的角色卡依赖这些扫描源
- ❌ **动态背景**：角色描述中的关键词无法触发相关世界书
- ❌ **Persona 联动**：切换 Persona 时相关世界书无法自动激活

**使用场景**：大型世界观（游戏/小说角色卡）、根据角色背景动态激活、根据 Persona 职业激活知识

**修复优先级**：⭐⭐ P1（重要）

---

## 9. 世界书 AN/EM/outlet 桶注入

### 问题描述
世界书条目不仅仅注入到 `worldInfoBefore` / `worldInfoAfter`，还可以注入到其他 3 个特殊位置。

### 酒馆的实现

**四个注入桶**：
```javascript
{
  before: [],        // worldInfoBefore（主系统块之前）
  after: [],         // worldInfoAfter（主系统块之后）
  authorsNote: [],   // AN 桶（作者注附近）
  examples: [],      // EM 桶（示例消息附近）
  outlet: []         // 自定义位置
}
```

**条目配置**（`position` 字段）：
- `0`: before（角色描述之前）
- `1`: after（角色描述之后）
- `2`: atDepth（历史深度注入）
- `3`: authorsNote（AN 桶）
- `4`: examples（EM 桶）
- `5`: outlet（自定义桶）

**注入位置示例**：
```
system: [main prompt]
system: [worldInfoBefore]        ← before 桶
system: [角色描述]
system: [worldInfoAfter]         ← after 桶
system: [示例消息开始]
system: [EM 桶条目]              ← examples 桶
system: [示例消息内容]
system: [AN 桶条目]              ← authorsNote 桶
system: [作者注]
------- 对话历史 -------
```

**典型用例**：

**EM 桶**（示例消息附近）：
```json
{
  "keys": ["魔法", "咒语"],
  "content": "施法时需要念咒语...",
  "position": 4,
  "comment": "让 AI 在示例中学习魔法系统"
}
```

**AN 桶**（作者注附近）：
```json
{
  "keys": ["战斗"],
  "content": "战斗场景需要详细描写动作...",
  "position": 3,
  "comment": "强调写作风格"
}
```

### 本项目的当前问题

```typescript
// WorldInfoEngine.ts 收集了三个桶：
const buckets = { before: [], after: [], atDepth: [] }
// 但 PromptBuilder 只用了 before 和 after！
// authorsNote、examples、outlet 都被丢弃
```

### 为什么重要

**影响**：
- ❌ **精细控制**：无法在最佳位置注入世界书内容
- ❌ **作者注增强**：无法用世界书动态修改写作风格
- ❌ **示例强化**：无法在示例中嵌入规则说明

**使用场景**：复杂 TRPG 规则、动态写作风格提示、自定义注入点

**修复优先级**：⭐⭐ P1（重要）

---

## 10. 世界书内容走 WORLD_INFO 正则

### 问题描述
激活的世界书内容应该经过 `WORLD_INFO` 正则脚本处理。

### 酒馆的实现

**正则 placement 类型**：
```javascript
const regex_placement = {
  USER_INPUT: 1,      // 用户输入
  AI_OUTPUT: 2,       // AI 输出
  SLASH_COMMAND: 3,   // 斜杠命令
  WORLD_INFO: 4       // 世界书内容 ← 这个！
}
```

**处理流程**（`formatWorldInfo`）：
```javascript
// 激活的世界书条目
const entry = { content: '{{char}} 是一名勇敢的战士...' }

// 1. 应用 wi_format 模板
let formatted = stringFormat(wi_format, entry.content)

// 2. 应用 WORLD_INFO 正则
formatted = getRegexedString(formatted, regex_placement.WORLD_INFO)

// 3. 宏替换
formatted = substituteParams(formatted)

return formatted
```

**典型用例**：

**正则脚本示例**：
```json
{
  "placement": 4,  // WORLD_INFO
  "findRegex": "^(.+)$",
  "replaceString": "💡 重要：$1",
  "comment": "给所有世界书添加图标"
}
```

**效果**：
```
Before: "勇士公会位于城市中心。"
After:  "💡 重要：勇士公会位于城市中心。"
```

### 本项目的当前问题

```typescript
// WorldInfoEngine.ts 返回原始 content
// PromptBuilder 直接拼接，没有调用正则
worldInfoBefore = buckets.before.map(e => e.content).join('\n\n')
```

### 为什么重要

**影响**：
- ❌ **格式一致性**：无法统一世界书的呈现格式
- ❌ **动态内容**：无法根据上下文动态修改世界书
- ❌ **兼容性**：导入的 WORLD_INFO 正则失效

**使用场景**：统一添加标记、根据场景动态修改、格式化处理

**修复优先级**：⭐⭐ P1（重要）
