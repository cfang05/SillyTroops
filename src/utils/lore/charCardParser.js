// utils/lore/charCardParser.js
// SillyTavern / TavernAI 格式角色卡 & 世界书解析器
//
// 支持的格式：
//   1. V1 CharCard JSON（TavernAI 原始格式）
//      { name, description, personality, scenario, first_mes, mes_example }
//
//   2. V2 CharCard JSON（SillyTavern 扩展格式）
//      { spec: "chara_card_v2", data: { ...v1字段, character_book: { entries: [...] } } }
//
//   3. CharBook / WorldInfo 独立 JSON
//      { entries: { '0': { keys, content, enabled, ... }, ... } }
//      或 { entries: [ ... ] }（数组格式）
//
// 输出：
//   - parseCharCard(json)   → 标准故事角色卡对象
//   - parseWorldInfo(json)  → 标准 lorebook entries 数组
//   - toStoryPatch(json)    → 可与故事对象合并的 patch（含 charCard + worldInfo）

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// 内部工具
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 安全解析 JSON 字符串（已是对象则直接返回）
 * @param {string|Object} input
 * @returns {Object|null}
 */
function safeParseJSON(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === 'object') return input;
  if (typeof input === 'string') {
    try {
      return JSON.parse(input);
    } catch (e) {
      console.warn('[CharCardParser] JSON 解析失败:', e.message);
      return null;
    }
  }
  return null;
}

/**
 * 规范化一个 WorldInfo/CharBook 条目为 lorebookManager 标准格式
 * @param {Object} raw   - 原始条目（V1/V2 格式均可）
 * @param {number} index - 在源列表中的索引（用于生成 id）
 * @returns {Object|null}
 */
