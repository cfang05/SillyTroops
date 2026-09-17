// src/pages/cardpool/utils/level-names.js
// 等级 → 称号映射。
//
// ⚠️ 这张表与 stores/userStore.ts 里的 LEVEL_NAMES **必须保持一致**（同一套设定）。
// 之所以在这里再放一份，而不是从 store 里 import：
//   1) 这里只需要"纯函数"，import store 会把 pinia 依赖拖进卡池页的组件树，
//      评论列表这种纯展示场景不该依赖状态管理初始化；
//   2) 服务端不复制这张表（避免第三处漂移），所以评论里只存等级数字，
//      称号统一由前端用这个函数生成 —— 只有"前端一处"需要和 store 对齐。
// 改动等级称号时，两处一起改（userStore.ts 的 LEVEL_NAMES 与本文件）。

export const LEVEL_NAMES = {
  1: '新手旅人',
  2: '逐光者',
  3: '窥秘人',
  4: '守夜人',
  5: '追索者',
  6: '秘术学徒',
  7: '命运之眼',
  8: '序列守望者',
  9: '星象师',
  10: '诡秘侍者',
  11: '牧羊人',
  12: '断罪者',
  13: '窃梦者',
  14: '命运之蛇',
  15: '旅团长',
  16: '时之虫',
  17: '奇迹师',
  18: '诡秘之主',
  19: '命运编织者',
  20: '旧日支配者'
}

/**
 * 根据等级取称号（与 userStore.getLevelName 同一套规则）
 * @param {number} level
 * @returns {string}
 */
export function levelName(level) {
  const n = Math.trunc(Number(level))
  if (!Number.isFinite(n) || n < 1) return '未启程者'
  if (n > 20) return '不可名状者'
  return LEVEL_NAMES[n] || '旅人'
}

/**
 * 评论上的等级展示文本：`Lv.15 旅团长`
 * @param {number|null|undefined} level
 * @returns {string} 等级缺失时返回空串（调用方据此不渲染）
 */
export function levelBadge(level) {
  if (level === null || level === undefined || level === '') return ''
  const n = Math.trunc(Number(level))
  if (!Number.isFinite(n) || n < 0) return ''
  return 'Lv.' + n + ' ' + levelName(n)
}

export default { LEVEL_NAMES, levelName, levelBadge }
