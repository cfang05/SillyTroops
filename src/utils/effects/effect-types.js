// utils/effects/effect-types.js
// 效果类型系统 —— 全局共用，物品/特性/魔法/技能等所有系统均从此文件引用
//
// 设计原则：
//   - EFFECT_TYPE   定义"做什么"（效果种类）
//   - EFFECT_TRIGGER 定义"何时触发"（触发时机）
//   - EFFECT_DURATION 定义"持续多久"（持续时长）
//
// 使用方式：
//   const { EFFECT_TYPE, EFFECT_TRIGGER, EFFECT_DURATION } = require('../effects/effect-types.js');

// ════════════════════════════════════════════════════════════════
// EFFECT_TRIGGER — 触发时机
// ════════════════════════════════════════════════════════════════

/**
 * 效果触发时机
 *
 * PASSIVE   — 被动持续效果，游戏开始时自动施加（人物特性 passiveEffects 使用）
 * ACTIVE    — 主动使用触发（物品 effects、特性主动技能 activeEffects 使用）
 * COMBAT    — 战斗轮次触发（如每轮开始/结束时自动执行）
 * CONDITION — 条件满足时触发（如 HP < 50%、某 flag 为 true 时）
 * ON_HIT    — 命中时触发（攻击命中后附带效果）
 * ON_KILL   — 击杀时触发
 * ON_DAMAGED — 受到伤害时触发
 */
const EFFECT_TRIGGER = {
  PASSIVE:    'passive',
  ACTIVE:     'active',
  COMBAT:     'combat',
  CONDITION:  'condition',
  ON_HIT:     'on_hit',
  ON_KILL:    'on_kill',
  ON_DAMAGED: 'on_damaged'
};

// ════════════════════════════════════════════════════════════════
// EFFECT_DURATION — 持续时长
// ════════════════════════════════════════════════════════════════

/**
 * 效果持续类型
 *
 * ONCE      — 仅触发一次，立即消耗
 * SCENE     — 持续到本场景结束
 * COMBAT    — 持续到战斗结束
 * PERMANENT — 永久（角色消亡前不消除，特性专用）
 * 数字       — 持续 N 轮（在效果对象中直接写数字）
 */
const EFFECT_DURATION = {
  ONCE:      'once',
  SCENE:     'scene',
  COMBAT:    'combat',
  PERMANENT: 'permanent'
};

// ════════════════════════════════════════════════════════════════
// EFFECT_TYPE — 效果种类（8大类完整体系）
//
// 1. RESTORATION    恢复与续航类
// 2. AUGMENTATION   属性与数值强化类
// 3. OFFENSIVE      伤害与攻击类
// 4. CROWD_CONTROL  控制与状态干扰类
// 5. UTILITY        环境与叙事交互类
// 6. PROTECTION     防御与护盾类
// 7. RISKY          风险与诅咒类
// 8. FATE           命运与概率修正类
// ════════════════════════════════════════════════════════════════

