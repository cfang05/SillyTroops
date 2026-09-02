// utils/collect/collect-trait.js
// 人物特性管理（账号级，按 openid 存储）
// 所有特性的定义、描述、效果均在此文件统一管理
//
// 效果类型规范：utils/effects/effect-types.js（EFFECT_TYPE / EFFECT_TRIGGER / EFFECT_DURATION）
// passiveEffects  — trigger: 'passive'，游戏开始时自动施加，duration 通常为 'permanent'
// activeEffects   — trigger: 'active'，玩家手动触发（预留字段，执行逻辑待实现）
// conditionEffects— trigger: 'condition'，满足特定条件自动触发（如低血量）

const STORAGE_KEY_PREFIX = 'collected_traits';

/**
 * 生成存储键名
 */
function getStorageKey(openid) {
  if (!openid) {
    console.warn('[CollectTrait] openid 为空');
    return null;
  }
  return `${STORAGE_KEY_PREFIX}_${openid}`;
}

/**
 * 收集人物特性定义
 *
 * 字段说明：
 * - id:               唯一标识符
 * - name:             显示名称
 * - description:      玩家可见的背景描述（有些性格化文字）
 * - effect:           玩家可见的效果描述（直接）
 * - icon:             emoji 图标
 * - category:         分类 'combat'|'social'|'survival'|'fate'|'curse'
 * - defaultUnlocked:  是否默认解锁
 * - rarity:           稀有度 'common'|'uncommon'|'rare'|'epic'
 *
 * passiveEffects:     游戏开始时自动施加的效果（格式与 EFFECT_TYPE 一致）
 *   - type:           见 item-types.js EFFECT_TYPE
 *   - value:          数值
 *   - stat / attr:    目标属性
 *   - duration:       'permanent'（特性效果始终为永久）
 *   - description:    可读描述
 *
 * combatBonus:        战斗系统直接读取的数值加成（combatManager 使用）
 *   - attackBonus:    攻击命中加值（累加到 d20）
 *   - damageBonus:    伤害加值（累加到伤害骰）
 *   - acBonus:        AC 加值
 *   - initiative:     先攻加值
 *   - critMin:        暴击最低骰点（默认 20，设为 19 = 19-20 皆暴击）
 *   - diceBonus:      所有检定通用加值
 */