function normalizeEntry(raw, index) {
  if (!raw) return null;

  // 兼容 ST V2 的 keys 字段（数组）和 V1 的 key 字段（逗号分隔字符串）
  var keys = [];
  if (Array.isArray(raw.keys)) {
    keys = raw.keys.map(function(k) { return String(k).trim(); }).filter(Boolean);
  } else if (typeof raw.key === 'string' && raw.key.trim()) {
    keys = raw.key.split(',').map(function(k) { return k.trim(); }).filter(Boolean);
  } else if (typeof raw.keys === 'string' && raw.keys.trim()) {
    keys = raw.keys.split(',').map(function(k) { return k.trim(); }).filter(Boolean);
  }

  // content 字段
  var content = raw.content || raw.value || raw.text || '';
  if (!content && typeof raw.content !== 'string') {
    return null; // 没有内容的条目跳过
  }

  // enabled
  var enabled = (raw.enabled !== false && raw.disable !== true);

  // constant（ST 叫 selective 的反面；或 constant 字段）
  var constant = !!(raw.constant || raw.always_active);

  // position（对齐酒馆 world_info_position 数值 0-7）
  // 0=before, 1=after, 2=ANTop, 3=ANBottom, 4=atDepth, 5=EMTop, 6=EMBottom, 7=outlet
  var position = 'before_context';
  var rawPos = raw.position;
  var extPos = (raw.extensions && raw.extensions.position !== undefined) ? raw.extensions.position : undefined;
  var posValue = (extPos !== undefined) ? extPos : rawPos;

  if (posValue === 'after_char' || posValue === 1 || posValue === 'after_context') {
    position = 'after_context';
  } else if (posValue === 4 || posValue === 'at_depth' || posValue === 'atDepth') {
    position = 'at_depth';
  } else if (posValue === 2 || posValue === 'an_top' || posValue === 'ANTop') {
    position = 'an_top';
  } else if (posValue === 3 || posValue === 'an_bottom' || posValue === 'ANBottom') {
    position = 'an_bottom';
  } else if (posValue === 5 || posValue === 'em_top' || posValue === 'EMTop') {
    position = 'em_top';
  } else if (posValue === 6 || posValue === 'em_bottom' || posValue === 'EMBottom') {
    position = 'em_bottom';
  } else if (posValue === 7 || posValue === 'outlet') {
    position = 'outlet';
  } else if (posValue === 'before_char' || posValue === 0 || posValue === 'before_context') {
    position = 'before_context';
  }

  // priority / order
  var priority = (typeof raw.priority === 'number') ? raw.priority
    : (typeof raw.order === 'number') ? (1000 - raw.order) // ST 的 order 越小越优先
    : 100;

  var insertionOrder = (typeof raw.insertion_order === 'number') ? raw.insertion_order
    : (typeof raw.order === 'number') ? raw.order
    : index;

  // 生成 id
  var id = raw.id || raw.uid || ('entry_' + index);

  // comment / name
  var comment = raw.comment || raw.name || '';

  // regex
  var regex = null;
  if (raw.use_regex && raw.keys_regex) {
    regex = raw.keys_regex;
  } else if (raw.regex && typeof raw.regex === 'string') {
    regex = raw.regex;
  }

  // 次要关键词（ST 用于 selective 触发时的 AND/OR 匹配组）
  var secondaryKeys = [];
  if (Array.isArray(raw.secondary_keys)) {
    secondaryKeys = raw.secondary_keys.map(function(k) { return String(k).trim(); }).filter(Boolean);
  } else if (Array.isArray(raw.keysecondary)) {
    secondaryKeys = raw.keysecondary.map(function(k) { return String(k).trim(); }).filter(Boolean);
  }

  var selective = !!raw.selective;
  var selectiveLogic = (typeof raw.selectiveLogic === 'number') ? raw.selectiveLogic
    : (raw.extensions && typeof raw.extensions.selectiveLogic === 'number') ? raw.extensions.selectiveLogic
    : 0; // AND_ANY

  // extensions 原样保留（depth/probability/group等 ST 扩展字段），避免编辑往返时信息丢失
  var extensions = (raw.extensions && typeof raw.extensions === 'object') ? raw.extensions : {};

  // ── P0：匹配增强字段（提升到顶层，供 WorldInfoEngine 直接读取） ──────────
  var scanDepth       = extensions.scan_depth ?? raw.scanDepth ?? null;
  var caseSensitive    = extensions.case_sensitive ?? raw.caseSensitive ?? null;
  var matchWholeWords  = extensions.match_whole_words ?? raw.matchWholeWords ?? null;

  // ── 全局扫描源六开关（对齐酒馆 globalScanData 的 match_* 字段） ──────────
  var matchPersonaDescription     = !!(extensions.match_persona_description ?? raw.matchPersonaDescription ?? false);
  var matchCharacterDescription   = !!(extensions.match_character_description ?? raw.matchCharacterDescription ?? false);
  var matchCharacterPersonality   = !!(extensions.match_character_personality ?? raw.matchCharacterPersonality ?? false);
  var matchCharacterDepthPrompt   = !!(extensions.match_character_depth_prompt ?? raw.matchCharacterDepthPrompt ?? false);
  var matchScenario               = !!(extensions.match_scenario ?? raw.matchScenario ?? false);
  var matchCreatorNotes           = !!(extensions.match_creator_notes ?? raw.matchCreatorNotes ?? false);

  // ── P1：递归 / 概率 / 分组 / 预算字段 ────────────────────────────────────
  var useGroupScoring  = extensions.use_group_scoring ?? raw.useGroupScoring ?? null;
  var probability      = (typeof extensions.probability === 'number') ? extensions.probability
    : (typeof raw.probability === 'number') ? raw.probability
    : 100;
  var useProbability    = extensions.useProbability ?? raw.useProbability ?? (probability !== 100);
  var group             = extensions.group ?? raw.group ?? '';
  var groupOverride     = !!(extensions.group_override ?? raw.groupOverride ?? false);
  var groupWeight       = (typeof extensions.group_weight === 'number') ? extensions.group_weight
    : (typeof raw.groupWeight === 'number') ? raw.groupWeight
    : 100;
  var depth             = (typeof extensions.depth === 'number') ? extensions.depth
    : (typeof raw.depth === 'number') ? raw.depth
    : 4;
  var role              = extensions.role ?? raw.role ?? 'system';
  var ignoreBudget       = !!(extensions.ignore_budget ?? raw.ignoreBudget ?? false);
  var excludeRecursion   = !!(extensions.exclude_recursion ?? raw.excludeRecursion ?? false);
  var preventRecursion   = !!(extensions.prevent_recursion ?? raw.preventRecursion ?? false);
  var delayUntilRecursion = extensions.delay_until_recursion ?? raw.delayUntilRecursion ?? false;

  // ── P2：限时效果字段 ────────────────────────────────────────────────────
  var sticky   = extensions.sticky ?? raw.sticky ?? null;
  var cooldown = extensions.cooldown ?? raw.cooldown ?? null;
  var delay    = extensions.delay ?? raw.delay ?? null;

  return {
    id:             String(id),
    keys:           keys,
    secondaryKeys:  secondaryKeys,
    regex:          regex,
    content:        content,
    priority:       priority,
    insertionOrder: insertionOrder,
    position:       position,
    enabled:        enabled,
    constant:       constant,
    selective:      selective,
    selectiveLogic: selectiveLogic,
    comment:        comment,
    extensions:     extensions,

    scanDepth:        scanDepth,
    caseSensitive:    caseSensitive,
    matchWholeWords:  matchWholeWords,

    matchPersonaDescription:    matchPersonaDescription,
    matchCharacterDescription:  matchCharacterDescription,
    matchCharacterPersonality:  matchCharacterPersonality,
    matchCharacterDepthPrompt:  matchCharacterDepthPrompt,
    matchScenario:              matchScenario,
    matchCreatorNotes:          matchCreatorNotes,

    useGroupScoring:      useGroupScoring,
    probability:          probability,
    useProbability:       useProbability,
    group:                group,
    groupOverride:        groupOverride,
    groupWeight:          groupWeight,
    depth:                depth,
    role:                 role,
    ignoreBudget:         ignoreBudget,
    excludeRecursion:     excludeRecursion,
    preventRecursion:     preventRecursion,
    delayUntilRecursion:  delayUntilRecursion,

    sticky:   sticky,
    cooldown: cooldown,
    delay:    delay
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 核心解析函数
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 解析 SillyTavern 格式的角色卡（V1 / V2）
 *
 * @param {string|Object} input - JSON 字符串或对象
 * @returns {{
 *   name: string,
 *   description: string,
 *   personality: string,
 *   scenario: string,
 *   firstMessage: string,
 *   exampleDialogue: string,
 *   systemPrompt: string,
 *   postHistoryInstructions: string,
 *   tags: string[],
 *   creatorNotes: string,
 *   lorebook: Array,         // 内嵌的 character_book entries（已标准化）
 *   raw: Object              // 原始解析对象
 * }|null}
 */
function parseCharCard(input) {
  var json = safeParseJSON(input);
  if (!json) return null;

  // 检测 V2/V3 格式（V3 沿用 V2 的 { spec, data:{...} } 外壳，字段基本兼容，
  // 额外的 assets/nickname/creation_date/group_only_greetings 等 V3 专属字段不影响现有字段读取）
  var data = json;
  if ((json.spec === 'chara_card_v2' || json.spec === 'chara_card_v3') && json.data && typeof json.data === 'object') {
    data = json.data;
  }

  // 提取基础字段（V1/V2 共有）
  var name        = data.name || '';
  var description = data.description || '';
  var personality = data.personality || '';
  var scenario    = data.scenario || data.world_scenario || '';
  var firstMes    = data.first_mes || data.firstMessage || '';
  var mesExample  = data.mes_example || data.exampleDialogue || data.example_dialogue || '';

  // V2 扩展字段
  var systemPrompt     = data.system_prompt || data.systemPrompt || '';
  var postHistory      = data.post_history_instructions || data.postHistoryInstructions || '';
  var tags             = Array.isArray(data.tags) ? data.tags : [];
  var creatorNotes     = data.creator_notes || data.creatorNotes || '';

  // 内嵌 character_book（V2 标准字段）
  var lorebookEntries = [];
  var charBook = data.character_book || data.characterBook || null;
  if (charBook) {
    var rawEntries = charBook.entries;
    // 兼容对象格式（ST 有时用 {0: {...}, 1: {...}} 格式）
    if (rawEntries && !Array.isArray(rawEntries) && typeof rawEntries === 'object') {
      rawEntries = Object.values(rawEntries);
    }
    if (Array.isArray(rawEntries)) {
      rawEntries.forEach(function(e, i) {
        var normalized = normalizeEntry(e, i);
        if (normalized) lorebookEntries.push(normalized);
      });
    }
  }

  console.log('[CharCardParser] 解析角色卡:', {
    name: name,
    lorebookCount: lorebookEntries.length,
    hasSystemPrompt: !!systemPrompt
  });

  return {
    name:                    name,
    description:             description,
    personality:             personality,
    scenario:                scenario,
    firstMessage:            firstMes,
    exampleDialogue:         mesExample,
    systemPrompt:            systemPrompt,
    postHistoryInstructions: postHistory,
    tags:                    tags,
    creatorNotes:            creatorNotes,
    lorebook:                lorebookEntries,
    raw:                     json
  };
}

/**
 * 解析独立的 WorldInfo / CharBook JSON 为标准 lorebook entries 数组
 *
 * 支持格式：
 *   { entries: { '0': {...}, '1': {...} } }   // ST 对象格式
 *   { entries: [ {...}, {...} ] }              // 数组格式
 *   [ {...}, {...} ]                            // 顶层数组
 *
 * @param {string|Object} input
 * @returns {Array} 标准化的 lorebook entry 数组
 */
function parseWorldInfo(input) {
  var json = safeParseJSON(input);
  if (!json) return [];

  var rawEntries = null;

  // 顶层数组
  if (Array.isArray(json)) {
    rawEntries = json;
  }
  // { entries: [...] } 或 { entries: { '0':... } }
  else if (json.entries) {
    if (Array.isArray(json.entries)) {
      rawEntries = json.entries;
    } else if (typeof json.entries === 'object') {
      rawEntries = Object.values(json.entries);
    }
  }
  // { worldInfoData: { ... } } 或类似包装
  else if (json.data && json.data.entries) {
    rawEntries = Array.isArray(json.data.entries)
      ? json.data.entries
      : Object.values(json.data.entries);
  }

  if (!rawEntries || !Array.isArray(rawEntries)) {
    console.warn('[CharCardParser] parseWorldInfo: 未识别的格式');
    return [];
  }

  var result = [];
  rawEntries.forEach(function(e, i) {
    var normalized = normalizeEntry(e, i);
    if (normalized) result.push(normalized);
  });

  console.log('[CharCardParser] parseWorldInfo: 解析条目', result.length, '条');
  return result;
}

/**
 * 将角色卡 JSON 转换为可与故事对象合并的 patch
 *
 * 用法：
 *   var patch = charCardParser.toStoryPatch(charCardJson);
 *   var story = Object.assign({}, myStory, patch);
 *
 * @param {string|Object} charCardInput  - 角色卡 JSON
 * @param {string|Object} [worldInfoInput] - 可选：额外的独立世界书 JSON
 * @returns {{
 *   charCard: Object,     // 解析后的角色卡（可直接当 characterCard 传给 gameAI）
 *   worldInfo: Array,     // 合并的 lorebook entries
 *   systemPrompt: string, // 角色卡内嵌的 system prompt（可替换故事 systemPrompt）
 * }|null}
 */
function toStoryPatch(charCardInput, worldInfoInput) {
  var charCard = parseCharCard(charCardInput);
  if (!charCard) return null;

  // 合并内嵌 lorebook + 外部 worldInfo
  var extraEntries = worldInfoInput ? parseWorldInfo(worldInfoInput) : [];
  var allEntries   = charCard.lorebook.concat(extraEntries);

  // 构建角色卡格式化文本（可直接注入 prompt）
  var cardText = formatCharCardForPrompt(charCard);

  return {
    charCard:     charCard,
    charCardText: cardText,
    worldInfo:    allEntries,
    systemPrompt: charCard.systemPrompt || ''
  };
}

/**
 * 将解析后的角色卡格式化为可注入 prompt 的文本
 *
 * @param {Object} charCard - parseCharCard() 返回的对象
 * @returns {string}
 */
function formatCharCardForPrompt(charCard) {
  if (!charCard) return '';

  var parts = [];

  if (charCard.name) {
    parts.push('【角色：' + charCard.name + '】');
  }

  if (charCard.description && charCard.description.trim()) {
    parts.push('# 角色描述\n' + charCard.description.trim());
  }

  if (charCard.personality && charCard.personality.trim()) {
    parts.push('# 性格特征\n' + charCard.personality.trim());
  }

  if (charCard.scenario && charCard.scenario.trim()) {
    parts.push('# 当前场景设定\n' + charCard.scenario.trim());
  }

  if (charCard.firstMessage && charCard.firstMessage.trim()) {
    parts.push('# 角色开场白（参考）\n' + charCard.firstMessage.trim());
  }

  if (charCard.exampleDialogue && charCard.exampleDialogue.trim()) {
    parts.push('# 对话示例\n' + charCard.exampleDialogue.trim());
  }

  return parts.join('\n\n');
}

/**
 * 从角色卡 JSON 中直接提取 lorebook 条目（便捷方法）
 *
 * @param {string|Object} charCardInput
 * @returns {Array}
 */
function extractLorebookFromCharCard(charCardInput) {
  var charCard = parseCharCard(charCardInput);
  return charCard ? charCard.lorebook : [];
}

// ─────────────────────────────────────────────────────────────────────────────
// 导出
// ─────────────────────────────────────────────────────────────────────────────
export default {
  parseCharCard:               parseCharCard,
  parseWorldInfo:              parseWorldInfo,
  toStoryPatch:                toStoryPatch,
  formatCharCardForPrompt:     formatCharCardForPrompt,
  extractLorebookFromCharCard: extractLorebookFromCharCard,
  // 内部工具（测试用）
  normalizeEntry:              normalizeEntry
};
