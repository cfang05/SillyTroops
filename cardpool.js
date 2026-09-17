// cardpool.js - 卡池数据 API（评分 / 下载量 / 评论）
//
// 数据落在 R2 上的两个 JSON 文件，由 r2.js 负责读写，本模块只处理业务规则：
//   stats.json     { "<cardId>": { ratingSum, ratingCount, downloadCount } }
//   comments.json  { "<cardId>": [ { id, authorId, authorName, content, rating, createdAt } ] }
//
// 三条硬规则：
//   1) 平均分 = ratingSum / ratingCount（保留 1 位小数）；ratingCount 为 0 时前端显示「暂无评分」
//   2) 同一个用户改评分只调整 ratingSum，不增加 ratingCount（靠 body.previousRating 判断）
//   3) 评论身份一律取自登录 token，不接受客户端自报的 authorId/authorName —— 否则任何人都能
//      冒用他人昵称（甚至管理员名义）发评论

'use strict';

const crypto = require('crypto');
const r2 = require('./r2');

const MAX_CONTENT_LEN = 500;
const MAX_AUTHOR_NAME_LEN = 20;
const MAX_CARD_ID_LEN = 200;
const MAX_COMMENTS_PER_CARD = 500;

// ── 通用小工具 ───────────────────────────────────────────────
function _isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * 校验并归一化 cardId。
 * 会出现在对象键与日志里，所以只允许常见安全字符，并限制长度 —— 避免 `__proto__`
 * 这类原型污染键，以及超长键把 JSON 撑爆。
 * @returns {string|null} 合法则返回原值（已 decode），否则 null
 */
function normalizeCardId(raw) {
  let id = String(raw == null ? '' : raw);
  try {
    id = decodeURIComponent(id);
  } catch (e) {
    // 非法转义（手改 URL 造成的孤立 %）按不合法处理
    return null;
  }
  id = id.trim();
  if (!id || id.length > MAX_CARD_ID_LEN) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(id)) return null;
  if (id === '__proto__' || id === 'constructor' || id === 'prototype') return null;
  return id;
}

/** 取某张卡片的统计（缺省全 0，前端据此显示「暂无评分」与 0 次下载） */
function _statsOf(stats, cardId) {
  const s = stats && stats[cardId];
  if (!_isPlainObject(s)) return { ratingSum: 0, ratingCount: 0, downloadCount: 0 };
  return {
    ratingSum: Number(s.ratingSum) || 0,
    ratingCount: Number(s.ratingCount) || 0,
    downloadCount: Number(s.downloadCount) || 0
  };
}

/** 生成评论 id：c_<毫秒时间戳>_<随机串>（与需求给的样例格式一致） */
function _newCommentId() {
  return 'c_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
}

function _toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
}

/**
 * 严格整数校验：只接受整数（含 "5" 这种数字字符串）。
 * ⚠️ 不能先 Math.trunc 再判范围：Math.trunc(2.5) === 2 会让 2.5 星蒙混过关，
 * 把平均分算成非预期值。NaN 与小数一律拒绝。
 */
function _toRating(v) {
  if (v === null || v === undefined || v === '') return NaN;
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
}

// ── 建路由 ───────────────────────────────────────────────────
/**
 * 挂载卡池接口。
 *
 * @param {import('express').Express} app
 * @param {{
 *   requireAuth: Function,
 *   db?: { getPool: Function, isConfigured: Function },
 *   accounts?: object
 * }} deps 依赖注入（从 server.js 传入），便于测试替换
 */
