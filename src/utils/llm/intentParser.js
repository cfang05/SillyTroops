// utils/llm/intentParser.js - 意图常量定义
// 职责：统一定义所有意图类型枚举，供 gameAI.js / narrator.js / stateManager 等模块共享。
// 注意：意图解析已合并到 gameAI.js 的单次 LLM 调用中，本模块不再包含 LLM 调用逻辑。

/**
 * 意图类型枚举
 * 定义所有可能的玩家行动意图
 */
const INTENT = {
  TALK_TO:      'TALK_TO',       // 与 NPC 交谈
  INVESTIGATE:  'INVESTIGATE',   // 详细调查环境或物体
  OBSERVE:      'OBSERVE',       // 观察周边整体情况
  USE_ITEM:     'USE_ITEM',      // 使用物品/道具
  MOVE:         'MOVE',          // 移动到明确命名的地点
  RECRUIT:      'RECRUIT',       // 招募 NPC 加入队伍
  ATTACK:       'ATTACK',        // 攻击目标
  CAST_SPELL:   'CAST_SPELL',    // 释放法术
  REST:         'REST',          // 休息恢复
  GIVE_ITEM:    'GIVE_ITEM',     // 给予物品给 NPC
  CHECK_STATUS: 'CHECK_STATUS',  // 查看自己的状态/属性/背包
  UNKNOWN:      'UNKNOWN'        // 无法识别的意图
};

/**
 * 意图类型数组（用于合法性校验）
 */
const INTENT_ENUM = Object.values(INTENT);

// ─────────────────────────────────────────────────────────────
// 关键词意图识别（合并后替代旧 gameAI 的 LLM 意图解析）
// 顺序即优先级：先匹配到的关键词胜出。
// ─────────────────────────────────────────────────────────────

const KEYWORD_INTENTS = [
  { action: INTENT.ATTACK, keywords: ['攻击', '打', '砍', '刺', '射', '揍', '杀', '击', '捅', '劈', '战斗'] },
  { action: INTENT.MOVE, keywords: ['前往', '走向', '进入', '上楼', '下楼', '出门', '离开', '移动', '去'] },
  { action: INTENT.TALK_TO, keywords: ['交谈', '说话', '聊天', '询问', '打招呼', '搭话', '对话'] },
  { action: INTENT.USE_ITEM, keywords: ['使用', '喝下', '吃掉'] },
  { action: INTENT.INVESTIGATE, keywords: ['调查', '检查', '搜索', '搜查', '翻找'] },
  { action: INTENT.OBSERVE, keywords: ['观察', '环顾', '打量', '看看'] },
  { action: INTENT.REST, keywords: ['休息', '睡觉'] },
  { action: INTENT.CHECK_STATUS, keywords: ['查看状态', '查看属性', '查看背包'] },
  { action: INTENT.GIVE_ITEM, keywords: ['交给', '给予', '送给'] },
  { action: INTENT.CAST_SPELL, keywords: ['施法', '释放法术', '法术'] }
];

/**
 * 关键词意图识别（无 LLM 依赖）
 * @param {string} text - 用户输入
 * @returns {{action:string, target:string|null, raw:string}|null}
 */
function detectIntent(text) {
  if (!text || typeof text !== 'string') return null;
  for (const { action, keywords } of KEYWORD_INTENTS) {
    for (const kw of keywords) {
      if (text.indexOf(kw) !== -1) {
        return { action, target: null, raw: text };
      }
    }
  }
  return { action: INTENT.UNKNOWN, target: null, raw: text };
}

export default {
  INTENT,
  INTENT_ENUM,
  detectIntent
};
