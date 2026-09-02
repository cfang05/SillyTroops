// src/utils/persona/trpgProfile.js
// TRPG 数值档案纯函数集合 —— 从 utils/character_info/character-manager.js 迁移而来
//
// 设计原则（合并方案决策 6）：
//   - 只保留纯函数，不再含任何 storage / CRUD / stateManager 依赖；
//   - 局内动态状态（HP/MP/SAN/有效属性）由调用方以参数传入，而非在此处读取全局状态；
//   - 数据归宿：Persona.trpgProfile（仅当某卡开启 stats 时才需要填）。
//
// 迁移自 character-manager.js 的函数：
//   createDefaultCharacterData / buildCharStatus / formatCharacterForLLM / calcModifier

'use strict';

/**
 * 创建默认角色数据（TRPG 数值档案）
 * @param {Object} overrides - 覆盖默认值的字段
 * @returns {Object}
 */
export function createDefaultCharacterData(overrides) {
  overrides = overrides || {};
  return {
    // ── 基础信息 ────────────────────────────────────────────
    name: overrides.name || '冒险者',
    surname: overrides.surname || '',
    avatar: overrides.avatar || '',
    race: overrides.race || 'human',
    gender: overrides.gender || '',
    age: overrides.age || 0,
    class: overrides.class || '战士',
    level: overrides.level || 1,
    background: overrides.background || '',
    appearance: overrides.appearance || '',
    personality: overrides.personality || '',

    // ── 核心资源 ────────────────────────────────────────────
    hp: overrides.hp !== undefined ? overrides.hp : 20,
    maxHp: overrides.maxHp !== undefined ? overrides.maxHp : 20,
    mp: overrides.mp !== undefined ? overrides.mp : 10,
    maxMp: overrides.maxMp !== undefined ? overrides.maxMp : 10,
    san: overrides.san !== undefined ? overrides.san : 100,
    maxSan: overrides.maxSan !== undefined ? overrides.maxSan : 100,

    // ── 六维属性（D&D 5e 风格）──────────────────────────────
    attributes: Object.assign({
      str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10
    }, overrides.attributes || {}),

    // ── 衍生属性 ────────────────────────────────────────────
    ac: overrides.ac !== undefined ? overrides.ac : 10,
    initiative: overrides.initiative !== undefined ? overrides.initiative : 0,
    speed: overrides.speed !== undefined ? overrides.speed : 30,

    // ── 技能熟练项 ────────────────────────────────────────
    proficiencies: Object.assign({
      acrobatics: false, athletics: false, stealth: false, perception: false,
      insight: false, persuasion: false, deception: false, intimidation: false,
      arcana: false, history: false, nature: false, religion: false,
      medicine: false, survival: false
    }, overrides.proficiencies || {}),

    // ── 特性与能力 ────────────────────────────────────────
    traits: overrides.traits || [],

    // ── 装备栏（8 槽位，值为物品 ID）─────────────────────
    equipment: Object.assign({
      head: '', body: '', feet: '', mainWeapon: '',
      offHand: '', accessory1: '', accessory2: '', accessory3: ''
    }, overrides.equipment || {}),

    // ── 状态效果 ──────────────────────────────────────────
    statusEffects: overrides.statusEffects || [],

    // ── 特长 / 扮演提示 ────────────────────────────────────
    specialties: overrides.specialties || [],
    roleplayHints: overrides.roleplayHints || '',

    // ── 元数据 ───────────────────────────────────────────
    id: overrides.id || '',
    createdAt: overrides.createdAt || Date.now(),
    updatedAt: overrides.updatedAt || Date.now()
  };
}

/**
 * 计算属性调整值（D&D 5e 公式）
 * @param {number} score
 * @returns {string} 带符号调整值（如 "+2" / "-1"）
 */
export function calcModifier(score) {
  var mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? '+' + mod : String(mod);
}

/**
 * 从角色数据构建 UI 状态面板所需的 charStatus 对象
 * @param {Object} charData
 * @returns {Object|null}
 */