function registerCardPoolRoutes(app, deps) {
  const requireAuth = deps && deps.requireAuth;
  const db = deps && deps.db;
  const accounts = deps && deps.accounts;

  /** R2 未配置时统一 503，把"服务端没配好"和"业务失败"区分开 */
  function ensureR2Or503(res) {
    if (!r2.isConfigured()) {
      res.status(503).json({ error: r2.MISSING_MSG });
      return false;
    }
    return true;
  }

  /** 业务异常统一处理：R2 的错误带 status，其余按 500 */
  function fail(res, e, what) {
    const status = (e && e.status) || 500;
    console.error('[CardPool] ' + what + ' 失败:', e && e.message);
    res.status(status).json({ error: (e && e.message) || (what + '失败') });
  }

  // ========== 评分 + 下载量 ==========

  /** 全量统计（前端首屏与卡片列表用，卡片与 R2 manifest 并行请求） */
  app.get('/api/card-stats', async (req, res) => {
    if (!ensureR2Or503(res)) return;
    try {
      const stats = await r2.readStats();
      res.json(_isPlainObject(stats) ? stats : {});
    } catch (e) {
      fail(res, e, '读取评分统计');
    }
  });

  /**
   * 评分。
   *
   * body: { rating: 1-5, previousRating?: 1-5 }
   *
   * previousRating 是「该用户本地记下的旧评分」，用来实现需求 4.5 推荐的策略
   * （允许修改评分，但只更新 ratingSum、不增加 ratingCount）：
   *   首次评分：  ratingSum += rating,                    ratingCount += 1
   *   修改评分：  ratingSum += rating - previousRating    （ratingCount 不变）
   *
   * ⚠️ 计数器只能表达"总和"，服务端无法自行判断这是第几次——所以"是否重复评分"由前端
   * 基于 localStorage 的 rated_cards 声明。这不是防刷机制（匿名接口本就可被刷），
   * 只是为了让同一用户的正常改分不把平均分算歪。
   */
  app.post('/api/card-stats/:cardId/rate', async (req, res) => {
    if (!ensureR2Or503(res)) return;
    const cardId = normalizeCardId(req.params.cardId);
    if (!cardId) return res.status(400).json({ error: 'cardId 不合法' });

    const body = req.body || {};
    const rating = _toRating(body.rating);
    if (!(rating >= 1 && rating <= 5)) {
      return res.status(400).json({ error: 'rating 必须是 1-5 的整数' });
    }

    // previousRating 可能缺省（首次评分）；给了就必须合法，否则宁可报错也不猜
    let previousRating = 0;
    if (body.previousRating !== undefined && body.previousRating !== null && body.previousRating !== '') {
      previousRating = _toRating(body.previousRating);
      if (!(previousRating >= 1 && previousRating <= 5)) {
        return res.status(400).json({ error: 'previousRating 必须是 1-5 的整数' });
      }
    }

    try {
      const updated = await r2.updateJson(r2.STATS_KEY, {}, (current) => {
        const stats = _isPlainObject(current) ? Object.assign({}, current) : {};
        const s = _statsOf(stats, cardId);
        if (previousRating) {
          s.ratingSum = Math.max(0, s.ratingSum - previousRating) + rating;
        } else {
          s.ratingSum += rating;
          s.ratingCount += 1;
        }
        stats[cardId] = s;
        return { data: stats, result: s };
      });
      res.json({ cardId: cardId, stats: updated, updated: !!previousRating });
    } catch (e) {
      fail(res, e, '保存评分');
    }
  });

  /** 下载次数 +1（每次调用都 +1，不去重——重复下载同样消耗带宽） */
  app.post('/api/card-stats/:cardId/download', async (req, res) => {
    if (!ensureR2Or503(res)) return;
    const cardId = normalizeCardId(req.params.cardId);
    if (!cardId) return res.status(400).json({ error: 'cardId 不合法' });

    try {
      const updated = await r2.updateJson(r2.STATS_KEY, {}, (current) => {
        const stats = _isPlainObject(current) ? Object.assign({}, current) : {};
        const s = _statsOf(stats, cardId);
        s.downloadCount += 1;
        stats[cardId] = s;
        return { data: stats, result: s };
      });
      res.json({ cardId: cardId, stats: updated });
    } catch (e) {
      fail(res, e, '保存下载次数');
    }
  });

  // ========== 评论 ==========

  /**
   * 用「数据库里的当前等级」覆盖评论上的等级快照。
   *
   * 需求是"实时显示该用户当前等级"，所以等级不能只靠发表时写进 comments.json 的那份
   * 快照（那份会随着用户升级而过期）。这里读完评论后，按 authorId 批量查一次账号表，
   * 用最新等级覆盖；查不到（账号已注销/无数据库）就保留快照值。
   *
   * 快照仍然保留在文件里（authorLevel / authorLevelName），作用是：
   *   · 离线/未配数据库时仍有等级可显示，而不是一片空白
   *   · 排查问题时能看到"发表当时的等级"
   *
   * @param {Array<object>} list 评论数组
   * @returns {Promise<Array<object>>} 补好等级的评论数组
   */
  async function withCurrentLevels(list) {
    if (!Array.isArray(list) || !list.length) return [];
    let levelMap = null;
    if (db && accounts && typeof db.isConfigured === 'function' && db.isConfigured()) {
      try {
        levelMap = await accounts.getLevelsByUserIds(db.getPool(), list.map((c) => c && c.authorId));
      } catch (e) {
        // 等级查不到不该让评论列表整个失败：退回快照值即可
        console.warn('[CardPool] 读取评论者等级失败（退回发表时快照）:', e && e.message);
      }
    }
    return list.map((c) => {
      if (!c) return c;
      const current = levelMap ? levelMap[String(c.authorId || '')] : undefined;
      const level = current == null ? (c.authorLevel == null ? null : Number(c.authorLevel)) : current;
      return Object.assign({}, c, {
        authorLevel: level,
        // 称号由前端用同一张表生成（LEVEL_NAMES 在 stores/userStore.ts），
        // 服务端不再复制一份映射，避免两处定义漂移
        authorLevelCurrent: current != null
      });
    });
  }

  /** 某卡片的评论列表（按 createdAt 倒序 = 最新在前） */
  app.get('/api/card-comments/:cardId', async (req, res) => {
    if (!ensureR2Or503(res)) return;
    const cardId = normalizeCardId(req.params.cardId);
    if (!cardId) return res.status(400).json({ error: 'cardId 不合法' });

    try {
      const all = await r2.readComments();
      const list = (_isPlainObject(all) && Array.isArray(all[cardId])) ? all[cardId] : [];
      const sorted = list.slice().sort((a, b) => (Number(b && b.createdAt) || 0) - (Number(a && a.createdAt) || 0));
      const withLevels = await withCurrentLevels(sorted);
      res.json({ cardId: cardId, comments: withLevels, total: withLevels.length });
    } catch (e) {
      fail(res, e, '读取评论');
    }
  });

  /**
   * 发表评论（必须登录）。
   *
   * body: { authorId, authorName, content, rating? }
   * ⚠️ authorId / authorName 由 token 覆盖：客户端传什么都不作数，
   *    这样"评论者身份 = 登录用户昵称"是服务端保证的，不是前端自觉。
   *    仍然校验 authorName 字段（长度 1-20），以便前端传了脏数据时能立刻报错。
   */
  app.post('/api/card-comments/:cardId', requireAuth, async (req, res) => {
    if (!ensureR2Or503(res)) return;
    const cardId = normalizeCardId(req.params.cardId);
    if (!cardId) return res.status(400).json({ error: 'cardId 不合法' });

    const body = req.body || {};
    const content = String(body.content == null ? '' : body.content).trim();
    if (content.length < 1 || content.length > MAX_CONTENT_LEN) {
      return res.status(400).json({ error: '评论内容需为 1-' + MAX_CONTENT_LEN + ' 个字符' });
    }

    // 客户端声明的 authorName（若提供）只做长度校验；真正落库的用 token 里的昵称
    if (body.authorName !== undefined && body.authorName !== null && body.authorName !== '') {
      const declared = String(body.authorName).trim();
      if (declared.length < 1 || declared.length > MAX_AUTHOR_NAME_LEN) {
        return res.status(400).json({ error: '昵称需为 1-' + MAX_AUTHOR_NAME_LEN + ' 个字符' });
      }
    }

    let rating = null;
    if (body.rating !== undefined && body.rating !== null && body.rating !== '') {
      const r = _toRating(body.rating);
      if (!(r >= 1 && r <= 5)) return res.status(400).json({ error: 'rating 必须是 1-5 的整数' });
      rating = r;
    }

    const account = req.account || {};
    const authorId = String(account.id || '');
    const authorName = String(account.nickname || account.username || '').trim().slice(0, MAX_AUTHOR_NAME_LEN);
    if (!authorId) return res.status(401).json({ error: '登录状态无效，请重新登录' });

    // 发表时的等级快照：取自账号表（服务端权威），而不是客户端传的值。
    // 读取时还会用数据库里的**当前**等级覆盖它（见 withCurrentLevels），
    // 快照的用途是"离线/无库时兜底 + 留存发表当时的等级"。
    let authorLevel = account.level == null ? null : Number(account.level);
    if (authorLevel == null && db && accounts && typeof db.isConfigured === 'function' && db.isConfigured()) {
      // account 行里没有 level（例如测试注入的假 account）时补查一次
      try {
        const map = await accounts.getLevelsByUserIds(db.getPool(), [authorId]);
        if (map[authorId] != null) authorLevel = map[authorId];
      } catch (e) {
        console.warn('[CardPool] 读取评论者等级失败（快照留空）:', e && e.message);
      }
    }

    const comment = {
      id: _newCommentId(),
      authorId: authorId,
      authorName: authorName,
      // 评论者等级：只存数字，称号由前端用同一张 LEVEL_NAMES 生成（避免两处定义漂移）。
      // 读取时会被数据库里的当前等级覆盖，所以这里是"发表当时"的快照。
      authorLevel: authorLevel,
      content: content,
      rating: rating,
      createdAt: Date.now()
    };

    try {
      await r2.updateJson(r2.COMMENTS_KEY, {}, (current) => {
        const all = _isPlainObject(current) ? Object.assign({}, current) : {};
        const list = Array.isArray(all[cardId]) ? all[cardId].slice() : [];
        list.push(comment);
        // 只保留最近 N 条，避免单张卡片的数组无限膨胀（JSON 整体读写的成本随体积上升）
        all[cardId] = list.length > MAX_COMMENTS_PER_CARD ? list.slice(-MAX_COMMENTS_PER_CARD) : list;
        return { data: all, result: comment };
      });
      console.log('[CardPool] ' + authorName + '（Lv.' + (authorLevel == null ? '?' : authorLevel) + '）评论了 ' + cardId);
      // 回传的评论也带上"当前等级"（与读取接口一致），前端乐观插入时就能显示正确的等级
      const [resolved] = await withCurrentLevels([comment]);
      res.json({ cardId: cardId, comment: resolved || comment });
    } catch (e) {
      fail(res, e, '保存评论');
    }
  });

  /** 删除评论（只允许删自己的） */
  app.delete('/api/card-comments/:cardId/:commentId', requireAuth, async (req, res) => {
    if (!ensureR2Or503(res)) return;
    const cardId = normalizeCardId(req.params.cardId);
    if (!cardId) return res.status(400).json({ error: 'cardId 不合法' });
    const commentId = String(req.params.commentId || '').trim();
    if (!commentId) return res.status(400).json({ error: 'commentId 不能为空' });

    const account = req.account || {};
    const meId = String(account.id || '');

    try {
      // 先在锁外快速判定"评论是否存在 / 是不是我的"，拿到明确状态码；
      // 真正的删除在锁内再校验一次（期间可能已被并发删除）
      const all = await r2.readComments();
      const list = (_isPlainObject(all) && Array.isArray(all[cardId])) ? all[cardId] : [];
      const found = list.find((c) => c && c.id === commentId);
      if (!found) return res.status(404).json({ error: '评论不存在或已被删除' });
      if (String(found.authorId || '') !== meId) {
        return res.status(403).json({ error: '只能删除自己的评论' });
      }

      const removed = await r2.updateJson(r2.COMMENTS_KEY, {}, (current) => {
        const data = _isPlainObject(current) ? Object.assign({}, current) : {};
        const arr = Array.isArray(data[cardId]) ? data[cardId].slice() : [];
        const idx = arr.findIndex((c) => c && c.id === commentId);
        // 并发下已被别人删掉：不写回（避免无谓写入），用 null 表达"已不存在"
        if (idx === -1) return { data: undefined, result: null };
        if (String(arr[idx].authorId || '') !== meId) return { data: undefined, result: 'forbidden' };
        const [target] = arr.splice(idx, 1);
        data[cardId] = arr;
        return { data: data, result: target || true };
      });

      if (removed === null) return res.status(404).json({ error: '评论不存在或已被删除' });
      if (removed === 'forbidden') return res.status(403).json({ error: '只能删除自己的评论' });

      console.log('[CardPool] ' + (account.username || meId) + ' 删除了评论 ' + commentId);
      res.json({ cardId: cardId, commentId: commentId, deleted: true });
    } catch (e) {
      fail(res, e, '删除评论');
    }
  });
}

module.exports = {
  registerCardPoolRoutes,
  normalizeCardId,
  MAX_CONTENT_LEN,
  MAX_AUTHOR_NAME_LEN
};
