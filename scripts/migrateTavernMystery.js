// scripts/migrateTavernMystery.js
// 一次性迁移：tavern-mystery 故事 → 标准 SillyTavern V2 角色卡 JSON
//
// 运行：node scripts/migrateTavernMystery.js
// 产物：migrations/tavern-mystery.card.json
//
// 与 human-despair 迁移的区别：tavern-mystery 有结构化 NPC。
//   NPC 战斗数值 → 世界书条目的 [combat] 行（combatManager 经 parseCombatTag 读取）
//   NPC 非战斗数据（trustThresholds/sampleDialogues/secret 等）→ extensions.trpg.npcs

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import story from '../src/utils/stories/tavern-mystery.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// tavern-mystery 是完整 TRPG 体验（含战斗 NPC），全模块开启
const MODULES = {
  intentDetection: true,
  combat: true,
  inventory: true,
  characterStatus: true,
  dicePanel: true,
  stats: true,
  adventure: true
};

/** 将 NPC combat 对象转换为 [combat] key=value 行 */
function combatToTag(combat) {
  if (!combat) return '';
  const parts = [];
  if (typeof combat.hp === 'number') parts.push('hp=' + combat.hp);
  if (typeof combat.armorBonus === 'number') parts.push('armor=' + combat.armorBonus);
  const a = combat.attributes || {};
  ['str', 'dex', 'con', 'int', 'wis', 'cha'].forEach(k => {
    if (typeof a[k] === 'number') parts.push(k + '=' + a[k]);
  });
  if (combat.weapon) parts.push('weapon=' + combat.weapon);
  if (combat.combatStyle) parts.push('style=' + String(combat.combatStyle).replace(/\s+/g, '_'));
  if (Array.isArray(combat.drops) && combat.drops.length) {
    parts.push('drops=' + combat.drops.map(d => (d.item || '') + 'x' + (d.quantity || 1)).join(','));
  }
  if (combat.isEnvironmental) parts.push('env=true');
  if (combat.canFight !== undefined) parts.push('canfight=' + (combat.canFight ? 'true' : 'false'));
  if (combat.reaction) parts.push('reaction=' + combat.reaction);
  return '[combat] ' + parts.join(' ');
}

/** 构建世界书条目（ST V2 character_book.entries 字段名） */
function buildLorebookEntries(story) {
  const entries = [];

  // 1. 世界观背景 → constant 常驻
  if (story.background && String(story.background).trim()) {
    entries.push({
      id: 'world-bg',
      keys: ['世界观', '背景', '酒馆之谜'],
      content: String(story.background).trim(),
      enabled: true,
      constant: true,
      insertion_order: 0,
      position: 0,
      comment: '世界观背景（常驻）'
    });
  }

  // 2. 场景 → 条目
  Object.keys(story.scenes || {}).forEach((sceneId, i) => {
    const s = story.scenes[sceneId];
    const content = [s.lore, s.description].filter(Boolean).join('\n');
    entries.push({
      id: 'scene-' + sceneId,
      keys: [s.id, s.name],
      content: content,
      enabled: true,
      constant: false,
      insertion_order: i + 1,
      position: 0,
      comment: s.name || s.id
    });
  });

  // 3. NPC → 条目（keys=[id, name, ...aliases]，content=lore + [combat] 行）
  Object.keys(story.npcs || {}).forEach((npcId, i) => {
    const npc = story.npcs[npcId];
    const keys = Array.from(new Set([npc.id, npc.name, ...(npc.aliases || [])])).filter(Boolean);
    const combatTag = combatToTag(npc.combat);
    const content = [npc.lore, combatTag].filter(Boolean).join('\n');
    entries.push({
      id: 'npc-' + npcId,
      keys: keys,
      content: content,
      enabled: true,
      constant: false,
      insertion_order: 50 + i,
      position: 0,
      comment: npc.name || npcId
    });
  });

  // 4. 物品 → 说明文本条目
  Object.keys(story.items || {}).forEach((itemId, i) => {
    const it = story.items[itemId];
    const parts = ['【' + (it.name || itemId) + '】' + (it.description || '')];
    if (it.howToObtain) parts.push('获取方式：' + it.howToObtain);
    entries.push({
      id: 'item-' + itemId,
      keys: [it.id, it.name],
      content: parts.join('\n'),
      enabled: true,
      constant: false,
      insertion_order: 100 + i,
      position: 0,
      comment: it.name || itemId
    });
  });

  return entries;
}

/** 提取 NPC 非战斗数据（供 adventure 模块：trust/dialogue/secret） */
function buildNpcCodeData(story) {
  const npcs = {};
  Object.keys(story.npcs || {}).forEach(npcId => {
    const n = story.npcs[npcId];
    npcs[npcId] = {
      name: n.name,
      fullName: n.fullName,
      aliases: n.aliases || [],
      age: n.age,
      race: n.race,
      gender: n.gender,
      occupation: n.occupation,
      formerOccupation: n.formerOccupation,
      appearance: n.appearance,
      personality: n.personality,
      background: n.background,
      secret: n.secret,
      trustThresholds: n.trustThresholds,
      sampleDialogues: n.sampleDialogues || []
    };
  });
  return npcs;
}

function buildCard(story) {
  const desc = [story.fullDesc, (story.shortDesc && story.shortDesc !== story.fullDesc) ? story.shortDesc : '']
    .filter(Boolean)
    .join('\n\n');

  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: story.title || '酒馆之谜',
      description: desc,
      personality: '',
      scenario: '',
      first_mes: story.welcome || '',
      mes_example: '',
      system_prompt: story.systemPrompt || '',
      creator_notes: '',
      creator: '',
      character_version: '1.0',
      tags: story.tags || [],
      alternate_greetings: [],
      extensions: {
        trpg: {
          modules: MODULES,
          initialScene: story.initialScene || (story.initialState && story.initialState.scene) || '',
          initialFlags: (story.initialState && story.initialState.flags) || {},
          initialQuickActions: story.initialQuickActions || [],
          startingItems: story.startingItems || [],
          items: story.items || {},
          npcs: buildNpcCodeData(story),
          availableQuests: story.availableQuests || [],
          clues: story.clues || [],
          endings: story.endings || [],
          secrets: story.secrets || [],
          collectibles: story.collectibles || {}
        }
      },
      character_book: {
        name: story.id || 'tavern-mystery',
        entries: buildLorebookEntries(story)
      }
    }
  };
}

// ── 执行 ─────────────────────────────────────────────────────────────
const card = buildCard(story);
const outDir = join(__dirname, '..', 'migrations');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'tavern-mystery.card.json');
writeFileSync(outPath, JSON.stringify(card, null, 2), 'utf8');

console.log('✅ 迁移完成:', outPath);
console.log('   名称:', card.data.name);
console.log('   世界书条目:', card.data.character_book.entries.length, '条');
console.log('   场景:', Object.keys(story.scenes || {}).length, '个');
console.log('   NPC:', Object.keys(story.npcs || {}).length, '个');
console.log('   物品:', Object.keys(story.items || {}).length, '个');
console.log('   任务:', (story.availableQuests || []).length, '条');
console.log('   模块开关:', JSON.stringify(MODULES));