export function buildCharStatus(charData) {
  if (!charData) return null;
  var attr = charData.attributes || {};
  var equip = charData.equipment || {};

  return {
    hp: charData.hp !== undefined ? charData.hp : 20,
    maxHp: charData.maxHp !== undefined ? charData.maxHp : 20,
    mp: charData.mp !== undefined ? charData.mp : 10,
    maxMp: charData.maxMp !== undefined ? charData.maxMp : 10,
    san: charData.san !== undefined ? charData.san : 100,
    maxSan: charData.maxSan !== undefined ? charData.maxSan : 100,
    str: attr.str || 10, strMod: calcModifier(attr.str || 10),
    dex: attr.dex || 10, dexMod: calcModifier(attr.dex || 10),
    con: attr.con || 10, conMod: calcModifier(attr.con || 10),
    int: attr.int || 10, intMod: calcModifier(attr.int || 10),
    wis: attr.wis || 10, wisMod: calcModifier(attr.wis || 10),
    cha: attr.cha || 10, chaMod: calcModifier(attr.cha || 10),
    equipment: {
      head: equip.head || '', body: equip.body || '', feet: equip.feet || '',
      mainWeapon: equip.mainWeapon || '', offHand: equip.offHand || '',
      accessory1: equip.accessory1 || '', accessory2: equip.accessory2 || '', accessory3: equip.accessory3 || ''
    },
    statusEffects: charData.statusEffects || []
  };
}

/**
 * 将角色数据格式化为 LLM 注入字符串（玩家角色档案）
 * @param {Object} charData - 角色完整数据
 * @param {Object} [dynState] - 局内动态状态（{hp,maxHp,mp,maxMp,san,maxSan,effective*,equipBonus,statusEffects}），
 *                             由调用方传入（合并后来自会话 trpgState），缺省降级到静态档案值
 * @returns {string}
 */
export function formatCharacterForLLM(charData, dynState) {
  if (!charData) return '';
  var attr = charData.attributes || {};
  dynState = dynState || {};

  var curHp = (dynState.hp !== undefined && dynState.hp !== null) ? dynState.hp : charData.hp;
  var maxHp = (dynState.maxHp !== undefined && dynState.maxHp !== null) ? dynState.maxHp : charData.maxHp;
  var curMp = (dynState.mp !== undefined && dynState.mp !== null) ? dynState.mp : charData.mp;
  var maxMp = (dynState.maxMp !== undefined && dynState.maxMp !== null) ? dynState.maxMp : charData.maxMp;
  var curSan = (dynState.san !== undefined && dynState.san !== null) ? dynState.san : charData.san;
  var maxSan = (dynState.maxSan !== undefined && dynState.maxSan !== null) ? dynState.maxSan : charData.maxSan;

  var effStr = dynState.effectiveStr !== undefined ? dynState.effectiveStr : (attr.str || 10);
  var effDex = dynState.effectiveDex !== undefined ? dynState.effectiveDex : (attr.dex || 10);
  var effCon = dynState.effectiveCon !== undefined ? dynState.effectiveCon : (attr.con || 10);
  var effInt = dynState.effectiveInt !== undefined ? dynState.effectiveInt : (attr.int || 10);
  var effWis = dynState.effectiveWis !== undefined ? dynState.effectiveWis : (attr.wis || 10);
  var effCha = dynState.effectiveCha !== undefined ? dynState.effectiveCha : (attr.cha || 10);

  var lines = [
    '【玩家角色档案】',
    '姓名：' + (charData.name || '未知'),
    '种族：' + (charData.race || '未知') + '　职业：' + (charData.class || '未知') + '　等级：' + (charData.level || 1)
  ];
  if (charData.appearance) lines.push('外貌：' + charData.appearance);
  if (charData.personality) lines.push('性格：' + charData.personality);
  if (charData.background) lines.push('背景：' + charData.background);
  lines.push('HP：' + curHp + '/' + maxHp + '　MP：' + curMp + '/' + maxMp + '　理智：' + curSan + '/' + maxSan);
  lines.push(
    '属性：力量' + effStr + '(' + calcModifier(effStr) + ')' +
    ' 敏捷' + effDex + '(' + calcModifier(effDex) + ')' +
    ' 体质' + effCon + '(' + calcModifier(effCon) + ')' +
    ' 智力' + effInt + '(' + calcModifier(effInt) + ')' +
    ' 感知' + effWis + '(' + calcModifier(effWis) + ')' +
    ' 魅力' + effCha + '(' + calcModifier(effCha) + ')'
  );

  var bonus = dynState.equipBonus || {};
  var bonusLine = Object.keys(bonus).filter(function (k) {
    return k !== 'weapon' && bonus[k] > 0;
  }).map(function (k) {
    var nameMap = { str: '力量', dex: '敏捷', con: '体质', int: '智力', wis: '感知', cha: '魅力', ac: 'AC' };
    return (nameMap[k] || k) + '+' + bonus[k];
  }).join('、');
  if (bonusLine) lines.push('装备加成：' + bonusLine);
  if (bonus.weapon) lines.push('武器骰：' + bonus.weapon);

  if (charData.specialties && charData.specialties.length > 0) {
    lines.push('特长：' + charData.specialties.join('、'));
  }
  if (charData.roleplayHints) {
    lines.push('角色扮演提示：' + charData.roleplayHints);
  }
  var statusEffects = dynState.statusEffects || charData.statusEffects || [];
  if (statusEffects.length > 0) {
    var effects = statusEffects.map(function (e) {
      return (e.icon || '') + e.name + '(' + e.desc + ')';
    }).join('、');
    lines.push('当前状态效果：' + effects);
  }
  return lines.join('\n');
}

