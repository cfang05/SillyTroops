// src/pages/cardpool/utils/cardpool_stats.js
// 卡池统计与评论的 API 封装（评分 / 下载量 / 评论）
//
// 数据全部来自 server.js（见根目录 cardpool.js + r2.js，落在 R2 的 stats.json / comments.json），
// 前端**不做任何本地累加**：评分与下载量是全局统计，必须以服务端返回值为准，
// 否则多设备/多用户之间会各算各的。
//
// 身份说明：评论的 authorId / authorName 由服务端从登录 token 里取（不接受客户端自报），
// 这里仍然按接口约定把当前登录用户的信息一起发过去，方便服务端做字段校验与日志。

// 卡片本体（封面/原卡）所在的 R2 公开域名：manifest.json 也在这里
export const R2_BASE_URL = 'https://cardpool.sillytroops.com';

/** 拼接 R2 上的资源地址（manifest 里的 thumb / file 都是相对路径，如 xxx-thumb.webp） */
export function r2Url(path) {
  if (!path) return '';
  const p = String(path);
  if (/^https?:\/\//i.test(p)) return p;
  return R2_BASE_URL + '/' + p.replace(/^\/+/, '');
}

// ── 请求封装 ─────────────────────────────────────────────────
// 与 userManager 一致：H5 同源走相对路径；小程序端没有相对路径可依托，
// 未配置后端地址时给出清晰失败而不是静默不工作。
const MINI_PROGRAM_API_BASE = '';

function _apiBase() {
  // #ifdef H5
  return ''; // 与后端同源，走相对路径
  // #endif
  // #ifndef H5
  return MINI_PROGRAM_API_BASE;
  // #endif
}

let _tokenGetter = null;

/**
 * 注入"取登录 token"的方法（由页面在 onLoad 时调用）。
 * 这样工具层不必直接依赖 userManager 的模块路径，也方便单测替换。
 */
export function configureCardPoolStats(getter) {
  _tokenGetter = typeof getter === 'function' ? getter : null;
}

function _authHeader() {
  const header = { 'Content-Type': 'application/json' };
  try {
    const token = _tokenGetter ? _tokenGetter() : '';
    if (token) header.Authorization = 'Bearer ' + token;
  } catch (e) { /* 取不到 token 就当匿名，服务端会返回 401 */ }
  return header;
}

function _request(path, options) {
  const opts = options || {};
  const base = _apiBase();
  if (!base && typeof window === 'undefined') {
    return Promise.reject(new Error('当前平台未配置卡池服务地址'));
  }
  return new Promise(function (resolve, reject) {
    uni.request({
      url: base + path,
      method: opts.method || 'GET',
      header: _authHeader(),
      data: opts.body || undefined,
      success: function (res) {
        let data = res.data;
        if (typeof data === 'string') {
          try { data = JSON.parse(data); } catch (e) { data = null; }
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data || {});
        } else {
          const err = new Error((data && (data.error || data.detail)) || ('HTTP ' + res.statusCode));
          err.status = res.statusCode;
          reject(err);
        }
      },
      fail: function (err) {
        const e = new Error('网络请求失败: ' + (err && err.errMsg ? err.errMsg : '未知错误'));
        e.networkError = true;
        reject(e);
      }
    });
  });
}

function _enc(v) {
  return encodeURIComponent(String(v == null ? '' : v));
}

// ── 评分 + 下载量 ────────────────────────────────────────────
/** 全量统计：{ "<cardId>": { ratingSum, ratingCount, downloadCount } } */
export function fetchCardStats() {
  return _request('/api/card-stats');
}

/**
 * 提交评分。
 * @param {string} cardId
 * @param {number} rating 1-5
 * @param {number|null} previousRating 本地记录的旧评分；传了表示"改分"，
 *        服务端只调整 ratingSum 不增加 ratingCount（见 cardpool.js 的注释）
 * @returns {Promise<{cardId:string, stats:object, updated:boolean}>}
 */
export function rateCard(cardId, rating, previousRating) {
  const body = { rating: rating };
  if (previousRating) body.previousRating = previousRating;
  return _request('/api/card-stats/' + _enc(cardId) + '/rate', { method: 'POST', body: body });
}

/** 下载次数 +1 */
export function recordDownload(cardId) {
  return _request('/api/card-stats/' + _enc(cardId) + '/download', { method: 'POST', body: {} });
}

// ── 评论 ─────────────────────────────────────────────────────
/** 某卡片的评论列表（服务端已按 createdAt 倒序） */
export function fetchComments(cardId) {
  return _request('/api/card-comments/' + _enc(cardId));
}

/**
 * 发表评论。
 * @param {string} cardId
 * @param {{authorId:string, authorName:string, content:string, rating?:number|null, previousRating?:number}} payload
 */
export function postComment(cardId, payload) {
  const body = {
    authorId: payload.authorId,
    authorName: payload.authorName,
    content: payload.content
  };
  if (payload.rating) body.rating = payload.rating;
  if (payload.previousRating) body.previousRating = payload.previousRating;
  return _request('/api/card-comments/' + _enc(cardId), { method: 'POST', body: body });
}