const TRAITS = [
  // ── 默认解锁（所有玩家都有）──────────────────────────────────────
  {
    id: 'cautious',
    name: '谨慎',
    icon: '🔍',
    category: 'fate',
    description: '保持思考才能避免不利的事态。任何时候都不轻易冒进。',
    effect: '所有技能检定+1。',
    rarity: 'common',
    defaultUnlocked: true,
    passiveEffects: [
      { type: 'dice_bonus', value: 1, checkType: 'skill', duration: 'permanent', description: '技能检定+1' }
    ],
    combatBonus: { diceBonus: 1 }
  },

  // ── 战斗系（combat）──────────────────────────────────────────────
  {
    id: 'berserker',
    name: '狂战士',
    icon: '⚔️',
    category: 'combat',
    description: '放出心中猛兽，用狂暴代替理智。身上哪怕只剩1点HP，战斗欲望也丝毫不减。',
    effect: '近战攻击与伤害检定+2。HP 低于 50% 时额外+2（共+4）。',
    rarity: 'uncommon',
    defaultUnlocked: true,
    passiveEffects: [
      { type: 'attack_bonus', value: 2, attackType: 'melee', duration: 'permanent', description: '近战攻击+2' }
    ],
    combatBonus: { attackBonus: 2, damageBonus: 2 },
    // 低血量额外加成由 combatManager 动态处理
    lowHpBonus: { threshold: 0.5, attackBonus: 2, damageBonus: 2 }
  },
  {
    id: 'sharpshooter',
    name: '神射手',
    icon: '🏹',
    category: 'combat',
    description: '每一次拉弓都不会浪费。你的眼睛比任何瞄准镜都更精准。',
    effect: '远程攻击+3，暴击范围扩展为19-20。',
    rarity: 'rare',
    defaultUnlocked: true,
    passiveEffects: [
      { type: 'attack_bonus', value: 3, attackType: 'ranged', duration: 'permanent', description: '远程攻击+3' },
      { type: 'expand_crit', critMin: 19, duration: 'permanent', description: '暴击范围19-20' }
    ],
    combatBonus: { attackBonus: 3, critMin: 19 }
  },
  {
    id: 'iron_skin',
    name: '铁皮肤',
    icon: '🛡️',
    category: 'combat',
    description: '皮肤如铠甲，刀枪难入。天生的体格让普通伤害如拂过轻风。',
    effect: 'AC+2，每次受到伤害减少1点。',
    rarity: 'uncommon',
    defaultUnlocked: true,
    passiveEffects: [
      { type: 'ac_boost', value: 2, duration: 'permanent', description: 'AC+2' },
      { type: 'damage_absorb', value: 1, duration: 'permanent', description: '受到伤害减少1' }
    ],
    combatBonus: { acBonus: 2, damageReduction: 1 }
  },
  {
    id: 'quick_reflexes',
    name: '迅捷反应',
    icon: '⚡',
    category: 'combat',
    description: '危险还未降临，身体已经做出反应。你永远是最快行动的人。',
    effect: '先攻+4，战斗中第一轮攻击检定+2。',
    rarity: 'uncommon',
    defaultUnlocked: true,
    passiveEffects: [
      { type: 'attr_boost', attr: 'dex', value: 4, duration: 'permanent', description: 'DEX+4（先攻加成）' }
    ],
    combatBonus: { initiative: 4, firstRoundAttackBonus: 2 }
  },

  // ── 社交系（social）──────────────────────────────────────────────
  {
    id: 'silver_tongue',
    name: '银舌头',
    icon: '💬',
    category: 'social',
    description: '说话就像帆布上的色彩一样自然。任何人都愿意相信你说的话。',
    effect: '说服/欺骗检定+3，与NPC初始信任度+5。',
    rarity: 'rare',
    defaultUnlocked: true,
    passiveEffects: [
      { type: 'skill_bonus', skill: 'persuasion', value: 3, duration: 'permanent', description: '说服检定+3' },
      { type: 'skill_bonus', skill: 'deception', value: 3, duration: 'permanent', description: '欺骗检定+3' }
    ],
    combatBonus: {},
    socialBonus: { initialTrustBonus: 5 }
  },
  {
    id: 'empath',
    name: '共情者',
    icon: '❤️',
    category: 'social',
    description: '你能感到他人的需求与困惑，仿佛他们就是你自己的。',
    effect: '洞察检定+3，向NPC赠予物品时信任度额外+3。',
    rarity: 'uncommon',
    defaultUnlocked: true,
    passiveEffects: [
      { type: 'skill_bonus', skill: 'insight', value: 3, duration: 'permanent', description: '洞察检定+3' }
    ],
    combatBonus: {},
    socialBonus: { giveItemTrustBonus: 3 }
  },

  // ── 生存系（survival）────────────────────────────────────────────
  {
    id: 'tough',
    name: '强韧',
    icon: '💪',
    category: 'survival',
    description: '比常人更能承受痛苦。你的身体能承受超越常人的打击。',
    effect: '最大HP+10，体质检定+2。',
    rarity: 'common',
    defaultUnlocked: true,
    passiveEffects: [
      { type: 'max_hp_boost', value: 10, duration: 'permanent', description: '最大HP+10' },
      { type: 'skill_bonus', skill: 'constitution', value: 2, duration: 'permanent', description: '体质检定+2' }
    ],
    combatBonus: { maxHpBonus: 10 }
  },
  {
    id: 'night_owl',
    name: '夜枭',
    icon: '🦉',
    category: 'survival',
    description: '黑暗是你的家园，而不是阻碍。你的双眼能在漆黑的阴影中寻找光亮。',
    effect: '黑暗环境中感知检定+4，永久不受黑暗地形陷阱。',
    rarity: 'uncommon',
    defaultUnlocked: true,
    passiveEffects: [
      { type: 'skill_bonus', skill: 'perception', value: 4, duration: 'permanent', description: '感知+4（黑暗）' },
      { type: 'set_flag', target: 'has_darkvision', value: true, duration: 'permanent', description: '黑暗视觉' }
    ],
    combatBonus: {}
  },

  // ── 命运系（fate）────────────────────────────────────────────────
  {
    id: 'lucky',
    name: '幸运儿',
    icon: '🍀',
    category: 'fate',
    description: '命运似乎偏爱你。每当你站在崩溃边缘，命运总会伸手把你拉回来。',
    effect: '每场景可将一次骰点重骰一次，取较高结果。',
    rarity: 'rare',
    defaultUnlocked: true,
    passiveEffects: [
      { type: 'reroll', times: 1, duration: 'scene', description: '每场景可重骰1次，取高' }
    ],
    combatBonus: { sceneLuckyReroll: 1 }
  },
  {
    id: 'jinxed',
    name: '厄运体质',
    icon: '🌑',
    category: 'curse',
    description: '不幸如影随形。但也许，极度的霉运反而会产生某种悲剧性的逆运气。',
    effect: '所有检定-1，但大失败（自然1）时获得随机奖励。',
    rarity: 'epic',
    defaultUnlocked: true,
    passiveEffects: [
      { type: 'dice_bonus', value: -1, checkType: 'all', duration: 'permanent', description: '所有检定-1' },
      { type: 'set_flag', target: 'trait_jinxed_active', value: true, duration: 'permanent', description: '大失败触发奖励' }
    ],
    combatBonus: { diceBonus: -1, critFail1TriggerSpecial: true }
  }
];

