// scripts/migrateHumanDespair.js
// 一次性迁移：human-despair 故事 → 标准 SillyTavern V2 角色卡 JSON
//
// 运行：node scripts/migrateHumanDespair.js
// 产物：migrations/human-despair.card.json（在 app 的「酒馆导入」页粘贴导入，
//       或后续用一个一次性导入函数直接写入 characterCardManager）
//
// 迁移映射（见 notes/合并方案-执行序.md）：
//   title/fullDesc/tags          → data.name/description/tags
//   welcome                      → data.first_mes
//   systemPrompt                 → data.system_prompt
//   background                   → 世界书 constant 条目（常驻）
//   scenes[x]                    → 世界书条目（keys=[sceneId, scene.name]）
//   items[x]                     → 世界书条目（说明文本）+ extensions.trpg.items（数值）
//   initialState/startingItems/
//   availableQuests/clues/endings/
//   secrets/visitors/collectibles → extensions.trpg.*
//   —                            → extensions.trpg.modules（stats/inventory/characterStatus/
//                                  dicePanel/adventure 开启；intentDetection/combat 关闭）

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import story from '../src/utils/stories/human-despair.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// human-despair 无正式战斗系统：仅 stats/inventory/characterStatus/dicePanel/adventure 开启
const MODULES = {
  intentDetection: false,
  combat: false,
  inventory: true,
  characterStatus: true,
  dicePanel: true,
  stats: true,
  adventure: true
};

/**
 * 构建世界书条目（ST V2 character_book.entries 字段名）
 */
function buildLorebookEntries(story) {
  const entries = [];

  // 1. 世界观背景 → constant 常驻条目
  if (story.background && String(story.background).trim()) {
    entries.push({
      id: 'world-bg',
      keys: ['世界观', '背景', '太阳异变', '人类一败涂地'],
      content: String(story.background).trim(),
      enabled: true,
      constant: true,
      insertion_order: 0,
      position: 0,
      comment: '世界观背景（常驻）'
    });
  }

  // 2. 场景 → 条目（keys=[sceneId, scene.name]）
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

  // 3. 物品 → 说明文本条目（数值类在 extensions.trpg.items）
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

/**
 * 构建 V2 角色卡 data 层
 */
function buildCard(story) {
  const desc = [story.fullDesc, (story.shortDesc && story.shortDesc !== story.fullDesc) ? story.shortDesc : '']
    .filter(Boolean)
    .join('\n\n');

  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: story.title || '人类一败涂地',
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
          availableQuests: story.availableQuests || [],
          clues: story.clues || [],
          endings: story.endings || [],
          secrets: story.secrets || [],
          visitors: story.visitors || { friendly: [], impostors: [] },
          collectibles: story.collectibles || {}
        }
      },
      character_book: {
        name: story.id || 'human-despair',
        entries: buildLorebookEntries(story)
      }
    }
  };
}

// ── 执行 ─────────────────────────────────────────────────────────────
const card = buildCard(story);
const outDir = join(__dirname, '..', 'migrations');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'human-despair.card.json');
writeFileSync(outPath, JSON.stringify(card, null, 2), 'utf8');

console.log('✅ 迁移完成:', outPath);
console.log('   名称:', card.data.name);
console.log('   世界书条目:', card.data.character_book.entries.length, '条');
console.log('   场景:', Object.keys(story.scenes || {}).length, '个');
console.log('   物品:', Object.keys(story.items || {}).length, '个');
console.log('   任务:', (story.availableQuests || []).length, '条');
console.log('   模块开关:', JSON.stringify(MODULES));