const EFFECT_TYPE = {

  // ──────────────────────────────────────────────────────────────
  // 1. 恢复与续航类 (Restoration)
  // ──────────────────────────────────────────────────────────────

  /** 立即恢复 HP。value: 数值 或 '50%' */
  RESTORE_HP:  'restore_hp',

  /** 恢复法术位/气点等资源。value: 数值 */
  RESTORE_MP:  'restore_mp',

  /** 恢复理智值。value: 数值 */
  RESTORE_SAN: 'restore_san',

  /** 移除负面状态。target: 'poison'|'burn'|'all' */
  CLEANSE:     'cleanse',

  /** 濒死稳定，阻止死亡豁免失败累积 */
  STABILIZE:   'stabilize',

  /** 复活。value: 复活后HP百分比（如 50 = 50%） */
  REVIVE:      'revive',

  // ──────────────────────────────────────────────────────────────
  // 2. 属性与数值强化类 (Augmentation)
  // ──────────────────────────────────────────────────────────────

  /** 临时提升六维属性。attr:'str'|'dex'|'con'|'int'|'wis'|'cha', value, duration */
  ATTR_BOOST:    'attr_boost',

  /** 攻击/伤害加值。value, attackType:'melee'|'ranged'|'magic'|'all', duration */
  ATTACK_BONUS:  'attack_bonus',

  /** 临时AC提升。value, duration */
  AC_BOOST:      'ac_boost',

  /** 特定技能加值。skill:'perception'|'stealth'|'persuasion'|'deception'|'insight'等, value */
  SKILL_BONUS:   'skill_bonus',

  /** 移动速度加减。value（负值=减速） */
  SPEED_BOOST:   'speed_boost',

  /** 提升/降低最大HP。value（负值=降低） */
  MAX_HP_BOOST:  'max_hp_boost',

  // ──────────────────────────────────────────────────────────────
  // 3. 伤害与攻击类 (Offensive)
  // ──────────────────────────────────────────────────────────────

  /** 直接伤害。value, dmgType:'fire'|'acid'|'cold'|'physical'|'shadow'等, target:'enemy'|'self'|npcId */
  DAMAGE:        'damage',

  /** 武器临时附魔（下一次攻击附带额外伤害）。value, dmgType */
  WEAPON_ENCHANT: 'weapon_enchant',

  /** 持续伤害（每轮）。value, duration:轮数, dmgType */
  DOT:           'dot',

  /** 造成伤害并回复等量HP。value */
  LIFESTEAL:     'lifesteal',

  // ──────────────────────────────────────────────────────────────
  // 4. 控制与状态干扰类 (Crowd Control & Debuffs)
  // ──────────────────────────────────────────────────────────────

  /** 施加状态。status:'paralyzed'|'blind'|'fear'|'stun'|'silence'|'slow'|'confuse', duration:轮数, target */
  APPLY_STATUS:  'apply_status',

  /** 降低目标数值。attr:'ac'|'str'等, value:负值, duration, target */
  DEBUFF:        'debuff',

  /** 强制位移。direction:'away'|'toward', distance:数值 */
  FORCED_MOVE:   'forced_move',

  /** 魅惑/混乱。type:'charm'|'confuse', duration, target */
  MIND_CONTROL:  'mind_control',

  // ──────────────────────────────────────────────────────────────
  // 5. 环境与叙事交互类 (Utility & Environmental)
  // ──────────────────────────────────────────────────────────────

  /** 改变地形。terrain:'difficult'|'wall'|'ice'|'thorns' */
  CREATE_TERRAIN: 'create_terrain',

  /** 传送。target:'self'|'marked', destination:描述 */
  TELEPORT:      'teleport',

  /** 隐身/烟雾。type:'invisible'|'smoke', duration */
  STEALTH:       'stealth',

  /** 侦测。detect:'traps'|'magic'|'hidden'|'thoughts' */
  DETECT:        'detect',

  /** 召唤。entity:召唤物描述, duration */
  SUMMON:        'summon',

  /** 解锁区域/选项。target:区域ID */
  UNLOCK_AREA:   'unlock_area',

  /** 设置剧情旗标。target:flag名, value */
  SET_FLAG:      'set_flag',

  /** 推进剧情节点。target:节点ID, value */
  STORY_ADVANCE: 'story_advance',

  /** NPC好感变化。target:npcId, value:正负数值 */
  TRUST_BOOST:   'trust_boost',

  // ──────────────────────────────────────────────────────────────
  // 6. 防御与护盾类 (Shield & Protection)
  // ──────────────────────────────────────────────────────────────

  /** 获得临时生命值（优先承受伤害）。value */
  TEMP_HP:          'temp_hp',

  /** 吸收固定数值伤害。value, duration:'once'|轮数 */
  DAMAGE_ABSORB:    'damage_absorb',

  /** 伤害反弹。ratio:0-1, duration:轮数 */
  DAMAGE_REFLECT:   'damage_reflect',

  /** 特定伤害免疫。dmgType:'fire'|'cold'等, duration:轮数 */
  DAMAGE_IMMUNITY:  'damage_immunity',

  /** 被动防御效果（装备时持续）。value */
  PASSIVE_DEFENSE:  'passive_defense',

  // ──────────────────────────────────────────────────────────────
  // 7. 风险与诅咒类 (Curses & Risky Effects)
  // ──────────────────────────────────────────────────────────────

  /** 恢复HP但永久损失最大HP。restoreValue, cost:永久损失量 */
  RISKY_RESTORE:  'risky_restore',

  /** 随机效果（从数组中随机选一个执行）。effects:[效果对象数组] */
  RANDOM_EFFECT:  'random_effect',

  /** 装备绑定/诅咒（持续debuff）。stat, value:负值 */
  CURSE:          'curse',

  /** 延迟生效。rounds:延迟轮数, subEffect:实际效果对象 */
  DELAYED_EFFECT: 'delayed_effect',

  /** 成瘾（效果随使用次数递减×0.7）。baseValue, flagKey */
  ADDICTION:      'addiction',

  // ──────────────────────────────────────────────────────────────
  // 8. 命运与概率修正类 (Probability & Fate Modification)
  // ──────────────────────────────────────────────────────────────

  /** 静态检定加值。value, checkType:'all'|'attack'|'skill'|'save', duration:'once'|'scene' */
  DICE_BONUS:    'dice_bonus',

  /** 额外奖励骰（加入总值）。die:'d4'|'d6', duration:'once' */
  EXTRA_DIE:     'extra_die',

  /** 优势（取高）。checkType:'all'|'attack'|'skill', duration:'once'|'scene' */
  ADVANTAGE:     'advantage',

  /** 对目标施加劣势（取低）。target:npcId, checkType, duration */
  DISADVANTAGE:  'disadvantage',

  /** 扩展暴击范围。critMin:19（则19-20皆暴击）, duration:'scene' */
  EXPAND_CRIT:   'expand_crit',

  /** 允许重骰失败检定。times:次数, duration:'once' */
  REROLL:        'reroll',

  // ──────────────────────────────────────────────────────────────
  // 通用兜底
  // ──────────────────────────────────────────────────────────────

  /** 自定义效果，由 LLM/叙述者处理。description:效果描述文字 */
  CUSTOM: 'custom'
};

export { EFFECT_TYPE, EFFECT_TRIGGER, EFFECT_DURATION };

export default {
  EFFECT_TYPE,
  EFFECT_TRIGGER,
  EFFECT_DURATION
};