/**
 * 根据ID获取特性定义（静态数据）
 * @param {string} traitId
 * @returns {Object|null}
 */
function getTraitDef(traitId) {
  return TRAITS.find(t => t.id === traitId) || null;
}

/**
 * 获取所有特性定义
 * @returns {Array}
 */
function getAllTraitDefs() {
  return TRAITS;
}

/**
 * 获取用户已收集的特性ID列表
 * @param {string} openid
 * @returns {Array<string>}
 */
function getCollectedTraits(openid) {
  const key = getStorageKey(openid);
  if (!key) return [];

  try {
    const stored = uni.getStorageSync(key);
    return stored || [];
  } catch (error) {
    console.error('[CollectTrait] 获取收集特性失败:', error);
    return [];
  }
}

/**
 * 保存收集的特性ID列表
 * @param {string} openid
 * @param {Array<string>} traits
 */
function saveCollectedTraits(openid, traits) {
  const key = getStorageKey(openid);
  if (!key) return;

  try {
    uni.setStorageSync(key, traits);
  } catch (error) {
    console.error('[CollectTrait] 保存收集特性失败:', error);
  }
}

/**
 * 获取用户所有已解锁的特性（含defaultUnlocked）
 * @param {string} openid
 * @returns {Array} 已解锁的特性完整信息数组
 */
function getUnlockedTraits(openid) {
  const collectedIds = getCollectedTraits(openid);
  return TRAITS.filter(trait => {
    return trait.defaultUnlocked || collectedIds.includes(trait.id);
  });
}

/**
 * 添加收集的特性
 * @param {string} openid
 * @param {string} traitId
 * @returns {boolean}
 */
function addCollectedTrait(openid, traitId) {
  const collectedIds = getCollectedTraits(openid);
  if (!collectedIds.includes(traitId)) {
    collectedIds.push(traitId);
    saveCollectedTraits(openid, collectedIds);
    console.log(`[CollectTrait] 添加特性: ${traitId}`);
    return true;
  }
  return false;
}

/**
 * 移除收集的特性（不可移除defaultUnlocked的特性）
 * @param {string} openid
 * @param {string} traitId
 */
function removeCollectedTrait(openid, traitId) {
  const trait = getTraitDef(traitId);
  if (trait && trait.defaultUnlocked) {
    console.warn('[CollectTrait] 无法移除默认解锁特性:', traitId);
    return;
  }
  const collectedIds = getCollectedTraits(openid);
  const filtered = collectedIds.filter(id => id !== traitId);
  if (filtered.length !== collectedIds.length) {
    saveCollectedTraits(openid, filtered);
    console.log(`[CollectTrait] 移除特性: ${traitId}`);
  }
}

/**
 * 解锁特性
 * @param {string} openid
 * @param {string} traitId
 * @returns {boolean}
 */
function unlockTrait(openid, traitId) {
  return addCollectedTrait(openid, traitId);
}

/**
 * 检查特性是否已解锁
 * @param {string} openid
 * @param {string} traitId
 * @returns {boolean}
 */
function isTraitUnlocked(openid, traitId) {
  const trait = getTraitDef(traitId);
  if (!trait) return false;
  if (trait.defaultUnlocked) return true;
  const collectedIds = getCollectedTraits(openid);
  return collectedIds.includes(traitId);
}

/**
 * 获取特性完整信息（含解锁状态）
 * @param {string} openid - 可为 null
 * @param {string} traitId
 * @returns {Object|null}
 */
function getTraitById(openid, traitId) {
  const trait = getTraitDef(traitId);
  if (!trait) return null;
  return {
    ...trait,
    unlocked: openid ? isTraitUnlocked(openid, traitId) : trait.defaultUnlocked
  };
}

export default {
  TRAITS,
  getTraitDef,
  getAllTraitDefs,
  getCollectedTraits,
  getUnlockedTraits,
  addCollectedTrait,
  removeCollectedTrait,
  unlockTrait,
  isTraitUnlocked,
  getTraitById
};
