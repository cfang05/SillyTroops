# 关键差异项详细解释（3/3）

## 12. 正则函数替换（{{match}} / $<name>）

### 问题描述
正则脚本的 `replaceString` 应该支持特殊变量和具名捕获组。

### 酒馆的实现

**基础替换**（已支持）：
```json
{
  "findRegex": "(\\d+)个苹果",
  "replaceString": "$1个红苹果"
}
```
- `$1`, `$2` → 捕获组 ✅ 本项目已支持

**函数替换**（本项目缺失）：

#### 1. `{{match}}` 变量
```json
{
  "findRegex": "\\b(攻击|防御)\\b",
  "replaceString": "【{{match}}】"
}
```
- `{{match}}` → 整个匹配文本
- 输入：`攻击力很高`
- 输出：`【攻击】力很高`

#### 2. 具名捕获组 `$<name>`
```json
{
  "findRegex": "(?<action>攻击|防御)力(?<value>\\d+)",
  "replaceString": "$<action>：$<value> 点"
}
```
- 输入：`攻击力50`
- 输出：`攻击：50 点`

#### 3. 复杂示例（TRPG 骰子）
```json
{
  "findRegex": "/roll (?<dice>\\d+)d(?<sides>\\d+)",
  "replaceString": "🎲 投掷 $<dice> 个 $<sides> 面骰子"
}
```
- 输入：`/roll 2d6`
- 输出：`🎲 投掷 2 个 6 面骰子`

### 本项目的当前问题

```typescript
// RegexScriptEngine.ts
newText = original.replace(regex, script.replaceString || '')
// 仅支持 $1, $2
// 不支持 {{match}} 和 $<name>
```

### 为什么重要

**影响**：
- ❌ **复杂正则**：无法实现高级文本处理
- ❌ **可读性**：具名捕获组比数字更清晰
- ❌ **功能性**：很多导入的正则脚本会失效

**使用场景**：TRPG 骰子命令、复杂文本格式化、动态内容替换

**修复优先级**：⭐⭐ P1（重要）

---

## 13. 正则 substituteRegex（NONE/RAW/ESCAPED）

### 问题描述
正则的 `replaceString` 中的宏变量应该根据 `substituteRegex` 设置进行不同处理。

### 酒馆的实现

**三种模式**（`substituteRegex` 字段）：

#### 1. NONE (0) - 不替换
```json
{
  "replaceString": "角色名：{{char}}",
  "substituteRegex": 0
}
```
- 输出：`角色名：{{char}}`（原样保留宏）

#### 2. RAW (1) - 原始替换
```json
{
  "replaceString": "角色名：{{char}}",
  "substituteRegex": 1
}
```
- 输出：`角色名：Alice`（正常宏替换）

#### 3. ESCAPED (2) - 转义替换
```json
{
  "replaceString": "角色名：{{char}}",
  "substituteRegex": 2
}
```
- 输出：`角色名：Alice`
- 但如果宏值包含正则特殊字符，会被转义
- 例如 `{{char}}` = `$Alice` → 输出 `角色名：\\$Alice`

**用途**：
- `NONE`: 保留宏供后续处理（嵌套正则）
- `RAW`: 标准宏替换
- `ESCAPED`: 防止宏值破坏正则匹配

### 本项目的当前问题

```typescript
// PresetImporter.ts 导入了字段
substituteRegex: item.substituteRegex ?? 1

// 但 RegexScriptEngine.ts 完全忽略它
// 所有宏都是 RAW 模式
```

### 为什么重要

**影响**：
- ❌ **嵌套正则**：无法实现多阶段正则处理
- ❌ **安全性**：宏值可能破坏正则匹配
- ❌ **精确控制**：无法控制宏替换时机

**使用场景**：多层正则嵌套、防止用户输入破坏正则、延迟宏替换

**修复优先级**：⭐⭐ P1（重要）

---

## 14. 正则 minDepth / maxDepth（深度过滤）

### 问题描述
正则脚本应该只对特定深度范围的历史消息生效。

### 酒馆的实现

**字段定义**：
```json
{
  "findRegex": "\\b(我|你)\\b",
  "replaceString": "*$1*",
  "minDepth": 5,    // 最少倒数第 5 条
  "maxDepth": 10    // 最多倒数第 10 条
}
```

