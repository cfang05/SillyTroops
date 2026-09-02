# TRPG 并行审计报告（旧 TRPG 玩法 vs 新 chat 对话线）

> 审计范围：`src/` 全量只读分析。目标：找出旧 TRPG 玩法代码与新 chat 模式之间所有并行/重复/死代码，产出可执行统一方案。
> 审计方式：grep 全量 import 引用 + 逐文件阅读。
> 约束遵守：本报告所有存储/网络建议均遵守 `.clinerules`（双端 H5/小程序、禁用 localStorage、统一 `uni.*` 存储、网络走 `uni.request`/`uni.cloud`、模板禁多根节点）。

---

## 0. 结论速览（TL;DR）

- 新 chat 线（`src/engine/*` + `src/stores/*` + `chat.vue` + `conversationManager.js`）已经是主链路；会话运行时状态已正确挂在 `conversation.trpgState`，由 `trpgProfile.initTrpgState()` 生成、`trpgProfile.trpgStateToCharStatus()` 消费。
- 旧 TRPG 状态机 `stateManager.js` 目前**只有 4 个 import 方**，其中 2 个是死代码（`adventureManager`、`combatManager`），1 个是无调用方的方法（`runtimeStore.syncFromStateManager`），只剩 `item-manager.js` 是真引用——但 `chat.vue` 只用 `item-manager` 的 `init()` / `getItemDef()`，**从不触碰它内部对 stateManager 的调用**。
- 结论：**整条 `GAME_STATE_*` 状态管线（stateManager + memory/* + combat/* + adventure/* + skills/*）当前没有任何页面/store 在运行时真正读写它**。它是纯"加载但不执行"的死重，可安全拆除。
- 两套状态系统确实存在字段重复（scene/trust/items/flags/HP/MP/SAN/六维/equipment），且 `trpgState` 目前**缺** stateManager 独有的一批字段（tempHp、effective*、equipBonus、statusEffects、activeBuffs/activeDebuffs、濒死骰、npcCooldown、npcCustomAliases、lastNPC、legendaryItems）。

---

## 1. 依赖图结论

### 1.1 旧 TRPG 模块的 import 引用全景（grep 结果）

| 旧模块 | 被谁 import | 是否页面/store 可达 |
|---|---|---|
| `utils/engine/stateManager.js` | ① `stores/runtimeStore.ts`（仅 `syncFromStateManager`，**无任何调用方**）② `utils/adventure/adventureManager.js`（死）③ `utils/combat/combatManager.js`（死）④ `utils/items/item-manager.js`（活，但仅 `init/getItemDef` 路径使用） | **半可达**：被 `item-manager` 加载进 bundle，但运行时无 live 页面调用其状态读写函数 |
| `utils/memory/atomicEvent.js` | 仅 `stateManager.js`（`applyIntent`/`addCustomAlias` 内部） | **不可达**（调用方函数本身无人调用） |
| `utils/memory/interactionLog.js` | 仅 `adventureManager.js` | **不可达** |
| `utils/memory/storyFragment.js` | 仅 `adventureManager.js`（自身还 import `llm/client.js`） | **不可达** |
| `utils/ai-helper.js` | **零 import**（仅 `llm/client.js` 注释提及） | **完全不可达** |
| `utils/combat/combatManager.js` | **零 import** | **完全不可达** |
| `utils/combat/enemyAI.js` | **零 import** | **完全不可达** |
| `utils/combat/enemyGenerator.js` | **零 import**（自身 import `llm/client.js`） | **完全不可达** |
| `utils/combat/itemEffects.js` | 仅 `combatManager.js` | **不可达** |
| `utils/combat/parseCombatTag.js` | 仅 `combatManager.js` | **不可达** |
| `utils/adventure/adventureManager.js` | **零 import** | **完全不可达** |
| `utils/skills/skills.js` | **零 import** | **完全不可达** |
| `utils/collect/collect-normal_items.js` | **零 import**（common-items 的代理层） | **完全不可达** |
| `utils/collect/collect-legend_items.js` | ① `account-manager.js`（活，App.vue）② `collect.vue`（活）③ `item-manager.js`（活，`getPlayerLegendaryItems` 休眠） | **可达（活）** |
| `utils/collect/collect-trait.js` | ① `account-manager.js`（活）② `collect.vue`（活）③ `stateManager.js`（死路径）④ `combatManager.js`（死） | **可达（活）** |
| `utils/effects/effect-types.js` | 仅 `items/item-types.js`（re-export 常量） | **可达（活，仅作为枚举常量）** |
| `utils/character_card/characterCardManager.js` | `stores/characterCardStore.ts` | **可达（活）** |
| `utils/llm/client.js` | ① `engine/MessageProcessor.ts`（活）② `combat/enemyGenerator.js`（死）③ `memory/storyFragment.js`（死） | **可达（活）** |
| `utils/llm/intentParser.js` | `chat.vue`（活，`detectIntent`） | **可达（活）** |

### 1.2 关键可达链路（live）

```
main.js → App.vue ──→ account-manager.js ──→ collect-legend_items.js / collect-trait.js
                     └→ userManager.js

pages/index/index.vue ─→ pages/collect/collect.vue ─→ collect-legend_items / collect-trait
pages/chat/chat.vue ──┬→ engine/{MessageProcessor,PromptBuilder,VariableEngine,BlockParser,RegexScriptEngine,WorldInfoEngine}
                      ├→ stores/{runtimeStore,characterCardStore,presetStore,regexPresetStore,personaStore,moduleStore,pluginStore}
                      ├→ utils/persona/trpgProfile.js（initTrpgState / trpgStateToCharStatus）
                      ├→ utils/account/conversationManager.js
                      ├→ utils/items/item-manager.js（仅 init() / getItemDef()）
                      └→ utils/llm/intentParser.js（detectIntent）

MessageProcessor ─→ PromptBuilder ─→ VariableEngine（setTrpgContext / {{hp}}/{{scene}}/{{flag}}/{{trust}} 宏）
                                  └→ WorldInfoEngine
MessageProcessor ─→ llm/client.js
VariableEngine   ─→ runtimeStore（localVariables）+ storage.js + dice-helper.js
```

### 1.3 死代码互引闭环（无人可达，仅互相引用）

```
adventureManager.js ──→ interactionLog.js / storyFragment.js / stateManager.js
combatManager.js    ──→ stateManager.js / dice-helper.js / itemEffects.js / collect-trait.js / parseCombatTag.js
enemyGenerator.js   ──→ llm/client.js
stateManager.js     ──→ storage.js / atomicEvent.js / collect-trait.js
```

这个闭环里没有任何节点被页面/store/组件反向 import（`CombatPanel.vue` 亦零引用），因此整个闭环是"加载即无副作用、运行永不执行"的死代码。

### 1.4 三分类结论

- **被页面/store 实际可达（活）**：`item-manager.js`（仅 init/getItemDef）、`collect-legend_items.js`、`collect-trait.js`、`effects/effect-types.js`（经 item-types re-export）、`characterCardManager.js`、`llm/client.js`、`llm/intentParser.js`。
- **只被其它死代码互相引用**：`stateManager.js` 的 2/4 个 import 方（`adventureManager`/`combatManager`）是死代码；`atomicEvent.js`/`interactionLog.js`/`storyFragment.js`/`itemEffects.js`/`parseCombatTag.js` 全部只被死代码引用。
- **完全无人引用**：`ai-helper.js`、`combatManager.js`、`enemyAI.js`、`enemyGenerator.js`、`adventureManager.js`、`skills.js`、`collect-normal_items.js`、`CombatPanel.vue`。

---

## 2. 死代码清单（逐文件判定）

### 2.1 完全死代码（零 import，可立即删除）

| 文件 | 大小/要点 | 判定依据 |
|---|---|---|
| `src/utils/ai-helper.js` | 279 行，`uni.cloud.extend.AI` 调用的旧封装 | grep 确认零 import；仅 `llm/client.js` 注释提到。且依赖 `uni.cloud.extend.AI`（微信云开发专属），本身还违反双端约束。**确认死代码** |
| `src/utils/skills/skills.js` | 186 行，静态技能库（火球术/冰箭等） | grep 确认零 import。**死代码** |
| `src/utils/collect/collect-normal_items.js` | 38 行，`common-items.js` 的轻量代理 | grep 确认零 import（`game.js openInventory` 已删除）。**死代码** |
| `src/utils/adventure/adventureManager.js` | 290 行，冒险存档/角色锁定 | grep 确认零 import。**死代码** |
| `src/utils/combat/combatManager.js` | 996 行，战斗管理器 | grep 确认零 import（`chat.vue` 仅注释说"Phase 4 待接入"）。**死代码** |
| `src/utils/combat/enemyAI.js` | 敌人行动决策 | grep 确认零 import。**死代码** |
| `src/utils/combat/enemyGenerator.js` | 224 行，LLM 随机敌人 | grep 确认零 import。**死代码** |
| `src/utils/combat/itemEffects.js` | 战斗内物品效果 | 仅 `combatManager.js` 引用（死）。**死代码** |
| `src/utils/combat/parseCombatTag.js` | 105 行，解析世界书 `[combat]` 行 | 仅 `combatManager.js` 引用（死）。**死代码**（但它是纯函数，若要保留战斗可单独抢救） |
| `src/components/modules/CombatPanel.vue` | 战斗面板组件 | grep 确认零 import（chat.vue 只 import CharacterStatus/InventoryPanel/DiceRoller）。**死代码** |
| `src/utils/memory/interactionLog.js` | 236 行，交互日志 | 仅 `adventureManager.js` 引用（死）。**死代码** |
| `src/utils/memory/storyFragment.js` | 297 行，LLM 故事摘要 | 仅 `adventureManager.js` 引用（死）。**死代码** |

### 2.2 条件死代码（可达，但运行时实际不执行的成员）

| 文件 | 判定 |
|---|---|
| `src/utils/memory/atomicEvent.js` | 仅 `stateManager.applyIntent`/`addCustomAlias` 调用，而这两个函数无 live 调用方。**加载但不执行**。随 stateManager 这两函数一并删除即可 |
| `src/utils/engine/stateManager.js` | 被 `item-manager`（活）/`runtimeStore`（活）/`adventureManager`+`combatManager`（死）import。live 路径只触发"模块加载"，**从不调用** `getState/updateState/changeHp/...`。**状态读写函数全部休眠** |
| `src/stores/runtimeStore.ts` 的 `syncFromStateManager()`、`scene`、`setScene()` | grep 确认 `syncFromStateManager` 零调用方；`scene`/`setScene` 仅 store 内部自引用，无页面读 `runtimeStore.scene`。**死成员** |
| `src/utils/items/item-manager.js` 的 `giveItem/useItem/getPlayerInventory/getPlayerLegendaryItems/equipItem/unequipItem/buildInventoryDisplay/_applyEffect` | 这些函数内部大量调用 `stateManager.*`；但 `chat.vue` 只用 `init()` + `getItemDef()`。**这批方法是"休眠的旧玩法入口"** |

### 2.3 活代码（不可删，但需注意耦合）

| 文件 | 说明 |
|---|---|
| `utils/items/item-manager.js` | `init()`（加载 `extensions.trpg.items`）、`getItemDef()`（chat.vue 背包派生用）是 live 必需；其余 stateManager 耦合方法见 2.2 |
| `utils/collect/collect-legend_items.js` / `collect-trait.js` | 账号级收藏，`collect.vue` + `account-manager.js` 使用；与 stateManager 无关（独立 `collected_legend_items_{openid}` / `collected_traits_{openid}` 存储键） |
| `utils/effects/effect-types.js` | 仅被 `item-types.js` re-export 枚举常量；是物品/特性效果类型的**唯一定义源**，保留 |
| `utils/character_card/characterCardManager.js` | 角色卡存储层，`characterCardStore` 使用；与 stateManager 无关 |
| `utils/llm/client.js` / `intentParser.js` | chat 线核心依赖，保留 |

---

## 3. 状态并行对照表

### 3.1 两套状态系统概览

| 维度 | 旧：`stateManager.js` | 新：`conversation.trpgState` |
|---|---|---|
| 数据源 | `storage.js` → `uni.getStorageSync` | `conversationManager.save` → `uni.setStorageSync` |
| 持久化键 | `GAME_STATE_${currentStoryId}_${currentCharacterId}`（`getStateKey()`；另有 `migrateFromOldKey` 从 `STORAGE_KEYS.GAME_STATE`=`game_state` 迁移） | `u_{userId}_conversation_{cardId}` 记录的 `trpgState` 字段（`userScope.scopedKey` 前缀） |
| 状态形状 | 根级 8 字段 + 嵌套 `character` 子对象（六维分 base/effective，装备加成、buff、濒死等） | 扁平字段（`initTrpgState` 生成） |
| 初始化 | `initCharacterState(charData, force)` | `trpgProfile.initTrpgState(card, profile)` |
| 读 UI | `getCharacterState()` → 旧 CharacterStatus | `trpgProfile.trpgStateToCharStatus(trpgState)` → CharacterStatus.vue |
| 注入 LLM | `formatCharacterForLLM`（旧 charData 参数） | `PromptBuilder._buildTrpgStatusText` + `VariableEngine` `{{hp}}/{{scene}}/{{flag}}/{{trust}}` 宏 |
| 当前运行时状态 | **无 live 调用方**（休眠） | **live**（chat.vue 读写 + `_persistConversation` 持久化） |

### 3.2 字段对照表（stateManager vs trpgState）

| 语义 | stateManager 字段 | trpgState 字段（`initTrpgState`） | 判定 |
|---|---|---|---|
| 场景 | `state.scene` | `scene` | **重复** |
| 信任度 | `state.trust`（{npcId:number}） | `trust`（初始 `{}`） | **重复** |
| 物品 | `state.items`（[{id,quantity}]） | `items`（来自 `trpg.startingItems`） | **重复** |
| 剧情 flag | `state.flags`（对象） | `flags`（来自 `trpg.initialFlags`） | **重复** |
| 当前 HP | `state.character.hp` | `hp` | **重复** |
| 最大 HP | `state.character.maxHp` | `maxHp` | **重复** |
| MP / maxMp | `character.mp / maxMp` | `mp / maxMp` | **重复** |
| SAN / maxSan | `character.san / maxSan` | `san / maxSan` | **重复** |
| 六维属性 | `character.baseStr/…/baseCha` + `effectiveStr/…/effectiveCha`（双层） | `str/dex/con/int/wis/cha`（**单层扁平**，无 base/effective 区分） | **部分重复**（trpgState 缺 effective 层） |
| 装备槽 | `character.equipment`（8 槽） | `equipment`（8 槽，来自 profile.equipment） | **重复** |

### 3.3 stateManager 独有、trpgState 缺失的字段（迁移缺口）

| 字段 | 位置 | 迁移建议 |
|---|---|---|
| `legendaryItems` | `state.legendaryItems` | 账号级，**不应**放会话 trpgState；应由 `account-manager.getLegendaryItems(openid)` 提供（chat.vue 的 `legendaryItems` ref 已预留 `[]`） |
| `npcCooldown` | `state.npcCooldown` | 防刷冷却；并入 trpgState（会话级） |
| `npcCustomAliases` | `state.npcCustomAliases` | 动态别名；并入 trpgState |
| `lastNPC` | `state.lastNPC` | 并入 trpgState |
| `tempHp` | `character.tempHp` | 并入 trpgState（`PromptBuilder`/`formatCharacterForLLM` 未读，但战斗/物品需要） |
| `equipBonus` | `character.equipBonus` | 并入 trpgState（`formatCharacterForLLM` 已读 `dynState.equipBonus`） |
| `effectiveStr/…/effectiveCha` | `character.effective*` | 并入 trpgState（`_buildTrpgStatusText` 已读 `c.effective* ?? c.base* ?? c.str`） |
| `effectiveAc` / `effectiveWeapon` | `character.effectiveAc/effectiveWeapon` | 并入 trpgState |
| `activeBuffs` / `activeDebuffs` | `character.activeBuffs/activeDebuffs` | 并入 trpgState |
| `statusEffects` | `character.statusEffects` | 并入 trpgState（`trpgStateToCharStatus` 已读 `s.statusEffects`，`formatCharacterForLLM` 已读） |
| `isDying` / `deathSaveSuccesses` / `deathSaveFailures` | `character.*` | 并入 trpgState |
| `currentStoryId` / `currentCharacterId` / `currentCharacterData` / `currentNpcs` | 模块闭包变量（非 state 持久化） | 迁移到 chat.vue 的 `sessionCardId` / `activeCard` / `extensions.trpg.npcs` |

### 3.4 trpgState 独有字段

| 字段 | 说明 |
|---|---|
| `story` | 卡片名（`initTrpgState` 里 `(card && card.name) || ''`），替代旧 `currentStoryId` |

> **核心重复存储风险**：若保留 stateManager 且未来重新接线，`scene/trust/items/flags/HP/MP/SAN/六维/equipment` 会同时写 `GAME_STATE_*` 与 `conversation.trpgState` 两处，产生双写漂移。当前唯一事实来源应定为 **`conversation.trpgState`**。

---

## 4. 分步统一方案（按依赖顺序）

### 步骤 (a)：可立即安全删除的文件（风险：低）

删除（或归档）以下零 import 文件：

1. `src/utils/ai-helper.js`
2. `src/utils/skills/skills.js`
3. `src/utils/collect/collect-normal_items.js`
4. `src/utils/adventure/adventureManager.js`
5. `src/utils/combat/combatManager.js`
6. `src/utils/combat/enemyAI.js`
7. `src/utils/combat/enemyGenerator.js`
8. `src/utils/combat/itemEffects.js`
9. `src/utils/combat/parseCombatTag.js`（若 Phase 4 计划接战斗，仅此文件可抢救为纯函数，见步骤 d）
10. `src/components/modules/CombatPanel.vue`
11. `src/utils/memory/interactionLog.js`
12. `src/utils/memory/storyFragment.js`

同时删除死成员：

- `src/stores/runtimeStore.ts`：删除 `syncFromStateManager()`、`scene` 字段、`setScene()`，并删除 `import stateManager from '../utils/engine/stateManager.js'`。
- `src/utils/engine/stateManager.js`：删除 `applyIntent()`、`addCustomAlias()`/`getCustomAliases()`/`getLastNPC()`（这 5 个函数是 `atomicEvent` 与 npcCooldown/npcCustomAliases/lastNPC 的唯一消费者，live 无调用方）。
- 随后 `src/utils/memory/atomicEvent.js` 成为零 import，一并删除（步骤 e）。

> 风险说明：均为 grep 确认零引用/零调用。唯一注意点——若团队仍在"Phase 4 战斗"路线图上，`combatManager.js`/`parseCombatTag.js`/`CombatPanel.vue` 建议先归档而非物理删除；其余可放心删。

### 步骤 (b)：stateManager 迁出纯函数（风险：中）

参照先例 `src/utils/persona/trpgProfile.js`（已迁移 `createDefaultCharacterData/buildCharStatus/formatCharacterForLLM/calcModifier/initTrpgState/trpgStateToCharStatus` 为纯函数），把 stateManager 里仍需要的逻辑迁为"传入状态、返回新状态"的纯函数，**移除 `storage`/`GAME_STATE_*`/`atomicEvent` 依赖**。

新建 `src/utils/trpg/trpgRules.js`（或并入 trpgProfile.js），迁出：

| stateManager 原函数 | 迁移形态 | 备注 |
|---|---|---|
| `getCombatStats(character)` | 已是纯函数，直接搬 | 唯一零改造即可迁移的函数 |
| `changeHp(delta)` → `changeHp(state, delta)` | 纯 reducer，返回 `{ state, result }` | 保留 tempHp 优先扣血逻辑 |
| `changeMp` / `changeSan` / `changeMaxHp` / `addTempHp` | 纯 reducer | 上限钳制逻辑保留 |
| `addTempBuff` / `addStatus` / `removeStatus` / `hasStatus` | 纯 reducer | 操作 `state.character.activeBuffs/activeDebuffs/statusEffects` |
| `recalcEffectiveStats(getItemDefFn)` | 纯 reducer，返回新 `state` | 装备→effective* 重算 |
| `equipToSlot` / `syncCombatHpBack` | 纯 reducer | 战斗/装备回写 |
| `initCharacterState(charData, force)` | 纯函数：`(charData, traits) => initialState.character` | 与 `initTrpgState` 合并成一个入口 |
| `_applyTraitPassiveEffects(traitIds, baseMaxHp)` | 纯函数，flag/attr 变更以返回值输出 | 依赖 `collect-trait.getTraitDef`（保留） |
| `applyIntent(intent)` | 拆为纯 reducer（信任度/冷却/别名变更）+ 外部副作用（事件日志） | 当前无调用方，可整体删除；如保留则去掉 `atomicEvent` 写入 |
| `hasItem/addItem/removeItem/getItems` | 纯函数，接收 `state.items` | 供 item-manager 复用 |
| `getFlag/setFlag/…` | 无需迁移，直接读写 `trpgState.flags` | |

**不迁移**（直接删除）：`getState/updateState/resetState/migrateFromOldKey/setCurrentStory/setCurrentCharacter/setCurrentCard/getStateStats` 等 storage/闭包状态管理函数——它们的职责已被 `conversationManager` + `chat.vue` 的 `trpgState` ref + `_persistConversation()` 取代。

> 风险：中。纯函数迁移需保证数值语义一致（尤其 tempHp 扣血顺序、maxHp 钳制、buff 同 id 覆盖）。建议迁移后为 `changeHp/changeMaxHp/recalcEffectiveStats` 补 3-5 个单测式断言。

### 步骤 (c)：`runtimeStore.syncFromStateManager` 改造（风险：低）

现状：`runtimeStore.ts` 里 `syncFromStateManager()` 读 `stateManager.getState().scene`，**零调用方**；`scene`/`setScene` 也零外部使用。

方案二选一（推荐 ①）：

1. **直接删除** `syncFromStateManager`/`scene`/`setScene`（当前无消费方；场景值已由 `PromptBuilder`/`VariableEngine` 经 `trpgState.scene` 注入，无需 store 中转）。
2. 若后续 UI 需要响应式场景，改为 `syncFromTrpgState(trpgState)`：
   ```ts
   syncFromTrpgState(trpgState: Record<string, any> | null) {
     this.scene = (trpgState && trpgState.scene) || '未知地点'
   }
   ```
   并在 `chat.vue` 的 `_loadConversation`/`_startFresh` 里调用 `runtimeStore.syncFromTrpgState(trpgState.value)`。

无论哪种，都删除 `runtimeStore.ts` 顶部的 `import stateManager`。

> 风险：低。仅动 store 内死成员 + 一个 import。

### 步骤 (d)：combatManager / item-manager / adventureManager 的 stateManager 依赖切换（风险：中/低）

- **`combatManager.js`**：当前死代码。若 Phase 4 要接战斗，改为 `import { getCombatStats } from '../trpg/trpgRules.js'`（步骤 b 迁出的纯函数），`initCombat(players, enemies)` 改为接收 `players` 里带 `trpgState`（调用方从 `chat.vue` 的 `trpgState.value` 传入），不再 `stateManager.getCurrentCharacterData()`。**若近期不接战斗，整目录删除（步骤 a）。**

- **`item-manager.js`**（live，重点）：保留 `init()`/`getItemDef()`/`getItemDefs()`/`getAllItemDefs()`/`registerDynamicItem()`（纯 registry 操作，无 stateManager 依赖）。改造以下 stateManager 耦合方法为"传入/返回 trpgState"：
  - `giveItem(itemId, qty, trpgState)` → `{ newTrpgState, result }`（内部用步骤 b 的纯 `addItem`）。
  - `useItem(itemId, context, trpgState)` → `{ newTrpgState, results, narrativeHint }`；`_applyEffect` 所有 `stateManager.changeHp/setFlag/addStatus/addTempBuff/…` 全部改为纯 reducer，累加变更后返回新 trpgState。
  - `getPlayerInventory(trpgState)` / `getPlayerLegendaryItems(openid)`（后者已不依赖 stateManager，改从 `account-manager` 读）/ `buildInventoryDisplay(openid, trpgState, equippedMap)`。
  - `equipItem/unequipItem` 里的 `characterManager` 参数（旧 `character-manager.js` 已删除）改为直接操作 `trpgState.equipment` + `trpgState.flags`。
  - 调用方 `chat.vue`：背包/使用物品触发时执行 `const r = itemManager.useItem(...)` 后 `trpgState.value = r.newTrpgState; _persistConversation()`。
  - **风险：低-中**（因为 `useItem/giveItem` 当前无 live 调用方，改造期间不破坏运行；真正接线时风险才上升）。`_applyEffect` 覆盖 8 大类 40+ 效果分支，改造量大，建议分 PR 按效果类迁移。

- **`adventureManager.js`**：死代码，删除（步骤 a）。它的"角色锁定/冒险存档"职责若未来需要，应由 `conversationManager`（一个 cardId 一个存档，已有）承担，不复刻。

### 步骤 (e)：memory/* 的去留（风险：低）

| 文件 | 去留 | 理由 |
|---|---|---|
| `memory/atomicEvent.js` | **删** | 仅被 stateManager 死函数调用；事件日志可由 `trpgState.flags` 或会话内轻量 log 替代。若确需诊断，写入 trpgState（随会话持久化）而非全局 `atomic_events` 键 |
| `memory/interactionLog.js` | **删** | 职责被 `conversationManager` 的 `messages`（完整对话历史已持久化）完全取代 |
| `memory/storyFragment.js` | **删** | LLM 摘要/上下文压缩职责已由 `WorldInfoEngine`（世界书）+ `messages` 承担；新 chat 线无摘要器。若将来要摘要，做成纯函数 `summarize(messages) => string`（复用 `llm/client.js`），不要做成独立 storage 模块 |

### 步骤 (f)（收尾）：统一 trpgState schema + 一次性旧数据迁移（风险：中）

1. 扩展 `trpgProfile.initTrpgState()`，补齐 3.3 的缺失字段：`tempHp/equipBonus/effectiveStr..Cha/effectiveAc/effectiveWeapon/activeBuffs/activeDebuffs/statusEffects/isDying/deathSaveSuccesses/deathSaveFailures/npcCooldown/npcCustomAliases/lastNPC`（默认值对齐 `stateManager.initialState`）。
2. 同步扩展 `trpgStateToCharStatus()`，让 CharacterStatus 面板能读到 effective* 与 statusEffects。
3. 一次性迁移：若检测到旧 `GAME_STATE_*` 数据（`storage.getGameState(storyId, charId)`），把 scene/trust/items/flags + character.* 折叠进 `conversationManager.save({ trpgState })`，随后 `storage.removeGameState(...)` 清理旧键。此逻辑只跑一次、由 `chat.vue` 的 `_loadConversation`/`_startFresh` 入口触发。
4. 最后确认 `stateManager.js` 已零 import，删除整个文件与 `src/utils/engine/README.md` 中对应示例段落（README 仍引用 stateManager API，属过期文档）。

---

## 5. 风险等级总表

| 步骤 | 涉及文件 | 风险 | 说明 |
|---|---|---|---|
| (a) 立即删除 | ai-helper/skills/collect-normal_items/adventureManager/combat/*/CombatPanel/interactionLog/storyFragment + runtimeStore 死成员 | **低** | grep 确认零引用；combatManager/parseCombatTag 若担心 Phase 4 可先归档 |
| (b) stateManager 纯函数化 | stateManager.js → 新 trpgRules.js / trpgProfile.js | **中** | 数值语义需保持；补断言验证 changeHp/changeMaxHp/recalcEffectiveStats |
| (c) runtimeStore 改造 | runtimeStore.ts | **低** | 死成员 + 删一个 import |
| (d1) combatManager 切换 | combatManager.js | **低**（死代码） | 删除或未来重接线 |
| (d2) item-manager 切换 | item-manager.js + chat.vue | **低→中** | `init/getItemDef` 现役不受影响；`useItem/_applyEffect` 改造量大但当前无调用方 |
| (d3) adventureManager | adventureManager.js | **低** | 删除 |
| (e) memory/* 去留 | atomicEvent/interactionLog/storyFragment | **低** | 职责已被 conversationManager/WorldInfoEngine 取代 |
| (f) trpgState schema 统一 + 旧数据迁移 | trpgProfile.js + chat.vue + conversationManager | **中** | 涉及持久化 schema 变更；需一次性迁移旧 GAME_STATE_*，迁移前先备份 |

---

## 6. 附：`.clinerules` 合规性提示

- **存储**：新 trpgState 已走 `conversationManager`（`uni.setStorageSync/getStorageSync`，`userScope.scopedKey` 用户隔离）✅；旧 `stateManager`/`memory/*` 走 `storage.js`（也是 `uni.*`）✅。删除时无需额外改造存储 API，但**任何新增存储不得用 `localStorage`**。
- **账号级数据**（legendaryItems/traits）用 `collected_legend_items_{openid}` / `collected_traits_{openid}`（`uni.*`），**不要**塞进会话 trpgState。
- **网络**：`ai-helper.js` 依赖 `uni.cloud.extend.AI`（微信云开发专属，非双端）；删除它后 LLM 走 `llm/client.js`（`MessageProcessor` 调用）。新 LLM/战斗网络能力若引入，须走 `uni.request` 或 `uni.cloud` + `#ifdef` 条件编译。
- **模板**：删除 `CombatPanel.vue` 不影响；其余组件模板已单根节点。

---

*报告生成方式：只读 grep + 逐文件阅读，未修改任何源文件。唯一产物为本报告。*