/**
 * 初始化 TRPG 会话状态（合并方案决策 6：挂 conversation.trpgState）。
 * 由角色卡的 extensions.trpg + Persona 的 trpgProfile 合成初始值。
 * 返回扁平结构，供 trpgStatus marker（PromptBuilder）与 {{hp}}/{{scene}}/{{flag}} 等宏（VariableEngine）读取。
 *
 * @param {Object} card - CharacterCardRecord（data 层，含 extensions.trpg）
 * @param {Object} [profile] - Persona.trpgProfile（缺省用默认档案）
 * @returns {Object}
 */
export function initTrpgState(card, profile) {
  var trpg = (card && card.extensions && card.extensions.trpg) || {};
  var p = profile || createDefaultCharacterData();
  var attrs = p.attributes || {};
  return {
    scene: trpg.initialScene || '',
    story: (card && card.name) || '',
    hp: p.hp !== undefined ? p.hp : 20,
    maxHp: p.maxHp !== undefined ? p.maxHp : 20,
    mp: p.mp !== undefined ? p.mp : 10,
    maxMp: p.maxMp !== undefined ? p.maxMp : 10,
    san: p.san !== undefined ? p.san : 100,
    maxSan: p.maxSan !== undefined ? p.maxSan : 100,
    str: attrs.str !== undefined ? attrs.str : 10,
    dex: attrs.dex !== undefined ? attrs.dex : 10,
    con: attrs.con !== undefined ? attrs.con : 10,
    int: attrs.int !== undefined ? attrs.int : 10,
    wis: attrs.wis !== undefined ? attrs.wis : 10,
    cha: attrs.cha !== undefined ? attrs.cha : 10,
    flags: Object.assign({}, trpg.initialFlags || {}),
    trust: {},
    items: Array.isArray(trpg.startingItems) ? trpg.startingItems.slice() : [],
    equipment: Object.assign({}, p.equipment || {})
  };
}

/**
 * 将扁平 trpgState 转换为 CharacterStatus 面板所需的 charStatus 形状
 * @param {Object} trpgState
 * @returns {Object}
 */
export function trpgStateToCharStatus(trpgState) {
  var s = trpgState || {};
  var v = function (val, dflt) { return val !== undefined ? val : dflt; };
  return {
    hp: v(s.hp, 20), maxHp: v(s.maxHp, 20),
    mp: v(s.mp, 10), maxMp: v(s.maxMp, 10),
    san: v(s.san, 100), maxSan: v(s.maxSan, 100),
    str: v(s.str, 10), strMod: calcModifier(v(s.str, 10)),
    dex: v(s.dex, 10), dexMod: calcModifier(v(s.dex, 10)),
    con: v(s.con, 10), conMod: calcModifier(v(s.con, 10)),
    int: v(s.int, 10), intMod: calcModifier(v(s.int, 10)),
    wis: v(s.wis, 10), wisMod: calcModifier(v(s.wis, 10)),
    cha: v(s.cha, 10), chaMod: calcModifier(v(s.cha, 10)),
    equipment: s.equipment || { head: '', body: '', feet: '', mainWeapon: '', offHand: '', accessory1: '', accessory2: '', accessory3: '' },
    statusEffects: s.statusEffects || []
  };
}

export default {
  createDefaultCharacterData,
  calcModifier,
  buildCharStatus,
  formatCharacterForLLM,
  initTrpgState,
  trpgStateToCharStatus
};