/**
 * 详情页的「评分 + 评论一起提交」。
 *
 * 走的就是评论接口（服务端的评论接口支持可选 rating，会复用与 /rate 完全相同的评分语义），
 * 但语义上它是一次"提交"而不是"发评论"，所以单独包一个名字更清楚。
 *
 * @param {string} cardId
 * @param {{authorId:string, authorName:string, content:string, rating?:number|null, previousRating?:number}} payload
 * @returns {Promise<{cardId:string, comment:object, stats:object|null, rated:boolean}>}
 *          stats 仅在本次带了评分时返回（前端据此刷新星级人数/平均分）
 */
export function submitRatingAndComment(cardId, payload) {
  return postComment(cardId, payload);
}

/** 删除评论（服务端只允许删自己的，否则 403） */
export function deleteComment(cardId, commentId) {
  return _request('/api/card-comments/' + _enc(cardId) + '/' + _enc(commentId), { method: 'DELETE' });
}

// ── 卡片展示用纯函数（放这里是为了让页面/弹窗共用同一套口径） ─────

/**
 * 卡片在界面上展示用的 tag 列表：**优先用中文 tag（tagsZh）**，没有才回退到英文 tags。
 *
 * 为什么必须有回退：manifest 由外部上传脚本产出，`tagsZh` 是后加的字段。
 * 如果这里写死只读 tagsZh，那么在管理员重新上传、manifest 还没带上该字段的这段时间里，
 * 所有卡片的封面标签会**整片消失** —— 既不报错也没有提示，属于很难发现的那种坏法。
 * 有兜底则新旧 manifest 都能正常显示。
 *
 * @param {object} card manifest 里的一张卡
 * @returns {string[]}
 */
export function displayTags(card) {
  if (!card) return []
  if (Array.isArray(card.tagsZh) && card.tagsZh.length) return card.tagsZh
  if (Array.isArray(card.tags)) return card.tags
  return []
}

/**
 * 平均分，保留 1 位小数。
 * @returns {number|null} 无人评分时返回 null（前端显示「暂无评分」）
 */
export function averageRating(stats) {
  const count = Number(stats && stats.ratingCount) || 0;
  const sum = Number(stats && stats.ratingSum) || 0;
  if (count <= 0) return null;
  return Math.round((sum / count) * 10) / 10;
}

/** 平均分的展示文本：无评分 → '暂无评分'；有评分 → '4.7' */
export function ratingText(stats) {
  const avg = averageRating(stats);
  return avg === null ? '暂无评分' : avg.toFixed(1);
}

/** 下载量的展示文本；stats 整体缺失（API 失败）时返回 '--' */
export function downloadText(stats) {
  if (!stats) return '--';
  return String(Number(stats.downloadCount) || 0);
}

/** 相对时间：'刚刚' / '3 分钟前' / '2 小时前' / '3 天前' / 'YYYY-MM-DD' */
export function relativeTime(ts) {
  const t = Number(ts) || 0;
  if (!t) return '';
  const diff = Date.now() - t;
  if (diff < 0) return '刚刚';
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return min + ' 分钟前';
  const hour = Math.floor(min / 60);
  if (hour < 24) return hour + ' 小时前';
  const day = Math.floor(hour / 24);
  if (day < 30) return day + ' 天前';
  const d = new Date(t);
  const pad = (n) => (n < 10 ? '0' + n : String(n));
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

// ── 评分本地记录（rated_cards） ──────────────────────────────
// 用于"同一用户重复评分"的策略：本地记住自己给过几分，改分时把旧值带给服务端。
// 注意：它只是"本设备上我的评分记录"，不是防刷手段。
const RATED_KEY = 'rated_cards';

export function getRatedMap() {
  try {
    const raw = uni.getStorageSync(RATED_KEY);
    if (raw && typeof raw === 'object') return raw;
    if (typeof raw === 'string' && raw) return JSON.parse(raw);
  } catch (e) { /* 存储异常按无记录处理 */ }
  return {};
}

export function getMyRating(cardId) {
  const v = getRatedMap()[cardId];
  const n = Number(v);
  return v !== undefined && n >= 1 && n <= 5 ? n : 0;
}

export function setMyRating(cardId, rating) {
  try {
    const map = getRatedMap();
    map[cardId] = rating;
    uni.setStorageSync(RATED_KEY, map);
  } catch (e) {
    console.warn('[CardPool] 写入本地评分记录失败:', e && e.message);
  }
}

export default {
  R2_BASE_URL,
  r2Url,
  configureCardPoolStats,
  fetchCardStats,
  rateCard,
  recordDownload,
  fetchComments,
  postComment,
  submitRatingAndComment,
  deleteComment,
  displayTags,
  averageRating,
  ratingText,
  downloadText,
  relativeTime,
  getRatedMap,
  getMyRating,
  setMyRating
};