**应用范围**：
```
message[0]  ← 最老的消息
...
message[5]  ✅ depth=10（在范围内）
message[6]  ✅ depth=9
message[7]  ✅ depth=8
message[8]  ✅ depth=7
message[9]  ✅ depth=6
message[10] ✅ depth=5
message[11] ❌ depth=4（太近，< minDepth）
...
message[14] ❌ depth=1（最新消息）
```

**典型用例**：

**场景 1**：简化旧消息
```json
{
  "findRegex": "(详细描述了.{20,})",
  "replaceString": "[省略详细描述]",
  "minDepth": 10,
  "comment": "旧消息太详细浪费 token，简化它们"
}
```

**场景 2**：保护近期消息
```json
{
  "findRegex": "\\*",
  "replaceString": "",
  "maxDepth": 5,
  "comment": "只删除旧消息的星号，保留近期格式"
}
```

### 本项目的当前问题

```typescript
// PresetImporter.ts 导入了字段
minDepth: item.minDepth,
maxDepth: item.maxDepth,

// 但 RegexScriptEngine.ts 忽略它们
// 所有消息都会被处理
```

### 为什么重要

**影响**：
- ❌ **Token 优化**：无法简化旧消息节省 token
- ❌ **格式保护**：无法保护近期消息的格式
- ❌ **精确控制**：无法按深度分层处理历史

**使用场景**：长对话中简化旧消息、保留近期消息格式、按时间衰减处理

**修复优先级**：⭐⭐ P1（重要）

---

## 总结对比表

| 项目 | 影响范围 | 修复难度 | 优先级 | 预计工时 |
|------|----------|----------|--------|----------|
| 1. few-shot 解析 | 角色学习效果 | 中 | ⭐⭐⭐ P0 | 0.5 天 |
| 2. depth_prompt | 长对话人设保持 | 低 | ⭐⭐⭐ P0 | 0.5 天 |
| 4. Swipe | 调试体验 | 中 | ⭐⭐ P1 | 1.5 天 |
| 5. Continue | 长回复场景 | 低 | ⭐⭐ P1 | 0.5 天 |
| 8. 六源扫描 | 深度世界观卡 | 中 | ⭐⭐ P1 | 1 天 |
| 9. AN/EM/outlet | 精细注入控制 | 低 | ⭐⭐ P1 | 0.5 天 |
| 10. WI 走正则 | 格式一致性 | 低 | ⭐⭐ P1 | 0.5 天 |
| 12. 正则函数替换 | 复杂文本处理 | 中 | ⭐⭐ P1 | 1 天 |
| 13. substituteRegex | 嵌套正则 | 低 | ⭐⭐ P1 | 0.5 天 |
| 14. 深度过滤 | Token 优化 | 低 | ⭐⭐ P1 | 0.5 天 |

**总计**：7 天工作量

---

## 建议实施顺序

### 第 1 批：P0 基础功能（1 天）
1. ✅ few-shot 解析（0.5 天）
2. ✅ depth_prompt 注入（0.5 天）

**理由**：直接影响角色卡的基本功能，必须优先修复

### 第 2 批：用户体验提升（2 天）
3. ✅ Continue 续写（0.5 天）
4. ✅ Swipe 多候选（1.5 天）

**理由**：显著提升调试和使用体验

### 第 3 批：世界书深度集成（2 天）
5. ✅ 六源扫描（1 天）
6. ✅ AN/EM/outlet 注入（0.5 天）
7. ✅ WI 走正则（0.5 天）

**理由**：对齐复杂世界书卡的功能

### 第 4 批：正则高级功能（2 天）
8. ✅ 函数替换（1 天）
9. ✅ substituteRegex（0.5 天）
10. ✅ 深度过滤（0.5 天）

**理由**：满足高级用户的复杂需求

---

## 关键技术难点

### 1. few-shot 解析
- 需要实现类似 `parseExampleIntoIndividual` 的行解析逻辑
- 状态机切换（in_user / in_bot）
- 输出为 message 数组而非字符串

### 2. Swipe 数据结构
- 修改 Message 类型定义
- UI 需要左右滑动组件
- 保存/加载时需要处理 swipes 数组

### 3. 正则函数替换
- 需要实现 `{{match}}` → 捕获整个匹配
- 需要解析具名捕获组 `$<name>`
- 替换时动态替换这些变量

### 4. 深度过滤
- 需要在 RegexScriptEngine 中传入消息深度信息
- 计算 depth = messages.length - index
- 根据 minDepth/maxDepth 过滤
